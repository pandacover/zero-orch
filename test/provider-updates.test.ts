import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { delimiter, join } from "node:path"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { claudeExecutable, claudePackage, codexBinaryIn, codexExecutable, codexPackage, installed, isNewer } from "../src/app/ProviderUpdates.ts"

const WIN = process.platform === "win32"

describe("provider updates", () => {
  let home: string
  const before = process.env["ZERO_HOME"]
  beforeEach(() => {
    home = mkdtempSync(join(tmpdir(), "zero-providers-"))
    process.env["ZERO_HOME"] = home
  })
  afterEach(() => {
    if (before === undefined) delete process.env["ZERO_HOME"]
    else process.env["ZERO_HOME"] = before
  })

  /** A binary file and the state an update writes for it. */
  const fakeUpdate = (id: "claude" | "codex", version: string, pathDirs: Array<string> = []) => {
    const bin = join(home, "providers", id, version, WIN ? `${id}.exe` : id)
    mkdirSync(join(bin, ".."), { recursive: true })
    writeFileSync(bin, "")
    writeFileSync(join(home, "providers", `${id}.json`), JSON.stringify({ version, path: bin, pathDirs }))
    return bin
  }

  it("compares versions by number, ignoring a prerelease suffix", () => {
    expect(isNewer("2.1.323", "2.1.319")).toBe(true)
    expect(isNewer("2.10.0", "2.9.9")).toBe(true)
    expect(isNewer("2.1.319", "2.1.319")).toBe(false)
    expect(isNewer("2.1.300", "2.1.319")).toBe(false)
    expect(isNewer("v0.170.0-alpha.1", "0.169.0")).toBe(true)
  })

  it("names the binary's package as each SDK looks for it", () => {
    expect(claudePackage("win32", "x64", false)).toBe("@anthropic-ai/claude-agent-sdk-win32-x64")
    expect(claudePackage("linux", "arm64", true)).toBe("@anthropic-ai/claude-agent-sdk-linux-arm64-musl")
    expect(codexPackage("darwin", "arm64")).toBe("@openai/codex-darwin-arm64")
  })

  it("finds Codex's binary and its PATH folder in a platform package, new layout or old", () => {
    const name = WIN ? "codex.exe" : "codex"
    const fresh = join(home, "new")
    mkdirSync(join(fresh, "vendor", "t", "bin"), { recursive: true })
    mkdirSync(join(fresh, "vendor", "t", "codex-path"))
    writeFileSync(join(fresh, "vendor", "t", "bin", name), "")
    expect(codexBinaryIn(fresh)).toEqual({ version: "", path: join(fresh, "vendor", "t", "bin", name), pathDirs: [join(fresh, "vendor", "t", "codex-path")] })
    const old = join(home, "old")
    mkdirSync(join(old, "vendor", "t", "codex"), { recursive: true })
    writeFileSync(join(old, "vendor", "t", "codex", name), "")
    expect(codexBinaryIn(old)?.path).toBe(join(old, "vendor", "t", "codex", name))
    expect(codexBinaryIn(join(home, "none"))).toBeUndefined()
  })

  it("uses the SDK's own Claude Code until a newer one is installed", () => {
    expect(installed("claude")).toBeUndefined()
    expect(claudeExecutable()).toEqual({})
    const bin = fakeUpdate("claude", "999.0.0")
    expect(claudeExecutable()).toEqual({ pathToClaudeCodeExecutable: bin })
  })

  it("goes back to the SDK's own once zero ships one as new, or the update's binary is gone", () => {
    fakeUpdate("claude", "0.0.1")
    expect(claudeExecutable()).toEqual({})
    writeFileSync(join(home, "providers", "claude.json"), JSON.stringify({ version: "999.0.0", path: join(home, "gone"), pathDirs: [] }))
    expect(claudeExecutable()).toEqual({})
    writeFileSync(join(home, "providers", "claude.json"), "not json")
    expect(installed("claude")).toBeUndefined()
  })

  it("puts an updated Codex's folders first on PATH, under the key the environment already uses", () => {
    expect(codexExecutable({ Path: "a" })).toEqual({ env: { Path: "a" } })
    const bin = fakeUpdate("codex", "999.0.0", ["dir"])
    expect(codexExecutable({ Path: ["a", "dir"].join(delimiter) })).toEqual({ env: { Path: ["dir", "a"].join(delimiter) }, codexPathOverride: bin })
    expect(codexExecutable({}).env).toEqual({ PATH: "dir" })
  })
})
