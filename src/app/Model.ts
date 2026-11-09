/**
 * What the control plane keeps: settings, projects, threads and the items in
 * a thread. Plain JSON on disk (src/app/Store.ts); settings coming from the
 * page are checked against `Settings` before they're saved.
 */
import { Schema } from "effect"

export const ProviderId = Schema.Literals(["claude", "codex", "ollama"])
export type ProviderId = typeof ProviderId.Type

/**
 * What an agent may do in a thread without asking.
 * - `ask`: reads freely; asks before every edit and command
 * - `auto-edit`: reads and edits inside the project freely; asks before commands
 * - `read-only`: reads only
 */
export const Access = Schema.Literals(["ask", "auto-edit", "read-only"])
export type Access = typeof Access.Type

export const Settings = Schema.Struct({
  defaultProvider: ProviderId,
  defaultAccess: Access,
  claude: Schema.Struct({
    enabled: Schema.Boolean,
    model: Schema.String,
    effort: Schema.Literals(["low", "medium", "high", "xhigh", "max"])
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
    /** Hand the agent singularity's most similar past change at a thread's first message. */
    recall: Schema.Boolean,
    /** Run `singularity store` after a turn that committed. */
    store: Schema.Boolean
  }),
  /** Give agents zero's evolved solver instructions and lessons. */
  useGenome: Schema.Boolean
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
  useGenome: true
}

export interface Project {
  readonly id: string
  readonly name: string
  readonly path: string
  readonly createdAt: string
}

export type Item =
  | { readonly kind: "user"; readonly id: string; readonly at: string; text: string }
  | { readonly kind: "assistant"; readonly id: string; readonly at: string; text: string }
  | {
    readonly kind: "tool"
    readonly id: string
    readonly at: string
    name: string
    detail: string
    status: "running" | "done" | "failed"
    output: string
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
    action: "recalled" | "stored" | "none"
    commit: string
    title: string
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
  status: "idle" | "running"
  /** The provider's own session or thread id, to continue it. */
  resume: string | null
  /** What the provider reported that session has cost so far, for providers that report a running total. */
  sessionCostUsd?: number | undefined
  readonly createdAt: string
  updatedAt: string
}

export interface Thread extends ThreadMeta {
  items: Array<Item>
}

export const newId = (prefix: string): string =>
  `${prefix}_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`

export const metaOf = (t: Thread): ThreadMeta => {
  const { items: _items, ...meta } = t
  return meta
}

/** A title from the first message: its first line, trimmed to a sidebar's width. */
export const titleFrom = (text: string): string => {
  const line = text.trim().split("\n")[0]!.replace(/\s+/g, " ")
  return line.length > 60 ? `${line.slice(0, 57).trimEnd()}…` : line || "New thread"
}
