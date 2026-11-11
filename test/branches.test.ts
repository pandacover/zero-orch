import { execFileSync } from "node:child_process"
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { createBranch, createWorktree, listBranches, newBranchName, parseLocal, parseRemote, samePath, slug, switchBranch, worktreeOf } from "../src/app/Branches.ts"

const git = (cwd: string, ...args: Array<string>) => execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim()

describe("branch lists, as git prints them", () => {
  it("marks a branch checked out in another worktree, and not one checked out here", () => {
    const here = join(tmpdir(), "repo")
    const out = [`main\u001f${here.replace(/\\/g, "/")}`, `feat\u001f${join(tmpdir(), "elsewhere")}`, "idle\u001f"].join("\n")
    expect(parseLocal(out, here)).toEqual([
      { name: "main", elsewhere: null, at: "", upstream: "", ahead: 0, behind: 0, gone: false },
      { name: "feat", elsewhere: join(tmpdir(), "elsewhere"), at: "", upstream: "", ahead: 0, behind: 0, gone: false },
      { name: "idle", elsewhere: null, at: "", upstream: "", ahead: 0, behind: 0, gone: false }
    ])
  })

  it("reads each branch's last commit date and how it stands against its upstream", () => {
    const out = [
      "feat\u001f\u001f2026-01-02T03:04:05+00:00\u001forigin/feat\u001fahead 2, behind 1",
      "old\u001f\u001f2025-06-01T00:00:00+00:00\u001forigin/old\u001fbehind 3",
      "dead\u001f\u001f2024-01-01T00:00:00+00:00\u001forigin/dead\u001fgone",
      "even\u001f\u001f2026-03-03T00:00:00+00:00\u001forigin/even\u001f"
    ].join("\n")
    const [feat, old, dead, even] = parseLocal(out, join(tmpdir(), "repo"))
    expect(feat).toMatchObject({ name: "feat", at: "2026-01-02T03:04:05+00:00", upstream: "origin/feat", ahead: 2, behind: 1, gone: false })
    expect(old).toMatchObject({ name: "old", at: "2025-06-01T00:00:00+00:00", upstream: "origin/old", ahead: 0, behind: 3, gone: false })
    expect(dead).toMatchObject({ name: "dead", at: "2024-01-01T00:00:00+00:00", upstream: "origin/dead", ahead: 0, behind: 0, gone: true })
    expect(even).toMatchObject({ name: "even", at: "2026-03-03T00:00:00+00:00", upstream: "origin/even", ahead: 0, behind: 0, gone: false })
  })

  it("leaves out a remote's HEAD, the bare remote, and remote branches a local one stands for", () => {
    const local = [{ name: "main", elsewhere: null, at: "", upstream: "", ahead: 0, behind: 0, gone: false }]
    expect(parseRemote("origin/HEAD\norigin\norigin/main\norigin/fix-login\nupstream/docs\n", local)).toEqual(["origin/fix-login", "upstream/docs"])
  })

  it("names folders and branches that git and Windows both take", () => {
    expect(slug("feat/Login fix!")).toBe("login-fix")
    expect(slug("..")).toBe("work")
    expect(newBranchName("origin/main")).toMatch(/^zero\/main-[a-z0-9]{4,6}$/)
    expect(samePath(join(tmpdir(), "a", ".."), tmpdir())).toBe(true)
  })
})

describe("switching branches and making worktrees, in a real repository", () => {
  let repo = ""
  let root = ""
  beforeAll(() => {
    repo = mkdtempSync(join(tmpdir(), "zero-branches-"))
    root = mkdtempSync(join(tmpdir(), "zero-worktrees-"))
    git(repo, "init", "-q", "-b", "main")
    git(repo, "config", "user.email", "test@example.com")
    git(repo, "config", "user.name", "Test")
    git(repo, "config", "commit.gpgsign", "false")
    writeFileSync(join(repo, "a.txt"), "one\n")
    git(repo, "add", ".")
    git(repo, "commit", "-q", "-m", "first")
    git(repo, "branch", "feature")
  })
  afterAll(() => {
    for (const d of [repo, root]) rmSync(d, { recursive: true, force: true })
  })

  it("lists the branches, the one checked out, and a base to start from", async () => {
    const b = await listBranches(repo)
    expect(b.repo).toBe(true)
    expect(b.current).toBe("main")
    expect(b.local.map((x) => x.name).sort()).toEqual(["feature", "main"])
    expect(b.base).toBe("main") // no remote: the branch checked out
    expect(b.linked).toBe(false)
    expect(b.local.every((x) => x.at !== "")).toBe(true)
    expect((await listBranches(root)).repo).toBe(false)
  })

  it("switches to a branch, and says why when it can't", async () => {
    expect(await switchBranch(repo, "feature")).toEqual({ ok: true, branch: "feature" })
    expect(git(repo, "branch", "--show-current")).toBe("feature")
    expect(await switchBranch(repo, "nope")).toEqual({ ok: false, error: "there's no branch nope" })
    expect(await switchBranch(repo, "--force")).toMatchObject({ ok: false })
    expect(await switchBranch(repo, "main")).toEqual({ ok: true, branch: "main" })
  })

  it("makes a worktree on a new branch from the base picked, in a folder of its own", async () => {
    const made = await createWorktree(repo, { base: "feature", branch: "zero/try", root })
    expect(made).toMatchObject({ ok: true, branch: "zero/try" })
    if (!made.ok) return
    expect(made.path).toBe(join(root, "try"))
    expect(existsSync(join(made.path, "a.txt"))).toBe(true)
    expect(git(made.path, "branch", "--show-current")).toBe("zero/try")
    expect(git(made.path, "rev-parse", "HEAD")).toBe(git(repo, "rev-parse", "feature"))
    // Seen from the worktree: it's a linked one, and the branch it holds is checked out elsewhere from the repo.
    expect((await listBranches(made.path)).linked).toBe(true)
    const fromRepo = await listBranches(repo)
    expect(samePath(fromRepo.local.find((b) => b.name === "zero/try")!.elsewhere!, made.path)).toBe(true)
    expect(fromRepo.local.find((b) => b.name === "main")!.elsewhere).toBeNull()
    // git won't check a branch out twice.
    expect((await switchBranch(repo, "zero/try")).ok).toBe(false)
  })

  it("makes up a branch name when given none, numbers a folder already taken, and refuses what git would", async () => {
    const auto = await createWorktree(repo, { base: "main", branch: "", root })
    expect(auto).toMatchObject({ ok: true })
    if (auto.ok) expect(auto.branch).toMatch(/^zero\/main-/)
    const again = await createWorktree(repo, { base: "main", branch: "other/try", root })
    expect(again.ok && again.path).toBe(join(root, "try-2"))
    expect(await createWorktree(repo, { base: "main", branch: "zero/try", root })).toMatchObject({ ok: false, error: expect.stringContaining("already exists") })
    expect(await createWorktree(repo, { base: "nope", branch: "x", root })).toEqual({ ok: false, error: "there's no branch nope" })
    expect(await createWorktree(repo, { base: "main", branch: "bad name", root })).toMatchObject({ ok: false })
  })

  it("makes a new branch from a base and checks it out", async () => {
    expect(await createBranch(repo, { base: "feature", branch: "topic/new" })).toEqual({ ok: true, branch: "topic/new" })
    expect(git(repo, "branch", "--show-current")).toBe("topic/new")
    expect(git(repo, "rev-parse", "HEAD")).toBe(git(repo, "rev-parse", "feature"))
    expect(await createBranch(repo, { base: "feature", branch: "" })).toEqual({ ok: false, error: "name the new branch" })
    expect(await createBranch(repo, { base: "feature", branch: "bad name" })).toMatchObject({ ok: false })
    expect(await createBranch(repo, { base: "feature", branch: "topic/new" })).toMatchObject({ ok: false, error: expect.stringContaining("already exists") })
    expect(await createBranch(repo, { base: "nope", branch: "topic/other" })).toEqual({ ok: false, error: "there's no branch nope" })
    expect(await switchBranch(repo, "main")).toEqual({ ok: true, branch: "main" })
  })

  it("finds the worktree a branch is checked out in", async () => {
    const found = await worktreeOf(repo, "zero/try")
    expect(found).toMatchObject({ ok: true, branch: "zero/try" })
    if (found.ok) expect(samePath(found.path, join(root, "try"))).toBe(true)
    expect(await worktreeOf(repo, "feature")).toEqual({ ok: false, error: expect.stringContaining("isn't checked out in another worktree") })
    expect(await worktreeOf(repo, "nope")).toEqual({ ok: false, error: "there's no branch nope" })
    expect(await worktreeOf(repo, "--x")).toMatchObject({ ok: false })
  })
})
