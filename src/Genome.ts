/**
 * The genome: everything about zero that zero may rewrite.
 *
 * It lives as plain files under `genome/`, in git, so each accepted change to
 * it is a commit — the unit singularity stores and recalls. Four parts:
 *
 * - `genome.json`  the knobs: models, effort, turn limit (schema-checked, bounded)
 * - `solver.md`    how the solver works a task (appended to Claude Code's prompt)
 * - `lessons.md`   what past generations learned, handed to the solver too
 * - `improver.md`  how the improver improves — the improver's own instructions,
 *                  which the improver may rewrite. That's what makes it recursive.
 *
 * The benchmark (`bench/`) and the loop that judges it are outside the genome:
 * an improver can't edit the test it is graded on.
 */
import { Effect, FileSystem, Path, Schema } from "effect"
import { createHash } from "node:crypto"
import { GenomeError } from "./Errors.ts"

/** The Claude models a genome may run on. */
export const MODELS = ["claude-opus-5-5", "claude-sonnet-5-5", "claude-haiku-5-5", "claude-fable-5-1"] as const
export const Model = Schema.Literals(MODELS)

export const Effort = Schema.Literals(["low", "medium", "high", "xhigh", "max"])
export type Effort = typeof Effort.Type

export const Knobs = Schema.Struct({
  /** The model the solver runs on. */
  solverModel: Model,
  solverEffort: Effort,
  /** The solver's turn limit on one task. */
  maxTurns: Schema.Int.check(Schema.isBetween({ minimum: 4, maximum: 80 })),
  /** The model the improver runs on. */
  improverModel: Model,
  improverEffort: Effort
})
export type Knobs = typeof Knobs.Type

const KnobsJson = Schema.fromJsonString(Knobs)
const decodeKnobs = Schema.decodeUnknownEffect(KnobsJson)

export interface Genome {
  readonly knobs: Knobs
  readonly solver: string
  readonly lessons: string
  readonly improver: string
  /** A hash of all four parts: the genome's identity in the ledger. */
  readonly id: string
}

/** The genome's files, relative to the repo root. */
export const GENOME_DIR = "genome"
export const GENOME_FILES = {
  knobs: "genome/genome.json",
  solver: "genome/solver.md",
  lessons: "genome/lessons.md",
  improver: "genome/improver.md"
} as const

/** Line endings don't count: a checkout on Windows may write CRLF. */
export const genomeId = (parts: Omit<Genome, "id">): string =>
  createHash("sha256")
    .update(JSON.stringify([parts.knobs, ...[parts.solver, parts.lessons, parts.improver].map((p) => p.replace(/\r\n/g, "\n"))]))
    .digest("hex")
    .slice(0, 12)

export const loadGenome = Effect.fn("Genome.load")(function*(root: string) {
  const fs = yield* FileSystem.FileSystem
  const path = yield* Path.Path
  const read = (file: string) =>
    fs.readFileString(path.join(root, file)).pipe(
      Effect.mapError(() => new GenomeError({ message: `can't read ${file} in ${root}` }))
    )
  const knobs = yield* read(GENOME_FILES.knobs).pipe(
    Effect.flatMap((text) => decodeKnobs(text)),
    Effect.mapError((e) =>
      e._tag === "GenomeError" ? e : new GenomeError({ message: `${GENOME_FILES.knobs} is invalid: ${e.message}` })
    )
  )
  const parts = {
    knobs,
    solver: yield* read(GENOME_FILES.solver),
    lessons: yield* read(GENOME_FILES.lessons),
    improver: yield* read(GENOME_FILES.improver)
  }
  return { ...parts, id: genomeId(parts) } satisfies Genome
})

/** The solver's system prompt addition: its instructions, then the lessons. */
export const solverPrompt = (genome: Genome): string =>
  [genome.solver.trim(), "", "# Lessons from earlier generations", "", genome.lessons.trim()].join("\n")
