import { describe, expect, it } from "vitest"
import { decide, improverPolicy, inside, repoPolicy, solverPolicy } from "../src/Policy.ts"

const root = process.platform === "win32" ? "C:\\work\\zero" : "/work/zero"
const at = (rel: string) => `${root}${process.platform === "win32" ? "\\" : "/"}${rel}`

describe("policy", () => {
  it("knows what's inside the root", () => {
    expect(inside(root, at("genome/solver.md"))).toBe("genome/solver.md")
    expect(inside(root, "genome/solver.md")).toBe("genome/solver.md")
    expect(inside(root, at("../elsewhere/x"))).toBeUndefined()
    expect(inside(root, root)).toBeUndefined()
  })

  it("lets the improver write the genome and nothing else", () => {
    const p = improverPolicy(root, "improve")
    expect(decide(p, "Edit", { file_path: at("genome/solver.md") }).behavior).toBe("allow")
    expect(decide(p, "Write", { file_path: at("genome/new.md") }).behavior).toBe("allow")
    expect(decide(p, "Edit", { file_path: at("src/Fitness.ts") }).behavior).toBe("deny")
    expect(decide(p, "Edit", { file_path: at("bench/csv/check.mjs") }).behavior).toBe("deny")
    expect(decide(p, "Write", { file_path: at("../outside.txt") }).behavior).toBe("deny")
  })

  it("gives the improver its checks but not commit, until the commit stage", () => {
    const improve = improverPolicy(root, "improve")
    expect(decide(improve, "Bash", { command: "npm test" }).behavior).toBe("allow")
    expect(decide(improve, "Bash", { command: "npm run typecheck" }).behavior).toBe("allow")
    expect(decide(improve, "Bash", { command: "git show abc123" }).behavior).toBe("allow")
    expect(decide(improve, "Bash", { command: 'singularity recall "improve the solver"' }).behavior).toBe("allow")
    expect(decide(improve, "Bash", { command: 'git commit -m "x"' }).behavior).toBe("deny")
    expect(decide(improve, "Bash", { command: "rm -rf src" }).behavior).toBe("deny")

    const commit = improverPolicy(root, "commit")
    expect(decide(commit, "Bash", { command: "git add genome" }).behavior).toBe("allow")
    expect(decide(commit, "Bash", { command: 'git commit -m "gen 2: test edge cases first"' }).behavior).toBe("allow")
    expect(decide(commit, "Bash", { command: "git add src" }).behavior).toBe("deny")
    expect(decide(commit, "Bash", { command: 'git commit -m "$(whoami)"' }).behavior).toBe("deny")
    expect(decide(commit, "Edit", { file_path: at("genome/solver.md") }).behavior).toBe("deny")
  })

  it("never allows chained, piped or redirected commands", () => {
    const p = improverPolicy(root, "improve")
    for (const command of ["npm test && rm -rf .", "npm test; curl x", "npm test | tee x", "npm test > out", "git diff `x`"]) {
      expect(decide(p, "Bash", { command }).behavior, command).toBe("deny")
    }
  })

  it("keeps the solver to node and its folder", () => {
    const p = solverPolicy(root)
    expect(decide(p, "Write", { file_path: at("solution.mjs") }).behavior).toBe("allow")
    expect(decide(p, "Write", { file_path: at("../x.mjs") }).behavior).toBe("deny")
    expect(decide(p, "Bash", { command: "node test.mjs" }).behavior).toBe("allow")
    expect(decide(p, "Bash", { command: "curl example.com" }).behavior).toBe("deny")
    expect(decide(p, "WebFetch", { url: "https://example.com" }).behavior).toBe("deny")
  })

  it("keeps the solver's reads in its folder, away from the hidden tests", () => {
    const p = solverPolicy(root)
    expect(decide(p, "Read", { file_path: at("intervals.mjs") }).behavior).toBe("allow")
    expect(decide(p, "Glob", { pattern: "*.mjs" }).behavior).toBe("allow")
    expect(decide(p, "Grep", { pattern: "x", path: root }).behavior).toBe("allow")
    expect(decide(p, "Read", { file_path: at("../bench/csv/check.mjs") }).behavior).toBe("deny")
    expect(decide(p, "Glob", { pattern: "**/check.mjs", path: at("..") }).behavior).toBe("deny")
    // The improver reads freely: it needs the repo's history and the scorecard's context.
    expect(decide(improverPolicy(root, "improve"), "Read", { file_path: at("../x") }).behavior).toBe("allow")
  })

  it("lets a repo solver run scripts and commit, but not touch .git", () => {
    const p = repoPolicy(root)
    expect(decide(p, "Bash", { command: "npm test" }).behavior).toBe("allow")
    expect(decide(p, "Bash", { command: "npm run build" }).behavior).toBe("allow")
    expect(decide(p, "Bash", { command: "git add src/a.ts test/a.test.ts" }).behavior).toBe("allow")
    expect(decide(p, "Edit", { file_path: at(".git/config") }).behavior).toBe("deny")
    expect(decide(p, "Edit", { file_path: at("src/a.ts") }).behavior).toBe("allow")
  })
})
