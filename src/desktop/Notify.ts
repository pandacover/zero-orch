/**
 * Desktop notifications, only while zero isn't the window in front (or has no
 * window: its threads finishing in the background): a thread finished its turn
 * or stopped on an error, or a tool call waits for approval. Clicking one
 * brings zero back, on that thread.
 */
import { Notification } from "electron"

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

/** `focused`: zero's window is the one in front. `open`: bring zero back (a window, if it has none) on a thread. */
export const notifier = (focused: () => boolean, open: (threadId: string) => void) => {
  const titles = new Map<string, string>()
  // Held until dismissed: a Notification nothing references is collected, and its click goes nowhere.
  const live = new Set<Notification>()
  return (event: string, data: unknown) => {
    const e = data as Event
    if (event === "thread" && e.id && e.title) titles.set(e.id, e.title)
    if (focused() || !Notification.isSupported()) return
    const n = notice(event, e, titles)
    if (!n) return
    const shown = new Notification({ title: n.title, body: n.body, silent: false })
    live.add(shown)
    const gone = () => live.delete(shown)
    shown.on("close", gone)
    shown.on("failed", gone)
    shown.on("click", () => {
      gone()
      open(n.threadId)
    })
    shown.show()
  }
}
