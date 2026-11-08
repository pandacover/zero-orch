/**
 * One generation of zero: measure, recall, improve, measure, keep or revert.
 *
 *   1. Start from a clean tree, so every change after this is the improver's.
 *   2. Score the current genome on the benchmark (or reuse its score from the
 *      ledger: a genome is measured once).
 *   3. Ask singularity for the past improvement most like this one. Every
 *      accepted improvement was a commit by an improver session, so this is
 *      memory of how zero improved itself before.
 *   4. Run the improver: an Agent SDK session in zero's own repo, with its
 *      instructions read from the genome (`genome/improver.md`, which it may
 *      also rewrite), the scorecard, the ledger and the recalled change.
 *   5. Guard: only `genome/` may change, and the new genome must load.
 *   6. Score the child. If it beats the parent, resume the improver's session
 *      and have it commit — its own commit, after its own passing checks, so
 *      singularity stores it — then `singularity store`. Otherwise put every
 *      file back.
 *   7. Write the attempt to the ledger, won or lost.
 *
 * `zero evolve` runs this in a fresh process per generation.
 */
import { Effect, Option, Path } from "effect"
import { Agent } from "./Claude.ts"
import { BENCH_WORK_DIR, loadTasks, runBench } from "./Bench.ts"
import { GitError } from "./Errors.ts"
import { judge } from "./Fitness.ts"
import { GENOME_DIR, type Genome, loadGenome, MODELS } from "./Genome.ts"
import { changes, head, revert, git } from "./Git.ts"
import { appendLedger, type Attempt, attempts, lastMeasure, readLedger, type Scorecard } from "./Ledger.ts"
import { improverPolicy } from "./Policy.ts"
import { Memory, type Recall } from "./Singularity.ts"

/** Most an improver session may spend. */
export const IMPROVER_BUDGET_USD = 5
export const IMPROVER_MAX_TURNS = 40

export interface GenerationOptions {
  readonly root: string
  readonly only?: ReadonlyArray<string> | undefined
  readonly concurrency?: number | undefined
  readonly log: (line: string) => void
}

const ImproverOutput = {
  type: "object",
  properties: {
    summary: { type: "string", description: "One line: what you changed in the genome." },
    hypothesis: { type: "string", description: "Why it should raise the score or cut the cost, naming the failures it addresses." },
    commitMessage: { type: "string", description: "A commit subject line for the change, under 70 characters, no quotes." }
  },
  required: ["summary", "hypothesis", "commitMessage"],
  additionalProperties: false
} as const

interface ImproverAnswer {
  readonly summary: string
  readonly hypothesis: string
  readonly commitMessage: string
}

const readAnswer = (value: unknown, fallback: string): ImproverAnswer => {
  const v = (value ?? {}) as Partial<Record<keyof ImproverAnswer, unknown>>
  const str = (x: unknown, d: string) => (typeof x === "string" && x.trim() !== "" ? x.trim() : d)
  return {
    summary: str(v.summary, fallback),
    hypothesis: str(v.hypothesis, ""),
    commitMessage: str(v.commitMessage, str(v.summary, "Improve the genome"))
  }
}

/** A subject line the commit-stage policy accepts: no quotes, `$` or backslashes, one line. */
export const safeSubject = (generation: number, message: string): string =>
  `gen ${generation}: ${message.replace(/[\r\n]+/g, " ").replace(/["$\\`;&|<>]/g, "").trim()}`.slice(0, 90)

/**
 * Whether a genome tells the solver where the hidden tests are. Reads are
 * confined and workspaces live outside the repo, but `node` can read any
 * file; a lesson pointing at `bench/` would game the score, not raise it.
 */
export const pointsAtTests = (genome: Genome, root: string): string | undefined => {
  const slashes = (s: string) => s.replace(/\\/g, "/").toLowerCase()
  const text = slashes(`${genome.solver}\n${genome.lessons}`)
  const found = /check\.mjs|\bbench\/|\.zero\//.exec(text)?.[0]
  if (found !== undefined) return found
  if (text.includes(slashes(root))) return "zero's own path"
  return undefined
}

const pct = (x: number) => `${(x * 100).toFixed(1)}%`

/**
 * Each setting the improver may change, its value now and what it accepts.
 * The improver can't choose what it doesn't know exists (gen 1 of the first
 * dogfood run only ever thought of effort).
 */
export const knobLines = (genome: Genome): Array<string> => {
  const k = genome.knobs
  const models = MODELS.join(", ")
  return [
    `- solverModel: ${k.solverModel} (one of: ${models}; prices differ a lot between them)`,
    `- solverEffort: ${k.solverEffort} (low, medium, high, xhigh, max)`,
    `- maxTurns: ${k.maxTurns} (4–80)`,
    `- improverModel: ${k.improverModel} (one of: ${models}): the model you run on`,
    `- improverEffort: ${k.improverEffort} (low, medium, high, xhigh, max)`
  ]
}

/** What the improver is told about where the genome stands. */
export const improverPrompt = (input: {
  readonly generation: number
  readonly genome: Genome
  readonly card: Scorecard
  readonly history: ReadonlyArray<Attempt>
  readonly recall: Option.Option<Recall>
}): string => {
  const { card } = input
  const lines: Array<string> = [
    `# Generation ${input.generation}`,
    "",
    `The current genome (${input.genome.id}) scores ${pct(card.score)} on the benchmark: ` +
    `${card.solved} of ${card.tasks} tasks fully solved, $${card.costUsd.toFixed(2)} spent.`,
    "",
    "## The genome's settings (genome/genome.json)",
    "",
    ...knobLines(input.genome),
    "",
    "## Scorecard",
    ""
  ]
  for (const r of card.results) {
    lines.push(`### ${r.id}: ${r.passed}/${r.total} hidden cases, $${r.costUsd.toFixed(3)}, ${r.turns} turns, stopped: ${r.stop}`)
    if (r.passed < r.total) {
      lines.push("", "Failed checks:", "```", r.failures || "(no output)", "```", "", "The solver's last words:", "```", r.lastWords || "(none)", "```")
    }
    lines.push("")
  }
  lines.push("## Earlier attempts (newest first)", "")
  if (input.history.length === 0) lines.push("None: this is the first generation.")
  for (const a of input.history.slice(-10).toReversed()) {
    const child = a.childScore === null ? "not measured" : pct(a.childScore)
    lines.push(`- gen ${a.generation} ${a.accepted ? "ACCEPTED" : "rejected"}: ${a.summary} (${pct(a.parentScore)} → ${child}; ${a.reason})`)
  }
  lines.push("", "## A past improvement singularity recalled", "")
  if (Option.isSome(input.recall)) {
    lines.push(input.recall.value.text.trim(), "", "Read it with `git show` before you decide; build on what worked.")
  } else {
    lines.push("singularity has no stored improvement like this one yet.")
  }
  lines.push(
    "",
    "## Your job",
    "",
    "Make one change to the genome, following your instructions, to raise the score or cut the cost.",
    "Edit only files under `genome/`. Run `npm run typecheck` and `npm test`, and finish when both pass.",
    "Don't commit. Finish with the JSON your output format asks for."
  )
  return lines.join("\n")
}

export const runGeneration = Effect.fn("Generation.run")(function*(options: GenerationOptions) {
  const { root, log } = options
  const path = yield* Path.Path
  const agent = yield* Agent
  const memory = yield* Memory

  // 1. A clean tree.
  const dirty = yield* changes(root)
  if (dirty.length > 0) {
    return yield* new GitError({
      message: `commit or stash your changes first; a generation reverts what it doesn't keep (${dirty.slice(0, 5).map((c) => c.path).join(", ")})`
    })
  }
  const startHead = yield* head(root)

  // 2. The parent, measured once.
  const ledger = yield* readLedger(root)
  const history = attempts(ledger)
  const generation = history.length + 1
  const parentGenome = yield* loadGenome(root)
  const bench = {
    benchDir: path.join(root, "bench"),
    workDir: BENCH_WORK_DIR,
    only: options.only,
    concurrency: options.concurrency,
    log
  }
  const taskIds = (yield* loadTasks(bench.benchDir, options.only)).map((t) => t.id)
  let parent = lastMeasure(ledger, parentGenome.id, taskIds)
  if (parent === undefined) {
    log(`gen ${generation}: measuring the current genome ${parentGenome.id}`)
    parent = yield* runBench(parentGenome, bench)
    yield* appendLedger(root, { kind: "measure", at: new Date().toISOString(), card: parent })
  }
  log(`gen ${generation}: parent ${parentGenome.id} scores ${pct(parent.score)} ($${parent.costUsd.toFixed(2)})`)

  // 3. Memory of past self-improvement.
  const failing = parent.results.filter((r) => r.passed < r.total).map((r) => r.id)
  const objective = failing.length > 0
    ? `improve zero's genome so the solver passes more hidden cases on ${failing.join(", ")}`
    : "improve zero's genome so the solver passes every task for less cost"
  const recall = yield* memory.recall(objective, root).pipe(
    Effect.catchTag("MemoryError", (e) => Effect.sync(() => (log(`singularity recall failed, going on without it: ${e.message}`), Option.none<Recall>())))
  )
  log(Option.isSome(recall) ? `singularity recalled ${recall.value.commit.slice(0, 10)}` : "singularity: nothing recalled")

  // 4. The improver.
  log(`gen ${generation}: improver running`)
  const improver = yield* agent.run({
    prompt: improverPrompt({ generation, genome: parentGenome, card: parent, history, recall }),
    cwd: root,
    model: parentGenome.knobs.improverModel,
    effort: parentGenome.knobs.improverEffort,
    maxTurns: IMPROVER_MAX_TURNS,
    maxBudgetUsd: IMPROVER_BUDGET_USD,
    systemAppend: parentGenome.improver,
    policy: improverPolicy(root, "improve"),
    outputSchema: ImproverOutput,
    persist: true,
    onEvent: (line) => log(`[improver]${line}`)
  }).pipe(
    // A crashed session is a failed attempt: the guard below reverts whatever it left.
    Effect.catchTag("AgentError", (e) =>
      Effect.succeed({ sessionId: "", ok: false, subtype: `crashed: ${e.message}`, text: e.message, structured: undefined, costUsd: 0, turns: 0 })
    )
  )
  const answer = readAnswer(improver.structured, improver.ok ? "(no summary)" : `improver stopped: ${improver.subtype}`)
  log(`gen ${generation}: improver says: ${answer.summary}`)

  const record = (fields: Pick<Attempt, "accepted" | "reason" | "childId" | "childScore" | "commit" | "files">) =>
    appendLedger(root, {
      kind: "attempt",
      at: new Date().toISOString(),
      generation,
      parentId: parentGenome.id,
      summary: answer.summary,
      hypothesis: answer.hypothesis,
      parentScore: parent.score,
      improverCostUsd: improver.costUsd,
      ...fields
    }).pipe(Effect.as({ generation, summary: answer.summary, ...fields }))

  // 5. The guard.
  const changed = yield* changes(root)
  const files = changed.map((c) => c.path)
  const reject = (reason: string, child: { id: string | null; score: number | null } = { id: null, score: null }) =>
    Effect.gen(function*() {
      yield* revert(root, changed)
      if ((yield* head(root)) !== startHead) yield* git(root, ["reset", "--hard", startHead])
      log(`gen ${generation}: rejected: ${reason}`)
      return yield* record({ accepted: false, reason, childId: child.id, childScore: child.score, commit: null, files })
    })
  if ((yield* head(root)) !== startHead) return yield* reject("the improver committed before it was measured")
  if (changed.length === 0) return yield* reject(improver.ok ? "the improver changed nothing" : `the improver stopped (${improver.subtype}) without a change`)
  const outside = files.filter((f) => !f.startsWith(`${GENOME_DIR}/`))
  if (outside.length > 0) return yield* reject(`changed files outside the genome: ${outside.join(", ")}`)
  const childGenome = yield* loadGenome(root).pipe(Effect.option)
  if (Option.isNone(childGenome)) return yield* reject("the new genome doesn't load (genome.json invalid?)")
  const leak = pointsAtTests(childGenome.value, root)
  if (leak !== undefined) return yield* reject(`the genome points the solver at the benchmark itself (${leak})`)

  // 6. Measure the child; keep it only if it wins.
  log(`gen ${generation}: measuring the child ${childGenome.value.id} (${files.join(", ")})`)
  const child = yield* runBench(childGenome.value, bench)
  yield* appendLedger(root, { kind: "measure", at: new Date().toISOString(), card: child })
  const verdict = judge(parent, child)
  if (!verdict.accept) return yield* reject(verdict.reason, { id: child.genomeId, score: child.score })

  log(`gen ${generation}: accepted: ${verdict.reason}; the improver commits it`)
  const subject = safeSubject(generation, answer.commitMessage)
  yield* agent.run({
    prompt: [
      `zero measured your change on the benchmark: ${verdict.reason}. It is accepted.`,
      "Commit it now with exactly these two commands, then stop:",
      "",
      "    git add genome",
      `    git commit -m "${subject}"`
    ].join("\n"),
    cwd: root,
    model: parentGenome.knobs.improverModel,
    effort: "low",
    maxTurns: 6,
    maxBudgetUsd: 0.5,
    systemAppend: parentGenome.improver,
    policy: improverPolicy(root, "commit"),
    resume: improver.sessionId,
    persist: true,
    onEvent: (line) => log(`[improver]${line}`)
  }).pipe(Effect.catchTag("AgentError", (e) => Effect.sync(() => log(`commit session failed: ${e.message}`))))

  let note = ""
  if ((yield* head(root)) === startHead) {
    // The session didn't commit. Keep the win anyway; singularity may not store a commit no session made.
    yield* git(root, ["add", GENOME_DIR])
    yield* git(root, ["commit", "-m", subject])
    note = " (committed by zero, not the session: singularity may not store it)"
  }
  const commit = yield* head(root)
  const leftover = (yield* changes(root)).filter((c) => c.path.startsWith(`${GENOME_DIR}/`))
  if (leftover.length > 0) yield* revert(root, leftover)

  // singularity: store the session's commit, then say whether it's in memory.
  yield* memory.store(root).pipe(Effect.catchTag("MemoryError", (e) => Effect.sync(() => log(`singularity store failed: ${e.message}`))))
  const stored = yield* memory.changes(root).pipe(Effect.orElseSucceed(() => []))
  const inMemory = stored.some((c) => c.commit === commit)
  log(`gen ${generation}: committed ${commit.slice(0, 10)}${note}; ${inMemory ? "singularity stored it" : "not in singularity's memory yet"}`)
  return yield* record({ accepted: true, reason: verdict.reason + note, childId: child.genomeId, childScore: child.score, commit, files })
})
