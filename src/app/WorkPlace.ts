/**
 * Where a thread's work really is. An agent may make a git worktree of its own (`git worktree add`, Claude
 * Code's EnterWorktree) or work in one that's there, while its session still runs in the thread's folder:
 * its tool calls say so. The thread then follows that worktree: its branch, its Git panel, and the pull
 * request opened from it. And a pull request the agent opens (`gh pr create`) is linked to the thread.
 *
 * Only calls that change something count (an edit, a commit, a push, a new worktree, a pull request):
 * reading the project's folder for comparison doesn't move the thread back.
 */
import { homedir } from "node:os"
import { isAbsolute, resolve } from "node:path"
import { type Run, run } from "./GitInfo.ts"

/** Tools whose detail is the path of a file they write. */
const EDITS = new Set(["Edit", "Write", "MultiEdit", "NotebookEdit"])
/** Tools whose detail is a shell command. */
const SHELLS = new Set(["Bash", "PowerShell"])
/** A shell command that changes the checkout it runs in, or opens a pull request from it. */
const CHANGES = /^(?:git(?:\s+-C\s+\S+)?\s+(?:commit|push|switch|checkout|merge|rebase|cherry-pick|reset|stash|worktree\s+add|am|revert)\b|gh\s+pr\s+(?:create|merge|ready)\b)/

/** A path as a shell wrote it, as this machine's: Git Bash's `/c/Users/x` is `C:\Users\x` on Windows. */
export const nativePath = (p: string, from: string): string => {
  let s = p.replace(/^["']|["']$/g, "")
  if (s === "~" || s.startsWith("~/")) s = homedir() + s.slice(1)
  if (process.platform === "win32") {
    const drive = /^\/([a-zA-Z])(?:\/|$)(.*)$/.exec(s)
    if (drive) s = `${drive[1]!.toUpperCase()}:\\${drive[2]!.replace(/\//g, "\\")}`
  }
  return isAbsolute(s) ? resolve(s) : resolve(from, s)
}

/** A command's words, quotes kept together: `cd "a b" && x` → `cd`, `"a b"`, `&&`, `x`. */
const words = (command: string): Array<string> => command.match(/"[^"]*"|'[^']*'|&&|\|\||[;|\n]|[^\s;|&]+/g) ?? []

/** The path `git worktree add [options] <path> [<commit>]` makes, from the words after `add`. */
const worktreeAddPath = (rest: ReadonlyArray<string>): string | undefined => {
  const valued = new Set(["-b", "-B", "--reason"])
  for (let i = 0; i < rest.length; i++) {
    const w = rest[i]!
    if (valued.has(w)) i++
    else if (!w.startsWith("-")) return w
  }
  return undefined
}

/**
 * The folders a shell command changed something in, in order: each segment's directory (after `cd`,
 * `Set-Location` or `git -C`), when the segment commits, pushes, switches, opens a PR, and so on; and a new
 * worktree's own folder.
 */
export const commandPlaces = (command: string, cwd: string): Array<string> => {
  const places: Array<string> = []
  let here = cwd
  const segments: Array<Array<string>> = [[]]
  for (const w of words(command)) {
    if (w === "&&" || w === "||" || w === ";" || w === "|" || w === "\n") segments.push([])
    else segments.at(-1)!.push(w)
  }
  for (const seg of segments) {
    if (!seg.length) continue
    const [first, second] = seg
    if ((first === "cd" || first === "pushd" || /^set-location$/i.test(first!)) && second && !second.startsWith("-")) {
      here = nativePath(second, here)
      continue
    }
    const line = seg.join(" ")
    if (!CHANGES.test(line)) continue
    const at = first === "git" && second === "-C" && seg[2] ? nativePath(seg[2], here) : here
    places.push(at)
    const add = seg.findIndex((w, i) => w === "add" && seg[i - 1] === "worktree")
    if (add >= 0) {
      const path = worktreeAddPath(seg.slice(add + 1))
      if (path) places.push(nativePath(path, at))
    }
  }
  return places
}

/** The first absolute path in some text (Windows or POSIX), as this machine's. */
const firstPath = (text: string, cwd: string): string | undefined => {
  const m = /[A-Za-z]:[\\/][^\s"'`<>|]+|(?<![\w.])\/[^\s"'`<>|:]+/.exec(text)
  return m ? nativePath(m[0].replace(/[.,;)]+$/, ""), cwd) : undefined
}

/** Where a finished tool call changed something, if it did: the folders, in order. */
export const toolPlaces = (call: { readonly name: string; readonly detail: string; readonly output: string }, cwd: string): Array<string> => {
  if (EDITS.has(call.name) && call.detail) return [nativePath(call.detail, cwd)]
  if (SHELLS.has(call.name)) return commandPlaces(call.detail, cwd)
  // Claude Code's own worktree: its answer says where it made it.
  if (call.name === "EnterWorktree") {
    const p = firstPath(call.output, cwd)
    return p ? [p] : []
  }
  return []
}

/** A pull request a tool call opened (or found already open for the branch): `gh pr create` prints its URL. */
export const openedPr = (call: { readonly name: string; readonly detail: string; readonly output: string }): { number: number; url: string } | undefined => {
  if (!SHELLS.has(call.name) || !/\bgh\s+pr\s+create\b/.test(call.detail)) return undefined
  const m = /https:\/\/[^\s/]+\/[^\s/]+\/[^\s/]+\/pull\/(\d+)/.exec(call.output)
  return m ? { number: Number(m[1]), url: m[0] } : undefined
}

/** The worktrees of the repository at `cwd`, from `git worktree list --porcelain`; [] when it isn't one. */
export const parseWorktrees = (text: string): Array<string> =>
  text.split("\n").flatMap((l) => (l.startsWith("worktree ") ? [l.slice("worktree ".length).trim()] : []))

const norm = (p: string) => {
  const r = resolve(p).replace(/[\\/]+$/, "")
  return process.platform === "win32" ? r.toLowerCase().replace(/\\/g, "/") : r
}

/** The worktree (of `trees`) a path is in: the deepest one holding it, since a worktree may sit inside another. */
export const treeOf = (path: string, trees: ReadonlyArray<string>): string | undefined => {
  const p = norm(path)
  let best: string | undefined
  for (const t of trees) {
    const n = norm(t)
    if ((p === n || p.startsWith(`${n}/`)) && (!best || n.length > norm(best).length)) best = t
  }
  return best === undefined ? undefined : resolve(best)
}

/**
 * The worktree of the repository at `cwd` the agent last changed something in, from the places its calls
 * changed (oldest first); undefined when none of them is in one of the repository's worktrees.
 */
export const lastWorktree = async (cwd: string, places: ReadonlyArray<string>, exec: Run = run): Promise<string | undefined> => {
  if (!places.length) return undefined
  const r = await exec("git", ["worktree", "list", "--porcelain"], cwd)
  if (!r.ok) return undefined
  const trees = parseWorktrees(r.stdout)
  for (let i = places.length - 1; i >= 0; i--) {
    const tree = treeOf(places[i]!, trees)
    if (tree) return tree
  }
  return undefined
}
