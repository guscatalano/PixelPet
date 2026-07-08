import { PET_H, PET_W, SCALE, SPRITE_H, SPRITE_TOP, SPRITE_W } from '../../shared/constants'
import { generateGrid, generateWalkGrid, render as renderPet, type AnimState } from '../../shared/catgen'
import { DEFAULT_PET } from '../../shared/pets'
import type { ClipName, Facing, PlayCommand, TriggerEvent } from '../../shared/types'

// ---- Bridge typing (exposed by preload) ------------------------------------
interface PetApi {
  setIgnoreMouse: (ignore: boolean) => void
  dragStart: () => void
  dragEnd: () => void
  sendTrigger: (ev: TriggerEvent) => void
  clipEnded: (clip: string) => void
  onPlay: (handler: (cmd: PlayCommand) => void) => void
  onWalkStep: (handler: (step: number) => void) => void
}
declare global {
  interface Window {
    pet: PetApi
  }
}

const DRAG_THRESHOLD = 4 // px of movement before a press becomes a drag
const REACT_MS = 450 // duration of the one-shot "react" pop

// ---- Frame bitmaps (generated from the active pet) -------------------------
function rgbaToCanvas(rgba: Uint8ClampedArray): HTMLCanvasElement {
  const c = document.createElement('canvas')
  c.width = SPRITE_W
  c.height = SPRITE_H
  const cx = c.getContext('2d')!
  const img = cx.createImageData(SPRITE_W, SPRITE_H)
  img.data.set(rgba)
  cx.putImageData(img, 0, 0)
  return c
}
const frameRGBA = (state: AnimState): Uint8ClampedArray =>
  renderPet(generateGrid(DEFAULT_PET, state), DEFAULT_PET.coat)

// Frames are generated on demand and cached by quantized state, so the tail can
// sway continuously while eye/ear expressions layer on top without ever snapping.
const frameCache = new Map<string, HTMLCanvasElement>()
function getFrame(eyeOpen: boolean, tailPhase: number, look: number, earPhase: number): HTMLCanvasElement {
  const tailStep = Math.round(tailPhase * 8) // ~17 positions across the sway
  const key = `${eyeOpen ? 1 : 0}|${tailStep}|${look}|${earPhase}`
  let c = frameCache.get(key)
  if (!c) {
    c = rgbaToCanvas(frameRGBA({ eyeOpen, tailPhase: tailStep / 8, look, earPhase }))
    frameCache.set(key, c)
  }
  return c
}
const tailAt = (now: number, speed: number): number => Math.sin(now / speed)

// Side-profile walk frames, cached by quantized step of the gait cycle.
const WALK_QUANT = 8 // gait frames per cycle. Pixel-art walks use ~4-8 crisp
// frames; too many finely-sampled frames make leg pixels shimmer (reads glitchy).
const walkCache = new Map<number, HTMLCanvasElement>()
function getWalkFrame(step: number): HTMLCanvasElement {
  const s = ((Math.round(step * WALK_QUANT) % WALK_QUANT) + WALK_QUANT) % WALK_QUANT
  let c = walkCache.get(s)
  if (!c) {
    c = rgbaToCanvas(renderPet(generateWalkGrid(DEFAULT_PET, s / WALK_QUANT), DEFAULT_PET.coat))
    walkCache.set(s, c)
  }
  return c
}

// Per-pixel hit mask from a neutral frame's opaque pixels.
const baseRGBA = frameRGBA({ eyeOpen: true, tailPhase: 0 })
const hitMask: boolean[] = new Array(SPRITE_W * SPRITE_H)
for (let i = 0; i < SPRITE_W * SPRITE_H; i++) hitMask[i] = baseRGBA[i * 4 + 3] > 0

// ---- Main canvas setup -----------------------------------------------------
const canvas = document.getElementById('pet') as HTMLCanvasElement
const dpr = window.devicePixelRatio || 1
canvas.style.width = `${PET_W}px`
canvas.style.height = `${PET_H}px`
canvas.width = Math.round(PET_W * dpr)
canvas.height = Math.round(PET_H * dpr)
const ctx = canvas.getContext('2d')!
ctx.scale(dpr, dpr)
ctx.imageSmoothingEnabled = false

// ---- Play state (driven by the main-process behavior engine) ---------------
let clip: ClipName = 'idle'
let facing: Facing = 'right'
let clipStart = performance.now()
let reactEndedSent = false

window.pet.onPlay((cmd: PlayCommand) => {
  if (cmd.clip !== clip) {
    clip = cmd.clip
    clipStart = performance.now()
    reactEndedSent = false
  }
  facing = cmd.facing
})

// Gait phase (0..1), driven by how far the pet has actually travelled, so the
// legs stay in sync with movement instead of running on wall-clock time.
let walkStep = 0
window.pet.onWalkStep((step: number) => {
  walkStep = step
})

// ---- Idle micro-behavior: occasional blinks, glances, ear-twitches ---------
let ev = ''
let evUntil = 0
let nextEvent = performance.now() + 1400

function idleExpr(now: number): { eyeOpen: boolean; look: number; earPhase: number } {
  if (now > nextEvent) {
    const r = Math.random()
    if (r < 0.5) { ev = 'blink'; evUntil = now + 130 }
    else if (r < 0.68) { ev = 'glL'; evUntil = now + 850 }
    else if (r < 0.86) { ev = 'glR'; evUntil = now + 850 }
    else { ev = 'ear'; evUntil = now + 230 }
    nextEvent = evUntil + 1600 + Math.random() * 3200
  }
  if (now < evUntil) {
    if (ev === 'blink') return { eyeOpen: false, look: 0, earPhase: 0 }
    if (ev === 'glL') return { eyeOpen: true, look: -1, earPhase: 0 }
    if (ev === 'glR') return { eyeOpen: true, look: 1, earPhase: 0 }
    return { eyeOpen: true, look: 0, earPhase: 1 }
  }
  return { eyeOpen: true, look: 0, earPhase: 0 }
}

// ---- Per-clip animation ----------------------------------------------------
// The tail sways continuously; eye/ear expressions layer on top. No canvas
// scaling (which would shimmer nearest-neighbor pixels), so nothing vibrates.
interface Anim {
  frame: HTMLCanvasElement
  overlay: 'none' | 'zzz'
}

function computeAnim(now: number): Anim {
  const elapsed = now - clipStart
  switch (clip) {
    case 'walk':
      return { frame: getWalkFrame(walkStep), overlay: 'none' }
    case 'sleep':
      return { frame: getFrame(false, tailAt(now, 2600), 0, 0), overlay: 'zzz' }
    case 'react': {
      // A gentle "noticed you": quick blink, then a glance toward you.
      if (elapsed >= REACT_MS) return idleAnim(now)
      const open = elapsed >= 130
      const look = facing === 'left' ? -1 : 1
      return { frame: getFrame(open, tailAt(now, 1400), open ? look : 0, 0), overlay: 'none' }
    }
    default:
      return idleAnim(now)
  }
}

function idleAnim(now: number): Anim {
  const e = idleExpr(now)
  return { frame: getFrame(e.eyeOpen, tailAt(now, 1600), e.look, e.earPhase), overlay: 'none' }
}

// ---- Rendering -------------------------------------------------------------
const FEET_X = (SPRITE_W / 2) * SCALE
const FEET_Y = (SPRITE_TOP + SPRITE_H) * SCALE

function drawZzz(now: number): void {
  const chars = ['z', 'z', 'Z']
  for (let i = 0; i < chars.length; i++) {
    const t = (now / 750 + i * 0.4) % 1
    const px = (SPRITE_W * 0.62 + i * 1.5) * SCALE + t * 4 * SCALE * 0.4
    const py = (SPRITE_TOP + 6 - t * 9) * SCALE
    ctx.globalAlpha = 1 - t
    ctx.fillStyle = '#9aa8c8'
    ctx.font = `${(3 + i) * SCALE * 0.55}px monospace`
    ctx.fillText(chars[i], px, py)
  }
  ctx.globalAlpha = 1
}

function render(now: number): void {
  const a = computeAnim(now)

  // Signal one-shot completion once.
  if (clip === 'react' && now - clipStart >= REACT_MS && !reactEndedSent) {
    reactEndedSent = true
    window.pet.clipEnded('react')
  }

  ctx.clearRect(0, 0, PET_W, PET_H)

  const flip = facing === 'left' ? -1 : 1
  ctx.save()
  // Only an integer horizontal flip for facing — no fractional scaling.
  ctx.translate(FEET_X, FEET_Y)
  ctx.scale(flip, 1)
  ctx.drawImage(a.frame, 0, 0, SPRITE_W, SPRITE_H, -(SPRITE_W / 2) * SCALE, -SPRITE_H * SCALE, SPRITE_W * SCALE, SPRITE_H * SCALE)
  ctx.restore()

  if (a.overlay === 'zzz') drawZzz(now)

  requestAnimationFrame(render)
}
requestAnimationFrame(render)

// ---- Hit testing: is (clientX, clientY) over an opaque cat pixel? -----------
// Uses the nominal (un-transformed) silhouette; good enough for hover/click.
function isOverCat(clientX: number, clientY: number): boolean {
  const nx = Math.floor(clientX / SCALE)
  const ny = Math.floor(clientY / SCALE) - SPRITE_TOP
  if (nx < 0 || nx >= SPRITE_W || ny < 0 || ny >= SPRITE_H) return false
  return hitMask[ny * SPRITE_W + nx] === true
}

// ---- Mouse interaction -----------------------------------------------------
let ignoring = true
let overCat = false
let pressed = false
let dragging = false
let pressX = 0
let pressY = 0

function setIgnore(ignore: boolean): void {
  if (ignore === ignoring) return
  ignoring = ignore
  window.pet.setIgnoreMouse(ignore)
}

function updateHover(clientX: number, clientY: number): void {
  const now = isOverCat(clientX, clientY)
  setIgnore(!now)
  if (now && !overCat) window.pet.sendTrigger({ type: 'hover-start' })
  if (!now && overCat) window.pet.sendTrigger({ type: 'hover-end' })
  overCat = now
}

window.addEventListener('mousemove', (e) => {
  if (pressed) {
    if (!dragging && Math.hypot(e.clientX - pressX, e.clientY - pressY) > DRAG_THRESHOLD) {
      dragging = true
      canvas.classList.add('dragging')
      window.pet.dragStart()
    }
    return
  }
  updateHover(e.clientX, e.clientY)
})

window.addEventListener('mousedown', (e) => {
  if (e.button !== 0) return
  if (!isOverCat(e.clientX, e.clientY)) return
  pressed = true
  dragging = false
  pressX = e.clientX
  pressY = e.clientY
})

window.addEventListener('mouseup', () => {
  if (!pressed) return
  pressed = false
  if (dragging) {
    dragging = false
    canvas.classList.remove('dragging')
    window.pet.dragEnd()
  } else {
    window.pet.sendTrigger({ type: 'click' })
  }
})

window.addEventListener('mouseleave', () => {
  if (pressed) return
  setIgnore(true)
  if (overCat) {
    window.pet.sendTrigger({ type: 'hover-end' })
    overCat = false
  }
})


