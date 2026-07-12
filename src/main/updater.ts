// Auto-update via electron-updater, wired to the GitHub Releases publish target
// (see the `build.publish` config in package.json). In the installed app it
// quietly checks on launch (and every few hours), downloads a newer version in
// the background, and surfaces a "Restart to update" affordance in the tray. In
// dev / unpackaged builds it's a no-op, since there's nothing to update.

import { app, Notification, dialog } from 'electron'
// electron-updater ships CommonJS; import the default and destructure.
import electronUpdater from 'electron-updater'
const { autoUpdater } = electronUpdater

const RECHECK_MS = 6 * 60 * 60 * 1000 // re-check a few times a day for long-running sessions

// Inside a Microsoft Store (MSIX/APPX) package the Store manages updates, and a
// self-updater is both pointless and disallowed. Electron sets this flag then.
const isStoreBuild = (process as unknown as { windowsStore?: boolean }).windowsStore === true

let updateReady = false
let downloadedVersion: string | null = null
let onChange: (() => void) | null = null

/** True once a newer version has finished downloading and is ready to install. */
export function isUpdateReady(): boolean { return updateReady }
/** The version waiting to install, if any. */
export function pendingVersion(): string | null { return downloadedVersion }
/** Notify (e.g. rebuild the tray menu) when the update state changes. */
export function onUpdateStateChange(fn: () => void): void { onChange = fn }

/** Start the background auto-update loop. Safe to call always; no-ops in dev. */
export function initAutoUpdate(): void {
  if (!app.isPackaged || isStoreBuild) return
  autoUpdater.autoDownload = true
  autoUpdater.autoInstallOnAppQuit = true // if they just quit, the update lands next launch

  autoUpdater.on('update-downloaded', (info) => {
    updateReady = true
    downloadedVersion = info.version
    onChange?.()
    new Notification({
      title: 'PixelPet update ready',
      body: `Version ${info.version} is ready — it installs when you quit, or restart now from the tray.`
    }).show()
  })
  autoUpdater.on('error', (err) => console.error('[updater] error', err))

  autoUpdater.checkForUpdates().catch((e) => console.error('[updater] initial check failed', e))
  setInterval(() => { autoUpdater.checkForUpdates().catch(() => { /* transient */ }) }, RECHECK_MS)
}

/** Quit and install the downloaded update now (tray "Restart to update"). */
export function restartToUpdate(): void {
  if (updateReady) autoUpdater.quitAndInstall()
}

/** Manual "Check for updates…" from the tray, with user feedback either way. */
export async function checkForUpdatesManual(): Promise<void> {
  if (isStoreBuild) {
    await dialog.showMessageBox({ type: 'info', message: 'Updates are managed by the Microsoft Store.' })
    return
  }
  if (!app.isPackaged) {
    await dialog.showMessageBox({ type: 'info', message: 'Updates are only checked in the installed app.' })
    return
  }
  if (updateReady) { restartToUpdate(); return }
  try {
    const r = await autoUpdater.checkForUpdates()
    // If a newer version exists it now downloads; 'update-downloaded' takes over.
    if (r && r.updateInfo.version === app.getVersion()) {
      await dialog.showMessageBox({ type: 'info', message: `You're on the latest version (${app.getVersion()}).` })
    }
  } catch (e) {
    await dialog.showMessageBox({ type: 'error', message: 'Could not check for updates.', detail: String(e) })
  }
}
