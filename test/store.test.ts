import { Effect } from "effect"
import { existsSync, mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, describe, expect, it } from "vitest"
import type { Item, Thread } from "../src/app/Model.ts"
import * as StoreModule from "../src/app/Store.ts"
import { ftsQuery } from "../src/app/ThreadDb.ts"

const homes: Array<string> = []
afterEach(() => {
  for (const h of homes.splice(0)) rmSync(h, { recursive: true, force: true })
})
const newHome = () => {
  const h = mkdtempSync(join(tmpdir(), "zero-store-"))
  homes.push(h)
  return h
}
/** A store on `home` for the length of `use`: opened, used, closed (its writes out). */
const withStore = <A>(home: string, use: (s: Effect.Success<ReturnType<typeof StoreModule.make>>) => A) =>
  Effect.runPromise(Effect.scoped(Effect.map(StoreModule.make(home), use)))

const thread = (id: string, title: string, items: Array<Item>, extra: Partial<Thread> = {}): Thread => ({
  id, projectId: "p1", title, provider: "claude", model: "claude-opus-5-5", access: "ask", status: "idle", resume: null,
  createdAt: "2026-11-13T00:00:00.000Z", updatedAt: "2026-11-13T00:00:00.000Z", items, ...extra
})
const user = (id: string, text: string): Item => ({ kind: "user", id, at: "2026-11-13T00:00:01.000Z", text })
const said = (id: string, text: string): Item => ({ kind: "assistant", id, at: "2026-11-13T00:00:02.000Z", text })

describe("threads in SQLite", () => {
  it("keeps a thread across a restart: its meta at once, its items in order when it's opened", async () => {
    const home = newHome()
    await withStore(home, (s) => {
      const t = thread("t_a", "Fix the login", [user("u1", "the login button does nothing"), said("a1", "Looking")], { status: "running" })
      s.createThread(t)
      // Streaming text grows in place: named, it's written.
      const reply = t.items[1] as Item & { kind: "assistant" }
      reply.text += " at the click handler."
      s.saveThread(t, true, reply)
      // A new item, appended: found without being named.
      t.items.push(user("u2", "thanks"))
      s.saveThread(t, true)
    })
    await withStore(home, (s) => {
      expect(s.threads().map((m) => [m.id, m.status, "items" in m])).toEqual([["t_a", "idle", false]])
      const t = s.thread("t_a")!
      expect(t.items.map((i) => i.id)).toEqual(["u1", "a1", "u2"])
      expect((t.items[1] as { text: string }).text).toBe("Looking at the click handler.")
      // The same object each time: the rest of zero relies on it.
      expect(s.thread("t_a")).toBe(t)
    })
  })

  it("changes a thread's meta without reading its items, and forgets a deleted thread", async () => {
    const home = newHome()
    await withStore(home, (s) => s.createThread(thread("t_b", "Branch", [user("u1", "hi")])))
    await withStore(home, (s) => {
      expect(s.patchThread("t_b", { branch: "feature/x" })?.branch).toBe("feature/x")
      s.deleteThread("t_b")
      expect(s.thread("t_b")).toBeUndefined()
    })
    await withStore(home, (s) => expect(s.threads()).toEqual([]))
  })

  it("brings in the old JSON threads, leaves the files, and takes a file an older zero changed again", async () => {
    const home = newHome()
    mkdirSync(join(home, "threads"))
    const file = join(home, "threads", "t_old.json")
    writeFileSync(file, JSON.stringify(thread("t_old", "From before", [user("u1", "an old message about websockets")])))
    writeFileSync(join(home, "threads", "t_gone.json"), JSON.stringify(thread("t_gone", "Deleted later", [])))
    writeFileSync(join(home, "threads", "broken.json"), "{ not json")
    await withStore(home, (s) => {
      expect(s.threads().map((m) => m.title).sort()).toEqual(["Deleted later", "From before"])
      expect(s.thread("t_old")!.items).toHaveLength(1)
      s.deleteThread("t_gone")
    })
    expect(existsSync(file)).toBe(true)
    // Started again: nothing new, nothing doubled, and a thread deleted here doesn't come back from its file.
    await withStore(home, (s) => {
      expect(s.threads().map((m) => m.id)).toEqual(["t_old"])
      expect(s.thread("t_old")!.items).toHaveLength(1)
    })
    // An older zero went on writing the file: its newer copy replaces the one in the database.
    writeFileSync(file, JSON.stringify(thread("t_old", "From before", [user("u1", "an old message"), said("a1", "and a reply written by an older zero")])))
    const later = new Date(Date.now() + 5000)
    utimesSync(file, later, later)
    await withStore(home, (s) => {
      expect(s.thread("t_old")!.items.map((i) => i.id)).toEqual(["u1", "a1"])
      expect(s.search("older zero").map((h) => h.threadId)).toEqual(["t_old"])
      // The old message's words left the index with it.
      expect(s.search("websockets")).toEqual([])
    })
  })

  it("finds threads by what they say and by title, by word prefix, best match once per thread", async () => {
    const home = newHome()
    await withStore(home, (s) => {
      s.createThread(thread("t_1", "Remote access", [user("u1", "pair a phone over tailscale"), said("a1", "Pairing works with a QR code")]))
      s.createThread(thread("t_2", "Sidebar polish", [user("u2", "the sidebar flickers when resizing")]))
      s.createThread(thread("t_3", "Tool output", [{ kind: "tool", id: "x1", at: "", name: "Bash", detail: "npx vitest run", status: "done", output: "secret words in output" }]))
      expect(s.search("tailscale").map((h) => h.threadId)).toEqual(["t_1"])
      expect(s.search("pair").map((h) => h.threadId)).toEqual(["t_1"])
      expect(s.search("sideb").map((h) => h.threadId)).toEqual(["t_2"])
      expect(s.search("resizing").map((h) => h.threadId)).toEqual(["t_2"])
      // A command is searchable; what it printed isn't (it's long, and noise).
      expect(s.search("vitest").map((h) => h.threadId)).toEqual(["t_3"])
      expect(s.search("secret")).toEqual([])
      const hit = s.search("qr code")[0]!
      expect(hit).toMatchObject({ threadId: "t_1", itemId: "a1" })
      expect(hit.snippet).toContain("\u0002QR\u0003")
      // What looks like FTS syntax is just words.
      expect(() => s.search('"unclosed AND (OR*')).not.toThrow()
      expect(s.search("   ")).toEqual([])
      s.deleteThread("t_1")
      expect(s.search("tailscale")).toEqual([])
    })
  })

  it("turns typed words into a query that can't be read as FTS syntax", () => {
    expect(ftsQuery('fix "login" AND (button)')).toBe('"fix"* "login"* "and"* "button"*')
    expect(ftsQuery("")).toBe("")
  })
})
