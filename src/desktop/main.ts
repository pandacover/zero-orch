/**
 * zero's desktop app: one window on the control plane.
 *
 * The backend (src/app/Api.ts) runs in this process. The page reaches it over
 * IPC through preload.cjs, and gets its files and attachments from the
 * `zero://app/` scheme. Nothing listens on a port, so there's no token to mint
 * and no Host header to check.
 */
import { app, BrowserWindow, dialog, type IpcMainInvokeEvent, ipcMain, nativeTheme, net, protocol, shell } from "electron"
import { enableCompileCache } from "node:module"
import { join } from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"
import { isInlineImage } from "../app/Attachments.ts"
import { notifier } from "./Notify.ts"
import { openWorkspace, useLoginPath } from "./Workspace.ts"

const ROOT = fileURLToPath(new URL("../..", import.meta.url)).replace(/[\\/]$/, "")
const PAGE = "zero://app/"

protocol.registerSchemesAsPrivileged([{ scheme: "zero", privileges: { standard: true, secure: true, supportFetchAPI: true } }])

const fail = (e: unknown) => {
  dialog.showErrorBox("zero can't start", String(e instanceof Error ? e.message : e))
  app.exit(2)
}

// One app per machine: two would share ~/.zero and run the same threads twice.
if (!app.requestSingleInstanceLock()) app.quit()
else {
  // Windows shows a toast only for an app with an AppUserModelID: installed, electron-builder.yml's
  // appId (its Start menu shortcut carries it); run from source, electron.exe's path.
  if (process.platform === "win32") app.setAppUserModelId(app.isPackaged ? "com.pandacover.zero" : process.execPath)
  // The backend loads while Electron and the window start up, from V8's compile cache after
  // the first run: it's imported here rather than at the top so neither waits for the other.
  enableCompileCache()
  const packaged = app.isPackaged
  const workspace = (packaged ? useLoginPath() : Promise.resolve()).then(() => openWorkspace({ packaged, bundled: ROOT }))
  const api = Promise.all([import("../app/Api.ts"), workspace]).then(([{ makeApi }, { root, blocked }]) =>
    makeApi({ root, cli: join(root, "src", "cli.ts"), blocked }))
  api.catch(fail)
  let win: BrowserWindow | null = null

  const notFound = () => new Response("not found", { status: 404 })
  /** The page's own files from ui/ (fonts in ui/fonts/), and attachments by id. */
  const serve = async (req: Request): Promise<Response> => {
    const url = new URL(req.url)
    if (url.host !== "app") return notFound()
    const [, first, id] = url.pathname.split("/")
    if (first === "attachments" && id) {
      const a = (await api).attachment(id)
      if (!a) return notFound()
      const file = await net.fetch(pathToFileURL(a.path).href)
      return new Response(file.body, {
        headers: {
          "content-type": isInlineImage(a.mime) ? a.mime : "application/octet-stream",
          "x-content-type-options": "nosniff",
          // A file someone pasted is shown, never run.
          "content-security-policy": "default-src 'none'; img-src 'self'; style-src 'unsafe-inline'; sandbox"
        }
      })
    }
    const file = url.pathname === "/" ? "index.html" : url.pathname.slice(1)
    return /^(fonts\/)?[\w.-]+$/.test(file) ? net.fetch(pathToFileURL(join(ROOT, "ui", file)).href) : notFound()
  }

  /** Only our page may call the backend: not an attachment, not a page a link led to. */
  const trusted = (e: IpcMainInvokeEvent) => {
    const url = e.senderFrame?.url ?? ""
    return url.startsWith(PAGE) && !url.startsWith(`${PAGE}attachments/`)
  }
  const refused = { status: 403, body: { error: "not from zero's page" } }
  ipcMain.handle("call", async (e, method: unknown, path: unknown, body: unknown) =>
    trusted(e) ? (await api).call(String(method), String(path), body) : refused)
  ipcMain.handle("upload", async (e, name: unknown, mime: unknown, bytes: unknown) =>
    trusted(e) && bytes instanceof Uint8Array ? (await api).upload(String(name), String(mime), bytes) : refused)

  /** A link out of the page: the web opens in the browser, an image in the OS viewer, any other file is saved. */
  const open = async (url: string) => {
    if (/^https?:\/\//.test(url)) return void shell.openExternal(url)
    const id = url.startsWith(`${PAGE}attachments/`) ? url.slice(`${PAGE}attachments/`.length) : ""
    const a = id ? (await api).attachment(id) : undefined
    if (!a) return
    if (isInlineImage(a.mime)) void shell.openPath(a.path)
    else win?.webContents.downloadURL(url)
  }

  const createWindow = () => {
    win = new BrowserWindow({
      width: 1280,
      height: 840,
      minWidth: 720,
      minHeight: 480,
      title: "zero",
      // Shown once painted, on the page's own background: no white flash.
      show: false,
      backgroundColor: nativeTheme.shouldUseDarkColors ? "#0d0d0d" : "#ffffff",
      webPreferences: { preload: join(import.meta.dirname, "preload.cjs"), sandbox: true, contextIsolation: true }
    })
    win.once("ready-to-show", () => win?.show())
    win.webContents.setWindowOpenHandler(({ url }) => {
      void open(url)
      return { action: "deny" }
    })
    win.webContents.on("will-navigate", (e, url) => {
      if (url.startsWith(PAGE)) return
      e.preventDefault()
      void open(url)
    })
    const notify = notifier(() => win)
    api.then((a) => {
      const off = a.subscribe((event, data) => {
        win?.webContents.send("event", event, data)
        notify(event, data)
      })
      win?.once("closed", off)
    })
    win.once("closed", () => (win = null))
    void win.loadURL(PAGE)
  }

  app.on("second-instance", () => {
    if (!win) return
    if (win.isMinimized()) win.restore()
    win.focus()
  })
  app.on("window-all-closed", () => app.quit())
  // Running turns and evolution runs stop with the app.
  let closed = false
  app.on("will-quit", (e) => {
    if (closed) return
    e.preventDefault()
    closed = true
    // Quitting again, now past this handler, lets a downloaded update install on the way out.
    api.then((a) => a.close()).finally(() => app.quit())
  })

  app.whenReady().then(() => {
    protocol.handle("zero", serve)
    createWindow()
    if (packaged) void import("./Updates.ts").then((u) => u.pollForUpdates())
  }, fail)
}
