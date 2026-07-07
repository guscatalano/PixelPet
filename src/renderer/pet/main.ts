import { PET_H, PET_W, SCALE, SPRITE_H, SPRITE_TOP, SPRITE_W } from '../../shared/constants'
import { CAT_IDLE, makeBlinkFrame, parseSprite, WHITE_CAT_PALETTE } from '../../shared/catSprite'
import type { ClipName, Facing, PlayCommand, TriggerEvent } from '../../shared/types'

// ---- Bridge typing (exposed by preload) ------------------------------------
interface PetApi {
  setIgnoreMouse: (ignore: boolean) => void
  dragStart: () => void
  dragEnd: () => void
  sendTrigger: (ev: TriggerEvent) => void
  clipEnded: (clip: string) => void
  onPlay: (handler: (cmd: PlayCommand) => void) => void
}
declare global {
  interface Window {
    pet: PetApi
  }
}

const DRAG_THRESHOLD = 4 // px of movement before a press becomes a drag
const REACT_MS = 450 // duration of the one-shot "react" pop

// ---- Frame bitmaps ---------------------------------------------------------
const idle = parseSprite(CAT_IDLE, WHITE_CAT_PALETTE)
const blink = parseSprite(makeBlinkFrame(CAT_IDLE), WHITE_CAT_PALETTE)
const hitMask = idle.mask // silhouette is identical across frames

function toCanvas(sprite: { width: number; height: number; rgba: Uint8ClampedArray }): HTMLCanvasElement {
  const c = document.createElement('canvas')
  c.width = sprite.width
  c.height = sprite.height
  const cx = c.getContext('2d')!
  const img = cx.createImageData(sprite.width, sprite.height)
  img.data.set(sprite.rgba)
  cx.putImageData(img, 0, 0)
  return c
}
const idleCanvas = toCanvas(idle)
const blinkCanvas = toCanvas(blink)

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

// ---- Blink scheduler (applied only to calm clips) --------------------------
let blinking = false
let nextBlinkAt = performance.now() + 2500
let blinkUntil = 0
function updateBlink(now: number): void {
  if (!blinking && now >= nextBlinkAt) {
    blinking = true
    blinkUntil = now + 110
  }
  if (blinking && now >= blinkUntil) {
    blinking = false
    nextBlinkAt = now + 2500 + Math.random() * 3500
  }
}

// ---- Per-clip animation ----------------------------------------------------
interface Anim {
  frame: 'base' | 'blink'
  sy: number // vertical offset in native px (negative = up)
  scaleX: number
  scaleY: number
  overlay: 'none' | 'zzz'
}

function computeAnim(now: number): Anim {
  const elapsed = now - clipStart
  switch (clip) {
    case 'walk': {
      // Bouncy hop-walk: the cat springs up and squashes on landing.
      const bounce = Math.abs(Math.sin(now / 110))
      return {
        frame: 'base',
        sy: -Math.round(bounce * 2),
        scaleX: 1.03 - bounce * 0.08,
        scaleY: 0.94 + bounce * 0.1,
        overlay: 'none'
      }
    }
    case 'sleep': {
      // Slow breathing + floating Zzz, eyes closed.
      const br = Math.sin(now / 1100)
      return { frame: 'blink', sy: 0, scaleX: 1 - br * 0.03, scaleY: 1 + br * 0.03, overlay: 'zzz' }
    }
    case 'react': {
      if (elapsed >= REACT_MS) return idleAnim(now)
      const pop = Math.sin((elapsed / REACT_MS) * Math.PI) // 0 -> 1 -> 0
      return {
        frame: elapsed < 130 ? 'blink' : 'base',
        sy: -Math.round(pop * 3),
        scaleX: 1 - pop * 0.12,
        scaleY: 1 + pop * 0.18,
        overlay: 'none'
      }
    }
    case 'sit':
      return { frame: blinking ? 'blink' : 'base', sy: 0, scaleX: 1, scaleY: 1, overlay: 'none' }
    default:
      return idleAnim(now)
  }
}

function idleAnim(now: number): Anim {
  const bob = Math.round(Math.sin(now / 600) * 2)
  return { frame: blinking ? 'blink' : 'base', sy: bob, scaleX: 1, scaleY: 1, overlay: 'none' }
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
  updateBlink(now)
  const a = computeAnim(now)

  // Signal one-shot completion once.
  if (clip === 'react' && now - clipStart >= REACT_MS && !reactEndedSent) {
    reactEndedSent = true
    window.pet.clipEnded('react')
  }

  ctx.clearRect(0, 0, PET_W, PET_H)

  const img = a.frame === 'blink' ? blinkCanvas : idleCanvas
  const flip = facing === 'left' ? -1 : 1
  ctx.save()
  // Scale/flip around the feet anchor so squash-stretch keeps the paws planted.
  ctx.translate(FEET_X, FEET_Y + a.sy * SCALE)
  ctx.scale(flip * a.scaleX, a.scaleY)
  ctx.drawImage(
    img,
    0,
    0,
    SPRITE_W,
    SPRITE_H,
    -(SPRITE_W / 2) * SCALE,
    -SPRITE_H * SCALE,
    SPRITE_W * SCALE,
    SPRITE_H * SCALE
  )
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
