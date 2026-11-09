/**
 * zero's own evolution, as the control plane shows it: the lineage, and the
 * benchmark, generation and evolve runs, started as child processes of the
 * CLI (`zero bench --record`, `zero generation`, `zero evolve`), one at a
 * time, their output streamed to open pages.
 */
import { Effect } from "effect"
import { spawn, type ChildProcess } from "node:child_process"
import { join } from "node:path"
import { BENCH_WORK_DIR, loadTasks } from "../Bench.ts"
import { GENOME_DIR, GENOME_FILES, loadGenome } from "../Genome.ts"
import { changes, revert } from "../Git.ts"
import { attempts, readLedger, totalCost } from "../Ledger.ts"
import { cleanEnv } from "../Proc.ts"
import { Memory, type StoredChange } from "../Singularity.ts"
import type { Hub } from "./Threads.ts"

export type JobKind = "bench" | "generation" | "evolve"

export interface JobRequest {
  readonly kind: JobKind
  readonly tasks: ReadonlyArray<string>
  readonly generations: number
  readonly budgetUsd: number
  /** How many times each task runs; the score averages over them. */
  readonly reps: number
}

export interface Job {
  readonly id: number
  readonly request: JobRequest
  readonly startedAt: string
  state: "running" | "stopping" | "done" | "failed" | "stopped"
  exitCode: number | null
  endedAt: string | null
}

/** The command line a job runs, after `node src/cli.ts`. */
export const jobArgs = (r: JobRequest): Array<string> => {
  const tasks = r.tasks.flatMap((t) => ["--task", t])
  const reps = r.reps > 1 ? ["--reps", String(r.reps)] : []
  if (r.kind === "bench") return ["bench", "--record", ...reps, ...tasks]
  if (r.kind === "generation") return ["generation", ...reps, ...tasks]
  return ["evolve", "--generations", String(r.generations), "--budget-usd", String(r.budgetUsd), ...reps, ...tasks]
}

/** A job request from the page, checked: unknown kinds, tasks or out-of-range numbers are refused. */
export const parseJobRequest = (body: unknown, knownTasks: ReadonlyArray<string>): JobRequest | string => {
  const b = (body ?? {}) as Record<string, unknown>
  const kind = b["kind"]
  if (kind !== "bench" && kind !== "generation" && kind !== "evolve") return "kind must be bench, generation or evolve"
  const tasks = Array.isArray(b["tasks"]) ? b["tasks"] : []
  if (!tasks.every((t): t is string => typeof t === "string" && knownTasks.includes(t))) return "unknown benchmark task"
  const generations = typeof b["generations"] === "number" ? b["generations"] : 3
  const budgetUsd = typeof b["budgetUsd"] === "number" ? b["budgetUsd"] : 25
  if (!Number.isInteger(generations) || generations < 1 || generations > 50) return "generations must be 1–50"
  if (!Number.isFinite(budgetUsd) || budgetUsd <= 0 || budgetUsd > 1000) return "budget must be between $0 and $1000"
  const reps = b["reps"] === undefined ? 1 : b["reps"]
  if (typeof reps !== "number" || !Number.isInteger(reps) || reps < 1 || reps > 5) return "reps must be a whole number 1–5"
  return { kind, tasks, generations, budgetUsd, reps }
}

const stripAnsi = (s: string) => s.replace(/\x1b\[[0-9;]*[A-Za-z]/g, "")

export const makeEvolution = (options: { readonly root: string; readonly cli: string; readonly hub: Hub }) => {
  const { root, cli, hub } = options
  let job: Job | undefined
  let child: ChildProcess | undefined
  let nextId = 1
  const log: Array<{ n: number; line: string }> = []
  let lineNo = 0

  const pushLine = (line: string) => {
    const entry = { n: ++lineNo, line }
    log.push(entry)
    if (log.length > 3000) log.splice(0, log.length - 3000)
    hub.send("zero-log", entry)
    if (/^gen \d+:|^genome |hidden cases|committed|rejected|accepted/.test(line)) hub.send("zero-state", {})
  }

  const running = () => job?.state === "running" || job?.state === "stopping"

  const start = (request: JobRequest) => {
    const id = nextId++
    job = { id, request, startedAt: new Date().toISOString(), state: "running", exitCode: null, endedAt: null }
    log.length = 0
    pushLine(`$ zero ${jobArgs(request).join(" ")}`)
    child = spawn(process.execPath, [cli, ...jobArgs(request)], { cwd: root, env: cleanEnv(), windowsHide: true })
    for (const stream of [child.stdout, child.stderr]) {
      let pending = ""
      stream?.setEncoding("utf8")
      stream?.on("data", (chunk: string) => {
        pending += chunk
        const lines = pending.split(/\r?\n/)
        pending = lines.pop() ?? ""
        for (const l of lines) pushLine(stripAnsi(l))
      })
      stream?.on("end", () => pending && pushLine(stripAnsi(pending)))
    }
    child.on("exit", (code) => {
      if (job?.id !== id) return
      job.exitCode = code
      job.endedAt = new Date().toISOString()
      job.state = job.state === "stopping" ? "stopped" : code === 0 ? "done" : "failed"
      child = undefined
      hub.send("zero-job", job)
      hub.send("zero-state", {})
    })
    hub.send("zero-job", job)
    return job
  }

  const stop = () => {
    if (!child || !job || job.state !== "running") return false
    job.state = "stopping"
    hub.send("zero-job", job)
    // The whole tree: zero's own child processes and the agent sessions under them.
    if (process.platform === "win32" && child.pid) spawn("taskkill", ["/T", "/F", "/PID", String(child.pid)], { windowsHide: true })
    else child.kill("SIGTERM")
    return true
  }

  let memoryCache: { at: number; value: ReadonlyArray<StoredChange> } | undefined
  const state = Effect.gen(function*() {
    const genome = yield* loadGenome(root).pipe(Effect.option)
    const tasks = yield* loadTasks(join(root, "bench")).pipe(Effect.orElseSucceed(() => []))
    const ledger = yield* readLedger(root)
    const tree = yield* changes(root).pipe(Effect.orElseSucceed(() => []))
    if (!memoryCache || Date.now() - memoryCache.at > 15_000) {
      const memory = yield* Memory
      memoryCache = { at: Date.now(), value: yield* memory.changes(root).pipe(Effect.orElseSucceed(() => [])) }
    }
    return {
      root,
      genome: genome._tag === "Some"
        ? {
          id: genome.value.id,
          knobs: genome.value.knobs,
          files: {
            [GENOME_FILES.solver]: genome.value.solver,
            [GENOME_FILES.lessons]: genome.value.lessons,
            [GENOME_FILES.improver]: genome.value.improver,
            [GENOME_FILES.knobs]: JSON.stringify(genome.value.knobs, null, 2)
          }
        }
        : null,
      tasks: tasks.map((t) => ({ id: t.id, prompt: t.prompt })),
      measures: ledger.flatMap((e) => (e.kind === "measure" ? [{ at: e.at, ...e.card }] : [])),
      attempts: attempts(ledger),
      spentUsd: totalCost(ledger),
      tree: tree.map((c) => c.path),
      memory: memoryCache.value,
      job: job ?? null,
      log,
      workDir: BENCH_WORK_DIR
    }
  })

  /** Start a run, if the request is sound and the tree allows it. */
  const request = (body: unknown) =>
    Effect.gen(function*() {
      if (running()) return { status: 409, body: { error: "a run is already going; stop it first" } }
      const tasks = (yield* loadTasks(join(root, "bench")).pipe(Effect.orElseSucceed(() => []))).map((t) => t.id)
      const parsed = parseJobRequest(body, tasks)
      if (typeof parsed === "string") return { status: 400, body: { error: parsed } }
      if (parsed.kind !== "bench") {
        const dirty = yield* changes(root).pipe(Effect.orElseSucceed(() => []))
        if (dirty.length > 0) return { status: 409, body: { error: "commit or discard the uncommitted changes first", files: dirty.map((c) => c.path) } }
      }
      return { status: 202, body: start(parsed) }
    })

  /** Put back what a stopped run left in genome/, and only there. */
  const discard = Effect.gen(function*() {
    if (running()) return { status: 409, body: { error: "stop the run first" } }
    const dirty = yield* changes(root).pipe(Effect.orElseSucceed(() => []))
    const outside = dirty.filter((c) => !c.path.startsWith(`${GENOME_DIR}/`))
    if (outside.length > 0) return { status: 409, body: { error: "changes outside genome/ are yours; commit or discard them yourself", files: outside.map((c) => c.path) } }
    yield* revert(root, dirty).pipe(Effect.orElseSucceed(() => undefined))
    hub.send("zero-state", {})
    return { status: 200, body: { discarded: dirty.map((c) => c.path) } }
  })

  return { state, request, stop, discard, running }
}
