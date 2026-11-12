/**
 * zero's desktop app: one window on the control plane.
 *
 * The backend (src/app/Api.ts) runs in this process. The page reaches it over
 * IPC through preload.cjs, and gets its files and attachments from the
 * `zero://app/` scheme. Nothing listens on a port for this window. Remote
 * access (src/app/Remote.ts), when Settings turns it on, serves the same page
 * and backend over HTTP on 127.0.0.1 for other devices, with its own pairing.
 *
 * Closing the window doesn't stop work: while a thread's turn or an evolution
 * run is going, zero keeps running in the background (an icon in the tray, the
 * notifications as before) and quits once it all ends. Quit from the tray stops it.
 */
import { app, BrowserWindow, dialog, type IpcMainInvokeEvent, ipcMain, Menu, nativeImage, nativeTheme, net, Notification, protocol, shell, Tray } from "electron"
import { statSync } from "node:fs"
import { enableCompileCache } from "node:module"
import { join } from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"
import type { Api } from "../app/Api.ts"
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
  const api = Promise.all([import("../app/Api.ts"), import("../app/Remote.ts"), import("../app/Store.ts"), workspace]).then(
    async ([{ makeApi }, { withRemote }, { appHome }, { root, blocked }]) =>
      withRemote(await makeApi({ root, cli: join(root, "src", "cli.ts"), blocked, listModels: true }), { ui: join(ROOT, "ui"), home: appHome() }))
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

  /**
   * A link out of the page: the web opens in the browser, an image in the OS viewer, any other file is saved.
   * A thread's "Open in VS Code" opens VS Code's own link; its "Show folder" opens a folder (only a folder:
   * a file would run, and a link in a page mustn't run anything).
   */
  const open = async (url: string) => {
    if (/^https?:\/\//.test(url)) return void shell.openExternal(url)
    if (/^vscode(-insiders)?:\/\/file\//.test(url)) return void shell.openExternal(url)
    if (url.startsWith("file:")) {
      const path = fileURLToPath(url)
      if (statSync(path, { throwIfNoEntry: false })?.isDirectory()) void shell.openPath(path)
      return
    }
    const id = url.startsWith(`${PAGE}attachments/`) ? url.slice(`${PAGE}attachments/`.length) : ""
    const a = id ? (await api).attachment(id) : undefined
    if (!a) return
    if (isInlineImage(a.mime)) void shell.openPath(a.path)
    else win?.webContents.downloadURL(url)
  }

  /**
   * On Windows and Linux the page is the whole window: no system title bar or menu bar (the menu's
   * shortcuts still work), and the minimize, maximize and close buttons drawn over its top right, as
   * tall as the page's header row (app.css keeps its own buttons clear of them, and drags by its headers).
   * macOS keeps its own title bar.
   */
  const OVERLAY_HEIGHT = 54
  const overlay = () => nativeTheme.shouldUseDarkColors
    ? { color: "#0d0d0d", symbolColor: "#a3a3a3", height: OVERLAY_HEIGHT }
    : { color: "#ffffff", symbolColor: "#666666", height: OVERLAY_HEIGHT }
  const frame = () => process.platform === "darwin" ? {} : { titleBarStyle: "hidden" as const, titleBarOverlay: overlay() }
  // The buttons follow the system's light or dark, as the page does.
  nativeTheme.on("updated", () => {
    if (process.platform !== "darwin" && win && !win.isDestroyed()) win.setTitleBarOverlay(overlay())
  })

  /** zero's window, opened if it was closed, on `threadId` if given. */
  const openWindow = (threadId?: string) => {
    if (!win) return createWindow(threadId)
    if (win.isMinimized()) win.restore()
    win.show()
    win.focus()
    if (threadId) win.webContents.send("event", "open", { threadId })
  }

  const createWindow = (threadId?: string) => {
    tray?.destroy()
    tray = null
    win = new BrowserWindow({
      width: 1280,
      height: 840,
      minWidth: 720,
      minHeight: 480,
      title: "zero",
      // Shown once painted, on the page's own background: no white flash.
      show: false,
      backgroundColor: nativeTheme.shouldUseDarkColors ? "#0d0d0d" : "#ffffff",
      ...frame(),
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
    const own = win
    api.then((a) => {
      const off = a.subscribe((event, data) => own.webContents.send("event", event, data))
      own.once("closed", off)
    })
    own.once("closed", () => {
      if (win === own) win = null
    })
    void own.loadURL(threadId ? `${PAGE}#/t/${threadId}` : PAGE)
  }

  // --- in the background: the window closed while work goes on ---
  let tray: Tray | null = null
  /** zero is quitting: past the point where work keeps it open. */
  let closed = false
  /** What's still going, in words ("2 threads", "a thread and an evolution run"), or "" when nothing is. */
  const going = (a: Api): string => {
    const b = a.busy()
    return [b.threads ? (b.threads === 1 ? "a thread" : `${b.threads} threads`) : "", b.evolution ? "an evolution run" : ""].filter(Boolean).join(" and ")
  }
  /** With no window: show what's still going in the tray, or quit once nothing is. */
  const settle = (a: Api) => {
    if (win || closed) return
    const what = going(a)
    if (!what) return app.quit()
    const tip = `zero: still working on ${what}`
    if (!tray) {
      tray = new Tray(nativeImage.createFromPath(join(ROOT, "ui", "icon-192.png")).resize({ width: 16, height: 16 }))
      tray.on("click", () => openWindow())
    }
    tray.setToolTip(tip)
    tray.setContextMenu(Menu.buildFromTemplate([
      { label: tip, enabled: false },
      { type: "separator" },
      { label: "Open zero", click: () => openWindow() },
      { label: `Quit, stopping ${what}`, click: () => app.quit() }
    ]))
  }

  app.on("second-instance", () => openWindow())
  app.on("activate", () => openWindow())
  // Closing the window while work goes on leaves zero running in the background until it ends.
  app.on("window-all-closed", () => {
    api.then((a) => {
      const what = going(a)
      if (!what) return app.quit()
      settle(a)
      if (Notification.isSupported()) {
        new Notification({ title: "zero is still working", body: `It keeps going on ${what} in the background and quits when that's done. Open it again from the tray.`, silent: true }).show()
      }
    }, () => app.quit())
  })
  // Quitting stops running turns and evolution runs.
  app.on("will-quit", (e) => {
    if (closed) return
    e.preventDefault()
    closed = true
    tray?.destroy()
    tray = null
    // Quitting again, now past this handler, lets a downloaded update install on the way out.
    api.then((a) => a.close()).finally(() => app.quit())
  })

  app.whenReady().then(() => {
    protocol.handle("zero", serve)
    createWindow()
    // Notifications, and the background's tray, follow the app, not a window: they go on with the window closed.
    const notify = notifier(() => win?.isFocused() ?? false, openWindow)
    void api.then((a) => a.subscribe((event, data) => {
      notify(event, data)
      // After the event's own change is done: a turn that ended is out of `busy` by then.
      setImmediate(() => settle(a))
    }))
    if (packaged) void import("./Updates.ts").then((u) => u.pollForUpdates())
  }, fail)
}
