import { BrowserWindow, screen } from 'electron'
import type { ClipName, Facing, Personality, PlayCommand, TriggerEvent } from '../../shared/types'
import type { Needs, Difficulty, CareAction, CareStatus } from '../../shared/care'
import { SPRITE_H, BOB_AMPLITUDE } from '../../shared/constants'
import { weightedPick } from './personality'
import { decay, apply as applyCare, nudge, careState, freshNeeds } from '../care/needs'
import { refreshPlatforms, supportY } from '../desktop/world'

const MOVE_TICK_MS = 16
const WALK_SPEED = 0.35 // px per tick (~22 px/s) — a calm walking pace, not a scramble
const MIN_WANDER = 90 // don't bother wandering shorter than this
const STRIDE = 12 // px travelled per full gait cycle; = 2*A/stance in the walk pose
const SHOT_SAFETY_MS = 4500 // force-end a one-shot if the renderer never reports it
const GRAVITY = 0.45 // px/tick² — vertical acceleration while airborne
const MAX_FALL = 9 // terminal velocity, px/tick
const FALL_CLIP_GAP = 10 // only show the flailing fall clip when dropping more than this
const REFRESH_EVERY = 15 // physics ticks between window-list refreshes (~240ms)
const EDGE_LOOKAHEAD = 9 // px ahead of the feet to probe for a drop while walking
const EDGE_DROP = 40 // a support drop bigger than this counts as "an edge"
const TEETER_MS = 1900 // how long the cat wobbles at an edge before deciding
const POOF_MS = 1100 // how long the scared poof holds
const BIG_FALL = 90 // falls taller than this spook the cat on landing
const CARE_TICK_MS = 60_000 // needs decay + self-care cadence (Care Mode)

/**
 * The pet's brain. Owns behavior: routes trigger events to reactions, runs the
 * personality-weighted ambient loop (wander / nap / loaf / groom / pounce),
 * and owns physics: walking, gravity onto window platforms, ballistic leaps.
 * It tells the renderer *what* to play via `pet:play`; the renderer's animation
 * graph decides *how* to get there (turning, sitting down, tucking in) and
 * reports arrival via `pet:state-reached`.
 */
export class PetEngine {
  private clip: ClipName = 'idle'
  private facing: Facing = 'right'
  private stayPut = false // settings: hold this spot (no wandering / leaping)
  private disabled = new Set<ClipName>() // settings: animations the user turned off
  private dragging = false
  private busy = false // a one-shot (react/yawn/stretch) is playing
  private visualReady = false // renderer's graph has arrived at this.clip
  private wanderTarget: number | null = null
  private curX = 0 // internal float position (avoids get/set round-trip jitter)
  private curY = 0
  private lastX = 0 // last integer position sent (avoid redundant setPosition calls)
  private lastY = 0
  private walkDist = 0 // px travelled this wander, drives the gait phase
  private vx = 0 // ballistic horizontal velocity (leaps)
  private vy = 0 // vertical velocity (gravity / leap impulse)
  private airMode: 'none' | 'fall' | 'leap' = 'none'
  private fallStartY = 0 // where the current fall began (poof on big landings)
  private walkAskedAt = 0 // when we requested the walk visual (stall safety)
  private afterShot: (() => void) | null = null // continuation after a one-shot ends
  private refreshCtr = 0
  private physicsTimer: ReturnType<typeof setInterval> | null = null
  private ambientTimer: ReturnType<typeof setTimeout> | null = null
  private actionTimer: ReturnType<typeof setTimeout> | null = null
  // ---- Care Mode ----
  private careMode = false
  private needs: Needs | null = null
  private difficulty: Difficulty = 'normal'
  private careTimer: ReturnType<typeof setInterval> | null = null
  private lastCareTs = 0
  private careSaveCtr = 0
  private saver: ((n: Needs) => void) | null = null
  private emoter: ((kind: string) => void) | null = null

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
    this.physicsTimer = setInterval(() => this.physics(), MOVE_TICK_MS)
    this.send()
    this.scheduleAmbient(1500)
  }

  dispose(): void {
    if (this.careMode) this.persistNeeds()
    if (this.physicsTimer) clearInterval(this.physicsTimer)
    if (this.ambientTimer) clearTimeout(this.ambientTimer)
    if (this.actionTimer) clearTimeout(this.actionTimer)
    if (this.careTimer) clearInterval(this.careTimer)
  }

  /** Feet position (window-local y), accounting for the bob headroom. */
  private feetOffset(height: number): number {
    const scale = height / (SPRITE_H + BOB_AMPLITUDE * 2)
    return height - BOB_AMPLITUDE * scale
  }

  // ---- renderer feedback -----------------------------------------------------

  onStateReached(clip: ClipName): void {
    if (clip === this.clip) this.visualReady = true
  }

  onClipEnded(clip: ClipName): void {
    if (this.actionTimer) { clearTimeout(this.actionTimer); this.actionTimer = null }
    this.busy = false
    const next = this.afterShot
    this.afterShot = null
    if (this.dragging) return
    if (next) { next(); return }
    if (clip === 'react' || clip === 'yawn' || clip === 'stretch' || clip === 'paw') {
      this.setClip('idle')
      this.scheduleAmbient()
    }
  }

  /** "Stay here" mode: no wandering, no pounce leaps — the cat holds its spot. */
  setStayPut(v: boolean): void {
    this.stayPut = v
    if (v && this.clip === 'walk') this.finishWander()
  }

  /** Per-animation opt-outs from settings. */
  setDisabled(anims: ClipName[]): void {
    this.disabled = new Set(anims)
    // If the cat is currently doing something the user just turned off, wind it down.
    if (this.disabled.has(this.clip) && (this.clip === 'sleep' || this.clip === 'loaf' || this.clip === 'sphinx' || this.clip === 'groom')) {
      this.setClip('idle')
      this.scheduleAmbient(600)
    }
  }

  private allowed(clip: ClipName): boolean {
    return !this.disabled.has(clip)
  }

  // ---- Care Mode ------------------------------------------------------------

  /** Turn Care Mode on with the given (already elapsed-decayed) needs. */
  enableCare(needs: Needs, difficulty: Difficulty, save: (n: Needs) => void): void {
    this.needs = needs
    this.difficulty = difficulty
    this.saver = save
    this.careMode = true
    this.lastCareTs = Date.now()
    if (!this.careTimer) this.careTimer = setInterval(() => this.careTick(), CARE_TICK_MS)
  }

  disableCare(): void {
    this.persistNeeds()
    this.careMode = false
    if (this.careTimer) { clearInterval(this.careTimer); this.careTimer = null }
  }

  setDifficulty(d: Difficulty): void {
    this.difficulty = d
  }

  /** Swap in another pet's needs (on active-pet change) without a time jump. */
  setNeeds(needs: Needs): void {
    this.needs = needs
    this.lastCareTs = Date.now()
  }

  /** A care action from the menu or a dragged object. */
  careAction(action: CareAction): void {
    if (!this.careMode || !this.needs) return
    this.needs = applyCare(this.needs, action)
    this.persistNeeds()
    // A little visual reward: sparkles for healing/cleaning, hearts otherwise.
    this.emoter?.(action === 'heal' || action === 'groom' ? 'sparkle' : 'heart')
    if (this.dragging || this.busy || this.airMode !== 'none') return
    // A pleased acknowledgement: play makes it pounce; the rest a happy react.
    if (action === 'play' && !this.stayPut && this.allowed('pounce')) this.startPounce()
    else if ((this.clip === 'idle' || this.clip === 'sit') && this.allowed('react')) this.playOneShot('react')
  }

  getStatus(): CareStatus {
    const needs = this.needs ?? freshNeeds()
    return { enabled: this.careMode, needs, state: careState(needs) }
  }

  /** Whether the cat is currently asleep (drives Dream Mode). */
  isSleeping(): boolean {
    return this.clip === 'sleep'
  }

  private persistNeeds(): void {
    if (this.needs && this.saver) this.saver(this.needs)
  }

  private careTick(): void {
    if (!this.careMode || !this.needs) return
    const now = Date.now()
    const hours = (now - this.lastCareTs) / 3_600_000
    this.lastCareTs = now
    this.needs = decay(this.needs, hours, this.difficulty)
    // Self-care: the cat restores energy while resting, hygiene while grooming.
    if (this.clip === 'sleep') this.needs = nudge(this.needs, 'energy', 0.03)
    else if (this.clip === 'loaf' || this.clip === 'sphinx') this.needs = nudge(this.needs, 'energy', 0.012)
    if (this.clip === 'groom') this.needs = nudge(this.needs, 'hygiene', 0.03)
    if (++this.careSaveCtr >= 3) { this.careSaveCtr = 0; this.persistNeeds() }
  }

  // ---- trigger intake ----------------------------------------------------------

  emit(ev: TriggerEvent): void {
    switch (ev.type) {
      case 'hover-start':
        this.onHover()
        break
      case 'click':
        this.onClick()
        break
      case 'leap':
        this.onLeap()
        break
    }
  }

  onDragStart(): void {
    this.dragging = true
    this.cancelWander()
    this.airMode = 'none'
    this.vy = 0
    this.vx = 0
    this.setClip('idle')
  }

  onDragEnd(): void {
    this.dragging = false
    // A little startled shake after being put down, then resume ambient life.
    if (this.allowed('react')) this.playOneShot('react')
    else this.scheduleAmbient(800)
  }

  // ---- reactions ---------------------------------------------------------------

  private onHover(): void {
    if (this.busy || this.dragging) return
    // Sleep/loaf/sphinx hover responses are renderer-local (ear-perk, head-turn) — don't wake.
    if (this.clip === 'sleep' || this.clip === 'loaf' || this.clip === 'sphinx') return
    if (this.clip !== 'idle' && this.clip !== 'sit') return
    // Affectionate cats greet you; independent ones often ignore a hover.
    const chance = 0.35 + this.personality.affection * 0.5 - this.personality.independence * 0.25
    if (Math.random() < chance) {
      // Sometimes the greeting is a paw reaching at you instead of a glance.
      const pawChance = 0.25 + this.personality.affection * 0.4
      const usePaw = this.allowed('paw') && (Math.random() < pawChance || !this.allowed('react'))
      if (usePaw) this.playOneShot('paw')
      else if (this.allowed('react')) this.playOneShot('react')
    }
  }

  private onClick(): void {
    if (this.dragging) return
    if (this.careMode && this.needs) this.needs = nudge(this.needs, 'fun', 0.05) // petting is fun
    this.emoter?.('heart') // a little love
    if (this.allowed('react')) this.playOneShot('react')
  }

  /** Set the callback that floats emote particles over the cat. */
  setEmoter(fn: (kind: string) => void): void {
    this.emoter = fn
  }

  /** Manually play a clip on demand (the settings "try an animation" gallery). */
  forcePlay(clip: ClipName): void {
    if (this.dragging || this.win.isDestroyed()) return
    this.cancelWander()
    if (this.actionTimer) { clearTimeout(this.actionTimer); this.actionTimer = null }
    this.busy = false
    this.afterShot = null
    this.airMode = 'none'; this.vx = 0; this.vy = 0
    switch (clip) {
      case 'yawn': case 'stretch': case 'react': case 'paw': this.playOneShot(clip); break
      case 'pounce': this.startPounce(); break
      case 'walk': this.startWander(); break
      case 'sleep': this.setClip('sleep'); this.scheduleAmbient(this.dwellFor('sleep')); break
      case 'loaf': this.setClip('loaf'); this.scheduleAmbient(this.dwellFor('loaf')); break
      case 'sphinx': this.setClip('sphinx'); this.scheduleAmbient(this.dwellFor('sphinx')); break
      case 'groom': this.setClip('groom'); this.scheduleAmbient(this.dwellFor('groom')); break
      default: this.setClip(clip); this.scheduleAmbient(this.dwellFor('sit')); break // idle/sit/teeter/poof/sick/sulk
    }
  }

  /** Play a one-shot (react/yawn/stretch); `after` chains the next action. */
  private playOneShot(shot: ClipName, after?: () => void): void {
    this.cancelWander()
    this.busy = true
    this.afterShot = after ?? null
    this.setClip(shot)
    if (this.actionTimer) clearTimeout(this.actionTimer)
    this.actionTimer = setTimeout(() => this.onClipEnded(shot), SHOT_SAFETY_MS)
  }

  // ---- wandering + physics -------------------------------------------------------

  private startWander(): void {
    if (this.dragging || this.win.isDestroyed()) return
    const wa = screen.getDisplayMatching(this.win.getBounds()).workArea
    const minX = wa.x
    const maxX = wa.x + wa.width - this.win.getBounds().width
    if (maxX - minX < MIN_WANDER) {
      this.finishWander()
      return
    }
    let target = Math.round(minX + Math.random() * (maxX - minX))
    if (Math.abs(target - this.curX) < MIN_WANDER) {
      target = this.curX + (target >= this.curX ? 1 : -1) * (MIN_WANDER + Math.random() * 140)
      target = Math.round(Math.max(minX, Math.min(maxX, target)))
    }
    this.wanderTarget = target
    this.walkDist = 0
    this.facing = target < this.curX ? 'left' : 'right'
    this.walkAskedAt = Date.now()
    this.setClip('walk', this.facing)
  }

  // The always-on physics tick: walking, gravity onto whatever window/taskbar is
  // under the feet, ballistic leaps, and edge detection (teeter before a drop).
  private physics(): void {
    if (this.win.isDestroyed()) return
    if (++this.refreshCtr >= REFRESH_EVERY) { this.refreshCtr = 0; refreshPlatforms() }
    if (this.dragging) {
      const [x, y] = this.win.getPosition()
      this.curX = x
      this.curY = y
      return
    }

    const b = this.win.getBounds()
    const feetOff = this.feetOffset(b.height)

    // Horizontal: walking (gated on the renderer having visually reached the walk)
    // or ballistic drift during a leap.
    if (this.airMode === 'leap') {
      this.curX += this.vx
    } else if (this.wanderTarget !== null && this.clip === 'walk') {
      if (this.visualReady) {
        const feetX = this.curX + b.width / 2
        const feetY = this.curY + feetOff
        // An edge ahead? Stop and teeter before walking off.
        const dir = this.facing === 'right' ? 1 : -1
        const aheadT = supportY(feetX + dir * EDGE_LOOKAHEAD, feetY)
        if (aheadT - feetY > EDGE_DROP && this.airMode === 'none') {
          if (this.allowed('teeter')) {
            this.startTeeter()
          } else {
            // Teeter turned off: just turn around at the edge.
            this.cancelWander()
            this.facing = this.facing === 'right' ? 'left' : 'right'
            this.setClip('idle', this.facing)
            this.scheduleAmbient(700)
          }
          return
        }
        const dx = this.wanderTarget - this.curX
        if (Math.abs(dx) <= WALK_SPEED) {
          this.curX = this.wanderTarget
          this.finishWander()
        } else {
          this.curX += Math.sign(dx) * WALK_SPEED
          this.walkDist += WALK_SPEED
        }
      } else if (Date.now() - this.walkAskedAt > 5000) {
        this.finishWander() // renderer never arrived; don't stall forever
      }
    }

    // Vertical: gravity toward the support surface under the feet.
    const feetX = this.curX + b.width / 2
    const feetY0 = this.curY + feetOff
    const T = supportY(feetX, feetY0)
    const gap = T - feetY0
    if (gap > 0.5 || this.vy < 0) {
      if (this.airMode === 'none') {
        this.airMode = 'fall'
        this.fallStartY = feetY0
      }
      this.vy = Math.min(MAX_FALL, this.vy + GRAVITY)
      const newFeetY = this.vy > 0 ? Math.min(T, feetY0 + this.vy) : feetY0 + this.vy
      this.curY = newFeetY - feetOff
      // Show the flailing fall once it's a real drop (not for leaps going up).
      if (this.airMode === 'fall' && this.vy > 0 && T - newFeetY > 0 && gap > FALL_CLIP_GAP && this.clip !== 'fall') {
        this.cancelWander()
        this.busy = false
        this.afterShot = null
        this.setClip('fall', this.facing)
      }
      if (newFeetY >= T && this.vy > 0) this.landAt(T, feetOff)
    } else {
      this.curY = T - feetOff
      if (this.airMode !== 'none') this.landAt(T, feetOff)
    }

    const rx = Math.round(this.curX), ry = Math.round(this.curY)
    if (rx !== this.lastX || ry !== this.lastY) {
      this.win.setPosition(rx, ry)
      this.lastX = rx
      this.lastY = ry
    }
    if (this.clip === 'walk' && this.airMode === 'none' && this.visualReady) {
      this.win.webContents.send('pet:walk-step', (this.walkDist / STRIDE) % 1)
    }
  }

  private landAt(T: number, feetOff: number): void {
    const dropped = T - this.fallStartY
    const wasLeap = this.airMode === 'leap'
    this.airMode = 'none'
    this.vy = 0
    this.vx = 0
    this.curY = T - feetOff
    if (this.clip === 'fall' || this.clip === 'pounce' || wasLeap) {
      if (!wasLeap && dropped > BIG_FALL && this.allowed('poof')) {
        // That was a long way down — Halloween-cat moment, then compose yourself.
        this.setClip('poof')
        if (this.actionTimer) clearTimeout(this.actionTimer)
        this.actionTimer = setTimeout(() => {
          this.setClip('idle')
          this.scheduleAmbient(800)
        }, POOF_MS)
      } else {
        this.setClip('idle')
        this.scheduleAmbient(600)
      }
    }
  }

  // ---- edge teetering ------------------------------------------------------------

  private startTeeter(): void {
    this.cancelWander()
    this.setClip('teeter', this.facing)
    if (this.actionTimer) clearTimeout(this.actionTimer)
    this.actionTimer = setTimeout(() => {
      if (this.dragging || this.clip !== 'teeter') return
      const p = this.personality
      // Bold cats sometimes just hop down; most back away from the edge.
      if (Math.random() < 0.2 + p.curiosity * 0.25 + p.mischief * 0.2) {
        const dir = this.facing === 'right' ? 1 : -1
        this.airMode = 'leap'
        this.fallStartY = 0 // a chosen hop never spooks
        this.vx = dir * 1.6
        this.vy = -2.4
        this.setClip('fall', this.facing) // legs out as it drops
      } else {
        this.facing = this.facing === 'right' ? 'left' : 'right'
        this.setClip('idle', this.facing)
        this.scheduleAmbient(900)
      }
    }, TEETER_MS)
  }

  // ---- the pounce ------------------------------------------------------------------

  private startPounce(): void {
    // Face whichever side has more room to land in.
    const wa = screen.getDisplayMatching(this.win.getBounds()).workArea
    const centre = wa.x + wa.width / 2
    this.facing = this.curX < centre ? 'right' : 'left'
    this.setClip('pounce', this.facing)
    // Safety: if the renderer never sends 'leap', recover.
    if (this.actionTimer) clearTimeout(this.actionTimer)
    this.actionTimer = setTimeout(() => {
      if (this.clip === 'pounce' && this.airMode === 'none') {
        this.setClip('idle')
        this.scheduleAmbient()
      }
    }, SHOT_SAFETY_MS)
  }

  /** The renderer finished the butt-wiggle and left the ground — apply the impulse. */
  private onLeap(): void {
    if (this.clip !== 'pounce' || this.dragging) return
    if (this.actionTimer) { clearTimeout(this.actionTimer); this.actionTimer = null }
    this.airMode = 'leap'
    this.fallStartY = 0
    this.vx = (this.facing === 'right' ? 1 : -1) * 2.1
    this.vy = -5.2
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

  // ---- personality-weighted ambient loop ---------------------------------------

  /**
   * How long the cat holds a resting state before the next ambient decision.
   * Restful states dwell much longer than fidgety ones — a nap is minutes-ish,
   * not seconds — and personality stretches them (a sleepy cat sleeps far
   * longer). These are floors-with-jitter, so sleep is never a 2-second blip.
   */
  private dwellFor(state: 'sleep' | 'loaf' | 'sphinx' | 'groom' | 'sit' | 'idle'): number {
    const p = this.personality
    const r = (min: number, max: number): number => min + Math.random() * (max - min)
    switch (state) {
      case 'sleep': return r(15000, 26000) * (0.75 + p.sleepiness * 0.9) // ~12s floor, much longer for sleepy cats
      case 'loaf': return r(11000, 19000) * (0.8 + p.sleepiness * 0.45)
      case 'sphinx': return r(11000, 19000) * (0.8 + p.sleepiness * 0.45)
      case 'groom': return r(5000, 9000)
      case 'sit': return r(4500, 9000) * (0.85 + (1 - p.energy) * 0.4)
      default: return r(3000, 6500) // idle / linger — brief, restless
    }
  }

  private scheduleAmbient(delayMs?: number): void {
    if (this.ambientTimer) clearTimeout(this.ambientTimer)
    const delay = delayMs ?? 3000 + Math.random() * 5000
    this.ambientTimer = setTimeout(() => this.ambientTick(), delay)
  }

  private ambientTick(): void {
    if (this.dragging || this.busy || this.airMode !== 'none' || this.clip === 'teeter' || this.clip === 'pounce') {
      this.scheduleAmbient(2000)
      return
    }
    const p = this.personality
    const wasAsleep = this.clip === 'sleep'
    // Care Mode bends the ambient weights toward how the cat FEELS: hungry cats
    // beg (paw) at you, tired/unwell cats rest, dirty cats groom, bored cats
    // roam. All these terms are 0 when Care Mode is off → identical to before.
    const n = this.careMode ? this.needs : null
    const lowHunger = n ? 1 - n.hunger : 0
    const tired = n ? 1 - n.energy : 0
    const bored = n ? 1 - n.fun : 0
    const dirty = n ? 1 - n.hygiene : 0
    const sick = n && n.health < 0.5 ? 1 - n.health : 0
    const action = weightedPick<'wander' | 'sleep' | 'loaf' | 'sphinx' | 'groom' | 'pounce' | 'paw' | 'sit' | 'linger' | 'sick' | 'sulk'>([
      // When genuinely unwell, lying down with the cone dominates everything.
      { item: 'sick', weight: n && n.health < 0.35 ? 4 + (0.35 - n.health) * 12 : 0 },
      // Bored & not unwell: sulk (ears back) some of the time.
      { item: 'sulk', weight: n && n.fun < 0.25 && n.health >= 0.35 ? 0.8 + bored * 1.4 : 0 },
      // Stay-put drops the moving actions; per-animation opt-outs drop theirs.
      { item: 'wander', weight: this.stayPut ? 0 : (0.3 + p.energy * 0.8 + p.curiosity * 0.3 + bored * 0.6 + lowHunger * 0.3) * (1 - tired * 0.6) * (1 - sick) },
      { item: 'sleep', weight: this.allowed('sleep') ? 0.12 + p.sleepiness * 0.9 - p.energy * 0.2 + tired * 0.9 + sick * 1.4 : 0 },
      { item: 'loaf', weight: this.allowed('loaf') ? 0.14 + p.sleepiness * 0.35 + (1 - p.energy) * 0.25 + tired * 0.5 + sick * 1.2 : 0 },
      { item: 'sphinx', weight: this.allowed('sphinx') ? 0.14 + p.sleepiness * 0.25 + (1 - p.energy) * 0.25 + tired * 0.4 + sick * 0.8 : 0 },
      { item: 'groom', weight: this.allowed('groom') ? 0.15 + p.independence * 0.2 + dirty * 1.3 : 0 },
      { item: 'pounce', weight: this.stayPut || !this.allowed('pounce') ? 0 : (0.06 + p.energy * 0.35 + p.mischief * 0.35 + bored * 0.3) * (1 - tired * 0.8) * (1 - sick) },
      { item: 'paw', weight: this.allowed('paw') ? (0.05 + p.affection * 0.22 + lowHunger * 1.3 + bored * 0.3) * (1 - sick * 0.7) : 0 },
      { item: 'sit', weight: 0.2 + (1 - p.energy) * 0.2 + sick * 0.3 },
      { item: 'linger', weight: 0.3 + (1 - p.energy) * 0.3 + sick * 0.4 }
    ])
    const go = (): void => {
      switch (action) {
        case 'wander':
          this.startWander()
          break
        case 'sleep':
          this.setClip('sleep')
          this.scheduleAmbient(this.dwellFor('sleep'))
          break
        case 'loaf':
          this.setClip('loaf')
          this.scheduleAmbient(this.dwellFor('loaf'))
          break
        case 'sphinx':
          this.setClip('sphinx')
          this.scheduleAmbient(this.dwellFor('sphinx'))
          break
        case 'groom':
          this.setClip('groom')
          this.scheduleAmbient(this.dwellFor('groom'))
          break
        case 'sick':
          this.setClip('sick')
          this.scheduleAmbient(this.dwellFor('sleep')) // a long, lethargic lie
          break
        case 'sulk':
          this.setClip('sulk')
          this.scheduleAmbient(this.dwellFor('sit'))
          break
        case 'pounce':
          this.startPounce()
          break
        case 'paw':
          this.playOneShot('paw')
          break
        case 'sit':
          this.setClip('sit')
          this.scheduleAmbient(this.dwellFor('sit'))
          break
        default:
          this.setClip('idle')
          this.scheduleAmbient(this.dwellFor('idle'))
          break
      }
    }
    // Flourishes: a yawn on the way to a nap; a stretch on waking up to move.
    if (action === 'sleep' && this.clip === 'idle' && this.allowed('yawn') && Math.random() < 0.45 + p.sleepiness * 0.45) {
      this.playOneShot('yawn', go)
    } else if (wasAsleep && (action === 'wander' || action === 'pounce') && this.allowed('stretch')) {
      this.playOneShot('stretch', go)
    } else {
      go()
    }
  }

  // ---- plumbing ------------------------------------------------------------------

  private setClip(clip: ClipName, facing?: Facing): void {
    if (clip !== this.clip) this.visualReady = false
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
