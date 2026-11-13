/**
 * A thread's git, for the page's Git panel: the branch the thread worked on,
 * how it stands against its upstream, the working tree, its commits, and the
 * pull request for it on GitHub with its checks, reviews and comments.
 *
 * Local facts come from `git`; the pull request from the GitHub CLI (`gh`),
 * signed in as the person. Both run with no shell, and never prompt.
 * Actions (comment, ready, re-run, merge, push, open a PR, close, reopen, edit,
 * update a branch, request reviewers, fetch and pull) are the person's clicks,
 * each one `gh` or `git` command.
 */
import { execFile } from "node:child_process"
import { readFile } from "node:fs/promises"
import { join } from "node:path"

export interface Exec {
  readonly ok: boolean
  readonly stdout: string
  readonly stderr: string
  /** The program wasn't found. */
  readonly missing: boolean
}

export type Run = (cmd: "git" | "gh", args: ReadonlyArray<string>, cwd: string, input?: string) => Promise<Exec>

const ENV = { ...process.env, GH_PROMPT_DISABLED: "1", GIT_TERMINAL_PROMPT: "0", NO_COLOR: "1", GH_NO_UPDATE_NOTIFIER: "1", CLICOLOR: "0" }

export const run: Run = (cmd, args, cwd, input) =>
  new Promise((resolve) => {
    const child = execFile(cmd, args as Array<string>, { cwd, env: ENV, timeout: 30_000, maxBuffer: 16 * 1024 * 1024, windowsHide: true }, (err, stdout, stderr) => {
      const code = (err as NodeJS.ErrnoException | null)?.code
      resolve({ ok: !err, stdout: String(stdout), stderr: String(stderr || (err && !stdout ? err.message : "")), missing: code === "ENOENT" })
    })
    if (input !== undefined) child.stdin?.end(input)
  })

export interface Change {
  readonly path: string
  /** Two letters as `git status --short` has them: index then work tree (`??` new, ` M` modified, `A ` added…). */
  readonly status: string
}

export interface Commit {
  readonly sha: string
  readonly subject: string
  readonly author: string
  readonly at: string
}

export interface Check {
  readonly name: string
  readonly workflow: string
  /** passed, failed, running, pending, skipped, cancelled, neutral */
  readonly state: CheckState
  readonly url: string
  /** The Actions run behind it, to re-run; null for other kinds of check. */
  readonly runId: string | null
  readonly startedAt: string | null
  readonly completedAt: string | null
}

export type CheckState = "passed" | "failed" | "running" | "pending" | "skipped" | "cancelled" | "neutral"

export interface Note {
  readonly kind: "comment" | "review" | "inline"
  readonly author: string
  readonly body: string
  readonly at: string
  readonly url: string
  /** A review's verdict: APPROVED, CHANGES_REQUESTED, COMMENTED, DISMISSED. */
  readonly state?: string
  /** An inline comment's place. */
  readonly path?: string
  readonly line?: number | null
}

export interface PullRequest {
  readonly number: number
  readonly title: string
  readonly body: string
  /** OPEN, CLOSED, MERGED */
  readonly state: string
  readonly isDraft: boolean
  readonly url: string
  readonly author: string
  readonly base: string
  readonly head: string
  readonly createdAt: string
  readonly updatedAt: string
  readonly mergedAt: string | null
  readonly additions: number
  readonly deletions: number
  readonly changedFiles: number
  /** MERGEABLE, CONFLICTING, UNKNOWN */
  readonly mergeable: string
  /** CLEAN, BLOCKED, BEHIND, DIRTY, UNSTABLE, DRAFT, HAS_HOOKS, UNKNOWN */
  readonly mergeState: string
  /** APPROVED, CHANGES_REQUESTED, REVIEW_REQUIRED, or "" */
  readonly reviewDecision: string
  readonly labels: ReadonlyArray<string>
  readonly reviewers: ReadonlyArray<string>
  readonly checks: ReadonlyArray<Check>
  /** Comments, reviews and inline review comments, oldest first. */
  readonly notes: ReadonlyArray<Note>
  readonly files: ReadonlyArray<{ readonly path: string; readonly additions: number; readonly deletions: number; readonly change: string }>
}

export interface GitView {
  readonly repo: boolean
  /** The branch this view is about: the one the thread last worked on, else the one checked out. */
  readonly branch: string
  /** The branch checked out in the project now ("" when HEAD is detached). */
  readonly current: string
  readonly upstream: string | null
  readonly ahead: number
  readonly behind: number
  /** The branch PRs go into by default, as `origin/main`; null without a remote HEAD. */
  readonly base: string | null
  /** The working tree; about `current`, which may not be `branch`. */
  readonly changes: ReadonlyArray<Change>
  /** The branch's own commits (past the base), newest first; the last few when it is the base. */
  readonly commits: ReadonlyArray<Commit>
  /** Whether the GitHub CLI can answer here, and why not. */
  readonly gh: { readonly ok: boolean; readonly detail: string }
  readonly pr: PullRequest | null
}

const FS = "\u001f"

/** `git status --porcelain=v1 -z` into changes; a rename shows its new path. */
export const parseStatus = (out: string): Array<Change> => {
  const result: Array<Change> = []
  const fields = out.split("\0")
  for (let i = 0; i < fields.length; i++) {
    const entry = fields[i]!
    if (entry.length < 4) continue
    const status = entry.slice(0, 2)
    result.push({ path: entry.slice(3), status })
    if (status.startsWith("R") || status.startsWith("C")) i++ // the old path follows
  }
  return result
}

/** `git log --format=%H<US>%s<US>%an<US>%aI` lines into commits. */
export const parseLog = (out: string): Array<Commit> =>
  out.split("\n").filter((l) => l.includes(FS)).map((l) => {
    const [sha = "", subject = "", author = "", at = ""] = l.split(FS)
    return { sha, subject, author, at }
  })

/** `git rev-list --left-right --count a...b` → [left, right]. */
export const parseCounts = (out: string): [number, number] => {
  const [a, b] = out.trim().split(/\s+/).map((n) => Number.parseInt(n, 10))
  return [Number.isFinite(a) ? a! : 0, Number.isFinite(b) ? b! : 0]
}

/** The Actions run id in a check's details URL (`…/actions/runs/123/job/456`). */
export const runIdOf = (url: string): string | null => /\/actions\/runs\/(\d+)/.exec(url ?? "")?.[1] ?? null

const checkState = (status: string, conclusion: string): CheckState => {
  const s = (status || "").toUpperCase()
  const c = (conclusion || "").toUpperCase()
  if (s && s !== "COMPLETED") return s === "IN_PROGRESS" ? "running" : "pending"
  if (c === "SUCCESS") return "passed"
  if (c === "FAILURE" || c === "TIMED_OUT" || c === "STARTUP_FAILURE" || c === "ACTION_REQUIRED" || c === "ERROR") return "failed"
  if (c === "SKIPPED") return "skipped"
  if (c === "CANCELLED") return "cancelled"
  if (c === "PENDING" || c === "EXPECTED") return "pending"
  return "neutral"
}

type Json = Record<string, any>

/** One entry of `statusCheckRollup`: a check run (Actions and apps) or a commit status. */
export const toCheck = (c: Json): Check => {
  if (c["__typename"] === "StatusContext") {
    const state = String(c["state"] ?? "")
    return {
      name: String(c["context"] ?? "status"),
      workflow: "",
      state: checkState(state === "PENDING" || state === "EXPECTED" ? "QUEUED" : "COMPLETED", state),
      url: String(c["targetUrl"] ?? ""),
      runId: null,
      startedAt: c["startedAt"] ?? null,
      completedAt: null
    }
  }
  const url = String(c["detailsUrl"] ?? "")
  return {
    name: String(c["name"] ?? "check"),
    workflow: String(c["workflowName"] ?? ""),
    state: checkState(String(c["status"] ?? ""), String(c["conclusion"] ?? "")),
    url,
    runId: runIdOf(url),
    startedAt: c["startedAt"] || null,
    completedAt: c["completedAt"] && !String(c["completedAt"]).startsWith("0001") ? c["completedAt"] : null
  }
}

const login = (a: Json | null | undefined) => String(a?.["login"] ?? a?.["name"] ?? "someone")

/** `gh pr view --json …` and the PR's inline review comments (the REST API's shape) into one PR. */
export const toPullRequest = (p: Json, inline: ReadonlyArray<Json> = []): PullRequest => {
  const notes: Array<Note> = [
    ...((p["comments"] ?? []) as Array<Json>).map((c): Note => ({
      kind: "comment", author: login(c["author"]), body: String(c["body"] ?? ""), at: String(c["createdAt"] ?? ""), url: String(c["url"] ?? "")
    })),
    // A review with no words and no verdict worth showing (a bare COMMENTED wrapper of inline comments) is left out.
    ...((p["reviews"] ?? []) as Array<Json>)
      .filter((r) => String(r["body"] ?? "").trim() || (r["state"] && r["state"] !== "COMMENTED"))
      .map((r): Note => ({
        kind: "review", author: login(r["author"]), body: String(r["body"] ?? ""), at: String(r["submittedAt"] ?? r["createdAt"] ?? ""), url: String(r["url"] ?? ""), state: String(r["state"] ?? "")
      })),
    ...inline.map((c): Note => ({
      kind: "inline", author: login(c["user"]), body: String(c["body"] ?? ""), at: String(c["created_at"] ?? ""), url: String(c["html_url"] ?? ""),
      path: String(c["path"] ?? ""), line: (c["line"] ?? c["original_line"] ?? null) as number | null
    }))
  ].sort((a, b) => a.at.localeCompare(b.at))
  return {
    number: Number(p["number"]),
    title: String(p["title"] ?? ""),
    body: String(p["body"] ?? ""),
    state: String(p["state"] ?? ""),
    isDraft: p["isDraft"] === true,
    url: String(p["url"] ?? ""),
    author: login(p["author"]),
    base: String(p["baseRefName"] ?? ""),
    head: String(p["headRefName"] ?? ""),
    createdAt: String(p["createdAt"] ?? ""),
    updatedAt: String(p["updatedAt"] ?? ""),
    mergedAt: p["mergedAt"] || null,
    additions: Number(p["additions"] ?? 0),
    deletions: Number(p["deletions"] ?? 0),
    changedFiles: Number(p["changedFiles"] ?? 0),
    mergeable: String(p["mergeable"] ?? "UNKNOWN"),
    mergeState: String(p["mergeStateStatus"] ?? "UNKNOWN"),
    reviewDecision: String(p["reviewDecision"] ?? ""),
    labels: ((p["labels"] ?? []) as Array<Json>).map((l) => String(l["name"] ?? "")).filter(Boolean),
    reviewers: ((p["reviewRequests"] ?? []) as Array<Json>).map((r) => String(r["login"] ?? r["name"] ?? r["slug"] ?? "")).filter(Boolean),
    checks: ((p["statusCheckRollup"] ?? []) as Array<Json>).map(toCheck),
    notes,
    files: ((p["files"] ?? []) as Array<Json>).map((f) => ({ path: String(f["path"] ?? ""), additions: Number(f["additions"] ?? 0), deletions: Number(f["deletions"] ?? 0), change: String(f["changeType"] ?? "") }))
  }
}

const PR_FIELDS = [
  "number", "title", "body", "state", "isDraft", "url", "author", "baseRefName", "headRefName", "createdAt", "updatedAt", "mergedAt",
  "additions", "deletions", "changedFiles", "mergeable", "mergeStateStatus", "reviewDecision", "labels", "reviewRequests",
  "statusCheckRollup", "comments", "reviews", "files"
].join(",")

/** Why `gh` can't help, from what it printed: not installed, not signed in, no GitHub remote. */
const ghTrouble = (r: Exec): string | null => {
  if (r.missing) return "The GitHub CLI (gh) isn't installed."
  const e = r.stderr.toLowerCase()
  if (/auth login|not logged|authentication/.test(e)) return "The GitHub CLI isn't signed in: run `gh auth login`."
  if (/none of the git remotes|not a git repository|no git remotes|could not determine/.test(e)) return "This repository has no GitHub remote."
  return null
}

/** The pull request for `branch`, or null when it has none; `gh` says why it couldn't look. */
export const pullRequest = async (cwd: string, branch: string, exec: Run = run): Promise<{ gh: GitView["gh"]; pr: PullRequest | null }> => {
  const r = await exec("gh", ["pr", "view", branch, "--json", PR_FIELDS], cwd)
  if (!r.ok) {
    const trouble = ghTrouble(r)
    if (trouble) return { gh: { ok: false, detail: trouble }, pr: null }
    if (/no pull requests? found/i.test(r.stderr)) return { gh: { ok: true, detail: "" }, pr: null }
    return { gh: { ok: false, detail: r.stderr.trim().split("\n")[0] || "gh pr view failed" }, pr: null }
  }
  let raw: Json
  try {
    raw = JSON.parse(r.stdout)
  } catch {
    return { gh: { ok: false, detail: "gh answered with something other than JSON" }, pr: null }
  }
  const inline = await exec("gh", ["api", `repos/{owner}/{repo}/pulls/${Number(raw["number"])}/comments?per_page=100`], cwd)
  let comments: Array<Json> = []
  try {
    if (inline.ok) comments = JSON.parse(inline.stdout)
  } catch {}
  return { gh: { ok: true, detail: "" }, pr: toPullRequest(raw, Array.isArray(comments) ? comments : []) }
}

/** GitHub's default branch for each folder's repository, as `gh` last said (null: it couldn't), and when. */
const defaults = new Map<string, { name: string | null; at: number }>()
const DEFAULT_TTL_MS = 10 * 60 * 1000
/**
 * The repository's default branch on GitHub, where a pull request goes unless it says otherwise. Asked
 * of GitHub, not read off `origin/HEAD`: that's set at clone time and goes stale when the default changes.
 */
export const defaultBranch = async (cwd: string, exec: Run = run): Promise<string | null> => {
  const known = defaults.get(cwd)
  if (known && Date.now() - known.at < DEFAULT_TTL_MS) return known.name
  const r = await exec("gh", ["repo", "view", "--json", "defaultBranchRef", "--jq", ".defaultBranchRef.name"], cwd)
  const name = r.ok && isRefName(r.stdout.trim()) ? r.stdout.trim() : null
  defaults.set(cwd, { name, at: Date.now() })
  return name
}

/**
 * The remote's default branch as `origin/<name>`: GitHub's, else what the clone's `origin/HEAD` says;
 * null when neither knows.
 */
export const remoteDefault = async (cwd: string, exec: Run = run): Promise<string | null> => {
  const [github, remoteHead] = await Promise.all([
    defaultBranch(cwd, exec),
    text(exec, cwd, ["rev-parse", "--abbrev-ref", "refs/remotes/origin/HEAD"])
  ])
  if (github) return `origin/${github}`
  return remoteHead && remoteHead !== "origin/HEAD" ? remoteHead : null
}

/** A git command's output (trimmed, unless `raw`: status lines start with a meaningful space), or null when it failed. */
const text = async (exec: Run, cwd: string, args: ReadonlyArray<string>, raw = false) => {
  const r = await exec("git", args, cwd)
  return r.ok ? (raw ? r.stdout : r.stdout.trim()) : null
}

/**
 * Everything the Git panel shows for a thread whose project is `cwd`, about `branch` (else the checked-out one).
 * `linked` is the URL of the pull request the thread is linked to, for `branch`: looked up by itself, not by the branch.
 */
export const gitView = async (cwd: string, branch: string | undefined, exec: Run = run, linked?: string): Promise<GitView> => {
  const inside = await text(exec, cwd, ["rev-parse", "--is-inside-work-tree"])
  const empty: GitView = { repo: false, branch: "", current: "", upstream: null, ahead: 0, behind: 0, base: null, changes: [], commits: [], gh: { ok: false, detail: "" }, pr: null }
  if (inside !== "true") return empty
  const current = (await text(exec, cwd, ["branch", "--show-current"])) ?? ""
  // The thread's branch, if it still exists here; else whatever is checked out.
  const known = branch && (await text(exec, cwd, ["rev-parse", "--verify", "--quiet", `refs/heads/${branch}`])) ? branch : ""
  const name = known || current
  const ref = name ? `refs/heads/${name}` : "HEAD"
  const [upstream, remoteHead, status, prInfo] = await Promise.all([
    name ? text(exec, cwd, ["rev-parse", "--abbrev-ref", "--symbolic-full-name", `${name}@{upstream}`]) : Promise.resolve(null),
    remoteDefault(cwd, exec),
    text(exec, cwd, ["status", "--porcelain=v1", "-z", "--untracked-files=all"], true),
    name ? pullRequest(cwd, linked && known ? linked : name, exec) : Promise.resolve({ gh: { ok: false, detail: "HEAD is detached: no branch to look up." }, pr: null })
  ])
  const [ahead, behind] = upstream ? parseCounts((await text(exec, cwd, ["rev-list", "--left-right", "--count", `${ref}...${upstream}`])) ?? "") : [0, 0]
  // A branch's own commits are those past the PR's base, else past the remote's default branch.
  const base = prInfo.pr?.base ? `origin/${prInfo.pr.base}` : remoteHead
  const format = `--format=%H${FS}%s${FS}%an${FS}%aI`
  const own = base && base.replace(/^origin\//, "") !== name
    ? await text(exec, cwd, ["log", format, "-n", "50", `${base}..${ref}`, "--"])
    : null
  const log = own !== null && own !== "" ? own : await text(exec, cwd, ["log", format, "-n", "10", ref, "--"])
  return {
    repo: true,
    branch: name,
    current,
    upstream,
    ahead,
    behind,
    base,
    changes: status === null ? [] : parseStatus(status),
    commits: parseLog(log ?? ""),
    gh: prInfo.gh,
    pr: prInfo.pr
  }
}

/** Most of a diff a page shows, or a model reads to write a commit message. */
const MAX_DIFF = 200_000

/**
 * One changed file's diff against HEAD, staged and not; a new file shows as all additions. Only a path
 * `git status` lists right now, so a page can't read any other file this way. Undefined when it isn't one.
 */
export const fileDiff = async (cwd: string, path: string, exec: Run = run): Promise<string | undefined> => {
  const status = await text(exec, cwd, ["status", "--porcelain=v1", "-z", "--untracked-files=all"], true)
  const change = status === null ? undefined : parseStatus(status).find((c) => c.path === path)
  if (!change) return undefined
  if (change.status === "??") {
    const body = await readFile(join(cwd, path), "utf8").catch(() => "")
    if (body.includes("\0")) return `new binary file ${path}`
    const lines = body.split("\n")
    if (lines.at(-1) === "") lines.pop()
    return `new file ${path}\n@@ -0,0 +1,${lines.length} @@\n${lines.map((l) => `+${l}`).join("\n")}`.slice(0, MAX_DIFF)
  }
  const head = await text(exec, cwd, ["rev-parse", "--verify", "--quiet", "HEAD"])
  const diff = await text(exec, cwd, head ? ["diff", "--no-color", "--no-ext-diff", "HEAD", "--", path] : ["diff", "--no-color", "--no-ext-diff", "--cached", "--", path], true)
  return (diff ?? "").slice(0, MAX_DIFF)
}

/** The most files @ in the composer offers to pick from. */
export const MAX_FILES = 20_000

/**
 * The files in a folder that git tracks or would (ignored ones left out), relative and with forward
 * slashes, for @ in the composer to pick from. `truncated` says some were left out; `git` false: not a repository.
 */
export const listFiles = async (cwd: string, exec: Run = run): Promise<{ files: Array<string>; truncated: boolean; git: boolean }> => {
  const out = await text(exec, cwd, ["ls-files", "-z", "--cached", "--others", "--exclude-standard"], true)
  if (out === null) return { files: [], truncated: false, git: false }
  const all = [...new Set(out.split("\0").filter(Boolean))]
  return { files: all.slice(0, MAX_FILES), truncated: all.length > MAX_FILES, git: true }
}

/** Everything uncommitted, for a model to describe: the stat, then the diff, cut to `limit` characters, and new files' names. */
export const pendingChange = async (cwd: string, limit = 12_000, exec: Run = run): Promise<string> => {
  const status = await text(exec, cwd, ["status", "--porcelain=v1", "-z", "--untracked-files=all"], true)
  const changes = status === null ? [] : parseStatus(status)
  const head = await text(exec, cwd, ["rev-parse", "--verify", "--quiet", "HEAD"])
  const base = head ? ["HEAD"] : ["--cached"]
  const stat = (await text(exec, cwd, ["diff", "--no-color", "--stat", ...base])) ?? ""
  const diff = (await text(exec, cwd, ["diff", "--no-color", "--no-ext-diff", ...base], true)) ?? ""
  const added = changes.filter((c) => c.status === "??").map((c) => c.path)
  return [stat, added.length ? `New files: ${added.join(", ")}` : "", diff.length > limit ? `${diff.slice(0, limit)}\n… (diff cut)` : diff]
    .filter((s) => s.trim() !== "").join("\n\n")
}

export type GitAction =
  | { readonly kind: "comment"; readonly number: number; readonly body: string }
  | { readonly kind: "ready"; readonly number: number; readonly draft: boolean }
  | { readonly kind: "rerun"; readonly runId: string }
  | { readonly kind: "merge"; readonly number: number; readonly method: "squash" | "merge" | "rebase"; readonly deleteBranch: boolean }
  | { readonly kind: "push"; readonly branch: string }
  /** Everything in the working tree, committed with `message`. */
  | { readonly kind: "commit"; readonly message: string }
  | { readonly kind: "create"; readonly branch: string; readonly base: string; readonly title: string; readonly body: string; readonly draft: boolean }
  /** Fetch every remote, and drop remote branches that are gone. */
  | { readonly kind: "fetch" }
  /** Fast-forward the checked-out branch to its upstream; never a merge or a rebase. */
  | { readonly kind: "pull" }
  | { readonly kind: "close"; readonly number: number; readonly comment: string }
  | { readonly kind: "reopen"; readonly number: number }
  | { readonly kind: "edit"; readonly number: number; readonly title: string; readonly body: string }
  /** Bring the pull request's branch up to date with its base, on GitHub. */
  | { readonly kind: "update"; readonly number: number; readonly rebase: boolean }
  | { readonly kind: "reviewers"; readonly number: number; readonly reviewers: ReadonlyArray<string> }

const isPrNumber = (x: unknown): x is number => typeof x === "number" && Number.isInteger(x) && x > 0
const str = (x: unknown) => (typeof x === "string" ? x : "")
/** A ref name git would take, and that can't be read as an option. */
export const isRefName = (x: string) => x !== "" && !x.startsWith("-") && !/[\s~^:?*[\\]|\.\.|@\{|\/\/|\.lock$|\/$|^\//.test(x)
/** A GitHub user (`ada`), or a team (`org/team`), as a reviewer is named. */
const REVIEWER = /^[A-Za-z0-9][A-Za-z0-9-]*(\/[A-Za-z0-9][A-Za-z0-9._-]*)?$/

/** A page's request into an action, or what's wrong with it. */
export const parseAction = (kind: string, body: Record<string, unknown>): GitAction | string => {
  switch (kind) {
    case "comment": {
      const text = str(body["body"]).trim()
      if (!isPrNumber(body["number"])) return "which pull request?"
      return text ? { kind, number: body["number"], body: text } : "write a comment first"
    }
    case "ready":
      return isPrNumber(body["number"]) ? { kind, number: body["number"], draft: body["draft"] === true } : "which pull request?"
    case "rerun":
      return /^\d+$/.test(str(body["runId"])) ? { kind, runId: str(body["runId"]) } : "which run?"
    case "merge": {
      const method = str(body["method"]) || "squash"
      if (!isPrNumber(body["number"])) return "which pull request?"
      if (method !== "squash" && method !== "merge" && method !== "rebase") return "merge, squash or rebase?"
      return { kind, number: body["number"], method, deleteBranch: body["deleteBranch"] === true }
    }
    case "push":
      return isRefName(str(body["branch"])) ? { kind, branch: str(body["branch"]) } : "which branch?"
    case "commit": {
      const message = str(body["message"]).trim()
      return message ? { kind, message: message.slice(0, 10_000) } : "write a commit message first"
    }
    case "create": {
      const branch = str(body["branch"])
      const base = str(body["base"])
      const title = str(body["title"]).trim()
      if (!isRefName(branch)) return "which branch?"
      if (base && !isRefName(base)) return "that base branch isn't a branch name"
      if (!title) return "give the pull request a title"
      return { kind, branch, base, title: title.slice(0, 256), body: str(body["body"]), draft: body["draft"] === true }
    }
    case "fetch":
      return { kind }
    case "pull":
      return { kind }
    case "close":
      return isPrNumber(body["number"]) ? { kind, number: body["number"], comment: str(body["comment"]).trim() } : "which pull request?"
    case "reopen":
      return isPrNumber(body["number"]) ? { kind, number: body["number"] } : "which pull request?"
    case "edit": {
      if (!isPrNumber(body["number"])) return "which pull request?"
      const title = str(body["title"]).trim().slice(0, 256)
      return title ? { kind, number: body["number"], title, body: str(body["body"]) } : "give the pull request a title"
    }
    case "update":
      return isPrNumber(body["number"]) ? { kind, number: body["number"], rebase: body["rebase"] === true } : "which pull request?"
    case "reviewers": {
      if (!isPrNumber(body["number"])) return "which pull request?"
      const raw = body["reviewers"]
      // One string split on commas and spaces, or a list; an @ before a name is allowed, and a name counted once.
      const names = typeof raw === "string" ? raw.split(/[\s,]+/) : Array.isArray(raw) ? raw.filter((x): x is string => typeof x === "string") : []
      const reviewers = [...new Set(names.map((n) => n.trim().replace(/^@/, "")).filter((n) => n !== ""))]
      if (reviewers.length === 0) return "name someone to review it"
      if (reviewers.length > 15) return "that's too many reviewers"
      const bad = reviewers.find((n) => !REVIEWER.test(n))
      return bad === undefined ? { kind, number: body["number"], reviewers } : `${bad} isn't a GitHub username`
    }
    default:
      return "no such action"
  }
}

/** The commands an action runs, in order; text goes in on stdin, never on the command line. */
export const commandsFor = (a: GitAction): Array<{ cmd: "git" | "gh"; args: Array<string>; input?: string }> => {
  switch (a.kind) {
    case "comment":
      return [{ cmd: "gh", args: ["pr", "comment", String(a.number), "--body-file", "-"], input: a.body }]
    case "ready":
      return [{ cmd: "gh", args: ["pr", "ready", String(a.number), ...(a.draft ? ["--undo"] : [])] }]
    case "rerun":
      return [{ cmd: "gh", args: ["run", "rerun", a.runId, "--failed"] }]
    case "merge":
      return [{ cmd: "gh", args: ["pr", "merge", String(a.number), `--${a.method}`, ...(a.deleteBranch ? ["--delete-branch"] : [])] }]
    case "push":
      return [{ cmd: "git", args: ["push", "--set-upstream", "origin", `refs/heads/${a.branch}:refs/heads/${a.branch}`] }]
    case "commit":
      return [{ cmd: "git", args: ["add", "--all"] }, { cmd: "git", args: ["commit", "--file", "-"], input: a.message }]
    case "create":
      return [
        { cmd: "git", args: ["push", "--set-upstream", "origin", `refs/heads/${a.branch}:refs/heads/${a.branch}`] },
        {
          cmd: "gh",
          args: ["pr", "create", `--head=${a.branch}`, ...(a.base ? [`--base=${a.base}`] : []), `--title=${a.title}`, "--body-file", "-", ...(a.draft ? ["--draft"] : [])],
          input: a.body
        }
      ]
    case "fetch":
      return [{ cmd: "git", args: ["fetch", "--all", "--prune"] }]
    case "pull":
      return [{ cmd: "git", args: ["pull", "--ff-only"] }]
    case "close":
      // The comment goes first, on stdin; the close runs either way.
      return [
        ...(a.comment ? [{ cmd: "gh" as const, args: ["pr", "comment", String(a.number), "--body-file", "-"], input: a.comment }] : []),
        { cmd: "gh", args: ["pr", "close", String(a.number)] }
      ]
    case "reopen":
      return [{ cmd: "gh", args: ["pr", "reopen", String(a.number)] }]
    case "edit":
      return [{ cmd: "gh", args: ["pr", "edit", String(a.number), `--title=${a.title}`, "--body-file", "-"], input: a.body }]
    case "update":
      return [{ cmd: "gh", args: ["pr", "update-branch", String(a.number), ...(a.rebase ? ["--rebase"] : [])] }]
    case "reviewers":
      return [{ cmd: "gh", args: ["pr", "edit", String(a.number), `--add-reviewer=${a.reviewers.join(",")}`] }]
  }
}

/** Run an action in `cwd`; the first command that fails stops it, and its words are the error. */
export const runAction = async (cwd: string, a: GitAction, exec: Run = run): Promise<{ ok: true; output: string } | { ok: false; error: string }> => {
  let output = ""
  for (const c of commandsFor(a)) {
    const r = await exec(c.cmd, c.args, cwd, c.input)
    if (!r.ok) {
      if (r.missing) return { ok: false, error: `${c.cmd} isn't installed` }
      return { ok: false, error: (r.stderr || r.stdout).trim().split("\n").slice(-3).join(" ") || `${c.cmd} ${c.args[0]} failed` }
    }
    output = (r.stdout || r.stderr).trim()
  }
  return { ok: true, output }
}
