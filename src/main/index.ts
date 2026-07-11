import { app, BrowserWindow, ipcMain, screen } from 'electron'
import { join } from 'node:path'
import type { AppSettings, ClipName, Personality, TriggerEvent } from '../shared/types'
import { MIN_SCALE, MAX_SCALE, petWindowSize } from '../shared/constants'
import { createTray } from './tray'
import { PetEngine } from './behavior/engine'
import { loadSettings, saveSettings, effectivePersonality, MIN_TURN_MS, MAX_TURN_MS, MIN_FRONT_SCALE, MAX_FRONT_SCALE } from './settings'
import { setSelfWindow } from './desktop/windows'

let petWindow: BrowserWindow | null = null
let settingsWindow: BrowserWindow | null = null
let tray: Electron.Tray | null = null
let engine: PetEngine | null = null
let settings!: AppSettings // assigned on app-ready, before any window is created

/** Cursor-follow drag state (main moves the window using the OS cursor position). */
let dragTimer: ReturnType<typeof setInterval> | null = null

function createPetWindow(): BrowserWindow {
  const { width, height } = petWindowSize(settings.scale)
  const win = new BrowserWindow({
    width,
    height,
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

  // Tell the window-enumerator to skip our own overlay (so the pet never tries
  // to stand on itself).
  if (process.platform === 'win32') {
    try { setSelfWindow(win.getNativeWindowHandle()) } catch (e) { console.error('[desktop] setSelfWindow failed', e) }
  }

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
    engine = new PetEngine(win, effectivePersonality(settings, settings.activePetId))
    engine.setStayPut(settings.stayPut)
    engine.start()
    // Tell the renderer which pet to draw (it boots on the default cat) and
    // push the live-tunable animation config.
    win.webContents.send('pet:set-pet', settings.activePetId)
    win.webContents.send('pet:set-config', { turnMs: settings.turnMs, frontScale: settings.frontScale })
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
  const { width, height } = petWindowSize(settings.scale)
  return [workArea.x + workArea.width - width - 48, workArea.y + workArea.height - height - 48]
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
  const { width: w, height: h } = petWindow.getBounds()
  const disp = screen.getDisplayNearestPoint({ x: x + Math.round(w / 2), y: y + Math.round(h / 2) })
  const wa = disp.workArea
  const nx = Math.max(wa.x, Math.min(wa.x + wa.width - w, x))
  const ny = Math.max(wa.y, Math.min(wa.y + wa.height - h, y))
  if (nx !== x || ny !== y) petWindow.setPosition(nx, ny)
}

// ---- settings window -------------------------------------------------------

function createSettingsWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: 720,
    height: 620,
    minWidth: 560,
    minHeight: 480,
    title: 'PixelPet Settings',
    backgroundColor: '#1a1b24',
    show: false,
    autoHideMenuBar: true,
    webPreferences: {
      preload: join(__dirname, '../preload/settings.js'),
      sandbox: false
    }
  })
  win.once('ready-to-show', () => win.show())
  win.on('closed', () => { settingsWindow = null })

  if (process.env['ELECTRON_RENDERER_URL']) {
    win.loadURL(`${process.env['ELECTRON_RENDERER_URL']}/settings.html`)
  } else {
    win.loadFile(join(__dirname, '../renderer/settings.html'))
  }
  return win
}

function openSettings(): void {
  if (settingsWindow && !settingsWindow.isDestroyed()) {
    settingsWindow.focus()
    return
  }
  settingsWindow = createSettingsWindow()
}

// ---- applying settings changes ---------------------------------------------

/** Swap the active pet: redraw in the renderer + retune the behavior engine. */
function applyActivePet(): void {
  petWindow?.webContents.send('pet:set-pet', settings.activePetId)
  if (engine) engine.personality = effectivePersonality(settings, settings.activePetId)
}

/** Resize the pet window to a new scale, keeping the pet's feet anchored. */
function applyScale(): void {
  if (!petWindow || petWindow.isDestroyed()) return
  const { x, y, width: ow, height: oh } = petWindow.getBounds()
  const { width, height } = petWindowSize(settings.scale)
  // Anchor bottom-center so the pet grows upward from where it stands.
  const nx = Math.round(x + (ow - width) / 2)
  const ny = y + (oh - height)
  petWindow.setBounds({ x: nx, y: ny, width, height })
  clampPetOnScreen()
}

/** Re-apply the active pet's (possibly overridden) personality to the engine. */
function applyPersonality(petId: string): void {
  if (petId === settings.activePetId && engine) {
    engine.personality = effectivePersonality(settings, settings.activePetId)
  }
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
  ipcMain.on('pet:state-reached', (_e, clip: ClipName) => {
    engine?.onStateReached(clip)
  })

  // ---- settings channels ----
  ipcMain.handle('settings:get', () => settings)
  ipcMain.on('settings:set-pet', (_e, petId: string) => {
    settings.activePetId = petId
    saveSettings(settings)
    applyActivePet()
  })
  ipcMain.on('settings:set-scale', (_e, scale: number) => {
    settings.scale = Math.max(MIN_SCALE, Math.min(MAX_SCALE, Math.round(scale)))
    saveSettings(settings)
    applyScale()
  })
  ipcMain.on('settings:set-turnms', (_e, ms: number) => {
    settings.turnMs = Math.max(MIN_TURN_MS, Math.min(MAX_TURN_MS, Math.round(ms)))
    saveSettings(settings)
    petWindow?.webContents.send('pet:set-config', { turnMs: settings.turnMs })
  })
  ipcMain.on('settings:set-stayput', (_e, v: boolean) => {
    settings.stayPut = !!v
    saveSettings(settings)
    engine?.setStayPut(settings.stayPut)
  })
  ipcMain.on('settings:set-frontscale', (_e, k: number) => {
    settings.frontScale = Math.max(MIN_FRONT_SCALE, Math.min(MAX_FRONT_SCALE, k))
    saveSettings(settings)
    petWindow?.webContents.send('pet:set-config', { frontScale: settings.frontScale })
  })
  ipcMain.on('settings:set-trait', (_e, p: { petId: string; key: keyof Personality; value: number }) => {
    const ov = settings.overrides[p.petId] ?? (settings.overrides[p.petId] = {})
    ov[p.key] = Math.max(0, Math.min(1, p.value))
    saveSettings(settings)
    applyPersonality(p.petId)
  })
  ipcMain.on('settings:reset-traits', (_e, petId: string) => {
    delete settings.overrides[petId]
    saveSettings(settings)
    applyPersonality(petId)
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
    settings = loadSettings()
    registerIpc()
    petWindow = createPetWindow()
    tray = createTray({
      onToggleVisible: () => {
        if (!petWindow) return
        if (petWindow.isVisible()) petWindow.hide()
        else petWindow.show()
      },
      onResetPosition: () => resetPetPosition(),
      onOpenSettings: () => openSettings(),
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
