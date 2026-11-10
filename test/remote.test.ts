import { mkdtempSync, rmSync } from "node:fs"
import { createServer } from "node:net"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { type Api, makeApi } from "../src/app/Api.ts"
import { deviceName, enableLink, normalizeCode, type RemoteStatus, servedUrl, servesOther, showCode, type Tailnet, withRemote } from "../src/app/Remote.ts"

const ROOT = fileURLToPath(new URL("..", import.meta.url))

const freePort = () =>
  new Promise<number>((resolve) => {
    const s = createServer().listen(0, "127.0.0.1", () => {
      const port = (s.address() as { port: number }).port
      s.close(() => resolve(port))
    })
  })

describe("tailscale serve's config", () => {
  const bg = JSON.stringify({ TCP: { "443": { HTTPS: true } }, Web: { "desk.tail1234.ts.net:443": { Handlers: { "/": { Proxy: "http://127.0.0.1:8137" } } } } })
  it("names the https address that forwards to our port", () => {
    expect(servedUrl(bg, 8137)).toBe("https://desk.tail1234.ts.net/")
    expect(servedUrl(bg, 9000)).toBeUndefined()
  })
  it("reads foreground sessions and other https ports too, and shrugs at junk", () => {
    const fg = JSON.stringify({ Foreground: { s1: { Web: { "desk.ts.net:8443": { Handlers: { "/": { Proxy: "http://localhost:8137/" } } } } } } })
    expect(servedUrl(fg, 8137)).toBe("https://desk.ts.net:8443/")
    expect(servedUrl("{}", 8137)).toBeUndefined()
    expect(servedUrl("not json", 8137)).toBeUndefined()
  })
})

describe("tailscale serve's config, when it serves something else", () => {
  it("knows https://<host>/ is taken by another service, and not by us", () => {
    const other = JSON.stringify({ Web: { "desk.ts.net:443": { Handlers: { "/": { Proxy: "http://127.0.0.1:3000" } } } } })
    const ours = JSON.stringify({ Web: { "desk.ts.net:443": { Handlers: { "/": { Proxy: "http://127.0.0.1:8137" } } } } })
    const elsewhere = JSON.stringify({ Web: { "desk.ts.net:8443": { Handlers: { "/": { Proxy: "http://127.0.0.1:3000" } } } } })
    expect(servesOther(other, 8137)).toBe(true)
    expect(servesOther(ours, 8137)).toBe(false)
    expect(servesOther(elsewhere, 8137)).toBe(false)
    expect(servesOther("{}", 8137)).toBe(false)
    expect(servesOther("junk", 8137)).toBe(false)
  })
  it("finds the link Tailscale gives to turn HTTPS on", () => {
    const said = "Serve is not enabled on your tailnet.\nTo enable, visit:\n\n         https://login.tailscale.com/f/serve?node=nXyz123\n"
    expect(enableLink(said)).toBe("https://login.tailscale.com/f/serve?node=nXyz123")
    expect(enableLink("error: something else")).toBeUndefined()
  })
})

describe("a paired device's name", () => {
  it("is its browser and its kind of device", () => {
    expect(deviceName("Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Mobile/15E148 Safari/604.1")).toBe("Safari on iPhone")
    expect(deviceName("Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/131.0 Mobile/15E148 Safari/604.1")).toBe("Chrome on iPhone")
    expect(deviceName("Mozilla/5.0 (Linux; Android 15; Pixel 9) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0 Mobile Safari/537.36")).toBe("Chrome on Android")
    expect(deviceName("Mozilla/5.0 (Linux; Android 14; SM-S921B) AppleWebKit/537.36 (KHTML, like Gecko) SamsungBrowser/26.0 Chrome/122.0 Mobile Safari/537.36")).toBe("Samsung Internet on Android")
    expect(deviceName("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0 Safari/537.36 Edg/131.0")).toBe("Edge on Windows")
    expect(deviceName("Mozilla/5.0 (Macintosh; Intel Mac OS X 14.6; rv:132.0) Gecko/20100101 Firefox/132.0")).toBe("Firefox on Mac")
    expect(deviceName("curl/8.0")).toBe("A device")
    expect(deviceName("")).toBe("A device")
  })
})

describe("pairing codes", () => {
  it("read the same however they're typed", () => {
    expect(showCode("abcd2345wxyz")).toBe("abcd-2345-wxyz")
    expect(normalizeCode(" ABCD-2345 wxyz ")).toBe("abcd2345wxyz")
  })
})

describe("remote access over HTTP", () => {
  let home = ""
  let api: Api
  let port = 0
  let base = ""
  let cookie = ""
  let tail: Tailnet = { found: true, running: true, host: "desk.tail1234.ts.net" }
  const served: Array<number> = []
  const heard: Array<[string, unknown]> = []
  const before = process.env["ZERO_HOME"]
  const status = async () => (await api.call("GET", "remote")).body as RemoteStatus
  const setRemote = async (remote: { enabled: boolean; port: number }) => {
    const r = await api.call("PUT", "settings", { ...api.settings(), remote })
    expect(r.status).toBe(200)
  }
  const call = (path: string, init: RequestInit = {}) =>
    fetch(`${base}${path}`, { redirect: "manual", ...init, headers: { cookie, ...(init.headers as Record<string, string> | undefined) } })

  beforeAll(async () => {
    home = mkdtempSync(join(tmpdir(), "zero-remote-"))
    process.env["ZERO_HOME"] = home
    api = await withRemote(await makeApi({ root: ROOT, cli: join(ROOT, "src", "cli.ts") }), {
      ui: join(ROOT, "ui"),
      home,
      tailnet: async () => tail,
      serve: async (p) => {
        served.push(p)
        tail = { ...tail, url: "https://desk.tail1234.ts.net/" }
        return { ok: true, output: "Available within your tailnet: https://desk.tail1234.ts.net/" }
      }
    })
    api.subscribe((event, data) => heard.push([event, data]))
    port = await freePort()
    base = `http://127.0.0.1:${port}`
  })
  afterAll(async () => {
    await api.close()
    if (before === undefined) delete process.env["ZERO_HOME"]
    else process.env["ZERO_HOME"] = before
    rmSync(home, { recursive: true, force: true })
  })

  it("is off until Settings turns it on", async () => {
    expect(api.settings().remote).toEqual({ enabled: false, port: 8137 })
    expect(await status()).toMatchObject({ enabled: false, listening: false })
    await setRemote({ enabled: true, port })
    const s = await status()
    expect(s).toMatchObject({ enabled: true, port, listening: true, local: `${base}/`, command: `tailscale serve --bg ${port}`, tailnet: { host: "desk.tail1234.ts.net" } })
    expect(s.code).toMatch(/^[a-z2-9]{4}-[a-z2-9]{4}-[a-z2-9]{4}$/)
  })

  it("shows an unpaired device only the pairing page", async () => {
    const page = await call("/")
    expect(page.status).toBe(200)
    expect(await page.text()).toContain("Pair with zero")
    expect((await call("/api/bootstrap", { headers: { "x-zero": "1" } })).status).toBe(401)
    expect((await call("/app.js")).status).toBe(404)
    expect((await call("/api/events")).status).toBe(401)
  })

  it("serves what puts it on a home screen before pairing, and nothing else", async () => {
    const manifest = await call("/manifest.webmanifest")
    expect(manifest.status).toBe(200)
    expect(manifest.headers.get("content-type")).toBe("application/manifest+json")
    expect(await manifest.json()).toMatchObject({ name: "zero", display: "standalone", start_url: "/" })
    const icon = await call("/icon-192.png")
    expect(icon.status).toBe(200)
    expect(icon.headers.get("content-type")).toBe("image/png")
    expect((await call("/icon-180.png")).status).toBe(200)
    expect(await (await call("/index.html")).text()).toContain("Pair with zero") // the pairing page, not the app
    expect((await call("/web.js")).status).toBe(404)
  })

  it("pairs a device that types the code, however it's typed, and not one that guesses", async () => {
    const wrong = await call("/pair", { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: "code=aaaa-aaaa-aaaa" })
    expect(wrong.status).toBe(401)
    expect(wrong.headers.get("set-cookie")).toBeNull()
    const typed = (await status()).code.toUpperCase().replace(/-/g, " ")
    const right = await call("/pair", { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: `code=${encodeURIComponent(typed)}` })
    expect(right.status).toBe(303)
    expect(right.headers.get("location")).toBe("/")
    const set = right.headers.get("set-cookie") ?? ""
    expect(set).toMatch(/HttpOnly/)
    expect(set).toMatch(/SameSite=Lax/)
    cookie = set.split(";")[0]!
  })

  it("serves a paired device the desktop's page and backend", async () => {
    const page = await call("/")
    expect(page.status).toBe(200)
    const html = await page.text()
    expect(html).toContain('<script src="web.js"></script>')
    expect(page.headers.get("x-frame-options")).toBe("DENY")
    expect((await call("/web.js")).headers.get("content-type")).toMatch(/javascript/)
    expect((await call("/fonts/martian-mono.woff2")).status).toBe(200)
    expect((await call("/../package.json")).status).toBe(404)
    const boot = await call("/api/bootstrap", { headers: { "x-zero": "1" } })
    expect(boot.status).toBe(200)
    expect(await boot.json()).toMatchObject({ projects: [{ name: "zero" }] })
  })

  it("refuses API calls without zero's header: no other site's page can make them", async () => {
    expect((await call("/api/bootstrap")).status).toBe(403)
    expect((await call("/api/threads", { method: "POST", headers: { "content-type": "text/plain" }, body: "{}" })).status).toBe(403)
  })

  it("starts a thread from the device and streams what happens to it", async () => {
    const events = await call("/api/events")
    expect(events.headers.get("content-type")).toBe("text/event-stream")
    const reader = events.body!.getReader()
    const projectId = ((await (await call("/api/bootstrap", { headers: { "x-zero": "1" } })).json()) as { projects: Array<{ id: string }> }).projects[0]!.id
    const made = await call("/api/threads", { method: "POST", headers: { "x-zero": "1", "content-type": "application/json" }, body: JSON.stringify({ projectId }) })
    expect(made.status).toBe(201)
    const thread = (await made.json()) as { id: string }
    let text = ""
    while (!text.includes(thread.id)) text += new TextDecoder().decode((await reader.read()).value)
    const frame = text.split("\n").find((l) => l.startsWith("data: ") && l.includes(thread.id))!
    expect(JSON.parse(frame.slice(6))).toMatchObject({ event: "thread", data: { id: thread.id } })
    await reader.cancel()
    // And an older one opens, as on the desktop.
    expect((await call(`/api/threads/${thread.id}`, { headers: { "x-zero": "1" } })).status).toBe(200)
    expect((await call("/api/threads/nope", { headers: { "x-zero": "1" } })).status).toBe(404)
    expect((await call("/api/threads", { method: "POST", headers: { "x-zero": "1", "content-type": "application/json" }, body: "{not json" })).status).toBe(400)
  })

  it("takes an attached file and hands it back, never as something to run", async () => {
    const up = await call("/api/attachments", { method: "POST", headers: { "x-zero": "1", "content-type": "text/html", "x-file-name": encodeURIComponent("notes é.html") }, body: "<script>alert(1)</script>" })
    expect(up.status).toBe(201)
    const { id } = (await up.json()) as { id: string }
    const got = await call(`/attachments/${id}`)
    expect(got.status).toBe(200)
    expect(got.headers.get("content-type")).toBe("application/octet-stream")
    expect(got.headers.get("content-disposition")).toMatch(/^attachment/)
    expect(await got.text()).toBe("<script>alert(1)</script>")
  })

  it("shares itself on the tailnet, then shows a QR code that pairs a phone in one step", async () => {
    // Tailscale doesn't serve the port yet: no link, nothing to scan.
    const before = await status()
    expect(before.pairUrl).toBeUndefined()
    expect(before.qr).toBeUndefined()
    const r = await api.call("POST", "remote/serve", {})
    expect(r.status).toBe(200)
    expect(served).toEqual([port])
    const s = r.body as RemoteStatus
    expect(s.serve).toMatchObject({ ok: true })
    const raw = normalizeCode(s.code)
    expect(s.pairUrl).toBe(`https://desk.tail1234.ts.net/pair?code=${raw}`)
    expect(s.qr).toMatch(/^<svg xmlns="http:\/\/www\.w3\.org\/2000\/svg" viewBox="0 0 41 41"/) // version 4, and its quiet zone
    // The phone's camera opens the link: paired, and on to zero.
    heard.length = 0
    const scanned = await fetch(`${base}/pair?code=${raw}`, {
      redirect: "manual",
      headers: { "user-agent": "Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Mobile/15E148 Safari/604.1", "x-forwarded-proto": "https" }
    })
    expect(scanned.status).toBe(303)
    expect(scanned.headers.get("location")).toBe("/")
    expect(scanned.headers.get("set-cookie")).toMatch(/; Secure$/)
    const phone = scanned.headers.get("set-cookie")!.split(";")[0]!
    expect((await fetch(`${base}/api/bootstrap`, { headers: { cookie: phone, "x-zero": "1" } })).status).toBe(200)
    // The desktop hears of it, and Settings says who.
    expect(heard).toContainEqual(["remote-paired", expect.objectContaining({ device: "Safari on iPhone" })])
    expect((await status()).paired).toMatchObject({ device: "Safari on iPhone" })
  })

  it("tells paired browsers of a new pairing through their event stream too", async () => {
    const events = await call("/api/events")
    const reader = events.body!.getReader()
    await reader.read() // ": connected"
    expect((await call(`/pair?code=${normalizeCode((await status()).code)}`)).status).toBe(303)
    let text = ""
    while (!text.includes("remote-paired")) text += new TextDecoder().decode((await reader.read()).value)
    await reader.cancel()
  })

  it("signs every device out with a new code", async () => {
    const old = (await status()).code
    const r = await api.call("POST", "remote/code", {})
    expect(r.status).toBe(200)
    expect((r.body as RemoteStatus).code).not.toBe(old)
    expect((r.body as RemoteStatus).paired).toBeUndefined()
    expect((r.body as RemoteStatus).pairUrl).toContain(normalizeCode((r.body as RemoteStatus).code))
    expect((await call("/api/bootstrap", { headers: { "x-zero": "1" } })).status).toBe(401)
    expect((await call("/api/ping")).status).toBe(401)
  })

  it("stops listening to guesses after ten wrong codes a minute", async () => {
    const guess = () => call("/pair?code=zzzz-zzzz-zzzz").then((r) => r.status)
    const seen: Array<number> = []
    for (let i = 0; i < 10; i++) seen.push(await guess())
    expect(seen.filter((s) => s === 401).length).toBeGreaterThanOrEqual(8) // one wrong code came earlier
    expect(await guess()).toBe(429)
    // Even the right code waits now.
    expect((await call(`/pair?code=${(await status()).code}`)).status).toBe(429)
  })

  it("moves to a new port and stops when turned off", async () => {
    const next = await freePort()
    await setRemote({ enabled: true, port: next })
    expect(await status()).toMatchObject({ listening: true, port: next })
    await expect(fetch(`${base}/`)).rejects.toThrow()
    expect((await fetch(`http://127.0.0.1:${next}/`)).status).toBe(200)
    await setRemote({ enabled: false, port: next })
    expect(await status()).toMatchObject({ enabled: false, listening: false })
    await expect(fetch(`http://127.0.0.1:${next}/`)).rejects.toThrow()
  })

  it("says so when its port is taken", async () => {
    const taken = await freePort()
    const blocker = createServer().listen(taken, "127.0.0.1")
    await new Promise((resolve) => blocker.once("listening", resolve))
    await setRemote({ enabled: true, port: taken })
    expect(await status()).toMatchObject({ enabled: true, listening: false, error: `port ${taken} is taken; pick another` })
    blocker.close()
    await setRemote({ enabled: false, port: taken })
  })

  it("won't run tailscale serve while it's off", async () => {
    const r = await api.call("POST", "remote/serve", {})
    expect(r.status).toBe(409)
    expect(served).toHaveLength(1)
    expect((await status()).pairUrl).toBeUndefined()
  })
})
