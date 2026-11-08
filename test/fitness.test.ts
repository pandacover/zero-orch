import { describe, expect, it } from "vitest"
import { parseCheck, scorecard } from "../src/Bench.ts"
import { judge } from "../src/Fitness.ts"
import type { TaskScore } from "../src/Ledger.ts"

const task = (id: string, passed: number, total: number, costUsd: number): TaskScore => ({
  id, passed, total, costUsd, turns: 5, stop: "success", failures: "", lastWords: ""
})

describe("fitness", () => {
  it("scores with partial credit", () => {
    const card = scorecard("g", [task("a", 10, 10, 0.1), task("b", 5, 10, 0.2)])
    expect(card.score).toBeCloseTo(0.75)
    expect(card.solved).toBe(1)
    expect(card.costUsd).toBeCloseTo(0.3)
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
