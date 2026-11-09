// zero control plane: projects, threads with Claude, settings, and zero's evolution.
// No framework: state in `S`, views rebuilt on navigation, live items patched in place.
"use strict"

const TOKEN = document.querySelector('meta[name="zero-token"]').content
const $ = (id) => document.getElementById(id)
const el = (tag, attrs = {}, ...kids) => {
  const n = document.createElement(tag)
  for (const [k, v] of Object.entries(attrs)) {
    if (v === undefined || v === null || v === false) continue
    if (k === "class") n.className = v
    else if (k === "text") n.textContent = v
    else if (k === "html") n.innerHTML = v
    else if (k.startsWith("on")) n.addEventListener(k.slice(2), v)
    else n.setAttribute(k, v === true ? "" : v)
  }
  for (const kid of kids.flat()) if (kid !== null && kid !== undefined && kid !== false) n.append(kid)
  return n
}
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c])
const usd = (x) => (x < 0.01 && x > 0 ? `$${x.toFixed(4)}` : `$${x.toFixed(2)}`)
const pct = (x) => (x * 100).toFixed(1)
const ago = (iso) => {
  const s = Math.max(0, (Date.now() - new Date(iso)) / 1000)
  if (s < 60) return "now"
  if (s < 3600) return `${Math.floor(s / 60)}m`
  if (s < 86400) return `${Math.floor(s / 3600)}h`
  return `${Math.floor(s / 86400)}d`
}
const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches

// ---------- state ----------
const S = {
  settings: null,
  projects: [],
  threads: [],
  providers: {},
  home: "",
  zeroRoot: "",
  open: null, // the thread on screen, with its items
  asking: new Set(), // threads waiting on an approval
  collapsed: new Set(load("collapsed", [])),
  expanded: new Set(), // tool items showing output
  route: { name: "home" },
  evo: null
}
function load(key, fallback) {
  try { return JSON.parse(localStorage.getItem(`zero.${key}`)) ?? fallback } catch { return fallback }
}
function save(key, value) {
  try { localStorage.setItem(`zero.${key}`, JSON.stringify(value)) } catch {}
}

async function api(method, path, body) {
  const res = await fetch(`/api/${path}`, {
    method,
    headers: { "x-zero-token": TOKEN, "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body)
  })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(data.error || `request failed (${res.status})`)
  return data
}

function toast(text, error = false) {
  const t = el("div", { class: `toast${error ? " error" : ""}`, role: error ? "alert" : "status", text })
  $("toasts").append(t)
  setTimeout(() => t.remove(), error ? 7000 : 3000)
}
const fail = (e) => toast(e.message, true)

function dialog({ title, text = "", ok, body = null }) {
  const d = $("dialog")
  $("dialog-title").textContent = title
  $("dialog-text").textContent = text
  $("dialog-text").hidden = !text
  $("dialog-body").replaceChildren(...(body ? [body] : []))
  $("dialog-ok").textContent = ok
  d.returnValue = ""
  d.showModal()
  body?.querySelector("input")?.focus()
  return new Promise((resolve) => d.addEventListener("close", () => resolve(d.returnValue === "ok"), { once: true }))
}

// ---------- routing ----------
function parseRoute() {
  const [, name, id] = location.hash.split("/")
  if (name === "t" && id) return { name: "thread", id }
  if (name === "new" && id) return { name: "new", projectId: id }
  if (name === "settings") return { name: "settings" }
  if (name === "evolution") return { name: "evolution" }
  return { name: "home" }
}
const go = (hash) => { if (location.hash !== hash) location.hash = hash; else route() }
addEventListener("hashchange", route)

async function route() {
  S.route = parseRoute()
  closeSide()
  if (S.route.name === "thread") {
    try {
      S.open = await api("GET", `threads/${S.route.id}`)
      save("last", S.route.id)
    } catch {
      S.open = null
      return go("#/")
    }
  } else {
    S.open = null
  }
  renderSide()
  renderMain()
}

// ---------- sidebar ----------
function renderSide() {
  const tree = $("tree")
  const byProject = new Map(S.projects.map((p) => [p.id, []]))
  for (const t of S.threads) byProject.get(t.projectId)?.push(t)
  tree.replaceChildren(...S.projects.map((p) => {
    const closed = S.collapsed.has(p.id)
    const threads = byProject.get(p.id) ?? []
    return el("section", { class: `proj${closed ? " closed" : ""}` },
      el("div", { class: "proj-head" },
        el("button", { class: "proj-toggle", type: "button", "aria-expanded": String(!closed), title: p.path, onclick: () => toggleProject(p.id) },
          el("span", { class: "chev", "aria-hidden": "true", text: "▼" }),
          el("span", { class: "proj-name", text: p.name })),
        el("span", { class: "proj-actions" },
          el("button", { class: "icon-btn", type: "button", title: `New thread in ${p.name}`, "aria-label": `New thread in ${p.name}`, onclick: () => go(`#/new/${p.id}`) }, "+"),
          el("button", { class: "icon-btn", type: "button", title: `Remove ${p.name} from zero`, "aria-label": `Remove ${p.name}`, onclick: () => removeProject(p) }, "×"))),
      el("ul", { class: "threads" },
        threads.length === 0
          ? el("li", { class: "none", text: "No threads yet" })
          : threads.map((t) => el("li", {},
            el("a", { class: `thread-link${S.open?.id === t.id ? " active" : ""}`, href: `#/t/${t.id}`, "aria-current": S.open?.id === t.id ? "page" : null },
              t.status === "running" ? el("span", { class: S.asking.has(t.id) ? "ask-dot" : "run-dot", title: S.asking.has(t.id) ? "Waiting for your approval" : "Working" }) : null,
              el("span", { class: "t", text: t.title }),
              el("span", { class: "age", text: ago(t.updatedAt) }))))))
  }))
  for (const a of document.querySelectorAll(".foot-link")) a.classList.toggle("active", a.dataset.route === S.route.name)
}
function toggleProject(id) {
  S.collapsed.has(id) ? S.collapsed.delete(id) : S.collapsed.add(id)
  save("collapsed", [...S.collapsed])
  renderSide()
}
async function addProject() {
  const body = el("div", {},
    el("label", { class: "field" }, "Folder", el("input", { name: "path", placeholder: "C:\\Users\\you\\code\\app", required: true, autocomplete: "off", spellcheck: "false" })),
    el("label", { class: "field" }, "Name (optional)", el("input", { name: "name", placeholder: "The folder's name", autocomplete: "off" })))
  if (!(await dialog({ title: "Add a project", text: "Paste the full path of a folder on this machine. Threads in it work there.", ok: "Add project", body }))) return
  try {
    const p = await api("POST", "projects", { path: body.querySelector("[name=path]").value, name: body.querySelector("[name=name]").value })
    toast(`Added ${p.name}.`)
    go(`#/new/${p.id}`)
  } catch (e) { fail(e) }
}
async function removeProject(p) {
  const n = S.threads.filter((t) => t.projectId === p.id).length
  if (!(await dialog({ title: `Remove ${p.name}?`, text: `Its ${n} thread${n === 1 ? "" : "s"} are deleted from zero. The folder itself isn't touched.`, ok: "Remove project" }))) return
  try { await api("DELETE", `projects/${p.id}`); toast(`Removed ${p.name}.`) } catch (e) { fail(e) }
}

// ---------- main ----------
function renderMain() {
  const main = $("main")
  const r = S.route
  if (r.name === "thread" && S.open) return main.replaceChildren(...threadView(S.open))
  if (r.name === "settings") return main.replaceChildren(settingsView())
  if (r.name === "evolution") return main.replaceChildren(evolutionView())
  const project = S.projects.find((p) => p.id === r.projectId) ?? S.projects[0]
  main.replaceChildren(startView(project))
}

const menuButton = () => el("button", { class: "icon-btn menu", type: "button", "aria-label": "Open sidebar", onclick: openSide }, "☰")
function openSide() { $("side").classList.add("open"); $("scrim").hidden = false }
function closeSide() { $("side").classList.remove("open"); $("scrim").hidden = true }
$("scrim").addEventListener("click", closeSide)
$("side-close").addEventListener("click", closeSide)

const claudeStatus = () => S.providers.claude
const modelOptions = (current) => {
  const list = [...(claudeStatus()?.models ?? [])]
  if (current && !list.includes(current)) list.unshift(current)
  return list.map((m) => el("option", { value: m, selected: m === current }, m))
}
const ACCESS = [
  ["ask", "Ask first", "Reads freely; asks before every edit and command."],
  ["auto-edit", "Auto-edit", "Reads and edits inside the project; asks before commands."],
  ["read-only", "Read-only", "Reads only. Nothing changes."]
]
const accessOptions = (current) => ACCESS.map(([v, label, help]) => el("option", { value: v, selected: v === current, title: help }, label))

// ---------- new thread ----------
const IDEAS = ["Explain how this project is laid out", "Find what's untested and add tests", "Review the last commit for bugs", "Run the checks and fix what fails"]
function startView(project) {
  if (!project) {
    return el("div", { class: "start" }, el("div", { class: "start-inner" },
      el("h1", { text: "Add a project to start" }),
      el("p", { class: "lede", text: "A project is a folder on this machine. Threads in it can read, edit and run things there." }),
      el("button", { class: "btn btn-primary", type: "button", onclick: addProject }, "Add project")))
  }
  const box = composer({
    placeholder: `Ask Claude to do something in ${project.name}…`,
    onSend: async (text) => {
      const projectId = pick.value
      const t = await api("POST", "threads", { projectId })
      await api("POST", `threads/${t.id}/messages`, { text })
      go(`#/t/${t.id}`)
    }
  })
  const pick = el("select", { class: "select", "aria-label": "Project", onchange: () => go(`#/new/${pick.value}`) },
    S.projects.map((p) => el("option", { value: p.id, selected: p.id === project.id }, p.name)))
  const ready = claudeStatus()?.available
  return el("div", { class: "main-col" },
    el("div", { class: "bar" }, menuButton(), el("div", { class: "title-wrap" }, el("div", { class: "crumb", text: "New thread" })), el("div", { class: "pickers" }, pick)),
    el("div", { class: "start" }, el("div", { class: "start-inner" },
      el("h1", {}, "What should we do in ", el("em", { text: project.name }), "?"),
      el("p", { class: "lede", text: ready
        ? `Claude works in ${project.path}. It ${accessText(S.settings.defaultAccess)}${S.settings.memory.recall ? ", and singularity hands it the most similar past change here." : "."}`
        : `Claude is turned off. Turn it on in Settings to start a thread.` }),
      box.node,
      el("div", { class: "ideas" }, IDEAS.map((idea) => el("button", { class: "idea", type: "button", onclick: () => box.fill(idea) }, idea))))))
}
const accessText = (a) => ({ "ask": "asks before edits and commands", "auto-edit": "edits freely and asks before commands", "read-only": "only reads" })[a]

// ---------- composer ----------
function composer({ placeholder, onSend, onStop, running = false, disabled = false }) {
  const ta = el("textarea", { rows: 1, placeholder, "aria-label": "Message", disabled })
  const send = el("button", { class: "send", type: "button" })
  const hint = el("span", { class: "hint" })
  let busy = running
  const size = () => { ta.style.height = "auto"; ta.style.height = `${Math.min(ta.scrollHeight, 280)}px` }
  const paint = () => {
    send.className = `send${busy ? " stop" : ""}`
    send.replaceChildren(busy ? "Stop" : "Send", el("kbd", { class: "kbd", text: busy ? "Esc" : "↵" }))
    send.disabled = !busy && (disabled || !ta.value.trim())
    hint.textContent = busy ? "Working. Esc stops it." : "Enter sends · Shift+Enter for a new line"
  }
  const submit = async () => {
    if (busy) return onStop?.()
    const text = ta.value.trim()
    if (!text || disabled) return
    send.disabled = true
    try {
      await onSend(text)
      ta.value = ""
      size()
    } catch (e) { fail(e) }
    paint()
  }
  ta.addEventListener("input", () => { size(); paint() })
  ta.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey && !e.isComposing) { e.preventDefault(); submit() }
  })
  send.addEventListener("click", submit)
  paint()
  const node = el("div", { class: "composer" }, ta, el("div", { class: "composer-foot" }, hint, send))
  queueMicrotask(() => !disabled && ta.focus())
  return {
    node,
    setBusy: (b) => { busy = b; paint() },
    fill: (text) => { ta.value = text; size(); paint(); ta.focus() }
  }
}

// ---------- thread ----------
let feed = null // { node, scroll, nodes: Map, working, composer, stick }
function threadView(t) {
  const project = S.projects.find((p) => p.id === t.projectId)
  const title = el("input", { class: "title", value: t.title, "aria-label": "Thread title", maxlength: 120 })
  title.addEventListener("keydown", (e) => { if (e.key === "Enter") title.blur(); if (e.key === "Escape") { title.value = t.title; title.blur() } })
  title.addEventListener("change", () => api("PATCH", `threads/${t.id}`, { title: title.value }).catch(fail))
  const model = el("select", { class: "select mono", "aria-label": "Model", title: "Model for this thread's next turn" }, modelOptions(t.model))
  model.addEventListener("change", () => api("PATCH", `threads/${t.id}`, { model: model.value }).then(() => toast(`Next turn uses ${model.value}.`)).catch(fail))
  const access = el("select", { class: "select", "aria-label": "What Claude may do without asking" }, accessOptions(t.access))
  access.addEventListener("change", () => api("PATCH", `threads/${t.id}`, { access: access.value }).then(() => toast(ACCESS.find(([v]) => v === access.value)[2])).catch(fail))
  const del = el("button", { class: "icon-btn", type: "button", title: "Delete thread", "aria-label": "Delete thread", onclick: async () => {
    if (!(await dialog({ title: "Delete this thread?", text: "Its messages are deleted from zero. Changes it made to the project stay.", ok: "Delete thread" }))) return
    try { await api("DELETE", `threads/${t.id}`); go("#/") } catch (e) { fail(e) }
  } })
  del.innerHTML = '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" aria-hidden="true"><path d="M2.5 4h11M6 4V2.5h4V4M4 4l.7 9.5h6.6L12 4M6.6 6.5v4.5M9.4 6.5v4.5"/></svg>'

  const nodes = new Map()
  const list = el("div", { class: "feed", role: "log", "aria-live": "polite" })
  const working = el("div", { class: "working", hidden: true }, el("i"), el("i"), el("i"), el("span", { text: "Working" }))
  const scroll = el("div", { class: "scroll" }, list)
  const box = composer({
    placeholder: claudeStatus()?.available ? "Reply…" : "Claude is turned off in Settings",
    disabled: !claudeStatus()?.available,
    running: t.status === "running",
    onSend: (text) => api("POST", `threads/${t.id}/messages`, { text }),
    onStop: () => api("POST", `threads/${t.id}/stop`, {}).catch(fail)
  })
  feed = { list, scroll, nodes, working, composer: box, stick: true, model, access, title }
  scroll.addEventListener("scroll", () => { feed.stick = scroll.scrollHeight - scroll.scrollTop - scroll.clientHeight < 60 })
  for (const item of t.items) list.append(itemNode(item, nodes))
  list.append(working)
  paintWorking()
  requestAnimationFrame(() => { scroll.scrollTop = scroll.scrollHeight })
  return [
    el("div", { class: "bar" }, menuButton(),
      el("div", { class: "title-wrap" }, title, el("div", { class: "crumb" }, project ? project.name : "removed project", " · ", el("code", { text: project?.path ?? "" }))),
      el("div", { class: "pickers" }, model, access, del)),
    scroll,
    el("div", { class: "composer-wrap" }, box.node)
  ]
}

function paintWorking() {
  if (!feed || !S.open) return
  const running = S.open.status === "running"
  const asking = S.open.items.some((i) => i.kind === "permission" && i.state === "pending")
  feed.working.hidden = !running || asking
  feed.list.append(feed.working)
  feed.composer.setBusy(running)
}
const follow = () => { if (feed?.stick) feed.scroll.scrollTop = feed.scroll.scrollHeight }

function itemNode(item, nodes) {
  const node = renderItem(item)
  node.dataset.id = item.id
  nodes.set(item.id, node)
  return node
}
function upsertItem(item) {
  const t = S.open
  const i = t.items.findIndex((x) => x.id === item.id)
  if (i >= 0) t.items[i] = item
  else t.items.push(item)
  const old = feed.nodes.get(item.id)
  const node = itemNode(item, feed.nodes)
  if (old) old.replaceWith(node)
  else feed.list.insertBefore(node, feed.working)
  paintWorking()
  follow()
}

const pendingDeltas = new Map()
let deltaFrame = 0
function applyDelta(itemId, delta) {
  const item = S.open?.items.find((x) => x.id === itemId)
  if (!item) return
  item.text += delta
  pendingDeltas.set(itemId, item)
  if (!deltaFrame) deltaFrame = requestAnimationFrame(() => {
    deltaFrame = 0
    for (const it of pendingDeltas.values()) feed?.nodes.get(it.id)?.querySelector(".prose")?.replaceChildren(...mdNodes(it.text))
    pendingDeltas.clear()
    follow()
  })
}

/** A detail line with the project's own path taken out: `cd "C:/…/proj" && npm test` reads `npm test`. */
function rel(text) {
  const project = S.projects.find((p) => p.id === S.open?.projectId)
  if (!project || !text) return text
  // The path as written with either slash, matched without regard to case.
  const base = project.path.replace(/[\\/]+$/, "").split(/[\\/]/).map((part) => part.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("[\\\\/]")
  const t = text
    .replace(new RegExp(`^cd\\s+"?${base}"?\\s*&&\\s*`, "i"), "")
    .replace(new RegExp(`${base}[\\\\/]?`, "gi"), "")
  return t || "."
}

function renderItem(item) {
  switch (item.kind) {
    case "user": return el("div", { class: "msg-user", text: item.text })
    case "assistant": return el("div", { class: "msg-ai" }, el("div", { class: "prose" }, mdNodes(item.text)))
    case "tool": {
      const open = S.expanded.has(item.id)
      const out = el("pre", { class: "tool-out", hidden: !open, text: item.output || (item.status === "running" ? "Running…" : "No output.") })
      const row = el("button", { class: "tool-row", type: "button", "aria-expanded": String(open), title: item.detail, onclick: () => {
        const now = out.hidden
        out.hidden = !now
        row.setAttribute("aria-expanded", String(now))
        now ? S.expanded.add(item.id) : S.expanded.delete(item.id)
      } }, el("span", { class: "tool-state", "aria-label": item.status }), el("span", { class: "tool-name", text: item.name }), el("span", { class: "tool-detail", text: rel(item.detail) }))
      return el("div", { class: `tool ${item.status}` }, row, out)
    }
    case "permission": {
      if (item.state !== "pending") {
        return el("div", { class: `asked ${item.state}` }, el("b", { text: item.state === "allowed" ? "Allowed" : "Denied" }), el("span", { text: item.tool }), el("code", { text: rel(item.detail) }))
      }
      const answer = (allow) => api("POST", `threads/${S.open.id}/permissions/${item.id}`, { allow }).catch(fail)
      return el("div", { class: "ask", role: "group", "aria-label": "Approval needed" },
        el("div", { class: "ask-q", text: `Claude wants to ${verb(item.tool)}` }),
        el("div", { class: "ask-what", text: rel(item.detail), title: item.detail }),
        el("div", { class: "ask-actions" },
          el("button", { class: "btn btn-primary", type: "button", onclick: () => answer(true) }, "Allow", el("kbd", { text: "Y" })),
          el("button", { class: "btn btn-quiet", type: "button", onclick: () => answer(false) }, "Deny", el("kbd", { text: "N" })),
          el("span", { class: "hint", text: "Change what needs asking with the access menu above." })))
    }
    case "memory": {
      const label = { recalled: "Recalled from memory", stored: "Stored in memory", none: "Committed" }[item.action]
      return el("div", { class: `mem ${item.action}`, title: item.title }, el("span", { class: "mem-label", text: label }), el("code", { text: item.commit.slice(0, 10) }), el("span", { class: "mem-title", text: item.title }))
    }
    case "turn": {
      const meta = [item.model, `${(item.durationMs / 1000).toFixed(1)}s`, item.costUsd !== null ? usd(item.costUsd) : null, item.tokens ? `${(item.tokens / 1000).toFixed(1)}k tokens` : null].filter(Boolean)
      if (item.outcome === "failed") return el("div", { class: "turn-error" }, el("b", { text: "The turn stopped with an error. " }), item.error)
      return el("div", { class: "turn-meta" }, item.outcome === "stopped" ? el("span", { class: "stopped", text: "Stopped" }) : null, meta.map((m) => el("span", { text: m })))
    }
  }
  return el("div")
}
const verb = (tool) => ({ Bash: "run a command", Edit: "edit a file", Write: "write a file", MultiEdit: "edit a file", NotebookEdit: "edit a notebook" })[tool] ?? `use ${tool}`

// ---------- markdown (escaped first; only our own tags come out) ----------
function inline(s) {
  const codes = []
  let t = esc(s).replace(/`([^`]+)`/g, (_, c) => `\u0000${codes.push(c) - 1}\u0000`)
  t = t.replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, (_, label, url) => `<a href="${url}" target="_blank" rel="noopener noreferrer">${label}</a>`)
  t = t.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>").replace(/(^|[^*\w])\*([^*\n]+)\*(?!\w)/g, "$1<em>$2</em>")
  return t.replace(/\u0000(\d+)\u0000/g, (_, i) => `<code>${codes[Number(i)]}</code>`)
}
function md(src) {
  const lines = src.replace(/\r\n/g, "\n").split("\n")
  const out = []
  const isBlockStart = (l) => /^```|^#{1,6}\s|^>\s?|^\s*([-*+]|\d+[.)])\s+|^(-{3,}|\*{3,})\s*$/.test(l)
  for (let i = 0; i < lines.length;) {
    const line = lines[i]
    const fence = /^```\s*([\w+#.-]*)\s*$/.exec(line)
    if (fence) {
      const body = []
      i++
      while (i < lines.length && !/^```\s*$/.test(lines[i])) body.push(lines[i++])
      i++
      out.push(`<div class="code"><div class="code-head"><span>${esc(fence[1] || "text")}</span><button class="copy" type="button">Copy</button></div><pre><code>${esc(body.join("\n"))}</code></pre></div>`)
      continue
    }
    if (!line.trim()) { i++; continue }
    const h = /^(#{1,6})\s+(.*)$/.exec(line)
    if (h) { const n = Math.min(3, h[1].length); out.push(`<h${n}>${inline(h[2])}</h${n}>`); i++; continue }
    if (/^(-{3,}|\*{3,})\s*$/.test(line)) { out.push("<hr>"); i++; continue }
    if (/^>\s?/.test(line)) {
      const q = []
      while (i < lines.length && /^>\s?/.test(lines[i])) q.push(lines[i++].replace(/^>\s?/, ""))
      out.push(`<blockquote>${md(q.join("\n"))}</blockquote>`)
      continue
    }
    const li = /^(\s*)([-*+]|\d+[.)])\s+/.exec(line)
    if (li) {
      const ordered = /\d/.test(li[2])
      const items = []
      while (i < lines.length) {
        const m = /^(\s*)([-*+]|\d+[.)])\s+(.*)$/.exec(lines[i])
        if (m) { items.push(m[3]); i++; continue }
        if (lines[i].trim() && /^\s{2,}/.test(lines[i]) && items.length) { items[items.length - 1] += ` ${lines[i].trim()}`; i++; continue }
        break
      }
      out.push(`<${ordered ? "ol" : "ul"}>${items.map((x) => `<li>${inline(x)}</li>`).join("")}</${ordered ? "ol" : "ul"}>`)
      continue
    }
    const para = []
    while (i < lines.length && lines[i].trim() && (para.length === 0 || !isBlockStart(lines[i]))) para.push(lines[i++])
    out.push(`<p>${para.map(inline).join("<br>")}</p>`)
  }
  return out.join("")
}
function mdNodes(src) {
  const t = document.createElement("template")
  t.innerHTML = md(src)
  return [...t.content.childNodes]
}
document.addEventListener("click", async (e) => {
  const b = e.target.closest(".copy")
  if (!b) return
  try {
    await navigator.clipboard.writeText(b.closest(".code").querySelector("pre").textContent)
    b.textContent = "Copied"
    setTimeout(() => { b.textContent = "Copy" }, 1200)
  } catch { toast("Couldn't copy: the browser blocked the clipboard.", true) }
})

// ---------- settings ----------
function settingsView() {
  const s = structuredClone(S.settings)
  const commit = async () => {
    try {
      const r = await api("PUT", "settings", s)
      S.settings = r.settings
      S.providers = r.providers
      toast("Settings saved.")
    } catch (e) { fail(e) }
  }
  const sw = (get, set, label) => {
    const b = el("button", { class: "switch", type: "button", role: "switch", "aria-checked": String(get()), "aria-label": label })
    b.addEventListener("click", () => { set(!get()); b.setAttribute("aria-checked", String(get())); commit() })
    return b
  }
  const sel = (options, get, set, label, mono = false) => {
    const x = el("select", { class: `select${mono ? " mono" : ""}`, "aria-label": label }, options.map(([v, l]) => el("option", { value: v, selected: v === get() }, l)))
    x.addEventListener("change", () => { set(x.value); commit() })
    return x
  }
  const row = (label, help, control) => el("div", { class: "row" }, el("div", {}, el("div", { class: "row-label", text: label }), help ? el("div", { class: "row-help", text: help }) : null), control)
  const st = claudeStatus()
  return el("div", { class: "page" }, el("div", { class: "page-inner" },
    el("div", {}, menuButton(), el("h1", { text: "Settings" }), el("p", { class: "lede", text: "Saved as you change them. New threads pick them up; open threads keep their own model and access." })),
    el("section", { class: "card" },
      el("div", { class: "lineage-head" }, el("h2", { text: "Claude" }), el("span", { class: `pill${st?.available ? "" : " off"}` }, el("i"), st?.available ? "Ready" : "Off")),
      el("p", { class: "hint", text: "Through the Claude Agent SDK, signed in the way Claude Code is on this machine." }),
      el("div", { class: "rows" },
        row("On", "Off stops new turns; threads stay.", sw(() => s.claude.enabled, (v) => (s.claude.enabled = v), "Claude on")),
        row("Model for new threads", "Each thread can switch from its header.", sel((st?.models ?? [s.claude.model]).map((m) => [m, m]), () => s.claude.model, (v) => (s.claude.model = v), "Model", true)),
        row("Effort", "How hard Claude thinks each step. Higher is slower and costs more.", sel([["low", "Low"], ["medium", "Medium"], ["high", "High"], ["xhigh", "Extra high"], ["max", "Max"]], () => s.claude.effort, (v) => (s.claude.effort = v), "Effort")))),
    el("section", { class: "card" },
      el("h2", { text: "New threads" }),
      el("div", { class: "rows" },
        row("What Claude may do without asking", ACCESS.find(([v]) => v === s.defaultAccess)[2], sel(ACCESS.map(([v, l]) => [v, l]), () => s.defaultAccess, (v) => (s.defaultAccess = v), "Default access")))),
    el("section", { class: "card" },
      el("h2", { text: "singularity memory" }),
      el("p", { class: "hint", text: "Memory of changes committed in each repository. It needs singularity installed; without it, threads work the same." }),
      el("div", { class: "rows" },
        row("Recall at a thread's first message", "Hand Claude the past change in this project most like what you asked.", sw(() => s.memory.recall, (v) => (s.memory.recall = v), "Recall")),
        row("Store what threads commit", "After a turn that commits, keep that commit for the next thread to recall.", sw(() => s.memory.store, (v) => (s.memory.store = v), "Store")))),
    el("section", { class: "card" },
      el("h2", { text: "zero's genome" }),
      el("div", { class: "rows" },
        row("Use zero's evolved instructions", "Add zero's solver instructions and lessons to every thread. Evolution improves them.", sw(() => s.useGenome, (v) => (s.useGenome = v), "Use genome")))),
    el("section", { class: "card" },
      el("h2", { text: "Where things are" }),
      el("div", { class: "rows" },
        row("Threads, projects and settings", null, el("span", { class: "path", text: S.home })),
        row("zero itself", null, el("span", { class: "path", text: S.zeroRoot }))))))
}

// ---------- evolution ----------
let evoMode = load("evoMode", "generation")
let evoReps = load("evoReps", 1)
function evolutionView() {
  const page = el("div", { class: "page" }, el("div", { class: "page-inner wide", id: "evo" }, el("p", { class: "hint", text: "Loading…" })))
  loadEvo()
  return page
}
async function loadEvo() {
  try { S.evo = await api("GET", "zero/state") } catch (e) { return fail(e) }
  if (S.route.name === "evolution") paintEvo()
}
function paintEvo() {
  const root = $("evo")
  if (!root || !S.evo) return
  const E = S.evo
  const running = E.job && (E.job.state === "running" || E.job.state === "stopping")
  const full = E.measures.filter((m) => m.genomeId === E.genome?.id && m.results.length === E.tasks.length)
  const now = full[full.length - 1]
  const chart = el("div", { class: "chart", role: "img", "aria-label": "Score by generation" })
  const fields = el("div", { class: "evo-fields", hidden: evoMode !== "evolve" },
    el("label", {}, "Generations", el("input", { id: "evo-gens", type: "number", min: 1, max: 50, value: 3 })),
    el("label", {}, "Stop after spending $", el("input", { id: "evo-budget", type: "number", min: 1, max: 1000, value: 25 })))
  const repsInput = el("input", { id: "evo-reps", type: "number", min: 1, max: 5, step: 1, value: evoReps })
  repsInput.addEventListener("change", () => { evoReps = Number(repsInput.value) || 1; save("evoReps", evoReps) })
  const reps = el("div", { class: "evo-fields" },
    el("label", {}, "Reps per task", repsInput),
    el("p", { class: "hint", text: "More reps average out noise in the score, and multiply the cost." }))
  const desc = {
    bench: "Score the current genome on the hidden tests. Changes nothing but the ledger.",
    generation: "Recall a past improvement, let the improver change the genome, score it, keep it only if it wins.",
    evolve: "Run generations back to back until the count or the budget runs out."
  }[evoMode]
  const blocked = evoMode !== "bench" && E.tree.length > 0
  const log = el("div", { class: "log", id: "evo-log" }, E.log.length ? E.log.map((l) => logLine(l.line)) : el("span", { text: "Output from the next run streams here." }))
  root.replaceChildren(
    el("div", {}, menuButton(), el("h1", { text: "Evolution" }), el("p", { class: "lede", text: `zero rewrites its own genome and keeps a change only when the benchmark says it's better. Spent so far: ${usd(E.spentUsd)}.` })),
    el("section", { class: "card" },
      el("div", { class: "lineage-head" },
        el("div", {}, el("h2", { text: "Lineage" }), el("p", { class: "hint", text: "The line moves only when a generation is kept. Turned-down attempts hang below it; × marks one a guard stopped." })),
        now ? el("div", {}, el("div", { class: "score" }, pct(now.score), el("small", { text: "%" })), el("div", { class: "score-of", text: `${now.solved} of ${now.tasks} tasks solved${now.reps > 1 ? ` · averaged over ${now.reps} reps` : ""}` })) : null),
      chart),
    el("div", { class: "evo-grid" },
      el("section", { class: "card evo-run" },
        el("h2", { text: "Run" }),
        el("div", { class: "seg", role: "radiogroup", "aria-label": "What to run" },
          [["bench", "Benchmark"], ["generation", "Generation"], ["evolve", "Evolve"]].map(([m, l]) =>
            el("button", { type: "button", role: "radio", "aria-checked": String(m === evoMode), onclick: () => { evoMode = m; save("evoMode", m); paintEvo() } }, l))),
        el("p", { class: "hint", text: desc }),
        reps,
        fields,
        blocked ? el("div", { class: "warnbox" }, el("b", { text: "Uncommitted changes in zero. " }), "A generation puts back what it doesn't keep, so commit or stash them first: ", E.tree.slice(0, 4).join(", "), E.tree.length > 4 ? "…" : "") : null,
        running
          ? el("button", { class: "btn btn-ink", type: "button", onclick: () => api("POST", "zero/jobs/stop", {}).catch(fail) }, E.job.state === "stopping" ? "Stopping…" : "Stop run")
          : el("button", { class: "btn btn-primary", type: "button", disabled: blocked || !E.genome, onclick: startEvo }, { bench: "Run benchmark", generation: "Run generation", evolve: "Evolve" }[evoMode])),
      el("section", { class: "card" },
        el("div", { class: "lineage-head" }, el("h2", { text: "Output" }), el("span", { class: "hint", text: E.job ? `${E.job.request.kind} · ${E.job.state}` : "" })),
        log)),
    el("section", { class: "card" },
      el("h2", { text: "Attempts" }),
      E.attempts.length === 0
        ? el("p", { class: "hint", text: "No generations yet. The first one measures the genome, then tries to beat it." })
        : el("ol", { class: "attempts", reversed: true }, E.attempts.slice().reverse().map((a) => {
          const cost = a.childScore === null ? null : judgedCost(E, a.childId, a.at)
          return el("li", { class: `attempt${a.accepted ? " kept" : ""}` },
            el("span", { class: "gen", text: `gen ${a.generation}` }),
            el("span", {}, el("span", { class: "v", text: a.accepted ? "Kept" : "Turned down" }), a.summary),
            el("span", { class: "delta", text: `${pct(a.parentScore)} → ${a.childScore === null ? "—" : pct(a.childScore)}${cost === null ? "" : ` · ${usd(cost)}`}` }),
            el("span", { class: "why", text: a.reason }))
        })))
  )
  drawLineage(chart, E, running && E.job.request.kind !== "bench")
  log.scrollTop = log.scrollHeight
}
async function startEvo() {
  try {
    await api("POST", "zero/jobs", { kind: evoMode, generations: Number($("evo-gens")?.value) || 3, budgetUsd: Number($("evo-budget")?.value) || 25, reps: Number($("evo-reps")?.value) || 1 })
    toast(`${{ bench: "Benchmark", generation: "Generation", evolve: "Evolve" }[evoMode]} started.`)
    loadEvo()
  } catch (e) { fail(e) }
}
function logLine(text) {
  const m = /^\[([\w-]+)\](.*)$/.exec(text)
  const cls = text.startsWith("$ ") ? "l-cmd" : /accepted|committed/.test(text) ? "l-kept" : /^(gen \d+|genome |benchmark:|===)/.test(text) ? "l-gen" : ""
  return el("div", { class: cls }, m ? el("span", { class: "tag", text: m[1] }) : null, m ? m[2].trim() : text)
}

// Cost of a genome's benchmark run, from the ledger. Prefers the latest measurement
// over the current tasks with the current reps, then over the current tasks, then any.
/**
 * What a genome cost in the measurement a verdict was made on: its latest
 * measurement up to that attempt. Later re-measurements (a bigger benchmark,
 * more reps) mustn't rewrite what an old verdict compared.
 */
function judgedCost(E, id, at) {
  const m = E.measures.filter((x) => x.genomeId === id && x.at <= at).at(-1)
  return m ? m.costUsd : null
}

function genomeCost(E, id) {
  const ms = E.measures.filter((m) => m.genomeId === id)
  if (!ms.length) return null
  const ids = E.tasks.map((t) => t.id).sort().join("\n")
  const same = (m) => m.results.map((r) => r.id).sort().join("\n") === ids
  const pick = ms.filter((m) => same(m) && (m.reps ?? 1) === evoReps).at(-1) ?? ms.filter(same).at(-1) ?? ms.at(-1)
  return pick.costUsd
}

const NS = "http://www.w3.org/2000/svg"
const svg = (tag, attrs = {}) => { const n = document.createElementNS(NS, tag); for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, v); return n }
function drawLineage(box, E, live) {
  const atts = E.attempts
  const full = E.measures.filter((m) => m.genomeId === E.genome?.id && m.results.length === E.tasks.length)
  const start = atts.length ? atts[0].parentScore : full.length ? full[full.length - 1].score : null
  if (start === null) return box.append(el("div", { class: "chart-empty", text: "No score yet. A benchmark places the first point." }))
  requestAnimationFrame(() => {
    const W = Math.max(box.clientWidth, 300), H = box.clientHeight
    const n = atts.length + (live ? 1 : 0)
    // Cost labels for the start and each kept generation; turned-down and guard-stopped points stay quiet.
    const labels = [{ i: 0, s: start, c: atts.length ? judgedCost(E, atts[0].parentId, atts[0].at) : genomeCost(E, E.genome?.id) }]
    atts.forEach((a, k) => { if (a.accepted && a.childScore !== null) labels.push({ i: k + 1, s: a.childScore, c: judgedCost(E, a.childId, a.at) }) })
    const shown = labels.filter((l) => l.c !== null)
    const pad = { l: 36, r: 20, t: shown.length ? 26 : 12, b: 24 }
    const scores = [start, ...atts.flatMap((a) => (a.childScore === null ? [] : [a.childScore]))]
    const lo = Math.max(0, Math.floor((Math.min(...scores) - 0.02) * 10) / 10)
    const tick = 1 - lo <= 0.2 ? 0.05 : 1 - lo <= 0.5 ? 0.1 : 0.25
    const x = (i) => pad.l + (n === 0 ? (W - pad.l - pad.r) / 2 : (i / n) * (W - pad.l - pad.r))
    const y = (s) => pad.t + (1 - (s - lo) / (1 - lo || 1)) * (H - pad.t - pad.b)
    const root = svg("svg", { viewBox: `0 0 ${W} ${H}` })
    for (let s = 1; s >= lo - 1e-9; s -= tick) {
      root.append(svg("line", { class: "grid-line", x1: pad.l, x2: W - pad.r, y1: y(s), y2: y(s) }))
      const t = svg("text", { class: "axis", x: pad.l - 8, y: y(s) + 3, "text-anchor": "end" }); t.textContent = Math.round(s * 100); root.append(t)
    }
    const step = Math.max(1, Math.ceil(n / Math.max(1, Math.floor((W - pad.l - pad.r) / 56))))
    for (let i = step; i <= atts.length; i += step) { const t = svg("text", { class: "axis", x: x(i), y: H - 4, "text-anchor": "middle" }); t.textContent = W < 560 ? i : `gen ${i}`; root.append(t) }
    let cur = start
    const pts = [[x(0), y(cur)]]
    const marks = []
    atts.forEach((a, k) => {
      const i = k + 1
      if (a.accepted && a.childScore !== null) { pts.push([x(i), y(cur)], [x(i), y(a.childScore)]); cur = a.childScore; marks.push({ i, kind: "kept", s: cur }) }
      else { pts.push([x(i), y(cur)]); marks.push({ i, kind: a.childScore === null ? "guard" : "down", s: a.childScore, from: cur }) }
    })
    root.append(svg("path", { class: "lineage-path", d: pts.map(([a, b], j) => `${j ? "L" : "M"}${a},${b}`).join("") }))
    if (live) { const [lx, ly] = pts[pts.length - 1]; root.append(svg("line", { class: "next-path", x1: lx, y1: ly, x2: x(n), y2: y(cur) }), svg("circle", { class: "next", cx: x(n), cy: y(cur), r: 6 })) }
    root.append(svg("circle", { class: "node-start", cx: x(0), cy: y(start), r: 4.5 }))
    for (const m of marks) {
      const cx = x(m.i)
      if (m.kind === "kept") root.append(svg("circle", { class: "node-kept", cx, cy: y(m.s), r: 5.5 }))
      else if (m.kind === "down") root.append(svg("line", { class: "stub", x1: cx, x2: cx, y1: y(m.from), y2: y(m.s) }), svg("circle", { class: "node-down", cx, cy: y(m.s), r: 4 }))
      else { const gy = y(m.from) + 14; root.append(svg("line", { class: "guard", x1: cx - 3.5, y1: gy - 3.5, x2: cx + 3.5, y2: gy + 3.5 }), svg("line", { class: "guard", x1: cx - 3.5, y1: gy + 3.5, x2: cx + 3.5, y2: gy - 3.5 })) }
    }
    // Centered above the point, but clamped between the y-axis labels (which end at pad.l - 8)
    // and the right edge; a label that would collide with the previous one is skipped.
    let prev = null
    for (const l of shown) {
      const text = usd(l.c), half = text.length * 3.1 // 10px mono ≈ 6.2px per character
      const lx = Math.min(Math.max(x(l.i), pad.l + half), W - 2 - half)
      const ly = y(l.s) - 10
      if (prev && lx - half < prev.right + 4 && Math.abs(ly - prev.y) < 12) continue
      const t = svg("text", { class: "axis", x: lx, y: ly, "text-anchor": "middle" }); t.textContent = text; root.append(t)
      prev = { right: lx + half, y: ly }
    }
    box.replaceChildren(root)
  })
}

// ---------- live events ----------
let evoTimer = 0
function connect() {
  const es = new EventSource(`/api/events?token=${encodeURIComponent(TOKEN)}`)
  es.addEventListener("thread", (e) => {
    const meta = JSON.parse(e.data)
    const i = S.threads.findIndex((t) => t.id === meta.id)
    if (i >= 0) S.threads[i] = meta
    else S.threads.unshift(meta)
    S.threads.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
    if (meta.status !== "running") S.asking.delete(meta.id)
    if (S.open?.id === meta.id) {
      Object.assign(S.open, meta)
      if (feed && document.activeElement !== feed.title) feed.title.value = meta.title
      paintWorking()
    }
    renderSide()
  })
  es.addEventListener("threads", (e) => {
    S.threads = JSON.parse(e.data)
    if (S.open && !S.threads.some((t) => t.id === S.open.id)) go("#/")
    renderSide()
  })
  es.addEventListener("item", (e) => {
    const { threadId, item } = JSON.parse(e.data)
    if (item.kind === "permission") {
      item.state === "pending" ? S.asking.add(threadId) : S.asking.delete(threadId)
      renderSide()
      if (item.state === "pending" && S.open?.id !== threadId) toast(`A thread is waiting for your approval.`)
    }
    if (S.open?.id === threadId && feed) upsertItem(item)
  })
  es.addEventListener("delta", (e) => {
    const { threadId, itemId, delta } = JSON.parse(e.data)
    if (S.open?.id === threadId) applyDelta(itemId, delta)
  })
  es.addEventListener("projects", (e) => {
    S.projects = JSON.parse(e.data)
    renderSide()
    if (S.route.name === "home" || S.route.name === "new") renderMain()
  })
  es.addEventListener("settings", (e) => { S.settings = JSON.parse(e.data) })
  es.addEventListener("zero-log", (e) => {
    if (!S.evo) return
    const entry = JSON.parse(e.data)
    S.evo.log.push(entry)
    const log = $("evo-log")
    if (log) {
      if (S.evo.log.length === 1) log.replaceChildren()
      const stick = log.scrollHeight - log.scrollTop - log.clientHeight < 40
      log.append(logLine(entry.line))
      if (stick) log.scrollTop = log.scrollHeight
    }
  })
  const evoRefresh = () => { clearTimeout(evoTimer); evoTimer = setTimeout(() => S.route.name === "evolution" && loadEvo(), 300) }
  es.addEventListener("zero-job", (e) => {
    const j = JSON.parse(e.data)
    if (j.state === "done") toast("Evolution run finished.")
    if (j.state === "failed") toast("Evolution run failed. The output says why.", true)
    evoRefresh()
  })
  es.addEventListener("zero-state", evoRefresh)
  es.onerror = () => {
    es.close()
    setTimeout(() => boot(true), 2000)
  }
}

// ---------- keys ----------
document.addEventListener("keydown", (e) => {
  if ($("dialog").open) return
  const typing = e.target instanceof HTMLTextAreaElement || e.target instanceof HTMLInputElement || e.target instanceof HTMLSelectElement
  if (e.altKey && (e.key === "n" || e.key === "N")) {
    e.preventDefault()
    const pid = S.open?.projectId ?? S.route.projectId ?? S.projects[0]?.id
    if (pid) go(`#/new/${pid}`)
    return
  }
  if (e.key === "Escape" && S.open?.status === "running") {
    e.preventDefault()
    api("POST", `threads/${S.open.id}/stop`, {}).catch(fail)
    return
  }
  if (!typing && S.open && (e.key === "y" || e.key === "n")) {
    const ask = S.open.items.find((i) => i.kind === "permission" && i.state === "pending")
    if (ask) api("POST", `threads/${S.open.id}/permissions/${ask.id}`, { allow: e.key === "y" }).catch(fail)
  }
})
$("new-thread").addEventListener("click", () => {
  const pid = S.open?.projectId ?? S.route.projectId ?? S.projects[0]?.id
  pid ? go(`#/new/${pid}`) : addProject()
})
$("add-project").addEventListener("click", addProject)
addEventListener("resize", () => { if (S.route.name === "evolution" && S.evo) paintEvo() })
setInterval(() => renderSide(), 60_000)

// ---------- start ----------
async function boot(reconnect = false) {
  try {
    const b = await api("GET", "bootstrap")
    Object.assign(S, { settings: b.settings, projects: b.projects, threads: b.threads, providers: b.providers, home: b.home, zeroRoot: b.zeroRoot })
  } catch (e) {
    $("main").replaceChildren(el("div", { class: "start" }, el("div", { class: "start-inner" },
      el("h1", { text: "Can't reach zero" }),
      el("p", { class: "lede", text: `${e.message}. Start it with \`node src/cli.ts ui\`, then reload this page.` }))))
    if (reconnect) setTimeout(() => boot(true), 4000)
    return
  }
  connect()
  if (!location.hash) {
    const last = load("last", null)
    if (last && S.threads.some((t) => t.id === last)) return go(`#/t/${last}`)
  }
  route()
}
boot()
