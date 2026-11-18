import { ID_RE } from './metrics.mjs';

export const PREFS_VERSION = 2;
export const DEFAULT_AUTO_WINDOW_LIMIT = 256_000;
export const WINDOW_LIMIT_TIERS = [
  80_000,
  128_000,
  160_000,
  200_000,
  256_000,
  512_000,
  840_000,
  1_000_000,
  2_000_000,
];

export const HUD_MODES = new Set(['both', 'window', 'menubar']);
export const ANCHOR_POSITIONS = new Set(['topRight', 'bottomCenter', 'bottomRight']);
export const CAPSULE_STYLES = new Set(['compact', 'full', 'minimal']);
export const LANGUAGES = new Set(['en', 'zh']);

/**
 * Normalizes legacy HUD display mode values into supported variants.
 */
export function normalizeDisplayMode(rawMode) {
  if (rawMode === 'bottom') return 'window';
  return typeof rawMode === 'string' && HUD_MODES.has(rawMode) ? rawMode : 'both';
}

function resolveWindowLimitPref(raw) {
  const rawVer = Number(raw?.prefsVersion);
  const hasV2 = Number.isFinite(rawVer) && rawVer >= PREFS_VERSION;
  const val = raw?.windowLimit;

  if (val == null || val === 'auto' || val === 0 || val === '0') {
    return 0;
  }
  const limit = Number(val);
  if (!Number.isFinite(limit) || limit <= 0) {
    return 0;
  }
  const rounded = Math.round(limit);
  // Migrate pre-v2 legacy default (1M) to Auto mode, while keeping other explicit custom overrides.
  if (!hasV2 && rounded === 1_000_000) {
    return 0;
  }
  return rounded;
}

/**
 * Normalizes raw persisted or incoming HUD preferences with safe defaults.
 */
export function normalizeHudPrefs(raw) {
  const offsetX = Number(raw?.offsetX);
  const offsetY = Number(raw?.offsetY);
  const mode = normalizeDisplayMode(raw?.displayMode);
  const anchor = typeof raw?.anchorPosition === 'string' && ANCHOR_POSITIONS.has(raw.anchorPosition)
    ? raw.anchorPosition
    : 'topRight';
  const style = typeof raw?.capsuleStyle === 'string' && CAPSULE_STYLES.has(raw.capsuleStyle)
    ? raw.capsuleStyle
    : 'compact';
  const language = typeof raw?.language === 'string' && LANGUAGES.has(raw.language)
    ? raw.language
    : 'en';
  const pinned = typeof raw?.pinnedConversationId === 'string' && ID_RE.test(raw.pinnedConversationId.trim())
    ? raw.pinnedConversationId.trim()
    : null;
  return {
    prefsVersion: PREFS_VERSION,
    windowLimit: resolveWindowLimitPref(raw),
    displayMode: mode,
    anchorPosition: anchor,
    capsuleStyle: style,
    language,
    offsetX: Number.isFinite(offsetX) ? offsetX : 0,
    offsetY: Number.isFinite(offsetY) ? offsetY : 0,
    ...(pinned ? { pinnedConversationId: pinned } : {}),
  };
}

/**
 * Applies a partial preference update onto an existing normalized preference object.
 */
export function applyHudPrefsPatch(currentPrefs, patch) {
  const cur = normalizeHudPrefs(currentPrefs);
  const next = { ...cur, prefsVersion: PREFS_VERSION };
  if (patch && typeof patch === 'object') {
    if (patch.displayMode != null) {
      const m = patch.displayMode === 'bottom' ? 'window' : patch.displayMode;
      if (typeof m === 'string' && HUD_MODES.has(m)) {
        next.displayMode = m;
      }
    }
    if (typeof patch.anchorPosition === 'string' && ANCHOR_POSITIONS.has(patch.anchorPosition)) {
      if (patch.anchorPosition !== cur.anchorPosition && patch.resetPosition !== false) {
        next.offsetX = 0;
        next.offsetY = 0;
      }
      next.anchorPosition = patch.anchorPosition;
    }
    if (typeof patch.capsuleStyle === 'string' && CAPSULE_STYLES.has(patch.capsuleStyle)) {
      next.capsuleStyle = patch.capsuleStyle;
    }
    if (typeof patch.language === 'string' && LANGUAGES.has(patch.language)) {
      next.language = patch.language;
    }
    if ('windowLimit' in patch && patch.windowLimit != null) {
      if (patch.windowLimit === 0 || patch.windowLimit === '0' || patch.windowLimit === 'auto') {
        next.windowLimit = 0;
      } else {
        const lim = Number(patch.windowLimit);
        if (Number.isFinite(lim) && lim > 0) next.windowLimit = Math.round(lim);
      }
    }
    if (patch.resetPosition === true) {
      next.offsetX = 0;
      next.offsetY = 0;
    }
    if ('pinnedConversationId' in patch) {
      const p = typeof patch.pinnedConversationId === 'string' ? patch.pinnedConversationId.trim() : '';
      if (p && ID_RE.test(p)) next.pinnedConversationId = p;
      else delete next.pinnedConversationId;
    }
  }
  return normalizeHudPrefs(next);
}

/**
 * Maps an observed pre-checkpoint prompt token count to Antigravity's nearest compaction ceiling tier.
 */
export function snapObservedCompactionLimit(tokens) {
  const n = Number(tokens);
  if (!Number.isFinite(n) || n <= 0) return DEFAULT_AUTO_WINDOW_LIMIT;
  if (n <= 95_000) return 80_000;
  if (n <= 145_000) return 128_000;
  if (n <= 185_000) return 160_000;
  if (n <= 215_000) return 200_000;
  if (n <= 310_000) return 256_000;
  if (n <= 560_000) return 512_000;
  if (n <= 880_000) return 840_000;
  return 1_000_000;
}

/**
 * Infers a model's Antigravity checkpoint compaction threshold from its public model identifier.
 */
export function inferModelCompactionLimit(modelName) {
  const s = typeof modelName === 'string' ? modelName.trim().toLowerCase() : '';
  if (!s) return null;
  if (/gpt-oss/.test(s)) return 80_000;
  if (/gemini-2\.5/.test(s)) return 128_000;
  if (/(?:^|[-_.\s])1m(?:$|[-_.\s])/.test(s)) return 840_000;
  return null;
}

/**
 * Resolves the effective context window / compaction ceiling for a session.
 */
export function resolveEffectiveWindowLimit({ prefs = {}, modelName = '', metrics = null } = {}) {
  const configured = Number(prefs?.windowLimit);
  if (Number.isFinite(configured) && configured > 0) {
    return { limit: Math.round(configured), mode: 'manual', source: 'manual' };
  }

  const observed = Number(metrics?.totals?.observedCompactionTokens ?? metrics?.current?.observedCompactionTokens);
  let limit = DEFAULT_AUTO_WINDOW_LIMIT;
  let source = 'default';

  if (Number.isFinite(observed) && observed > 0) {
    limit = snapObservedCompactionLimit(observed);
    source = 'compaction';
  } else {
    const inferred = inferModelCompactionLimit(modelName);
    if (inferred != null) {
      limit = inferred;
      source = 'model';
    }
  }

  const used = Number(metrics?.current?.estimatedNextContextTokens);
  if (Number.isFinite(used) && used > limit) {
    const promoted = WINDOW_LIMIT_TIERS.find((t) => t >= used);
    limit = promoted ?? Math.ceil(used / 100_000) * 100_000;
    if (source === 'default') source = 'observed_usage';
  }

  return { limit, mode: 'auto', source };
}

/**
 * Returns whether the native macOS HUD floating capsule is supported in this environment.
 */
export function isHudSupported({ platform = process.platform, env = process.env } = {}) {
  return platform === 'darwin' && env?.CONTEXT_MONITOR_NO_HUD !== '1';
}
