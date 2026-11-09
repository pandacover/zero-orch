import { describe, expect, it } from "vitest"
import { combineReps, parseCheck, scorecard } from "../src/Bench.ts"
import { judge } from "../src/Fitness.ts"
import type { TaskScore } from "../src/Ledger.ts"

const task = (id: string, passed: number, total: number, costUsd: number, turns = 5): TaskScore => ({
  id, passed, total, costUsd, turns, stop: "success", failures: "", lastWords: ""
})

describe("fitness", () => {
  it("scores with partial credit", () => {
    const card = scorecard("g", [task("a", 10, 10, 0.1), task("b", 5, 10, 0.2)])
    expect(card.score).toBeCloseTo(0.75)
    expect(card.solved).toBe(1)
    expect(card.costUsd).toBeCloseTo(0.3)
    expect(card.reps).toBe(1)
  })

  it("sums a task's reps, averages its turns and keeps the worst rep's words", () => {
    const worst = { ...task("a", 2, 8, 0.3, 9), stop: "error_max_turns", failures: "FAIL edge", lastWords: "gave up" }
    const combined = combineReps([task("a", 8, 8, 0.1, 3), worst, task("a", 6, 8, 0.2, 6)])
    expect(combined).toEqual({
      id: "a", passed: 16, total: 24, costUsd: expect.closeTo(0.6), turns: 6,
      stop: "error_max_turns", failures: "FAIL edge", lastWords: "gave up"
    })
  })

  it("scores reps as the mean pass rate over every run", () => {
    const a = combineReps([task("a", 10, 10, 0.1), task("a", 0, 10, 0.1)])
    const b = combineReps([task("b", 10, 10, 0.1), task("b", 10, 10, 0.1)])
    const card = scorecard("g", [a, b], 2)
    expect(card.score).toBeCloseTo(0.75)
    // A task counts as solved only when every rep solved it.
    expect(card.solved).toBe(1)
    expect(card.costUsd).toBeCloseTo(0.4)
    expect(card.reps).toBe(2)
  })

  it("accepts a higher score, rejects a lower one", () => {
    const parent = scorecard("p", [task("a", 5, 10, 1)])
    expect(judge(parent, scorecard("c", [task("a", 7, 10, 3)])).accept).toBe(true)
    expect(judge(parent, scorecard("c", [task("a", 4, 10, 0.1)])).accept).toBe(false)
  })

  it("breaks a tie on cost only when clearly cheaper", () => {
    const parent = scorecard("p", [task("a", 10, 10, 1)])
    expect(judge(parent, scorecard("c", [task("a", 10, 10, 0.8)])).accept).toBe(true)
    expect(judge(parent, scorecard("c", [task("a", 10, 10, 0.95)])).accept).toBe(false)
    expect(judge(parent, scorecard("c", [task("a", 10, 10, 1.5)])).accept).toBe(false)
  })

  it("reads the check's verdict line", () => {
    expect(parseCheck('FAIL x: nope\n{"passed":3,"total":8}\n')).toEqual({ passed: 3, total: 8 })
    expect(parseCheck("crashed")).toEqual({ passed: 0, total: 1 })
  })
})
