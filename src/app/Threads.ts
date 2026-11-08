/**
 * Threads: a conversation with one provider, in one project.
 *
 * A turn: the person's message goes in; on a thread's first message in a git
 * project, singularity hands over the past change there most like it; the
 * provider streams text and tool calls, which become the thread's items; a
 * tool call that needs approval becomes a card the person answers; when the
 * turn ends, if it committed, `singularity store` keeps that commit for the
 * next thread to recall. Every change is sent to open pages as it happens.
 */
import { Effect, Option, Stream } from "effect"
import { loadGenome, solverPrompt } from "../Genome.ts"
import { git, head } from "../Git.ts"
import { Memory } from "../Singularity.ts"
import type { Access, Item, Project, ProviderId, Thread } from "./Model.ts"
import { metaOf, newId, titleFrom } from "./Model.ts"
import { type Provider, turnStream } from "./providers/Provider.ts"
import { claude } from "./providers/Claude.ts"
import { codex } from "./providers/Codex.ts"
import { ollama } from "./providers/Ollama.ts"
import { Store } from "./Store.ts"

export const PROVIDERS: Record<ProviderId, Provider> = { claude, codex, ollama }

export interface Hub {
  send(event: string, data: unknown): void
}

interface Live {
  readonly abort: AbortController
  readonly asks: Map<string, (allow: boolean) => void>
}

const now = () => new Date().toISOString()

/** The commit subject from a recall's text: `committed as abc123: "Subject"`. */
export const recalledTitle = (text: string): string => /committed as \w+: "([^"]+)"/.exec(text)?.[1] ?? "a past change"

export const makeThreads = (options: { readonly zeroRoot: string; readonly hub: Hub }) =>
  Effect.gen(function*() {
    const store = yield* Store
    const live = new Map<string, Live>()
    const { hub } = options

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

    const create = (project: Project, input: { provider?: ProviderId; model?: string; access?: Access }) => {
      const settings = store.settings()
      const provider = input.provider ?? settings.defaultProvider
      const thread: Thread = {
        id: newId("t"),
        projectId: project.id,
        title: "New thread",
        provider,
        model: input.model || PROVIDERS[provider].defaultModel(settings),
        access: input.access ?? settings.defaultAccess,
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

    /** Change a thread's provider, model or access. A new provider starts a new session. */
    const update = (t: Thread, patch: { title?: string; provider?: ProviderId; model?: string; access?: Access }) => {
      if (patch.provider && patch.provider !== t.provider) {
        t.provider = patch.provider
        t.resume = null
        t.model = patch.model || PROVIDERS[patch.provider].defaultModel(store.settings())
      } else if (patch.model) {
        t.model = patch.model
      }
      if (patch.access) t.access = patch.access
      if (patch.title?.trim()) t.title = patch.title.trim().slice(0, 120)
      touch(t)
      store.saveThread(t)
    }

    const ask = (t: Thread, l: Live) => (tool: string, detail: string): Promise<boolean> =>
      new Promise((resolve) => {
        const item: Item = { kind: "permission", id: newId("ask"), at: now(), tool, detail, state: "pending" }
        put(t, item, false)
        const done = (allow: boolean) => {
          l.asks.delete(item.id)
          item.state = allow ? "allowed" : "denied"
          put(t, item, false)
          resolve(allow)
        }
        l.asks.set(item.id, done)
        l.abort.signal.addEventListener("abort", () => l.asks.has(item.id) && done(false), { once: true })
      })

    /** One turn, start to end. Never fails: what goes wrong ends up on the thread. */
    const turn = (t: Thread, project: Project, text: string) =>
      Effect.gen(function*() {
        const memory = yield* Memory
        const settings = store.settings()
        const provider = PROVIDERS[t.provider]
        const l: Live = { abort: new AbortController(), asks: new Map() }
        live.set(t.id, l)
        const started = Date.now()
        const firstTurn = !t.items.some((i) => i.kind === "user")
        const history = t.items.flatMap((i) => (i.kind === "user" || i.kind === "assistant" ? [{ role: i.kind, text: i.text }] : []))

        put(t, { kind: "user", id: newId("u"), at: now(), text }, false)
        if (firstTurn) t.title = titleFrom(text)
        t.status = "running"
        touch(t)

        const before = yield* head(project.path).pipe(Effect.option)
        let prompt = text
        if (firstTurn && settings.memory.recall && Option.isSome(before)) {
          const recall = yield* memory.recall(text, project.path).pipe(Effect.orElseSucceed(() => Option.none()))
          if (Option.isSome(recall)) {
            put(t, { kind: "memory", id: newId("m"), at: now(), action: "recalled", commit: recall.value.commit, title: recalledTitle(recall.value.text) })
            prompt = `${text}\n\n${recall.value.text}`
          }
        }
        const instructions = settings.useGenome
          ? yield* loadGenome(options.zeroRoot).pipe(Effect.map(solverPrompt), Effect.orElseSucceed(() => ""))
          : ""

        let costUsd: number | null = null
        let tokens: number | null = null
        const texts = new Map<string, Item & { kind: "assistant" }>()
        const outcome = yield* turnStream(provider, {
          cwd: project.path,
          prompt,
          history,
          model: t.model,
          resume: t.resume,
          instructions,
          access: t.access,
          settings,
          ask: ask(t, l),
          signal: l.abort.signal
        }).pipe(
          Stream.runForEach((e) =>
            Effect.sync(() => {
              if (e.type === "session") {
                if (t.resume !== e.resume) {
                  t.resume = e.resume
                  store.saveThread(t, true)
                }
              } else if (e.type === "text") {
                const known = texts.get(e.key)
                if (known) {
                  known.text += e.delta
                  hub.send("delta", { threadId: t.id, itemId: known.id, delta: e.delta })
                  store.saveThread(t, true)
                } else {
                  const item = { kind: "assistant" as const, id: newId("a"), at: now(), text: e.delta }
                  texts.set(e.key, item)
                  put(t, item)
                }
              } else if (e.type === "tool") {
                put(t, { kind: "tool", id: `tool_${e.key}`, at: now(), name: e.name, detail: e.detail, status: e.status, output: e.output ?? "" })
              } else {
                costUsd = e.costUsd
                tokens = e.tokens
              }
            })
          ),
          Effect.as({ outcome: "done" as const, error: "" }),
          Effect.catchTag("ProviderError", (e) =>
            Effect.succeed(l.abort.signal.aborted ? { outcome: "stopped" as const, error: "" } : { outcome: "failed" as const, error: e.message })
          )
        )
        const result = l.abort.signal.aborted && outcome.outcome === "done" ? { outcome: "stopped" as const, error: "" } : outcome
        // Tool calls a stopped turn left running didn't finish.
        for (const i of t.items) if (i.kind === "tool" && i.status === "running" && result.outcome !== "done") put(t, { ...i, status: "failed" })

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
        const resolve = live.get(id)?.asks.get(askId)
        if (!resolve) return false
        resolve(allow)
        return true
      },
      stopAll: () => {
        for (const l of live.values()) l.abort.abort()
      }
    }
  })

export type Threads = Effect.Success<ReturnType<typeof makeThreads>>
