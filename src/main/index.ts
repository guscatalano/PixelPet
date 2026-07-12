import { app, BrowserWindow, ipcMain, screen, Menu, type MenuItemConstructorOptions } from 'electron'
import { join } from 'node:path'
import { existsSync } from 'node:fs'
import { randomUUID } from 'node:crypto'
import { dnaToPet } from '../shared/petdna'
import type { AppSettings, AiConfig, AiStatus, ClipName, Personality, TriggerEvent } from '../shared/types'
import { MIN_SCALE, MAX_SCALE, petWindowSize } from '../shared/constants'
import { createTray, applyTrayMenu, assetPath, type TrayCallbacks } from './tray'
import { initAutoUpdate, onUpdateStateChange, isUpdateReady, pendingVersion, checkForUpdatesManual, restartToUpdate } from './updater'
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
import { saveSourcePhotos, readPhotoDataUrl, deletePetPhotos } from './dream/store'
import {
  fetchAlbumImageIds, fetchThumbnailDataUrl, fetchPreviewDataUrl, testImmich,
  saveImmichKey, loadImmichKey, hasImmichKey, clearImmichKey
} from './dream/immich'
import type { ImmichConfig, ImmichStatus } from '../shared/types'

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
    engine.setEmoter((kind) => petWindow?.webContents.send('pet:emote', kind))
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
    icon: assetPath('icon.png'), // taskbar/titlebar icon (dev too; packaged uses builder icon)
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
        { label: '🧶  Yarn ball', click: () => bringItem('toy') },
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

// ---- dream mode: a sleeping cat dreams of its photos -----------------------

let dreamWindow: BrowserWindow | null = null
let dreamTimer: ReturnType<typeof setInterval> | null = null
let dreamPool: string[] = [] // local file paths (this pet's source photos)
let dreamImmichIds: string[] = [] // Immich album asset ids (shared across pets)
let dreamImmichAt = 0 // when the Immich list was last fetched
let dreamIdx = 0
let dreamLastSwap = 0
let dreamShowing = false
let dreamWasSleeping = false // edge-detect sleep sessions
let dreamThisSession = false // did this nap roll a dream?

const IMMICH_TTL = 30 * 60_000 // re-fetch the album list every 30 min

/** Refresh the Immich asset-id list if configured (fire-and-forget). */
async function refreshImmich(): Promise<void> {
  const im = settings.immich
  const key = loadImmichKey()
  if (!im.serverUrl || !im.albumId || !key) { dreamImmichIds = []; return }
  try {
    dreamImmichIds = await fetchAlbumImageIds(im.serverUrl, im.albumId, key)
    dreamImmichAt = Date.now()
  } catch (err) {
    console.error('[dream] immich fetch failed', err)
  }
}

function immichStatus(): ImmichStatus {
  return { serverUrl: settings.immich.serverUrl, albumId: settings.immich.albumId, hasKey: hasImmichKey() }
}

const DREAM_BASE_W = 120, DREAM_BASE_H = 112
function dreamScale(): number { return Math.max(0.5, Math.min(2.5, settings.dreamBubbleScale ?? 1)) }

function createDreamWindow(): BrowserWindow {
  const s = dreamScale()
  const win = new BrowserWindow({
    width: Math.round(DREAM_BASE_W * s), height: Math.round(DREAM_BASE_H * s),
    transparent: true, frame: false, resizable: false,
    skipTaskbar: true, hasShadow: false, focusable: false, alwaysOnTop: true,
    maximizable: false, fullscreenable: false,
    webPreferences: { preload: join(__dirname, '../preload/dream.js'), sandbox: false }
  })
  win.setAlwaysOnTop(true, 'screen-saver')
  win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true })
  win.setIgnoreMouseEvents(true, { forward: true }) // decorative until the pointer is over it
  win.webContents.once('did-finish-load', () => { if (!win.isDestroyed()) win.webContents.send('dream:scale', dreamScale()) })
  if (process.env['ELECTRON_RENDERER_URL']) win.loadURL(`${process.env['ELECTRON_RENDERER_URL']}/dream.html`)
  else win.loadFile(join(__dirname, '../renderer/dream.html'))
  win.on('closed', () => { dreamWindow = null })
  return win
}

/** Apply a new bubble scale to the live dream window (resize + tell the renderer). */
function applyDreamScale(): void {
  if (!dreamWindow || dreamWindow.isDestroyed()) return
  const s = dreamScale()
  dreamWindow.setSize(Math.round(DREAM_BASE_W * s), Math.round(DREAM_BASE_H * s))
  dreamWindow.webContents.send('dream:scale', s)
}

/** Rebuild the active pet's dream photo pool (on pet swap / generate / delete). */
function refreshDreamPool(): void {
  const pet = findPet(settings, settings.activePetId)
  dreamPool = (pet.dreamPhotos ?? []).filter((p) => existsSync(p))
  dreamIdx = 0
}

async function showDreamPhoto(): Promise<void> {
  const total = dreamPool.length + dreamImmichIds.length
  if (!dreamWindow || !total) return
  const idx = dreamIdx % total
  dreamIdx++
  let url: string | null = null
  if (idx < dreamPool.length) {
    url = readPhotoDataUrl(dreamPool[idx])
    dreamCurrent = { kind: 'local', ref: dreamPool[idx] }
  } else {
    const key = loadImmichKey()
    const id = dreamImmichIds[idx - dreamPool.length]
    if (key) url = await fetchThumbnailDataUrl(settings.immich.serverUrl, id, key)
    dreamCurrent = { kind: 'immich', ref: id }
  }
  if (url && dreamWindow && !dreamWindow.isDestroyed()) dreamWindow.webContents.send('dream:photo', url)
}

/** The photo currently in the bubble — so the viewer can load it full-size. */
let dreamCurrent: { kind: 'local' | 'immich'; ref: string } | null = null
let dreamViewer: BrowserWindow | null = null

/** Open the current dream photo large and centered; dismiss on click / Esc / blur. */
function openDreamViewer(dataUrl: string): void {
  if (dreamViewer && !dreamViewer.isDestroyed()) dreamViewer.close()
  const wa = screen.getDisplayNearestPoint(screen.getCursorScreenPoint()).workArea
  const w = Math.round(wa.width * 0.6), h = Math.round(wa.height * 0.72)
  const win = new BrowserWindow({
    width: w, height: h,
    x: Math.round(wa.x + (wa.width - w) / 2), y: Math.round(wa.y + (wa.height - h) / 2),
    frame: false, backgroundColor: '#0b0c12', show: false, skipTaskbar: true,
    alwaysOnTop: true, resizable: true, webPreferences: { sandbox: true }
  })
  win.setAlwaysOnTop(true, 'screen-saver')
  const html = `<!doctype html><meta charset="utf-8"><style>
    html,body{margin:0;height:100%;background:#0b0c12;overflow:hidden;cursor:zoom-out}
    .w{position:fixed;inset:0;display:flex;align-items:center;justify-content:center;padding:20px;box-sizing:border-box}
    img{max-width:100%;max-height:100%;object-fit:contain;border-radius:10px;box-shadow:0 14px 44px rgba(0,0,0,.6)}
    .h{position:fixed;bottom:12px;left:0;right:0;text-align:center;color:#7f86a0;font:600 12px system-ui,sans-serif}
  </style><div class="w"><img src="${dataUrl}"></div><div class="h">click or press Esc to close</div>
  <script>addEventListener('click',()=>window.close());addEventListener('keydown',e=>{if(e.key==='Escape')window.close()})</script>`
  win.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(html))
  win.webContents.on('before-input-event', (_e, input) => { if (input.key === 'Escape') win.close() })
  win.once('ready-to-show', () => { win.show(); win.focus() })
  win.on('blur', () => { if (!win.isDestroyed()) win.close() })
  win.on('closed', () => { if (dreamViewer === win) dreamViewer = null })
  dreamViewer = win
}

async function openDreamViewerCurrent(): Promise<void> {
  const src = dreamCurrent
  if (!src) return
  let url: string | null = null
  if (src.kind === 'local') {
    url = readPhotoDataUrl(src.ref)
  } else {
    const key = loadImmichKey()
    if (key) url = await fetchPreviewDataUrl(settings.immich.serverUrl, src.ref, key)
  }
  if (url) openDreamViewer(url)
}

function dreamTick(): void {
  const sleeping = !!engine?.isSleeping()
  // Each time the cat drops off to sleep, roll whether this nap dreams at all.
  if (sleeping && !dreamWasSleeping) dreamThisSession = Math.random() < settings.dreamChance
  dreamWasSleeping = sleeping
  const hasPhotos = dreamPool.length + dreamImmichIds.length > 0
  const active = settings.dreamMode && sleeping && dreamThisSession && hasPhotos && !!petWindow
  // Keep the Immich list fresh while dreaming.
  if (settings.dreamMode && settings.immich.albumId && hasImmichKey() && Date.now() - dreamImmichAt > IMMICH_TTL) {
    void refreshImmich()
  }
  if (active) {
    if (!dreamWindow || dreamWindow.isDestroyed()) { dreamWindow = createDreamWindow(); dreamShowing = false }
    const b = petWindow!.getBounds()
    const s = dreamWindow.getBounds()
    const wa = screen.getDisplayMatching(b).workArea
    const y = Math.max(wa.y + 2, b.y - s.height + 10)
    dreamWindow.setPosition(Math.round(b.x + b.width / 2 - s.width / 2), Math.round(y))
    const now = Date.now()
    if (!dreamShowing) {
      dreamWindow.showInactive()
      dreamShowing = true
      dreamLastSwap = now
      const send = (): void => { void showDreamPhoto() }
      if (dreamWindow.webContents.isLoading()) dreamWindow.webContents.once('did-finish-load', send)
      else send()
    } else if (now - dreamLastSwap > 9000) {
      dreamLastSwap = now
      void showDreamPhoto()
    }
  } else if (dreamShowing && dreamWindow) {
    dreamWindow.hide()
    dreamShowing = false
  }
}

function startDreamLoop(): void {
  refreshDreamPool()
  void refreshImmich()
  if (!dreamTimer) dreamTimer = setInterval(dreamTick, 2000)
}

// ---- applying settings changes ---------------------------------------------

/** Swap the active pet: redraw in the renderer + retune the behavior engine. */
function applyActivePet(): void {
  petWindow?.webContents.send('pet:set-pet', findPet(settings, settings.activePetId))
  if (engine) engine.personality = effectivePersonality(settings, settings.activePetId)
  applyCare() // load the newly-active pet's needs
  refreshDreamPool() // the new pet dreams of its own photos
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
  ipcMain.on('settings:set-dreammode', (_e, v: boolean) => {
    settings.dreamMode = !!v
    saveSettings(settings)
    dreamTick() // reflect promptly (hide if just turned off)
  })
  ipcMain.on('settings:set-dreamchance', (_e, v: number) => {
    settings.dreamChance = Math.max(0, Math.min(1, v))
    saveSettings(settings)
  })
  ipcMain.on('settings:set-petfilter', (_e, f: AppSettings['petFilter']) => {
    if (f === 'all' || f === 'builtin' || f === 'user') { settings.petFilter = f; saveSettings(settings) }
  })
  ipcMain.on('settings:play-clip', (_e, clip: ClipName) => engine?.forcePlay(clip))
  // Dream bubble: flip click-through on/off as the pointer enters/leaves it, and
  // open the current photo full-size on a double-click.
  ipcMain.on('dream:set-interactive', (_e, on: boolean) => {
    if (dreamWindow && !dreamWindow.isDestroyed()) dreamWindow.setIgnoreMouseEvents(!on, { forward: true })
  })
  ipcMain.on('dream:open-viewer', () => { void openDreamViewerCurrent() })
  ipcMain.on('settings:set-dreambubblescale', (_e, v: number) => {
    settings.dreamBubbleScale = Math.max(0.5, Math.min(2.5, v))
    saveSettings(settings)
    applyDreamScale()
  })
  ipcMain.handle('immich:status', () => immichStatus())
  ipcMain.on('immich:set-config', (_e, cfg: Partial<ImmichConfig>) => {
    if (typeof cfg.serverUrl === 'string') settings.immich.serverUrl = cfg.serverUrl.trim()
    if (typeof cfg.albumId === 'string') settings.immich.albumId = cfg.albumId.trim()
    saveSettings(settings)
    void refreshImmich()
  })
  ipcMain.handle('immich:set-key', (_e, key: string) => {
    saveImmichKey(typeof key === 'string' ? key.trim() : '')
    void refreshImmich()
    return immichStatus()
  })
  ipcMain.handle('immich:clear-key', () => {
    clearImmichKey()
    dreamImmichIds = []
    return immichStatus()
  })
  ipcMain.handle('immich:test', async () => {
    return testImmich(settings.immich.serverUrl, settings.immich.albumId, loadImmichKey() ?? '')
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
      const shots = dataUrls.slice(0, 4)
      const pet = await generatePetFromPhotos(shots.map(dataUrlToImage), cfg)
      const saved = saveSourcePhotos(pet.id, shots) // the cat dreams of these later
      if (saved.length) pet.dreamPhotos = saved
      settings.userPets.push(pet)
      settings.activePetId = pet.id
      saveSettings(settings)
      applyActivePet()
      return { ok: true, pet }
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) }
    }
  })
  // Build a cat without AI: the renderer sends a PetDNA (from the manual editor
  // or the randomizer); dnaToPet validates/clamps it into a real user pet.
  ipcMain.handle('pets:create', (_e, dna: unknown) => {
    try {
      const pet = dnaToPet(dna, `user-${randomUUID().slice(0, 8)}`)
      settings.userPets.push(pet)
      settings.activePetId = pet.id
      saveSettings(settings)
      applyActivePet()
      return { ok: true, pet }
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) }
    }
  })
  ipcMain.on('pets:rename', (_e, p: { petId: string; name: string }) => {
    const name = typeof p?.name === 'string' ? p.name.trim().slice(0, 24) : ''
    if (!p?.petId) return
    if (name) settings.nameOverrides[p.petId] = name
    else delete settings.nameOverrides[p.petId]
    saveSettings(settings)
  })
  ipcMain.on('pets:delete-user', (_e, petId: string) => {
    const i = settings.userPets.findIndex((p) => p.id === petId)
    if (i < 0) return
    settings.userPets.splice(i, 1)
    delete settings.overrides[petId]
    deletePetPhotos(petId) // remove its saved dream photos
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
    const trayCb: TrayCallbacks = {
      onToggleVisible: () => {
        if (!petWindow) return
        if (petWindow.isVisible()) petWindow.hide()
        else petWindow.show()
      },
      onResetPosition: () => resetPetPosition(),
      onOpenSettings: () => openSettings(),
      onCheckUpdates: () => { void checkForUpdatesManual() },
      onRestartToUpdate: () => restartToUpdate(),
      onQuit: () => {
        stopDrag()
        app.quit()
      }
    }
    tray = createTray(trayCb)

    // Auto-update: rebuild the tray menu when an update finishes downloading so
    // "Restart to update" appears.
    onUpdateStateChange(() => {
      if (tray) applyTrayMenu(tray, trayCb, { updateReady: isUpdateReady(), version: pendingVersion() })
    })
    initAutoUpdate()

    startDreamLoop()

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
    if (dreamTimer) clearInterval(dreamTimer)
    dreamWindow?.destroy()
    engine?.dispose()
    tray?.destroy()
  })
}
