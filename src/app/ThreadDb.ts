/**
 * Threads in SQLite (`zero.db` in zero's home), through Node's own `node:sqlite`: no native module to build.
 *
 *     threads    one row a thread: its meta (Thread without items) as JSON
 *     items      one row an item, in the thread's order (seq), as JSON
 *     thread_text, item_text   FTS5 indexes over titles and over what items say, for search
 *
 * Writes are per item: a turn that streams rewrites the rows that changed, not the thread. The FTS
 * rows share their rowid with the row they index, so keeping them current is a delete and an insert.
 */
import { DatabaseSync } from "node:sqlite"
import type { Item, Thread, ThreadMeta } from "./Model.ts"

/** A thread that matched a search: where (its title, or an item of it), and the words around the match. */
export interface SearchHit {
  readonly threadId: string
  /** The item that matched; absent when the title did. */
  readonly itemId?: string
  /** The text around the match, the matched words between \u0002 and \u0003. */
  readonly snippet: string
}

/** What an item says, for search: your words, the agent's, and the commands and paths it used. */
export const searchText = (item: Item): string => {
  switch (item.kind) {
    case "user": return item.text.replace(/\{\{att:[^}]+\}\}/g, " ")
    case "assistant": return item.text
    case "tool": return `${item.name} ${item.detail}`
    default: return ""
  }
}

/**
 * A search as the person typed it, in FTS5's terms: each word a prefix, all of them needed.
 * Quotes and operators they typed are words here, never syntax.
 */
export const ftsQuery = (typed: string): string =>
  typed.toLowerCase().split(/[^\p{L}\p{N}_]+/u).filter(Boolean).slice(0, 12).map((w) => `"${w}"*`).join(" ")

/** FNV-1a over a string's UTF-16 units, mixed with its length: enough to tell text that changed from text that didn't. */
const hash = (s: string): number => {
  let h = 0x811c9dc5 ^ s.length
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 0x01000193)
  return h >>> 0
}

export const openThreadDb = (file: string) => {
  const db = new DatabaseSync(file)
  db.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA synchronous = NORMAL;
    PRAGMA busy_timeout = 3000;
    CREATE TABLE IF NOT EXISTS threads (rid INTEGER PRIMARY KEY, id TEXT NOT NULL UNIQUE, meta TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS items (
      rid INTEGER PRIMARY KEY, thread_id TEXT NOT NULL, id TEXT NOT NULL, seq INTEGER NOT NULL, data TEXT NOT NULL,
      UNIQUE (thread_id, id)
    );
    CREATE INDEX IF NOT EXISTS items_in_order ON items (thread_id, seq);
    CREATE VIRTUAL TABLE IF NOT EXISTS thread_text USING fts5(title, tokenize = 'porter unicode61 remove_diacritics 2');
    CREATE VIRTUAL TABLE IF NOT EXISTS item_text USING fts5(body, tokenize = 'porter unicode61 remove_diacritics 2');
    CREATE TABLE IF NOT EXISTS imported (id TEXT PRIMARY KEY, mtime REAL NOT NULL);
  `)
  const q = {
    metas: db.prepare("SELECT meta FROM threads"),
    items: db.prepare("SELECT data FROM items WHERE thread_id = ? ORDER BY seq"),
    putThread: db.prepare("INSERT INTO threads (id, meta) VALUES (?, ?) ON CONFLICT (id) DO UPDATE SET meta = excluded.meta RETURNING rid"),
    putItem: db.prepare(
      "INSERT INTO items (thread_id, id, seq, data) VALUES (?, ?, ?, ?) ON CONFLICT (thread_id, id) DO UPDATE SET data = excluded.data, seq = excluded.seq RETURNING rid"
    ),
    dropTitle: db.prepare("DELETE FROM thread_text WHERE rowid = ?"),
    putTitle: db.prepare("INSERT INTO thread_text (rowid, title) VALUES (?, ?)"),
    dropText: db.prepare("DELETE FROM item_text WHERE rowid = ?"),
    putText: db.prepare("INSERT INTO item_text (rowid, body) VALUES (?, ?)"),
    dropItemTexts: db.prepare("DELETE FROM item_text WHERE rowid IN (SELECT rid FROM items WHERE thread_id = ?)"),
    dropItems: db.prepare("DELETE FROM items WHERE thread_id = ?"),
    dropThreadTitle: db.prepare("DELETE FROM thread_text WHERE rowid IN (SELECT rid FROM threads WHERE id = ?)"),
    dropThread: db.prepare("DELETE FROM threads WHERE id = ?"),
    count: db.prepare("SELECT count(*) AS n FROM threads"),
    importedAt: db.prepare("SELECT id, mtime FROM imported"),
    markImported: db.prepare("INSERT INTO imported (id, mtime) VALUES (?, ?) ON CONFLICT (id) DO UPDATE SET mtime = excluded.mtime"),
    findItems: db.prepare(`
      SELECT i.thread_id AS threadId, i.id AS itemId, snippet(item_text, 0, char(2), char(3), '…', 14) AS snippet
      FROM item_text JOIN items i ON i.rid = item_text.rowid
      WHERE item_text MATCH ? ORDER BY bm25(item_text) LIMIT 400`),
    findTitles: db.prepare(`
      SELECT t.id AS threadId, snippet(thread_text, 0, char(2), char(3), '…', 14) AS snippet
      FROM thread_text JOIN threads t ON t.rid = thread_text.rowid
      WHERE thread_text MATCH ? ORDER BY bm25(thread_text) LIMIT 100`)
  }
  /**
   * What's in the FTS rows now (a hash of it), by rowid: an item's row is written again only when its text
   * changed, and streaming text is saved often. A hash, not the text: every message ever would sit in memory.
   */
  const titles = new Map<number, number>()
  const texts = new Map<number, number>()

  const inTransaction = <A>(f: () => A): A => {
    db.exec("BEGIN")
    try {
      const a = f()
      db.exec("COMMIT")
      return a
    } catch (e) {
      db.exec("ROLLBACK")
      throw e
    }
  }
  const writeMeta = (meta: ThreadMeta) => {
    const { rid } = q.putThread.get(meta.id, JSON.stringify(meta)) as { rid: number }
    const h = hash(meta.title)
    if (titles.get(rid) === h) return
    q.dropTitle.run(rid)
    q.putTitle.run(rid, meta.title)
    titles.set(rid, h)
  }
  const writeItem = (threadId: string, item: Item, seq: number) => {
    const { rid } = q.putItem.get(threadId, item.id, seq, JSON.stringify(item)) as { rid: number }
    const text = searchText(item)
    const h = hash(text)
    if (texts.get(rid) === h) return
    q.dropText.run(rid)
    if (text) q.putText.run(rid, text)
    texts.set(rid, h)
  }

  return {
    /** Every thread's meta, without items. */
    metas: (): Array<ThreadMeta> => (q.metas.all() as Array<{ meta: string }>).map((r) => JSON.parse(r.meta) as ThreadMeta),
    /** A thread's items, in order. */
    items: (id: string): Array<Item> => (q.items.all(id) as Array<{ data: string }>).map((r) => JSON.parse(r.data) as Item),
    isEmpty: () => (q.count.get() as { n: number }).n === 0,
    /** A thread's meta and the items given (each at its place in the thread), in one transaction. */
    write: (meta: ThreadMeta, items: ReadonlyArray<{ item: Item; seq: number }>) =>
      inTransaction(() => {
        writeMeta(meta)
        for (const { item, seq } of items) writeItem(meta.id, item, seq)
      }),
    /** When each old JSON thread file was last brought in (its mtime then), by thread id. */
    importedAt: (): Map<string, number> => new Map((q.importedAt.all() as Array<{ id: string; mtime: number }>).map((r) => [r.id, r.mtime])),
    /** Whole threads from old JSON files, each replacing what the database had of it, in one transaction. */
    importThreads: (threads: ReadonlyArray<{ thread: Thread; mtime: number }>) =>
      inTransaction(() => {
        for (const { thread: t, mtime } of threads) {
          q.dropItemTexts.run(t.id)
          q.dropItems.run(t.id)
          const { items, ...meta } = t
          writeMeta(meta)
          items.forEach((item, seq) => writeItem(t.id, item, seq))
          q.markImported.run(t.id, mtime)
        }
      }),
    remove: (id: string) =>
      inTransaction(() => {
        q.dropItemTexts.run(id)
        q.dropItems.run(id)
        q.dropThreadTitle.run(id)
        q.dropThread.run(id)
      }),
    /** Threads whose title or items match `typed`, best first, each once (its best match). */
    search: (typed: string, limit = 30): Array<SearchHit> => {
      const match = ftsQuery(typed)
      if (!match) return []
      const out = new Map<string, SearchHit>()
      for (const r of q.findTitles.all(match) as Array<{ threadId: string; snippet: string }>) {
        if (!out.has(r.threadId)) out.set(r.threadId, { threadId: r.threadId, snippet: r.snippet })
      }
      for (const r of q.findItems.all(match) as Array<{ threadId: string; itemId: string; snippet: string }>) {
        if (!out.has(r.threadId)) out.set(r.threadId, r)
        if (out.size >= limit) break
      }
      return [...out.values()].slice(0, limit)
    },
    close: () => db.close()
  }
}

export type ThreadDb = ReturnType<typeof openThreadDb>
