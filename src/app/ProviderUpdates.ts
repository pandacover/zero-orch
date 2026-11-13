/**
 * Newer Claude Code and Codex than zero ships with, installed from Settings → Providers.
 *
 * zero's SDKs bring their own Claude Code and Codex binaries, pinned in package.json. An update
 * installs a newer binary beside zero, in ~/.zero/providers/<id>/<version>, with npm (so the
 * person's registry and proxy settings apply), checks that it starts, and points the SDK at it:
 * Claude's `pathToClaudeCodeExecutable`, Codex's `codexPathOverride`. Sessions started after that
 * run on it. Nothing in zero's own folder changes, so this works for an installed app as well as a
 * clone, and a session still running keeps the binary it started with. Once zero itself ships a
 * version as new, its own is used again.
 */
import { execFile } from "node:child_process"
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { createRequire } from "node:module"
import { delimiter, dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { cleanEnv } from "../Proc.ts"
import { appHome } from "./Store.ts"

export type Updatable = "claude" | "codex"
export const UPDATABLE: ReadonlyArray<Updatable> = ["claude", "codex"]

/** A binary installed by an update: its version (as `--version` says it), where it is, and folders its PATH needs. */
export interface Installed {
  readonly version: string
  readonly path: string
  readonly pathDirs: ReadonlyArray<string>
}

/** What Settings shows for one provider's program. */
export interface ProviderVersion {
  /** The version new sessions use; null when this copy of zero has none (an installed app leaves Codex out). */
  readonly current: string | null
  /** True when `current` came from an update, not with zero. */
  readonly updated: boolean
  /** The newest release; null when the check failed (`error` says why). */
  readonly latest: string | null
  readonly error?: string | undefined
  /** `latest` is newer than `current` (or there's none yet): an update would install it. */
  readonly newer: boolean
  /** An update is installing now. */
  readonly updating: boolean
}

const WIN = process.platform === "win32"
const require = createRequire(import.meta.url)

/** `a` is a later version than `b`, by their numeric major.minor.patch. */
export const isNewer = (a: string, b: string): boolean => {
  const parts = (v: string) => v.replace(/^v/, "").split("-")[0]!.split(".").map((n) => Number.parseInt(n, 10) || 0)
  const x = parts(a)
  const y = parts(b)
  for (let i = 0; i < Math.max(x.length, y.length); i++) {
    const d = (x[i] ?? 0) - (y[i] ?? 0)
    if (d !== 0) return d > 0
  }
  return false
}

const libcMusl = (): boolean => {
  try {
    const report = process.report?.getReport() as { header?: { glibcVersionRuntime?: string } } | undefined
    return !report?.header?.glibcVersionRuntime
  } catch {
    return false
  }
}

/** The Agent SDK's package with Claude Code's binary for this machine, as the SDK itself picks it. */
export const claudePackage = (platform: string = process.platform, arch: string = process.arch, musl = platform === "linux" && libcMusl()): string =>
  `@anthropic-ai/claude-agent-sdk-${platform}-${arch}${musl ? "-musl" : ""}`

/** Codex's package with its binary for this machine. */
export const codexPackage = (platform: string = process.platform, arch: string = process.arch): string => `@openai/codex-${platform}-${arch}`

/** Where Codex keeps its binary in its platform package: `vendor/<target>/bin` (or the older `codex/`), and the folders it adds to PATH. */
export const codexBinaryIn = (pkgDir: string): Installed | undefined => {
  const vendor = join(pkgDir, "vendor")
  const name = WIN ? "codex.exe" : "codex"
  let targets: Array<string> = []
  try { targets = readdirSync(vendor) } catch { return undefined }
  for (const t of targets) {
    for (const [bin, path] of [[join(vendor, t, "bin", name), join(vendor, t, "codex-path")], [join(vendor, t, "codex", name), join(vendor, t, "path")]] as const) {
      if (existsSync(bin)) return { version: "", path: bin, pathDirs: existsSync(path) ? [path] : [] }
    }
  }
  return undefined
}

/** The version zero itself ships, or null when this copy has no binary for it. */
const bundledVersion = (id: Updatable): string | null => {
  try {
    if (id === "claude") {
      const dir = dirname(fileURLToPath(import.meta.resolve("@anthropic-ai/claude-agent-sdk")))
      const sdk = JSON.parse(readFileSync(join(dir, "package.json"), "utf8")) as { claudeCodeVersion?: string }
      return sdk.claudeCodeVersion ?? null
    }
    const pkg = require.resolve("@openai/codex/package.json")
    const own = createRequire(pkg)
    // An installed app leaves Codex's binaries out (they're large, and Codex is off by default).
    if (!codexBinaryIn(dirname(own.resolve(`${codexPackage()}/package.json`)))) return null
    return (JSON.parse(readFileSync(pkg, "utf8")) as { version: string }).version
  } catch {
    return null
  }
}

const home = () => join(appHome(), "providers")
const statePath = (id: Updatable) => join(home(), `${id}.json`)

const readState = (id: Updatable): Installed | undefined => {
  try {
    const s = JSON.parse(readFileSync(statePath(id), "utf8")) as Partial<Installed>
    return typeof s.version === "string" && typeof s.path === "string" ? { version: s.version, path: s.path, pathDirs: s.pathDirs ?? [] } : undefined
  } catch {
    return undefined
  }
}

/** The updated binary sessions should run, or undefined to use the SDK's own (none installed, gone, or not newer). */
export const installed = (id: Updatable): Installed | undefined => {
  const s = readState(id)
  if (!s || !existsSync(s.path)) return undefined
  const bundled = bundledVersion(id)
  return bundled && !isNewer(s.version, bundled) ? undefined : s
}

/** Options for the Agent SDK's `query`: Claude Code's updated binary, when there is one. */
export const claudeExecutable = (): { pathToClaudeCodeExecutable?: string } => {
  const s = installed("claude")
  return s ? { pathToClaudeCodeExecutable: s.path } : {}
}

/** Options for `new Codex(...)`: the updated binary, with its folders ahead on PATH as the SDK would put them. */
export const codexExecutable = (env: Record<string, string>): { env: Record<string, string>; codexPathOverride?: string } => {
  const s = installed("codex")
  if (!s) return { env }
  const key = Object.keys(env).find((k) => k.toLowerCase() === "path") ?? "PATH"
  const rest = (env[key] ?? "").split(delimiter).filter((p) => p && !s.pathDirs.includes(p))
  return { env: { ...env, [key]: [...s.pathDirs, ...rest].join(delimiter) }, codexPathOverride: s.path }
}

/**
 * A command's outcome; never throws. Windows starts npm's .cmd shim only through a shell, given as one
 * line (its arguments here are zero's own, with no spaces or quotes to escape).
 */
const run = (cmd: string, args: ReadonlyArray<string>, cwd: string, timeout: number) =>
  new Promise<{ ok: boolean; out: string }>((resolve) => {
    const shell = WIN && cmd === "npm"
    execFile(shell ? [cmd, ...args].join(" ") : cmd, shell ? [] : args, { cwd, env: cleanEnv(), timeout, maxBuffer: 8 * 1024 * 1024, windowsHide: true, shell }, (e, stdout, stderr) =>
      resolve({ ok: !e, out: e ? (String(stderr).trim().split("\n").filter((l) => !/^npm (warn|notice)/i.test(l)).pop() || e.message) : String(stdout) }))
  })

/** The newest release: the version a person sees, and the npm version that installs it. */
interface Release { readonly version: string; readonly npm: string }

const LATEST_FOR_MS = 10 * 60_000
interface Look { readonly at: number; readonly release?: Release | undefined; readonly error?: string | undefined }
const latestCache = new Map<Updatable, Look>()

const fetchLatest = async (id: Updatable): Promise<Release> => {
  // Claude Code's version rides on the Agent SDK's release, which names it.
  const r = id === "claude"
    ? await run("npm", ["view", "@anthropic-ai/claude-agent-sdk@latest", "version", "claudeCodeVersion", "--json"], home(), 60_000)
    : await run("npm", ["view", "@openai/codex@latest", "version", "--json"], home(), 60_000)
  if (!r.ok) throw new Error(`npm couldn't say (${r.out})`)
  const said = JSON.parse(r.out) as string | { version?: string; claudeCodeVersion?: string }
  const release = typeof said === "string" ? { version: said, npm: said }
    : id === "claude" && said.version && said.claudeCodeVersion ? { version: said.claudeCodeVersion, npm: said.version }
    : undefined
  if (!release) throw new Error("npm's answer named no version")
  return release
}

const latest = async (id: Updatable, fresh: boolean): Promise<Look> => {
  const known = latestCache.get(id)
  if (known && !fresh && Date.now() - known.at < LATEST_FOR_MS) return known
  mkdirSync(home(), { recursive: true })
  const found: Look = await fetchLatest(id).then((release) => ({ at: Date.now(), release }), (e: unknown) => ({ at: Date.now(), error: e instanceof Error ? e.message : String(e) }))
  latestCache.set(id, found)
  return found
}

const updating = new Map<Updatable, Promise<ProviderVersion>>()

/** One provider's version now, and the newest out (asked of npm at most every ten minutes, unless `fresh`). */
export const versionOf = async (id: Updatable, fresh = false): Promise<ProviderVersion> => {
  const s = installed(id)
  const l = await latest(id, fresh)
  const current = s?.version ?? bundledVersion(id)
  const newest = l.release?.version ?? null
  return { current, updated: !!s, latest: newest, error: l.error, newer: !!newest && (!current || isNewer(newest, current)), updating: updating.has(id) }
}

export const versions = async (fresh = false): Promise<Record<Updatable, ProviderVersion>> => {
  const [claude, codex] = await Promise.all(UPDATABLE.map((id) => versionOf(id, fresh)))
  return { claude: claude!, codex: codex! }
}

/** What the binary says its version is, or undefined when it doesn't start. */
const selfReported = async (path: string): Promise<string | undefined> => {
  const r = await run(path, ["--version"], dirname(path), 60_000)
  return r.ok ? /\d+\.\d+\.\d+/.exec(r.out)?.[0] : undefined
}

/**
 * Install the newest release beside zero and use it from the next session. Older updates are
 * removed, except the one in use until now, which a running session may still have open.
 */
export const update = (id: Updatable): Promise<ProviderVersion> => {
  const going = updating.get(id)
  if (going) return going
  const job = (async () => {
    const l = await latest(id, true)
    if (!l.release) throw new Error(`Couldn't find the newest version: ${l.error}`)
    const release = l.release
    const now = installed(id)?.version ?? bundledVersion(id)
    if (now && !isNewer(release.version, now)) return
    const base = join(home(), id)
    const dir = join(base, release.version)
    rmSync(dir, { recursive: true, force: true })
    mkdirSync(dir, { recursive: true })
    // The binary's own package for this machine, under the name the SDK looks for: Codex publishes each
    // platform's as a version of @openai/codex ("0.169.0-win32-x64"), which npm's optional dependencies miss at times.
    const pkg = id === "claude" ? claudePackage() : codexPackage()
    const spec = id === "claude" ? release.npm : `npm:@openai/codex@${release.npm}-${process.platform}-${process.arch}`
    // Its own package.json makes the folder npm's project, so the install lands here and nowhere above.
    writeFileSync(join(dir, "package.json"), JSON.stringify({ name: `zero-${id}`, private: true, dependencies: { [pkg]: spec } }, null, 2))
    const r = await run("npm", ["install", "--no-audit", "--no-fund", "--no-package-lock"], dir, 15 * 60_000)
    if (!r.ok) throw new Error(`npm couldn't install ${pkg}@${spec} (${r.out})`)
    const found = id === "claude"
      ? (() => {
        const path = join(dir, "node_modules", ...pkg.split("/"), WIN ? "claude.exe" : "claude")
        return existsSync(path) ? { version: release.version, path, pathDirs: [] } : undefined
      })()
      : codexBinaryIn(join(dir, "node_modules", ...pkg.split("/")))
    if (!found) throw new Error(`npm installed ${pkg}@${spec}, but it has no binary for this machine`)
    const said = await selfReported(found.path)
    if (!said) throw new Error(`${found.path} doesn't start`)
    const fresh: Installed = { ...found, version: said }
    const before = readState(id)
    writeFileSync(statePath(id), JSON.stringify(fresh, null, 2))
    const keep = new Set([release.version, before?.version])
    for (const old of readdirSync(base)) {
      if (keep.has(old)) continue
      try { rmSync(join(base, old), { recursive: true, force: true }) } catch { /* still running: next time */ }
    }
  })().finally(() => updating.delete(id)).then(() => versionOf(id))
  updating.set(id, job)
  return job
}
