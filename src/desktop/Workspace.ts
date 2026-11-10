/**
 * Where zero's own repo lives for the desktop app.
 *
 * Run from a clone (`npm run app`), it is that clone. An installed app's files
 * are read-only, and evolution rewrites genome/, commits it and runs the tests,
 * so on first run the app clones zero into ~/.zero/zero and installs that
 * clone's dependencies in the background. Until then, or if that fails,
 * evolution says why instead of starting.
 */
import { execFile } from "node:child_process"
import { existsSync, renameSync, rmSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { cleanEnv } from "../Proc.ts"
import { appHome } from "../app/Store.ts"

export const REPO = "https://github.com/pandacover/zero-orch.git"

export interface Workspace {
  /** zero's repo: genome, benchmark, ledger and CLI. */
  readonly root: string
  /** Why evolution can't run yet, or undefined. */
  readonly blocked: () => string | undefined
}

const WIN = process.platform === "win32"

/** A command's outcome; never throws. Windows starts npm's .cmd shim only through a shell. */
const run = (cmd: string, args: ReadonlyArray<string>, cwd: string, env: NodeJS.ProcessEnv = cleanEnv(), timeout = 0) =>
  new Promise<{ ok: boolean; out: string }>((resolve) => {
    execFile(cmd, args, { cwd, env, timeout, maxBuffer: 8 * 1024 * 1024, windowsHide: true, shell: WIN && cmd === "npm" }, (e, stdout, stderr) =>
      resolve({ ok: !e, out: e ? (String(stderr).trim().split("\n").pop() || e.message) : String(stdout) }))
  })

/**
 * A GUI launch on macOS or Linux gets a bare PATH, without Homebrew, nvm or ~/.local/bin.
 * The login shell's PATH lets threads and evolution find git, gh, npm and singularity.
 */
export const useLoginPath = async (): Promise<void> => {
  if (WIN) return
  const mark = "__ZERO_PATH__"
  const r = await run(process.env["SHELL"] || "/bin/sh", ["-ilc", `printf '${mark}%s' "$PATH"`], process.cwd(), process.env, 5000)
  const path = r.ok ? r.out.split(mark).pop()?.trim() : undefined
  if (path) process.env["PATH"] = path
}

export const openWorkspace = async (options: { readonly packaged: boolean; readonly bundled: string }): Promise<Workspace> => {
  if (!options.packaged) return { root: options.bundled, blocked: () => undefined }
  const home = appHome()
  const root = join(home, "zero")
  if (!existsSync(join(root, ".git"))) {
    // Cloned beside its place and moved in, so a half-finished clone is never taken for a whole one.
    const part = `${root}.part`
    rmSync(part, { recursive: true, force: true })
    const cloned = await run("git", ["clone", "--quiet", REPO, part], home)
    if (!cloned.ok) {
      const why = `Evolution needs its own copy of zero, and cloning ${REPO} failed (${cloned.out}). Check that git is installed, then restart the app.`
      return { root: options.bundled, blocked: () => why }
    }
    renameSync(part, root)
  }
  // Written once `npm ci` succeeds: a node_modules left by a quit mid-install doesn't count.
  const installed = join(root, "node_modules", ".zero-installed")
  let why: string | undefined
  if (!existsSync(installed)) {
    why = "zero is still installing its dependencies in ~/.zero/zero. Try again in a minute."
    // The clone's tests and typecheck need its dev tools, but not a second Electron.
    void run("npm", ["ci", "--no-audit", "--no-fund"], root, cleanEnv({ ELECTRON_SKIP_BINARY_DOWNLOAD: "1" })).then((r) => {
      if (r.ok) {
        writeFileSync(installed, "")
        return void (why = undefined)
      }
      rmSync(join(root, "node_modules"), { recursive: true, force: true })
      why = `Installing zero's dependencies in ~/.zero/zero failed (${r.out}). Check that Node and npm are installed, then restart the app.`
    })
  }
  return { root, blocked: () => why }
}
