// Dogfooding helper: run one control-plane thread to the end through the real
// API, answering approval cards the way a careful person would, and log it all.
//
//   node scripts/drive-thread.mjs --port 4747 --project <id|name> --access auto-edit "message" [--thread <id>]
//
// Approvals: edits and writes inside the project are allowed; commands are
// allowed only from a short list (checks, read-only git, git add/commit,
// node, singularity recall); everything else is denied, and the reason is
// logged so a person can see what the agent wanted.
import { readFileSync } from "node:fs"

const args = process.argv.slice(2)
const flag = (name, fallback) => {
  const i = args.indexOf(`--${name}`)
  if (i < 0) return fallback
  const [v] = args.splice(i, 2).slice(1)
  return v
}
const port = Number(flag("port", "4747"))
const projectArg = flag("project", "zero")
const access = flag("access", "auto-edit")
const model = flag("model", "")
const threadArg = flag("thread", "")
const fileArg = flag("file", "")
const text = fileArg ? readFileSync(fileArg, "utf8") : args.join(" ")
const base = `http://127.0.0.1:${port}`

const page = await (await fetch(`${base}/`)).text()
const token = /zero-token" content="([^"]+)"/.exec(page)?.[1]
if (!token) throw new Error("no token: is the control plane running?")
const api = async (method, path, body) => {
  const res = await fetch(`${base}/api/${path}`, { method, headers: { "x-zero-token": token, "content-type": "application/json" }, body: body && JSON.stringify(body) })
  const data = await res.json()
  if (!res.ok) throw new Error(`${method} ${path}: ${data.error}`)
  return data
}

const boot = await api("GET", "bootstrap")
const project = boot.projects.find((p) => p.id === projectArg || p.name === projectArg)
if (!project) throw new Error(`no project ${projectArg}`)
const norm = (p) => p.replace(/\\/g, "/").toLowerCase()

const SAFE = [
  /^(npm (test|run (typecheck|test|build|lint))|npx (tsc|vitest)\b.*)$/,
  /^node [\w./\\-]+( .*)?$/,
  /^git (status|diff|log|show|add|commit|rev-parse|ls-files)\b/,
  /^singularity (recall|changes)\b/,
  /^(ls|cat|head|tail|wc|pwd)\b/
]
const decide = (tool, detail) => {
  // A leading `cd "<the project>" &&` is just Claude being explicit about where it is.
  const cd = /^cd\s+"?([^"&]+?)"?\s*&&\s*/.exec(detail)
  const d = cd && norm(cd[1].trim()).startsWith(norm(project.path)) ? detail.slice(cd[0].length) : detail
  if (["Edit", "Write", "MultiEdit", "NotebookEdit"].includes(tool)) {
    return norm(detail).startsWith(norm(project.path)) || !/^[a-z]:|^\//i.test(detail)
      ? [true, "edit inside the project"]
      : [false, "edit outside the project"]
  }
  if (tool === "Bash") {
    const parts = d.split(/\s*(?:&&|;|\|\|)\s*/)
    const bad = parts.find((p) => !SAFE.some((re) => re.test(p.trim())))
    return bad === undefined ? [true, "on the allowlist"] : [false, `not on the allowlist: ${bad.slice(0, 120)}`]
  }
  return [false, `tool ${tool}`]
}

const thread = threadArg
  ? await api("GET", `threads/${threadArg}`)
  : await api("POST", "threads", { projectId: project.id, access, ...(model ? { model } : {}) })
const log = (...m) => console.log(new Date().toISOString().slice(11, 19), ...m)
log(`thread ${thread.id} in ${project.name} (${access})`)

const es = await fetch(`${base}/api/events?token=${encodeURIComponent(token)}`)
const reader = es.body.getReader()
const decoder = new TextDecoder()
let buffer = ""
let started = false
const done = new Promise(async (resolve) => {
  for (;;) {
    const { value, done: end } = await reader.read()
    if (end) return resolve("stream closed")
    buffer += decoder.decode(value, { stream: true })
    const frames = buffer.split("\n\n")
    buffer = frames.pop()
    for (const frame of frames) {
      const ev = /^event: (.+)$/m.exec(frame)?.[1]
      const data = /^data: (.+)$/m.exec(frame)?.[1]
      if (!ev || !data) continue
      const d = JSON.parse(data)
      if (ev === "item" && d.threadId === thread.id) {
        const it = d.item
        if (it.kind === "tool" && it.status !== "running") log(`  ${it.status === "done" ? "✓" : "✗"} ${it.name} ${it.detail.slice(0, 140)}`)
        if (it.kind === "memory") log(`  memory ${it.action}: ${it.commit.slice(0, 10)} ${it.title}`)
        if (it.kind === "permission" && it.state === "pending") {
          const [allow, why] = decide(it.tool, it.detail)
          log(`  ${allow ? "ALLOW" : "DENY "} ${it.tool} (${why}): ${it.detail.slice(0, 160)}`)
          await api("POST", `threads/${thread.id}/permissions/${it.id}`, { allow }).catch((e) => log(`  answer failed: ${e.message}`))
        }
        if (it.kind === "assistant" && it.text) { /* streamed; printed at the end */ }
        if (it.kind === "turn") {
          log(`turn ${it.outcome}: ${(it.durationMs / 1000).toFixed(0)}s, $${(it.costUsd ?? 0).toFixed(3)}${it.error ? `, error: ${it.error}` : ""}`)
        }
      }
      if (ev === "thread" && d.id === thread.id) {
        if (d.status === "running") started = true
        if (started && d.status === "idle") return resolve("idle")
      }
    }
  }
})
await api("POST", `threads/${thread.id}/messages`, { text })
const why = await done
const final = await api("GET", `threads/${thread.id}`)
const last = [...final.items].reverse().find((i) => i.kind === "assistant")
log(`ended (${why}). Last words:\n${last?.text ?? "(none)"}`)
process.exit(0)
