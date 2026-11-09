import { describe, expect, it } from "vitest"
import { jobArgs, parseJobRequest } from "../src/app/Evolution.ts"

const tasks = ["csv", "lru"]

describe("control plane jobs", () => {
  it("turns a page's request into zero's own command line", () => {
    expect(jobArgs({ kind: "bench", tasks: [], generations: 3, budgetUsd: 25, reps: 1 })).toEqual(["bench", "--record"])
    expect(jobArgs({ kind: "generation", tasks: ["csv"], generations: 3, budgetUsd: 25, reps: 1 })).toEqual(["generation", "--task", "csv"])
    expect(jobArgs({ kind: "evolve", tasks: [], generations: 4, budgetUsd: 12.5, reps: 1 })).toEqual(["evolve", "--generations", "4", "--budget-usd", "12.5"])
  })

  it("passes --reps only when a task runs more than once", () => {
    expect(jobArgs({ kind: "bench", tasks: ["lru"], generations: 3, budgetUsd: 25, reps: 3 })).toEqual(["bench", "--record", "--reps", "3", "--task", "lru"])
    expect(jobArgs({ kind: "generation", tasks: [], generations: 3, budgetUsd: 25, reps: 2 })).toEqual(["generation", "--reps", "2"])
    expect(jobArgs({ kind: "evolve", tasks: [], generations: 4, budgetUsd: 12.5, reps: 5 })).toEqual(["evolve", "--generations", "4", "--budget-usd", "12.5", "--reps", "5"])
  })

  it("accepts only known kinds, known tasks and sane numbers", () => {
    expect(parseJobRequest({ kind: "evolve", tasks: ["lru"], generations: 2, budgetUsd: 10 }, tasks)).toEqual({ kind: "evolve", tasks: ["lru"], generations: 2, budgetUsd: 10, reps: 1 })
    expect(parseJobRequest({ kind: "solve" }, tasks)).toMatch(/kind/)
    expect(parseJobRequest({ kind: "bench", tasks: ["../../etc"] }, tasks)).toMatch(/unknown/)
    expect(parseJobRequest({ kind: "bench", tasks: ["--record"] }, tasks)).toMatch(/unknown/)
    expect(parseJobRequest({ kind: "evolve", generations: 0 }, tasks)).toMatch(/generations/)
    expect(parseJobRequest({ kind: "evolve", generations: 2.5 }, tasks)).toMatch(/generations/)
    expect(parseJobRequest({ kind: "evolve", budgetUsd: -1 }, tasks)).toMatch(/budget/)
    expect(parseJobRequest(undefined, tasks)).toMatch(/kind/)
  })

  it("takes reps as a whole number 1–5", () => {
    expect(parseJobRequest({ kind: "bench", reps: 3 }, tasks)).toMatchObject({ kind: "bench", reps: 3 })
    expect(parseJobRequest({ kind: "generation", reps: 1 }, tasks)).toMatchObject({ reps: 1 })
    expect(parseJobRequest({ kind: "evolve", reps: 5 }, tasks)).toMatchObject({ reps: 5 })
    for (const reps of [0, 6, 2.5, -1, "3", null, Number.NaN]) {
      expect(parseJobRequest({ kind: "bench", reps }, tasks)).toMatch(/reps/)
    }
  })
})
