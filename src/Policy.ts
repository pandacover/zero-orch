/**
 * What an agent session may do, decided in code for every tool call.
 *
 * The improver runs with write access to its own genome; that's the point of
 * it. So the boundary can't live in the prompt. Each session gets a policy:
 * the folder it may write in, which paths there it may write, and an
 * allowlist of exact shell commands. The Agent SDK asks `decide` before every
 * tool call it would otherwise prompt for; anything not allowed is denied
 * with the reason, which the model sees and can work around.
 *
 * A second, independent guard runs after the improver finishes: the
 * generation checks with git which files changed (src/Generation.ts).
 */
import { isAbsolute, relative, resolve, sep } from "node:path"

export interface ToolPolicy {
  /** The folder the session works in; nothing outside it is written. */
  readonly root: string
  /** Whether a path, relative to `root` with `/` separators, may be written. */
  readonly writable: (relPath: string) => boolean
  /** Shell commands allowed, each matched against the whole command line. */
  readonly bash: ReadonlyArray<RegExp>
  /** Reads stay inside `root` too (the solver: so it can't go looking for the hidden tests). */
  readonly confineReads?: boolean | undefined
}

/** The tools a session has at all. No subagents, no web: a session works on its folder. */
export const TOOLS: ReadonlyArray<string> = ["Read", "Glob", "Grep", "Edit", "Write", "Bash"]

const READ_TOOLS = new Set(["Read", "Glob", "Grep"])
const WRITE_TOOLS = new Set(["Edit", "Write", "MultiEdit", "NotebookEdit"])

/** Chaining, substitution and redirection: a command with any of these is never on an allowlist. */
const SHELL_META = /[;&|`<>]|\$\(|\r|\n/

export type Decision =
  | { readonly behavior: "allow"; readonly updatedInput: Record<string, unknown> }
  | { readonly behavior: "deny"; readonly message: string }

const allow = (input: Record<string, unknown>): Decision => ({ behavior: "allow", updatedInput: input })
const deny = (message: string): Decision => ({ behavior: "deny", message })

/** `path` relative to `root` with `/` separators, or undefined when it's outside. */
export const inside = (root: string, path: string): string | undefined => {
  const rel = relative(resolve(root), resolve(root, path))
  if (rel === "" || rel.startsWith("..") || isAbsolute(rel)) return undefined
  return rel.split(sep).join("/")
}

const within = (root: string, path: string): boolean =>
  resolve(root, path) === resolve(root) || inside(root, path) !== undefined

export const decide = (policy: ToolPolicy, tool: string, input: Record<string, unknown>): Decision => {
  if (READ_TOOLS.has(tool)) {
    if (!policy.confineReads) return allow(input)
    const target = input["file_path"] ?? input["path"] ?? "."
    if (typeof target !== "string" || !within(policy.root, target)) return deny(`read only inside ${policy.root}`)
    return allow(input)
  }
  if (WRITE_TOOLS.has(tool)) {
    const target = input["file_path"] ?? input["notebook_path"]
    if (typeof target !== "string") return deny(`${tool} needs a file path`)
    const rel = inside(policy.root, target)
    if (rel === undefined) return deny(`${target} is outside ${policy.root}; write only inside it`)
    if (!policy.writable(rel)) return deny(`${rel} is read-only in this session`)
    return allow(input)
  }
  if (tool === "Bash") {
    const command = typeof input["command"] === "string" ? input["command"].trim() : ""
    if (SHELL_META.test(command)) return deny("run one command at a time, with no pipes, chaining or redirection")
    if (policy.bash.some((re) => re.test(command))) return allow(input)
    return deny(`\`${command}\` isn't allowed here. Allowed: ${policy.bash.map((re) => re.source).join(", ")}`)
  }
  return deny(`${tool} isn't available in this session`)
}

/**
 * The solver on a task: writes anywhere in its folder, runs node on files.
 * (`node` runs any code, so this narrows what the model reaches for; it is
 * not a sandbox. Run benchmarks on a machine you'd let an agent use.)
 */
export const solverPolicy = (root: string): ToolPolicy => ({
  root,
  writable: () => true,
  bash: [/^node( [\w./\\=:-]+)+$/, /^ls( [\w./\\-]+)*$/],
  confineReads: true
})

const READ_GIT = /^git (status|diff|log|show)( [^\s]+)*$/

/** Reading singularity's memory: `singularity recall "<task>"` or `singularity changes`. */
export const READ_MEMORY = /^singularity (recall|changes)( .+)?$/

/** A command that only reads memory, so any session may run it without asking. */
export const isMemoryRead = (command: unknown): boolean =>
  typeof command === "string" && !SHELL_META.test(command.trim()) && READ_MEMORY.test(command.trim())

/**
 * The solver on a real repo (`zero solve`): writes anywhere in it but `.git`,
 * runs the project's own scripts and node, reads memory, and commits.
 */
export const repoPolicy = (root: string): ToolPolicy => ({
  root,
  writable: (rel) => rel !== ".git" && !rel.startsWith(".git/"),
  bash: [
    /^(npm|pnpm|yarn|bun) (test|run [\w:.-]+|install|ci)( [^\s]+)*$/,
    /^(npx|bunx) (tsc|vitest|eslint|prettier)( [^\s]+)*$/,
    /^node( [\w./\\=:-]+)+$/,
    /^ls( [\w./\\-]+)*$/,
    READ_GIT,
    /^git add( [^\s]+)+$/,
    /^git commit -m "[^"$\\`]+"$/,
    READ_MEMORY
  ]
})

/**
 * The improver on zero's own repo: writes only the genome, runs the checks,
 * and reads history and memory. It never commits; zero commits a change
 * that won (src/Generation.ts).
 */
export const improverPolicy = (root: string): ToolPolicy => ({
  root,
  writable: (rel) => rel.startsWith("genome/"),
  bash: [/^npm run typecheck$/, /^npm test$/, READ_GIT, READ_MEMORY]
})
