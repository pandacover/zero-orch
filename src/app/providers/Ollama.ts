/**
 * Ollama: models on this machine, as plain chat. No tools, so a thread on
 * Ollama talks about the project but doesn't touch it. Ollama keeps no
 * session, so each turn sends the thread so far.
 */
import type { Provider, TurnEvent, TurnInput } from "./Provider.ts"

const tags = async (baseUrl: string): Promise<Array<string>> => {
  const res = await fetch(`${baseUrl.replace(/\/$/, "")}/api/tags`, { signal: AbortSignal.timeout(1500) })
  if (!res.ok) throw new Error(`Ollama answered ${res.status}`)
  const body = (await res.json()) as { models?: Array<{ name: string }> }
  return (body.models ?? []).map((m) => m.name)
}

async function* turn(input: TurnInput): AsyncGenerator<TurnEvent> {
  const base = input.settings.ollama.baseUrl.replace(/\/$/, "")
  const res = await fetch(`${base}/api/chat`, {
    method: "POST",
    signal: input.signal,
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      model: input.model,
      stream: true,
      messages: [
        ...(input.instructions ? [{ role: "system", content: input.instructions }] : []),
        ...input.history.map((h) => ({ role: h.role, content: h.text })),
        { role: "user", content: input.prompt }
      ]
    })
  }).catch((e: unknown) => {
    throw new Error(`can't reach Ollama at ${base}: ${e instanceof Error ? e.message : e}. Start it with \`ollama serve\`.`)
  })
  if (!res.ok || !res.body) throw new Error(`Ollama answered ${res.status}: ${(await res.text()).slice(0, 200)}`)
  const key = `ollama-${Date.now()}`
  const decoder = new TextDecoder()
  let buffer = ""
  for await (const chunk of res.body as unknown as AsyncIterable<Uint8Array>) {
    buffer += decoder.decode(chunk, { stream: true })
    const lines = buffer.split("\n")
    buffer = lines.pop() ?? ""
    for (const line of lines) {
      if (!line.trim()) continue
      const m = JSON.parse(line) as { message?: { content?: string }; done?: boolean; error?: string; eval_count?: number; prompt_eval_count?: number }
      if (m.error) throw new Error(`Ollama: ${m.error}`)
      if (m.message?.content) yield { type: "text", key, delta: m.message.content }
      if (m.done) yield { type: "usage", costUsd: 0, tokens: (m.eval_count ?? 0) + (m.prompt_eval_count ?? 0) }
    }
  }
}

export const ollama: Provider = {
  id: "ollama",
  label: "Ollama",
  compaction: "none",
  defaultModel: (s) => s.ollama.model,
  status: async (s) => {
    if (!s.ollama.enabled) return { available: false, detail: "Turned off in settings", models: [], asks: false, tools: false }
    try {
      const models = await tags(s.ollama.baseUrl)
      if (models.length === 0) return { available: false, detail: "Ollama is running but has no models. Pull one with `ollama pull`.", models, asks: false, tools: false }
      return { available: true, detail: `Local chat at ${s.ollama.baseUrl}. No tools: it can read what you paste, not your files.`, models, asks: false, tools: false }
    } catch {
      return { available: false, detail: `Not running at ${s.ollama.baseUrl}. Start it with \`ollama serve\`.`, models: [], asks: false, tools: false }
    }
  },
  turn
}
