// Before the first paint: the theme (Settings › Appearance, else the system's), so nothing flashes.
// In a headless check, ?wco=1 stands in for the desktop window's own buttons at the top right.
"use strict"
;(() => {
  const root = document.documentElement
  let pick = "system"
  try { pick = JSON.parse(localStorage.getItem("zero.theme")) || "system" } catch {}
  root.dataset.pick = pick
  root.dataset.theme = pick === "system" ? (matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light") : pick
  const q = new URLSearchParams(location.search)
  if (q.get("wco") === "1") root.classList.add("wco-stand-in")
  if (q.get("motion") === "0") root.classList.add("no-motion")
})()
