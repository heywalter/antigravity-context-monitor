import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseTranscriptMetrics } from './metrics.mjs';
import { computeReferenceCost, getGlobalHistory, toLocalDateKey } from './history.mjs';
import {
  applyHudPrefsPatch,
  inferModelCompactionLimit,
  isHudSupported,
  normalizeDisplayMode,
  normalizeHudPrefs,
  PREFS_VERSION,
  resolveEffectiveWindowLimit,
  snapObservedCompactionLimit,
} from './prefs.mjs';
import { ConversationTitleResolver, parseAnnotationTitle, unescapePbtxtString } from './titles.mjs';
import {
  aggregateStepTimings,
  ConversationTimingReader,
  decodeTimestampMs,
  parseStepTimingMetadata,
} from './ttft.mjs';

test('parses multi-turn transcript, cache hit rate, compaction, and torn lines', () => {
  const sample = [
    JSON.stringify({
      step_index: 0,
      type: 'USER_INPUT',
      status: 'DONE',
      created_at: '2026-11-14T01:00:00Z',
      content: '<USER_REQUEST>\nInspect repo\n</USER_REQUEST>',
    }),
    JSON.stringify({
      step_index: 1,
      type: 'PLANNER_RESPONSE',
      status: 'DONE',
      created_at: '2026-11-14T01:00:02Z',
      input_tokens: 10000,
      cache_read_tokens: 0,
      output_tokens: 500,
      tool_calls: [{ name: 'read_file', args: { Path: '"/tmp/a.js"' } }],
    }),
    JSON.stringify({
      step_index: 2,
      type: 'GENERIC',
      status: 'DONE',
      created_at: '2026-11-14T01:00:03Z',
      content: 'file contents',
    }),
    JSON.stringify({
      step_index: 3,
      type: 'PLANNER_RESPONSE',
      status: 'DONE',
      created_at: '2026-11-14T01:00:05Z',
      input_tokens: 2000,
      cache_read_tokens: 10000,
      output_tokens: 300,
      tool_calls: [],
    }),
    JSON.stringify({
      step_index: 4,
      type: 'CHECKPOINT',
      status: 'DONE',
      created_at: '2026-11-14T01:01:00Z',
    }),
    JSON.stringify({
      step_index: 5,
      type: 'USER_INPUT',
      status: 'DONE',
      created_at: '2026-11-14T01:02:00Z',
      content: 'Summarize',
    }),
    JSON.stringify({
      step_index: 6,
      type: 'PLANNER_RESPONSE',
      status: 'DONE',
      created_at: '2026-11-14T01:02:02Z',
      input_tokens: 1500,
      cache_read_tokens: 4500,
      output_tokens: 200,
      tool_calls: [],
    }),
    '{"step_index":7,"type":"PLANNER_RESPONSE","torn":',
  ].join('\n');

  const m = parseTranscriptMetrics(sample, {
    mtimeMs: Date.parse('2026-11-14T01:02:03Z'),
  });
  assert.equal(m.hasData, true);
  assert.equal(m.isRunning, false);
  assert.equal(m.totals.userTurns, 2);
  assert.equal(m.totals.modelCalls, 3);
  assert.equal(m.totals.toolCalls, 1);
  assert.equal(m.totals.checkpoints, 1);
  assert.equal(m.totals.inputTokens, 13500);
  assert.equal(m.totals.cacheReadTokens, 14500);
  assert.equal(m.totals.outputTokens, 1000);
  assert.equal(m.timeline[0].tokPerSec, 500);
  assert.equal(m.timeline[2].tokPerSec, 200);
  assert.equal(m.totals.avgTokPerSec, 350);
  assert.equal(m.totals.lastTokPerSec, 200);
  assert.equal(m.current.promptTokens, 6000);
  assert.equal(m.current.estimatedNextContextTokens, 6200);
  assert.equal(m.current.initialBaselineTokens, 10000);
  assert.equal(m.timeline.length, 3);
  assert.equal(m.timeline[2].compacted, true);
  assert.equal(m.timeline[2].deltaFromPrev, -6000);
  assert.equal(m.totals.observedCompactionTokens, 12000);
  assert.equal(m.current.observedCompactionTokens, 12000);
  assert.equal(m.tools[0].name, 'read_file');
  assert.equal(m.tools[0].estimatedContextAdded, 2000);
  assert.equal(m.turns[0].preview, 'Inspect repo');
});

test('parses checkpoints, error steps, and generation speed cleanly', () => {
  const sample = [
    JSON.stringify({
      step_index: 0,
      type: 'USER_INPUT',
      status: 'DONE',
      created_at: '2026-11-14T01:00:00Z',
      content: '<USER_REQUEST>\nVerify portable parser fixture\n</USER_REQUEST>',
    }),
    JSON.stringify({
      step_index: 1,
      type: 'PLANNER_RESPONSE',
      status: 'DONE',
      created_at: '2026-11-14T01:00:01Z',
      input_tokens: 8000,
      cache_read_tokens: 4000,
      output_tokens: 400,
      tool_calls: [{ name: 'run_command' }],
    }),
    JSON.stringify({
      step_index: 2,
      type: 'GENERIC',
      status: 'DONE',
      created_at: '2026-11-14T01:00:03Z',
    }),
    JSON.stringify({
      step_index: 3,
      type: 'CHECKPOINT',
      status: 'DONE',
      created_at: '2026-11-14T01:00:04Z',
    }),
    JSON.stringify({
      step_index: 4,
      type: 'TOOL_RESPONSE',
      status: 'ERROR',
      created_at: '2026-11-14T01:00:05Z',
    }),
  ].join('\n');

  const m = parseTranscriptMetrics(sample);
  assert.equal(m.hasData, true);
  assert.equal(m.totals.checkpoints, 1);
  assert.equal(m.totals.errorSteps, 1);
  assert.equal(m.totals.modelCalls, 1);
  assert.ok(m.totals.avgTokPerSec > 0);
  assert.equal(m.current.promptTokens, 12000);
});

test('track_active hook writes active_hook.json atomically and outputs {}', () => {
  const fakeHome = mkdtempSync(join(tmpdir(), 'cm-hook-test-'));
  const hookScript = fileURLToPath(new URL('../../hooks/track_active.sh', import.meta.url));
  const convId = '00000000-0000-4000-8000-000000000001';
  try {
    const payload = JSON.stringify({
      conversationId: convId,
      modelName: 'gemini-test',
    });
    const out = execFileSync(hookScript, {
      input: payload,
      encoding: 'utf-8',
      env: { ...process.env, HOME: fakeHome },
    });
    assert.equal(out.trim(), '{}');
    const saved = JSON.parse(
      readFileSync(join(fakeHome, '.gemini', 'antigravity', 'sidecar_data', 'context-monitor', 'context_monitor', 'active_hook.json'), 'utf-8'),
    );
    assert.equal(saved.conversationId, convId);
    assert.equal(saved.modelName, 'gemini-test');
  } finally {
    rmSync(fakeHome, { recursive: true, force: true });
  }
});

test('computeReferenceCost calculates API cost and cache savings accurately', () => {
  const cost = computeReferenceCost({
    inputTokens: 1_000_000,
    cacheReadTokens: 10_000_000,
    outputTokens: 500_000,
  });
  assert.ok(Math.abs(cost.inputCostUsd - 2.0) < 1e-9);
  assert.ok(Math.abs(cost.cacheReadCostUsd - 2.0) < 1e-9);
  assert.ok(Math.abs(cost.outputCostUsd - 5.0) < 1e-9);
  assert.ok(Math.abs(cost.totalCostUsd - 9.0) < 1e-9);
  assert.ok(Math.abs(cost.savedByCacheUsd - 18.0) < 1e-9);
  assert.ok(Math.abs(cost.totalCostCny - 65.25) < 1e-9);
});

test('getGlobalHistory aggregates Desktop + CLI transcripts, buckets, and 84-day heatmap', () => {
  const tmpRoot = mkdtempSync(join(tmpdir(), 'cm-hist-test-'));
  try {
    const desktopBrain = join(tmpRoot, 'antigravity', 'brain');
    const cliBrain = join(tmpRoot, 'antigravity-cli', 'brain');
    const convA = '11111111-1111-1111-1111-111111111111';
    const convB = '22222222-2222-2222-2222-222222222222';
    mkdirSync(join(desktopBrain, convA, '.system_generated', 'logs'), { recursive: true });
    mkdirSync(join(cliBrain, convB, '.system_generated', 'logs'), { recursive: true });

    const nowMs = Date.parse('2026-11-14T12:00:00Z');
    const twoDaysAgoMs = nowMs - 2 * 86_400_000;
    const todayIso = new Date(nowMs).toISOString();
    const olderIso = new Date(twoDaysAgoMs).toISOString();

    writeFileSync(
      join(desktopBrain, convA, '.system_generated', 'logs', 'transcript.jsonl'),
      [
        JSON.stringify({ step_index: 0, type: 'USER_INPUT', created_at: todayIso, content: 'Fix bug' }),
        JSON.stringify({
          step_index: 1,
          type: 'PLANNER_RESPONSE',
          status: 'DONE',
          created_at: todayIso,
          input_tokens: 1000,
          cache_read_tokens: 9000,
          output_tokens: 500,
        }),
      ].join('\n'),
      'utf-8',
    );

    writeFileSync(
      join(cliBrain, convB, '.system_generated', 'logs', 'transcript.jsonl'),
      [
        JSON.stringify({ step_index: 0, type: 'USER_INPUT', created_at: olderIso, content: 'Run CLI check' }),
        JSON.stringify({
          step_index: 1,
          type: 'PLANNER_RESPONSE',
          status: 'DONE',
          created_at: olderIso,
          input_tokens: 2000,
          cache_read_tokens: 4000,
          output_tokens: 1000,
        }),
      ].join('\n'),
      'utf-8',
    );

    const hist = getGlobalHistory({
      brainRoots: [
        { source: 'desktop', dir: desktopBrain },
        { source: 'cli', dir: cliBrain },
      ],
      sourceFilter: 'all',
      nowMs,
    });

    assert.equal(hist.todayKey, toLocalDateKey(nowMs));
    assert.equal(hist.today.allTokens, 10500);
    assert.equal(hist.today.sessions, 1);
    assert.equal(hist.last7Days.allTokens, 17500);
    assert.equal(hist.allTime.allTokens, 17500);
    assert.equal(hist.bySource.desktop.allTokens, 10500);
    assert.equal(hist.bySource.cli.allTokens, 7000);
    assert.equal(hist.heatmap.length, 84);
    assert.equal(hist.heatmap[83].allTokens, 10500);
    assert.ok(hist.heatmap[83].level >= 1);
    assert.equal(hist.topSessions.length, 2);

    const cliOnly = getGlobalHistory({
      brainRoots: [
        { source: 'desktop', dir: desktopBrain },
        { source: 'cli', dir: cliBrain },
      ],
      sourceFilter: 'cli',
      nowMs,
    });
    assert.equal(cliOnly.allTime.allTokens, 7000);
    assert.equal(cliOnly.today.allTokens, 0);
  } finally {
    rmSync(tmpRoot, { recursive: true, force: true });
  }
});

test('track_active hook also writes active_hook.json to ANTIGRAVITY_EXECUTABLE_DATA_DIR when set', () => {
  const tmpRoot = mkdtempSync(join(tmpdir(), 'cm-hook-execdir-'));
  const fakeHome = join(tmpRoot, 'home');
  const execDataDir = join(tmpRoot, 'custom_exec_data');
  const hookScript = fileURLToPath(new URL('../../hooks/track_active.sh', import.meta.url));
  const convId = '33333333-3333-4333-8333-333333333333';
  try {
    mkdirSync(fakeHome, { recursive: true });
    const payload = JSON.stringify({
      conversationId: convId,
      modelName: 'gemini-2.5-pro',
    });
    const out = execFileSync(hookScript, {
      input: payload,
      encoding: 'utf-8',
      env: { ...process.env, HOME: fakeHome, ANTIGRAVITY_EXECUTABLE_DATA_DIR: execDataDir },
    });
    assert.equal(out.trim(), '{}');
    const savedDefault = JSON.parse(
      readFileSync(join(fakeHome, '.gemini', 'antigravity', 'sidecar_data', 'context-monitor', 'context_monitor', 'active_hook.json'), 'utf-8'),
    );
    const savedCustom = JSON.parse(readFileSync(join(execDataDir, 'active_hook.json'), 'utf-8'));
    assert.equal(savedDefault.conversationId, convId);
    assert.equal(savedCustom.conversationId, convId);
    assert.equal(savedCustom.modelName, 'gemini-2.5-pro');
  } finally {
    rmSync(tmpRoot, { recursive: true, force: true });
  }
});

test('normalizeHudPrefs, applyHudPrefsPatch, and isHudSupported enforce invariants', () => {
  assert.equal(normalizeDisplayMode('bottom'), 'window');
  assert.equal(normalizeDisplayMode('invalid'), 'both');

  const base = normalizeHudPrefs({
    displayMode: 'bottom',
    windowLimit: 200000,
    anchorPosition: 'bottomCenter',
    offsetX: 18,
    offsetY: -12,
    pinnedConversationId: 'bad-id',
  });
  assert.equal(base.displayMode, 'window');
  assert.equal(base.windowLimit, 200000);
  assert.equal(base.anchorPosition, 'bottomCenter');
  assert.equal('pinnedConversationId' in base, false);

  // Changing anchor resets drag offset by default unless resetPosition: false
  const movedAnchor = applyHudPrefsPatch(base, { anchorPosition: 'topRight', language: 'zh' });
  assert.equal(movedAnchor.anchorPosition, 'topRight');
  assert.equal(movedAnchor.offsetX, 0);
  assert.equal(movedAnchor.offsetY, 0);
  assert.equal(movedAnchor.language, 'zh');

  const keptOffset = applyHudPrefsPatch(base, {
    anchorPosition: 'bottomRight',
    resetPosition: false,
    pinnedConversationId: '44444444-4444-4444-8444-444444444444',
    capsuleStyle: 'bogus',
  });
  assert.equal(keptOffset.anchorPosition, 'bottomRight');
  assert.equal(keptOffset.offsetX, 18);
  assert.equal(keptOffset.capsuleStyle, 'compact');
  assert.equal(keptOffset.pinnedConversationId, '44444444-4444-4444-8444-444444444444');

  const unpinned = applyHudPrefsPatch(keptOffset, { pinnedConversationId: '' });
  assert.equal('pinnedConversationId' in unpinned, false);

  assert.equal(isHudSupported({ platform: 'darwin', env: {} }), true);
  assert.equal(isHudSupported({ platform: 'darwin', env: { CONTEXT_MONITOR_NO_HUD: '1' } }), false);
  assert.equal(isHudSupported({ platform: 'linux', env: {} }), false);
  assert.equal(isHudSupported({ platform: 'win32', env: {} }), false);
});

test('window limit v2 migration and Auto compaction-aware resolution work accurately', () => {
  // Legacy v1 default (1M without prefsVersion) migrates automatically to Auto (0)
  const migrated = normalizeHudPrefs({ windowLimit: 1_000_000 });
  assert.equal(migrated.prefsVersion, PREFS_VERSION);
  assert.equal(migrated.windowLimit, 0);

  // Explicit 1M selection saved under v2 is preserved
  const explicitV2 = applyHudPrefsPatch(migrated, { windowLimit: 1_000_000 });
  assert.equal(explicitV2.prefsVersion, PREFS_VERSION);
  assert.equal(explicitV2.windowLimit, 1_000_000);
  assert.equal(normalizeHudPrefs(explicitV2).windowLimit, 1_000_000);

  // Auto mode defaults to 256K compaction limit and respects model / empirical signals
  assert.deepEqual(
    resolveEffectiveWindowLimit({ prefs: { windowLimit: 0 } }),
    { limit: 256_000, mode: 'auto', source: 'default' },
  );
  assert.equal(inferModelCompactionLimit('gemini-2.5-pro'), 128_000);
  assert.equal(inferModelCompactionLimit('gpt-oss-120b-medium'), 80_000);
  assert.equal(inferModelCompactionLimit('claude-sonnet-5-5-1m'), 840_000);

  assert.deepEqual(
    resolveEffectiveWindowLimit({ prefs: { windowLimit: 0 }, modelName: 'gemini-2.5-pro' }),
    { limit: 128_000, mode: 'auto', source: 'model' },
  );
  assert.equal(snapObservedCompactionLimit(255_194), 256_000);
  assert.deepEqual(
    resolveEffectiveWindowLimit({
      prefs: { windowLimit: 0 },
      modelName: 'gemini-3.8-flash-high',
      metrics: { totals: { observedCompactionTokens: 255_194 }, current: { estimatedNextContextTokens: 120_000 } },
    }),
    { limit: 256_000, mode: 'auto', source: 'compaction' },
  );

  // Overflow promotion keeps occupancy <= 100% if a session grows beyond default 256K
  assert.equal(
    resolveEffectiveWindowLimit({
      prefs: { windowLimit: 0 },
      metrics: { totals: {}, current: { estimatedNextContextTokens: 320_000 } },
    }).limit,
    512_000,
  );

  // Manual override takes strict precedence
  assert.deepEqual(
    resolveEffectiveWindowLimit({ prefs: { windowLimit: 200_000 }, modelName: 'gemini-2.5-pro' }),
    { limit: 200_000, mode: 'manual', source: 'manual' },
  );
});

test('ConversationTitleResolver decodes pbtxt titles and refreshes immediately on rename', () => {
  assert.equal(unescapePbtxtString('Refactor \\"HUD\\" \\344\\270\\255\\346\\226\\207'), 'Refactor "HUD" 中文');
  assert.equal(parseAnnotationTitle('title:"Refactor \\"HUD\\" UI" last_user_view_time:{seconds:1}'), 'Refactor "HUD" UI');

  const tmpRoot = mkdtempSync(join(tmpdir(), 'cm-title-test-'));
  try {
    const appData = join(tmpRoot, 'antigravity');
    const annDir = join(appData, 'annotations');
    const convA = '55555555-5555-4555-8555-555555555555';
    const convB = '66666666-6666-4666-8666-666666666666';
    mkdirSync(annDir, { recursive: true });

    const annPath = join(annDir, `${convA}.pbtxt`);
    writeFileSync(annPath, 'title:"Initial Title" pinned:false\n', 'utf-8');

    const resolver = new ConversationTitleResolver({ idPattern: /^[0-9a-f-]{8,}$/i });
    assert.equal(resolver.resolve(convA, [appData]), 'Initial Title');

    // Simulate user renaming conversation in Antigravity (file content + size/mtime update)
    writeFileSync(annPath, 'title:"Renamed \\344\\270\\255\\346\\226\\207 Title" pinned:false\n', 'utf-8');
    assert.equal(resolver.resolve(convA, [appData]), 'Renamed 中文 Title');
    assert.equal(resolver.resolve(convB, [appData]), '');
  } finally {
    rmSync(tmpRoot, { recursive: true, force: true });
  }
});

function encodeVarint(value) {
  let v = BigInt(value);
  const bytes = [];
  while (v >= 0x80n) {
    bytes.push(Number((v & 0x7fn) | 0x80n));
    v >>= 7n;
  }
  bytes.push(Number(v));
  return Buffer.from(bytes);
}

function encodeFieldBytes(fieldNo, payload) {
  const tag = encodeVarint((fieldNo << 3) | 2);
  const len = encodeVarint(payload.length);
  return Buffer.concat([tag, len, payload]);
}

function encodeFieldVarint(fieldNo, value) {
  return Buffer.concat([encodeVarint((fieldNo << 3) | 0), encodeVarint(value)]);
}

function encodeTimestamp(sec, nanos = 0) {
  const parts = [encodeFieldVarint(1, sec)];
  if (nanos > 0) parts.push(encodeFieldVarint(2, nanos));
  return Buffer.concat(parts);
}

function encodeStepMetadata({ createdSec, createdNs = 0, viewableSec, viewableNs = 0, finishedSec = null, finishedNs = 0, outputTokens = 0 }) {
  const parts = [];
  if (createdSec != null) parts.push(encodeFieldBytes(1, encodeTimestamp(createdSec, createdNs)));
  if (viewableSec != null) parts.push(encodeFieldBytes(6, encodeTimestamp(viewableSec, viewableNs)));
  if (finishedSec != null) parts.push(encodeFieldBytes(7, encodeTimestamp(finishedSec, finishedNs)));
  if (outputTokens > 0) {
    parts.push(encodeFieldBytes(9, encodeFieldVarint(3, outputTokens)));
  }
  return Buffer.concat(parts);
}

test('parses CortexStepMetadata TTFT protobufs and aggregates Avg / Last TTFT safely', () => {
  const baseSec = 1_794_800_000;
  // Step 1: 1.500s TTFT, 2.000s stream
  const md1 = encodeStepMetadata({
    createdSec: baseSec,
    createdNs: 100_000_000,
    viewableSec: baseSec + 1,
    viewableNs: 600_000_000,
    finishedSec: baseSec + 3,
    finishedNs: 600_000_000,
    outputTokens: 250,
  });
  // Step 3: 3.250s TTFT, 4.000s stream
  const md3 = encodeStepMetadata({
    createdSec: baseSec + 10,
    createdNs: 0,
    viewableSec: baseSec + 13,
    viewableNs: 250_000_000,
    finishedSec: baseSec + 17,
    finishedNs: 250_000_000,
    outputTokens: 600,
  });
  // Step 5: Interrupted/aborted status=8 step without finishedAt or usage -> must be ignored
  const mdAborted = encodeStepMetadata({
    createdSec: baseSec + 20,
    viewableSec: baseSec + 35,
    finishedSec: null,
    outputTokens: 0,
  });

  assert.equal(Math.round(decodeTimestampMs(encodeTimestamp(baseSec, 250_000_000))), baseSec * 1000 + 250);
  const parsed1 = parseStepTimingMetadata(md1, 3);
  assert.deepEqual(parsed1, { ttftMs: 1500, streamMs: 2000, outputTokens: 250 });
  assert.equal(parseStepTimingMetadata(mdAborted, 8), null);

  const agg = aggregateStepTimings([
    { idx: 1, status: 3, metadata: md1 },
    { idx: 3, status: 3, metadata: md3 },
    { idx: 5, status: 8, metadata: mdAborted },
  ]);
  assert.equal(agg.measuredSteps, 2);
  assert.equal(agg.avgTtftMs, 2375);
  assert.equal(agg.lastTtftMs, 3250);
  assert.equal(agg.byStepIndex.get(1)?.ttftMs, 1500);
  assert.equal(agg.byStepIndex.get(3)?.ttftMs, 3250);
  assert.equal(agg.byStepIndex.has(5), false);
});

test('ConversationTimingReader reads steps TTFT from SQLite DB when node:sqlite is available', (t) => {
  let DatabaseSync;
  try {
    const req = createRequire(import.meta.url);
    ({ DatabaseSync } = req('node:sqlite'));
  } catch {
    t.skip('node:sqlite unavailable on this Node.js version');
    return;
  }

  const tmpRoot = mkdtempSync(join(tmpdir(), 'cm-ttft-db-'));
  try {
    const appData = join(tmpRoot, 'antigravity');
    const convDir = join(appData, 'conversations');
    const convId = '77777777-7777-4777-8777-777777777777';
    mkdirSync(convDir, { recursive: true });
    const dbPath = join(convDir, `${convId}.db`);

    const db = new DatabaseSync(dbPath);
    db.exec('CREATE TABLE steps (idx INTEGER PRIMARY KEY, step_type INTEGER, status INTEGER, metadata BLOB);');
    const baseSec = 1_794_810_000;
    const stmt = db.prepare('INSERT INTO steps (idx, step_type, status, metadata) VALUES (?, ?, ?, ?)');
    stmt.run(0, 14, 3, Buffer.alloc(0)); // USER_INPUT ignored
    stmt.run(1, 15, 3, encodeStepMetadata({
      createdSec: baseSec,
      createdNs: 0,
      viewableSec: baseSec + 2,
      viewableNs: 0,
      finishedSec: baseSec + 4,
      outputTokens: 120,
    }));
    db.close();

    const reader = new ConversationTimingReader({ idPattern: /^[0-9a-f-]{8,}$/i });
    const first = reader.read(convId, [appData]);
    assert.equal(first.measuredSteps, 1);
    assert.equal(first.avgTtftMs, 2000);
    assert.equal(first.lastTtftMs, 2000);

    // Append a new step and ensure cache invalidates via DB/WAL stat change
    const db2 = new DatabaseSync(dbPath);
    db2.prepare('INSERT INTO steps (idx, step_type, status, metadata) VALUES (?, ?, ?, ?)').run(
      3,
      15,
      3,
      encodeStepMetadata({
        createdSec: baseSec + 10,
        createdNs: 0,
        viewableSec: baseSec + 14,
        viewableNs: 0,
        finishedSec: baseSec + 16,
        outputTokens: 300,
      }),
    );
    db2.close();

    const second = reader.read(convId, [appData]);
    assert.equal(second.measuredSteps, 2);
    assert.equal(second.avgTtftMs, 3000);
    assert.equal(second.lastTtftMs, 4000);
  } finally {
    rmSync(tmpRoot, { recursive: true, force: true });
  }
});
