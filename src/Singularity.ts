/**
 * singularity: the memory zero is built on.
 *
 * singularity is procedural memory kept in git. When an agent session commits
 * a change, and the last check before that commit passed, singularity stores
 * the commit with what the session was asked and the commands it ran. Later,
 * for a task like it, `recall` points back to that commit.
 *
 * zero uses that one mechanism at both of its levels:
 * - the solver, working a task in some repo, is handed the past change in
 *   that repo most like the task;
 * - the improver, rewriting zero's own genome, is handed the past
 *   *improvement* most like the one it is about to make — because every
 *   accepted improvement was a commit made by an improver session, which
 *   singularity stored.
 *
 * So each generation learns from how earlier generations improved, not just
 * from their scores: memory of self-improvement feeds self-improvement.
 */
import { Context, Effect, Layer, Option, Schema } from "effect"
import { ChildProcessSpawner } from "effect/process"
import { MemoryError } from "./Errors.ts"
import { procOk, runProcess, singularityCommand, singularityHook, tail } from "./Proc.ts"

/**
 * What every agent zero starts in a git repo is told about singularity, added
 * to its system prompt. It lives in code, not in the genome, so no improver
 * can evolve it away. (Benchmark solvers work in throwaway folders with no
 * memory, so they don't get it.)
 */
export const MEMORY_NOTE = [
  "# Memory: singularity",
  "",
  "This repository's memory is singularity. It keeps each change an agent session committed here",
  "after a check passed, with the task that asked for it and the commands that made it.",
  "",
  "- At the start of each task (a thread's first request, and the first after a commit), zero asks singularity for",
  "  the past change here most like it. If it had one, it follows that message, headed \"A past change in this",
  "  repository like your task\": read it, and its commit with `git show <commit>`, before you start. A list of",
  "  check scripts earlier sessions ran may follow too: reuse them rather than writing your own.",
  "- Reading a stored commit with `git show` or `git log` brings what git doesn't hold, such as the commands",
  "  its session ran to check it. Use those commands.",
  "- Mid-task, when you are about to do something likely done before here (a kind of change, a fix,",
  "  a command that keeps failing), run `singularity recall \"<what you are about to do>\"`. It prints the",
  "  most similar past change, or says there is none. It calls no model. Don't run it at every step.",
  "- `singularity changes` lists what it has stored here.",
  "- Run this repo's checks before the change is committed: singularity stores a commit only when a check",
  "  passed before it, and the next task like this one starts from it."
].join("\n")

/** A past change singularity handed over: a pointer to its commit, as text for a prompt. */
export interface Recall {
  readonly commit: string
  readonly text: string
  readonly score: number
}

/** What singularity hands an agent at a task's start: a pointer to a past change and/or check scripts. */
export interface HandOver {
  readonly text: string
  /** The past change's commit, when the hand-over points to one. */
  readonly commit: string | null
}

/** A change singularity stored, as `changes --json` lists it. */
export interface StoredChange {
  readonly id: string
  readonly commit: string
  readonly title: string
  readonly task: string
  readonly retired: boolean
}

export class Memory extends Context.Service<Memory, {
  /** The past change in the repo at `cwd` most like `task`, if singularity has one. */
  recall(task: string, cwd: string): Effect.Effect<Option.Option<Recall>, MemoryError>
  /**
   * The hand-over for a message in session `session`: at a task's start, the past change most like it
   * and the check scripts earlier sessions ran; otherwise none. With singularity's hook script (its own
   * install), singularity decides what starts a task, as it does in Claude Code, and its model picks the
   * change when the person chose one in its setup. Without it, `recall` runs when `startsTask` says so.
   */
  handOver(input: { readonly session: string; readonly prompt: string; readonly cwd: string; readonly startsTask: boolean }): Effect.Effect<Option.Option<HandOver>, MemoryError>
  /**
   * What singularity adds after a shell call that read a stored commit (`git show`, `git log`): what git
   * doesn't show, such as the commands its session ran. `input` is Claude Code's PostToolUse input.
   */
  afterTool(input: Readonly<Record<string, unknown>>, session: string): Effect.Effect<Option.Option<string>, MemoryError>
  /** Store the changes sessions committed in the repo at `cwd` (idempotent: one record per commit). */
  store(cwd: string): Effect.Effect<void, MemoryError>
  /** The changes stored for the repo at `cwd`, newest first. */
  changes(cwd: string): Effect.Effect<ReadonlyArray<StoredChange>, MemoryError>
}>()("zero/Memory") {}

const RecallJson = Schema.fromJsonString(Schema.Struct({
  handed_over: Schema.Boolean,
  text: Schema.NullOr(Schema.String),
  picked: Schema.NullOr(Schema.Struct({ commit: Schema.String })),
  score: Schema.Number
}))

const ChangesJson = Schema.fromJsonString(Schema.Struct({
  changes: Schema.Array(Schema.Struct({
    id: Schema.String,
    commit: Schema.String,
    title: Schema.String,
    task: Schema.NullOr(Schema.String),
    retired: Schema.NullOr(Schema.Unknown)
  }))
}))

/** What a hook printed for the agent: Claude Code's `hookSpecificOutput.additionalContext`, or nothing. */
export const hookContext = (stdout: string): string | undefined => {
  try {
    const text: unknown = JSON.parse(stdout)?.hookSpecificOutput?.additionalContext
    return typeof text === "string" && text.trim() !== "" ? text : undefined
  } catch {
    return undefined
  }
}

/** The commit a hand-over points to (`committed as <sha>: "…"`), if it points to one. */
export const pointedCommit = (text: string): string | null => /committed as ([0-9a-f]{7,40})\b/.exec(text)?.[1] ?? null

/**
 * Shell calls the tool-call hook can add to: ones that read commits. The hook itself checks this
 * first; checking it here too saves starting a process for every other call.
 */
export const readsCommits = (input: Readonly<Record<string, unknown>>): boolean =>
  input["tool_name"] === "Bash" && /\bgit\b.{0,160}?\b(?:show|log)\b/.test(JSON.stringify(input["tool_input"] ?? ""))

/** The singularity command line on this machine. */
export const layer = Layer.effect(
  Memory,
  Effect.gen(function*() {
    const [command, prefix] = singularityCommand()
    const hookScript = singularityHook()
    const spawner = yield* ChildProcessSpawner.ChildProcessSpawner
    /** singularity's hook for `event`, fed Claude Code's hook input: what it hands the agent, if anything. */
    const hook = (event: ReadonlyArray<string>, input: Readonly<Record<string, unknown>>, cwd: string, timeoutS: number) =>
      hookScript === undefined
        ? Effect.succeed(undefined)
        : runProcess(process.execPath, [hookScript, ...event], { cwd, timeoutS, input: JSON.stringify(input) }).pipe(
          Effect.provideService(ChildProcessSpawner.ChildProcessSpawner, spawner),
          Effect.mapError((e) => new MemoryError({ message: `singularity hook ${event[0]}: ${String(e)}` })),
          Effect.map((r) => hookContext(r.stdout))
        )
    const run = (args: ReadonlyArray<string>, cwd: string) =>
      runProcess(command, [...prefix, ...args], { cwd, timeoutS: 120 }).pipe(
        Effect.provideService(ChildProcessSpawner.ChildProcessSpawner, spawner),
        Effect.mapError((e) => new MemoryError({ message: `singularity ${args[0]}: ${String(e)}` })),
        Effect.flatMap((r) =>
          procOk(r)
            ? Effect.succeed(r.stdout)
            : Effect.fail(new MemoryError({ message: `singularity ${args[0]} failed: ${tail(r.stderr || r.stdout, 400)}` }))
        )
      )
    const recall = (task: string, cwd: string) =>
      run(["recall", "--json", task], cwd).pipe(
        Effect.flatMap(Schema.decodeUnknownEffect(RecallJson)),
        Effect.mapError((e) => e._tag === "MemoryError" ? e : new MemoryError({ message: `recall printed: ${e.message}` })),
        Effect.map((r) =>
          r.handed_over && r.text !== null && r.picked !== null
            ? Option.some<Recall>({ commit: r.picked.commit, text: r.text, score: r.score })
            : Option.none<Recall>()
        )
      )
    return Memory.of({
      recall,
      handOver: ({ session, prompt, cwd, startsTask }) => {
        if (hookScript === undefined) {
          return startsTask
            ? recall(prompt, cwd).pipe(Effect.map(Option.map((r): HandOver => ({ text: r.text, commit: r.commit }))))
            : Effect.succeedNone
        }
        // As Claude Code runs them: the card (and, with no model chosen, the pointer) and, beside it,
        // the model's pick of the pointer when the person chose a model in singularity's setup.
        const input = { session_id: session, cwd, prompt, hook_event_name: "UserPromptSubmit" }
        return Effect.all([hook(["user-prompt-pick"], input, cwd, 120), hook(["user-prompt-submit", "--picks"], input, cwd, 90)], { concurrency: 2 }).pipe(
          Effect.map((parts) => {
            const text = parts.filter((p) => p !== undefined).join("\n\n")
            return text === "" ? Option.none() : Option.some({ text, commit: pointedCommit(text) })
          })
        )
      },
      afterTool: (input, session) =>
        readsCommits(input)
          ? hook(["post-tool-use"], { ...input, session_id: session }, typeof input["cwd"] === "string" ? input["cwd"] : process.cwd(), 15).pipe(Effect.map(Option.fromUndefinedOr))
          : Effect.succeedNone,
      store: (cwd) => Effect.asVoid(run(["store"], cwd)),
      changes: (cwd) =>
        run(["changes", "--json"], cwd).pipe(
          Effect.flatMap(Schema.decodeUnknownEffect(ChangesJson)),
          Effect.mapError((e) => e._tag === "MemoryError" ? e : new MemoryError({ message: `changes printed: ${e.message}` })),
          Effect.map((r) =>
            r.changes.map((c) => ({ id: c.id, commit: c.commit, title: c.title, task: c.task ?? "", retired: c.retired !== null }))
          )
        )
    })
  })
)

/**
 * `afterTool` for an Agent SDK hook: a promise that never fails, of the note or undefined.
 *
 * The notes go under their own session (`<session>-tools`). singularity skips the notes on a commit
 * its session was already handed at the task's start, yet that hand-over is the pointer alone and
 * tells the agent `git show` will bring the rest: under one session, the commands the pointed-to
 * change's session ran would never arrive. A note still comes once per commit.
 */
export const toolNotes = (memory: Memory["Service"], session: string) => (input: Readonly<Record<string, unknown>>): Promise<string | undefined> =>
  Effect.runPromise(memory.afterTool(input, `${session}-tools`).pipe(Effect.map(Option.getOrUndefined))).catch(() => undefined)

/** Memory with nothing in it: for runs where singularity isn't installed, and tests. */
export const empty = Layer.succeed(
  Memory,
  Memory.of({
    recall: () => Effect.succeedNone,
    handOver: () => Effect.succeedNone,
    afterTool: () => Effect.succeedNone,
    store: () => Effect.void,
    changes: () => Effect.succeed([])
  })
)
