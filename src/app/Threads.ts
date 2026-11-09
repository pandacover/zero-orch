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
import { Effect, Option, Stream } from "effect"
import { type Attachment, plainText, promptText } from "./Attachments.ts"
import { loadGenome, solverPrompt } from "../Genome.ts"
import { git, head } from "../Git.ts"
import { Memory, MEMORY_NOTE, type Recall } from "../Singularity.ts"
import type { Access, Item, Project, ProviderId, Settings, Thread } from "./Model.ts"
import { isCompact, isEffortFor, metaOf, newId, titleFrom } from "./Model.ts"
import { type Provider, turnStream } from "./providers/Provider.ts"
import { claude, nameThread } from "./providers/Claude.ts"
import { codex } from "./providers/Codex.ts"
import { ollama } from "./providers/Ollama.ts"
import { Store } from "./Store.ts"

export const PROVIDERS: Record<ProviderId, Provider> = { claude, codex, ollama }

export interface Hub {
  send(event: string, data: unknown): void
}

interface Pending {
  readonly done: (allow: boolean) => void
  /** What the thread's access makes of the call now. */
  readonly recheck?: (() => "allow" | "deny" | "ask") | undefined
}

interface Live {
  readonly abort: AbortController
  readonly asks: Map<string, Pending>
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
    const live = new Map<string, Live>()
    const { hub } = options
    const name = options.nameThread ?? nameThread

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

    const create = (project: Project, input: { provider?: ProviderId; model?: string; access?: Access; effort?: string }) => {
      const settings = store.settings()
      const provider = input.provider ?? settings.defaultProvider
      const thread: Thread = {
        id: newId("t"),
        projectId: project.id,
        title: "New thread",
        provider,
        model: input.model || PROVIDERS[provider].defaultModel(settings),
        access: input.access ?? settings.defaultAccess,
        ...(isEffortFor(provider, input.effort) ? { effort: input.effort } : {}),
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
    const update = (t: Thread, patch: { title?: string; provider?: ProviderId; model?: string; access?: Access; effort?: string }) => {
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
          if (verdict === "allow") p.done(true)
          else if (verdict === "deny") p.done(false)
        }
      }
      if (patch.title?.trim()) t.title = patch.title.trim().slice(0, 120)
      touch(t)
      store.saveThread(t)
    }

    const ask = (t: Thread, l: Live) => (tool: string, detail: string, recheck?: () => "allow" | "deny" | "ask"): Promise<boolean> =>
      new Promise((resolve) => {
        const item: Item = { kind: "permission", id: newId("ask"), at: now(), tool, detail, state: "pending" }
        put(t, item, false)
        const done = (allow: boolean) => {
          if (!l.asks.has(item.id)) return
          l.asks.delete(item.id)
          item.state = allow ? "allowed" : "denied"
          put(t, item, false)
          resolve(allow)
        }
        l.asks.set(item.id, { done, recheck })
        l.abort.signal.addEventListener("abort", () => l.asks.has(item.id) && done(false), { once: true })
      })

    /**
     * One turn, start to end. Never fails: what goes wrong ends up on the thread.
     *
     * With `compactFirst` (the person left Compact on when the context was filling), the provider
     * compacts its session first while the message waits in `queued`; then the message runs.
     */
    const turn = (t: Thread, project: Project, text: string, attachments: ReadonlyArray<Attachment> = [], opts: { readonly compactFirst?: boolean } = {}) =>
      Effect.gen(function*() {
        const memory = yield* Memory
        // A thread's own effort wins over the settings' default.
        const settings = withEffort(store.settings(), t.provider, t.effort)
        const provider = PROVIDERS[t.provider]
        const l: Live = { abort: new AbortController(), asks: new Map() }
        live.set(t.id, l)
        const started = Date.now()
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
        const run = (prompt: string, instructions: string) =>
          turnStream(provider, {
            cwd: project.path,
            prompt,
            history,
            model: t.model,
            resume: t.resume,
            instructions,
            access: () => t.access,
            settings,
            ask: ask(t, l),
            signal: l.abort.signal
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
                  put(t, { kind: "tool", id: `tool_${e.key}`, at: now(), name: e.name, detail: e.detail, status: e.status, output: e.output ?? "" })
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
          touch(t)
          startCompaction()
          yield* run("/compact", "")
          // A compaction that ended without saying so is over either way.
          if (compaction?.state === "running") put(t, { ...compaction, state: l.abort.signal.aborted ? "failed" : "done" })
          compaction = undefined
          delete t.queued
        }

        put(t, { kind: "user", id: newId("u"), at: now(), text, ...(attachments.length ? { attachments } : {}) }, false)
        const refused = compact ? cantCompact(provider, t.resume) : ""
        if (refused) {
          put(t, { kind: "turn", id: newId("end"), at: now(), provider: t.provider, model: t.model, durationMs: 0, costUsd: null, tokens: null, outcome: "failed", error: refused }, false)
          live.delete(t.id)
          touch(t)
          store.saveThread(t)
          return
        }
        if (firstTurn && !compact) {
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
        touch(t)

        const before = yield* head(project.path).pipe(Effect.option)
        // singularity keeps memory per git repo, and the person may turn recall off.
        const remembers = settings.memory.recall && Option.isSome(before) && !compact
        let prompt = compact ? text.trim() : promptText(text, attachments)
        if (remembers && !l.abort.signal.aborted) {
          // Every message is a task start, as singularity's own hook treats it: ask singularity for
          // the past change here most like it. The thread shows what came of it either way, so a
          // miss or a failure isn't silent.
          const handed = new Set(t.items.flatMap((i) => (i.kind === "memory" && i.action === "recalled" ? [i.commit] : [])))
          const asked = yield* memory.recall(words, project.path).pipe(
            Effect.match({
              onFailure: (e) => ({ recall: Option.none<Recall>(), failed: e.message }),
              onSuccess: (recall) => ({ recall, failed: "" })
            })
          )
          if (Option.isSome(asked.recall) && handed.has(asked.recall.value.commit)) {
            // The agent already has this one from earlier in the thread: point at it, don't hand it over twice.
            const recall = asked.recall.value
            put(t, { kind: "memory", id: newId("m"), at: now(), action: "checked", commit: recall.commit, title: `the same past change as earlier in this thread: ${recalledTitle(recall.text)}` })
          } else if (Option.isSome(asked.recall)) {
            const recall = asked.recall.value
            put(t, { kind: "memory", id: newId("m"), at: now(), action: "recalled", commit: recall.commit, title: recalledTitle(recall.text), text: recall.text })
            prompt = `${prompt}\n\n${recall.text}`
          } else {
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
        const instructions = [genome, remembers ? MEMORY_NOTE : ""].filter((s) => s !== "").join("\n\n")

        if (compact && !l.abort.signal.aborted) startCompaction()
        // Stopped while the message was queued: it's on the thread, but doesn't run.
        const outcome = l.abort.signal.aborted ? { outcome: "stopped" as const, error: "" } : yield* run(prompt, instructions)
        const result = l.abort.signal.aborted && outcome.outcome === "done" ? { outcome: "stopped" as const, error: "" } : outcome
        // Tool calls (and a compaction) a stopped turn left running didn't finish.
        for (const i of t.items) if (i.kind === "tool" && i.status === "running" && result.outcome !== "done") put(t, { ...i, status: "failed" })
        if (compaction?.state === "running") put(t, { ...compaction, state: result.outcome === "done" ? "done" : "failed" })

        // A commit this turn made: let singularity keep it.
        const after = yield* head(project.path).pipe(Effect.option)
        if (settings.memory.store && Option.isSome(before) && Option.isSome(after) && after.value !== before.value) {
          yield* memory.store(project.path).pipe(Effect.ignore)
          const stored = yield* memory.changes(project.path).pipe(Effect.orElseSucceed(() => []))
          const subject = yield* git(project.path, ["log", "-1", "--format=%s"]).pipe(Effect.map((s) => s.trim()), Effect.orElseSucceed(() => ""))
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
        const branch = yield* git(project.path, ["branch", "--show-current"]).pipe(Effect.map((s) => s.trim()), Effect.orElseSucceed(() => ""))
        if (branch) t.branch = branch
        live.delete(t.id)
        t.status = "idle"
        touch(t)
        store.saveThread(t)
      })

    return {
      create,
      update,
      turn,
      isRunning: (id: string) => live.has(id),
      stop: (id: string) => {
        const l = live.get(id)
        if (!l) return false
        l.abort.abort()
        return true
      },
      answer: (id: string, askId: string, allow: boolean) => {
        const pending = live.get(id)?.asks.get(askId)
        if (!pending) return false
        pending.done(allow)
        return true
      },
      stopAll: () => {
        for (const l of live.values()) l.abort.abort()
      }
    }
  })

export type Threads = Effect.Success<ReturnType<typeof makeThreads>>
