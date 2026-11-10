/**
 * Claude, through the Claude Agent SDK: Claude Code's own agent loop and
 * tools, streamed token by token, continued across turns with `resume`.
 *
 * Every tool call goes through `canUseTool`, which follows the thread's
 * access: reads run, edits inside the project run under `auto-edit`,
 * everything runs under `full-access`, and anything else waits for the
 * person to allow it in the thread.
 */
import { type CanUseTool, type Query, query, type SDKMessage, type SDKUserMessage } from "@anthropic-ai/claude-agent-sdk"
import { memoryHooks } from "../../Claude.ts"
import { MODELS } from "../../Genome.ts"
import { cleanEnv } from "../../Proc.ts"
import { inside, isMemoryRead } from "../../Policy.ts"
import { type Access, isCompact } from "../Model.ts"
import type { Provider, TurnEvent, TurnInput, Verdict } from "./Provider.ts"
import { keepOutput, notRun, short } from "./Provider.ts"

export const CLAUDE_MODELS = [...MODELS]

const TOOLS = ["Read", "Glob", "Grep", "Edit", "Write", "Bash", "WebSearch", "WebFetch"]
const READS = new Set(["Read", "Glob", "Grep", "WebSearch", "WebFetch"])
const EDITS = new Set(["Edit", "Write", "MultiEdit", "NotebookEdit"])

const detailOf = (_tool: string, input: Record<string, unknown>): string =>
  short(input["command"] ?? input["file_path"] ?? input["pattern"] ?? input["url"] ?? input["query"] ?? input, 400)

/** Whether a call runs without asking, is refused, or waits for the person. */
export const gate = (access: Access, cwd: string, tool: string, input: Record<string, unknown>): "allow" | "deny" | "ask" => {
  if (READS.has(tool)) return "allow"
  // Reading singularity's memory is a read: an agent shouldn't have to ask to recall.
  if (tool === "Bash" && isMemoryRead(input["command"])) return "allow"
  if (access === "read-only") return "deny"
  if (access === "full-access") return "allow"
  if (EDITS.has(tool)) {
    const path = input["file_path"] ?? input["notebook_path"]
    const inProject = typeof path === "string" && inside(cwd, path) !== undefined
    return access === "auto-edit" && inProject ? "allow" : "ask"
  }
  return "ask"
}

const resultText = (content: unknown): string => {
  if (typeof content === "string") return content
  if (Array.isArray(content)) {
    return content.map((c) => (c && typeof c === "object" && "text" in c ? String((c as { text: unknown }).text) : "")).join("\n")
  }
  return ""
}

async function* turn(input: TurnInput): AsyncGenerator<TurnEvent> {
  const abort = new AbortController()
  input.signal.addEventListener("abort", () => abort.abort(), { once: true })
  const canUseTool: CanUseTool = async (tool, toolInput) => {
    // Read the access now, not at the turn's start: the person may have changed it since.
    const now = () => gate(input.access(), input.cwd, tool, toolInput)
    const verdict = now()
    if (verdict === "allow") return { behavior: "allow", updatedInput: toolInput }
    if (verdict === "deny") return { behavior: "deny", message: "This thread is read-only. Say what you'd change instead." }
    // The agent hears why a call didn't run: only the person's Deny reads as a no.
    let answer: Verdict
    try {
      answer = await input.ask(tool, detailOf(tool, toolInput), now)
    } catch (e) {
      return { behavior: "deny", message: notRun({ failure: e instanceof Error ? e.message : String(e) }) }
    }
    return answer === "allowed" ? { behavior: "allow", updatedInput: toolInput } : { behavior: "deny", message: notRun(answer) }
  }
  // The message goes in as a stream held open until the turn's result, so the session can
  // still be asked how full its context is (a plain string prompt closes it at the result).
  let release = () => {}
  const held = new Promise<void>((resolve) => (release = resolve))
  input.signal.addEventListener("abort", () => release(), { once: true })
  async function* prompt(): AsyncGenerator<SDKUserMessage> {
    yield { type: "user", message: { role: "user", content: input.prompt }, parent_tool_use_id: null, session_id: "" }
    await held
  }
  const messages = query({
    prompt: prompt(),
    options: {
      cwd: input.cwd,
      model: input.model,
      effort: input.settings.claude.effort,
      systemPrompt: { type: "preset", preset: "claude_code", append: input.instructions },
      tools: TOOLS,
      // The project's own CLAUDE.md and settings, as Claude Code would read them there.
      settingSources: ["project"],
      permissionMode: "default",
      canUseTool,
      includePartialMessages: true,
      abortController: abort,
      // Native compaction stays on whatever the machine's settings or environment say:
      // a long thread compacts itself when its context fills, and `/compact` always works.
      settings: { autoCompactEnabled: true },
      hooks: {
        PostCompact: [{ hooks: [async (h) => {
          if (h.hook_event_name === "PostCompact") summary = summaryOf(h.compact_summary)
          return {}
        }] }],
        ...memoryHooks(input.afterTool)
      },
      env: cleanEnv({ DISABLE_AUTO_COMPACT: undefined, DISABLE_COMPACT: undefined }),
      ...(input.resume ? { resume: input.resume } : {})
    }
  })

  let session: string | undefined
  let messageId = ""
  const streamed = new Set<string>()
  const tools = new Map<string, { name: string; detail: string }>()
  const announced = new Set<string>()
  const pending: Array<TurnEvent> = []
  // Compaction the person asked for with `/compact`; any other is Claude Code's own, as the context filled.
  const asked = isCompact(input.prompt)
  let compacting = false
  // The summary arrives through Claude Code's PostCompact hook, just before the compaction's boundary message.
  let summary = ""
  try {
  for await (const m of messages as AsyncIterable<SDKMessage>) {
    if (session === undefined && "session_id" in m && typeof m.session_id === "string") {
      session = m.session_id
      yield { type: "session", resume: session }
    }
    if (m.type === "system" && m.subtype === "status") {
      if (m.status === "compacting" && !compacting) {
        compacting = true
        yield { type: "compact", trigger: asked ? "manual" : "auto", state: "running" }
      }
      if (m.compact_result === "failed") {
        compacting = false
        yield { type: "compact", trigger: asked ? "manual" : "auto", state: "failed", error: m.compact_error ?? "" }
      }
      continue
    }
    if (m.type === "system" && m.subtype === "compact_boundary") {
      compacting = false
      const c = m.compact_metadata
      yield { type: "compact", trigger: c.trigger, state: "done", preTokens: c.pre_tokens, postTokens: c.post_tokens, durationMs: c.duration_ms, summary }
      summary = ""
      continue
    }
    if (m.type === "stream_event") {
      if (m.parent_tool_use_id) continue
      const e = m.event
      if (e.type === "message_start") messageId = e.message.id
      if (e.type === "content_block_delta" && e.delta.type === "text_delta") {
        streamed.add(messageId)
        yield { type: "text", key: `${messageId}:${e.index}`, delta: e.delta.text }
      }
      continue
    }
    if (m.type === "assistant") {
      if (m.parent_tool_use_id) continue
      m.message.content.forEach((block, i) => {
        if (block.type === "tool_use") {
          tools.set(block.id, { name: block.name, detail: detailOf(block.name, block.input as Record<string, unknown>) })
        }
        // Text that didn't arrive as deltas (a provider without partial messages) arrives whole.
        if (block.type === "text" && !streamed.has(m.message.id)) pending.push({ type: "text", key: `${m.message.id}:${i}`, delta: block.text })
      })
      for (const [id, t] of tools) {
        if (announced.has(id)) continue
        announced.add(id)
        pending.push({ type: "tool", key: id, name: t.name, detail: t.detail, status: "running" })
      }
      yield* pending.splice(0)
      continue
    }
    if (m.type === "user" && Array.isArray(m.message.content)) {
      for (const block of m.message.content) {
        if (typeof block !== "object" || block.type !== "tool_result") continue
        const t = tools.get(block.tool_use_id)
        if (!t) continue
        yield {
          type: "tool",
          key: block.tool_use_id,
          name: t.name,
          detail: t.detail,
          status: block.is_error ? "failed" : "done",
          output: keepOutput(resultText(block.content))
        }
      }
      continue
    }
    if (m.type === "result") {
      const context = await contextOf(messages)
      release()
      if (context) yield { type: "context", ...context }
      yield { type: "usage", costUsd: m.total_cost_usd, tokens: m.usage.input_tokens + m.usage.output_tokens, cumulative: true }
      if (m.subtype !== "success" && !abort.signal.aborted) throw new Error(`Claude stopped: ${m.subtype.replace(/_/g, " ")}${m.errors?.length ? `: ${m.errors.join("; ")}` : ""}`)
    }
  }
  } finally {
    release()
  }
}

/** A compaction summary as a person reads it: its <summary> part when it has one, without the model's <analysis>. */
export const summaryOf = (raw: string | undefined): string => {
  const text = raw ?? ""
  const inner = /<summary>([\s\S]*?)(?:<\/summary>|$)/.exec(text)?.[1]
  return (inner ?? text.replace(/<analysis>[\s\S]*?<\/analysis>/g, "")).trim()
}

/**
 * How full the session's context is after a turn, against the point where Claude Code compacts
 * it on its own; undefined when the session can't say (it never holds up the turn for long).
 */
const contextOf = async (q: Query): Promise<{ used: number; limit: number } | undefined> => {
  try {
    const u = await Promise.race([q.getContextUsage({ detail: "summary" }), new Promise<never>((_, no) => setTimeout(() => no(new Error("slow")), 5000))])
    const limit = u.autoCompactThreshold ?? u.maxTokens
    return limit > 0 ? { used: u.totalTokens, limit } : undefined
  } catch {
    return undefined
  }
}

const TITLE_PROMPT = `You name conversations with a coding agent. Reply with a title for the conversation that starts with the person's message: 3 to 7 words, sentence case, no quotes, no trailing period, nothing else. Name the task, not the person ("Fix flaky login test", "Add dark mode toggle").`

const COMMIT_PROMPT = `You write git commit messages. Reply with the message only: a subject line in the imperative mood, at most 72 characters, saying what the change does ("Retry failed uploads three times"). Add a blank line and at most three short lines on why only when the subject can't carry it. No code fences, quotes, labels or prefixes like "feat:".`

/** A title for a thread from its first message, by a small model (no tools, no session kept); "" when it can't. */
export const nameThread = async (message: string, model: string): Promise<string> =>
  cleanTitle(await answer(`<message>\n${message.slice(0, 4000)}\n</message>`, TITLE_PROMPT, model))

/** A commit message for the uncommitted change (GitInfo `pendingChange`), by a small model; "" when it can't. */
export const commitMessage = async (change: string, model: string): Promise<string> =>
  cleanMessage(await answer(`<change>\n${change}\n</change>`, COMMIT_PROMPT, model))

/** A model's answer as a commit message: no code fence, subject first, at most 72 characters on it. */
export const cleanMessage = (raw: string): string => {
  const lines = raw.replace(/^```\w*\n?|\n?```\s*$/g, "").trim().split("\n").map((l) => l.trimEnd())
  const subject = (lines[0] ?? "").replace(/^(subject|commit message)\s*:\s*/i, "").replace(/^["'`]+|["'`]+$/g, "").trim()
  if (!subject) return ""
  return [subject.length > 72 ? subject.slice(0, 72).trimEnd() : subject, ...lines.slice(1)].join("\n").trim()
}

/** A small model's one answer, with no tools and no session kept; "" when it can't answer in 30 seconds. */
const answer = async (prompt: string, system: string, model: string): Promise<string> => {
  const abort = new AbortController()
  const timer = setTimeout(() => abort.abort(), 30_000)
  try {
    const messages = query({
      prompt,
      options: {
        model,
        systemPrompt: system,
        tools: [],
        maxTurns: 1,
        settingSources: [],
        persistSession: false,
        abortController: abort,
        env: cleanEnv()
      }
    })
    for await (const m of messages as AsyncIterable<SDKMessage>) {
      if (m.type === "result") return m.subtype === "success" ? m.result : ""
    }
    return ""
  } catch {
    return ""
  } finally {
    clearTimeout(timer)
  }
}

/** A model's answer as a title: one line, no quotes, labels or trailing period, at most 60 characters. */
export const cleanTitle = (raw: string): string => {
  const line = raw.trim().split("\n")[0]!.replace(/^(title|thread)\s*:\s*/i, "").replace(/^["'`*#\s]+|["'`*\s.]+$/g, "").replace(/\s+/g, " ")
  return line.length > 60 ? `${line.slice(0, 57).trimEnd()}…` : line
}

export const claude: Provider = {
  id: "claude",
  label: "Claude",
  compaction: "manual",
  defaultModel: (s) => s.claude.model,
  status: async (s) => ({
    available: s.claude.enabled,
    detail: s.claude.enabled ? "Claude Agent SDK, signed in as Claude Code is" : "Turned off in settings",
    models: CLAUDE_MODELS,
    asks: true,
    tools: true
  }),
  turn
}
