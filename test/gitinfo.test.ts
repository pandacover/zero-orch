import { describe, expect, it } from "vitest"
import { commandsFor, type Exec, gitView, listFiles, parseAction, parseCounts, parseLog, parseStatus, pullRequest, type Run, runAction, runIdOf, toCheck, toPullRequest } from "../src/app/GitInfo.ts"

const ok = (stdout = ""): Exec => ({ ok: true, stdout, stderr: "", missing: false })
const no = (stderr = ""): Exec => ({ ok: false, stdout: "", stderr, missing: false })

/** A fake `git`/`gh`: the first rule whose words all appear in the command answers it. */
const fake = (rules: Array<[string, Exec]>, calls: Array<string> = []): Run => async (cmd, args, _cwd, input) => {
  const line = `${cmd} ${args.join(" ")}`
  calls.push(input === undefined ? line : `${line} <<${input}`)
  for (const [words, r] of rules) if (words.split(" ").every((w) => line.includes(w))) return r
  return no("unexpected")
}

describe("git output", () => {
  it("reads status lines, keeping the leading space and skipping a rename's old path", () => {
    expect(parseStatus(" M src/a.ts\0?? new file.txt\0R  b.ts\0old b.ts\0A  c.ts\0")).toEqual([
      { path: "src/a.ts", status: " M" },
      { path: "new file.txt", status: "??" },
      { path: "b.ts", status: "R " },
      { path: "c.ts", status: "A " }
    ])
    expect(parseStatus("")).toEqual([])
  })

  it("reads log lines and ahead/behind counts", () => {
    expect(parseLog("abc\u001fFix it\u001fAda\u001f2026-01-02T03:04:05Z\n")).toEqual([{ sha: "abc", subject: "Fix it", author: "Ada", at: "2026-01-02T03:04:05Z" }])
    expect(parseLog("")).toEqual([])
    expect(parseCounts("2\t5\n")).toEqual([2, 5])
    expect(parseCounts("")).toEqual([0, 0])
  })

  it("finds the Actions run behind a check", () => {
    expect(runIdOf("https://github.com/o/r/actions/runs/123/job/456")).toBe("123")
    expect(runIdOf("https://ci.example.com/build/9")).toBeNull()
  })
})

describe("pull requests", () => {
  it("names each check's state from GitHub's status and conclusion", () => {
    const states = [
      [{ status: "COMPLETED", conclusion: "SUCCESS" }, "passed"],
      [{ status: "COMPLETED", conclusion: "FAILURE" }, "failed"],
      [{ status: "COMPLETED", conclusion: "TIMED_OUT" }, "failed"],
      [{ status: "IN_PROGRESS", conclusion: "" }, "running"],
      [{ status: "QUEUED", conclusion: "" }, "pending"],
      [{ status: "COMPLETED", conclusion: "SKIPPED" }, "skipped"],
      [{ status: "COMPLETED", conclusion: "CANCELLED" }, "cancelled"]
    ] as const
    for (const [c, state] of states) expect(toCheck({ __typename: "CheckRun", name: "test", ...c }).state).toBe(state)
    expect(toCheck({ __typename: "StatusContext", context: "ci/legacy", state: "PENDING", targetUrl: "u" })).toMatchObject({ name: "ci/legacy", state: "pending", runId: null })
    expect(toCheck({ __typename: "StatusContext", context: "ci/legacy", state: "SUCCESS" }).state).toBe("passed")
    expect(toCheck({ __typename: "CheckRun", name: "t", status: "COMPLETED", conclusion: "SUCCESS", completedAt: "0001-01-01T00:00:00Z" }).completedAt).toBeNull()
  })

  it("puts comments, reviews and inline comments in one conversation, oldest first", () => {
    const pr = toPullRequest({
      number: 7, title: "T", body: "B", state: "OPEN", isDraft: true, url: "u", author: { login: "ada" },
      baseRefName: "main", headRefName: "feat", labels: [{ name: "bug" }], reviewRequests: [{ login: "bob" }],
      comments: [{ author: { login: "bob" }, body: "first", createdAt: "2026-01-01T00:00:00Z", url: "c1" }],
      reviews: [
        { author: { login: "cy" }, body: "", state: "APPROVED", submittedAt: "2026-01-03T00:00:00Z" },
        { author: { login: "cy" }, body: "", state: "COMMENTED", submittedAt: "2026-01-02T12:00:00Z" }
      ],
      statusCheckRollup: [{ __typename: "CheckRun", name: "test", workflowName: "CI", status: "COMPLETED", conclusion: "FAILURE", detailsUrl: "https://github.com/o/r/actions/runs/9/job/1" }]
    }, [{ user: { login: "cy" }, body: "nit", path: "a.ts", line: 3, created_at: "2026-01-02T00:00:00Z", html_url: "i1" }])
    expect(pr).toMatchObject({ number: 7, isDraft: true, author: "ada", base: "main", head: "feat", labels: ["bug"], reviewers: ["bob"], mergeable: "UNKNOWN" })
    // The bare COMMENTED review (a wrapper of inline comments) isn't shown twice.
    expect(pr.notes.map((n) => [n.kind, n.author, n.body])).toEqual([["comment", "bob", "first"], ["inline", "cy", "nit"], ["review", "cy", ""]])
    expect(pr.notes[1]).toMatchObject({ path: "a.ts", line: 3 })
    expect(pr.checks).toEqual([expect.objectContaining({ name: "test", workflow: "CI", state: "failed", runId: "9" })])
  })

  it("tells no PR apart from gh being unable to look", async () => {
    expect(await pullRequest(".", "feat", fake([["gh pr view", no("no pull requests found for branch \"feat\"")]]))).toEqual({ gh: { ok: true, detail: "" }, pr: null })
    expect((await pullRequest(".", "feat", fake([["gh pr view", no("To get started with GitHub CLI, please run:  gh auth login")]]))).gh.ok).toBe(false)
    const missing: Run = async () => ({ ok: false, stdout: "", stderr: "", missing: true })
    expect((await pullRequest(".", "feat", missing)).gh.detail).toMatch(/isn't installed/)
  })
})

describe("a thread's git view", () => {
  it("is empty outside a repository", async () => {
    expect(await gitView(".", undefined, fake([["rev-parse --is-inside-work-tree", no("not a git repository")]]))).toMatchObject({ repo: false, pr: null })
  })

  it("follows the thread's branch, its upstream, its own commits and its PR", async () => {
    const calls: Array<string> = []
    const exec = fake([
      ["rev-parse --is-inside-work-tree", ok("true\n")],
      ["branch --show-current", ok("main\n")],
      ["rev-parse --verify --quiet refs/heads/feat", ok("abc\n")],
      ["feat@{upstream}", ok("origin/feat\n")],
      ["refs/remotes/origin/HEAD", ok("origin/main\n")],
      ["status --porcelain", ok(" M a.ts\0")],
      ["rev-list --left-right --count refs/heads/feat...origin/feat", ok("1\t0\n")],
      ["log origin/main..refs/heads/feat", ok("s1\u001fAdd\u001fAda\u001f2026-01-01T00:00:00Z\n")],
      ["gh pr view feat", ok(JSON.stringify({ number: 4, state: "OPEN", baseRefName: "main", headRefName: "feat" }))],
      ["gh api repos/{owner}/{repo}/pulls/4/comments", ok("[]")]
    ], calls)
    const v = await gitView(".", "feat", exec)
    expect(v).toMatchObject({ repo: true, branch: "feat", current: "main", upstream: "origin/feat", ahead: 1, behind: 0, base: "origin/main" })
    expect(v.changes).toEqual([{ path: "a.ts", status: " M" }])
    expect(v.commits.map((c) => c.subject)).toEqual(["Add"])
    expect(v.pr?.number).toBe(4)
  })

  it("takes GitHub's default branch as the base over a stale origin/HEAD, and origin/HEAD when gh can't say", async () => {
    const rules = (gh: Exec): Array<[string, Exec]> => [
      ["rev-parse --is-inside-work-tree", ok("true\n")],
      ["branch --show-current", ok("feat\n")],
      ["rev-parse --verify --quiet refs/heads/feat", ok("abc\n")],
      ["gh repo view --json defaultBranchRef", gh],
      // Set at clone time, when the default was another branch.
      ["refs/remotes/origin/HEAD", ok("origin/zero/dogfood\n")],
      ["gh pr view feat", no("no pull requests found")],
      ["log", ok("")]
    ]
    expect((await gitView("repo-a", "feat", fake(rules(ok("main\n"))))).base).toBe("origin/main")
    expect((await gitView("repo-b", "feat", fake(rules(no("gh: not logged in"))))).base).toBe("origin/zero/dogfood")
    // Asked once, then remembered for a while.
    const calls: Array<string> = []
    await gitView("repo-a", "feat", fake(rules(ok("other\n")), calls))
    expect(calls.some((c) => c.startsWith("gh repo view"))).toBe(false)
  })

  it("falls back to the checked-out branch when the thread's is gone", async () => {
    const exec = fake([
      ["rev-parse --is-inside-work-tree", ok("true")],
      ["branch --show-current", ok("dev")],
      ["rev-parse --verify --quiet refs/heads/gone", no()],
      ["gh pr view dev", no("no pull requests found")],
      ["log", ok("")]
    ])
    expect(await gitView(".", "gone", exec)).toMatchObject({ branch: "dev", upstream: null, pr: null, gh: { ok: true } })
  })
})

describe("actions", () => {
  it("takes only well-formed requests", () => {
    expect(parseAction("comment", { number: 3, body: "  hi " })).toEqual({ kind: "comment", number: 3, body: "hi" })
    expect(parseAction("comment", { number: 3, body: " " })).toMatch(/write/)
    expect(parseAction("comment", { number: "3; rm -rf", body: "x" })).toMatch(/which/)
    expect(parseAction("rerun", { runId: "--failed" })).toMatch(/which run/)
    expect(parseAction("merge", { number: 3, method: "force" })).toMatch(/merge, squash or rebase/)
    expect(parseAction("merge", { number: 3 })).toEqual({ kind: "merge", number: 3, method: "squash", deleteBranch: false })
    expect(parseAction("push", { branch: "--force" })).toMatch(/which branch/)
    expect(parseAction("push", { branch: "a..b" })).toMatch(/which branch/)
    expect(parseAction("push", { branch: "zero/feat-1" })).toEqual({ kind: "push", branch: "zero/feat-1" })
    expect(parseAction("create", { branch: "feat", title: "" })).toMatch(/title/)
    expect(parseAction("nope", {})).toMatch(/no such action/)
  })

  it("runs gh and git with text on stdin and flag values bound to their flags", () => {
    expect(commandsFor({ kind: "comment", number: 3, body: "--danger" })).toEqual([{ cmd: "gh", args: ["pr", "comment", "3", "--body-file", "-"], input: "--danger" }])
    expect(commandsFor({ kind: "ready", number: 3, draft: true })[0]!.args).toEqual(["pr", "ready", "3", "--undo"])
    expect(commandsFor({ kind: "merge", number: 3, method: "rebase", deleteBranch: true })[0]!.args).toEqual(["pr", "merge", "3", "--rebase", "--delete-branch"])
    const create = commandsFor({ kind: "create", branch: "feat", base: "main", title: "-x", body: "B", draft: true })
    expect(create.map((c) => c.cmd)).toEqual(["git", "gh"])
    expect(create[1]).toEqual({ cmd: "gh", args: ["pr", "create", "--head=feat", "--base=main", "--title=-x", "--body-file", "-", "--draft"], input: "B" })
  })

  it("stops at the first command that fails and says why", async () => {
    const calls: Array<string> = []
    const r = await runAction(".", { kind: "create", branch: "feat", base: "", title: "T", body: "", draft: false }, fake([["git push", no("rejected: non-fast-forward")]], calls))
    expect(r).toEqual({ ok: false, error: "rejected: non-fast-forward" })
    expect(calls).toHaveLength(1)
  })

  it("takes the new git and pull request actions", () => {
    expect(parseAction("fetch", {})).toEqual({ kind: "fetch" })
    expect(parseAction("pull", {})).toEqual({ kind: "pull" })
    expect(parseAction("close", {})).toMatch(/which/)
    expect(parseAction("close", { number: 3, comment: "  done " })).toEqual({ kind: "close", number: 3, comment: "done" })
    expect(parseAction("reopen", {})).toMatch(/which/)
    expect(parseAction("reopen", { number: 3 })).toEqual({ kind: "reopen", number: 3 })
    expect(parseAction("edit", { number: 3, title: "  " })).toMatch(/title/)
    expect(parseAction("edit", { number: 3, title: "New", body: "B" })).toEqual({ kind: "edit", number: 3, title: "New", body: "B" })
    expect(parseAction("update", { number: 3 })).toEqual({ kind: "update", number: 3, rebase: false })
    expect(parseAction("update", { number: 3, rebase: true })).toEqual({ kind: "update", number: 3, rebase: true })
    expect(parseAction("reviewers", { number: 3, reviewers: "@ada, bob  ada" })).toEqual({ kind: "reviewers", number: 3, reviewers: ["ada", "bob"] })
    expect(parseAction("reviewers", { number: 3, reviewers: ["org/team"] })).toEqual({ kind: "reviewers", number: 3, reviewers: ["org/team"] })
    expect(parseAction("reviewers", { number: 3, reviewers: "" })).toMatch(/name someone/)
    expect(parseAction("reviewers", { number: 3, reviewers: "bad name!" })).toMatch(/name! isn't a GitHub username/)
    expect(parseAction("reviewers", { number: 3, reviewers: "--flag" })).toMatch(/isn't a GitHub username/)
  })

  it("runs the new actions' commands", () => {
    expect(commandsFor({ kind: "fetch" })).toEqual([{ cmd: "git", args: ["fetch", "--all", "--prune"] }])
    expect(commandsFor({ kind: "pull" })).toEqual([{ cmd: "git", args: ["pull", "--ff-only"] }])
    expect(commandsFor({ kind: "close", number: 3, comment: "done" })).toEqual([
      { cmd: "gh", args: ["pr", "comment", "3", "--body-file", "-"], input: "done" },
      { cmd: "gh", args: ["pr", "close", "3"] }
    ])
    expect(commandsFor({ kind: "close", number: 3, comment: "" })).toEqual([{ cmd: "gh", args: ["pr", "close", "3"] }])
    expect(commandsFor({ kind: "reopen", number: 3 })).toEqual([{ cmd: "gh", args: ["pr", "reopen", "3"] }])
    expect(commandsFor({ kind: "edit", number: 3, title: "New title", body: "--B" })).toEqual([
      { cmd: "gh", args: ["pr", "edit", "3", "--title=New title", "--body-file", "-"], input: "--B" }
    ])
    expect(commandsFor({ kind: "update", number: 3, rebase: true })).toEqual([{ cmd: "gh", args: ["pr", "update-branch", "3", "--rebase"] }])
    expect(commandsFor({ kind: "reviewers", number: 3, reviewers: ["ada", "bob"] })).toEqual([{ cmd: "gh", args: ["pr", "edit", "3", "--add-reviewer=ada,bob"] }])
  })
})

describe("files for @", () => {
  it("lists tracked and new files, not ignored ones, once each, and says when it isn't a repository", async () => {
    const calls: Array<string> = []
    const r = await listFiles(".", fake([["git ls-files --cached --others --exclude-standard", ok("src/a.ts\0README.md\0src/a.ts\0")]], calls))
    expect(r).toEqual({ files: ["src/a.ts", "README.md"], truncated: false, git: true })
    expect(calls).toEqual(["git ls-files -z --cached --others --exclude-standard"])
    expect(await listFiles(".", fake([]))).toEqual({ files: [], truncated: false, git: false })
  })
})
