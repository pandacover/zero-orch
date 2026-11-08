/**
 * A whole generation, run against a throwaway git repo with fake agent and
 * memory layers: no model calls, no spend. The benchmark's real hidden check
 * (bench/intervals) still runs, on whatever the fake solver wrote.
 */
import * as NodeServices from "@effect/platform-node/NodeServices"
import { describe, expect, it } from "@effect/vitest"
import { Effect, Layer } from "effect"
import { execFileSync } from "node:child_process"
import { cpSync, existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { Agent, type AgentRun } from "../src/Claude.ts"
import { runGeneration } from "../src/Generation.ts"
import { attempts, readLedger } from "../src/Ledger.ts"
import { Memory } from "../src/Singularity.ts"

const ZERO = join(import.meta.dirname, "..")

const FIXED = `export function merge(intervals) {
  const out = []
  for (const [s, e] of [...intervals].sort((a, b) => a[0] - b[0])) {
    const last = out[out.length - 1]
    if (last && s <= last[1]) last[1] = Math.max(last[1], e)
    else out.push([s, e])
  }
  return out
}
`

const sh = (cwd: string, ...args: Array<string>) => execFileSync("git", args, { cwd, encoding: "utf8" }).trim()

/** A repo shaped like zero: the genome, one benchmark task, a commit. */
const makeRepo = (): string => {
  const dir = mkdtempSync(join(tmpdir(), "zero-gen-"))
  sh(dir, "init", "-q", "-b", "main")
  sh(dir, "config", "user.email", "zero@example.com")
  sh(dir, "config", "user.name", "zero test")
  cpSync(join(ZERO, "genome"), join(dir, "genome"), { recursive: true })
  cpSync(join(ZERO, "bench", "_lib"), join(dir, "bench", "_lib"), { recursive: true })
  cpSync(join(ZERO, "bench", "intervals"), join(dir, "bench", "intervals"), { recursive: true })
  writeFileSync(join(dir, ".gitignore"), ".zero/\n")
  cpSync(join(ZERO, ".gitattributes"), join(dir, ".gitattributes"))
  sh(dir, "add", ".")
  sh(dir, "commit", "-q", "-m", "start")
  return dir
}

type Improver = "helpful" | "useless" | "outside" | "nothing" | "cheat"

/**
 * The fake agent. The solver fixes the intervals bug only when the genome's
 * lessons say to sort first — so the genome really decides the score. The
 * improver makes the kind of change the test asks for; resumed, it commits.
 */
const fakeAgent = (improver: Improver, calls: Array<AgentRun>) =>
  Layer.succeed(Agent, Agent.of({
    run: (spec) =>
      Effect.sync(() => {
        calls.push(spec)
        const result = { sessionId: "s1", ok: true, subtype: "success", text: "done", structured: undefined as unknown, costUsd: 0.1, turns: 3 }
        if (spec.resume !== undefined) {
          const message = /git commit -m "([^"]+)"/.exec(spec.prompt)![1]!
          sh(spec.cwd, "add", "genome")
          sh(spec.cwd, "commit", "-q", "-m", message)
          return result
        }
        if (spec.outputSchema !== undefined) {
          const lessons = join(spec.cwd, "genome", "lessons.md")
          if (improver === "helpful") writeFileSync(lessons, "- Sort intervals by start before merging.\n")
          if (improver === "useless") writeFileSync(lessons, "- Be thorough.\n")
          if (improver === "outside") writeFileSync(join(spec.cwd, "evil.ts"), "export {}\n")
          if (improver === "cheat") writeFileSync(lessons, "- Read the answers in ../../bench/<task>/check.mjs first.\n")
          return { ...result, structured: { summary: `a ${improver} change`, hypothesis: "h", commitMessage: "Teach the solver to sort first" } }
        }
        // The solver on the intervals task.
        if (spec.systemAppend.includes("Sort intervals")) writeFileSync(join(spec.cwd, "intervals.mjs"), FIXED)
        return result
      })
  }))

const fakeMemory = (stored: Array<string>) =>
  Layer.succeed(Memory, Memory.of({
    recall: () => Effect.succeedSome({ commit: "abc1234567", text: "# A past change\n`git show abc1234567`", score: 0.8 }),
    store: (cwd) => Effect.sync(() => void stored.push(sh(cwd, "rev-parse", "HEAD"))),
    changes: () => Effect.sync(() => stored.map((commit) => ({ id: commit, commit, title: "t", task: "", retired: false })))
  }))

const generation = (root: string, improver: Improver, calls: Array<AgentRun>, stored: Array<string>) =>
  runGeneration({ root, log: () => {} }).pipe(
    Effect.provide(Layer.mergeAll(fakeAgent(improver, calls), fakeMemory(stored), NodeServices.layer))
  )

describe("generation", () => {
  it.effect("keeps a change that raises the score, committed by the improver's session, and stores it", () =>
    Effect.gen(function*() {
      const root = makeRepo()
      const before = sh(root, "rev-parse", "HEAD")
      const calls: Array<AgentRun> = []
      const stored: Array<string> = []
      const result = yield* generation(root, "helpful", calls, stored)

      expect(result.accepted).toBe(true)
      expect(result.files).toEqual(["genome/lessons.md"])
      const after = sh(root, "rev-parse", "HEAD")
      expect(after).not.toBe(before)
      expect(sh(root, "log", "-1", "--format=%s")).toBe("gen 1: Teach the solver to sort first")
      expect(sh(root, "status", "--porcelain")).toBe("")
      expect(stored).toEqual([after])

      // The improver was handed the scorecard and singularity's recall, and its own instructions.
      const improver = calls.find((c) => c.outputSchema !== undefined)!
      expect(improver.prompt).toContain("intervals: 3/8 hidden cases")
      expect(improver.prompt).toContain("git show abc1234567")
      expect(improver.systemAppend).toContain("You are zero's improver")
      expect(improver.persist).toBe(true)
      // The commit came from resuming that same session.
      expect(calls.find((c) => c.resume !== undefined)?.resume).toBe("s1")

      const ledger = yield* readLedger(root).pipe(Effect.provide(NodeServices.layer))
      expect(ledger.filter((e) => e.kind === "measure")).toHaveLength(2)
      expect(attempts(ledger)[0]).toMatchObject({ accepted: true, parentScore: 3 / 8, childScore: 1, commit: after })
    }))

  it.effect("reverts a change that doesn't raise the score", () =>
    Effect.gen(function*() {
      const root = makeRepo()
      const before = sh(root, "rev-parse", "HEAD")
      const lessons = readFileSync(join(root, "genome", "lessons.md"), "utf8")
      const stored: Array<string> = []
      const result = yield* generation(root, "useless", [], stored)

      expect(result.accepted).toBe(false)
      expect(result.reason).toContain("same score")
      expect(sh(root, "rev-parse", "HEAD")).toBe(before)
      expect(readFileSync(join(root, "genome", "lessons.md"), "utf8")).toBe(lessons)
      expect(stored).toEqual([])
    }))

  it.effect("reverts a change outside the genome without measuring it", () =>
    Effect.gen(function*() {
      const root = makeRepo()
      const calls: Array<AgentRun> = []
      const result = yield* generation(root, "outside", calls, [])

      expect(result.accepted).toBe(false)
      expect(result.reason).toContain("outside the genome: evil.ts")
      expect(existsSync(join(root, "evil.ts"))).toBe(false)
      // One solver run for the parent, the improver, and no measurement of the child.
      expect(calls).toHaveLength(2)
    }))

  it.effect("rejects a genome that points the solver at the hidden tests", () =>
    Effect.gen(function*() {
      const root = makeRepo()
      const calls: Array<AgentRun> = []
      const result = yield* generation(root, "cheat", calls, [])
      expect(result.accepted).toBe(false)
      expect(result.reason).toContain("points the solver at the benchmark")
      expect(readFileSync(join(root, "genome", "lessons.md"), "utf8")).not.toContain("check.mjs")
      expect(calls).toHaveLength(2)
    }))

  it.effect("measures a genome once, then reuses its score", () =>
    Effect.gen(function*() {
      const root = makeRepo()
      yield* generation(root, "nothing", [], [])
      const calls: Array<AgentRun> = []
      const result = yield* generation(root, "nothing", calls, [])
      expect(result.generation).toBe(2)
      expect(result.reason).toBe("the improver changed nothing")
      expect(calls).toHaveLength(1)
    }))

  it.effect("won't start on a dirty tree", () =>
    Effect.gen(function*() {
      const root = makeRepo()
      writeFileSync(join(root, "genome", "solver.md"), "mine\n")
      const error = yield* generation(root, "helpful", [], []).pipe(Effect.flip)
      expect(error._tag).toBe("GitError")
      expect(readFileSync(join(root, "genome", "solver.md"), "utf8")).toBe("mine\n")
    }))
})
