/**
 * A thread's branch, picked from its composer: the branches it can switch to,
 * the switch itself, a new branch from a base the person picks, a git worktree
 * on a new branch from such a base for a thread to work in apart from the
 * project's own folder, and joining the worktree a branch is already in.
 *
 * Every command is `git` with no shell (GitInfo's `run`), and never prompts.
 */
import { existsSync } from "node:fs"
import { join, resolve } from "node:path"
import { type Exec, isRefName, remoteDefault, type Run, run } from "./GitInfo.ts"

export interface Branch {
  readonly name: string
  /** Where it's checked out, when that's another worktree than the one asked about: git won't switch to it here. */
  readonly elsewhere: string | null
  /** When its last commit was made (ISO 8601); "" when git didn't say. */
  readonly at: string
  /** The branch it tracks, as `origin/name`; "" when it tracks none. */
  readonly upstream: string
  /** Commits it has that its upstream doesn't, and the other way round. */
  readonly ahead: number
  readonly behind: number
  /** Its upstream was deleted on the remote. */
  readonly gone: boolean
}

export interface Branches {
  readonly repo: boolean
  /** The branch checked out here; "" when HEAD is detached. */
  readonly current: string
  readonly local: ReadonlyArray<Branch>
  /** Remote branches with no local branch of the same name, as `origin/name`: switching to one makes it. */
  readonly remote: ReadonlyArray<string>
  /** The branch a new worktree starts from unless the person picks another: the remote's default, else `current`. */
  readonly base: string
  /** Whether this folder is a worktree git added, not the repository's main one. */
  readonly linked: boolean
}

const FS = "\u001f"

/** A path as git and Windows may both write it, for comparing. */
export const samePath = (a: string, b: string): boolean => {
  const norm = (p: string) => {
    const r = resolve(p).replace(/[\\/]+$/, "")
    return process.platform === "win32" ? r.toLowerCase().replace(/\\/g, "/") : r
  }
  return norm(a) === norm(b)
}

/** Why a git command failed, in git's last words. */
const why = (r: Exec, what: string): string =>
  r.missing ? "git isn't installed" : (r.stderr || r.stdout).trim().split("\n").filter(Boolean).slice(-2).join(" ") || `${what} failed`

const out = async (exec: Run, cwd: string, args: ReadonlyArray<string>) => {
  const r = await exec("git", args, cwd)
  return r.ok ? r.stdout.trim() : null
}

/**
 * `git for-each-ref` lines of five fields, each after a unit separator: the name, the worktree it's in, its
 * last commit's date, its upstream, and how it stands against that upstream (`ahead 2`, `behind 1`,
 * `ahead 2, behind 1`, `gone`, or nothing), into branches, against the worktree at `cwd`. A line with fewer
 * fields (older output) leaves the rest empty.
 */
export const parseLocal = (text: string, cwd: string): Array<Branch> =>
  text.split("\n").filter((l) => l.trim()).map((l) => {
    const [name = "", where = "", at = "", upstream = "", track = ""] = l.split(FS).map((f) => f.trim())
    const count = (re: RegExp) => Number(re.exec(track)?.[1] ?? 0)
    return {
      name,
      elsewhere: where && !samePath(where, cwd) ? where : null,
      at,
      upstream,
      ahead: count(/ahead (\d+)/),
      behind: count(/behind (\d+)/),
      gone: track === "gone"
    }
  }).filter((b) => b.name !== "")

/** Remote branches (`origin/x`) that no local branch already stands for; never `origin/HEAD` or the bare remote. */
export const parseRemote = (text: string, local: ReadonlyArray<Branch>): Array<string> => {
  const names = new Set(local.map((b) => b.name))
  return text.split("\n").map((l) => l.trim()).filter((r) => r.includes("/") && !r.endsWith("/HEAD") && !names.has(r.slice(r.indexOf("/") + 1)))
}

/** Every branch the composer's branch menu offers, for the worktree (or project folder) at `cwd`. */
export const listBranches = async (cwd: string, exec: Run = run): Promise<Branches> => {
  const none: Branches = { repo: false, current: "", local: [], remote: [], base: "", linked: false }
  if ((await out(exec, cwd, ["rev-parse", "--is-inside-work-tree"])) !== "true") return none
  const [current, heads, remotes, remoteHead, gitDir, common] = await Promise.all([
    out(exec, cwd, ["branch", "--show-current"]),
    out(exec, cwd, ["for-each-ref", `--format=%(refname:short)${FS}%(worktreepath)${FS}%(committerdate:iso-strict)${FS}%(upstream:short)${FS}%(upstream:track,nobracket)`, "--sort=-committerdate", "refs/heads"]),
    out(exec, cwd, ["for-each-ref", "--format=%(refname:short)", "--sort=-committerdate", "refs/remotes"]),
    remoteDefault(cwd, exec),
    out(exec, cwd, ["rev-parse", "--absolute-git-dir"]),
    out(exec, cwd, ["rev-parse", "--path-format=absolute", "--git-common-dir"])
  ])
  const local = parseLocal(heads ?? "", cwd)
  const remote = parseRemote(remotes ?? "", local)
  const defaultBranch = remoteHead ? remoteHead.replace(/^origin\//, "") : ""
  // The default branch as a local branch if there is one (it may be ahead of origin's), else origin's.
  const base = defaultBranch
    ? local.some((b) => b.name === defaultBranch) ? defaultBranch : `origin/${defaultBranch}`
    : current ?? local[0]?.name ?? ""
  return {
    repo: true,
    current: current ?? "",
    local,
    remote,
    base,
    linked: gitDir !== null && common !== null && !samePath(gitDir, common)
  }
}

/**
 * Switch the worktree at `cwd` to `branch`: a local branch, or a remote one (`origin/x`), which makes a
 * local `x` that tracks it. Uncommitted changes come along when git can carry them; when it can't, it
 * refuses and says why, and nothing changes.
 */
export const switchBranch = async (cwd: string, branch: string, exec: Run = run): Promise<{ ok: true; branch: string } | { ok: false; error: string }> => {
  if (!isRefName(branch)) return { ok: false, error: "that isn't a branch name" }
  const local = await out(exec, cwd, ["rev-parse", "--verify", "--quiet", `refs/heads/${branch}`])
  const remote = local ? null : await out(exec, cwd, ["rev-parse", "--verify", "--quiet", `refs/remotes/${branch}`])
  if (!local && !remote) return { ok: false, error: `there's no branch ${branch}` }
  const r = await exec("git", local ? ["switch", "--no-guess", branch] : ["switch", "--track", branch], cwd)
  if (!r.ok) return { ok: false, error: why(r, "git switch") }
  return { ok: true, branch: (await out(exec, cwd, ["branch", "--show-current"])) || branch }
}

/**
 * A new branch `branch` started from `base` (a local or remote branch), checked out in the worktree at
 * `cwd`. Uncommitted changes come along when git can carry them; when it can't, it refuses and nothing changes.
 */
export const createBranch = async (
  cwd: string,
  input: { readonly base: string; readonly branch: string },
  exec: Run = run
): Promise<{ ok: true; branch: string } | { ok: false; error: string }> => {
  const branch = input.branch.trim()
  const base = input.base.trim()
  if (!branch) return { ok: false, error: "name the new branch" }
  if (!isRefName(branch)) return { ok: false, error: `${branch} can't be a branch name` }
  if (!isRefName(base)) return { ok: false, error: "pick the branch it starts from" }
  if (!(await out(exec, cwd, ["rev-parse", "--verify", "--quiet", `${base}^{commit}`]))) return { ok: false, error: `there's no branch ${base}` }
  if (await out(exec, cwd, ["rev-parse", "--verify", "--quiet", `refs/heads/${branch}`])) return { ok: false, error: `${branch} already exists: switch to it, or pick another name` }
  const r = await exec("git", ["switch", "--no-track", "-c", branch, base], cwd)
  if (!r.ok) return { ok: false, error: why(r, "git switch") }
  return { ok: true, branch }
}

/**
 * Make `cwd` a git repository with `git init` and an empty first commit, unless it's already in one
 * (its own, or a parent folder's): a repository nested in another is seldom what anyone wants. The
 * first commit gives HEAD a branch to stand on, so branches and worktrees work from the start.
 */
export const initRepo = async (cwd: string, exec: Run = run): Promise<{ ok: true; made: boolean } | { ok: false; error: string }> => {
  const inside = await exec("git", ["rev-parse", "--is-inside-work-tree"], cwd)
  if (inside.missing) return { ok: false, error: "git isn't installed" }
  if (inside.ok && inside.stdout.trim() === "true") return { ok: true, made: false }
  const r = await exec("git", ["init"], cwd)
  if (!r.ok) return { ok: false, error: `git init failed: ${why(r, "git init")}` }
  const c = await exec("git", ["commit", "--allow-empty", "-m", "Initial commit"], cwd)
  return c.ok ? { ok: true, made: true } : { ok: false, error: `the repository was made, but its first commit failed: ${why(c, "git commit")}` }
}

/** A branch name's last part as a folder name: `feat/Login fix` → `login-fix`. */
export const slug = (s: string): string =>
  s.toLowerCase().replace(/^.*\//, "").replace(/[^a-z0-9._-]+/g, "-").replace(/^[-.]+|[-.]+$/g, "").slice(0, 60) || "work"

/** A branch name for a worktree when the person gives none: `zero/<base>-<a few letters>`. */
export const newBranchName = (base: string): string =>
  `zero/${slug(base.replace(/^origin\//, ""))}-${Date.now().toString(36).slice(-4)}${Math.random().toString(36).slice(2, 4)}`

/**
 * A new git worktree on a new branch `branch` started from `base` (a local or remote branch), in a
 * folder of its own under `root`. `repo` is any worktree of the repository. The folder is new: a name
 * already taken gets a number.
 */
export const createWorktree = async (
  repo: string,
  input: { readonly base: string; readonly branch: string; readonly root: string },
  exec: Run = run
): Promise<{ ok: true; path: string; branch: string } | { ok: false; error: string }> => {
  const base = input.base.trim()
  const branch = input.branch.trim() || newBranchName(base)
  if (!isRefName(base)) return { ok: false, error: "pick the branch the worktree starts from" }
  if (!isRefName(branch)) return { ok: false, error: `${branch} can't be a branch name` }
  if (!(await out(exec, repo, ["rev-parse", "--verify", "--quiet", `${base}^{commit}`]))) return { ok: false, error: `there's no branch ${base}` }
  if (await out(exec, repo, ["rev-parse", "--verify", "--quiet", `refs/heads/${branch}`])) return { ok: false, error: `${branch} already exists: switch to it, or name a new branch` }
  let path = join(input.root, slug(branch))
  for (let n = 2; existsSync(path); n++) path = join(input.root, `${slug(branch)}-${n}`)
  // A remote base doesn't make the new branch track it: its upstream is set when it's pushed.
  const r = await exec("git", ["worktree", "add", "--no-track", "-b", branch, path, base], repo)
  if (!r.ok) return { ok: false, error: why(r, "git worktree add") }
  return { ok: true, path, branch }
}

/** The folder where the local branch `branch` is checked out, when that's another worktree than the one at `cwd`. */
export const worktreeOf = async (
  cwd: string,
  branch: string,
  exec: Run = run
): Promise<{ ok: true; path: string; branch: string } | { ok: false; error: string }> => {
  if (!isRefName(branch)) return { ok: false, error: "that isn't a branch name" }
  const found = (await listBranches(cwd, exec)).local.find((b) => b.name === branch)
  if (!found) return { ok: false, error: `there's no branch ${branch}` }
  if (found.elsewhere === null) return { ok: false, error: `${branch} isn't checked out in another worktree` }
  return { ok: true, path: resolve(found.elsewhere), branch }
}
