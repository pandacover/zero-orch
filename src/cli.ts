#!/usr/bin/env node
/**
 * zero: a recursive self-improving agent on singularity's memory.
 *
 *     node src/cli.ts bench [--task ID ...] [--concurrency N] [--reps N]  score the current genome
 *     node src/cli.ts generation [--task ID ...] [--reps N]               one generation: improve, measure, keep or revert
 *     node src/cli.ts evolve [--generations N] [--budget-usd X] [--reps N] generations in a row, each in a fresh process
 *     node src/cli.ts solve TASK... [--cwd DIR]                  the evolved solver on a real repo, with memory
 *     node src/cli.ts lineage                                    what was tried, what won, what singularity stored
 *
 * The control plane is a desktop app: `npm run app` (src/desktop/main.ts).
 */
import * as NodeRuntime from "@effect/platform-node/NodeRuntime"
import * as NodeServices from "@effect/platform-node/NodeServices"
import { Console, Effect, Layer, Option } from "effect"
import { Argument, Command, Flag } from "effect/cli"
import { fileURLToPath } from "node:url"
import { BENCH_WORK_DIR, runBench } from "./Bench.ts"
import * as Claude from "./Claude.ts"
import { loadGenome } from "./Genome.ts"
import { runGeneration } from "./Generation.ts"
import { appendLedger, attempts, readLedger, totalCost } from "./Ledger.ts"
import { runProcess } from "./Proc.ts"
import * as Singularity from "./Singularity.ts"
import { Memory } from "./Singularity.ts"
import { solve } from "./Solve.ts"

/** zero's own repo: the folder above src/. */
const ROOT = fileURLToPath(new URL("..", import.meta.url)).replace(/[\\/]$/, "")
const CLI = fileURLToPath(import.meta.url)

const log = (line: string) => console.log(line)
const pct = (x: number) => `${(x * 100).toFixed(1)}%`

const taskFlag = Flag.String("task").pipe(
  Flag.atLeast(0),
  Flag.withDescription("run only this benchmark task (repeatable)")
)
const concurrencyFlag = Flag.Int("concurrency").pipe(
  Flag.withDefault(3),
  Flag.withDescription("benchmark tasks run at once")
)
const repsFlag = Flag.Int("reps").pipe(
  Flag.withDefault(1),
  Flag.withDescription("times each benchmark task runs, so the score averages out the solver's luck")
)

const bench = Command.make(
  "bench",
  {
    task: taskFlag,
    concurrency: concurrencyFlag,
    reps: repsFlag,
    record: Flag.Boolean("record").pipe(Flag.withDefault(false), Flag.withDescription("write the score to the ledger"))
  },
  Effect.fn(function*(args) {
    const genome = yield* loadGenome(ROOT)
    const card = yield* runBench(genome, {
      benchDir: `${ROOT}/bench`,
      workDir: BENCH_WORK_DIR,
      only: args.task,
      concurrency: args.concurrency,
      reps: args.reps,
      log
    })
    if (args.record) yield* appendLedger(ROOT, { kind: "measure", at: new Date().toISOString(), card })
    yield* Console.log(`genome ${genome.id}: ${pct(card.score)}, ${card.solved}/${card.tasks} solved, $${card.costUsd.toFixed(2)}`)
  })
).pipe(Command.withDescription("score the current genome on the benchmark's hidden tests"))

const generation = Command.make(
  "generation",
  { task: taskFlag, concurrency: concurrencyFlag, reps: repsFlag },
  Effect.fn(function*(args) {
    // The generation logs its own verdict as it reaches it.
    yield* runGeneration({ root: ROOT, only: args.task, concurrency: args.concurrency, reps: args.reps, log })
  })
).pipe(Command.withDescription("one generation: recall, improve the genome, measure it, keep it or put it back"))

const evolve = Command.make(
  "evolve",
  {
    generations: Flag.Int("generations").pipe(Flag.withDefault(3), Flag.withDescription("how many generations to run")),
    budget: Flag.Finite("budget-usd").pipe(Flag.withDefault(25), Flag.withDescription("stop once the ledger's total spend passes this")),
    task: taskFlag,
    concurrency: concurrencyFlag,
    reps: repsFlag
  },
  Effect.fn(function*(args) {
    const passOn = [
      ...args.task.flatMap((t) => ["--task", t]),
      "--concurrency",
      String(args.concurrency),
      "--reps",
      String(args.reps)
    ]
    for (let i = 1; i <= args.generations; i++) {
      const spent = totalCost(yield* readLedger(ROOT))
      if (spent >= args.budget) {
        yield* Console.log(`stopping: the ledger has spent $${spent.toFixed(2)} of the $${args.budget} budget`)
        break
      }
      yield* Console.log(`\n=== generation ${i} of ${args.generations} ($${spent.toFixed(2)} spent so far) ===`)
      // A fresh process each time: it reads the genome, and zero's own code, as the last generation left them.
      const r = yield* runProcess(process.execPath, [CLI, "generation", ...passOn], { cwd: ROOT, timeoutS: 4 * 3600, inherit: true })
      if (r.exitCode !== 0) {
        yield* Console.log(`stopping: generation ${i} ${r.timedOut ? "timed out" : `exited ${r.exitCode}`}`)
        process.exitCode = 1
        break
      }
    }
    const history = attempts(yield* readLedger(ROOT))
    yield* Console.log(`\n${history.filter((a) => a.accepted).length} of ${history.length} attempts accepted so far; \`zero lineage\` shows them`)
  })
).pipe(Command.withDescription("run generations in a row, each in a fresh process, within a budget"))

const solveCommand = Command.make(
  "solve",
  {
    task: Argument.String("task").pipe(Argument.atLeast(1), Argument.withDescription("what to do")),
    cwd: Flag.String("cwd").pipe(Flag.optional, Flag.withDescription("the repo to work in (default: here)"))
  },
  Effect.fn(function*(args) {
    const genome = yield* loadGenome(ROOT)
    const cwd = Option.getOrElse(args.cwd, () => process.cwd())
    const r = yield* solve({ genome, task: args.task.join(" "), cwd, log })
    yield* Console.log([
      "",
      r.text,
      "",
      `${r.ok ? "done" : `stopped: ${r.subtype}`} in ${r.turns} turns, $${r.costUsd.toFixed(2)}` +
      (r.committed ? `; committed ${r.committed.slice(0, 10)} and stored it in singularity` : "; nothing committed")
    ].join("\n"))
  })
).pipe(Command.withDescription("work a task in a repo with the evolved solver, handed singularity's memory of it"))

const lineage = Command.make(
  "lineage",
  {},
  Effect.fn(function*() {
    const ledger = yield* readLedger(ROOT)
    const genome = yield* loadGenome(ROOT)
    const lines = [`current genome ${genome.id}`, ""]
    for (const a of attempts(ledger)) {
      const child = a.childScore === null ? "—" : pct(a.childScore)
      lines.push(`gen ${a.generation}  ${a.accepted ? "✓" : "·"}  ${pct(a.parentScore)} → ${child}  ${a.summary}`)
      lines.push(`         ${a.reason}${a.commit ? `  [${a.commit.slice(0, 10)}]` : ""}`)
    }
    if (attempts(ledger).length === 0) lines.push("no generations yet: run `zero generation` or `zero evolve`")
    lines.push("", `spent: $${totalCost(ledger).toFixed(2)}`)
    const memory = yield* Memory
    const stored = yield* memory.changes(ROOT).pipe(Effect.orElseSucceed(() => []))
    lines.push("", `singularity holds ${stored.length} change(s) for this repo${stored.length ? ":" : ""}`)
    for (const c of stored.slice(0, 10)) lines.push(`  ${c.commit.slice(0, 10)}  ${c.title}${c.retired ? "  (retired)" : ""}`)
    yield* Console.log(lines.join("\n"))
  })
).pipe(Command.withDescription("every attempt, kept or not, and what singularity stored"))

/** Expected failures get one line and exit code 2, not a stack trace. */
const reportError = (e: { readonly message: string }) =>
  Console.error(`error: ${e.message}`).pipe(Effect.andThen(Effect.sync(() => (process.exitCode = 2))))

const services = Layer.mergeAll(Claude.layer, Singularity.layer).pipe(Layer.provideMerge(NodeServices.layer))

Command.make("zero").pipe(
  Command.withDescription("a recursive self-improving agent built on singularity's memory"),
  Command.withSubcommands([bench, generation, evolve, solveCommand, lineage]),
  Command.run({ version: "0.1.0" }),
  Effect.catchTags({
    AgentError: reportError,
    GenomeError: reportError,
    GitError: reportError,
    BenchError: reportError
  }),
  Effect.provide(services),
  NodeRuntime.runMain
)
