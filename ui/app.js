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
/**
 * A phone or tablet (remote access): a finger for a pointer, and no hover. There Enter makes a new
 * line (Send sends), nothing opens the keyboard unasked, and a long press opens a row's actions.
 */
const touchFirst = matchMedia("(hover: none) and (pointer: coarse)")
/** This page came over remote access (ui/web.js), not in zero's own window (zero://). */
const remote = location.protocol !== "zero:"
/** What last pressed: "mouse", "pen" or "touch". */
let lastPointer = "mouse"
addEventListener("pointerdown", (e) => { lastPointer = e.pointerType || "mouse" }, true)

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
  evo: null,
  /** The plan's usage windows as Claude last reported them ({ kind, status, used, resetsAt }). */
  limits: [],
  /** Each thread's session's slash commands (thread id → [{ name, description, hint }]), as its provider last said. */
  commands: new Map(),
  /** What the sidebar's search found in threads' messages (zero.db's index): for the words `q`. */
  hits: { q: "", list: [] },
  /** An item to bring into view once its thread is open (a search hit's). */
  jump: null
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

/**
 * A note in the corner. `action` ({ label, run }) adds a button that does something about it;
 * such a toast stays longer, and waits while the pointer is on it. `thread` ties it to a thread,
 * so it goes away once that thread is open.
 */
function toast(text, error = false, { action = null, thread = null } = {}) {
  const box = $("toasts")
  const t = el("div", { class: `toast${error ? " error" : ""}${action ? " has-cta" : ""}`, role: error ? "alert" : "status", "data-thread": thread },
    el("span", { class: "toast-text", text }))
  const close = () => { t.remove(); if (!box.children.length && box.matches(":popover-open")) box.hidePopover() }
  if (action) t.append(el("button", { class: "toast-cta", type: "button", onclick: () => { close(); action.run() } }, action.label))
  box.append(t)
  // Shown afresh so it lands above anything in the top layer (an open modal); put away when empty.
  if (box.matches(":popover-open")) box.hidePopover()
  box.showPopover()
  const ms = action ? 9000 : error ? 7000 : 3000
  let timer = setTimeout(close, ms)
  if (action) {
    t.addEventListener("pointerenter", () => clearTimeout(timer))
    t.addEventListener("pointerleave", () => { timer = setTimeout(close, 3000) })
  }
}
/** A toast about a thread, with a button that opens it. */
const threadToast = (threadId, text, error = false) =>
  toast(text, error, { thread: threadId, action: { label: "Open thread", run: () => go(`#/t/${threadId}`) } })
/** Opening a thread puts away the toasts about it. */
function clearThreadToasts(threadId) {
  const box = $("toasts")
  for (const t of box.querySelectorAll(".toast[data-thread]")) if (t.dataset.thread === threadId) t.remove()
  if (!box.children.length && box.matches(":popover-open")) box.hidePopover()
}
const fail = (e) => toast(e.message, true)
const threadName = (id) => S.threads.find((t) => t.id === id)?.title ?? "A thread"

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
  // A finger has no hover: a tap would leave a tip standing over what it opened.
  if (e.pointerType === "touch") return
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

/**
 * A short list of things to do with something, `title`: a sheet up from the bottom on a phone, a small
 * box elsewhere. Each action is { label, run, danger }. A tap outside, Cancel or Escape puts it away.
 */
function actionSheet(title, actions) {
  const d = el("dialog", { class: "sheet", "aria-label": title })
  const close = () => d.close()
  d.append(el("div", { class: "sheet-box" },
    el("div", { class: "sheet-title", text: title }),
    actions.map((a) => el("button", { class: `sheet-item${a.danger ? " danger" : ""}`, type: "button", onclick: () => { close(); a.run() } }, a.label))),
    el("button", { class: "sheet-item sheet-cancel", type: "button", onclick: close }, "Cancel"))
  d.addEventListener("click", (e) => { if (e.target === d) close() })
  d.addEventListener("close", () => d.remove())
  document.body.append(d)
  d.showModal()
}
/**
 * A right-click menu of `actions` ({ label, run, danger, icon }) at (`x`, `y`): a small list by the pointer,
 * not a modal. A click elsewhere, Escape, a scroll or the window losing focus puts it away; Up and Down
 * move between its items. Only one is open at a time.
 */
let ctxMenu = null
function contextMenu(x, y, title, actions) {
  ctxMenu?.close()
  const back = document.activeElement
  const m = el("div", { class: "ctx-menu", role: "menu", "aria-label": title, popover: "auto" },
    actions.map((a) => el("button", { class: `ctx-item${a.danger ? " danger" : ""}`, type: "button", role: "menuitem", tabindex: -1,
      onclick: () => { close(); a.run() } }, a.icon ? icon(a.icon) : el("span", { class: "ico" }), el("span", { text: a.label }))))
  /** Put away: by a pick, a key, or the browser's light dismiss (a click elsewhere). Safe to run twice. */
  const close = () => {
    if (!m.isConnected) return
    if (m.matches(":popover-open")) m.hidePopover()
    removeEventListener("blur", close)
    removeEventListener("resize", close)
    removeEventListener("scroll", close, true)
    m.remove()
    if (ctxMenu?.node === m) ctxMenu = null
    // Back to where focus was, unless a click put it somewhere else since.
    if (!document.activeElement || document.activeElement === document.body) back?.focus?.({ preventScroll: true })
  }
  m.addEventListener("toggle", (e) => { if (e.newState === "closed") close() })
  m.addEventListener("keydown", (e) => {
    if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); close(); return }
    const items = [...m.querySelectorAll(".ctx-item")]
    const i = items.indexOf(document.activeElement)
    const to = e.key === "ArrowDown" ? (i + 1) % items.length : e.key === "ArrowUp" ? (i - 1 + items.length) % items.length
      : e.key === "Home" ? 0 : e.key === "End" ? items.length - 1 : -1
    if (to < 0) return
    e.preventDefault()
    items[to].focus()
  })
  document.body.append(m)
  m.showPopover()
  // Opens down and right of the pointer, flipped where that would leave the window.
  const w = m.offsetWidth, h = m.offsetHeight
  m.style.left = `${Math.max(6, x + w > innerWidth - 6 ? x - w : x)}px`
  m.style.top = `${Math.max(6, y + h > innerHeight - 6 ? y - h : y)}px`
  addEventListener("blur", close)
  addEventListener("resize", close)
  addEventListener("scroll", close, true)
  m.querySelector(".ctx-item")?.focus({ preventScroll: true })
  ctxMenu = { node: m, close }
}
/**
 * The actions `menu()` names ({ title, actions }) on a long press of `node` by a finger (a sheet up from the
 * bottom), or a right-click (a menu at the pointer). The press doesn't also follow the link under it, and the
 * phone's own link menu stays away (app.css: -webkit-touch-callout).
 */
function onHold(node, menu) {
  let timer = 0
  let start = null
  let held = false
  const sheet = () => { const { title, actions } = menu(); actionSheet(title, actions) }
  const cancel = () => { clearTimeout(timer); timer = 0 }
  node.addEventListener("pointerdown", (e) => {
    held = false
    if (e.pointerType === "mouse") return
    start = { x: e.clientX, y: e.clientY }
    timer = setTimeout(() => { timer = 0; held = true; navigator.vibrate?.(8); sheet() }, 450)
  })
  // Moving the finger (a scroll) isn't a press.
  node.addEventListener("pointermove", (e) => { if (timer && Math.hypot(e.clientX - start.x, e.clientY - start.y) > 8) cancel() })
  for (const type of ["pointerup", "pointercancel", "pointerleave"]) node.addEventListener(type, cancel)
  node.addEventListener("click", (e) => { if (held) { e.preventDefault(); e.stopPropagation(); held = false } }, true)
  node.addEventListener("contextmenu", (e) => {
    e.preventDefault()
    // A finger's long press fires this too: that's the sheet's.
    if (held || timer) { cancel(); if (!held) { held = true; sheet() } return }
    // The keyboard's menu key has no pointer: the menu opens at the row.
    const r = node.getBoundingClientRect()
    const keyed = e.button !== 2 && e.clientX === 0 && e.clientY === 0
    const { title, actions } = menu()
    contextMenu(keyed ? r.left + 12 : e.clientX, keyed ? r.bottom - 4 : e.clientY, title, actions)
  })
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
/** The thread on screen, with zero in front, has been seen: its ended turn leaves Needs you. */
function markSeen() {
  const t = S.open
  if (!t?.unseen || !document.hasFocus()) return
  delete t.unseen
  const meta = S.threads.find((m) => m.id === t.id)
  if (meta) delete meta.unseen
  api("PATCH", `threads/${t.id}`, { seen: true }).catch(() => {})
}
addEventListener("focus", () => { markSeen(); renderSide() })

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
      clearThreadToasts(S.route.id)
      markSeen()
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
  // A thread that needs the person, or is working, moves up to those sections; one with unsent
  // words in its reply box moves up to Drafts. Either way it isn't listed twice.
  const inbox = inboxSections(q)
  const drafted = draftedThreadIds(inbox.ids)
  for (const t of S.threads) if (!drafted.has(t.id) && !inbox.ids.has(t.id)) byProject.get(t.projectId)?.push(t)
  shownDrafted = [...drafted].sort().join(" ")
  shownInbox = inbox.key
  // The window's title counts what needs you, so the taskbar says so while you're elsewhere.
  const waiting = S.threads.filter((t) => { const st = inboxState(t); return st && st !== "working" }).length
  document.title = waiting ? `(${waiting}) zero` : "zero"
  const hasThreads = new Set(S.threads.map((t) => t.projectId))
  // Pinned threads first, each group newest first as S.threads is; a thread another started sits under it.
  for (const [id, list] of byProject) byProject.set(id, nested(list.sort((a, b) => Number(Boolean(b.pinned)) - Number(Boolean(a.pinned)))))
  const shown = S.projects.flatMap((p) => {
    const all = byProject.get(p.id) ?? []
    if (!q || p.name.toLowerCase().includes(q)) return [[p, all]]
    const hits = all.filter((t) => t.title.toLowerCase().includes(q))
    return hits.length ? [[p, hits]] : []
  })
  const draftsSec = draftsSection(inbox.ids)
  // Threads whose messages match (not their titles: those are listed above it already).
  const listed = new Set([...inbox.ids, ...shown.flatMap(([, ts]) => ts.map((t) => t.id))])
  const found = hitsSection(q, listed)
  if (q && shown.length === 0 && !draftsSec && !inbox.nodes.length && !found) {
    const looking = q.length >= 2 && S.hits.q !== q
    return tree.replaceChildren(el("p", { class: "tree-empty", text: looking ? "Searching messages…" : `No threads match “${S.query.trim()}”.` }))
  }
  tree.replaceChildren(...inbox.nodes, ...(draftsSec ? [draftsSec] : []), ...(found ? [found] : []), ...shown.map(([p, threads]) => {
    const closed = !q && S.collapsed.has(p.id)
    return el("section", { class: `proj${closed ? " closed" : ""}`, "data-id": p.id },
      held(el("div", { class: "proj-head" },
        el("button", { class: "proj-toggle", type: "button", "aria-expanded": String(!closed), title: p.path, onclick: () => toggleProject(p.id) },
          el("span", { class: "proj-name", text: p.name })),
        el("span", { class: "proj-actions" },
          el("button", { class: "icon-btn", type: "button", title: `New thread in ${p.name}`, "aria-label": `New thread in ${p.name}`, onclick: () => go(`#/new/${p.id}`) }, "+"),
          el("button", { class: "icon-btn proj-remove", type: "button", title: `Remove ${p.name} from zero`, "aria-label": `Remove ${p.name}`, onclick: () => removeProject(p) }, "×"))),
        () => ({ title: p.name, actions: [
          { label: "New thread", icon: PLUS_PATHS, run: () => go(`#/new/${p.id}`) },
          { label: "Copy folder path", icon: COPY_PATHS, run: () => copyText(p.path, "Folder path copied.") },
          { label: "Remove from zero", icon: TRASH_PATHS, danger: true, run: () => removeProject(p) }
        ] })),
      el("ul", { class: "threads", inert: closed },
        threads.length === 0
          // Every thread of it is up in Drafts: it still has threads, just none to list here.
          ? (hasThreads.has(p.id) ? [] : el("li", { class: "none", text: "No threads yet" }))
          : threads.map((t) => threadRow(t))))
  }))
  for (const a of document.querySelectorAll(".foot-link")) a.classList.toggle("active", a.dataset.route === S.route.name)
}
/** The sidebar's "In messages": threads whose messages match the search, each with the words around the match. */
function hitsSection(q, listed) {
  if (!q || S.hits.q !== q) return null
  const rows = S.hits.list.filter((h) => h.itemId && !listed.has(h.threadId)).map((h) => ({ h, t: threadMeta(h.threadId) })).filter((x) => x.t)
  if (!rows.length) return null
  return el("section", { class: "proj inbox hits", "aria-label": "In messages" },
    el("div", { class: "proj-head" }, el("span", { class: "proj-name", text: "In messages" }), el("span", { class: "inbox-count", text: String(rows.length) })),
    el("ul", { class: "threads" }, rows.map(({ h, t }) => el("li", { class: "thread-row hit-row" },
      el("a", { class: `thread-link hit-link${S.open?.id === t.id ? " active" : ""}`, href: `#/t/${t.id}`, onclick: () => { S.jump = h.itemId } },
        el("span", { class: "t", text: t.title }),
        el("span", { class: "hit-snippet" }, ...marked(h.snippet)))))))
}
/** A search snippet as text, its matched words (between \u0002 and \u0003) in <mark>: built as nodes, never as HTML. */
function marked(snippet) {
  return snippet.split("\u0002").flatMap((part, i) => {
    if (i === 0) return [part]
    const [hit, rest = ""] = part.split("\u0003")
    return [el("mark", { text: hit }), rest]
  })
}
/** Search the messages of every thread, a moment after the typing stops; the sidebar lists what's found. */
let searching = 0
function searchSoon() {
  clearTimeout(searching)
  const q = S.query.trim().toLowerCase()
  if (q.length < 2) return
  searching = setTimeout(async () => {
    const list = await api("GET", `search/${encodeURIComponent(q)}`).catch(() => [])
    if (S.query.trim().toLowerCase() !== q) return
    S.hits = { q, list }
    renderSide()
  }, 140)
}
/** A thread's row in the sidebar: its marks, title and age; pin and delete on hover. `where` names its project (in Needs you and Working). */
function threadRow(t, where = "") {
  const started = t.parentId ? `Started by “${threadMeta(t.parentId)?.title ?? "another thread"}”` : ""
  return held(el("li", { class: `thread-row${t.pinned ? " pinned" : ""}${t.depth ? " child" : ""}${where !== "" ? " inbox-row" : ""}`, style: t.depth ? `--depth: ${t.depth}` : null },
    el("a", { class: `thread-link${S.open?.id === t.id ? " active" : ""}`, href: `#/t/${t.id}`, "aria-current": S.open?.id === t.id ? "page" : null,
      title: [where ? `In ${where}` : "", started].filter(Boolean).join("\n") || null },
      t.depth ? el("span", { class: "child-mark", "aria-hidden": "true", html: `<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round">${CHILD_PATHS}</svg>` }) : null,
      ...threadMarks(t),
      el("span", { class: "t", text: t.title }),
      prMark(t.pr),
      where ? el("span", { class: "t-where", text: where }) : null,
      el("span", { class: "age", text: ago(t.updatedAt) })),
    // Pinning and deleting live here, on the row's hover, rather than in the thread's header (a long press, by touch).
    el("button", { class: "icon-btn thread-pin", type: "button", title: t.pinned ? "Unpin thread" : "Pin to the top", "aria-label": `${t.pinned ? "Unpin" : "Pin"} ${t.title}`, "aria-pressed": String(Boolean(t.pinned)), html: PIN_ICON, onclick: () => pinThread(t) }),
    el("button", { class: "icon-btn thread-del", type: "button", title: "Delete thread", "aria-label": `Delete ${t.title}`, html: TRASH_ICON, onclick: () => deleteThread(t) })),
  () => threadMenu(t))
}
/**
 * Where a thread stands for the person: "ask" (waiting for their approval), "failed" or "done" (a turn
 * ended that they haven't looked at), "working", or "" (nothing for them: it's listed under its project).
 * The thread on screen is seen as it ends.
 */
const inboxState = (t) =>
  t.status === "running" ? (S.asking.has(t.id) ? "ask" : "working") : t.unseen && S.open?.id !== t.id ? t.unseen : ""
const NEEDS_ORDER = { ask: 0, failed: 1, done: 2 }
/** The state each inbox section's rows were last drawn in: a thread changing section redraws the sidebar. */
let shownInbox = ""
/**
 * Needs you (waiting for an approval, or a turn ended unseen) and Working, above Drafts and the projects,
 * as an inbox: what to look at next is at the top. Each section shows only when it has threads.
 */
function inboxSections(q) {
  const projectName = (t) => S.projects.find((p) => p.id === t.projectId)?.name ?? ""
  const many = S.projects.length > 1
  const needs = [], working = []
  for (const t of S.threads) {
    const state = inboxState(t)
    if (!state) continue
    if (q && !`${t.title} ${projectName(t)}`.toLowerCase().includes(q)) continue
    ;(state === "working" ? working : needs).push({ t, state })
  }
  needs.sort((a, b) => NEEDS_ORDER[a.state] - NEEDS_ORDER[b.state] || b.t.updatedAt.localeCompare(a.t.updatedAt))
  const section = (cls, label, rows) => rows.length
    ? [el("section", { class: `proj inbox ${cls}`, "aria-label": label },
      el("div", { class: "proj-head" }, el("span", { class: "proj-name", text: label }), el("span", { class: "inbox-count", text: String(rows.length) })),
      el("ul", { class: "threads" }, rows.map(({ t }) => threadRow(t, many ? projectName(t) : ""))))]
    : []
  const ids = new Set([...needs, ...working].map(({ t }) => t.id))
  return {
    ids,
    key: [...needs, ...working].map(({ t, state }) => `${t.id}:${state}`).join(" "),
    nodes: [...section("needs", "Needs you", needs), ...section("working-sec", "Working", working)]
  }
}
/**
 * A project's threads in sidebar order, each thread another started right under it (newest first),
 * marked with how deep it sits: `{ ...meta, depth }`. A thread whose starter isn't in the list stands alone.
 */
function nested(list) {
  const here = new Set(list.map((t) => t.id))
  const kids = new Map()
  for (const t of list) if (t.parentId && here.has(t.parentId)) kids.set(t.parentId, [...(kids.get(t.parentId) ?? []), t])
  const out = []
  const seen = new Set()
  const add = (t, depth) => {
    if (seen.has(t.id)) return
    seen.add(t.id)
    out.push(depth ? { ...t, depth } : t)
    for (const k of kids.get(t.id) ?? []) add(k, depth + 1)
  }
  for (const t of list) if (!t.parentId || !here.has(t.parentId)) add(t, 0)
  for (const t of list) add(t, 0) // a loop of starters, which shouldn't happen, still lists them
  return out
}
const CHILD_PATHS = '<path d="M4 3v5.5A1.5 1.5 0 0 0 5.5 10H12M9.5 7.5 12 10l-2.5 2.5"/>'
// The right-click menu's icons: the paths of the row's own icons below.
const COPY_PATHS = '<rect x="5.5" y="5.5" width="8" height="8" rx="2"/><path d="M10.5 3.5v-.5A1.5 1.5 0 0 0 9 1.5H4A1.5 1.5 0 0 0 2.5 3v5A1.5 1.5 0 0 0 4 9.5h.5"/>'
const PIN_PATHS = '<path d="M9.5 2 14 6.5l-2 .5-2.5 2.5.5 3-1 1-3-3L3 13.5M5 9 2.5 6.5l1-1 3 .5L9 3.5z"/>'
const TRASH_PATHS = '<path d="M2.5 4h11M6 4V2.5h4V4M4 4l.7 9.5h6.6L12 4M6.6 6.5v4.5M9.4 6.5v4.5"/>'
const DISCARD_PATHS = '<path d="M4.5 4.5l7 7M11.5 4.5l-7 7"/>'
/** `node`, with `open` on a long press or right-click. */
const held = (node, open) => { onHold(node, open); return node }
const pinThread = (t) => api("PATCH", `threads/${t.id}`, { pinned: !t.pinned }).catch(fail)
/** What a right-click or long press on a thread offers: what its row's hover buttons do, and copying its id. */
const threadMenu = (t, draftKey = "") => ({ title: t.title, actions: [
  ...(draftKey ? [{ label: "Discard draft", icon: DISCARD_PATHS, run: () => discardDraft(draftKey) }] : []),
  { label: t.pinned ? "Unpin" : "Pin to the top", icon: PIN_PATHS, run: () => pinThread(t) },
  { label: "Copy thread ID", icon: COPY_PATHS, run: () => copyText(t.id, "Thread ID copied.") },
  { label: "Delete thread", icon: TRASH_PATHS, danger: true, run: () => deleteThread(t) }
] })
/** Put `text` on the clipboard, and say so. */
async function copyText(text, said = "Copied.") {
  try {
    await navigator.clipboard.writeText(text)
    toast(said)
  } catch { toast("Couldn't copy: the browser blocked the clipboard.", true) }
}
/** A thread's dot (working, waiting for an approval, or ended unseen) and its pin, ahead of its title. */
const DOTS = {
  working: ["run-dot", "Working"],
  ask: ["ask-dot", "Waiting for your approval"],
  done: ["done-dot", "Finished: your turn"],
  failed: ["fail-dot", "Stopped on an error"]
}
/** The thread's pull request after its title, coloured by how it stands: open, draft, merged or closed. */
const prMark = (pr) => pr
  ? el("span", { class: "pr-mark", "data-state": String(pr.state).toLowerCase(), title: `PR #${pr.number} · ${PR_STATE_LABEL[String(pr.state).toLowerCase()] ?? pr.state} · ${pr.branch}`, text: `#${pr.number}` })
  : null
const threadMarks = (t) => {
  const dot = DOTS[inboxState(t)]
  return [
    dot ? el("span", { class: dot[0], title: dot[1] }) : null,
    t.pinned ? el("span", { class: "pin-mark", title: "Pinned", html: PIN_ICON }) : null
  ]
}
/** The threads with words waiting in their reply box: listed under Drafts, not under their project (nor those in `inbox`). */
function draftedThreadIds(inbox = new Set()) {
  const ids = new Set()
  for (const key of drafts.keys()) if (key.startsWith("t:") && !inbox.has(key.slice(2)) && S.threads.some((t) => t.id === key.slice(2))) ids.add(key.slice(2))
  return ids
}
/** The drafted threads the sidebar last left out of their projects, to know when to redraw it whole. */
let shownDrafted = ""
/**
 * Drafts: every box with words not yet sent, newest first, above the projects. A new thread's
 * draft goes back to its project's start page, titled by its words. A reply's draft is its thread
 * itself, moved up out of its project (its title, its words on hover) until it's sent or emptied.
 */
function draftsSection(inbox = new Set()) {
  const q = S.query.trim().toLowerCase()
  const rows = []
  for (const [key, d] of drafts) {
    const cut = key.indexOf(":")
    const kind = key.slice(0, cut), id = key.slice(cut + 1)
    const thread = kind === "t" ? S.threads.find((t) => t.id === id) : null
    const project = S.projects.find((p) => p.id === (thread ? thread.projectId : id))
    // A draft whose thread or project was removed goes with it.
    if (!project || (kind === "t" && !thread)) { drafts.delete(key); continue }
    // A thread that needs the person, or is working, is listed up there instead.
    if (thread && inbox.has(thread.id)) continue
    const where = thread ? `Reply in “${thread.title}”` : `New thread in ${project.name}`
    if (q && !`${d.title} ${where} ${project.name}`.toLowerCase().includes(q)) continue
    rows.push({ key, d, where, thread, href: thread ? `#/t/${thread.id}` : `#/new/${project.id}` })
  }
  if (!rows.length) return null
  rows.sort((a, b) => b.d.at.localeCompare(a.d.at))
  return el("section", { class: "proj drafts" },
    el("div", { class: "proj-head" }, el("span", { class: "proj-name", text: "Drafts" })),
    el("ul", { class: "threads" }, rows.map(({ key, d, where, thread, href }) => {
      const active = thread ? S.open?.id === thread.id : location.hash === href
      if (thread) return held(el("li", { class: `thread-row draft-row draft-thread${thread.pinned ? " pinned" : ""}` },
        el("a", { class: `thread-link draft-link${active ? " active" : ""}`, href, title: `Unsent: ${d.title}`, "aria-current": active ? "page" : null },
          el("span", { class: "draft-mark", "aria-hidden": "true", html: DRAFT_ICON }),
          ...threadMarks(thread),
          el("span", { class: "t", text: thread.title }),
          el("span", { class: "age", text: ago(d.at) })),
        el("button", { class: "icon-btn thread-pin", type: "button", title: "Discard draft", "aria-label": `Discard draft in ${thread.title}`, html: DISCARD_ICON, onclick: () => discardDraft(key) }),
        el("button", { class: "icon-btn thread-del", type: "button", title: "Delete thread", "aria-label": `Delete ${thread.title}`, html: TRASH_ICON, onclick: () => deleteThread(thread) })),
      () => threadMenu(thread, key))
      return held(el("li", { class: "thread-row draft-row" },
        el("a", { class: `thread-link draft-link${active ? " active" : ""}`, href, title: where, "aria-current": active ? "page" : null },
          el("span", { class: "draft-mark", "aria-hidden": "true", html: DRAFT_ICON }),
          el("span", { class: "t", text: d.title }),
          el("span", { class: "age", text: ago(d.at) })),
        el("button", { class: "icon-btn thread-del", type: "button", title: "Discard draft", "aria-label": `Discard draft: ${d.title}`, html: TRASH_ICON, onclick: () => discardDraft(key) })),
      () => ({ title: d.title, actions: [{ label: "Discard draft", icon: TRASH_PATHS, danger: true, run: () => discardDraft(key) }] }))
    })))
}
/** Repaint only the Drafts section: typing changes nothing else in the sidebar. */
function paintDrafts() {
  const tree = $("tree")
  if (!tree) return
  // A thread moving into or out of Drafts changes its project's list too.
  const inbox = inboxSections("")
  if (S.query.trim() || inbox.key !== shownInbox || [...draftedThreadIds(inbox.ids)].sort().join(" ") !== shownDrafted) return renderSide()
  const old = tree.querySelector(":scope > .drafts")
  const fresh = draftsSection(inbox.ids)
  if (old && fresh) old.replaceWith(fresh)
  else if (old) old.remove()
  // Drafts go below Needs you and Working, above the projects.
  else if (fresh) tree.insertBefore(fresh, tree.querySelector(":scope > .proj:not(.inbox)"))
}
let draftsTimer = 0
/** One repaint for a burst of keystrokes. */
const paintDraftsSoon = () => { if (!draftsTimer) draftsTimer = setTimeout(() => { draftsTimer = 0; paintDrafts() }, 30) }
const DRAFT_ICON = '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"><path d="M10.5 2.5 13.5 5.5 6 13H3v-3z"/><path d="M9 4l3 3"/></svg>'
const DISCARD_ICON = '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" aria-hidden="true"><path d="M4.5 4.5l7 7M11.5 4.5l-7 7"/></svg>'
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
    el("label", { class: "field" }, "Name (optional)", el("input", { name: "name", placeholder: "The folder's name", autocomplete: "off" })),
    el("label", { class: "check" }, el("input", { type: "checkbox", name: "create", checked: true }), "Create the folder if it doesn't exist"),
    el("label", { class: "check" }, el("input", { type: "checkbox", name: "git" }), "Initialize a git repository there, with an empty first commit (skipped if it's already in one)"))
  if (!(await dialog({ title: "Add a project", text: "Paste the full path of a folder on this machine. Threads in it work there.", ok: "Add project", body }))) return
  const field = (n) => body.querySelector(`[name=${n}]`)
  try {
    const p = await api("POST", "projects", { path: field("path").value, name: field("name").value, create: field("create").checked, git: field("git").checked })
    if (p.git?.error) toast(`Added ${p.name}, but ${p.git.error}`)
    else toast(p.git === "initialized" ? `Added ${p.name} as a new git repository.` : p.git === "already" ? `Added ${p.name}; it's already in a git repository.` : `Added ${p.name}.`)
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
  if (r.name === "thread" && S.open) {
    main.replaceChildren(...threadView(S.open))
    if (S.jump) { const id = S.jump; S.jump = null; requestAnimationFrame(() => jumpTo(id)) }
    return
  }
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
// Narrow: a tap on a thread puts the sidebar away, the one already open too (that tap changes no route).
$("tree").addEventListener("click", (e) => { if (narrow.matches && !e.defaultPrevented && e.target.closest("a[href]")) closeSide() })
$("search").addEventListener("input", (e) => { S.query = e.target.value; renderSide(); searchSoon() })
$("search").addEventListener("keydown", (e) => { if (e.key === "Escape" && e.target.value) { e.stopPropagation(); e.target.value = ""; S.query = ""; renderSide() } })

// ---------- touch: the app fits what's visible above the keyboard ----------
// Chrome shrinks the page for the keyboard (index.html's viewport asks it to); Safari lays the keyboard
// over the page and scrolls it instead, which would push the header away. There the page takes the
// visible height, so the composer sits just above the keyboard and the header stays put.
if (window.visualViewport) {
  const vv = visualViewport
  const fit = () => {
    const root = document.documentElement
    if (!touchFirst.matches || vv.scale > 1.01) { root.classList.remove("keyboard"); return root.style.removeProperty("--app-h") }
    root.style.setProperty("--app-h", `${Math.round(vv.height)}px`)
    // Safari's keyboard leaves the window's height alone and shrinks only what's visible.
    root.classList.toggle("keyboard", innerHeight - vv.height > 120)
    if (scrollY !== 0) scrollTo(0, 0)
  }
  vv.addEventListener("resize", fit)
  vv.addEventListener("scroll", fit)
  touchFirst.addEventListener("change", fit)
  fit()
}

// ---------- touch, narrow: the sidebar follows a finger, out from the left edge and back ----------
{
  const side = $("side")
  const scrim = $("scrim")
  let drag = null // { x, y, from: "edge" | "side", axis: "" | "x" | "y", dx }
  const width = () => side.getBoundingClientRect().width
  const settle = (open) => {
    side.classList.remove("dragging")
    side.style.transform = ""
    scrim.style.opacity = ""
    open ? openSide() : closeSide()
  }
  addEventListener("touchstart", (e) => {
    drag = null
    if (!narrow.matches || e.touches.length !== 1 || document.querySelector("dialog[open]")) return
    const t = e.touches[0]
    const open = side.classList.contains("open")
    if (!open && t.clientX <= 22) drag = { x: t.clientX, y: t.clientY, from: "edge", axis: "", dx: 0 }
    else if (open && (side.contains(e.target) || e.target === scrim)) drag = { x: t.clientX, y: t.clientY, from: "side", axis: "", dx: 0 }
  }, { passive: true })
  addEventListener("touchmove", (e) => {
    if (!drag) return
    const t = e.touches[0]
    const dx = t.clientX - drag.x, dy = t.clientY - drag.y
    if (!drag.axis) {
      if (Math.hypot(dx, dy) < 10) return
      drag.axis = Math.abs(dx) > Math.abs(dy) ? "x" : "y"
      // Up and down is the list scrolling; a swipe the wrong way is nothing.
      if (drag.axis === "y" || (drag.from === "side" ? dx > 0 : dx < 0)) { drag = null; return }
      side.classList.add("dragging")
      scrim.hidden = false
    }
    e.preventDefault()
    drag.dx = dx
    const w = width()
    const off = drag.from === "edge" ? Math.min(0, dx - w) : Math.min(0, dx)
    side.style.transform = `translateX(${off}px)`
    scrim.style.opacity = String(Math.max(0, 1 + off / w))
  }, { passive: false })
  const end = () => {
    if (!drag || drag.axis !== "x") { drag = null; return }
    const { from, dx } = drag
    drag = null
    settle(from === "edge" ? dx > width() * 0.3 : dx > -width() * 0.3)
  }
  addEventListener("touchend", end)
  addEventListener("touchcancel", end)
}

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
  // The name the provider gives it (Claude Code names every model it offers), else one made from the id.
  const named = modelLabel(id)?.name
  if (named) return named
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

/** What a provider says of a model: { name, description, efforts }, or undefined. */
const modelLabel = (id, provider) => {
  for (const [p] of PROVIDERS) {
    if (provider && p !== provider) continue
    const label = S.providers[p]?.labels?.[id]
    if (label) return label
  }
  return undefined
}
/** The effort levels a model takes: its provider's, cut to the ones the model knows when the provider says. */
const effortsFor = (provider, model) => {
  const levels = EFFORTS[provider] ?? []
  const known = modelLabel(model, provider)?.efforts
  return known ? levels.filter(([v]) => v === "" || known.includes(v)) : levels
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
    const e = effortsFor(state.provider, state.model).length ? effortLabel(state.provider, state.effort) : ""
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
            const item = popItem({
              key: `${p}/${m}`, on, text: modelName(m), disabled: state.busy && !on,
              onPick: () => {
                const patch = { provider: p, model: m }
                // A provider change keeps the effort if the new one knows it, else takes its default.
                if (p !== state.provider && !EFFORTS[p].some(([v]) => v === state.effort)) patch.effort = defaultEffort(p)
                // A model that takes fewer effort levels keeps the effort if it can, else the nearest it takes.
                const levels = effortsFor(p, m).map(([v]) => v)
                const effort = patch.effort ?? state.effort
                if (levels.length && !levels.includes(effort)) patch.effort = levels.includes("high") ? "high" : levels.at(-1)
                save(patch)
              }
            })
            const about = modelLabel(m, p)?.description
            item.title = about ? `${about}\n${m}` : m
            return item
          }))]
      }
      // Turned on but not reachable: say why, so a missing group isn't a mystery.
      if (p !== "claude" && S.settings[p]?.enabled && st && !st.available) return [el("div", { class: "pop-group" }, el("div", { class: "pop-head", text: name }), el("div", { class: "pop-note", text: st.detail }))]
      return []
    })
    const levels = effortsFor(state.provider, state.model)
    pop.panel.replaceChildren(...[
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
        }))].filter(Boolean))
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

/** A branch's name in a list: its folder part (zero/, origin/) quiet, so the part that tells branches apart stands out. */
function branchLabel(name) {
  const cut = name.lastIndexOf("/") + 1
  return el("span", { class: "bp-branch" }, cut ? el("span", { class: "bp-dir", text: name.slice(0, cut) }) : null, name.slice(cut))
}
/** What's wrong with `name` as a new branch's name, in words; "" when it's fine or empty. `taken` is the local branches' names. */
const branchNameProblem = (name, taken) =>
  !name ? ""
    : name.startsWith("-") || /[\s~^:?*[\\]|\.\.|@\{|\/\/|\.lock$|\/$|^\//.test(name) ? "That can't be a branch name: no spaces, no “..”, and none of ~ ^ : ? * [ \\"
    : taken.includes(name) ? `${name} already exists: pick it from the list, or use another name.`
    : ""

/**
 * The branch chip, beside Attach: the branch the thread works on, or (for a new thread) the project
 * folder's. Its panel is one column with two views. The list, which opens first, has a search box, the
 * branches with their age and how they stand against their upstream, and two commands: New branch… and
 * New worktree…. The new view is a small form: a new branch, either in this folder or in a worktree of
 * its own. Picking a branch switches to it; one checked out in another worktree is joined (a thread moves
 * into that worktree). Picking closes the panel; an action that fails keeps it open and says why.
 *
 * `load()` reads the branches (src/app/Branches.ts). `onSwitch(name)`, `onCreate({ base, branch })`,
 * `onWorktree({ base, branch })` and `onJoin(name)` act and resolve once done; `onLeave()` takes a thread
 * out of its worktree. With `deferWorktree` (a new thread) a worktree is only chosen here, and made (or
 * joined) when the thread starts: `choice()` says which, as `{ base, branch }` or `{ join }`.
 */
function branchPicker({ load, onSwitch, onCreate, onWorktree, onJoin, onLeave = null, deferWorktree = false }) {
  const state = { data: null, error: "", problem: "", working: false, running: false, filter: "", view: "list", mode: "branch", base: "", name: "", pending: null }
  const pop = popover({ name: "Branch", panelClass: "bp-panel" })
  pop.trigger.classList.add("bp-trigger")
  pop.trigger.prepend(icon(BRANCH_PATHS))
  pop.wrap.hidden = true // until it's known the folder is in git
  const paintLabel = () => {
    const d = state.data
    const p = state.pending
    pop.label.textContent = p?.join ? p.join : p ? `New worktree from ${p.base}` : d?.current || (d?.repo ? "detached HEAD" : "Branch")
    pop.trigger.classList.toggle("on", Boolean(p) || Boolean(d?.worktree))
    pop.trigger.title = p?.join
      ? `Starts in the worktree where ${p.join} is checked out`
      : p
        ? `A new worktree on ${p.branch || "a new branch"} from ${p.base}, made when you send`
        : d?.worktree ? `Works in a worktree, on ${d.current || "a detached HEAD"}\n${d.cwd}` : `On ${d?.current || "a detached HEAD"}: switch branches, or work in a new worktree`
  }
  const refresh = async () => {
    try {
      const d = await load()
      state.data = { ...d, worktree: Boolean(d.cwd && d.project && d.cwd !== d.project) || false }
      state.error = ""
      if (!state.base || ![...d.local.map((b) => b.name), ...d.remote].includes(state.base)) state.base = d.base
    } catch (e) { state.error = e.message }
    pop.wrap.hidden = !state.data?.repo
    paintLabel()
    pop.repaint()
  }
  /** Run one of the panel's actions. It closes the panel when it worked; when it didn't, the panel stays and says why. */
  const act = async (fn) => {
    if (state.working) return
    state.working = true
    state.problem = ""
    pop.repaint()
    let ok = true
    try { await fn() } catch (e) { ok = false; state.problem = e.message }
    state.working = false
    await refresh()
    if (ok) pop.close(true)
    else pop.panel.querySelector(state.view === "new" ? ".bp-name" : ".bp-filter")?.focus()
  }
  // Keys typed in the panel's boxes are for the boxes: not the panel's arrow keys, nor the page's.
  const own = (node) => { node.addEventListener("keydown", (e) => { if (e.key !== "Escape") e.stopPropagation() }); return node }
  const names = () => (state.data?.local ?? []).map((b) => b.name)
  const tag = (text, cls = "", title = null) => el("span", { class: `bp-tag ${cls}`.trim(), text, title })
  const openNew = (mode, name = "") => {
    const d = state.data
    Object.assign(state, { view: "new", mode, name, problem: "", base: mode === "branch" ? d?.current || d?.base || "" : d?.base || "" })
    pop.repaint()
    const box = pop.panel.querySelector(".bp-name")
    box?.focus()
    box?.setSelectionRange(box.value.length, box.value.length)
  }
  const openList = () => {
    Object.assign(state, { view: "list", problem: "" })
    pop.repaint()
    filter.focus()
  }
  // Made once, outside pop.paint, so typing in the search box never loses its caret.
  const filter = own(el("input", { class: "bp-filter", type: "search", placeholder: "Find a branch, or type a new name", "aria-label": "Find a branch, or type a new name", "data-key": "filter", autocomplete: "off", spellcheck: "false" }))
  const filterBox = el("label", { class: "bp-search" }, icon('<circle cx="7" cy="7" r="4.5"/><path d="M10.5 10.5 14 14"/>'), filter)
  const listBox = el("div", { class: "pop-scroll bp-list", role: "menu", "aria-label": "Branches" })
  const cmdBox = el("div", { class: "bp-cmds" })
  filter.addEventListener("input", () => { state.filter = filter.value; paintList() })
  filter.addEventListener("keydown", (e) => {
    // Down goes into the list; Enter takes the branch named exactly, else the first match, else offers to create what was typed.
    if (e.key === "ArrowDown") { e.preventDefault(); (listBox.querySelector(".pop-item:not(:disabled)") ?? cmdBox.querySelector("button:not(:disabled)"))?.focus() }
    if (e.key !== "Enter" || !state.filter.trim()) return
    e.preventDefault()
    // The branch named exactly wins over one that merely contains what was typed; a name that is the checked branch's own just closes the panel.
    const q = state.filter.trim()
    const pickable = [...listBox.querySelectorAll('.pop-item:not(:disabled):not([aria-checked="true"])')]
    const exact = pickable.find((n) => n.dataset.key === `b/${q}` || n.dataset.key === `r/${q}`)
    const first = exact ?? pickable[0]
    if (first) first.click()
    else if (listBox.querySelector('.pop-item[aria-checked="true"]')) pop.close(true)
    else cmdBox.querySelector("button:not(:disabled)")?.click()
  })
  /** Fill the list of branches, and the two commands under it. Runs for the list view, and on each key typed in the search box. */
  const paintList = () => {
    const d = state.data
    const q = state.filter.trim()
    const hit = (name) => !q || name.toLowerCase().includes(q.toLowerCase())
    const locked = state.working || state.running
    const p = state.pending
    /** The row that's checked: the branch a pending join names, else the one checked out. */
    const isOn = (b) => (p ? p.join === b.name : b.name === d.current)
    const local = (d?.local ?? []).filter((b) => hit(b.name)).sort((a, b) => Number(isOn(b)) - Number(isOn(a)))
    const remote = (d?.remote ?? []).filter(hit)
    const rows = local.map((b) => {
      const on = isOn(b)
      const tags = [
        b.name === (d.base ?? "").replace(/^origin\//, "") ? tag("default", "", "The repository's default branch") : null,
        b.elsewhere ? tag("worktree", "", `Checked out in ${b.elsewhere}`) : null,
        b.gone ? tag("gone", "", "Its upstream branch was deleted on the remote") : null,
        b.ahead > 0 ? tag(`↑${b.ahead}`, "ahead", `${b.ahead} commit${b.ahead === 1 ? "" : "s"} not pushed`) : null,
        b.behind > 0 ? tag(`↓${b.behind}`, "", `${b.behind} commit${b.behind === 1 ? "" : "s"} behind ${b.upstream}`) : null,
        b.at ? el("span", { class: "bp-when", text: ago(b.at), title: new Date(b.at).toLocaleString() }) : null
      ]
      return el("button", { class: "pop-item bp-row", type: "button", role: "menuitemradio", "aria-checked": String(on), "data-key": `b/${b.name}`, disabled: locked && !on,
        title: on ? `On ${b.name}` : b.elsewhere ? `Checked out in ${b.elsewhere}: ${deferWorktree ? "start the thread there" : "work there"}` : `Switch to ${b.name}`,
        onclick: () => {
          if (on) return
          if (b.elsewhere && deferWorktree) { state.pending = { join: b.name }; paintLabel(); pop.close(true); return }
          if (b.elsewhere) act(() => onJoin(b.name))
          else act(async () => { state.pending = null; await onSwitch(b.name) })
        } },
        el("span", { class: "pop-check", "aria-hidden": "true", text: on ? "✓" : "" }),
        branchLabel(b.name),
        el("span", { class: "bp-meta" }, ...tags))
    })
    const remoteRows = remote.map((r) =>
      el("button", { class: "pop-item bp-row", type: "button", role: "menuitemradio", "aria-checked": "false", "data-key": `r/${r}`, disabled: locked,
        title: `Make a local branch that tracks ${r}, and switch to it`,
        onclick: () => act(async () => { state.pending = null; await onSwitch(r) }) },
        el("span", { class: "pop-check", "aria-hidden": "true" }),
        branchLabel(r)))
    listBox.replaceChildren(...[
      local.length ? el("div", { class: "pop-group", role: "group", "aria-label": "Local branches" }, el("div", { class: "pop-head", text: "Branches" }), rows) : null,
      remote.length ? el("div", { class: "pop-group", role: "group", "aria-label": "Remote branches" }, el("div", { class: "pop-head", text: "Remote" }), remoteRows) : null,
      !local.length && !remote.length ? el("div", { class: "pop-note", text: !d ? state.error || "Reading the branches…" : q ? `No branch matches “${q}”.` : "No branches yet." }) : null
    ].filter(Boolean))
    // The two commands. Typing a name no local branch has offers to create it.
    const fresh = q !== "" && !names().includes(q) && !(d?.remote ?? []).includes(q)
    const none = !(d?.local.length || d?.remote.length)
    cmdBox.replaceChildren(
      el("button", { class: "pop-item bp-cmd", type: "button", "data-key": "new-branch", disabled: locked || none, onclick: () => openNew("branch", fresh ? q : "") },
        icon(PLUS_PATHS), el("span", { text: fresh ? `Create branch “${q}”…` : "New branch…" })),
      el("button", { class: "pop-item bp-cmd", type: "button", "data-key": "new-worktree", disabled: locked || none, onclick: () => openNew("worktree", fresh ? q : "") },
        icon(FOLDER_PATHS), el("span", { text: fresh ? `New worktree on “${q}”…` : "New worktree…" })))
  }
  pop.paint = () => {
    const d = state.data
    const locked = state.working || state.running
    if (state.view === "list") {
      const p = state.pending
      const cancel = () => el("button", { class: "btn btn-quiet btn-xs", type: "button", "data-key": "cancel", onclick: () => { state.pending = null; paintLabel(); pop.repaint() } }, "Work in the project folder")
      // Where the thread works, when that isn't the project folder: a choice pending, or a worktree it's in.
      const where = p?.join
        ? el("div", { class: "bp-where" }, el("div", { class: "pop-note", text: `The thread starts in the worktree where ${p.join} is checked out.` }), cancel())
        : p
          ? el("div", { class: "bp-where" }, el("div", { class: "pop-note", text: `A new worktree on ${p.branch || "a new branch"} from ${p.base}, made when you send.` }), cancel())
          : d?.worktree && onLeave
            ? el("div", { class: "bp-where" },
              el("div", { class: "pop-note", text: `Works in a worktree: ${d.cwd}` }),
              el("button", { class: "btn btn-quiet btn-xs", type: "button", "data-key": "leave", disabled: locked, onclick: () => act(onLeave) }, "Work in the project folder"))
            : null
      pop.panel.replaceChildren(el("div", { class: "pop-col bp-pick" },
        filterBox,
        state.running ? el("div", { class: "pop-note", text: "Branches switch once this turn ends." }) : null,
        state.working ? el("div", { class: "pop-note", text: "Working…" }) : null,
        state.problem ? el("p", { class: "bp-error", role: "alert", text: state.problem }) : null,
        listBox,
        cmdBox,
        where))
      paintList()
      return
    }
    // The new view: a small form for a branch, here or in a worktree of its own.
    const worktree = state.mode === "worktree"
    const taken = names()
    const all = [...taken, ...(d?.remote ?? [])]
    const nameBox = own(el("input", { class: "bp-name", "data-key": "name", placeholder: worktree ? "Made up if empty" : "feature/login", "aria-label": "The new branch's name", autocomplete: "off", spellcheck: "false", value: state.name, disabled: locked }))
    const baseBox = own(el("select", { class: "bp-base", "aria-label": "The branch it starts from", "data-key": "base", disabled: locked },
      all.map((name) => el("option", { value: name, selected: name === state.base }, name))))
    baseBox.addEventListener("change", () => { state.base = baseBox.value })
    const error = el("p", { class: "bp-error", role: "alert", hidden: true })
    const create = el("button", { class: "btn btn-primary btn-xs", type: "button", "data-key": "create" },
      state.working ? "Working…" : worktree ? (deferWorktree ? "Use a new worktree" : "Create worktree") : "Create branch")
    /** Say what's wrong with the name (or with the last try), and let Create be pressed only when nothing is. */
    const check = () => {
      const name = nameBox.value.trim()
      const bad = branchNameProblem(name, taken)
      error.textContent = bad || state.problem
      error.hidden = !(bad || state.problem)
      create.disabled = locked || !all.length || bad !== "" || (!worktree && !name)
    }
    const submit = () => {
      const choice = { base: baseBox.value, branch: nameBox.value.trim() }
      // A new thread's worktree is only chosen here: it's made when the thread starts.
      if (worktree && deferWorktree) {
        Object.assign(state, { pending: choice, view: "list", name: "", filter: "" })
        filter.value = ""
        paintLabel()
        pop.close(true)
        return
      }
      act(async () => {
        if (worktree) await onWorktree(choice)
        else { state.pending = null; await onCreate(choice) }
        Object.assign(state, { view: "list", name: "", filter: "" })
        filter.value = ""
      })
    }
    nameBox.addEventListener("input", () => { state.name = nameBox.value; state.problem = ""; check() })
    nameBox.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); if (!create.disabled) submit() } })
    create.addEventListener("click", submit)
    pop.panel.replaceChildren(el("div", { class: "pop-col bp-form" },
      el("div", { class: "bp-top" },
        el("button", { class: "btn btn-quiet btn-xs", type: "button", "data-key": "back", onclick: openList }, "‹ Branches"),
        el("span", { class: "bp-title", text: worktree ? "New worktree" : "New branch" })),
      el("div", { class: "seg bp-seg", role: "radiogroup", "aria-label": "Where the new branch is checked out" },
        el("button", { type: "button", role: "radio", "aria-checked": String(!worktree), "data-key": "mode-branch", disabled: locked, onclick: () => { state.mode = "branch"; pop.repaint() } }, "In this folder"),
        el("button", { type: "button", role: "radio", "aria-checked": String(worktree), "data-key": "mode-worktree", disabled: locked, onclick: () => { state.mode = "worktree"; pop.repaint() } }, "In a new worktree")),
      el("label", { class: "bp-field" }, el("span", { text: "Branch name" }), nameBox),
      el("label", { class: "bp-field" }, el("span", { text: "Start from" }), baseBox),
      el("p", { class: "pop-note bp-help", text: !worktree ? "This folder switches to the new branch. Uncommitted changes come along."
        : deferWorktree ? "Made when you send: the thread works in a folder of its own on the new branch, apart from the project folder."
          : "The thread moves to a folder of its own on the new branch, and starts a fresh session there. Its messages stay." }),
      error,
      el("div", { class: "bp-actions" },
        el("button", { class: "btn btn-quiet btn-xs", type: "button", "data-key": "cancel-new", onclick: openList }, "Cancel"),
        create)))
    check()
  }
  // Opening it starts at the list with an empty search, and reads the branches again: the agent may have made or switched some.
  pop.trigger.addEventListener("click", () => {
    if (pop.panel.hidden) return
    Object.assign(state, { view: "list", filter: "", problem: "" })
    filter.value = ""
    pop.repaint()
    if (!touchFirst.matches) filter.focus()
    refresh()
  })
  refresh()
  return {
    node: pop.wrap,
    refresh,
    /** The worktree a new thread starts in, if one was chosen: { base, branch } for a new one, { join } for one that exists. */
    choice: () => state.pending,
    clear: () => { state.pending = null; paintLabel() },
    setBusy: (b) => { if (state.running !== b) { state.running = b; pop.repaint() } }
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

/**
 * In a header row that drags the window, the spot under the fixed sidebar toggle stays clickable. It has to be
 * inside the row: Electron takes a no-drag box only from within a drag box, never from a box laid over it.
 */
const toggleSpot = () => el("span", { class: "toggle-spot", "aria-hidden": "true" })

function startView(project) {
  if (!project) {
    return el("div", { class: "main-col" },
      el("div", { class: "bar" }, toggleSpot()),
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
  // The project folder's branch: switching it switches the folder now; a worktree is made when the thread starts.
  const branch = branchPicker({
    load: () => api("GET", `projects/${project.id}/branches`),
    onSwitch: async (name) => {
      const r = await api("POST", `projects/${project.id}/branch`, { branch: name })
      toast(`${project.name} is on ${r.branch} now.`)
    },
    onCreate: async (choice) => {
      const r = await api("POST", `projects/${project.id}/branch`, { ...choice, create: true })
      toast(`${project.name} is on the new branch ${r.branch} now.`)
    },
    deferWorktree: true
  })
  const box = composer({
    controls: [models.node],
    tools: [branch.node],
    draftKey: `new:${project.id}`,
    files: () => api("GET", `projects/${project.id}/files`),
    onSend: async (text) => {
      const projectId = project.id
      const { provider, model, effort, access } = models.value()
      const worktree = branch.choice()
      const t = await api("POST", "threads", { projectId, provider, model, effort, access, ...(worktree ? { worktree } : {}) })
      branch.clear()
      await api("POST", `threads/${t.id}/messages`, { text })
      go(`#/t/${t.id}`)
    }
  })
  const readyFor = (p) => {
    box.setReady(status(p)?.available === true,
      status(p)?.available ? `Ask ${providerLabel(p)} to do something in ${project.name}. Type @ to point at a file.` : `${providerLabel(p)} is turned off in Settings`)
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
    el("div", { class: "bar bar-quiet" }, toggleSpot(), el("div", { class: "title-wrap" })),
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
/** Words with each @path in them (a file picked with @) as the chip the composer showed: its name, the path on hover. */
function mentions(text) {
  const out = []
  let last = 0
  for (const m of text.matchAll(/(^|\s)@([\w.-]+(?:[/\\][\w.-]+)*\.\w+)(?=\s|$|[,;:!?)])/g)) {
    const at = m.index + m[1].length
    if (at > last) out.push(text.slice(last, at))
    const path = m[2]
    out.push(el("span", { class: "mention", title: path }, el("span", { class: "mention-at", text: "@" }), path.slice(Math.max(path.lastIndexOf("/"), path.lastIndexOf("\\")) + 1)))
    last = at + 1 + path.length
  }
  if (last < text.length) out.push(text.slice(last))
  return out
}
/** A sent message: its words, with each attached file as a chip where it was put. */
function userNodes(item) {
  const known = new Map((item.attachments ?? []).map((a) => [a.id, a]))
  const out = []
  let last = 0
  for (const m of item.text.matchAll(ATT)) {
    if (m.index > last) out.push(...mentions(item.text.slice(last, m.index)))
    const a = known.get(m[1])
    // A picture shows as itself, big enough to see what it is; any other file as a chip.
    out.push(a && isRaster(a.mime)
      ? el("a", { class: "att-pic", href: fileUrl(a.id), target: "_blank", rel: "noopener", title: `${a.name} · ${bytes(a.size)}` },
        el("img", { src: fileUrl(a.id), alt: a.name }), el("span", { class: "att-pic-name", text: a.name }))
      : a
      ? attChip("a",{ name: a.name, mime: a.mime, src: fileUrl(a.id), attrs: { href: fileUrl(a.id), target: "_blank", rel: "noopener", title: `${a.name} · ${bytes(a.size)}` } })
      : el("span", { class: "att gone", text: "a file" }))
    last = m.index + m[0].length
  }
  if (last < item.text.length) out.push(...mentions(item.text.slice(last)))
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
const QUOTE_ICON = '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" aria-hidden="true"><path d="M3 4.5h10M3 8h7M3 11.5h10M1.5 3v10"/></svg>'
/**
 * Select words in a reply and a Quote button shows just above them: it puts them in the
 * composer as a `>` block to answer below. A manual popover, so it floats over the feed.
 */
const quoteBtn = el("button", { class: "quote-pop", type: "button", popover: "manual", "aria-label": "Quote in your reply" }, el("span", { html: QUOTE_ICON, "aria-hidden": "true" }), "Quote")
document.body.append(quoteBtn)
let quoteText = ""
const quoteShown = () => quoteBtn.matches(":popover-open")
const hideQuote = () => { if (quoteShown()) quoteBtn.hidePopover(); quoteText = "" }
/** The selection's words, when all of it sits in one reply of the open thread. */
function quotable() {
  const sel = getSelection()
  if (!feed || !sel || sel.isCollapsed || !sel.rangeCount) return null
  const prose = (n) => (n?.nodeType === Node.ELEMENT_NODE ? n : n?.parentElement)?.closest(".msg-a .prose")
  const at = prose(sel.anchorNode)
  if (!at || at !== prose(sel.focusNode) || !feed.list.contains(at)) return null
  const text = sel.toString().trim()
  return text ? { text, range: sel.getRangeAt(0) } : null
}
function placeQuote() {
  const q = quotable()
  if (!q) return hideQuote()
  // The first line's box: the button sits over where the selection starts, not the middle of a long one.
  // By touch, the phone's own Copy menu takes that spot: the button goes below the last line, clear of the handles.
  const rects = [...q.range.getClientRects()].filter((r) => r.width > 0)
  const touch = lastPointer === "touch"
  const r = (touch ? rects.at(-1) : rects[0]) ?? q.range.getBoundingClientRect()
  quoteText = q.text
  if (!quoteShown()) quoteBtn.showPopover()
  const w = quoteBtn.offsetWidth, h = quoteBtn.offsetHeight
  const x = Math.max(8, Math.min(r.left + r.width / 2 - w / 2, innerWidth - w - 8))
  const above = r.top - h - 6
  quoteBtn.style.left = `${x}px`
  quoteBtn.style.top = `${touch ? Math.min(r.bottom + 30, innerHeight - h - 8) : above < 8 ? r.bottom + 6 : above}px`
}
// Shown once the selection settles (mouse up, Shift+arrows, or a finger letting go of the handles),
// gone as soon as it collapses or leaves a reply.
document.addEventListener("mouseup", () => setTimeout(placeQuote))
document.addEventListener("keyup", (e) => { if (e.shiftKey || e.key === "Shift") placeQuote() })
let quoteSettle = 0
let pressingQuote = false
document.addEventListener("selectionchange", () => {
  if (quoteShown() && !pressingQuote && !quotable()) hideQuote()
  if (lastPointer !== "touch") return
  clearTimeout(quoteSettle)
  quoteSettle = setTimeout(placeQuote, 350)
})
addEventListener("scroll", () => quoteShown() && placeQuote(), true)
addEventListener("resize", () => quoteShown() && placeQuote())
// Pressing it mustn't clear the selection before the click reads it (a tap can clear it on a phone).
quoteBtn.addEventListener("mousedown", (e) => e.preventDefault())
quoteBtn.addEventListener("pointerdown", () => { pressingQuote = true })
quoteBtn.addEventListener("pointerup", () => setTimeout(() => { pressingQuote = false }, 400))
quoteBtn.addEventListener("pointercancel", () => { pressingQuote = false })
quoteBtn.addEventListener("click", () => {
  pressingQuote = false
  const words = quoteText
  hideQuote()
  if (!words || !feed) return
  const cut = words.length > 1500 ? `${words.slice(0, 1500).trimEnd()}…` : words
  getSelection()?.removeAllRanges()
  feed.composer.quote(cut.split("\n").map((l) => `> ${l}`.trimEnd()).join("\n"))
})

/** A sent message as words, each attached file by its name. */
function plainText(item) {
  const known = new Map((item.attachments ?? []).map((a) => [a.id, a]))
  return item.text.replace(ATT, (_, id) => known.get(id)?.name ?? "a file")
}
/** A sent message: click it (or Enter on it) to edit it and send it again. */
/** How many lines of a sent prompt show before Show more: 3 on a phone, where it sticks above a small screen (app.css). */
const userLines = () => (narrow.matches ? 3 : 5)
function userMessage(item) {
  // A long prompt shows its first lines (userLines); Show more opens the rest (and stays open while the page is).
  const body = el("div", { class: "msg-user-body" }, userNodes(item))
  const key = `msg:${item.id}`
  const more = el("button", { class: "msg-more", type: "button", hidden: true })
  const bubble = el("div", { class: "msg-user", tabindex: "0" }, body, more)
  const paintMore = () => {
    const open = S.expanded.has(key)
    const lines = parseFloat(getComputedStyle(body).lineHeight) * userLines()
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
  // A message from the agent in the thread that started this one, not from the person: it says whose.
  const from = item.from ? el("div", { class: "msg-from" }, icon(LINK_PATHS), el("span", { text: "From the agent in" }), threadLink(item.from.threadId, item.from.title)) : null
  const wrap = el("div", { class: `msg msg-u${from ? " from-thread" : ""}` }, from, bubble, msgActions(() => plainText(item)))
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
    el("div", { class: "msg-edit-foot" }, el("span", { class: "hint", text: touchFirst.matches ? "Sends as a new message" : "Sends as a new message · Esc cancels" }), cancel, send))
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
    else if (e.key === "Enter" && !e.shiftKey && !e.isComposing && !touchFirst.matches) { e.preventDefault(); submit() }
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
      // A file picked with @ goes as its path, the way Claude Code takes one.
      if (c.classList.contains("mention")) { out += `@${c.dataset.path}`; continue }
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
 * Unsent words per box ("new:<project>", "t:<thread>"), kept while zero is open: the box's own
 * nodes (so file chips come back too), the words as one line for the sidebar, and when they changed.
 */
const drafts = new Map()
/** A draft as one line: its words, each file by its name. */
function draftTitle(input) {
  const names = new Map([...input.querySelectorAll(".att[data-att]")].map((c) => [c.dataset.att, c.querySelector(".att-name")?.textContent || "a file"]))
  return serialize(input).replace(ATT, (_, id) => names.get(id) ?? "a file").replace(/\s+/g, " ").trim() || "A file"
}
/** Throw a draft away, and empty its box if it's on screen. */
function discardDraft(key) {
  const d = drafts.get(key)
  drafts.delete(key)
  const box = d?.nodes.find((n) => n.parentNode)?.parentNode
  if (box) { box.replaceChildren(); box.dispatchEvent(new Event("input")) }
  paintDrafts()
}
/**
 * The message box. It's an editable div rather than a textarea so a file
 * can sit among the words: paste one, drop one, or pick one with Attach and
 * it lands as a chip where the caret was. Each file uploads as it lands;
 * Send waits until they all have.
 */
/** How well a file's path matches what was typed after @: its name first, then anywhere in its path; -1 if not at all. */
function fileScore(path, q) {
  if (!q) return 1 / (1 + path.length)
  const p = path.toLowerCase()
  const base = p.slice(p.lastIndexOf("/") + 1)
  const s = base.startsWith(q) ? 3 : base.includes(q) ? 2 : p.includes(q) ? 1 : -1
  return s < 0 ? -1 : s + 1 / (1 + path.length)
}

/**
 * The composer's menu for @ (a file in the project, put in as `@path`) and / (one of `commands`, at the
 * start of the box). Arrows move, Enter or Tab picks, Esc closes.
 */
function mentionMenu(input, { files, commands = [] }) {
  const pop = el("div", { class: "mention-pop", role: "listbox", hidden: true })
  pop.addEventListener("mousedown", (e) => e.preventDefault()) // keep the caret in the box
  let items = [], at = 0, match = null, list = null, asked = 0
  /** zero's own commands, then the provider session's (a function: those arrive once a turn has started). */
  const cmdList = () => typeof commands === "function" ? commands() : commands
  const close = () => { pop.hidden = true; items = []; match = null }
  /** What's typed just before the caret: an @word anywhere, or a /word that starts the box. */
  const typed = () => {
    const s = getSelection()
    if (!s.rangeCount || !s.isCollapsed || !input.contains(s.anchorNode) || s.anchorNode.nodeType !== Node.TEXT_NODE) return null
    const node = s.anchorNode, end = s.anchorOffset, before = node.nodeValue.slice(0, end)
    const mention = files && /(?:^|\s)@([^\s@]*)$/.exec(before)
    if (mention) return { kind: "file", node, start: end - mention[1].length - 1, end, q: mention[1].toLowerCase() }
    const slash = cmdList().length && input.firstChild === node && /^\/([\w:.-]*)$/.exec(before)
    if (slash) return { kind: "command", node, start: 0, end, q: slash[1].toLowerCase() }
    return null
  }
  const paint = () => {
    pop.replaceChildren(...items.map((it, i) => {
      const b = el("button", { class: `mention-item${i === at ? " on" : ""}`, type: "button", role: "option", "aria-selected": String(i === at), tabindex: "-1", onclick: () => pick(i) }, ...it.view)
      b.addEventListener("mousemove", () => { if (at !== i) { at = i; paint() } })
      return b
    }))
    if (!items.length) pop.append(el("div", { class: "mention-none", text: match?.kind === "file" ? (list ? "No file matches." : "Looking for files…") : "No command matches." }))
    pop.hidden = false
    pop.querySelector(".on")?.scrollIntoView({ block: "nearest" })
  }
  const update = async () => {
    match = typed()
    if (!match) return close()
    at = 0
    if (match.kind === "command") {
      const q = match.q
      items = cmdList().filter((c) => (c.when?.() ?? true) && (c.name.startsWith(q) || (q.length > 1 && c.name.includes(q)))).slice(0, 40).map((c) => ({
        value: c, view: [el("span", { class: "mention-main", text: `/${c.name}` }), c.args ? el("span", { class: "mention-args", text: c.args }) : null,
          el("span", { class: "mention-sub", text: c.desc }), c.from ? el("span", { class: "mention-from", text: c.from }) : null]
      }))
      return paint()
    }
    const q = match.q, mine = ++asked
    if (!list) {
      items = []
      paint()
      try { list = await files() } catch { list = { files: [] } }
      if (mine !== asked || !match) return
    }
    items = list.files.map((f) => [f, fileScore(f, q)]).filter(([, s]) => s >= 0).sort((a, b) => b[1] - a[1]).slice(0, 8).map(([f]) => {
      const cut = f.lastIndexOf("/")
      return { value: f, view: [el("span", { class: "mention-main", text: f.slice(cut + 1) }), cut > 0 ? el("span", { class: "mention-sub", text: f.slice(0, cut) }) : null] }
    })
    paint()
  }
  /** Put the pick in place of what was typed: a file as `@path `; a command runs, or is put in to add words to. */
  const pick = (i) => {
    const it = items[i], m = match
    if (!it || !m) return
    const r = document.createRange()
    r.setStart(m.node, m.start)
    r.setEnd(m.node, m.end)
    const s = getSelection()
    s.removeAllRanges()
    s.addRange(r)
    close()
    if (m.kind === "file") {
      // The file goes in as a chip: its name, with the whole path on hover; it's sent as @path.
      const cut = it.value.lastIndexOf("/")
      const chip = el("span", { class: "mention", contenteditable: "false", "data-path": it.value, title: it.value }, el("span", { class: "mention-at", text: "@" }), it.value.slice(cut + 1))
      const space = document.createTextNode(" ")
      r.deleteContents()
      r.insertNode(space)
      r.insertNode(chip)
      const after = document.createRange()
      after.setStart(space, 1)
      after.collapse(true)
      s.removeAllRanges()
      s.addRange(after)
      input.dispatchEvent(new Event("input"))
      return
    }
    if (it.value.run) { document.execCommand("delete"); return void it.value.run() }
    document.execCommand("insertText", false, `/${it.value.name} `)
  }
  /** Keys while the menu is open; true when the key was its. */
  const key = (e) => {
    if (pop.hidden) return false
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      if (items.length) { at = (at + (e.key === "ArrowDown" ? 1 : items.length - 1)) % items.length; paint() }
    } else if ((e.key === "Enter" || e.key === "Tab") && !e.shiftKey && items.length) pick(at)
    else if (e.key === "Escape") close()
    else return false
    e.preventDefault()
    e.stopPropagation()
    return true
  }
  input.addEventListener("blur", close)
  return { pop, update, key, close }
}

function composer({ onSend, onStop, controls = [], tools = [], running = false, disabled = false, draftKey = "", files = null, commands = [] }) {
  const input = el("div", { class: "input empty", contenteditable: disabled ? "false" : "true", role: "textbox", "aria-multiline": "true", "aria-label": "Message", "data-placeholder": "" })
  // What was written here before going elsewhere comes back, chips and all.
  const kept = draftKey && drafts.get(draftKey)?.nodes
  if (kept) input.append(...kept)
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
    hint.textContent = busy ? (touchFirst.matches ? "Working. The square stops it." : "Working. Esc stops it.") : ""
    hint.hidden = !busy
  }
  /** After any change: an empty box is truly empty (so its placeholder shows). */
  const sync = () => {
    const isEmpty = empty()
    // Clear only what the browser leaves behind (a stray <br>), never a space or line the person typed.
    if (isEmpty && input.textContent === "" && input.childNodes.length) input.replaceChildren()
    input.classList.toggle("empty", isEmpty)
    if (draftKey) {
      const was = drafts.get(draftKey)
      if (isEmpty) drafts.delete(draftKey)
      else {
        const title = draftTitle(input)
        drafts.set(draftKey, { nodes: [...input.childNodes], title, at: was?.title === title ? was.at : new Date().toISOString() })
      }
      // The sidebar's Drafts follow along, once per burst of typing.
      if (Boolean(was) !== !isEmpty || (was && was.title !== drafts.get(draftKey)?.title)) paintDraftsSoon()
    }
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
      // A chip can move to another composer with its draft: it tells the box it's in now, not this one.
      const changed = (box) => box?.dispatchEvent(new Event("input"))
      x.addEventListener("click", () => {
        const box = chip.closest(".input")
        const next = chip.nextSibling
        if (next?.nodeType === Node.TEXT_NODE && next.nodeValue === " ") next.remove()
        chip.remove()
        changed(box)
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
        changed(chip.closest(".input"))
      }, (e) => {
        const box = chip.closest(".input")
        if (local) URL.revokeObjectURL(local)
        chip.nextSibling?.nodeValue === " " && chip.nextSibling.remove()
        chip.remove()
        fail(e)
        changed(box)
      })
    }
    if (nodes.length) { insert(nodes); sync() }
  }

  /** The send button: Stop while the thread works, Send otherwise. */
  const submit = async () => {
    if (busy) return onStop?.()
    return sendNow()
  }
  /**
   * Enter never stops a turn: someone typing their next message while the agent works hits Enter
   * out of habit, and that used to stop the turn mid-call (the call then showed as failed).
   */
  const enter = () => {
    if (!busy) return sendNow()
    toast("Still working. Your message stays here until the turn ends; the square button or Esc stops it.")
  }
  const sendNow = async () => {
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
  const menu = mentionMenu(input, { files, commands })
  input.addEventListener("input", () => { if (!recalling) recalled = -1; sync(); menu.update() })
  input.addEventListener("click", () => menu.update())
  input.addEventListener("keydown", (e) => {
    if (menu.key(e)) return
    // Shift+Enter is left to the browser: it breaks the line. So is Enter on a phone's keyboard,
    // where a message often runs to more than a line and Send is a thumb away.
    if (e.key === "Enter" && !e.shiftKey && !e.isComposing && !touchFirst.matches) { e.preventDefault(); enter(); return }
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
  node.append(menu.pop, input, el("div", { class: "composer-foot" }, el("div", { class: "composer-controls" }, attach, tools), hint, el("div", { class: "composer-end" }, controls, send)), picker)
  sync()
  // Focus once the view is on screen, without scrolling: focusing while it's still being built laid the whole
  // thread out an extra time (a long thread opened ~140ms slower for it).
  requestAnimationFrame(() => {
    // On a phone, focus would put the keyboard over the thread just opened: a tap on the box asks for it.
    if (disabled || touchFirst.matches || !input.isConnected) return
    input.focus({ preventScroll: true })
    // Back to a draft: the caret goes at its end, where you left off.
    if (kept) { const r = document.createRange(); r.selectNodeContents(input); r.collapse(false); caretTo(r) }
  })
  return {
    node,
    setBusy: (b) => { busy = b; paint() },
    /** Whether the thread's provider can take a message now, and what the empty box says. */
    setReady: (ready, text) => {
      // Called on every change of the thread: touching contentEditable, even to what it is, costs a style pass.
      if (disabled === !ready && input.dataset.placeholder === text) return
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
  const working = el("div", { class: "working", hidden: true, role: "status" }, el("i"), el("i"), el("i"), el("span", { text: "Working" }),
    el("span", { class: "working-time" }))
  const scroll = el("div", { class: "scroll" }, list)
  // Compact: shown when the context is filling. On, the next message waits while the session compacts first.
  const compact = el("button", { class: "pill-btn compact-toggle", type: "button", role: "switch", onclick: () => {
    S.compactOff.has(t.id) ? S.compactOff.delete(t.id) : S.compactOff.add(t.id)
    paintCompact(S.open)
  } }, el("span", { class: "compact-knob", "aria-hidden": "true" }), el("span", { text: "Compact" }))
  // The thread's branch: switch it, or move the thread to a new worktree from a base you pick.
  const branched = (meta, words) => {
    Object.assign(S.open ?? {}, meta)
    for (const k of ["cwd", "workTree", "pr"]) if (!(k in meta) && S.open) delete S.open[k]
    toast(words)
    if (gitPanel?.threadId === t.id) loadGit()
  }
  const branch = branchPicker({
    load: () => api("GET", `threads/${t.id}/branches`),
    onSwitch: async (name) => branched(await api("POST", `threads/${t.id}/branch`, { branch: name }), `Switched to ${name}.`),
    onCreate: async (choice) => branched(await api("POST", `threads/${t.id}/branch`, { ...choice, create: true }), `Created ${choice.branch} and switched to it.`),
    onWorktree: async (choice) => {
      const meta = await api("POST", `threads/${t.id}/worktree`, choice)
      branched(meta, `This thread works in a new worktree now, on ${meta.branch}.`)
    },
    onJoin: async (name) => {
      const meta = await api("POST", `threads/${t.id}/worktree`, { join: name })
      branched(meta, meta.cwd ? `This thread works in the worktree of ${name} now.` : "This thread works in the project folder again.")
    },
    onLeave: async () => branched(await api("POST", `threads/${t.id}/worktree`, { leave: true }), "This thread works in the project folder again.")
  })
  // How full the context is, and Claude's usage limits when one is getting close: a ring, words on hover.
  const meter = el("span", { class: "meter", role: "img", tabindex: "0", hidden: true },
    el("span", { class: "meter-ring", "aria-hidden": "true" }), el("span", { class: "meter-text" }))
  const box = composer({
    running: t.status === "running",
    controls: [meter, compact, models.node],
    tools: [branch.node],
    draftKey: `t:${t.id}`,
    files: () => api("GET", `threads/${t.id}/files`),
    // What / offers: zero's own actions, the provider's /compact when its session takes it, then the
    // session's own commands (the person's, the project's, skills, a few of Claude Code's) once a turn has told them.
    commands: () => [
      { name: "compact", args: "what to keep", desc: "Summarize the thread so far to free up context", when: () => status(S.open?.provider)?.compaction === "manual" && !!S.open?.resume },
      { name: "git", desc: "Show or hide the Git panel", run: () => setGitOpen(!gitOpenNow()) },
      { name: "rename", desc: "Rename this thread", run: () => { feed?.title.focus(); feed?.title.select() } },
      ...(project ? [{ name: "new", desc: `Start a new thread in ${project.name}`, run: () => go(`#/new/${project.id}`) }] : []),
      ...(S.commands.get(t.id) ?? []).map((c) => ({ name: c.name, args: c.hint, desc: c.description, from: providerLabel(t.provider) }))
    ],
    onSend: (text) => api("POST", `threads/${t.id}/messages`, { text, compact: compactOn(S.open) }),
    onStop: () => api("POST", `threads/${t.id}/stop`, {}).catch(fail)
  })
  const queued = el("div", { class: "queued", hidden: true })
  const links = linksNode(t)
  // The turns above the ones drawn: a button for them, which also loads them as it scrolls into view.
  const earlier = el("button", { class: "feed-earlier", type: "button", onclick: () => showEarlier() }, el("span"))
  feed?.io?.disconnect()
  feed = { list, scroll, cache: new Map(), groups: new Map(), turns: new Map(), working, queued, composer: box, stick: true, models, title, compact, meter, branch, links, shown: TURNS_SHOWN, hidden: 0, earlier }
  feed.io = new IntersectionObserver((seen) => { if (seen.some((e) => e.isIntersecting) && feed?.earlier === earlier) showEarlier() }, { root: scroll, rootMargin: "600px 0px 0px 0px" })

  paintReady(t)
  // Scrolled up, a button brings you back to the latest; it says so when something new came in meanwhile.
  const jump = el("button", { class: "jump-latest", type: "button", hidden: true, title: "Jump to the latest", "aria-label": "Jump to the latest",
    html: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M8 3v10M3.5 8.5 8 13l4.5-4.5"/></svg><span>New</span>',
    onclick: () => { feed.stick = true; scroll.scrollTo({ top: scroll.scrollHeight, behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" }) } })
  feed.jump = jump
  // A scroll is yours only right after a wheel, touch, key or press in the thread: one that follows a resize
  // or a reflow (the window narrowed, an image loaded) keeps a thread that was following at its end.
  let touched = 0
  for (const type of ["wheel", "touchmove", "keydown", "pointerdown"]) scroll.addEventListener(type, () => { touched = Date.now() }, { passive: true })
  scroll.addEventListener("scroll", () => {
    const atEnd = scroll.scrollHeight - scroll.scrollTop - scroll.clientHeight < 60
    if (!atEnd && feed.stick && Date.now() - touched > 1500) { scroll.scrollTop = scroll.scrollHeight; return }
    feed.stick = atEnd
    jump.hidden = feed.stick
    if (feed.stick) jump.classList.remove("fresh")
  })
  renderFeed()
  paintWorking()
  // At the end first; only then does scrolling up to the earlier entries load them (at the top, before
  // that first scroll, the button was in view and drew a second batch at once).
  requestAnimationFrame(() => {
    scroll.scrollTop = scroll.scrollHeight
    requestAnimationFrame(() => { if (feed?.earlier === earlier) feed.io.observe(earlier) })
  })
  const git = makeGitPanel(t)
  // The session's slash commands, for / (empty until a turn of it has started).
  if (!S.commands.has(t.id)) api("GET", `threads/${t.id}/commands`).then((list) => { if (list.length) S.commands.set(t.id, list) }, () => {})
  return [
    el("div", { class: "thread-cols" },
      el("div", { class: "main-col" },
        el("div", { class: "bar" },
          toggleSpot(),
          // One line: the project (click it for a new thread there), a middle dot, the thread's title (editable in place).
          el("div", { class: "title-wrap title-line" },
            project
              ? el("button", { class: "title-project", type: "button", title: `New thread in ${project.name}\n${project.path}`, onclick: () => go(`#/new/${project.id}`) }, project.name)
              : el("span", { class: "title-project gone", text: "removed project" }),
            el("span", { class: "title-sep", "aria-hidden": "true", text: "·" }),
            title,
            links),
          DESKTOP ? el("div", { class: "bar-tools" },
            el("button", { class: "icon-btn bar-tool", type: "button", title: "Open this thread's folder in VS Code", "aria-label": "Open in VS Code", html: CODE_ICON, onclick: () => openOut(vscodeUrl(threadDir(t, project))) }),
            el("button", { class: "icon-btn bar-tool", type: "button", title: "Show this thread's folder", "aria-label": "Show folder", html: FOLDER_ICON, onclick: () => openOut(folderUrl(threadDir(t, project))) })) : null),
        scroll,
        el("div", { class: "composer-wrap" }, jump, box.node)),
      git.node,
      git.toggle)
  ]
}

/** The composer takes messages only when the thread's provider is available; switching provider can change that. */
function paintReady(t) {
  const ready = status(t.provider)?.available === true
  feed.composer.setReady(ready, ready ? "Reply, or type @ for a file, / for a command" : `${providerLabel(t.provider)} is turned off in Settings`)
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
/** Names for Claude's usage limits (rate_limit_event's rateLimitType). */
const LIMIT_NAMES = { five_hour: "5-hour limit", seven_day: "Weekly limit", seven_day_opus: "Weekly Opus limit", seven_day_sonnet: "Weekly Sonnet limit", overage: "Extra usage" }
/** A limit worth showing beside the ring: refused, warned about, or past three quarters. */
const limitPressing = (l) => l.status === "rejected" || l.status === "allowed_warning" || (l.used ?? 0) >= 0.75
const tokensK = (n) => n >= 1000 ? `${Math.round(n / 1000)}k` : String(n)
const resetWords = (iso) => {
  if (!iso) return ""
  const d = new Date(iso)
  const today = d.toDateString() === new Date().toDateString()
  return `resets ${today ? "" : d.toLocaleDateString([], { weekday: "short" }) + " "}${d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}`
}
/** The composer's meter: the context's fill as a ring (and %), and the most pressing usage limit as words, for this thread. */
function paintMeter() {
  const m = feed?.meter
  const t = S.open
  if (!m || !t) return
  const ctx = t.context && t.context.limit > 0 ? t.context : null
  const share = ctx ? Math.min(1, ctx.used / ctx.limit) : 0
  const limits = t.provider === "claude" ? (S.limits ?? []).filter((l) => l.used !== null || l.status !== "allowed") : []
  const pressing = limits.filter(limitPressing).sort((a, b) => (b.used ?? 1) - (a.used ?? 1))[0]
  m.hidden = !ctx && !pressing
  if (m.hidden) return
  const pct = Math.round(share * 100)
  m.querySelector(".meter-ring").style.setProperty("--fill", `${share * 360}deg`)
  m.classList.toggle("warm", share >= COMPACT_SOON)
  m.classList.toggle("limited", !!pressing)
  const limitShort = pressing ? (pressing.status === "rejected" ? `${LIMIT_NAMES[pressing.kind] ?? "Limit"} reached` : `${LIMIT_NAMES[pressing.kind] ?? "Limit"} ${Math.round((pressing.used ?? 0) * 100)}%`) : ""
  m.querySelector(".meter-text").textContent = [ctx ? `${pct}%` : "", limitShort].filter(Boolean).join(" · ")
  const lines = [
    ctx ? `Context: ${tokensK(ctx.used)} of ${tokensK(ctx.limit)} tokens (${pct}%)` : "",
    ...limits.map((l) => {
      const name = LIMIT_NAMES[l.kind] ?? l.kind
      const used = l.status === "rejected" ? "reached" : l.used !== null ? `${Math.round(l.used * 100)}% used` : l.status === "allowed_warning" ? "getting close" : "fine"
      return [`${name}: ${used}`, resetWords(l.resetsAt)].filter(Boolean).join(", ")
    })
  ].filter(Boolean)
  m.title = lines.join("\n")
  m.setAttribute("aria-label", lines.join(". "))
}

function paintCompact(t) {
  paintMeter()
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
  // How long this turn has run, from your message (the call it's on shows just above).
  const since = S.open.items.findLast((i) => i.kind === "user")?.at
  feed.working.dataset.since = running && since ? since : ""
  tickWorking()
  // A message waiting for the session to compact first.
  feed.queued.hidden = !S.open.queued
  if (S.open.queued && feed.queued.dataset.text !== S.open.queued) {
    feed.queued.dataset.text = S.open.queued
    feed.queued.replaceChildren(el("span", { class: "queued-label", text: "Queued · runs once the context is compacted" }), el("div", { class: "queued-text", text: S.open.queued }))
  }
  feed.list.append(feed.queued, feed.working)
  feed.composer.setBusy(running)
  feed.models.setBusy(running)
  feed.branch?.setBusy(running)
  paintCompact(S.open)
}
/** The working line's clock: m:ss since the turn began, each second while it shows. */
function tickWorking() {
  const w = feed?.working
  if (!w) return
  const t = w.querySelector(".working-time")
  t.textContent = w.dataset.since && !w.hidden ? elapsed(w.dataset.since) : ""
}
setInterval(tickWorking, 1000)
/**
 * Keep a following thread at its end, once a frame: reading scrollHeight lays the whole thread out, and
 * doing it on every event of a long thread was most of the time an event took.
 */
let following = 0
const follow = () => {
  if (following) return
  following = requestAnimationFrame(() => {
    following = 0
    if (feed?.stick) feed.scroll.scrollTop = feed.scroll.scrollHeight
    else feed?.jump?.classList.add("fresh")
  })
}

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
  const { finals, metaFor, merged, changes } = turnEnds()
  const top = []
  let run = null
  for (const item of S.open.items) {
    if (merged.has(item.id)) continue // its details ride in the answer's action row instead
    // A call to zero's thread tools shows as its link card instead (a pending approval for one still shows).
    if (item.kind === "tool" && item.name.startsWith(THREAD_TOOL)) continue
    if (!foldable(item)) { run = null; top.push(item); continue }
    if (!run) top.push(run = { key: item.id, items: [] })
    run.items.push(item)
  }
  const groups = new Map()
  // Each turn (a message of yours and everything after it, up to your next) is one block, so your
  // message can stick to the top while its turn scrolls by, until the next turn's pushes it away.
  const all = []
  for (const x of top) {
    if (!all.length || (!x.items && x.kind === "user")) all.push({ key: x.items ? x.key : x.id, entries: [] })
    all.at(-1).entries.push(x)
  }
  // Only the latest entries (messages, runs of tool calls) are drawn: a long thread opened slowly drawing
  // all of it. Earlier ones come in as you scroll up to them (or ask), a batch at a time; the oldest turn
  // drawn may start partway through.
  let budget = feed.shown, hidden = 0
  const drawn = []
  for (let i = all.length - 1; i >= 0; i--) {
    const { key, entries } = all[i]
    if (budget <= 0) { hidden += entries.length; continue }
    const keep = entries.length <= budget ? entries : entries.slice(entries.length - budget)
    hidden += entries.length - keep.length
    budget -= keep.length
    drawn.unshift({ key, entries: keep })
  }
  const sections = drawn.map(({ key, entries }) => {
    const nodes = entries.map((x) => x.items ? toolGroup(x, groups) : nodeFor(x))
    let section = feed.turns.get(key)
    if (!section) feed.turns.set(key, (section = el("section", { class: "turn" })))
    reconcile(section, nodes)
    return section
  })
  feed.groups = groups
  feed.hidden = hidden
  if (hidden) feed.earlier.querySelector("span").textContent = `Show earlier (${hidden} more)`
  reconcile(feed.list, [...(hidden ? [feed.earlier] : []), ...sections, feed.queued, feed.working])
  // Only a turn's last agent response (its answer, not the narration between tool calls) has the
  // action row, and the turn's details (model, time, cost, tokens) sit in that row beside Copy.
  for (const [id, { node }] of feed.cache) {
    if (!node.classList.contains("msg-a")) continue
    node.classList.toggle("final", finals.has(id))
    const turn = metaFor.get(id)
    const slot = node.querySelector(".msg-meta")
    if (slot.dataset.turn !== (turn?.id ?? "")) { slot.dataset.turn = turn?.id ?? ""; slot.replaceChildren(...(turn ? turnMeta(turn) : [])) }
    paintTurnFiles(node, changes.get(id))
  }
}
/**
 * Where each turn ends: `finals` are the last agent responses of turns; `metaFor` pairs such a
 * response with its turn's details, and `merged` holds those turn items so they aren't drawn twice.
 * A turn that failed keeps its own error line; one with no response keeps its details line.
 */
function turnEnds() {
  const finals = new Set(), metaFor = new Map(), merged = new Set(), changes = new Map()
  let last = null
  // The files the turn's edits changed, by path, with their lines added and removed.
  let edited = new Map()
  for (const item of S.open.items) {
    if (item.kind === "assistant") last = item.id
    else if (item.kind === "tool" && item.diff && item.status !== "failed") {
      const c = countsOf(item), was = edited.get(item.detail) ?? { add: 0, del: 0 }
      edited.set(item.detail, { add: was.add + c.add, del: was.del + c.del })
    } else if (item.kind === "user" || item.kind === "turn") {
      if (last) finals.add(last)
      if (item.kind === "turn" && last && item.outcome !== "failed") { metaFor.set(last, item); merged.add(item.id) }
      // Only a turn that has ended lists its changes: while it runs, its files are still changing.
      if (item.kind === "turn" && last && edited.size) changes.set(last, edited)
      if (item.kind === "user" || item.kind === "turn") edited = new Map()
      last = null
    }
  }
  if (last) finals.add(last)
  return { finals, metaFor, merged, changes }
}
/**
 * Under a turn's answer, what its edits changed: "Changed 3 files +40 −12", each file with its own
 * counts, and a way to the Git panel to review and commit them. Repainted only when the list changes.
 */
function paintTurnFiles(node, edited) {
  const files = edited ? [...edited] : []
  const sig = JSON.stringify(files)
  let box = node.querySelector(".turn-files")
  if ((box?.dataset.sig ?? "[]") === sig) return
  if (!files.length) return void box?.remove()
  if (!box) { box = el("div", { class: "turn-files" }); node.querySelector(".msg-actions").before(box) }
  box.dataset.sig = sig
  const total = files.reduce((s, [, c]) => ({ add: s.add + c.add, del: s.del + c.del }), { add: 0, del: 0 })
  const SHOWN = 6
  // In the desktop app a file opens in VS Code, at the thread's folder for a path given relative to it.
  const dir = S.open ? threadDir(S.open, S.projects.find((p) => p.id === S.open.projectId)) : ""
  const row = ([path, c]) => el("li", { class: "turn-file" },
    DESKTOP
      ? el("button", { class: "turn-file-path", type: "button", text: rel(path), title: `Open ${path} in VS Code`, onclick: () => openOut(vscodeUrl(absPath(path, dir))) })
      : el("span", { class: "turn-file-path", text: rel(path), title: path }),
    diffStat(c))
  const rest = files.length - SHOWN
  box.replaceChildren(
    el("div", { class: "turn-files-head" },
      el("span", { class: "turn-files-title", text: `Changed ${files.length} file${files.length === 1 ? "" : "s"}` }),
      diffStat(total),
      el("button", { class: "btn btn-quiet btn-xs turn-files-review", type: "button", title: "Open the Git panel (Alt+G) to see the diffs and commit", onclick: () => { if (gitPanel && !gitOpenNow()) setGitOpen(true) } }, "Review in Git")),
    el("ul", { class: "turn-file-list" }, ...files.slice(0, SHOWN).map(row),
      rest > 0 ? el("li", { class: "turn-file more" }, el("details", {}, el("summary", { text: `${rest} more` }), el("ul", { class: "turn-file-list" }, ...files.slice(SHOWN).map(row)))) : null))
}
/** Bring an item of the open thread into view, drawing earlier entries until it's there, and mark it a moment. */
function jumpTo(itemId) {
  if (!feed || !S.open?.items.some((i) => i.id === itemId)) return
  for (let n = 0; n < 50 && !feed.cache.get(itemId)?.node.isConnected && feed.hidden; n++) {
    feed.shown += TURNS_SHOWN
    renderFeed()
  }
  const node = feed.cache.get(itemId)?.node
  if (!node?.isConnected) return
  feed.stick = false
  node.scrollIntoView({ block: "center" })
  node.classList.add("jumped")
  setTimeout(() => node.classList.remove("jumped"), 1600)
}
/** How many of a thread's latest entries (messages, runs of tool calls) are drawn when it opens, and how many more each time you scroll up to the rest. */
const TURNS_SHOWN = 60
/** Draw the next batch of earlier turns, keeping what you're looking at where it is. */
function showEarlier() {
  if (!feed?.hidden) return
  const s = feed.scroll
  const from = s.scrollHeight - s.scrollTop
  feed.shown += TURNS_SHOWN
  renderFeed()
  s.scrollTop = s.scrollHeight - from
}
/** On a failed turn: send your last message again (its files too), as a new message. Only on the thread's last turn. */
function retryButton(item) {
  const t = S.open
  if (!t || t.items.at(-1)?.id !== item.id) return null
  const last = t.items.findLast((i) => i.kind === "user")
  if (!last) return null
  return el("button", { class: "btn btn-quiet btn-xs turn-retry", type: "button", title: "Send your last message again", onclick: (e) => {
    e.currentTarget.disabled = true
    api("POST", `threads/${t.id}/messages`, { text: last.text }).catch((err) => { e.currentTarget.disabled = false; fail(err) })
  } }, "Try again")
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
  // The same calls as last time (an event elsewhere in the thread): nothing here to draw again.
  const same = g.items && g.items.length === run.items.length && g.items.every((x, i) => x === run.items[i])
  g.items = run.items
  if (same) return g.node
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
  // A run that's over says what it did ("Read 7 files, edited 2"); one still going shows its latest call.
  const summary = state !== "running" && tools.length > 1 ? toolSummary(tools) : ""
  const counted = summary ? (failed ? `${failed} failed` : "") : `${tools.length} tool${tools.length === 1 ? "" : "s"}${failed ? ` · ${failed} failed` : ""}`
  const sum = tools.reduce((s, i) => { if (!i.diff) return s; const c = countsOf(i); return { add: s.add + c.add, del: s.del + c.del, any: true } }, { add: 0, del: 0, any: false })
  g.head.replaceChildren(...[
    el("span", { class: "tool-state", "aria-label": state }),
    g.win,
    sum.any ? diffStat(sum) : null,
    el("span", { class: "tool-count", text: counted })].filter(Boolean))
  if (summary) {
    g.spinning?.cancel()
    g.spinning = null
    g.shown = `summary:${last.id}`
    g.reel.replaceChildren(el("span", { class: "reel-line" }, el("span", { class: "tool-summary", text: summary })))
    g.head.title = summary
    return
  }
  g.head.removeAttribute("title")
  // A new call spins the row like a lottery drum and lands on it; the same call just repaints.
  const was = g.shown === undefined ? undefined : g.items.find((i) => i.id === g.shown)
  const spin = was !== undefined && g.shown !== last.id && !matchMedia("(prefers-reduced-motion: reduce)").matches
  g.shown = last.id
  if (spin) spinReel(g, [was, ...blurs(tools, last), last].map(line))
  else if (!g.spinning) g.reel.replaceChildren(line(last))
  else g.landing = line(last) // lands on the latest text once the spin ends
}
/**
 * What a run of tool calls did, in words: "Read 7 files, edited 2, ran 3 commands". Files are counted once
 * however often they were read; tools it has no words for are named.
 */
function toolSummary(tools) {
  const n = (k, one, many = `${one}s`) => `${k} ${k === 1 ? one : many}`
  const files = (names) => new Set(tools.filter((t) => names.includes(t.name)).map((t) => t.detail)).size
  const count = (names) => tools.filter((t) => names.includes(t.name)).length
  const known = ["Read", "Edit", "MultiEdit", "Write", "NotebookEdit", "Bash", "PowerShell", "Grep", "Glob", "WebFetch", "WebSearch", "Task", "Agent", "TodoWrite", "BashOutput", "KillShell"]
  const read = files(["Read"]), edited = files(["Edit", "MultiEdit", "NotebookEdit"]), wrote = files(["Write"])
  const ran = count(["Bash", "PowerShell"]), searched = count(["Grep", "Glob"]), web = count(["WebFetch", "WebSearch"]), agents = count(["Task", "Agent"])
  const others = [...new Set(tools.filter((t) => !known.includes(t.name)).map((t) => t.name.replace(/^mcp__[^_]+__/, "").replace(/_/g, " ")))]
  const parts = [
    read ? `read ${n(read, "file")}` : "",
    edited ? `edited ${read ? edited : n(edited, "file")}` : "",
    wrote ? `wrote ${read || edited ? wrote : n(wrote, "file")}` : "",
    ran ? `ran ${n(ran, "command")}` : "",
    searched ? `searched ${searched === 1 ? "once" : `${searched} times`}` : "",
    web ? `looked up ${n(web, "page")}` : "",
    agents ? `started ${n(agents, "subagent")}` : "",
    count(["TodoWrite"]) ? "updated the plan" : "",
    others.length ? `used ${others.slice(0, 2).join(", ")}${others.length > 2 ? ` and ${others.length - 2} more` : ""}` : ""
  ].filter(Boolean)
  const text = parts.join(", ")
  return text ? text[0].toUpperCase() + text.slice(1) : ""
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
    case "assistant": return el("div", { class: "msg msg-a" }, el("div", { class: "msg-ai" }, el("div", { class: "prose" }, mdNodes(item.text))), msgActions(() => item.text, el("span", { class: "msg-meta" })))
    case "tool": {
      if (memoryRead(item)) return memoryCard(item)
      const open = S.expanded.has(item.id)
      // An edit opens to what it changed (and its output only when it failed); any other call to its output.
      const counts = item.diff ? countsOf(item) : null
      // A diff is drawn when its card first opens: hundreds of edits' lines in a long thread, drawn up front,
      // made the page tens of thousands of nodes heavier.
      const out = item.diff
        ? el("div", { class: "tool-out tool-diff", inert: !open })
        : el("pre", { class: "tool-out", inert: !open, text: item.output || (item.status === "running" ? "Running…" : "No output.") })
      const drawDiff = () => {
        if (!item.diff || out.childElementCount) return
        out.append(diffView(item.diff), ...(item.status === "failed" && item.output ? [el("pre", { class: "tool-fail", text: item.output })] : []))
      }
      if (open) drawDiff()
      const node = el("div", { class: `tool ${item.status}${open ? " open" : ""}` })
      const row = el("button", { class: "tool-row", type: "button", "aria-expanded": String(open), onclick: () => {
        const now = !node.classList.contains("open")
        if (now) drawDiff()
        node.classList.toggle("open", now)
        out.inert = !now
        row.setAttribute("aria-expanded", String(now))
        now ? S.expanded.add(item.id) : S.expanded.delete(item.id)
      } }, el("span", { class: "tool-state", "aria-label": item.status }), el("span", { class: "tool-name", text: item.name }), el("span", { class: "tool-detail", text: rel(item.detail) }),
        counts ? diffStat(counts) : null)
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
      const parts = [el("span", { class: "mem-label", text: label }), item.commit ? el("code", { text: item.commit.slice(0, 10) }) : null, el("span", { class: "mem-title", text: item.title })]
      if (!item.text) return el("div", { class: `mem ${item.action}` }, el("div", { class: "mem-head", title: item.title }, ...parts))
      // A recall holds what singularity handed the agent, word for word, as the markdown it is: folded, one line until opened.
      return el("details", { class: `mem ${item.action}` },
        el("summary", { class: "mem-head", title: item.title }, ...parts, el("span", { class: "mem-more", "aria-hidden": "true" })),
        el("div", { class: "mem-text prose" }, mdNodes(item.text)))
    }
    case "compact": return compactCard(item)
    case "link": return linkCard(item)
    // zero's own follow-up, not the person's: the agent stopped on a failed call without saying where things stand.
    case "followup": return el("div", { class: "mem followup" },
      el("div", { class: "mem-head", title: item.reason },
        el("span", { class: "mem-label", text: "zero sent it on" }),
        el("span", { class: "mem-title", text: `${providerLabel(S.open?.provider)} stopped after a failed call (${item.reason}) without saying where things stand` })))
    case "turn": {
      if (item.outcome === "failed") return el("div", { class: "turn-error" }, el("b", { text: "The turn stopped with an error. " }), item.error, retryButton(item))
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
  const head = el("summary", { class: "mem-head", title }, el("span", { class: "mem-label", text: label }), commit ? el("code", { text: commit.slice(0, 10) }) : null, el("span", { class: "mem-title", text: title }), el("span", { class: "mem-more", "aria-hidden": "true" }))
  // Folded to its one line; open, the command's output as it printed it.
  return el("details", { class: `mem ${commit ? "recalled" : "checked"}` }, head, el("pre", { class: "mem-text", text: out }))
}
const verb = (tool) =>({
  Bash: "run a command", Edit: "edit a file", Write: "write a file", MultiEdit: "edit a file", NotebookEdit: "edit a notebook",
  [`${THREAD_TOOL}start_thread`]: "start another thread", [`${THREAD_TOOL}message_thread`]: "message a thread it started"
})[tool] ?? `use ${tool}`

// ---------- linked threads: one started another, talks to it, waits for it ----------
/** How Claude Code names zero's thread tools (src/app/providers/Claude.ts, THREAD_TOOL_PREFIX). */
const THREAD_TOOL = "mcp__zero__"
const LINK_PATHS = '<path d="M6.5 9.5 9.5 6.5M7 4.5l1.2-1.2a2.6 2.6 0 0 1 3.7 3.7L10.7 8.2M9 11.5l-1.2 1.2a2.6 2.6 0 0 1-3.7-3.7L5.3 7.8"/>'
const threadMeta = (id) => S.threads.find((t) => t.id === id)
/** A link to another thread, by its title now (the one the card was made with if it's gone). */
function threadLink(id, fallback, cls = "link-title") {
  const t = threadMeta(id)
  if (!t) return el("span", { class: `${cls} gone`, text: fallback || "a deleted thread", title: "That thread was deleted" })
  return el("a", { class: cls, href: `#/t/${id}`, title: `Open “${t.title}”` }, t.title)
}
/** Whether a thread is working, waiting on the person, or done, as a word and a dot. */
function threadState(id) {
  const t = threadMeta(id)
  if (!t) return null
  const asking = S.asking.has(id)
  return el("span", { class: `link-live${t.status === "running" ? (asking ? " asking" : " running") : ""}` },
    t.status === "running" ? el("span", { class: asking ? "ask-dot" : "run-dot", "aria-hidden": "true" }) : null,
    t.status === "running" ? (asking ? "waiting for your approval" : "working") : "idle")
}
/**
 * What this thread's agent did with another thread: started it on a task, sent it a message, or waited
 * for its reply. The other thread's title links to it; its reply shows once it's in.
 */
function linkCard(item) {
  const verbs = { started: "Started", messaged: "Sent a message to", waited: "Waited for" }
  const states = { sent: "", waiting: "waiting for its reply…", replied: "replied", timeout: "still working when the wait ran out", failed: "didn't finish" }
  const head = el("div", { class: "link-head" },
    icon(LINK_PATHS, "link-ico"),
    el("span", { class: "link-verb", text: verbs[item.action] ?? "Linked" }),
    threadLink(item.threadId, item.title),
    states[item.state] ? el("span", { class: "link-state", text: states[item.state] }) : threadState(item.threadId))
  const what = item.text ? el("details", { class: "link-what" },
    el("summary", { text: item.action === "started" ? "The task it was given" : "The message" }),
    el("div", { class: "prose" }, mdNodes(item.text))) : null
  const reply = item.reply ? el("div", { class: "link-reply" }, el("div", { class: "link-reply-head", text: "Its reply" }), el("div", { class: "prose" }, mdNodes(item.reply))) : null
  const error = item.error ? el("div", { class: "link-error", text: item.error }) : null
  return el("div", { class: `link-card ${item.state}` }, head, what, reply, error)
}
/**
 * The thread's links in its header: the thread that started it, and the threads it started,
 * each a click away. Hidden when it has neither.
 */
function linksNode(t) {
  const node = el("div", { class: "thread-links" })
  node.paint = () => {
    const now = S.open?.id === t.id ? S.open : t
    const kids = S.threads.filter((x) => x.parentId === now.id)
    const parent = now.parentId ? threadMeta(now.parentId) : null
    node.hidden = !parent && !kids.length
    node.replaceChildren(...[
      parent ? el("a", { class: "link-chip", href: `#/t/${parent.id}`, title: `Started by the agent in “${parent.title}”` }, icon(LINK_PATHS), el("span", { text: `From ${parent.title}` })) : null,
      kids.length ? el("button", { class: "link-chip", type: "button", title: "Threads this thread's agent started",
        onclick: () => actionSheet(`Started from “${now.title}”`, kids.map((k) => ({ label: `${k.status === "running" ? "● " : ""}${k.title}`, run: () => go(`#/t/${k.id}`) }))) },
        icon(LINK_PATHS), el("span", { text: `${kids.length} thread${kids.length === 1 ? "" : "s"}` }),
        kids.some((k) => k.status === "running") ? el("span", { class: "run-dot", "aria-hidden": "true" }) : null) : null].filter(Boolean))
  }
  node.paint()
  return node
}
/** Repaint the open thread's header links: a thread it links to was made, renamed, or started or ended a turn. */
function paintLinks() { feed?.links?.paint() }

// ---------- git panel: a right sidebar with the thread's branch and its pull request ----------
const BRANCH_PATHS = '<circle cx="4.5" cy="3.5" r="1.5"/><circle cx="4.5" cy="12.5" r="1.5"/><circle cx="11.5" cy="4.5" r="1.5"/><path d="M4.5 5v6M11.5 6c0 3.5-7 2.5-7 5"/>'
const PLUS_PATHS = '<path d="M8 3.5v9M3.5 8h9"/>'
const FOLDER_PATHS = '<path d="M2 4.5h4l1.5 1.5H14v6.5H2z"/>'
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
  // Labelled, not just an icon: "Git", and how many files have changed once it's looked.
  const badge = el("span", { class: "git-badge", hidden: true })
  const count = el("span", { class: "git-count-chip", hidden: true })
  const toggle = el("button", { class: "icon-btn git-toggle", type: "button", "aria-controls": "git-panel", onclick: () => setGitOpen(!gitOpenNow()),
    html: `<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${BRANCH_PATHS}</svg><span class="git-word">Git</span>` }, count, badge)
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
  gitPanel = { node, body, toggle, badge, count, refresh, threadId: t.id, data: null, loading: false, at: 0, timer: 0, draft: "", folds: new Map() }
  setGitWidth(load("gitWidth", GIT.base), false)
  wireGitResize(resize)
  paintGitToggle()
  loadGit()
  // While it's open, look again: often while checks run, now and then otherwise.
  gitPanel.timer = setInterval(() => {
    const g = gitPanel
    if (g && !document.hidden && autoPullOn() && Date.now() - (gitFetched.get(g.threadId) ?? 0) > AUTO_PULL_MS) autoSync()
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
  const changed = d?.repo ? d.changes.length : 0
  g.count.hidden = !changed
  g.count.textContent = changed > 99 ? "99+" : String(changed)
  const files = changed ? `${changed} changed file${changed === 1 ? "" : "s"}` : ""
  const label = `${open ? "Hide" : "Show"} Git`
  g.toggle.setAttribute("aria-label", [label, files].filter(Boolean).join(", "))
  g.toggle.title = [`${label} (Alt+G)`, branch, files, pr ? `PR #${pr.number} · ${PR_STATE_LABEL[prState(pr)]}` : ""].filter(Boolean).join("\n")
}

/** How often auto-pull fetches for the open thread. */
const AUTO_PULL_MS = 180_000
/** When each thread's folder was last fetched (thread id → ms), so reopening a thread doesn't fetch again at once. */
const gitFetched = new Map()
const autoPullOn = () => load("gitAutoPull", false) === true
/** Whether a pull now would only fast-forward: behind its upstream, nothing of its own, nothing uncommitted, no turn running. */
const canAutoPull = (d) => !!d?.repo && !!d.upstream && d.behind > 0 && d.ahead === 0 && d.branch === d.current && d.changes.length === 0 && S.open?.status !== "running"

/** Auto-pull's round: fetch, look again, and fast-forward the branch when that's safe. A pull that failed isn't tried again until the branch moves. */
async function autoSync() {
  const g = gitPanel
  if (!g || g.syncing || (g.data && !g.data.repo)) return
  g.syncing = true
  gitFetched.set(g.threadId, Date.now())
  try {
    // Being offline is ordinary: the next round tries again.
    await api("POST", `threads/${g.threadId}/git/fetch`, {}).catch(() => {})
    while (gitPanel === g && g.loading) await new Promise((r) => setTimeout(r, 200))
    if (gitPanel !== g) return
    await loadGit()
    const d = g.data
    if (gitPanel !== g || !canAutoPull(d)) return
    const key = `${d.branch}@${d.behind}`
    if (g.pullFailed === key) return
    try {
      await api("POST", `threads/${g.threadId}/git/pull`, {})
      toast(`Pulled ${d.behind} commit${d.behind === 1 ? "" : "s"} into ${d.branch}.`)
    } catch (e) {
      g.pullFailed = key
      toast(`Couldn't pull ${d.branch}: ${e.message}`, true)
    }
    if (gitPanel === g) await loadGit()
  } finally {
    g.syncing = false
  }
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
    d.pr ? prCard(d.pr, d) : noPrCard(d),
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

/** How many lines a diff adds and removes (its "+" and "-" lines, not the file headers). */
function diffCounts(text) {
  let add = 0, del = 0
  for (const l of text.split("\n")) {
    if (l.startsWith("+") && !l.startsWith("+++")) add++
    else if (l.startsWith("-") && !l.startsWith("---")) del++
  }
  return { add, del }
}
/** An item's diff counts, worked out once per item (an item is replaced, not changed, when it updates). */
const counted = new WeakMap()
function countsOf(item) {
  let c = counted.get(item)
  if (!c || c.diff !== item.diff) counted.set(item, (c = { diff: item.diff, ...diffCounts(item.diff) }))
  return c
}
/** "+12 −3", green and red, for a row. */
const diffStat = ({ add, del }) => el("span", { class: "diff-stat", "aria-label": `${add} lines added, ${del} removed` },
  add ? el("b", { class: "d-plus", text: `+${add}` }) : null, del ? el("b", { class: "d-minus", text: `−${del}` }) : null)

// ---------- out to the editor and the file manager (the desktop app only: a phone's would be the wrong machine) ----------
const DESKTOP = location.protocol === "zero:"
const CODE_ICON = '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m5.5 4.5-3.5 3.5 3.5 3.5M10.5 4.5l3.5 3.5-3.5 3.5M9 2.5 7 13.5"/></svg>'
const FOLDER_ICON = '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round" aria-hidden="true"><path d="M1.75 4.25a1 1 0 0 1 1-1h3.1l1.4 1.5h5.99a1 1 0 0 1 1 1v6.5a1 1 0 0 1-1 1H2.75a1 1 0 0 1-1-1z"/></svg>'
/** Where a thread's work is: the worktree its agent moved to, else its worktree, else its project's folder. */
const threadDir = (t, project) => {
  const m = S.open?.id === t.id ? S.open : t
  return m.workTree || m.cwd || project?.path || ""
}
const slashes = (p) => p.replace(/\\/g, "/").replace(/^\/+/, "")
const vscodeUrl = (path) => path ? `vscode://file/${encodeURI(slashes(path))}` : ""
const folderUrl = (path) => path ? `file:///${encodeURI(slashes(path))}` : ""
/** A path the agent gave (absolute, or under the thread's folder) as an absolute one. */
const absPath = (path, dir) => /^([a-zA-Z]:[\\/]|\/)/.test(path) || !dir ? path : `${dir.replace(/[\\/]$/, "")}/${path}`
const openOut = (url) => { if (url) window.open(url, "_blank") }

/** A unified diff, its lines marked as added, removed or a hunk's header. */
function diffView(text) {
  const lines = text.split("\n")
  if (lines.at(-1) === "") lines.pop()
  const cut = lines.length > 2000
  // A bare "@@" (an edit's pieces, from a tool card) is a divider, and nothing at the very top.
  if (lines[0] === "@@") lines.shift()
  return el("pre", { class: "git-diff" }, ...(cut ? lines.slice(0, 2000) : lines).map((l) => l === "@@" ? el("span", { class: "d-gap", "aria-hidden": "true" }) : el("span", {
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
  const canPull = d.upstream && d.behind > 0 && d.ahead === 0 && d.branch === d.current
  const diverged = d.upstream && d.ahead > 0 && d.behind > 0
  return el("div", { class: "git-card git-branch" },
    el("div", { class: "git-branch-line" },
      icon(BRANCH_PATHS, "git-branch-ico"),
      el("code", { class: "git-branch-name", text: d.branch || "detached HEAD", title: d.branch })),
    facts.length ? el("div", { class: "git-facts" }, facts) : null,
    el("div", { class: "git-actions" },
      canPull ? el("button", { class: "btn btn-primary btn-xs", type: "button", title: `Fast-forward ${d.branch} to ${d.upstream}`, onclick: (e) => withBusy(e.currentTarget, () => gitAction("pull", {}, `Pulled ${d.behind} commit${d.behind === 1 ? "" : "s"} into ${d.branch}.`)) }, `Pull ↓${d.behind}`) : null,
      canPush ? el("button", { class: "btn btn-quiet btn-xs", type: "button", onclick: (e) => withBusy(e.currentTarget, () => gitAction("push", { branch: d.branch }, `Pushed ${d.branch}.`)) }, "Push") : null,
      el("button", { class: "btn btn-quiet btn-xs", type: "button", title: "Ask the remotes what's new, and forget remote branches that were deleted", onclick: (e) => withBusy(e.currentTarget, async () => { gitFetched.set(gitPanel?.threadId, Date.now()); await gitAction("fetch", {}, "Fetched.") }) }, "Fetch")),
    diverged ? el("p", { class: "git-note", text: `${d.branch} has ${d.ahead} commit${d.ahead === 1 ? "" : "s"} of its own and is ${d.behind} behind ${d.upstream}, so a pull can't fast-forward it.` }) : null,
    diverged ? el("div", { class: "git-actions" },
      el("button", { class: "btn btn-quiet btn-xs", type: "button", onclick: () => askAgent(`Rebase ${d.branch} onto ${d.upstream}: run \`git pull --rebase\`, resolve any conflicts, run the checks, and tell me what changed. Don't push.`) }, "Ask the agent to rebase")) : null,
    d.upstream ? el("label", { class: "check git-auto", title: "While this thread is open, zero fetches every few minutes and fast-forwards this branch when it is only behind and nothing is uncommitted. Never a merge or a rebase." },
      el("input", { type: "checkbox", checked: autoPullOn(), onchange: (e) => {
        save("gitAutoPull", e.currentTarget.checked)
        if (e.currentTarget.checked && gitPanel) { gitFetched.delete(gitPanel.threadId); autoSync() }
      } }),
      "Pull automatically") : null,
    d.worktree ? el("p", { class: "git-note", title: d.cwd, text: `In a worktree: ${d.cwd}` }) : null,
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

function prCard(pr, d) {
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
    if (pr.mergeState === "BEHIND") actions.push(el("button", { class: "btn btn-quiet btn-xs", type: "button", title: `Bring ${pr.head} up to date with ${pr.base}, on GitHub`, onclick: (e) => withBusy(e.currentTarget, () => gitAction("update", { number: pr.number }, `Updated ${pr.head} from ${pr.base}.`)) }, "Update branch"))
    actions.push(el("button", { class: "btn btn-quiet btn-xs", type: "button", "aria-haspopup": "dialog", onclick: () => actionSheet(`#${pr.number} ${pr.title}`, [
      { label: "Edit title and description", run: () => editPr(pr) },
      { label: "Request reviewers", run: () => requestReviewers(pr) },
      { label: `Update branch from ${pr.base}`, run: () => gitAction("update", { number: pr.number }, `Updated ${pr.head} from ${pr.base}.`) },
      { label: "Close pull request", danger: true, run: () => closePr(pr) }
    ]) }, "More…"))
  }
  if (pr.state === "CLOSED") actions.push(el("button", { class: "btn btn-quiet btn-xs", type: "button", onclick: (e) => withBusy(e.currentTarget, () => gitAction("reopen", { number: pr.number }, `Reopened #${pr.number}.`)) }, "Reopen"))
  if (pr.state !== "OPEN" && d.gh.ok && d.branch && d.branch !== (d.base?.replace(/^origin\//, "") ?? "")) actions.push(el("button", { class: "btn btn-quiet btn-xs", type: "button", title: `Open another pull request for ${d.branch}`, onclick: () => createPr(d) }, "New pull request"))
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

/** Close the pull request, with an optional comment on GitHub; its branch stays. */
async function closePr(pr) {
  const body = el("div", {},
    el("label", { class: "field" }, "Comment (optional)", el("textarea", { name: "comment", rows: "3", placeholder: "Why it's being closed" })))
  if (!(await dialog({ title: `Close #${pr.number}?`, text: `${pr.title}. It isn't merged; it can be reopened later, and the branch ${pr.head} stays.`, ok: "Close pull request", body }))) return
  await gitAction("close", { number: pr.number, comment: body.querySelector("[name=comment]").value }, `Closed #${pr.number}.`)
}

/** Edit the pull request's title and description, on GitHub. */
async function editPr(pr) {
  const body = el("div", {},
    el("label", { class: "field" }, "Title", el("input", { name: "title", value: pr.title, autocomplete: "off" })),
    el("label", { class: "field" }, "Description", el("textarea", { name: "body", rows: "10" }, pr.body)))
  if (!(await dialog({ title: `Edit #${pr.number}`, ok: "Save", body }))) return
  const title = body.querySelector("[name=title]").value
  if (!title.trim()) return toast("Give the pull request a title.", true)
  await gitAction("edit", { number: pr.number, title, body: body.querySelector("[name=body]").value }, "Pull request updated.")
}

/** Ask GitHub for a review from people or teams, by name. */
async function requestReviewers(pr) {
  const body = el("div", {},
    el("label", { class: "field" }, "Reviewers", el("input", { name: "reviewers", placeholder: "ada, bob, org/team", autocomplete: "off", spellcheck: "false" })))
  const asked = pr.reviewers.length > 0
  if (!(await dialog({ title: `Request a review of #${pr.number}`, text: asked ? `Already asked: ${pr.reviewers.join(", ")}.` : "GitHub usernames or teams, separated by commas.", ok: "Request review", body }))) return
  const names = body.querySelector("[name=reviewers]").value
  if (!names.trim()) return
  await gitAction("reviewers", { number: pr.number, reviewers: names }, "Review requested.")
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
// GitHub-flavored: headings, rules, fences (``` and ~~~), quotes, nested, task and numbered lists,
// tables, emphasis, strikethrough, code spans, links and bare URLs. Links open only http(s) and mailto;
// images become links, since the page's policy loads no remote images.
const safeUrl = (u) => /^(https?:\/\/|mailto:)/i.test(u)
const linkTag = (url, label) => `<a href="${url}" target="_blank" rel="noopener noreferrer">${label}</a>`
function emphasis(t) {
  return t
    .replace(/\*\*\*(?=\S)([\s\S]*?\S)\*\*\*/g, "<strong><em>$1</em></strong>")
    .replace(/\*\*(?=\S)([\s\S]*?\S)\*\*/g, "<strong>$1</strong>")
    .replace(/(^|[^\w])__(?=\S)([\s\S]*?\S)__(?!\w)/g, "$1<strong>$2</strong>")
    .replace(/(^|[^*\w])\*(?=[^\s*])([^*]*?[^\s*]|[^\s*])\*(?![*\w])/g, "$1<em>$2</em>")
    .replace(/(^|[^\w])_(?=[^\s_])([^_]*?[^\s_]|[^\s_])_(?!\w)/g, "$1<em>$2</em>")
    .replace(/~~(?=\S)([\s\S]*?\S)~~/g, "<del>$1</del>")
}
function inline(s) {
  const kept = []
  const keep = (html) => `\u0000${kept.push(html) - 1}\u0000`
  // On the raw text: code spans, backslash escapes and <autolinks>, which nothing else may touch.
  let t = s.replace(/(?<!`)(`+)(?!`)([\s\S]*?[^`])\1(?!`)|\\([!-/:-@[-`{-~])|<((?:https?:\/\/|mailto:)[^\s<>]+)>/g, (_, ticks, code, ch, auto) => {
    if (ticks) {
      const c = code.replace(/\n/g, " ")
      return keep(`<code>${esc(/^ .*[^ ].* $/.test(c) ? c.slice(1, -1) : c)}</code>`)
    }
    if (ch) return keep(esc(ch))
    return keep(linkTag(esc(auto), esc(auto)))
  })
  t = esc(t)
  // [label](url "title") and ![alt](url); a URL may hold one level of parentheses.
  t = t.replace(/(!?)\[([^\]]*)\]\(\s*((?:[^\s()]|\([^\s()]*\))+)(?:\s+&quot;[^]*?&quot;)?\s*\)/g, (_, bang, label, url) => {
    const text = bang ? (label || url) : label
    return safeUrl(url) ? keep(linkTag(url, emphasis(text))) : emphasis(text)
  })
  // Bare URLs, less trailing punctuation and an unmatched closing parenthesis.
  t = t.replace(/\bhttps?:\/\/[^\s\u0000]+/g, (m) => {
    let url = m.split(/&(?:lt|gt|quot|#39);/)[0]
    let rest = m.slice(url.length)
    for (;;) {
      const end = /[.,:;!?*_~]+$/.exec(url)?.[0] ?? (url.endsWith(")") && (url.match(/\(/g)?.length ?? 0) < (url.match(/\)/g)?.length ?? 0) ? ")" : "")
      if (!end) break
      url = url.slice(0, -end.length)
      rest = end + rest
    }
    return (/^https?:\/\/[^/]/.test(url) ? keep(linkTag(url, url)) : url) + rest
  })
  t = emphasis(t)
  while (/\u0000\d+\u0000/.test(t)) t = t.replace(/\u0000(\d+)\u0000/g, (_, i) => kept[Number(i)])
  return t
}

const indentOf = (l) => { let n = 0; for (const c of l) { if (c === " ") n++; else if (c === "\t") n += 4 - (n % 4); else break } return n }
const dedent = (l, n) => { let col = 0, k = 0; while (k < l.length && col < n && (l[k] === " " || l[k] === "\t")) { col += l[k] === "\t" ? 4 - (col % 4) : 1; k++ } return l.slice(k) }
const MD_FENCE = /^ {0,3}(`{3,}|~{3,})\s*([^\s`]*)/
const MD_ATX = /^ {0,3}(#{1,6})(?:[ \t]+(.*?))?(?:[ \t]+#+)?[ \t]*$/
const MD_HR = /^ {0,3}([-*_])(?:[ \t]*\1){2,}[ \t]*$/
const MD_ITEM = /^( {0,3})([-*+]|\d{1,9}[.)])(?:([ \t]+)(.*))?$/
const MD_QUOTE = /^ {0,3}> ?/
const MD_TABLE_SEP = /^ {0,3}\|?[ \t]*:?-+:?[ \t]*(?:\|[ \t]*:?-+:?[ \t]*)*\|?[ \t]*$/
const isFence = (l) => { const m = MD_FENCE.exec(l); return !!m && !(m[1][0] === "`" && l.slice(m[0].length).includes("`")) }
const isMdBlockStart = (l) => isFence(l) || MD_ATX.test(l) || MD_HR.test(l) || MD_QUOTE.test(l) || /^ {0,3}([-*+]|\d{1,9}[.)])[ \t]+\S/.test(l)

/** A table row's cells: split on pipes outside code spans, \| kept as a pipe. */
function tableCells(line) {
  let s = line.trim()
  if (s.startsWith("|")) s = s.slice(1)
  if (s.endsWith("|") && !s.endsWith("\\|")) s = s.slice(0, -1)
  const cells = []
  let cur = "", code = 0
  for (let k = 0; k < s.length; k++) {
    const c = s[k]
    if (c === "\\" && s[k + 1] === "|") { cur += "|"; k++; continue }
    if (c === "`") { let n = 1; while (s[k + n] === "`") n++; code = code === n ? 0 : code || n; cur += s.slice(k, k + n); k += n - 1; continue }
    if (c === "|" && !code) { cells.push(cur.trim()); cur = ""; continue }
    cur += c
  }
  cells.push(cur.trim())
  return cells
}
const isTableStart = (lines, i) => i + 1 < lines.length && lines[i].includes("|") && MD_TABLE_SEP.test(lines[i + 1]) && lines[i + 1].includes("-") &&
  tableCells(lines[i]).length === tableCells(lines[i + 1]).length

const codeBlock = (lang, body) => `<div class="code"><div class="code-head"><span>${esc(lang || "text")}</span><button class="copy" type="button">Copy</button></div><pre><code>${esc(body)}</code></pre></div>`

/** Block markup for these lines. `tight` leaves paragraphs unwrapped, as in a tight list's items. */
function mdBlocks(lines, tight = false) {
  const out = []
  let i = 0
  while (i < lines.length) {
    const line = lines[i]
    if (!line.trim()) { i++; continue }
    if (isFence(line)) {
      const [, mark, lang] = MD_FENCE.exec(line)
      const ind = indentOf(line)
      const close = new RegExp(`^ {0,3}${mark[0] === "`" ? "`" : "~"}{${mark.length},}[ \\t]*$`)
      const body = []
      i++
      while (i < lines.length && !close.test(lines[i])) body.push(dedent(lines[i++], ind))
      i++
      out.push(codeBlock(lang, body.join("\n")))
      continue
    }
    const h = MD_ATX.exec(line)
    if (h) { out.push(`<h${h[1].length}>${inline(h[2] ?? "")}</h${h[1].length}>`); i++; continue }
    if (MD_HR.test(line)) { out.push("<hr>"); i++; continue }
    if (MD_QUOTE.test(line)) {
      const q = []
      while (i < lines.length && lines[i].trim() && (MD_QUOTE.test(lines[i]) || (q.length && !isMdBlockStart(lines[i])))) q.push(lines[i++].replace(MD_QUOTE, ""))
      out.push(`<blockquote>${mdBlocks(q)}</blockquote>`)
      continue
    }
    if (isTableStart(lines, i)) {
      const head = tableCells(lines[i])
      const align = tableCells(lines[i + 1]).map((c) => c.startsWith(":") ? (c.endsWith(":") ? "center" : "left") : c.endsWith(":") ? "right" : "")
      const cell = (tag, text, k) => `<${tag}${align[k] ? ` class="al-${align[k]}"` : ""}>${inline(text ?? "")}</${tag}>`
      const rows = []
      i += 2
      while (i < lines.length && lines[i].trim() && !isMdBlockStart(lines[i])) rows.push(tableCells(lines[i++]))
      out.push(`<div class="table-wrap"><table><thead><tr>${head.map((c, k) => cell("th", c, k)).join("")}</tr></thead>` +
        (rows.length ? `<tbody>${rows.map((r) => `<tr>${head.map((_, k) => cell("td", r[k], k)).join("")}</tr>`).join("")}</tbody>` : "") + "</table></div>")
      continue
    }
    const first = MD_ITEM.exec(line)
    if (first) {
      const ordered = /\d/.test(first[2])
      const items = []
      let loose = false
      while (i < lines.length) {
        const m = MD_ITEM.exec(lines[i])
        if (!m || /\d/.test(m[2]) !== ordered || MD_HR.test(lines[i])) break
        if (items.length && items[items.length - 1].blankAfter) loose = true
        const markerAt = m[1].length
        const gap = m[3] ? indentOf(m[3]) : 1
        const contentAt = markerAt + m[2].length + (gap > 4 ? 1 : gap)
        const body = [m[4] ?? ""]
        i++
        let blank = false
        while (i < lines.length) {
          const l = lines[i]
          if (!l.trim()) { body.push(""); blank = true; i++; continue }
          const ind = indentOf(l)
          if (ind >= Math.min(contentAt, markerAt + 2)) { body.push(dedent(l, Math.min(ind, contentAt))); blank = false; i++; continue }
          if (!blank && !isMdBlockStart(l)) { body.push(l.trim()); i++; continue }
          break
        }
        let trailing = 0
        while (body.length > 1 && body[body.length - 1] === "") { body.pop(); trailing++ }
        if (body.some((l, k) => l === "" && k > 0 && body[k - 1] !== "")) loose = true
        let task = null
        const tm = /^\[([ xX])\][ \t]+/.exec(body[0])
        if (tm) { task = tm[1] !== " "; body[0] = body[0].slice(tm[0].length) }
        items.push({ body, task, blankAfter: trailing > 0, n: ordered ? parseInt(m[2], 10) : 0 })
      }
      const tag = ordered ? "ol" : "ul"
      const start = ordered && items[0].n !== 1 ? ` start="${items[0].n}"` : ""
      out.push(`<${tag}${start}>${items.map((it) => it.task === null
        ? `<li>${mdBlocks(it.body, !loose)}</li>`
        : `<li class="task"><input type="checkbox" disabled${it.task ? " checked" : ""}> ${mdBlocks(it.body, !loose)}</li>`).join("")}</${tag}>`)
      continue
    }
    const para = []
    let heading = 0
    while (i < lines.length && lines[i].trim()) {
      if (para.length && /^ {0,3}=+[ \t]*$/.test(lines[i])) { heading = 1; i++; break }
      if (para.length && /^ {0,3}-+[ \t]*$/.test(lines[i])) { heading = 2; i++; break }
      if (para.length && (isMdBlockStart(lines[i]) || isTableStart(lines, i))) break
      para.push(lines[i++].trim())
    }
    // A line ending in a backslash or two spaces is a hard break; every line break shows as one here.
    const html = inline(para.map((l, k) => k < para.length - 1 ? l.replace(/\\$/, "") : l).join("\n")).replace(/\n/g, "<br>")
    out.push(heading ? `<h${heading}>${html}</h${heading}>` : tight ? html : `<p>${html}</p>`)
  }
  return out.join("")
}
function md(src) {
  return mdBlocks(src.replace(/\r\n?/g, "\n").split("\n"))
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
  ["remote", "Remote access", '<rect x="4.5" y="1.5" width="7" height="13" rx="1.6"/><path d="M7.2 12.2h1.6"/>'],
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
/**
 * While Remote access is on screen and Tailscale doesn't serve zero yet (HTTPS being turned on, or the
 * command run by hand), look again every few seconds; paint the section afresh once that changes.
 */
let remoteWatch = 0
function watchRemote() {
  clearTimeout(remoteWatch)
  remoteWatch = setTimeout(async () => {
    if (!$("settings").open || settingsTab !== "remote") return
    const r = await api("GET", "remote").catch(() => null)
    if (r && (r.pairUrl || !r.enabled || !r.tailnet.running)) paintSettings()
    else watchRemote()
  }, 4000)
}

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
  const copyBtn = (label, text) => el("button", { class: "btn btn-quiet btn-xs", type: "button", text: label, onclick: async (e) => {
    try {
      await navigator.clipboard.writeText(text)
      e.currentTarget.textContent = "Copied"
    } catch { toast("Couldn't copy: the browser blocked the clipboard.", true) }
  } })
  /** The command to run by hand, with a Copy button: what Share on my tailnet runs. */
  const manual = (r, help) => Object.assign(row("Or run it yourself", help,
    el("span", { class: "row-end" }, el("code", { class: "cmd", text: r.command }), copyBtn("Copy", r.command))), { className: "row row-stack" })
  /** Run `tailscale serve` here, then paint what it said. */
  const shareOnTailnet = async (r, live, button) => {
    if (r.tailnet.busy && !(await dialog({ title: "Replace what Tailscale serves?", text: `Tailscale Serve already serves something else at https://${r.tailnet.host ?? "this machine"}/. Sharing zero there replaces it.`, ok: "Share zero" }))) return
    button.disabled = true
    button.textContent = "Sharing…"
    try { live.replaceChildren(...remoteGroups(await api("POST", "remote/serve", {}), live)) } catch (e) { fail(e); button.disabled = false; button.textContent = "Share on my tailnet" }
  }
  /** Remote access as the backend sees it (src/app/Remote.ts): listening or not, Tailscale, pairing. */
  const remoteGroups = (r, live) => {
    const t = r.tailnet
    const said = r.serve
    // Not reachable yet but on the way: look again every few seconds, and paint the QR code once it's there.
    if (r.enabled && t.running && !r.pairUrl) watchRemote()
    const reach = !r.enabled ? null
      : !t.found ? group("Tailscale", "Tailscale isn't installed here, or the tailscale command isn't on the PATH. Install it on this machine and your phone, sign both in to one tailnet, then look again.")
      : !t.running ? group("Tailscale", "Tailscale is installed but not connected. Sign in on this machine, then look again.")
      : r.pairUrl ? (() => {
        const paired = r.paired ? el("p", { class: "qr-paired" }, el("i"), `${r.paired.device} paired ${ago(r.paired.at) === "now" ? "just now" : `${ago(r.paired.at)} ago`}.`) : null
        const copies = el("div", { class: "row-end" }, copyBtn("Copy pairing link", r.pairUrl), copyBtn("Copy address", t.url))
        const img = el("img", { class: "qr", src: `data:image/svg+xml;charset=utf-8,${encodeURIComponent(r.qr)}`, alt: "QR code: the pairing link", width: 184, height: 184 })
        const warning = el("p", { class: "hint", text: "The link carries the pairing code: send it only to your own devices." })
        // On the phone itself the code is for some other device: there it waits behind a tap, and the links come first.
        if (remote) return group("Pair another device", "This device is paired already. To pair another, send it the link, or show it the code.",
          el("div", { class: "qr-remote" }, paired, copies, el("details", { class: "qr-more" }, el("summary", { class: "btn btn-quiet btn-xs", text: "Show the QR code" }), img)),
          warning)
        return group("Pair your phone", null,
          el("div", { class: "qr-pair" }, img,
            el("div", { class: "qr-steps" },
              el("ol", {},
                el("li", { text: "Turn Tailscale on on your phone, signed in to the same tailnet as this computer." }),
                el("li", { text: "Point the phone's camera at this code and open the link." })),
              el("p", { class: "hint", text: "zero opens there, paired. To keep it a tap away, add it to the home screen from the browser's menu." }),
              paired, copies)),
          warning)
      })()
      : said?.enableUrl ? group("Share zero on your tailnet", "Tailscale asks for one thing first: HTTPS on for your tailnet. Turn it on in Tailscale's admin page; zero finishes on its own, and the QR code shows here.",
        row("Turn on HTTPS", "Once, for the whole tailnet.", el("a", { class: "btn btn-primary btn-xs", href: said.enableUrl, target: "_blank", rel: "noopener noreferrer", text: "Open Tailscale" })),
        manual(r, "If it doesn't finish, run this once HTTPS is on."))
      : group("Share zero on your tailnet", "One step left: Tailscale Serve carries zero to your devices over HTTPS, on your tailnet only. Tailscale keeps serving it after restarts.",
        said && !said.ok ? el("pre", { class: "cmd serve-said", text: said.output || "tailscale serve didn't say why it failed." }) : null,
        row(t.busy ? "Set it up here, replacing what's served now" : "Set it up here", `zero runs tailscale serve on this machine${t.host ? `, for https://${t.host}/` : ""}.`,
          el("button", { class: "btn btn-primary btn-xs", type: "button", text: "Share on my tailnet", onclick: (e) => shareOnTailnet(r, live, e.currentTarget) })),
        manual(r, "Runs on this machine; then the QR code shows here."))
    return [
      group(null, null,
        row("Status", r.listening ? `Listening at ${r.local}` : r.enabled ? (r.error ?? "Starting…") : "Off. Paired devices can't reach zero.",
          el("span", { class: "row-end" }, pill(r.listening, "Listening", r.enabled ? "Not listening" : "Off"),
            el("button", { class: "btn btn-quiet btn-xs", type: "button", text: "Look again", onclick: () => paintSettings() })))),
      reach,
      group("Pairing", r.pairUrl ? "No camera handy? Open the address on the device and type this code. It asks once, then stays paired." : "A new device asks for this code once, then stays paired.",
        row("Pairing code", null, el("span", { class: "pair-code", text: r.code })),
        row("Sign out every device", "Makes a new code. Devices paired with this one have to pair again.",
          el("button", { class: "btn btn-quiet btn-xs", type: "button", text: "New code", onclick: async () => {
            if (!(await dialog({ title: "Sign out every device?", text: "zero makes a new pairing code. Each phone or computer you paired has to pair again with it.", ok: "New code" }))) return
            try { await api("POST", "remote/code", {}); toast("New pairing code. Every device is signed out."); paintSettings() } catch (e) { fail(e) }
          } })))
    ].filter(Boolean)
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
    remote: () => {
      const port = el("input", { class: "port-input", type: "number", min: 1024, max: 65535, step: 1, value: s.remote.port, "aria-label": "Port" })
      port.addEventListener("change", () => {
        const n = Number(port.value)
        if (!Number.isInteger(n) || n < 1024 || n > 65535) { port.value = s.remote.port; return toast("A port is a whole number from 1024 to 65535.", true) }
        s.remote.port = n
        commit()
      })
      // Turned off from a paired device, it cuts off that very device: asked first.
      const remoteSwitch = () => {
        const b = sw(() => s.remote.enabled, (v) => (s.remote.enabled = v), "Remote access")
        b.addEventListener("click", async (e) => {
          if (!s.remote.enabled) return
          e.stopImmediatePropagation()
          if (await dialog({ title: "Turn off remote access?", text: "This device loses zero as well, until remote access is turned on again on the computer.", ok: "Turn off" })) {
            s.remote.enabled = false
            b.setAttribute("aria-checked", "false")
            commit()
          }
        }, { capture: true })
        return b
      }
      // What's listening and what Tailscale says come from the backend: painted when they arrive.
      const live = el("div", { class: "set-live" }, el("p", { class: "hint", text: "Looking…" }))
      api("GET", "remote").then((r) => live.replaceChildren(...remoteGroups(r, live)), (e) => live.replaceChildren(el("p", { class: "hint", text: e.message })))
      return [
        group(null, "Use zero from your phone or another computer on your tailnet: start threads and carry on old ones, as here. It works while this app is open.",
          row("Serve zero to your other devices", "On this machine only (127.0.0.1); Tailscale Serve carries it to your devices over HTTPS.", remote ? remoteSwitch() : sw(() => s.remote.enabled, (v) => (s.remote.enabled = v), "Remote access")),
          row("Port", "The local port Tailscale forwards to.", port)),
        live
      ]
    },
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
// zero improving itself: what the loop is, where it stands, what it tried, and the runs that move it.
let evoMode = load("evoMode", "generation")
let evoReps = load("evoReps", 1)
let evoGens = load("evoGens", 3)
/** Evolve's budget, as more to spend from here; the CLI wants the ledger's total, so it's added to what's spent. */
let evoMore = load("evoMore", 5)
/** The chart's measure: "score" or "cost"; null picks whichever has moved. */
let evoMetric = load("evoMetric", null)
let evoFilter = "all"
let evoFile = "genome/solver.md"
const evoOpen = new Set()
let evoClock = 0

const EVO_KINDS = {
  bench: { label: "Benchmark", verb: "Run benchmark", what: "Score the current genome on every task. Nothing changes but the ledger." },
  generation: { label: "Generation", verb: "Run one generation", what: "The improver proposes one change, the benchmark judges it, and zero keeps it only if it wins." },
  evolve: { label: "Evolve", verb: "Start evolving", what: "Generations back to back, each starting from what the last one kept, until the count or the money runs out." }
}
const EVO_STEPS = [
  ["measure", "Measure", "The solver works every benchmark task; hidden tests it never sees score it."],
  ["propose", "Propose", "The improver studies the scores and earlier tries, recalls a past win, and edits genome/."],
  ["judge", "Judge", "The new genome is benchmarked. It wins with a higher score, or the same for 15% less."],
  ["keep", "Keep", "A win is committed and remembered for the next improver. A loss is put back."]
]
const EVO_FILES = [
  ["genome/solver.md", "solver.md", "The instructions every solver agent starts with."],
  ["genome/lessons.md", "lessons.md", "What earlier generations learned, passed on to the solver."],
  ["genome/improver.md", "improver.md", "How the improver goes about changing the genome, which it may rewrite too."]
]
const EVO_KNOBS = [
  ["solverModel", "Solver model", "Works each benchmark task", modelName],
  ["solverEffort", "Solver effort", "How hard it thinks each turn"],
  ["maxTurns", "Turn limit", "Most turns on one task"],
  ["improverModel", "Improver model", "Rewrites the genome", modelName],
  ["improverEffort", "Improver effort", "How hard it thinks each turn"]
]
/** The page's tabs: [key, label]. Overview has what's needed to run; the rest is for reading. */
const EVO_TABS = [["overview", "Overview"], ["history", "History"], ["genome", "Genome"], ["bench", "Benchmark"]]
let evoTab = load("evoTab", "overview")

const EVO_LEDE = "zero rewrites its own genome, the instructions and settings its agents run with, and keeps a change only when a benchmark with hidden tests shows it's better."
function evolutionView() {
  const page = el("div", { class: "page" }, el("div", { class: "page-inner wide evo", id: "evo" }, S.evo ? null : evoSkeleton()))
  // Seen before: what was there shows at once (the page is in place by the microtask), and the fresh state follows.
  if (S.evo) queueMicrotask(paintEvo)
  loadEvo()
  return page
}
let evoLoading = null
let evoSeen = ""
/** Fetch the state, and paint it if it changed. Calls while one is out share it. */
function loadEvo() {
  evoLoading ??= api("GET", "zero/state").then((E) => {
    const text = JSON.stringify(E)
    const changed = text !== evoSeen
    evoSeen = text
    S.evo = E
    if (changed && S.route.name === "evolution") paintEvo()
  }, (e) => { if (S.route.name === "evolution") fail(e) }).finally(() => { evoLoading = null })
  return evoLoading
}
/** Before the first answer: the page's shape, so nothing jumps when it arrives. */
function evoSkeleton() {
  const bar = (w, h = 12) => el("span", { class: "skel", style: `width:${w};height:${h}px` })
  const stat = (label) => el("div", { class: "kpi" }, el("div", { class: "kpi-label", text: label }), el("div", { class: "kpi-value" }, bar("55%", 26)), el("div", { class: "kpi-sub" }, bar("80%", 10)))
  return [
    evoHeader(null),
    evoTabs(null),
    el("div", { class: "evo-tab" },
      el("section", { class: "kpis", "aria-busy": "true" }, ["Score", "Cost per task", "Generations", "Spent"].map(stat)),
      evoLoop({ job: null, log: [] }),
      el("div", { class: "evo-main" },
        el("section", { class: "card evo-chart-card", "aria-busy": "true" }, el("h2", { text: "Lineage" }), bar("60%", 10), el("div", { class: "chart" }, bar("100%", 240))),
        el("section", { class: "card evo-skel-tall" }, el("h2", { text: "Run" }))))
  ]
}
/** Rebuild one section in place, leaving the rest of the page (and where it's scrolled) alone. */
function swapEvo(id, build) {
  const n = $(id)
  if (!n || !S.evo) return null
  const fresh = build(S.evo)
  n.replaceWith(fresh)
  return fresh
}

const evoRunning = (E) => E.job && (E.job.state === "running" || E.job.state === "stopping")
/** The current genome's latest score on the whole benchmark. */
const evoNow = (E) => E.measures.filter((m) => m.genomeId === E.genome?.id && m.results.length === E.tasks.length).at(-1)
const perTask = (m) => m.costUsd / Math.max(1, m.tasks * (m.reps ?? 1))
const share = (from, to) => (from > 0 ? Math.round((1 - to / from) * 100) : 0)

/** Where a run is in the loop, from its output: the last line that says. */
function evoStage(E) {
  if (!evoRunning(E)) return null
  if (E.job.request.kind === "bench") return "measure"
  for (let i = E.log.length - 1; i >= 0; i--) {
    const l = E.log[i].line
    if (/^gen \d+: (accepted|committed)/.test(l)) return "keep"
    if (/^gen \d+: (rejected|measuring the child)/.test(l)) return "judge"
    if (/^gen \d+: improver|^\[improver\]|^singularity/.test(l)) return "propose"
    if (/^gen \d+: (measuring the current|parent)|^=== generation/.test(l)) return "measure"
  }
  return "measure"
}

/** What the chosen run should cost, from the last measurement and what improvers have cost lately. */
function evoEstimate(E) {
  const now = evoNow(E)
  if (!now) return null
  const bench = (now.costUsd / (now.reps ?? 1)) * evoReps
  if (evoMode === "bench") return bench
  const recent = E.attempts.slice(-5).map((a) => a.improverCostUsd)
  const improver = recent.length ? recent.reduce((s, x) => s + x, 0) / recent.length : 0.7
  // The parent is measured first when it has no score with these reps; after that each child is.
  const measured = E.measures.some((m) => m.genomeId === E.genome.id && m.results.length === E.tasks.length && (m.reps ?? 1) === evoReps)
  const one = improver + bench
  const first = one + (measured ? 0 : bench)
  return evoMode === "generation" ? first : Math.min(first + one * (evoGens - 1), evoMore)
}

/** Paint the page: the header and tabs, then the open tab. Where the page is scrolled stays put. */
function paintEvo() {
  const root = $("evo")
  if (!root || !S.evo) return
  const E = S.evo
  const running = evoRunning(E)
  clearInterval(evoClock)
  if (running) evoClock = setInterval(() => { const n = $("evo-elapsed"); if (n && S.evo?.job) n.textContent = elapsed(S.evo.job.startedAt); else clearInterval(evoClock) }, 1000)
  if (!EVO_TABS.some(([k]) => k === evoTab)) evoTab = "overview"
  const body = {
    overview: () => [
      evoStats(E),
      evoLoop(E),
      el("div", { class: "evo-main" }, evoChart(E), evoRun(E)),
      evoOutput(E),
      evoLatest(E)
    ],
    history: () => [evoHistory(E)],
    genome: () => [el("div", { class: "evo-main evo-main-genome" }, evoGenome(E), evoMemory(E))],
    bench: () => [evoBench(E)]
  }[evoTab]
  root.replaceChildren(evoHeader(E), evoTabs(E), el("div", { class: "evo-tab", id: "evo-tab", role: "tabpanel", "aria-labelledby": `evo-tab-${evoTab}` }, body()))
  const log = $("evo-log")
  if (log) log.scrollTop = log.scrollHeight
}
/** Open a tab of the page, and keep focus on its tab when it had it. */
function evoGo(tab) {
  const had = document.activeElement?.closest?.(".evo-tabs")
  evoTab = tab
  save("evoTab", tab)
  paintEvo()
  if (had) $(`evo-tab-${tab}`)?.focus()
}

function evoStatus(E) {
  if (!E) return el("span", { class: "evo-status" }, el("i"), "Loading…")
  const j = E.job
  if (evoRunning(E)) {
    return el("span", { class: "evo-status live" }, el("i"),
      j.state === "stopping" ? "Stopping…" : `${EVO_KINDS[j.request.kind].label} running`,
      el("span", { class: "evo-status-time", id: "evo-elapsed", text: elapsed(j.startedAt) }))
  }
  if (!j) return el("span", { class: "evo-status" }, el("i"), "Idle")
  const when = ago(j.endedAt ?? j.startedAt)
  const said = { done: "Last run finished", failed: "Last run failed", stopped: "Last run stopped" }[j.state] ?? "Idle"
  return el("span", { class: `evo-status ${j.state}` }, el("i"), said, el("span", { class: "evo-status-time", text: when === "now" ? "just now" : `${when} ago` }))
}

function evoHeader(E) {
  return el("header", { class: "evo-head" },
    el("div", { class: "evo-title" },
      el("h1", { text: "Evolution" }),
      el("p", { class: "lede", text: EVO_LEDE })),
    evoStatus(E))
}

/** The tabs under the header. History counts its generations. Left and Right move between them. */
function evoTabs(E) {
  const keys = EVO_TABS.map(([k]) => k)
  return el("nav", { class: "evo-tabs", role: "tablist", "aria-label": "Evolution" },
    EVO_TABS.map(([k, label]) => el("button", {
      class: "evo-tabbtn", type: "button", role: "tab", id: `evo-tab-${k}`, "aria-selected": String(k === evoTab), tabindex: k === evoTab ? 0 : -1,
      onclick: () => { if (E && k !== evoTab) evoGo(k) },
      onkeydown: (e) => {
        if (!E || (e.key !== "ArrowLeft" && e.key !== "ArrowRight")) return
        e.preventDefault()
        evoGo(keys[(keys.indexOf(k) + (e.key === "ArrowRight" ? 1 : keys.length - 1)) % keys.length])
      }
    }, label, k === "history" && E?.attempts.length ? el("span", { class: "evo-tab-n", text: String(E.attempts.length) }) : null)))
}

/** How a generation works, as four steps; during a run, which one it's on. */
function evoLoop(E) {
  const stage = evoStage(E)
  const at = EVO_STEPS.findIndex(([k]) => k === stage)
  return el("section", { class: `evo-loop${stage ? " live" : ""}`, "aria-label": "How a generation works" },
    EVO_STEPS.map(([key, title, text], i) =>
      el("div", { class: `evo-step${key === stage ? " active" : ""}${at > i ? " done" : ""}`, "data-step": key, "aria-current": key === stage ? "step" : null },
        el("div", { class: "evo-step-top" }, el("span", { class: "evo-step-n", text: String(i + 1) }), el("b", { text: title }),
          key === stage ? el("span", { class: "evo-step-now", text: "now" }) : null),
        el("p", { text }))))
}

function evoStats(E) {
  const now = evoNow(E)
  const first = E.measures[0]
  const kept = E.attempts.filter((a) => a.accepted).length
  const benchUsd = E.measures.reduce((s, m) => s + m.costUsd, 0)
  const stat = (label, value, sub, good = null) =>
    el("div", { class: "kpi" }, el("div", { class: "kpi-label", text: label }), el("div", { class: "kpi-value" }, value),
      el("div", { class: "kpi-sub" }, good ? el("span", { class: "kpi-good", text: good }) : null, sub))
  const saved = now && first ? share(perTask(first), perTask(now)) : 0
  return el("section", { class: "kpis", "aria-label": "Where zero stands" },
    stat("Score", now ? [pct(now.score), el("small", { text: "%" })] : "—",
      now ? `${now.solved} of ${now.tasks} tasks fully solved${(now.reps ?? 1) > 1 ? ` · ${now.reps} reps` : ""}` : "Run a benchmark to score this genome"),
    stat("Cost per task", now ? usd(perTask(now)) : "—",
      now && first ? (saved > 0 ? `from ${usd(perTask(first))}` : `${usd(perTask(first))} at the start`) : "One solver run, on average",
      saved > 0 ? `${saved}% less` : null),
    stat("Generations", String(E.attempts.length),
      E.attempts.length ? `${kept} kept · ${E.attempts.length - kept} turned down` : "None yet"),
    stat("Spent", usd(E.spentUsd), `${usd(benchUsd)} benchmarks · ${usd(E.spentUsd - benchUsd)} improvers`))
}

function evoChart(E) {
  const scores = [...E.attempts.map((a) => a.parentScore), ...E.attempts.map((a) => a.childScore).filter((s) => s !== null)]
  const flat = scores.length > 0 && Math.max(...scores) - Math.min(...scores) < 0.005
  const metric = evoMetric ?? (flat ? "cost" : "score")
  const chart = el("div", { class: "chart", role: "img", "aria-label": metric === "cost" ? "Benchmark cost by generation" : "Score by generation" })
  const seg = el("div", { class: "seg seg-sm", role: "radiogroup", "aria-label": "Chart shows" },
    [["score", "Score"], ["cost", "Cost"]].map(([m, l]) =>
      el("button", { type: "button", role: "radio", "aria-checked": String(m === metric), onclick: () => { evoMetric = m; save("evoMetric", m); swapEvo("evo-chart", evoChart)?.querySelector("[aria-checked=true]")?.focus() } }, l)))
  const key = (cls, text) => el("span", { class: "legend-item" }, el("span", { class: `legend-mark ${cls}` }), text)
  const card = el("section", { class: "card evo-chart-card", id: "evo-chart" },
    el("div", { class: "card-head" },
      el("div", {}, el("h2", { text: "Lineage" }),
        el("p", { class: "hint", text: metric === "cost"
          ? "A full benchmark run's cost, generation by generation. It drops when a cheaper genome is kept."
          : "The genome's score, generation by generation. It moves only when a change is kept." })),
      seg),
    chart,
    E.attempts.length === 0 && !evoNow(E) ? null : el("div", { class: "legend" }, key("lm-start", "First measured"), key("lm-kept", "Kept"), key("lm-down", "Turned down"), key("lm-guard", "Stopped by a guard"),
      flat && metric === "score" ? el("span", { class: "legend-note", text: "Every genome scores the same: Cost tells more." }) : null))
  drawLineage(chart, E, evoRunning(E) && E.job.request.kind !== "bench", metric)
  return card
}

function evoRun(E) {
  const running = evoRunning(E)
  const dirty = E.tree.length > 0
  const blocked = evoMode !== "bench" && dirty
  const notEvolve = evoMode !== "evolve"
  const onlyGenome = dirty && E.tree.every((p) => p.startsWith("genome/"))
  const est = evoEstimate(E)
  const stepper = (id, value, min, max, set, off = false) => {
    const input = el("input", { id, type: "number", min, max, step: 1, value, inputmode: "numeric", disabled: off })
    const put = (v) => { const n = Math.min(max, Math.max(min, Math.round(Number(v) || min))); input.value = n; set(n); paintEvoEstimate() }
    input.addEventListener("change", () => put(input.value))
    return el("div", { class: "stepper" },
      el("button", { type: "button", "aria-label": "Less", disabled: off, onclick: () => put(Number(input.value) - 1) }, "−"),
      input,
      el("button", { type: "button", "aria-label": "More", disabled: off, onclick: () => put(Number(input.value) + 1) }, "+"))
  }
  const field = (label, help, control, off = false) =>
    el("div", { class: `evo-field${off ? " off" : ""}` },
      el("div", { class: "evo-field-text" },
        el("div", { class: "evo-field-label" }, label, el("span", { class: "only", text: "Evolve only" })),
        el("div", { class: "row-help", text: help })),
      control)
  const more = el("input", { id: "evo-more", type: "number", min: 1, max: 500, step: 1, value: evoMore, inputmode: "decimal", disabled: notEvolve })
  more.addEventListener("change", () => { evoMore = Math.min(500, Math.max(1, Number(more.value) || 5)); more.value = evoMore; save("evoMore", evoMore); paintEvoEstimate() })
  const kinds = Object.keys(EVO_KINDS)
  const pick = (m) => { evoMode = m; save("evoMode", m); paintRun() }
  const modes = el("div", { class: "seg evo-modes", role: "radiogroup", "aria-label": "What to run" },
    kinds.map((m) =>
      el("button", {
        type: "button", role: "radio", "aria-checked": String(m === evoMode), tabindex: m === evoMode ? 0 : -1,
        onclick: () => pick(m),
        onkeydown: (e) => {
          if (!["ArrowDown", "ArrowUp", "ArrowLeft", "ArrowRight"].includes(e.key)) return
          e.preventDefault()
          pick(kinds[(kinds.indexOf(m) + (e.key === "ArrowDown" || e.key === "ArrowRight" ? 1 : kinds.length - 1)) % kinds.length])
        }
      }, EVO_KINDS[m].label)))
  return el("section", { class: "card evo-run", id: "evo-run" },
    el("div", { class: "card-head" }, el("h2", { text: "Run" }), el("span", { class: "hint", text: "Real sessions, real money" })),
    modes,
    el("p", { class: "evo-mode-what", text: EVO_KINDS[evoMode].what }),
    el("div", { class: "evo-fields" },
      field("Reps per task", "Runs each task more than once to average out luck.", stepper("evo-reps", evoReps, 1, 5, (n) => { evoReps = n; save("evoReps", n) })),
      field("Generations", "At most this many in a row.", stepper("evo-gens", evoGens, 1, 50, (n) => { evoGens = n; save("evoGens", n) }, notEvolve), notEvolve),
      field("Spend up to", `More, on top of the ${usd(E.spentUsd)} spent so far.`,
        el("label", { class: "money" }, el("span", { text: "$" }), more), notEvolve)),
    // Whatever the mode: the same note, so choosing one doesn't move the page.
    dirty
      ? el("div", { class: "warnbox" },
        el("b", { text: "zero has uncommitted changes. " }),
        "A benchmark can still run, but Generation and Evolve put back every change they don't keep, so commit or stash these first: ",
        el("span", { class: "mono", text: E.tree.slice(0, 4).join(", ") + (E.tree.length > 4 ? ` and ${E.tree.length - 4} more` : "") }),
        onlyGenome && !running ? el("div", {}, el("button", { class: "btn btn-quiet btn-xs", type: "button", onclick: discardGenome }, "Put back the genome/ changes")) : null)
      : null,
    el("div", { class: "evo-go" },
      el("div", { class: "evo-est", id: "evo-est" }, evoEstimateText(E, est)),
      running
        ? el("button", { class: "btn btn-ink", type: "button", disabled: E.job.state === "stopping", onclick: stopEvo }, E.job.state === "stopping" ? "Stopping…" : "Stop the run")
        : el("button", { class: "btn btn-primary", type: "button", disabled: blocked || !E.genome, onclick: startEvo }, EVO_KINDS[evoMode].verb)))
}
/** The Run card alone, after a choice in it: same size in every mode, focus kept on the chosen one. */
function paintRun() {
  const had = document.activeElement?.closest?.(".evo-modes")
  const fresh = swapEvo("evo-run", evoRun)
  if (had) fresh?.querySelector(".evo-modes [aria-checked=true]")?.focus()
}
function evoEstimateText(E, est) {
  if (est === null) return [el("span", { class: "hint", text: "The cost shows once the genome has a score." })]
  return [el("span", { class: "hint", text: evoMode === "evolve" ? "Up to about" : "About" }), el("b", { text: usd(est) })]
}
function paintEvoEstimate() {
  const n = $("evo-est")
  if (n && S.evo) n.replaceChildren(...evoEstimateText(S.evo, evoEstimate(S.evo)))
}

function evoOutput(E) {
  const j = E.job
  const running = evoRunning(E)
  const args = j ? ["zero", ...(j.request.kind === "bench" ? ["bench"] : [j.request.kind])].join(" ") : ""
  const log = el("div", { class: `log${E.log.length ? "" : " empty"}`, id: "evo-log", role: "log", "aria-live": "off" },
    E.log.length ? E.log.map((l) => logLine(l.line))
      : el("div", { class: "log-empty", text: "Nothing has run since zero started. A run's output streams here, line by line." }))
  return el("section", { class: "card evo-out" },
    el("div", { class: "card-head" },
      el("div", { class: "evo-out-title" }, el("h2", { text: "Output" }),
        j ? el("span", { class: "hint", text: `${EVO_KINDS[j.request.kind].label} · ${{ running: "running", stopping: "stopping", done: "finished", failed: "failed", stopped: "stopped" }[j.state]}` }) : null,
        j ? el("code", { class: "file-chip", text: args }) : null),
      running ? el("button", { class: "btn btn-quiet btn-xs", type: "button", disabled: j.state === "stopping", onclick: stopEvo }, j.state === "stopping" ? "Stopping…" : "Stop") : null),
    log)
}

/** Overview's last few generations, with a way to all of them. */
function evoLatest(E) {
  const last = E.attempts.slice(-3).reverse()
  return el("section", { class: "card" },
    el("div", { class: "card-head" },
      el("div", {}, el("h2", { text: "Latest generations" }), el("p", { class: "hint", text: "Open one to see what the improver tried, why, and what the benchmark said." })),
      E.attempts.length > last.length ? el("button", { class: "btn btn-quiet btn-xs", type: "button", onclick: () => evoGo("history") }, `See all ${E.attempts.length}`) : null),
    last.length === 0
      ? el("div", { class: "evo-empty" }, el("b", { text: "No generations yet." }), "Run one: the first measures the genome as it is, then tries to beat it.")
      : el("ol", { class: "attempts" }, last.map((a) => evoAttempt(E, a))))
}

function evoHistory(E) {
  const all = E.attempts.slice().reverse()
  const kept = all.filter((a) => a.accepted).length
  const list = all.filter((a) => evoFilter === "all" || (evoFilter === "kept") === a.accepted)
  const seg = el("div", { class: "seg seg-sm seg-3", role: "radiogroup", "aria-label": "Show" },
    [["all", `All ${all.length}`], ["kept", `Kept ${kept}`], ["down", `Turned down ${all.length - kept}`]].map(([f, l]) =>
      el("button", { type: "button", role: "radio", "aria-checked": String(f === evoFilter), onclick: () => { evoFilter = f; swapEvo("evo-history", evoHistory)?.querySelector(".seg [aria-checked=true]")?.focus() } }, l)))
  return el("section", { class: "card", id: "evo-history" },
    el("div", { class: "card-head" },
      el("div", {}, el("h2", { text: "History" }), el("p", { class: "hint", text: "Every generation, kept or not. Open one to see what the improver tried, why, and what the benchmark said." })),
      all.length ? seg : null),
    all.length === 0
      ? el("div", { class: "evo-empty" }, el("b", { text: "No generations yet." }), "Run one: the first measures the genome as it is, then tries to beat it.")
      : list.length === 0 ? el("div", { class: "evo-empty", text: "None here." })
      : el("ol", { class: "attempts" }, list.map((a) => evoAttempt(E, a))))
}
function evoAttempt(E, a) {
  const guard = a.childScore === null
  const verdict = a.accepted ? "Kept" : guard ? "Guard" : "Turned down"
  const pc = judgedCost(E, a.parentId, a.at)
  const cc = guard ? null : judgedCost(E, a.childId, a.at)
  const dScore = guard ? null : a.childScore - a.parentScore
  const dCost = pc !== null && cc !== null ? -share(pc, cc) : null
  const delta = (v, text, better) => el("span", { class: `delta ${v === 0 ? "" : better ? "up" : "down"}`, text })
  const d = el("details", { class: `attempt ${a.accepted ? "kept" : guard ? "guard" : "down"}`, id: `evo-att-${a.generation}`, open: evoOpen.has(a.generation) },
    el("summary", {},
      el("span", { class: "gen", text: `#${a.generation}` }),
      el("span", { class: "verdict", text: verdict, title: guard ? "Stopped by a guard before it was measured" : null }),
      el("span", { class: "att-sum", text: a.summary || "No summary." }),
      el("span", { class: "att-nums" },
        guard ? el("span", { class: "delta", text: "not measured" })
          : [Math.abs(dScore) < 0.0005 ? delta(0, "same score") : delta(dScore, `${dScore > 0 ? "+" : ""}${(dScore * 100).toFixed(1)} pts`, dScore > 0),
            dCost === null ? null : delta(dCost, dCost === 0 ? "same cost" : `${dCost > 0 ? "+" : "−"}${Math.abs(dCost)}% cost`, dCost < 0)],
        el("span", { class: "when", text: `${ago(a.at)} ago`.replace("now ago", "just now"), title: new Date(a.at).toLocaleString() }))),
    el("div", { class: "att-body" },
      el("dl", {},
        a.hypothesis ? [el("dt", { text: "Why it tried this" }), el("dd", { text: a.hypothesis })] : null,
        el("dt", { text: "Verdict" }), el("dd", { text: a.reason }),
        el("dt", { text: "Score" }), el("dd", { class: "num", text: `${pct(a.parentScore)}% → ${guard ? "—" : `${pct(a.childScore)}%`}` }),
        el("dt", { text: "Benchmark cost" }), el("dd", { class: "num", text: `${pc === null ? "—" : usd(pc)} → ${cc === null ? "—" : usd(cc)}` }),
        el("dt", { text: "Files" }), el("dd", {}, a.files.length ? a.files.map((f) => el("code", { class: "file-chip", text: f })) : el("span", { class: "hint", text: "None" })),
        el("dt", { text: "Improver cost" }), el("dd", { class: "num", text: usd(a.improverCostUsd) }),
        a.commit ? [el("dt", { text: "Commit" }), el("dd", {}, el("code", { class: "file-chip", text: a.commit.slice(0, 10), title: a.commit }))] : null)))
  d.addEventListener("toggle", () => (d.open ? evoOpen.add(a.generation) : evoOpen.delete(a.generation)))
  return d
}
/** Open a generation's entry in History, from the chart. */
function openAttempt(gen) {
  evoOpen.add(gen)
  evoFilter = "all"
  evoTab = "history"
  save("evoTab", evoTab)
  paintEvo()
  const n = $(`evo-att-${gen}`)
  n?.scrollIntoView({ behavior: reduced ? "auto" : "smooth", block: "center" })
  n?.querySelector("summary")?.focus({ preventScroll: true })
}

function evoGenome(E) {
  const g = E.genome
  if (!g) return el("section", { class: "card", id: "evo-genome" }, el("h2", { text: "Current genome" }), el("div", { class: "evo-empty" }, el("b", { text: "The genome doesn't load." }), "Check genome/genome.json; runs stay off until it parses."))
  const on = S.settings?.useGenome !== false
  const file = EVO_FILES.find(([f]) => f === evoFile) ?? EVO_FILES[0]
  const text = g.files[file[0]] ?? ""
  return el("section", { class: "card evo-genome", id: "evo-genome" },
    el("div", { class: "card-head" },
      el("div", {}, el("h2", { text: "Current genome" }),
        el("p", { class: "hint", text: "What generations change: these settings and three instruction files, all in genome/ and versioned in git." })),
      el("code", { class: "file-chip", text: g.id, title: "The genome's id: a hash of all four files" })),
    el("dl", { class: "knobs" }, EVO_KNOBS.map(([k, label, help, show]) =>
      el("div", { class: "knob", title: help }, el("dt", { text: label }), el("dd", { text: show ? show(g.knobs[k]) : String(g.knobs[k]) })))),
    el("div", { class: "files" },
      el("div", { class: "file-tabs", role: "tablist", "aria-label": "Genome files" },
        EVO_FILES.map(([f, name]) => el("button", { type: "button", role: "tab", "aria-selected": String(f === file[0]), onclick: () => { evoFile = f; swapEvo("evo-genome", evoGenome)?.querySelector(".file-tabs [aria-selected=true]")?.focus() } }, name))),
      el("p", { class: "hint", text: `${file[2]} ${text.trim().split("\n").length} lines.` }),
      el("pre", { class: "file-text", tabindex: 0, text: text.trim() || "(empty)" })),
    el("p", { class: "hint evo-uses" }, el("span", { class: `pill${on ? "" : " off"}` }, el("i"), on ? "In your threads" : "Off for threads"),
      on ? " Your threads get solver.md and lessons.md too, so what evolution learns reaches your work." : " Turned off in Settings, so threads don't get these instructions."))
}

function evoBench(E) {
  const now = evoNow(E)
  const res = new Map((now?.results ?? []).map((r) => [r.id, r]))
  const firstLine = (p) => p.split(/\n\s*\n/)[0].replace(/`/g, "").replace(/^#+\s*/, "").replace(/\s+/g, " ").trim()
  return el("section", { class: "card" },
    el("div", { class: "card-head" },
      el("div", {}, el("h2", { text: "Benchmark" }),
        el("p", { class: "hint", text: `${E.tasks.length} small programming tasks. Each has hidden tests the solver never sees; the score is the share of them passed.` })),
      now ? el("span", { class: "pill" }, el("i"), `${now.solved} of ${now.tasks} solved`) : null),
    el("ul", { class: "tasks" }, E.tasks.map((t) => {
      const r = res.get(t.id)
      const full = r && r.passed === r.total
      const about = firstLine(t.prompt)
      return el("li", { class: "task" },
        el("div", { class: "task-text" },
          el("span", { class: "task-id", text: t.id }),
          el("span", { class: "task-prompt", text: about, title: about })),
        r ? el("span", { class: "task-bar", title: `${r.passed} of ${r.total} hidden cases passed` }, el("span", { style: `width:${(r.passed / Math.max(1, r.total)) * 100}%`, class: full ? "full" : "" })) : el("span", { class: "task-bar" }),
        el("span", { class: "task-nums", text: r ? `${r.passed}/${r.total}` : "not run" }),
        el("span", { class: "task-cost", text: r ? usd(r.costUsd / (now.reps ?? 1)) : "" }))
    })))
}

function evoMemory(E) {
  if (E.memory === null) {
    return el("section", { class: "card", "aria-busy": "true" },
      el("h2", { text: "Memory" }),
      el("p", { class: "hint", text: "Asking singularity what it stored…" }),
      el("ul", { class: "memory" }, [0, 1].map(() => el("li", {}, el("span", { class: "skel", style: "width:70%;height:10px" })))))
  }
  const live = E.memory.filter((m) => !m.retired)
  return el("section", { class: "card evo-memory" },
    el("div", { class: "card-head" },
      el("div", {}, el("h2", { text: "Memory" }),
        el("p", { class: "hint", text: "Kept changes singularity stored. Before each generation it hands the improver the one most like the job at hand." })),
      E.memory.length ? el("span", { class: "pill" }, el("i"), `${live.length} in use${E.memory.length > live.length ? ` · ${E.memory.length - live.length} retired` : ""}`) : null),
    E.memory.length === 0
      ? el("div", { class: "evo-empty" }, "Nothing stored yet. Each kept generation is stored here.")
      : el("ul", { class: "memory" }, E.memory.map((m) =>
        el("li", { class: m.retired ? "retired" : "" },
          el("span", { class: "mem-title", text: m.title || m.task, title: m.title || m.task }),
          m.retired ? el("span", { class: "hint", text: "retired" }) : null,
          el("code", { class: "file-chip", text: m.commit.slice(0, 7), title: m.commit })))))
}

async function startEvo() {
  const E = S.evo
  try {
    await api("POST", "zero/jobs", { kind: evoMode, generations: evoGens, budgetUsd: Math.min(1000, Math.round((E.spentUsd + evoMore) * 100) / 100), reps: evoReps })
    toast(`${EVO_KINDS[evoMode].label} started.`)
    loadEvo()
  } catch (e) { fail(e) }
}
function stopEvo() { api("POST", "zero/jobs/stop", {}).catch(fail) }
async function discardGenome() {
  const files = S.evo.tree
  if (!(await dialog({ title: "Put back the genome/ changes?", text: `This throws away the uncommitted changes in ${files.join(", ")}, most likely left by a run that was stopped.`, ok: "Put back" }))) return
  try {
    const r = await api("POST", "zero/discard", {})
    toast(`Put back ${r.discarded.length} file${r.discarded.length === 1 ? "" : "s"}.`)
    loadEvo()
  } catch (e) { fail(e) }
}
function logLine(text) {
  const m = /^\[([\w-]+)\](.*)$/.exec(text)
  const cls = text.startsWith("$ ") ? "l-cmd"
    : /accepted|committed/.test(text) ? "l-kept"
    : /rejected|failed|stopping|error/i.test(text) ? "l-bad"
    : /^(gen \d+|genome |benchmark:|===)/.test(text) ? "l-gen" : ""
  return el("div", { class: cls }, m ? el("span", { class: "tag", text: m[1] }) : null, m ? m[2].trim() : text)
}

/**
 * What a genome cost in the measurement a verdict was made on: its latest
 * measurement up to that attempt. Later re-measurements (a bigger benchmark,
 * more reps) mustn't rewrite what an old verdict compared.
 */
function judgedCost(E, id, at) {
  const m = E.measures.filter((x) => x.genomeId === id && x.at <= at).at(-1)
  return m ? m.costUsd : null
}

const NS = "http://www.w3.org/2000/svg"
const svg = (tag, attrs = {}) => { const n = document.createElementNS(NS, tag); for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, v); return n }
/**
 * The lineage: a step line through the genome each generation started from, moving only on a kept
 * change; turned-down children hang off it, and × marks one a guard stopped before it was measured.
 * `metric` is "score" (0–1) or "cost" (a full benchmark run, in dollars).
 */
function drawLineage(box, E, live, metric) {
  const atts = E.attempts
  const cost = metric === "cost"
  const parentOf = (a) => (cost ? judgedCost(E, a.parentId, a.at) : a.parentScore)
  const childOf = (a) => (a.childScore === null ? null : cost ? judgedCost(E, a.childId, a.at) : a.childScore)
  const now = evoNow(E)
  const start = atts.length ? parentOf(atts[0]) : now ? (cost ? now.costUsd : now.score) : null
  if (start === null) return box.append(el("div", { class: "chart-empty" }, el("b", { text: "No score yet." }), "Run a benchmark to place the first point."))
  requestAnimationFrame(() => {
    const W = Math.max(box.clientWidth, 300), H = box.clientHeight
    const n = atts.length + (live ? 1 : 0)
    const values = [start, ...atts.flatMap((a) => [parentOf(a), childOf(a)]).filter((v) => v !== null)]
    let lo, hi, tick
    if (cost) {
      const max = Math.max(...values) * 1.12 || 1
      const raw = max / 4, mag = 10 ** Math.floor(Math.log10(raw)), f = raw / mag
      tick = (f <= 1 ? 1 : f <= 2 ? 2 : f <= 2.5 ? 2.5 : f <= 5 ? 5 : 10) * mag
      lo = 0; hi = Math.ceil(max / tick) * tick
    } else {
      lo = Math.max(0, Math.floor((Math.min(...values) - 0.02) * 10) / 10); hi = 1
      tick = hi - lo <= 0.2 ? 0.05 : hi - lo <= 0.5 ? 0.1 : 0.25
    }
    const fmt = (v) => (cost ? (v === 0 ? "$0" : `$${v < 1 ? v.toFixed(2) : v.toFixed(v % 1 ? 1 : 0)}`) : String(Math.round(v * 100)))
    const pad = { l: cost ? 44 : 36, r: 22, t: 26, b: 26 }
    const x = (i) => pad.l + (n === 0 ? (W - pad.l - pad.r) / 2 : (i / n) * (W - pad.l - pad.r))
    const y = (v) => pad.t + (1 - (v - lo) / (hi - lo || 1)) * (H - pad.t - pad.b)
    const root = svg("svg", { viewBox: `0 0 ${W} ${H}` })
    for (let v = hi; v >= lo - 1e-9; v -= tick) {
      root.append(svg("line", { class: "grid-line", x1: pad.l, x2: W - pad.r, y1: y(v), y2: y(v) }))
      const t = svg("text", { class: "axis", x: pad.l - 8, y: y(v) + 3, "text-anchor": "end" }); t.textContent = fmt(v); root.append(t)
    }
    const step = Math.max(1, Math.ceil(n / Math.max(1, Math.floor((W - pad.l - pad.r) / 56))))
    const t0 = svg("text", { class: "axis", x: x(0), y: H - 4, "text-anchor": "start" }); t0.textContent = "start"; root.append(t0)
    for (let i = step; i <= atts.length; i += step) { const t = svg("text", { class: "axis", x: x(i), y: H - 4, "text-anchor": i === n ? "end" : "middle" }); t.textContent = W < 560 ? `#${i}` : `gen ${i}`; root.append(t) }
    // The line: flat while generations are turned down, a step at each kept one. A parent re-measured
    // (a bigger benchmark, more reps) moves it halfway between generations.
    let cur = start
    const pts = [[x(0), y(cur)]]
    const marks = []
    atts.forEach((a, k) => {
      const i = k + 1
      const p = parentOf(a)
      if (p !== null && Math.abs(p - cur) > 1e-9) { pts.push([x(i - 0.5), y(cur)], [x(i - 0.5), y(p)]); cur = p }
      const c = childOf(a)
      if (a.accepted && c !== null) { pts.push([x(i), y(cur)], [x(i), y(c)]); marks.push({ i, a, kind: "kept", v: c, from: cur }); cur = c }
      else { pts.push([x(i), y(cur)]); marks.push({ i, a, kind: c === null ? "guard" : "down", v: c, from: cur }) }
    })
    if (live) pts.push([x(n), y(cur)])
    const last = live ? pts.length - 2 : pts.length - 1
    root.append(svg("path", { class: "lineage-area", d: `${pts.slice(0, last + 1).map(([a, b], j) => `${j ? "L" : "M"}${a},${b}`).join("")}L${pts[last][0]},${H - pad.b}L${x(0)},${H - pad.b}Z` }))
    root.append(svg("path", { class: "lineage-path", d: pts.slice(0, last + 1).map(([a, b], j) => `${j ? "L" : "M"}${a},${b}`).join("") }))
    if (live) root.append(svg("line", { class: "next-path", x1: pts[last][0], y1: pts[last][1], x2: x(n), y2: y(cur) }), svg("circle", { class: "next", cx: x(n), cy: y(cur), r: 6 }))
    root.append(svg("circle", { class: "node-start", cx: x(0), cy: y(start), r: 4.5 }))
    for (const m of marks) {
      const cx = x(m.i)
      if (m.kind === "kept") root.append(svg("circle", { class: "node-kept", cx, cy: y(m.v), r: 5.5 }))
      else if (m.kind === "down") root.append(svg("line", { class: "stub", x1: cx, x2: cx, y1: y(m.from), y2: y(m.v) }), svg("circle", { class: "node-down", cx, cy: y(m.v), r: 4 }))
      else { const gy = y(m.from) + (cost ? -14 : 14); root.append(svg("line", { class: "guard", x1: cx - 3.5, y1: gy - 3.5, x2: cx + 3.5, y2: gy + 3.5 }), svg("line", { class: "guard", x1: cx - 3.5, y1: gy + 3.5, x2: cx + 3.5, y2: gy - 3.5 })) }
    }
    // Values for the start and each kept generation, above the point; one that would collide with the last is skipped.
    let prev = null
    for (const l of [{ i: 0, v: start }, ...marks.filter((m) => m.kind === "kept").map((m) => ({ i: m.i, v: m.v }))]) {
      // To the right of the point, clear of the step that rises into it; pulled left at the right edge.
      const text = cost ? usd(l.v) : `${pct(l.v)}%`, w = text.length * 6.2
      const lx = Math.min(x(l.i) + 8, W - 2 - w)
      const ly = y(l.v) - 9
      if (prev && lx < prev.right + 4 && Math.abs(ly - prev.y) < 12) continue
      const t = svg("text", { class: "axis value", x: lx, y: ly, "text-anchor": "start" }); t.textContent = text; root.append(t)
      prev = { right: lx + w, y: ly }
    }
    // Hover and click targets, bigger than the dots: a generation's point opens it in History.
    const fv = (v) => (v === null ? "—" : cost ? usd(v) : `${pct(v)}%`)
    root.append(svg("circle", { class: "hit", cx: x(0), cy: y(start), r: 11, title: `Start: the genome as first measured · ${fv(start)}` }))
    for (const m of marks) {
      const verdict = { kept: "Kept", down: "Turned down", guard: "Stopped by a guard" }[m.kind]
      const sum = m.a.summary.length > 90 ? `${m.a.summary.slice(0, 88)}…` : m.a.summary
      const hit = svg("circle", { class: "hit", cx: x(m.i), cy: m.kind === "guard" ? y(m.from) : y(m.v), r: 11, tabindex: 0, role: "button",
        title: `Gen ${m.a.generation} · ${verdict} · ${fv(m.from)} → ${fv(m.v)} · ${sum}` })
      hit.addEventListener("click", () => openAttempt(m.a.generation))
      hit.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); openAttempt(m.a.generation) } })
      root.append(hit)
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
      // A new branch or folder (the thread moved to a worktree, or back): the chip and Git panel read it again.
      const moved = S.open.branch !== meta.branch || S.open.cwd !== meta.cwd || S.open.workTree !== meta.workTree
      Object.assign(S.open, meta)
      for (const k of ["cwd", "workTree", "pr"]) if (!(k in meta)) delete S.open[k]
      if ((ended || moved) && gitPanel?.threadId === meta.id) loadGit()
      if ((ended || moved) && feed?.branch) feed.branch.refresh()
      if (!("effort" in meta)) delete S.open.effort // cleared: back to the provider's default
      if (feed && document.activeElement !== feed.title) feed.title.value = meta.title
      if (feed) {
        feed.models.set({ provider: meta.provider, model: meta.model, effort: meta.effort ?? defaultEffort(meta.provider) })
        feed.models.setAccess(meta.access)
        paintReady(S.open)
      }
      if (!("unseen" in meta)) delete S.open.unseen
      markSeen()
      paintWorking()
    }
    // A thread the open one linked to (started, messaged, waited for) changed: its cards show how it is now.
    repaintLinksTo(meta.id, meta.parentId)
    renderSide()
  }
  /** A thread the open one links to (started, messaged, waited for) changed: its cards and the header show how it is now. */
  const repaintLinksTo = (id, parentId) => {
    if (!feed || !S.open || S.open.id === id) return
    const linked = S.open.items.some((i) => i.kind === "link" && i.threadId === id)
    if (!linked && S.open.parentId !== id && parentId !== S.open.id) return
    for (const i of S.open.items) if (i.kind === "link" && i.threadId === id) feed.cache.delete(i.id)
    renderFeed()
    paintLinks()
  }
  on["threads"] = (data) => {
    S.threads = data
    if (S.open && !S.threads.some((t) => t.id === S.open.id)) go("#/")
    // A linked thread may be gone: its cards and the header say so.
    if (feed && S.open) {
      for (const i of S.open.items) if (i.kind === "link" && !S.threads.some((t) => t.id === i.threadId)) feed.cache.delete(i.id)
      renderFeed()
      paintLinks()
    }
    renderSide()
  }
  on["item"] = ({ threadId, item }) => {
    if (item.kind === "permission") {
      item.state === "pending" ? S.asking.add(threadId) : S.asking.delete(threadId)
      repaintLinksTo(threadId)
      renderSide()
      if (item.state === "pending" && S.open?.id !== threadId) threadToast(threadId, `${threadName(threadId)} is waiting for your approval.`)
    }
    // A thread you're not looking at finished: say so here (the desktop notification is for when zero is behind).
    if (item.kind === "turn" && S.open?.id !== threadId && document.hasFocus()) {
      if (item.outcome === "done") threadToast(threadId, `${threadName(threadId)}: done. Your turn.`)
      else if (item.outcome === "failed") threadToast(threadId, `${threadName(threadId)} stopped on an error.`, true)
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
  on["limits"] = (data) => { S.limits = data; paintMeter() }
  on["commands"] = ({ threadId, commands }) => { S.commands.set(threadId, commands) }
  // The desktop app couldn't do something the page asked of the OS (open a link in VS Code, a folder).
  on["notice"] = ({ text, error }) => toast(text, Boolean(error))
  // Claude Code said which models it offers: the menus have them from the next time they open.
  on["providers"] = (data) => {
    S.providers = data
    if (feed && S.open) feed.models.set({ model: S.open.model })
  }
  // A phone scanned the QR code (or typed the code): say so, and show it in Settings if that's open.
  on["remote-paired"] = ({ device }) => {
    toast(`${device} paired with zero.`)
    if ($("settings").open && settingsTab === "remote") paintSettings()
  }
  on["zero-log"] = (entry) => {
    if (!S.evo) return
    S.evo.log.push(entry)
    const log = $("evo-log")
    if (log) {
      log.querySelector(".log-empty")?.remove()
      log.classList.remove("empty")
      const stick = log.scrollHeight - log.scrollTop - log.clientHeight < 40
      log.append(logLine(entry.line))
      if (stick) log.scrollTop = log.scrollHeight
    }
    // The loop strip shows which step the run is on.
    const stage = evoStage(S.evo)
    const steps = [...document.querySelectorAll(".evo-step")]
    const at = steps.findIndex((n) => n.dataset.step === stage)
    steps.forEach((n, i) => {
      n.classList.toggle("active", i === at)
      n.classList.toggle("done", at > i)
      n.querySelector(".evo-step-now")?.remove()
      if (i === at) n.querySelector(".evo-step-top").append(el("span", { class: "evo-step-now", text: "now" }))
    })
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
  // In a browser (remote access, ui/web.js) the stream can drop, a phone's whenever it sleeps: back,
  // the page fetches what it missed and paints the view again. Drafts are kept; the desktop never drops.
  let resyncTimer = 0
  on["resync"] = () => {
    clearTimeout(resyncTimer)
    resyncTimer = setTimeout(async () => {
      try {
        const b = await api("GET", "bootstrap")
        Object.assign(S, { settings: b.settings, projects: b.projects, threads: b.threads, providers: b.providers })
      } catch { return }
      for (const id of S.asking) if (!S.threads.some((t) => t.id === id && t.status === "running")) S.asking.delete(id)
      route()
    }, 300)
  }
  zero.on((event, data) => on[event]?.(data))
}

// ---------- command palette ----------
/** Ctrl+K (Cmd+K): every thread, project and place, filtered as you type; Enter goes, arrows choose. */
function openPalette() {
  const d = $("palette")
  if (d.open) return
  const entries = [
    { label: "New thread", hint: chord("Alt N"), run: () => newThread() },
    ...S.threads.map((t) => ({ label: t.title, hint: S.projects.find((p) => p.id === t.projectId)?.name ?? "", run: () => go(`#/t/${t.id}`) })),
    ...S.projects.map((p) => ({ label: `New thread in ${p.name}`, hint: p.path, run: () => go(`#/new/${p.id}`) })),
    { label: "Evolution", hint: "zero's lineage and runs", run: () => go("#/evolution") },
    { label: "Settings", hint: "models, access, memory", run: () => openSettings() },
    ...(gitPanel ? [{ label: gitOpenNow() ? "Hide the Git panel" : "Show the Git panel", hint: "Alt+G", run: () => setGitOpen(!gitOpenNow()) }] : []),
    { label: "Add a project", hint: "a folder on this machine", run: () => addProject() },
    { label: "Keyboard shortcuts", hint: "?", run: () => openKeys() }
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
    newThread()
    return
  }
  if (e.altKey && (e.key === "g" || e.key === "G") && gitPanel) {
    e.preventDefault()
    setGitOpen(!gitOpenNow())
    return
  }
  // Escape with words selected (the Quote button up) puts the selection away; it doesn't stop the turn.
  if (e.key === "Escape" && (quoteShown() || !(getSelection()?.isCollapsed ?? true)) && !typing) {
    e.preventDefault()
    hideQuote()
    getSelection()?.removeAllRanges()
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

// ---------- starting, finding, and the keys for both ----------
const MAC = /Mac|iPhone|iPad/.test(navigator.platform)
/** A key chord as this machine names it: "Ctrl K" here, "⌘K" on a Mac. */
const chord = (k) => MAC ? k.replace(/Ctrl ?/g, "⌘").replace(/Alt ?/g, "⌥").replace(/Shift ?/g, "⇧") : k
for (const k of document.querySelectorAll(".side-kbd")) k.textContent = chord(k.textContent)
/** A new thread in the project you're in (the first one otherwise). */
function newThread() {
  const pid = S.open?.projectId ?? S.route.projectId ?? S.projects[0]?.id
  if (pid) go(`#/new/${pid}`)
  else addProject()
}
$("new-thread").addEventListener("click", newThread)
$("open-palette").addEventListener("click", (e) => { e.preventDefault(); openPalette() })
$("open-keys").addEventListener("click", () => openKeys())
/** Every key zero answers to, grouped, in one sheet: opened with ?, from the palette, or the sidebar. */
const KEYS = [
  ["Anywhere", [["Ctrl K", "Go to any thread, project or place"], ["Alt N", "New thread"], ["Alt G", "Show or hide the Git panel"], ["?", "These shortcuts"]]],
  ["Writing", [["Enter", "Send"], ["Shift Enter", "New line"], ["@", "Point at a file in the project"], ["/", "Commands: zero's, and your Claude Code commands and skills"], ["↑ ↓", "Your earlier messages, in an empty box"]]],
  ["While Claude works", [["Esc", "Stop the turn"], ["Y / N", "Allow or deny what it asks"]]]
]
function openKeys() {
  if ($("dialog").open || $("palette").open || document.querySelector(".keys-sheet")) return
  const d = el("dialog", { class: "keys-sheet", "aria-label": "Keyboard shortcuts" })
  d.append(el("div", { class: "keys-head" }, el("h3", { text: "Keyboard shortcuts" }), el("button", { class: "icon-btn", type: "button", "aria-label": "Close", text: "×", onclick: () => d.close() })),
    ...KEYS.map(([group, rows]) => el("section", { class: "keys-group" }, el("h4", { text: group }),
      el("dl", {}, ...rows.flatMap(([k, what]) => [el("dt", {}, ...chord(k).split(" ").map((part) => el("kbd", { text: part }))), el("dd", { text: what })])))))
  d.addEventListener("click", (e) => { if (e.target === d) d.close() })
  d.addEventListener("close", () => d.remove())
  document.body.append(d)
  d.showModal()
}
document.addEventListener("keydown", (e) => {
  if (e.key !== "?" || e.ctrlKey || e.metaKey || e.altKey) return
  const t = e.target
  if (t.isContentEditable || t instanceof HTMLInputElement || t instanceof HTMLTextAreaElement || t instanceof HTMLSelectElement) return
  if (document.querySelector("dialog[open]")) return
  e.preventDefault()
  openKeys()
})
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
    Object.assign(S, { settings: b.settings, projects: b.projects, threads: b.threads, providers: b.providers, home: b.home, zeroRoot: b.zeroRoot, limits: b.limits ?? [] })
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
