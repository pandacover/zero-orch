/**
 * Child processes: git, singularity, a benchmark check, and the next
 * generation of zero itself.
 *
 * On timeout or interruption the process's scope closes and the Node spawner
 * kills the whole process tree, so nothing a generation starts outlives it.
 */
import { Duration, Effect, Option, Stream } from "effect"
import { ChildProcess, ChildProcessSpawner } from "effect/process"
import { existsSync } from "node:fs"
import { homedir } from "node:os"
import { join } from "node:path"

export interface ProcResult {
  /** Undefined when the process timed out. */
  readonly exitCode: number | undefined
  readonly timedOut: boolean
  readonly durationS: number
  readonly stdout: string
  readonly stderr: string
}

export const procOk = (r: ProcResult): boolean => r.exitCode === 0 && !r.timedOut

export interface RunOptions {
  readonly cwd: string
  readonly timeoutS: number
  /** Variables added to (or, when undefined, removed from) this process's environment. */
  readonly env?: Readonly<Record<string, string | undefined>> | undefined
  /** Written to stdin, which is then closed. */
  readonly input?: string | undefined
  /** Copy the child's output to ours as it arrives, for long runs a person watches. */
  readonly inherit?: boolean | undefined
}

/**
 * Variables a parent Claude Code session sets for its children. Dropping them
 * makes an Agent SDK run behave like a fresh launch from a terminal, wherever
 * zero itself runs; CLAUDE_EFFORT in particular would override the genome's effort.
 */
export const SESSION_VARS: ReadonlyArray<string> = [
  "CLAUDECODE",
  "CLAUDE_PID",
  "CLAUDE_EFFORT",
  "CLAUDE_AGENT_SDK_VERSION",
  "CLAUDE_CODE_CHILD_SESSION",
  "CLAUDE_CODE_ENTRYPOINT",
  "CLAUDE_CODE_EXECPATH",
  "CLAUDE_CODE_MESSAGING_SOCKET",
  "CLAUDE_CODE_MESSAGING_TOKEN",
  "CLAUDE_CODE_SESSION_ATTENDED",
  "CLAUDE_CODE_SESSION_ID"
]

/** This process's environment without a parent Claude Code session's variables, plus `extra`. */
export const cleanEnv = (extra: Readonly<Record<string, string | undefined>> = {}): Record<string, string> => {
  const env: Record<string, string> = {}
  for (const [k, v] of Object.entries({ ...process.env, ...extra })) {
    if (v !== undefined && !SESSION_VARS.includes(k)) env[k] = v
  }
  return env
}

/**
 * `cleanEnv` for a child that runs `command`. In the desktop app `process.execPath` is
 * Electron, and ELECTRON_RUN_AS_NODE makes it act as Node; any other child is left alone.
 */
export const envFor = (command: string, extra: Readonly<Record<string, string | undefined>> = {}): Record<string, string> =>
  cleanEnv(command === process.execPath && process.versions.electron ? { ...extra, ELECTRON_RUN_AS_NODE: "1" } : extra)

/** Run `command` with `args`, no shell. */
export const runProcess = Effect.fn("Proc.run")(function*(
  command: string,
  args: ReadonlyArray<string>,
  options: RunOptions
) {
  const spawner = yield* ChildProcessSpawner.ChildProcessSpawner
  const stdout: Array<Uint8Array> = []
  const stderr: Array<Uint8Array> = []
  const started = performance.now()
  const collect = (into: Array<Uint8Array>, echo: NodeJS.WriteStream) => (chunk: Uint8Array) =>
    Effect.sync(() => {
      into.push(chunk)
      if (options.inherit) echo.write(chunk)
    })
  const exitCode = yield* Effect.scoped(
    Effect.gen(function*() {
      const handle = yield* spawner.spawn(ChildProcess.make(command, args, {
        cwd: options.cwd,
        env: envFor(command, options.env),
        extendEnv: false,
        stdin: options.input === undefined ? "ignore" : Stream.make(new TextEncoder().encode(options.input))
      }))
      const [, , code] = yield* Effect.all(
        [
          Stream.runForEach(handle.stdout, collect(stdout, process.stdout)),
          Stream.runForEach(handle.stderr, collect(stderr, process.stderr)),
          handle.exitCode
        ],
        { concurrency: "unbounded" }
      )
      return code as number
    })
  ).pipe(Effect.timeoutOption(Duration.seconds(options.timeoutS)))
  return {
    exitCode: Option.getOrUndefined(exitCode),
    timedOut: Option.isNone(exitCode),
    durationS: (performance.now() - started) / 1000,
    stdout: decode(stdout),
    stderr: decode(stderr)
  } satisfies ProcResult
})

const decode = (chunks: ReadonlyArray<Uint8Array>): string => {
  const decoder = new TextDecoder()
  return chunks.map((c) => decoder.decode(c, { stream: true })).join("") + decoder.decode()
}

/** The last `n` characters of some output, for prompts and error lines. */
export const tail = (text: string, n = 2000): string => (text.length <= n ? text : `…${text.slice(-n)}`)

/**
 * How to start singularity without a shell. `ZERO_SINGULARITY` names the
 * command; otherwise the CLI an install put in ~/.singularity runs under this
 * Node (Windows can't spawn its `.cmd` shim without a shell); otherwise the
 * `singularity` on PATH.
 */
export const singularityCommand = (): readonly [string, ReadonlyArray<string>] => {
  const named = process.env["ZERO_SINGULARITY"]
  if (named !== undefined && named !== "") return [named, []]
  const cli = join(singularityApp(), "singularity.ts")
  if (existsSync(cli)) return [process.execPath, [cli]]
  return ["singularity", []]
}

/** singularity's home: its install, config and memory (`SINGULARITY_HOME`, else ~/.singularity). */
export const singularityHome = (): string => process.env["SINGULARITY_HOME"] || join(homedir(), ".singularity")

/** Where an install keeps singularity's CLI sources (apps/cli/src). */
const singularityApp = () => join(singularityHome(), "app", "apps", "cli", "src")

/**
 * singularity's hook script, the one its setup gives Claude Code: the hand-over at a task's start
 * and the notes on `git show`. `ZERO_SINGULARITY_HOOK` names it; otherwise an install's; otherwise
 * none, and zero falls back to `recall`.
 */
export const singularityHook = (): string | undefined => {
  const named = process.env["ZERO_SINGULARITY_HOOK"]
  if (named !== undefined && named !== "") return named
  const script = join(singularityApp(), "workflows", "hook.ts")
  return existsSync(script) ? script : undefined
}
