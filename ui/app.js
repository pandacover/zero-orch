// zero control plane: projects, threads with Claude, settings, and zero's evolution.
// No framework: state in `S`, views rebuilt on navigation, live items patched in place.
"use strict"

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
  /** Threads where the person turned Compact off; it's on by default whenever it shows. */
  compactOff: new Set(),
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
  query: "", // the sidebar's search
  route: { name: "home" },
  evo: null
}
function load(key, fallback) {
  try { return JSON.parse(localStorage.getItem(`zero.${key}`)) ?? fallback } catch { return fallback }
}
function save(key, value) {
  try { localStorage.setItem(`zero.${key}`, JSON.stringify(value)) } catch {}
}

/** One call to the backend in the app's main process (src/app/Api.ts), through src/desktop/preload.cjs. */
async function api(method, path, body) {
  const { status, body: data } = await zero.call(method, path, body)
  if (status >= 400) throw new Error(data?.error || `request failed (${status})`)
  return data
}

function toast(text, error = false) {
  const t = el("div", { class: `toast${error ? " error" : ""}`, role: error ? "alert" : "status", text })
  const box = $("toasts")
  box.append(t)
  // Shown afresh so it lands above anything in the top layer (an open modal); put away when empty.
  if (box.matches(":popover-open")) box.hidePopover()
  box.showPopover()
  setTimeout(() => { t.remove(); if (!box.children.length && box.matches(":popover-open")) box.hidePopover() }, error ? 7000 : 3000)
}
const fail = (e) => toast(e.message, true)

// ---------- tooltips: shown at once, not after the browser's delay ----------
// Elements keep using `title`; on hover it moves to data-tip (so the native one never shows) and this one shows it.
// A manual popover: it shows in the top layer, so it stays above an open modal (Settings, a confirm).
const tip = el("div", { class: "tip", role: "tooltip", popover: "manual" })
document.body.append(tip)
let tipFor = null
const tipShown = () => tip.matches(":popover-open")
const hideTip = () => { if (tipShown()) tip.hidePopover(); tipFor = null }
/** Move an element's title into data-tip, keeping it as the accessible name when it's the only one. */
function adoptTitle(n) {
  const text = n.getAttribute("title")
  n.removeAttribute("title")
  if (text === null) return
  n.dataset.tip = text
  if (text && !n.hasAttribute("aria-label") && !n.textContent.trim()) n.setAttribute("aria-label", text)
}
function showTip(n) {
  const text = n.dataset.tip
  if (!text || !n.isConnected) return hideTip()
  tipFor = n
  tip.textContent = text
  // Shown afresh each time so it lands above anything that opened in the top layer since.
  if (tipShown()) tip.hidePopover()
  tip.showPopover()
  const r = n.getBoundingClientRect()
  const w = tip.offsetWidth
  const h = tip.offsetHeight
  const x = Math.max(8, Math.min(r.left + r.width / 2 - w / 2, innerWidth - w - 8))
  const below = r.bottom + 6
  tip.style.left = `${x}px`
  tip.style.top = `${below + h > innerHeight - 8 ? r.top - h - 6 : below}px`
}
document.addEventListener("pointerover", (e) => {
  const n = e.target.closest?.("[title], [data-tip]")
  if (!n) return hideTip()
  if (n.hasAttribute("title")) adoptTitle(n)
  if (n !== tipFor || !tipShown()) showTip(n)
})
document.addEventListener("pointerout", (e) => { if (tipFor && !tipFor.contains(e.relatedTarget)) hideTip() })
for (const type of ["pointerdown", "keydown", "wheel"]) document.addEventListener(type, hideTip, true)
addEventListener("scroll", hideTip, true)
// A title set while the page runs (Copy → Copied, a chip's new name) moves over too, and updates a tip that's showing.
new MutationObserver((records) => {
  for (const r of records) {
    if (!r.target.hasAttribute("title")) continue
    adoptTitle(r.target)
    if (r.target === tipFor) showTip(r.target)
  }
}).observe(document.body, { attributes: true, attributeFilter: ["title"], subtree: true })

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
  // Settings is a modal, not a page: an old #/settings link opens it over the home screen.
  if (S.route.name === "settings") {
    history.replaceState(null, "", "#/")
    S.route = { name: "home" }
    queueMicrotask(openSettings)
  }
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
  // Searching shows only the threads whose title matches (or every thread of a project whose name does), all expanded.
  const q = S.query.trim().toLowerCase()
  const byProject = new Map(S.projects.map((p) => [p.id, []]))
  for (const t of S.threads) byProject.get(t.projectId)?.push(t)
  // Pinned threads first, each group newest first as S.threads is.
  for (const list of byProject.values()) list.sort((a, b) => Number(Boolean(b.pinned)) - Number(Boolean(a.pinned)))
  const shown = S.projects.flatMap((p) => {
    const all = byProject.get(p.id) ?? []
    if (!q || p.name.toLowerCase().includes(q)) return [[p, all]]
    const hits = all.filter((t) => t.title.toLowerCase().includes(q))
    return hits.length ? [[p, hits]] : []
  })
  if (q && shown.length === 0) return tree.replaceChildren(el("p", { class: "tree-empty", text: `No threads match “${S.query.trim()}”.` }))
  tree.replaceChildren(...shown.map(([p, threads]) => {
    const closed = !q && S.collapsed.has(p.id)
    return el("section", { class: `proj${closed ? " closed" : ""}`, "data-id": p.id },
      el("div", { class: "proj-head" },
        el("button", { class: "proj-toggle", type: "button", "aria-expanded": String(!closed), title: p.path, onclick: () => toggleProject(p.id) },
          el("span", { class: "proj-name", text: p.name })),
        el("span", { class: "proj-actions" },
          el("button", { class: "icon-btn", type: "button", title: `New thread in ${p.name}`, "aria-label": `New thread in ${p.name}`, onclick: () => go(`#/new/${p.id}`) }, "+"),
          el("button", { class: "icon-btn", type: "button", title: `Remove ${p.name} from zero`, "aria-label": `Remove ${p.name}`, onclick: () => removeProject(p) }, "×"))),
      el("ul", { class: "threads", inert: closed },
        threads.length === 0
          ? el("li", { class: "none", text: "No threads yet" })
          : threads.map((t) => el("li", { class: `thread-row${t.pinned ? " pinned" : ""}` },
            el("a", { class: `thread-link${S.open?.id === t.id ? " active" : ""}`, href: `#/t/${t.id}`, "aria-current": S.open?.id === t.id ? "page" : null },
              t.status === "running" ? el("span", { class: S.asking.has(t.id) ? "ask-dot" : "run-dot", title: S.asking.has(t.id) ? "Waiting for your approval" : "Working" }) : null,
              t.pinned ? el("span", { class: "pin-mark", title: "Pinned", html: PIN_ICON }) : null,
              el("span", { class: "t", text: t.title }),
              el("span", { class: "age", text: ago(t.updatedAt) })),
            // Pinning and deleting live here, on the row's hover, rather than in the thread's header.
            el("button", { class: "icon-btn thread-pin", type: "button", title: t.pinned ? "Unpin thread" : "Pin to the top", "aria-label": `${t.pinned ? "Unpin" : "Pin"} ${t.title}`, "aria-pressed": String(Boolean(t.pinned)), html: PIN_ICON, onclick: () => api("PATCH", `threads/${t.id}`, { pinned: !t.pinned }).catch(fail) }),
            el("button", { class: "icon-btn thread-del", type: "button", title: "Delete thread", "aria-label": `Delete ${t.title}`, html: TRASH_ICON, onclick: () => deleteThread(t) })))))
  }))
  for (const a of document.querySelectorAll(".foot-link")) a.classList.toggle("active", a.dataset.route === S.route.name)
}
const PIN_ICON = '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9.5 2 14 6.5l-2 .5-2.5 2.5.5 3-1 1-3-3L3 13.5M5 9 2.5 6.5l1-1 3 .5L9 3.5z"/></svg>'
const TRASH_ICON = '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" aria-hidden="true"><path d="M2.5 4h11M6 4V2.5h4V4M4 4l.7 9.5h6.6L12 4M6.6 6.5v4.5M9.4 6.5v4.5"/></svg>'
async function deleteThread(t) {
  if (!(await dialog({ title: "Delete this thread?", text: "Its messages are deleted from zero. Changes it made to the project stay.", ok: "Delete thread" }))) return
  try {
    await api("DELETE", `threads/${t.id}`)
    if (S.open?.id === t.id) go("#/")
  } catch (e) { fail(e) }
}
function toggleProject(id) {
  S.collapsed.has(id) ? S.collapsed.delete(id) : S.collapsed.add(id)
  save("collapsed", [...S.collapsed])
  // Fold the section in place (not a re-render) so its height can ease shut or open.
  const section = [...$("tree").querySelectorAll(".proj")].find((s) => s.dataset.id === id)
  if (!section || S.query.trim()) return renderSide()
  const closed = S.collapsed.has(id)
  section.classList.toggle("closed", closed)
  section.querySelector(".proj-toggle").setAttribute("aria-expanded", String(!closed))
  section.querySelector(".threads").inert = closed
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
  // Off a thread, its Git panel goes (and stops looking).
  if (gitPanel) { clearInterval(gitPanel.timer); gitPanel = null }
  if (r.name === "evolution") return main.replaceChildren(evolutionView())
  const project = S.projects.find((p) => p.id === r.projectId) ?? S.projects[0]
  main.replaceChildren(startView(project))
}

const narrow = matchMedia("(max-width: 820px)")
/** The one sidebar toggle says what it will do. */
function paintToggle() {
  const shown = narrow.matches ? $("side").classList.contains("open") : !document.querySelector(".shell").classList.contains("side-hidden")
  const label = shown ? "Hide sidebar" : "Show sidebar"
  $("side-toggle").setAttribute("aria-label", label)
  $("side-toggle").setAttribute("aria-expanded", String(shown))
  $("side-toggle").title = label
}
function openSide() { $("side").classList.add("open"); $("scrim").hidden = false; paintToggle() }
function closeSide() { $("side").classList.remove("open"); $("scrim").hidden = true; paintToggle() }
/** Narrow: slide the sidebar over or away. Wide: hide or show it, remembered. */
function toggleSide() {
  if (narrow.matches) return $("side").classList.contains("open") ? closeSide() : openSide()
  const hidden = !document.querySelector(".shell").classList.contains("side-hidden")
  document.querySelector(".shell").classList.toggle("side-hidden", hidden)
  save("sideHidden", hidden)
  paintToggle()
  sideResized()
}
document.querySelector(".shell").classList.toggle("side-hidden", load("sideHidden", false))
$("scrim").addEventListener("click", closeSide)
$("side-toggle").addEventListener("click", toggleSide)
narrow.addEventListener("change", paintToggle)
paintToggle()
$("search").addEventListener("input", (e) => { S.query = e.target.value; renderSide() })
$("search").addEventListener("keydown", (e) => { if (e.key === "Escape" && e.target.value) { e.stopPropagation(); e.target.value = ""; S.query = ""; renderSide() } })

// ---------- sidebar width: drag the edge, arrow keys on it, double-click resets ----------
const SIDE = { min: 200, max: 480, base: 272 }
function setSideWidth(w, persist = true) {
  const width = Math.round(Math.min(SIDE.max, Math.max(SIDE.min, w)))
  document.querySelector(".shell").style.setProperty("--side-w", `${width}px`)
  $("side-resize").setAttribute("aria-valuenow", String(width))
  if (persist) save("sideWidth", width)
  return width
}
function sideResized() { if (S.route.name === "evolution" && S.evo) paintEvo() }
{
  const handle = $("side-resize")
  handle.setAttribute("aria-valuemin", String(SIDE.min))
  handle.setAttribute("aria-valuemax", String(SIDE.max))
  setSideWidth(load("sideWidth", SIDE.base), false)
  handle.addEventListener("pointerdown", (e) => {
    if (e.button !== 0) return
    e.preventDefault()
    handle.setPointerCapture(e.pointerId)
    const left = $("side").getBoundingClientRect().left
    document.body.classList.add("resizing")
    const move = (ev) => setSideWidth(ev.clientX - left, false)
    const up = (ev) => {
      handle.removeEventListener("pointermove", move)
      handle.removeEventListener("pointerup", up)
      handle.removeEventListener("pointercancel", up)
      document.body.classList.remove("resizing")
      setSideWidth(ev.clientX - left)
      sideResized()
    }
    handle.addEventListener("pointermove", move)
    handle.addEventListener("pointerup", up)
    handle.addEventListener("pointercancel", up)
  })
  handle.addEventListener("dblclick", () => { setSideWidth(SIDE.base); sideResized() })
  handle.addEventListener("keydown", (e) => {
    const step = e.shiftKey ? 48 : 16
    const now = Number(handle.getAttribute("aria-valuenow"))
    const next = { ArrowLeft: now - step, ArrowRight: now + step, Home: SIDE.min, End: SIDE.max }[e.key]
    if (next === undefined) return
    e.preventDefault()
    setSideWidth(next)
    sideResized()
  })
}

const PROVIDERS = [["claude", "Claude"], ["codex", "Codex"], ["ollama", "Ollama"]]
const providerLabel = (p) => PROVIDERS.find(([x]) => x === p)?.[1] ?? p
const status = (p) => S.providers[p]
const ACCESS = [
  ["ask", "Ask first", "Reads freely; asks before every edit and command."],
  ["auto-edit", "Auto-edit", "Reads and edits inside the project; asks before commands."],
  ["full-access", "Full access", "Reads, edits and runs commands without asking."],
  ["read-only", "Read-only", "Reads only. Nothing changes."]
]
const accessLabel = (a) => ACCESS.find(([v]) => v === a)?.[1] ?? a
/** Each provider's effort levels, as src/app/Model.ts's EFFORTS has them; "" is the provider's own default. */
const EFFORTS = {
  claude: [["low", "Low"], ["medium", "Medium"], ["high", "High"], ["xhigh", "Extra high"], ["max", "Max"]],
  codex: [["", "Default"], ["minimal", "Minimal"], ["low", "Low"], ["medium", "Medium"], ["high", "High"], ["xhigh", "Extra high"]],
  ollama: []
}
const defaultEffort = (p) => (p === "claude" ? S.settings.claude.effort : p === "codex" ? S.settings.codex.effort : "")
const effortLabel = (p, v) => EFFORTS[p]?.find(([x]) => x === v)?.[1] ?? ""

/** A model id as people say it: claude-opus-5-5 → Opus 5.5, gpt-5.5-codex → GPT-5.5 Codex, qwen2.5-coder:7b → Qwen2.5 Coder 7B. */
function modelName(id) {
  if (!id) return "Default"
  const cap = (w) => (w ? w[0].toUpperCase() + w.slice(1) : w)
  const claude = /^claude-([a-z]+)-(\d+)(?:-(\d{1,2}))?(?:-\d{8})?$/.exec(id)
  if (claude) return `${cap(claude[1])} ${claude[2]}${claude[3] ? `.${claude[3]}` : ""}`
  const gpt = /^gpt-([\d.]+[a-z]?)(?:-(.+))?$/i.exec(id)
  if (gpt) return `GPT-${gpt[1]}${gpt[2] ? ` ${gpt[2].split("-").map(cap).join(" ")}` : ""}`
  if (/^o\d/.test(id)) return id
  const [base, tag] = id.split(":")
  const words = base.split(/[-_]/).map(cap).join(" ")
  return tag && tag !== "latest" ? `${words} ${tag.toUpperCase()}` : words
}

/**
 * A composer chip that opens a panel above it. `paint()` fills the panel
 * while it's open. A click outside or Escape closes it; Up and Down move
 * within a column, Left and Right between columns.
 */
function popover({ name, panelClass }) {
  const label = el("span", { class: "pop-label" })
  const trigger = el("button", { class: "select chip pop-trigger", type: "button", "aria-haspopup": "dialog", "aria-expanded": "false" }, label)
  const panel = el("div", { class: `pop-panel ${panelClass}`, role: "dialog", "aria-label": name, hidden: true })
  const wrap = el("div", { class: "pop" }, trigger, panel)
  const pop = { wrap, trigger, label, panel, paint: () => {} }
  const outside = (e) => { if (!wrap.contains(e.target)) pop.close() }
  pop.open = () => {
    panel.hidden = false
    trigger.setAttribute("aria-expanded", "true")
    pop.paint()
    ;(panel.querySelector(".pop-item[aria-checked=true]:not(:disabled)") ?? panel.querySelector("button:not(:disabled)"))?.focus()
    document.addEventListener("pointerdown", outside, true)
  }
  pop.close = (refocus = false) => {
    if (panel.hidden) return
    panel.hidden = true
    trigger.setAttribute("aria-expanded", "false")
    document.removeEventListener("pointerdown", outside, true)
    if (refocus) trigger.focus()
  }
  /** Paint again, keeping focus on the same control. */
  pop.repaint = () => {
    if (panel.hidden) return
    const focused = document.activeElement?.closest?.(".pop-panel") === panel ? document.activeElement.dataset.key : null
    pop.paint()
    if (focused) panel.querySelector(`[data-key="${CSS.escape(focused)}"]`)?.focus()
  }
  trigger.addEventListener("click", () => (panel.hidden ? pop.open() : pop.close()))
  panel.addEventListener("keydown", (e) => {
    // Escape here closes the panel; it must not reach the page, where Escape stops a running turn.
    if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); pop.close(true); return }
    if (e.key === "y" || e.key === "n") e.stopPropagation()
    const cols = [...panel.querySelectorAll(".pop-col")].filter((c) => c.querySelector("button:not(:disabled)"))
    const col = document.activeElement?.closest?.(".pop-col")
    if ((e.key === "ArrowLeft" || e.key === "ArrowRight") && cols.length > 1 && col) {
      e.preventDefault()
      const next = cols[(cols.indexOf(col) + (e.key === "ArrowRight" ? 1 : -1) + cols.length) % cols.length]
      ;(next.querySelector(".pop-item[aria-checked=true]:not(:disabled)") ?? next.querySelector("button:not(:disabled)"))?.focus()
      return
    }
    if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return
    e.preventDefault()
    const all = [...(col ?? panel).querySelectorAll("button:not(:disabled)")]
    const i = all.indexOf(document.activeElement)
    all[(i + (e.key === "ArrowDown" ? 1 : -1) + all.length) % all.length]?.focus()
  })
  return pop
}

/** One row of a picker list: a check, a label, and optionally a line of help under it. */
const popItem = ({ key, on, text, help, mark, disabled, onPick }) =>
  el("button", { class: "pop-item", type: "button", role: "menuitemradio", "aria-checked": String(on), "data-key": key, disabled, onclick: () => !on && onPick() },
    el("span", { class: "pop-check", "aria-hidden": "true", text: on ? "✓" : "" }),
    mark ?? null,
    help ? el("span", { class: "pop-text" }, el("span", { text }), el("span", { class: "pop-help", text: help })) : el("span", { text }))

/**
 * The model, effort and permissions picker: one chip, one panel. Models on
 * the left grouped by provider, then the chosen provider's effort, then what
 * the agent may do without asking. Picking keeps the panel open.
 * `onChange(patch)` saves a model or effort pick and `onAccess(level)` a
 * permissions pick; a refused pick is put back by the caller with `set()` or
 * `setAccess()`.
 */
function modelPicker({ provider, model, effort, access, onChange, onAccess }) {
  const state = { provider, model, effort: effort ?? defaultEffort(provider), access, busy: false }
  const pop = popover({ name: "Model, effort and permissions", panelClass: "mp-panel" })
  const mark = el("span", { class: "ap-mark", "aria-hidden": "true" })
  pop.trigger.prepend(mark)
  const paintLabel = () => {
    const e = EFFORTS[state.provider]?.length ? effortLabel(state.provider, state.effort) : ""
    mark.dataset.level = state.access
    pop.label.textContent = e ? `${modelName(state.model)} · ${e}` : modelName(state.model)
    pop.trigger.title = `${providerLabel(state.provider)} · ${state.model}${e ? ` · ${e} effort` : ""}\n${accessLabel(state.access)}: ${ACCESS.find(([v]) => v === state.access)?.[2] ?? ""}`
  }
  const save = (patch) => {
    Object.assign(state, patch)
    paintLabel()
    pop.repaint()
    Promise.resolve(onChange?.(patch)).catch(() => {})
  }
  pop.paint = () => {
    const groups = PROVIDERS.flatMap(([p, name]) => {
      const st = status(p)
      const list = [...(st?.available ? st.models : [])]
      if (p === state.provider && state.model && !list.includes(state.model)) list.unshift(state.model)
      if (list.length) {
        return [el("div", { class: "pop-group", role: "group", "aria-label": name }, el("div", { class: "pop-head", text: name }),
          list.map((m) => {
            const on = p === state.provider && m === state.model
            return popItem({
              key: `${p}/${m}`, on, text: modelName(m), disabled: state.busy && !on,
              onPick: () => {
                const patch = { provider: p, model: m }
                // A provider change keeps the effort if the new one knows it, else takes its default.
                if (p !== state.provider && !EFFORTS[p].some(([v]) => v === state.effort)) patch.effort = defaultEffort(p)
                save(patch)
              }
            })
          }))]
      }
      // Turned on but not reachable: say why, so a missing group isn't a mystery.
      if (p !== "claude" && S.settings[p]?.enabled && st && !st.available) return [el("div", { class: "pop-group" }, el("div", { class: "pop-head", text: name }), el("div", { class: "pop-note", text: st.detail }))]
      return []
    })
    const levels = EFFORTS[state.provider] ?? []
    pop.panel.replaceChildren(
      el("div", { class: "pop-col mp-models" },
        state.busy ? el("div", { class: "pop-note", text: "Models switch once this turn ends." }) : null,
        el("div", { class: "pop-scroll", role: "menu", "aria-label": "Model" }, groups)),
      levels.length ? el("div", { class: "pop-col mp-effort", role: "menu", "aria-label": "Effort" },
        el("div", { class: "pop-head", text: "Effort" }),
        levels.map(([v, l]) => popItem({ key: `effort/${v}`, on: v === state.effort, text: l, onPick: () => save({ effort: v }) })),
        state.busy ? el("div", { class: "pop-note", text: "Applies from the next turn." }) : null) : null,
      // Permissions apply at once, even mid-turn. Each level's meaning is its tooltip.
      el("div", { class: "pop-col mp-access", role: "menu", "aria-label": "Permissions" },
        el("div", { class: "pop-head", text: "Permissions" }),
        ACCESS.map(([v, l, help]) => {
          const item = popItem({
            key: `access/${v}`, on: v === state.access, text: l,
            mark: el("span", { class: "ap-mark", "data-level": v, "aria-hidden": "true" }),
            onPick: () => {
              state.access = v
              paintLabel()
              pop.repaint()
              Promise.resolve(onAccess?.(v)).catch(() => {})
            }
          })
          item.title = help
          return item
        })))
    // Keep the chosen model in view when the list scrolls.
    pop.panel.querySelector(".mp-models .pop-item[aria-checked=true]")?.scrollIntoView({ block: "nearest" })
  }
  paintLabel()
  return {
    node: pop.wrap,
    value: () => ({ ...state }),
    set: (patch) => { Object.assign(state, patch); paintLabel(); pop.repaint() },
    setAccess: (v) => { if (v !== state.access) { state.access = v; paintLabel(); pop.repaint() } },
    setBusy: (b) => { if (state.busy !== b) { state.busy = b; pop.repaint() } }
  }
}

// ---------- new thread ----------
/** Things to ask, by kind. The pills above the list switch between them. */
const IDEAS = [
  ["Explore", '<circle cx="8" cy="8" r="6"/><path d="m10.5 5.5-1.6 3.4-3.4 1.6 1.6-3.4z"/>', [
    "Explain how this project is laid out",
    "Walk me through what happens when the main command runs",
    "What would trip up someone new to this code?",
    "List the TODOs and what each one would take"]],
  ["Test", '<path d="M6 2h4M6.5 2v4L3 13a1 1 0 0 0 .9 1.5h8.2A1 1 0 0 0 13 13L9.5 6V2"/><path d="M4.6 10h6.8"/>', [
    "Find what's untested and add tests",
    "Run the checks and fix what fails",
    "Write tests for the trickiest function here",
    "Find the slowest test and make it faster"]],
  ["Review", '<path d="M1.5 8S4 3.5 8 3.5 14.5 8 14.5 8 12 12.5 8 12.5 1.5 8 1.5 8z"/><circle cx="8" cy="8" r="2"/>', [
    "Review the last commit for bugs",
    "Look for security problems in how input is handled",
    "Find dead code that's safe to delete",
    "Check the error handling on the main paths"]],
  ["Fix", '<path d="M10.2 2.3a3.5 3.5 0 0 0-4.4 4.4L2 10.5V14h3.5l3.8-3.8a3.5 3.5 0 0 0 4.4-4.4l-2.2 2.2-2-.5-.5-2z"/>', [
    "Fix the type errors",
    "Tidy up the code I changed last",
    "Make the README match what the code does",
    "Upgrade a dependency that's behind and fix what breaks"]]
]
let ideaKind = load("ideaKind", "Explore")
const icon = (paths, cls = "") => el("span", { class: `ico ${cls}`, "aria-hidden": "true", html: `<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round">${paths}</svg>` })

function startView(project) {
  if (!project) {
    return el("div", { class: "main-col" },
      el("div", { class: "bar" }),
      el("div", { class: "start" }, el("div", { class: "start-inner" },
        el("h1", { text: "Add a project to start" }),
        el("p", { class: "lede", text: "A project is a folder on this machine. Threads in it can read, edit and run things there." }),
        el("button", { class: "btn btn-primary", type: "button", onclick: addProject }, "Add project"))))
  }
  const first = S.settings.defaultProvider
  const models = modelPicker({
    provider: first,
    model: first === "claude" ? S.settings.claude.model : first === "codex" ? (S.settings.codex.model || status("codex")?.models[0]) : (S.settings.ollama.model || status("ollama")?.models[0]),
    effort: defaultEffort(first),
    access: S.settings.defaultAccess,
    onChange: () => readyFor(models.value().provider)
  })
  const box = composer({
    controls: [models.node],
    onSend: async (text) => {
      const projectId = project.id
      const { provider, model, effort, access } = models.value()
      const t = await api("POST", "threads", { projectId, provider, model, effort, access })
      await api("POST", `threads/${t.id}/messages`, { text })
      go(`#/t/${t.id}`)
    }
  })
  const readyFor = (p) => {
    box.setReady(status(p)?.available === true,
      status(p)?.available ? `Ask ${providerLabel(p)} to do something in ${project.name}…` : `${providerLabel(p)} is turned off in Settings`)
    box.setAttach(status(p)?.tools !== false, `${providerLabel(p)} can't open files`)
  }
  readyFor(first)
  const ready = status(first)?.available
  const list = el("div", { class: "suggest", role: "list" })
  const kinds = el("div", { class: "kinds", role: "tablist", "aria-label": "Kinds of things to ask" })
  const paintIdeas = () => {
    const kind = IDEAS.find(([k]) => k === ideaKind) ?? IDEAS[0]
    ideaKind = kind[0]
    const ideas = kind[2]
    kinds.replaceChildren(...IDEAS.map(([k, paths]) => el("button", {
      class: "kind", type: "button", role: "tab", "aria-selected": String(k === ideaKind),
      onclick: () => { ideaKind = k; save("ideaKind", k); paintIdeas() }
    }, icon(paths), k)))
    list.replaceChildren(...ideas.map((idea) => el("button", { class: "suggest-item", type: "button", role: "listitem", onclick: () => box.fill(idea) }, idea)))
  }
  paintIdeas()
  return el("div", { class: "main-col" },
    el("div", { class: "bar bar-quiet" }, el("div", { class: "title-wrap" })),
    el("div", { class: "start" }, el("div", { class: "start-inner" },
      el("h1", {}, "What should we do in ", el("em", { text: project.name }), "?"),
      el("p", { class: "lede", text: ready
        ? `${providerLabel(first)} works in ${project.path}. It ${accessText(S.settings.defaultAccess)}${S.settings.memory.recall ? ", and singularity hands it the most similar past change here." : "."}`
        : `${providerLabel(first)} is turned off. Turn it on in Settings to start a thread.` }),
      kinds,
      list)),
    el("div", { class: "composer-wrap" }, box.node))
}
const accessText = (a) => ({ "ask": "asks before edits and commands", "auto-edit": "edits freely and asks before commands", "full-access": "edits and runs commands without asking", "read-only": "only reads" })[a]

// ---------- attachments ----------
/** Where a message's text marks an attached file; the server reads the same marker (src/app/Attachments.ts). */
const ATT = /\{\{att:(att_[a-z0-9]{6,32})\}\}/g
const MAX_FILE = 25 * 1024 * 1024
const fileUrl = (id) => `/attachments/${id}`
const isRaster = (mime) => /^image\/(png|jpeg|gif|webp|bmp)$/.test(mime ?? "")
const bytes = (n) => (n < 1024 ? `${n} B` : n < 1048576 ? `${Math.round(n / 1024)} KB` : `${(n / 1048576).toFixed(1)} MB`)
const FILE_PATHS = '<path d="M9 1.75H4.5a1.5 1.5 0 0 0-1.5 1.5v9.5a1.5 1.5 0 0 0 1.5 1.5h7a1.5 1.5 0 0 0 1.5-1.5V5.75z"/><path d="M9 1.75v4h4"/>'
const CLIP_PATHS = '<path d="m13.5 7.5-5.6 5.6a3.4 3.4 0 0 1-4.8-4.8l5.9-5.9a2.3 2.3 0 0 1 3.2 3.2l-5.8 5.8a1.1 1.1 0 0 1-1.6-1.6l5.2-5.2"/>'

/** A file as a small chip: a thumbnail (images) or a file mark, then its name. */
function attChip(tag, { name, mime, src, attrs = {} }) {
  return el(tag, { class: "att", ...attrs },
    isRaster(mime) && src ? el("img", { class: "att-thumb", src, alt: "" }) : icon(FILE_PATHS, "att-icon"),
    el("span", { class: "att-name", text: name }))
}
/** A sent message: its words, with each attached file as a chip where it was put. */
function userNodes(item) {
  const known = new Map((item.attachments ?? []).map((a) => [a.id, a]))
  const out = []
  let last = 0
  for (const m of item.text.matchAll(ATT)) {
    if (m.index > last) out.push(item.text.slice(last, m.index))
    const a = known.get(m[1])
    out.push(a
      ? attChip("a", { name: a.name, mime: a.mime, src: fileUrl(a.id), attrs: { href: fileUrl(a.id), target: "_blank", rel: "noopener", title: `${a.name} · ${bytes(a.size)}` } })
      : el("span", { class: "att gone", text: "a file" }))
    last = m.index + m[0].length
  }
  if (last < item.text.length) out.push(item.text.slice(last))
  return out
}

const COPY_ICON = '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round" aria-hidden="true"><rect x="5.5" y="5.5" width="8" height="8" rx="2"/><path d="M10.5 3.5v-.5A1.5 1.5 0 0 0 9 1.5H4A1.5 1.5 0 0 0 2.5 3v5A1.5 1.5 0 0 0 4 9.5h.5"/></svg>'
const CHECK_ICON = '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m3.5 8.5 3 3 6-7"/></svg>'
/** The row under a message that shows on hover: a copy button for `text()`, then any `extra` (a response's turn details). */
function msgActions(text, ...extra) {
  const copy = el("button", { class: "icon-btn msg-copy", type: "button", title: "Copy", "aria-label": "Copy message", html: COPY_ICON })
  copy.addEventListener("click", async (e) => {
    e.stopPropagation()
    try {
      await navigator.clipboard.writeText(text())
      copy.innerHTML = CHECK_ICON
      copy.title = "Copied"
      setTimeout(() => { copy.innerHTML = COPY_ICON; copy.title = "Copy" }, 1200)
    } catch { toast("Couldn't copy: the browser blocked the clipboard.", true) }
  })
  return el("div", { class: "msg-actions" }, copy, extra)
}
/** Quote a reply in the composer: the words selected in it, or all of it, as a `>` block to answer below. */
function quoteButton(item) {
  return el("button", { class: "icon-btn msg-quote", type: "button", title: "Quote in your reply (the selection, or all of it)", "aria-label": "Quote message", html: QUOTE_ICON,
    // Keep the selection: pressing the button mustn't clear it before the click reads it.
    onmousedown: (e) => e.preventDefault(),
    onclick: (e) => {
      e.stopPropagation()
      const message = e.currentTarget.closest(".msg")
      const sel = getSelection()
      const picked = sel && !sel.isCollapsed && message?.contains(sel.anchorNode) && message.contains(sel.focusNode) ? sel.toString() : ""
      const words = (picked || item.text).trim()
      const cut = words.length > 1500 ? `${words.slice(0, 1500).trimEnd()}…` : words
      feed?.composer.quote(cut.split("\n").map((l) => `> ${l}`.trimEnd()).join("\n"))
    } })
}
const QUOTE_ICON = '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" aria-hidden="true"><path d="M3 4.5h10M3 8h7M3 11.5h10M1.5 3v10"/></svg>'

/** A sent message as words, each attached file by its name. */
function plainText(item) {
  const known = new Map((item.attachments ?? []).map((a) => [a.id, a]))
  return item.text.replace(ATT, (_, id) => known.get(id)?.name ?? "a file")
}
/** A sent message: click it (or Enter on it) to edit it and send it again. */
/** How many lines of a sent prompt show before Show more. */
const USER_LINES = 5
function userMessage(item) {
  // A long prompt shows its first 5 lines; Show more opens the rest (and stays open while the page is).
  const body = el("div", { class: "msg-user-body" }, userNodes(item))
  const key = `msg:${item.id}`
  const more = el("button", { class: "msg-more", type: "button", hidden: true })
  const bubble = el("div", { class: "msg-user", tabindex: "0" }, body, more)
  const paintMore = () => {
    const open = S.expanded.has(key)
    const lines = parseFloat(getComputedStyle(body).lineHeight) * USER_LINES
    more.hidden = !(body.scrollHeight > lines + 2)
    bubble.classList.toggle("clamped", !more.hidden && !open)
    // Opened in full, it reads in the feed: not stuck to the top, not scrolling inside itself.
    bubble.parentElement?.classList.toggle("expanded", !more.hidden && open)
    more.textContent = open ? "Show less" : "Show more"
    more.setAttribute("aria-expanded", String(open))
  }
  more.addEventListener("click", (e) => {
    e.stopPropagation() // not an edit
    S.expanded.has(key) ? S.expanded.delete(key) : S.expanded.add(key)
    paintMore()
  })
  new ResizeObserver(paintMore).observe(body)
  const wrap = el("div", { class: "msg msg-u" }, bubble, msgActions(() => plainText(item)))
  const start = () => { if (!wrap.classList.contains("editing")) editMessage(item, wrap, bubble) }
  bubble.addEventListener("click", (e) => {
    // A file chip opens the file; a drag that selected words is for copying them.
    if (e.target.closest("a") || String(getSelection()).length) return
    start()
  })
  bubble.addEventListener("keydown", (e) => { if (e.key === "Enter" && e.target === bubble) { e.preventDefault(); start() } })
  return wrap
}
/**
 * Edit a sent message in place. The agent's history can't be rewound, so
 * sending the edit posts it as a new message at the end of the thread.
 */
function editMessage(item, wrap, bubble) {
  const known = new Map((item.attachments ?? []).map((a) => [a.id, a]))
  const nodes = []
  let last = 0
  for (const m of item.text.matchAll(ATT)) {
    if (m.index > last) nodes.push(item.text.slice(last, m.index))
    const a = known.get(m[1])
    // Chips keep their file: serialize() turns each back into its marker.
    if (a) nodes.push(attChip("span", { name: a.name, mime: a.mime, src: fileUrl(a.id), attrs: { contenteditable: "false", "data-att": a.id, title: a.name } }))
    last = m.index + m[0].length
  }
  if (last < item.text.length) nodes.push(item.text.slice(last))
  const input = el("div", { class: "msg-edit-input", contenteditable: "true", role: "textbox", "aria-multiline": "true", "aria-label": "Edit message" }, nodes)
  const cancel = el("button", { class: "btn btn-quiet btn-sm", type: "button", text: "Cancel" })
  const send = el("button", { class: "btn btn-primary btn-sm", type: "button", text: "Send" })
  const editor = el("div", { class: "msg-edit" }, input,
    el("div", { class: "msg-edit-foot" }, el("span", { class: "hint", text: "Sends as a new message · Esc cancels" }), cancel, send))
  const close = () => {
    editor.replaceWith(bubble)
    wrap.classList.remove("editing")
    bubble.focus({ preventScroll: true })
  }
  const submit = async () => {
    const text = serialize(input).trim()
    if (!text || send.disabled) return
    send.disabled = true
    try {
      await api("POST", `threads/${S.open.id}/messages`, { text })
      close()
    } catch (e) { send.disabled = false; fail(e) }
  }
  input.addEventListener("input", () => { send.disabled = serialize(input).trim() === "" })
  input.addEventListener("keydown", (e) => {
    if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); close() }
    else if (e.key === "Enter" && !e.shiftKey && !e.isComposing) { e.preventDefault(); submit() }
  })
  input.addEventListener("paste", (e) => {
    e.preventDefault()
    const text = e.clipboardData?.getData("text/plain") ?? ""
    if (text) document.execCommand("insertText", false, text)
  })
  cancel.addEventListener("click", close)
  send.addEventListener("click", submit)
  wrap.classList.add("editing")
  bubble.replaceWith(editor)
  input.focus()
  const r = document.createRange()
  r.selectNodeContents(input)
  r.collapse(false)
  getSelection().removeAllRanges()
  getSelection().addRange(r)
}
async function upload(file) {
  const { status, body: data } = await zero.upload(file.name || "", file.type || "application/octet-stream", new Uint8Array(await file.arrayBuffer()))
  if (status >= 400) throw new Error(data?.error || `couldn't attach ${file.name || "the file"} (${status})`)
  return data
}

/** Keep a sent prompt for Up-arrow recall: its words only (files don't come back), newest first, 50 at most. */
function remember(text) {
  const words = text.replace(ATT, "").trim()
  if (!words) return
  const past = load("prompts", []).filter((p) => p !== words)
  save("prompts", [words, ...past].slice(0, 50))
}

/** The editor's content as text: line breaks as "\n", each file chip as its marker. */
function serialize(root) {
  let out = ""
  const walk = (n) => {
    for (const c of n.childNodes) {
      if (c.nodeType === Node.TEXT_NODE) { out += c.nodeValue.replace(/​/g, ""); continue }
      if (c.nodeType !== Node.ELEMENT_NODE) continue
      if (c.classList.contains("att")) { if (c.dataset.att) out += `{{att:${c.dataset.att}}}`; continue }
      if (c.tagName === "BR") { out += "\n"; continue }
      // A block the browser made for a new line starts on one.
      if (/^(DIV|P|LI)$/.test(c.tagName) && out && !out.endsWith("\n")) out += "\n"
      walk(c)
    }
  }
  walk(root)
  return out.replace(/ /g, " ")
}

// ---------- composer ----------
/**
 * The message box. It's an editable div rather than a textarea so a file
 * can sit among the words: paste one, drop one, or pick one with Attach and
 * it lands as a chip where the caret was. Each file uploads as it lands;
 * Send waits until they all have.
 */
function composer({ onSend, onStop, controls = [], running = false, disabled = false }) {
  const input = el("div", { class: "input empty", contenteditable: disabled ? "false" : "true", role: "textbox", "aria-multiline": "true", "aria-label": "Message", "data-placeholder": "" })
  const picker = el("input", { type: "file", multiple: true, hidden: true, tabindex: "-1" })
  const attach = el("button", { class: "pill-btn", type: "button", title: "Attach files. You can paste or drop them too." }, icon(CLIP_PATHS), el("span", { text: "Attach" }))
  const send = el("button", { class: "send", type: "button" })
  const hint = el("span", { class: "hint" })
  let busy = running
  let canAttach = true
  let range = null // where the caret last was inside the box

  const uploading = () => input.querySelector('.att[data-state="uploading"]') !== null
  const empty = () => !input.querySelector(".att") && serialize(input).trim() === ""
  const paint = () => {
    send.className = `send${busy ? " stop" : ""}`
    send.title = busy ? "Stop (Esc)" : uploading() ? "Waiting for files to upload" : "Send (Enter)"
    send.setAttribute("aria-label", busy ? "Stop" : "Send")
    send.innerHTML = busy
      ? '<svg viewBox="0 0 16 16" aria-hidden="true"><rect x="4" y="4" width="8" height="8" rx="1.5" fill="currentColor"/></svg>'
      : '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M8 13V3M3.5 7.5 8 3l4.5 4.5"/></svg>'
    send.disabled = !busy && (disabled || empty() || uploading())
    attach.disabled = disabled || !canAttach
    hint.textContent = busy ? "Working. Esc stops it." : ""
    hint.hidden = !busy
  }
  /** After any change: an empty box is truly empty (so its placeholder shows). */
  const sync = () => {
    const isEmpty = empty()
    // Clear only what the browser leaves behind (a stray <br>), never a space or line the person typed.
    if (isEmpty && input.textContent === "" && input.childNodes.length) input.replaceChildren()
    input.classList.toggle("empty", isEmpty)
    paint()
  }
  const track = () => {
    if (!input.isConnected) return document.removeEventListener("selectionchange", track)
    const s = getSelection()
    if (s.rangeCount && input.contains(s.anchorNode)) range = s.getRangeAt(0).cloneRange()
  }
  document.addEventListener("selectionchange", track)
  const caretTo = (r) => {
    const s = getSelection()
    s.removeAllRanges()
    s.addRange(r)
    range = r.cloneRange()
  }
  /** Put nodes where the caret was (the end if it never was in the box), and the caret after them. */
  const insert = (nodes) => {
    input.focus()
    let r = range && input.contains(range.startContainer) ? range : null
    if (!r) { r = document.createRange(); r.selectNodeContents(input); r.collapse(false) }
    r.deleteContents()
    const frag = document.createDocumentFragment()
    frag.append(...nodes)
    r.insertNode(frag)
    const after = document.createRange()
    after.setStartAfter(nodes.at(-1))
    after.collapse(true)
    caretTo(after)
  }
  const addFiles = (files) => {
    if (disabled) return
    if (!canAttach) return toast(attach.title, true)
    const nodes = []
    for (const file of files) {
      if (file.size > MAX_FILE) { toast(`${file.name} is over 25 MB, too big to attach.`, true); continue }
      const local = isRaster(file.type) ? URL.createObjectURL(file) : null
      const chip = attChip("span", { name: file.name || "pasted file", mime: file.type, src: local, attrs: { contenteditable: "false", "data-state": "uploading", title: "Uploading…" } })
      const x = el("button", { class: "att-x", type: "button", tabindex: "-1", "aria-label": `Remove ${file.name || "file"}`, title: "Remove", text: "×" })
      x.addEventListener("mousedown", (e) => e.preventDefault()) // keep the caret in the box
      x.addEventListener("click", () => {
        const next = chip.nextSibling
        if (next?.nodeType === Node.TEXT_NODE && next.nodeValue === " ") next.remove()
        chip.remove()
        sync()
      })
      chip.append(x)
      nodes.push(chip, document.createTextNode(" "))
      // The preview gives way to the server's copy once it's there.
      upload(file).then((a) => {
        if (local) { chip.querySelector(".att-thumb").src = fileUrl(a.id); URL.revokeObjectURL(local) }
        chip.dataset.att = a.id
        delete chip.dataset.state
        chip.title = `${a.name} · ${bytes(a.size)}`
        chip.querySelector(".att-name").textContent = a.name
        paint()
      }, (e) => {
        if (local) URL.revokeObjectURL(local)
        chip.nextSibling?.nodeValue === " " && chip.nextSibling.remove()
        chip.remove()
        fail(e)
        sync()
      })
    }
    if (nodes.length) { insert(nodes); sync() }
  }

  const submit = async () => {
    if (busy) return onStop?.()
    if (disabled || uploading() || empty()) return
    const text = serialize(input).trim()
    send.disabled = true
    try {
      await onSend(text)
      input.replaceChildren()
      range = null
      remember(text)
    } catch (e) { fail(e) }
    sync()
  }

  // Up in an empty box brings back what was sent before, newest first; Down goes forward again.
  // Typing into a recalled prompt makes it a draft: the arrows move the caret again.
  let recalled = -1
  let recalling = false
  const recall = (step) => {
    const past = load("prompts", [])
    const next = recalled + step
    if (next < -1 || next >= past.length) return false
    recalled = next
    recalling = true
    input.replaceChildren()
    input.focus()
    if (next >= 0) document.execCommand("insertText", false, past[next])
    recalling = false
    sync()
    return true
  }
  input.addEventListener("input", () => { if (!recalling) recalled = -1; sync() })
  input.addEventListener("keydown", (e) => {
    // Shift+Enter is left to the browser: it breaks the line.
    if (e.key === "Enter" && !e.shiftKey && !e.isComposing) { e.preventDefault(); submit(); return }
    const plain = !e.shiftKey && !e.altKey && !e.ctrlKey && !e.metaKey && !e.isComposing
    if (plain && (e.key === "ArrowUp" || e.key === "ArrowDown") && (recalled >= 0 || empty())) {
      if (recall(e.key === "ArrowUp" ? 1 : -1)) e.preventDefault()
    }
  })
  input.addEventListener("paste", (e) => {
    const files = [...(e.clipboardData?.files ?? [])]
    e.preventDefault()
    if (files.length) return addFiles(files)
    // Words only: what was copied from a page keeps none of its markup.
    const text = e.clipboardData?.getData("text/plain") ?? ""
    if (text) document.execCommand("insertText", false, text)
  })
  const node = el("div", { class: "composer" })
  node.addEventListener("dragover", (e) => {
    if (disabled || !e.dataTransfer?.types.includes("Files")) return
    e.preventDefault()
    node.classList.add("drop")
  })
  node.addEventListener("dragleave", (e) => { if (!node.contains(e.relatedTarget)) node.classList.remove("drop") })
  // Dropped files land where they were dropped (when that's inside the box); dropped text is the browser's.
  node.addEventListener("drop", (e) => {
    node.classList.remove("drop")
    const files = [...(e.dataTransfer?.files ?? [])]
    if (!files.length) return
    e.preventDefault()
    const at = document.caretRangeFromPoint?.(e.clientX, e.clientY)
      ?? (() => { const p = document.caretPositionFromPoint?.(e.clientX, e.clientY); if (!p) return null; const r = document.createRange(); r.setStart(p.offsetNode, p.offset); return r })()
    if (at && input.contains(at.startContainer)) range = at
    addFiles(files)
  })
  attach.addEventListener("click", () => picker.click())
  picker.addEventListener("change", () => {
    const files = [...picker.files]
    picker.value = ""
    if (files.length) addFiles(files)
  })
  send.addEventListener("mousedown", (e) => e.preventDefault())
  send.addEventListener("click", submit)
  // Attach on the left; the model picker sits on the right, beside Send.
  node.append(input, el("div", { class: "composer-foot" }, el("div", { class: "composer-controls" }, attach), hint, el("div", { class: "composer-end" }, controls, send)), picker)
  paint()
  queueMicrotask(() => !disabled && input.focus())
  return {
    node,
    setBusy: (b) => { busy = b; paint() },
    /** Whether the thread's provider can take a message now, and what the empty box says. */
    setReady: (ready, text) => {
      disabled = !ready
      input.contentEditable = ready ? "true" : "false"
      input.dataset.placeholder = text
      paint()
    },
    /** Whether the provider can open files; `why` says so on the Attach button when it can't. */
    setAttach: (can, why = "") => {
      canAttach = can
      attach.title = can ? "Attach files. You can paste or drop them too." : why
      paint()
    },
    /** Add a quoted block at the end of what's written, and put the caret below it. */
    quote: (block) => {
      input.focus()
      const r = document.createRange()
      r.selectNodeContents(input)
      r.collapse(false)
      caretTo(r)
      document.execCommand("insertText", false, `${empty() ? "" : "\n\n"}${block}\n\n`)
      sync()
    },
    fill: (text) => {
      input.textContent = text
      sync()
      input.focus()
      const r = document.createRange()
      r.selectNodeContents(input)
      r.collapse(false)
      caretTo(r)
    }
  }
}

// ---------- thread ----------
let feed = null // { node, scroll, nodes: Map, working, composer, stick }
function threadView(t) {
  const project = S.projects.find((p) => p.id === t.projectId)
  const title = el("input", { class: "title", value: t.title, "aria-label": "Thread title", maxlength: 120 })
  title.addEventListener("keydown", (e) => { if (e.key === "Enter") title.blur(); if (e.key === "Escape") { title.value = t.title; title.blur() } })
  title.addEventListener("change", () => api("PATCH", `threads/${t.id}`, { title: title.value }).catch(fail))
  // Picks save quietly; the server's answer (the thread event) is the record. A refused pick goes back.
  const current = () => ({ provider: t.provider, model: t.model, effort: t.effort ?? defaultEffort(t.provider) })
  const models = modelPicker({
    ...current(),
    access: t.access,
    onChange: (patch) => api("PATCH", `threads/${t.id}`, patch).catch((e) => { models.set(current()); fail(e) }),
    onAccess: (value) => api("PATCH", `threads/${t.id}`, { access: value }).catch((e) => { models.setAccess(t.access); fail(e) })
  })
  const list = el("div", { class: "feed", role: "log", "aria-live": "polite" })
  const working = el("div", { class: "working", hidden: true }, el("i"), el("i"), el("i"), el("span", { text: "Working" }))
  const scroll = el("div", { class: "scroll" }, list)
  // Compact: shown when the context is filling. On, the next message waits while the session compacts first.
  const compact = el("button", { class: "pill-btn compact-toggle", type: "button", role: "switch", onclick: () => {
    S.compactOff.has(t.id) ? S.compactOff.delete(t.id) : S.compactOff.add(t.id)
    paintCompact(S.open)
  } }, el("span", { class: "compact-knob", "aria-hidden": "true" }), el("span", { text: "Compact" }))
  const box = composer({
    running: t.status === "running",
    controls: [compact, models.node],
    onSend: (text) => api("POST", `threads/${t.id}/messages`, { text, compact: compactOn(S.open) }),
    onStop: () => api("POST", `threads/${t.id}/stop`, {}).catch(fail)
  })
  const queued = el("div", { class: "queued", hidden: true })
  feed = { list, scroll, cache: new Map(), groups: new Map(), turns: new Map(), working, queued, composer: box, stick: true, models, title, compact }
  paintReady(t)
  scroll.addEventListener("scroll", () => { feed.stick = scroll.scrollHeight - scroll.scrollTop - scroll.clientHeight < 60 })
  renderFeed()
  paintWorking()
  requestAnimationFrame(() => { scroll.scrollTop = scroll.scrollHeight })
  const git = makeGitPanel(t)
  return [
    el("div", { class: "thread-cols" },
      el("div", { class: "main-col" },
        el("div", { class: "bar" },
          // One line: the project (click it for a new thread there), a middle dot, the thread's title (editable in place).
          el("div", { class: "title-wrap title-line" },
            project
              ? el("button", { class: "title-project", type: "button", title: `New thread in ${project.name}\n${project.path}`, onclick: () => go(`#/new/${project.id}`) }, project.name)
              : el("span", { class: "title-project gone", text: "removed project" }),
            el("span", { class: "title-sep", "aria-hidden": "true", text: "·" }),
            title)),
        scroll,
        el("div", { class: "composer-wrap" }, box.node)),
      git.node,
      git.toggle)
  ]
}

/** The composer takes messages only when the thread's provider is available; switching provider can change that. */
function paintReady(t) {
  const ready = status(t.provider)?.available === true
  feed.composer.setReady(ready, ready ? "Reply…" : `${providerLabel(t.provider)} is turned off in Settings`)
  feed.composer.setAttach(status(t.provider)?.tools !== false, `${providerLabel(t.provider)} can't open files`)
  paintCompact(t)
}

/**
 * When the context is this full (of where the provider compacts on its own), Compact shows in the
 * composer. The server keeps the same number (COMPACT_SOON, src/app/Model.ts).
 */
const COMPACT_SOON = 0.7
const needsCompaction = (t) => !!t?.context && t.context.limit > 0 && t.context.used >= COMPACT_SOON * t.context.limit
/** A thread left this long has a cold cache: compacting first makes the next turn cheaper. Same as IDLE_COMPACT_MS on the server. */
const IDLE_COMPACT_MS = 60 * 60 * 1000
const idleMs = (t) => { const at = t?.items?.at(-1)?.at; return at ? Date.now() - Date.parse(at) : 0 }
const idleLong = (t) => t?.status !== "running" && idleMs(t) >= IDLE_COMPACT_MS
/** Compact shows only for a provider that takes `/compact`, in a session whose context is filling or that has sat idle an hour. */
const compactShown = (t) => !!t && status(t.provider)?.compaction === "manual" && !!t.resume && (needsCompaction(t) || idleLong(t))
const compactOn = (t) => compactShown(t) && !S.compactOff.has(t.id)
function paintCompact(t) {
  if (!feed?.compact || !t) return
  const shown = compactShown(t)
  feed.compact.hidden = !shown
  if (!shown) return
  const on = !S.compactOff.has(t.id)
  const hours = Math.floor(idleMs(t) / IDLE_COMPACT_MS)
  const why = needsCompaction(t)
    ? `Context ${Math.round((t.context.used / t.context.limit) * 100)}% full.`
    : `Idle for ${hours} hour${hours === 1 ? "" : "s"}: the next message would reload the whole thread.`
  feed.compact.setAttribute("aria-checked", String(on))
  feed.compact.classList.toggle("on", on)
  feed.compact.title = on
    ? `${why} Your next message waits while ${providerLabel(t.provider)} compacts this thread, then runs. Click to send as is.`
    : `${why} Your next message is sent as is; ${providerLabel(t.provider)} still compacts on its own when the context is full. Click to compact first.`
}

function paintWorking() {
  if (!feed || !S.open) return
  const running = S.open.status === "running"
  const asking = S.open.items.some((i) => i.kind === "permission" && i.state === "pending")
  feed.working.hidden = !running || asking
  // While a compaction runs, the working line says so (its card in the feed shows the detail).
  const compacting = running && S.open.items.some((i) => i.kind === "compact" && i.state === "running")
  feed.working.querySelector("span").textContent = compacting ? "Compacting context" : "Working"
  // A message waiting for the session to compact first.
  feed.queued.hidden = !S.open.queued
  if (S.open.queued && feed.queued.dataset.text !== S.open.queued) {
    feed.queued.dataset.text = S.open.queued
    feed.queued.replaceChildren(el("span", { class: "queued-label", text: "Queued · runs once the context is compacted" }), el("div", { class: "queued-text", text: S.open.queued }))
  }
  feed.list.append(feed.queued, feed.working)
  feed.composer.setBusy(running)
  feed.models.setBusy(running)
  paintCompact(S.open)
}
const follow = () => { if (feed?.stick) feed.scroll.scrollTop = feed.scroll.scrollHeight }

/** An item's node, rendered again only when the item itself was replaced. */
function nodeFor(item) {
  const known = feed.cache.get(item.id)
  if (known && known.item === item) return known.node
  const node = renderItem(item)
  node.dataset.id = item.id
  feed.cache.set(item.id, { item, node })
  return node
}
/** Make `parent`'s children exactly `nodes`, moving only what's out of place (text selections survive). */
function reconcile(parent, nodes) {
  nodes.forEach((n, i) => { if (parent.children[i] !== n) parent.insertBefore(n, parent.children[i] ?? null) })
  while (parent.children.length > nodes.length) parent.lastElementChild.remove()
}
/** Tool calls, and the approvals already answered between them, fold into one row. */
const foldable = (item) => (item.kind === "tool" && !memoryRead(item)) || (item.kind === "permission" && item.state !== "pending")
/**
 * A command the agent ran to read singularity's memory mid-task (`singularity recall "…"` or
 * `singularity changes`). It isn't folded away with the other tools: it shows as a memory card.
 */
const memoryRead = (item) =>
  item.kind === "tool" && (item.name === "Bash" || item.name === "Shell") && MEMORY_COMMAND.test((item.detail ?? "").trim())
/** The command alone (maybe after a `cd`, maybe wrapped in a shell, as Codex runs it), with nothing piped or chained. */
const MEMORY_COMMAND = /^(?:cd\s+("[^"]*"|\S+)\s*&&\s*)?(?:(?:bash|sh|pwsh|powershell(?:\.exe)?)(?:\s+-\w+)*\s+["']?)?singularity (?:recall|changes)\b[^|;&<>`]*$/

/**
 * The feed: the text of the conversation, with each run of tool calls
 * collapsed to one row that shows the last tool to run. Open a row to see
 * every call in it, and open a call to see its output.
 */
function renderFeed() {
  const { finals, metaFor, merged } = turnEnds()
  const top = []
  let run = null
  for (const item of S.open.items) {
    if (merged.has(item.id)) continue // its details ride in the answer's action row instead
    if (!foldable(item)) { run = null; top.push(item); continue }
    if (!run) top.push(run = { key: item.id, items: [] })
    run.items.push(item)
  }
  const groups = new Map()
  // Each turn (a message of yours and everything after it, up to your next) is one block, so your
  // message can stick to the top while its turn scrolls by, until the next turn's pushes it away.
  const turns = []
  for (const x of top) {
    const node = x.items ? toolGroup(x, groups) : nodeFor(x)
    if (!turns.length || (!x.items && x.kind === "user")) turns.push({ key: x.items ? x.key : x.id, nodes: [] })
    turns.at(-1).nodes.push(node)
  }
  feed.groups = groups
  const sections = turns.map(({ key, nodes }) => {
    let section = feed.turns.get(key)
    if (!section) feed.turns.set(key, (section = el("section", { class: "turn" })))
    reconcile(section, nodes)
    return section
  })
  reconcile(feed.list, [...sections, feed.queued, feed.working])
  // Only a turn's last agent response (its answer, not the narration between tool calls) has the
  // action row, and the turn's details (model, time, cost, tokens) sit in that row beside Copy.
  for (const [id, { node }] of feed.cache) {
    if (!node.classList.contains("msg-a")) continue
    node.classList.toggle("final", finals.has(id))
    const turn = metaFor.get(id)
    const slot = node.querySelector(".msg-meta")
    if (slot.dataset.turn !== (turn?.id ?? "")) { slot.dataset.turn = turn?.id ?? ""; slot.replaceChildren(...(turn ? turnMeta(turn) : [])) }
  }
}
/**
 * Where each turn ends: `finals` are the last agent responses of turns; `metaFor` pairs such a
 * response with its turn's details, and `merged` holds those turn items so they aren't drawn twice.
 * A turn that failed keeps its own error line; one with no response keeps its details line.
 */
function turnEnds() {
  const finals = new Set(), metaFor = new Map(), merged = new Set()
  let last = null
  for (const item of S.open.items) {
    if (item.kind === "assistant") last = item.id
    else if (item.kind === "user" || item.kind === "turn") {
      if (last) finals.add(last)
      if (item.kind === "turn" && last && item.outcome !== "failed") { metaFor.set(last, item); merged.add(item.id) }
      last = null
    }
  }
  if (last) finals.add(last)
  return { finals, metaFor, merged }
}
/** A turn's details: Stopped (if it was), the model, how long it took, what it cost, its tokens. */
function turnMeta(item) {
  const meta = [modelName(item.model), `${(item.durationMs / 1000).toFixed(1)}s`, item.costUsd !== null ? usd(item.costUsd) : null, item.tokens ? `${(item.tokens / 1000).toFixed(1)}k tokens` : null].filter(Boolean)
  return [item.outcome === "stopped" ? el("span", { class: "stopped", text: "Stopped" }) : null, ...meta.map((m) => el("span", { text: m }))].filter(Boolean)
}
function toolGroup(run, groups) {
  let g = feed.groups.get(run.key)
  if (!g) {
    const head = el("button", { class: "tool-row tool-group-head", type: "button" })
    const body = el("div", { class: "tool-group-body" })
    g = { head, body, node: el("div", { class: "tool-group" }, head, body) }
    head.addEventListener("click", () => {
      const open = !S.expanded.has(`group:${run.key}`)
      open ? S.expanded.add(`group:${run.key}`) : S.expanded.delete(`group:${run.key}`)
      paintGroup(g, run.key)
    })
  }
  groups.set(run.key, g)
  g.items = run.items
  reconcile(g.body, run.items.map(nodeFor))
  paintGroup(g, run.key)
  return g.node
}
function paintGroup(g, key) {
  const tools = g.items.filter((i) => i.kind === "tool")
  const last = tools.at(-1) ?? g.items.at(-1)
  const open = S.expanded.has(`group:${key}`)
  const state = last.kind === "tool" ? last.status : last.state === "allowed" ? "done" : "failed"
  const failed = tools.filter((i) => i.status === "failed").length
  // Closed is a class (not `hidden`) so the body can ease shut; inert keeps it out of reach meanwhile.
  g.node.className = `tool-group ${state}${open ? " open" : ""}`
  g.body.inert = !open
  g.head.setAttribute("aria-expanded", String(open))
  const line = (item) => el("span", { class: "reel-line" },
    el("span", { class: "tool-name", text: item.kind === "tool" ? item.name : item.tool }),
    el("span", { class: "tool-detail", text: rel(item.detail) }))
  // The reel stays put across repaints, so a call finishing mid-spin doesn't cut the spin short.
  if (!g.reel) g.win = el("span", { class: "reel-window" }, (g.reel = el("span", { class: "reel" })))
  g.head.replaceChildren(
    el("span", { class: "tool-state", "aria-label": state }),
    g.win,
    el("span", { class: "tool-count", text: `${tools.length} tool${tools.length === 1 ? "" : "s"}${failed ? ` · ${failed} failed` : ""}` }))
  // A new call spins the row like a lottery drum and lands on it; the same call just repaints.
  const was = g.shown === undefined ? undefined : g.items.find((i) => i.id === g.shown)
  const spin = was !== undefined && g.shown !== last.id && !matchMedia("(prefers-reduced-motion: reduce)").matches
  g.shown = last.id
  if (spin) spinReel(g, [was, ...blurs(tools, last), last].map(line))
  else if (!g.spinning) g.reel.replaceChildren(line(last))
  else g.landing = line(last) // lands on the latest text once the spin ends
}
/** A few other calls from the run (or the same one again) for the drum to flick past. */
function blurs(tools, last) {
  const pool = tools.filter((i) => i.id !== last.id)
  return Array.from({ length: 4 }, () => pool[Math.floor(Math.random() * pool.length)] ?? last)
}
/** Roll the drum from the first line to the last: fast and blurred, then easing to a stop with a small bounce. */
function spinReel(g, lines) {
  g.spinning?.cancel()
  g.landing = lines.at(-1)
  g.reel.replaceChildren(...lines)
  const run = g.reel.animate([
    { transform: "translateY(0)", filter: "blur(0)" },
    { offset: 0.2, filter: "blur(1.4px)" },
    { offset: 0.75, filter: "blur(0.4px)" },
    { transform: `translateY(-${((lines.length - 1) / lines.length) * 100}%)`, filter: "blur(0)" }
  ], { duration: 720, easing: "cubic-bezier(.12,.75,.22,1.12)" })
  g.spinning = run
  run.onfinish = () => {
    if (g.spinning !== run) return
    g.spinning = null
    g.reel.replaceChildren(g.landing)
  }
}
function upsertItem(item) {
  const t = S.open
  const i = t.items.findIndex((x) => x.id === item.id)
  if (i >= 0) t.items[i] = item
  else t.items.push(item)
  renderFeed()
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
    for (const it of pendingDeltas.values()) feed?.cache.get(it.id)?.node.querySelector(".prose")?.replaceChildren(...mdNodes(it.text))
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
    case "user": return userMessage(item)
    case "assistant": return el("div", { class: "msg msg-a" }, el("div", { class: "msg-ai" }, el("div", { class: "prose" }, mdNodes(item.text))), msgActions(() => item.text, quoteButton(item), el("span", { class: "msg-meta" })))
    case "tool": {
      if (memoryRead(item)) return memoryCard(item)
      const open = S.expanded.has(item.id)
      const out = el("pre", { class: "tool-out", inert: !open, text: item.output || (item.status === "running" ? "Running…" : "No output.") })
      const node = el("div", { class: `tool ${item.status}${open ? " open" : ""}` })
      const row = el("button", { class: "tool-row", type: "button", "aria-expanded": String(open), onclick: () => {
        const now = !node.classList.contains("open")
        node.classList.toggle("open", now)
        out.inert = !now
        row.setAttribute("aria-expanded", String(now))
        now ? S.expanded.add(item.id) : S.expanded.delete(item.id)
      } }, el("span", { class: "tool-state", "aria-label": item.status }), el("span", { class: "tool-name", text: item.name }), el("span", { class: "tool-detail", text: rel(item.detail) }))
      node.append(row, out)
      return node
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
          el("span", { class: "hint", text: "Change what needs asking with the model menu below." })))
    }
    case "memory": {
      const label = { recalled: "Recalled from memory", checked: "Memory checked", stored: "Stored in memory", none: "Committed" }[item.action]
      const head = el("div", { class: "mem-head", title: item.title }, el("span", { class: "mem-label", text: label }), item.commit ? el("code", { text: item.commit.slice(0, 10) }) : null, el("span", { class: "mem-title", text: item.title }))
      // A recall shows what singularity handed the agent, word for word.
      return el("div", { class: `mem ${item.action}` }, head, item.text ? el("pre", { class: "mem-text", text: item.text }) : null)
    }
    case "compact": return compactCard(item)
    case "turn": {
      if (item.outcome === "failed") return el("div", { class: "turn-error" }, el("b", { text: "The turn stopped with an error. " }), item.error)
      return el("div", { class: "turn-meta" }, turnMeta(item))
    }
  }
  return el("div")
}
/**
 * A compaction, as it happens: while it runs, a moving bar, how much it's summarizing and for how long;
 * once done, how much smaller the context got, how long it took, and the summary the session goes on from.
 */
function compactCard(item) {
  const k = (n) => (n >= 1000 ? `${(n / 1000).toFixed(n < 10000 ? 1 : 0)}k` : String(n))
  const why = item.trigger === "auto" ? `${providerLabel(S.open?.provider)} compacted on its own as the context filled` : "Compacted as asked"
  const head = (title, ...rest) => el("div", { class: "compact-head" }, el("span", { class: "compact-icon", "aria-hidden": "true" }), el("b", { text: title }), ...rest)
  if (item.state === "running") {
    const size = item.preTokens !== null ? `Summarizing about ${k(item.preTokens)} tokens of this thread` : "Summarizing this thread so far"
    return el("div", { class: "compact-card running", role: "status", "aria-live": "polite" },
      head("Compacting context", el("span", { class: "compact-time", "data-since": item.at, text: elapsed(item.at) })),
      el("div", { class: "compact-bar", "aria-hidden": "true" }, el("i")),
      el("div", { class: "compact-sub", text: `${size}. ${item.trigger === "auto" ? "Claude started this on its own; the turn goes on after." : "Your next step waits for it."}` }))
  }
  if (item.state === "failed") {
    return el("div", { class: "compact-card failed", role: "status" }, head("Compaction failed"), el("div", { class: "compact-sub", text: item.error || "The provider didn't finish compacting. The thread goes on as it was." }))
  }
  const facts = [
    item.preTokens !== null && item.postTokens !== null ? `${k(item.preTokens)} → ${k(item.postTokens)} tokens` : null,
    item.preTokens && item.postTokens !== null ? `${Math.max(0, Math.round((1 - item.postTokens / item.preTokens) * 100))}% smaller` : null,
    item.durationMs ? `${(item.durationMs / 1000).toFixed(1)}s` : null
  ].filter(Boolean)
  return el("div", { class: "compact-card done", role: "status" },
    head("Context compacted", el("span", { class: "compact-facts", text: facts.join(" · ") })),
    el("div", { class: "compact-sub", text: `${why}. What came before is now this summary.` }),
    item.summary ? el("details", { class: "compact-summary" }, el("summary", { text: "What Claude kept" }), el("div", { class: "prose" }, mdNodes(item.summary))) : null)
}
/** m:ss since an ISO time. */
const elapsed = (iso) => { const s = Math.max(0, Math.floor((Date.now() - Date.parse(iso)) / 1000)); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}` }
// A running compaction's clock ticks every second.
setInterval(() => { for (const n of document.querySelectorAll(".compact-time[data-since]")) n.textContent = elapsed(n.dataset.since) }, 1000)

/** What singularity told the agent when it asked mid-task: the question, the commit it pointed to, and its words. */
function memoryCard(item) {
  const command = /singularity (recall|changes)\b.*/.exec(item.detail ?? "")?.[0] ?? item.detail
  const recall = command.startsWith("singularity recall")
  const out = item.output || (item.status === "running" ? "Asking singularity…" : "No output.")
  const commit = /committed as (\w+)/.exec(out)?.[1]
  const subject = /committed as \w+: "([^"]+)"/.exec(out)?.[1]
  const asked = command.replace(/^singularity recall\s*/, "").replace(/^(["'])(.*)\1$/, "$2")
  const label = !recall ? "Agent listed memory" : commit ? "Agent recalled" : "Agent asked memory"
  const title = !recall ? "the changes stored in this repo" : subject ? `${subject} (asked: ${asked})` : `asked: ${asked}`
  const head = el("div", { class: "mem-head" }, el("span", { class: "mem-label", text: label }), commit ? el("code", { text: commit.slice(0, 10) }) : null, el("span", { class: "mem-title", text: title }))
  return el("div", { class: `mem ${commit ? "recalled" : "checked"}` }, head, el("pre", { class: "mem-text", text: out }))
}
const verb = (tool) =>({ Bash: "run a command", Edit: "edit a file", Write: "write a file", MultiEdit: "edit a file", NotebookEdit: "edit a notebook" })[tool] ?? `use ${tool}`

// ---------- git panel: a right sidebar with the thread's branch and its pull request ----------
const BRANCH_PATHS = '<circle cx="4.5" cy="3.5" r="1.5"/><circle cx="4.5" cy="12.5" r="1.5"/><circle cx="11.5" cy="4.5" r="1.5"/><path d="M4.5 5v6M11.5 6c0 3.5-7 2.5-7 5"/>'
const PR_PATHS = '<circle cx="4.5" cy="3.5" r="1.5"/><circle cx="4.5" cy="12.5" r="1.5"/><circle cx="11.5" cy="12.5" r="1.5"/><path d="M4.5 5v6M11.5 11V6.5a2 2 0 0 0-2-2H7M8.5 3 7 4.5 8.5 6"/>'
const REFRESH_PATHS = '<path d="M13.2 8A5.2 5.2 0 1 1 11.6 4.3M13.2 2.3v3.2H10"/>'
const OUT_PATHS = '<path d="M9.5 2.5h4v4M13.5 2.5 8 8M6.5 3.5h-3v9h9v-3"/>'
const GIT = { min: 300, max: 680, base: 380 }
/** The one panel on screen (the open thread's), or null. */
let gitPanel = null

const prState = (pr) => (pr.state === "OPEN" && pr.isDraft ? "draft" : pr.state.toLowerCase())
const PR_STATE_LABEL = { open: "Open", draft: "Draft", merged: "Merged", closed: "Closed" }
const CHECK_MARK = { passed: "✓", failed: "×", running: "", pending: "", skipped: "–", cancelled: "⊘", neutral: "–" }
const REVIEW_LABEL = { APPROVED: "Approved", CHANGES_REQUESTED: "Changes requested", REVIEW_REQUIRED: "Review required" }
const MERGE_STATE = {
  CLEAN: "Ready to merge", BLOCKED: "Merging is blocked", BEHIND: "Behind its base", DIRTY: "Has conflicts",
  UNSTABLE: "Some checks aren't passing", DRAFT: "Draft", HAS_HOOKS: "Ready to merge (hooks)", UNKNOWN: ""
}
/** A `git status --short` code in words. */
const changeWord = (s) => s === "??" ? "new" : /D/.test(s) ? "deleted" : /R/.test(s) ? "renamed" : /A/.test(s) ? "added" : /U/.test(s) || s === "AA" || s === "DD" ? "conflict" : "modified"
/** ago() as words: "just now", "5m ago". */
const agoText = (iso) => { const a = ago(iso); return a === "now" ? "just now" : `${a} ago` }
/**
 * GitHub text mixes markdown with HTML (templates' comments, <details>, links, badges). The common tags
 * become the markdown md() reads and the rest are dropped; md() escapes everything, so nothing runs.
 */
const githubMd = (s) => s
  .replace(/\r\n/g, "\n")
  .replace(/<!--[\s\S]*?-->/g, "")
  .replace(/^\[\/\/\]: #.*$/gm, "")
  .replace(/<br\s*\/?>/gi, "\n")
  .replace(/<summary>([\s\S]*?)<\/summary>/gi, "\n$1\n")
  .replace(/<a\s[^>]*?href="(https?:[^"]+)"[^>]*>([\s\S]*?)<\/a>/gi, (_, url, label) => `[${label.replace(/<[^>]+>/g, "").trim() || url}](${url})`)
  .replace(/<\/?(?:code|tt)>/gi, "`")
  .replace(/<\/?(?:strong|b)>/gi, "**")
  .replace(/<li>/gi, "\n- ")
  .replace(/<img\s[^>]*?alt="([^"]*)"[^>]*>/gi, "$1")
  .replace(/<\/?[a-z][a-z0-9-]*(?:\s[^>]*)?\/?>/gi, "")
  .replace(/!\[([^\]]*)\]\((?:https?:[^)\s]+)\)/g, "$1")
  .replace(/\n\s*\n(?=- )/g, "\n")
  .replace(/\n{3,}/g, "\n\n")
  .trim()
const prose = (body) => mdNodes(githubMd(body))

function makeGitPanel(t) {
  if (gitPanel) clearInterval(gitPanel.timer)
  // One toggle for open and closed, fixed at the window's top right like the left sidebar's: it never moves.
  const badge = el("span", { class: "git-badge", hidden: true })
  const toggle = el("button", { class: "icon-btn git-toggle", type: "button", "aria-controls": "git-panel", onclick: () => setGitOpen(!gitOpenNow()),
    html: `<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${BRANCH_PATHS}</svg>` }, badge)
  const body = el("div", { class: "git-body" }, el("p", { class: "git-empty", text: "Loading…" }))
  const refresh = el("button", { class: "icon-btn git-refresh", type: "button", title: "Refresh", html: `<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${REFRESH_PATHS}</svg>`, onclick: () => loadGit() })
  const resize = el("div", { class: "git-resize", role: "separator", "aria-orientation": "vertical", "aria-label": "Resize Git panel", tabindex: "0", title: "Drag to resize · double-click to reset" })
  // Closed, it stays in the page (inert) so it can slide and fade both ways; see setGitOpen.
  const node = el("aside", { class: "git-panel", id: "git-panel", "aria-label": "Git" },
    resize,
    el("div", { class: "git-head" },
      el("h2", { text: "Git" }),
      el("span", { class: "git-at" }),
      refresh),
    body)
  showGit(node, load("gitOpen", false))
  gitPanel = { node, body, toggle, badge, refresh, threadId: t.id, data: null, loading: false, at: 0, timer: 0, draft: "", folds: new Map() }
  setGitWidth(load("gitWidth", GIT.base), false)
  wireGitResize(resize)
  paintGitToggle()
  loadGit()
  // While it's open, look again: often while checks run, now and then otherwise.
  gitPanel.timer = setInterval(() => {
    const g = gitPanel
    if (!g || !gitOpenNow() || document.hidden || g.loading) return
    const waiting = g.data?.pr?.checks.some((c) => c.state === "running" || c.state === "pending")
    if (Date.now() - g.at > (waiting ? 15_000 : 90_000)) loadGit()
  }, 5_000)
  return { node, toggle }
}
const gitOpenNow = () => !!gitPanel && !gitPanel.node.classList.contains("closed")
/** Open or close the panel's node: the CSS slides it and fades its content; closed, it can't be focused or clicked. */
function showGit(node, open) {
  node.classList.toggle("closed", !open)
  node.inert = !open
}
function setGitOpen(open) {
  if (!gitPanel) return
  showGit(gitPanel.node, open)
  save("gitOpen", open)
  paintGitToggle()
  // Look again once it has slid open: repainting its content mid-slide would stall the animation.
  if (open && Date.now() - gitPanel.at > 10_000) setTimeout(loadGit, sideMoveMs())
}
/** How long a sidebar takes to slide (--side-move in app.css), in ms. */
const sideMoveMs = () => parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--side-move")) * 1000 || 0
function setGitWidth(w, persist = true) {
  const width = Math.round(Math.min(GIT.max, Math.max(GIT.min, w)))
  document.querySelector(".shell").style.setProperty("--git-w", `${width}px`)
  if (persist) save("gitWidth", width)
}
function wireGitResize(handle) {
  handle.addEventListener("pointerdown", (e) => {
    if (e.button !== 0) return
    e.preventDefault()
    handle.setPointerCapture(e.pointerId)
    const right = handle.parentElement.getBoundingClientRect().right
    document.body.classList.add("resizing")
    const move = (ev) => setGitWidth(right - ev.clientX, false)
    const up = (ev) => {
      handle.removeEventListener("pointermove", move)
      handle.removeEventListener("pointerup", up)
      handle.removeEventListener("pointercancel", up)
      document.body.classList.remove("resizing")
      setGitWidth(right - ev.clientX)
    }
    handle.addEventListener("pointermove", move)
    handle.addEventListener("pointerup", up)
    handle.addEventListener("pointercancel", up)
  })
  handle.addEventListener("dblclick", () => setGitWidth(GIT.base))
  handle.addEventListener("keydown", (e) => {
    const now = handle.parentElement.getBoundingClientRect().width
    const step = e.shiftKey ? 48 : 16
    const next = { ArrowLeft: now + step, ArrowRight: now - step }[e.key]
    if (next === undefined) return
    e.preventDefault()
    setGitWidth(next)
  })
}

/** The Git toggle says what it will do, and a dot on it gives the PR's state (and its checks') at a glance. */
function paintGitToggle() {
  const g = gitPanel
  if (!g) return
  const open = gitOpenNow()
  g.toggle.classList.toggle("on", open)
  g.toggle.setAttribute("aria-expanded", String(open))
  const d = g.data
  const pr = d?.pr
  g.badge.hidden = !pr
  if (pr) {
    const failing = pr.checks.some((c) => c.state === "failed")
    const running = pr.checks.some((c) => c.state === "running" || c.state === "pending")
    g.badge.dataset.state = prState(pr)
    g.badge.dataset.checks = failing ? "failed" : running ? "running" : pr.checks.length ? "passed" : ""
  }
  const branch = d?.repo ? d.branch || "detached HEAD" : S.open?.branch || ""
  const label = `${open ? "Hide" : "Show"} Git`
  g.toggle.setAttribute("aria-label", label)
  g.toggle.title = [label, branch, pr ? `PR #${pr.number} · ${PR_STATE_LABEL[prState(pr)]}` : ""].filter(Boolean).join("\n")
}

async function loadGit() {
  const g = gitPanel
  if (!g || g.loading) return
  g.loading = true
  g.refresh.classList.add("spinning")
  try {
    const data = await api("GET", `threads/${g.threadId}/git`)
    if (gitPanel !== g) return
    g.data = data
    g.error = ""
    // The tree may have changed: open diffs are read again as they're painted.
    g.diffs = new Map()
  } catch (e) {
    if (gitPanel !== g) return
    g.error = e.message
  } finally {
    g.loading = false
    g.at = Date.now()
    g.refresh.classList.remove("spinning")
  }
  paintGitToggle()
  paintGit()
}

/** Run one of the panel's actions; the panel looks again after. */
async function gitAction(kind, body, done = "") {
  const g = gitPanel
  if (!g) return false
  try {
    await api("POST", `threads/${g.threadId}/git/${kind}`, body)
    if (done) toast(done)
    loadGit()
    return true
  } catch (e) {
    fail(e)
    return false
  }
}
/** Put words in the composer for the agent: the person reads them and sends. */
function askAgent(text) {
  if (!feed?.composer) return
  feed.composer.fill(text)
  if (narrow.matches || innerWidth < 1100) setGitOpen(false)
}

function paintGit() {
  const g = gitPanel
  if (!g) return
  const d = g.data
  g.node.querySelector(".git-at").textContent = g.at ? `updated ${agoText(new Date(g.at).toISOString())}` : ""
  // Keep where the person was: a comment half-written and the scroll position.
  const draft = g.body.querySelector(".git-comment textarea")
  if (draft) g.draft = draft.value
  const top = g.body.scrollTop
  if (!d) return g.body.replaceChildren(el("p", { class: "git-empty", text: g.error || "Loading…" }))
  if (!d.repo) {
    return g.body.replaceChildren(el("div", { class: "git-empty" },
      el("b", { text: "Not a git repository" }),
      el("p", { text: "This thread's project folder isn't in git, so there's no branch or pull request to show." })))
  }
  const kids = [
    g.error ? el("p", { class: "git-note warn", text: g.error }) : null,
    branchCard(d),
    d.pr ? prCard(d.pr) : noPrCard(d),
    ...(d.pr ? prSections(d.pr) : []),
    gitSec("commits", d.pr ? "Commits on this branch" : "Commits", d.commits.length, d.commits.length
      ? el("ol", { class: "git-list" }, d.commits.map((c) => el("li", { class: "git-commit" },
        el("code", { class: "git-sha", text: c.sha.slice(0, 7), title: c.sha }),
        el("span", { class: "git-subject", text: c.subject, title: c.subject }),
        el("span", { class: "git-when", text: ago(c.at), title: `${c.author} · ${new Date(c.at).toLocaleString()}` }))))
      : el("p", { class: "git-none", text: "No commits yet." })),
    gitSec("changes", d.current && d.current !== d.branch ? `Uncommitted on ${d.current}` : "Uncommitted changes", d.changes.length, d.changes.length
      ? el("div", {}, el("ul", { class: "git-list" }, d.changes.map((c) => changeRow(g, c))), commitBox(g))
      : el("p", { class: "git-none", text: "The working tree is clean." }), d.changes.length > 0 && d.changes.length <= 30)
  ]
  g.body.replaceChildren(...kids.filter(Boolean))
  // A section the person folded or unfolded stays that way through refreshes.
  for (const s of g.body.querySelectorAll("details.git-sec")) {
    if (g.folds.has(s.dataset.key)) s.open = g.folds.get(s.dataset.key)
    s.addEventListener("toggle", () => g.folds.set(s.dataset.key, s.open))
  }
  const ta = g.body.querySelector(".git-comment textarea")
  if (ta && g.draft) ta.value = g.draft
  g.body.scrollTop = top
}

/** A changed file: its row opens its diff below it, read on demand and kept until the panel loads again. */
function changeRow(g, c) {
  g.openDiffs ??= new Set()
  g.diffs ??= new Map()
  const open = g.openDiffs.has(c.path)
  const row = el("li", { class: `git-file${open ? " open" : ""}` },
    el("button", { class: "git-file-btn", type: "button", "aria-expanded": String(open), title: `Show the diff of ${c.path}`, onclick: () => {
      open ? g.openDiffs.delete(c.path) : g.openDiffs.add(c.path)
      paintGit()
    } },
    el("span", { class: `git-chg chg-${changeWord(c.status)}`, text: changeWord(c.status), title: `git status: ${c.status}` }),
    el("span", { class: "git-path", text: c.path, title: c.path })))
  if (!open) return row
  const diff = g.diffs.get(c.path)
  if (diff === undefined) {
    g.diffs.set(c.path, null)
    api("GET", `threads/${g.threadId}/git/diff/${encodeURIComponent(c.path)}`).then(
      (r) => { g.diffs.set(c.path, r.diff); if (gitPanel === g) paintGit() },
      (e) => { g.diffs.set(c.path, `couldn't read the diff: ${e.message}`); if (gitPanel === g) paintGit() })
  }
  row.append(diff ? diffView(diff) : el("p", { class: "git-none", text: "Reading the diff…" }))
  return row
}

/** A unified diff, its lines marked as added, removed or a hunk's header. */
function diffView(text) {
  const lines = text.split("\n")
  if (lines.at(-1) === "") lines.pop()
  const cut = lines.length > 2000
  return el("pre", { class: "git-diff" }, ...(cut ? lines.slice(0, 2000) : lines).map((l) => el("span", {
    class: l.startsWith("@@") ? "d-hunk" : l.startsWith("+") && !l.startsWith("+++") ? "d-add" : l.startsWith("-") && !l.startsWith("---") ? "d-del" : /^(diff |index |--- |\+\+\+ |new file|deleted file)/.test(l) ? "d-meta" : "",
    text: `${l}\n`
  })), cut ? el("span", { class: "d-meta", text: "… more lines than shown here" }) : null)
}

/** Commit everything uncommitted: the person's message, or one the small model writes from the diff. */
function commitBox(g) {
  const ta = el("textarea", { rows: 2, placeholder: "Commit message", "aria-label": "Commit message" })
  ta.value = g.commitDraft ?? ""
  const commit = el("button", { class: "btn btn-primary btn-xs", type: "button", onclick: (e) => withBusy(e.currentTarget, async () => {
    if (!ta.value.trim()) return toast("Write a commit message first, or let Claude write one.", true)
    if (await gitAction("commit", { message: ta.value }, "Committed.")) g.commitDraft = ""
  }) }, "Commit all")
  const write = el("button", { class: "btn btn-quiet btn-xs", type: "button", title: "Claude's small model reads the diff (up to 12,000 characters) and writes the message", onclick: (e) => withBusy(e.currentTarget, async () => {
    try {
      const r = await api("POST", `threads/${g.threadId}/git/message`, {})
      ta.value = g.commitDraft = r.message
      ta.focus()
    } catch (err) { fail(err) }
  }) }, "Write message")
  ta.addEventListener("input", () => { g.commitDraft = ta.value })
  ta.addEventListener("keydown", (e) => { if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) { e.preventDefault(); commit.click() } })
  return el("div", { class: "git-comment git-commit-box" }, ta, el("div", { class: "git-comment-foot" }, el("span", { class: "hint", text: "Ctrl+Enter commits" }), write, commit))
}

/** A section that folds: a title, a count, then its content. */
function gitSec(key, title, count, content, openByDefault = true) {
  return el("details", { class: "git-sec", "data-key": key, open: openByDefault },
    el("summary", {}, el("span", { text: title }), count !== null && count !== undefined ? el("span", { class: "git-count", text: String(count) }) : null),
    el("div", { class: "git-sec-body" }, content))
}

function branchCard(d) {
  const facts = []
  if (d.upstream) {
    facts.push(el("span", { class: "git-fact", title: `Tracks ${d.upstream}` }, d.upstream))
    if (d.ahead) facts.push(el("span", { class: "git-fact ahead", title: `${d.ahead} commit${d.ahead === 1 ? "" : "s"} not pushed` }, `↑${d.ahead}`))
    if (d.behind) facts.push(el("span", { class: "git-fact", title: `${d.behind} commit${d.behind === 1 ? "" : "s"} on ${d.upstream} not here` }, `↓${d.behind}`))
    if (!d.ahead && !d.behind) facts.push(el("span", { class: "git-fact", text: "up to date" }))
  } else if (d.branch) {
    facts.push(el("span", { class: "git-fact", text: "not pushed" }))
  }
  const canPush = d.branch && (!d.upstream || d.ahead > 0)
  return el("div", { class: "git-card git-branch" },
    el("div", { class: "git-branch-line" },
      icon(BRANCH_PATHS, "git-branch-ico"),
      el("code", { class: "git-branch-name", text: d.branch || "detached HEAD", title: d.branch }),
      canPush ? el("button", { class: "btn btn-quiet btn-xs", type: "button", onclick: (e) => withBusy(e.currentTarget, () => gitAction("push", { branch: d.branch }, `Pushed ${d.branch}.`)) }, "Push") : null),
    facts.length ? el("div", { class: "git-facts" }, facts) : null,
    d.current && d.branch !== d.current
      ? el("p", { class: "git-note", text: `The project is on ${d.current} now; this thread last worked on ${d.branch}.` })
      : null)
}

function noPrCard(d) {
  const baseName = d.base?.replace(/^origin\//, "") ?? ""
  if (!d.gh.ok) return el("div", { class: "git-card" }, el("p", { class: "git-note", text: d.gh.detail || "GitHub isn't reachable from here." }))
  const onBase = !d.branch || d.branch === baseName
  return el("div", { class: "git-card git-nopr" },
    el("div", { class: "git-nopr-line" }, icon(PR_PATHS, "git-pr-ico"), el("span", { text: "No pull request yet" })),
    onBase
      ? el("p", { class: "git-note", text: d.branch ? `${d.branch} is the default branch; a pull request comes from a branch of its own.` : "Check out a branch to open a pull request." })
      : el("div", { class: "git-actions" },
        el("button", { class: "btn btn-primary btn-xs", type: "button", onclick: () => createPr(d) }, d.upstream ? "Create pull request" : "Push and create pull request"),
        el("button", { class: "btn btn-quiet btn-xs", type: "button", onclick: () => askAgent(`Open a pull request for the branch ${d.branch}${baseName ? ` into ${baseName}` : ""}: push it if needed, and write a clear title and description from its commits.`) }, "Ask the agent")))
}

async function createPr(d) {
  const baseName = d.base?.replace(/^origin\//, "") ?? ""
  const first = d.commits.at(-1)?.subject ?? d.branch
  const body = el("div", {},
    el("label", { class: "field" }, "Title", el("input", { name: "title", value: d.commits.length === 1 ? d.commits[0].subject : first, autocomplete: "off" })),
    el("label", { class: "field" }, "Description", el("textarea", { name: "body", rows: "7", placeholder: "What changed, and why" },
      d.commits.length > 1 ? d.commits.slice().reverse().map((c) => `- ${c.subject}`).join("\n") : "")),
    el("label", { class: "field" }, "Into", el("input", { name: "base", value: baseName, placeholder: "The repository's default branch", autocomplete: "off", spellcheck: "false" })),
    el("label", { class: "check" }, el("input", { type: "checkbox", name: "draft" }), "Open as a draft"))
  if (!(await dialog({ title: `Pull request for ${d.branch}`, text: d.upstream ? "" : `${d.branch} is pushed to origin first.`, ok: "Create pull request", body }))) return
  const v = (n) => body.querySelector(`[name=${n}]`)
  await gitAction("create", { branch: d.branch, base: v("base").value.trim(), title: v("title").value, body: v("body").value, draft: v("draft").checked }, "Pull request created.")
}

function prCard(pr) {
  const state = prState(pr)
  const pills = []
  if (pr.reviewDecision && REVIEW_LABEL[pr.reviewDecision]) pills.push(el("span", { class: `git-pill review-${pr.reviewDecision.toLowerCase()}`, text: REVIEW_LABEL[pr.reviewDecision] }))
  if (state === "open" && MERGE_STATE[pr.mergeState]) pills.push(el("span", { class: `git-pill merge-${pr.mergeState.toLowerCase()}`, text: MERGE_STATE[pr.mergeState] }))
  for (const l of pr.labels) pills.push(el("span", { class: "git-pill label", text: l }))
  const actions = [
    el("a", { class: "btn btn-quiet btn-xs", href: pr.url, target: "_blank", rel: "noopener noreferrer" }, icon(OUT_PATHS), "GitHub")
  ]
  if (pr.state === "OPEN") {
    actions.push(pr.isDraft
      ? el("button", { class: "btn btn-quiet btn-xs", type: "button", onclick: (e) => withBusy(e.currentTarget, () => gitAction("ready", { number: pr.number }, "Marked ready for review.")) }, "Ready for review")
      : el("button", { class: "btn btn-quiet btn-xs", type: "button", onclick: (e) => withBusy(e.currentTarget, () => gitAction("ready", { number: pr.number, draft: true }, "Converted to a draft.")) }, "Convert to draft"))
    actions.push(el("button", { class: "btn btn-primary btn-xs", type: "button", disabled: pr.isDraft, title: pr.isDraft ? "A draft can't be merged" : null, onclick: () => mergePr(pr) }, "Merge…"))
  }
  return el("div", { class: `git-card git-pr pr-${state}` },
    el("div", { class: "git-pr-top" },
      el("span", { class: `git-state st-${state}` }, icon(PR_PATHS), PR_STATE_LABEL[state] ?? pr.state),
      el("span", { class: "git-when", text: state === "merged" && pr.mergedAt ? `merged ${agoText(pr.mergedAt)}` : `updated ${agoText(pr.updatedAt)}` })),
    el("a", { class: "git-pr-title", href: pr.url, target: "_blank", rel: "noopener noreferrer" }, el("span", { class: "git-pr-num", text: `#${pr.number}` }), " ", pr.title),
    el("div", { class: "git-pr-meta" },
      el("span", { text: pr.author }),
      el("span", { class: "git-refs" }, el("code", { text: pr.base }), " ← ", el("code", { text: pr.head }))),
    el("div", { class: "git-pr-meta" },
      el("span", { class: "git-add", text: `+${pr.additions}` }),
      el("span", { class: "git-del", text: `−${pr.deletions}` }),
      el("span", { text: `${pr.changedFiles} file${pr.changedFiles === 1 ? "" : "s"}` }),
      pr.reviewers.length ? el("span", { text: `review asked of ${pr.reviewers.join(", ")}` }) : null),
    pills.length ? el("div", { class: "git-pills" }, pills) : null,
    el("div", { class: "git-actions" }, actions))
}

async function mergePr(pr) {
  const body = el("div", {},
    el("label", { class: "field" }, "How", el("select", { class: "select", name: "method" },
      el("option", { value: "squash" }, "Squash and merge"),
      el("option", { value: "merge" }, "Create a merge commit"),
      el("option", { value: "rebase" }, "Rebase and merge"))),
    el("label", { class: "check" }, el("input", { type: "checkbox", name: "delete" }), `Delete ${pr.head} after`))
  if (!(await dialog({ title: `Merge #${pr.number} into ${pr.base}?`, text: pr.title, ok: "Merge", body }))) return
  await gitAction("merge", { number: pr.number, method: body.querySelector("[name=method]").value, deleteBranch: body.querySelector("[name=delete]").checked }, `Merged #${pr.number}.`)
}

/** Checks in the order they matter: what failed, what's still going, then what passed or didn't run. */
const CHECK_ORDER = ["failed", "running", "pending", "cancelled", "passed", "neutral", "skipped"]
const QUIET_CHECK = new Set(["passed", "neutral", "skipped"])
function prSections(pr) {
  const checks = [...pr.checks].sort((a, b) => CHECK_ORDER.indexOf(a.state) - CHECK_ORDER.indexOf(b.state))
  // Many checks: the ones that passed or were skipped fold away behind a button.
  const fold = checks.length > 10 && !gitPanel?.allChecks
  const quiet = fold ? checks.filter((c) => QUIET_CHECK.has(c.state)) : []
  const shown = fold ? checks.filter((c) => !QUIET_CHECK.has(c.state)) : checks
  const count = (s) => checks.filter((c) => c.state === s).length
  const failed = checks.filter((c) => c.state === "failed")
  const runs = [...new Set(failed.map((c) => c.runId).filter(Boolean))]
  const summary = [["passed", "passed"], ["failed", "failed"], ["running", "running"], ["pending", "waiting"], ["skipped", "skipped"], ["cancelled", "cancelled"]]
    .map(([s, w]) => [count(s), w, s]).filter(([n]) => n > 0)
  const checksSec = gitSec("checks", "Checks", checks.length, checks.length
    ? [
      el("p", { class: "git-check-sum" }, summary.map(([n, w, s]) => el("span", { class: `sum-${s}`, text: `${n} ${w}` }))),
      el("ul", { class: "git-list" }, shown.map((c) => el("li", { class: `git-check ck-${c.state}` },
        el("span", { class: "ck-mark", "aria-label": c.state, title: c.state, text: CHECK_MARK[c.state] }),
        c.url ? el("a", { class: "ck-name", href: c.url, target: "_blank", rel: "noopener noreferrer", title: c.workflow ? `${c.workflow} / ${c.name}` : c.name }, c.workflow ? el("span", { class: "ck-wf", text: `${c.workflow} / ` }) : null, c.name)
          : el("span", { class: "ck-name", text: c.name }),
        el("span", { class: "git-when", text: c.completedAt && c.startedAt ? took(c.startedAt, c.completedAt) : c.state === "running" && c.startedAt ? `${ago(c.startedAt)}` : "" })))),
      quiet.length
        ? el("button", { class: "git-more", type: "button", onclick: () => { gitPanel.allChecks = true; paintGit() } }, `Show ${quiet.length} more (passed or skipped)`)
        : null,
      failed.length
        ? el("div", { class: "git-actions" },
          runs.length ? el("button", { class: "btn btn-quiet btn-xs", type: "button", onclick: (e) => withBusy(e.currentTarget, async () => { for (const id of runs) if (!(await gitAction("rerun", { runId: id }))) return; toast(`Re-running ${runs.length === 1 ? "the failed jobs" : `${runs.length} runs' failed jobs`}.`) }) }, "Re-run failed") : null,
          el("button", { class: "btn btn-quiet btn-xs", type: "button", onclick: () => askAgent(fixChecksPrompt(pr, failed)) }, "Ask the agent to fix"))
        : null
    ]
    : el("p", { class: "git-none", text: "No checks ran on this pull request." }), true)
  const description = gitSec("description", "Description", null, pr.body.trim()
    ? el("div", { class: "prose git-prose" }, prose(pr.body))
    : el("p", { class: "git-none", text: "No description." }), true)
  const notes = pr.notes
  const conversation = gitSec("conversation", "Conversation", notes.length, [
    notes.length
      ? el("ol", { class: "git-notes" }, notes.map(noteNode))
      : el("p", { class: "git-none", text: "No comments or reviews yet." }),
    notes.some((n) => n.kind === "inline" || n.state === "CHANGES_REQUESTED" || n.kind === "comment")
      ? el("div", { class: "git-actions" }, el("button", { class: "btn btn-quiet btn-xs", type: "button", onclick: () => askAgent(addressPrompt(pr)) }, "Ask the agent to address these"))
      : null,
    pr.state !== "CLOSED" ? commentBox(pr) : null
  ], true)
  const files = gitSec("files", "Files changed", pr.files.length, el("ul", { class: "git-list" }, pr.files.map((f) => el("li", { class: "git-file" },
    el("span", { class: "git-path", text: f.path, title: f.path }),
    el("span", { class: "git-add", text: `+${f.additions}` }),
    el("span", { class: "git-del", text: `−${f.deletions}` })))), pr.files.length <= 20)
  return [checksSec, description, conversation, files]
}
const took = (a, b) => {
  const s = Math.max(0, Math.round((Date.parse(b) - Date.parse(a)) / 1000))
  return s < 60 ? `${s}s` : `${Math.floor(s / 60)}m ${s % 60}s`
}

function noteNode(n) {
  const what = n.kind === "inline"
    ? el("span", { class: "note-where" }, "on ", el("code", { text: `${n.path}${n.line ? `:${n.line}` : ""}` }))
    : n.kind === "review"
      ? el("span", { class: `note-verdict v-${(n.state || "").toLowerCase()}`, text: ({ APPROVED: "approved", CHANGES_REQUESTED: "asked for changes", COMMENTED: "reviewed", DISMISSED: "review dismissed" })[n.state] ?? "reviewed" })
      : null
  return el("li", { class: `git-note-item note-${n.kind}` },
    el("div", { class: "note-head" },
      el("b", { text: n.author }),
      what,
      n.url ? el("a", { class: "git-when", href: n.url, target: "_blank", rel: "noopener noreferrer", text: ago(n.at), title: new Date(n.at).toLocaleString() }) : el("span", { class: "git-when", text: ago(n.at) })),
    n.body.trim() ? el("div", { class: "prose git-prose" }, prose(n.body)) : null)
}

function commentBox(pr) {
  const ta = el("textarea", { rows: "3", placeholder: `Comment on #${pr.number}…`, "aria-label": "Comment" })
  const send = el("button", { class: "btn btn-primary btn-xs", type: "button" }, "Comment")
  const post = () => withBusy(send, async () => {
    if (!ta.value.trim()) return
    if (await gitAction("comment", { number: pr.number, body: ta.value }, "Comment posted.")) { ta.value = ""; if (gitPanel) gitPanel.draft = "" }
  })
  send.addEventListener("click", post)
  ta.addEventListener("keydown", (e) => { if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) { e.preventDefault(); post() } })
  return el("div", { class: "git-comment" }, ta, el("div", { class: "git-comment-foot" }, el("span", { class: "hint", text: "Ctrl+Enter posts it to GitHub" }), send))
}

/** Disable a button while its action runs. */
async function withBusy(button, fn) {
  if (button.disabled) return
  button.disabled = true
  try { await fn() } finally { if (button.isConnected) button.disabled = false }
}

function fixChecksPrompt(pr, failed) {
  const lines = failed.map((c) => `- ${c.workflow ? `${c.workflow} / ` : ""}${c.name}${c.url ? ` (${c.url})` : ""}`)
  return `These checks failed on pull request #${pr.number} (${pr.url}):\n${lines.join("\n")}\n\nRead their logs (\`gh run view --log-failed\`), fix the cause on ${pr.head}, run the checks locally, then commit and push.`
}
function addressPrompt(pr) {
  return `Address the review comments on pull request #${pr.number} (${pr.url}). Read them with \`gh pr view ${pr.number} --comments\` and \`gh api repos/{owner}/{repo}/pulls/${pr.number}/comments\`, make the changes on ${pr.head}, run the checks, then commit and push.`
}

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

// ---------- settings: a modal, its settings grouped into sections down the left ----------
const SETTINGS_SECTIONS = [
  ["providers", "Providers", '<path d="M8 1.8 13.5 5v6L8 14.2 2.5 11V5z"/><path d="M2.5 5 8 8.2 13.5 5M8 8.2v6"/>'],
  ["threads", "New threads", '<path d="M2.5 3.5h11v7h-6l-3 2.5v-2.5h-2z"/>'],
  ["memory", "Memory", '<path d="M8 2.5a5.5 5.5 0 1 0 5.5 5.5"/><path d="M8 5v3l2 1.5"/><path d="M11 1.8 13.8 2l.2 2.8"/>'],
  ["genome", "Genome", '<path d="M5 1.5c0 4 6 5 6 9.5M11 1.5c0 4-6 5-6 9.5M5 14.5v-3.5M11 14.5v-3.5M6 4h4M6.3 11h3.4"/>'],
  ["storage", "Storage", '<ellipse cx="8" cy="4" rx="5.5" ry="2"/><path d="M2.5 4v8c0 1.1 2.5 2 5.5 2s5.5-.9 5.5-2V4M2.5 8c0 1.1 2.5 2 5.5 2s5.5-.9 5.5-2"/>']
]
let settingsTab = load("settingsTab", "providers")
function openSettings() {
  paintSettings()
  const d = $("settings")
  if (!d.open) d.showModal()
  d.querySelector(`.set-nav [data-tab="${settingsTab}"]`)?.focus()
}
$("open-settings").addEventListener("click", openSettings)
// A click on the backdrop (outside the box) closes it, as Escape does.
$("settings").addEventListener("click", (e) => { if (e.target === e.currentTarget) e.currentTarget.close() })

/** Paint the modal: the section list, and the chosen section's settings. Saved as they change. */
function paintSettings() {
  const d = $("settings")
  const s = structuredClone(S.settings)
  const commit = async () => {
    try {
      const r = await api("PUT", "settings", s)
      S.settings = r.settings
      S.providers = r.providers
      toast("Settings saved.")
      // Statuses may have changed (a provider turned on): paint them, keeping focus where it was.
      const label = document.activeElement?.getAttribute("aria-label")
      paintSettings()
      if (label) d.querySelector(`[aria-label="${CSS.escape(label)}"]`)?.focus()
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
  const group = (title, hint, ...rows) => el("section", { class: "set-group" },
    title ? el("h4", { class: "set-group-title" }, title) : null,
    hint ? el("p", { class: "hint", text: hint }) : null,
    el("div", { class: "rows" }, rows))
  const pill = (on, yes, no) => el("span", { class: `pill${on ? "" : " off"}` }, el("i"), on ? yes : no)
  const st = status("claude")
  const other = (p, about) => {
    const ps = status(p)
    return row(providerLabel(p), s[p].enabled ? (ps?.detail ?? about) : about,
      el("span", { class: "row-end" }, s[p].enabled ? pill(ps?.available, "Ready", "Unavailable") : null,
        sw(() => s[p].enabled, (v) => (s[p].enabled = v), `${providerLabel(p)} on`)))
  }
  const sections = {
    providers: () => [
      group(el("span", { class: "set-title-row" }, "Claude", pill(st?.available, "Ready", "Off")),
        "Through the Claude Agent SDK, signed in the way Claude Code is on this machine.",
        row("On", "Off stops new turns; threads stay.", sw(() => s.claude.enabled, (v) => (s.claude.enabled = v), "Claude on")),
        row("Model for new threads", "Each thread can switch from its composer.", sel((st?.models ?? [s.claude.model]).map((m) => [m, modelName(m)]), () => s.claude.model, (v) => (s.claude.model = v), "Model")),
        row("Effort for new threads", "How hard Claude thinks each step. Higher is slower and costs more.", sel(EFFORTS.claude, () => s.claude.effort, (v) => (s.claude.effort = v), "Effort"))),
      group("More providers", "Their models join the model menu, grouped by provider. Switching a thread to another provider starts a new session.",
        other("codex", "OpenAI's Codex, signed in as the Codex CLI is. Runs in its own sandbox and can't stop to ask."),
        other("ollama", "Models on this machine through Ollama, as plain chat: no tools."))
    ],
    threads: () => [
      group(null, "What new threads start with. Open threads keep their own model and access.",
        row("What Claude may do without asking", ACCESS.find(([v]) => v === s.defaultAccess)[2], sel(ACCESS.map(([v, l]) => [v, l]), () => s.defaultAccess, (v) => (s.defaultAccess = v), "Default access"))),
      group("Titles", "A new thread is named from its first message. You can rename any thread by its title.",
        row("Name threads with a small model", "Off keeps the first line of your first message as the title. Needs Claude on.", sw(() => s.titles.auto, (v) => (s.titles.auto = v), "Name threads with a small model")),
        row("Model that names them", "Small is fast and cheap; a title is a few words.", sel((st?.models ?? [s.titles.model]).map((m) => [m, modelName(m)]), () => s.titles.model, (v) => (s.titles.model = v), "Title model")))
    ],
    memory: () => [
      group("singularity", "Memory of changes committed in each repository. It needs singularity installed; without it, threads work the same.",
        row("Recall at each message", "Hand Claude the past change in this project most like what you asked.", sw(() => s.memory.recall, (v) => (s.memory.recall = v), "Recall")),
        row("Store what threads commit", "After a turn that commits, keep that commit for the next thread to recall.", sw(() => s.memory.store, (v) => (s.memory.store = v), "Store")))
    ],
    genome: () => [
      group(null, "zero's solver instructions and lessons, which Evolution improves.",
        row("Use zero's evolved instructions", "Add them to every thread.", sw(() => s.useGenome, (v) => (s.useGenome = v), "Use genome")))
    ],
    storage: () => [
      group(null, null,
        row("Threads, projects and settings", null, el("span", { class: "path", text: S.home })),
        row("zero itself", null, el("span", { class: "path", text: S.zeroRoot })))
    ]
  }
  if (!sections[settingsTab]) settingsTab = "providers"
  const [, title] = SETTINGS_SECTIONS.find(([k]) => k === settingsTab)
  const pick = (k) => { settingsTab = k; save("settingsTab", k); paintSettings(); d.querySelector(`.set-nav [data-tab="${k}"]`)?.focus() }
  const nav = el("nav", { class: "set-nav", "aria-label": "Settings sections" },
    el("h2", { class: "set-heading", id: "settings-title", text: "Settings" }),
    SETTINGS_SECTIONS.map(([k, label, paths], i) => el("button", {
      class: `set-tab${k === settingsTab ? " on" : ""}`, type: "button", "data-tab": k, "aria-current": k === settingsTab ? "page" : null,
      onclick: () => pick(k),
      // Up and Down move between sections.
      onkeydown: (e) => {
        if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return
        e.preventDefault()
        pick(SETTINGS_SECTIONS[(i + (e.key === "ArrowDown" ? 1 : -1) + SETTINGS_SECTIONS.length) % SETTINGS_SECTIONS.length][0])
      }
    }, icon(paths), el("span", { text: label }))))
  const close = el("button", { class: "icon-btn set-close", type: "button", title: "Close (Esc)", "aria-label": "Close settings", text: "×", onclick: () => d.close() })
  d.replaceChildren(nav, el("div", { class: "set-body" },
    el("header", { class: "set-head" }, el("h3", { text: title }), el("span", { class: "hint", text: "Saved as you change them." }), close),
    el("div", { class: "set-scroll" }, sections[settingsTab]())))
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
    el("div", {}, el("h1", { text: "Evolution" }), el("p", { class: "lede", text: `zero rewrites its own genome and keeps a change only when the benchmark says it's better. Spent so far: ${usd(E.spentUsd)}.` })),
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
  const on = {}
  on["thread"] = (meta) => {
    const i = S.threads.findIndex((t) => t.id === meta.id)
    if (i >= 0) S.threads[i] = meta
    else S.threads.unshift(meta)
    S.threads.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
    if (meta.status !== "running") S.asking.delete(meta.id)
    if (S.open?.id === meta.id) {
      // A turn that just ended may have committed, pushed or opened a PR: the Git panel looks again.
      const ended = S.open.status === "running" && meta.status !== "running"
      Object.assign(S.open, meta)
      if (ended && gitPanel?.threadId === meta.id) loadGit()
      if (!("effort" in meta)) delete S.open.effort // cleared: back to the provider's default
      if (feed && document.activeElement !== feed.title) feed.title.value = meta.title
      if (feed) {
        feed.models.set({ provider: meta.provider, model: meta.model, effort: meta.effort ?? defaultEffort(meta.provider) })
        feed.models.setAccess(meta.access)
        paintReady(S.open)
      }
      paintWorking()
    }
    renderSide()
  }
  on["threads"] = (data) => {
    S.threads = data
    if (S.open && !S.threads.some((t) => t.id === S.open.id)) go("#/")
    renderSide()
  }
  on["item"] = ({ threadId, item }) => {
    if (item.kind === "permission") {
      item.state === "pending" ? S.asking.add(threadId) : S.asking.delete(threadId)
      renderSide()
      if (item.state === "pending" && S.open?.id !== threadId) toast(`A thread is waiting for your approval.`)
    }
    if (S.open?.id === threadId && feed) upsertItem(item)
  }
  on["delta"] = ({ threadId, itemId, delta }) => {
    if (S.open?.id === threadId) applyDelta(itemId, delta)
  }
  on["projects"] = (data) => {
    S.projects = data
    renderSide()
    if (S.route.name === "home" || S.route.name === "new") renderMain()
  }
  on["settings"] = (data) => { S.settings = data }
  on["zero-log"] = (entry) => {
    if (!S.evo) return
    S.evo.log.push(entry)
    const log = $("evo-log")
    if (log) {
      if (S.evo.log.length === 1) log.replaceChildren()
      const stick = log.scrollHeight - log.scrollTop - log.clientHeight < 40
      log.append(logLine(entry.line))
      if (stick) log.scrollTop = log.scrollHeight
    }
  }
  const evoRefresh = () => { clearTimeout(evoTimer); evoTimer = setTimeout(() => S.route.name === "evolution" && loadEvo(), 300) }
  on["zero-job"] = (j) => {
    if (j.state === "done") toast("Evolution run finished.")
    if (j.state === "failed") toast("Evolution run failed. The output says why.", true)
    evoRefresh()
  }
  on["zero-state"] = evoRefresh
  // A desktop notification clicked: its thread.
  on["open"] = ({ threadId }) => { if (S.threads.some((t) => t.id === threadId)) go(`#/t/${threadId}`) }
  // The backend runs in this app, so the stream never drops: no reconnecting.
  zero.on((event, data) => on[event]?.(data))
}

// ---------- command palette ----------
/** Ctrl+K (Cmd+K): every thread, project and place, filtered as you type; Enter goes, arrows choose. */
function openPalette() {
  const d = $("palette")
  if (d.open) return
  const entries = [
    ...S.threads.map((t) => ({ label: t.title, hint: S.projects.find((p) => p.id === t.projectId)?.name ?? "", run: () => go(`#/t/${t.id}`) })),
    ...S.projects.map((p) => ({ label: `New thread in ${p.name}`, hint: p.path, run: () => go(`#/new/${p.id}`) })),
    { label: "Evolution", hint: "zero's lineage and runs", run: () => go("#/evolution") },
    { label: "Settings", hint: "models, access, memory", run: () => openSettings() },
    ...(gitPanel ? [{ label: gitOpenNow() ? "Hide the Git panel" : "Show the Git panel", hint: "Alt+G", run: () => setGitOpen(!gitOpenNow()) }] : []),
    { label: "Add a project", hint: "a folder on this machine", run: () => addProject() }
  ]
  const input = el("input", { type: "search", placeholder: "Go to a thread, project or place…", "aria-label": "Search", autocomplete: "off", spellcheck: "false" })
  const list = el("ul", { class: "palette-list", role: "listbox" })
  let shown = []
  let at = 0
  const paint = () => {
    const words = input.value.trim().toLowerCase().split(/\s+/).filter(Boolean)
    shown = entries.filter((x) => words.every((w) => `${x.label} ${x.hint}`.toLowerCase().includes(w))).slice(0, 50)
    at = Math.min(at, Math.max(0, shown.length - 1))
    list.replaceChildren(...(shown.length ? shown.map((x, i) => el("li", { class: `palette-item${i === at ? " on" : ""}`, role: "option", "aria-selected": String(i === at), onmousedown: (e) => { e.preventDefault(); choose(i) } },
      el("span", { class: "palette-label", text: x.label }), el("span", { class: "palette-hint", text: x.hint }))) : [el("li", { class: "palette-none", text: "Nothing matches." })]))
    list.children[at]?.scrollIntoView({ block: "nearest" })
  }
  const choose = (i) => { const x = shown[i]; d.close(); if (x) x.run() }
  input.addEventListener("input", () => { at = 0; paint() })
  input.addEventListener("keydown", (e) => {
    if (e.key === "ArrowDown" || e.key === "ArrowUp") { e.preventDefault(); at = (at + (e.key === "ArrowDown" ? 1 : -1) + shown.length) % Math.max(1, shown.length); paint() }
    else if (e.key === "Enter" && !e.isComposing) { e.preventDefault(); choose(at) }
  })
  d.replaceChildren(input, list)
  d.addEventListener("close", () => d.replaceChildren(), { once: true })
  d.addEventListener("click", (e) => { if (e.target === d) d.close() })
  paint()
  d.showModal()
  input.focus()
}

// ---------- keys ----------
document.addEventListener("keydown", (e) => {
  if ((e.ctrlKey || e.metaKey) && !e.altKey && (e.key === "k" || e.key === "K")) {
    e.preventDefault()
    if ($("palette").open) $("palette").close()
    else if (!$("dialog").open && !$("settings").open) openPalette()
    return
  }
  if ($("dialog").open || $("palette").open) return
  const typing = e.target.isContentEditable || e.target instanceof HTMLTextAreaElement || e.target instanceof HTMLInputElement || e.target instanceof HTMLSelectElement
  if (e.altKey && (e.key === "n" || e.key === "N")) {
    e.preventDefault()
    const pid = S.open?.projectId ?? S.route.projectId ?? S.projects[0]?.id
    if (pid) go(`#/new/${pid}`)
    return
  }
  if (e.altKey && (e.key === "g" || e.key === "G") && gitPanel) {
    e.preventDefault()
    setGitOpen(!gitOpenNow())
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
$("add-project").addEventListener("click", addProject)
// An hour idle is reached by the clock, not by an event: look again each minute.
setInterval(() => { if (S.open) paintCompact(S.open) }, 60_000)
// A file dropped anywhere but the composer would open in place of the app; it does nothing instead.
for (const type of ["dragover", "drop"]) {
  addEventListener(type, (e) => { if (e.dataTransfer?.types.includes("Files") && !e.target.closest?.(".composer")) e.preventDefault() })
}
addEventListener("resize", () => { if (S.route.name === "evolution" && S.evo) paintEvo() })
setInterval(() => renderSide(), 60_000)

// ---------- start ----------
async function boot() {
  try {
    const b = await api("GET", "bootstrap")
    Object.assign(S, { settings: b.settings, projects: b.projects, threads: b.threads, providers: b.providers, home: b.home, zeroRoot: b.zeroRoot })
  } catch (e) {
    $("main").replaceChildren(el("div", { class: "start" }, el("div", { class: "start-inner" },
      el("h1", { text: "Can't reach zero" }),
      el("p", { class: "lede", text: `${e.message}. Restart the app; if it keeps happening, run it from a terminal with \`npm run app\` to see why.` }))))
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
