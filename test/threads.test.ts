import * as NodeServices from "@effect/platform-node/NodeServices"
import { Effect, Layer, Option } from "effect"
import { execFileSync } from "node:child_process"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, describe, expect, it } from "vitest"
import { compactionOffered, DEFAULT_SETTINGS, isCompact, type Item, needsCompaction, type Thread } from "../src/app/Model.ts"
import { cleanTitle, gate, summaryOf } from "../src/app/providers/Claude.ts"
import type { Provider, TurnInput } from "../src/app/providers/Provider.ts"
import * as StoreModule from "../src/app/Store.ts"
import { Store } from "../src/app/Store.ts"
import { lineBuffer, makeThreads, PROVIDERS, recalledTitle, turnCost, withEffort } from "../src/app/Threads.ts"
import { MemoryError } from "../src/Errors.ts"
import * as Singularity from "../src/Singularity.ts"

describe("thread turns", () => {
  it("charges a resumed session's turn only what it added", () => {
    // The three turns of a dogfood thread, as the Agent SDK reported them: running totals.
    let before = 0
    const turns = [0.966, 2.175, 4.03].map((reported) => {
      const cost = turnCost(reported, true, before)
      before = reported
      return cost
    })
    expect(turns.map((c) => Number(c!.toFixed(3)))).toEqual([0.966, 1.209, 1.855])
  })

  it("takes a per-turn cost as it is, and keeps an unknown cost unknown", () => {
    expect(turnCost(0.25, false, 3)).toBe(0.25)
    expect(turnCost(null, true, 3)).toBeNull()
    // A total below the last one means a new session: never a negative charge.
    expect(turnCost(0.1, true, 3)).toBe(0)
  })

  it("names a recalled change by its commit subject", () => {
    expect(recalledTitle('An earlier task here asked for something like yours, committed as 5009bb34bd: "Add --reps N to bench"')).toBe("Add --reps N to bench")
    expect(recalledTitle("no subject here")).toBe("a past change")
  })

  it("lets streamed text through a whole line at a time", () => {
    const b = lineBuffer()
    expect(b.push("Hel")).toBe("")
    expect(b.push("lo wor")).toBe("")
    expect(b.push("ld\nsec")).toBe("Hello world\n")
    expect(b.push("ond\nthird\n")).toBe("second\nthird\n")
    expect(b.push("tail")).toBe("")
    expect(b.flush()).toBe("tail")
    expect(b.flush()).toBe("")
  })

  it("puts a thread's effort in place of its provider's default, and only a known one", () => {
    expect(withEffort(DEFAULT_SETTINGS, "claude", "max").claude.effort).toBe("max")
    expect(withEffort(DEFAULT_SETTINGS, "codex", "minimal").codex.effort).toBe("minimal")
    expect(withEffort(DEFAULT_SETTINGS, "claude", "minimal")).toBe(DEFAULT_SETTINGS)
    expect(withEffort(DEFAULT_SETTINGS, "claude", undefined)).toBe(DEFAULT_SETTINGS)
    expect(withEffort(DEFAULT_SETTINGS, "ollama", "high")).toBe(DEFAULT_SETTINGS)
  })

  it("gates edits by the access it's given", () => {
    const cwd = join(tmpdir(), "proj")
    const edit = { file_path: join(cwd, "a.txt") }
    expect(gate("ask", cwd, "Edit", edit)).toBe("ask")
    expect(gate("auto-edit", cwd, "Edit", edit)).toBe("allow")
    expect(gate("read-only", cwd, "Edit", edit)).toBe("deny")
    expect(gate("read-only", cwd, "Read", edit)).toBe("allow")
  })

  it("runs commands without asking only under full access", () => {
    const cwd = join(tmpdir(), "proj")
    const cmd = { command: "npm test" }
    expect(gate("ask", cwd, "Bash", cmd)).toBe("ask")
    expect(gate("auto-edit", cwd, "Bash", cmd)).toBe("ask")
    expect(gate("full-access", cwd, "Bash", cmd)).toBe("allow")
    expect(gate("full-access", cwd, "Edit", { file_path: join(cwd, "a.txt") })).toBe("allow")
    expect(gate("read-only", cwd, "Bash", cmd)).toBe("deny")
  })

  it("lets any thread read singularity's memory without asking, but nothing chained to it", () => {
    const cwd = join(tmpdir(), "proj")
    for (const access of ["ask", "auto-edit", "read-only"] as const) {
      expect(gate(access, cwd, "Bash", { command: 'singularity recall "fix the flaky test"' }), access).toBe("allow")
      expect(gate(access, cwd, "Bash", { command: "singularity changes" }), access).toBe("allow")
    }
    expect(gate("ask", cwd, "Bash", { command: 'singularity recall "x" && rm -rf .' })).toBe("ask")
    expect(gate("ask", cwd, "Bash", { command: "singularity store" })).toBe("ask")
    expect(gate("read-only", cwd, "Bash", { command: "singularity setup" })).toBe("deny")
  })
})

describe("memory at each task start", () => {
  const dirs: Array<string> = []
  const real = PROVIDERS.claude
  afterEach(() => {
    PROVIDERS.claude = real
    for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true })
  })

  /** Turns in a git project, one per message, on a fake Claude that records what it was given last. */
  const firstTurn = async (memory: Layer.Layer<Singularity.Memory>, options: { git?: boolean; messages?: ReadonlyArray<string> } = {}) => {
    const home = mkdtempSync(join(tmpdir(), "zero-home-"))
    const proj = mkdtempSync(join(tmpdir(), "zero-proj-"))
    dirs.push(home, proj)
    if (options.git !== false) {
      for (const args of [["init", "-q"], ["-c", "user.name=t", "-c", "user.email=t@t", "commit", "-q", "--allow-empty", "-m", "first"]]) {
        execFileSync("git", args, { cwd: proj })
      }
    }
    let given: TurnInput | undefined
    PROVIDERS.claude = { ...real, turn: (async function*(input: TurnInput) { given = input }) as Provider["turn"] }
    const layer = Layer.mergeAll(memory, StoreModule.layer(home)).pipe(Layer.provideMerge(NodeServices.layer))
    const t = await Effect.gen(function*() {
      const store = yield* Store
      const threads = yield* makeThreads({ zeroRoot: join(home, "no-genome"), hub: { send: () => {} }, nameThread: async () => "" })
      const project = yield* store.addProject(proj)
      const t = threads.create(project, { access: "ask" })
      for (const message of options.messages ?? ["add a retry to the fetch helper"]) yield* threads.turn(t, project, message)
      return store.thread(t.id)!
    }).pipe(Effect.provide(layer), Effect.runPromise)
    return { t, given: given!, memories: t.items.filter((i): i is Item & { kind: "memory" } => i.kind === "memory") }
  }

  const memoryWith = (recall: Singularity.Memory["Service"]["recall"]) =>
    Layer.succeed(Singularity.Memory, Singularity.Memory.of({ recall, store: () => Effect.void, changes: () => Effect.succeed([]) }))

  it("hands the agent the recalled change and tells it about singularity", async () => {
    const text = '# A past change in this repository like your task\n\ncommitted as abc1234567: "Retry the upload helper"'
    const { given, memories } = await firstTurn(memoryWith(() => Effect.succeed(Option.some({ commit: "abc1234567ff", text, score: 0.8 }))))
    expect(given.prompt).toContain(text)
    expect(given.instructions).toContain(Singularity.MEMORY_NOTE)
    expect(memories).toMatchObject([{ action: "recalled", commit: "abc1234567ff", title: "Retry the upload helper" }])
  })

  it("shows that memory was checked when nothing matched", async () => {
    const { given, memories } = await firstTurn(Singularity.empty)
    expect(given.prompt).toBe("add a retry to the fetch helper")
    expect(given.instructions).toContain("singularity recall")
    expect(memories).toMatchObject([{ action: "checked", commit: "", title: "nothing stored in this repo is like this task yet" }])
  })

  it("says so when singularity didn't answer, instead of going quiet", async () => {
    const { memories } = await firstTurn(memoryWith(() => Effect.fail(new MemoryError({ message: "singularity recall: not found" }))))
    expect(memories).toMatchObject([{ action: "checked", title: "singularity didn't answer: singularity recall: not found" }])
  })

  it("asks again at each message, and doesn't hand over the same change twice", async () => {
    const text = (subject: string) => `# A past change in this repository like your task

committed as abc1234567: "${subject}"`
    const asked: Array<string> = []
    const recall = (task: string) => {
      asked.push(task)
      if (task.startsWith("rename")) return Effect.succeed(Option.none())
      const commit = task.startsWith("add") ? "aaaaaaaaaa11" : "bbbbbbbbbb22"
      return Effect.succeed(Option.some({ commit, text: text(task.startsWith("add") ? "Retry the upload helper" : "Fix the bench flags"), score: 0.8 }))
    }
    const { given, memories } = await firstTurn(memoryWith(recall), { messages: ["add a retry", "rename the helper", "add a retry with backoff", "fix the bench flags"] })
    expect(asked).toEqual(["add a retry", "rename the helper", "add a retry with backoff", "fix the bench flags"])
    expect(memories.map((m) => [m.action, m.commit])).toEqual([
      ["recalled", "aaaaaaaaaa11"],
      ["checked", ""],
      ["checked", "aaaaaaaaaa11"],
      ["recalled", "bbbbbbbbbb22"]
    ])
    expect(memories[2]!.title).toBe("the same past change as earlier in this thread: Retry the upload helper")
    // The last message, a new task, was handed its own past change.
    expect(given.prompt).toContain("Fix the bench flags")
  })

  it("leaves memory out of a project that isn't a git repo", async () => {
    const { given, memories } = await firstTurn(Singularity.empty, { git: false })
    expect(given.instructions).not.toContain("singularity")
    expect(memories).toEqual([])
  })
})

describe("a running turn", () => {
  const dirs: Array<string> = []
  const real = PROVIDERS.claude
  afterEach(() => {
    PROVIDERS.claude = real
    for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true })
  })

  /** Runs a turn on a fake Claude; `during` gets the threads and thread once the turn asks for approval. */
  const run = (script: (input: TurnInput) => AsyncGenerator<never, void>, during: (threads: Effect.Success<ReturnType<typeof makeThreads>>, t: { id: string }) => void) => {
    const home = mkdtempSync(join(tmpdir(), "zero-home-"))
    const proj = mkdtempSync(join(tmpdir(), "zero-proj-"))
    dirs.push(home, proj)
    const events: Array<{ event: string; data: any }> = []
    const asked = Promise.withResolvers<void>()
    const hub = {
      send: (event: string, data: any) => {
        events.push({ event, data: structuredClone(data) })
        if (event === "item" && data.item.kind === "permission" && data.item.state === "pending") asked.resolve()
      }
    }
    PROVIDERS.claude = { ...real, turn: script as Provider["turn"] }
    const layer = Layer.mergeAll(Singularity.empty, StoreModule.layer(home)).pipe(Layer.provideMerge(NodeServices.layer))
    return Effect.gen(function*() {
      const store = yield* Store
      const threads = yield* makeThreads({ zeroRoot: join(home, "no-genome"), hub, nameThread: async () => "" })
      const project = yield* store.addProject(proj)
      const t = threads.create(project, { access: "ask" })
      const turn = Effect.runPromise(threads.turn(t, project, "go").pipe(Effect.provide(layer)))
      yield* Effect.promise(() => asked.promise)
      during(threads, t)
      yield* Effect.promise(() => turn)
      return { t: store.thread(t.id)!, events }
    }).pipe(Effect.provide(layer), Effect.runPromise)
  }

  it("answers a waiting approval when the access changes to one that settles it", async () => {
    let allowed: boolean | undefined
    let accessAfter: string | undefined
    const { t } = await run(async function*(input) {
      const file = join(input.cwd, "a.txt")
      allowed = await input.ask("Edit", file, () => gate(input.access(), input.cwd, "Edit", { file_path: file }))
      accessAfter = input.access()
    }, (threads, t) => threads.update(t as never, { access: "auto-edit" }))
    expect(allowed).toBe(true)
    expect(accessAfter).toBe("auto-edit")
    const ask = t.items.find((i): i is Item & { kind: "permission" } => i.kind === "permission")
    expect(ask?.state).toBe("allowed")
  })

  it("runs a waiting command when the thread switches to full access", async () => {
    let allowed: boolean | undefined
    await run(async function*(input) {
      allowed = await input.ask("Bash", "npm test", () => gate(input.access(), input.cwd, "Bash", { command: "npm test" }))
    }, (threads, t) => {
      // auto-edit doesn't settle a command: it keeps waiting until full access does.
      threads.update(t as never, { access: "auto-edit" })
      threads.update(t as never, { access: "full-access" })
    })
    expect(allowed).toBe(true)
  })

  it("denies a waiting approval when the thread turns read-only", async () => {
    let allowed: boolean | undefined
    await run(async function*(input) {
      const file = join(input.cwd, "a.txt")
      allowed = await input.ask("Edit", file, () => gate(input.access(), input.cwd, "Edit", { file_path: file }))
    }, (threads, t) => threads.update(t as never, { access: "read-only" }))
    expect(allowed).toBe(false)
  })

  it("streams text to the page line by line and keeps all of it", async () => {
    const { t, events } = await run(async function*(input) {
      yield { type: "text", key: "m:0", delta: "Hel" } as never
      yield { type: "text", key: "m:0", delta: "lo wor" } as never
      yield { type: "text", key: "m:0", delta: "ld\nsec" } as never
      await input.ask("Bash", "ls", () => "ask")
      yield { type: "text", key: "m:0", delta: "ond line" } as never
    }, (threads, t) => threads.answer(t.id, threads_pending(t), true))
    const sent = events.flatMap((e) =>
      e.event === "item" && e.data.item.kind === "assistant" ? [e.data.item.text] : e.event === "delta" ? [e.data.delta] : []
    )
    expect(sent).toEqual(["Hello world\n", "second line"])
    expect(t.items.find((i) => i.kind === "assistant")).toMatchObject({ text: "Hello world\nsecond line" })
  })
})

/** The id of the approval a thread is waiting on. */
const threads_pending = (t: { id: string; items?: Array<Item> }) => {
  const ask = (t as { items: Array<Item> }).items.find((i) => i.kind === "permission" && i.state === "pending")
  return ask!.id
}

describe("titles and compaction", () => {
  const dirs: Array<string> = []
  const real = { claude: PROVIDERS.claude, codex: PROVIDERS.codex }
  afterEach(() => {
    Object.assign(PROVIDERS, real)
    for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true })
  })

  /** Messages in one thread (not a git repo) on a fake provider; `name` stands in for the small model. */
  const thread = async (options: {
    messages: ReadonlyArray<string>
    name?: (message: string, model: string) => Promise<string>
    settings?: Partial<typeof DEFAULT_SETTINGS>
    provider?: "claude" | "codex"
    resume?: string
    script?: (input: TurnInput) => AsyncGenerator<any, void>
    between?: (t: Thread) => void
    compactFirst?: boolean
    hub?: (event: string, data: any) => void
  }) => {
    const home = mkdtempSync(join(tmpdir(), "zero-home-"))
    const proj = mkdtempSync(join(tmpdir(), "zero-proj-"))
    dirs.push(home, proj)
    const given: Array<TurnInput> = []
    const id = options.provider ?? "claude"
    PROVIDERS[id] = { ...real[id], turn: (async function*(input: TurnInput) {
      given.push(input)
      if (options.script) yield* options.script(input)
    }) as Provider["turn"] }
    const layer = Layer.mergeAll(Singularity.empty, StoreModule.layer(home)).pipe(Layer.provideMerge(NodeServices.layer))
    const t = await Effect.gen(function*() {
      const store = yield* Store
      yield* store.saveSettings({ ...DEFAULT_SETTINGS, ...options.settings })
      const threads = yield* makeThreads({ zeroRoot: join(home, "no-genome"), hub: { send: options.hub ?? (() => {}) }, nameThread: options.name ?? (async () => "") })
      const project = yield* store.addProject(proj)
      const t = threads.create(project, { provider: id })
      if (options.resume) t.resume = options.resume
      for (const m of options.messages) {
        yield* threads.turn(t, project, m, [], { compactFirst: options.compactFirst === true })
        options.between?.(t)
        // Let a title the small model is still working on land.
        yield* Effect.promise(() => new Promise((r) => setTimeout(r, 5)))
      }
      return store.thread(t.id)!
    }).pipe(Effect.provide(layer), Effect.runPromise)
    return { t, given }
  }

  it("has the small model name a new thread from its first message, once", async () => {
    const asked: Array<[string, string]> = []
    const { t } = await thread({
      messages: ["the login test fails on CI about half the time, can you look", "and the signup one?"],
      name: async (m, model) => (asked.push([m, model]), "Fix flaky login test")
    })
    expect(asked).toEqual([["the login test fails on CI about half the time, can you look", "claude-haiku-5-5"]])
    expect(t.title).toBe("Fix flaky login test")
  })

  it("keeps the first line when naming is off, or the small model can't answer", async () => {
    let called = false
    const off = await thread({ messages: ["add a retry to the fetch helper"], settings: { titles: { auto: false, model: "claude-haiku-5-5" } }, name: async () => (called = true, "Nope") })
    expect(called).toBe(false)
    expect(off.t.title).toBe("add a retry to the fetch helper")
    const failed = await thread({ messages: ["add a retry to the fetch helper"], name: async () => { throw new Error("offline") } })
    expect(failed.t.title).toBe("add a retry to the fetch helper")
  })

  it("doesn't name over a title the person gave meanwhile", async () => {
    let answer!: (s: string) => void
    const late = new Promise<string>((r) => (answer = r))
    const { t } = await thread({
      messages: ["add a retry to the fetch helper"],
      name: () => late,
      between: (t) => { t.title = "My own name"; answer("Add fetch retries") }
    })
    expect(t.title).toBe("My own name")
  })

  it("cleans a model's answer into a title", () => {
    expect(cleanTitle('Title: "Fix flaky login test."\nBecause…')).toBe("Fix flaky login test")
    expect(cleanTitle("**Add dark mode toggle**")).toBe("Add dark mode toggle")
    expect(cleanTitle("x".repeat(80))).toHaveLength(58)
  })

  it("knows /compact", () => {
    expect(isCompact("/compact")).toBe(true)
    expect(isCompact("  /compact keep the API notes ")).toBe(true)
    expect(isCompact("/compaction")).toBe(false)
    expect(isCompact("please /compact")).toBe(false)
  })

  it("passes /compact to Claude's session as it is, without memory or a title, and shows the compaction", async () => {
    const { t, given } = await thread({
      messages: ["/compact keep the API notes"],
      resume: "session-1",
      name: async () => "Should not be named",
      script: async function*() {
        yield { type: "compact", trigger: "manual", state: "running" }
        yield { type: "compact", trigger: "manual", state: "done", preTokens: 151000, postTokens: 12000 }
      }
    })
    expect(given.map((g) => [g.prompt, g.resume])).toEqual([["/compact keep the API notes", "session-1"]])
    expect(t.title).toBe("New thread")
    expect(t.items.filter((i) => i.kind === "memory")).toEqual([])
    const cards = t.items.filter((i) => i.kind === "compact")
    expect(cards).toMatchObject([{ trigger: "manual", state: "done", preTokens: 151000, postTokens: 12000 }])
    expect(t.items.at(-1)).toMatchObject({ kind: "turn", outcome: "done" })
  })

  it("shows a compaction Claude did on its own mid-turn", async () => {
    const { t } = await thread({
      messages: ["refactor the parser"],
      script: async function*() {
        yield { type: "text", key: "a", delta: "Working on it\n" }
        yield { type: "compact", trigger: "auto", state: "running" }
      }
    })
    // The turn ended with the compaction still open: it's closed, not left spinning.
    expect(t.items.filter((i) => i.kind === "compact")).toMatchObject([{ trigger: "auto", state: "done" }])
  })

  it("says why /compact can't run, instead of sending it as a task", async () => {
    const fresh = await thread({ messages: ["/compact"] })
    expect(fresh.given).toEqual([])
    expect(fresh.t.items.at(-1)).toMatchObject({ kind: "turn", outcome: "failed", error: "Nothing to compact yet: this thread has no session." })
    const codex = await thread({ messages: ["/compact"], provider: "codex", resume: "thread-1" })
    expect(codex.given).toEqual([])
    expect(codex.t.items.at(-1)).toMatchObject({ outcome: "failed", error: expect.stringContaining("compacts its context on its own") })
    expect(codex.t.status).toBe("idle")
  })

  it("keeps how full the context is, as the provider reports it", async () => {
    const { t } = await thread({
      messages: ["refactor the parser"],
      script: async function*() {
        yield { type: "context", used: 700000, limit: 967000 }
      }
    })
    expect(t.context).toEqual({ used: 700000, limit: 967000 })
    expect(needsCompaction(t.context)).toBe(true)
    expect(needsCompaction({ used: 100000, limit: 967000 })).toBe(false)
    expect(needsCompaction(undefined)).toBe(false)
  })

  it("compacts first and queues the message, then runs it, as one turn", async () => {
    const queuedWhileCompacting: Array<string | undefined> = []
    let shown: string | undefined
    const { t, given } = await thread({
      messages: ["now add the retry"],
      resume: "session-1",
      compactFirst: true,
      hub: (event, data) => { if (event === "thread" && data.queued) shown = data.queued },
      script: async function*(input) {
        if (input.prompt === "/compact") {
          yield { type: "compact", trigger: "manual", state: "running" }
          yield { type: "compact", trigger: "manual", state: "done", preTokens: 700000, postTokens: 30000 }
          yield { type: "usage", costUsd: 0.5, tokens: 10, cumulative: false }
        } else {
          yield { type: "text", key: "a", delta: "Added it\n" }
          yield { type: "usage", costUsd: 0.25, tokens: 5, cumulative: false }
        }
      },
      between: (t) => queuedWhileCompacting.push(t.queued)
    })
    expect(given.map((g) => g.prompt)).toEqual(["/compact", "now add the retry"])
    expect(shown).toBe("now add the retry")
    expect(queuedWhileCompacting).toEqual([undefined])
    // The compaction, then the message, then its answer, then one turn that counts both.
    expect(t.items.map((i) => i.kind)).toEqual(["compact", "user", "assistant", "turn"])
    expect(t.items.at(-1)).toMatchObject({ kind: "turn", outcome: "done", costUsd: 0.75, tokens: 15 })
  })

  it("doesn't compact first where it can't: no session yet, or a provider that takes no /compact", async () => {
    const fresh = await thread({ messages: ["start"], compactFirst: true })
    expect(fresh.given.map((g) => g.prompt)).toEqual(["start"])
    const codex = await thread({ messages: ["go on"], provider: "codex", resume: "thread-1", compactFirst: true })
    expect(codex.given.map((g) => g.prompt)).toEqual(["go on"])
  })

  it("offers compacting first when the context is filling or the thread sat idle an hour", () => {
    const at = (iso: string) => ({ kind: "turn", id: "end", at: iso } as unknown as Item)
    const base = { items: [at("2026-11-09T10:00:00.000Z")] } as unknown as Thread
    const t0 = Date.parse("2026-11-09T10:00:00.000Z")
    expect(compactionOffered(base, t0 + 59 * 60_000)).toBe(false)
    expect(compactionOffered(base, t0 + 60 * 60_000)).toBe(true)
    expect(compactionOffered({ ...base, context: { used: 700, limit: 1000 } }, t0)).toBe(true)
    expect(compactionOffered({ items: [] } as unknown as Thread, t0)).toBe(false)
  })

  it("shows a compaction the moment it starts, sized from the last turn, then fills it in", async () => {
    let seenBeforeProvider: unknown
    const { t } = await thread({
      messages: ["now add the retry"],
      resume: "session-1",
      compactFirst: true,
      hub: (event, data) => { if (event === "item" && data.item.kind === "compact" && seenBeforeProvider === undefined) seenBeforeProvider = data.item },
      between: () => {},
      script: async function*(input) {
        if (input.prompt !== "/compact") return
        yield { type: "compact", trigger: "manual", state: "running" }
        yield { type: "compact", trigger: "manual", state: "done", preTokens: 700000, postTokens: 30000, durationMs: 6600, summary: "Kept: the parser plan." }
      },
      settings: {}
    }).catch((e) => { throw e })
    expect(seenBeforeProvider).toMatchObject({ kind: "compact", state: "running", trigger: "manual" })
    const cards = t.items.filter((i) => i.kind === "compact")
    expect(cards).toHaveLength(1)
    expect(cards[0]).toMatchObject({ state: "done", preTokens: 700000, postTokens: 30000, durationMs: 6600, summary: "Kept: the parser plan." })
  })

  it("reads a compaction summary without the model's analysis", () => {
    expect(summaryOf("<analysis>\nthinking\n</analysis>\n<summary>\n1. Goal: spans\n</summary>")).toBe("1. Goal: spans")
    expect(summaryOf("<analysis>x</analysis> plain words")).toBe("plain words")
    expect(summaryOf(undefined)).toBe("")
  })
})
