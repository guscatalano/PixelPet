import { SPRITE_H, SPRITE_TOP, SPRITE_W } from '../../shared/constants'
import { generateGrid, generateWalkGrid, render as renderPet, type AnimState, type Pet } from '../../shared/catgen'
import { generateRigGrid, lerpPose, POSES, type RigPose } from '../../shared/rigcat'
import { generate34Grid } from '../../shared/turn34'
import { DEFAULT_PET, PETS } from '../../shared/pets'
import type { ClipName, Facing, PlayCommand, TriggerEvent } from '../../shared/types'

// ---- Bridge typing (exposed by preload) ------------------------------------
interface PetApi {
  setIgnoreMouse: (ignore: boolean) => void
  dragStart: () => void
  dragEnd: () => void
  sendTrigger: (ev: TriggerEvent) => void
  clipEnded: (clip: string) => void
  stateReached: (clip: string) => void
  onPlay: (handler: (cmd: PlayCommand) => void) => void
  onWalkStep: (handler: (step: number) => void) => void
  onSetPet: (handler: (petId: string) => void) => void
}
declare global {
  interface Window {
    pet: PetApi
  }
}

const DRAG_THRESHOLD = 4 // px of movement before a press becomes a drag

// ---- Frame bitmaps (generated from the active pet) --------------------------
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
// The active pet is mutable: Settings can swap it at runtime (see onSetPet).
let activePet: Pet = DEFAULT_PET
const frontRGBA = (state: AnimState): Uint8ClampedArray =>
  renderPet(generateGrid(activePet, state), activePet.coat)
const poseCanvas = (pose: RigPose): HTMLCanvasElement =>
  rgbaToCanvas(renderPet(generateRigGrid(activePet, pose), activePet.coat))

// Front-idle frames, cached by quantized state (tail sways continuously while
// eye/ear expressions layer on top without snapping).
const frontCache = new Map<string, HTMLCanvasElement>()
function getFrontFrame(eyeOpen: boolean, tailPhase: number, look: number, earPhase: number): HTMLCanvasElement {
  const tailStep = Math.round(tailPhase * 8)
  const key = `${eyeOpen ? 1 : 0}|${tailStep}|${look}|${earPhase}`
  let c = frontCache.get(key)
  if (!c) {
    c = rgbaToCanvas(frontRGBA({ eyeOpen, tailPhase: tailStep / 8, look, earPhase }))
    frontCache.set(key, c)
  }
  return c
}
const tailAt = (now: number, speed: number): number => Math.sin(now / speed)

// Side-profile walk frames, cached by quantized step of the gait cycle (also
// reused, sped up, as the scrabbling fall).
const WALK_QUANT = 8
const walkCache = new Map<number, HTMLCanvasElement>()
function getWalkFrame(step: number): HTMLCanvasElement {
  const s = ((Math.round(step * WALK_QUANT) % WALK_QUANT) + WALK_QUANT) % WALK_QUANT
  let c = walkCache.get(s)
  if (!c) {
    c = rgbaToCanvas(renderPet(generateWalkGrid(activePet, s / WALK_QUANT), activePet.coat))
    walkCache.set(s, c)
  }
  return c
}

// Rig-pose frames for node loops, cached by a caller-chosen key.
const rigCache = new Map<string, HTMLCanvasElement>()
function getRigFrame(key: string, make: () => RigPose): HTMLCanvasElement {
  let c = rigCache.get(key)
  if (!c) {
    c = poseCanvas(make())
    rigCache.set(key, c)
  }
  return c
}

// ---- The animation graph -----------------------------------------------------
// Nodes are stable looping visual states; edges are finite transition sequences
// (real motion: the cat turns, sits, tucks, coils). The engine requests a clip;
// the renderer walks the graph to it and reports arrival via stateReached.
type Node =
  | 'front' | 'sit' | 'stand' | 'walk' | 'loaf' | 'sleep' | 'groom'
  | 'teeter' | 'crouch' | 'air' | 'fall' | 'poof'

interface Frame { img: HTMLCanvasElement; ms: number; ox?: number; oy?: number }
interface Seq { frames: Frame[]; end: Node; onDone?: () => void }

const easeK = (k: number): number => (k < 0.5 ? 2 * k * k : 1 - Math.pow(-2 * k + 2, 2) / 2)

// Finite sequences are built lazily per pet and cached by name.
const seqCache = new Map<string, Frame[]>()
function seqFrames(name: string, build: () => Frame[]): Frame[] {
  let f = seqCache.get(name)
  if (!f) {
    f = build()
    seqCache.set(name, f)
  }
  return f
}
const rigLerpFrames = (A: RigPose, B: RigPose, n: number, ms: number): Frame[] =>
  Array.from({ length: n }, (_, i) => ({ img: poseCanvas(lerpPose(A, B, easeK((i + 1) / n))), ms }))

// The ¾ turn keyframes (side sit -> facing you). Eyes closed through the turn
// (the blink masks the 1-eye -> 2-eye pop); ox tracks the head from its side
// position to centre. Reverse for turning away.
const TURN_KEYS = [
  { t: 1.0, blink: true, ox: 8, oy: 2 },
  { t: 0.62, blink: true, ox: 4, oy: 1 },
  { t: 0.28, blink: false, ox: 1, oy: 0 }
]
const turnFrames = (): Frame[] => TURN_KEYS.map((k) => ({
  img: rgbaToCanvas(renderPet(generate34Grid(activePet, k.t, { eyeOpen: !k.blink }), activePet.coat)),
  ms: 80, ox: k.ox, oy: k.oy
}))

/** The transition sequence for one graph edge (from -> to must be adjacent). */
function edgeSeq(from: Node, to: Node): Frame[] | null {
  const key = `${from}>${to}`
  switch (key) {
    case 'sit>front': return seqFrames(key, turnFrames)
    case 'front>sit': return seqFrames(key, () => [...turnFrames()].reverse())
    case 'sit>stand': return seqFrames(key, () => rigLerpFrames(POSES.sit, POSES.stand, 5, 95))
    case 'stand>sit': return seqFrames(key, () => rigLerpFrames(POSES.stand, POSES.sit, 5, 95))
    case 'sit>loaf': return seqFrames(key, () => rigLerpFrames(POSES.sit, POSES.loaf, 6, 105))
    case 'loaf>sit': return seqFrames(key, () => rigLerpFrames(POSES.loaf, POSES.sit, 6, 105))
    case 'sit>sleep': return seqFrames(key, () => rigLerpFrames(POSES.sit, POSES.curl, 7, 105))
    case 'sleep>sit': return seqFrames(key, () => rigLerpFrames(POSES.curl, POSES.sit, 7, 105))
    case 'sit>groom': return seqFrames(key, () => rigLerpFrames(POSES.sit, POSES.groom, 4, 110))
    case 'groom>sit': return seqFrames(key, () => rigLerpFrames(POSES.groom, POSES.sit, 4, 110))
    case 'stand>walk': case 'walk>stand': return [] // same base pose
    case 'stand>teeter': return seqFrames(key, () => rigLerpFrames(POSES.stand, POSES.teeter, 4, 100))
    case 'teeter>stand': return seqFrames(key, () => rigLerpFrames(POSES.teeter, POSES.stand, 4, 100))
    case 'stand>poof': return seqFrames(key, () => rigLerpFrames(POSES.stand, POSES.poof, 4, 75)) // fast — it's a scare
    case 'poof>stand': return seqFrames(key, () => rigLerpFrames(POSES.poof, POSES.stand, 4, 130))
    case 'stand>crouch': return seqFrames(key, () => rigLerpFrames(POSES.stand, POSES.crouch, 4, 100))
    case 'crouch>stand': return seqFrames(key, () => rigLerpFrames(POSES.crouch, POSES.stand, 4, 100))
    case 'crouch>air': return seqFrames(key, () => [
      { img: poseCanvas(lerpPose(POSES.crouch, POSES.pounce, 0.5)), ms: 70 },
      { img: poseCanvas(POSES.pounce), ms: 70 }
    ])
    case 'air>stand': case 'fall>stand': return seqFrames('land>stand', () => [
      { img: poseCanvas(POSES.land), ms: 110 },
      { img: poseCanvas(lerpPose(POSES.land, POSES.stand, 0.5)), ms: 95 }
    ])
    default: return null
  }
}

// Graph adjacency for pathfinding (BFS over a dozen nodes).
const EDGES: Record<Node, Node[]> = {
  front: ['sit'],
  sit: ['front', 'stand', 'loaf', 'sleep', 'groom'],
  stand: ['sit', 'walk', 'teeter', 'poof', 'crouch'],
  walk: ['stand'],
  loaf: ['sit'],
  sleep: ['sit'],
  groom: ['sit'],
  teeter: ['stand'],
  crouch: ['stand', 'air'],
  air: ['stand'],
  fall: ['stand'],
  poof: ['stand']
}
function pathTo(from: Node, to: Node): Node[] {
  if (from === to) return []
  const prev = new Map<Node, Node>()
  const q: Node[] = [from]
  while (q.length) {
    const n = q.shift()!
    for (const m of EDGES[n] ?? []) {
      if (m === from || prev.has(m)) continue
      prev.set(m, n)
      if (m === to) {
        const path: Node[] = [to]
        let c: Node = to
        while (prev.get(c) !== undefined && c !== from) {
          c = prev.get(c)!
          if (c !== from) path.unshift(c)
        }
        return path
      }
      q.push(m)
    }
  }
  return [] // unreachable (shouldn't happen)
}

// ---- One-shot actions (play at a required node, then report done) ------------
function yawnFrames(): Frame[] {
  return seqFrames('yawn', () => [0.3, 0.65, 1, 1, 1, 0.6, 0.25].map((k) => ({
    img: rgbaToCanvas(renderPet(generate34Grid(activePet, 0, { yawn: k }), activePet.coat)), ms: 130
  })))
}
function stretchFrames(): Frame[] {
  return seqFrames('stretch', () => {
    const inF = rigLerpFrames(POSES.stand, POSES.stretch, 6, 110)
    const hold: Frame[] = [{ img: inF[5].img, ms: 380 }]
    const outF = rigLerpFrames(POSES.stretch, POSES.stand, 6, 100)
    return [...inF, ...hold, ...outF]
  })
}
function reactFrames(): Frame[] {
  // A gentle "noticed you": quick blink, then a glance toward the viewer.
  return seqFrames('react', () => [
    { img: getFrontFrame(false, 0.2, 0, 0), ms: 130 },
    { img: getFrontFrame(true, 0.3, 1, 0), ms: 320 }
  ])
}
const ONE_SHOT_NODE: Partial<Record<ClipName, Node>> = { yawn: 'front', stretch: 'stand', react: 'front' }
const ONE_SHOT_FRAMES: Partial<Record<ClipName, () => Frame[]>> = { yawn: yawnFrames, stretch: stretchFrames, react: reactFrames }

// ---- Graph runtime state ------------------------------------------------------
const NODE_OF: Partial<Record<ClipName, Node>> = {
  idle: 'front', sit: 'sit', walk: 'walk', sleep: 'sleep', loaf: 'loaf',
  groom: 'groom', teeter: 'teeter', fall: 'fall', poof: 'poof'
}
const CROUCH_WIGGLE_MS = 1150 // butt-wiggle time before the leap

let curNode: Node = 'front'
let nodeSince = performance.now()
let facing: Facing = 'right'
let targetClip: ClipName = 'idle'
let seq: { frames: Frame[]; i: number; nextAt: number; end: Node; onDone?: () => void } | null = null
let pendingOneShot: ClipName | null = null
let reachedSent = false

function startSeq(frames: Frame[], end: Node, now: number, onDone?: () => void): void {
  if (!frames.length) {
    curNode = end
    nodeSince = now
    onDone?.()
    return
  }
  seq = { frames, i: 0, nextAt: now + frames[0].ms, end, onDone }
}

/** Advance toward targetClip: play the next edge, one-shot, or settle. */
function planNext(now: number): void {
  if (seq) return
  // Fall preempts everything instantly (physics has taken over).
  if (targetClip === 'fall' && curNode !== 'fall') {
    curNode = 'fall'
    nodeSince = now
    return
  }
  if (pendingOneShot) {
    const need = ONE_SHOT_NODE[pendingOneShot]!
    if (curNode === need) {
      const shot = pendingOneShot
      pendingOneShot = null
      startSeq(ONE_SHOT_FRAMES[shot]!(), need, now, () => window.pet.clipEnded(shot))
      return
    }
    stepToward(need, now)
    return
  }
  if (targetClip === 'pounce') {
    if (curNode === 'crouch') {
      // Wiggle handled by the node loop; leap after the anticipation beat.
      if (now - nodeSince >= CROUCH_WIGGLE_MS) {
        startSeq(edgeSeq('crouch', 'air')!, 'air', now, () => window.pet.sendTrigger({ type: 'leap' }))
      }
      return
    }
    if (curNode === 'air') return // ballistic; engine lands us
    stepToward('crouch', now)
    return
  }
  const target = NODE_OF[targetClip] ?? 'front'
  if (curNode === target) {
    if (!reachedSent) {
      reachedSent = true
      window.pet.stateReached(targetClip)
    }
    return
  }
  stepToward(target, now)
}

function stepToward(target: Node, now: number): void {
  const path = pathTo(curNode, target)
  if (!path.length) { curNode = target; nodeSince = now; return }
  const next = path[0]
  const frames = edgeSeq(curNode, next)
  if (frames === null) { curNode = next; nodeSince = now; return } // no art for edge: snap (shouldn't happen)
  startSeq(frames, next, now)
}

// ---- Node loop drawing --------------------------------------------------------
// Idle micro-behavior for the front node: occasional blinks, glances, ear twitches.
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

// Gait phase (0..1), driven by distance travelled (sent from main).
let walkStep = 0
window.pet.onWalkStep((step: number) => { walkStep = step })

// Slow blink for the side rest nodes (sit / loaf).
const restBlink = (now: number): boolean => now % 4200 > 160

// Hover ear-perk while sleeping: perk eases toward 1 while hovered, back to 0.
let hovering = false
let perkCur = 0
let perkLast = 0
function sleepFrame(now: number): HTMLCanvasElement {
  const dt = Math.min(100, now - perkLast)
  perkLast = now
  const target = hovering ? 1 : 0
  const speed = dt / 220 // ~220ms to full perk
  perkCur = target > perkCur ? Math.min(target, perkCur + speed) : Math.max(target, perkCur - speed)
  const b = Math.round(((Math.sin(now / 900) + 1) / 2) * 5) // breath 0..5
  const p = Math.round(perkCur * 4) // perk 0..4
  return getRigFrame(`sleep|${b}|${p}`, () => {
    const pose = lerpPose(POSES.curl, POSES.curl, 0)
    const br = (b / 5) * 2 - 1
    pose.body = [pose.body[0], pose.body[1] - br * 0.25, pose.body[2], pose.body[3] + br * 0.5]
    pose.earPerk = p / 4
    if (p === 4) pose.head = [pose.head[0], pose.head[1] - 1, pose.head[2]] // listening…
    return pose
  })
}

function nodeFrame(now: number): { img: HTMLCanvasElement; ox?: number; oy?: number } {
  switch (curNode) {
    case 'front': {
      const e = idleExpr(now)
      return { img: getFrontFrame(e.eyeOpen, tailAt(now, 1600), e.look, e.earPhase) }
    }
    case 'sit': {
      const open = restBlink(now)
      return { img: getRigFrame(`sit|${open ? 1 : 0}`, () => ({ ...POSES.sit, eye: open ? 1 : 0 })) }
    }
    case 'stand': return { img: getRigFrame('stand', () => POSES.stand) }
    case 'walk': return { img: getWalkFrame(walkStep) }
    case 'fall': return { img: getWalkFrame((now / 90) % 1) } // legs scrabbling in the air
    case 'loaf': {
      const b = Math.round(((Math.sin(now / 1100) + 1) / 2) * 5)
      const open = restBlink(now)
      return { img: getRigFrame(`loaf|${b}|${open ? 1 : 0}`, () => {
        const pose = lerpPose(POSES.loaf, POSES.loaf, 0)
        const br = (b / 5) * 2 - 1
        pose.body = [pose.body[0], pose.body[1] - br * 0.2, pose.body[2], pose.body[3] + br * 0.35]
        pose.eye = open ? 1 : 0
        return pose
      }) }
    }
    case 'sleep': return { img: sleepFrame(now) }
    case 'groom': {
      const k = 0.5 + 0.5 * Math.sin(now / 140)
      const q = Math.round(k * 4)
      return { img: getRigFrame(`groom|${q}`, () => lerpPose(POSES.groom, POSES.groomLick, q / 4)) }
    }
    case 'teeter': {
      const k = 0.5 + 0.5 * Math.sin(now / 260)
      const q = Math.round(k * 6)
      return { img: getRigFrame(`teeter|${q}`, () => lerpPose(POSES.teeter, POSES.teeterFwd, q / 6)) }
    }
    case 'crouch': {
      const k = 0.5 + 0.5 * Math.sin(now / 150)
      const q = Math.round(k * 4)
      return { img: getRigFrame(`wiggle|${q}`, () => lerpPose(POSES.crouch, POSES.crouchWiggle, q / 4)) }
    }
    case 'air': return { img: getRigFrame('air', () => POSES.pounce) }
    case 'poof': return { img: getRigFrame('poof', () => POSES.poof) }
  }
}

// ---- Play state (driven by the main-process behavior engine) -----------------
window.pet.onPlay((cmd: PlayCommand) => {
  facing = cmd.facing
  if (cmd.clip === targetClip) return
  targetClip = cmd.clip
  reachedSent = false
  if (ONE_SHOT_NODE[cmd.clip]) pendingOneShot = cmd.clip
  // Fall interrupts any running sequence immediately — physics won't wait.
  if (cmd.clip === 'fall') {
    seq = null
    pendingOneShot = null
    curNode = 'fall'
    nodeSince = performance.now()
  }
})

// ---- Per-pixel hit mask (union of rest silhouettes, so hover works whether the
// cat is fronting, sitting, loafing, or curled) ---------------------------------
let hitMask: boolean[] = buildHitMask()
function buildHitMask(): boolean[] {
  const mask = new Array<boolean>(SPRITE_W * SPRITE_H).fill(false)
  const add = (rgba: Uint8ClampedArray): void => {
    for (let i = 0; i < SPRITE_W * SPRITE_H; i++) if (rgba[i * 4 + 3] > 0) mask[i] = true
  }
  add(frontRGBA({ eyeOpen: true, tailPhase: 0 }))
  add(renderPet(generateRigGrid(activePet, POSES.sit), activePet.coat))
  add(renderPet(generateRigGrid(activePet, POSES.loaf), activePet.coat))
  add(renderPet(generateRigGrid(activePet, POSES.curl), activePet.coat))
  return mask
}

// ---- Main canvas setup --------------------------------------------------------
// SCALE is runtime: the pet window can be resized in Settings. We derive the
// current scale from the window size (main owns it), and recompute on resize.
const canvas = document.getElementById('pet') as HTMLCanvasElement
const dpr = window.devicePixelRatio || 1
const ctx = canvas.getContext('2d')!
let scale = 4
let petW = 0
let petH = 0
let FEET_X = 0
let FEET_Y = 0

function applyScale(): void {
  scale = Math.max(1, Math.round(window.innerWidth / SPRITE_W))
  petW = SPRITE_W * scale
  petH = (SPRITE_H + SPRITE_TOP * 2) * scale
  canvas.style.width = `${petW}px`
  canvas.style.height = `${petH}px`
  canvas.width = Math.round(petW * dpr)
  canvas.height = Math.round(petH * dpr)
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
  ctx.imageSmoothingEnabled = false
  FEET_X = (SPRITE_W / 2) * scale
  FEET_Y = (SPRITE_TOP + SPRITE_H) * scale
}
applyScale()
window.addEventListener('resize', applyScale)

// Swap the active pet at runtime: regenerate all frames + the hit mask.
window.pet.onSetPet((petId: string) => {
  const next = PETS.find((p) => p.id === petId)
  if (!next || next === activePet) return
  activePet = next
  frontCache.clear()
  walkCache.clear()
  rigCache.clear()
  seqCache.clear()
  hitMask = buildHitMask()
})

// ---- Rendering ------------------------------------------------------------
function drawZzz(now: number): void {
  const chars = ['z', 'z', 'Z']
  for (let i = 0; i < chars.length; i++) {
    const t = (now / 750 + i * 0.4) % 1
    const px = (SPRITE_W * 0.62 + i * 1.5) * scale + t * 4 * scale * 0.4
    const py = (SPRITE_TOP + 6 - t * 9) * scale
    ctx.globalAlpha = 1 - t
    ctx.fillStyle = '#9aa8c8'
    ctx.font = `${(3 + i) * scale * 0.55}px monospace`
    ctx.fillText(chars[i], px, py)
  }
  ctx.globalAlpha = 1
}

// Draw one sprite frame at the feet anchor, flipped for facing. ox/oy are
// native-px offsets in the sprite's local (pre-flip) space, so a turn designed
// facing right mirrors correctly when the cat faces left.
function drawSprite(frame: HTMLCanvasElement, fc: Facing, ox = 0, oy = 0): void {
  ctx.save()
  ctx.translate(FEET_X, FEET_Y)
  ctx.scale(fc === 'left' ? -1 : 1, 1) // integer flip only — no fractional scaling
  ctx.drawImage(frame, 0, 0, SPRITE_W, SPRITE_H, (-SPRITE_W / 2 + ox) * scale, (-SPRITE_H + oy) * scale, SPRITE_W * scale, SPRITE_H * scale)
  ctx.restore()
}

function render(now: number): void {
  // Advance the active transition sequence.
  if (seq && now >= seq.nextAt) {
    seq.i++
    if (seq.i >= seq.frames.length) {
      curNode = seq.end
      nodeSince = now
      const done = seq.onDone
      seq = null
      done?.()
    } else {
      seq.nextAt = now + seq.frames[seq.i].ms
    }
  }
  if (!seq) planNext(now)

  ctx.clearRect(0, 0, petW, petH)
  if (seq) {
    const f = seq.frames[seq.i]
    drawSprite(f.img, facing, f.ox ?? 0, f.oy ?? 0)
  } else {
    const f = nodeFrame(now)
    drawSprite(f.img, facing, f.ox ?? 0, f.oy ?? 0)
    if (curNode === 'sleep') drawZzz(now)
  }
  requestAnimationFrame(render)
}
requestAnimationFrame(render)

// ---- Hit testing: is (clientX, clientY) over an opaque cat pixel? -------------
function isOverCat(clientX: number, clientY: number): boolean {
  const nx = Math.floor(clientX / scale)
  const ny = Math.floor(clientY / scale) - SPRITE_TOP
  if (nx < 0 || nx >= SPRITE_W || ny < 0 || ny >= SPRITE_H) return false
  return hitMask[ny * SPRITE_W + nx] === true
}

// ---- Mouse interaction -------------------------------------------------------
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
  const nowOver = isOverCat(clientX, clientY)
  setIgnore(!nowOver)
  if (nowOver && !overCat) window.pet.sendTrigger({ type: 'hover-start' })
  if (!nowOver && overCat) window.pet.sendTrigger({ type: 'hover-end' })
  overCat = nowOver
  hovering = nowOver // drives the sleeping ear-perk
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
    hovering = false
  }
})
