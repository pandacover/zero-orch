/**
 * The control plane's server: the page in `ui/`, a JSON API, and one stream
 * of server-sent events every open page listens to.
 *
 * It listens on loopback only, refuses a Host header that isn't loopback (no
 * DNS rebinding), and wants the token it minted at startup on every API call;
 * the page it serves carries that token.
 */
import * as NodeServices from "@effect/platform-node/NodeServices"
import { Effect, Layer, ManagedRuntime } from "effect"
import { randomBytes } from "node:crypto"
import { createReadStream } from "node:fs"
import { readFile } from "node:fs/promises"
import { createServer, type IncomingMessage, type ServerResponse } from "node:http"
import { extname, join } from "node:path"
import * as Singularity from "../Singularity.ts"
import { type Attachment, findAttachment, isInlineImage, markersIn, MAX_ATTACHMENT_BYTES, removeAttachments, saveAttachment } from "./Attachments.ts"
import { makeEvolution } from "./Evolution.ts"
import { type Access, ACCESSES, compactionOffered, metaOf, type ProviderId } from "./Model.ts"
import * as StoreModule from "./Store.ts"
import { Store } from "./Store.ts"
import { type Hub, makeThreads, PROVIDERS } from "./Threads.ts"

export interface ServerOptions {
  /** zero's own repo: its genome, benchmark and ledger. */
  readonly root: string
  /** zero's CLI, which evolution runs start. */
  readonly cli: string
  readonly port: number
}

const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml"
}

const isProvider = (x: unknown): x is ProviderId => x === "claude" || x === "codex" || x === "ollama"
const isAccess = (x: unknown): x is Access => (ACCESSES as ReadonlyArray<unknown>).includes(x)

export const startServer = (options: ServerOptions) =>
  Effect.callback<never>(() => {
    const { root, cli, port } = options
    const token = randomBytes(18).toString("base64url")
    const runtime = ManagedRuntime.make(
      Layer.mergeAll(Singularity.layer, StoreModule.layer()).pipe(Layer.provideMerge(NodeServices.layer))
    )

    const listeners = new Set<ServerResponse>()
    const hub: Hub = {
      send: (event, data) => {
        const frame = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`
        for (const res of listeners) res.write(frame)
      }
    }
    const evolution = makeEvolution({ root, cli, hub })
    const ready = runtime.runPromise(Effect.gen(function*() {
      const store = yield* Store
      // zero is a project from the start: the place to talk about zero itself.
      if (store.projects().length === 0) yield* store.addProject(root, "zero")
      return { store, threads: yield* makeThreads({ zeroRoot: root, hub }) }
    }))

    const json = (res: ServerResponse, status: number, body: unknown) => {
      res.writeHead(status, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" })
      res.end(JSON.stringify(body))
    }
    const readBody = (req: IncomingMessage) =>
      new Promise<Record<string, unknown> | undefined>((resolve) => {
        let data = ""
        req.on("data", (c) => (data.length < 256_000 ? (data += c) : req.destroy()))
        req.on("end", () => {
          try {
            const v = data ? JSON.parse(data) : {}
            resolve(v && typeof v === "object" ? v : undefined)
          } catch {
            resolve(undefined)
          }
        })
      })
    /** A body as bytes, or undefined once it passes `limit`. */
    const readRaw = (req: IncomingMessage, limit: number) =>
      new Promise<Buffer | undefined>((resolve) => {
        const chunks: Array<Buffer> = []
        let size = 0
        req.on("data", (c: Buffer) => {
          size += c.length
          if (size > limit) {
            resolve(undefined)
            req.destroy()
          } else chunks.push(c)
        })
        req.on("end", () => resolve(Buffer.concat(chunks)))
        req.on("error", () => resolve(undefined))
      })
    const providers = async () => {
      const { store } = await ready
      const s = store.settings()
      const entries = await Promise.all(Object.values(PROVIDERS).map(async (p) => [p.id, { label: p.label, compaction: p.compaction, ...(await p.status(s)) }] as const))
      return Object.fromEntries(entries)
    }

    const server = createServer(async (req, res) => {
      try {
        const url = new URL(req.url ?? "/", `http://127.0.0.1:${port}`)
        const host = (req.headers.host ?? "").replace(/:\d+$/, "")
        if (host !== "127.0.0.1" && host !== "localhost") return json(res, 403, { error: "loopback only" })

        if (!url.pathname.startsWith("/api/")) {
          const file = url.pathname === "/" ? "index.html" : url.pathname.slice(1)
          if (!/^[\w.-]+$/.test(file)) return json(res, 404, { error: "not found" })
          const body = await readFile(join(root, "ui", file), "utf8").catch(() => undefined)
          if (body === undefined) return json(res, 404, { error: "not found" })
          res.writeHead(200, { "content-type": MIME[extname(file)] ?? "text/plain", "cache-control": "no-store" })
          return res.end(file === "index.html" ? body.replace("__ZERO_TOKEN__", token) : body)
        }

        if ((req.headers["x-zero-token"] ?? url.searchParams.get("token")) !== token) {
          return json(res, 401, { error: "this page is from an earlier run of the server; reload it" })
        }
        const { store, threads } = await ready
        const parts = url.pathname.split("/").slice(2) // after /api/
        const m = req.method ?? "GET"

        // --- attachments: the file itself is the body, so this comes before the JSON is read ---
        if (parts[0] === "attachments") {
          if (m === "POST" && parts.length === 1) {
            const size = Number(req.headers["content-length"] ?? 0)
            if (size > MAX_ATTACHMENT_BYTES) return json(res, 413, { error: `files up to ${MAX_ATTACHMENT_BYTES / 1024 / 1024} MB attach` })
            const bytes = await readRaw(req, MAX_ATTACHMENT_BYTES)
            if (bytes === undefined) return json(res, 413, { error: `files up to ${MAX_ATTACHMENT_BYTES / 1024 / 1024} MB attach` })
            if (bytes.length === 0) return json(res, 400, { error: "that file is empty" })
            let name = ""
            try {
              name = decodeURIComponent(String(req.headers["x-file-name"] ?? ""))
            } catch {}
            const saved = saveAttachment(store.home, name, String(req.headers["content-type"] ?? ""), bytes)
            return json(res, 201, saved)
          }
          if (m === "GET" && parts[1] && parts.length === 2) {
            const a = findAttachment(store.home, parts[1])
            if (!a) return json(res, 404, { error: "no such file" })
            const inline = isInlineImage(a.mime)
            res.writeHead(200, {
              "content-type": inline ? a.mime : "application/octet-stream",
              "content-length": String(a.size),
              "cache-control": "private, max-age=86400",
              "x-content-type-options": "nosniff",
              // A file someone pasted is shown, never run: it shares this page's origin and its token.
              "content-security-policy": "default-src 'none'; img-src 'self'; style-src 'unsafe-inline'; sandbox",
              "content-disposition": `${inline ? "inline" : "attachment"}; filename*=UTF-8''${encodeURIComponent(a.name)}`
            })
            return createReadStream(a.path).pipe(res)
          }
          return json(res, 404, { error: "not found" })
        }

        const body = m === "GET" ? {} : await readBody(req)
        if (body === undefined) return json(res, 400, { error: "the request body isn't JSON" })

        // --- events ---
        if (m === "GET" && parts[0] === "events") {
          res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-store", connection: "keep-alive" })
          res.write(": connected\n\n")
          listeners.add(res)
          const ping = setInterval(() => res.write(": ping\n\n"), 20_000)
          req.on("close", () => {
            clearInterval(ping)
            listeners.delete(res)
          })
          return
        }

        // --- everything a page needs to start ---
        if (m === "GET" && parts[0] === "bootstrap") {
          return json(res, 200, {
            settings: store.settings(),
            projects: store.projects(),
            threads: store.threads(),
            providers: await providers(),
            home: store.home,
            zeroRoot: root
          })
        }
        if (m === "GET" && parts[0] === "providers") return json(res, 200, await providers())

        // --- settings ---
        if (m === "PUT" && parts[0] === "settings") {
          const saved = await runtime.runPromise(store.saveSettings(body).pipe(Effect.result))
          if (saved._tag === "Failure") return json(res, 400, { error: saved.failure.message })
          hub.send("settings", saved.success)
          return json(res, 200, { settings: saved.success, providers: await providers() })
        }

        // --- projects ---
        if (parts[0] === "projects") {
          if (m === "POST" && parts.length === 1) {
            if (typeof body["path"] !== "string" || !body["path"].trim()) return json(res, 400, { error: "give the project's folder path" })
            const added = await runtime.runPromise(store.addProject(body["path"], typeof body["name"] === "string" ? body["name"] : undefined).pipe(Effect.result))
            if (added._tag === "Failure") return json(res, 400, { error: added.failure.message })
            hub.send("projects", store.projects())
            return json(res, 201, added.success)
          }
          if (m === "DELETE" && parts[1]) {
            if (store.threads().some((t) => t.projectId === parts[1] && threads.isRunning(t.id))) return json(res, 409, { error: "stop this project's running threads first" })
            for (const t of store.threads()) if (t.projectId === parts[1]) removeAttachments(store.home, store.thread(t.id))
            await runtime.runPromise(store.removeProject(parts[1]))
            hub.send("projects", store.projects())
            hub.send("threads", store.threads())
            return json(res, 200, { removed: parts[1] })
          }
        }

        // --- threads ---
        if (parts[0] === "threads") {
          if (m === "POST" && parts.length === 1) {
            const project = store.project(String(body["projectId"] ?? ""))
            if (!project) return json(res, 400, { error: "pick a project for the thread" })
            const thread = threads.create(project, {
              ...(isProvider(body["provider"]) ? { provider: body["provider"] } : {}),
              ...(typeof body["model"] === "string" ? { model: body["model"] } : {}),
              ...(isAccess(body["access"]) ? { access: body["access"] } : {}),
              ...(typeof body["effort"] === "string" ? { effort: body["effort"] } : {})
            })
            return json(res, 201, thread)
          }
          const thread = parts[1] ? store.thread(parts[1]) : undefined
          if (!thread) return json(res, 404, { error: "no such thread" })
          if (m === "GET" && parts.length === 2) return json(res, 200, thread)
          if (m === "PATCH" && parts.length === 2) {
            if (threads.isRunning(thread.id) && (body["provider"] || body["model"])) return json(res, 409, { error: "wait for the turn to end before switching models" })
            threads.update(thread, {
              ...(typeof body["title"] === "string" ? { title: body["title"] } : {}),
              ...(isProvider(body["provider"]) ? { provider: body["provider"] } : {}),
              ...(typeof body["model"] === "string" ? { model: body["model"] } : {}),
              ...(isAccess(body["access"]) ? { access: body["access"] } : {}),
              ...(typeof body["effort"] === "string" ? { effort: body["effort"] } : {})
            })
            return json(res, 200, metaOf(thread))
          }
          if (m === "DELETE" && parts.length === 2) {
            threads.stop(thread.id)
            removeAttachments(store.home, thread)
            store.deleteThread(thread.id)
            hub.send("threads", store.threads())
            return json(res, 200, { removed: thread.id })
          }
          if (m === "POST" && parts[2] === "messages") {
            const text = typeof body["text"] === "string" ? body["text"].trim() : ""
            if (!text) return json(res, 400, { error: "write a message first" })
            // The files are the ones the text marks; each must have been uploaded.
            const attachments: Array<Attachment> = []
            for (const id of markersIn(text)) {
              const a = findAttachment(store.home, id)
              if (!a) return json(res, 400, { error: "an attached file is gone; attach it again" })
              attachments.push(a)
            }
            if (threads.isRunning(thread.id)) return json(res, 409, { error: "this thread is still working; stop it or wait" })
            const project = store.project(thread.projectId)
            if (!project) return json(res, 409, { error: "this thread's project was removed" })
            const status = (await providers())[thread.provider]
            if (!status?.available) return json(res, 409, { error: `${PROVIDERS[thread.provider].label} isn't available: ${status?.detail ?? "unknown"}` })
            // Compact first: asked by the page's toggle, and only when the context is filling or the thread sat idle an hour.
            const compactFirst = body["compact"] === true && compactionOffered(thread)
            runtime.runFork(threads.turn(thread, project, text, attachments, { compactFirst }))
            return json(res, 202, { started: true })
          }
          if (m === "POST" && parts[2] === "stop") return threads.stop(thread.id) ? json(res, 202, { stopping: true }) : json(res, 409, { error: "this thread isn't working" })
          if (m === "POST" && parts[2] === "permissions" && parts[3]) {
            return threads.answer(thread.id, parts[3], body["allow"] === true)
              ? json(res, 200, { answered: true })
              : json(res, 409, { error: "that request was already answered or the turn ended" })
          }
        }

        // --- zero's evolution ---
        if (parts[0] === "zero") {
          if (m === "GET" && parts[1] === "state") return json(res, 200, await runtime.runPromise(evolution.state))
          if (m === "POST" && parts[1] === "jobs" && parts.length === 2) {
            const r = await runtime.runPromise(evolution.request(body))
            return json(res, r.status, r.body)
          }
          if (m === "POST" && parts[1] === "jobs" && parts[2] === "stop") return evolution.stop() ? json(res, 202, { stopping: true }) : json(res, 409, { error: "nothing is running" })
          if (m === "POST" && parts[1] === "discard") {
            const r = await runtime.runPromise(evolution.discard)
            return json(res, r.status, r.body)
          }
        }

        return json(res, 404, { error: "not found" })
      } catch (e) {
        return json(res, 500, { error: String(e instanceof Error ? e.message : e) })
      }
    })

    ready.then(
      () =>
        server.listen(port, "127.0.0.1", () => {
          console.log(`zero control plane: http://127.0.0.1:${port}`)
          console.log("Ctrl+C to quit (running turns and runs stop with it)")
        }),
      (e) => {
        console.error(`error: can't open the control plane's files: ${e}`)
        process.exit(2)
      }
    )
    server.on("error", (e) => {
      console.error(`error: can't listen on 127.0.0.1:${port}: ${e.message}`)
      process.exit(2)
    })
    const quit = () => {
      evolution.stop()
      ready.then(({ threads }) => threads.stopAll()).finally(() => setTimeout(() => process.exit(0), 300))
    }
    process.once("SIGINT", quit)
    process.once("SIGTERM", quit)

    return Effect.sync(() => {
      evolution.stop()
      server.close()
      void runtime.dispose()
    })
  })
