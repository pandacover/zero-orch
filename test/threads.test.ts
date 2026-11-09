import { describe, expect, it } from "vitest"
import { recalledTitle, turnCost } from "../src/app/Threads.ts"

describe("thread turns", () => {
  it("charges a resumed session's turn only what it added", () => {
    // The three turns of a dogfood thread, as the Agent SDK reported them: running totals.
    let before = 0
    const turns = [0.966, 2.175, 4.03].map((reported) => {
      const cost = turnCost(reported, true, before)
      before = reported
      return cost
    })
    expect(turns.map((c) => Number(c!.toFixed(3)))).toEqual([0.966, 1.209, 1.855])
  })

  it("takes a per-turn cost as it is, and keeps an unknown cost unknown", () => {
    expect(turnCost(0.25, false, 3)).toBe(0.25)
    expect(turnCost(null, true, 3)).toBeNull()
    // A total below the last one means a new session: never a negative charge.
    expect(turnCost(0.1, true, 3)).toBe(0)
  })

  it("names a recalled change by its commit subject", () => {
    expect(recalledTitle('An earlier task here asked for something like yours, committed as 5009bb34bd: "Add --reps N to bench"')).toBe("Add --reps N to bench")
    expect(recalledTitle("no subject here")).toBe("a past change")
  })
})
