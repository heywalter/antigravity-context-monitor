import { existsSync, readFileSync, statSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';

/**
 * Decodes Go `proto.MarshalTextString` / protobuf text string escapes
 * (including octal UTF-8 byte sequences such as `\344\270\255` for CJK text).
 */
export function unescapePbtxtString(raw) {
  if (typeof raw !== 'string' || !raw) return '';
  const bytes = [];
  for (let i = 0; i < raw.length; i++) {
    const ch = raw[i];
    if (ch !== '\\' || i + 1 >= raw.length) {
      for (const b of Buffer.from(ch, 'utf-8')) bytes.push(b);
      continue;
    }
    const next = raw[i + 1];
    if (next >= '0' && next <= '7') {
      let end = i + 2;
      while (end < raw.length && end < i + 4 && raw[end] >= '0' && raw[end] <= '7') {
        end++;
      }
      bytes.push(parseInt(raw.slice(i + 1, end), 8) & 0xff);
      i = end - 1;
      continue;
    }
    if (next === 'x' && i + 3 < raw.length && /^[0-9a-fA-F]{2}$/.test(raw.slice(i + 2, i + 4))) {
      bytes.push(parseInt(raw.slice(i + 2, i + 4), 16) & 0xff);
      i += 3;
      continue;
    }
    i++;
    const map = { n: 10, r: 13, t: 9, '"': 34, "'": 39, '\\': 92 };
    const code = map[next];
    if (code !== undefined) {
      bytes.push(code);
    } else {
      for (const b of Buffer.from(next, 'utf-8')) bytes.push(b);
    }
  }
  return Buffer.from(bytes).toString('utf-8');
}

/**
 * Parses `title:"..."` from an Antigravity `.pbtxt` annotation file.
 */
export function parseAnnotationTitle(raw) {
  if (typeof raw !== 'string' || !raw) return '';
  const match = raw.match(/(?:^|\s)title\s*:\s*"((?:[^"\\]|\\.)*)"/);
  if (!match) return '';
  return unescapePbtxtString(match[1]).replace(/\s+/g, ' ').trim();
}

function safeStatKey(filePath) {
  try {
    const st = statSync(filePath);
    return `${st.mtimeMs}:${st.size}`;
  } catch {
    return null;
  }
}

let DatabaseSyncClass = null;
try {
  const req = createRequire(import.meta.url);
  DatabaseSyncClass = req('node:sqlite')?.DatabaseSync || null;
} catch {
  DatabaseSyncClass = null;
}

/**
 * Resolves the latest human/auto-generated conversation title from local Antigravity
 * annotation files (`<appData>/annotations/<conv>.pbtxt`), falling back to read-only
 * `conversation_summaries.db` lookup if present, and invalidating immediately on change.
 */
export class ConversationTitleResolver {
  constructor({ idPattern, fetchFallback, cacheTtlMs = 15_000 } = {}) {
    this.idPattern = idPattern;
    this.fetchFallback = fetchFallback;
    this.cacheTtlMs = cacheTtlMs;
    this.annCache = new Map(); // conv -> { path, statKey, title }
    this.dbCache = new Map();  // dbPath -> { dbKey, titles: Map<conv, title>, atMs }
    this.apiCache = new Map(); // conv -> { title, atMs, pending }
  }

  readFromAnnotations(appDataDirs, conv) {
    for (const appData of appDataDirs) {
      const p = join(appData, 'annotations', `${conv}.pbtxt`);
      const statKey = safeStatKey(p);
      if (!statKey) continue;
      const hit = this.annCache.get(conv);
      if (hit && hit.path === p && hit.statKey === statKey) {
        return hit.title;
      }
      try {
        const title = parseAnnotationTitle(readFileSync(p, 'utf-8'));
        if (this.annCache.size > 400) this.annCache.clear();
        this.annCache.set(conv, { path: p, statKey, title });
        return title;
      } catch {
        // File might be mid-update; fall through cleanly.
      }
    }
    return '';
  }

  readFromSummaryDb(appDataDirs, conv) {
    if (!DatabaseSyncClass) return '';
    for (const appData of appDataDirs) {
      const dbPath = join(appData, 'conversation_summaries.db');
      if (!existsSync(dbPath)) continue;
      const mainKey = safeStatKey(dbPath) || '0';
      const walKey = safeStatKey(`${dbPath}-wal`) || '0';
      const dbKey = `${mainKey}|${walKey}`;
      const hit = this.dbCache.get(dbPath);
      if (hit && hit.dbKey === dbKey) {
        return hit.titles.get(conv) || '';
      }
      let db = null;
      try {
        db = new DatabaseSyncClass(dbPath, { readOnly: true });
        const rows = db.prepare('SELECT conversation_id, title FROM conversation_summaries WHERE title != ""').all();
        const titles = new Map();
        for (const r of rows) {
          if (r && typeof r.conversation_id === 'string' && typeof r.title === 'string') {
            titles.set(r.conversation_id, r.title.replace(/\s+/g, ' ').trim());
          }
        }
        if (this.dbCache.size > 8) this.dbCache.clear();
        this.dbCache.set(dbPath, { dbKey, titles, atMs: Date.now() });
        const found = titles.get(conv) || '';
        if (found) return found;
      } catch {
        // Ignore transient SQLite lock or schema difference.
      } finally {
        try { db?.close(); } catch {}
      }
    }
    return '';
  }

  resolve(conv, appDataDirs) {
    if (!conv || (this.idPattern && !this.idPattern.test(conv))) return '';

    const annTitle = this.readFromAnnotations(appDataDirs, conv);
    if (annTitle) return annTitle;

    const dbTitle = this.readFromSummaryDb(appDataDirs, conv);
    if (dbTitle) return dbTitle;

    if (typeof this.fetchFallback !== 'function') return '';

    const now = Date.now();
    const cached = this.apiCache.get(conv);
    if (cached && cached.pending) {
      return cached.title || '';
    }
    if (!cached || now - cached.atMs >= this.cacheTtlMs) {
      const entry = { title: cached?.title || '', atMs: now, pending: true };
      if (this.apiCache.size > 300) this.apiCache.clear();
      this.apiCache.set(conv, entry);
      Promise.resolve(this.fetchFallback(conv))
        .then((title) => {
          entry.title = typeof title === 'string' ? title.replace(/\s+/g, ' ').trim() : '';
          entry.atMs = Date.now();
          entry.pending = false;
        })
        .catch(() => {
          entry.atMs = Date.now();
          entry.pending = false;
        });
      return entry.title;
    }
    return cached.title || '';
  }
}
