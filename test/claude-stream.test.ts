import { describe, expect, it, vi } from "vitest"
import { DEFAULT_SETTINGS } from "../src/app/Model.ts"
import type { TurnEvent, TurnInput } from "../src/app/providers/Provider.ts"

/** The messages the fake Agent SDK session sends, in order; set by each test. */
let script: Array<Record<string, unknown>> = []

vi.mock("@anthropic-ai/claude-agent-sdk", () => ({
  query: () => {
    async function* messages() {
      for (const m of script) yield m
    }
    const q = messages() as AsyncGenerator<Record<string, unknown>> & { getContextUsage: () => Promise<never>; close: () => void }
    q.getContextUsage = () => Promise.reject(new Error("not in tests"))
    q.close = () => {}
    return q
  }
}))

const { claude, earlyDetail, editDiff, limitOf, partialFields, usableCommands } = await import("../src/app/providers/Claude.ts")

const input = (): TurnInput => ({
  cwd: process.cwd(),
  prompt: "write it",
  history: [],
  model: "claude-haiku-5-5",
  resume: null,
  instructions: "",
  access: () => "full-access",
  settings: DEFAULT_SETTINGS,
  ask: async () => "allowed",
  signal: new AbortController().signal
})

const stream = (event: Record<string, unknown>) => ({ type: "stream_event", parent_tool_use_id: null, session_id: "s1", event })

describe("a tool call's input as it streams", () => {
  it("reads the top-level string fields that have streamed in whole", () => {
    expect(partialFields(`{"file_path":"C:\\\\a\\\\b.ts","content":"export const`)).toEqual({ file_path: "C:\\a\\b.ts" })
    expect(partialFields(`{"command":"echo \\"hi\\"","description":"Say`)).toEqual({ command: "echo \"hi\"" })
    expect(partialFields(`{"file_path":"src/a.t`)).toEqual({})
    expect(partialFields("")).toEqual({})
  })

  it("skips nested fields and keys spelled inside strings", () => {
    expect(partialFields(`{"edits":[{"command":"no"}],"content":"{\\"command\\": \\"no\\"}","file_path":"a.ts"}`)).toEqual({ content: "{\"command\": \"no\"}", file_path: "a.ts" })
  })

  it("gives a card's detail only once a field it shows is whole", () => {
    expect(earlyDetail("Write", `{"file_path":"a.ts","content":"x`)).toBe("a.ts")
    expect(earlyDetail("Write", `{"file_path":"a.t`)).toBe("")
    expect(earlyDetail("TodoWrite", `{"todos":[{"content":"x"}]`)).toBe("")
  })
})

describe("Claude's tool cards", () => {
  it("go up as the model starts writing a call, get its file once that has streamed, and end with its result", async () => {
    const id = "toolu_1"
    script = [
      stream({ type: "message_start", message: { id: "msg_1" } }),
      stream({ type: "content_block_start", index: 0, content_block: { type: "tool_use", id, name: "Write", input: {} } }),
      stream({ type: "content_block_delta", index: 0, delta: { type: "input_json_delta", partial_json: "{\"file_path\":\"src/a" } }),
      stream({ type: "content_block_delta", index: 0, delta: { type: "input_json_delta", partial_json: ".ts\",\"content\":\"export const a" } }),
      stream({ type: "content_block_delta", index: 0, delta: { type: "input_json_delta", partial_json: " = 1\\n\"}" } }),
      stream({ type: "content_block_stop", index: 0 }),
      { type: "assistant", parent_tool_use_id: null, session_id: "s1", message: { id: "msg_1", content: [{ type: "tool_use", id, name: "Write", input: { file_path: "src/a.ts", content: "export const a = 1\n" } }] } },
      { type: "user", parent_tool_use_id: null, session_id: "s1", message: { role: "user", content: [{ type: "tool_result", tool_use_id: id, content: "written" }] } },
      { type: "result", subtype: "success", session_id: "s1", total_cost_usd: 0.01, usage: { input_tokens: 1, output_tokens: 1 } }
    ]
    const events: Array<TurnEvent> = []
    for await (const e of claude.turn(input())) events.push(e)
    const cards = events.filter((e): e is Extract<TurnEvent, { type: "tool" }> => e.type === "tool")
    expect(cards.map((c) => [c.status, c.detail])).toEqual([
      ["running", ""], // the call's first token: before any of its input
      ["running", "src/a.ts"], // its file, while its content still streams
      ["done", "src/a.ts"]
    ])
    expect(cards.every((c) => c.key === id && c.name === "Write")).toBe(true)
  })

  it("still shows a call that arrives whole, without partial messages", async () => {
    script = [
      { type: "assistant", parent_tool_use_id: null, session_id: "s1", message: { id: "msg_1", content: [{ type: "tool_use", id: "toolu_2", name: "Bash", input: { command: "ls" } }] } },
      { type: "user", parent_tool_use_id: null, session_id: "s1", message: { role: "user", content: [{ type: "tool_result", tool_use_id: "toolu_2", content: "a" }] } },
      { type: "result", subtype: "success", session_id: "s1", total_cost_usd: 0, usage: { input_tokens: 1, output_tokens: 1 } }
    ]
    const cards: Array<[string, string]> = []
    for await (const e of claude.turn(input())) if (e.type === "tool") cards.push([e.status, e.detail])
    expect(cards).toEqual([["running", "ls"], ["done", "ls"]])
  })
})

describe("Claude's usage limits", () => {
  it("passes the plan's usage windows on as they're reported, as a share and a time", async () => {
    script = [
      { type: "rate_limit_event", session_id: "s1", uuid: "u1", rate_limit_info: { status: "allowed_warning", rateLimitType: "five_hour", utilization: 0.82, resetsAt: 1794000000 } },
      { type: "rate_limit_event", session_id: "s1", uuid: "u2", rate_limit_info: { status: "allowed" } },
      { type: "result", subtype: "success", session_id: "s1", total_cost_usd: 0, usage: { input_tokens: 1, output_tokens: 1 } }
    ]
    const limits: Array<unknown> = []
    for await (const e of claude.turn(input())) if (e.type === "limit") limits.push(e.limit)
    // One that names no window says nothing to show.
    expect(limits).toEqual([{ kind: "five_hour", status: "allowed_warning", used: 0.82, resetsAt: new Date(1794000000 * 1000).toISOString(), at: expect.any(String) }])
  })

  it("reads a percentage as a share, and keeps an unknown share unknown", () => {
    expect(limitOf({ status: "allowed", rateLimitType: "seven_day", utilization: 57 })?.used).toBe(0.57)
    expect(limitOf({ status: "allowed", rateLimitType: "seven_day" })).toMatchObject({ used: null, resetsAt: null })
    expect(limitOf(undefined)).toBeUndefined()
  })
})

describe("what an edit changed, for its card", () => {
  it("marks an Edit's old lines removed and its new lines added", () => {
    expect(editDiff("Edit", { file_path: "a.ts", old_string: "a\nb\n", new_string: "a\nc" })).toBe("@@\n-a\n-b\n+a\n+c")
  })
  it("keeps a MultiEdit's pieces apart, and shows a Write as all added", () => {
    expect(editDiff("MultiEdit", { edits: [{ old_string: "x", new_string: "y" }, { old_string: "p", new_string: "" }] })).toBe("@@\n-x\n+y\n@@\n-p")
    expect(editDiff("Write", { file_path: "n.ts", content: "one\ntwo\n" })).toBe("@@ new content\n+one\n+two")
  })
  it("gives nothing for other tools or an empty change, and cuts a long one", () => {
    expect(editDiff("Bash", { command: "ls" })).toBeUndefined()
    expect(editDiff("Edit", { file_path: "a.ts" })).toBeUndefined()
    const long = editDiff("Write", { content: Array.from({ length: 400 }, (_, i) => `l${i}`).join("\n") })!.split("\n")
    expect(long).toHaveLength(301)
    expect(long.at(-1)).toBe("@@ 101 more lines")
  })
})

describe("the slash commands a composer offers", () => {
  it("keeps the person's, the project's and skills, a few of Claude Code's own, and none of the terminal's", () => {
    const list = [
      { name: "review", description: "Review a PR", argumentHint: "", builtin: true },
      { name: "clear", description: "Clear the conversation", argumentHint: "", builtin: true },
      { name: "compact", description: "Compact", argumentHint: "", builtin: true },
      { name: "deploy", description: "Ship it", argumentHint: "<env>" },
      { name: "statusline", description: "Set up the status line", argumentHint: "" },
      { name: "deploy", description: "a second row with the same name", argumentHint: "" }
    ]
    expect(usableCommands(list, ["statusline"])).toEqual([
      { name: "deploy", description: "Ship it", hint: "<env>" },
      { name: "review", description: "Review a PR", hint: "" }
    ])
  })
})
