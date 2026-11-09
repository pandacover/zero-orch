/**
 * Codex, through OpenAI's Codex SDK: Codex's own agent and sandbox, signed
 * in as the Codex CLI is (`~/.codex`), continued across turns by thread id.
 *
 * Codex can't pause mid-turn for approval through the SDK, so a thread's
 * access picks its sandbox instead: `read-only` runs Codex read-only, and
 * the others let it write inside the project (`workspace-write`).
 */
import { Codex, type ThreadItem } from "@openai/codex-sdk"
import { readFileSync } from "node:fs"
import { homedir } from "node:os"
import { join } from "node:path"
import { cleanEnv } from "../../Proc.ts"
import type { Provider, TurnEvent, TurnInput } from "./Provider.ts"
import { keepOutput, short } from "./Provider.ts"

const describe = (item: ThreadItem): { name: string; detail: string; output: string } | undefined => {
  switch (item.type) {
    case "command_execution":
      return { name: "Shell", detail: short(item.command, 400), output: item.aggregated_output }
    case "file_change":
      return { name: "Edit", detail: item.changes.map((c) => `${c.kind} ${c.path}`).join(", "), output: "" }
    case "mcp_tool_call":
      return { name: `${item.server}.${item.tool}`, detail: short(item.arguments, 400), output: item.error?.message ?? "" }
    case "web_search":
      return { name: "WebSearch", detail: item.query, output: "" }
    case "error":
      // Mid-turn errors from Codex are warnings (config notices, fallbacks); a real failure ends the turn.
      return { name: "Notice", detail: item.message, output: "" }
    default:
      return undefined
  }
}

const statusOf = (item: ThreadItem, completed: boolean): "running" | "done" | "failed" => {
  if ("status" in item) {
    if (item.status === "failed") return "failed"
    if (item.status === "completed") return "done"
  }
  return completed ? "done" : "running"
}

async function* turn(input: TurnInput): AsyncGenerator<TurnEvent> {
  const codex = new Codex({ env: cleanEnv() })
  const options = {
    workingDirectory: input.cwd,
    skipGitRepoCheck: true,
    sandboxMode: input.access() === "read-only" ? ("read-only" as const) : ("workspace-write" as const),
    approvalPolicy: "never" as const,
    ...(input.model && input.model !== DEFAULT ? { model: input.model } : {}),
    ...(input.settings.codex.effort ? { modelReasoningEffort: input.settings.codex.effort } : {})
  }
  const thread = input.resume ? codex.resumeThread(input.resume, options) : codex.startThread(options)
  // Codex has no separate system prompt here: instructions lead the thread's first message.
  const prompt = !input.resume && input.instructions
    ? `<instructions>\n${input.instructions}\n</instructions>\n\n${input.prompt}`
    : input.prompt
  const { events } = await thread.runStreamed(prompt, { signal: input.signal })

  const said = new Map<string, number>()
  for await (const e of events) {
    if (e.type === "thread.started") yield { type: "session", resume: e.thread_id }
    else if (e.type === "item.started" || e.type === "item.updated" || e.type === "item.completed") {
      const item = e.item
      if (item.type === "agent_message") {
        // Codex sends the whole message so far; pass on only what's new.
        const before = said.get(item.id) ?? 0
        if (item.text.length > before) {
          yield { type: "text", key: item.id, delta: item.text.slice(before) }
          said.set(item.id, item.text.length)
        }
        continue
      }
      const d = describe(item)
      if (d) {
        yield {
          type: "tool",
          key: item.id,
          name: d.name,
          detail: d.detail,
          status: statusOf(item, e.type === "item.completed"),
          output: keepOutput(d.output)
        }
      }
    } else if (e.type === "turn.completed") {
      yield { type: "usage", costUsd: null, tokens: e.usage.input_tokens + e.usage.output_tokens }
    } else if (e.type === "turn.failed") {
      throw new Error(`Codex: ${e.error.message}`)
    } else if (e.type === "error") {
      throw new Error(`Codex: ${e.message}`)
    }
  }
}

const DEFAULT = "Codex default"
const codexHome = () => process.env["CODEX_HOME"] ?? join(homedir(), ".codex")

/** The models Codex lists for this account, from its own cache, and the model its config names. */
export const codexModels = (home = codexHome()): { listed: Array<string>; configured: string | undefined } => {
  let listed: Array<string> = []
  try {
    const cache = JSON.parse(readFileSync(join(home, "models_cache.json"), "utf8")) as { models?: Array<{ slug?: string; visibility?: string }> }
    listed = (cache.models ?? []).filter((m) => m.slug && m.visibility === "list").map((m) => m.slug!)
  } catch {
    // no cache yet: Codex writes it on its first run
  }
  let configured: string | undefined
  try {
    configured = /^\s*model\s*=\s*"([^"]+)"/m.exec(readFileSync(join(home, "config.toml"), "utf8"))?.[1]
  } catch {
    // no config
  }
  return { listed, configured }
}

export const codex: Provider = {
  id: "codex",
  label: "Codex",
  // Codex compacts its own thread when the context fills; its SDK takes no `/compact`.
  compaction: "auto",
  defaultModel: (s) => {
    if (s.codex.model) return s.codex.model
    const { listed, configured } = codexModels()
    // A config model the account can't use would fail every turn: start from one Codex lists.
    return configured && listed.length > 0 && !listed.includes(configured) ? listed[0]! : DEFAULT
  },
  status: async (s) => {
    if (!s.codex.enabled) return { available: false, detail: "Turned off in settings", models: [], asks: false, tools: true }
    const { listed, configured } = codexModels()
    const stale = configured && listed.length > 0 && !listed.includes(configured)
    return {
      available: true,
      detail: stale
        ? `Codex SDK, signed in as the Codex CLI is. Your Codex config names ${configured}, which Codex doesn't list for this account; threads start on ${listed[0]}.`
        : "Codex SDK, signed in as the Codex CLI is. Runs in Codex's sandbox; it can't stop to ask.",
      models: [...(stale ? [] : [DEFAULT]), ...listed],
      asks: false,
      tools: true
    }
  },
  turn
}
