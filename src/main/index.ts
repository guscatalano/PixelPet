import { app, BrowserWindow, ipcMain, screen, Menu, dialog, powerMonitor, type MenuItemConstructorOptions } from 'electron'
import { join } from 'node:path'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { randomUUID } from 'node:crypto'
import { loadCreature } from '../shared/creature'
import type { AppSettings, AiConfig, AiStatus, ClipName, Collar, LoginItem, Personality, TriggerEvent } from '../shared/types'
import { DEFAULT_COLLAR } from '../shared/types'
import { snapScale, petWindowSize } from '../shared/constants'
import { createTray, applyTrayMenu, assetPath, type TrayCallbacks } from './tray'
import { initAutoUpdate, onUpdateStateChange, isUpdateReady, pendingVersion, checkForUpdatesManual, restartToUpdate } from './updater'
import { PetEngine } from './behavior/engine'
import {
  loadSettings, saveSettings, effectivePersonality, findPet, AI_PROVIDERS,
  MIN_TURN_MS, MAX_TURN_MS, MIN_FRONT_SCALE, MAX_FRONT_SCALE, DETAIL_LEVELS
} from './settings'
import { setSelfWindow, enumWindowsTitled } from './desktop/windows'
import { clampWinCoord, winPoint } from './desktop/coords'
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

// ---- OS-driven shutdown (session end / MSIX quiesce) ------------------------
// Windows has to see every process in a package exit before it can replace that
// package on disk, so an MSIX auto-update asks the running app to quiesce first.
// A tray app deliberately outlives `window-all-closed`, so nothing here answered
// that request: the deployment waited ~30s, gave up, and force-killed us — which
// lands in the event log as an Application Hang (HangType=Quiesce) rather than a
// clean exit, and looks like a crash to the user every time the app updates.

/** True once a quit is underway, from either the user or the OS. */
let quitting = false

/** Exit because the OS asked us to, not because the user did. Idempotent. */
function quitForOs(reason: string): void {
  if (quitting) return
  quitting = true
  console.log(`[lifecycle] shutting down: ${reason}`)
  // The OS only waits so long before killing us, and a wedged renderer can stall
  // app.quit() past that. Hard-exit well inside the budget as a backstop; unref
  // so this timer can never be the thing keeping the process alive.
  setTimeout(() => app.exit(0), 4000).unref()
  app.quit()
}

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
  win.setBounds({ x: px, y: py, width, height })

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
    engine.setWindowSize(petWindowSize(settings.scale))
    engine.setStayPut(settings.stayPut)
    engine.setFaceChance(settings.faceChance)
    engine.setDisabled(settings.disabledAnims)
    engine.setEmoter((kind) => petWindow?.webContents.send('pet:emote', kind))
    engine.setKnocker((x, y) => dropKnockedObject(x, y))
    engine.setStringToy({
      show: showStringToy,
      pivot: (x, y) => stringSend('string:pivot', { x, y }),
      hit: (vx, vy) => stringSend('string:hit', { vx, vy }),
      grab: (x, y) => stringSend('string:catch', { x, y }),
      release: () => stringSend('string:release'),
      hide: hideStringToy
    })
    engine.start()
    applyCare()
    // Tell the renderer which pet to draw (the full spec, so user-generated pets
    // — absent from the built-in PETS the renderer imports — render too) and
    // push the live-tunable animation config.
    win.webContents.send('pet:set-pet', findPet(settings, settings.activePetId))
    win.webContents.send('pet:set-config', { turnMs: settings.turnMs, frontScale: settings.frontScale, pupilsByTime: settings.pupilsByTime, detail: settings.detail })
  })

  // Show/Hide only ever hide()s this window and nothing else closes it, so an
  // incoming close is the OS telling us to go away — a package quiesce, the end
  // of the session, or Task Manager's "End task". Take it as a quit signal.
  win.on('close', () => quitForOs('pet window closed by the OS'))

  // Windows-only: log off / restart / force shutdown (WM_ENDSESSION). We get very
  // little time on this path, which is what quitForOs's hard-exit backstop is for.
  win.on('session-end', () => quitForOs('session ending'))

  win.on('closed', () => {
    engine?.dispose()
    engine = null
    petWindow = null
  })

  return win
}

/**
 * Move the pet window, restating its intended size. A bare setPosition lets
 * Windows re-derive the size from a rounded DIP<->pixel conversion at non-100%
 * scaling, and repeated moves make the pet grow (see the physics tick in engine).
 */
function placePet(x: number, y: number): void {
  if (!petWindow || petWindow.isDestroyed()) return
  petWindow.setBounds({ x: clampWinCoord(x), y: clampWinCoord(y), ...petWindowSize(settings.scale) })
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
    placePet(c.x - offsetX, c.y - offsetY)
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

// ---- "Find Cat": ping a sonar so you can spot where your pet went -----------

/** How long the sonar overlay lives — must outlast the CSS animation. */
const SONAR_MS = 2900

let sonarWindow: BrowserWindow | null = null
let sonarTimer: ReturnType<typeof setTimeout> | null = null

/** A few expanding rings centered on the pet, then it tears itself down. */
function pingSonar(): void {
  if (!petWindow || petWindow.isDestroyed()) return
  // Restart cleanly if the menu item gets clicked repeatedly.
  if (sonarTimer) { clearTimeout(sonarTimer); sonarTimer = null }
  if (sonarWindow && !sonarWindow.isDestroyed()) sonarWindow.destroy()

  const b = petWindow.getBounds()
  // Big enough for the rings to expand well clear of the pet at any size.
  const size = Math.max(320, Math.round(Math.max(b.width, b.height) * 3.4))
  const win = new BrowserWindow({
    width: size, height: size,
    x: Math.round(b.x + b.width / 2 - size / 2),
    y: Math.round(b.y + b.height / 2 - size / 2),
    transparent: true, frame: false, resizable: false, show: false,
    skipTaskbar: true, hasShadow: false, focusable: false, alwaysOnTop: true,
    maximizable: false, fullscreenable: false,
    webPreferences: { sandbox: true }
  })
  win.setAlwaysOnTop(true, 'screen-saver')
  win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true })
  win.setIgnoreMouseEvents(true) // purely decorative — never eat a click
  win.once('ready-to-show', () => { if (!win.isDestroyed()) win.showInactive() })
  win.on('closed', () => { if (sonarWindow === win) sonarWindow = null })

  if (process.env['ELECTRON_RENDERER_URL']) win.loadURL(`${process.env['ELECTRON_RENDERER_URL']}/sonar.html`)
  else win.loadFile(join(__dirname, '../renderer/sonar.html'))
  sonarWindow = win

  sonarTimer = setTimeout(() => {
    sonarTimer = null
    if (!win.isDestroyed()) win.destroy()
  }, SONAR_MS)
}

/**
 * Tray "Find Cat" — the escape hatch for "where did it go?". Unlike Reset
 * Position it doesn't move the pet: it just makes sure the pet is showing, fully
 * on-screen and back on top, then pings the sonar so your eye can find it.
 */
/**
 * Show or hide the pet — and everything that belongs to it.
 *
 * The pet is not one window. The string toy, the dream bubble, a knocked-off
 * object and a dragged care item are each their own always-on-top window, and
 * hiding only the pet used to leave whichever were open floating on screen with
 * no cat: the string toy in particular, since play can run for a while. Worse,
 * the engine kept running, so a hidden cat could START playing and pop a fresh
 * string up out of nowhere. One place owns this now so nothing gets missed.
 */
function setPetVisible(on: boolean): void {
  if (!petWindow || petWindow.isDestroyed()) return
  engine?.setHidden(!on) // stand the behaviour down BEFORE hiding, so nothing respawns
  if (on) {
    petWindow.show()
    clampPetOnScreen()
    ensureOnTop()
    return
  }
  hideStringToy()
  stopItemDrag()
  if (itemWindow && !itemWindow.isDestroyed()) itemWindow.destroy()
  if (knockedTimer) { clearTimeout(knockedTimer); knockedTimer = null }
  if (knockedWindow && !knockedWindow.isDestroyed()) knockedWindow.destroy()
  if (sonarTimer) { clearTimeout(sonarTimer); sonarTimer = null }
  if (sonarWindow && !sonarWindow.isDestroyed()) sonarWindow.destroy()
  if (dreamWindow && !dreamWindow.isDestroyed()) dreamWindow.hide()
  dreamShowing = false
  petWindow.hide()
}

function findCat(): void {
  if (!petWindow || petWindow.isDestroyed()) {
    petWindow = createPetWindow() // gone entirely — a fresh one lands somewhere obvious
    return
  }
  if (!petWindow.isVisible()) setPetVisible(true) // wakes the behaviour back up too
  clampPetOnScreen()
  ensureOnTop()
  engine?.forcePlay('react') // a little perk-up, so it's obvious which pixels are the cat
  pingSonar()
}

/** Send the pet back to a known-good on-screen spot (tray "Reset Position"). */
function resetPetPosition(): void {
  if (!petWindow) return
  const [x, y] = defaultPetPosition()
  placePet(x, y)
  if (!petWindow.isVisible()) setPetVisible(true)
}

// ---- staying on top ---------------------------------------------------------
// Windows quietly strips WS_EX_TOPMOST from our overlays in situations we get no
// event for: another app going exclusive-fullscreen, explorer.exe restarting, the
// secure desktop (UAC prompt, lock screen) coming and going. The pet then ends up
// stuck *behind* every window with no way for the user to get it back. Re-assert
// the flag on a slow timer, and immediately after the events most likely to have
// clobbered it. Cheap: a no-op SetWindowPos when we're already on top.

const TOPMOST_TICK_MS = 4000
let topmostTimer: ReturnType<typeof setInterval> | null = null

/** Re-assert always-on-top for every overlay that's currently showing. */
function ensureOnTop(): void {
  for (const w of [petWindow, itemWindow, dreamWindow]) {
    if (w && !w.isDestroyed() && w.isVisible()) w.setAlwaysOnTop(true, 'screen-saver')
  }
}

/** Nudge the pet fully back on-screen (e.g. after a monitor is unplugged). */
function clampPetOnScreen(): void {
  if (!petWindow || petWindow.isDestroyed()) return
  const { x, y, width: curW, height: curH } = petWindow.getBounds()
  // Clamp against the size the pet SHOULD be, and restore it if it has drifted.
  const { width: w, height: h } = petWindowSize(settings.scale)
  const disp = screen.getDisplayNearestPoint(winPoint(x + w / 2, y + h / 2))
  const wa = disp.workArea
  const nx = Math.max(wa.x, Math.min(wa.x + wa.width - w, x))
  const ny = Math.max(wa.y, Math.min(wa.y + wa.height - h, y))
  if (nx !== x || ny !== y || curW !== w || curH !== h) placePet(nx, ny)
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
    const win = settingsWindow
    // focus() alone is not enough on Windows. The request comes from the tray,
    // so our process is not the foreground one, and the foreground lock means
    // SetForegroundWindow is downgraded to a taskbar flash — the window stays
    // buried behind whatever is on top of it.
    if (win.isMinimized()) win.restore()
    win.show() // also covers a hidden window, and raises within its z-band
    win.focus()
    if (!win.isFocused()) {
      // Still buried: briefly make it topmost. Windows honours a z-order change
      // from a background process even when it refuses the foreground handoff,
      // and the flag is dropped again immediately so it does not sit above
      // everything afterwards.
      win.setAlwaysOnTop(true)
      win.focus()
      win.setAlwaysOnTop(false)
      win.moveTop()
    }
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

// ---- knocked-off objects ------------------------------------------------------
// Deliberately NOT the care-item window: that one is draggable and feeds the cat
// on contact. This is scenery — click-through, no interaction, gone in a second.

const KNOCKED_MS = 1150 // must outlast the CSS drop + puff in knocked.html
let knockedWindow: BrowserWindow | null = null
let knockedTimer: ReturnType<typeof setTimeout> | null = null

/** Something goes over the edge at (x, ledgeY) and tumbles to the floor. */
function dropKnockedObject(x: number, ledgeY: number): void {
  const disp = screen.getDisplayNearestPoint(winPoint(x, ledgeY))
  const floor = disp.workArea.y + disp.workArea.height
  const height = Math.round(floor - ledgeY)
  if (height < 40) return // already on the floor; nothing to fall

  if (knockedTimer) { clearTimeout(knockedTimer); knockedTimer = null }
  if (knockedWindow && !knockedWindow.isDestroyed()) knockedWindow.destroy()

  const width = 40
  const win = new BrowserWindow({
    width, height,
    x: Math.round(x - width / 2), y: Math.round(ledgeY),
    transparent: true, frame: false, resizable: false, show: false,
    skipTaskbar: true, hasShadow: false, focusable: false, alwaysOnTop: true,
    maximizable: false, fullscreenable: false,
    webPreferences: { sandbox: true }
  })
  win.setAlwaysOnTop(true, 'screen-saver')
  win.setIgnoreMouseEvents(true)
  win.once('ready-to-show', () => { if (!win.isDestroyed()) win.showInactive() })
  win.on('closed', () => { if (knockedWindow === win) knockedWindow = null })
  if (process.env['ELECTRON_RENDERER_URL']) win.loadURL(`${process.env['ELECTRON_RENDERER_URL']}/knocked.html`)
  else win.loadFile(join(__dirname, '../renderer/knocked.html'))
  knockedWindow = win

  knockedTimer = setTimeout(() => {
    knockedTimer = null
    if (!win.isDestroyed()) win.destroy()
  }, KNOCKED_MS)
}

// ---- the string toy -----------------------------------------------------------
// A string dangling in front of the pet while it plays. Unlike the yarn ball
// (a care item you drag onto the cat), this is scenery the pet produces for
// itself — click-through, and it leaves when the animation does.

let stringWindow: BrowserWindow | null = null
let stringReady = false
let stringPendingCfg: unknown = null
let stringPendingPivot: unknown = null

/** Forward a message to the string window, holding cfg + the latest pivot until
 *  the page is up (the engine starts driving before the renderer exists). */
function stringSend(ch: string, payload?: unknown): void {
  const w = stringWindow
  if (!w || w.isDestroyed()) return
  if (!stringReady) {
    if (ch === 'string:cfg') stringPendingCfg = payload
    else if (ch === 'string:pivot') stringPendingPivot = payload
    return // a hit/grab this early has nothing to land on; drop it
  }
  w.webContents.send(ch, payload)
}

function showStringToy(x: number, y: number, width: number, height: number, cfg: unknown): void {
  hideStringToy()
  const win = new BrowserWindow({
    width, height,
    x: Math.round(x), y: Math.round(y),
    transparent: true, frame: false, resizable: false, show: false,
    skipTaskbar: true, hasShadow: false, focusable: false, alwaysOnTop: true,
    maximizable: false, fullscreenable: false,
    webPreferences: { preload: join(__dirname, '../preload/string.js'), sandbox: false }
  })
  win.setAlwaysOnTop(true, 'screen-saver')
  win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true })
  win.setIgnoreMouseEvents(true)
  win.once('ready-to-show', () => { if (!win.isDestroyed()) win.showInactive() })
  win.on('closed', () => { if (stringWindow === win) { stringWindow = null; stringReady = false } })
  win.webContents.once('did-finish-load', () => {
    if (win.isDestroyed() || stringWindow !== win) return
    stringReady = true
    if (stringPendingCfg) win.webContents.send('string:cfg', stringPendingCfg)
    if (stringPendingPivot) win.webContents.send('string:pivot', stringPendingPivot)
    stringPendingCfg = stringPendingPivot = null
  })
  if (process.env['ELECTRON_RENDERER_URL']) win.loadURL(`${process.env['ELECTRON_RENDERER_URL']}/string.html`)
  else win.loadFile(join(__dirname, '../renderer/string.html'))
  stringWindow = win
  stringReady = false
  stringPendingCfg = cfg
  stringPendingPivot = null
}

function hideStringToy(): void {
  if (stringWindow && !stringWindow.isDestroyed()) stringWindow.destroy()
  stringWindow = null
  stringReady = false
  stringPendingCfg = stringPendingPivot = null
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
  win.setPosition(clampWinCoord(b.x - s.width - 6), clampWinCoord(b.y + b.height / 2 - s.height / 2))
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
  const active = settings.dreamMode && sleeping && dreamThisSession && hasPhotos && !!petWindow && petWindow.isVisible()
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
    dreamWindow.setPosition(clampWinCoord(b.x + b.width / 2 - s.width / 2), clampWinCoord(y))
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

/**
 * "Start on boot" state.
 *
 * The OS is the single source of truth, so this is read live rather than
 * mirrored into AppSettings: the user can also turn startup off from Task
 * Manager or Windows Settings, and a persisted copy of ours would quietly
 * disagree with reality the moment they did.
 *
 * Store (MSIX) builds are the exception — packaged startup is declared in the
 * manifest and owned by Windows, so the app cannot set it from in here.
 */
function loginItem(): LoginItem {
  if (process.platform === 'linux') return { supported: false, openAtLogin: false, reason: 'unsupported' }
  if (process.windowsStore) return { supported: false, openAtLogin: app.getLoginItemSettings().openAtLogin, reason: 'store' }
  return { supported: true, openAtLogin: app.getLoginItemSettings().openAtLogin }
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
  const nx = clampWinCoord(x + (ow - width) / 2)
  const ny = clampWinCoord(y + (oh - height))
  petWindow.setBounds({ x: nx, y: ny, width, height })
  engine?.setWindowSize({ width, height })
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
  ipcMain.handle('app:version', () => app.getVersion())
  ipcMain.handle('app:login-item', () => loginItem())
  ipcMain.on('app:set-login-item', (_e, on: boolean) => {
    if (!loginItem().supported) return
    app.setLoginItemSettings({ openAtLogin: !!on })
  })
  ipcMain.on('settings:set-pet', (_e, petId: string) => {
    // Persist the outgoing pet's needs under its own id before switching.
    if (settings.careMode && engine) saveNeeds(settings.activePetId, engine.getStatus().needs, Date.now())
    settings.activePetId = petId
    saveSettings(settings)
    applyActivePet()
  })
  ipcMain.on('settings:set-scale', (_e, scale: number) => {
    settings.scale = snapScale(scale)
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
  ipcMain.on('settings:set-facechance', (_e, v: number) => {
    settings.faceChance = Math.max(0, Math.min(1, Number.isFinite(v) ? v : 0.4))
    saveSettings(settings)
    engine?.setFaceChance(settings.faceChance)
  })
  ipcMain.on('settings:set-frontscale', (_e, k: number) => {
    settings.frontScale = Math.max(MIN_FRONT_SCALE, Math.min(MAX_FRONT_SCALE, k))
    saveSettings(settings)
    petWindow?.webContents.send('pet:set-config', { frontScale: settings.frontScale })
  })
  ipcMain.on('settings:set-detail', (_e, v: number) => {
    if (!(DETAIL_LEVELS as readonly number[]).includes(v)) return
    settings.detail = v
    saveSettings(settings)
    petWindow?.webContents.send('pet:set-config', { detail: settings.detail })
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
  // Build a creature without AI: the renderer sends a CreatureDef (style + coat)
  // from the editor/randomizer; loadCreature validates/clamps it into a user pet.
  ipcMain.handle('pets:create', (_e, def: unknown) => {
    try {
      const pet = loadCreature(def, `user-${randomUUID().slice(0, 8)}`)
      settings.userPets.push(pet)
      settings.activePetId = pet.id
      saveSettings(settings)
      applyActivePet()
      return { ok: true, pet }
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) }
    }
  })
  // Export the current creature as a shareable .pixelpet.json pack.
  ipcMain.handle('pets:export', async (_e, def: unknown) => {
    try {
      const nm = (def && typeof def === 'object' && typeof (def as { name?: unknown }).name === 'string' ? (def as { name: string }).name : 'creature').replace(/[^\w-]+/g, '_') || 'creature'
      const res = await dialog.showSaveDialog({ title: 'Export creature', defaultPath: `${nm}.pixelpet.json`, filters: [{ name: 'PixelPet creature', extensions: ['json'] }] })
      if (res.canceled || !res.filePath) return { ok: false, error: 'Cancelled' }
      writeFileSync(res.filePath, JSON.stringify({ pixelpet: 1, kind: 'creature', creature: def }, null, 2))
      return { ok: true }
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) }
    }
  })
  // Import a creature pack (or a bare CreatureDef); validated by loadCreature.
  ipcMain.handle('pets:import', async () => {
    try {
      const res = await dialog.showOpenDialog({ title: 'Import creature', filters: [{ name: 'PixelPet creature', extensions: ['json'] }], properties: ['openFile'] })
      if (res.canceled || !res.filePaths.length) return { ok: false, error: 'Cancelled' }
      const raw = JSON.parse(readFileSync(res.filePaths[0], 'utf8')) as Record<string, unknown>
      const def = raw && typeof raw === 'object' && 'creature' in raw ? raw.creature : raw // wrapped pack or bare def
      const pet = loadCreature(def, `user-${randomUUID().slice(0, 8)}`)
      settings.userPets.push(pet)
      settings.activePetId = pet.id
      saveSettings(settings)
      applyActivePet()
      return { ok: true, pet }
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) }
    }
  })
  // Put a collar on a pet / take it off. An accessory, not part of the pet —
  // stored against the pet's id, layered on by allPets() at render time.
  ipcMain.on('pets:set-collar', (_e, p: { petId: string; collar: Collar | null }) => {
    if (!p?.petId) return
    const hex = /^#[0-9a-fA-F]{6}$/
    if (p.collar && hex.test(p.collar.band)) {
      settings.collars[p.petId] = { band: p.collar.band.toLowerCase(), tag: hex.test(p.collar.tag) ? p.collar.tag.toLowerCase() : DEFAULT_COLLAR.tag }
    } else {
      delete settings.collars[p.petId]
    }
    saveSettings(settings)
    if (p.petId === settings.activePetId) applyActivePet()
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

/**
 * Debug hook for testing the climb. Run a SECOND instance with
 *   electron . --goto-window="<title substring>"
 * and the already-running pet walks under that window and jumps onto it. The
 * single-instance lock already forwards argv to the live instance, so this needs
 * no extra plumbing — and it turns "wait for a ~20% ambient roll" into something
 * a test can actually assert on.
 *
 * Must be the `--flag=value` form: Chromium rewrites the forwarded command line
 * and interleaves its own switches, so a space-separated value does not survive
 * as argv[i + 1] (you get something like --allow-file-access-from-files instead).
 */
function handleDebugArgs(argv: string[]): void {
  // --play-clip=<name>: force any animation immediately, so behaviours that are
  // otherwise rare (zoomies) or situational (knock) can be tested on demand.
  const clipArg = argv.find((a) => a.startsWith('--play-clip='))
  const clip = clipArg?.slice('--play-clip='.length).trim()
  if (clip) {
    console.log(`[debug] forcing clip "${clip}"`)
    engine?.forcePlay(clip as ClipName)
  }

  // --open-settings: exactly what the tray item does. The tray cannot be driven
  // from a script, and "does it actually come to the front" is precisely the
  // kind of thing that needs testing rather than assuming.
  if (argv.includes('--open-settings')) {
    console.log('[debug] open settings')
    openSettings()
  }

  // --set-visible=0|1: the tray's Show/Hide, which a script cannot click. Hiding
  // has to take the pet's other windows with it (see setPetVisible), and "did
  // the string toy actually go away" is not something to take on trust.
  const visArg = argv.find((a) => a.startsWith('--set-visible='))
  if (visArg) {
    const on = visArg.slice('--set-visible='.length).trim() !== '0'
    console.log(`[debug] set pet visible = ${on}`)
    setPetVisible(on)
  }

  const arg = argv.find((a) => a.startsWith('--goto-window='))
  const value = arg?.slice('--goto-window='.length).trim()
  if (!value) return
  const needle = value.toLowerCase()
  const match = enumWindowsTitled().find((w) => w.title.toLowerCase().includes(needle))
  if (!match) {
    console.warn(`[debug] no visible window matching "${needle}"`)
    return
  }
  console.log(`[debug] sending the pet onto "${match.title}" @ ${match.x},${match.y} ${match.w}x${match.h}`)
  engine?.climbToward(match.x + match.w / 2, match.y)
}

const gotLock = app.requestSingleInstanceLock()
if (!gotLock) {
  app.quit()
} else {
  app.on('second-instance', (_e, argv) => {
    if (!petWindow) petWindow = createPetWindow()
    handleDebugArgs(argv)
  })

  app.whenReady().then(() => {
    // macOS: run as a menu-bar agent (no Dock icon) — the pet + tray are the UI.
    if (process.platform === 'darwin') app.dock?.hide()
    settings = loadSettings()
    registerIpc()
    petWindow = createPetWindow()
    const trayCb: TrayCallbacks = {
      onToggleVisible: () => setPetVisible(!petWindow?.isVisible()),
      onFindCat: () => findCat(),
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

    // macOS/Linux counterpart to the pet window's win32 'session-end'.
    powerMonitor.on('shutdown', () => quitForOs('system shutdown'))

    // Keep the pet on top (see the note by ensureOnTop): a slow heartbeat, plus
    // the moments Windows is most likely to have dropped the topmost flag.
    topmostTimer = setInterval(ensureOnTop, TOPMOST_TICK_MS)
    powerMonitor.on('resume', ensureOnTop)
    powerMonitor.on('unlock-screen', ensureOnTop)

    // Keep the pet reachable when the monitor layout changes.
    screen.on('display-removed', () => { clampPetOnScreen(); ensureOnTop() })
    screen.on('display-metrics-changed', () => { clampPetOnScreen(); ensureOnTop() })
  })

  app.on('window-all-closed', () => {
    // Tray app: keep running with no visible windows. An OS-driven close comes
    // in through the pet window's 'close' handler, which quits us properly.
  })

  // Terminal/`kill` shutdowns — mainly dev and macOS/Linux, harmless on Windows.
  process.on('SIGTERM', () => quitForOs('SIGTERM'))
  process.on('SIGINT', () => quitForOs('SIGINT'))

  app.on('before-quit', () => {
    quitting = true // our own quit — stop quitForOs re-entering as windows close
    stopDrag()
    stopItemDrag()
    itemWindow?.destroy()
    if (topmostTimer) clearInterval(topmostTimer)
    if (sonarTimer) clearTimeout(sonarTimer)
    sonarWindow?.destroy()
    if (knockedTimer) clearTimeout(knockedTimer)
    knockedWindow?.destroy()
    hideStringToy()
    if (dreamTimer) clearInterval(dreamTimer)
    dreamWindow?.destroy()
    engine?.dispose()
    tray?.destroy()
  })
}
