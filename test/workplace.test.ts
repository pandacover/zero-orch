import { execFileSync } from "node:child_process"
import { mkdtempSync, realpathSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import { afterEach, describe, expect, it } from "vitest"
import { commandPlaces, lastWorktree, nativePath, openedPr, parseWorktrees, toolPlaces, treeOf } from "../src/app/WorkPlace.ts"

const win = process.platform === "win32"
const base = resolve(win ? "C:\\work\\zero" : "/work/zero")
const tree = resolve(win ? "C:\\work\\trees\\fix" : "/work/trees/fix")

describe("where an agent's work is", () => {
  it("reads a shell's paths as this machine's", () => {
    expect(nativePath("../trees/fix", base)).toBe(tree)
    expect(nativePath(`"${tree}"`, base)).toBe(tree)
    if (win) expect(nativePath("/c/Users/me/x", base)).toBe("C:\\Users\\me\\x")
  })

  it("counts a command's folder only where it changes something there", () => {
    expect(commandPlaces(`cd ../trees/fix && npm test`, base)).toEqual([])
    expect(commandPlaces(`cd ../trees/fix && git add -A && git commit -m "x"`, base)).toEqual([tree])
    expect(commandPlaces(`git -C ../trees/fix push -u origin fix`, base)).toEqual([tree])
    expect(commandPlaces(`git status && gh pr create --title t --body b`, base)).toEqual([base])
    // A new worktree: where it was made from, then the worktree itself.
    expect(commandPlaces(`git worktree add -b fix ../trees/fix origin/main`, base)).toEqual([base, tree])
    // Reading the project's folder to compare doesn't count.
    expect(commandPlaces(`cd ${base} && git diff main`, tree)).toEqual([])
  })

  it("takes an edit's file, a shell's changes, and Claude Code's own worktree", () => {
    const file = join(tree, "src", "a.ts")
    expect(toolPlaces({ name: "Edit", detail: file, output: "" }, base)).toEqual([file])
    expect(toolPlaces({ name: "Read", detail: file, output: "" }, base)).toEqual([])
    expect(toolPlaces({ name: "Bash", detail: `cd ${tree} && git commit -m x`, output: "" }, base)).toEqual([tree])
    expect(toolPlaces({ name: "EnterWorktree", detail: "{}", output: `Created worktree at ${tree} on branch fix.` }, base)).toEqual([tree])
  })

  it("links the pull request gh pr create printed, or said already exists", () => {
    const url = "https://github.com/me/zero/pull/17"
    expect(openedPr({ name: "Bash", detail: "gh pr create --fill", output: `Creating pull request\n${url}\n` })).toEqual({ number: 17, url })
    expect(openedPr({ name: "Bash", detail: "gh pr create --fill", output: `a pull request for branch "fix" into branch "main" already exists:\n${url}` })).toEqual({ number: 17, url })
    expect(openedPr({ name: "Bash", detail: "gh pr view 17", output: url })).toBeUndefined()
  })

  it("finds the deepest worktree holding a path", () => {
    const nested = join(base, ".claude", "worktrees", "x")
    const trees = parseWorktrees(`worktree ${base}\nHEAD abc\nbranch refs/heads/main\n\nworktree ${nested}\nHEAD def\nbranch refs/heads/x\n`)
    expect(trees).toEqual([base, nested])
    expect(treeOf(join(nested, "a.ts"), trees)).toBe(nested)
    expect(treeOf(join(base, "a.ts"), trees)).toBe(base)
    expect(treeOf(join(base + "-other", "a.ts"), trees)).toBeUndefined()
  })
})

describe("following a worktree in a real repository", () => {
  const dirs: Array<string> = []
  afterEach(() => { for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true }) })

  it("is the worktree last changed, not a folder outside the repository", async () => {
    const root = realpathSync(mkdtempSync(join(tmpdir(), "zero-wp-")))
    dirs.push(root)
    const repo = join(root, "repo")
    const g = (cwd: string, ...args: Array<string>) => execFileSync("git", args, { cwd, stdio: "pipe" })
    execFileSync("git", ["init", "-q", "-b", "main", repo])
    g(repo, "-c", "user.name=t", "-c", "user.email=t@t", "commit", "-q", "--allow-empty", "-m", "first")
    const wt = join(root, "fix")
    g(repo, "worktree", "add", "-q", "-b", "fix", wt)
    const outside = join(tmpdir(), "elsewhere", "notes.md")
    expect(await lastWorktree(repo, [join(wt, "a.ts"), outside])).toBe(resolve(wt))
    expect(await lastWorktree(repo, [join(wt, "a.ts"), join(repo, "b.ts")])).toBe(resolve(repo))
    expect(await lastWorktree(repo, [outside])).toBeUndefined()
    expect(await lastWorktree(repo, [])).toBeUndefined()
  })
})
