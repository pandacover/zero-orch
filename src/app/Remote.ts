/**
 * Remote access: the control plane over HTTP, for a phone or another computer
 * on your tailnet. Off until Settings turns it on; it starts, moves and stops
 * as the `remote` settings change.
 *
 * It listens on 127.0.0.1 only. `tailscale serve --bg <port>` carries it to
 * the tailnet, over HTTPS, at this machine's name there. A device pairs once
 * with the code Settings shows (typed in, or in the link), and keeps it as a
 * cookie; a new code signs every device out. API calls also need an `x-zero`
 * header, which another site's page can't send without a preflight this
 * server never answers: no cross-site requests.
 *
 * The page is the same ui/ the desktop window shows: ui/web.js gives it the
 * `window.zero` that src/desktop/preload.cjs gives the window.
 */
import { execFile } from "node:child_process"
import { randomInt, timingSafeEqual } from "node:crypto"
import { createReadStream, readFileSync } from "node:fs"
import { readFile, writeFile } from "node:fs/promises"
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http"
import { extname, join } from "node:path"
import type { Api, Reply } from "./Api.ts"
import { isInlineImage, MAX_ATTACHMENT_BYTES } from "./Attachments.ts"
import type { Settings } from "./Model.ts"

export interface RemoteOptions {
  /** The page's files: zero's ui/ folder. */
  readonly ui: string
  /** Where the pairing code is kept (remote.json): zero's home, ~/.zero. */
  readonly home: string
  /** What Tailscale says of this machine; a stand-in in tests. */
  readonly tailnet?: (port: number) => Promise<Tailnet>
}

export interface Tailnet {
  /** The tailscale CLI answered. */
  readonly found: boolean
  /** Connected to a tailnet. */
  readonly running: boolean
  /** This machine's name on the tailnet, e.g. desk.tail1234.ts.net. */
  readonly host?: string
  /** Where `tailscale serve` already offers our port, e.g. https://desk.tail1234.ts.net/. */
  readonly url?: string
}

/** What Settings shows of remote access. */
export interface RemoteStatus {
  readonly enabled: boolean
  readonly port: number
  readonly listening: boolean
  /** Why it isn't listening though it's on (the port is taken). */
  readonly error?: string
  /** The pairing code, as a person types it: xxxx-xxxx-xxxx. */
  readonly code: string
  readonly local: string
  /** What makes it reachable from the tailnet. */
  readonly command: string
  readonly tailnet: Tailnet
}

/** No 0/o, 1/l/i: a code read off one screen and typed into another. 31^12, about 60 bits. */
const ALPHABET = "23456789abcdefghjkmnpqrstuvwxyz"
const CODE_LENGTH = 12
export const newCode = (): string => Array.from({ length: CODE_LENGTH }, () => ALPHABET[randomInt(ALPHABET.length)]).join("")
/** What a person typed, as the code is kept: case, spaces and dashes don't matter. */
export const normalizeCode = (typed: string): string => typed.toLowerCase().replace(/[^a-z0-9]/g, "")
export const showCode = (code: string): string => code.match(/.{1,4}/g)?.join("-") ?? code

const COOKIE = "zero_remote"
/** Wrong codes allowed a minute, from everyone together: guessing 60 bits at this rate never ends. */
const TRIES_PER_MINUTE = 10
const MAX_JSON_BYTES = 4 * 1024 * 1024

const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".woff2": "font/woff2",
  ".svg": "image/svg+xml"
}

/** Where `tailscale serve status --json` sends https traffic to 127.0.0.1:`port`, if anywhere. */
export const servedUrl = (serveJson: string, port: number): string | undefined => {
  let config: unknown
  try { config = JSON.parse(serveJson) } catch { return undefined }
  // The background config, and any foreground `tailscale serve` sessions (each a config of its own).
  const configs = [config, ...Object.values((config as { Foreground?: Record<string, unknown> })?.Foreground ?? {})]
  const ours = new RegExp(`^https?://(127\\.0\\.0\\.1|localhost|\\[::1\\]):${port}/?$`)
  for (const c of configs) {
    const web = (c as { Web?: Record<string, { Handlers?: Record<string, { Proxy?: string }> }> })?.Web ?? {}
    for (const [hostPort, site] of Object.entries(web)) {
      if (!ours.test(site.Handlers?.["/"]?.Proxy ?? "")) continue
      const [host, p] = hostPort.split(/:(?=\d+$)/)
      return `https://${host}${p && p !== "443" ? `:${p}` : ""}/`
    }
  }
  return undefined
}

const tailscale = (args: ReadonlyArray<string>) =>
  new Promise<string | undefined>((resolve) => {
    execFile("tailscale", args as Array<string>, { timeout: 4000, windowsHide: true }, (err, stdout) => resolve(err ? undefined : stdout))
  })

/** Ask the tailscale CLI about this machine; nothing found is an answer, not an error. */
export const askTailscale = async (port: number): Promise<Tailnet> => {
  const status = await tailscale(["status", "--json"])
  if (status === undefined) return { found: false, running: false }
  let running = false
  let host: string | undefined
  try {
    const s = JSON.parse(status) as { BackendState?: string; Self?: { DNSName?: string } }
    running = s.BackendState === "Running"
    host = s.Self?.DNSName?.replace(/\.$/, "") || undefined
  } catch {}
  const serve = running ? await tailscale(["serve", "status", "--json"]) : undefined
  const url = serve === undefined ? undefined : servedUrl(serve, port)
  return { found: true, running, ...(host ? { host } : {}), ...(url ? { url } : {}) }
}

const cookieOf = (req: IncomingMessage): string => {
  for (const part of (req.headers.cookie ?? "").split(";")) {
    const [k, ...v] = part.trim().split("=")
    if (k === COOKIE) return v.join("=")
  }
  return ""
}
const same = (a: string, b: string) => a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b))

/** Headers every answer carries: no framing, no sniffing. */
const BASE = { "x-frame-options": "DENY", "x-content-type-options": "nosniff", "referrer-policy": "no-referrer" }

const json = (res: ServerResponse, status: number, body: unknown) => {
  res.writeHead(status, { ...BASE, "content-type": "application/json; charset=utf-8", "cache-control": "no-store" })
  res.end(JSON.stringify(body))
}

/** A body's bytes, or undefined past `limit`. */
const readBody = (req: IncomingMessage, limit: number) =>
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

const escapeHtml = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`)

/** The one page an unpaired device gets: a field for the code. Plain HTML, no script. */
const pairPage = (message?: string) => `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Pair with zero</title>
<style>
  :root { color-scheme: light dark; --bg: #fff; --ink: #16171d; --muted: #6b6f7b; --line: #d9dbe1; --accent: #2156e0; }
  @media (prefers-color-scheme: dark) { :root { --bg: #0d0d0d; --ink: #ececf1; --muted: #9a9daa; --line: #2c2e36; --accent: #4f8dfb; } }
  body { margin: 0; min-height: 100dvh; display: grid; place-items: center; background: var(--bg); color: var(--ink); font: 16px/1.5 system-ui, sans-serif; }
  main { width: min(360px, 100% - 40px); }
  h1 { font-size: 26px; margin: 0 0 6px; letter-spacing: -0.02em; }
  p { color: var(--muted); margin: 0 0 18px; }
  input { box-sizing: border-box; width: 100%; padding: 12px 14px; border: 1px solid var(--line); border-radius: 12px; background: none; color: inherit; font: 500 20px/1.2 ui-monospace, monospace; letter-spacing: .08em; text-align: center; }
  button { width: 100%; margin-top: 12px; padding: 12px; border: 0; border-radius: 12px; background: var(--accent); color: #fff; font: 600 16px/1 system-ui, sans-serif; }
  .err { color: #d4473b; }
</style></head>
<body><main>
  <h1>Pair with zero</h1>
  <p>Type the code from zero on your computer: Settings, then Remote access. You pair once; this browser stays paired.</p>
  ${message ? `<p class="err" role="alert">${escapeHtml(message)}</p>` : ""}
  <form method="post" action="/pair">
    <input name="code" aria-label="Pairing code" placeholder="xxxx-xxxx-xxxx" autocomplete="one-time-code" autocapitalize="none" autocorrect="off" spellcheck="false" required autofocus>
    <button type="submit">Pair</button>
  </form>
</main></body></html>`

/**
 * `api`, with remote access around it: its `call` also answers `GET remote`
 * (a RemoteStatus) and `POST remote/code` (a new code, every device signed
 * out), and its `close` stops the server too.
 */
export const withRemote = async (api: Api, { ui, home, tailnet = askTailscale }: RemoteOptions): Promise<Api> => {
  const file = join(home, "remote.json")
  const loadCode = () => {
    try {
      const c = normalizeCode(String((JSON.parse(readFileSync(file, "utf8")) as { code?: unknown }).code ?? ""))
      if (c.length === CODE_LENGTH) return c
    } catch {}
    return undefined
  }
  const saveCode = async (c: string) => writeFile(file, JSON.stringify({ code: c }, null, 2))
  let code = loadCode() ?? newCode()
  await saveCode(code)

  let server: Server | undefined
  let on: Settings["remote"] = { enabled: false, port: 0 }
  let error: string | undefined
  const streams = new Set<ServerResponse>()
  const failures: Array<number> = []

  const pair = async (req: IncomingMessage, res: ServerResponse, url: URL) => {
    let typed = url.searchParams.get("code") ?? ""
    if (req.method === "POST") typed = new URLSearchParams((await readBody(req, 4096))?.toString("utf8") ?? "").get("code") ?? ""
    const now = Date.now()
    while (failures.length && failures[0]! < now - 60_000) failures.shift()
    const page = (status: number, message?: string) => {
      res.writeHead(status, { ...BASE, "content-type": "text/html; charset=utf-8", "cache-control": "no-store", "content-security-policy": "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'" })
      res.end(pairPage(message))
    }
    if (!typed && same(cookieOf(req), code)) {
      res.writeHead(303, { ...BASE, location: "/", "cache-control": "no-store" })
      return res.end()
    }
    if (!typed) return page(200)
    if (failures.length >= TRIES_PER_MINUTE) return page(429, "Too many wrong codes. Wait a minute, then try again.")
    if (!same(normalizeCode(typed), code)) {
      failures.push(now)
      return page(401, "That code isn't the one zero shows. Check it and try again.")
    }
    const secure = req.headers["x-forwarded-proto"] === "https" ? "; Secure" : ""
    // A year; Lax so a link to zero from another app still arrives signed in.
    res.writeHead(303, { ...BASE, location: "/", "cache-control": "no-store", "set-cookie": `${COOKIE}=${code}; Path=/; Max-Age=31536000; HttpOnly; SameSite=Lax${secure}` })
    res.end()
  }

  const events = (res: ServerResponse) => {
    res.writeHead(200, { ...BASE, "content-type": "text/event-stream", "cache-control": "no-store", "x-accel-buffering": "no" })
    res.write(": connected\n\n")
    streams.add(res)
    const off = api.subscribe((event, data) => res.write(`data: ${JSON.stringify({ event, data })}\n\n`))
    // Proxies and phones drop a quiet connection.
    const ping = setInterval(() => res.write(": ping\n\n"), 20_000)
    res.on("close", () => {
      clearInterval(ping)
      off()
      streams.delete(res)
    })
  }

  const handle = async (req: IncomingMessage, res: ServerResponse) => {
    const url = new URL(req.url ?? "/", "http://zero")
    const path = url.pathname
    const m = req.method ?? "GET"
    if (path === "/pair") return pair(req, res, url)
    if (!same(cookieOf(req), code)) {
      if (path.startsWith("/api/")) return json(res, 401, { error: "this device isn't paired with zero; reload to pair it" })
      if (path !== "/" && path !== "/index.html") return json(res, 404, { error: "not found" })
      return pair(req, res, url)
    }
    if (path.startsWith("/api/")) {
      const rest = path.slice("/api/".length)
      if (m === "GET" && rest === "ping") return json(res, 200, { ok: true })
      if (m === "GET" && rest === "events") return events(res)
      if (req.headers["x-zero"] !== "1") return json(res, 403, { error: "not from zero's page" })
      if (m === "POST" && rest === "attachments") {
        const bytes = await readBody(req, MAX_ATTACHMENT_BYTES)
        if (bytes === undefined) return json(res, 413, { error: `files up to ${MAX_ATTACHMENT_BYTES / 1024 / 1024} MB attach` })
        let name = ""
        try { name = decodeURIComponent(String(req.headers["x-file-name"] ?? "")) } catch {}
        const r = api.upload(name, String(req.headers["content-type"] ?? "application/octet-stream"), bytes)
        return json(res, r.status, r.body)
      }
      let body: unknown
      if (m !== "GET" && m !== "HEAD") {
        const raw = await readBody(req, MAX_JSON_BYTES)
        if (raw === undefined) return json(res, 413, { error: "that request is too big" })
        try { body = raw.length ? JSON.parse(raw.toString("utf8")) : undefined } catch { return json(res, 400, { error: "the request body isn't JSON" }) }
      }
      const r = await remote.call(m, rest, body)
      return json(res, r.status, r.body)
    }
    // An attachment: shown if it's an image, saved otherwise, never run.
    const [, first, id] = path.split("/")
    if (m === "GET" && first === "attachments" && id) {
      const a = api.attachment(id)
      if (!a) return json(res, 404, { error: "no such file" })
      const inline = isInlineImage(a.mime)
      res.writeHead(200, {
        ...BASE,
        "content-type": inline ? a.mime : "application/octet-stream",
        "content-length": String(a.size),
        "cache-control": "private, max-age=86400",
        "content-security-policy": "default-src 'none'; img-src 'self'; style-src 'unsafe-inline'; sandbox",
        "content-disposition": `${inline ? "inline" : "attachment"}; filename*=UTF-8''${encodeURIComponent(a.name)}`
      })
      return createReadStream(a.path).pipe(res)
    }
    // The page's own files, as the desktop window gets them.
    const name = path === "/" ? "index.html" : path.slice(1)
    if (m !== "GET" || !/^(fonts\/)?[\w.-]+$/.test(name)) return json(res, 404, { error: "not found" })
    const bytes = await readFile(join(ui, name)).catch(() => undefined)
    if (!bytes) return json(res, 404, { error: "not found" })
    res.writeHead(200, { ...BASE, "content-type": MIME[extname(name)] ?? "application/octet-stream", "cache-control": name.startsWith("fonts/") ? "max-age=604800" : "no-store" })
    res.end(bytes)
  }

  const signOutStreams = () => {
    for (const res of streams) res.end()
    streams.clear()
  }
  const stop = () =>
    new Promise<void>((resolve) => {
      const s = server
      server = undefined
      if (!s) return resolve()
      signOutStreams()
      s.close(() => resolve())
      s.closeAllConnections()
    })
  const start = (port: number) =>
    new Promise<void>((resolve) => {
      const s = createServer((req, res) => {
        handle(req, res).catch((e) => {
          if (!res.headersSent) json(res, 500, { error: String(e instanceof Error ? e.message : e) })
          else res.end()
        })
      })
      s.once("error", (e: NodeJS.ErrnoException) => {
        error = e.code === "EADDRINUSE" ? `port ${port} is taken; pick another` : `can't listen on 127.0.0.1:${port}: ${e.message}`
        resolve()
      })
      s.listen(port, "127.0.0.1", () => {
        server = s
        error = undefined
        resolve()
      })
    })

  // Settings change one at a time, in order.
  let queue = Promise.resolve()
  const apply = (next: Settings["remote"]) =>
    (queue = queue.then(async () => {
      const unchanged = next.enabled === on.enabled && next.port === on.port
      on = next
      // Unchanged settings don't retry a port that was taken: turning it off and on again does.
      if (unchanged && (server !== undefined || !next.enabled || error !== undefined)) return
      // A device that turned remote access off, or moved it, gets its answer before its connection goes.
      if (server) await new Promise((resolve) => setTimeout(resolve, 1000))
      await stop()
      error = undefined
      if (next.enabled) await start(next.port)
    }))

  const status = async (): Promise<RemoteStatus> => {
    await queue
    return {
      enabled: on.enabled,
      port: on.port,
      listening: server !== undefined,
      ...(error ? { error } : {}),
      code: showCode(code),
      local: `http://127.0.0.1:${on.port}/`,
      command: `tailscale serve --bg ${on.port}`,
      tailnet: await tailnet(on.port)
    }
  }

  api.subscribe((event, data) => {
    const r = (data as Partial<Settings> | undefined)?.remote
    if (event === "settings" && r) void apply(r)
  })
  await apply(api.settings().remote)

  const remote: Api = {
    ...api,
    call: async (method, path, body): Promise<Reply> => {
      const parts = path.split("/").filter(Boolean)
      if (parts[0] !== "remote") return api.call(method, path, body)
      try {
        if (method === "GET" && parts.length === 1) return { status: 200, body: await status() }
        if (method === "POST" && parts[1] === "code" && parts.length === 2) {
          code = newCode()
          await saveCode(code)
          // Paired devices hold the old code: their streams end, and their next call asks them to pair again.
          signOutStreams()
          return { status: 200, body: await status() }
        }
        return { status: 404, body: { error: "not found" } }
      } catch (e) {
        return { status: 500, body: { error: String(e instanceof Error ? e.message : e) } }
      }
    },
    close: async () => {
      await queue
      await stop()
      await api.close()
    }
  }
  return remote
}
