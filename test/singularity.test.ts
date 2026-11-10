import * as NodeServices from "@effect/platform-node/NodeServices"
import { Effect, Layer, Option } from "effect"
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import * as Singularity from "../src/Singularity.ts"
import { hookContext, Memory, pointedCommit, readsCommits, toolNotes } from "../src/Singularity.ts"

/** A stand-in for singularity's hook.ts: answers as the real one does, and logs what it was given. */
const FAKE_HOOK = `
import { appendFileSync, readFileSync } from "node:fs"
const event = process.argv[2]
const input = JSON.parse(readFileSync(0, "utf8"))
appendFileSync(process.env.FAKE_HOOK_LOG, JSON.stringify({ event, args: process.argv.slice(3), input }) + "\\n")
const say = (text) => process.stdout.write(JSON.stringify({ hookSpecificOutput: { hookEventName: input.hook_event_name, additionalContext: text } }))
if (event === "user-prompt-pick") say('# A past change in this repository like your task\\n\\nAn earlier task here asked for something like yours, committed as 0123abcd: "Retry uploads"')
if (event === "user-prompt-submit") say("# Check scripts earlier sessions here ran\\n\\n- scripts/e2e.mjs")
if (event === "post-tool-use") say("Its session checked it with: npm run typecheck")
`

describe("singularity's hooks, as zero runs them", () => {
  let dir = ""
  const log = () => readFileSync(join(dir, "log.jsonl"), "utf8").trim().split("\n").map((l) => JSON.parse(l))
  const env = { hook: process.env["ZERO_SINGULARITY_HOOK"], log: process.env["FAKE_HOOK_LOG"] }
  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), "zero-hook-"))
    writeFileSync(join(dir, "hook.mjs"), FAKE_HOOK)
    writeFileSync(join(dir, "log.jsonl"), "")
    process.env["ZERO_SINGULARITY_HOOK"] = join(dir, "hook.mjs")
    process.env["FAKE_HOOK_LOG"] = join(dir, "log.jsonl")
  })
  afterAll(() => {
    for (const [k, v] of [["ZERO_SINGULARITY_HOOK", env.hook], ["FAKE_HOOK_LOG", env.log]] as const) {
      if (v === undefined) delete process.env[k]
      else process.env[k] = v
    }
    rmSync(dir, { recursive: true, force: true })
  })
  const memory = <A, E>(f: (m: Memory["Service"]) => Effect.Effect<A, E>) =>
    Effect.gen(function*() { return yield* f(yield* Memory) }).pipe(
      Effect.provide(Singularity.layer.pipe(Layer.provide(NodeServices.layer))),
      Effect.runPromise
    )

  it("hands over the model's pick and the check scripts together, under the thread's session", async () => {
    const h = await memory((m) => m.handOver({ session: "zero-thr_1", prompt: "retry uploads", cwd: dir, startsTask: false }))
    expect(Option.getOrThrow(h).commit).toBe("0123abcd")
    expect(Option.getOrThrow(h).text).toContain("# Check scripts earlier sessions here ran")
    const calls = log()
    expect(calls.map((c) => c.event).sort()).toEqual(["user-prompt-pick", "user-prompt-submit"])
    expect(calls.find((c) => c.event === "user-prompt-submit").args).toEqual(["--picks"])
    expect(calls[0].input).toMatchObject({ session_id: "zero-thr_1", prompt: "retry uploads", cwd: dir, hook_event_name: "UserPromptSubmit" })
  })

  it("passes on a git show to the tool-call hook, and nothing else", async () => {
    writeFileSync(join(dir, "log.jsonl"), "")
    const call = (command: string) => ({ hook_event_name: "PostToolUse", session_id: "claude-session", cwd: dir, tool_name: "Bash", tool_input: { command } })
    const shown = await memory((m) => m.afterTool(call("git show 0123abcd"), "zero-thr_1"))
    const listed = await memory((m) => m.afterTool(call("ls -la"), "zero-thr_1"))
    expect(shown).toEqual(Option.some("Its session checked it with: npm run typecheck"))
    expect(listed).toEqual(Option.none())
    expect(log()).toMatchObject([{ event: "post-tool-use", input: { session_id: "zero-thr_1" } }])
  })
})

describe("notes on a commit the agent reads", () => {
  it("come under their own session, so the change handed over at the start still gets its commands", async () => {
    const sessions: Array<string> = []
    const memory = Memory.of({
      recall: () => Effect.succeedNone,
      handOver: () => Effect.succeedNone,
      afterTool: (_input, session) => Effect.sync(() => (sessions.push(session), Option.some("ran: npm test"))),
      store: () => Effect.void,
      changes: () => Effect.succeed([])
    })
    expect(await toolNotes(memory, "zero-thr_1")({ tool_name: "Bash" })).toBe("ran: npm test")
    expect(sessions).toEqual(["zero-thr_1-tools"])
  })

  it("never fail the agent's call", async () => {
    const memory = Memory.of({
      recall: () => Effect.succeedNone,
      handOver: () => Effect.succeedNone,
      afterTool: () => Effect.die("boom"),
      store: () => Effect.void,
      changes: () => Effect.succeed([])
    })
    expect(await toolNotes(memory, "s")({})).toBeUndefined()
  })
})

describe("reading singularity's answers", () => {
  it("takes a hook's context, and nothing from empty or broken output", () => {
    expect(hookContext(JSON.stringify({ hookSpecificOutput: { additionalContext: "hi" } }))).toBe("hi")
    expect(hookContext("")).toBeUndefined()
    expect(hookContext("{oops")).toBeUndefined()
    expect(hookContext(JSON.stringify({ hookSpecificOutput: { additionalContext: "  " } }))).toBeUndefined()
  })

  it("finds the commit a hand-over points to", () => {
    expect(pointedCommit('committed as 0123abcd: "Retry uploads"')).toBe("0123abcd")
    expect(pointedCommit("# Check scripts earlier sessions here ran")).toBeNull()
  })

  it("starts the tool-call hook only for shell calls that read commits", () => {
    expect(readsCommits({ tool_name: "Bash", tool_input: { command: "git show HEAD~1" } })).toBe(true)
    expect(readsCommits({ tool_name: "Bash", tool_input: { command: "git log --oneline -5" } })).toBe(true)
    expect(readsCommits({ tool_name: "Bash", tool_input: { command: "npm test" } })).toBe(false)
    expect(readsCommits({ tool_name: "Read", tool_input: { file_path: "git show" } })).toBe(false)
  })
})
