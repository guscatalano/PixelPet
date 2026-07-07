import { BrowserWindow, screen } from 'electron'
import type { ClipName, Facing, Personality, PlayCommand, TriggerEvent } from '../../shared/types'
import { PET_W } from '../../shared/constants'
import { weightedPick } from './personality'

const MOVE_TICK_MS = 30
const WALK_SPEED = 1.6 // px per tick while wandering
const REACT_SAFETY_MS = 650 // force-end a react if the renderer never reports it

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
  private moveTimer: ReturnType<typeof setInterval> | null = null
  private ambientTimer: ReturnType<typeof setTimeout> | null = null
  private reactTimer: ReturnType<typeof setTimeout> | null = null

  constructor(
    private readonly win: BrowserWindow,
    public personality: Personality
  ) {}

  /** Begin idling + ambient scheduling once the renderer is ready. */
  start(): void {
    this.send()
    this.scheduleAmbient(1500)
  }

  dispose(): void {
    if (this.moveTimer) clearInterval(this.moveTimer)
    if (this.ambientTimer) clearTimeout(this.ambientTimer)
    if (this.reactTimer) clearTimeout(this.reactTimer)
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
    const [x] = this.win.getPosition()
    const minX = wa.x
    const maxX = wa.x + wa.width - PET_W
    if (maxX <= minX) {
      this.finishWander()
      return
    }
    const target = Math.round(minX + Math.random() * (maxX - minX))
    this.wanderTarget = Math.max(minX, Math.min(maxX, target))
    this.facing = this.wanderTarget < x ? 'left' : 'right'
    this.setClip('walk', this.facing)
    if (!this.moveTimer) this.moveTimer = setInterval(() => this.moveTick(), MOVE_TICK_MS)
  }

  private moveTick(): void {
    if (this.wanderTarget === null || this.dragging || this.win.isDestroyed()) return
    const [x, y] = this.win.getPosition()
    const dx = this.wanderTarget - x
    if (Math.abs(dx) <= WALK_SPEED) {
      this.win.setPosition(this.wanderTarget, y)
      this.finishWander()
      return
    }
    this.win.setPosition(Math.round(x + Math.sign(dx) * WALK_SPEED), y)
  }

  private finishWander(): void {
    this.wanderTarget = null
    if (this.moveTimer) {
      clearInterval(this.moveTimer)
      this.moveTimer = null
    }
    if (!this.dragging) {
      this.setClip('idle')
      this.scheduleAmbient()
    }
  }

  private cancelWander(): void {
    this.wanderTarget = null
    if (this.moveTimer) {
      clearInterval(this.moveTimer)
      this.moveTimer = null
    }
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
    if (this.dragging || this.busy) {
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
