/**
 * The git a generation needs: where HEAD is, which files changed, and how to
 * put back what a rejected attempt changed.
 */
import { Effect, FileSystem, Path } from "effect"
import { GitError } from "./Errors.ts"
import { procOk, runProcess, tail } from "./Proc.ts"

export const git = (root: string, args: ReadonlyArray<string>) =>
  runProcess("git", args, { cwd: root, timeoutS: 60 }).pipe(
    Effect.mapError((e) => new GitError({ message: `git ${args[0]}: ${String(e)}` })),
    Effect.flatMap((r) =>
      procOk(r)
        ? Effect.succeed(r.stdout)
        : Effect.fail(new GitError({ message: `git ${args.join(" ")} failed: ${tail(r.stderr || r.stdout, 400)}` }))
    )
  )

export const head = (root: string) => git(root, ["rev-parse", "HEAD"]).pipe(Effect.map((s) => s.trim()))

export interface Change {
  /** Relative to the repo root, `/` separators. */
  readonly path: string
  /** In HEAD (so it can be checked out again), or new. */
  readonly tracked: boolean
}

/** Every file that differs from HEAD, staged or not, including new files (ignored ones aren't). */
export const changes = Effect.fn("Git.changes")(function*(root: string) {
  const out = yield* git(root, ["status", "--porcelain=v1", "-z", "--untracked-files=all"])
  const result: Array<Change> = []
  const fields = out.split("\0")
  for (let i = 0; i < fields.length; i++) {
    const entry = fields[i]!
    if (entry.length < 4) continue
    const status = entry.slice(0, 2)
    const path = entry.slice(3)
    // A rename's entry is followed by its old path.
    if (status.startsWith("R") || status.startsWith("C")) {
      const from = fields[++i]
      if (from) result.push({ path: from, tracked: true })
    }
    result.push({ path, tracked: status !== "??" && !status.startsWith("A") })
  }
  return result as ReadonlyArray<Change>
})

/** Put every changed file back as HEAD has it, deleting new ones. */
export const revert = Effect.fn("Git.revert")(function*(root: string, changed: ReadonlyArray<Change>) {
  const fs = yield* FileSystem.FileSystem
  const path = yield* Path.Path
  const tracked = changed.filter((c) => c.tracked).map((c) => c.path)
  if (tracked.length > 0) yield* git(root, ["checkout", "HEAD", "--", ...tracked])
  for (const c of changed.filter((c) => !c.tracked)) {
    yield* git(root, ["rm", "--cached", "--quiet", "--ignore-unmatch", "--", c.path])
    yield* fs.remove(path.join(root, c.path), { force: true }).pipe(
      Effect.mapError((e) => new GitError({ message: `can't remove ${c.path}: ${e.message}` }))
    )
  }
})
