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
import { procOk, runProcess, singularityCommand, tail } from "./Proc.ts"

/** A past change singularity handed over: a pointer to its commit, as text for a prompt. */
export interface Recall {
  readonly commit: string
  readonly text: string
  readonly score: number
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

/** The singularity command line on this machine. */
export const layer = Layer.effect(
  Memory,
  Effect.gen(function*() {
    const [command, prefix] = singularityCommand()
    const spawner = yield* ChildProcessSpawner.ChildProcessSpawner
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
    return Memory.of({
      recall: (task, cwd) =>
        run(["recall", "--json", task], cwd).pipe(
          Effect.flatMap(Schema.decodeUnknownEffect(RecallJson)),
          Effect.mapError((e) => e._tag === "MemoryError" ? e : new MemoryError({ message: `recall printed: ${e.message}` })),
          Effect.map((r) =>
            r.handed_over && r.text !== null && r.picked !== null
              ? Option.some({ commit: r.picked.commit, text: r.text, score: r.score })
              : Option.none()
          )
        ),
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

/** Memory with nothing in it: for runs where singularity isn't installed, and tests. */
export const empty = Layer.succeed(
  Memory,
  Memory.of({
    recall: () => Effect.succeedNone,
    store: () => Effect.void,
    changes: () => Effect.succeed([])
  })
)
