import { app, Menu, nativeImage, Tray } from 'electron'
import { join } from 'node:path'

export interface TrayCallbacks {
  onToggleVisible: () => void
  onQuit: () => void
}

/** Resolve a bundled asset both in dev (project root) and when packaged. */
function assetPath(name: string): string {
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

  const menu = Menu.buildFromTemplate([
    { label: 'PixelPet', enabled: false },
    { type: 'separator' },
    { label: 'Show / Hide Pet', click: () => cb.onToggleVisible() },
    // Placeholder until the settings window lands in a later milestone.
    { label: 'Settings…', enabled: false },
    { type: 'separator' },
    { label: 'Quit', click: () => cb.onQuit() }
  ])

  tray.setContextMenu(menu)
  return tray
}
