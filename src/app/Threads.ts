/**
 * Threads: a conversation with one provider, in one project.
 *
 * A turn: the person's message goes in; in a git project, singularity hands over
 * the past change there most like it (each message is a task start); the
 * provider streams text and tool calls, which become the thread's items; a
 * tool call that needs approval becomes a card the person answers; when the
 * turn ends, if it committed, `singularity store` keeps that commit for the
 * next thread to recall. Every change is sent to open pages as it happens.
 */
import { Effect, FileSystem, Option, Path, Stream } from "effect"
import { ChildProcessSpawner } from "effect/process"
import { existsSync } from "node:fs"
import { basename, join } from "node:path"
import { type Attachment, plainText, promptText } from "./Attachments.ts"
import { createWorktree, listBranches, slug } from "./Branches.ts"
import { loadGenome, solverPrompt } from "../Genome.ts"
import { git, head } from "../Git.ts"
import { type HandOver, Memory, MEMORY_NOTE, toolNotes } from "../Singularity.ts"
import type { Access, Item, Project, ProviderId, Settings, Thread, UsageLimit } from "./Model.ts"
import { atMost, isCompact, isEffortFor, metaOf, newId, titleFrom } from "./Model.ts"
import { type Provider, type ThreadTools, turnStream, type Verdict } from "./providers/Provider.ts"
import { claude, claudeModels, nameThread } from "./providers/Claude.ts"
import { codex } from "./providers/Codex.ts"
import { ollama } from "./providers/Ollama.ts"
import { Store } from "./Store.ts"

export const PROVIDERS: Record<ProviderId, Provider> = { claude, codex, ollama }

export interface Hub {
  send(event: string, data: unknown): void
}

interface Pending {
  readonly done: (verdict: Verdict) => void
  /** What the thread's access makes of the call now. */
  readonly recheck?: (() => "allow" | "deny" | "ask") | undefined
}

interface Live {
  readonly abort: AbortController
  readonly asks: Map<string, Pending>
  /** The person pressed Deny in this turn: an agent stopping after that is doing as told. */
  declined?: boolean
}

const now = () => new Date().toISOString()

/** The commit subject from a recall's text: `committed as abc123: "Subject"`. */
/**
 * One turn's cost. A provider that reports its session's running total (the
 * Agent SDK, when a thread is resumed) is charged only the difference from
 * the total after the last turn. (Dogfooding found a thread's third turn,
 * 38 seconds long, recorded at $4.03: every earlier turn counted again.)
 */
export const turnCost = (reported: number | null, cumulative: boolean, before: number): number | null =>
  reported === null ? null : cumulative ? Math.max(0, reported - before) : reported

/**
 * Streamed text, held back until a line is complete: `push` returns the
 * whole lines that are ready (or ""), `flush` what's left when the text ends.
 */
export const lineBuffer = () => {
  let tail = ""
  return {
    push: (delta: string): string => {
      tail += delta
      const cut = tail.lastIndexOf("\n")
      if (cut < 0) return ""
      const ready = tail.slice(0, cut + 1)
      tail = tail.slice(cut + 1)
      return ready
    },
    flush: (): string => {
      const rest = tail
      tail = ""
      return rest
    }
  }
}

/** Settings with a thread's own effort in place of its provider's default. */
export const withEffort = (settings: Settings, provider: ProviderId, effort: string | undefined): Settings => {
  if (!effort || !isEffortFor(provider, effort)) return settings
  if (provider === "claude") return { ...settings, claude: { ...settings.claude, effort: effort as Settings["claude"]["effort"] } }
  if (provider === "codex") return { ...settings, codex: { ...settings.codex, effort: effort as Settings["codex"]["effort"] } }
  return settings
}

/** How singularity heads a hand-over's pointer, and its card of check scripts (its scripts/Render.ts). */
const LIKE_HEADER = "# A past change in this repository like your task"
const CARD_HEADER = "# Check scripts earlier sessions here ran"

/** The session singularity keeps a thread's hand-overs under, whichever provider runs it. */
export const memorySession = (t: { readonly id: string }): string => `zero-${t.id}`

/**
 * Told to every agent, every turn, whichever provider: an error from a tool is not the person
 * saying no. (An agent that took a dropped approval for a refusal ended its turn mid-edit,
 * silent, with the project left broken.)
 */
export const TOOL_FAILURE_NOTE = [
  "# When a tool call fails",
  "",
  "A tool call that errors (a timeout, a dropped connection, a crash, an approval that couldn't be asked) is not",
  "the person saying no. Only a result that says the person declined is a no. When a call errors, check whether it",
  "took effect, retry it once if it didn't, and carry on. If it still fails, don't end your turn silently: say what",
  "is done, what isn't, and anything you left broken."
].join("\n")

/** What a tool card says when the turn was stopped while it ran: the stop ended it, it didn't end the turn. */
export const STOPPED_NOTE = "(The turn was stopped while this call ran: the stop ended the call, not the other way round.)"
export const cutShort = (output: string): string => (output.includes(STOPPED_NOTE) ? output : [output.trim(), STOPPED_NOTE].filter(Boolean).join("\n"))

/** What an agent wrote after its last failed tool call before it may end the turn, at least. */
const REPORT_MIN = 200

/**
 * The failed tool call a turn stopped on, if it did: the turn's last tool call failed, the
 * person didn't decline anything, and the agent said next to nothing after it. `items` are
 * the turn's own, in order. (A short "No response requested." after a failed edit is a stall;
 * a paragraph saying what broke is a report.)
 */
export const stalledOn = (items: ReadonlyArray<Item>, declined: boolean): (Item & { kind: "tool" }) | undefined => {
  if (declined) return undefined
  let last = -1
  for (let i = items.length - 1; i >= 0; i--) if (items[i]!.kind === "tool") { last = i; break }
  const tool = items[last]
  if (!tool || tool.kind !== "tool" || tool.status !== "failed") return undefined
  const after = items.slice(last + 1)
  if (after.some((i) => i.kind === "permission" && i.state === "denied")) return undefined
  const said = after.reduce((n, i) => n + (i.kind === "assistant" ? i.text.trim().length : 0), 0)
  return said < REPORT_MIN ? tool : undefined
}

/** zero's follow-up to an agent that stopped on a failed call: from zero, not the person. */
export const followUp = (tool: Item & { kind: "tool" }): string => {
  const why = tool.output.trim().replace(/\s+/g, " ").slice(0, 400) || "no output"
  return [
    "(From zero, which runs this thread, not from the person.)",
    `Your turn ended right after a tool call failed: ${tool.name} ${tool.detail} -> ${why}`,
    "That error came from the tool, not from the person. Check whether the call took effect, retry it once if it",
    "didn't, and carry on with the task. If you can't finish, say plainly what is done, what isn't, and anything left broken."
  ].join("\n")
}

/** The folder a thread works in: its worktree, else its project's. */
export const dirOf = (t: { readonly cwd?: string | undefined }, project: Project): string => t.cwd ?? project.path

/** Where the worktrees of a project's threads go: `<root>/<project>-<id>/<branch>`. */
export const worktreeRoot = (home: string, project: Project): string => join(home, "worktrees", `${slug(project.name)}-${project.id.slice(-6)}`)

/** How deep threads may start threads: a thread the person started, and two levels under it. */
export const MAX_DEPTH = 2
/** How long a wait for another thread lasts unless the agent says. */
const WAIT_S = 600
/** Most of a reply an agent reads back from another thread. */
const REPLY_MAX = 24_000

/** Told to a thread another thread's agent started: who's talking to it, and who reads its answer. */
export const childNote = (parent: string) => [
  "# Started by another thread",
  "",
  `This thread was started by the agent in another zero thread ("${parent}"). Its messages here come from that agent,`,
  "not from the person, though the person can read this thread and answer its approvals. Work the task through,",
  "then end your turn with a reply that stands on its own: that agent reads only your last message."
].join("\n")

/** What a thread said in its last turn: its text after the last message it was sent, and how the turn ended. */
export const lastReply = (t: Thread): { text: string; outcome: string; error: string } => {
  let from = -1
  for (let i = t.items.length - 1; i >= 0; i--) if (t.items[i]!.kind === "user") { from = i; break }
  const after = t.items.slice(from + 1)
  const said = after.flatMap((i) => (i.kind === "assistant" ? [i.text.trim()] : [])).filter(Boolean)
  const end = after.findLast((i) => i.kind === "turn")
  // Its last message is its answer; the narration between tool calls before it is kept only when it's short.
  const text = said.join("\n\n").length <= REPLY_MAX ? said.join("\n\n") : `…${said.at(-1)!.slice(-REPLY_MAX)}`
  return { text, outcome: end?.kind === "turn" ? end.outcome : "", error: end?.kind === "turn" ? end.error : "" }
}

export const recalledTitle = (text: string): string => /committed as \w+: "([^"]+)"/.exec(text)?.[1] ?? "a past change"

/** Why a provider won't take `/compact` in this thread, or "" when it will. */
export const cantCompact = (provider: Provider, resume: string | null): string =>
  provider.compaction === "auto"
    ? `${provider.label} compacts its context on its own when it fills; its SDK takes no /compact.`
    : provider.compaction === "none"
    ? `${provider.label} keeps no session to compact: each turn sends it the thread as it is.`
    : resume === null
    ? "Nothing to compact yet: this thread has no session."
    : ""

export const makeThreads = (options: {
  readonly zeroRoot: string
  readonly hub: Hub
  /** Names a thread from its first message with a small model; "" keeps the first line. */
  readonly nameThread?: ((message: string, model: string) => Promise<string>) | undefined
}) =>
  Effect.gen(function*() {
    const store = yield* Store
    // What a turn runs with, kept so a thread's agent can start another thread's turn from a tool call.
    const services = yield* Effect.context<Memory | ChildProcessSpawner.ChildProcessSpawner | FileSystem.FileSystem | Path.Path>()
    const live = new Map<string, Live>()
    /** Threads whose turn was asked for and hasn't set itself up yet: they count as working. */
    const starting = new Set<string>()
    /** Who's waiting for a thread's turn to end. */
    const waiters = new Map<string, Set<() => void>>()
    const busy = (id: string) => live.has(id) || starting.has(id)
    const settle = (id: string) => {
      const ws = waiters.get(id)
      waiters.delete(id)
      for (const w of ws ?? []) w()
    }
    const { hub } = options
    const name = options.nameThread ?? nameThread
    /** The plan's usage windows as the provider last reported them, by kind: the composer's meter shows them. */
    const limits = new Map<string, UsageLimit>()

    const touch = (t: Thread) => {
      t.updatedAt = now()
      hub.send("thread", metaOf(t))
    }
    const put = (t: Thread, item: Item, soon = true) => {
      const i = t.items.findIndex((x) => x.id === item.id)
      if (i >= 0) t.items[i] = item
      else t.items.push(item)
      hub.send("item", { threadId: t.id, item })
      store.saveThread(t, soon)
    }

    const create = (
      project: Project,
      input: { provider?: ProviderId; model?: string; access?: Access; effort?: string; title?: string; cwd?: string; parentId?: string; branch?: string }
    ) => {
      const settings = store.settings()
      const provider = input.provider ?? settings.defaultProvider
      const thread: Thread = {
        id: newId("t"),
        projectId: project.id,
        title: input.title?.trim().slice(0, 120) || "New thread",
        provider,
        model: input.model || PROVIDERS[provider].defaultModel(settings),
        access: input.access ?? settings.defaultAccess,
        ...(isEffortFor(provider, input.effort) ? { effort: input.effort } : {}),
        ...(input.cwd ? { cwd: input.cwd } : {}),
        ...(input.parentId ? { parentId: input.parentId } : {}),
        ...(input.branch ? { branch: input.branch } : {}),
        status: "idle",
        resume: null,
        createdAt: now(),
        updatedAt: now(),
        items: []
      }
      store.createThread(thread)
      hub.send("thread", metaOf(thread))
      return thread
    }

    /** Change a thread's provider, model, access or effort. A new provider starts a new session. */
    /** `effort: ""` goes back to following the settings. */
    const update = (t: Thread, patch: { title?: string; provider?: ProviderId; model?: string; access?: Access; effort?: string; pinned?: boolean; seen?: boolean }) => {
      if (patch.provider && patch.provider !== t.provider) {
        t.provider = patch.provider
        t.resume = null
        t.sessionCostUsd = 0
        delete t.context
        t.model = patch.model || PROVIDERS[patch.provider].defaultModel(store.settings())
        // An effort the new provider doesn't know goes back to its default.
        if (t.effort && !isEffortFor(t.provider, t.effort)) delete t.effort
      } else if (patch.model) {
        t.model = patch.model
      }
      if (patch.effort === "") delete t.effort
      else if (isEffortFor(t.provider, patch.effort)) t.effort = patch.effort
      if (patch.access && patch.access !== t.access) {
        t.access = patch.access
        // A running turn reads the access at each call; a request already waiting is answered
        // now if the new access settles it (auto-edit allows an edit, read-only denies it).
        for (const p of [...(live.get(t.id)?.asks.values() ?? [])]) {
          const verdict = p.recheck?.()
          if (verdict === "allow") p.done("allowed")
          else if (verdict === "deny") p.done("refused")
        }
      }
      if (patch.title?.trim()) t.title = patch.title.trim().slice(0, 120)
      if (patch.pinned === true) t.pinned = true
      else if (patch.pinned === false) delete t.pinned
      // The person opened the thread: the turn that ended is seen.
      if (patch.seen === true) delete t.unseen
      // Pinning and looking aren't activity: the thread keeps its age, so unpinning puts it back where it was.
      const onlyPin = Object.keys(patch).every((k) => k === "pinned" || k === "seen")
      if (onlyPin) hub.send("thread", metaOf(t))
      else touch(t)
      store.saveThread(t)
    }

    /**
     * Work in another folder from the next turn: a worktree, or (undefined) the project's own. A
     * provider's session belongs to the folder it ran in (Claude Code keeps it under that path), so
     * the thread starts a new one there; its messages stay on the thread.
     */
    const moveTo = (t: Thread, cwd: string | undefined, branch: string) => {
      if (cwd !== t.cwd) {
        if (cwd) t.cwd = cwd
        else delete t.cwd
        t.resume = null
        t.sessionCostUsd = 0
        delete t.context
        delete t.taskHead
      }
      if (branch) t.branch = branch
      touch(t)
      store.saveThread(t)
    }

    const ask = (t: Thread, l: Live) => (tool: string, detail: string, recheck?: () => "allow" | "deny" | "ask"): Promise<Verdict> =>
      new Promise((resolve) => {
        const item: Item = { kind: "permission", id: newId("ask"), at: now(), tool, detail, state: "pending" }
        put(t, item, false)
        const done = (verdict: Verdict) => {
          if (!l.asks.has(item.id)) return
          l.asks.delete(item.id)
          item.state = verdict === "allowed" ? "allowed" : "denied"
          if (verdict === "declined") l.declined = true
          put(t, item, false)
          resolve(verdict)
        }
        l.asks.set(item.id, { done, recheck })
        l.abort.signal.addEventListener("abort", () => l.asks.has(item.id) && done("stopped"), { once: true })
      })

    /**
     * One turn, start to end. Never fails: what goes wrong ends up on the thread.
     *
     * With `compactFirst` (the person left Compact on when the context was filling), the provider
     * compacts its session first while the message waits in `queued`; then the message runs.
     */
    const turn = (
      t: Thread,
      project: Project,
      text: string,
      attachments: ReadonlyArray<Attachment> = [],
      opts: { readonly compactFirst?: boolean; readonly from?: { readonly threadId: string; readonly title: string } } = {}
    ) =>
      Effect.gen(function*() {
        const memory = yield* Memory
        // A thread's own effort wins over the settings' default.
        const settings = withEffort(store.settings(), t.provider, t.effort)
        const provider = PROVIDERS[t.provider]
        const l: Live = { abort: new AbortController(), asks: new Map() }
        live.set(t.id, l)
        starting.delete(t.id)
        const started = Date.now()
        // The thread's worktree, else the project's folder: where the agent works, and whose git counts.
        const cwd = dirOf(t, project)
        const firstTurn = !t.items.some((i) => i.kind === "user")
        const history = t.items.flatMap((i): Array<{ role: "user" | "assistant"; text: string }> =>
          i.kind === "user"
            ? [{ role: "user", text: promptText(i.text, i.attachments) }]
            : i.kind === "assistant"
            ? [{ role: "assistant", text: i.text }]
            : []
        )
        // The words alone, each file named where its marker was: for the title and memory recall.
        const words = plainText(text, attachments)
        // `/compact`: the provider's own compaction of its session, not a task.
        const compact = isCompact(text)
        const compactFirst = opts.compactFirst === true && !compact && cantCompact(provider, t.resume) === ""

        let compaction: (Item & { kind: "compact" }) | undefined
        let costUsd: number | null = null
        let tokens: number | null = null
        const texts = new Map<string, Item & { kind: "assistant" }>()
        // Text reaches the page a whole line at a time, not token by token.
        const held = new Map<string, ReturnType<typeof lineBuffer>>()
        const release = (key: string, chunk: string) => {
          if (!chunk) return
          const known = texts.get(key)
          if (known) {
            known.text += chunk
            hub.send("delta", { threadId: t.id, itemId: known.id, delta: chunk })
            store.saveThread(t, true)
          } else {
            const item = { kind: "assistant" as const, id: newId("a"), at: now(), text: chunk }
            texts.set(key, item)
            put(t, item)
          }
        }
        const flushText = (except?: string) => {
          for (const [key, buffer] of held) if (key !== except) release(key, buffer.flush())
        }
        /** Show a compaction we're starting right away; the provider's own events fill it in. */
        const startCompaction = () => {
          compaction = { kind: "compact", id: newId("c"), at: now(), trigger: "manual", state: "running", preTokens: t.context?.used ?? null, postTokens: null, durationMs: null, summary: "", error: "" }
          put(t, compaction, false)
        }
        /** One prompt to the provider, its events onto the thread; how it ended. */
        // A thread can start threads of its own, down to MAX_DEPTH; only a provider that takes tools uses them.
        const tools = !compact && depthOf(t) < MAX_DEPTH ? threadTools(t, project, l) : undefined
        const run = (prompt: string, instructions: string, remembers: boolean) =>
          turnStream(provider, {
            cwd,
            ...(tools && !prompt.startsWith("/compact") ? { threads: tools } : {}),
            prompt,
            history,
            model: t.model,
            resume: t.resume,
            instructions,
            access: () => t.access,
            settings,
            ask: ask(t, l),
            signal: l.abort.signal,
            // singularity's notes on a stored commit the agent reads with `git show` or `git log`.
            ...(remembers
              ? {
                afterTool: toolNotes(memory, memorySession(t))
              }
              : {})
          }).pipe(
            Stream.runForEach((e) =>
              Effect.sync(() => {
                if (e.type === "session") {
                  if (t.resume !== e.resume) {
                    // A different session (the old one couldn't be resumed) starts its running total at zero.
                    t.sessionCostUsd = 0
                    t.resume = e.resume
                    store.saveThread(t, true)
                  }
                } else if (e.type === "text") {
                  flushText(e.key)
                  let buffer = held.get(e.key)
                  if (!buffer) held.set(e.key, buffer = lineBuffer())
                  release(e.key, buffer.push(e.delta))
                } else if (e.type === "compact") {
                  flushText()
                  // One card per compaction: its start, then how it ended.
                  const open = compaction?.state === "running" ? compaction : undefined
                  compaction = {
                    kind: "compact",
                    id: open?.id ?? newId("c"),
                    at: open?.at ?? now(),
                    trigger: e.trigger,
                    state: e.state,
                    // Until the provider says, how full the context was after the last turn.
                    preTokens: e.preTokens ?? open?.preTokens ?? t.context?.used ?? null,
                    postTokens: e.postTokens ?? null,
                    durationMs: e.durationMs ?? (e.state === "running" ? null : Date.now() - Date.parse(open?.at ?? now())),
                    summary: e.summary ?? "",
                    error: e.error ?? ""
                  }
                  put(t, compaction, false)
                } else if (e.type === "tool") {
                  flushText()
                  // A call that fails once the turn is stopped failed because of the stop (Claude's "Stream closed"),
                  // not the other way round: its card says so.
                  const output = e.status === "failed" && l.abort.signal.aborted ? cutShort(e.output ?? "") : e.output ?? ""
                  put(t, { kind: "tool", id: `tool_${e.key}`, at: now(), name: e.name, detail: e.detail, status: e.status, output })
                } else if (e.type === "limit") {
                  limits.set(e.limit.kind, e.limit)
                  hub.send("limits", [...limits.values()])
                } else if (e.type === "context") {
                  t.context = { used: e.used, limit: e.limit }
                  hub.send("thread", metaOf(t))
                } else {
                  flushText()
                  const cost = turnCost(e.costUsd, e.cumulative === true, t.sessionCostUsd ?? 0)
                  if (cost !== null) costUsd = (costUsd ?? 0) + cost
                  if (e.cumulative && e.costUsd !== null) t.sessionCostUsd = e.costUsd
                  if (e.tokens !== null) tokens = (tokens ?? 0) + e.tokens
                }
              })
            ),
            Effect.as({ outcome: "done" as "done" | "stopped" | "failed", error: "" }),
            Effect.catchTag("ProviderError", (e) =>
              Effect.succeed(l.abort.signal.aborted ? { outcome: "stopped" as const, error: "" } : { outcome: "failed" as const, error: e.message })
            ),
            Effect.tap(() => Effect.sync(() => flushText()))
          )

        if (compactFirst) {
          // The message waits, shown as queued, while the session compacts.
          t.queued = words.trim() || "Your message"
          t.status = "running"
          delete t.unseen
          touch(t)
          startCompaction()
          yield* run("/compact", "", false)
          // A compaction that ended without saying so is over either way.
          if (compaction?.state === "running") put(t, { ...compaction, state: l.abort.signal.aborted ? "failed" : "done" })
          compaction = undefined
          delete t.queued
        }

        put(t, { kind: "user", id: newId("u"), at: now(), text, ...(attachments.length ? { attachments } : {}), ...(opts.from ? { from: opts.from } : {}) }, false)
        const refused = compact
          ? cantCompact(provider, t.resume)
          : t.cwd && !existsSync(t.cwd)
          ? `This thread's worktree is gone (${t.cwd}). Pick a branch for it in the composer.`
          : ""
        if (refused) {
          put(t, { kind: "turn", id: newId("end"), at: now(), provider: t.provider, model: t.model, durationMs: 0, costUsd: null, tokens: null, outcome: "failed", error: refused }, false)
          t.unseen = "failed"
          live.delete(t.id)
          touch(t)
          store.saveThread(t)
          settle(t.id)
          return
        }
        // A title given when the thread was made (another thread's agent named it) stands.
        if (firstTurn && !compact && t.title === "New thread") {
          const placeholder = titleFrom(words)
          t.title = placeholder
          // A small model names the thread meanwhile; the first line stands until it answers, or if it can't.
          if (settings.titles.auto && settings.claude.enabled && words.trim()) {
            name(words, settings.titles.model).then((title) => {
              // Not over a name the person gave it meanwhile, and not into a thread since deleted.
              if (!title || t.title !== placeholder || store.thread(t.id) !== t) return
              t.title = title
              hub.send("thread", metaOf(t))
              store.saveThread(t, t.status === "running")
            }, () => {})
          }
        }
        t.status = "running"
        delete t.unseen
        touch(t)

        const before = yield* head(cwd).pipe(Effect.option)
        // singularity keeps memory per git repo, and the person may turn recall off.
        const remembers = settings.memory.recall && Option.isSome(before) && !compact
        let prompt = compact ? text.trim() : promptText(text, attachments)
        if (remembers && !l.abort.signal.aborted && Option.isSome(before)) {
          // A hand-over only where a task starts: the thread's first request, and the first after a commit,
          // as singularity's own hook does in Claude Code. A follow-up adds nothing, so it costs no tokens.
          const startsTask = t.taskHead !== before.value
          t.taskHead = before.value
          const handed = new Set(t.items.flatMap((i) => (i.kind === "memory" && i.action === "recalled" && i.commit ? [i.commit] : [])))
          const asked = yield* memory.handOver({ session: memorySession(t), prompt: words, cwd, startsTask }).pipe(
            Effect.match({
              onFailure: (e) => ({ handOver: Option.none<HandOver>(), searched: false, failed: e.message }),
              onSuccess: (answer) => ({ ...answer, failed: "" })
            })
          )
          const h = Option.getOrUndefined(asked.handOver)
          if (h && h.commit !== null && handed.has(h.commit) && h.text.trim().startsWith(LIKE_HEADER) && !h.text.includes(CARD_HEADER)) {
            // The agent already has this one from earlier in the thread: point at it, don't hand it over twice.
            put(t, { kind: "memory", id: newId("m"), at: now(), action: "checked", commit: h.commit, title: `the same past change as earlier in this thread: ${recalledTitle(h.text)}` })
          } else if (h) {
            const title = h.commit !== null ? recalledTitle(h.text) : "check scripts earlier sessions here ran"
            put(t, { kind: "memory", id: newId("m"), at: now(), action: "recalled", commit: h.commit ?? "", title, text: h.text })
            prompt = `${prompt}\n\n${h.text}`
          } else if (asked.failed || asked.searched) {
            // The thread shows what came of a search either way, so a miss or a failure isn't silent. A message
            // singularity didn't search for ("commit and push", "hi", a follow-up) gets nothing, as in Claude Code:
            // "nothing stored is like this task" would claim a search that never ran.
            put(t, {
              kind: "memory",
              id: newId("m"),
              at: now(),
              action: "checked",
              commit: "",
              title: asked.failed ? `singularity didn't answer: ${asked.failed}` : "nothing stored in this repo is like this task yet"
            })
          }
        }
        const genome = settings.useGenome
          ? yield* loadGenome(options.zeroRoot).pipe(Effect.map(solverPrompt), Effect.orElseSucceed(() => ""))
          : ""
        // Every turn in a repo with memory is told what singularity is and how to recall mid-task.
        // A thread another thread's agent started is told so: that agent reads its last message back.
        const parent = t.parentId ? store.thread(t.parentId)?.title ?? opts.from?.title ?? "another thread" : ""
        const instructions = [genome, remembers ? MEMORY_NOTE : "", compact ? "" : TOOL_FAILURE_NOTE, parent && !compact ? childNote(parent) : ""]
          .filter((s) => s !== "").join("\n\n")

        if (compact && !l.abort.signal.aborted) startCompaction()
        const start = t.items.length
        // Stopped while the message was queued: it's on the thread, but doesn't run.
        let outcome = l.abort.signal.aborted ? { outcome: "stopped" as const, error: "" } : yield* run(prompt, instructions, remembers)
        // An agent that stopped on a failed call, without a word on where things stand, is sent on once,
        // by zero and saying so: not after a Stop, a Deny, or in a read-only thread, where stopping is right.
        const stuck = outcome.outcome === "done" && !compact && !l.abort.signal.aborted && t.access !== "read-only"
          ? stalledOn(t.items.slice(start), l.declined === true)
          : undefined
        if (stuck) {
          put(t, { kind: "followup", id: newId("f"), at: now(), reason: `${stuck.name} ${stuck.detail}`.trim() })
          outcome = yield* run(followUp(stuck), instructions, remembers)
        }
        const result = l.abort.signal.aborted && outcome.outcome === "done" ? { outcome: "stopped" as const, error: "" } : outcome
        // Tool calls (and a compaction) a stopped turn left running didn't finish.
        for (const i of t.items) {
          if (i.kind !== "tool" || i.status !== "running" || result.outcome === "done") continue
          put(t, { ...i, status: "failed", output: result.outcome === "stopped" ? cutShort(i.output) : i.output })
        }
        if (compaction?.state === "running") put(t, { ...compaction, state: result.outcome === "done" ? "done" : "failed" })

        // A commit this turn made: let singularity keep it.
        const after = yield* head(cwd).pipe(Effect.option)
        if (settings.memory.store && Option.isSome(before) && Option.isSome(after) && after.value !== before.value) {
          yield* memory.store(cwd).pipe(Effect.ignore)
          const stored = yield* memory.changes(cwd).pipe(Effect.orElseSucceed(() => []))
          const subject = yield* git(cwd, ["log", "-1", "--format=%s"]).pipe(Effect.map((s) => s.trim()), Effect.orElseSucceed(() => ""))
          const kept = stored.some((c) => c.commit === after.value)
          put(t, {
            kind: "memory",
            id: newId("m"),
            at: now(),
            action: kept ? "stored" : "none",
            commit: after.value,
            title: kept ? subject : `${subject} (not stored: singularity keeps a commit when a check passed before it)`
          })
        }

        put(t, {
          kind: "turn",
          id: newId("end"),
          at: now(),
          provider: t.provider,
          model: t.model,
          durationMs: Date.now() - started,
          costUsd,
          tokens,
          outcome: result.outcome,
          error: result.error
        }, false)
        // The branch the turn left the project on: the one the thread's Git panel follows (it may have made it).
        const branch = yield* git(cwd, ["branch", "--show-current"]).pipe(Effect.map((s) => s.trim()), Effect.orElseSucceed(() => ""))
        if (branch) t.branch = branch
        live.delete(t.id)
        t.status = "idle"
        // A turn the person stopped is one they saw end; one that finished or failed waits for them to look.
        if (result.outcome === "stopped") delete t.unseen
        else t.unseen = result.outcome
        touch(t)
        store.saveThread(t)
        settle(t.id)
      })

    /** How many threads up this one's line goes: 0 for a thread the person started. */
    const depthOf = (t: Thread): number => {
      let depth = 0
      const seen = new Set([t.id])
      for (let p = t.parentId; p && !seen.has(p); p = store.thread(p)?.parentId) {
        seen.add(p)
        depth++
      }
      return depth
    }

    /** A thread's turn, run on its own as the page's Send runs one; a wait sees the thread working from now. */
    const startTurn = (c: Thread, project: Project, text: string, from: { readonly threadId: string; readonly title: string }) => {
      starting.add(c.id)
      Effect.runForkWith(services)(turn(c, project, text, [], { from }).pipe(
        // A turn that died before its end leaves no one waiting on it for nothing.
        Effect.ensuring(Effect.sync(() => {
          starting.delete(c.id)
          if (!live.has(c.id)) settle(c.id)
        }))
      ))
    }

    /** Until a thread's turn ends ("idle"), the wait runs out, or the waiting turn is stopped. */
    const whenIdle = (id: string, ms: number, signal: AbortSignal): Promise<"idle" | "timeout" | "stopped"> =>
      new Promise((resolve) => {
        if (!busy(id)) return resolve("idle")
        if (signal.aborted) return resolve("stopped")
        const done = (how: "idle" | "timeout" | "stopped") => {
          clearTimeout(timer)
          signal.removeEventListener("abort", onAbort)
          waiters.get(id)?.delete(onIdle)
          resolve(how)
        }
        const onIdle = () => done("idle")
        const onAbort = () => done("stopped")
        const timer = setTimeout(() => done("timeout"), ms)
        let ws = waiters.get(id)
        if (!ws) waiters.set(id, ws = new Set())
        ws.add(onIdle)
        signal.addEventListener("abort", onAbort, { once: true })
      })

    /**
     * The tools a thread's agent has for other threads: start one (in a worktree of its own, if it
     * likes), message the ones it started, wait for their replies, list them. Each call shows on this
     * thread as a card linking to the other thread; the other thread shows who started it.
     */
    const threadTools = (parent: Thread, project: Project, l: Live): ThreadTools => {
      const from = () => ({ threadId: parent.id, title: parent.title })
      type Link = Item & { kind: "link" }
      // Not onto a thread deleted meanwhile: saving it would write it back.
      const show = (link: Link) => { if (store.thread(parent.id) === parent) put(parent, link) }
      const seconds = (s: number | undefined) => Math.min(3600, Math.max(10, Math.round(s ?? WAIT_S)))
      const childOf = (id: string): Thread => {
        const c = store.thread(id)
        if (!c || c.parentId !== parent.id) throw new Error(`${id} isn't a thread this one started; list_threads names those.`)
        return c
      }
      /** Wait for the thread, and say what came of it: on the card, and to the agent. */
      const report = async (id: string, link: Link, timeoutSeconds: number | undefined): Promise<string> => {
        const s = seconds(timeoutSeconds)
        const how = await whenIdle(id, s * 1000, l.abort.signal)
        const c = store.thread(id)
        if (how === "stopped") {
          show({ ...link, state: "failed", error: "Stopped waiting: this turn was stopped." })
          return "Stopped waiting: this turn was stopped. The other thread goes on."
        }
        if (!c) {
          show({ ...link, state: "failed", error: "The thread was deleted." })
          throw new Error(`Thread ${id} was deleted.`)
        }
        if (how === "timeout") {
          show({ ...link, title: c.title, state: "timeout" })
          return `Thread ${id} ("${c.title}") is still working after ${s}s. Call wait_for_thread again to keep waiting.`
        }
        const r = lastReply(c)
        const failed = r.outcome === "failed" || r.outcome === "stopped"
        show({ ...link, title: c.title, state: failed ? "failed" : "replied", reply: r.text, ...(r.error ? { error: r.error } : failed ? { error: `Its turn ${r.outcome === "stopped" ? "was stopped" : "failed"}.` } : {}) })
        const ended = failed ? ` (its turn ${r.outcome === "stopped" ? "was stopped" : `failed${r.error ? `: ${r.error}` : ""}`})` : ""
        return [`Thread ${id} ("${c.title}") finished its turn${ended}.`, r.text ? `Its reply:\n\n${r.text}` : "It said nothing."].join("\n\n")
      }
      return {
        start: async (a) => {
          if (depthOf(parent) + 1 > MAX_DEPTH) throw new Error("Threads started from threads can't start threads of their own here.")
          if (a.model && parent.provider === "claude" && !claudeModels().includes(a.model)) {
            throw new Error(`There's no model ${a.model} here. Models: ${claudeModels().join(", ")}`)
          }
          let cwd = parent.cwd
          let branch: string | undefined
          if (a.worktree) {
            const repo = dirOf(parent, project)
            const base = a.worktree.base?.trim() || (await listBranches(repo)).base
            if (!base) throw new Error("This project isn't a git repository, so a thread can't get a worktree.")
            const wt = await createWorktree(repo, { base, branch: a.worktree.branch ?? "", root: worktreeRoot(store.home, project) })
            if (!wt.ok) throw new Error(`Couldn't make the worktree: ${wt.error}`)
            cwd = wt.path
            branch = wt.branch
          }
          const c = create(project, {
            provider: parent.provider,
            model: a.model || parent.model,
            access: atMost(a.access ?? parent.access, parent.access),
            ...(parent.effort ? { effort: parent.effort } : {}),
            ...(a.title ? { title: a.title } : {}),
            ...(cwd ? { cwd } : {}),
            ...(branch ? { branch } : {}),
            parentId: parent.id
          })
          const link: Link = { kind: "link", id: newId("l"), at: now(), threadId: c.id, title: c.title, action: "started", state: a.wait ? "waiting" : "sent", text: a.prompt }
          show(link)
          startTurn(c, project, a.prompt, from())
          const where = branch ? ` in a worktree on the new branch ${branch} (${cwd})` : ""
          if (!a.wait) return `Started thread ${c.id}${where}. It works on its own: call wait_for_thread with its id for its reply.`
          return report(c.id, link, a.timeoutSeconds)
        },
        message: async (a) => {
          const c = childOf(a.threadId)
          if (busy(c.id)) throw new Error(`Thread ${c.id} is still working. Call wait_for_thread first, then message it.`)
          const link: Link = { kind: "link", id: newId("l"), at: now(), threadId: c.id, title: c.title, action: "messaged", state: a.wait ? "waiting" : "sent", text: a.text }
          show(link)
          startTurn(c, project, a.text, from())
          if (!a.wait) return `Sent. Thread ${c.id} is working on it: call wait_for_thread for its reply.`
          return report(c.id, link, a.timeoutSeconds)
        },
        wait: async (a) => {
          const c = childOf(a.threadId)
          const link: Link = { kind: "link", id: newId("l"), at: now(), threadId: c.id, title: c.title, action: "waited", state: "waiting", text: "" }
          show(link)
          return report(c.id, link, a.timeoutSeconds)
        },
        list: async () => {
          const kids = store.threads().filter((m) => m.parentId === parent.id)
          if (!kids.length) return "This thread hasn't started any threads."
          return kids.map((m) => {
            const said = lastReply(store.thread(m.id)!).text
            return `- ${m.id} "${m.title}": ${busy(m.id) ? "working" : "idle"}${m.cwd ? `, in worktree ${m.cwd} (${m.branch ?? basename(m.cwd)})` : ""}` +
              (said ? `\n  last reply: ${said.replace(/\s+/g, " ").slice(0, 300)}` : "")
          }).join("\n")
        }
      }
    }

    return {
      create,
      update,
      moveTo,
      turn,
      /** A thread was deleted: anyone waiting for it hears so now. */
      forget: (id: string) => settle(id),
      isRunning: busy,
      /** The plan's usage windows as the provider last reported them. */
      limits: () => [...limits.values()],
      /** How many threads have a turn going. */
      running: () => live.size,
      stop: (id: string) => {
        const l = live.get(id)
        if (!l) return false
        l.abort.abort()
        return true
      },
      answer: (id: string, askId: string, allow: boolean) => {
        const pending = live.get(id)?.asks.get(askId)
        if (!pending) return false
        pending.done(allow ? "allowed" : "declined")
        return true
      },
      stopAll: () => {
        for (const l of live.values()) l.abort.abort()
      }
    }
  })

export type Threads = Effect.Success<ReturnType<typeof makeThreads>>
