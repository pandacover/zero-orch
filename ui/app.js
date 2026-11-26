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
const plural = (n, word) => `${n} ${word}${n === 1 ? "" : "s"}`
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
const MAC = /Mac|iPhone|iPad/.test(navigator.platform)
/** A key chord as this machine names it: "Ctrl K" here, "⌘K" on a Mac. */
const chord = (k) => MAC ? k.replace(/Ctrl ?/g, "⌘").replace(/Alt ?/g, "⌥").replace(/Shift ?/g, "⇧") : k
/** What last pressed: "mouse", "pen" or "touch". */
let lastPointer = "mouse"
addEventListener("pointerdown", (e) => { lastPointer = e.pointerType || "mouse" }, true)

// ---------- icons: 16px, 1.5 stroke, round ends ----------
const P = (d, extra = "") => `<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"${extra}>${d}</svg>`
const I = {
  sideL: P('<rect x="2" y="2.5" width="12" height="11" rx="2.5"/><path d="M6.25 2.5v11"/>'),
  sideR: P('<rect x="2" y="2.5" width="12" height="11" rx="2.5"/><path d="M9.75 2.5v11"/>'),
  compose: P('<path d="M13.5 8.75v3.5a1.75 1.75 0 0 1-1.75 1.75h-8A1.75 1.75 0 0 1 2 12.25v-8A1.75 1.75 0 0 1 3.75 2.5h3.5"/><path d="M11.4 2.35a1.45 1.45 0 0 1 2.05 2.05L8.6 9.25l-2.75.65.65-2.75z"/>'),
  gear: P('<circle cx="8" cy="8" r="2.1"/><path d="M6.9 1.75h2.2l.35 1.6a5 5 0 0 1 1.2.7l1.55-.5 1.1 1.9-1.2 1.1a5 5 0 0 1 0 1.4l1.2 1.1-1.1 1.9-1.55-.5a5 5 0 0 1-1.2.7l-.35 1.6H6.9l-.35-1.6a5 5 0 0 1-1.2-.7l-1.55.5-1.1-1.9 1.2-1.1a5 5 0 0 1 0-1.4l-1.2-1.1 1.1-1.9 1.55.5a5 5 0 0 1 1.2-.7z"/>'),
  keys: P('<rect x="1.75" y="3.75" width="12.5" height="8.5" rx="1.75"/><path d="M4.5 6.5h.01M7 6.5h.01M9.5 6.5h.01M12 6.5h-.5M5 9.5h6"/>'),
  settle: P('<circle cx="8" cy="8" r="5.75"/><path d="m5.6 8.15 1.65 1.65 3.2-3.5"/>'),
  unsettle: P('<path d="M5.75 4.25 3 7l2.75 2.75"/><path d="M3 7h6.75a3.25 3.25 0 0 1 0 6.5H8"/>'),
  stop: P('<rect x="4.25" y="4.25" width="7.5" height="7.5" rx="1.5" fill="currentColor" stroke="none"/>'),
  up: P('<path d="M8 13V3.5M4 7.25 8 3.25l4 4"/>', ' stroke-width="1.75"'),
  down: P('<path d="M8 3v9.5M4 8.75l4 4 4-4"/>'),
  clip: P('<path d="M13.25 7.4 8.1 12.55a3.35 3.35 0 0 1-4.75-4.75l5.6-5.6a2.25 2.25 0 0 1 3.2 3.2l-5.6 5.6a1.15 1.15 0 0 1-1.6-1.6l5.1-5.1"/>'),
  branch: P('<circle cx="4.5" cy="3.75" r="1.5"/><circle cx="4.5" cy="12.25" r="1.5"/><circle cx="11.5" cy="4.75" r="1.5"/><path d="M4.5 5.25v5.5M11.5 6.25v.25a2.75 2.75 0 0 1-2.75 2.75h-1.5A2.75 2.75 0 0 0 4.5 12"/>'),
  chevD: P('<path d="m4.5 6.25 3.5 3.5 3.5-3.5"/>'),
  chevR: P('<path d="m6.25 4.5 3.5 3.5-3.5 3.5"/>'),
  back: P('<path d="M12.5 8h-9M7.25 4.25 3.5 8l3.75 3.75"/>'),
  check: P('<path d="m3.5 8.5 3 3 6-7"/>'),
  ask: P('<path d="M8 1.75 13 3.6v3.9c0 3.15-2.1 5.55-5 6.75-2.9-1.2-5-3.6-5-6.75V3.6z"/><path d="M8 5.5v3M8 10.75h.01"/>'),
  alert: P('<path d="M7.13 2.75a1 1 0 0 1 1.74 0l5.4 9.5a1 1 0 0 1-.87 1.5H2.6a1 1 0 0 1-.87-1.5z"/><path d="M8 6.5v2.75M8 11.25h.01"/>'),
  pencil: P('<path d="M10.6 2.9a1.5 1.5 0 0 1 2.12 0l.38.38a1.5 1.5 0 0 1 0 2.12L6 12.5l-3.25.75L3.5 10z"/>'),
  spin: P('<path d="M8 2.25a5.75 5.75 0 1 0 5.75 5.75"/>'),
  search: P('<circle cx="7" cy="7" r="4.5"/><path d="M10.5 10.5 14 14"/>'),
  x: P('<path d="M4.25 4.25l7.5 7.5M11.75 4.25l-7.5 7.5"/>'),
  plus: P('<path d="M8 3.5v9M3.5 8h9"/>'),
  folder: P('<path d="M1.75 4.25a1 1 0 0 1 1-1h3.1l1.4 1.5h5.99a1 1 0 0 1 1 1v6.5a1 1 0 0 1-1 1H2.75a1 1 0 0 1-1-1z"/>'),
  folderPlus: P('<path d="M1.75 4.25a1 1 0 0 1 1-1h3.1l1.4 1.5h5.99a1 1 0 0 1 1 1v6.5a1 1 0 0 1-1 1H2.75a1 1 0 0 1-1-1z"/><path d="M8 7.25v3.5M6.25 9h3.5"/>'),
  file: P('<path d="M4 1.75h5l3 3v9.5H4z"/><path d="M9 1.75v3h3"/>'),
  term: P('<rect x="1.75" y="2.75" width="12.5" height="10.5" rx="2"/><path d="m4.75 6.25 2 1.75-2 1.75M8.5 10h3"/>'),
  diff: P('<path d="M4 1.75h5l3 3v9.5H4z"/><path d="M8 6.25v3M6.5 7.75h3M6.5 11.25h3"/>'),
  pr: P('<circle cx="4.5" cy="3.75" r="1.5"/><circle cx="4.5" cy="12.25" r="1.5"/><circle cx="11.5" cy="12.25" r="1.5"/><path d="M4.5 5.25v5.5M11.5 10.75V6.5a2 2 0 0 0-2-2H7.5M9 3 7.5 4.5 9 6"/>'),
  trash: P('<path d="M2.75 4.5h10.5M6.25 4.5V3h3.5v1.5M4.25 4.5l.6 8.6a1 1 0 0 0 1 .9h4.3a1 1 0 0 0 1-.9l.6-8.6"/>'),
  copy: P('<rect x="5.5" y="5.5" width="8" height="8" rx="1.5"/><path d="M10.5 5.5V3.75a1.25 1.25 0 0 0-1.25-1.25h-5.5A1.25 1.25 0 0 0 2.5 3.75v5.5a1.25 1.25 0 0 0 1.25 1.25H5.5"/>'),
  inbox: P('<path d="M1.75 8.5 3.5 3.25h9l1.75 5.25v3.75a1.5 1.5 0 0 1-1.5 1.5h-9.5a1.5 1.5 0 0 1-1.5-1.5z"/><path d="M1.75 8.5h3.5l1 1.75h3.5l1-1.75h3.5"/>'),
  evo: P('<path d="M2 12.5 6 8l3 3 5-6.5"/><path d="M10.5 4.5H14V8"/>'),
  open: P('<path d="M9.5 2.5h4v4M13.5 2.5 8 8M12 9.5v3a1 1 0 0 1-1 1H3.5a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1h3"/>'),
  code: P('<path d="m5.5 4.5-3.5 3.5 3.5 3.5M10.5 4.5l3.5 3.5-3.5 3.5M9 2.5 7 13.5"/>'),
  card: P('<rect x="1.75" y="3" width="12.5" height="10" rx="2"/><path d="M4.75 6.5h3.5M4.75 9.5h6.5"/>'),
  desktop: P('<rect x="1.75" y="2.5" width="12.5" height="8.5" rx="1.5"/><path d="M5.5 13.75h5M8 11v2.75"/>'),
  phone: P('<rect x="4.25" y="1.75" width="7.5" height="12.5" rx="1.75"/><path d="M7.25 11.75h1.5"/>'),
  link: P('<path d="M6.5 9.5 9.5 6.5M7 4.5l1.2-1.2a2.6 2.6 0 0 1 3.7 3.7L10.7 8.2M9 11.5l-1.2 1.2a2.6 2.6 0 0 1-3.7-3.7L5.3 7.8"/>'),
  pin: P('<path d="M9.5 2 14 6.5l-2 .5-2.5 2.5.5 3-1 1-3-3L3 13.5M5 9 2.5 6.5l1-1 3 .5L9 3.5z"/>'),
  zap: P('<path d="M8.75 1.75 3.5 9h4l-.75 5.25L12 7H8z"/>'),
  more: '<svg viewBox="0 0 16 16" fill="currentColor" aria-hidden="true"><circle cx="3.5" cy="8" r="1.25"/><circle cx="8" cy="8" r="1.25"/><circle cx="12.5" cy="8" r="1.25"/></svg>'
}
const svgEl = (html, cls = "") => el("span", { class: `ico ${cls}`.trim(), "aria-hidden": "true", html })

// ---------- state ----------
const S = {
  /** The sidebar's list: "inbox", "working" or "settled". It changes only when the person picks another. */
  view: "inbox",
  /** The thread's title is being renamed in the header. */
  renaming: false,
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
  expanded: new Set(), // tool items showing output
  route: { name: "home" },
  evo: null,
  /** The plan's usage windows as Claude last reported them ({ kind, status, used, resetsAt }). */
  limits: [],
  /** Each thread's session's slash commands (thread id → [{ name, description, hint }]), as its provider last said. */
  commands: new Map(),
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
  while (box.children.length >= 3) box.firstElementChild.remove()
  box.append(t)
  // Shown afresh so it lands above anything in the top layer (an open modal); put away when empty.
  if (box.matches(":popover-open")) box.hidePopover()
  box.showPopover()
  placeToasts()
  const ms = action ? 9000 : error ? 7000 : 3000
  let timer = setTimeout(close, ms)
  if (action) {
    t.addEventListener("pointerenter", () => clearTimeout(timer))
    t.addEventListener("pointerleave", () => { timer = setTimeout(close, 3000) })
  }
}
/**
 * Toasts sit in the bottom right corner, 8px in. Where the widest would cover the composer, they wait above it
 * instead; elsewhere they stay in the corner.
 */
function placeToasts() {
  const box = $("toasts")
  const col = document.querySelector(".dock > .col")
  let bottom = 8
  const w = box.offsetWidth
  if (col && w && col.offsetParent) {
    const c = col.getBoundingClientRect()
    if (c.right - 1 > innerWidth - 8 - w - 8) bottom = Math.round(innerHeight - c.top + 8)
  }
  document.documentElement.style.setProperty("--toast-bottom", `${bottom}px`)
}
addEventListener("resize", () => placeToasts())
/** The composer grows, an approval appears above it: toasts keep clear of it. */
const dockWatch = new ResizeObserver(() => placeToasts())
const watchDock = (node) => { dockWatch.disconnect(); dockWatch.observe(node); return node }
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

// ---------- tooltips: zero's own, not the browser's ----------
// Elements keep using `title`; on hover it moves to data-tip (so the native one never shows) and this one shows it.
// A manual popover: it shows in the top layer, so it stays above an open modal (Settings, a confirm).
// The first waits a moment (passing the pointer over a list shouldn't spray tips); once one has shown,
// the next shows at once while the pointer goes from one control to the next.
const tip = el("div", { class: "tip", role: "tooltip", popover: "manual" })
document.body.append(tip)
let tipFor = null
let tipTimer = 0
let tipHiddenAt = 0
const TIP_DELAY_MS = 320
const TIP_WARM_MS = 450
const tipShown = () => tip.matches(":popover-open")
const hideTip = () => {
  clearTimeout(tipTimer)
  if (tipShown()) { tip.hidePopover(); tipHiddenAt = performance.now() }
  tipFor = null
}
/** A tip's words, with a shortcut it ends in ("Stop (Esc)", "Search (Ctrl K)") drawn as keys. */
const KEYS_AT_END = /^([\s\S]*\S)\s+\(((?:Ctrl|Cmd|Shift|Alt|Option|Esc|Enter|Tab|Space|Backspace|Delete|[A-Z0-9?/,.\[\]⌘⇧⌥⌃↑↓←→]|[\s+])+)\)$/
function tipContent(text) {
  const m = KEYS_AT_END.exec(text)
  if (!m) return [text]
  return [el("span", { class: "tip-text", text: m[1] }),
    el("span", { class: "tip-keys" }, m[2].split(/\s*\+\s*|\s+/).filter(Boolean).map((k) => el("kbd", { text: k })))]
}
/** Move an element's title into data-tip, keeping it as the accessible name when it's the only one. */
function adoptTitle(n) {
  const text = n.getAttribute("title")
  n.removeAttribute("title")
  if (text === null) return
  n.dataset.tip = text
  if (text && !n.hasAttribute("aria-label") && !n.textContent.trim()) n.setAttribute("aria-label", text)
}
function showTip(n, warm = false) {
  clearTimeout(tipTimer)
  const text = n.dataset.tip
  if (!text || !n.isConnected) return hideTip()
  tipFor = n
  tip.replaceChildren(...tipContent(text))
  // Going from one tip to the next, it moves without easing in again.
  tip.classList.toggle("warm", warm)
  // Shown afresh each time so it lands above anything that opened in the top layer since.
  if (tipShown()) tip.hidePopover()
  tip.showPopover()
  const r = n.getBoundingClientRect()
  const w = tip.offsetWidth
  const h = tip.offsetHeight
  let x = Math.max(8, Math.min(r.left + r.width / 2 - w / 2, innerWidth - w - 8))
  const below = r.bottom + 8
  const above = below + h > innerHeight - 8
  const y = above ? r.top - h - 8 : below
  tip.dataset.side = above ? "top" : "bottom"
  // The desktop window's minimize, maximize and close buttons are drawn over the page's top right, above
  // everything it shows: a tip that would reach under them moves left of them.
  const wco = navigator.windowControlsOverlay
  if (wco?.visible) {
    const bar = wco.getTitlebarAreaRect()
    const edge = bar.x + bar.width
    if (y < bar.y + bar.height && x + w > edge - 8) x = Math.max(8, edge - w - 8)
  }
  tip.style.left = `${x}px`
  tip.style.top = `${y}px`
}
document.addEventListener("pointerover", (e) => {
  // A finger has no hover: a tap would leave a tip standing over what it opened.
  if (e.pointerType === "touch") return
  const n = e.target.closest?.("[title], [data-tip]")
  if (!n) return hideTip()
  if (n.hasAttribute("title")) adoptTitle(n)
  if (n === tipFor) return // shown, or about to be
  const warm = tipShown() || performance.now() - tipHiddenAt < TIP_WARM_MS
  hideTip()
  tipFor = n
  if (warm) return void showTip(n, true)
  tipTimer = setTimeout(() => { if (tipFor === n) showTip(n) }, TIP_DELAY_MS)
})
document.addEventListener("pointerout", (e) => { if (tipFor && !tipFor.contains(e.relatedTarget)) hideTip() })
for (const type of ["pointerdown", "keydown", "wheel"]) document.addEventListener(type, hideTip, true)
addEventListener("scroll", hideTip, true)
// A title set while the page runs (Copy → Copied, a chip's new name) moves over too, and updates a tip that's showing.
new MutationObserver((records) => {
  for (const r of records) {
    if (!r.target.hasAttribute("title")) continue
    adoptTitle(r.target)
    if (r.target === tipFor && tipShown()) showTip(r.target, true)
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
    actions.filter((a) => !a.disabled).map((a) => el("button", { class: `sheet-item${a.danger ? " danger" : ""}`, type: "button", onclick: () => { close(); a.run() } }, a.label))),
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
/** `anchor`: the button that opened it, if one did; the menu then opens left of `x` (the button's right edge). */
function contextMenu(x, y, title, actions, anchor = null, align = "end") {
  ctxMenu?.close()
  const back = document.activeElement
  const m = el("div", { class: "ctx-menu", role: "menu", "aria-label": title, popover: "auto" },
    actions.map((a) => el("button", { class: `ctx-item${a.danger ? " danger" : ""}`, type: "button", role: "menuitem", tabindex: -1, disabled: a.disabled,
      // An icon column only when some item has an icon.
      onclick: () => { close(); a.run() } }, a.icon ? icon(a.icon) : actions.some((b) => b.icon) ? el("span", { class: "ico" }) : null, el("span", { class: "ctx-label", text: a.label }),
      a.kbd && !touchFirst.matches ? el("span", { class: "k", text: chord(a.kbd) }) : null)))
  /** Put away: by a pick, a key, or the browser's light dismiss (a click elsewhere). Safe to run twice. */
  const close = () => {
    if (!m.isConnected) return
    if (m.matches(":popover-open")) m.hidePopover()
    removeEventListener("blur", close)
    removeEventListener("resize", close)
    removeEventListener("scroll", close, true)
    m.remove()
    anchor?.setAttribute("aria-expanded", "false")
    if (ctxMenu?.node === m) ctxMenu = null
    // Back to where focus was, unless a click put it somewhere else since.
    if (!document.activeElement || document.activeElement === document.body) back?.focus?.({ preventScroll: true })
  }
  m.addEventListener("toggle", (e) => { if (e.newState === "closed") close() })
  m.addEventListener("keydown", (e) => {
    if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); close(); return }
    const items = [...m.querySelectorAll(".ctx-item:not(:disabled)")]
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
  m.style.left = `${Math.max(6, anchor ? (align === "start" ? Math.min(x, innerWidth - w - 6) : x - w) : x + w > innerWidth - 6 ? x - w : x)}px`
  // Under a button: flipped above it (not over it) where below would leave the window.
  const above = anchor ? anchor.getBoundingClientRect().top - 4 - h : y - h
  m.style.top = `${Math.max(6, y + h > innerHeight - 6 ? above : y)}px`
  if (anchor) anchor.setAttribute("aria-expanded", "true")
  addEventListener("blur", close)
  addEventListener("resize", close)
  addEventListener("scroll", close, true)
  m.querySelector(".ctx-item:not(:disabled)")?.focus({ preventScroll: true })
  ctxMenu = { node: m, close, anchor }
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
  S.renaming = false
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

/// ---------- sidebar: what needs you, what's working, what's settled ----------
/**
 * Whether the person is done with a thread for now (src/app/Model.ts, isSettled): said so, or a thread from
 * before settling whose ended turn they've seen.
 */
const isSettled = (t) => t.settled ?? !t.unseen
/**
 * Where a thread stands: "ask" (waiting for an approval), "working", "failed" or "done" (its last turn ended
 * so), "new" (nothing has run yet), or "settled". A running thread is never settled.
 */
const stateOf = (t) => {
  if (t.status === "running") return S.asking.has(t.id) ? "ask" : "working"
  if (isSettled(t)) return "settled"
  if (t.unseen === "failed" || t.ended === "failed") return "failed"
  if (t.unseen || t.ended) return "done"
  return "new"
}
/** A turn ended that the person hasn't looked at: the thread on screen is seen as it ends. */
const unread = (t) => !!t.unseen && S.open?.id !== t.id
/** The order of the inbox: approvals, then errors, then finished turns, then new threads and drafts. */
const INBOX_RANK = { ask: 0, failed: 1, done: 2, new: 3, settled: 3 }
const projectName = (id) => S.projects.find((p) => p.id === id)?.name ?? ""
const hasDraft = (t) => drafts.has(`t:${t.id}`)

/**
 * The three lists, as rows: { key, t?, draft?, href, rank, at }. The inbox holds what needs you and every
 * thread with unsent words (a settled one too); Working, what's running; Settled, the rest.
 */
function lists() {
  const inbox = [], working = [], settled = []
  for (const t of S.threads) {
    const st = stateOf(t)
    const at = t.updatedAt
    if (st === "working") working.push({ key: t.id, t, href: `#/t/${t.id}`, rank: 0, at })
    else if (st === "ask" || st !== "settled" || hasDraft(t)) inbox.push({ key: t.id, t, href: `#/t/${t.id}`, rank: hasDraft(t) && st === "settled" ? 3 : INBOX_RANK[st], at: hasDraft(t) && st === "settled" ? drafts.get(`t:${t.id}`).at : at })
    else settled.push({ key: t.id, t, href: `#/t/${t.id}`, rank: 0, at })
  }
  // A new thread's unsent words: a row of its own, back to its project's start page.
  for (const [key, d] of drafts) {
    if (!key.startsWith("new:")) continue
    const pid = key.slice(4)
    if (!S.projects.some((p) => p.id === pid)) { drafts.delete(key); continue }
    inbox.push({ key, draft: { key, pid, ...d }, href: `#/new/${pid}`, rank: 3, at: d.at })
  }
  const order = (a, b) => a.rank - b.rank || Number(Boolean(b.t?.pinned)) - Number(Boolean(a.t?.pinned)) || b.at.localeCompare(a.at)
  return { inbox: inbox.sort(order), working: working.sort(order), settled: settled.sort(order) }
}

/** The mark at the end of a row: what the thread needs, or that it's working. */
function markFor(row) {
  const mk = (cls, tip, html = "") => el("span", { class: `mark ${cls}`, title: tip, html })
  if (row.draft) return mk("draft", "Unsent message", I.pencil)
  const t = row.t, st = stateOf(t)
  if (st === "ask") return mk("ask", "Waiting for your approval", I.ask)
  if (st === "working") return mk("run", "Working", I.spin)
  if (st === "failed" && t.unseen) return mk("failed", "Stopped on an error", I.alert)
  if (st === "failed") return mk("failed", "Its last turn stopped on an error", I.alert)
  if (unread(t)) return mk("unread", "Finished: not read yet")
  if (hasDraft(t)) return mk("draft", "Unsent message", I.pencil)
  return el("span", { class: "mark" })
}
/** The one action a row offers on hover, in its age's place: stop, bring back, discard a draft, or settle. */
function rowAction(row) {
  if (row.draft) return { icon: I.x, tip: "Discard draft", run: () => discardDraft(row.draft.key) }
  const t = row.t, st = stateOf(t)
  if (st === "working" || st === "ask") return { icon: I.stop, tip: "Stop", run: () => api("POST", `threads/${t.id}/stop`, {}).catch(fail) }
  if (st === "settled" && hasDraft(t)) return { icon: I.x, tip: "Discard draft", run: () => discardDraft(`t:${t.id}`) }
  if (st === "settled") return { icon: I.unsettle, tip: "Back to the inbox", run: () => unsettle(t) }
  return { icon: I.settle, tip: "Settle", kbd: "Alt S", run: (item) => settle(t, item) }
}
/** Settle a thread: it goes to Settled until a new message brings it back. Undo is a toast away. */
function settle(t, item = null) {
  if (t.status === "running") return
  const doIt = () => {
    patchMeta(t.id, { settled: true, unseen: undefined })
    renderSide()
    api("PATCH", `threads/${t.id}`, { settled: true }).then(
      () => toast(`Settled “${t.title}”`, false, { action: { label: "Undo", run: () => unsettle(t, false) } }),
      (e) => { patchMeta(t.id, { settled: false }); renderSide(); fail(e) })
  }
  if (item && !reduced) { item.classList.add("leaving"); setTimeout(doIt, 160) } else doIt()
}
function unsettle(t, say = true) {
  patchMeta(t.id, { settled: false })
  renderSide()
  api("PATCH", `threads/${t.id}`, { settled: false }).then(() => { if (say) toast(`“${t.title}” is back in the inbox`) }, fail)
}
/** Change a thread's meta here at once (the server's thread event confirms it). `undefined` removes a field. */
function patchMeta(id, patch) {
  for (const m of [S.threads.find((x) => x.id === id), S.open?.id === id ? S.open : null]) {
    if (!m) continue
    for (const [k, v] of Object.entries(patch)) if (v === undefined) delete m[k]; else m[k] = v
  }
}

/** A row's first line: its project, the thread that started it, its pull request, and a pin if it's pinned. */
function rowWhere(row) {
  if (row.draft) return [projectName(row.draft.pid), " · new thread"]
  const t = row.t
  const parent = t.parentId ? threadMeta(t.parentId) : null
  return [
    t.pinned ? el("span", { class: "pin", html: I.pin, title: "Pinned" }) : null,
    projectName(t.projectId) || "removed project",
    parent ? ` · ↳ ${parent.title}` : "",
    t.pr ? ` · #${t.pr.number}` : ""
  ]
}
function rowNode(row) {
  const t = row.t
  const active = t ? S.open?.id === t.id : location.hash === row.href
  const working = t && t.status === "running" && !S.asking.has(t.id)
  const item = el("div", { class: "item", role: "listitem", "data-key": row.key })
  const tip = t ? [`${projectName(t.projectId)} / ${t.title}`, t.parentId ? `Started by “${threadMeta(t.parentId)?.title ?? "another thread"}”` : "", t.pr ? `PR #${t.pr.number} · ${PR_STATE_LABEL[String(t.pr.state).toLowerCase()] ?? t.pr.state}` : ""].filter(Boolean).join("\n")
    : `New thread in ${projectName(row.draft.pid)}: ${row.draft.title}`
  const link = el("a", { class: `row${active ? " active" : ""}${t && unread(t) ? " unread" : ""}`, href: row.href, "aria-current": active ? "page" : null, title: tip },
    el("span", { class: "p" }, ...rowWhere(row).filter(Boolean)),
    working ? el("span", { class: "age", "data-since": t.updatedAt, text: elapsed(t.updatedAt) }) : el("span", { class: "age", text: ago(row.at) }),
    el("span", { class: "t", text: t ? t.title : row.draft.title }),
    markFor(row))
  item.append(link)
  const act = rowAction(row)
  if (act) {
    const b = el("button", { class: "ib row-act", type: "button", "aria-label": `${act.tip}: ${t ? t.title : row.draft.title}`, "data-tip": act.tip, "data-kbd": act.kbd ?? null, html: act.icon })
    b.addEventListener("click", (e) => { e.preventDefault(); act.run(item) })
    item.append(b)
  }
  return held(item, () => t ? threadMenu(t) : { title: row.draft.title, actions: [{ label: "Discard draft", icon: I.trash, danger: true, run: () => discardDraft(row.draft.key) }] })
}
const EMPTY = {
  inbox: () => S.projects.length
    ? [I.inbox, "Nothing needs you", "Threads show here when they finish, ask before running something, or stop on an error."]
    : [I.folder, "No projects yet", "Your threads show here once you've added a folder for zero to work in."],
  working: () => [I.spin, "Nothing running", "Threads show here while zero works on them."],
  settled: () => [I.settle, "Nothing settled yet", "Settle a thread when you're done with it. A new message brings it back."]
}
/** What the list last drew: an event that changes nothing in it doesn't redraw it. */
let listSig = ""
function renderSide() {
  const all = lists()
  const rows = all[S.view]
  // The window's title counts what needs you, so the taskbar says so while you're elsewhere.
  const waiting = S.threads.filter((t) => { const st = stateOf(t); return st === "ask" || (t.unseen && S.open?.id !== t.id) }).length
  document.title = waiting ? `(${waiting}) zero` : "zero"
  renderNav(all)
  const list = $("list")
  const sig = [S.view, S.open?.id ?? location.hash, ...rows.map((r) => {
    const t = r.t
    return t ? `${t.id}:${stateOf(t)}:${unread(t) ? 1 : 0}:${t.title}:${hasDraft(t) ? 1 : 0}:${t.pinned ? 1 : 0}:${t.pr?.number ?? ""}:${t.parentId ? threadMeta(t.parentId)?.title : ""}:${projectName(t.projectId)}:${ago(r.at)}`
      : `${r.key}:${r.draft.title}:${ago(r.at)}`
  })].join("|")
  if (sig === listSig) return tickSide()
  listSig = sig
  const focusKey = document.activeElement?.closest?.(".item")?.dataset.key
  const focusAct = document.activeElement?.classList.contains("row-act")
  const top = list.scrollTop
  if (!rows.length) {
    const [glyph, head, words] = EMPTY[S.view]()
    list.replaceChildren(el("div", { class: "list-empty" }, svgEl(glyph), el("b", { text: head }), el("span", { text: words }),
      !S.projects.length && S.view === "inbox" ? el("button", { class: "btn sm", type: "button", onclick: addProject, html: `${I.folderPlus}Add project` }) : null))
  } else list.replaceChildren(...rows.map(rowNode))
  list.scrollTop = top
  if (focusKey) {
    const n = [...list.querySelectorAll(".item")].find((x) => x.dataset.key === focusKey)
    ;(focusAct ? n?.querySelector(".row-act") : n?.querySelector(".row"))?.focus({ preventScroll: true })
  }
  const head = $("list-head")
  head.hidden = S.view === "inbox"
  if (S.view !== "inbox") {
    head.replaceChildren(
      el("button", { class: "ib", type: "button", "aria-label": "Back to the inbox", "data-tip": "Back to the inbox", "data-kbd": "Alt 1", html: I.back, onclick: () => setView("inbox") }),
      el("b", { text: S.view === "working" ? "Working" : "Settled" }),
      el("span", { class: "n", text: String(rows.length) }))
  }
  scrollEdges()
}
/** The working rows' clocks, each second. */
function tickSide() {
  for (const n of document.querySelectorAll("#list .age[data-since]")) n.textContent = elapsed(n.dataset.since)
}
setInterval(tickSide, 1000)
let sideTimer = 0
/** One repaint for a burst of keystrokes (a draft's words change the list). */
const renderSideSoon = () => { if (!sideTimer) sideTimer = setTimeout(() => { sideTimer = 0; renderSide() }, 30) }
const paintDraftsSoon = renderSideSoon
const paintDrafts = renderSide
/** Hairlines above and below the list show only while there's more that way. */
function scrollEdges() {
  const list = $("list"), side = $("side")
  side.classList.toggle("more-above", list.scrollTop > 1)
  side.classList.toggle("more-below", list.scrollTop + list.clientHeight < list.scrollHeight - 1)
}
$("list").addEventListener("scroll", scrollEdges, { passive: true })
new ResizeObserver(scrollEdges).observe($("list"))
function renderNav(all = lists()) {
  const w = all.working.length, s = all.settled.length
  const nw = $("nav-working"), ns = $("nav-settled")
  nw.querySelector(".n").textContent = w ? String(w) : ""
  ns.querySelector(".n").textContent = s ? String(s) : ""
  nw.classList.toggle("live", w > 0)
  nw.setAttribute("aria-pressed", String(S.view === "working"))
  ns.setAttribute("aria-pressed", String(S.view === "settled"))
  nw.dataset.tip = S.view === "working" ? "Back to the inbox" : `${plural(w, "thread")} running`
  ns.dataset.tip = S.view === "settled" ? "Back to the inbox" : "Threads you're done with"
  nw.dataset.kbd = S.view === "working" ? "Alt 1" : "Alt 2"
  ns.dataset.kbd = S.view === "settled" ? "Alt 1" : "Alt 3"
  const evo = $("nav-evo")
  evo.classList.toggle("active", S.route.name === "evolution")
  if (S.route.name === "evolution") evo.setAttribute("aria-current", "page"); else evo.removeAttribute("aria-current")
}
/** Show one of the lists. Picking the one that's showing (other than the inbox) goes back to the inbox. */
function setView(v) {
  S.view = S.view === v && v !== "inbox" ? "inbox" : v
  listSig = ""
  renderSide()
  $("list").scrollTop = 0
  scrollEdges()
}
$("nav-working").addEventListener("click", () => setView("working"))
$("nav-settled").addEventListener("click", () => setView("settled"))
/** The thread before or after `id` in the list on show (by `d`), or null. */
function neighbour(id, d) {
  const ids = lists()[S.view].filter((r) => r.t).map((r) => r.t.id)
  const i = ids.indexOf(id)
  if (i < 0) return ids[d > 0 ? 0 : ids.length - 1] ?? null
  return ids[i + d] ?? null
}

/** `node`, with `open` on a long press or right-click. */
const held = (node, open) => { onHold(node, open); return node }
const pinThread = (t) => api("PATCH", `threads/${t.id}`, { pinned: !t.pinned }).catch(fail)
/** What a right-click or long press on a thread offers (and the header's title menu). */
const threadMenu = (t) => {
  const st = stateOf(t)
  const project = S.projects.find((p) => p.id === t.projectId)
  const dir = threadDir(t, project)
  return { title: t.title, actions: [
    { label: "Rename", icon: I.pencil, kbd: "F2", run: () => { if (S.open?.id !== t.id) { S.renameNext = t.id; go(`#/t/${t.id}`) } else startRename() } },
    st === "settled" ? { label: "Back to the inbox", icon: I.unsettle, run: () => unsettle(t) }
      : { label: "Settle", icon: I.settle, kbd: "Alt S", disabled: t.status === "running", run: () => settle(t) },
    t.status === "running" ? { label: "Stop", icon: I.stop, run: () => api("POST", `threads/${t.id}/stop`, {}).catch(fail) } : null,
    { label: t.pinned ? "Unpin" : "Pin to the top", icon: I.pin, run: () => pinThread(t) },
    hasDraft(t) ? { label: "Discard draft", icon: I.x, run: () => discardDraft(`t:${t.id}`) } : null,
    t.branch ? { label: "Copy branch name", icon: I.branch, run: () => copyText(t.branch, "Branch name copied.") } : null,
    { label: "Copy thread ID", icon: I.copy, run: () => copyText(t.id, "Thread ID copied.") },
    DESKTOP && dir ? { label: "Open in VS Code", icon: I.code, run: () => openOut(vscodeUrl(dir)) } : null,
    DESKTOP && dir ? { label: "Show folder", icon: I.folder, run: () => openOut(folderUrl(dir)) } : null,
    { label: "Delete thread…", icon: I.trash, danger: true, run: () => deleteThread(t) }
  ].filter(Boolean) }
}
/** Put `text` on the clipboard, and say so. */
async function copyText(text, said = "Copied.") {
  try {
    await navigator.clipboard.writeText(text)
    toast(said)
  } catch { toast("Couldn't copy: the browser blocked the clipboard.", true) }
}
/** The thread's pull request's state, in words. */
const PR_STATE_LABEL = { open: "Open", draft: "Draft", merged: "Merged", closed: "Closed" }
/** A search snippet as text, its matched words (between \u0002 and \u0003) in <mark>: built as nodes, never as HTML. */
function marked(snippet) {
  return snippet.split("\u0002").flatMap((part, i) => {
    if (i === 0) return [part]
    const [hit, rest = ""] = part.split("\u0003")
    return [el("mark", { text: hit }), rest]
  })
}
async function deleteThread(t) {
  if (!(await dialog({ title: "Delete this thread?", text: "Its messages are deleted from zero. Changes it made to the project stay.", ok: "Delete thread" }))) return
  try {
    await api("DELETE", `threads/${t.id}`)
    if (S.open?.id === t.id) go("#/")
  } catch (e) { fail(e) }
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
  hideTip()
  ctxMenu?.close()
  liveBox = null
  if (r.name === "thread" && S.open) {
    main.replaceChildren(...threadView(S.open))
    if (S.jump) { const id = S.jump; S.jump = null; requestAnimationFrame(() => jumpTo(id)) }
    if (S.renameNext === S.open.id) { S.renameNext = null; startRename() }
  } else {
    // Off a thread, its Git panel goes (and stops looking).
    feed?.io?.disconnect()
    feed = null
    emptyPanel()
    if (r.name === "evolution") main.replaceChildren(headBar(el("span", { class: "seg title" }, el("span", { text: "Evolution" }))), evolutionView())
    else main.replaceChildren(...startView(S.projects.find((p) => p.id === r.projectId) ?? S.projects[0]))
  }
  applyShell()
}
// ---------- the shell: the sidebar, the thread, the Changes panel, and the thread's details card ----------
/** Below 640px (a phone over remote access) the sidebar lies over the thread; below 1100px the Changes panel does. */
const narrow = matchMedia("(max-width: 639px)")
const mid = matchMedia("(max-width: 1099px)")
const app = $("app")
S.sideOpen = narrow.matches ? false : !load("sideHidden", false)
S.panelOpen = mid.matches ? false : load("gitOpen", false)
/** The widths the person chose (kept), and the ones the window has room for now (S.sideW, S.panelW). */
S.sideWant = load("sideWidth", 264)
S.panelWant = load("gitWidth", 340)
S.sideW = S.sideWant
S.panelW = S.panelWant
S.infoOpen = load("infoOpen", true)
/** The card over a narrow thread: opened on purpose there, never kept. */
S.infoOver = false
/** How wide a scrollbar is here (0 where they lie over the page): the feed keeps that room on both sides, and so does the dock. */
{
  const probe = el("div", { style: "position:absolute;top:-999px;width:100px;height:50px;overflow-y:scroll;scrollbar-width:thin" })
  document.body.append(probe)
  document.documentElement.style.setProperty("--sbw", `${probe.offsetWidth - probe.clientWidth}px`)
  probe.remove()
}
/** The Changes panel shows anywhere but Evolution, once there's a project. */
const panelAllowed = () => S.route.name !== "evolution" && S.projects.length > 0
const gitOpenNow = () => S.panelOpen && panelAllowed()
function setSide(open, persist = true) {
  S.sideOpen = open
  if (persist && !narrow.matches) save("sideHidden", !open)
  if (open && narrow.matches) S.panelOpen = false
  clampWidths()
  applyShell()
  sideResized()
}
const toggleSide = () => setSide(!S.sideOpen)
const openSide = () => setSide(true, false)
/** On a phone, a pick in the sidebar puts it away. */
function closeSide() { if (narrow.matches && S.sideOpen) setSide(false, false) }
function setPanel(open, persist = true) {
  S.panelOpen = open
  if (persist && !mid.matches) save("gitOpen", open)
  if (open && narrow.matches) S.sideOpen = false
  clampWidths()
  applyShell()
  // Look again once it has slid open: repainting its content mid-slide would stall the animation.
  if (open && gitPanel && Date.now() - gitPanel.at > 10_000) setTimeout(loadGit, 260)
}
const setGitOpen = setPanel
function applyShell() {
  const allowed = panelAllowed()
  const panel = S.panelOpen && allowed
  app.classList.toggle("side-closed", !S.sideOpen)
  app.classList.toggle("panel-open", panel)
  const root = document.documentElement
  root.style.setProperty("--side-w", `${S.sideW}px`)
  root.style.setProperty("--panel-w", `${S.panelW}px`)
  const l = $("side-toggle"), r = $("panel-toggle")
  l.setAttribute("aria-expanded", String(S.sideOpen))
  l.setAttribute("aria-label", S.sideOpen ? "Hide sidebar" : "Show sidebar")
  l.dataset.tip = S.sideOpen ? "Hide sidebar" : "Show sidebar"
  r.hidden = !allowed
  r.setAttribute("aria-expanded", String(panel))
  r.setAttribute("aria-label", panel ? "Hide changes" : "Show changes")
  r.dataset.tip = panel ? "Hide changes" : "Show changes"
  const over = (S.sideOpen && narrow.matches) || (panel && mid.matches)
  $("scrim").hidden = !over
  // What's off screen can't be tabbed into.
  $("side").inert = !S.sideOpen
  $("panel").inert = !panel
  paintGitToggle()
  layoutInfo()
  requestAnimationFrame(placeToasts)
}
$("side-toggle").innerHTML = I.sideL
$("panel-toggle").innerHTML = I.sideR
$("info-toggle").innerHTML = I.card
$("side-toggle").addEventListener("click", toggleSide)
$("panel-toggle").addEventListener("click", () => setPanel(!gitOpenNow()))
$("info-toggle").addEventListener("click", () => toggleInfo())
$("scrim").addEventListener("click", () => { if (narrow.matches) setSide(false, false); if (mid.matches) setPanel(false, false) })
const onBreakpoint = () => {
  S.sideOpen = narrow.matches ? false : !load("sideHidden", false)
  S.panelOpen = mid.matches ? false : load("gitOpen", false)
  clampWidths()
  applyShell()
}
narrow.addEventListener("change", onBreakpoint)
mid.addEventListener("change", onBreakpoint)
// On a phone, a tap on a thread puts the sidebar away, the one already open too (that tap changes no route).
$("list").addEventListener("click", (e) => { if (narrow.matches && !e.defaultPrevented && e.target.closest("a[href]")) closeSide() })
$("new-btn").innerHTML = I.compose
$("new-btn").addEventListener("click", () => newThread())
$("brand").addEventListener("click", (e) => { e.preventDefault(); newThread() })
$("open-settings").innerHTML = I.gear
$("open-keys").innerHTML = I.keys

// ---------- widths: both handles, by pointer or arrow keys; double-click resets. The thread keeps at least 420px. ----------
const LIM = { side: [208, 420, 264], panel: [280, 560, 340] }
function clampWidths() {
  const room = innerWidth - 420
  S.sideW = Math.round(Math.max(LIM.side[0], Math.min(S.sideWant, LIM.side[1], room - (S.panelOpen && !mid.matches ? S.panelWant : 0))))
  S.panelW = Math.round(Math.max(LIM.panel[0], Math.min(S.panelWant, LIM.panel[1], mid.matches ? innerWidth - 40 : room - (S.sideOpen ? S.sideW : 0))))
}
function sideResized() { if (S.route.name === "evolution" && S.evo) paintEvo() }
function wireResize(handle, which) {
  const set = (w, persist = true) => {
    if (which === "side") S.sideWant = w; else S.panelWant = w
    clampWidths()
    // What the window had room for is what's kept: a drag past the limit doesn't remember the overshoot.
    if (which === "side") S.sideWant = S.sideW; else S.panelWant = S.panelW
    applyShell()
    handle.setAttribute("aria-valuenow", String(which === "side" ? S.sideW : S.panelW))
    if (persist) save(which === "side" ? "sideWidth" : "gitWidth", which === "side" ? S.sideW : S.panelW)
  }
  handle.setAttribute("aria-valuemin", String(LIM[which][0]))
  handle.setAttribute("aria-valuemax", String(LIM[which][1]))
  handle.addEventListener("pointerdown", (e) => {
    if (e.button !== 0) return
    e.preventDefault()
    handle.setPointerCapture(e.pointerId)
    handle.classList.add("dragging")
    document.body.classList.add("resizing")
    const at = (ev) => which === "side" ? ev.clientX - $("side").getBoundingClientRect().left : innerWidth - ev.clientX
    const move = (ev) => set(at(ev), false)
    const up = (ev) => {
      handle.removeEventListener("pointermove", move)
      handle.removeEventListener("pointerup", up)
      handle.removeEventListener("pointercancel", up)
      handle.classList.remove("dragging")
      document.body.classList.remove("resizing")
      set(at(ev))
      sideResized()
    }
    handle.addEventListener("pointermove", move)
    handle.addEventListener("pointerup", up)
    handle.addEventListener("pointercancel", up)
  })
  handle.addEventListener("dblclick", () => { set(LIM[which][2]); sideResized() })
  handle.addEventListener("keydown", (e) => {
    const step = e.shiftKey ? 48 : 16
    const now = which === "side" ? S.sideW : S.panelW
    const grow = which === "side" ? 1 : -1
    const next = { ArrowLeft: now - step * grow, ArrowRight: now + step * grow, Home: LIM[which][0], End: LIM[which][1] }[e.key]
    if (next === undefined) return
    e.preventDefault()
    set(next)
    sideResized()
  })
}
wireResize($("side-resize"), "side")
wireResize($("panel-resize"), "panel")
addEventListener("resize", () => { clampWidths(); applyShell() })

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

// ---------- touch, on a phone: the sidebar follows a finger, out from the left edge and back ----------
{
  const side = $("side")
  const scrim = $("scrim")
  let drag = null // { x, y, from: "edge" | "side", axis: "" | "x" | "y", dx }
  const width = () => side.getBoundingClientRect().width
  const land = (open) => {
    side.classList.remove("dragging")
    side.style.transform = ""
    scrim.style.opacity = ""
    setSide(open, false)
  }
  addEventListener("touchstart", (e) => {
    drag = null
    if (!narrow.matches || e.touches.length !== 1 || document.querySelector("dialog[open]")) return
    const t = e.touches[0]
    if (!S.sideOpen && t.clientX <= 22) drag = { x: t.clientX, y: t.clientY, from: "edge", axis: "", dx: 0 }
    else if (S.sideOpen && (side.contains(e.target) || e.target === scrim)) drag = { x: t.clientX, y: t.clientY, from: "side", axis: "", dx: 0 }
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
      side.inert = false
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
    land(from === "edge" ? dx > width() * 0.3 : dx > -width() * 0.3)
  }
  addEventListener("touchend", end)
  addEventListener("touchcancel", end)
}

// ---------- the thread's details card ----------
/*
 * A card at the top right of a thread: where it works, where it was started from, and what it runs with.
 * Its toggle sits left of the Changes toggle. Opening Changes hides it (they share the right side); its toggle
 * then brings the card back and closes Changes. Where the thread is wide enough the column moves over to make
 * room; where it isn't, the card lies over the thread and starts closed.
 */
const INFO_ROOM = 832
const INFO_W = 264
const infoDocked = () => $("main").clientWidth >= INFO_ROOM
const infoWanted = () => infoDocked() ? S.infoOpen : S.infoOver
function layoutInfo() {
  const t = S.route.name === "thread" ? S.open : null
  const shown = !!t && infoWanted() && !gitOpenNow()
  const card = $("info"), btn = $("info-toggle")
  app.classList.toggle("has-info", !!t)
  btn.hidden = !t
  btn.setAttribute("aria-expanded", String(shown))
  btn.setAttribute("aria-label", shown ? "Hide details" : "Show details")
  btn.dataset.tip = shown ? "Hide details" : "Show details"
  // The column's room: just enough that its right edge clears the card, never more than the card takes.
  const W = $("main").clientWidth, take = INFO_W + 16
  const pad = shown && infoDocked() ? Math.max(0, Math.min(take, 720 + 32 + 2 * take - W)) : 0
  document.documentElement.style.setProperty("--info-pad", `${pad}px`)
  if (!card) return
  const was = !card.hidden
  card.hidden = !shown
  card.classList.toggle("over", !infoDocked())
  if (shown && !was) renderInfo()
}
function toggleInfo() {
  if (S.route.name !== "thread") return
  if (gitOpenNow()) { setPanel(false); if (infoDocked()) S.infoOpen = true; else S.infoOver = true }
  else if (infoDocked()) S.infoOpen = !S.infoOpen
  else S.infoOver = !S.infoOver
  save("infoOpen", S.infoOpen)
  layoutInfo()
}
new ResizeObserver(() => layoutInfo()).observe($("main"))
const stamp = (iso) => new Date(iso).toLocaleString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })
/** A folder's path, its last part apart from the rest: the end shows when a long one is cut. */
const splitPath = (path) => { const p = String(path).replace(/\\/g, "/"); const i = p.lastIndexOf("/"); return i < 0 ? ["", p] : [p.slice(0, i + 1), p.slice(i + 1)] }
/** What this thread has cost: its session's running total, as its provider reports it; else the sum of its turns. */
function costSoFar(t) {
  if (typeof t.sessionCostUsd === "number") return { usd: t.sessionCostUsd, sub: "this session" }
  const turns = (t.items ?? []).filter((i) => i.kind === "turn" && typeof i.costUsd === "number")
  return turns.length ? { usd: turns.reduce((s, i) => s + i.costUsd, 0), sub: "so far" } : null
}
/** Where the thread was started: this machine, a paired device, another thread, or (before zero kept it) not known. */
function originOf(t) {
  const o = t.origin
  if (o?.kind === "thread" || (!o && t.parentId)) return { glyph: I.link, name: t.parentId ? threadMeta(t.parentId)?.title ?? o?.device ?? "another thread" : o.device, sub: "its agent", href: t.parentId ? `#/t/${t.parentId}` : null }
  if (o?.kind === "remote") return { glyph: /iPhone|Android|iPad/.test(o.device) ? I.phone : I.desktop, name: o.device, sub: "remote access" }
  if (o?.kind === "local") return { glyph: I.desktop, name: o.device, sub: remote ? "" : "this computer" }
  return { glyph: I.desktop, name: "Not recorded", sub: "", none: true }
}
function renderInfo() {
  const card = $("info"), t = S.route.name === "thread" ? S.open : null
  if (!card || !t || card.hidden) return
  const project = S.projects.find((p) => p.id === t.projectId)
  const g = gitPanel?.threadId === t.id ? gitPanel.data : null
  const notGit = g && !g.repo
  const folder = threadDir(t, project)
  const [dir, leaf] = splitPath(folder)
  const from = originOf(t)
  const cost = costSoFar(t)
  const effort = effortsFor(t.provider, t.model).length ? effortLabel(t.provider, t.effort ?? defaultEffort(t.provider)) : ""
  const kids = S.threads.filter((x) => x.parentId === t.id)
  const pr = t.pr
  const sig = JSON.stringify([t.id, t.branch, notGit, folder, t.pr, t.origin, t.parentId, t.model, effort, t.access, cost?.usd, ago(t.createdAt), kids.map((k) => k.id + k.title), from.name])
  if (card.dataset.sig === sig) return
  card.dataset.sig = sig
  const row = (label, ...dd) => [el("dt", { text: label }), el("dd", {}, ...dd)]
  const v = (text, cls = "", title = text) => el("span", { class: `v ${cls}`.trim(), text, title })
  const sub = (text) => text ? el("span", { class: "sub", text }) : null
  card.replaceChildren(
    el("dl", {},
      ...row("Branch", svgEl(I.branch), notGit ? v("Not a git repository") : v(t.branch || g?.branch || "—", "mono")),
      ...row("Folder", svgEl(I.folder), el("span", { class: "v mono path", title: folder }, el("bdi", {}, el("span", { class: "dir", text: dir }), leaf || "—"))),
      ...(pr ? row("PR", svgEl(I.pr), v(`#${pr.number}`), sub(PR_STATE_LABEL[String(pr.state).toLowerCase()] ?? pr.state)) : [])),
    el("hr"),
    el("dl", {},
      ...row("From", svgEl(from.glyph), from.href ? el("a", { class: "v", href: from.href, text: from.name, title: `Open “${from.name}”` }) : v(from.name, from.none ? "none" : ""), sub(from.sub ? `· ${from.sub}` : "")),
      ...(kids.length ? row("Threads", svgEl(I.link), el("button", { class: "v linkish", type: "button", text: plural(kids.length, "thread"), title: kids.map((k) => k.title).join("\n"),
        onclick: () => actionSheet(`Started from “${t.title}”`, kids.map((k) => ({ label: `${k.status === "running" ? "● " : ""}${k.title}`, run: () => go(`#/t/${k.id}`) }))) })) : []),
      ...row("Started", v(stamp(t.createdAt), "", new Date(t.createdAt).toLocaleString()), sub(`· ${agoText(t.createdAt)}`)),
      ...row("Model", v(`${modelName(t.model)}${effort ? ` · ${effort}` : ""}`, "", `${providerLabel(t.provider)} · ${t.model}`)),
      ...row("Access", v(accessLabel(t.access), "", ACCESS.find(([a]) => a === t.access)?.[2] ?? "")),
      ...row("Cost", cost ? v(usd(cost.usd), "mono") : v("—"), cost ? sub(cost.sub) : null)))
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
  const trigger = el("button", { class: "mb pop-trigger", type: "button", "aria-haspopup": "dialog", "aria-expanded": "false" }, label)
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
  pop.trigger.id = "model"
  pop.trigger.append(svgEl(I.chevD, "chev"))
  // The model, then its effort: four bars filled to the level, and the level's name.
  const paintLabel = () => {
    const e = effortsFor(state.provider, state.model).length ? effortLabel(state.provider, state.effort) : ""
    pop.label.replaceChildren(el("span", { class: "mname", text: modelName(state.model) }), ...(e ? [effortGlyph(state.provider, state.effort), el("span", { class: "eff", text: e })] : []))
    pop.trigger.setAttribute("aria-label", `Model: ${providerLabel(state.provider)} ${modelName(state.model)}${e ? `, ${e} effort` : ""}, ${accessLabel(state.access)}`)
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
    const SHORT = { xhigh: "X-High", "": "Default" }
    pop.panel.replaceChildren(...[
      el("div", { class: "pop-col mp-models" },
        state.busy ? el("div", { class: "pop-note", text: "Models switch once this turn ends." }) : null,
        el("div", { class: "pop-scroll", role: "menu", "aria-label": "Model" }, groups)),
      // Effort: one control, the levels side by side.
      levels.length ? el("div", { class: "pop-col mp-effort" },
        el("div", { class: "pop-head", text: "Effort" }),
        el("div", { class: "seg-ctl", role: "group", "aria-label": "Effort" },
          levels.map(([v, l]) => el("button", { type: "button", "data-key": `effort/${v}`, "aria-pressed": String(v === state.effort), title: `${l} effort`, text: SHORT[v] ?? l, onclick: () => { if (v !== state.effort) save({ effort: v }) } }))),
        state.busy ? el("div", { class: "pop-note", text: "Applies from the next turn." }) : null) : null,
      // Permissions apply at once, even mid-turn.
      el("div", { class: "pop-col mp-access", role: "menu", "aria-label": "Permissions" },
        el("div", { class: "pop-head", text: "Permissions" }),
        ACCESS.map(([v, l, help]) => {
          const item = popItem({
            key: `access/${v}`, on: v === state.access, text: l, help,
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
/** An icon: its paths (drawn in zero's 16px frame), or a whole svg (one of I). */
const icon = (paths, cls = "") => el("span", { class: `ico ${cls}`.trim(), "aria-hidden": "true", html: paths.startsWith("<svg") ? paths : P(paths) })

/** The project picker for a new thread: the projects, and Add project. In the header and on the page. */
function projectMenu(anchor, current) {
  if (ctxMenu?.anchor === anchor) return ctxMenu.close()
  const r = anchor.getBoundingClientRect()
  const actions = [
    ...S.projects.map((p) => ({ label: p.name, icon: p.id === current?.id ? I.check : "", run: () => go(`#/new/${p.id}`) })),
    { label: "Add project…", icon: I.folderPlus, run: addProject }
  ]
  if (touchFirst.matches) return actionSheet("Project", actions)
  contextMenu(r.left, r.bottom + 6, "Project", actions, anchor, "start")
}

function startView(project) {
  if (!project) {
    return [headBar(el("span", { class: "seg title" }, el("span", { text: "New thread" }))),
      el("div", { class: "view" }, el("div", { class: "blank" }, el("div", { class: "blank-in" },
        el("h1", { text: "Add a project to start" }),
        el("p", { text: "A project is a folder on this machine. Threads in it can read, edit and run things there, and zero gets better at it every time it does." }),
        el("button", { class: "btn ink", type: "button", onclick: addProject, html: `${I.folderPlus}Add project` }))))]
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
  liveBox = box
  const readyFor = (p) => {
    box.setReady(status(p)?.available === true,
      status(p)?.available ? `Ask ${providerLabel(p)} to do something in ${project.name}. Type @ to point at a file.` : `${providerLabel(p)} is turned off in Settings`)
    box.setAttach(status(p)?.tools !== false, `${providerLabel(p)} can't open files`)
  }
  readyFor(first)
  const ready = status(first)?.available
  const list = el("div", { class: "suggest", role: "list" })
  const kinds = el("div", { class: "seg-ctl kinds", role: "tablist", "aria-label": "Kinds of things to ask" })
  const paintIdeas = () => {
    const kind = IDEAS.find(([k]) => k === ideaKind) ?? IDEAS[0]
    ideaKind = kind[0]
    kinds.replaceChildren(...IDEAS.map(([k, paths]) => el("button", {
      class: "kind", type: "button", role: "tab", "aria-selected": String(k === ideaKind), "aria-pressed": String(k === ideaKind),
      onclick: () => { ideaKind = k; save("ideaKind", k); paintIdeas() }
    }, icon(paths), k)))
    list.replaceChildren(...kind[2].map((idea) => el("button", { class: "suggest-item", type: "button", role: "listitem", onclick: () => box.fill(idea) }, idea)))
  }
  paintIdeas()
  const pick = (cls) => {
    const b = el("button", { class: cls, type: "button", "aria-haspopup": "menu", title: `${project.path}\nPick the project for the new thread` }, el("span", { text: project.name }), svgEl(I.chevD))
    b.addEventListener("click", () => projectMenu(b, project))
    return b
  }
  return [
    headBar(pick("seg proj"), el("span", { class: "sep", "aria-hidden": "true", text: "/" }), el("span", { class: "seg title" }, el("span", { text: "New thread" }))),
    el("div", { class: "view" }, el("div", { class: "blank" }, el("div", { class: "blank-in" },
      el("h1", { text: "What should zero work on?" }),
      el("p", { class: "where" }, "in", pick("pick")),
      el("p", { class: "mono", text: project.path }),
      el("p", { class: "lede", text: ready
        ? `${providerLabel(first)} ${accessText(S.settings.defaultAccess)}${S.settings.memory.recall ? ", and singularity hands it the most similar past change here." : "."}`
        : `${providerLabel(first)} is turned off. Turn it on in Settings to start a thread.` }),
      kinds,
      list))),
    watchDock(el("div", { class: "dock" }, el("div", { class: "col" }, el("div", { class: "above" }), box.node, box.meta))),
    dropZone()
  ]
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
  // A file (it has an extension) or a folder (it ends in a slash), as the @ menu puts them in.
  for (const m of text.matchAll(/(^|\s)@([\w.-]+(?:[/\\][\w.-]+)*(?:\.\w+|[/\\]))(?=\s|$|[,;:!?)])/g)) {
    const at = m.index + m[1].length
    if (at > last) out.push(text.slice(last, at))
    const path = m[2]
    out.push(mentionChip(path.replace(/\\/g, "/")))
    last = at + 1 + path.length
  }
  if (last < text.length) out.push(text.slice(last))
  return out
}
/**
 * A file or folder picked with @: its icon and name, the whole path on hover. A folder's path ends in a slash.
 * In the composer (`inComposer`) it can't be edited inside, and is sent as @path.
 */
function mentionChip(path, inComposer = false) {
  const dir = path.endsWith("/")
  const bare = dir ? path.slice(0, -1) : path
  const name = bare.slice(bare.lastIndexOf("/") + 1)
  return el("span", { class: `mention${dir ? " dir" : ""}`, title: path, ...(inComposer ? { contenteditable: "false", "data-path": path } : {}) },
    icon(dir ? FOLDER_PATHS : FILE_PATHS, "mention-ico"), el("span", { class: "mention-name", text: name }))
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
/** Settings › Send messages with: "enter", or "ctrl" (Ctrl+Enter sends, Enter makes a new line). Kept on this device. */
S.sendWith = load("sendWith", "enter")
const sendKey = () => (S.sendWith === "ctrl" ? chord("Ctrl Enter") : "Enter")
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
/**
 * How well an entry's path matches what was typed after @: its name first (exactly, then at its start, then
 * anywhere), then anywhere in its path; -1 if not at all. Shorter paths win a tie.
 */
function pathScore(path, q) {
  const p = path.toLowerCase()
  const base = p.slice(p.lastIndexOf("/") + 1)
  const s = base === q ? 4 : base.startsWith(q) ? 3 : base.includes(q) ? 2 : p.includes(q) ? 1 : -1
  return s < 0 ? -1 : s + 1 / (1 + path.length)
}
/** The files the project lists, and every folder they're in: [{ path, dir }], folders first. */
function pathEntries(files) {
  const dirs = new Set()
  for (const f of files) for (let i = f.indexOf("/"); i > 0; i = f.indexOf("/", i + 1)) dirs.add(f.slice(0, i))
  return [...[...dirs].sort().map((path) => ({ path, dir: true })), ...files.map((path) => ({ path, dir: false }))]
}
/** `text` with the first `q` in it marked, for the menu's names. */
function hitMarked(text, q) {
  const i = q ? text.toLowerCase().indexOf(q) : -1
  if (i < 0) return [text]
  return [text.slice(0, i), el("mark", { class: "mention-hit", text: text.slice(i, i + q.length) }), text.slice(i + q.length)]
}
const CHEVRON_SVG = '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="m6 4 4 4-4 4"/></svg>'

/**
 * The composer's menu for @ (a file or folder in the project, put in as `@path`, a folder's ending in a slash)
 * and / (one of `commands`, at the start of the box). Arrows move, Enter picks, Tab opens a folder to pick
 * inside it (or picks a file), Esc closes. With nothing typed after @, or a folder and a slash, it lists
 * that folder: its folders, then its files.
 */
function mentionMenu(input, { files, commands = [] }) {
  const pop = el("div", { class: "mention-pop", role: "listbox", hidden: true })
  pop.addEventListener("mousedown", (e) => e.preventDefault()) // keep the caret in the box
  let items = [], at = 0, match = null, entries = null, asked = 0
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
  const keys = (...pairs) => el("div", { class: "mention-foot" }, pairs.map(([k, what]) => el("span", {}, el("kbd", { text: k }), what)))
  const paint = () => {
    const rows = items.map((it, i) => {
      const b = el("button", { class: `mention-item${it.dir ? " dir" : ""}${i === at ? " on" : ""}`, type: "button", role: "option", "aria-selected": String(i === at), tabindex: "-1", onclick: () => pick(i) }, ...it.view)
      b.addEventListener("mousemove", () => { if (at !== i) { at = i; paint() } })
      return b
    })
    const isFiles = match?.kind === "file"
    const browsing = isFiles && match.browse !== undefined
    const head = isFiles ? el("div", { class: "mention-head" },
      browsing && match.browse ? [icon(FOLDER_PATHS, "mention-ico"), el("span", { class: "mention-crumb", text: `‎${match.browse}‎` })] : el("span", { text: browsing ? "Files and folders" : "Matching files and folders" })) : null
    const none = items.length ? null
      : el("div", { class: "mention-none", text: isFiles ? (entries ? (browsing ? "This folder is empty." : "Nothing in the project matches.") : "Looking through the project…") : "No command matches." })
    const dirOn = items[at]?.dir
    const foot = touchFirst.matches || !items.length ? null
      : isFiles ? keys(["↑↓", "move"], ["↵", dirOn ? "add folder" : "add"], ...(dirOn ? [["Tab", "open"]] : []), ["Esc", "close"])
      : keys(["↑↓", "move"], ["↵", "pick"], ["Esc", "close"])
    pop.classList.toggle("files", isFiles)
    pop.replaceChildren(...[head, el("div", { class: "mention-list" }, rows, none), foot].filter(Boolean))
    pop.hidden = false
    pop.querySelector(".mention-item.on")?.scrollIntoView({ block: "nearest" })
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
    const m = match, q = m.q, mine = ++asked
    // Nothing typed, or a folder and its slash: that folder's contents.
    if (q === "" || q.endsWith("/")) m.browse = q.slice(0, -1)
    if (!entries) {
      items = []
      paint()
      try { entries = pathEntries((await files()).files) } catch { entries = [] }
      if (mine !== asked || match !== m) return
    }
    const inside = (p) => m.browse === "" ? !p.includes("/") : p.startsWith(`${m.browse}/`) && !p.slice(m.browse.length + 1).includes("/")
    const found = m.browse !== undefined
      ? entries.filter((e) => inside(e.path.toLowerCase()))
        .sort((a, b) => (b.dir - a.dir) || a.path.localeCompare(b.path, undefined, { sensitivity: "base" })).slice(0, 200)
      : entries.map((e) => [e, pathScore(e.path, q)]).filter(([, sc]) => sc >= 0).sort((a, b) => b[1] - a[1]).slice(0, 50).map(([e]) => e)
    const hit = m.browse !== undefined ? "" : q.slice(q.lastIndexOf("/") + 1)
    items = found.map((e) => {
      const cut = e.path.lastIndexOf("/")
      return { value: e.path, dir: e.dir, view: [
        icon(e.dir ? FOLDER_PATHS : FILE_PATHS, "mention-ico"),
        el("span", { class: "mention-name" }, hitMarked(e.path.slice(cut + 1), hit)),
        // Where it is, when that isn't the folder being looked at.
        m.browse === undefined && cut > 0 ? el("span", { class: "mention-path", text: `‎${e.path.slice(0, cut)}‎` }) : null,
        e.dir ? el("span", { class: "mention-chev", "aria-hidden": "true", html: CHEVRON_SVG }) : null
      ] }
    })
    paint()
  }
  /** Select what was typed (from the @ or / to the caret): it's what a pick replaces. */
  const selectTyped = (m) => {
    const r = document.createRange()
    r.setStart(m.node, m.start)
    r.setEnd(m.node, m.end)
    const s = getSelection()
    s.removeAllRanges()
    s.addRange(r)
    return r
  }
  /** Put the pick in place of what was typed: a file or folder as a chip; a command runs, or is put in to add words to. */
  const pick = (i) => {
    const it = items[i], m = match
    if (!it || !m) return
    const r = selectTyped(m)
    close()
    if (m.kind === "file") {
      const chip = mentionChip(it.dir ? `${it.value}/` : it.value, true)
      const space = document.createTextNode(" ")
      r.deleteContents()
      r.insertNode(space)
      r.insertNode(chip)
      const after = document.createRange()
      after.setStart(space, 1)
      after.collapse(true)
      const s = getSelection()
      s.removeAllRanges()
      s.addRange(after)
      input.dispatchEvent(new Event("input"))
      return
    }
    if (it.value.run) { document.execCommand("delete"); return void it.value.run() }
    document.execCommand("insertText", false, `/${it.value.name} `)
  }
  /** Into a folder: what was typed becomes `@folder/`, and the menu lists what's in it. */
  const open = (i) => {
    const it = items[i], m = match
    if (!it?.dir || !m) return
    selectTyped(m)
    document.execCommand("insertText", false, `@${it.value}/`)
    update()
  }
  /** Keys while the menu is open; true when the key was its. */
  const key = (e) => {
    if (pop.hidden) return false
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      if (items.length) { at = (at + (e.key === "ArrowDown" ? 1 : items.length - 1)) % items.length; paint() }
    } else if (e.key === "Tab" && !e.shiftKey && items.length) items[at]?.dir ? open(at) : pick(at)
    else if (e.key === "Enter" && !e.shiftKey && items.length) pick(at)
    else if (e.key === "Escape") close()
    else return false
    e.preventDefault()
    e.stopPropagation()
    return true
  }
  input.addEventListener("blur", close)
  return { pop, update, key, close }
}

function composer({ onSend, onStop, onAllow = null, controls = [], tools = [], running = false, disabled = false, draftKey = "", files = null, commands = [] }) {
  const input = el("div", { class: "input empty", contenteditable: disabled ? "false" : "true", role: "textbox", "aria-multiline": "true", "aria-label": "Message", "data-placeholder": "" })
  // What was written here before going elsewhere comes back, chips and all.
  const kept = draftKey && drafts.get(draftKey)?.nodes
  if (kept) input.append(...kept)
  const picker = el("input", { type: "file", multiple: true, hidden: true, tabindex: "-1" })
  const attach = el("button", { class: "mb mb-ic", type: "button", title: "Attach files. You can paste or drop them too.", "aria-label": "Attach files", html: I.clip })
  const send = el("button", { class: "send", type: "button" })
  let busy = running
  let canAttach = true
  let range = null // where the caret last was inside the box

  const uploading = () => input.querySelector('.att[data-state="uploading"]') !== null
  const empty = () => !input.querySelector(".att") && serialize(input).trim() === ""
  /** Working with nothing typed: the button stops the turn. With a message typed it sends it, to wait for the turn's end. */
  const stops = () => busy && empty()
  const STOP_SVG = I.stop
  const SEND_SVG = I.up
  let painted = ""
  /** The button as things stand; it's touched only when that changed (each key typed comes through here). */
  const paint = (isEmpty = empty()) => {
    const stop = busy && isEmpty
    const up = uploading()
    const state = `${stop}|${busy}|${up}|${disabled}|${isEmpty}|${canAttach}|${sendKey()}`
    if (state === painted) return
    painted = state
    send.className = `send${stop ? " stop" : ""}`
    const key = sendKey()
    send.title = stop ? "Stop (Esc)" : up ? "Waiting for files to upload" : busy ? `Queue: runs when this turn ends (${key})` : `Send (${key})`
    send.setAttribute("aria-label", stop ? "Stop" : busy ? "Queue" : "Send")
    send.innerHTML = stop ? STOP_SVG : SEND_SVG
    send.disabled = !stop && (disabled || isEmpty || up)
    attach.disabled = disabled || !canAttach
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
    paint(isEmpty)
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
  // A chip can move to another composer with its draft: it tells the box it's in now, not this one.
  const changed = (box) => box?.dispatchEvent(new Event("input"))
  /** A file chip in the box, with its × to take the file out. */
  const removable = (chip, name) => {
    const x = el("button", { class: "att-x", type: "button", tabindex: "-1", "aria-label": `Remove ${name}`, title: "Remove", text: "×" })
    x.addEventListener("mousedown", (e) => e.preventDefault()) // keep the caret in the box
    x.addEventListener("click", () => {
      const box = chip.closest(".input")
      const next = chip.nextSibling
      if (next?.nodeType === Node.TEXT_NODE && next.nodeValue === " ") next.remove()
      chip.remove()
      changed(box)
    })
    chip.append(x)
    return chip
  }
  const addFiles = (files) => {
    if (disabled) return
    if (!canAttach) return toast(attach.title, true)
    const nodes = []
    for (const file of files) {
      if (file.size > MAX_FILE) { toast(`${file.name} is over 25 MB, too big to attach.`, true); continue }
      const local = isRaster(file.type) ? URL.createObjectURL(file) : null
      const chip = removable(attChip("span", { name: file.name || "pasted file", mime: file.type, src: local, attrs: { contenteditable: "false", "data-state": "uploading", title: "Uploading…" } }), file.name || "file")
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

  /** The send button: Stop while the thread works and nothing's typed, Send (or queue) otherwise. */
  const submit = async () => {
    if (stops()) return onStop?.()
    return sendNow()
  }
  /** Enter never stops a turn: while the agent works it queues the message for when the turn ends. */
  const enter = () => sendNow()
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
    painted = "" // the button was disabled by hand above
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
    if (e.key === "Enter" && !e.shiftKey && !e.isComposing && !touchFirst.matches) {
      const ctrl = e.ctrlKey || e.metaKey
      // Ctrl+Enter in an empty box answers a waiting approval: Allow.
      if (ctrl && empty() && onAllow?.()) { e.preventDefault(); return }
      // Settings › Send messages with: Enter (Ctrl+Enter makes a new line), or Ctrl+Enter (Enter does).
      if (ctrl === (S.sendWith === "ctrl")) { e.preventDefault(); enter(); return }
      if (ctrl) { e.preventDefault(); document.execCommand("insertLineBreak") }
      return
    }
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
  node.append(menu.pop, el("div", { class: "input-row" }, input, send), picker)
  // The row under the box: Attach and the branch on the left; the model, Compact and the context on the right.
  const meta = el("div", { class: "meta" }, el("div", { class: "meta-l" }, attach, tools), el("div", { class: "meta-r" }, controls))
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
    meta,
    addFiles,
    focus: () => { if (!disabled) input.focus() },
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
    /**
     * A message taken back (from the queue): its words and files go at the end of what's written, below it,
     * to be edited and sent again.
     */
    restore: (text, attachments = []) => {
      const known = new Map(attachments.map((a) => [a.id, a]))
      const nodes = []
      let last = 0
      for (const m of text.matchAll(ATT)) {
        if (m.index > last) nodes.push(document.createTextNode(text.slice(last, m.index)))
        const a = known.get(m[1])
        // Chips keep their file: serialize() turns each back into its marker.
        if (a) nodes.push(removable(attChip("span", { name: a.name, mime: a.mime, src: isRaster(a.mime) ? fileUrl(a.id) : null, attrs: { contenteditable: "false", "data-att": a.id, title: `${a.name} · ${bytes(a.size)}` } }), a.name))
        last = m.index + m[0].length
      }
      if (last < text.length) nodes.push(document.createTextNode(text.slice(last)))
      if (!nodes.length) return
      if (!empty()) nodes.unshift(document.createTextNode("\n\n"))
      input.append(...nodes)
      sync()
      input.focus()
      const r = document.createRange()
      r.selectNodeContents(input)
      r.collapse(false)
      caretTo(r)
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

/// ---------- thread ----------
let feed = null // { list, scroll, cache, working, composer, stick, models, branch, meter, compact, ask, queued, … }
/** The composer on screen (a thread's, or a new thread's): what a file dropped anywhere on the thread goes into. */
let liveBox = null
/**
 * The top row of the main pane: where you are. It drags the window; the spots under the fixed toggles that lie
 * over it stay clickable (Electron cuts a no-drag hole only from inside a drag box).
 */
const headBar = (...crumb) => el("header", { class: "head drag" },
  el("span", { class: "nodrag-left", "aria-hidden": "true" }), el("span", { class: "nodrag-right", "aria-hidden": "true" }),
  el("div", { class: "crumb" }, ...crumb))
/** A small status pill for the header: from the thread's real state. */
function statePill(t) {
  const st = stateOf(t)
  if (st === "working") {
    const compacting = t.items?.some((i) => i.kind === "compact" && i.state === "running")
    const since = t.items?.findLast((i) => i.kind === "user")?.at ?? t.updatedAt
    return el("span", { class: "pill run state" }, svgEl(I.spin), el("span", { text: compacting ? "Compacting" : "Working" }), el("span", { class: "clock", "data-since": since, text: elapsed(since) }))
  }
  if (st === "ask") return el("span", { class: "pill ask state" }, svgEl(I.ask), "Needs approval")
  if (st === "failed") return el("span", { class: "pill failed state" }, svgEl(I.alert), "Error")
  if (st === "settled") return el("span", { class: "pill state" }, svgEl(I.settle), "Settled")
  return null
}
/** The header of a thread: its project (a new thread there), its title (a menu; F2 or a double-click renames), its state, its links. */
function paintHead() {
  const t = S.open
  const crumb = feed?.head?.querySelector(".crumb")
  if (!t || !crumb) return
  const project = S.projects.find((p) => p.id === t.projectId)
  // Each event of the thread comes through here: the row is rebuilt only when what it says changed.
  const sig = JSON.stringify([t.id, t.title, stateOf(t), project?.name, project?.path, S.renaming, t.status === "running" && t.items.some((i) => i.kind === "compact" && i.state === "running")])
  if (crumb.dataset.sig === sig) return feed.links.paint()
  crumb.dataset.sig = sig
  const proj = project
    ? el("button", { class: "seg proj", type: "button", title: `New thread in ${project.name}\n${project.path}`, onclick: () => go(`#/new/${project.id}`) }, el("span", { text: project.name }))
    : el("span", { class: "seg proj gone" }, el("span", { text: "removed project" }))
  let title
  if (S.renaming) {
    title = el("input", { class: "rename", id: "rename", "aria-label": "Thread title", maxlength: 120, value: t.title })
    let done = false
    const finish = (keep) => {
      if (done) return
      done = true
      const v = title.value.trim()
      S.renaming = false
      if (keep && v && v !== t.title) { patchMeta(t.id, { title: v }); api("PATCH", `threads/${t.id}`, { title: v }).catch(fail); renderSide() }
      paintHead()
      crumb.querySelector(".seg.title")?.focus({ preventScroll: true })
    }
    title.addEventListener("keydown", (e) => {
      if (e.key === "Enter") { e.preventDefault(); finish(true) }
      else if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); finish(false) }
    })
    title.addEventListener("blur", () => finish(true))
    requestAnimationFrame(() => { title.focus(); title.select() })
  } else {
    title = el("button", { class: "seg title", type: "button", "aria-haspopup": "menu", title: t.title }, el("span", { text: t.title }), svgEl(I.chevD))
    title.addEventListener("click", () => {
      if (ctxMenu?.anchor === title) return ctxMenu.close()
      const r = title.getBoundingClientRect()
      const { title: name, actions } = threadMenu(S.open)
      if (touchFirst.matches) return actionSheet(name, actions)
      contextMenu(r.left, r.bottom + 6, name, actions, title, "start")
    })
    title.addEventListener("dblclick", () => { ctxMenu?.close(); startRename() })
  }
  crumb.replaceChildren(proj, el("span", { class: "sep", "aria-hidden": "true", text: "/" }), title, statePill(t) ?? "", feed.links)
  feed.links.paint()
}
function startRename() {
  if (S.route.name !== "thread" || !S.open) return
  S.renaming = true
  paintHead()
}

/** The effort's glyph: four rising bars, filled to the level. */
function effortGlyph(provider, effort) {
  const levels = (EFFORTS[provider] ?? []).filter(([v]) => v !== "")
  const i = levels.findIndex(([v]) => v === effort)
  const n = i < 0 ? 0 : Math.max(1, Math.ceil(((i + 1) / levels.length) * 4))
  return el("span", { class: "effort", "aria-hidden": "true", html: `<svg viewBox="0 0 14 14">${[4, 6.5, 9, 11.5].map((h, k) => `<rect x="${1.5 + k * 3}" y="${12.5 - h}" width="2" height="${h}" rx=".75"${k < n ? ' class="on"' : ""}/>`).join("")}</svg>` })
}

function threadView(t) {
  const project = S.projects.find((p) => p.id === t.projectId)
  // Picks save quietly; the server's answer (the thread event) is the record. A refused pick goes back.
  const current = () => ({ provider: t.provider, model: t.model, effort: t.effort ?? defaultEffort(t.provider) })
  const models = modelPicker({
    ...current(),
    access: t.access,
    onChange: (patch) => api("PATCH", `threads/${t.id}`, patch).catch((e) => { models.set(current()); fail(e) }),
    onAccess: (value) => api("PATCH", `threads/${t.id}`, { access: value }).catch((e) => { models.setAccess(t.access); fail(e) })
  })
  const list = el("div", { class: "feed", role: "log", "aria-live": "polite" })
  const working = el("div", { class: "working", hidden: true, role: "status", "aria-label": "Working" },
    svgEl(I.spin), el("span", { class: "step", text: "Working" }), el("span", { class: "clock working-time" }))
  const scroll = el("div", { class: "view" }, el("div", { class: "col" }, list))
  // Compact: shown when the context is filling, or after an hour idle. On, the next message waits while the session compacts first.
  const compact = el("button", { class: "mb compact-tgl", type: "button", role: "switch", onclick: () => {
    S.compactOff.has(t.id) ? S.compactOff.delete(t.id) : S.compactOff.add(t.id)
    paintCompact(S.open)
    showTip(compact, true)
  } }, el("span", { class: "knob", "aria-hidden": "true" }), el("span", { text: "Compact" }))
  // The thread's branch: switch it, or move the thread to a new worktree from a base you pick.
  const branched = (meta, words) => {
    Object.assign(S.open ?? {}, meta)
    for (const k of ["cwd", "workTree", "pr", "queued", "waiting"]) if (!(k in meta) && S.open) delete S.open[k]
    toast(words)
    if (gitPanel?.threadId === t.id) loadGit()
    renderInfo()
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
  // How full the context is, and the plan's usage limits: a ring and a %, the detail and Compact now in its popover.
  const meter = contextMeter(t)
  const box = composer({
    running: t.status === "running",
    controls: [models.node, compact, meter.node],
    tools: [branch.node],
    draftKey: `t:${t.id}`,
    files: () => api("GET", `threads/${t.id}/files`),
    onAllow: () => { const ask = pendingAsk(); if (!ask) return false; answerAsk(ask, true); return true },
    // What / offers: zero's own actions, the provider's /compact when its session takes it, then the
    // session's own commands (the person's, the project's, skills, a few of Claude Code's) once a turn has told them.
    commands: () => [
      { name: "compact", args: "what to keep", desc: "Summarize the thread so far to free up context", when: () => status(S.open?.provider)?.compaction === "manual" && !!S.open?.resume },
      { name: "git", desc: "Show or hide the Changes panel", run: () => setGitOpen(!gitOpenNow()) },
      { name: "rename", desc: "Rename this thread", run: () => startRename() },
      ...(project ? [{ name: "new", desc: `Start a new thread in ${project.name}`, run: () => go(`#/new/${project.id}`) }] : []),
      ...(S.commands.get(t.id) ?? []).map((c) => ({ name: c.name, args: c.hint, desc: c.description, from: providerLabel(t.provider) }))
    ],
    onSend: (text) => api("POST", `threads/${t.id}/messages`, { text, compact: compactOn(S.open) }),
    onStop: () => api("POST", `threads/${t.id}/stop`, {}).catch(fail)
  })
  liveBox = box
  // Above the composer: an approval waiting, then what waits to be sent.
  const ask = el("div", { class: "ask-card", hidden: true, role: "group", "aria-label": "Approval" })
  const queued = el("div", { class: "queue", hidden: true, role: "list", "aria-label": "Queued messages" })
  const links = linksNode(t)
  // The turns above the ones drawn: a button for them, which also loads them as it scrolls into view.
  const earlier = el("button", { class: "feed-earlier", type: "button", onclick: () => showEarlier() }, el("span"))
  // Scrolled up, a pill brings you back to the latest; it says so when something new came in meanwhile.
  const jump = el("button", { class: "jump", type: "button", hidden: true, title: "Jump to the latest", "aria-label": "Jump to the latest" }, svgEl(I.down), el("span", { text: "Latest" }))
  const above = el("div", { class: "above" }, ask, queued, jump)
  const head = headBar()
  feed?.io?.disconnect()
  feed = { list, scroll, cache: new Map(), groups: new Map(), turns: new Map(), folds: new Map(), working, queued, ask, composer: box, stick: true, models, compact, meter, branch, links, head, shown: TURNS_SHOWN, hidden: 0, earlier, jump }
  feed.io = new IntersectionObserver((seen) => { if (seen.some((e) => e.isIntersecting) && feed?.earlier === earlier) showEarlier() }, { root: scroll, rootMargin: "600px 0px 0px 0px" })
  jump.addEventListener("click", () => { feed.stick = true; scroll.scrollTo({ top: scroll.scrollHeight, behavior: reduced ? "auto" : "smooth" }) })

  paintReady(t)
  paintHead()
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
  makeGitPanel(t)
  // The session's slash commands, for / (empty until a turn of it has started).
  if (!S.commands.has(t.id)) api("GET", `threads/${t.id}/commands`).then((list) => { if (list.length) S.commands.set(t.id, list) }, () => {})
  return [
    head,
    el("aside", { class: "info", id: "info", "aria-label": "Thread details", hidden: true }),
    scroll,
    watchDock(el("div", { class: "dock" }, el("div", { class: "col" }, above, box.node, box.meta))),
    dropZone()
  ]
}
/** The overlay a file dragged over the thread shows: let go anywhere on it and the file goes into the composer. */
const dropZone = () => el("div", { class: "drop", id: "drop", hidden: true }, el("div", {}, el("b", { text: "Drop to attach" }), el("span", { text: `Images, text and code, up to ${MAX_FILE / 1048576} MB each` })))
{
  let depth = 0
  const main = $("main")
  const files = (e) => [...(e.dataTransfer?.types ?? [])].includes("Files")
  const zone = () => $("drop")
  main.addEventListener("dragenter", (e) => {
    if (!files(e) || !zone() || !liveBox) return
    e.preventDefault()
    depth++
    zone().hidden = false
  })
  main.addEventListener("dragover", (e) => { if (zone() && !zone().hidden) e.preventDefault() })
  main.addEventListener("dragleave", () => { if (--depth <= 0) { depth = 0; if (zone()) zone().hidden = true } })
  main.addEventListener("drop", (e) => {
    depth = 0
    if (!zone() || zone().hidden) return
    zone().hidden = true
    // One the composer took itself (dropped where its caret goes) is done already.
    if (e.defaultPrevented) return
    e.preventDefault()
    const list = [...(e.dataTransfer?.files ?? [])]
    if (list.length) liveBox?.addFiles(list)
  })
}

/**
 * The context meter under the composer: a ring and how full the context is (a usage limit's words beside it when
 * one is close). Its popover has the detail: tokens, the plan's limits, and Compact now.
 */
function contextMeter(t) {
  const pop = popover({ name: "Context", panelClass: "ctx-panel" })
  pop.trigger.classList.add("meter")
  pop.wrap.hidden = true
  const R = 5.5, C = 2 * Math.PI * R
  const ring = el("span", { class: "ring", "aria-hidden": "true", html: `<svg viewBox="0 0 14 14"><circle class="bg" cx="7" cy="7" r="${R}"/><circle class="fg" cx="7" cy="7" r="${R}" stroke-dasharray="0 ${C.toFixed(2)}"/></svg>` })
  pop.trigger.prepend(ring)
  pop.wrap.classList.add("up-end")
  pop.paint = () => {
    const t = S.open
    if (!t) return
    const ctx = t.context && t.context.limit > 0 ? t.context : null
    const share = ctx ? Math.min(1, ctx.used / ctx.limit) : 0
    const limits = t.provider === "claude" ? (S.limits ?? []).filter((l) => l.used !== null || l.status !== "allowed") : []
    const compacting = t.items.some((i) => i.kind === "compact" && i.state === "running")
    const can = status(t.provider)?.compaction === "manual" && !!t.resume
    const busy = t.status === "running"
    const say = compacting ? `${providerLabel(t.provider)} is compacting the session: what came before becomes a summary it goes on from.`
      : status(t.provider)?.compaction === "manual" ? `${providerLabel(t.provider)} compacts on its own when it's full. From 70%, Compact shows beside this: your next message waits while it compacts first.`
      : status(t.provider)?.compaction === "auto" ? `${providerLabel(t.provider)} compacts its context on its own when it fills.` : ""
    pop.panel.replaceChildren(
      ctx ? el("div", { class: `ctx${share >= COMPACT_SOON && !compacting ? " high" : ""}` },
        el("div", { class: "ctx-big" }, el("b", { text: `${Math.round(share * 100)}%` }), el("span", { text: "of the context used" })),
        el("div", { class: "ctx-bar" }, el("i", { style: `width:${(share * 100).toFixed(1)}%` })),
        el("p", { text: `${tokensK(ctx.used)} of ${tokensK(ctx.limit)} tokens. ${say}` })) : el("div", { class: "pop-note", text: "No context measured yet: it shows after the first turn." }),
      ...(limits.length ? [el("hr"), el("div", { class: "pop-head", text: "Usage limits" }), ...limits.map((l) => el("div", { class: `ctx-limit${limitPressing(l) ? " high" : ""}` },
        el("span", { class: "lb", text: LIMIT_NAMES[l.kind] ?? l.kind }),
        el("span", { class: "n", text: l.status === "rejected" ? "reached" : l.used !== null ? `${Math.round(l.used * 100)}%` : l.status === "allowed_warning" ? "getting close" : "fine" }),
        l.resetsAt ? el("span", { class: "sub", text: resetWords(l.resetsAt) }) : null))] : []),
      el("hr"),
      el("button", { class: "pop-item ctx-compact", type: "button", disabled: !can || busy || !t.items.length, "data-key": "compact",
        onclick: () => { pop.close(); api("POST", `threads/${t.id}/messages`, { text: "/compact" }).catch(fail) } },
        icon(I.zap), el("span", { class: "pop-text" }, el("span", { text: "Compact now" }),
          el("span", { class: "pop-help", text: !can ? (status(t.provider)?.compaction === "manual" ? "Nothing to compact yet" : `${providerLabel(t.provider)} takes no /compact`) : busy ? "After this turn ends" : "Same as /compact" }))))
  }
  const paint = () => {
    const t = S.open
    if (!t) return
    const ctx = t.context && t.context.limit > 0 ? t.context : null
    const share = ctx ? Math.min(1, ctx.used / ctx.limit) : 0
    const limits = t.provider === "claude" ? (S.limits ?? []).filter((l) => l.used !== null || l.status !== "allowed") : []
    const pressing = limits.filter(limitPressing).sort((a, b) => (b.used ?? 1) - (a.used ?? 1))[0]
    pop.wrap.hidden = !ctx && !pressing
    if (pop.wrap.hidden) return
    const pct = Math.round(share * 100)
    ring.querySelector(".fg").setAttribute("stroke-dasharray", `${(C * share).toFixed(2)} ${C.toFixed(2)}`)
    pop.trigger.classList.toggle("high", share >= COMPACT_SOON || !!pressing)
    const limitShort = pressing ? (pressing.status === "rejected" ? `${LIMIT_NAMES[pressing.kind] ?? "Limit"} reached` : `${LIMIT_NAMES[pressing.kind] ?? "Limit"} ${Math.round((pressing.used ?? 0) * 100)}%`) : ""
    pop.label.replaceChildren(...[ctx ? el("span", { class: "pct", text: `${pct}%` }) : null, limitShort ? el("span", { class: "lim", text: `${ctx ? "· " : ""}${limitShort}` }) : null].filter(Boolean))
    const lines = [
      ctx ? `Context: ${tokensK(ctx.used)} of ${tokensK(ctx.limit)} tokens (${pct}%)` : "",
      ...limits.map((l) => {
        const name = LIMIT_NAMES[l.kind] ?? l.kind
        const used = l.status === "rejected" ? "reached" : l.used !== null ? `${Math.round(l.used * 100)}% used` : l.status === "allowed_warning" ? "getting close" : "fine"
        return [`${name}: ${used}`, resetWords(l.resetsAt)].filter(Boolean).join(", ")
      })
    ].filter(Boolean)
    pop.trigger.title = lines.join("\n")
    pop.trigger.setAttribute("aria-label", lines.join(". "))
    pop.repaint()
  }
  return { node: pop.wrap, paint }
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
function paintMeter() { feed?.meter?.paint() }

function paintCompact(t) {
  paintMeter()
  if (!feed?.compact || !t) return
  // Not while it compacts: there is nothing left to decide until it ends.
  const compacting = t.items.some((i) => i.kind === "compact" && i.state === "running")
  const shown = compactShown(t) && !compacting
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
  // The working line stands on its own only when nothing else shows the work: no call running (the call is
  // its group's last row, with its own clock) and no compaction (its card is the loader).
  const compacting = running && S.open.items.some((i) => i.kind === "compact" && i.state === "running")
  const calling = running && S.open.items.some((i) => i.kind === "tool" && i.status === "running" && !i.name.startsWith(THREAD_TOOL))
  feed.working.hidden = !running || asking || compacting || calling
  // How long this turn has run, from your message.
  const since = S.open.items.findLast((i) => i.kind === "user")?.at
  feed.working.dataset.since = running && since ? since : ""
  tickWorking()
  paintQueue()
  paintAsk()
  // Moved only when out of place: moving it restarts its animation (each tool call came through here).
  if (feed.list.lastElementChild !== feed.working) feed.list.append(feed.working)
  feed.composer.setBusy(running)
  feed.models.setBusy(running)
  feed.branch?.setBusy(running)
  paintCompact(S.open)
  paintHead()
}
/** The approval the open thread waits on, if any. */
const pendingAsk = () => S.open?.items.find((i) => i.kind === "permission" && i.state === "pending") ?? null
/** Answer it: Allow (`always`: for the rest of the thread) or Deny. */
function answerAsk(item, allow, always = false) {
  if (!S.open) return
  api("POST", `threads/${S.open.id}/permissions/${item.id}`, { allow, ...(always ? { always: true } : {}) }).catch(fail)
}
/**
 * An approval waiting, above the composer: what the agent wants to do and the three answers. Y and Ctrl+Enter
 * allow, N denies. A message typed meanwhile waits in the queue for the turn (zero's queue), it doesn't answer.
 */
function paintAsk() {
  const card = feed?.ask
  const item = pendingAsk()
  if (!card) return
  card.hidden = !item
  if (!item) { delete card.dataset.id; return }
  if (card.dataset.id === item.id) return
  card.dataset.id = item.id
  const btn = (label, cls, run, kbd, title) => {
    const b = el("button", { class: `btn ${cls}`, type: "button", title }, label, kbd && !touchFirst.matches ? el("kbd", { text: kbd }) : null)
    b.addEventListener("click", () => { card.querySelectorAll("button").forEach((x) => { x.disabled = true }); run() })
    return b
  }
  card.replaceChildren(
    el("div", { class: "ask-top" }, svgEl(I.ask), el("span", { text: `${providerLabel(S.open.provider)} wants to ${verb(item.tool)}` }), el("span", { class: "tool", text: item.tool.replace(/^mcp__[^_]+__/, "") })),
    el("pre", { class: "ask-cmd", text: rel(item.detail), title: item.detail }),
    el("div", { class: "ask-acts" },
      btn("Deny", "quiet", () => answerAsk(item, false), "N"),
      el("span", { class: "grow" }),
      el("span", { class: "hint", text: "What needs asking: the model menu below." }),
      btn("Always allow", "quiet", () => answerAsk(item, true, true), "", "Allow this exact call for the rest of the thread, without asking again"),
      btn("Allow", "ink", () => answerAsk(item, true), chord("Ctrl ⏎"), "Allow (Y, or Ctrl+Enter in an empty box)")))
}
/**
 * Above the composer: a message waiting for the session to compact first, and the ones sent while the turn runs,
 * numbered in the order they'll go. One sent while it runs can be taken back into the composer, or removed.
 */
function paintQueue() {
  const tray = feed.queued
  const waiting = S.open.waiting ?? []
  tray.hidden = !S.open.queued && !waiting.length
  const key = JSON.stringify([S.open.queued ?? "", waiting])
  if (tray.dataset.key === key) return
  tray.dataset.key = key
  const id = S.open.id
  const out = (m, restore) => async (e) => {
    const b = e.currentTarget
    b.disabled = true
    try {
      const back = await api("DELETE", `threads/${id}/queue/${m.id}`)
      if (restore && feed?.queued === tray) feed.composer.restore(back.text, back.attachments)
    } catch (err) { b.disabled = false; fail(err) }
  }
  const parts = []
  if (S.open.queued) parts.push(el("div", { class: "queue-h", text: "After compaction" }), el("ol", {}, el("li", { role: "listitem" }, el("span", { class: "q", text: S.open.queued, title: S.open.queued }))))
  if (waiting.length) {
    parts.push(el("div", { class: "queue-h", text: waiting.length === 1 ? "Sends when this turn ends" : "Send together when this turn ends" }),
      el("ol", {}, waiting.map((m, i) => el("li", { role: "listitem" },
        el("span", { class: "n", text: String(i + 1) }),
        el("span", { class: "q", text: m.text, title: m.text }),
        el("button", { class: "ib", type: "button", title: "Edit: back to the composer, out of the queue", "aria-label": "Edit this message: back to the composer", html: I.pencil, onclick: out(m, true) }),
        el("button", { class: "ib", type: "button", title: "Remove from the queue", "aria-label": "Remove this message", html: I.x, onclick: out(m, false) })))))
  }
  tray.replaceChildren(...parts)
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
  const sections = drawn.map(({ key, entries }, i) => {
    let nodes = entries.map((x) => x.items ? toolGroup(x, groups) : nodeFor(x))
    // A turn that has ended with its answer: the work before the answer (what it said between calls, the calls,
    // the approvals) folds into one row, "Worked for 4m 12s", open on demand. Your message and the answer stay.
    const from = entries[0] && !entries[0].items && entries[0].kind === "user" ? 1 : 0
    const end = entries.findIndex((x) => !x.items && metaFor.has(x.id))
    if (end > from) {
      const live = i === drawn.length - 1 && feed.painted
      nodes = [...nodes.slice(0, from), workedFold(key, nodes.slice(from, end), metaFor.get(entries[end].id), live), ...nodes.slice(end)]
    }
    let section = feed.turns.get(key)
    if (!section) feed.turns.set(key, (section = el("section", { class: "turn" })))
    reconcile(section, nodes)
    return section
  })
  feed.painted = true
  feed.groups = groups
  feed.hidden = hidden
  if (hidden) feed.earlier.querySelector("span").textContent = `Show earlier (${hidden} more)`
  reconcile(feed.list, [...(hidden ? [feed.earlier] : []), ...sections, feed.working])
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
  // A turn still running hasn't given its answer yet: what it says between calls gets no action row.
  if (last && S.open.status !== "running") finals.add(last)
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
  if (!box) { box = el("div", { class: "card turn-files" }); node.querySelector(".msg-actions").before(box) }
  box.dataset.sig = sig
  const total = files.reduce((s, [, c]) => ({ add: s.add + c.add, del: s.del + c.del }), { add: 0, del: 0 })
  const SHOWN = 6
  // In the desktop app a file opens in VS Code, at the thread's folder for a path given relative to it.
  const dir = S.open ? threadDir(S.open, S.projects.find((p) => p.id === S.open.projectId)) : ""
  const pathNodes = (p) => { const [d, leaf] = splitPath(rel(p)); return el("bdi", {}, el("span", { class: "dir", text: d }), leaf) }
  const row = ([path, c]) => el("li", { class: "turn-file" },
    DESKTOP
      ? el("button", { class: "path turn-file-path", type: "button", title: `Open ${path} in VS Code`, onclick: () => openOut(vscodeUrl(absPath(path, dir))) }, pathNodes(path))
      : el("span", { class: "path turn-file-path", title: path }, pathNodes(path)),
    diffStat(c))
  const rest = files.length - SHOWN
  box.replaceChildren(
    el("div", { class: "card-head" },
      svgEl(I.diff),
      el("span", { text: `${plural(files.length, "file")} changed` }),
      diffStat(total),
      el("span", { class: "grow" }),
      el("button", { class: "btn quiet sm turn-files-review", type: "button", title: "See the diffs and commit, in the Changes panel's Code tab (Ctrl+Alt+B)", onclick: () => { if (!gitPanel) return; setGitTab("code"); if (!gitOpenNow()) setGitOpen(true) } }, "Review")),
    el("ul", { class: "files-list turn-file-list" }, ...files.slice(0, SHOWN).map(row),
      rest > 0 ? el("li", { class: "turn-file more" }, el("details", {}, el("summary", { text: `${rest} more` }), el("ul", { class: "turn-file-list" }, ...files.slice(SHOWN).map(row)))) : null))
}
/** How long a turn worked, as "38s", "4m 12s" or "1h 5m" (the fold's row and the answer's details both say it so). */
function workedFor(ms) {
  const s = Math.max(1, Math.round(ms / 1000))
  if (s < 60) return `${s}s`
  const m = Math.floor(s / 60)
  if (m < 60) return s % 60 ? `${m}m ${s % 60}s` : `${m}m`
  return `${Math.floor(m / 60)}h ${m % 60}m`
}
/**
 * The fold a finished turn's work goes into: a row saying how long it worked, and the work itself on demand.
 * `live`: the turn just ended as you watched, so the work is drawn open and then eases shut.
 */
function workedFold(key, nodes, turn, live) {
  const id = `worked:${key}`
  let f = feed.folds.get(key)
  if (!f) {
    const head = el("button", { class: "tools-sum worked-head", type: "button" })
    const body = el("div", { class: "worked-body" })
    f = { head, body, node: el("div", { class: "worked" }, head, body) }
    head.addEventListener("click", () => {
      S.expanded.has(id) ? S.expanded.delete(id) : S.expanded.add(id)
      paintFold(f, id)
    })
    feed.folds.set(key, f)
    // Shown open for two frames, so the shutting has somewhere to ease from.
    if (live && !matchMedia("(prefers-reduced-motion: reduce)").matches) {
      f.opening = true
      requestAnimationFrame(() => requestAnimationFrame(() => { f.opening = false; paintFold(f, id) }))
    }
  }
  reconcile(f.body, nodes)
  f.label = `Worked for ${workedFor(turn.durationMs ?? 0)}`
  paintFold(f, id)
  return f.node
}
function paintFold(f, id) {
  const open = f.opening || S.expanded.has(id)
  f.node.classList.toggle("open", open)
  f.body.inert = !open
  f.head.setAttribute("aria-expanded", String(open))
  if (f.head.dataset.label !== f.label) {
    f.head.dataset.label = f.label
    f.head.replaceChildren(el("span", { class: "worked-label", text: f.label }), svgEl(I.chevR, "chev"))
  }
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
  // Inside a finished turn's folded work: open it first.
  node.closest(".worked:not(.open)")?.querySelector(".worked-head")?.click()
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
  return el("button", { class: "btn sm turn-retry", type: "button", title: "Send your last message again", onclick: (e) => {
    e.currentTarget.disabled = true
    api("POST", `threads/${t.id}/messages`, { text: last.text }).catch((err) => { e.currentTarget.disabled = false; fail(err) })
  } }, "Retry")
}
/** A turn's details: Stopped (if it was), the model, how long it took, what it cost, its tokens. */
function turnMeta(item) {
  const meta = [modelName(item.model), workedFor(item.durationMs ?? 0), item.costUsd !== null ? usd(item.costUsd) : null, item.tokens ? `${(item.tokens / 1000).toFixed(1)}k tokens` : null].filter(Boolean)
  return [item.outcome === "stopped" ? el("span", { class: "stopped", text: "Stopped" }) : null, ...meta.map((m) => el("span", { text: m }))].filter(Boolean)
}
function toolGroup(run, groups) {
  let g = feed.groups.get(run.key)
  if (!g) {
    const head = el("button", { class: "tools-sum", type: "button" })
    const body = el("div", { class: "tools-list" })
    const live = el("div", { class: "working live", hidden: true })
    g = { head, body, live, node: el("div", { class: "tools" }, head, body, live) }
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
  paintGroup(g, run.key)
  return g.node
}
/** What a running call is doing, as a verb: "Reading", "Running". */
const LIVE_VERB = { Read: "Reading", Edit: "Editing", MultiEdit: "Editing", Write: "Writing", NotebookEdit: "Editing", Bash: "Running", PowerShell: "Running", Shell: "Running", Grep: "Searching", Glob: "Finding", WebFetch: "Fetching", WebSearch: "Searching the web", Task: "Delegating", Agent: "Delegating", TodoWrite: "Planning" }
/** "Allowed" on a call the person let run (or "Always allowed"), told on the call itself. */
const allowedTag = (always) => el("span", { class: "tag", title: always ? "You allowed this for the rest of the thread" : "You allowed this" }, svgEl(I.check), always ? "Always allowed" : "Allowed")
/**
 * A run of tool calls: one line saying what the finished ones did ("Read 3 files and ran 1 command"), open on
 * demand to each call (each opens to its output or diff). The call that's running is the run's last row, outside
 * the fold: a spinner, what it's doing, where, and its own clock. An approval the person gave rides on the call it
 * let run as a tag; one they denied keeps a line of its own.
 */
function paintGroup(g, key) {
  const items = g.items
  const tools = items.filter((i) => i.kind === "tool")
  const live = tools.findLast((i) => i.status === "running" && S.open?.status === "running")
  const tags = new Map()
  const given = []
  for (const i of items) {
    if (i.kind === "permission" && i.state === "allowed") given.push(i)
    else if (i.kind === "tool") {
      const k = given.findIndex((p) => p.tool === i.name)
      if (k >= 0) tags.set(i.id, given.splice(k, 1)[0].always === true)
    }
  }
  const done = tools.filter((i) => i !== live)
  const shown = items.filter((i) => (i.kind === "tool" && i !== live) || (i.kind === "permission" && i.state !== "allowed"))
  const open = S.expanded.has(`group:${key}`)
  const failed = done.filter((i) => i.status === "failed").length
  const state = live ? "running" : failed && tools.at(-1)?.status === "failed" ? "failed" : "done"
  g.node.className = `tools ${state}${open ? " open" : ""}`
  g.body.inert = !open
  g.head.hidden = shown.length === 0
  g.head.setAttribute("aria-expanded", String(open))
  const denied = items.filter((i) => i.kind === "permission" && i.state === "denied").length
  const words = toolSummary(done) || (denied ? `Denied ${plural(denied, "call")}` : plural(done.length, "call"))
  const sum = done.reduce((s, i) => { if (!i.diff) return s; const c = countsOf(i); return { add: s.add + c.add, del: s.del + c.del, any: true } }, { add: 0, del: 0, any: false })
  const headSig = JSON.stringify([words, sum, failed, denied])
  if (g.head.dataset.sig !== headSig) {
    g.head.dataset.sig = headSig
    g.head.replaceChildren(...[svgEl(I.term), el("span", { class: "sum-text", text: words }), sum.any ? diffStat(sum) : null,
      failed ? el("span", { class: "tool-count", text: `${failed} failed` }) : null, svgEl(I.chevR, "chev")].filter(Boolean))
  }
  reconcile(g.body, shown.map(nodeFor))
  for (const i of shown) {
    if (i.kind !== "tool") continue
    const slot = nodeFor(i).querySelector(".tool-tag")
    const want = tags.has(i.id) ? (tags.get(i.id) ? "always" : "once") : ""
    if (slot && slot.dataset.v !== want) { slot.dataset.v = want; slot.replaceChildren(...(want ? [allowedTag(want === "always")] : [])) }
  }
  g.live.hidden = !live
  if (live) {
    const sig = `${live.id}|${live.detail}|${tags.get(live.id) ?? ""}`
    if (g.live.dataset.sig !== sig) {
      g.live.dataset.sig = sig
      g.live.replaceChildren(...[svgEl(I.spin),
        el("span", { class: "step" }, el("span", { class: "v", text: LIVE_VERB[live.name] ?? live.name.replace(/^mcp__[^_]+__/, "").replace(/_/g, " ") }), el("code", { text: rel(live.detail), title: live.detail })),
        tags.has(live.id) ? allowedTag(tags.get(live.id)) : null,
        el("span", { class: "clock", "data-since": live.at, text: elapsed(live.at) })].filter(Boolean))
    }
  } else delete g.live.dataset.sig
}
/**
 * What a run of tool calls did, in words: "Read 7 files, edited 2 and ran 3 commands". Files are counted once
 * however often they were read; tools it has no words for are named.
 */
function toolSummary(tools) {
  const n = (k, one, many = `${one}s`) => `${k} ${k === 1 ? one : many}`
  const files = (names) => new Set(tools.filter((t) => names.includes(t.name)).map((t) => t.detail)).size
  const count = (names) => tools.filter((t) => names.includes(t.name)).length
  const known = ["Read", "Edit", "MultiEdit", "Write", "NotebookEdit", "Bash", "PowerShell", "Shell", "Grep", "Glob", "WebFetch", "WebSearch", "Task", "Agent", "TodoWrite", "BashOutput", "KillShell"]
  const read = files(["Read"]), edited = files(["Edit", "MultiEdit", "NotebookEdit"]), wrote = files(["Write"])
  const ran = count(["Bash", "PowerShell", "Shell"]), searched = count(["Grep", "Glob"]), web = count(["WebFetch", "WebSearch"]), agents = count(["Task", "Agent"])
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
  const text = parts.length > 1 ? `${parts.slice(0, -1).join(", ")} and ${parts.at(-1)}` : parts[0] ?? ""
  return text ? text[0].toUpperCase() + text.slice(1) : ""
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
      } }, el("span", { class: "tool-state", "aria-label": item.status }), el("span", { class: "tool-name", text: item.name.replace(/^mcp__[^_]+__/, "") }), el("code", { class: "tool-detail", text: rel(item.detail), title: item.detail }),
        counts ? diffStat(counts) : null, el("span", { class: "tool-tag" }))
      node.append(row, out)
      return node
    }
    case "permission": {
      // Waiting: the card above the composer asks (paintAsk). Allowed: the call it let run carries the tag.
      if (item.state === "pending") return el("div", { class: "ask-slot", hidden: true })
      return el("div", { class: `answered ${item.state}` }, svgEl(item.state === "denied" ? I.x : I.check),
        el("span", { text: item.state === "denied" ? "Denied" : item.always ? "Always allowed" : "Allowed" }), el("span", { class: "who", text: item.tool.replace(/^mcp__[^_]+__/, "") }), el("code", { text: rel(item.detail), title: item.detail }))
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
      if (item.outcome === "failed") {
        return el("div", { class: "card err", role: "alert" },
          el("div", { class: "card-head" }, svgEl(I.alert), el("span", { text: "Stopped on an error" }), el("span", { class: "grow" }), retryButton(item)),
          item.error ? el("pre", { text: item.error }) : null)
      }
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
  const who = providerLabel(S.open?.provider)
  const why = item.trigger === "auto" ? `${who} compacted on its own as the context filled` : "Compacted as asked"
  const head = (glyph, title, ...rest) => el("div", { class: "card-head" }, svgEl(glyph), el("span", { text: title }), el("span", { class: "grow" }), ...rest)
  if (item.state === "running") {
    const size = item.preTokens !== null ? `Summarizing about ${k(item.preTokens)} tokens of this thread` : "Summarizing this thread so far"
    return el("div", { class: "card cmp running", role: "status", "aria-live": "polite" },
      head(I.spin, "Compacting context", el("span", { class: "clock compact-time", "data-since": item.at, text: elapsed(item.at) })),
      el("div", { class: "cmp-bar", "aria-hidden": "true" }, el("i")),
      el("p", { class: "cmp-sub", text: `${size}. ${item.trigger === "auto" ? `${who} started this on its own; the turn goes on after.` : "Your next step waits for it."}` }))
  }
  if (item.state === "failed") {
    return el("div", { class: "card cmp failed", role: "status" }, head(I.alert, "Compaction failed"), el("p", { class: "cmp-sub", text: item.error || "The provider didn't finish compacting. The thread goes on as it was." }))
  }
  const facts = [
    item.preTokens !== null && item.postTokens !== null ? `${k(item.preTokens)} → ${k(item.postTokens)} tokens` : null,
    item.preTokens && item.postTokens !== null ? `${Math.max(0, Math.round((1 - item.postTokens / item.preTokens) * 100))}% smaller` : null,
    item.durationMs ? `${(item.durationMs / 1000).toFixed(1)}s` : null
  ].filter(Boolean)
  return el("div", { class: "card cmp done", role: "status" },
    head(I.zap, "Context compacted", el("span", { class: "facts", text: facts.join(" · ") })),
    el("p", { class: "cmp-sub", text: `${why}. What came before is now this summary.` }),
    item.summary ? el("details", { class: "cmp-kept" }, el("summary", { class: "tools-sum" }, el("span", { text: `What ${who} kept` }), svgEl(I.chevR, "chev")), el("div", { class: "cmp-summary prose" }, mdNodes(item.summary))) : null)
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
const FOLDER_PATHS = '<path d="M1.75 4.25a1 1 0 0 1 1-1h3.1l1.4 1.5h5.99a1 1 0 0 1 1 1v6.5a1 1 0 0 1-1 1H2.75a1 1 0 0 1-1-1z"/>'
const PR_PATHS = '<circle cx="4.5" cy="3.5" r="1.5"/><circle cx="4.5" cy="12.5" r="1.5"/><circle cx="11.5" cy="12.5" r="1.5"/><path d="M4.5 5v6M11.5 11V6.5a2 2 0 0 0-2-2H7M8.5 3 7 4.5 8.5 6"/>'
/** The one panel on screen (the open thread's), or null. */
let gitPanel = null

const prState = (pr) => (pr.state === "OPEN" && pr.isDraft ? "draft" : pr.state.toLowerCase())
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

/**
 * The Git panel's tabs: the branch and its pull request at a glance, what happened on it (commits and the
 * conversation, newest first), and the code (what's uncommitted, and what the pull request changes).
 */
const GIT_TABS = [["summary", "Summary"], ["timeline", "Timeline"], ["code", "Code"]]
const MORE_ICON = '<svg viewBox="0 0 16 16" fill="currentColor" aria-hidden="true"><circle cx="3.5" cy="8" r="1.25"/><circle cx="8" cy="8" r="1.25"/><circle cx="12.5" cy="8" r="1.25"/></svg>'

function makeGitPanel(t) {
  if (gitPanel) clearInterval(gitPanel.timer)
  const body = el("div", { class: "git-body", role: "tabpanel" }, el("p", { class: "git-empty", text: "Loading…" }))
  const sub = el("div", { class: "git-sub" })
  const tabs = el("div", { class: "seg-ctl git-tabs", role: "tablist", "aria-label": "Changes" },
    GIT_TABS.map(([key, label]) => el("button", { class: "git-tab", type: "button", role: "tab", "data-tab": key, onclick: () => setGitTab(key) },
      el("span", { text: label }), el("span", { class: "git-tab-n" }))))
  // The arrows move between tabs, as in any tab list.
  tabs.addEventListener("keydown", (e) => {
    const step = { ArrowRight: 1, ArrowLeft: -1 }[e.key]
    if (!step || !gitPanel) return
    e.preventDefault()
    const i = GIT_TABS.findIndex(([k]) => k === gitPanel.tab)
    const next = GIT_TABS[(i + step + GIT_TABS.length) % GIT_TABS.length][0]
    setGitTab(next)
    tabs.querySelector(`[data-tab="${next}"]`)?.focus()
  })
  const node = el("div", { class: "git" }, el("div", { class: "git-tabrow" }, tabs), sub, body)
  $("panel-body").replaceChildren(node)
  const saved = load("gitTab", "summary")
  gitPanel = {
    node, body, sub, tabs, threadId: t.id, data: null, loading: false, at: 0, timer: 0, draft: "",
    tab: GIT_TABS.some(([k]) => k === saved) ? saved : "summary", tops: {}
  }
  paintGitToggle()
  loadGit()
  // Keeping it current is zero's job, not a button's: while it's open it looks again on its own (often while
  // checks run), when the window comes back to the front, after a turn and after each of its actions.
  gitPanel.timer = setInterval(() => {
    const g = gitPanel
    if (g && !document.hidden && autoPullOn() && Date.now() - (gitFetched.get(g.threadId) ?? 0) > AUTO_PULL_MS) autoSync()
    if (!g || !gitOpenNow() || document.hidden || g.loading) return
    const waiting = g.data?.pr?.checks.some((c) => c.state === "running" || c.state === "pending")
    if (Date.now() - g.at > (waiting ? 15_000 : 45_000)) loadGit()
  }, 5_000)
}
/** Off a thread, the panel says what it would show: what a thread changes, once one is open. */
function emptyPanel() {
  if (gitPanel) { clearInterval(gitPanel.timer); gitPanel = null }
  const home = S.route.name === "home" || S.route.name === "new"
  $("panel-body").replaceChildren(el("div", { class: "panel-empty" }, svgEl(I.diff),
    el("b", { text: home ? "No changes yet" : "No thread open" }),
    el("span", { text: home ? "What zero changes in this thread shows here, to review and commit." : "Open a thread to see what it changed." })))
  paintGitToggle()
}
function setGitTab(key) {
  const g = gitPanel
  if (!g || g.tab === key) return
  g.tops[g.tab] = g.body.scrollTop
  g.tab = key
  save("gitTab", key)
  paintGit(true)
}
/** Back to the window after a while away: the open panel catches up. */
function gitCatchUp() {
  const g = gitPanel
  if (g && gitOpenNow() && !document.hidden && !g.loading && Date.now() - g.at > 5_000) loadGit()
}
addEventListener("focus", gitCatchUp)
document.addEventListener("visibilitychange", gitCatchUp)
/**
 * The Changes toggle says what it will do; closed, a dot on it says the thread has uncommitted changes. The panel's
 * head counts them. Its tip names the branch, the changes and the pull request.
 */
function paintGitToggle() {
  const r = $("panel-toggle")
  if (!r) return
  const g = gitPanel
  const d = g?.data
  const pr = d?.pr
  const changed = d?.repo ? d.changes.length : 0
  const open = gitOpenNow()
  r.classList.toggle("dot", !open && changed > 0)
  $("panel-count").textContent = changed ? (changed > 99 ? "99+" : String(changed)) : ""
  const branch = d?.repo ? d.branch || "detached HEAD" : S.open?.branch || ""
  const files = changed ? `${changed} uncommitted file${changed === 1 ? "" : "s"}` : ""
  const label = `${open ? "Hide" : "Show"} changes`
  r.setAttribute("aria-label", [label, files].filter(Boolean).join(", "))
  r.dataset.tip = [label, branch, files, pr ? `PR #${pr.number} · ${PR_STATE_LABEL[prState(pr)]}` : ""].filter(Boolean).join(" · ")
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

function paintGit(switched = false) {
  const g = gitPanel
  if (!g) return
  const d = g.data
  // Keep where the person was: a comment half-written, and the scroll position (each tab its own).
  const draft = g.body.querySelector(".git-comment:not(.git-commit-box) textarea")
  if (draft) g.draft = draft.value
  const top = switched ? (g.tops[g.tab] ?? 0) : g.body.scrollTop
  for (const b of g.tabs.children) {
    const on = b.dataset.tab === g.tab
    b.setAttribute("aria-selected", String(on))
    b.tabIndex = on ? 0 : -1
  }
  g.tabs.hidden = !!d && !d.repo
  if (!d || !d.repo) {
    g.sub.replaceChildren()
    if (!d) return g.body.replaceChildren(el("p", { class: "git-empty", text: g.error || "Loading…" }))
    return g.body.replaceChildren(el("div", { class: "git-empty" },
      el("b", { text: "Not a git repository" }),
      el("p", { text: "This thread's project folder isn't in git, so there's no branch or pull request to show." })))
  }
  // A count beside a tab only where it's news: the conversation's size, and what's uncommitted.
  const counts = { summary: 0, timeline: d.pr?.notes.length ?? 0, code: d.changes.length }
  for (const b of g.tabs.children) b.querySelector(".git-tab-n").textContent = counts[b.dataset.tab] ? String(counts[b.dataset.tab]) : ""
  const view = (g.tab === "timeline" ? timelineTab : g.tab === "code" ? codeTab : summaryTab)(d, g)
  g.sub.replaceChildren(el("div", { class: "git-sub-info" }, view.info), el("div", { class: "git-sub-actions" }, view.actions))
  g.body.replaceChildren(...[g.error ? el("p", { class: "git-note warn", text: g.error }) : null, ...view.body.flat()].filter(Boolean))
  const ta = g.body.querySelector(".git-comment:not(.git-commit-box) textarea")
  if (ta && g.draft) ta.value = g.draft
  g.body.scrollTop = top
}

/** A small button in the panel; it's disabled while what it does runs. */
const gitBtn = (label, run, { primary = false, title = null, disabled = false, cls = "" } = {}) =>
  el("button", { class: `btn ${primary ? "btn-primary" : "btn-quiet"} btn-xs ${cls}`.trim(), type: "button", title, disabled, onclick: (e) => withBusy(e.currentTarget, run) }, label)
/**
 * "More": the rest of a tab's actions, in a menu under the button, as the sidebar's right-click opens one;
 * on a phone, a sheet. A second click puts the menu away.
 */
const gitMore = (title, items) => {
  if (!items.length) return null
  let wasOpen = false
  const b = el("button", { class: "icon-btn git-more-btn", type: "button", title: "More", "aria-label": "More actions", "aria-haspopup": "menu", html: MORE_ICON })
  // The menu's light dismiss closes it on the press, before the click: the click mustn't open it again.
  b.addEventListener("pointerdown", () => { wasOpen = ctxMenu?.anchor === b })
  b.addEventListener("click", () => {
    if (wasOpen) { wasOpen = false; return }
    if (touchFirst.matches) return actionSheet(title, items)
    const r = b.getBoundingClientRect()
    contextMenu(r.right, r.bottom + 4, title, items, b)
  })
  return b
}

/** Summary: the branch against its upstream, and its pull request (or how to open one), its checks and description. */
function summaryTab(d, g) {
  const baseName = d.base?.replace(/^origin\//, "") ?? ""
  const pr = d.pr
  const canPush = d.branch && (!d.upstream || d.ahead > 0)
  const canPull = d.upstream && d.behind > 0 && d.ahead === 0 && d.branch === d.current
  const diverged = d.upstream && d.ahead > 0 && d.behind > 0
  const onBase = !d.branch || d.branch === baseName
  const where = !d.upstream
    ? (d.branch ? "not pushed" : "")
    : [d.ahead ? `↑${d.ahead}` : "", d.behind ? `↓${d.behind}` : "", !d.ahead && !d.behind ? "up to date" : ""].filter(Boolean).join(" ")
  const info = [
    icon(BRANCH_PATHS, "git-sub-ico"),
    el("span", { class: "git-branch-name", title: [d.branch, d.upstream ? `tracks ${d.upstream}` : ""].filter(Boolean).join("\n") }, d.branch ? branchLabel(d.branch) : "detached HEAD"),
    where ? el("span", { class: `git-sub-state${d.ahead ? " ahead" : ""}`, text: where, title: d.upstream ? `Against ${d.upstream}` : "" }) : null
  ]
  const actions = []
  if (canPull) actions.push(gitBtn(`Pull ↓${d.behind}`, () => gitAction("pull", {}, `Pulled ${plural(d.behind, "commit")} into ${d.branch}.`), { title: `Fast-forward ${d.branch} to ${d.upstream}` }))
  if (canPush) actions.push(gitBtn(d.upstream ? `Push ↑${d.ahead}` : "Push", () => gitAction("push", { branch: d.branch }, `Pushed ${d.branch}.`), { title: d.upstream ? `Push to ${d.upstream}` : `Push ${d.branch} to origin` }))
  if (pr?.state === "OPEN") actions.push(gitBtn("Merge…", () => mergePr(pr), { primary: true, disabled: pr.isDraft, title: pr.isDraft ? "A draft can't be merged" : `Merge #${pr.number} into ${pr.base}` }))
  else if (!pr && d.gh.ok && !onBase) actions.push(gitBtn("Create PR", () => createPr(d), { primary: true, title: d.upstream ? `Open a pull request for ${d.branch}` : `Push ${d.branch}, then open a pull request for it` }))
  const more = []
  if (pr) more.push({ label: "Open on GitHub", run: () => openOut(pr.url) })
  if (pr?.state === "OPEN") {
    more.push(pr.isDraft
      ? { label: "Ready for review", run: () => gitAction("ready", { number: pr.number }, "Marked ready for review.") }
      : { label: "Convert to draft", run: () => gitAction("ready", { number: pr.number, draft: true }, "Converted to a draft.") })
    more.push({ label: "Edit title and description", run: () => editPr(pr) })
    more.push({ label: "Request reviewers", run: () => requestReviewers(pr) })
    more.push({ label: `Update branch from ${pr.base}`, run: () => gitAction("update", { number: pr.number }, `Updated ${pr.head} from ${pr.base}.`) })
  }
  if (pr?.state === "CLOSED") more.push({ label: "Reopen pull request", run: () => gitAction("reopen", { number: pr.number }, `Reopened #${pr.number}.`) })
  if (pr && pr.state !== "OPEN" && d.gh.ok && !onBase) more.push({ label: "New pull request", run: () => createPr(d) })
  if (!pr && d.gh.ok && !onBase) more.push({ label: "Ask the agent to open a pull request", run: () => askAgent(`Open a pull request from the branch ${d.branch}${baseName ? ` into ${baseName} (\`--base ${baseName}\`)` : ""}: push it if needed, and write a clear title and description from its commits.`) })
  if (diverged) more.push({ label: `Ask the agent to rebase onto ${d.upstream}`, run: () => askAgent(`Rebase ${d.branch} onto ${d.upstream}: run \`git pull --rebase\`, resolve any conflicts, run the checks, and tell me what changed. Don't push.`) })
  more.push({ label: "Fetch from the remotes", run: async () => { gitFetched.set(g.threadId, Date.now()); await gitAction("fetch", {}, "Fetched.") } })
  if (d.upstream) more.push({ label: autoPullOn() ? "Stop pulling automatically" : "Pull automatically", run: () => {
    const on = !autoPullOn()
    save("gitAutoPull", on)
    toast(on ? `While a thread is open, zero fetches every few minutes and fast-forwards its branch when that's safe.` : "Stopped pulling automatically.")
    if (on && gitPanel) { gitFetched.delete(gitPanel.threadId); autoSync() }
    paintGit()
  } })
  if (pr?.state === "OPEN") more.push({ label: "Close pull request", danger: true, run: () => closePr(pr) })
  actions.push(gitMore(pr ? `#${pr.number} ${pr.title}` : d.branch || "Git", more))

  const body = []
  if (pr) body.push(prHead(pr), checksBlock(pr), descriptionBlock(pr))
  else {
    const why = !d.gh.ok ? d.gh.detail || "GitHub isn't reachable from here."
      : onBase ? (d.branch ? `${d.branch} is the default branch: a pull request comes from a branch of its own.` : "Check out a branch to open a pull request.")
        : `Create one for ${d.branch} from here, or ask the agent (under More) to write it from the commits.`
    body.push(el("div", { class: "git-lead" }, el("h3", { class: "git-lead-title", text: "No pull request yet" }), el("p", { class: "git-note", text: why })))
  }
  const notes = [
    diverged ? `${d.branch} has ${plural(d.ahead, "commit")} of its own and is ${d.behind} behind ${d.upstream}, so a pull can't fast-forward it.` : "",
    d.worktree ? `In a worktree: ${d.cwd}` : "",
    d.current && d.branch !== d.current ? `The project is on ${d.current} now; this thread last worked on ${d.branch}.` : "",
    d.upstream && autoPullOn() ? "Pulls automatically while this thread is open." : ""
  ].filter(Boolean)
  if (notes.length) body.push(el("div", { class: "git-foot-notes" }, notes.map((n) => el("p", { class: "git-note", text: n, title: n }))))
  return { info, actions, body }
}

/** The pull request: its state, title, who and where, its size, and its review and merge state. */
function prHead(pr) {
  const state = prState(pr)
  const pills = []
  if (pr.reviewDecision && REVIEW_LABEL[pr.reviewDecision]) pills.push(el("span", { class: `git-pill review-${pr.reviewDecision.toLowerCase()}`, text: REVIEW_LABEL[pr.reviewDecision] }))
  if (state === "open" && MERGE_STATE[pr.mergeState]) pills.push(el("span", { class: `git-pill merge-${pr.mergeState.toLowerCase()}`, text: MERGE_STATE[pr.mergeState] }))
  for (const l of pr.labels) pills.push(el("span", { class: "git-pill label", text: l }))
  return el("div", { class: `git-pr pr-${state}` },
    el("div", { class: "git-pr-top" },
      el("span", { class: `git-state st-${state}` }, icon(PR_PATHS), PR_STATE_LABEL[state] ?? pr.state),
      el("span", { class: "git-when", text: state === "merged" && pr.mergedAt ? `merged ${agoText(pr.mergedAt)}` : `updated ${agoText(pr.updatedAt)}` })),
    el("a", { class: "git-pr-title", href: pr.url, target: "_blank", rel: "noopener noreferrer", title: "Open on GitHub" }, pr.title),
    el("p", { class: "git-pr-meta" },
      el("span", { class: "git-pr-num", text: `#${pr.number}` }), ` by ${pr.author} · `,
      el("span", { class: "git-ref", text: pr.head }), " into ", el("span", { class: "git-ref", text: pr.base })),
    el("p", { class: "git-pr-meta" },
      el("span", { class: "git-add", text: `+${pr.additions}` }), " ", el("span", { class: "git-del", text: `−${pr.deletions}` }),
      ` · ${plural(pr.changedFiles, "file")}`, pr.reviewers.length ? ` · review asked of ${pr.reviewers.join(", ")}` : ""),
    pills.length ? el("div", { class: "git-pills" }, pills) : null)
}

/** A titled part of a tab: a heading in type, not a box. */
const gitBlock = (title, count, extra, ...content) => el("section", { class: "git-block" },
  el("h3", { class: "git-h" }, el("span", { text: title }), count ? el("span", { class: "git-h-n", text: String(count) }) : null, extra),
  ...content)

/** Checks in the order they matter: what failed, what's still going, then what passed or didn't run. */
const CHECK_ORDER = ["failed", "running", "pending", "cancelled", "passed", "neutral", "skipped"]
const QUIET_CHECK = new Set(["passed", "neutral", "skipped"])
function checksBlock(pr) {
  const checks = [...pr.checks].sort((a, b) => CHECK_ORDER.indexOf(a.state) - CHECK_ORDER.indexOf(b.state))
  if (!checks.length) return null
  // Many checks: the ones that passed or were skipped fold away behind a button.
  const fold = checks.length > 10 && !gitPanel?.allChecks
  const quiet = fold ? checks.filter((c) => QUIET_CHECK.has(c.state)) : []
  const shown = fold ? checks.filter((c) => !QUIET_CHECK.has(c.state)) : checks
  const count = (s) => checks.filter((c) => c.state === s).length
  const failed = checks.filter((c) => c.state === "failed")
  const runs = [...new Set(failed.map((c) => c.runId).filter(Boolean))]
  const summary = [["passed", "passed"], ["failed", "failed"], ["running", "running"], ["pending", "waiting"], ["skipped", "skipped"], ["cancelled", "cancelled"]]
    .map(([s, w]) => [count(s), w, s]).filter(([n]) => n > 0)
  return gitBlock("Checks", 0, el("span", { class: "git-check-sum" }, summary.map(([n, w, s]) => el("span", { class: `sum-${s}`, text: `${n} ${w}` }))),
    el("ul", { class: "git-list" }, shown.map((c) => el("li", { class: `git-check ck-${c.state}` },
      el("span", { class: "ck-mark", "aria-label": c.state, title: c.state, text: CHECK_MARK[c.state] }),
      c.url ? el("a", { class: "ck-name", href: c.url, target: "_blank", rel: "noopener noreferrer", title: c.workflow ? `${c.workflow} / ${c.name}` : c.name }, c.workflow ? el("span", { class: "ck-wf", text: `${c.workflow} / ` }) : null, c.name)
        : el("span", { class: "ck-name", text: c.name }),
      el("span", { class: "git-when", text: c.completedAt && c.startedAt ? took(c.startedAt, c.completedAt) : c.state === "running" && c.startedAt ? `${ago(c.startedAt)}` : "" })))),
    quiet.length ? el("button", { class: "git-more", type: "button", onclick: () => { gitPanel.allChecks = true; paintGit() } }, `Show ${quiet.length} more (passed or skipped)`) : null,
    failed.length
      ? el("div", { class: "git-actions" },
        runs.length ? gitBtn("Re-run failed", async () => { for (const id of runs) if (!(await gitAction("rerun", { runId: id }))) return; toast(`Re-running ${runs.length === 1 ? "the failed jobs" : `${runs.length} runs' failed jobs`}.`) }) : null,
        el("button", { class: "btn btn-quiet btn-xs", type: "button", onclick: () => askAgent(fixChecksPrompt(pr, failed)) }, "Ask the agent to fix"))
      : null)
}
function descriptionBlock(pr) {
  return gitBlock("Description", 0, null, pr.body.trim()
    ? el("div", { class: "prose git-prose" }, prose(pr.body))
    : el("p", { class: "git-none", text: "No description." }))
}
const took = (a, b) => {
  const s = Math.max(0, Math.round((Date.parse(b) - Date.parse(a)) / 1000))
  return s < 60 ? `${s}s` : `${Math.floor(s / 60)}m ${s % 60}s`
}

/** Timeline: the branch's commits and the pull request's conversation, one list, newest first. */
function timelineTab(d) {
  const pr = d.pr
  const notes = pr?.notes ?? []
  const info = [el("span", { class: "git-sub-text", text: [plural(d.commits.length, "commit"), pr ? plural(notes.length, "comment") : ""].filter(Boolean).join(" · ") })]
  const actions = pr && notes.some((n) => n.kind === "inline" || n.state === "CHANGES_REQUESTED" || n.kind === "comment")
    ? [el("button", { class: "btn btn-quiet btn-xs", type: "button", title: "Put a prompt in the composer: address the review comments, run the checks, commit and push", onclick: () => askAgent(addressPrompt(pr)) }, "Ask the agent to address")]
    : []
  const events = [
    ...d.commits.map((c) => ({ at: c.at, node: commitEvent(c) })),
    ...notes.map((n) => ({ at: n.at, node: noteNode(n) }))
  ].sort((a, b) => Date.parse(b.at) - Date.parse(a.at))
  const body = [
    pr && pr.state !== "CLOSED" ? commentBox(pr) : null,
    events.length ? el("ol", { class: "git-timeline" }, events.map((e) => e.node)) : el("p", { class: "git-none", text: "Nothing on this branch yet." })
  ]
  return { info, actions, body }
}
function commitEvent(c) {
  return el("li", { class: "git-ev git-ev-commit" },
    el("span", { class: "git-ev-mark", "aria-hidden": "true" }),
    el("div", { class: "git-ev-main" },
      el("p", { class: "git-ev-title", text: c.subject, title: c.subject }),
      el("p", { class: "git-ev-meta" },
        el("code", { class: "git-sha", text: c.sha.slice(0, 7), title: c.sha }), ` · ${c.author} · `,
        el("span", { text: agoText(c.at), title: new Date(c.at).toLocaleString() }))))
}
function noteNode(n) {
  const what = n.kind === "inline"
    ? el("span", { class: "note-where" }, "on ", el("code", { text: `${n.path}${n.line ? `:${n.line}` : ""}` }))
    : n.kind === "review"
      ? el("span", { class: `note-verdict v-${(n.state || "").toLowerCase()}`, text: ({ APPROVED: "approved", CHANGES_REQUESTED: "asked for changes", COMMENTED: "reviewed", DISMISSED: "review dismissed" })[n.state] ?? "reviewed" })
      : el("span", { class: "note-verdict", text: "commented" })
  const when = n.url
    ? el("a", { class: "git-when", href: n.url, target: "_blank", rel: "noopener noreferrer", text: agoText(n.at), title: new Date(n.at).toLocaleString() })
    : el("span", { class: "git-when", text: agoText(n.at) })
  return el("li", { class: `git-ev git-ev-note note-${n.kind}${n.state ? ` v-${n.state.toLowerCase()}` : ""}` },
    el("span", { class: "git-ev-mark", "aria-hidden": "true" }),
    el("div", { class: "git-ev-main" },
      el("p", { class: "note-head" }, el("b", { text: n.author }), " ", what, " · ", when),
      n.body.trim() ? el("div", { class: "prose git-prose" }, prose(n.body)) : null))
}
function commentBox(pr) {
  const ta = el("textarea", { rows: "2", placeholder: `Comment on #${pr.number}…`, "aria-label": "Comment" })
  const send = el("button", { class: "btn btn-primary btn-xs", type: "button" }, "Comment")
  const post = () => withBusy(send, async () => {
    if (!ta.value.trim()) return
    if (await gitAction("comment", { number: pr.number, body: ta.value }, "Comment posted.")) { ta.value = ""; if (gitPanel) gitPanel.draft = "" }
  })
  send.addEventListener("click", post)
  ta.addEventListener("keydown", (e) => { if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) { e.preventDefault(); post() } })
  return el("div", { class: "git-comment" }, ta, el("div", { class: "git-comment-foot" }, el("span", { class: "hint", text: "Ctrl+Enter posts it to GitHub" }), send))
}

/** Code: what's uncommitted (each file's diff on demand) with its commit message, then what the pull request changes. */
function codeTab(d, g) {
  const pr = d.pr
  const n = d.changes.length
  const on = d.current && d.current !== d.branch ? d.current : d.branch
  const info = [el("span", { class: "git-sub-text", text: n ? `${n} uncommitted${on ? ` on ${on}` : ""}` : "Nothing uncommitted" })]
  const actions = n
    ? [gitBtn("Write message", () => writeCommitMessage(g), { title: "Claude's small model reads the diff (up to 12,000 characters) and writes the message" }),
      gitBtn("Commit", () => commitAll(g), { primary: true, cls: "git-commit-go", title: "Commit everything uncommitted (Ctrl+Enter in the message)" })]
    : []
  const body = n
    ? [commitBox(g), el("ul", { class: "git-list git-changes" }, d.changes.map((c) => changeRow(g, c)))]
    : [el("p", { class: "git-none", text: "The working tree is clean." })]
  if (pr?.files.length) {
    body.push(gitBlock(`Changed in #${pr.number}`, pr.files.length, null,
      el("ul", { class: "git-list" }, pr.files.map((f) => el("li", { class: "git-pr-file" },
        el("span", { class: "git-path", text: f.path, title: f.path }),
        el("span", { class: "git-add", text: `+${f.additions}` }),
        el("span", { class: "git-del", text: `−${f.deletions}` }))))))
  }
  return { info, actions, body }
}
/** The commit message: the person's, or one the small model writes from the diff. */
function commitBox(g) {
  const ta = el("textarea", { rows: 2, placeholder: "Commit message", "aria-label": "Commit message" })
  ta.value = g.commitDraft ?? ""
  ta.addEventListener("input", () => { g.commitDraft = ta.value })
  ta.addEventListener("keydown", (e) => { if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) { e.preventDefault(); g.sub.querySelector(".git-commit-go")?.click() } })
  return el("div", { class: "git-comment git-commit-box" }, ta)
}
async function commitAll(g) {
  const message = g.commitDraft ?? ""
  if (!message.trim()) {
    g.body.querySelector(".git-commit-box textarea")?.focus()
    return toast("Write a commit message first, or let Claude write one.", true)
  }
  if (await gitAction("commit", { message }, "Committed.")) g.commitDraft = ""
}
async function writeCommitMessage(g) {
  try {
    const r = await api("POST", `threads/${g.threadId}/git/message`, {})
    g.commitDraft = r.message
    const ta = g.body.querySelector(".git-commit-box textarea")
    if (ta) { ta.value = r.message; ta.focus() }
  } catch (err) { fail(err) }
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
  ["general", "General", '<rect x="2" y="2.5" width="12" height="11" rx="2.5"/><path d="M2 6h12"/>'],
  ["providers", "Providers", '<path d="M8 1.8 13.5 5v6L8 14.2 2.5 11V5z"/><path d="M2.5 5 8 8.2 13.5 5M8 8.2v6"/>'],
  ["threads", "New threads", '<path d="M2.5 3.5h11v7h-6l-3 2.5v-2.5h-2z"/>'],
  ["projects", "Projects", '<path d="M1.75 4.25a1 1 0 0 1 1-1h3.1l1.4 1.5h5.99a1 1 0 0 1 1 1v6.5a1 1 0 0 1-1 1H2.75a1 1 0 0 1-1-1z"/>'],
  ["memory", "Memory", '<path d="M8 2.5a5.5 5.5 0 1 0 5.5 5.5"/><path d="M8 5v3l2 1.5"/><path d="M11 1.8 13.8 2l.2 2.8"/>'],
  ["genome", "Genome", '<path d="M5 1.5c0 4 6 5 6 9.5M11 1.5c0 4-6 5-6 9.5M5 14.5v-3.5M11 14.5v-3.5M6 4h4M6.3 11h3.4"/>'],
  ["remote", "Remote access", '<rect x="4.5" y="1.5" width="7" height="13" rx="1.6"/><path d="M7.2 12.2h1.6"/>'],
  ["storage", "Storage", '<ellipse cx="8" cy="4" rx="5.5" ry="2"/><path d="M2.5 4v8c0 1.1 2.5 2 5.5 2s5.5-.9 5.5-2V4M2.5 8c0 1.1 2.5 2 5.5 2s5.5-.9 5.5-2"/>']
]
let settingsTab = load("settingsTab", "general")
/**
 * Settings › Appearance: the system's light or dark, or one of them always. Kept on this device; in the desktop
 * app it sets the window's own theme too, so its minimize, maximize and close buttons match.
 */
function setTheme(pick) {
  save("theme", pick)
  applyTheme()
}
function applyTheme() {
  const pick = load("theme", "system")
  const root = document.documentElement
  root.dataset.pick = pick
  root.dataset.theme = pick === "system" ? (matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light") : pick
  window.zero?.theme?.(pick)
}
matchMedia("(prefers-color-scheme: dark)").addEventListener("change", applyTheme)
applyTheme()
/** Claude Code's and Codex's versions as the backend last said, so a repaint shows them at once. */
let providerVersions = null
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
  /**
   * The program a provider runs (Claude Code, the Codex CLI): its version, and an Update button when a newer
   * one is out (src/app/ProviderUpdates.ts). The last answer paints at once; the backend's fills it in after.
   */
  const versionRow = (id, name) => {
    const help = el("div", { class: "row-help" })
    const end = el("span", { class: "row-end" })
    const btn = (text, primary, onclick) => el("button", { class: `btn ${primary ? "btn-primary" : "btn-quiet"} btn-xs`, type: "button", text, onclick })
    const paint = (v) => {
      if (!v) {
        help.textContent = "Looking for a newer version…"
        return end.replaceChildren()
      }
      const now = v.current ? `${v.current}, ${v.updated ? "installed from here" : "as zero ships it"}.` : "Not in this copy of zero."
      const news = v.updating ? "Updating…" : v.latest === null ? `Couldn't look for a newer one: ${v.error ?? "no answer"}` : v.newer ? `${v.latest} is out.` : "Up to date."
      help.textContent = `${now} ${news}`
      end.replaceChildren(
        v.updating ? Object.assign(btn("Updating…", false), { disabled: true })
        : v.newer ? btn(`${v.current ? "Update" : "Install"} to ${v.latest}`, true, async (e) => {
          const b = e.currentTarget
          b.disabled = true
          b.textContent = "Updating…"
          help.textContent = `${now} Downloading ${name} ${v.latest}; this can take a minute.`
          try {
            const r = await api("POST", `providers/${id}/update`, {})
            providerVersions = { ...providerVersions, ...r }
            paint(r[id])
            toast(`${name} ${r[id].current} is installed. ${id === "claude" ? "Each thread moves to it at its next message." : "Codex turns run it from now on."}`)
          } catch (err) { fail(err); paint(v) }
        })
        : btn("Look again", false, async (e) => {
          e.currentTarget.disabled = true
          try {
            providerVersions = await api("GET", "providers/versions/fresh")
            paint(providerVersions[id])
          } catch (err) { fail(err); paint(v) }
        }))
    }
    paint(providerVersions?.[id])
    askVersions().then((all) => paint(all[id]), (err) => { if (!providerVersions) help.textContent = `Couldn't look for a newer version: ${err.message}` })
    return el("div", { class: "row" }, el("div", {}, el("div", { class: "row-label", text: name }), help), end)
  }
  /** One look per paint, shared by the rows that show versions. */
  let asked
  const askVersions = () => asked ??= api("GET", "providers/versions").then((v) => (providerVersions = v))
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
  /** A choice of a few, as one segmented control. */
  const segs = (options, get, set, label) => {
    const box = el("div", { class: "seg-ctl", role: "group", "aria-label": label })
    const paint = () => { for (const b of box.children) b.setAttribute("aria-pressed", String(b.dataset.v === get())) }
    box.append(...options.map(([v, l]) => el("button", { type: "button", "data-v": v, text: l, onclick: () => { set(v); paint() } })))
    paint()
    return box
  }
  const sections = {
    general: () => [
      group(null, "These are kept on this device.",
        row("Appearance", "Light, dark, or as the system has it.", segs([["system", "System"], ["light", "Light"], ["dark", "Dark"]], () => load("theme", "system"), setTheme, "Appearance")),
        row("Send messages with", "The other key makes a new line, as Shift Enter always does.", segs([["enter", "Enter"], ["ctrl", chord("Ctrl Enter")]], () => S.sendWith, (v) => { S.sendWith = v; save("sendWith", v) }, "Send messages with")))
    ],
    projects: () => [
      group(null, "A project is a folder on this machine. Threads in it read, edit and run things there.",
        ...S.projects.map((p) => {
          const n = S.threads.filter((t) => t.projectId === p.id).length
          return row(p.name, `${p.path} · ${plural(n, "thread")}`,
            el("span", { class: "row-end" },
              el("button", { class: "btn quiet sm", type: "button", text: "New thread", onclick: () => { d.close(); go(`#/new/${p.id}`) } }),
              el("button", { class: "ib", type: "button", title: "Copy the folder's path", "aria-label": `Copy ${p.name}'s path`, html: I.copy, onclick: () => copyText(p.path, "Folder path copied.") }),
              el("button", { class: "ib", type: "button", title: `Remove ${p.name} from zero`, "aria-label": `Remove ${p.name}`, html: I.trash, onclick: async () => { await removeProject(p); paintSettings() } })))
        }),
        el("div", { class: "set-actions" }, el("button", { class: "btn sm", type: "button", html: `${I.folderPlus}Add project`, onclick: () => { d.close(); addProject() } })))
    ],
    providers: () => [
      group(el("span", { class: "set-title-row" }, "Claude", pill(st?.available, "Ready", "Off")),
        "Through the Claude Agent SDK, signed in the way Claude Code is on this machine.",
        row("On", "Off stops new turns; threads stay.", sw(() => s.claude.enabled, (v) => (s.claude.enabled = v), "Claude on")),
        row("Model for new threads", "Each thread can switch from its composer.", sel((st?.models ?? [s.claude.model]).map((m) => [m, modelName(m)]), () => s.claude.model, (v) => (s.claude.model = v), "Model")),
        row("Effort for new threads", "How hard Claude thinks each step. Higher is slower and costs more.", sel(EFFORTS.claude, () => s.claude.effort, (v) => (s.claude.effort = v), "Effort")),
        versionRow("claude", "Claude Code")),
      group("More providers", "Their models join the model menu, grouped by provider. Switching a thread to another provider starts a new session.",
        other("codex", "OpenAI's Codex, signed in as the Codex CLI is. Runs in its own sandbox and can't stop to ask."),
        s.codex.enabled ? versionRow("codex", "Codex CLI") : null,
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
  if (!sections[settingsTab]) settingsTab = "general"
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
  const close = el("button", { class: "ib set-close", type: "button", title: "Close (Esc)", "aria-label": "Close settings", html: I.x, onclick: () => d.close() })
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
      // A field the meta no longer has was cleared (a queued message that ran, a worktree left).
      for (const k of ["cwd", "workTree", "pr", "queued", "waiting"]) if (!(k in meta)) delete S.open[k]
      if ((ended || moved) && gitPanel?.threadId === meta.id) loadGit()
      if ((ended || moved) && feed?.branch) feed.branch.refresh()
      // Ended: its answer gets its action row, and the work before it folds away (see renderFeed).
      if (ended && feed) renderFeed()
      if (!("effort" in meta)) delete S.open.effort // cleared: back to the provider's default
      if (feed) {
        feed.models.set({ provider: meta.provider, model: meta.model, effort: meta.effort ?? defaultEffort(meta.provider) })
        feed.models.setAccess(meta.access)
        paintReady(S.open)
      }
      for (const k of ["unseen", "pinned", "ended"]) if (!(k in meta)) delete S.open[k]
      markSeen()
      paintWorking()
      renderInfo()
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
/**
 * Ctrl+K (Cmd+K): go to anything. Threads by title or project (the latest first), what threads' messages say
 * (zero.db's search, a moment after the typing stops), new threads in each project, and zero's actions.
 * Enter goes, arrows choose.
 */
function openPalette() {
  const d = $("palette")
  if (d.open) return
  const stateGlyph = (t) => ({ ask: I.ask, failed: I.alert, working: I.spin, settled: I.settle })[stateOf(t)] ?? I.inbox
  const actions = () => [
    { label: "New thread", kbd: "Alt N", glyph: I.compose, run: () => newThread() },
    ...S.projects.map((p) => ({ label: `New thread in ${p.name}`, where: p.path, glyph: I.plus, run: () => go(`#/new/${p.id}`) })),
    { label: "Add project…", glyph: I.folderPlus, run: () => addProject() },
    { label: S.sideOpen ? "Hide sidebar" : "Show sidebar", kbd: "Ctrl B", glyph: I.sideL, run: () => toggleSide() },
    ...(panelAllowed() ? [{ label: gitOpenNow() ? "Hide changes" : "Show changes", kbd: "Ctrl Alt B", glyph: I.sideR, run: () => setPanel(!gitOpenNow()) }] : []),
    ...(S.route.name === "thread" ? [{ label: $("info")?.hidden === false ? "Hide details" : "Show details", kbd: "Ctrl I", glyph: I.card, run: () => toggleInfo() }] : []),
    { label: "Inbox", kbd: "Alt 1", glyph: I.inbox, run: () => { setView("inbox"); if (!S.sideOpen) setSide(true) } },
    { label: "Working", kbd: "Alt 2", glyph: I.spin, run: () => { setView("working"); if (!S.sideOpen) setSide(true) } },
    { label: "Settled", kbd: "Alt 3", glyph: I.settle, run: () => { setView("settled"); if (!S.sideOpen) setSide(true) } },
    { label: "Evolution", where: "zero's lineage and runs", glyph: I.evo, run: () => go("#/evolution") },
    { label: "Settings", kbd: "Ctrl ,", glyph: I.gear, run: () => openSettings() },
    { label: "Keyboard shortcuts", kbd: "?", glyph: I.keys, run: () => openKeys() }
  ]
  const input = el("input", { type: "search", placeholder: "Go to a thread, project or action", "aria-label": "Go to", autocomplete: "off", spellcheck: "false" })
  const list = el("div", { class: "pal-list", role: "listbox" })
  let rows = []
  let at = 0
  let hits = { q: "", list: [] }
  let asking = 0
  const choose = (i) => { const r = rows[i]; d.close(); r?.run() }
  const paint = () => {
    const q = input.value.trim().toLowerCase()
    const words = q.split(/\s+/).filter(Boolean)
    const match = (s) => words.every((w) => s.toLowerCase().includes(w))
    const threads = [...S.threads].filter((t) => !q || match(`${t.title} ${projectName(t.projectId)}`)).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)).slice(0, q ? 30 : 6)
    const listed = new Set(threads.map((t) => t.id))
    const found = q && hits.q === q ? hits.list.filter((h) => h.itemId && !listed.has(h.threadId) && threadMeta(h.threadId)).slice(0, 12) : []
    const acts = actions().filter((a) => !q || match(`${a.label} ${a.where ?? ""}`))
    rows = [
      ...threads.map((t) => ({ head: q ? "Threads" : "Recent", glyph: stateGlyph(t), label: t.title, where: projectName(t.projectId), run: () => go(`#/t/${t.id}`) })),
      ...found.map((h) => ({ head: "In messages", glyph: I.search, label: threadMeta(h.threadId).title, snippet: h.snippet, run: () => { S.jump = h.itemId; go(`#/t/${h.threadId}`) } })),
      ...acts.map((a) => ({ head: "Actions", ...a }))
    ]
    at = Math.min(at, Math.max(0, rows.length - 1))
    const nodes = []
    rows.forEach((r, i) => {
      if (i === 0 || rows[i - 1].head !== r.head) nodes.push(el("div", { class: "pop-h", text: r.head }))
      const b = el("button", { class: `pi${i === at ? " hl" : ""}`, type: "button", role: "option", tabindex: "-1", "aria-selected": String(i === at) },
        icon(r.glyph),
        el("span", { class: "lb" }, r.label, r.snippet ? el("small", {}, ...marked(r.snippet)) : null),
        r.where ? el("span", { class: "where", text: r.where }) : null,
        r.kbd ? el("span", { class: "k", text: chord(r.kbd) }) : null)
      b.addEventListener("mousedown", (e) => { e.preventDefault(); choose(i) })
      b.addEventListener("mousemove", () => { if (at !== i) { at = i; for (const [j, n] of [...list.querySelectorAll(".pi")].entries()) n.classList.toggle("hl", j === at) } })
      nodes.push(b)
    })
    if (!rows.length) nodes.push(el("div", { class: "pal-empty", text: q.length >= 2 && hits.q !== q ? "Searching messages…" : `Nothing matches “${input.value.trim()}”` }))
    list.replaceChildren(...nodes)
    list.querySelectorAll(".pi")[at]?.scrollIntoView({ block: "nearest" })
  }
  /** Search the messages of every thread, a moment after the typing stops. */
  const search = () => {
    clearTimeout(asking)
    const q = input.value.trim().toLowerCase()
    if (q.length < 2) return
    asking = setTimeout(async () => {
      const found = await api("GET", `search/${encodeURIComponent(q)}`).catch(() => [])
      if (input.value.trim().toLowerCase() !== q) return
      hits = { q, list: found }
      paint()
    }, 140)
  }
  input.addEventListener("input", () => { at = 0; paint(); search() })
  input.addEventListener("keydown", (e) => {
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault()
      if (!rows.length) return
      at = (at + (e.key === "ArrowDown" ? 1 : -1) + rows.length) % rows.length
      const items = [...list.querySelectorAll(".pi")]
      items.forEach((n, j) => n.classList.toggle("hl", j === at))
      items[at]?.scrollIntoView({ block: "nearest" })
    } else if (e.key === "Enter" && !e.isComposing) { e.preventDefault(); choose(at) }
  })
  d.replaceChildren(el("div", { class: "pal-in" }, svgEl(I.search), input), list)
  d.addEventListener("close", () => d.replaceChildren(), { once: true })
  d.addEventListener("click", (e) => { if (e.target === d) d.close() })
  paint()
  d.showModal()
  input.focus()
}

// ---------- keys ----------
/** Every key zero answers to, grouped, in one sheet: opened with ?, from the palette, or the sidebar. */
const KEYS = [
  ["Threads", [["Ctrl K", "Go to anything"], ["Alt N", "New thread"], ["Alt ↓ / Alt ↑", "Next or previous thread"], ["Alt S", "Settle, and go to the next"], ["F2", "Rename the thread"], ["Alt 1 / 2 / 3", "Inbox, Working, Settled"]]],
  ["Writing", [["Enter", "Send (or Ctrl Enter: Settings)"], ["Shift Enter", "New line"], ["@", "Point at a file in the project"], ["/", "Commands: zero's, and your Claude Code commands and skills"], ["↑ ↓", "Your earlier messages, in an empty box"]]],
  ["While Claude works", [["Esc", "Stop the turn"], ["Y / Ctrl Enter", "Allow what it asks"], ["N", "Deny it"]]],
  ["Window", [["Ctrl B", "Sidebar"], ["Ctrl Alt B / Alt G", "Changes"], ["Ctrl I", "Thread details"], ["Ctrl ,", "Settings"], ["?", "These shortcuts"], ["/", "Focus the composer"], ["Esc", "Close a menu or panel"]]]
]
function openKeys() {
  if ($("dialog").open || $("palette").open || document.querySelector(".keys-sheet")) return
  const keys = (s) => s.split(" / ").flatMap((part, i) => [i ? el("span", { class: "or", text: "/" }) : null, ...chord(part).split(" ").map((k) => el("kbd", { class: "key", text: k }))]).filter(Boolean)
  const d = el("dialog", { class: "dlg keys-sheet", "aria-label": "Keyboard shortcuts" })
  d.append(el("div", { class: "dlg-h" }, el("h2", { text: "Keyboard shortcuts" }), el("button", { class: "ib", type: "button", "aria-label": "Close", html: I.x, onclick: () => d.close() })),
    el("div", { class: "dlg-b" }, el("dl", { class: "keys" }, ...KEYS.flatMap(([group, rows]) => [el("h3", { text: group }), ...rows.flatMap(([k, what]) => [el("dt", { text: what }), el("dd", {}, ...keys(k))])]))))
  d.addEventListener("click", (e) => { if (e.target === d) d.close() })
  d.addEventListener("close", () => d.remove())
  document.body.append(d)
  d.showModal()
}
const isTyping = (t) => t.isContentEditable || t instanceof HTMLTextAreaElement || t instanceof HTMLInputElement || t instanceof HTMLSelectElement
document.addEventListener("keydown", (e) => {
  const ctrl = e.ctrlKey || e.metaKey
  const k = e.key.length === 1 ? e.key.toLowerCase() : e.key
  if (ctrl && !e.altKey && k === "k") {
    e.preventDefault()
    if ($("palette").open) $("palette").close()
    else if (!$("dialog").open && !$("settings").open && !document.querySelector("dialog.keys-sheet[open]")) openPalette()
    return
  }
  if (document.querySelector("dialog[open]")) return
  const typing = isTyping(e.target)
  if (ctrl && !e.altKey && !e.shiftKey && k === "i") { e.preventDefault(); toggleInfo(); return }
  if (ctrl && e.altKey && (k === "b" || e.code === "KeyB")) { e.preventDefault(); if (panelAllowed()) setPanel(!gitOpenNow()); return }
  if (ctrl && !e.altKey && !e.shiftKey && k === "b") { e.preventDefault(); toggleSide(); return }
  if (ctrl && !e.altKey && k === ",") { e.preventDefault(); openSettings(); return }
  if (e.altKey && !ctrl && (k === "n" || e.code === "KeyN")) { e.preventDefault(); newThread(); return }
  if (e.altKey && !ctrl && (k === "g" || e.code === "KeyG")) { e.preventDefault(); if (panelAllowed()) setPanel(!gitOpenNow()); return }
  if (e.altKey && !ctrl && ["1", "2", "3"].includes(e.code?.replace("Digit", "") ?? k)) {
    e.preventDefault()
    setView(["inbox", "working", "settled"][Number(e.code.replace("Digit", "")) - 1])
    if (!S.sideOpen) setSide(true, !narrow.matches)
    return
  }
  if (e.altKey && !ctrl && (k === "ArrowDown" || k === "ArrowUp")) {
    e.preventDefault()
    const next = neighbour(S.open?.id ?? "", k === "ArrowDown" ? 1 : -1)
    if (next) go(`#/t/${next}`)
    return
  }
  if (e.altKey && !ctrl && (k === "s" || e.code === "KeyS")) {
    e.preventDefault()
    const t = S.open
    if (S.route.name !== "thread" || !t || t.status === "running" || stateOf(t) === "settled") return
    // Settle, and go on to the next thing that needs you.
    const next = S.view === "inbox" ? neighbour(t.id, 1) ?? neighbour(t.id, -1) : null
    settle(threadMeta(t.id) ?? t)
    if (next && next !== t.id) go(`#/t/${next}`)
    return
  }
  if (k === "F2" && S.route.name === "thread" && !typing) { e.preventDefault(); startRename(); return }
  if (k === "Escape") {
    // A menu or a picker closes itself first (their own keys); then what lies over the thread; then a selection.
    if (narrow.matches && S.sideOpen) { e.preventDefault(); return setSide(false, false) }
    if (mid.matches && gitOpenNow()) { e.preventDefault(); return setPanel(false, false) }
    if (!infoDocked() && S.infoOver) { e.preventDefault(); S.infoOver = false; return layoutInfo() }
    // Escape with words selected (the Quote button up) puts the selection away; it doesn't stop the turn.
    if ((quoteShown() || !(getSelection()?.isCollapsed ?? true)) && !typing) {
      e.preventDefault()
      hideQuote()
      getSelection()?.removeAllRanges()
      return
    }
    // Then zero's own: Esc stops a running turn.
    if (S.open?.status === "running") {
      e.preventDefault()
      api("POST", `threads/${S.open.id}/stop`, {}).catch(fail)
    }
    return
  }
  if (typing || ctrl || e.altKey) return
  if (k === "?") { e.preventDefault(); openKeys(); return }
  if (k === "/" && liveBox) { e.preventDefault(); liveBox.focus(); return }
  if (S.open && (k === "y" || k === "n")) {
    const ask = pendingAsk()
    if (ask) { e.preventDefault(); answerAsk(ask, k === "y") }
  }
})

/** A new thread in the project you're in (the first one otherwise). */
function newThread() {
  const pid = S.open?.projectId ?? S.route.projectId ?? S.projects[0]?.id
  if (pid) go(`#/new/${pid}`)
  else addProject()
  requestAnimationFrame(() => liveBox?.focus())
}
$("open-keys").addEventListener("click", () => openKeys())
// An hour idle is reached by the clock, not by an event: look again each minute.
setInterval(() => { if (S.open) paintCompact(S.open) }, 60_000)
// A file dropped anywhere but the thread would open in place of the app; it does nothing instead.
for (const type of ["dragover", "drop"]) {
  addEventListener(type, (e) => { if (e.dataTransfer?.types.includes("Files") && !e.target.closest?.(".composer")) e.preventDefault() })
}
addEventListener("resize", () => { if (S.route.name === "evolution" && S.evo) paintEvo() })
setInterval(() => renderSide(), 60_000)
// Clocks: a running call's, the header's, a compaction's; each second.
setInterval(() => { for (const n of document.querySelectorAll("#main .clock[data-since]")) n.textContent = elapsed(n.dataset.since) }, 1000)

// ---------- start ----------
async function boot() {
  try {
    const b = await api("GET", "bootstrap")
    Object.assign(S, { settings: b.settings, projects: b.projects, threads: b.threads, providers: b.providers, home: b.home, zeroRoot: b.zeroRoot, limits: b.limits ?? [] })
  } catch (e) {
    $("main").replaceChildren(headBar(), el("div", { class: "view" }, el("div", { class: "blank" }, el("div", { class: "blank-in" },
      el("h1", { text: "Can't reach zero" }),
      el("p", { text: `${e.message}. Restart the app; if it keeps happening, run it from a terminal with \`npm run app\` to see why.` })))))
    return
  }
  clampWidths()
  applyShell()
  connect()
  // With the layout in place, let things move.
  requestAnimationFrame(() => requestAnimationFrame(() => app.classList.remove("no-anim")))
  if (!location.hash) {
    const last = load("last", null)
    if (last && S.threads.some((t) => t.id === last)) return go(`#/t/${last}`)
  }
  route()
}
boot()
