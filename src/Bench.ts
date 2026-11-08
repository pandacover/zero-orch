/**
 * The benchmark: zero's fitness function.
 *
 * Each task is a folder in `bench/`: `task.md` (what the solver is told),
 * optionally `files/` (copied into its workspace), and `check.mjs`, the
 * hidden tests. The solver works in a fresh scratch folder and never sees
 * the check; it runs afterwards, as `node bench/<task>/check.mjs <workspace>`,
 * and prints one JSON line `{"passed": n, "total": m}`.
 *
 * A genome's score is the mean over tasks of passed/total — partial credit,
 * so an improvement that fixes one more edge case shows.
 */
import { Effect, FileSystem, Path } from "effect"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { Agent } from "./Claude.ts"
import { BenchError } from "./Errors.ts"
import { type Genome, solverPrompt } from "./Genome.ts"
import type { Scorecard, TaskScore } from "./Ledger.ts"
import { solverPolicy } from "./Policy.ts"
import { runProcess, tail } from "./Proc.ts"

export interface BenchTask {
  readonly id: string
  readonly dir: string
  readonly prompt: string
}

/**
 * Where solver workspaces go: outside zero's repo, so nothing near a
 * workspace leads to the hidden tests.
 */
export const BENCH_WORK_DIR = join(tmpdir(), "zero-bench")

/** Most a solver session may spend on one task. */
export const SOLVER_BUDGET_USD = 2

export const loadTasks = Effect.fn("Bench.load")(function*(benchDir: string, only: ReadonlyArray<string> = []) {
  const fs = yield* FileSystem.FileSystem
  const path = yield* Path.Path
  const names = yield* fs.readDirectory(benchDir).pipe(
    Effect.mapError(() => new BenchError({ message: `no benchmark at ${benchDir}` }))
  )
  const tasks: Array<BenchTask> = []
  for (const id of names.toSorted()) {
    if (id.startsWith("_") || id.startsWith(".")) continue
    if (only.length > 0 && !only.includes(id)) continue
    const dir = path.join(benchDir, id)
    const prompt = yield* fs.readFileString(path.join(dir, "task.md")).pipe(Effect.orElseSucceed(() => undefined))
    if (prompt === undefined) continue
    if (!(yield* fs.exists(path.join(dir, "check.mjs")).pipe(Effect.orElseSucceed(() => false)))) continue
    tasks.push({ id, dir, prompt })
  }
  if (tasks.length === 0) return yield* new BenchError({ message: `no tasks in ${benchDir}${only.length ? ` named ${only.join(", ")}` : ""}` })
  return tasks as ReadonlyArray<BenchTask>
})

/** The check's verdict, read from the last JSON line it printed. */
export const parseCheck = (stdout: string): { passed: number; total: number } => {
  const lines = stdout.trim().split("\n").reverse()
  for (const line of lines) {
    try {
      const v = JSON.parse(line) as { passed?: unknown; total?: unknown }
      if (typeof v.passed === "number" && typeof v.total === "number" && v.total > 0) return { passed: v.passed, total: v.total }
    } catch {
      // not the verdict line
    }
  }
  return { passed: 0, total: 1 }
}

const taskPrompt = (task: BenchTask, workspace: string) =>
  [
    task.prompt.trim(),
    "",
    `Your working directory is ${workspace}. Put every file there.`,
    "The shell runs one command per call and only `node <file>` (no `cd`, `&&`, pipes or `node -e`):",
    "to try your code, write a script file and run it with node.",
    "Hidden tests will import your module and check it after you finish."
  ].join("\n")

export const runTask = Effect.fn("Bench.runTask")(function*(
  genome: Genome,
  task: BenchTask,
  workspace: string,
  log: (line: string) => void
) {
  const fs = yield* FileSystem.FileSystem
  const path = yield* Path.Path
  const agent = yield* Agent
  yield* fs.makeDirectory(workspace, { recursive: true })
  const files = path.join(task.dir, "files")
  if (yield* fs.exists(files)) yield* fs.copy(files, workspace)

  const run = yield* agent.run({
    prompt: taskPrompt(task, workspace),
    cwd: workspace,
    model: genome.knobs.solverModel,
    effort: genome.knobs.solverEffort,
    maxTurns: genome.knobs.maxTurns,
    maxBudgetUsd: SOLVER_BUDGET_USD,
    systemAppend: solverPrompt(genome),
    policy: solverPolicy(workspace),
    persist: false,
    onEvent: (line) => log(`[${task.id}]${line}`)
  }).pipe(
    // A session that crashes scores zero on its task; it doesn't stop the benchmark.
    Effect.catchTag("AgentError", (e) =>
      Effect.succeed({ sessionId: "", ok: false, subtype: "crashed", text: e.message, structured: undefined, costUsd: 0, turns: 0 })
    )
  )

  const check = yield* runProcess(process.execPath, [path.join(task.dir, "check.mjs"), workspace], {
    cwd: workspace,
    timeoutS: 60
  })
  const verdict = check.timedOut ? { passed: 0, total: 1 } : parseCheck(check.stdout)
  const failures = check.stdout.split("\n").filter((l) => !l.startsWith("{")).join("\n").trim()
  log(`[${task.id}] ${verdict.passed}/${verdict.total} hidden cases, $${run.costUsd.toFixed(3)}, ${run.turns} turns (${run.subtype})`)
  return {
    id: task.id,
    passed: verdict.passed,
    total: verdict.total,
    costUsd: run.costUsd,
    turns: run.turns,
    stop: run.subtype,
    failures: tail(check.timedOut ? "the check timed out" : failures, 800),
    lastWords: tail(run.text, 500)
  } satisfies TaskScore
})

export interface BenchOptions {
  readonly benchDir: string
  /** Where workspaces go; each run gets a fresh folder under it. */
  readonly workDir: string
  readonly only?: ReadonlyArray<string> | undefined
  readonly concurrency?: number | undefined
  readonly log?: ((line: string) => void) | undefined
}

export const runBench = Effect.fn("Bench.run")(function*(genome: Genome, options: BenchOptions) {
  const path = yield* Path.Path
  const log = options.log ?? (() => {})
  const tasks = yield* loadTasks(options.benchDir, options.only)
  const runDir = path.join(options.workDir, `${new Date().toISOString().replace(/[:.]/g, "-")}-${genome.id}`)
  log(`benchmark: ${tasks.length} task(s), genome ${genome.id}`)
  const results = yield* Effect.forEach(
    tasks,
    (task) => runTask(genome, task, path.join(runDir, task.id), log),
    { concurrency: options.concurrency ?? 3 }
  )
  return scorecard(genome.id, results)
})

export const scorecard = (genomeId: string, results: ReadonlyArray<TaskScore>): Scorecard => ({
  genomeId,
  score: results.reduce((s, r) => s + r.passed / r.total, 0) / Math.max(results.length, 1),
  solved: results.filter((r) => r.passed === r.total).length,
  tasks: results.length,
  costUsd: results.reduce((s, r) => s + r.costUsd, 0),
  results
})
