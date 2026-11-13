/**
 * The control plane's backend, with no transport in it: `call` answers one
 * request from the page, `upload` and `attachment` handle files, and
 * `subscribe` hands out the live events. src/desktop/main.ts wires it to the
 * window over IPC, and src/app/Remote.ts to other devices over HTTP; tests can
 * call it directly.
 */
import * as NodeServices from "@effect/platform-node/NodeServices"
import { Effect, Layer, ManagedRuntime } from "effect"
import * as Singularity from "../Singularity.ts"
import { type Attachment, findAttachment, markersIn, MAX_ATTACHMENT_BYTES, removeAttachments, saveAttachment } from "./Attachments.ts"
import { makeEvolution } from "./Evolution.ts"
import { createBranch, createWorktree, initRepo, listBranches, samePath, switchBranch, worktreeOf } from "./Branches.ts"
import { fileDiff, gitView, listFiles, parseAction, pendingChange, runAction } from "./GitInfo.ts"
import { commitMessage, loadClaudeModels, relistClaudeModels } from "./providers/Claude.ts"
import { UPDATABLE, type Updatable, update, versions } from "./ProviderUpdates.ts"
import { type Access, ACCESSES, compactionOffered, metaOf, type Project, type ProviderId, type Settings } from "./Model.ts"
import * as StoreModule from "./Store.ts"
import { Store } from "./Store.ts"
import { dirOf, gitDirOf, type Hub, makeThreads, PROVIDERS, worktreeRoot } from "./Threads.ts"

export interface ApiOptions {
  /** zero's own repo: its genome, benchmark and ledger. */
  readonly root: string
  /** zero's CLI, which evolution runs start. */
  readonly cli: string
  /** Why evolution runs can't start yet, or undefined. */
  readonly blocked?: (() => string | undefined) | undefined
  /** Ask Claude Code which models it offers, once at the start (it starts a session that sends nothing). */
  readonly listModels?: boolean | undefined
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
  /** The settings as saved now; a change is also sent to subscribers as a `settings` event. */
  readonly settings: () => Settings
  readonly subscribe: (listener: Listener) => () => void
  /** What's still working: threads with a turn going, and whether an evolution run is. */
  readonly busy: () => { readonly threads: number; readonly evolution: boolean }
  /** Stops running turns and evolution runs, then frees the runtime. */
  readonly close: () => Promise<void>
}

const isProvider = (x: unknown): x is ProviderId => x === "claude" || x === "codex" || x === "ollama"
const isUpdatable = (x: unknown): x is Updatable => (UPDATABLE as ReadonlyArray<unknown>).includes(x)
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

export const makeApi = async ({ root, cli, blocked, listModels = false }: ApiOptions): Promise<Api> => {
  const runtime = ManagedRuntime.make(
    Layer.mergeAll(Singularity.layer, StoreModule.layer()).pipe(Layer.provideMerge(NodeServices.layer))
  )
  const listeners = new Set<Listener>()
  const hub: Hub = { send: (event, data) => { for (const l of listeners) l(event, data) } }
  const evolution = makeEvolution({ root, cli, hub, blocked })
  const { store, threads } = await runtime.runPromise(Effect.gen(function*() {
    const store = yield* Store
    // zero is a project from the start: the place to talk about zero itself.
    if (store.projects().length === 0) yield* store.addProject(root, "zero")
    return { store, threads: yield* makeThreads({ zeroRoot: root, hub }) }
  }))
  runtime.runFork(evolution.warm)

  const providers = async () => {
    const s = store.settings()
    const entries = await Promise.all(Object.values(PROVIDERS).map(async (p) => [p.id, { label: p.label, compaction: p.compaction, ...(await p.status(s)) }] as const))
    return Object.fromEntries(entries)
  }
  // Every model Claude Code offers joins the menus once it has said which; until then, the built-in few.
  if (listModels && store.settings().claude.enabled) {
    void loadClaudeModels().then(async (loaded) => { if (loaded) hub.send("providers", await providers()) })
  }

  /** Whether a thread is working in `dir` now: a branch switch there would pull the floor from under it. */
  const workingIn = (project: Project, dir: string) =>
    store.threads().some((m) => m.projectId === project.id && threads.isRunning(m.id) && (samePath(dirOf(m, project), dir) || samePath(gitDirOf(m, project), dir)))
  /** Switch the folder `dir` to the branch named in `body`, or create it when `body["create"]` is true; the thread (if any) follows it in its Git panel. */
  const switchIn = async (project: Project, dir: string, body: Record<string, unknown>): Promise<Reply | string> => {
    if (workingIn(project, dir)) return error(409, "a thread is working in this folder; wait for it, or stop it, before switching branches")
    const branch = typeof body["branch"] === "string" ? body["branch"] : ""
    const done = body["create"] === true
      ? await createBranch(dir, { branch, base: typeof body["base"] === "string" ? body["base"] : "" })
      : await switchBranch(dir, branch)
    return done.ok ? done.branch : error(409, done.error)
  }

  const route = async (m: string, parts: ReadonlyArray<string>, body: Record<string, unknown>): Promise<Reply> => {
    // --- everything a page needs to start ---
    // Threads whose title or messages match: GET search/<the words, URI-encoded>.
    if (m === "GET" && parts[0] === "search") return reply(200, store.search(decodeURIComponent(parts[1] ?? "")))
    if (m === "GET" && parts[0] === "bootstrap") {
      return reply(200, { settings: store.settings(), projects: store.projects(), threads: store.threads(), providers: await providers(), home: store.home, zeroRoot: root, limits: threads.limits() })
    }
    // Claude Code's and Codex's versions, and the newest out: GET providers/versions (fresh: GET providers/versions/fresh).
    if (m === "GET" && parts[0] === "providers" && parts[1] === "versions") return reply(200, await versions(parts[2] === "fresh"))
    // Install the newest beside zero; sessions started from now on run it.
    if (m === "POST" && parts[0] === "providers" && isUpdatable(parts[1]) && parts[2] === "update") {
      const id = parts[1]
      const done = await update(id).then((v) => v, (e: unknown) => e instanceof Error ? e.message : String(e))
      if (typeof done === "string") return error(502, done)
      // A newer Claude Code may offer newer models: the menus take them once it has said.
      if (id === "claude" && listModels) void relistClaudeModels().then(async (loaded) => { if (loaded) hub.send("providers", await providers()) })
      return reply(200, { [id]: done })
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
        const name = typeof body["name"] === "string" ? body["name"] : undefined
        const added = await runtime.runPromise(store.addProject(body["path"], name, body["create"] === true).pipe(Effect.result))
        if (added._tag === "Failure") return error(400, added.failure.message)
        hub.send("projects", store.projects())
        if (body["git"] !== true) return reply(201, added.success)
        // The project stands either way; a failed `git init` is said, not a reason to take it back.
        const git = await initRepo(added.success.path)
        return reply(201, { ...added.success, git: git.ok ? (git.made ? "initialized" : "already") : { error: git.error } })
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
      // The project folder's branches, for a new thread's branch menu; switching one switches the folder.
      const project = id ? store.project(id) : undefined
      if (project && m === "GET" && parts[2] === "branches") return reply(200, await listBranches(project.path))
      // The project's files, for @ in a new thread's composer.
      if (project && m === "GET" && parts[2] === "files") return reply(200, await listFiles(project.path))
      if (project && m === "POST" && parts[2] === "branch") {
        const switched = await switchIn(project, project.path, body)
        if (typeof switched !== "string") return switched
        // The threads working in the project's folder are on this branch now: their Git panels follow.
        for (const meta of store.threads()) {
          if (meta.projectId !== project.id || meta.cwd || meta.workTree || meta.branch === switched) continue
          // Not activity: each keeps its place in the sidebar. Its items aren't read for it.
          const next = store.patchThread(meta.id, { branch: switched })
          if (next) hub.send("thread", next)
        }
        return reply(200, { branch: switched })
      }
    }

    // --- threads ---
    if (parts[0] === "threads") {
      if (m === "POST" && parts.length === 1) {
        const project = store.project(String(body["projectId"] ?? ""))
        if (!project) return error(400, "pick a project for the thread")
        // A new worktree for the thread to work in, on a new branch from the base the person picked.
        const w = body["worktree"]
        if (w && typeof w === "object") {
          const { base = "", branch = "", join } = w as Record<string, unknown>
          // Into the worktree where a branch is already checked out: no new folder.
          if (typeof join === "string") {
            const found = await worktreeOf(project.path, join)
            if (!found.ok) return error(400, found.error)
            return reply(201, threads.create(project, { ...choices(body), cwd: found.path, branch: found.branch }))
          }
          const made = await createWorktree(project.path, { base: String(base), branch: String(branch), root: worktreeRoot(store.home, project) })
          if (!made.ok) return error(400, made.error)
          return reply(201, threads.create(project, { ...choices(body), cwd: made.path, branch: made.branch }))
        }
        return reply(201, threads.create(project, choices(body)))
      }
      const thread = parts[1] ? store.thread(parts[1]) : undefined
      if (!thread) return error(404, "no such thread")
      if (m === "GET" && parts.length === 2) return reply(200, thread)
      if (m === "PATCH" && parts.length === 2) {
        if (threads.isRunning(thread.id) && (body["provider"] || body["model"])) return error(409, "wait for the turn to end before switching models")
        threads.update(thread, {
          ...(typeof body["title"] === "string" ? { title: body["title"] } : {}),
          ...(typeof body["pinned"] === "boolean" ? { pinned: body["pinned"] } : {}),
          ...(body["seen"] === true ? { seen: true } : {}),
          ...choices(body)
        })
        return reply(200, metaOf(thread))
      }
      if (m === "DELETE" && parts.length === 2) {
        threads.stop(thread.id)
        removeAttachments(store.home, thread)
        store.deleteThread(thread.id)
        threads.forget(thread.id)
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
        // Sent while the thread works: it waits, and runs when the turn ends.
        if (threads.isRunning(thread.id)) {
          threads.enqueue(thread, text, attachments)
          return reply(202, { queued: true })
        }
        const project = store.project(thread.projectId)
        if (!project) return error(409, "this thread's project was removed")
        const status = (await providers())[thread.provider]
        if (!status?.available) return error(409, `${PROVIDERS[thread.provider].label} isn't available: ${status?.detail ?? "unknown"}`)
        // Compact first: asked by the page's toggle, and only when the context is filling or the thread sat idle an hour.
        const compactFirst = body["compact"] === true && compactionOffered(thread)
        runtime.runFork(threads.turn(thread, project, text, attachments, { compactFirst }))
        return reply(202, { started: true })
      }
      // Take back a message waiting for the turn to end: DELETE threads/<id>/queue/<its id>. The answer is the
      // message, its words and its files, for the page to put back in the composer.
      if (m === "DELETE" && parts[2] === "queue" && parts[3]) {
        const back = threads.unqueue(thread, parts[3])
        if (!back) return error(409, "that message already ran")
        return reply(200, { text: back.text, attachments: back.attachments.map(({ id, name, mime, size }) => ({ id, name, mime, size })) })
      }
      // The slash commands its session takes, for / in its composer.
      if (m === "GET" && parts[2] === "commands") return reply(200, threads.commands(thread.id))
      // The files where the thread works, for @ in its composer.
      if (m === "GET" && parts[2] === "files") {
        const project = store.project(thread.projectId)
        if (!project) return error(409, "this thread's project was removed")
        return reply(200, await listFiles(gitDirOf(thread, project)))
      }
      // --- the thread's git: its branch, working tree, commits, and its pull request ---
      // --- the thread's branch, from its composer: switch it, or move the thread to a new worktree ---
      if (parts[2] === "branches" || parts[2] === "branch" || parts[2] === "worktree") {
        const project = store.project(thread.projectId)
        if (!project) return error(409, "this thread's project was removed")
        // The checkout the thread follows: the worktree its agent moved to, else where it works.
        const dir = gitDirOf(thread, project)
        if (m === "GET" && parts[2] === "branches") return reply(200, { ...(await listBranches(dir)), cwd: dir, project: project.path })
        if (threads.isRunning(thread.id)) return error(409, "wait for the turn to end before changing this thread's branch")
        if (m === "POST" && parts[2] === "branch") {
          const switched = await switchIn(project, dir, body)
          if (typeof switched !== "string") return switched
          threads.moveTo(thread, thread.cwd, switched, thread.workTree)
          return reply(200, metaOf(thread))
        }
        if (m === "POST" && parts[2] === "worktree") {
          // Back to the project's own folder, on whatever branch it has.
          if (body["leave"] === true) {
            const current = (await listBranches(project.path)).current
            threads.moveTo(thread, undefined, current)
            return reply(200, metaOf(thread))
          }
          // Into the worktree where a branch is already checked out.
          if (typeof body["join"] === "string") {
            const found = await worktreeOf(dir, body["join"])
            if (!found.ok) return error(400, found.error)
            threads.moveTo(thread, samePath(found.path, project.path) ? undefined : found.path, found.branch)
            return reply(200, metaOf(thread))
          }
          const made = await createWorktree(dir, {
            base: typeof body["base"] === "string" ? body["base"] : "",
            branch: typeof body["branch"] === "string" ? body["branch"] : "",
            root: worktreeRoot(store.home, project)
          })
          if (!made.ok) return error(400, made.error)
          threads.moveTo(thread, made.path, made.branch)
          return reply(200, metaOf(thread))
        }
      }
      if (parts[2] === "git") {
        const project = store.project(thread.projectId)
        if (!project) return error(409, "this thread's project was removed")
        const dir = gitDirOf(thread, project)
        if (m === "GET" && parts.length === 3) {
          // The thread's own pull request, by its URL, while the thread is on the branch it was opened from.
          const linked = thread.pr && thread.pr.branch === thread.branch ? thread.pr.url : undefined
          const view = await gitView(dir, thread.branch, undefined, linked)
          // Found (or opened from the panel): the thread is linked to it, and the sidebar shows how it stands.
          if (view.pr && view.gh.ok) threads.linkPr(thread, { number: view.pr.number, url: view.pr.url, branch: view.branch, state: view.pr.state === "OPEN" && view.pr.isDraft ? "DRAFT" : view.pr.state })
          return reply(200, { ...view, cwd: dir, worktree: !samePath(dir, project.path) })
        }
        // One changed file's diff, for the panel's file list.
        if (m === "GET" && parts[3] === "diff" && parts[4] && parts.length === 5) {
          const diff = await fileDiff(dir, decodeURIComponent(parts[4]))
          return diff === undefined ? error(404, "that file has no uncommitted change") : reply(200, { diff })
        }
        // A commit message for what's uncommitted, from the small model that names threads.
        if (m === "POST" && parts[3] === "message" && parts.length === 4) {
          const s = store.settings()
          if (!s.claude.enabled) return error(409, "a commit message needs Claude, which is turned off in settings")
          const change = await pendingChange(dir)
          if (!change) return error(409, "there's nothing to commit")
          const message = await commitMessage(change, s.titles.model)
          return message ? reply(200, { message }) : error(502, "the model didn't answer; write the message yourself")
        }
        if (m === "POST" && parts[3] && parts.length === 4) {
          const action = parseAction(parts[3], body)
          if (typeof action === "string") return error(400, action)
          // A pull moves the files under a working agent: wait for it.
          if (action.kind === "pull" && workingIn(project, dir)) return error(409, "a thread is working in this folder; wait for it, or stop it, before pulling")
          const done = await runAction(dir, action)
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
    settings: () => store.settings(),
    subscribe: (listener) => {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    busy: () => ({ threads: threads.running(), evolution: evolution.running() }),
    close: async () => {
      evolution.stop()
      threads.stopAll()
      threads.closeAll()
      // A moment for the ended sessions to end their child processes.
      await new Promise((resolve) => setTimeout(resolve, 300))
      await runtime.dispose()
    }
  }
}
