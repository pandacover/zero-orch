import { mkdtempSync, rmSync } from "node:fs"
import { createServer } from "node:net"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { type Api, makeApi } from "../src/app/Api.ts"
import { normalizeCode, type RemoteStatus, servedUrl, showCode, withRemote } from "../src/app/Remote.ts"

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
      tailnet: async () => ({ found: true, running: true, host: "desk.tail1234.ts.net" })
    })
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

  it("signs every device out with a new code", async () => {
    const old = (await status()).code
    const r = await api.call("POST", "remote/code", {})
    expect(r.status).toBe(200)
    expect((r.body as RemoteStatus).code).not.toBe(old)
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
})
