/**
 * Claude, through the Claude Agent SDK: Claude Code's own agent loop and
 * tools, streamed token by token, continued across turns with `resume`.
 *
 * Every tool call goes through `canUseTool`, which follows the thread's
 * access: reads run, edits inside the project run under `auto-edit`, and
 * everything else waits for the person to allow it in the thread.
 */
import { type CanUseTool, query, type SDKMessage } from "@anthropic-ai/claude-agent-sdk"
import { MODELS } from "../../Genome.ts"
import { cleanEnv } from "../../Proc.ts"
import { inside } from "../../Policy.ts"
import type { Provider, TurnEvent, TurnInput } from "./Provider.ts"
import { keepOutput, short } from "./Provider.ts"

export const CLAUDE_MODELS = [...MODELS]

const TOOLS = ["Read", "Glob", "Grep", "Edit", "Write", "Bash", "WebSearch", "WebFetch"]
const READS = new Set(["Read", "Glob", "Grep", "WebSearch", "WebFetch"])
const EDITS = new Set(["Edit", "Write", "MultiEdit", "NotebookEdit"])

const detailOf = (_tool: string, input: Record<string, unknown>): string =>
  short(input["command"] ?? input["file_path"] ?? input["pattern"] ?? input["url"] ?? input["query"] ?? input, 400)

/** Whether a call runs without asking, is refused, or waits for the person. */
export const gate = (access: TurnInput["access"], cwd: string, tool: string, input: Record<string, unknown>): "allow" | "deny" | "ask" => {
  if (READS.has(tool)) return "allow"
  if (access === "read-only") return "deny"
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
    const verdict = gate(input.access, input.cwd, tool, toolInput)
    if (verdict === "allow") return { behavior: "allow", updatedInput: toolInput }
    if (verdict === "deny") return { behavior: "deny", message: "This thread is read-only. Say what you'd change instead." }
    const ok = await input.ask(tool, detailOf(tool, toolInput))
    return ok
      ? { behavior: "allow", updatedInput: toolInput }
      : { behavior: "deny", message: "The person declined this. Ask them how to proceed, or take another way." }
  }
  const messages = query({
    prompt: input.prompt,
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
      env: cleanEnv(),
      ...(input.resume ? { resume: input.resume } : {})
    }
  })

  let session: string | undefined
  let messageId = ""
  const streamed = new Set<string>()
  const tools = new Map<string, { name: string; detail: string }>()
  const announced = new Set<string>()
  const pending: Array<TurnEvent> = []
  for await (const m of messages as AsyncIterable<SDKMessage>) {
    if (session === undefined && "session_id" in m && typeof m.session_id === "string") {
      session = m.session_id
      yield { type: "session", resume: session }
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
      yield { type: "usage", costUsd: m.total_cost_usd, tokens: m.usage.input_tokens + m.usage.output_tokens }
      if (m.subtype !== "success" && !abort.signal.aborted) throw new Error(`Claude stopped: ${m.subtype.replace(/_/g, " ")}${m.errors?.length ? `: ${m.errors.join("; ")}` : ""}`)
    }
  }
}
export const claude: Provider = {
  id: "claude",
  label: "Claude",
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
