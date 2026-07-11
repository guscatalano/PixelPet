import { BrowserWindow, screen } from 'electron'
import type { ClipName, Facing, Personality, PlayCommand, TriggerEvent } from '../../shared/types'
import { SPRITE_H, BOB_AMPLITUDE } from '../../shared/constants'
import { weightedPick } from './personality'
import { refreshPlatforms, supportY } from '../desktop/world'

const MOVE_TICK_MS = 16
const WALK_SPEED = 0.35 // px per tick (~22 px/s) — a calm walking pace, not a scramble
const MIN_WANDER = 90 // don't bother wandering shorter than this
const STRIDE = 12 // px travelled per full gait cycle; = 2*A/stance in the walk pose
const REACT_SAFETY_MS = 650 // force-end a react if the renderer never reports it
const FALL_SPEED = 7 // px per tick the pet drops when unsupported
const FALL_CLIP_GAP = 10 // only show the flailing fall clip when dropping more than this
const REFRESH_EVERY = 15 // physics ticks between window-list refreshes (~240ms)

/**
 * The pet's brain. Owns behavior: routes trigger events to reactions, runs the
 * personality-weighted ambient loop (wander / nap / linger), and drives the
 * window during a wander. It tells the renderer *what* to play via `pet:play`;
 * the renderer decides *how* to draw it.
 *
 * This is intentionally a small, explicit engine for M2. The trigger/reaction
 * wiring is centralized here so new triggers (music, process-launch) and
 * reactions can be added without touching the renderer.
 */
export class PetEngine {
  private clip: ClipName = 'idle'
  private facing: Facing = 'right'
  private dragging = false
  private busy = false // a one-shot reaction (react) is playing
  private wanderTarget: number | null = null
  private curX = 0 // internal float position (avoids get/set round-trip jitter)
  private curY = 0
  private lastX = 0 // last integer position sent (avoid redundant setPosition calls)
  private lastY = 0
  private walkDist = 0 // px travelled this wander, drives the gait phase
  private falling = false // pet is above its support surface (gravity active)
  private refreshCtr = 0
  private physicsTimer: ReturnType<typeof setInterval> | null = null
  private ambientTimer: ReturnType<typeof setTimeout> | null = null
  private reactTimer: ReturnType<typeof setTimeout> | null = null

  constructor(
    private readonly win: BrowserWindow,
    public personality: Personality
  ) {}

  /** Begin idling + ambient scheduling once the renderer is ready. */
  start(): void {
    const [x, y] = this.win.getPosition()
    this.curX = x
    this.curY = y
    this.lastX = x
    this.lastY = y
    refreshPlatforms()
    this.physicsTimer = setInterval(() => this.physics(), MOVE_TICK_MS) // gravity + walking, always on
    this.send()
    this.scheduleAmbient(1500)
  }

  dispose(): void {
    if (this.physicsTimer) clearInterval(this.physicsTimer)
    if (this.ambientTimer) clearTimeout(this.ambientTimer)
    if (this.reactTimer) clearTimeout(this.reactTimer)
  }

  /** Feet position (screen y) within the pet window, accounting for bob headroom. */
  private feetOffset(height: number): number {
    const scale = height / (SPRITE_H + BOB_AMPLITUDE * 2)
    return height - BOB_AMPLITUDE * scale
  }

  // ---- trigger intake -------------------------------------------------------

  emit(ev: TriggerEvent): void {
    switch (ev.type) {
      case 'hover-start':
        this.onHover()
        break
      case 'click':
        this.onClick()
        break
    }
  }

  onDragStart(): void {
    this.dragging = true
    this.cancelWander()
    this.setClip('idle')
  }

  onDragEnd(): void {
    this.dragging = false
    // A little startled shake after being put down, then resume ambient life.
    this.playReact()
  }

  onClipEnded(clip: ClipName): void {
    if (clip !== 'react') return
    if (this.reactTimer) {
      clearTimeout(this.reactTimer)
      this.reactTimer = null
    }
    this.busy = false
    if (!this.dragging) {
      this.setClip('idle')
      this.scheduleAmbient()
    }
  }

  // ---- reactions ------------------------------------------------------------

  private onHover(): void {
    if (this.busy || this.dragging) return
    // Affectionate cats greet you; independent ones often ignore a hover.
    const chance = 0.35 + this.personality.affection * 0.5 - this.personality.independence * 0.25
    if (Math.random() < chance) this.playReact()
  }

  private onClick(): void {
    if (this.dragging) return
    this.playReact()
  }

  private playReact(): void {
    this.cancelWander()
    this.busy = true
    this.setClip('react')
    if (this.reactTimer) clearTimeout(this.reactTimer)
    this.reactTimer = setTimeout(() => this.onClipEnded('react'), REACT_SAFETY_MS)
  }

  private startWander(): void {
    if (this.dragging || this.win.isDestroyed()) return
    const wa = screen.getDisplayMatching(this.win.getBounds()).workArea
    const minX = wa.x
    const maxX = wa.x + wa.width - this.win.getBounds().width
    if (maxX - minX < MIN_WANDER) {
      this.finishWander()
      return
    }
    // Pick a target that's a worthwhile distance away, clamped on-screen.
    let target = Math.round(minX + Math.random() * (maxX - minX))
    if (Math.abs(target - this.curX) < MIN_WANDER) {
      target = this.curX + (target >= this.curX ? 1 : -1) * (MIN_WANDER + Math.random() * 140)
      target = Math.round(Math.max(minX, Math.min(maxX, target)))
    }
    this.wanderTarget = target
    this.walkDist = 0
    this.facing = target < this.curX ? 'left' : 'right'
    this.setClip('walk', this.facing)
  }

  // The always-on physics tick: walk toward a wander target (horizontal) and
  // fall onto whatever window/floor is under the feet (vertical gravity). This is
  // what makes the pet "aware of what it's standing on".
  private physics(): void {
    if (this.win.isDestroyed()) return
    if (++this.refreshCtr >= REFRESH_EVERY) { this.refreshCtr = 0; refreshPlatforms() }
    if (this.dragging) { const [x, y] = this.win.getPosition(); this.curX = x; this.curY = y; return }

    const b = this.win.getBounds()

    // Horizontal: advance toward the wander target while the walk clip is playing.
    if (this.wanderTarget !== null && this.clip === 'walk') {
      const dx = this.wanderTarget - this.curX
      if (Math.abs(dx) <= WALK_SPEED) { this.curX = this.wanderTarget; this.finishWander() }
      else { this.curX += Math.sign(dx) * WALK_SPEED; this.walkDist += WALK_SPEED }
    }

    // Vertical: gravity toward the support surface under the feet.
    const feetOff = this.feetOffset(b.height)
    const feetX = this.curX + b.width / 2
    const feetY0 = this.curY + feetOff
    const T = supportY(feetX, feetY0)
    const gap = T - feetY0
    if (gap > 0.5) { this.curY = Math.min(T, feetY0 + FALL_SPEED) - feetOff; this.falling = true }
    else { this.curY = T - feetOff; this.falling = false }

    // Play the flailing fall clip while dropping a meaningful distance; land to idle.
    if (this.falling && gap > FALL_CLIP_GAP && this.clip !== 'fall' && !this.dragging) {
      this.cancelWander()
      if (this.reactTimer) { clearTimeout(this.reactTimer); this.reactTimer = null }
      this.busy = false
      this.setClip('fall', this.facing)
    } else if (!this.falling && this.clip === 'fall') {
      this.setClip('idle')
      this.scheduleAmbient(400)
    }

    const rx = Math.round(this.curX), ry = Math.round(this.curY)
    if (rx !== this.lastX || ry !== this.lastY) {
      this.win.setPosition(rx, ry)
      this.lastX = rx
      this.lastY = ry
    }
    if (this.clip === 'walk' && !this.falling) this.win.webContents.send('pet:walk-step', (this.walkDist / STRIDE) % 1)
  }

  private finishWander(): void {
    this.wanderTarget = null
    if (!this.dragging) {
      this.setClip('idle')
      this.scheduleAmbient()
    }
  }

  private cancelWander(): void {
    this.wanderTarget = null
  }

  private startSleep(): void {
    this.setClip('sleep')
    // Nap for a while; the next ambient tick wakes the cat into a new action.
    this.scheduleAmbient(7000 + Math.random() * 7000)
  }

  // ---- personality-weighted ambient loop ------------------------------------

  private scheduleAmbient(delayMs?: number): void {
    if (this.ambientTimer) clearTimeout(this.ambientTimer)
    const delay = delayMs ?? 3000 + Math.random() * 5000
    this.ambientTimer = setTimeout(() => this.ambientTick(), delay)
  }

  private ambientTick(): void {
    if (this.dragging || this.busy || this.falling) {
      this.scheduleAmbient(2000)
      return
    }
    const p = this.personality
    const action = weightedPick<'wander' | 'sleep' | 'linger'>([
      { item: 'wander', weight: 0.3 + p.energy * 0.9 + p.curiosity * 0.3 },
      { item: 'sleep', weight: 0.15 + p.sleepiness * 1.0 - p.energy * 0.2 },
      { item: 'linger', weight: 0.4 + (1 - p.energy) * 0.4 }
    ])
    switch (action) {
      case 'wander':
        this.startWander()
        break
      case 'sleep':
        this.startSleep()
        break
      default:
        this.setClip('idle')
        this.scheduleAmbient()
        break
    }
  }

  // ---- plumbing -------------------------------------------------------------

  private setClip(clip: ClipName, facing?: Facing): void {
    this.clip = clip
    if (facing) this.facing = facing
    this.send()
  }

  private send(): void {
    if (this.win.isDestroyed()) return
    const cmd: PlayCommand = { clip: this.clip, facing: this.facing }
    this.win.webContents.send('pet:play', cmd)
  }
}
