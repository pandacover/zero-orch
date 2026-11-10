import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { type Api, makeApi } from "../src/app/Api.ts"
import { envFor } from "../src/Proc.ts"

const ROOT = fileURLToPath(new URL("..", import.meta.url))

describe("the control plane's backend, without a transport", () => {
  let home = ""
  let api: Api
  const before = process.env["ZERO_HOME"]
  beforeAll(async () => {
    home = mkdtempSync(join(tmpdir(), "zero-api-"))
    process.env["ZERO_HOME"] = home
    api = await makeApi({ root: ROOT, cli: join(ROOT, "src", "cli.ts") })
  })
  afterAll(async () => {
    await api.close()
    if (before === undefined) delete process.env["ZERO_HOME"]
    else process.env["ZERO_HOME"] = before
    rmSync(home, { recursive: true, force: true })
  })

  it("starts with zero as its first project", async () => {
    const r = await api.call("GET", "bootstrap")
    expect(r.status).toBe(200)
    expect(r.body).toMatchObject({ home, projects: [{ name: "zero" }], threads: [] })
  })

  it("answers an unknown path or a bad body with an error, never a throw", async () => {
    expect(await api.call("GET", "nope")).toEqual({ status: 404, body: { error: "not found" } })
    expect((await api.call("POST", "projects", "not an object")).status).toBe(400)
    expect((await api.call("GET", "threads/thr_missing")).status).toBe(404)
  })

  it("tells subscribers what changed, until they leave", async () => {
    const seen: Array<string> = []
    const off = api.subscribe((event) => seen.push(event))
    const projectId = ((await api.call("GET", "bootstrap")).body as { projects: Array<{ id: string }> }).projects[0]!.id
    const made = await api.call("POST", "threads", { projectId })
    expect(made.status).toBe(201)
    off()
    await api.call("POST", "threads", { projectId })
    expect(seen).toEqual(["thread"])
  })

  it("keeps an uploaded file and finds it by id", () => {
    expect(api.upload("empty.txt", "text/plain", new Uint8Array()).status).toBe(400)
    const r = api.upload("note.txt", "text/plain", new TextEncoder().encode("hi"))
    expect(r.status).toBe(201)
    const id = (r.body as { id: string }).id
    expect(api.attachment(id)).toMatchObject({ name: "note.txt", size: 2 })
    expect(api.attachment("../etc")).toBeUndefined()
  })
})

describe("child environments", () => {
  it("adds ELECTRON_RUN_AS_NODE only for this binary, and only under Electron", () => {
    expect(envFor(process.execPath)["ELECTRON_RUN_AS_NODE"]).toBeUndefined() // plain Node here
    expect(envFor("git")["ELECTRON_RUN_AS_NODE"]).toBeUndefined()
  })
})
