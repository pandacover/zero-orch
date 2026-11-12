/**
 * Claude, through the Claude Agent SDK: Claude Code's own agent loop and
 * tools, streamed token by token, continued across turns with `resume`.
 *
 * Every tool call goes through `canUseTool`, which follows the thread's
 * access: reads run, edits inside the project run under `auto-edit`,
 * everything runs under `full-access`, and anything else waits for the
 * person to allow it in the thread.
 */
import { type CanUseTool, createSdkMcpServer, type ModelInfo, type Query, query, type SDKMessage, type SDKUserMessage, tool } from "@anthropic-ai/claude-agent-sdk"
import { z } from "zod"
import { memoryHooks } from "../../Claude.ts"
import { MODELS } from "../../Genome.ts"
import { cleanEnv } from "../../Proc.ts"
import { inside, isMemoryRead } from "../../Policy.ts"
import { type Access, ACCESSES, type Effort, isCompact, type UsageLimit } from "../Model.ts"
import type { ModelLabel, Provider, ThreadTools, TurnEvent, TurnInput, Verdict } from "./Provider.ts"
import { keepOutput, notRun, short } from "./Provider.ts"

/** The models a thread can pick before Claude Code has said which it offers (or when it can't). */
export const CLAUDE_MODELS = [...MODELS]

/** Every model Claude Code offers here, as it said, by id; undefined until it has. */
let offered: ReadonlyArray<{ readonly id: string } & ModelLabel> | undefined
let asking: Promise<boolean> | undefined

/**
 * Claude Code's model list (the one its `/model` shows) as threads pick from it: one row per model,
 * by its full id. An alias (`opus`, `default`) gives way to the model it stands for, so each model
 * shows once and a thread keeps a model that doesn't change under it.
 */
export const toLabels = (models: ReadonlyArray<ModelInfo>): Array<{ id: string } & ModelLabel> => {
  const seen = new Map<string, { id: string } & ModelLabel>()
  for (const m of models) {
    const id = m.resolvedModel ?? m.value
    // "Default (recommended)" is another model's alias; that model's own row names it.
    if (!id.startsWith("claude-") || seen.has(id) || m.value === "default") continue
    seen.set(id, { id, name: m.displayName, description: m.description, efforts: m.supportsEffort ? [...(m.supportedEffortLevels ?? [])] : [] })
  }
  return [...seen.values()]
}

/**
 * Ask Claude Code which models it offers, once: it starts a session that sends no message (nothing
 * is billed), reads the list and ends it. True once the list is in; a failure leaves the built-in list,
 * and the next call asks again.
 */
export const loadClaudeModels = (): Promise<boolean> =>
  asking ??= (async () => {
    const abort = new AbortController()
    const timer = setTimeout(() => abort.abort(), 60_000)
    let release = () => {}
    const held = new Promise<void>((resolve) => (release = resolve))
    // A prompt that never comes: the session answers control requests, and sends nothing to a model.
    async function* nothing(): AsyncGenerator<SDKUserMessage> { await held }
    try {
      const q = query({ prompt: nothing(), options: { abortController: abort, settingSources: [], persistSession: false, tools: [], env: cleanEnv() } })
      const list = toLabels(await q.supportedModels())
      if (list.length) offered = list
      return list.length > 0
    } catch {
      asking = undefined
      return false
    } finally {
      clearTimeout(timer)
      release()
      abort.abort()
    }
  })()

/** The model ids a thread can pick now. */
export const claudeModels = (): Array<string> => (offered ? offered.map((m) => m.id) : CLAUDE_MODELS)

/** The effort to run `model` at: as asked when it takes it, else its highest up to "high", else none. */
export const effortFor = (model: string, effort: string): string | undefined => {
  const known = offered?.find((m) => m.id === model)
  if (!known || !known.efforts) return effort
  if (known.efforts.includes(effort)) return effort
  return ["high", "medium", "low"].find((e) => known.efforts!.includes(e))
}

const TOOLS = ["Read", "Glob", "Grep", "Edit", "Write", "Bash", "WebSearch", "WebFetch"]
const READS = new Set(["Read", "Glob", "Grep", "WebSearch", "WebFetch"])
const EDITS = new Set(["Edit", "Write", "MultiEdit", "NotebookEdit"])

const detailOf = (_tool: string, input: Record<string, unknown>): string =>
  short(input["command"] ?? input["file_path"] ?? input["pattern"] ?? input["url"] ?? input["query"] ?? input, 400)

const DETAIL_KEYS = ["command", "file_path", "pattern", "url", "query"]

/**
 * The top-level string fields of a tool call's input that has only partly streamed in, those
 * whose value is complete: `{"file_path":"a.ts","content":"exp` gives `{ file_path: "a.ts" }`.
 */
export const partialFields = (json: string): Record<string, string> => {
  const out: Record<string, string> = {}
  let depth = 0
  let i = 0
  let key: string | undefined
  while (i < json.length) {
    const c = json[i]!
    if (c === "\"") {
      let j = i + 1
      while (j < json.length && json[j] !== "\"") j += json[j] === "\\" ? 2 : 1
      if (j >= json.length) break // the string is still streaming
      let s: string
      try {
        s = JSON.parse(json.slice(i, j + 1)) as string
      } catch {
        break
      }
      i = j + 1
      if (depth !== 1) continue
      while (i < json.length && /\s/.test(json[i]!)) i++
      if (json[i] === ":") {
        key = s
        i++
      } else if (key !== undefined) {
        out[key] = s
        key = undefined
      }
      continue
    }
    if (c === "{" || c === "[") depth++
    else if (c === "}" || c === "]") depth--
    else if (c === "," && depth === 1) key = undefined
    i++
  }
  return out
}

/** A card's detail from a call's input so far; "" until a field the detail shows has streamed in whole. */
export const earlyDetail = (tool: string, json: string): string => {
  const fields = partialFields(json)
  return DETAIL_KEYS.some((k) => k in fields) ? detailOf(tool, fields) : ""
}

/** zero's own tools for other threads, as Claude Code names them: `mcp__zero__<tool>`. */
export const THREAD_TOOL_PREFIX = "mcp__zero__"
/** Reading about threads this one started, or waiting on them, changes nothing. */
const THREAD_READS = new Set(["wait_for_thread", "list_threads"].map((t) => `${THREAD_TOOL_PREFIX}${t}`))

/** Whether a call runs without asking, is refused, or waits for the person. */
export const gate = (access: Access, cwd: string, tool: string, input: Record<string, unknown>): "allow" | "deny" | "ask" => {
  if (READS.has(tool) || THREAD_READS.has(tool)) return "allow"
  // A thread started from this one may do no more than this one may (Threads caps its access), so starting
  // or messaging it needs asking only where everything does: under Ask first.
  if (tool.startsWith(THREAD_TOOL_PREFIX)) return access === "ask" ? "ask" : "allow"
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

const THREADS_NOTE = [
  "These tools start other zero threads in this project, each a Claude agent of its own, and talk to them.",
  "Use one to hand off a separate piece of work, or several to run parallel pieces at once, then wait for their answers.",
  "A thread you start may do no more than this one may. The person sees each thread, and may answer its approvals.",
  "Give each thread a self-contained task: it doesn't see this conversation. For work that edits files in parallel,",
  "give each thread a worktree, so they don't edit the same checkout at once."
].join(" ")

const text = (s: string) => ({ content: [{ type: "text" as const, text: s }] })
/** A tool's answer: what it says, or why it couldn't, as an error the agent reads. */
const answerOf = async (f: () => Promise<string>) => {
  try {
    return text(await f())
  } catch (e) {
    return { ...text(e instanceof Error ? e.message : String(e)), isError: true }
  }
}
const timeout = z.number().int().min(10).max(3600).optional().describe("How long to wait, in seconds (default 600). Wait again if it's still working.")

/** zero's thread tools as an in-process MCP server: Claude Code calls them `mcp__zero__<name>`. */
export const threadServer = (threads: ThreadTools) =>
  createSdkMcpServer({
    name: "zero",
    instructions: THREADS_NOTE,
    tools: [
      tool("start_thread", "Start a new zero thread in this project: a Claude agent of its own, working on the task you give it. It runs on its own; set wait to get its reply, or call wait_for_thread later.", {
        prompt: z.string().min(1).describe("The task, complete in itself: the other thread doesn't see this conversation."),
        title: z.string().max(120).optional().describe("A short title for the thread, as the person sees it in the sidebar."),
        model: z.string().optional().describe("A Claude model id; this thread's model if not given."),
        access: z.enum(ACCESSES as [Access, ...Array<Access>]).optional().describe("What it may do without asking; at most this thread's access, which it gets if not given."),
        worktree: z.object({
          branch: z.string().optional().describe("The new branch's name; one is made up if not given."),
          base: z.string().optional().describe("The branch it starts from; the project's default branch if not given.")
        }).optional().describe("Work in a new git worktree on a new branch, apart from the project's folder."),
        wait: z.boolean().optional().describe("Wait for its reply before answering (default false)."),
        timeoutSeconds: timeout
      }, (a) => answerOf(() => threads.start(a)), { alwaysLoad: true }),
      tool("message_thread", "Send a thread this one started its next message, once it has finished its turn. Set wait to get its reply.", {
        threadId: z.string().describe("The thread's id, from start_thread or list_threads."),
        text: z.string().min(1),
        wait: z.boolean().optional().describe("Wait for its reply before answering (default false)."),
        timeoutSeconds: timeout
      }, (a) => answerOf(() => threads.message(a)), { alwaysLoad: true }),
      tool("wait_for_thread", "Wait until a thread this one started finishes its turn, and read its reply.", {
        threadId: z.string(),
        timeoutSeconds: timeout
      }, (a) => answerOf(() => threads.wait(a)), { alwaysLoad: true }),
      tool("list_threads", "List the threads this one started: id, title, whether each is working, and its last reply.", {}, () => answerOf(() => threads.list()), { alwaysLoad: true })
    ]
  })

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
      ...(effortFor(input.model, input.settings.claude.effort) ? { effort: effortFor(input.model, input.settings.claude.effort) as Effort } : {}),
      systemPrompt: { type: "preset", preset: "claude_code", append: input.instructions },
      tools: TOOLS,
      ...(input.threads ? { mcpServers: { zero: threadServer(input.threads) } } : {}),
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
  /** What each tool card shows now: a card goes up as the model starts writing its call, not once it has. */
  const announced = new Map<string, string>()
  /** Tool calls still streaming in the current message, by content block index: their input so far. */
  const drafts = new Map<number, { id: string; name: string; json: string }>
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
    if (m.type === "rate_limit_event") {
      const limit = limitOf(m.rate_limit_info)
      if (limit) yield { type: "limit", limit }
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
      if (e.type === "message_start") {
        messageId = e.message.id
        drafts.clear()
      }
      if (e.type === "content_block_delta" && e.delta.type === "text_delta") {
        streamed.add(messageId)
        yield { type: "text", key: `${messageId}:${e.index}`, delta: e.delta.text }
      }
      // A tool call shows from its first token: a long Write or Edit streams for many seconds, and
      // the card used to go up only once all of it had, then finish at once.
      if (e.type === "content_block_start" && e.content_block.type === "tool_use") {
        const { id, name } = e.content_block
        drafts.set(e.index, { id, name, json: "" })
        tools.set(id, { name, detail: "" })
        announced.set(id, "")
        yield { type: "tool", key: id, name, detail: "", status: "running" }
      }
      if (e.type === "content_block_delta" && e.delta.type === "input_json_delta") {
        const d = drafts.get(e.index)
        if (d && announced.get(d.id) === "") {
          d.json += e.delta.partial_json
          const detail = earlyDetail(d.name, d.json)
          if (detail) {
            announced.set(d.id, detail)
            yield { type: "tool", key: d.id, name: d.name, detail, status: "running" }
          }
        }
      }
      if (e.type === "content_block_stop") drafts.delete(e.index)
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
      // New calls, and calls whose card went up while streaming, now with their whole input.
      for (const [id, t] of tools) {
        if (announced.get(id) === t.detail) continue
        announced.set(id, t.detail)
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

/**
 * One of the plan's usage windows as Claude Code reported it, or undefined for one that names no
 * window. `utilization` arrives as a share (0–1) or a percentage (0–100): it's kept as a share.
 */
export const limitOf = (info: { status?: string; rateLimitType?: string; utilization?: number; resetsAt?: number } | undefined): UsageLimit | undefined => {
  if (!info?.rateLimitType || !info.status) return undefined
  const u = typeof info.utilization === "number" && Number.isFinite(info.utilization) ? info.utilization : null
  const used = u === null ? null : Math.min(1, Math.max(0, u > 1 ? u / 100 : u))
  // resetsAt is in seconds since the epoch.
  const resetsAt = typeof info.resetsAt === "number" && info.resetsAt > 0 ? new Date(info.resetsAt * (info.resetsAt < 1e12 ? 1000 : 1)).toISOString() : null
  return { kind: info.rateLimitType, status: info.status, used, resetsAt, at: new Date().toISOString() }
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
    models: claudeModels(),
    ...(offered ? { labels: Object.fromEntries(offered.map(({ id, ...label }) => [id, label])) } : {}),
    asks: true,
    tools: true
  }),
  turn
}
