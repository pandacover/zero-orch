/**
 * Claude, through the Claude Agent SDK: Claude Code's own agent loop and
 * tools, streamed token by token. A thread keeps one Claude Code session
 * running across its turns, each message going into its open input; one
 * that has ended (idle, a change it can't take, a crash) is resumed.
 *
 * Every tool call goes through `canUseTool`, which follows the thread's
 * access: reads run, edits inside the project run under `auto-edit`,
 * everything runs under `full-access`, and anything else waits for the
 * person to allow it in the thread.
 */
import { randomUUID } from "node:crypto"
import { type CanUseTool, createSdkMcpServer, type ModelInfo, type Query, query, type SDKMessage, type SDKUserMessage, tool } from "@anthropic-ai/claude-agent-sdk"
import { z } from "zod"
import { memoryHooks } from "../../Claude.ts"
import { MODELS } from "../../Genome.ts"
import { cleanEnv } from "../../Proc.ts"
import { claudeExecutable } from "../ProviderUpdates.ts"
import { inside, isMemoryRead } from "../../Policy.ts"
import { type Access, ACCESSES, type Effort, isCompact, type UsageLimit } from "../Model.ts"
import type { ModelLabel, Provider, SlashCommandInfo, ThreadTools, TurnEvent, TurnInput, Verdict } from "./Provider.ts"
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
      const q = query({ prompt: nothing(), options: { abortController: abort, settingSources: [], persistSession: false, tools: [], env: cleanEnv(), ...claudeExecutable() } })
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

/** Ask again, as after Claude Code is updated: a newer one may offer newer models. */
export const relistClaudeModels = (): Promise<boolean> => {
  asking = undefined
  return loadClaudeModels()
}

/** The model ids a thread can pick now. */
export const claudeModels = (): Array<string> => (offered ? offered.map((m) => m.id) : CLAUDE_MODELS)

/** The effort to run `model` at: as asked when it takes it, else its highest up to "high", else none. */
export const effortFor = (model: string, effort: string): string | undefined => {
  const known = offered?.find((m) => m.id === model)
  if (!known || !known.efforts) return effort
  if (known.efforts.includes(effort)) return effort
  return ["high", "medium", "low"].find((e) => known.efforts!.includes(e))
}

/**
 * The built-in tools a thread gets. ToolSearch lets Claude Code defer MCP tools (the person's
 * claude.ai connectors) as bare names, loaded when needed: without it every connector's full
 * definition goes in each turn, as ~80 blocks that miss the prompt cache back to the system prompt.
 */
export const TOOLS = ["Read", "Glob", "Grep", "Edit", "Write", "Bash", "WebSearch", "WebFetch", "ToolSearch"]
/** Loading a deferred tool's definition is a read; calling the tool is gated as itself. */
const READS = new Set(["Read", "Glob", "Grep", "WebSearch", "WebFetch", "ToolSearch"])
const EDITS = new Set(["Edit", "Write", "MultiEdit", "NotebookEdit"])

const detailOf = (_tool: string, input: Record<string, unknown>): string =>
  short(input["command"] ?? input["file_path"] ?? input["pattern"] ?? input["url"] ?? input["query"] ?? input, 400)

const DETAIL_KEYS = ["command", "file_path", "pattern", "url", "query"]

/**
 * Claude Code's own commands that make sense from zero's composer; the rest (/clear, /model, /config…) are
 * the terminal's or are zero's to do. Every command of the person's, a project's, a plugin's or a skill stays.
 */
const BUILTIN_COMMANDS = new Set(["init", "review", "security-review", "pr-comments", "release-notes"])

/** The slash commands a composer offers, from what Claude Code says it takes (/compact is zero's own toggle). */
export const usableCommands = (
  list: ReadonlyArray<{ name: string; description: string; argumentHint?: string; builtin?: boolean }>,
  terminal: ReadonlyArray<string> = []
): Array<SlashCommandInfo> => {
  const seen = new Set<string>()
  return list.flatMap((c) => {
    if (seen.has(c.name) || c.name === "compact" || terminal.includes(c.name) || (c.builtin && !BUILTIN_COMMANDS.has(c.name))) return []
    seen.add(c.name)
    return [{ name: c.name, description: c.description, hint: c.argumentHint ?? "" }]
  }).sort((a, b) => a.name.localeCompare(b.name))
}

/** Lines of a diff kept on a tool card: enough to read the change, not a whole file. */
const DIFF_LINES = 300

/**
 * What an Edit, MultiEdit or Write changed, as a unified-diff-like text the page colours: removed lines
 * with "-", added with "+", an edit's pieces apart by "@@". A Write shows the file it wrote, all added.
 * Undefined for any other tool, or an input without the strings.
 */
export const editDiff = (tool: string, input: Record<string, unknown>): string | undefined => {
  const lines = (s: unknown, mark: string) => typeof s === "string" && s !== "" ? s.replace(/\n$/, "").split("\n").map((l) => mark + l) : []
  const piece = (e: Record<string, unknown>) => ["@@", ...lines(e["old_string"], "-"), ...lines(e["new_string"], "+")]
  const out = tool === "Edit" ? piece(input)
    : tool === "MultiEdit" && Array.isArray(input["edits"]) ? (input["edits"] as Array<Record<string, unknown>>).flatMap(piece)
    : tool === "Write" ? ["@@ new content", ...lines(input["content"], "+")]
    : []
  if (out.length <= 1) return undefined
  const more = out.length - DIFF_LINES
  return (more > 0 ? [...out.slice(0, DIFF_LINES), `@@ ${more} more line${more === 1 ? "" : "s"}`] : out).join("\n")
}

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

/** How long a thread's Claude Code session stays up with no turn running; the next turn resumes it. */
export const IDLE_MS = 15 * 60_000
/** How long a stopped turn waits for Claude Code to say it stopped before its session is ended instead. */
export const STOP_GRACE_MS = 10_000

/** Values handed over in order, to one reader; `end` ends the reading, with an error or without. */
const channel = <T>() => {
  const items: Array<T> = []
  let wake: (() => void) | undefined
  let over: { readonly error: unknown } | undefined
  return {
    push: (v: T) => {
      if (over) return
      items.push(v)
      wake?.()
    },
    end: (error?: unknown) => {
      over ??= { error }
      wake?.()
    },
    /** The next value; undefined once it has ended without an error. */
    next: async (): Promise<T | undefined> => {
      for (;;) {
        if (items.length) return items.shift()
        if (over) {
          if (over.error !== undefined) throw over.error
          return undefined
        }
        await new Promise<void>((resolve) => (wake = resolve))
        wake = undefined
      }
    }
  }
}

/** The turn a live session is running now: what reaches it, and what the session's callbacks act for. */
interface Reader {
  readonly input: TurnInput
  /** The uuid its message went in with: its result carries it back. */
  readonly uuid: ReturnType<typeof randomUUID>
  readonly inbox: ReturnType<typeof channel<SDKMessage>>
  /** The summary of a compaction in this turn, from Claude Code's PostCompact hook. */
  summary: string
}

/**
 * One Claude Code process, kept for a thread's turns: each message goes into its open input,
 * and each turn reads what comes out until its own result. A frame that comes out between
 * turns reaches no one.
 */
interface Session {
  readonly q: Query
  /** What it started with, but the model: a turn that needs otherwise starts a new session. */
  readonly config: string
  readonly cwd: string
  model: string
  /** Claude Code's session id, once it has said. */
  id: string | undefined
  readonly send: (m: SDKUserMessage) => void
  reader: Reader | undefined
  closed: boolean
  idle: ReturnType<typeof setTimeout> | undefined
  /** Its slash commands, once Claude Code has said which it takes. */
  commands: Array<SlashCommandInfo> | undefined
  commandsAsked: boolean
}

/** The live sessions, by thread. */
const sessions = new Map<string, Session>()

/** End a session: its process, its input, and whatever turn is reading it. */
const end = (s: Session) => {
  if (s.closed) return
  s.closed = true
  clearTimeout(s.idle)
  for (const [k, v] of sessions) if (v === s) sessions.delete(k)
  s.q.close()
  s.reader?.inbox.end(new Error("Claude Code's session ended"))
}

/**
 * The part of a turn's options a running session can't change: a change starts a new one. That
 * includes which Claude Code runs it, so after an update each thread's next turn resumes on the new one.
 */
const configOf = (input: TurnInput): string =>
  JSON.stringify([effortFor(input.model, input.settings.claude.effort) ?? null, input.instructions, input.threads !== undefined, claudeExecutable().pathToClaudeCodeExecutable ?? null])

/** Whether a call may run, by the thread's access, asking the person when it says to. */
const permit = (input: TurnInput): CanUseTool => async (tool, toolInput) => {
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

/**
 * Start a Claude Code session for a thread, resuming its last one. Its callbacks are fixed when
 * it starts, so each acts for whichever turn is running: that turn's access, approvals, memory
 * and thread tools.
 */
const open = (input: TurnInput, config: string): Session => {
  const inbox = channel<SDKUserMessage>()
  async function* prompt(): AsyncGenerator<SDKUserMessage> {
    for (let m = await inbox.next(); m; m = await inbox.next()) yield m
  }
  const current = () => s.reader?.input
  const threads = (): ThreadTools => {
    const t = current()?.threads
    if (!t) throw new Error("This thread's tools aren't available in this turn.")
    return t
  }
  const q = query({
    prompt: prompt(),
    options: {
      cwd: input.cwd,
      model: input.model,
      ...(effortFor(input.model, input.settings.claude.effort) ? { effort: effortFor(input.model, input.settings.claude.effort) as Effort } : {}),
      systemPrompt: { type: "preset", preset: "claude_code", append: input.instructions },
      tools: TOOLS,
      ...(input.threads
        ? { mcpServers: { zero: threadServer({ start: (a) => threads().start(a), message: (a) => threads().message(a), wait: (a) => threads().wait(a), list: () => threads().list() }) } }
        : {}),
      // The project's own CLAUDE.md and settings, as Claude Code would read them there.
      settingSources: ["project"],
      permissionMode: "default",
      canUseTool: (tool, toolInput, o) => {
        const now = current()
        return now ? permit(now)(tool, toolInput, o) : Promise.resolve({ behavior: "deny", message: "No turn is running in this thread." })
      },
      includePartialMessages: true,
      // Native compaction stays on whatever the machine's settings or environment say:
      // a long thread compacts itself when its context fills, and `/compact` always works.
      settings: { autoCompactEnabled: true },
      hooks: {
        PostCompact: [{ hooks: [async (h) => {
          if (h.hook_event_name === "PostCompact" && s.reader) s.reader.summary = summaryOf(h.compact_summary)
          return {}
        }] }],
        ...memoryHooks(async (h) => current()?.afterTool?.(h))
      },
      // No background tasks: one would run on between turns, and its news start a turn no one reads.
      env: cleanEnv({ DISABLE_AUTO_COMPACT: undefined, DISABLE_COMPACT: undefined, CLAUDE_CODE_DISABLE_BACKGROUND_TASKS: "1" }),
      ...(input.resume ? { resume: input.resume } : {}),
      // A newer Claude Code than the SDK's own, once one is installed from Settings.
      ...claudeExecutable()
    }
  })
  const s: Session = { q, config, cwd: input.cwd, model: input.model, id: undefined, send: inbox.push, reader: undefined, closed: false, idle: undefined, commands: undefined, commandsAsked: false }
  void (async () => {
    let error: unknown = new Error("Claude Code's session ended")
    try {
      for (let r = await q.next(); !r.done; r = await q.next()) s.reader?.inbox.push(r.value)
    } catch (e) {
      error = e
    }
    // The process ended (or crashed): the turn reading hears why, and the next turn starts another.
    s.reader?.inbox.end(error)
    s.closed = true
    clearTimeout(s.idle)
    inbox.end()
    for (const [k, v] of sessions) if (v === s) sessions.delete(k)
  })()
  return s
}

/**
 * The session a turn runs on: the thread's live one when it fits (a new model is switched to on
 * it), else a new one that resumes the thread's last. A compaction runs on the live one as it is.
 */
const sessionFor = async (input: TurnInput): Promise<Session> => {
  const config = configOf(input)
  const live = input.threadId ? sessions.get(input.threadId) : undefined
  if (live?.reader) throw new Error("This thread's Claude session is already running a turn.")
  const fits = live && !live.closed && live.cwd === input.cwd && live.id === (input.resume ?? undefined) &&
    (live.config === config || isCompact(input.prompt))
  if (live && fits) {
    clearTimeout(live.idle)
    if (live.model === input.model) return live
    try {
      await live.q.setModel(input.model)
      live.model = input.model
      return live
    } catch {
      // It can't switch: a new session resumes with the model.
    }
  }
  if (live) end(live)
  const s = open(input, config)
  if (input.threadId) sessions.set(input.threadId, s)
  return s
}

/** End a thread's live session; its next turn resumes it in a new one. */
export const closeSession = (threadId: string) => {
  const s = sessions.get(threadId)
  if (s) end(s)
}

/** End every live session. */
export const closeSessions = () => {
  for (const s of [...sessions.values()]) end(s)
}

async function* turn(input: TurnInput): AsyncGenerator<TurnEvent> {
  if (input.signal.aborted) return
  const s = await sessionFor(input)
  const reader: Reader = { input, uuid: randomUUID(), inbox: channel<SDKMessage>(), summary: "" }
  s.reader = reader
  s.send({ type: "user", message: { role: "user", content: input.prompt }, parent_tool_use_id: null, session_id: "", uuid: reader.uuid })
  // Stop interrupts the turn and leaves the session up; one that doesn't stop in time is ended.
  let grace: ReturnType<typeof setTimeout> | undefined
  const stop = () => {
    s.q.interrupt().catch(() => {})
    grace = setTimeout(() => end(s), STOP_GRACE_MS)
  }
  input.signal.addEventListener("abort", stop, { once: true })
  // Stopped while its session was being got ready (a model switch): the message went in, so stop it.
  if (input.signal.aborted) stop()
  /** The turn's own result came: the session is between turns, ready for the next. */
  let finished = false

  let session: string | undefined
  let messageId = ""
  const streamed = new Set<string>()
  const tools = new Map<string, { name: string; detail: string; diff?: string | undefined }>()
  /** What each tool card shows now: a card goes up as the model starts writing its call, not once it has. */
  const announced = new Map<string, string>()
  /** Tool calls still streaming in the current message, by content block index: their input so far. */
  const drafts = new Map<number, { id: string; name: string; json: string }>
  const pending: Array<TurnEvent> = []
  // Compaction the person asked for with `/compact`; any other is Claude Code's own, as the context filled.
  const asked = isCompact(input.prompt)
  let compacting = false
  // The session's slash commands: asked once it has started, sent with the next message after they arrive.
  // The turn never waits for them.
  let commandsSent = false
  try {
  for (let m = await reader.inbox.next(); m; m = await reader.inbox.next()) {
    if (s.commands && !commandsSent) {
      commandsSent = true
      yield { type: "commands", commands: s.commands }
    }
    if (session === undefined && "session_id" in m && typeof m.session_id === "string" && m.session_id) {
      session = m.session_id
      s.id = session
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
    if (m.type === "system" && m.subtype === "init") {
      const terminal = (m as { terminal_slash_commands?: Array<string> }).terminal_slash_commands ?? []
      // Every turn starts with an init; the session is asked once.
      if (!s.commandsAsked) {
        s.commandsAsked = true
        s.q.supportedCommands().then((list) => { s.commands = usableCommands(list, terminal) }, () => {})
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
      // The summary arrives through Claude Code's PostCompact hook, just before the compaction's boundary message.
      yield { type: "compact", trigger: c.trigger, state: "done", preTokens: c.pre_tokens, postTokens: c.post_tokens, durationMs: c.duration_ms, summary: reader.summary }
      reader.summary = ""
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
          tools.set(block.id, { name: block.name, detail: detailOf(block.name, block.input as Record<string, unknown>), diff: editDiff(block.name, block.input as Record<string, unknown>) })
        }
        // Text that didn't arrive as deltas (a provider without partial messages) arrives whole.
        if (block.type === "text" && !streamed.has(m.message.id)) pending.push({ type: "text", key: `${m.message.id}:${i}`, delta: block.text })
      })
      // New calls, and calls whose card went up while streaming, now with their whole input.
      for (const [id, t] of tools) {
        if (announced.get(id) === t.detail) continue
        announced.set(id, t.detail)
        pending.push({ type: "tool", key: id, name: t.name, detail: t.detail, status: "running", ...(t.diff ? { diff: t.diff } : {}) })
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
          output: keepOutput(resultText(block.content)),
          ...(t.diff ? { diff: t.diff } : {})
        }
      }
      continue
    }
    // Another message's result (a turn Claude Code started on its own) isn't this turn's end.
    if (m.type === "result" && (m.user_message_uuid === undefined || m.user_message_uuid === reader.uuid || m.user_message_uuids?.includes(reader.uuid))) {
      finished = true
      const context = await contextOf(s.q)
      if (context) yield { type: "context", ...context }
      yield { type: "usage", costUsd: m.total_cost_usd, tokens: m.usage.input_tokens + m.usage.output_tokens, cumulative: true }
      if (m.subtype !== "success" && !input.signal.aborted) throw new Error(`Claude stopped: ${m.subtype.replace(/_/g, " ")}${m.errors?.length ? `: ${m.errors.join("; ")}` : ""}`)
      return
    }
  }
  throw new Error("Claude Code's session ended before the turn did")
  } finally {
    input.signal.removeEventListener("abort", stop)
    clearTimeout(grace)
    if (s.reader === reader) s.reader = undefined
    // A turn left before its result leaves the session mid-turn: it ends, and the next turn resumes.
    if (!finished || !input.threadId || sessions.get(input.threadId) !== s) end(s)
    else {
      s.idle = setTimeout(() => end(s), IDLE_MS)
      s.idle.unref?.()
    }
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
        env: cleanEnv(),
        ...claudeExecutable()
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
  turn,
  close: closeSession,
  closeAll: closeSessions
}
