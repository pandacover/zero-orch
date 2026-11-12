import { afterEach, describe, expect, it, vi } from "vitest"
import { DEFAULT_SETTINGS } from "../src/app/Model.ts"
import type { ThreadTools, TurnEvent, TurnInput } from "../src/app/providers/Provider.ts"

type Frame = Record<string, unknown>
type Sent = { readonly message: { readonly content: string }; readonly uuid: string }

/**
 * A fake Claude Code process in streaming-input mode: it reads each message from its prompt
 * stream and answers through `respond`, and frames go out in order until it's closed or crashes.
 */
class FakeSession {
  readonly sent: Array<Sent> = []
  readonly out: Array<Frame> = []
  wake: (() => void) | undefined
  closed = false
  crashed: Error | undefined
  model: string
  readonly interrupt = vi.fn(async () => {
    this.onInterrupt?.()
    return undefined
  })
  readonly setModel = vi.fn(async (m: string) => {
    this.model = m
  })
  readonly close = vi.fn(() => {
    this.closed = true
    this.wake?.()
  })
  onInterrupt: (() => void) | undefined
  readonly q: Record<string | symbol, unknown>
  readonly options: Record<string, any>
  constructor(options: Record<string, any>, prompt: AsyncIterable<Sent>) {
    this.options = options
    this.model = options["model"]
    this.q = {
      next: async () => {
        for (;;) {
          if (this.crashed) throw this.crashed
          if (this.out.length) return { done: false, value: this.out.shift() }
          if (this.closed) return { done: true, value: undefined }
          await new Promise<void>((resolve) => (this.wake = resolve))
        }
      },
      interrupt: this.interrupt,
      setModel: this.setModel,
      close: this.close,
      getContextUsage: async () => ({ totalTokens: 100 * this.sent.length, maxTokens: 1000 })
    }
    void (async () => {
      for await (const m of prompt) {
        this.sent.push(m)
        respond(this, m)
      }
    })()
  }
  emit(...frames: Array<Frame>) {
    this.out.push(...frames)
    this.wake?.()
  }
  crash(e: Error) {
    this.crashed = e
    this.wake?.()
  }
}

/** Every session the fake SDK started, in order. */
let fakes: Array<FakeSession> = []
const SESSION = "sess-1"
const text = (t: string, msg = "m") => ({ type: "stream_event", parent_tool_use_id: null, session_id: SESSION, event: { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: t } }, msg })
const result = (uuid: string | undefined, subtype = "success", cost = 0.01) => ({
  type: "result", subtype, session_id: SESSION, user_message_uuid: uuid, total_cost_usd: cost, usage: { input_tokens: 1, output_tokens: 1 }
})
/** By default a message is answered with its own text, echoed, and its result. */
let respond: (f: FakeSession, m: Sent) => void = (f, m) =>
  f.emit({ type: "system", subtype: "init", session_id: SESSION }, text(`re: ${m.message.content}`), result(m.uuid, "success", 0.01 * f.sent.length))

vi.mock("@anthropic-ai/claude-agent-sdk", () => ({
  query: ({ prompt, options }: { prompt: AsyncIterable<Sent>; options: Record<string, unknown> }) => {
    const f = new FakeSession(options, prompt)
    fakes.push(f)
    return f.q
  },
  tool: (name: string, _d: string, _s: unknown, handler: (a: unknown) => unknown) => ({ name, handler }),
  createSdkMcpServer: (o: unknown) => o
}))

const { claude, closeSession, closeSessions, IDLE_MS, STOP_GRACE_MS } = await import("../src/app/providers/Claude.ts")

const input = (over: Partial<TurnInput> = {}): TurnInput => ({
  threadId: "t1",
  cwd: process.cwd(),
  prompt: "hello",
  history: [],
  model: "claude-haiku-5-5",
  resume: null,
  instructions: "be brief",
  access: () => "full-access",
  settings: DEFAULT_SETTINGS,
  ask: async () => "allowed",
  signal: new AbortController().signal,
  ...over
})

/** A turn's events, and the session id it says to resume. */
const run = async (i: TurnInput) => {
  const events: Array<TurnEvent> = []
  for await (const e of claude.turn(i)) events.push(e)
  const said = events.flatMap((e) => (e.type === "text" ? [e.delta] : [])).join("")
  return { events, said, resume: events.find((e) => e.type === "session")?.resume ?? null }
}
const settled = () => new Promise((resolve) => setTimeout(resolve, 0))

afterEach(() => {
  closeSessions()
  fakes = []
  respond = (f, m) => f.emit({ type: "system", subtype: "init", session_id: SESSION }, text(`re: ${m.message.content}`), result(m.uuid, "success", 0.01 * f.sent.length))
  vi.useRealTimers()
})

describe("a thread's live Claude session", () => {
  it("runs every turn of a thread in one Claude Code process", async () => {
    const one = await run(input({ prompt: "one" }))
    const two = await run(input({ prompt: "two", resume: one.resume }))
    const three = await run(input({ prompt: "three", resume: two.resume }))
    expect(fakes).toHaveLength(1)
    expect(fakes[0]!.sent.map((m) => m.message.content)).toEqual(["one", "two", "three"])
    expect([one.said, two.said, three.said]).toEqual(["re: one", "re: two", "re: three"])
    expect(fakes[0]!.close).not.toHaveBeenCalled()
    // Each turn reports the session's running cost, and its context after it.
    expect(three.events.filter((e) => e.type === "usage")).toEqual([{ type: "usage", costUsd: 0.03, tokens: 2, cumulative: true }])
    expect(three.events.find((e) => e.type === "context")).toEqual({ type: "context", used: 300, limit: 1000 })
  })

  it("keeps separate sessions for separate threads, and a one-off turn's ends with it", async () => {
    await run(input({ threadId: "a" }))
    await run(input({ threadId: "b" }))
    await run(input({ threadId: undefined }))
    expect(fakes).toHaveLength(3)
    expect(fakes.map((f) => f.close.mock.calls.length)).toEqual([0, 0, 1])
  })

  it("lets no frame from between turns, or from a turn Claude Code started itself, into a turn", async () => {
    const one = await run(input({ prompt: "one" }))
    // Late frames after the result reach no one.
    fakes[0]!.emit(text("stray after turn one"))
    await settled()
    respond = (f, m) => f.emit(
      text("mine "),
      // Another message's result doesn't end this turn, and its cost isn't this turn's.
      result("someone-else", "success", 9),
      text("still mine"),
      result(m.uuid, "success", 0.02)
    )
    const two = await run(input({ prompt: "two", resume: one.resume }))
    expect(two.said).toBe("mine still mine")
    expect(two.events.filter((e) => e.type === "usage").map((e) => e.type === "usage" && e.costUsd)).toEqual([0.02])
  })

  it("stops a turn with an interrupt, keeps the session, and goes on in it", async () => {
    const stop = new AbortController()
    respond = (f, m) => {
      if (m.message.content !== "long") return respond0(f, m)
      f.emit(
        { type: "system", subtype: "init", session_id: SESSION },
        { type: "assistant", parent_tool_use_id: null, session_id: SESSION, message: { id: "m1", content: [{ type: "tool_use", id: "tu1", name: "Bash", input: { command: "sleep 99" } }] } }
      )
      f.onInterrupt = () => f.emit(
        { type: "user", parent_tool_use_id: null, session_id: SESSION, message: { role: "user", content: [{ type: "tool_result", tool_use_id: "tu1", is_error: true, content: "Interrupted" }] } },
        result(m.uuid, "error_during_execution")
      )
      setTimeout(() => stop.abort(), 5)
    }
    const one = await run(input({ prompt: "long", signal: stop.signal }))
    expect(fakes[0]!.interrupt).toHaveBeenCalledTimes(1)
    // The call the stop cut short shows as failed; the turn ends without an error.
    expect(one.events.filter((e) => e.type === "tool").map((e) => e.type === "tool" && e.status)).toEqual(["running", "failed"])
    const two = await run(input({ prompt: "go on", resume: one.resume }))
    expect(two.said).toBe("re: go on")
    expect(fakes).toHaveLength(1)
    expect(fakes[0]!.close).not.toHaveBeenCalled()
  })

  it("ends a session that doesn't stop in time, and resumes it next turn", async () => {
    vi.useFakeTimers()
    const stop = new AbortController()
    respond = (f, m) => {
      if (m.message.content !== "stuck") return respond0(f, m)
      f.emit({ type: "system", subtype: "init", session_id: SESSION }, text("working"))
    }
    const turn = run(input({ prompt: "stuck", signal: stop.signal })).then(() => "ended", (e: Error) => e.message)
    await vi.advanceTimersByTimeAsync(1)
    stop.abort()
    await vi.advanceTimersByTimeAsync(STOP_GRACE_MS + 1)
    // A stopped turn's provider error reads as "stopped" in the thread, since its signal was aborted.
    expect(await turn).toMatch(/session ended/)
    expect(fakes[0]!.close).toHaveBeenCalled()
    vi.useRealTimers()
    await run(input({ prompt: "again", resume: SESSION }))
    expect(fakes).toHaveLength(2)
    expect(fakes[1]!.options["resume"]).toBe(SESSION)
  })

  it("switches the model on the live session", async () => {
    const one = await run(input())
    await run(input({ model: "claude-sonnet-5-5", resume: one.resume }))
    expect(fakes).toHaveLength(1)
    expect(fakes[0]!.setModel).toHaveBeenCalledWith("claude-sonnet-5-5")
  })

  it.each([
    ["instructions", { instructions: "something new" }],
    ["effort", { settings: { ...DEFAULT_SETTINGS, claude: { ...DEFAULT_SETTINGS.claude, effort: "low" as const } } }],
    ["thread tools", { threads: {} as ThreadTools }]
  ] as const)("starts a new session that resumes the last when the %s change", async (_what, change) => {
    const one = await run(input())
    await run(input({ ...change, resume: one.resume }))
    expect(fakes).toHaveLength(2)
    expect(fakes[0]!.close).toHaveBeenCalled()
    expect(fakes[1]!.options["resume"]).toBe(SESSION)
  })

  it("starts a new session in a new folder, or when the thread starts its session over", async () => {
    const one = await run(input())
    await run(input({ cwd: `${process.cwd()}/elsewhere`, resume: one.resume }))
    expect(fakes).toHaveLength(2)
    // A thread that moved (or changed provider) has no session to resume.
    await run(input({ resume: null }))
    expect(fakes).toHaveLength(3)
    expect(fakes[2]!.options["resume"]).toBeUndefined()
  })

  it("compacts on the live session though a compaction comes without notes or tools", async () => {
    const one = await run(input({ threads: {} as ThreadTools }))
    await run(input({ prompt: "/compact", instructions: "", resume: one.resume }))
    await run(input({ prompt: "next", threads: {} as ThreadTools, resume: one.resume }))
    expect(fakes).toHaveLength(1)
  })

  it("ends a session left idle, and the next turn resumes it", async () => {
    vi.useFakeTimers()
    const one = await run(input())
    await vi.advanceTimersByTimeAsync(IDLE_MS - 1000)
    expect(fakes[0]!.close).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(2000)
    expect(fakes[0]!.close).toHaveBeenCalled()
    await run(input({ resume: one.resume }))
    expect(fakes).toHaveLength(2)
    expect(fakes[1]!.options["resume"]).toBe(SESSION)
  })

  it("fails the turn a crash cuts off, and resumes next turn", async () => {
    respond = (f) => {
      f.emit(text("half"))
      setTimeout(() => f.crash(new Error("process exited with code 1")), 5)
    }
    await expect(run(input())).rejects.toThrow("process exited with code 1")
    respond = respond0
    await run(input({ resume: SESSION }))
    expect(fakes).toHaveLength(2)
    expect(fakes[1]!.options["resume"]).toBe(SESSION)
  })

  it("closes a thread's session when asked, and every session at once", async () => {
    await run(input({ threadId: "a" }))
    await run(input({ threadId: "b" }))
    closeSession("a")
    expect(fakes.map((f) => f.closed)).toEqual([true, false])
    closeSessions()
    expect(fakes.map((f) => f.closed)).toEqual([true, true])
  })

  it("answers approvals and thread tools for the turn running now", async () => {
    const asked: Array<string> = []
    const listed: Array<string> = []
    let duringTurn: Promise<unknown> = Promise.resolve()
    respond = (f, m) => {
      // Claude Code asks about a call, and calls a thread tool, while this turn runs.
      const zero = f.options["mcpServers"].zero as { tools: Array<{ name: string; handler: (a: unknown) => Promise<unknown> }> }
      duringTurn = Promise.all([
        f.options["canUseTool"]("Bash", { command: "rm -rf x" }, {}),
        zero.tools.find((t) => t.name === "list_threads")!.handler({})
      ]).then(() => respond0(f, m))
    }
    const tools = (who: string): ThreadTools => ({
      start: async () => "", message: async () => "", wait: async () => "", list: async () => (listed.push(who), "")
    })
    const turn = (who: string, resume: string | null) =>
      run(input({ prompt: who, resume, access: () => "ask", threads: tools(who), ask: async (tool) => (asked.push(`${who}:${tool}`), "allowed") }))
    const one = await turn("first", null)
    await duringTurn
    await turn("second", one.resume)
    await duringTurn
    expect(fakes).toHaveLength(1)
    expect(asked).toEqual(["first:Bash", "second:Bash"])
    expect(listed).toEqual(["first", "second"])
    // Between turns, nothing is allowed.
    expect(await fakes[0]!.options["canUseTool"]("Bash", { command: "ls" }, {})).toMatchObject({ behavior: "deny" })
  })
})

const respond0 = (f: FakeSession, m: Sent) =>
  f.emit({ type: "system", subtype: "init", session_id: SESSION }, text(`re: ${m.message.content}`), result(m.uuid, "success", 0.01 * f.sent.length))
