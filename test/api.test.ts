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

  it("lists a project's branches, and won't make a worktree from a branch that isn't there", async () => {
    const projectId = ((await api.call("GET", "bootstrap")).body as { projects: Array<{ id: string }> }).projects[0]!.id
    const b = await api.call("GET", `projects/${projectId}/branches`)
    expect(b.status).toBe(200)
    expect(b.body).toMatchObject({ repo: true, linked: false })
    const made = await api.call("POST", "threads", { projectId, worktree: { base: "no-such-branch-here", branch: "zero/x" } })
    expect(made).toEqual({ status: 400, body: { error: "there's no branch no-such-branch-here" } })
    const t = (await api.call("POST", "threads", { projectId })).body as { id: string }
    expect((await api.call("POST", `threads/${t.id}/branch`, { branch: "--orphan" })).status).toBe(409)
    expect((await api.call("GET", `threads/${t.id}/branches`)).body).toMatchObject({ repo: true, cwd: ROOT.replace(/[\\/]$/, "") })
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

describe("desktop notifications", async () => {
  const { notice } = await import("../src/desktop/Notify.ts")
  const titles = new Map([["thr_1", "Fix the upload retry"]])
  it("tells of a finished turn, an error and a wait for approval, under the thread's title", () => {
    expect(notice("item", { threadId: "thr_1", item: { kind: "turn", outcome: "done" } }, titles)).toEqual({ threadId: "thr_1", title: "Fix the upload retry", body: "Done. Your turn." })
    expect(notice("item", { threadId: "thr_1", item: { kind: "turn", outcome: "failed", error: "rate limited" } }, titles)?.body).toBe("Stopped on an error: rate limited")
    expect(notice("item", { threadId: "thr_1", item: { kind: "permission", state: "pending", tool: "Bash", detail: "npm test" } }, titles)?.body).toBe("Waiting for your approval: Bash npm test")
  })
  it("stays quiet about everything else, a turn the person stopped included", () => {
    expect(notice("item", { threadId: "thr_1", item: { kind: "turn", outcome: "stopped" } }, titles)).toBeUndefined()
    expect(notice("item", { threadId: "thr_1", item: { kind: "permission", state: "allowed" } }, titles)).toBeUndefined()
    expect(notice("item", { threadId: "thr_1", item: { kind: "tool" } }, titles)).toBeUndefined()
    expect(notice("thread", { id: "thr_1", title: "x" }, titles)).toBeUndefined()
  })
})
