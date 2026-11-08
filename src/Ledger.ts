/**
 * The ledger: every measurement and every attempt, kept or not.
 *
 * git (and so singularity) holds only the improvements that won. The ledger
 * also holds the ones that lost, which the next improver needs as much: what
 * was tried, what it scored, why it was turned down. One JSON line per entry
 * in `.zero/ledger.jsonl`, local to this checkout.
 */
import { Effect, FileSystem, Path, Schema } from "effect"

export const TaskScore = Schema.Struct({
  id: Schema.String,
  passed: Schema.Number,
  total: Schema.Number,
  costUsd: Schema.Number,
  turns: Schema.Number,
  stop: Schema.String,
  failures: Schema.String,
  lastWords: Schema.String
})
export type TaskScore = typeof TaskScore.Type

export const Scorecard = Schema.Struct({
  genomeId: Schema.String,
  /** Mean over tasks of the share of hidden cases passed, 0–1. */
  score: Schema.Number,
  /** Tasks with every hidden case passed. */
  solved: Schema.Number,
  tasks: Schema.Number,
  costUsd: Schema.Number,
  results: Schema.Array(TaskScore)
})
export type Scorecard = typeof Scorecard.Type

export const Measure = Schema.Struct({
  kind: Schema.Literal("measure"),
  at: Schema.String,
  card: Scorecard
})

export const Attempt = Schema.Struct({
  kind: Schema.Literal("attempt"),
  at: Schema.String,
  generation: Schema.Number,
  parentId: Schema.String,
  childId: Schema.NullOr(Schema.String),
  accepted: Schema.Boolean,
  reason: Schema.String,
  summary: Schema.String,
  hypothesis: Schema.String,
  files: Schema.Array(Schema.String),
  parentScore: Schema.Number,
  childScore: Schema.NullOr(Schema.Number),
  /** The commit an accepted attempt became. */
  commit: Schema.NullOr(Schema.String),
  /** What the improver session cost (the child's measurement is its own entry). */
  improverCostUsd: Schema.Number
})
export type Attempt = typeof Attempt.Type

export const Entry = Schema.Union([Measure, Attempt])
export type Entry = typeof Entry.Type

const EntryJson = Schema.fromJsonString(Entry)
const decodeLine = Schema.decodeUnknownOption(EntryJson)
const encodeLine = Schema.encodeSync(EntryJson)

export const ledgerPath = (root: string) => `${root}/.zero/ledger.jsonl`

export const readLedger = Effect.fn("Ledger.read")(function*(root: string) {
  const fs = yield* FileSystem.FileSystem
  const file = ledgerPath(root)
  if (!(yield* fs.exists(file).pipe(Effect.orElseSucceed(() => false)))) return [] as ReadonlyArray<Entry>
  const text = yield* fs.readFileString(file).pipe(Effect.orElseSucceed(() => ""))
  const entries: Array<Entry> = []
  for (const line of text.split("\n")) {
    if (line.trim() === "") continue
    const entry = decodeLine(line)
    if (entry._tag === "Some") entries.push(entry.value)
  }
  return entries as ReadonlyArray<Entry>
})

export const appendLedger = Effect.fn("Ledger.append")(function*(root: string, entry: Entry) {
  const fs = yield* FileSystem.FileSystem
  const path = yield* Path.Path
  const file = ledgerPath(root)
  yield* fs.makeDirectory(path.dirname(file), { recursive: true })
  yield* fs.writeFileString(file, `${encodeLine(entry)}\n`, { flag: "a" })
})

/**
 * The genome's latest score on exactly these tasks. A score on a subset
 * (`--task`) isn't comparable to one on the whole benchmark, so it never
 * stands in for it.
 */
export const lastMeasure = (
  entries: ReadonlyArray<Entry>,
  genomeId: string,
  taskIds: ReadonlyArray<string>
): Scorecard | undefined => {
  const key = [...taskIds].sort().join(",")
  for (let i = entries.length - 1; i >= 0; i--) {
    const e = entries[i]!
    if (e.kind === "measure" && e.card.genomeId === genomeId && e.card.results.map((r) => r.id).sort().join(",") === key) {
      return e.card
    }
  }
  return undefined
}

export const attempts = (entries: ReadonlyArray<Entry>): ReadonlyArray<Attempt> =>
  entries.filter((e): e is Attempt => e.kind === "attempt")

/** What every session in the ledger cost: improvers and measurements. */
export const totalCost = (entries: ReadonlyArray<Entry>): number =>
  entries.reduce((sum, e) => sum + (e.kind === "measure" ? e.card.costUsd : e.improverCostUsd), 0)
