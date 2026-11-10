/**
 * One Claude Agent SDK session, as an Effect.
 *
 * `query()` is an async iterator of messages; here it is a Stream, folded
 * into the one thing callers need: the result (text, structured output, cost,
 * turns, session id). Interrupting the Effect aborts the session.
 *
 * Every session runs with no settings files (`settingSources: []`), so a
 * run behaves the same on any machine, and every tool call goes through the
 * session's ToolPolicy (src/Policy.ts).
 */
import { type CanUseTool, query, type SDKMessage } from "@anthropic-ai/claude-agent-sdk"
import { Context, Effect, Layer, Stream } from "effect"
import { AgentError } from "./Errors.ts"
import type { Effort } from "./Genome.ts"
import { decide, TOOLS, type ToolPolicy } from "./Policy.ts"
import { cleanEnv } from "./Proc.ts"

export interface AgentRun {
  readonly prompt: string
  readonly cwd: string
  readonly model: string
  readonly effort: Effort
  readonly maxTurns: number
  /** The session stops when its estimated spend passes this. */
  readonly maxBudgetUsd: number
  /** Added to Claude Code's own system prompt. */
  readonly systemAppend: string
  readonly policy: ToolPolicy
  /** A JSON Schema the session's final answer must match. */
  readonly outputSchema?: Record<string, unknown> | undefined
  /** Continue this session instead of starting one. */
  readonly resume?: string | undefined
  /**
   * Keep the transcript where Claude Code keeps its own. singularity finds
   * the session that made a commit by its transcript, so sessions that commit
   * must persist; throwaway benchmark sessions needn't.
   */
  readonly persist: boolean
  /** Progress lines (one per tool call), for a person watching. */
  readonly onEvent?: ((line: string) => void) | undefined
  /** What memory adds after a shell call (singularity's notes on a commit read with `git show`). */
  readonly afterTool?: ((input: Readonly<Record<string, unknown>>) => Promise<string | undefined>) | undefined
}

/**
 * The PostToolUse hook that hands memory's notes to the agent. Sessions here load no settings files, so
 * singularity's own Claude Code hooks never run in them; this does their tool-call part.
 */
export const memoryHooks = (afterTool: ((input: Readonly<Record<string, unknown>>) => Promise<string | undefined>) | undefined) =>
  afterTool === undefined
    ? {}
    : {
      PostToolUse: [{
        matcher: "Bash",
        hooks: [async (h: { readonly hook_event_name: string }) => {
          const text = h.hook_event_name === "PostToolUse" ? await afterTool(h as unknown as Record<string, unknown>) : undefined
          return text ? { hookSpecificOutput: { hookEventName: "PostToolUse" as const, additionalContext: text } } : {}
        }]
      }]
    }

export interface AgentResult {
  readonly sessionId: string
  /** The session finished its turn (not stopped by turns, budget or an error). */
  readonly ok: boolean
  /** `success`, or why it stopped: `error_max_turns`, `error_max_budget_usd`, … */
  readonly subtype: string
  readonly text: string
  readonly structured: unknown
  readonly costUsd: number
  readonly turns: number
}

export class Agent extends Context.Service<Agent, {
  run(spec: AgentRun): Effect.Effect<AgentResult, AgentError>
}>()("zero/Agent") {}

/** A one-line summary of a tool call, for progress output. */
const describeTool = (name: string, input: Record<string, unknown>): string => {
  const arg = input["command"] ?? input["file_path"] ?? input["pattern"] ?? ""
  return `${name} ${String(arg).replace(/\s+/g, " ").slice(0, 100)}`.trim()
}

const runSession = (spec: AgentRun) =>
  Effect.suspend(() => {
    const abort = new AbortController()
    const canUseTool: CanUseTool = async (tool, input) => {
      const decision = decide(spec.policy, tool, input)
      if (decision.behavior === "deny") spec.onEvent?.(`  denied ${describeTool(tool, input)}: ${decision.message}`)
      return decision
    }
    const messages = query({
      prompt: spec.prompt,
      options: {
        cwd: spec.cwd,
        model: spec.model,
        effort: spec.effort,
        maxTurns: spec.maxTurns,
        maxBudgetUsd: spec.maxBudgetUsd,
        systemPrompt: { type: "preset", preset: "claude_code", append: spec.systemAppend },
        tools: [...TOOLS],
        settingSources: [],
        permissionMode: "default",
        canUseTool,
        persistSession: spec.persist,
        abortController: abort,
        env: cleanEnv(),
        hooks: memoryHooks(spec.afterTool),
        ...(spec.outputSchema ? { outputFormat: { type: "json_schema" as const, schema: spec.outputSchema } } : {}),
        ...(spec.resume ? { resume: spec.resume } : {})
      }
    })
    return Stream.fromAsyncIterable(messages, (cause) => new AgentError({ message: `agent session failed: ${String(cause)}` })).pipe(
      Stream.tap((m: SDKMessage) =>
        Effect.sync(() => {
          if (m.type !== "assistant" || spec.onEvent === undefined) return
          for (const block of m.message.content) {
            if (block.type === "tool_use") spec.onEvent(`  ${describeTool(block.name, block.input as Record<string, unknown>)}`)
          }
        })
      ),
      Stream.filter((m: SDKMessage) => m.type === "result"),
      Stream.runLast,
      Effect.flatMap((last) => {
        if (last._tag === "None" || last.value.type !== "result") {
          return Effect.fail(new AgentError({ message: "agent session ended without a result" }))
        }
        const r = last.value
        return Effect.succeed({
          sessionId: r.session_id,
          ok: r.subtype === "success" && !r.is_error,
          subtype: r.subtype,
          text: r.subtype === "success" ? r.result : (r.errors ?? []).join("\n"),
          structured: r.subtype === "success" ? r.structured_output : undefined,
          costUsd: r.total_cost_usd,
          turns: r.num_turns
        } satisfies AgentResult)
      }),
      Effect.onInterrupt(() => Effect.sync(() => abort.abort()))
    )
  })

/** Sessions on Claude, through the Agent SDK. */
export const layer = Layer.succeed(Agent, Agent.of({ run: runSession }))
