/**
 * Desktop notifications, only while zero isn't the window in front: a thread
 * finished its turn or stopped on an error, or a tool call waits for approval.
 * Clicking one brings zero back, on that thread.
 */
import { type BrowserWindow, Notification } from "electron"

interface Event {
  readonly id?: string
  readonly title?: string
  readonly threadId?: string
  readonly item?: { readonly kind: string; readonly state?: string; readonly tool?: string; readonly detail?: string; readonly outcome?: string; readonly error?: string }
}

/** What a hub event is worth telling the person about, if anything. Pure, for tests. */
export const notice = (event: string, data: Event, titles: ReadonlyMap<string, string>): { readonly threadId: string; readonly title: string; readonly body: string } | undefined => {
  const item = data.item
  if (event !== "item" || !item || !data.threadId) return undefined
  const title = titles.get(data.threadId) || "zero"
  if (item.kind === "permission" && item.state === "pending") {
    return { threadId: data.threadId, title, body: `Waiting for your approval: ${item.tool ?? ""} ${item.detail ?? ""}`.trim().slice(0, 200) }
  }
  if (item.kind === "turn" && item.outcome === "done") return { threadId: data.threadId, title, body: "Done. Your turn." }
  if (item.kind === "turn" && item.outcome === "failed") return { threadId: data.threadId, title, body: `Stopped on an error: ${item.error ?? ""}`.slice(0, 200) }
  return undefined
}

export const notifier = (window: () => BrowserWindow | null) => {
  const titles = new Map<string, string>()
  return (event: string, data: unknown) => {
    const e = data as Event
    if (event === "thread" && e.id && e.title) titles.set(e.id, e.title)
    const win = window()
    if (!win || win.isFocused() || !Notification.isSupported()) return
    const n = notice(event, e, titles)
    if (!n) return
    const shown = new Notification({ title: n.title, body: n.body, silent: false })
    shown.on("click", () => {
      if (win.isDestroyed()) return
      if (win.isMinimized()) win.restore()
      win.show()
      win.focus()
      win.webContents.send("event", "open", { threadId: n.threadId })
    })
    shown.show()
  }
}
