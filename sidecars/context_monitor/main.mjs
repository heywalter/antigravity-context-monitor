/**
 * Read-only Context & Usage Monitor sidecar backend.
 *
 * Serves the auxiliary pane UI and exposes `/api/usage` to read token usage and
 * context growth metrics from the active conversation's local `transcript.jsonl`.
 */
import { execFile, spawn } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import {
  accessSync,
  chmodSync,
  constants,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { homedir } from 'node:os';
import { basename, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { SidecarApp, Response } from 'sidecar_sdk';
import { ID_RE, parseTranscriptMetrics } from './metrics.mjs';
import { computeReferenceCost, getGlobalHistory } from './history.mjs';
import {
  applyHudPrefsPatch,
  isHudSupported,
  normalizeHudPrefs,
  resolveEffectiveWindowLimit,
} from './prefs.mjs';
import { ConversationTitleResolver } from './titles.mjs';
import { ConversationTimingReader } from './ttft.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const STATIC = {
  '/styles.css': ['styles.css', 'text/css; charset=utf-8'],
  '/app.js': ['app.js', 'application/javascript; charset=utf-8'],
};

function safeReaddir(dirPath) {
  try {
    return readdirSync(dirPath);
  } catch {
    return [];
  }
}

function statOf(filePath) {
  try {
    const s = statSync(filePath);
    return { mtime: s.mtimeMs, size: s.size };
  } catch {
    return { mtime: 0, size: -1 };
  }
}

/**
 * Locates Antigravity appData roots containing `brain/`.
 * When launched by the Language Server, `ANTIGRAVITY_EXECUTABLE_DATA_DIR` pins
 * this sidecar to its own product directory.
 */
function findAppDataDirs() {
  const dataDir = process.env.ANTIGRAVITY_EXECUTABLE_DATA_DIR;
  if (dataDir) {
    for (let d = dataDir; d !== dirname(d); d = dirname(d)) {
      if (basename(d) !== 'sidecar_data') continue;
      const appData = dirname(d);
      return existsSync(join(appData, 'brain')) ? [appData] : [];
    }
    return [];
  }
  const root = join(homedir(), '.gemini');
  return safeReaddir(root)
    .sort()
    .map((name) => join(root, name))
    .filter((candidate) => existsSync(join(candidate, 'brain')));
}

function findTranscriptPath(conv) {
  if (!conv || !ID_RE.test(conv)) return null;
  for (const appData of findAppDataDirs()) {
    const convDir = join(appData, 'brain', conv);
    if (!existsSync(convDir)) continue;
    const candidate = join(convDir, '.system_generated', 'logs', 'transcript.jsonl');
    return { appData, convDir, transcriptPath: candidate };
  }
  return null;
}

function fetchTitle(conv) {
  const exe = process.env.ANTIGRAVITY_AGENTAPI_EXE;
  const file = exe || 'agentapi';
  const args = [...(exe ? ['agentapi'] : []), 'get-conversation-metadata', conv];
  return new Promise((resolve) => {
    execFile(file, args, { encoding: 'utf-8', timeout: 3000 }, (err, stdout) => {
      if (err) return resolve('');
      try {
        const md = JSON.parse(stdout || '{}');
        const meta = md?.response?.conversationMetadata?.metadata || md?.response?.conversation_metadata?.metadata;
        resolve(meta?.title || md.title || md.summary || md.name || md.metadata?.title || md.conversation?.title || '');
      } catch {
        resolve('');
      }
    });
  });
}

const titleResolver = new ConversationTitleResolver({
  idPattern: ID_RE,
  fetchFallback: fetchTitle,
  cacheTtlMs: 15_000,
});

const timingReader = new ConversationTimingReader({ idPattern: ID_RE });

function convTitle(conv) {
  return titleResolver.resolve(conv, findAppDataDirs());
}

const metricsCache = new Map(); // transcriptPath -> { etagKey, metrics }

function applyTimingToMetrics(baseMetrics, timing) {
  if (!baseMetrics || !timing || !timing.measuredSteps) {
    return baseMetrics;
  }
  const byIdx = timing.byStepIndex;
  return {
    ...baseMetrics,
    totals: {
      ...baseMetrics.totals,
      avgTtftMs: timing.avgTtftMs,
      lastTtftMs: timing.lastTtftMs,
      ttftSampleCount: timing.measuredSteps,
    },
    timeline: Array.isArray(baseMetrics.timeline)
      ? baseMetrics.timeline.map((item) => {
          const stepTiming = byIdx.get(item.stepIndex);
          return stepTiming ? { ...item, ttftMs: stepTiming.ttftMs } : item;
        })
      : [],
  };
}

function readConversationMetrics(conv, { includeTiming = false } = {}) {
  const located = findTranscriptPath(conv);
  if (!located) {
    return { found: false, etag: `${conv}|missing`, title: convTitle(conv), metrics: null };
  }
  const { transcriptPath } = located;
  const st = statOf(transcriptPath);
  const title = convTitle(conv);
  if (st.size < 0) {
    return { found: true, hasTranscript: false, etag: `${conv}|empty|${title}`, title, metrics: null };
  }
  const hit = metricsCache.get(transcriptPath);
  let baseMetrics = hit && hit.etagKey === `${st.mtime}:${st.size}` ? hit.metrics : null;
  if (!baseMetrics) {
    let raw = '';
    try {
      raw = readFileSync(transcriptPath, 'utf-8');
    } catch {
      return { found: true, hasTranscript: false, etag: `${conv}|unreadable`, title, metrics: null };
    }
    baseMetrics = parseTranscriptMetrics(raw, { mtimeMs: st.mtime });
    if (metricsCache.size > 100) metricsCache.clear();
    metricsCache.set(transcriptPath, { etagKey: `${st.mtime}:${st.size}`, metrics: baseMetrics });
  }

  const timing = includeTiming ? timingReader.read(conv, findAppDataDirs()) : null;
  const timingSig = timing ? `${timing.avgTtftMs ?? ''}:${timing.lastTtftMs ?? ''}:${timing.measuredSteps}` : '';
  const etag = `${conv}|${st.mtime}:${st.size}|${title}|${timingSig}`;
  const metrics = timing ? applyTimingToMetrics(baseMetrics, timing) : baseMetrics;
  return { found: true, hasTranscript: true, etag, title, metrics };
}

function resolveDefaultStateDir() {
  return join(homedir(), '.gemini', 'antigravity', 'sidecar_data', 'context-monitor', 'context_monitor');
}

function resolveStateDir() {
  return process.env.ANTIGRAVITY_EXECUTABLE_DATA_DIR || resolveDefaultStateDir();
}

function effectiveConvTitle(snap) {
  return snap?.title || snap?.metrics?.turns?.[0]?.preview || '';
}

const modelByConv = new Map(); // convId -> modelName
const hookCache = { path: '', key: '', value: null };

function readActiveHook() {
  const candidates = [...new Set([
    join(resolveStateDir(), 'active_hook.json'),
    join(resolveDefaultStateDir(), 'active_hook.json'),
  ])];
  let bestPath = '';
  let bestSt = { mtime: 0, size: -1 };
  for (const p of candidates) {
    const st = statOf(p);
    if (st.size >= 0 && st.mtime >= bestSt.mtime) {
      bestPath = p;
      bestSt = st;
    }
  }
  if (!bestPath) return null;
  const key = `${bestSt.mtime}:${bestSt.size}`;
  if (hookCache.path === bestPath && hookCache.key === key) {
    return hookCache.value;
  }
  try {
    const parsed = JSON.parse(readFileSync(bestPath, 'utf-8'));
    const convId = typeof parsed?.conversationId === 'string' ? parsed.conversationId.trim() : '';
    const modelName = typeof parsed?.modelName === 'string' ? parsed.modelName.trim() : '';
    if (ID_RE.test(convId) && modelName) {
      if (modelByConv.size > 200) modelByConv.clear();
      modelByConv.set(convId, modelName);
    }
    const val = ID_RE.test(convId)
      ? { conversationId: convId, modelName, hookMtimeMs: bestSt.mtime }
      : null;
    hookCache.path = bestPath;
    hookCache.key = key;
    hookCache.value = val;
    return val;
  } catch {
    return null;
  }
}

let recentCache = { atMs: 0, list: [] };

function scanRecentConversations() {
  const now = Date.now();
  if (now - recentCache.atMs < 1500) {
    return recentCache.list;
  }
  const byId = new Map();
  for (const appData of findAppDataDirs()) {
    const brainDir = join(appData, 'brain');
    for (const name of safeReaddir(brainDir)) {
      if (!ID_RE.test(name)) continue;
      const transcriptPath = join(brainDir, name, '.system_generated', 'logs', 'transcript.jsonl');
      const st = statOf(transcriptPath);
      if (st.size < 0) continue;
      const prev = byId.get(name);
      if (!prev || st.mtime > prev.mtimeMs) {
        byId.set(name, { conversationId: name, transcriptPath, mtimeMs: st.mtime, size: st.size });
      }
    }
  }
  const list = [...byId.values()]
    .sort((a, b) => b.mtimeMs - a.mtimeMs)
    .slice(0, 10);
  recentCache = { atMs: now, list };
  return list;
}

const lastAuxViewed = { conversationId: '', atMs: 0 };

function resolveActiveConversation() {
  const hookInfo = readActiveHook();
  const recent = scanRecentConversations();
  const candidates = [];
  if (recent[0]) {
    candidates.push({ id: recent[0].conversationId, ts: recent[0].mtimeMs });
  }
  if (hookInfo?.conversationId) {
    candidates.push({ id: hookInfo.conversationId, ts: hookInfo.hookMtimeMs });
  }
  if (lastAuxViewed.conversationId && ID_RE.test(lastAuxViewed.conversationId)) {
    candidates.push({ id: lastAuxViewed.conversationId, ts: lastAuxViewed.atMs });
  }
  if (app.config?.conversationId && ID_RE.test(app.config.conversationId)) {
    candidates.push({ id: app.config.conversationId, ts: 0 });
  }
  candidates.sort((a, b) => b.ts - a.ts);
  return {
    activeConversationId: candidates[0]?.id || null,
    hookInfo,
    recent,
  };
}

function modelNameForConv(conv, hookInfo) {
  if (!conv) return '';
  return modelByConv.get(conv) || (hookInfo?.conversationId === conv ? hookInfo.modelName : '') || '';
}

function buildHudSummary(metrics) {
  if (!metrics || !metrics.hasData) return null;
  const c = metrics.current || {};
  const t = metrics.totals || {};
  return {
    userTurns: t.userTurns ?? 0,
    stepsCount: t.stepsCount ?? 0,
    modelCalls: t.modelCalls ?? 0,
    toolCalls: t.toolCalls ?? 0,
    checkpoints: t.checkpoints ?? 0,
    observedCompactionTokens: t.observedCompactionTokens ?? null,
    allTokens: t.allTokens ?? 0,
    promptTokens: t.promptTokens ?? 0,
    inputTokens: t.inputTokens ?? 0,
    cacheReadTokens: t.cacheReadTokens ?? 0,
    outputTokens: t.outputTokens ?? 0,
    overallCacheHitRate: t.overallCacheHitRate ?? 0,
    avgTokPerSec: t.avgTokPerSec ?? null,
    lastTokPerSec: t.lastTokPerSec ?? null,
    avgTtftMs: t.avgTtftMs ?? null,
    lastTtftMs: t.lastTtftMs ?? null,
    ttftSampleCount: t.ttftSampleCount ?? 0,
    currentPromptTokens: c.promptTokens ?? 0,
    estimatedNextContextTokens: c.estimatedNextContextTokens ?? 0,
    initialBaselineTokens: c.initialBaselineTokens ?? 0,
    growthTokens: c.growthTokens ?? 0,
    currentCacheHitRate: c.cacheHitRate ?? 0,
    cost: computeReferenceCost(t),
  };
}

function compactHistoryBucket(b) {
  return {
    allTokens: b?.allTokens ?? 0,
    inputTokens: b?.inputTokens ?? 0,
    cacheReadTokens: b?.cacheReadTokens ?? 0,
    outputTokens: b?.outputTokens ?? 0,
    cacheHitRate: b?.cacheHitRate ?? 0,
    steps: b?.steps ?? 0,
    sessions: b?.sessions ?? 0,
    totalCostUsd: b?.cost?.totalCostUsd ?? 0,
    totalCostCny: b?.cost?.totalCostCny ?? 0,
    savedByCacheUsd: b?.cost?.savedByCacheUsd ?? 0,
  };
}

function readEnrichedHistory({ source = 'all', force = false } = {}) {
  const antigravityDataDir = findAppDataDirs()[0];
  const hist = getGlobalHistory({ antigravityDataDir, sourceFilter: source, force });
  return {
    ...hist,
    topSessions: hist.topSessions.map((s) => ({
      ...s,
      title: convTitle(s.conversationId) || s.title || '',
    })),
  };
}

console.log(`[context_monitor] app data dirs: ${findAppDataDirs().join(', ') || '(pending)'}`);

const hudToken = randomBytes(16).toString('hex');
const app = new SidecarApp();

app.page('/', () => readFileSync(join(__dirname, 'index.html'), 'utf-8'));

for (const [route, [file, contentType]] of Object.entries(STATIC)) {
  app.api(route, () => new Response(readFileSync(join(__dirname, file), 'utf-8'), { contentType }), 'GET');
}

app.api('/api/usage', (data) => {
  const resolved = resolveActiveConversation();
  const explicitConv = String(data.conversationId || app.config?.conversationId || '').trim();
  const hasExplicit = Boolean(explicitConv && ID_RE.test(explicitConv));
  const conv = hasExplicit ? explicitConv : (resolved.activeConversationId || '');
  if (!conv || !ID_RE.test(conv)) {
    return { conversationId: null, found: false, unchanged: false, etag: 'none', metrics: null, cost: null };
  }
  if (hasExplicit && lastAuxViewed.conversationId !== conv) {
    lastAuxViewed.conversationId = conv;
    lastAuxViewed.atMs = Date.now();
  }
  const snap = readConversationMetrics(conv, { includeTiming: true });
  const title = effectiveConvTitle(snap);
  const modelName = modelNameForConv(conv, resolved.hookInfo);
  const prefs = readHudPrefs();
  const windowLimitInfo = resolveEffectiveWindowLimit({ prefs, modelName, metrics: snap.metrics });
  const etag = `${snap.etag}|${title}|${modelName}|${prefs.windowLimit}|${windowLimitInfo.limit}:${windowLimitInfo.source}`;
  if (data.etag && data.etag === etag) {
    return { conversationId: conv, found: snap.found, unchanged: true, etag };
  }
  return {
    conversationId: conv,
    found: snap.found,
    hasTranscript: Boolean(snap.hasTranscript),
    title,
    modelName,
    windowLimitInfo,
    unchanged: false,
    etag,
    metrics: snap.metrics,
    cost: snap.metrics?.hasData ? computeReferenceCost(snap.metrics.totals) : null,
  };
}, 'GET');

app.api('/api/history', (data) => {
  const source = String(data.source || 'all').trim();
  const force = data.force === '1' || data.force === 'true';
  return readEnrichedHistory({ source, force });
}, 'GET');

app.api('/api/hud', (data) => {
  if (!data.hudToken || data.hudToken !== hudToken) {
    return new Response(JSON.stringify({ error: 'unauthorized' }), {
      contentType: 'application/json',
      status: 401,
    });
  }
  const { activeConversationId, hookInfo, recent } = resolveActiveConversation();
  const pinned = String(data.conversationId || '').trim();
  const selectedConversationId = pinned && ID_RE.test(pinned) ? pinned : activeConversationId;

  const snap = selectedConversationId
    ? readConversationMetrics(selectedConversationId, { includeTiming: true })
    : { found: false, etag: 'none', title: '', metrics: null };
  const title = effectiveConvTitle(snap);
  const modelName = modelNameForConv(selectedConversationId, hookInfo);

  const recentSessions = recent.slice(0, 8).map((item) => {
    const rSnap = readConversationMetrics(item.conversationId);
    const rTitle = effectiveConvTitle(rSnap);
    return {
      conversationId: item.conversationId,
      title: rTitle,
      promptTokens: rSnap.metrics?.current?.promptTokens ?? 0,
      estimatedNextContextTokens: rSnap.metrics?.current?.estimatedNextContextTokens ?? 0,
      stepsCount: rSnap.metrics?.totals?.stepsCount ?? 0,
      userTurns: rSnap.metrics?.totals?.userTurns ?? 0,
      isRunning: Boolean(rSnap.metrics?.isRunning),
      updatedAt: rSnap.metrics?.updatedAt || new Date(item.mtimeMs).toISOString(),
    };
  });

  const hist = readEnrichedHistory({ source: 'all', force: false });
  const prefs = readHudPrefs();
  const windowLimitInfo = resolveEffectiveWindowLimit({ prefs, modelName, metrics: snap.metrics });
  const recentSig = recentSessions.map((r) => `${r.conversationId}:${r.stepsCount}:${r.title}`).join(';');
  const prefsSig = `${prefs.anchorPosition}:${prefs.capsuleStyle}:${prefs.displayMode}:${prefs.windowLimit}:${windowLimitInfo.limit}:${windowLimitInfo.source}:${prefs.language}`;
  const etag = `${selectedConversationId || 'none'}|${snap.etag}|${title}|${modelName}|${recentSig}|${hist.todayKey}:${hist.allTime.allTokens}|${prefsSig}`;
  if (data.etag && data.etag === etag) {
    return { unchanged: true, etag };
  }

  return {
    unchanged: false,
    etag,
    activeConversationId,
    selectedConversationId,
    title,
    modelName,
    effectiveWindowLimit: windowLimitInfo.limit,
    windowLimitMode: windowLimitInfo.mode,
    windowLimitSource: windowLimitInfo.source,
    found: Boolean(snap.found),
    hasData: Boolean(snap.metrics?.hasData),
    isRunning: Boolean(snap.metrics?.isRunning),
    summary: buildHudSummary(snap.metrics),
    prefs,
    recentSessions,
    historySummary: {
      todayKey: hist.todayKey,
      today: compactHistoryBucket(hist.today),
      last7Days: compactHistoryBucket(hist.last7Days),
      thisMonth: compactHistoryBucket(hist.thisMonth),
      allTime: compactHistoryBucket(hist.allTime),
      bySource: {
        desktop: {
          sessions: hist.bySource.desktop.sessions,
          allTokens: hist.bySource.desktop.allTokens,
          totalCostUsd: hist.bySource.desktop.cost.totalCostUsd,
        },
        cli: {
          sessions: hist.bySource.cli.sessions,
          allTokens: hist.bySource.cli.allTokens,
          totalCostUsd: hist.bySource.cli.cost.totalCostUsd,
        },
      },
      heatmap: hist.heatmap.map((c) => ({
        date: c.date,
        weekday: c.weekday,
        allTokens: c.allTokens,
        level: c.level,
        costUsd: c.costUsd,
      })),
    },
  };
}, 'GET');

function hudPrefsPath() {
  return join(resolveStateDir(), 'hud_prefs.json');
}

function readHudPrefs() {
  try {
    return normalizeHudPrefs(JSON.parse(readFileSync(hudPrefsPath(), 'utf-8')));
  } catch {
    return normalizeHudPrefs({});
  }
}

function writeHudPrefs(patch) {
  const clean = applyHudPrefsPatch(readHudPrefs(), patch);
  const p = hudPrefsPath();
  mkdirSync(dirname(p), { recursive: true });
  const tmp = `${p}.${process.pid}.tmp`;
  writeFileSync(tmp, JSON.stringify(clean, null, 2) + '\n', 'utf-8');
  renameSync(tmp, p);
  return clean;
}

app.api('/api/hud/prefs', () => ({ ...readHudPrefs(), hudSupported: isHudSupported() }), 'GET');

app.api('/api/hud/prefs', (data) => ({
  ok: true,
  prefs: { ...writeHudPrefs(data), hudSupported: isHudSupported() },
}), 'POST');

function pipeLines(stream, prefix, fn) {
  let buf = '';
  stream.on('data', (chunk) => {
    buf += chunk.toString('utf-8');
    let nl = buf.indexOf('\n');
    while (nl !== -1) {
      const line = buf.slice(0, nl).trimEnd();
      if (line) fn(`${prefix} ${line}`);
      buf = buf.slice(nl + 1);
      nl = buf.indexOf('\n');
    }
  });
  stream.on('end', () => {
    const tail = buf.trimEnd();
    if (tail) fn(`${prefix} ${tail}`);
  });
}

function isExecutable(filePath) {
  try {
    accessSync(filePath, constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

function compileHudBinaryAsync(swiftSrc, outBin) {
  const tmpBin = `${outBin}.${process.pid}.tmp`;
  return new Promise((resolve) => {
    execFile(
      'swiftc',
      ['-O', '-o', tmpBin, swiftSrc, '-framework', 'Cocoa', '-framework', 'CoreGraphics'],
      { encoding: 'utf-8', timeout: 90_000 },
      (compileErr) => {
        if (compileErr) {
          try { rmSync(tmpBin, { force: true }); } catch {}
          resolve(false);
          return;
        }
        try {
          chmodSync(tmpBin, 0o755);
        } catch {
          try { rmSync(tmpBin, { force: true }); } catch {}
          resolve(false);
          return;
        }
        execFile(tmpBin, ['--self-test'], { encoding: 'utf-8', timeout: 10_000 }, (testErr, stdout) => {
          if (testErr || !String(stdout || '').includes('SELF_TEST_OK')) {
            try { rmSync(tmpBin, { force: true }); } catch {}
            resolve(false);
            return;
          }
          try {
            renameSync(tmpBin, outBin);
            resolve(true);
          } catch {
            try { rmSync(tmpBin, { force: true }); } catch {}
            resolve(false);
          }
        });
      },
    );
  });
}

async function resolveHudBinary(stateDir) {
  const swiftSrc = join(__dirname, 'hud_bar.swift');
  const bundledBin = join(__dirname, 'hud_bar');

  if (existsSync(swiftSrc)) {
    const desiredHash = createHash('sha256')
      .update(readFileSync(swiftSrc))
      .update(`:${process.platform}:${process.arch}`)
      .digest('hex');
    const binDir = join(stateDir, 'bin');
    const cachedBin = join(binDir, 'hud_bar');
    const hashPath = join(binDir, 'hud_bar.sha256');

    if (
      isExecutable(cachedBin) &&
      existsSync(hashPath) &&
      readFileSync(hashPath, 'utf-8').trim() === desiredHash
    ) {
      return cachedBin;
    }

    mkdirSync(binDir, { recursive: true });
    console.log(`[context_monitor] Building native macOS HUD (hud_bar.swift) for ${process.arch}...`);
    if (await compileHudBinaryAsync(swiftSrc, cachedBin)) {
      writeFileSync(hashPath, `${desiredHash}\n`, 'utf-8');
      return cachedBin;
    }
  }

  if (isExecutable(bundledBin)) {
    return bundledBin;
  }

  console.warn('[context_monitor] Native macOS HUD unavailable (install Xcode Command Line Tools for floating capsule); Aux Pane remains active.');
  return null;
}

function startHudSupervisor(server) {
  if (process.platform !== 'darwin' || process.env.CONTEXT_MONITOR_NO_HUD === '1') {
    return;
  }

  const stateDir = resolveStateDir();
  mkdirSync(stateDir, { recursive: true });
  const port = server.address().port;
  const apiUrl = `http://127.0.0.1:${port}/api/hud`;
  const prefsPath = join(stateDir, 'hud_prefs.json');

  let shuttingDown = false;
  let hudChild = null;
  let respawnTimer = null;

  const stopHudChild = () => {
    if (respawnTimer) {
      clearTimeout(respawnTimer);
      respawnTimer = null;
    }
    if (hudChild && !hudChild.killed) {
      try {
        hudChild.kill('SIGTERM');
      } catch {
        // Ignore already exited child.
      }
    }
  };

  const launch = (hudBin) => {
    if (shuttingDown) return;
    hudChild = spawn(hudBin, ['--api', apiUrl, '--prefs', prefsPath, '--ppid', String(process.pid)], {
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env, CONTEXT_MONITOR_HUD_TOKEN: hudToken },
    });
    if (hudChild.stdout) pipeLines(hudChild.stdout, '[hud_bar]', console.log);
    if (hudChild.stderr) pipeLines(hudChild.stderr, '[hud_bar]', console.error);
    hudChild.on('exit', (code, signal) => {
      hudChild = null;
      if (shuttingDown) return;
      console.error(`[context_monitor] hud_bar exited (code=${code}, signal=${signal}); respawning in 3s`);
      respawnTimer = setTimeout(() => launch(hudBin), 3000);
    });
    hudChild.on('error', (err) => {
      console.error(`[context_monitor] hud_bar spawn error: ${err.message}`);
    });
  };

  const shutdown = () => {
    if (shuttingDown) return;
    shuttingDown = true;
    stopHudChild();
    const forceExit = setTimeout(() => process.exit(0), 500);
    forceExit.unref();
    server.close(() => process.exit(0));
  };

  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
  process.on('exit', () => {
    shuttingDown = true;
    stopHudChild();
  });

  resolveHudBinary(stateDir).then((hudBin) => {
    if (!hudBin || shuttingDown) return;
    launch(hudBin);
  });
}

app.run().then((server) => {
  startHudSupervisor(server);
});
