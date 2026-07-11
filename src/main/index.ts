import { app, BrowserWindow, ipcMain, screen, Menu, type MenuItemConstructorOptions } from 'electron'
import { join } from 'node:path'
import type { AppSettings, AiConfig, AiStatus, ClipName, Personality, TriggerEvent } from '../shared/types'
import { MIN_SCALE, MAX_SCALE, petWindowSize } from '../shared/constants'
import { createTray } from './tray'
import { PetEngine } from './behavior/engine'
import {
  loadSettings, saveSettings, effectivePersonality, findPet, AI_PROVIDERS,
  MIN_TURN_MS, MAX_TURN_MS, MIN_FRONT_SCALE, MAX_FRONT_SCALE
} from './settings'
import { setSelfWindow } from './desktop/windows'
import { testConnection, DEFAULT_MODEL, DEFAULT_ENDPOINT, type VisionConfig } from './ai/providers'
import { generatePetFromPhotos, dataUrlToImage } from './ai/petGenerator'
import { saveApiKey, loadApiKey, hasApiKey, clearApiKey, encryptionAvailable } from './ai/secrets'
import { loadNeeds, saveNeeds } from './care/needs'
import { DIFFICULTIES, type CareAction, type Difficulty } from '../shared/care'

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
    engine.setDisabled(settings.disabledAnims)
    engine.start()
    applyCare()
    // Tell the renderer which pet to draw (the full spec, so user-generated pets
    // — absent from the built-in PETS the renderer imports — render too) and
    // push the live-tunable animation config.
    win.webContents.send('pet:set-pet', findPet(settings, settings.activePetId))
    win.webContents.send('pet:set-config', { turnMs: settings.turnMs, frontScale: settings.frontScale, pupilsByTime: settings.pupilsByTime })
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

// ---- right-click care menu + draggable care items --------------------------

type ItemKind = 'food' | 'toy' | 'medicine'
const ITEM_ACTION: Record<ItemKind, CareAction> = { food: 'feed', toy: 'play', medicine: 'heal' }
let itemWindow: BrowserWindow | null = null
let itemKind: ItemKind = 'food'
let itemDragTimer: ReturnType<typeof setInterval> | null = null

function createItemWindow(): BrowserWindow {
  const size = 52
  const win = new BrowserWindow({
    width: size, height: size, transparent: true, frame: false, resizable: false,
    skipTaskbar: true, hasShadow: false, alwaysOnTop: true, maximizable: false, fullscreenable: false,
    webPreferences: { preload: join(__dirname, '../preload/item.js'), sandbox: false }
  })
  win.setAlwaysOnTop(true, 'screen-saver')
  win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true })
  if (process.env['ELECTRON_RENDERER_URL']) win.loadURL(`${process.env['ELECTRON_RENDERER_URL']}/item.html`)
  else win.loadFile(join(__dirname, '../renderer/item.html'))
  win.on('closed', () => { itemWindow = null; stopItemDrag() })
  return win
}

/** Summon a draggable care item next to the cat (right-click → Bring…). */
function bringItem(kind: ItemKind): void {
  if (!petWindow) return
  itemKind = kind
  if (!itemWindow || itemWindow.isDestroyed()) itemWindow = createItemWindow()
  const win = itemWindow
  const send = (): void => win.webContents.send('item:set', kind)
  if (win.webContents.isLoading()) win.webContents.once('did-finish-load', send)
  else send()
  const b = petWindow.getBounds()
  const s = win.getBounds()
  win.setPosition(Math.round(b.x - s.width - 6), Math.round(b.y + b.height / 2 - s.height / 2))
  win.show()
}

function startItemDrag(): void {
  if (!itemWindow) return
  const [wx, wy] = itemWindow.getPosition()
  const c = screen.getCursorScreenPoint()
  const ox = c.x - wx, oy = c.y - wy
  stopItemDrag()
  itemDragTimer = setInterval(() => {
    if (!itemWindow) return
    const p = screen.getCursorScreenPoint()
    itemWindow.setPosition(p.x - ox, p.y - oy)
  }, 16)
}
function stopItemDrag(): void {
  if (itemDragTimer) { clearInterval(itemDragTimer); itemDragTimer = null }
}

const rectsOverlap = (a: Electron.Rectangle, b: Electron.Rectangle): boolean =>
  a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y

/** Item let go: if it's on the cat, use it (feed/play/heal); else leave it out. */
function onItemDropped(): void {
  stopItemDrag()
  if (!itemWindow || !petWindow) return
  if (rectsOverlap(itemWindow.getBounds(), petWindow.getBounds())) {
    engine?.careAction(ITEM_ACTION[itemKind])
    itemWindow.close()
    itemWindow = null
  }
}

function showPetMenu(): void {
  const items: MenuItemConstructorOptions[] = []
  if (settings.careMode && engine) {
    const st = engine.getStatus()
    items.push({ label: `${st.state.emoji}  ${st.state.label}`, enabled: false })
    items.push({ type: 'separator' })
    items.push({ label: 'Feed', click: () => engine?.careAction('feed') })
    items.push({ label: 'Play', click: () => engine?.careAction('play') })
    items.push({ label: 'Rest', click: () => engine?.careAction('rest') })
    items.push({ label: 'Groom', click: () => engine?.careAction('groom') })
    items.push({ label: 'Give medicine', click: () => engine?.careAction('heal') })
    items.push({ type: 'separator' })
    items.push({
      label: 'Bring an item…',
      submenu: [
        { label: '🥣  Food bowl', click: () => bringItem('food') },
        { label: '🪶  Feather toy', click: () => bringItem('toy') },
        { label: '💊  Medicine', click: () => bringItem('medicine') }
      ]
    })
  } else {
    items.push({ label: 'Care Mode is off', enabled: false })
    items.push({ label: 'Turn on Care Mode…', click: () => openSettings() })
  }
  items.push({ type: 'separator' })
  items.push({ label: 'Settings…', click: () => openSettings() })
  Menu.buildFromTemplate(items).popup()
}

// ---- applying settings changes ---------------------------------------------

/** Swap the active pet: redraw in the renderer + retune the behavior engine. */
function applyActivePet(): void {
  petWindow?.webContents.send('pet:set-pet', findPet(settings, settings.activePetId))
  if (engine) engine.personality = effectivePersonality(settings, settings.activePetId)
  applyCare() // load the newly-active pet's needs
}

/** (Re)configure Care Mode on the engine from settings + the active pet. */
function applyCare(): void {
  if (!engine) return
  if (settings.careMode) {
    const needs = loadNeeds(settings.activePetId, settings.difficulty, Date.now())
    engine.enableCare(needs, settings.difficulty, (n) => saveNeeds(settings.activePetId, n, Date.now()))
  } else {
    engine.disableCare()
  }
}

/** Non-secret AI status for the settings UI. */
function aiStatus(): AiStatus {
  return {
    provider: settings.ai.provider,
    model: settings.ai.model,
    endpoint: settings.ai.endpoint ?? DEFAULT_ENDPOINT[settings.ai.provider],
    hasKey: hasApiKey(),
    encryptionAvailable: encryptionAvailable()
  }
}

/**
 * Assemble the vision config from settings + the stored key. A custom endpoint
 * (e.g. a local Ollama server) may need no key, so we only require one for the
 * default cloud endpoints. Returns null when a key is genuinely required but absent.
 */
function visionConfig(): VisionConfig | null {
  const key = loadApiKey() ?? ''
  const custom = !!settings.ai.endpoint?.trim()
  if (!key && !custom) return null
  return { provider: settings.ai.provider, apiKey: key, model: settings.ai.model, endpoint: settings.ai.endpoint }
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
    // Persist the outgoing pet's needs under its own id before switching.
    if (settings.careMode && engine) saveNeeds(settings.activePetId, engine.getStatus().needs, Date.now())
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
  ipcMain.on('settings:set-anims', (_e, disabled: ClipName[]) => {
    settings.disabledAnims = Array.isArray(disabled) ? disabled : []
    saveSettings(settings)
    engine?.setDisabled(settings.disabledAnims)
  })
  ipcMain.on('settings:set-frontscale', (_e, k: number) => {
    settings.frontScale = Math.max(MIN_FRONT_SCALE, Math.min(MAX_FRONT_SCALE, k))
    saveSettings(settings)
    petWindow?.webContents.send('pet:set-config', { frontScale: settings.frontScale })
  })
  ipcMain.on('settings:set-pupils', (_e, v: boolean) => {
    settings.pupilsByTime = !!v
    saveSettings(settings)
    petWindow?.webContents.send('pet:set-config', { pupilsByTime: settings.pupilsByTime })
  })

  // ---- Care Mode channels ----
  ipcMain.on('settings:set-caremode', (_e, v: boolean) => {
    settings.careMode = !!v
    saveSettings(settings)
    applyCare()
  })
  ipcMain.on('settings:set-difficulty', (_e, d: Difficulty) => {
    if ((DIFFICULTIES as string[]).includes(d)) {
      settings.difficulty = d
      saveSettings(settings)
      engine?.setDifficulty(d)
    }
  })
  ipcMain.handle('care:get', () => engine?.getStatus() ?? null)
  ipcMain.on('care:action', (_e, action: CareAction) => engine?.careAction(action))
  ipcMain.on('pet:context-menu', () => showPetMenu())
  ipcMain.on('item:drag-start', () => startItemDrag())
  ipcMain.on('item:drag-end', () => onItemDropped())
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

  // ---- AI / generate-from-photo channels ----
  ipcMain.handle('ai:status', () => aiStatus())
  ipcMain.on('ai:set-config', (_e, cfg: Partial<AiConfig>) => {
    if (cfg.provider && (AI_PROVIDERS as string[]).includes(cfg.provider)) settings.ai.provider = cfg.provider
    if (typeof cfg.model === 'string') settings.ai.model = cfg.model.trim() || DEFAULT_MODEL[settings.ai.provider]
    settings.ai.endpoint = typeof cfg.endpoint === 'string' && cfg.endpoint.trim() ? cfg.endpoint.trim() : undefined
    saveSettings(settings)
  })
  ipcMain.handle('ai:set-key', (_e, key: string) => {
    saveApiKey(typeof key === 'string' ? key.trim() : '')
    return aiStatus()
  })
  ipcMain.handle('ai:clear-key', () => {
    clearApiKey()
    return aiStatus()
  })
  ipcMain.handle('ai:test', async () => {
    const cfg = visionConfig()
    if (!cfg) return { ok: false, message: 'Add an API key (or set a local endpoint that needs none).' }
    return testConnection(cfg)
  })
  ipcMain.handle('ai:generate', async (_e, dataUrls: string[]) => {
    const cfg = visionConfig()
    if (!cfg) return { ok: false, error: 'Add an API key first (or set a local endpoint that needs none).' }
    if (!Array.isArray(dataUrls) || !dataUrls.length) return { ok: false, error: 'No photo provided.' }
    try {
      const images = dataUrls.slice(0, 4).map(dataUrlToImage)
      const pet = await generatePetFromPhotos(images, cfg)
      settings.userPets.push(pet)
      settings.activePetId = pet.id
      saveSettings(settings)
      applyActivePet()
      return { ok: true, pet }
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) }
    }
  })
  ipcMain.on('pets:delete-user', (_e, petId: string) => {
    const i = settings.userPets.findIndex((p) => p.id === petId)
    if (i < 0) return
    settings.userPets.splice(i, 1)
    delete settings.overrides[petId]
    if (settings.activePetId === petId) settings.activePetId = 'ash'
    saveSettings(settings)
    applyActivePet()
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
    stopItemDrag()
    itemWindow?.destroy()
    engine?.dispose()
    tray?.destroy()
  })
}
