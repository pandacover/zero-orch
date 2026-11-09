/**
 * The control plane's own files, under `ZERO_HOME` (default `~/.zero`):
 *
 *     settings.json          Settings
 *     projects.json          Project[]
 *     threads/<id>.json      Thread (meta and items)
 *     attachments/<id>/<name>  a file attached to a message (src/app/Attachments.ts)
 *
 * Everything is held in memory and written through; a thread that's
 * streaming is written at most every half second, and once more when its
 * turn ends.
 */
import { Context, Effect, Layer, Schema } from "effect"
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs"
import { homedir } from "node:os"
import { basename, join, resolve } from "node:path"
import { DEFAULT_SETTINGS, newId, type Project, Settings, type Thread, type ThreadMeta, metaOf } from "./Model.ts"

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
  addProject(path: string, name?: string): Effect.Effect<Project, StoreError>
  removeProject(id: string): Effect.Effect<void>
  threads(): ReadonlyArray<ThreadMeta>
  thread(id: string): Thread | undefined
  createThread(thread: Thread): void
  /** Write a thread now, or (with `soon`) within half a second. */
  saveThread(thread: Thread, soon?: boolean): void
  deleteThread(id: string): void
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
  for (const k of ["claude", "codex", "ollama", "memory"]) out[k] = { ...(d[k] as object), ...(r[k] ?? {}) }
  return out
}

export const make = (home: string) =>
  Effect.gen(function*() {
    mkdirSync(join(home, "threads"), { recursive: true })
    let settings: Settings = yield* decodeSettings(mergeSettings(readJson(join(home, "settings.json"), {}))).pipe(
      Effect.orElseSucceed(() => DEFAULT_SETTINGS)
    )
    const projects: Array<Project> = readJson(join(home, "projects.json"), [])
    const threads = new Map<string, Thread>()
    for (const f of readdirSync(join(home, "threads"))) {
      if (!f.endsWith(".json")) continue
      const t = readJson<Thread | undefined>(join(home, "threads", f), undefined)
      // A turn can't still be going after a restart.
      if (t?.id) threads.set(t.id, { ...t, status: "idle" })
    }
    const timers = new Map<string, ReturnType<typeof setTimeout>>()
    const writeThread = (t: Thread) => writeJson(join(home, "threads", `${t.id}.json`), t)

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
      addProject: (path, name) =>
        Effect.gen(function*() {
          const full = resolve(path.trim().replace(/^"|"$/g, ""))
          if (!existsSync(full)) return yield* new StoreError({ message: `no folder at ${full}` })
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
          for (const t of [...threads.values()]) {
            if (t.projectId !== id) continue
            threads.delete(t.id)
            rmSync(join(home, "threads", `${t.id}.json`), { force: true })
          }
        }),
      threads: () => [...threads.values()].map(metaOf).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)),
      thread: (id) => threads.get(id),
      createThread: (t) => {
        threads.set(t.id, t)
        writeThread(t)
      },
      saveThread: (t, soon) => {
        if (!soon) {
          clearTimeout(timers.get(t.id))
          timers.delete(t.id)
          return writeThread(t)
        }
        if (timers.has(t.id)) return
        timers.set(t.id, setTimeout(() => {
          timers.delete(t.id)
          writeThread(t)
        }, 500))
      },
      deleteThread: (id) => {
        threads.delete(id)
        clearTimeout(timers.get(id))
        rmSync(join(home, "threads", `${id}.json`), { force: true })
      }
    })
  })

export const layer = (home: string = appHome()) => Layer.effect(Store, make(home))
