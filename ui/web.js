// The page in a browser, from remote access (src/app/Remote.ts): the same three calls on
// `window.zero` that src/desktop/preload.cjs gives the desktop window, over HTTP instead of IPC.
// In the window `zero` is already there, and this does nothing.
"use strict"

if (!window.zero) {
  const unpaired = () => location.reload() // the server answers an unpaired browser with its pairing page
  const answer = async (res) => {
    if (res.status === 401) unpaired()
    return { status: res.status, body: await res.json().catch(() => ({ error: `request failed (${res.status})` })) }
  }
  const offline = (e) => ({ status: 503, body: { error: `can't reach zero (${e.message}); is the app still running on your computer?` } })

  window.zero = {
    call: (method, path, body) =>
      fetch(`/api/${path}`, {
        method,
        headers: { "x-zero": "1", ...(body === undefined ? {} : { "content-type": "application/json" }) },
        body: body === undefined ? undefined : JSON.stringify(body)
      }).then(answer, offline),
    upload: (name, mime, bytes) =>
      fetch("/api/attachments", { method: "POST", headers: { "x-zero": "1", "content-type": mime, "x-file-name": encodeURIComponent(name) }, body: bytes }).then(answer, offline),
    /**
     * Every live event, as (name, data). A phone drops the stream when it sleeps; on the way back
     * the page hears `resync`, since it missed whatever happened meanwhile.
     */
    on: (listener) => {
      let opened = false
      let wait = 1000
      const connect = () => {
        const es = new EventSource("/api/events")
        es.onopen = () => {
          if (opened) listener("resync", {})
          opened = true
          wait = 1000
        }
        es.onmessage = (e) => {
          const { event, data } = JSON.parse(e.data)
          listener(event, data)
        }
        // The browser retries a dropped stream itself; one it gave up on (an error answer) is retried
        // here, after asking whether this device is still paired.
        es.onerror = () => {
          if (es.readyState !== EventSource.CLOSED) return
          setTimeout(async () => {
            const res = await fetch("/api/ping").catch(() => undefined)
            if (res?.status === 401) return unpaired()
            wait = Math.min(wait * 2, 15000)
            connect()
          }, wait)
        }
      }
      connect()
      // Back from a while in the background: a stream the phone froze can look open and have missed things.
      let hiddenAt = 0
      document.addEventListener("visibilitychange", () => {
        if (document.visibilityState === "hidden") hiddenAt = Date.now()
        else if (opened && Date.now() - hiddenAt > 30000) listener("resync", {})
      })
    }
  }
}
