import * as NodeServices from "@effect/platform-node/NodeServices"
import { describe, expect, it } from "@effect/vitest"
import { Effect } from "effect"
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { scorecard } from "../src/Bench.ts"
import { type Entry, lastMeasure, readLedger, type TaskScore } from "../src/Ledger.ts"

const task = (id: string, passed: number): TaskScore => ({
  id, passed, total: 10, costUsd: 0.1, turns: 5, stop: "success", failures: "", lastWords: ""
})

const measure = (genomeId: string, ids: Array<string>, reps: number): Entry => ({
  kind: "measure",
  at: "2026-11-09T00:00:00.000Z",
  card: scorecard(genomeId, ids.map((id) => task(id, 5)), reps)
})

describe("ledger", () => {
  it("reuses a score only when it was measured with the same reps", () => {
    const entries = [measure("g", ["a", "b"], 1), measure("g", ["a", "b"], 3)]
    expect(lastMeasure(entries, "g", ["b", "a"])?.reps).toBe(1)
    expect(lastMeasure(entries, "g", ["a", "b"], 3)?.reps).toBe(3)
    expect(lastMeasure(entries, "g", ["a", "b"], 2)).toBeUndefined()
    // The task set still has to match too.
    expect(lastMeasure(entries, "g", ["a"], 3)).toBeUndefined()
  })

  it.effect("reads a ledger line written before reps existed as one rep", () =>
    Effect.gen(function*() {
      const root = mkdtempSync(join(tmpdir(), "zero-ledger-"))
      mkdirSync(join(root, ".zero"))
      const old = {
        kind: "measure",
        at: "2026-10-01T00:00:00.000Z",
        card: { genomeId: "g", score: 0.5, solved: 0, tasks: 1, costUsd: 0.1, results: [task("a", 5)] }
      }
      writeFileSync(join(root, ".zero", "ledger.jsonl"), `${JSON.stringify(old)}\n`)
      const entries = yield* readLedger(root).pipe(Effect.provide(NodeServices.layer))
      expect(entries).toHaveLength(1)
      expect(lastMeasure(entries, "g", ["a"])?.reps).toBe(1)
    }))
})
