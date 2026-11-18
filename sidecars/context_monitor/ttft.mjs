/**
 * Pure protobuf + read-only SQLite timing extractor for Antigravity step TTFT
 * (Time To First Token).
 *
 * Reads `CortexStepMetadata` blobs from `<appData>/conversations/<conv>.db`
 * (`steps` table, `step_type = 15` = `PLANNER_RESPONSE`) where Antigravity records:
 *   - f1: `created_at` (google.protobuf.Timestamp)
 *   - f6: `viewable_at` (google.protobuf.Timestamp; matches `ChatModelMetadata.time_to_first_token`)
 *   - f7: `finished_generating_at` (google.protobuf.Timestamp)
 *   - f9: `model_usage` (`output_tokens` at f3)
 */
import { existsSync, statSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';

const MAX_REASONABLE_TTFT_MS = 600_000;
const STATUS_DONE = 3;
const STATUS_LEGACY_DONE = 5;

function safeStatKey(filePath) {
  try {
    const st = statSync(filePath);
    return `${st.mtimeMs}:${st.size}`;
  } catch {
    return '';
  }
}

export function readVarint(buf, pos) {
  let val = 0n;
  let shift = 0n;
  while (pos < buf.length) {
    const byte = buf[pos++];
    val |= BigInt(byte & 0x7f) << shift;
    if ((byte & 0x80) === 0) {
      return [Number(val), pos];
    }
    shift += 7n;
    if (shift > 63n) break;
  }
  return [null, buf.length];
}

export function decodeTopProtoFields(buf) {
  if (!buf || typeof buf.length !== 'number') return [];
  const fields = [];
  let pos = 0;
  while (pos < buf.length) {
    const [tag, p1] = readVarint(buf, pos);
    if (tag == null || tag <= 0) break;
    pos = p1;
    const fieldNo = tag >>> 3;
    const wireType = tag & 7;
    if (wireType === 0) {
      const [val, p2] = readVarint(buf, pos);
      if (val == null) break;
      pos = p2;
      fields.push([fieldNo, wireType, val]);
    } else if (wireType === 1) {
      if (pos + 8 > buf.length) break;
      fields.push([fieldNo, wireType, buf.subarray(pos, pos + 8)]);
      pos += 8;
    } else if (wireType === 2) {
      const [len, p2] = readVarint(buf, pos);
      if (len == null || len < 0 || p2 + len > buf.length) break;
      pos = p2;
      fields.push([fieldNo, wireType, buf.subarray(pos, pos + len)]);
      pos += len;
    } else if (wireType === 5) {
      if (pos + 4 > buf.length) break;
      fields.push([fieldNo, wireType, buf.subarray(pos, pos + 4)]);
      pos += 4;
    } else {
      break;
    }
  }
  return fields;
}

export function decodeTimestampMs(buf) {
  let seconds = 0;
  let nanos = 0;
  for (const [fn, wt, v] of decodeTopProtoFields(buf)) {
    if (wt !== 0) continue;
    if (fn === 1) seconds = v;
    else if (fn === 2) nanos = v;
  }
  if (!Number.isFinite(seconds) || seconds < 1_000_000_000 || seconds > 4_100_000_000) {
    return null;
  }
  const safeNanos = Number.isFinite(nanos) && nanos >= 0 && nanos < 1_000_000_000 ? nanos : 0;
  return seconds * 1000 + safeNanos / 1e6;
}

export function parseStepTimingMetadata(metadataBuf, status = 0) {
  if (!metadataBuf || metadataBuf.length === 0) return null;
  let createdAtMs = null;
  let viewableAtMs = null;
  let finishedAtMs = null;
  let hasUsage = false;
  let outputTokens = 0;

  for (const [fn, wt, v] of decodeTopProtoFields(metadataBuf)) {
    if (wt !== 2) continue;
    if (fn === 1) {
      createdAtMs = decodeTimestampMs(v);
    } else if (fn === 6) {
      viewableAtMs = decodeTimestampMs(v);
    } else if (fn === 7) {
      finishedAtMs = decodeTimestampMs(v);
    } else if (fn === 9) {
      hasUsage = true;
      for (const [ufn, uwt, uv] of decodeTopProtoFields(v)) {
        if (ufn === 3 && uwt === 0 && Number.isFinite(uv)) {
          outputTokens = uv;
        }
      }
    }
  }

  if (createdAtMs == null || viewableAtMs == null || viewableAtMs < createdAtMs) {
    return null;
  }
  const ttftMs = Math.round(viewableAtMs - createdAtMs);
  if (ttftMs < 0 || ttftMs > MAX_REASONABLE_TTFT_MS) {
    return null;
  }
  const streamMs =
    finishedAtMs != null && finishedAtMs >= viewableAtMs
      ? Math.round(finishedAtMs - viewableAtMs)
      : null;

  const isCompletedOrMeasured =
    finishedAtMs != null ||
    hasUsage ||
    outputTokens > 0 ||
    status === STATUS_DONE ||
    status === STATUS_LEGACY_DONE;
  if (!isCompletedOrMeasured) {
    return null;
  }

  return { ttftMs, streamMs, outputTokens };
}

export function aggregateStepTimings(rows) {
  let sumTtftMs = 0;
  let measuredSteps = 0;
  let lastTtftMs = null;
  const byStepIndex = new Map();

  for (const row of rows || []) {
    if (!row) continue;
    const stepIndex = Number(row.idx);
    const parsed = parseStepTimingMetadata(row.metadata, Number(row.status) || 0);
    if (!parsed) continue;
    sumTtftMs += parsed.ttftMs;
    measuredSteps += 1;
    lastTtftMs = parsed.ttftMs;
    if (Number.isFinite(stepIndex)) {
      byStepIndex.set(stepIndex, {
        ttftMs: parsed.ttftMs,
        streamMs: parsed.streamMs,
      });
    }
  }

  return {
    avgTtftMs: measuredSteps > 0 ? Math.round(sumTtftMs / measuredSteps) : null,
    lastTtftMs,
    measuredSteps,
    byStepIndex,
  };
}

let DatabaseSyncClass = null;
try {
  const req = createRequire(import.meta.url);
  DatabaseSyncClass = req('node:sqlite')?.DatabaseSync || null;
} catch {
  DatabaseSyncClass = null;
}

const EMPTY_RESULT = {
  avgTtftMs: null,
  lastTtftMs: null,
  measuredSteps: 0,
  byStepIndex: new Map(),
};

/**
 * Stat-cached, read-only SQLite reader for per-conversation step TTFT latencies.
 */
export class ConversationTimingReader {
  constructor({ idPattern, maxCachedConvs = 32 } = {}) {
    this.idPattern = idPattern;
    this.maxCachedConvs = maxCachedConvs;
    this.cache = new Map(); // conv -> { dbPath, statKey, result }
  }

  read(conv, appDataDirs) {
    if (!conv || (this.idPattern && !this.idPattern.test(conv))) {
      return EMPTY_RESULT;
    }
    if (!DatabaseSyncClass) {
      return EMPTY_RESULT;
    }

    let dbPath = null;
    for (const appData of appDataDirs || []) {
      const candidate = join(appData, 'conversations', `${conv}.db`);
      if (existsSync(candidate)) {
        dbPath = candidate;
        break;
      }
    }
    if (!dbPath) {
      return EMPTY_RESULT;
    }

    const statKey = `${safeStatKey(dbPath)}|${safeStatKey(`${dbPath}-wal`)}`;
    const cached = this.cache.get(conv);
    if (cached && cached.dbPath === dbPath && cached.statKey === statKey) {
      return cached.result;
    }

    let db = null;
    try {
      db = new DatabaseSyncClass(dbPath, { readOnly: true, timeout: 1000 });
      const rows = db
        .prepare('SELECT idx, status, metadata FROM steps WHERE step_type = 15 ORDER BY idx ASC')
        .all();
      const result = aggregateStepTimings(rows);
      if (this.cache.size >= this.maxCachedConvs && !this.cache.has(conv)) {
        const oldestKey = this.cache.keys().next().value;
        if (oldestKey !== undefined) this.cache.delete(oldestKey);
      }
      this.cache.set(conv, { dbPath, statKey, result });
      return result;
    } catch {
      return cached?.result || EMPTY_RESULT;
    } finally {
      try {
        db?.close();
      } catch {
        // Ignore close errors on read-only handles.
      }
    }
  }
}
