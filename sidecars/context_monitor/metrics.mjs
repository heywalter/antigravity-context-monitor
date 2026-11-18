/**
 * Pure parser and aggregator for Antigravity conversation transcripts.
 *
 * Reads JSONL lines from `<appData>/brain/<conv>/.system_generated/logs/transcript.jsonl`
 * and computes live context window occupancy, Prompt Cache hit rate, cumulative token
 * usage, per-turn summaries, per-step timeline entries, and tool usage breakdowns.
 */
import { basename } from 'node:path';

export const ID_RE = /^[0-9a-f-]{8,}$/i;

function num(v) {
  return typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : 0;
}

function hasTokens(step) {
  return (
    (typeof step?.input_tokens === 'number' && Number.isFinite(step.input_tokens)) ||
    (typeof step?.cache_read_tokens === 'number' && Number.isFinite(step.cache_read_tokens)) ||
    (typeof step?.output_tokens === 'number' && Number.isFinite(step.output_tokens))
  );
}

function unquote(v) {
  if (typeof v !== 'string') return v == null ? '' : String(v);
  const s = v.trim();
  if (s.length >= 2 && s.startsWith('"') && s.endsWith('"')) {
    try {
      return String(JSON.parse(s));
    } catch {
      return s.slice(1, -1);
    }
  }
  return s;
}

function cleanUserPrompt(content) {
  if (typeof content !== 'string' || !content.trim()) return '';
  const match = content.match(/<USER_REQUEST>\s*([\s\S]*?)\s*<\/USER_REQUEST>/i);
  const raw = match ? match[1] : content;
  const normalized = raw.replace(/\s+/g, ' ').trim();
  return normalized.length > 90 ? `${normalized.slice(0, 89).trimEnd()}…` : normalized;
}

export function describeToolCall(tc) {
  const name = typeof tc?.name === 'string' ? tc.name : '';
  if (!name) return '';
  const args = tc.args && typeof tc.args === 'object' ? tc.args : {};
  const summary = unquote(args.toolSummary) || unquote(args.toolAction);
  if (summary) {
    const clean = summary.replace(/\s+/g, ' ').trim();
    return clean.length > 64 ? `${clean.slice(0, 63).trimEnd()}…` : clean;
  }
  const filePath = unquote(args.Path || args.AbsolutePath || args.TargetFile);
  if (filePath) return `${name} (${basename(filePath)})`;
  return name;
}

/**
 * Determines whether the agent appears mid-turn based on the newest parseable step.
 * Mirrors the turn-end heuristic used by Antigravity's built-in swarm_board.
 */
function detectIsRunning(steps) {
  for (let i = steps.length - 1; i >= 0; i--) {
    const step = steps[i];
    if (!step) continue;
    if (step.type === 'PLANNER_RESPONSE') {
      const calls = Array.isArray(step.tool_calls) ? step.tool_calls : [];
      return calls.length > 0 || step.status !== 'DONE';
    }
    if (step.type === 'ERROR_MESSAGE') {
      return step.status !== 'DONE';
    }
    if (step.type === 'USER_INPUT' || step.type === 'GENERIC') {
      return true;
    }
  }
  return false;
}

/**
 * Parses raw `transcript.jsonl` text into structured context and usage metrics.
 */
export function parseTranscriptMetrics(text, { mtimeMs = 0 } = {}) {
  const rawLines = (text || '').split('\n');
  const steps = [];
  for (const line of rawLines) {
    if (!line.trim()) continue;
    try {
      const parsed = JSON.parse(line);
      if (parsed && typeof parsed === 'object') steps.push(parsed);
    } catch {
      // A partially written final line is safely skipped until the next poll.
    }
  }

  let userTurnsCount = 0;
  let modelCallsCount = 0;
  let toolCallsCount = 0;
  let errorStepsCount = 0;
  let checkpointsCount = 0;
  let totalInputTokens = 0;
  let totalCacheReadTokens = 0;
  let totalOutputTokens = 0;
  let timedOutputTokens = 0;
  let timedDurationSec = 0;
  let lastTokPerSec = null;

  let firstPromptTokens = null;
  let latestMeasured = null;
  let prevPromptTokens = null;
  const compactionPeaks = [];

  const timeline = [];
  const turns = [];
  const toolStats = new Map(); // name -> { name, calls, errors, estimatedContextAdded }
  let currentTurn = null;
  let prevTurnEndContext = 0;

  function ensureTurn(createdAt, preview = '') {
    if (!currentTurn) {
      userTurnsCount += 1;
      currentTurn = {
        index: userTurnsCount,
        startedAt: createdAt || null,
        endedAt: createdAt || null,
        preview,
        modelCalls: 0,
        toolCalls: 0,
        inputTokens: 0,
        cacheReadTokens: 0,
        outputTokens: 0,
        startContextTokens: null,
        endContextTokens: null,
        contextDelta: 0,
      };
      turns.push(currentTurn);
    }
    return currentTurn;
  }

  let pendingToolBatch = null; // [{ name }] from the previous PLANNER_RESPONSE

  for (let idx = 0; idx < steps.length; idx++) {
    const step = steps[idx];
    const type = String(step.type || '');
    const status = String(step.status || '');
    const createdAt = typeof step.created_at === 'string' ? step.created_at : null;

    if (status === 'ERROR' || type === 'ERROR_MESSAGE') {
      errorStepsCount += 1;
      if (pendingToolBatch && type === 'GENERIC' && status === 'ERROR') {
        for (const tName of pendingToolBatch) {
          const entry = toolStats.get(tName);
          if (entry) entry.errors += 1;
        }
      }
    }

    if (type === 'CHECKPOINT') {
      checkpointsCount += 1;
      if (prevPromptTokens != null && prevPromptTokens > 0) {
        compactionPeaks.push(prevPromptTokens);
      }
      continue;
    }

    if (type === 'USER_INPUT') {
      userTurnsCount += 1;
      if (currentTurn && currentTurn.endContextTokens != null) {
        prevTurnEndContext = currentTurn.endContextTokens;
      }
      currentTurn = {
        index: userTurnsCount,
        startedAt: createdAt,
        endedAt: createdAt,
        preview: cleanUserPrompt(step.content),
        modelCalls: 0,
        toolCalls: 0,
        inputTokens: 0,
        cacheReadTokens: 0,
        outputTokens: 0,
        startContextTokens: null,
        endContextTokens: null,
        contextDelta: 0,
      };
      turns.push(currentTurn);
      pendingToolBatch = null;
      continue;
    }

    if (type !== 'PLANNER_RESPONSE') continue;

    const turn = ensureTurn(createdAt);
    modelCallsCount += 1;
    turn.modelCalls += 1;
    if (createdAt) turn.endedAt = createdAt;

    const calls = Array.isArray(step.tool_calls) ? step.tool_calls : [];
    const callNames = calls.map((c) => String(c?.name || 'unknown')).filter(Boolean);
    const callDescriptions = calls.map((c) => describeToolCall(c)).filter(Boolean);
    toolCallsCount += callNames.length;
    turn.toolCalls += callNames.length;

    for (const name of callNames) {
      if (!toolStats.has(name)) {
        toolStats.set(name, { name, calls: 0, errors: 0, estimatedContextAdded: 0 });
      }
      toolStats.get(name).calls += 1;
    }

    const measured = hasTokens(step);
    const inputTokens = num(step.input_tokens);
    const cacheReadTokens = num(step.cache_read_tokens);
    const outputTokens = num(step.output_tokens);
    const promptTokens = inputTokens + cacheReadTokens;

    if (measured) {
      totalInputTokens += inputTokens;
      totalCacheReadTokens += cacheReadTokens;
      totalOutputTokens += outputTokens;

      turn.inputTokens += inputTokens;
      turn.cacheReadTokens += cacheReadTokens;
      turn.outputTokens += outputTokens;

      if (firstPromptTokens == null) firstPromptTokens = promptTokens;
      if (turn.startContextTokens == null) turn.startContextTokens = promptTokens;
      turn.endContextTokens = promptTokens + outputTokens;
      turn.contextDelta = turn.endContextTokens - prevTurnEndContext;

      const deltaFromPrev = prevPromptTokens == null ? promptTokens : promptTokens - prevPromptTokens;
      if (pendingToolBatch && pendingToolBatch.length > 0 && prevPromptTokens != null && deltaFromPrev > 0) {
        const share = Math.round(deltaFromPrev / pendingToolBatch.length);
        for (const tName of pendingToolBatch) {
          const stat = toolStats.get(tName);
          if (stat) stat.estimatedContextAdded += share;
        }
      }

      const compacted = prevPromptTokens != null && deltaFromPrev < -1024;
      const cacheHitRate = promptTokens > 0 ? cacheReadTokens / promptTokens : 0;

      let stepTokPerSec = null;
      if (outputTokens > 0 && createdAt) {
        const startMs = Date.parse(createdAt);
        let endMs = NaN;
        const nextStep = steps[idx + 1];
        if (nextStep?.type === 'GENERIC' && typeof nextStep.created_at === 'string') {
          endMs = Date.parse(nextStep.created_at);
        } else if (idx === steps.length - 1 && callNames.length === 0 && status === 'DONE' && mtimeMs > startMs) {
          endMs = mtimeMs;
        }
        if (Number.isFinite(startMs) && Number.isFinite(endMs) && endMs >= startMs && (endMs - startMs) <= 300_000) {
          const durSec = Math.max(0.8, (endMs - startMs) / 1000);
          stepTokPerSec = Math.round(outputTokens / durSec);
          timedOutputTokens += outputTokens;
          timedDurationSec += durSec;
          lastTokPerSec = stepTokPerSec;
        }
      }

      latestMeasured = {
        stepIndex: Number.isFinite(step.step_index) ? step.step_index : idx,
        createdAt,
        inputTokens,
        cacheReadTokens,
        outputTokens,
        promptTokens,
        estimatedNextContextTokens: promptTokens + outputTokens,
        cacheHitRate,
      };

      timeline.push({
        stepIndex: latestMeasured.stepIndex,
        turnIndex: turn.index,
        createdAt,
        status,
        inputTokens,
        cacheReadTokens,
        outputTokens,
        promptTokens,
        deltaFromPrev,
        compacted,
        cacheHitRate,
        tokPerSec: stepTokPerSec,
        tools: callDescriptions,
        toolNames: callNames,
      });

      prevPromptTokens = promptTokens;
    }

    pendingToolBatch = callNames.length > 0 ? callNames : null;
  }

  const totalPromptTokens = totalInputTokens + totalCacheReadTokens;
  const totalAllTokens = totalPromptTokens + totalOutputTokens;
  const overallCacheHitRate = totalPromptTokens > 0 ? totalCacheReadTokens / totalPromptTokens : 0;

  const currentPromptTokens = latestMeasured ? latestMeasured.promptTokens : 0;
  const initialBaselineTokens = firstPromptTokens ?? 0;
  const growthTokens = Math.max(0, currentPromptTokens - initialBaselineTokens);
  const observedCompactionTokens = compactionPeaks.length > 0 ? Math.max(...compactionPeaks) : null;

  const tools = [...toolStats.values()].sort(
    (a, b) => b.calls - a.calls || b.estimatedContextAdded - a.estimatedContextAdded || a.name.localeCompare(b.name),
  );

  const firstStep = steps.find((s) => typeof s.created_at === 'string');
  const lastStep = [...steps].reverse().find((s) => typeof s.created_at === 'string');

  return {
    hasData: steps.length > 0 && latestMeasured != null,
    isRunning: detectIsRunning(steps),
    startedAt: firstStep?.created_at || null,
    updatedAt: lastStep?.created_at || null,
    current: {
      promptTokens: currentPromptTokens,
      uncachedInputTokens: latestMeasured ? latestMeasured.inputTokens : 0,
      cacheReadTokens: latestMeasured ? latestMeasured.cacheReadTokens : 0,
      lastOutputTokens: latestMeasured ? latestMeasured.outputTokens : 0,
      estimatedNextContextTokens: latestMeasured ? latestMeasured.estimatedNextContextTokens : 0,
      initialBaselineTokens,
      growthTokens,
      cacheHitRate: latestMeasured ? latestMeasured.cacheHitRate : 0,
      stepIndex: latestMeasured ? latestMeasured.stepIndex : null,
      observedCompactionTokens,
    },
    totals: {
      userTurns: userTurnsCount,
      modelCalls: modelCallsCount,
      toolCalls: toolCallsCount,
      errorSteps: errorStepsCount,
      checkpoints: checkpointsCount,
      observedCompactionTokens,
      stepsCount: steps.length,
      inputTokens: totalInputTokens,
      cacheReadTokens: totalCacheReadTokens,
      outputTokens: totalOutputTokens,
      promptTokens: totalPromptTokens,
      allTokens: totalAllTokens,
      overallCacheHitRate,
      avgTokPerSec: timedDurationSec > 0 ? Math.round(timedOutputTokens / timedDurationSec) : null,
      lastTokPerSec,
    },
    turns,
    timeline,
    tools,
  };
}
