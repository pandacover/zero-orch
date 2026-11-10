// The page's only way to the backend: three calls on `window.zero`, no Node.
// CommonJS because sandboxed preloads can't be ES modules.
const { contextBridge, ipcRenderer } = require("electron")

contextBridge.exposeInMainWorld("zero", {
  /** One request: resolves to { status, body }. */
  call: (method, path, body) => ipcRenderer.invoke("call", method, path, body),
  /** A file's bytes: resolves to { status, body }, the saved attachment on success. */
  upload: (name, mime, bytes) => ipcRenderer.invoke("upload", name, mime, bytes),
  /** Every live event, as (name, data). */
  on: (listener) => { ipcRenderer.on("event", (_e, event, data) => listener(event, data)) }
})
