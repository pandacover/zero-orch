/**
 * What the control plane keeps: settings, projects, threads and the items in
 * a thread. Plain JSON on disk (src/app/Store.ts); settings coming from the
 * page are checked against `Settings` before they're saved.
 */
import { Schema } from "effect"
import type { Attachment } from "./Attachments.ts"

export const ProviderId = Schema.Literals(["claude", "codex", "ollama"])
export type ProviderId = typeof ProviderId.Type

/**
 * What an agent may do in a thread without asking.
 * - `ask`: reads freely; asks before every edit and command
 * - `auto-edit`: reads and edits inside the project freely; asks before commands
 * - `read-only`: reads only
 */
/** What a thread may do without asking: everything (`full-access`), edits in the project (`auto-edit`), only reads. */
export const Access = Schema.Literals(["ask", "auto-edit", "full-access", "read-only"])
export const ACCESSES: ReadonlyArray<Access> = Access.literals
export type Access = typeof Access.Type

/** From least to most an agent may do without asking. */
const ACCESS_RANK: Record<Access, number> = { "read-only": 0, ask: 1, "auto-edit": 2, "full-access": 3 }
/** The lesser of two accesses: a thread a thread starts may do no more than the thread that started it. */
export const atMost = (wanted: Access, limit: Access): Access => (ACCESS_RANK[wanted] <= ACCESS_RANK[limit] ? wanted : limit)

/** How hard Claude thinks each step. */
export const Effort = Schema.Literals(["low", "medium", "high", "xhigh", "max"])
export type Effort = typeof Effort.Type

/** The effort levels each provider takes; a thread's effort must be one of its provider's. */
export const EFFORTS: Record<ProviderId, ReadonlyArray<string>> = {
  claude: ["low", "medium", "high", "xhigh", "max"],
  codex: ["minimal", "low", "medium", "high", "xhigh"],
  ollama: []
}
export const isEffortFor = (provider: ProviderId, x: unknown): x is string => typeof x === "string" && EFFORTS[provider].includes(x)

export const Settings = Schema.Struct({
  defaultProvider: ProviderId,
  defaultAccess: Access,
  claude: Schema.Struct({
    enabled: Schema.Boolean,
    model: Schema.String,
    effort: Effort
  }),
  codex: Schema.Struct({
    enabled: Schema.Boolean,
    /** Empty: the model Codex's own config names. */
    model: Schema.String,
    effort: Schema.Literals(["", "minimal", "low", "medium", "high", "xhigh"])
  }),
  ollama: Schema.Struct({
    enabled: Schema.Boolean,
    baseUrl: Schema.String,
    model: Schema.String
  }),
  memory: Schema.Struct({
    /** Hand the agent singularity's most similar past change with each message. */
    recall: Schema.Boolean,
    /** Run `singularity store` after a turn that committed. */
    store: Schema.Boolean
  }),
  /** Give agents zero's evolved solver instructions and lessons. */
  useGenome: Schema.Boolean,
  titles: Schema.Struct({
    /** Have a small model name a thread from its first message; off keeps that message's first line. */
    auto: Schema.Boolean,
    /** The model that names threads: small, fast and cheap. */
    model: Schema.String
  }),
  /** The control plane over HTTP on 127.0.0.1, for other devices through `tailscale serve` (src/app/Remote.ts). */
  remote: Schema.Struct({
    enabled: Schema.Boolean,
    port: Schema.Int.check(Schema.isBetween({ minimum: 1024, maximum: 65535 }))
  })
})
export type Settings = typeof Settings.Type

export const DEFAULT_SETTINGS: Settings = {
  defaultProvider: "claude",
  defaultAccess: "ask",
  claude: { enabled: true, model: "claude-opus-5-5", effort: "high" },
  // Off until they're ready here: Codex's Windows sandbox asks for elevation on every command.
  codex: { enabled: false, model: "", effort: "" },
  ollama: { enabled: false, baseUrl: "http://127.0.0.1:11434", model: "" },
  memory: { recall: true, store: true },
  useGenome: true,
  titles: { auto: true, model: "claude-haiku-5-5" },
  remote: { enabled: false, port: 8137 }
}

export interface Project {
  readonly id: string
  readonly name: string
  readonly path: string
  readonly createdAt: string
}

export type Item =
  | {
    readonly kind: "user"
    readonly id: string
    readonly at: string
    /** The message; `{{att:<id>}}` marks where an attached file sits among the words. */
    text: string
    attachments?: ReadonlyArray<Attachment> | undefined
    /** Sent by the agent in another thread (the one that started this), not by the person. */
    from?: { readonly threadId: string; readonly title: string } | undefined
  }
  | {
    /**
     * This thread's agent started, messaged or waited for another thread (src/app/Threads.ts,
     * `threadTools`). One card per call, updated as it goes; it links to that thread.
     */
    readonly kind: "link"
    readonly id: string
    readonly at: string
    readonly threadId: string
    /** That thread's title when the call was made; the page shows its title now. */
    title: string
    action: "started" | "messaged" | "waited"
    /** `sent`: not waited for. `timeout`: still working when the wait ran out. */
    state: "sent" | "waiting" | "replied" | "timeout" | "failed"
    /** What was sent: the task, or the message. */
    text: string
    /** The other thread's answer, once it replied. */
    reply?: string | undefined
    error?: string | undefined
  }
  | { readonly kind: "assistant"; readonly id: string; readonly at: string; text: string }
  | {
    readonly kind: "tool"
    readonly id: string
    readonly at: string
    name: string
    detail: string
    status: "running" | "done" | "failed"
    output: string
    /** What an edit changed: "-" and "+" lines, "@@" between pieces (Edit, MultiEdit, Write). */
    diff?: string | undefined
  }
  | {
    readonly kind: "permission"
    readonly id: string
    readonly at: string
    tool: string
    detail: string
    state: "pending" | "allowed" | "denied"
  }
  | {
    readonly kind: "memory"
    readonly id: string
    readonly at: string
    /** `checked`: asked at task start, nothing handed over (commit is ""). `none`: committed, not stored. */
    action: "recalled" | "checked" | "stored" | "none"
    commit: string
    title: string
    /** What singularity handed over, word for word, as the agent was given it (recalled only). */
    text?: string
  }
  | {
    /** The provider compacted the session's context (its own, native compaction): asked with `/compact`, or on its own. */
    readonly kind: "compact"
    readonly id: string
    readonly at: string
    trigger: "manual" | "auto"
    state: "running" | "done" | "failed"
    /** Tokens in the context before (an estimate from the last turn while it runs) and after. */
    preTokens: number | null
    postTokens: number | null
    /** How long it took, once done. */
    durationMs?: number | null | undefined
    /** The summary the session goes on from, once done. */
    summary?: string | undefined
    error: string
  }
  | {
    /**
     * zero sent the agent a follow-up of its own, not the person's: its turn ended right after
     * a tool call failed, without saying where things stand. `reason` says which call.
     */
    readonly kind: "followup"
    readonly id: string
    readonly at: string
    reason: string
  }
  | {
    readonly kind: "turn"
    readonly id: string
    readonly at: string
    provider: ProviderId
    model: string
    durationMs: number
    costUsd: number | null
    tokens: number | null
    outcome: "done" | "stopped" | "failed"
    error: string
  }

export interface ThreadMeta {
  readonly id: string
  readonly projectId: string
  title: string
  provider: ProviderId
  model: string
  access: Access
  /** The provider's effort for this thread, one of `EFFORTS[provider]`; unset follows the settings. */
  effort?: string | undefined
  status: "idle" | "running"
  /** The provider's own session or thread id, to continue it. */
  resume: string | null
  /** What the provider reported that session has cost so far, for providers that report a running total. */
  sessionCostUsd?: number | undefined
  /** How full the session's context was after its last turn: `used` tokens of `limit`, where it compacts on its own. */
  context?: { used: number; limit: number } | undefined
  /** A message waiting while the session compacts first (its words), shown as queued. */
  queued?: string | undefined
  /** Kept at the top of its project in the sidebar. */
  pinned?: boolean | undefined
  /** HEAD when the thread's current task started: a message after HEAD moves (a commit) starts a new one. */
  taskHead?: string | undefined
  /** The git branch the project was on when the thread's last turn ended: what its Git panel is about. */
  branch?: string | undefined
  /** A git worktree of the project this thread works in, instead of the project's own folder. */
  cwd?: string | undefined
  /** The thread whose agent started this one: it talks to it and waits for its answers. */
  parentId?: string | undefined
  /** A turn ended that the person hasn't looked at yet, and how: the sidebar lists the thread under Needs you. */
  unseen?: "done" | "failed" | undefined
  readonly createdAt: string
  updatedAt: string
}

export interface Thread extends ThreadMeta {
  items: Array<Item>
}

/** Where the account stands against one of its plan's usage windows, as the provider last said. */
export interface UsageLimit {
  /** Which window: "five_hour", "seven_day", "seven_day_opus"… */
  readonly kind: string
  /** "allowed", "allowed_warning" (getting close) or "rejected" (used up until it resets). */
  readonly status: string
  /** How much of the window is used, 0 to 1, when the provider says. */
  readonly used: number | null
  /** When the window resets (ISO), when the provider says. */
  readonly resetsAt: string | null
  readonly at: string
}

export const newId = (prefix: string): string =>
  `${prefix}_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`

export const metaOf = (t: Thread): ThreadMeta => {
  const { items: _items, ...meta } = t
  return meta
}

/** A title from the first message: its first line, trimmed to a sidebar's width. */
/**
 * When the context is this full (of where the provider would compact on its own), the composer
 * offers to compact first. The page keeps the same number (ui/app.js).
 */
export const COMPACT_SOON = 0.7
export const needsCompaction = (context: { used: number; limit: number } | undefined): boolean =>
  context !== undefined && context.limit > 0 && context.used >= COMPACT_SOON * context.limit

/** A session left this long has a cold cache: compacting before the next message makes it cheaper. */
export const IDLE_COMPACT_MS = 60 * 60 * 1000

/** Whether to offer compacting first: the context is filling, or the thread has sat idle an hour. */
export const compactionOffered = (t: Thread, now = Date.now()): boolean => {
  const last = t.items.at(-1)?.at
  return needsCompaction(t.context) || (last !== undefined && now - Date.parse(last) >= IDLE_COMPACT_MS)
}

/** A message asking the provider to compact its context, `/compact` with optional instructions for the summary. */
export const isCompact = (text: string): boolean => /^\/compact(\s|$)/.test(text.trim())

export const titleFrom = (text: string): string => {
  const line = text.trim().split("\n")[0]!.replace(/\s+/g, " ")
  return line.length > 60 ? `${line.slice(0, 57).trimEnd()}…` : line || "New thread"
}
