/**
 * Cross-session token history, 12-week heatmap, and API reference cost aggregator.
 *
 * Scans Antigravity Desktop (`~/.gemini/antigravity/brain`) and CLI
 * (`~/.gemini/antigravity-cli/brain`) transcripts incrementally using an in-memory
 * `mtimeMs:size` cache so unchanged conversations are never re-parsed.
 */
import { existsSync, readdirSync, statSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { ID_RE } from './metrics.mjs';

export const REFERENCE_PRICING = {
  inputUsdPerMillion: 2.0,
  cacheReadUsdPerMillion: 0.2,
  outputUsdPerMillion: 10.0,
  usdToCny: 7.25,
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
    return { mtimeMs: s.mtimeMs, size: s.size };
  } catch {
    return { mtimeMs: 0, size: -1 };
  }
}

function num(v) {
  return typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : 0;
}

function cleanPreview(content) {
  if (typeof content !== 'string' || !content.trim()) return '';
  const match = content.match(/<USER_REQUEST>\s*([\s\S]*?)\s*<\/USER_REQUEST>/i);
  const raw = match ? match[1] : content;
  const normalized = raw.replace(/\s+/g, ' ').trim();
  return normalized.length > 72 ? `${normalized.slice(0, 71).trimEnd()}…` : normalized;
}

/**
 * Converts a timestamp (ms) into a local calendar `YYYY-MM-DD` string.
 */
export function toLocalDateKey(ms) {
  const d = new Date(ms);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function stepDateKey(createdAt, fallbackDateKey) {
  if (typeof createdAt === 'string' && createdAt) {
    const parsed = Date.parse(createdAt);
    if (Number.isFinite(parsed)) {
      return toLocalDateKey(parsed);
    }
  }
  return fallbackDateKey;
}

/**
 * Computes reference API billing and Prompt Caching savings for a token tally.
 */
export function computeReferenceCost({ inputTokens = 0, cacheReadTokens = 0, outputTokens = 0 } = {}) {
  const inp = num(inputTokens);
  const cache = num(cacheReadTokens);
  const out = num(outputTokens);
  const inputCostUsd = (inp / 1_000_000) * REFERENCE_PRICING.inputUsdPerMillion;
  const cacheReadCostUsd = (cache / 1_000_000) * REFERENCE_PRICING.cacheReadUsdPerMillion;
  const outputCostUsd = (out / 1_000_000) * REFERENCE_PRICING.outputUsdPerMillion;
  const totalCostUsd = inputCostUsd + cacheReadCostUsd + outputCostUsd;
  const savedByCacheUsd =
    (cache / 1_000_000) * (REFERENCE_PRICING.inputUsdPerMillion - REFERENCE_PRICING.cacheReadUsdPerMillion);
  return {
    inputCostUsd,
    cacheReadCostUsd,
    outputCostUsd,
    totalCostUsd,
    savedByCacheUsd,
    totalCostCny: totalCostUsd * REFERENCE_PRICING.usdToCny,
    savedByCacheCny: savedByCacheUsd * REFERENCE_PRICING.usdToCny,
  };
}

/**
 * Discovers Antigravity Desktop & CLI brain directories.
 */
export function discoverBrainRoots({ antigravityDataDir, brainRoots } = {}) {
  if (Array.isArray(brainRoots)) {
    return brainRoots.filter((r) => r && r.dir && existsSync(r.dir));
  }

  const candidates = [];
  const seen = new Set();
  const add = (source, dirPath) => {
    const abs = resolve(dirPath);
    if (seen.has(abs) || !existsSync(abs)) return;
    seen.add(abs);
    candidates.push({ source, dir: abs });
  };

  if (antigravityDataDir) {
    add('desktop', join(antigravityDataDir, 'brain'));
    const geminiRoot = dirname(resolve(antigravityDataDir));
    add('cli', join(geminiRoot, 'antigravity-cli', 'brain'));
  }

  const defaultGeminiRoot = join(homedir(), '.gemini');
  add('desktop', join(defaultGeminiRoot, 'antigravity', 'brain'));
  add('cli', join(defaultGeminiRoot, 'antigravity-cli', 'brain'));

  return candidates;
}

const fileParseCache = new Map(); // transcriptPath -> { sig, parsed }

function parseSessionHistory(raw, { conversationId, source, mtimeMs }) {
  const lines = (raw || '').split('\n');
  const fallbackDate = toLocalDateKey(mtimeMs || Date.now());

  let inputTokens = 0;
  let cacheReadTokens = 0;
  let outputTokens = 0;
  let userTurns = 0;
  let modelCalls = 0;
  let stepsCount = 0;
  let preview = '';
  let lastIso = null;
  const byDay = {};

  for (const line of lines) {
    if (!line.trim()) continue;
    let step;
    try {
      step = JSON.parse(line);
    } catch {
      continue;
    }
    if (!step || typeof step !== 'object') continue;
    stepsCount += 1;

    if (typeof step.created_at === 'string' && step.created_at) {
      lastIso = step.created_at;
    }

    if (step.type === 'USER_INPUT') {
      userTurns += 1;
      if (!preview && typeof step.content === 'string') {
        preview = cleanPreview(step.content);
      }
      continue;
    }

    if (step.type !== 'PLANNER_RESPONSE') continue;
    modelCalls += 1;

    const inp = num(step.input_tokens);
    const cache = num(step.cache_read_tokens);
    const out = num(step.output_tokens);
    if (inp === 0 && cache === 0 && out === 0) continue;

    inputTokens += inp;
    cacheReadTokens += cache;
    outputTokens += out;

    const dk = stepDateKey(step.created_at, fallbackDate);
    if (!byDay[dk]) {
      byDay[dk] = {
        inputTokens: 0,
        cacheReadTokens: 0,
        outputTokens: 0,
        allTokens: 0,
        modelCalls: 0,
        steps: 0,
      };
    }
    const day = byDay[dk];
    day.inputTokens += inp;
    day.cacheReadTokens += cache;
    day.outputTokens += out;
    day.allTokens += inp + cache + out;
    day.modelCalls += 1;
    day.steps += 1;
  }

  const promptTokens = inputTokens + cacheReadTokens;
  const allTokens = promptTokens + outputTokens;

  return {
    conversationId,
    source,
    preview,
    updatedAt: lastIso || new Date(mtimeMs || Date.now()).toISOString(),
    updatedAtMs: mtimeMs || 0,
    totals: {
      inputTokens,
      cacheReadTokens,
      outputTokens,
      promptTokens,
      allTokens,
      userTurns,
      modelCalls,
      stepsCount,
    },
    byDay,
  };
}

function emptyBucket() {
  return {
    inputTokens: 0,
    cacheReadTokens: 0,
    outputTokens: 0,
    promptTokens: 0,
    allTokens: 0,
    steps: 0,
    modelCalls: 0,
    sessions: 0,
  };
}

function addDayToBucket(bucket, day) {
  bucket.inputTokens += day.inputTokens;
  bucket.cacheReadTokens += day.cacheReadTokens;
  bucket.outputTokens += day.outputTokens;
  bucket.promptTokens += day.inputTokens + day.cacheReadTokens;
  bucket.allTokens += day.allTokens;
  bucket.steps += day.steps;
  bucket.modelCalls += day.modelCalls;
}

function finalizeBucket(bucket) {
  const cacheHitRate = bucket.promptTokens > 0 ? bucket.cacheReadTokens / bucket.promptTokens : 0;
  return {
    ...bucket,
    cacheHitRate,
    cost: computeReferenceCost(bucket),
  };
}

const summaryCache = new Map(); // cacheKey -> { atMs, payload }

/**
 * Aggregates cross-session history, daily heatmap, and reference API cost across
 * Antigravity Desktop and CLI conversations.
 */
export function getGlobalHistory({
  antigravityDataDir,
  brainRoots,
  sourceFilter = 'all',
  force = false,
  nowMs = Date.now(),
  resolveTitle,
} = {}) {
  const filter = sourceFilter === 'desktop' || sourceFilter === 'cli' ? sourceFilter : 'all';
  const useMemo = !force && !Array.isArray(brainRoots);
  const cacheKey = `${antigravityDataDir || 'default'}|${filter}`;
  if (useMemo) {
    const cached = summaryCache.get(cacheKey);
    if (cached && nowMs - cached.atMs < 10_000) {
      return cached.payload;
    }
  }

  const roots = discoverBrainRoots({ antigravityDataDir, brainRoots });
  const allSessions = [];

  for (const root of roots) {
    for (const name of safeReaddir(root.dir)) {
      if (!ID_RE.test(name)) continue;
      const transcriptPath = join(root.dir, name, '.system_generated', 'logs', 'transcript.jsonl');
      const st = statOf(transcriptPath);
      if (st.size <= 0) continue;

      const sig = `${st.mtimeMs}:${st.size}`;
      const hit = fileParseCache.get(transcriptPath);
      let parsed;
      if (hit && hit.sig === sig) {
        parsed = hit.parsed;
      } else {
        let raw = '';
        try {
          raw = readFileSync(transcriptPath, 'utf-8');
        } catch {
          continue;
        }
        parsed = parseSessionHistory(raw, {
          conversationId: name,
          source: root.source,
          mtimeMs: st.mtimeMs,
        });
        if (fileParseCache.size >= 1500 && !fileParseCache.has(transcriptPath)) {
          const oldest = fileParseCache.keys().next().value;
          if (oldest !== undefined) fileParseCache.delete(oldest);
        }
        fileParseCache.set(transcriptPath, { sig, parsed });
      }
      if (parsed.totals.allTokens > 0 || parsed.totals.stepsCount > 0) {
        allSessions.push(parsed);
      }
    }
  }

  // Deduplicate if the same conversationId appeared under multiple roots of the same source,
  // preferring the newer transcript.
  const dedupedMap = new Map();
  for (const s of allSessions) {
    const k = `${s.source}:${s.conversationId}`;
    const prev = dedupedMap.get(k);
    if (!prev || s.updatedAtMs > prev.updatedAtMs) {
      dedupedMap.set(k, s);
    }
  }
  const uniqueSessions = [...dedupedMap.values()];

  const bySourceRaw = {
    desktop: emptyBucket(),
    cli: emptyBucket(),
  };
  for (const s of uniqueSessions) {
    const b = bySourceRaw[s.source] || bySourceRaw.desktop;
    b.sessions += 1;
    b.inputTokens += s.totals.inputTokens;
    b.cacheReadTokens += s.totals.cacheReadTokens;
    b.outputTokens += s.totals.outputTokens;
    b.promptTokens += s.totals.promptTokens;
    b.allTokens += s.totals.allTokens;
    b.steps += s.totals.stepsCount;
    b.modelCalls += s.totals.modelCalls;
  }

  const filteredSessions = filter === 'all' ? uniqueSessions : uniqueSessions.filter((s) => s.source === filter);

  const todayKey = toLocalDateKey(nowMs);
  const monthPrefix = todayKey.slice(0, 7);
  const last7Keys = new Set();
  const baseDate = new Date(nowMs);
  baseDate.setHours(12, 0, 0, 0);
  for (let i = 0; i < 7; i++) {
    last7Keys.add(toLocalDateKey(baseDate.getTime() - i * 86_400_000));
  }

  const todayBucket = emptyBucket();
  const last7Bucket = emptyBucket();
  const monthBucket = emptyBucket();
  const allTimeBucket = emptyBucket();
  const dailyMap = new Map(); // YYYY-MM-DD -> { ...day, sessionIds: Set }

  for (const s of filteredSessions) {
    allTimeBucket.sessions += 1;
    allTimeBucket.inputTokens += s.totals.inputTokens;
    allTimeBucket.cacheReadTokens += s.totals.cacheReadTokens;
    allTimeBucket.outputTokens += s.totals.outputTokens;
    allTimeBucket.promptTokens += s.totals.promptTokens;
    allTimeBucket.allTokens += s.totals.allTokens;
    allTimeBucket.steps += s.totals.stepsCount;
    allTimeBucket.modelCalls += s.totals.modelCalls;

    let hadToday = false;
    let hadLast7 = false;
    let hadMonth = false;

    for (const [dk, day] of Object.entries(s.byDay)) {
      let agg = dailyMap.get(dk);
      if (!agg) {
        agg = { ...emptyBucket(), date: dk, sessionSet: new Set() };
        dailyMap.set(dk, agg);
      }
      addDayToBucket(agg, day);
      agg.sessionSet.add(s.conversationId);

      if (dk === todayKey) {
        addDayToBucket(todayBucket, day);
        hadToday = true;
      }
      if (last7Keys.has(dk)) {
        addDayToBucket(last7Bucket, day);
        hadLast7 = true;
      }
      if (dk.startsWith(monthPrefix)) {
        addDayToBucket(monthBucket, day);
        hadMonth = true;
      }
    }

    if (hadToday) todayBucket.sessions += 1;
    if (hadLast7) last7Bucket.sessions += 1;
    if (hadMonth) monthBucket.sessions += 1;
  }

  // Build 12-week (84-day) chronological heatmap ending today.
  const heatDays = [];
  let maxHeatTokens = 0;
  for (let offset = 83; offset >= 0; offset--) {
    const d = new Date(baseDate.getTime() - offset * 86_400_000);
    const dk = toLocalDateKey(d.getTime());
    const agg = dailyMap.get(dk);
    const allTokens = agg ? agg.allTokens : 0;
    if (allTokens > maxHeatTokens) maxHeatTokens = allTokens;
    heatDays.push({
      date: dk,
      weekday: d.getDay(), // 0 = Sun .. 6 = Sat
      allTokens,
      inputTokens: agg ? agg.inputTokens : 0,
      cacheReadTokens: agg ? agg.cacheReadTokens : 0,
      outputTokens: agg ? agg.outputTokens : 0,
      steps: agg ? agg.steps : 0,
      sessions: agg ? agg.sessionSet.size : 0,
      costUsd: agg ? computeReferenceCost(agg).totalCostUsd : 0,
    });
  }

  for (const cell of heatDays) {
    if (cell.allTokens <= 0 || maxHeatTokens <= 0) {
      cell.level = 0;
    } else {
      const scaled = Math.sqrt(cell.allTokens / maxHeatTokens);
      if (scaled <= 0.25) cell.level = 1;
      else if (scaled <= 0.50) cell.level = 2;
      else if (scaled <= 0.78) cell.level = 3;
      else cell.level = 4;
    }
  }

  const recentDays = [...dailyMap.values()]
    .sort((a, b) => b.date.localeCompare(a.date))
    .slice(0, 14)
    .map(({ sessionSet, ...rest }) => finalizeBucket({ ...rest, sessions: sessionSet.size }));

  const topSessions = [...filteredSessions]
    .sort((a, b) => b.totals.allTokens - a.totals.allTokens || b.updatedAtMs - a.updatedAtMs)
    .slice(0, 12)
    .map((s) => {
      const customTitle = resolveTitle ? resolveTitle(s.conversationId) : '';
      return {
        conversationId: s.conversationId,
        source: s.source,
        title: customTitle || s.preview || '',
        updatedAt: s.updatedAt,
        allTokens: s.totals.allTokens,
        promptTokens: s.totals.promptTokens,
        inputTokens: s.totals.inputTokens,
        cacheReadTokens: s.totals.cacheReadTokens,
        outputTokens: s.totals.outputTokens,
        cacheHitRate: s.totals.promptTokens > 0 ? s.totals.cacheReadTokens / s.totals.promptTokens : 0,
        userTurns: s.totals.userTurns,
        modelCalls: s.totals.modelCalls,
        stepsCount: s.totals.stepsCount,
        cost: computeReferenceCost(s.totals),
      };
    });

  const payload = {
    generatedAt: new Date(nowMs).toISOString(),
    todayKey,
    sourceFilter: filter,
    pricing: REFERENCE_PRICING,
    today: finalizeBucket(todayBucket),
    last7Days: finalizeBucket(last7Bucket),
    thisMonth: finalizeBucket(monthBucket),
    allTime: finalizeBucket(allTimeBucket),
    bySource: {
      desktop: finalizeBucket(bySourceRaw.desktop),
      cli: finalizeBucket(bySourceRaw.cli),
    },
    heatmap: heatDays,
    recentDays,
    topSessions,
  };

  if (useMemo) {
    if (summaryCache.size > 16) summaryCache.clear();
    summaryCache.set(cacheKey, { atMs: nowMs, payload });
  }

  return payload;
}
