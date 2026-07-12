import { app, Menu, nativeImage, Tray } from 'electron'
import { join } from 'node:path'

export interface TrayCallbacks {
  onToggleVisible: () => void
  onResetPosition: () => void
  onOpenSettings: () => void
  onCheckUpdates: () => void
  onRestartToUpdate: () => void
  onQuit: () => void
}

/** Resolve a bundled asset both in dev (project root) and when packaged. */
export function assetPath(name: string): string {
  if (app.isPackaged) {
    return join(process.resourcesPath, 'assets', name)
  }
  // __dirname === out/main in dev builds; assets live at the project root.
  return join(__dirname, '../../assets', name)
}

export function createTray(cb: TrayCallbacks): Tray {
  const image = nativeImage.createFromPath(assetPath('tray.png'))
  const tray = new Tray(image)
  tray.setToolTip('PixelPet')
  applyTrayMenu(tray, cb, { updateReady: false })
  return tray
}

/**
 * (Re)build the tray menu. Call again when the update state changes so the
 * "Restart to update" item can appear once a download is ready.
 */
export function applyTrayMenu(tray: Tray, cb: TrayCallbacks, state: { updateReady: boolean; version?: string | null }): void {
  const menu = Menu.buildFromTemplate([
    { label: 'PixelPet', enabled: false },
    { type: 'separator' },
    { label: 'Show / Hide Pet', click: () => cb.onToggleVisible() },
    { label: 'Reset Position', click: () => cb.onResetPosition() },
    { label: 'Settings…', click: () => cb.onOpenSettings() },
    { type: 'separator' },
    state.updateReady
      ? { label: `Restart to update${state.version ? ` (v${state.version})` : ''}`, click: () => cb.onRestartToUpdate() }
      : { label: 'Check for updates…', click: () => cb.onCheckUpdates() },
    { type: 'separator' },
    { label: 'Quit', click: () => cb.onQuit() }
  ])
  tray.setContextMenu(menu)
}
