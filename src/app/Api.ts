/**
 * The control plane's backend, with no transport in it: `call` answers one
 * request from the page, `upload` and `attachment` handle files, and
 * `subscribe` hands out the live events. src/desktop/main.ts wires it to the
 * window over IPC; tests can call it directly.
 */
import * as NodeServices from "@effect/platform-node/NodeServices"
import { Effect, Layer, ManagedRuntime } from "effect"
import * as Singularity from "../Singularity.ts"
import { type Attachment, findAttachment, markersIn, MAX_ATTACHMENT_BYTES, removeAttachments, saveAttachment } from "./Attachments.ts"
import { makeEvolution } from "./Evolution.ts"
import { gitView, parseAction, runAction } from "./GitInfo.ts"
import { type Access, ACCESSES, compactionOffered, metaOf, type ProviderId } from "./Model.ts"
import * as StoreModule from "./Store.ts"
import { Store } from "./Store.ts"
import { type Hub, makeThreads, PROVIDERS } from "./Threads.ts"

export interface ApiOptions {
  /** zero's own repo: its genome, benchmark and ledger. */
  readonly root: string
  /** zero's CLI, which evolution runs start. */
  readonly cli: string
}

/** An answer, with an HTTP-style status so the page can tell errors (>= 400, `body.error`) apart. */
export interface Reply {
  readonly status: number
  readonly body: unknown
}

export type Listener = (event: string, data: unknown) => void

export interface Api {
  readonly call: (method: string, path: string, body?: unknown) => Promise<Reply>
  readonly upload: (name: string, mime: string, bytes: Uint8Array) => Reply
  readonly attachment: (id: string) => Attachment | undefined
  readonly subscribe: (listener: Listener) => () => void
  /** Stops running turns and evolution runs, then frees the runtime. */
  readonly close: () => Promise<void>
}

const isProvider = (x: unknown): x is ProviderId => x === "claude" || x === "codex" || x === "ollama"
const isAccess = (x: unknown): x is Access => (ACCESSES as ReadonlyArray<unknown>).includes(x)
const reply = (status: number, body: unknown): Reply => ({ status, body })
const error = (status: number, message: string): Reply => ({ status, body: { error: message } })
const TOO_BIG = `files up to ${MAX_ATTACHMENT_BYTES / 1024 / 1024} MB attach`

/** A thread's choices from a request body: only the fields that are present and valid. */
const choices = (b: Record<string, unknown>) => ({
  ...(isProvider(b["provider"]) ? { provider: b["provider"] } : {}),
  ...(typeof b["model"] === "string" ? { model: b["model"] } : {}),
  ...(isAccess(b["access"]) ? { access: b["access"] } : {}),
  ...(typeof b["effort"] === "string" ? { effort: b["effort"] } : {})
})

export const makeApi = async ({ root, cli }: ApiOptions): Promise<Api> => {
  const runtime = ManagedRuntime.make(
    Layer.mergeAll(Singularity.layer, StoreModule.layer()).pipe(Layer.provideMerge(NodeServices.layer))
  )
  const listeners = new Set<Listener>()
  const hub: Hub = { send: (event, data) => { for (const l of listeners) l(event, data) } }
  const evolution = makeEvolution({ root, cli, hub })
  const { store, threads } = await runtime.runPromise(Effect.gen(function*() {
    const store = yield* Store
    // zero is a project from the start: the place to talk about zero itself.
    if (store.projects().length === 0) yield* store.addProject(root, "zero")
    return { store, threads: yield* makeThreads({ zeroRoot: root, hub }) }
  }))

  const providers = async () => {
    const s = store.settings()
    const entries = await Promise.all(Object.values(PROVIDERS).map(async (p) => [p.id, { label: p.label, compaction: p.compaction, ...(await p.status(s)) }] as const))
    return Object.fromEntries(entries)
  }

  const route = async (m: string, parts: ReadonlyArray<string>, body: Record<string, unknown>): Promise<Reply> => {
    // --- everything a page needs to start ---
    if (m === "GET" && parts[0] === "bootstrap") {
      return reply(200, { settings: store.settings(), projects: store.projects(), threads: store.threads(), providers: await providers(), home: store.home, zeroRoot: root })
    }
    if (m === "GET" && parts[0] === "providers") return reply(200, await providers())

    // --- settings ---
    if (m === "PUT" && parts[0] === "settings") {
      const saved = await runtime.runPromise(store.saveSettings(body).pipe(Effect.result))
      if (saved._tag === "Failure") return error(400, saved.failure.message)
      hub.send("settings", saved.success)
      return reply(200, { settings: saved.success, providers: await providers() })
    }

    // --- projects ---
    if (parts[0] === "projects") {
      if (m === "POST" && parts.length === 1) {
        if (typeof body["path"] !== "string" || !body["path"].trim()) return error(400, "give the project's folder path")
        const added = await runtime.runPromise(store.addProject(body["path"], typeof body["name"] === "string" ? body["name"] : undefined).pipe(Effect.result))
        if (added._tag === "Failure") return error(400, added.failure.message)
        hub.send("projects", store.projects())
        return reply(201, added.success)
      }
      const id = parts[1]
      if (m === "DELETE" && id) {
        if (store.threads().some((t) => t.projectId === id && threads.isRunning(t.id))) return error(409, "stop this project's running threads first")
        for (const t of store.threads()) if (t.projectId === id) removeAttachments(store.home, store.thread(t.id))
        await runtime.runPromise(store.removeProject(id))
        hub.send("projects", store.projects())
        hub.send("threads", store.threads())
        return reply(200, { removed: id })
      }
    }

    // --- threads ---
    if (parts[0] === "threads") {
      if (m === "POST" && parts.length === 1) {
        const project = store.project(String(body["projectId"] ?? ""))
        if (!project) return error(400, "pick a project for the thread")
        return reply(201, threads.create(project, choices(body)))
      }
      const thread = parts[1] ? store.thread(parts[1]) : undefined
      if (!thread) return error(404, "no such thread")
      if (m === "GET" && parts.length === 2) return reply(200, thread)
      if (m === "PATCH" && parts.length === 2) {
        if (threads.isRunning(thread.id) && (body["provider"] || body["model"])) return error(409, "wait for the turn to end before switching models")
        threads.update(thread, { ...(typeof body["title"] === "string" ? { title: body["title"] } : {}), ...choices(body) })
        return reply(200, metaOf(thread))
      }
      if (m === "DELETE" && parts.length === 2) {
        threads.stop(thread.id)
        removeAttachments(store.home, thread)
        store.deleteThread(thread.id)
        hub.send("threads", store.threads())
        return reply(200, { removed: thread.id })
      }
      if (m === "POST" && parts[2] === "messages") {
        const text = typeof body["text"] === "string" ? body["text"].trim() : ""
        if (!text) return error(400, "write a message first")
        // The files are the ones the text marks; each must have been uploaded.
        const attachments: Array<Attachment> = []
        for (const id of markersIn(text)) {
          const a = findAttachment(store.home, id)
          if (!a) return error(400, "an attached file is gone; attach it again")
          attachments.push(a)
        }
        if (threads.isRunning(thread.id)) return error(409, "this thread is still working; stop it or wait")
        const project = store.project(thread.projectId)
        if (!project) return error(409, "this thread's project was removed")
        const status = (await providers())[thread.provider]
        if (!status?.available) return error(409, `${PROVIDERS[thread.provider].label} isn't available: ${status?.detail ?? "unknown"}`)
        // Compact first: asked by the page's toggle, and only when the context is filling or the thread sat idle an hour.
        const compactFirst = body["compact"] === true && compactionOffered(thread)
        runtime.runFork(threads.turn(thread, project, text, attachments, { compactFirst }))
        return reply(202, { started: true })
      }
      // --- the thread's git: its branch, working tree, commits, and its pull request ---
      if (parts[2] === "git") {
        const project = store.project(thread.projectId)
        if (!project) return error(409, "this thread's project was removed")
        if (m === "GET" && parts.length === 3) return reply(200, await gitView(project.path, thread.branch))
        if (m === "POST" && parts[3] && parts.length === 4) {
          const action = parseAction(parts[3], body)
          if (typeof action === "string") return error(400, action)
          const done = await runAction(project.path, action)
          return done.ok ? reply(200, done) : error(502, done.error)
        }
      }
      if (m === "POST" && parts[2] === "stop") return threads.stop(thread.id) ? reply(202, { stopping: true }) : error(409, "this thread isn't working")
      if (m === "POST" && parts[2] === "permissions" && parts[3]) {
        return threads.answer(thread.id, parts[3], body["allow"] === true)
          ? reply(200, { answered: true })
          : error(409, "that request was already answered or the turn ended")
      }
    }

    // --- zero's evolution ---
    if (parts[0] === "zero") {
      if (m === "GET" && parts[1] === "state") return reply(200, await runtime.runPromise(evolution.state))
      if (m === "POST" && parts[1] === "jobs" && parts.length === 2) {
        const r = await runtime.runPromise(evolution.request(body))
        return reply(r.status, r.body)
      }
      if (m === "POST" && parts[1] === "jobs" && parts[2] === "stop") return evolution.stop() ? reply(202, { stopping: true }) : error(409, "nothing is running")
      if (m === "POST" && parts[1] === "discard") {
        const r = await runtime.runPromise(evolution.discard)
        return reply(r.status, r.body)
      }
    }

    return error(404, "not found")
  }

  return {
    call: async (method, path, body) => {
      try {
        const b = body && typeof body === "object" && !Array.isArray(body) ? (body as Record<string, unknown>) : {}
        return await route(method, path.split("/").filter(Boolean), b)
      } catch (e) {
        return error(500, String(e instanceof Error ? e.message : e))
      }
    },
    upload: (name, mime, bytes) => {
      if (bytes.byteLength > MAX_ATTACHMENT_BYTES) return error(413, TOO_BIG)
      if (bytes.byteLength === 0) return error(400, "that file is empty")
      return reply(201, saveAttachment(store.home, name, mime, Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength)))
    },
    attachment: (id) => findAttachment(store.home, id),
    subscribe: (listener) => {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    close: async () => {
      evolution.stop()
      threads.stopAll()
      // A moment for the aborted sessions to end their child processes.
      await new Promise((resolve) => setTimeout(resolve, 300))
      await runtime.dispose()
    }
  }
}
