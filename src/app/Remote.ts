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
 *
 * Once Tailscale serves the port, Settings shows a QR code of the pairing
 * link: a phone's camera opens zero on it, paired, in one step. Settings can
 * run `tailscale serve` itself (POST remote/serve), and hears a
 * `remote-paired` event when a device pairs.
 */
import { execFile, spawn } from "node:child_process"
import { randomInt, timingSafeEqual } from "node:crypto"
import { createReadStream, readFileSync } from "node:fs"
import { readFile, writeFile } from "node:fs/promises"
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http"
import { extname, join } from "node:path"
import type { Api, Reply } from "./Api.ts"
import { isInlineImage, MAX_ATTACHMENT_BYTES } from "./Attachments.ts"
import type { Settings } from "./Model.ts"
import { qrSvg } from "./Qr.ts"

export interface RemoteOptions {
  /** The page's files: zero's ui/ folder. */
  readonly ui: string
  /** Where the pairing code is kept (remote.json): zero's home, ~/.zero. */
  readonly home: string
  /** What Tailscale says of this machine; a stand-in in tests. */
  readonly tailnet?: (port: number) => Promise<Tailnet>
  /** Runs `tailscale serve --bg <port>`; a stand-in in tests. */
  readonly serve?: (port: number) => Promise<ServeResult>
}

/** What `tailscale serve --bg <port>` said. */
export interface ServeResult {
  /** It finished, serving the port. */
  readonly ok: boolean
  /** Its own words, for when it didn't. */
  readonly output: string
  /** Where to turn HTTPS on for the tailnet, when Tailscale asks for that first; serve finishes by itself once it's on. */
  readonly enableUrl?: string
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
  /** `tailscale serve` already offers something else at https://<host>/, which serving zero would replace. */
  readonly busy?: boolean
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
  /** Once Tailscale serves it: the link that opens zero on a device and pairs it, and that link as a QR code (SVG). */
  readonly pairUrl?: string
  readonly qr?: string
  /** The last device that paired since zero started, and when. */
  readonly paired?: { readonly device: string; readonly at: string }
  /** What `tailscale serve` said (POST remote/serve only). */
  readonly serve?: ServeResult
}

/** No 0/o, 1/l/i: a code read off one screen and typed into another. 31^12, about 60 bits. */
const ALPHABET = "23456789abcdefghjkmnpqrstuvwxyz"
const CODE_LENGTH = 12
export const newCode = (): string => Array.from({ length: CODE_LENGTH }, () => ALPHABET[randomInt(ALPHABET.length)]).join("")
/** What a person typed, as the code is kept: case, spaces and dashes don't matter. */
export const normalizeCode = (typed: string): string => typed.toLowerCase().replace(/[^a-z0-9]/g, "")
export const showCode = (code: string): string => code.match(/.{1,4}/g)?.join("-") ?? code

const COOKIE = "zero_remote"
/** The files that put zero on a home screen: served before pairing (browsers often ask without the cookie), as they hold nothing private. */
const PUBLIC = /^\/(manifest\.webmanifest|icon-[\w-]+\.png)$/
/** Wrong codes allowed a minute, from everyone together: guessing 60 bits at this rate never ends. */
const TRIES_PER_MINUTE = 10
const MAX_JSON_BYTES = 4 * 1024 * 1024

const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".webmanifest": "application/manifest+json",
  ".png": "image/png",
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
  const busy = !url && serve !== undefined && servesOther(serve, port)
  return { found: true, running, ...(host ? { host } : {}), ...(url ? { url } : {}), ...(busy ? { busy } : {}) }
}

/** Whether `tailscale serve status --json` sends https://<host>/ (port 443, path /) somewhere other than our port. */
export const servesOther = (serveJson: string, port: number): boolean => {
  let config: unknown
  try { config = JSON.parse(serveJson) } catch { return false }
  const ours = new RegExp(`^https?://(127\\.0\\.0\\.1|localhost|\\[::1\\]):${port}/?$`)
  const web = (config as { Web?: Record<string, { Handlers?: Record<string, { Proxy?: string }> }> })?.Web ?? {}
  return Object.entries(web).some(([hostPort, site]) => {
    const root = site.Handlers?.["/"]
    return /:443$/.test(hostPort) && root !== undefined && !ours.test(root.Proxy ?? "")
  })
}

/** The link in Tailscale's words that turns something on, e.g. https://login.tailscale.com/f/serve?node=…. */
export const enableLink = (output: string): string | undefined => /https:\/\/login\.tailscale\.com\/\S+/.exec(output)?.[0]

/**
 * `tailscale serve --bg <port>`. Done in a moment when the tailnet has HTTPS on. When it hasn't,
 * Tailscale prints a link to turn it on and waits: the link comes back at once, and the command
 * keeps waiting (up to ten minutes), so it finishes by itself once HTTPS is on.
 */
export const runServe = (port: number) =>
  new Promise<ServeResult>((resolve) => {
    let output = ""
    let settled = false
    const done = (r: ServeResult) => {
      if (settled) return
      settled = true
      resolve(r)
    }
    const child = spawn("tailscale", ["serve", "--bg", String(port)], { windowsHide: true, stdio: ["ignore", "pipe", "pipe"] })
    const kill = setTimeout(() => child.kill(), 10 * 60_000)
    const hear = (chunk: Buffer) => {
      output += chunk.toString("utf8")
      const enableUrl = enableLink(output)
      if (enableUrl) done({ ok: false, output: output.trim(), enableUrl })
    }
    child.stdout.on("data", hear)
    child.stderr.on("data", hear)
    child.on("error", (e) => {
      clearTimeout(kill)
      done({ ok: false, output: e.message })
    })
    child.on("close", (exit) => {
      clearTimeout(kill)
      done({ ok: exit === 0, output: output.trim() })
    })
  })

/** A device as a person names it, from its browser's user agent: "Safari on iPhone". */
export const deviceName = (ua: string): string => {
  const os = /iPhone/.test(ua) ? "iPhone" : /iPad/.test(ua) ? "iPad" : /Android/.test(ua) ? "Android" : /CrOS/.test(ua) ? "Chromebook"
    : /Macintosh|Mac OS X/.test(ua) ? "Mac" : /Windows/.test(ua) ? "Windows" : /Linux/.test(ua) ? "Linux" : ""
  const browser = /EdgA?\/|EdgiOS/.test(ua) ? "Edge" : /SamsungBrowser/.test(ua) ? "Samsung Internet" : /OPR\/|OPiOS/.test(ua) ? "Opera"
    : /FxiOS|Firefox\//.test(ua) ? "Firefox" : /CriOS|Chrome\//.test(ua) ? "Chrome" : /Safari\//.test(ua) ? "Safari" : ""
  return browser && os ? `${browser} on ${os}` : browser || os || "A device"
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
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="theme-color" content="#ffffff" media="(prefers-color-scheme: light)"><meta name="theme-color" content="#0d0d0d" media="(prefers-color-scheme: dark)">
<link rel="apple-touch-icon" href="/icon-180.png">
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
  <p>On your computer, open zero's Settings, then Remote access. Scan its QR code with this device's camera, or type the code it shows here. You pair once; this browser stays paired.</p>
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
export const withRemote = async (api: Api, { ui, home, tailnet = askTailscale, serve = runServe }: RemoteOptions): Promise<Api> => {
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
  let paired: RemoteStatus["paired"]
  // Remote access's own events (a device paired) go to the same listeners as the backend's.
  type Listener = Parameters<Api["subscribe"]>[0]
  const own = new Set<Listener>()
  const subscribe = (listener: Listener) => {
    own.add(listener)
    const off = api.subscribe(listener)
    return () => {
      own.delete(listener)
      off()
    }
  }
  const emit = (event: string, data: unknown) => { for (const l of own) l(event, data) }

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
    paired = { device: deviceName(String(req.headers["user-agent"] ?? "")), at: new Date().toISOString() }
    emit("remote-paired", paired)
    const secure = req.headers["x-forwarded-proto"] === "https" ? "; Secure" : ""
    // A year; Lax so a link to zero from another app still arrives signed in.
    res.writeHead(303, { ...BASE, location: "/", "cache-control": "no-store", "set-cookie": `${COOKIE}=${code}; Path=/; Max-Age=31536000; HttpOnly; SameSite=Lax${secure}` })
    res.end()
  }

  const events = (res: ServerResponse) => {
    res.writeHead(200, { ...BASE, "content-type": "text/event-stream", "cache-control": "no-store", "x-accel-buffering": "no" })
    res.write(": connected\n\n")
    streams.add(res)
    const off = subscribe((event, data) => res.write(`data: ${JSON.stringify({ event, data })}\n\n`))
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
    if (m === "GET" && PUBLIC.test(path)) return sendFile(res, path.slice(1))
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
    return sendFile(res, name)
  }
  const sendFile = async (res: ServerResponse, name: string) => {
    const bytes = await readFile(join(ui, name)).catch(() => undefined)
    if (!bytes) return json(res, 404, { error: "not found" })
    const cached = name.startsWith("fonts/") || name.endsWith(".png")
    res.writeHead(200, { ...BASE, "content-type": MIME[extname(name)] ?? "application/octet-stream", "cache-control": cached ? "max-age=604800" : "no-store" })
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
    const t = await tailnet(on.port)
    // The link a phone's camera opens: zero, paired. Only once Tailscale serves it, so that it works when scanned.
    const pairUrl = on.enabled && t.url ? `${t.url}pair?code=${code}` : undefined
    return {
      enabled: on.enabled,
      port: on.port,
      listening: server !== undefined,
      ...(error ? { error } : {}),
      code: showCode(code),
      local: `http://127.0.0.1:${on.port}/`,
      command: `tailscale serve --bg ${on.port}`,
      tailnet: t,
      ...(pairUrl ? { pairUrl, qr: qrSvg(pairUrl) } : {}),
      ...(paired ? { paired } : {})
    }
  }

  api.subscribe((event, data) => {
    const r = (data as Partial<Settings> | undefined)?.remote
    if (event === "settings" && r) void apply(r)
  })
  await apply(api.settings().remote)

  const remote: Api = {
    ...api,
    subscribe,
    call: async (method, path, body): Promise<Reply> => {
      const parts = path.split("/").filter(Boolean)
      if (parts[0] !== "remote") return api.call(method, path, body)
      try {
        if (method === "GET" && parts.length === 1) return { status: 200, body: await status() }
        if (method === "POST" && parts[1] === "code" && parts.length === 2) {
          code = newCode()
          paired = undefined
          await saveCode(code)
          // Paired devices hold the old code: their streams end, and their next call asks them to pair again.
          signOutStreams()
          return { status: 200, body: await status() }
        }
        if (method === "POST" && parts[1] === "serve" && parts.length === 2) {
          await queue
          if (!on.enabled) return { status: 409, body: { error: "turn remote access on first" } }
          const result = await serve(on.port)
          return { status: 200, body: { ...(await status()), serve: result } }
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
