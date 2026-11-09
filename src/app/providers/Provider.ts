/**
 * One shape for every agent the control plane talks to.
 *
 * A provider turns one user message into a stream of `TurnEvent`s: streamed
 * text, tool calls as they start and finish, the session id to continue
 * from, and what the turn cost. The thread runner (src/app/Threads.ts) turns
 * those into the items a thread shows; it never sees an SDK's own types.
 */
import { Schema, Stream } from "effect"
import type { Access, ProviderId, Settings } from "../Model.ts"

export type TurnEvent =
  | { readonly type: "session"; readonly resume: string }
  /** A piece of assistant text; pieces with the same key are one message. */
  | { readonly type: "text"; readonly key: string; readonly delta: string }
  | {
    readonly type: "tool"
    readonly key: string
    readonly name: string
    readonly detail: string
    readonly status: "running" | "done" | "failed"
    readonly output?: string | undefined
  }
  | {
    readonly type: "usage"
    readonly costUsd: number | null
    readonly tokens: number | null
    /**
     * `costUsd` is the session's running total, not this turn's. The Agent
     * SDK reports a resumed session's cost that way.
     */
    readonly cumulative?: boolean | undefined
  }

export interface TurnInput {
  readonly cwd: string
  readonly prompt: string
  /** The thread so far, for providers that keep no session of their own. */
  readonly history: ReadonlyArray<{ readonly role: "user" | "assistant"; readonly text: string }>
  readonly model: string
  readonly resume: string | null
  /** Instructions added to the provider's own system prompt (zero's genome, when on). */
  readonly instructions: string
  /** The thread's access right now: the person can change it while a turn runs. */
  readonly access: () => Access
  readonly settings: Settings
  /**
   * Ask the person whether a tool call may run; resolves false when denied or the turn stops.
   * `recheck` says what the thread's access makes of the call now, so a change of access
   * can answer a request still waiting.
   */
  readonly ask: (tool: string, detail: string, recheck?: () => "allow" | "deny" | "ask") => Promise<boolean>
  readonly signal: AbortSignal
}

export interface ProviderStatus {
  readonly available: boolean
  /** One line: why it's unavailable, or what it will use. */
  readonly detail: string
  readonly models: ReadonlyArray<string>
  /** Can it pause for approval before a tool call? */
  readonly asks: boolean
  readonly tools: boolean
}

export interface Provider {
  readonly id: ProviderId
  readonly label: string
  status(settings: Settings): Promise<ProviderStatus>
  /** The model a new thread gets when none is chosen. */
  defaultModel(settings: Settings): string
  turn(input: TurnInput): AsyncGenerator<TurnEvent>
}

export class ProviderError extends Schema.TaggedError<ProviderError>()("ProviderError", {
  message: Schema.String
}) {}

/** A provider's turn as an Effect Stream; interrupting it aborts the turn. */
export const turnStream = (provider: Provider, input: TurnInput): Stream.Stream<TurnEvent, ProviderError> =>
  Stream.fromAsyncIterable(provider.turn(input), (cause) =>
    new ProviderError({ message: cause instanceof Error ? cause.message : String(cause) })
  )

/** Text for a card: whitespace folded, cut to `n` characters. */
export const short = (value: unknown, n = 160): string => {
  const s = typeof value === "string" ? value : JSON.stringify(value) ?? ""
  const one = s.replace(/\s+/g, " ").trim()
  return one.length > n ? `${one.slice(0, n - 1)}…` : one
}

/** Tool output kept on a card: the end matters most. */
export const keepOutput = (s: string, n = 6000): string => (s.length > n ? `…${s.slice(-n)}` : s)
