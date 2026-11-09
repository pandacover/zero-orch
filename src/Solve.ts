/**
 * `zero solve`: the evolved solver on real work, in any git repo.
 *
 * This is where singularity's memory pays the solver directly. Before the
 * session starts, singularity hands over the past change in that repo most
 * like the task. The session works, runs the repo's checks, and commits; then
 * `singularity store` keeps that commit, so the next similar task there
 * starts from it. Every solved task leaves memory behind.
 */
import { Effect, Option } from "effect"
import { Agent } from "./Claude.ts"
import { type Genome, solverPrompt } from "./Genome.ts"
import { head } from "./Git.ts"
import { repoPolicy } from "./Policy.ts"
import { Memory, MEMORY_NOTE, type Recall } from "./Singularity.ts"

export const SOLVE_BUDGET_USD = 10

export const solvePrompt = (task: string, recall: Option.Option<Recall>): string =>
  [
    task.trim(),
    "",
    ...(Option.isSome(recall) ? [recall.value.text.trim(), ""] : []),
    "When the change is done, run this repo's checks (tests, typecheck, build or lint: whichever it has),",
    "fix what fails, and commit with `git add <files>` and `git commit -m \"<subject>\"` (a plain one-line subject).",
    "Commit only after the checks pass."
  ].join("\n")

export const solve = Effect.fn("Solve.run")(function*(input: {
  readonly genome: Genome
  readonly task: string
  readonly cwd: string
  readonly log: (line: string) => void
}) {
  const agent = yield* Agent
  const memory = yield* Memory
  const before = yield* head(input.cwd)
  const recall = yield* memory.recall(input.task, input.cwd).pipe(Effect.orElseSucceed(() => Option.none<Recall>()))
  input.log(Option.isSome(recall) ? `singularity handed over ${recall.value.commit.slice(0, 10)}` : "singularity: no past change like this here")
  const run = yield* agent.run({
    prompt: solvePrompt(input.task, recall),
    cwd: input.cwd,
    model: input.genome.knobs.solverModel,
    effort: input.genome.knobs.solverEffort,
    // Real tasks are bigger than benchmark ones.
    maxTurns: Math.max(input.genome.knobs.maxTurns, 60),
    maxBudgetUsd: SOLVE_BUDGET_USD,
    systemAppend: `${solverPrompt(input.genome)}\n\n${MEMORY_NOTE}`,
    policy: repoPolicy(input.cwd),
    persist: true,
    onEvent: input.log
  })
  const after = yield* head(input.cwd)
  if (after !== before) {
    yield* memory.store(input.cwd).pipe(Effect.catchTag("MemoryError", (e) => Effect.sync(() => input.log(`singularity store failed: ${e.message}`))))
  }
  return { ...run, committed: after !== before ? after : undefined }
})
