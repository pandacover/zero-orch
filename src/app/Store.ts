/**
 * The control plane's own files, under `ZERO_HOME` (default `~/.zero`):
 *
 *     settings.json          Settings
 *     projects.json          Project[]
 *     zero.db                threads, their items, and a search index of them (src/app/ThreadDb.ts)
 *     attachments/<id>/<name>  a file attached to a message (src/app/Attachments.ts)
 *
 * Every thread's meta is in memory from the start; a thread's items are read when it's first asked
 * for, and stay. Writes go through per item: a streaming thread writes the items that changed at most
 * every half second, and once more when its turn ends.
 *
 * Threads used to be `threads/<id>.json`. Those files stay where they are, untouched: each start brings
 * in any that's new or changed since it was last brought in, so a thread an older zero went on writing
 * there comes along too.
 */
import { Context, Effect, Layer, Schema } from "effect"
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, statSync, writeFileSync } from "node:fs"
import { homedir } from "node:os"
import { basename, join, resolve } from "node:path"
import { DEFAULT_SETTINGS, type Item, newId, type Project, Settings, type Thread, type ThreadMeta, metaOf } from "./Model.ts"
import { openThreadDb, type SearchHit, type ThreadDb } from "./ThreadDb.ts"

export class StoreError extends Schema.TaggedError<StoreError>()("StoreError", {
  message: Schema.String
}) {}

export const appHome = (): string => process.env["ZERO_HOME"] ?? join(homedir(), ".zero")

export class Store extends Context.Service<Store, {
  readonly home: string
  settings(): Settings
  saveSettings(input: unknown): Effect.Effect<Settings, StoreError>
  projects(): ReadonlyArray<Project>
  project(id: string): Project | undefined
  /** A folder as a project; with `create`, the folder (and its parents) are made when missing. */
  addProject(path: string, name?: string, create?: boolean): Effect.Effect<Project, StoreError>
  removeProject(id: string): Effect.Effect<void>
  threads(): ReadonlyArray<ThreadMeta>
  thread(id: string): Thread | undefined
  createThread(thread: Thread): void
  /**
   * Write a thread now, or (with `soon`) within half a second: its meta, and its items that are new or
   * were replaced. An item changed in place (streaming text, an answered approval) is named as `changed`.
   */
  saveThread(thread: Thread, soon?: boolean, changed?: Item): void
  deleteThread(id: string): void
  /** Change a thread's meta and write it, without reading its items when they aren't in memory. */
  patchThread(id: string, patch: Partial<ThreadMeta>): ThreadMeta | undefined
  /** Threads whose title or messages match the words, best first. */
  search(typed: string): ReadonlyArray<SearchHit>
}>()("zero/Store") {}

const decodeSettings = Schema.decodeUnknownEffect(Settings)

const writeJson = (file: string, value: unknown) => {
  const tmp = `${file}.tmp`
  writeFileSync(tmp, JSON.stringify(value, null, 2))
  renameSync(tmp, file)
}

const readJson = <A>(file: string, fallback: A): A => {
  try {
    return JSON.parse(readFileSync(file, "utf8")) as A
  } catch {
    return fallback
  }
}

/** Settings from disk, filling in what an older file lacks. */
const mergeSettings = (raw: unknown): unknown => {
  const r = (raw ?? {}) as Record<string, Record<string, unknown>>
  const d = DEFAULT_SETTINGS as unknown as Record<string, unknown>
  const out: Record<string, unknown> = { ...d, ...r }
  for (const k of ["claude", "codex", "ollama", "memory", "titles", "remote"]) out[k] = { ...(d[k] as object), ...(r[k] ?? {}) }
  return out
}

export const make = (home: string) =>
  Effect.gen(function*() {
    mkdirSync(home, { recursive: true })
    let settings: Settings = yield* decodeSettings(mergeSettings(readJson(join(home, "settings.json"), {}))).pipe(
      Effect.orElseSucceed(() => DEFAULT_SETTINGS)
    )
    const projects: Array<Project> = readJson(join(home, "projects.json"), [])
    const db = openThreadDb(join(home, "zero.db"))
    importJsonThreads(home, db)
    // A turn can't still be going after a restart, nor a message be waiting on one.
    const metas = new Map<string, ThreadMeta>(db.metas().map(({ queued: _q, waiting: _w, ...m }) => [m.id, { ...m, status: "idle" }]))
    /** Threads whose items have been read: the same object every time one is asked for. */
    const loaded = new Map<string, Thread>()
    /** Each loaded thread's items as last written, by id: an item that's a different object now was replaced. */
    const written = new Map<string, Map<string, Item>>()
    /** Items named as changed in place since the last write, by thread. */
    const changedItems = new Map<string, Set<string>>()
    const timers = new Map<string, ReturnType<typeof setTimeout>>()
    /** Past zero's close: what's in memory stays as it is, and nothing more goes to (or comes from) the database. */
    let closed = false

    const load = (id: string): Thread | undefined => {
      const known = loaded.get(id)
      if (known) return known
      const meta = metas.get(id)
      if (!meta || closed) return undefined
      const items = db.items(id)
      const t: Thread = { ...meta, items }
      loaded.set(id, t)
      written.set(id, new Map(items.map((i) => [i.id, i])))
      return t
    }
    /** Its meta, and the items that are new, replaced, or named as changed, in one transaction. */
    const writeThread = (t: Thread) => {
      if (closed) return
      const before = written.get(t.id) ?? new Map<string, Item>()
      const named = changedItems.get(t.id)
      const items: Array<{ item: Item; seq: number }> = []
      t.items.forEach((item, seq) => {
        if (before.get(item.id) !== item || named?.has(item.id)) items.push({ item, seq })
      })
      const meta = metaOf(t)
      db.write(meta, items)
      for (const { item } of items) before.set(item.id, item)
      written.set(t.id, before)
      changedItems.delete(t.id)
      metas.set(t.id, meta)
    }
    const flush = () => {
      for (const [id, timer] of timers) {
        clearTimeout(timer)
        const t = loaded.get(id)
        if (t) writeThread(t)
      }
      timers.clear()
    }
    const forget = (id: string) => {
      clearTimeout(timers.get(id))
      timers.delete(id)
      metas.delete(id)
      loaded.delete(id)
      written.delete(id)
      changedItems.delete(id)
      if (!closed) db.remove(id)
    }
    // Writes waiting on their half second go out, and the database closes, when zero does.
    yield* Effect.addFinalizer(() =>
      Effect.sync(() => {
        flush()
        closed = true
        db.close()
      })
    )

    return Store.of({
      home,
      settings: () => settings,
      saveSettings: (input) =>
        decodeSettings(input).pipe(
          Effect.mapError((e) => new StoreError({ message: `settings: ${e.message}` })),
          Effect.tap((s) => Effect.sync(() => {
            settings = s
            writeJson(join(home, "settings.json"), s)
          }))
        ),
      projects: () => projects,
      project: (id) => projects.find((p) => p.id === id),
      addProject: (path, name, create = false) =>
        Effect.gen(function*() {
          const full = resolve(path.trim().replace(/^"|"$/g, ""))
          if (!existsSync(full)) {
            if (!create) return yield* new StoreError({ message: `no folder at ${full}` })
            yield* Effect.try({
              try: () => mkdirSync(full, { recursive: true }),
              catch: (e) => new StoreError({ message: `couldn't make ${full}: ${(e as Error).message}` })
            })
          }
          if (!statSync(full).isDirectory()) return yield* new StoreError({ message: `${full} is a file, not a folder` })
          const known = projects.find((p) => resolve(p.path).toLowerCase() === full.toLowerCase())
          if (known) return known
          const project: Project = { id: newId("p"), name: name?.trim() || basename(full), path: full, createdAt: new Date().toISOString() }
          projects.push(project)
          writeJson(join(home, "projects.json"), projects)
          return project
        }),
      removeProject: (id) =>
        Effect.sync(() => {
          const i = projects.findIndex((p) => p.id === id)
          if (i < 0) return
          projects.splice(i, 1)
          writeJson(join(home, "projects.json"), projects)
          for (const m of [...metas.values()]) if (m.projectId === id) forget(m.id)
        }),
      // A loaded thread's meta is read off it, so a change not written yet still shows.
      threads: () =>
        [...metas.values()]
          .map((m) => {
            const t = loaded.get(m.id)
            return t ? metaOf(t) : m
          })
          .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)),
      thread: load,
      createThread: (t) => {
        metas.set(t.id, metaOf(t))
        loaded.set(t.id, t)
        writeThread(t)
      },
      saveThread: (t, soon, changed) => {
        if (changed) {
          const named = changedItems.get(t.id) ?? new Set<string>()
          named.add(changed.id)
          changedItems.set(t.id, named)
        }
        if (!soon) {
          clearTimeout(timers.get(t.id))
          timers.delete(t.id)
          return writeThread(t)
        }
        if (timers.has(t.id)) return
        timers.set(t.id, setTimeout(() => {
          timers.delete(t.id)
          if (loaded.get(t.id) === t) writeThread(t)
        }, 500))
      },
      deleteThread: forget,
      patchThread: (id, patch) => {
        const t = loaded.get(id)
        if (t) {
          Object.assign(t, patch)
          writeThread(t)
          return metaOf(t)
        }
        const m = metas.get(id)
        if (!m) return undefined
        const next = { ...m, ...patch }
        metas.set(id, next)
        if (!closed) db.write(next, [])
        return next
      },
      search: (typed) => closed ? [] : db.search(typed).filter((h) => metas.has(h.threadId))
    })
  })

export const layer = (home: string = appHome()) => Layer.effect(Store, make(home))

/**
 * Threads kept the old way, as `threads/<id>.json`: each file that's new, or changed since it was last
 * brought in, replaces that thread in the database (all of them in one transaction). The files are left
 * as they are: an older zero still reads and writes them, and nothing of them is lost.
 */
const importJsonThreads = (home: string, db: ThreadDb) => {
  const dir = join(home, "threads")
  if (!existsSync(dir)) return
  const seen = db.importedAt()
  const fresh = readdirSync(dir).filter((f) => f.endsWith(".json")).flatMap((f) => {
    const file = join(dir, f)
    const mtime = statSync(file).mtimeMs
    const id = f.slice(0, -".json".length)
    if ((seen.get(id) ?? -1) >= mtime) return []
    const t = readJson<Thread | undefined>(file, undefined)
    return t?.id === id && Array.isArray(t.items) ? [{ thread: t, mtime }] : []
  })
  if (fresh.length) db.importThreads(fresh)
}
