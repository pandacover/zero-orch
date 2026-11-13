/**
 * Updates for the installed app: every five minutes it asks GitHub's latest
 * release whether there's a newer version, downloads it in the background,
 * and offers a restart. Unrestarted, it installs on the next quit.
 */
import { dialog, shell } from "electron"
import updater from "electron-updater"
import { REPO } from "./Workspace.ts"

const EVERY_MS = 5 * 60_000

export const pollForUpdates = (): void => {
  const { autoUpdater } = updater
  autoUpdater.autoInstallOnAppQuit = true
  autoUpdater.logger = null
  let available = "" // a newer version being fetched
  let offered = "" // the version the person was last told about, so a poll never asks twice

  const check = () => void autoUpdater.checkForUpdates().catch(() => {})
  const timer = setInterval(check, EVERY_MS)

  autoUpdater.on("update-available", (info) => (available = info.version))
  autoUpdater.on("update-downloaded", async (info) => {
    clearInterval(timer)
    const { response } = await dialog.showMessageBox({
      type: "info",
      buttons: ["Restart now", "Later"],
      defaultId: 0,
      cancelId: 1,
      message: `zero ${info.version} is ready`,
      detail: "Restart to use it now, or it installs the next time you quit."
    })
    if (response === 0) autoUpdater.quitAndInstall()
  })
  // A failed check (offline, rate limited) waits for the next poll. A failed download or install,
  // such as a Mac build without a Developer ID that can't replace itself, sends the person to the
  // release page instead, once per version.
  autoUpdater.on("error", async (e) => {
    if (!available || offered === available) return
    offered = available
    const { response } = await dialog.showMessageBox({
      type: "info",
      buttons: ["Download", "Later"],
      defaultId: 0,
      cancelId: 1,
      message: `zero ${available} is out`,
      detail: `It couldn't install itself (${e.message}). Download it from GitHub instead.`
    })
    if (response === 0) shell.openExternal(`${REPO.replace(/\.git$/, "")}/releases/tag/v${available}`).catch(() => {})
  })

  check()
}
