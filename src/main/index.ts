import { app, BrowserWindow, ipcMain, screen } from 'electron'
import { join } from 'node:path'
import type { ClipName, TriggerEvent } from '../shared/types'
import { PET_W, PET_H } from '../shared/constants'
import { createTray } from './tray'
import { PetEngine } from './behavior/engine'
import { DEFAULT_PERSONALITY } from './behavior/personality'

let petWindow: BrowserWindow | null = null
let tray: Electron.Tray | null = null
let engine: PetEngine | null = null

/** Cursor-follow drag state (main moves the window using the OS cursor position). */
let dragTimer: ReturnType<typeof setInterval> | null = null

function createPetWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: PET_W,
    height: PET_H,
    transparent: true,
    frame: false,
    resizable: false,
    maximizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    hasShadow: false,
    focusable: false,
    alwaysOnTop: true,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false
    }
  })

  win.setAlwaysOnTop(true, 'screen-saver')
  win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true })

  // Start click-through; the renderer disables it (per-pixel) over the cat.
  win.setIgnoreMouseEvents(true, { forward: true })

  const [px, py] = defaultPetPosition()
  win.setPosition(px, py)

  if (process.env['ELECTRON_RENDERER_URL']) {
    win.loadURL(`${process.env['ELECTRON_RENDERER_URL']}/pet.html`)
  } else {
    win.loadFile(join(__dirname, '../renderer/pet.html'))
  }

  // Surface renderer errors/warnings in the main-process log for debugging.
  win.webContents.on('console-message', (_e, level, message, line, source) => {
    if (level >= 2) console.error(`[pet-renderer] ${message} (${source}:${line})`)
  })
  win.webContents.on('render-process-gone', (_e, details) => {
    console.error(`[pet-renderer] process gone: ${details.reason}`)
  })

  win.webContents.on('did-finish-load', () => {
    // The renderer can reload (HMR, or navigation); dispose the previous engine
    // so orphaned timers don't keep running and fighting over the window.
    engine?.dispose()
    engine = new PetEngine(win, { ...DEFAULT_PERSONALITY })
    engine.start()
  })

  win.on('closed', () => {
    engine?.dispose()
    engine = null
    petWindow = null
  })

  return win
}

function startDrag(): void {
  if (!petWindow) return
  const [winX, winY] = petWindow.getPosition()
  const cursor = screen.getCursorScreenPoint()
  const offsetX = cursor.x - winX
  const offsetY = cursor.y - winY

  stopDrag()
  dragTimer = setInterval(() => {
    if (!petWindow) return
    const c = screen.getCursorScreenPoint()
    petWindow.setPosition(c.x - offsetX, c.y - offsetY)
  }, 16)
}

function stopDrag(): void {
  if (dragTimer) {
    clearInterval(dragTimer)
    dragTimer = null
  }
}

function defaultPetPosition(): [number, number] {
  const { workArea } = screen.getPrimaryDisplay()
  return [workArea.x + workArea.width - PET_W - 48, workArea.y + workArea.height - PET_H - 48]
}

/** Send the pet back to a known-good on-screen spot (tray "Reset Position"). */
function resetPetPosition(): void {
  if (!petWindow) return
  const [x, y] = defaultPetPosition()
  petWindow.setPosition(x, y)
  if (!petWindow.isVisible()) petWindow.show()
}

/** Nudge the pet fully back on-screen (e.g. after a monitor is unplugged). */
function clampPetOnScreen(): void {
  if (!petWindow || petWindow.isDestroyed()) return
  const [x, y] = petWindow.getPosition()
  const disp = screen.getDisplayNearestPoint({ x: x + Math.round(PET_W / 2), y: y + Math.round(PET_H / 2) })
  const wa = disp.workArea
  const nx = Math.max(wa.x, Math.min(wa.x + wa.width - PET_W, x))
  const ny = Math.max(wa.y, Math.min(wa.y + wa.height - PET_H, y))
  if (nx !== x || ny !== y) petWindow.setPosition(nx, ny)
}

function registerIpc(): void {
  ipcMain.on('pet:set-ignore-mouse', (_e, ignore: boolean) => {
    petWindow?.setIgnoreMouseEvents(ignore, { forward: true })
  })
  ipcMain.on('pet:drag-start', () => {
    startDrag()
    engine?.onDragStart()
  })
  ipcMain.on('pet:drag-end', () => {
    stopDrag()
    engine?.onDragEnd()
  })
  ipcMain.on('pet:trigger', (_e, ev: TriggerEvent) => {
    engine?.emit(ev)
  })
  ipcMain.on('pet:clip-ended', (_e, clip: ClipName) => {
    engine?.onClipEnded(clip)
  })
}

const gotLock = app.requestSingleInstanceLock()
if (!gotLock) {
  app.quit()
} else {
  app.on('second-instance', () => {
    if (!petWindow) petWindow = createPetWindow()
  })

  app.whenReady().then(() => {
    registerIpc()
    petWindow = createPetWindow()
    tray = createTray({
      onToggleVisible: () => {
        if (!petWindow) return
        if (petWindow.isVisible()) petWindow.hide()
        else petWindow.show()
      },
      onResetPosition: () => resetPetPosition(),
      onQuit: () => {
        stopDrag()
        app.quit()
      }
    })

    // Keep the pet reachable when the monitor layout changes.
    screen.on('display-removed', clampPetOnScreen)
    screen.on('display-metrics-changed', clampPetOnScreen)
  })

  app.on('window-all-closed', () => {
    // Tray app: keep running with no visible windows.
  })

  app.on('before-quit', () => {
    stopDrag()
    engine?.dispose()
    tray?.destroy()
  })
}
