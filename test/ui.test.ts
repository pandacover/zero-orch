import * as NodeServices from "@effect/platform-node/NodeServices"
import { Effect, Layer, Option } from "effect"
import { mkdtempSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { describe, expect, it, vi } from "vitest"
import { jobArgs, makeEvolution, parseJobRequest } from "../src/app/Evolution.ts"
import { Memory } from "../src/Singularity.ts"

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

describe("control plane state", () => {
  it("answers without waiting on singularity, and says when its list arrives", async () => {
    const root = mkdtempSync(join(tmpdir(), "zero-evo-"))
    const events: Array<string> = []
    const gate = Promise.withResolvers<void>()
    let asked = 0
    const memory = Layer.succeed(Memory, Memory.of({
      recall: () => Effect.succeedNone,
      handOver: () => Effect.succeed({ handOver: Option.none(), searched: false }),
      afterTool: () => Effect.succeedNone,
      store: () => Effect.void,
      changes: () =>
        Effect.sync(() => void asked++).pipe(
          Effect.andThen(Effect.promise(() => gate.promise)),
          Effect.as([{ id: "c1", commit: "abc1234567", title: "genome: cheaper solver", task: "", retired: false }])
        )
    }))
    const run = <A, E>(effect: Effect.Effect<A, E, Memory | NodeServices.NodeServices>) =>
      Effect.runPromise(effect.pipe(Effect.provide(Layer.mergeAll(memory, NodeServices.layer))))
    const evolution = makeEvolution({ root, cli: "cli.ts", hub: { send: (event) => void events.push(event) } })

    // singularity hasn't answered: the page gets everything else now, and no list yet.
    const first = await run(evolution.state)
    expect(first.memory).toBeNull()
    expect(asked).toBe(1)

    gate.resolve()
    await vi.waitFor(() => expect(events).toContain("zero-state"))
    const second = await run(evolution.state)
    expect(second.memory).toEqual([{ id: "c1", commit: "abc1234567", title: "genome: cheaper solver", task: "", retired: false }])
    // A fresh list isn't asked for again.
    expect(asked).toBe(1)
  })
})
