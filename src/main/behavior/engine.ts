import { app, BrowserWindow, screen } from 'electron'
import { appendFileSync } from 'node:fs'
import { join } from 'node:path'
import type { ClipName, Facing, Personality, PlayCommand, TriggerEvent } from '../../shared/types'
import type { Needs, Difficulty, CareAction, CareStatus } from '../../shared/care'
import { SPRITE_H, BOB_AMPLITUDE } from '../../shared/constants'
import { weightedPick } from './personality'
import { decay, apply as applyCare, nudge, careState, freshNeeds } from '../care/needs'
import { refreshPlatforms, supportY, ledgesAbove } from '../desktop/world'
import { winCoord } from '../desktop/coords'
import { pickWanderTarget } from './wander'

const MOVE_TICK_MS = 16
const WALK_SPEED = 0.35 // px per tick (~22 px/s) — a calm walking pace, not a scramble
const PRANCE_SPEED = 0.47 // an excited prance covers ground a bit faster than the walk
// Every clip that travels across the screen (a gait). Its speed comes from GAIT_SPEED.
// A zoomies fit: several short sprints with hard turns, not one long walk. Rare
// by design — it should feel like the cat briefly lost its mind, and a pet that
// does it often is just annoying.
const ZOOMIES_SPEED = 3.4 // px/tick (~210 px/s nominal) — a flat-out tear that
// the 4Hz bounding cycle can still sell; see strideFor()
const ZOOMIES_ACCEL_PX = 46 // explode out of each turn over this distance…
const ZOOMIES_BRAKE_PX = 56 // …and skid into the next one over this. Constant
// velocity read as gliding; the ramps are what make it look unhinged.
const ZOOMIES_DASHES = [4, 7] as const // inclusive range of sprints per fit
const ZOOMIES_LEG = [140, 420] as const // px per sprint
const WALK_CLIPS = new Set<ClipName>(['walk', 'prance', 'stalk', 'trot', 'hop', 'zoomies'])
// Trot is deliberately quicker than prance: the two share bounce machinery in
// the sprite generator (trot ≈ a 70% prance), so pace is what tells them apart —
// prance is a showy bounce on the spot-ish, trot is briskly going somewhere.
const TROT_SPEED = 0.62
// A bound is a discrete event, not a way of getting about: a cat clears a gap in
// one or two and then walks. It used to be a full travel gait at a 12px stride,
// so a 300px wander came out as ~25 consecutive bunny-hops. Each bound now
// covers real ground and a hop trip is only one or two of them.
//   NB this constrains the hop CLIP (an override any pet can play). A creature
//   whose DNA gait is 'hop' still bounds continuously, because that renders
//   through the plain walk clip with the pet's own geometry — rabbits unaffected.
const HOP_STRIDE = 52 // px covered by a single bound
// A trot's stance is half the cycle (vs the walk's 0.75), so its stride is
// 2*A/0.5 = 18px in generator units. Must track SWING in catgen.generateWalkGrid
// or a planted foot slides against the ground.
const TROT_STRIDE = 18
const HOP_SPEED = 1.5 // px/tick (~94px/s) → ~1.8 bounds/sec at that stride
const HOP_BOUNDS = [1, 2] as const // inclusive range of bounds per hop trip
const GAIT_SPEED: Partial<Record<ClipName, number>> = { prance: PRANCE_SPEED, trot: TROT_SPEED, stalk: 0.22, hop: HOP_SPEED, zoomies: ZOOMIES_SPEED }
/** Gaits whose stride is a fixed physical distance rather than derived from
 *  speed — a bound covers a bound's worth of ground, whatever the pace. */
const GAIT_STRIDE: Partial<Record<ClipName, number>> = { hop: HOP_STRIDE, trot: TROT_STRIDE }
// Stalking is not a continuous slink: a hunting cat creeps a short way, FREEZES
// stock-still to watch, then creeps again. The freeze is most of what makes it
// read as hunting rather than as walking slowly.
const STALK_CREEP = [24, 78] as const // px covered between freezes
const STALK_FREEZE_MS = [520, 1700] as const // how long it holds, watching
const MIN_WANDER = 90 // don't bother wandering shorter than this
const STRIDE = 12 // px travelled per full gait cycle; = 2*A/stance in the walk pose
// Cats do not sprint by pedalling faster — stride LENGTH grows roughly linearly
// with velocity, and stride frequency stays in a narrow band (a galloping cat
// runs ~3-4 strides/sec, a walk ~1.5-2). With a fixed 12px stride, zoomies at
// 262px/s worked out to 22 leg cycles a second: a blur, and the thing that made
// it read as "walking unrealistically fast" rather than running.
const MAX_GAIT_HZ = 4
/** Stride length for a given speed: lengthen the stride rather than let the
 *  cycle rate run away. A no-op for walk/prance/trot, which are already under
 *  the cap at 12px — only the fast gaits stretch. */
function strideFor(pxPerTick: number): number {
  return Math.max(STRIDE, (pxPerTick * (1000 / MOVE_TICK_MS)) / MAX_GAIT_HZ)
}
const SHOT_SAFETY_MS = 4500 // force-end a one-shot if the renderer never reports it
// Clips that legitimately run longer than the default need their own ceiling, or
// the safety net cuts them off mid-performance. A randomised knead can reach ~9s.
const SHOT_SAFETY: Partial<Record<ClipName, number>> = { knead: 14000, kneadboth: 14000, knock: 6000 }
const DEFAULT_FACE_CHANCE = 0.4 // mirrors settings.ts; used before settings arrive
const CLIMB_GOAL_TTL_MS = 40_000 // give up on a debug climb target after this
const GRAVITY = 0.45 // px/tick² — vertical acceleration while airborne
const MAX_FALL = 9 // terminal velocity, px/tick
const FALL_CLIP_GAP = 10 // only show the flailing fall clip when dropping more than this
const REFRESH_EVERY = 15 // physics ticks between window-list refreshes (~240ms)
// ---- Climbing ----------------------------------------------------------------
// A pounce leaves the ground at vy = -5.2 against GRAVITY 0.45, so it peaks about
// 30px up — nowhere near the top of a real window. With nothing able to carry the
// pet upward it could only ever fall downhill, which is why it ended up living on
// the taskbar. A targeted jump gives it a way back up onto your windows.
const JUMP_CLEAR = 16 // px of clearance over the ledge at the top of the arc
const MAX_JUMP_RISE = 300 // the tallest step it will attempt (px)
const MAX_JUMP_REACH = 260 // the widest sideways gap it will attempt (px)
const MAX_JUMP_VX = 5.5 // cap the horizontal drift; beyond this it reads as flying
const EDGE_LOOKAHEAD = 9 // px ahead of the feet to probe for a drop while walking
const EDGE_DROP = 40 // a support drop bigger than this counts as "an edge"
const TEETER_MS = 1900 // how long the cat wobbles at an edge before deciding
// Time from the start of the knock clip to the swipe frame. Must match the sum
// of the frames before the swipe in knockFrames() (src/renderer/pet/main.ts).
const KNOCK_SWIPE_MS = 1300
// ---- The string toy -----------------------------------------------------------
// A play session follows the real feline prey sequence — stare, stalk, crouch &
// wiggle, pounce, sometimes a proper catch — because a cat that stands flat and
// pats at the air reads as nothing. The ENGINE owns the string: where it hangs,
// how it drifts (like prey: wander, twitch, occasionally bolt), and whether a
// leap actually connects. The overlay window just simulates a rope around the
// pivot it is handed.
const STRING_W = 180 // overlay size — room for the rope to whip without clipping
const STRING_H = 340
const ROPE_LEN = 150
const STRING_PIVOT_REST = 60 // window-relative resting pivot height
const STRING_KNOT_ABOVE = 55 // knot hangs this far above the pet's window top
const STRING_DART_CHANCE = 0.3 // prey sometimes bolts as the cat commits → a miss
const STRING_CATCH_CHANCE = 0.4 // a clean swat sometimes becomes a real catch
const STRING_MAX_ROUNDS = 2 // attempts per session (a win ends it early) — each
// round can include a stalk back under the string, so more than two runs long

/** The string-toy overlay, owned by main and driven from here.
 *  All coordinates are window-relative except show()'s screen origin. */
export interface StringToy {
  show: (x: number, y: number, width: number, height: number,
    cfg: { pivotX: number; pivotY: number; ropeLen: number }) => void
  pivot: (x: number, y: number) => void
  hit: (vx: number, vy: number) => void
  grab: (x: number, y: number) => void
  release: () => void
  hide: () => void
}

type StringPhase = 'drop' | 'stare' | 'stalk' | 'crouch' | 'air' | 'hold' | 'settle' | 'retract'
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
  private faceChance = DEFAULT_FACE_CHANCE // settings: how often it turns to you
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
  private stalkHoldUntil = 0 // frozen mid-creep until this timestamp
  private stalkNextPauseAt = 0 // walkDist at which the next freeze begins
  private vx = 0 // ballistic horizontal velocity (leaps)
  private vy = 0 // vertical velocity (gravity / leap impulse)
  private airMode: 'none' | 'fall' | 'leap' = 'none'
  /** Solved impulse for a climb, applied when the renderer reports the leap. */
  private pendingJump: { vx: number; vy: number } | null = null
  /** Debug: a ledge the pet has been told to get onto (see climbToward). */
  private climbGoal: { x: number; y: number } | null = null
  private climbGoalAt = 0 // when it was set, so a stale goal expires
  /** Sprints left in the current zoomies fit (0 = not having one). */
  private zoomiesLeft = 0
  private knockTimer: ReturnType<typeof setTimeout> | null = null
  private rollTimer: ReturnType<typeof setTimeout> | null = null // mid-flop roll
  /** Set by main: show something tumbling off the ledge at (x, y). */
  private knocker: ((x: number, y: number) => void) | null = null
  /** Set by main: the dangling string toy. */
  private stringToy: StringToy | null = null
  // ---- string-play session state (see stringTick) ----
  private strPhase: StringPhase | null = null
  private strTicks = 0 // ticks in the current phase
  private strClock = 0 // ticks since the session began (drives the prey drift)
  private strOrigin = { x: 0, y: 0 } // string window origin on screen
  private strBaseX = 0 // window-relative resting pivot x
  private strPivot = { x: 0, y: 0 } // window-relative pivot, engine-driven
  private strDart = 0 // ticks of "prey bolted upward" remaining
  private strRounds = 0
  private strSwatted = false // this round's mid-air swat has been resolved
  private strCaught = false // the session's win happened
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
    this.abortStringPlay()
    if (this.knockTimer) clearTimeout(this.knockTimer)
    if (this.rollTimer) clearTimeout(this.rollTimer)
    if (this.physicsTimer) clearInterval(this.physicsTimer)
    if (this.ambientTimer) clearTimeout(this.ambientTimer)
    if (this.actionTimer) clearTimeout(this.actionTimer)
    if (this.careTimer) clearInterval(this.careTimer)
  }

  /** How often settling turns the pet to face you (0 = never, 1 = every time). */
  setFaceChance(v: number): void {
    this.faceChance = Number.isFinite(v) ? Math.max(0, Math.min(1, v)) : DEFAULT_FACE_CHANCE
  }

  /**
   * What to settle into once something finishes. 'idle' is the front view — the
   * pet turning to look at you — and everything used to land there, so it faced
   * you after every wander, one-shot and landing, which is far too much. Roll
   * against the setting and otherwise rest in side profile.
   */
  private settleClip(): ClipName {
    return Math.random() < this.faceChance ? 'idle' : 'sit'
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
    if (clip === 'react' || clip === 'yawn' || clip === 'stretch' || clip === 'paw' ||
        clip === 'knead' || clip === 'kneadboth' || clip === 'scratch') {
      this.setClip(this.settleClip())
      this.scheduleAmbient()
    }
  }

  /** "Stay here" mode: no wandering, no pounce leaps — the cat holds its spot. */
  setStayPut(v: boolean): void {
    this.stayPut = v
    if (v && this.isWalking()) this.finishWander()
  }

  /** Walk and prance share all the movement machinery; only the look differs. */
  private isWalking(): boolean { return WALK_CLIPS.has(this.clip) }

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
    if (this.rollTimer) { clearTimeout(this.rollTimer); this.rollTimer = null }
    this.abortStringPlay() // picked up mid-play: the string goes with it
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
  /** Wire up the "something just went over the edge" visual (main owns the window). */
  setKnocker(cb: (x: number, y: number) => void): void {
    this.knocker = cb
  }

  /** Wire up the dangling string toy (main owns the window). */
  setStringToy(toy: StringToy): void {
    this.stringToy = toy
  }

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
      case 'yawn': case 'stretch': case 'react': case 'paw': case 'knead': case 'kneadboth': case 'scratch': this.playOneShot(clip); break
      case 'flop': this.startFlop(); break
      case 'roll': this.playOneShot('roll', () => this.setClip('flop')); break
      case 'knock': this.startKnock(); break
      case 'bat': this.startStringPlay(); break // the full hunt, not a one-shot clip
      case 'pounce': this.startPounce(); break
      case 'walk': case 'prance': case 'stalk': case 'trot': case 'hop': this.startWander(clip); break
      case 'zoomies': this.startZoomies(); break
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
    this.actionTimer = setTimeout(() => this.onClipEnded(shot), SHOT_SAFETY[shot] ?? SHOT_SAFETY_MS)
  }

  // ---- wandering + physics -------------------------------------------------------

  /**
   * Where your pointer is, in screen x — or null if it isn't on the same display
   * as the pet, in which case "toward you" has no meaning worth acting on.
   */
  private cursorX(): number | null {
    try {
      const c = screen.getCursorScreenPoint()
      const wa = screen.getDisplayMatching(this.win.getBounds()).workArea
      if (c.x < wa.x || c.x > wa.x + wa.width) return null
      return c.x
    } catch {
      return null // headless / display teardown — just wander at random
    }
  }

  private startWander(force?: ClipName, toX?: number): void {
    if (this.dragging || this.win.isDestroyed()) return
    const wa = screen.getDisplayMatching(this.win.getBounds()).workArea
    const minX = wa.x
    const maxX = wa.x + wa.width - this.win.getBounds().width
    if (maxX - minX < MIN_WANDER) {
      this.finishWander()
      return
    }
    // Pick HOW to travel before how far: a bound is a discrete effort, so the
    // gait decides what distance is even plausible.
    let clip: ClipName = 'walk'
    if (force && WALK_CLIPS.has(force)) clip = force
    else {
      const p = this.personality, r = Math.random()
      if (r < 0.1 + p.energy * 0.25 + p.mischief * 0.2) clip = 'prance'
      else if (r < 0.16) clip = 'trot'
      else if (r < 0.2 + p.mischief * 0.08) clip = 'stalk'
      else if (r < 0.24) clip = 'hop'
    }

    let target: number
    if (toX !== undefined && Number.isFinite(toX)) {
      // A directed walk (the stalk under the string, the debug climb goal).
      // NaN would flow through max/min/round into wanderTarget and from there
      // into curX — checked here because this is the chokepoint.
      target = Math.round(Math.max(minX, Math.min(maxX, toX)))
      if (clip === 'hop') clip = 'walk' // a fixed destination is a walk, not bounds
    } else if (clip === 'hop') {
      // One or two bounds, and no MIN_WANDER floor — that floor is what would
      // otherwise stretch a hop back into a cross-the-room affair.
      const [lo, hi] = HOP_BOUNDS
      const bounds = lo + Math.floor(Math.random() * (hi - lo + 1))
      const dist = HOP_STRIDE * (bounds + 0.35)
      let dir = Math.random() < 0.5 ? -1 : 1
      if (this.curX + dir * dist < minX || this.curX + dir * dist > maxX) dir = -dir
      target = Math.round(Math.max(minX, Math.min(maxX, this.curX + dir * dist)))
      if (Math.abs(target - this.curX) < HOP_STRIDE * 0.6) clip = 'walk' // boxed in
    } else {
      // Where it chooses to go says more about a cat than how often it goes, so
      // this is what independence actually controls (see behavior/wander.ts).
      target = pickWanderTarget({
        minX,
        maxX,
        halfW: this.win.getBounds().width / 2,
        cursorX: this.cursorX(),
        independence: this.personality.independence,
        rnd: Math.random
      })
      if (Math.abs(target - this.curX) < MIN_WANDER) {
        target = this.curX + (target >= this.curX ? 1 : -1) * (MIN_WANDER + Math.random() * 140)
        target = Math.round(Math.max(minX, Math.min(maxX, target)))
      }
    }
    this.wanderTarget = target
    this.walkDist = 0
    // Creep a little before the first freeze, so a stalk starts by moving.
    this.stalkHoldUntil = 0
    this.stalkNextPauseAt = STALK_CREEP[0] + Math.random() * (STALK_CREEP[1] - STALK_CREEP[0])
    this.facing = target < this.curX ? 'left' : 'right'
    this.walkAskedAt = Date.now()
    this.setClip(clip, this.facing)
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
    } else if (this.wanderTarget !== null && this.isWalking()) {
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
        // Mid-stalk freeze. Holding curX still also holds walkDist, so the gait
        // phase stops and the cat freezes MID-STEP — paw up, weight committed —
        // which is exactly the pose a stalking cat holds. Only the advance is
        // skipped: gravity and the rest of the tick below must still run.
        let frozen = false
        if (this.clip === 'stalk') {
          const nowMs = Date.now()
          if (nowMs < this.stalkHoldUntil) {
            frozen = true
          } else if (this.walkDist >= this.stalkNextPauseAt) {
            const [flo, fhi] = STALK_FREEZE_MS
            this.stalkHoldUntil = nowMs + flo + Math.random() * (fhi - flo)
            const [clo, chi] = STALK_CREEP
            this.stalkNextPauseAt = this.walkDist + clo + Math.random() * (chi - clo)
            frozen = true
          }
        }
        let spd = frozen ? 0 : GAIT_SPEED[this.clip] ?? WALK_SPEED
        if (this.clip === 'zoomies') {
          // Launch hard, brake hard: speed ramps with distance out of the turn
          // and back down approaching the target (walkDist resets each dash).
          const accel = Math.min(1, (this.walkDist + 8) / ZOOMIES_ACCEL_PX)
          const brake = Math.min(1, Math.abs(dx) / ZOOMIES_BRAKE_PX + 0.25)
          spd *= Math.min(accel, brake)
        }
        if (Math.abs(dx) <= spd) {
          this.curX = this.wanderTarget
          this.finishWander()
        } else {
          this.curX += Math.sign(dx) * spd
          this.walkDist += spd
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

    // winCoord, not Math.round: setPosition takes a C++ int and rejects both a
    // huge-but-finite coordinate and -0 (which Math.round hands back for any
    // value in (-0.5, 0]) with a native conversion error. Thrown from inside
    // this interval, that error takes the whole app down — see desktop/coords.
    const rx = winCoord(this.curX), ry = winCoord(this.curY)
    if (rx === null || ry === null) {
      // Log enough state to identify the culprit, snap back to the last position
      // that successfully reached the window, and reset all motion.
      const dump =
        `[engine] unusable position cur=(${this.curX},${this.curY}) v=(${this.vx},${this.vy})` +
        ` clip=${this.clip} air=${this.airMode} wander=${this.wanderTarget} str=${this.strPhase}` +
        ` strPivot=(${this.strPivot.x},${this.strPivot.y}) strOrigin=(${this.strOrigin.x},${this.strOrigin.y})` +
        ` jump=${JSON.stringify(this.pendingJump)} zoomies=${this.zoomiesLeft}`
      console.error(dump)
      // Also to disk: a detached app's stderr goes nowhere, and this dump is the
      // one chance to name the culprit when it happens in the wild.
      try { appendFileSync(join(app.getPath('userData'), 'engine.log'), `${new Date().toISOString()} ${dump}\n`) } catch { /* diagnostics must not throw */ }
      this.curX = this.lastX
      this.curY = this.lastY
      this.vx = 0
      this.vy = 0
      this.airMode = 'none'
      this.pendingJump = null
      this.abortStringPlay()
      this.cancelWander()
      this.setClip('idle')
      this.scheduleAmbient(2000)
      return
    }
    if (rx !== this.lastX || ry !== this.lastY) {
      this.win.setPosition(rx, ry)
      this.lastX = rx
      this.lastY = ry
    }
    if (this.isWalking() && this.airMode === 'none' && this.visualReady) {
      const stride = GAIT_STRIDE[this.clip] ?? strideFor(GAIT_SPEED[this.clip] ?? WALK_SPEED)
      this.win.webContents.send('pet:walk-step', (this.walkDist / stride) % 1)
    }
    // String play rides the physics tick: prey drift, phase changes, the swat.
    if (this.strPhase !== null) this.stringTick()
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
    this.abortStringPlay() // stalked right up to an edge: the ledge wins
    this.cancelWander()
    this.setClip('teeter', this.facing)
    if (this.actionTimer) clearTimeout(this.actionTimer)
    this.actionTimer = setTimeout(() => {
      if (this.dragging || this.clip !== 'teeter') return
      const p = this.personality
      // A real ledge, and a cat looking over it. Mischief decides whether it
      // backs off, hops down — or does the obvious thing.
      if (this.allowed('knock') && Math.random() < 0.12 + p.mischief * 0.45) {
        this.startKnock()
        return
      }
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

  // ---- flopping out ----------------------------------------------------------

  /**
   * Flop onto the side and stay there. The belly-up roll is a SEPARATE clip
   * played partway through the dwell, so a plain flop is a plain flop and the
   * two can be toggled independently.
   */
  private startFlop(): void {
    if (this.rollTimer) { clearTimeout(this.rollTimer); this.rollTimer = null }
    this.setClip('flop')
    const dwell = this.dwellFor('flop')
    this.scheduleAmbient(dwell)
    // Long enough to be worth interrupting, and only if rolling is switched on.
    if (dwell > 6000 && this.allowed('roll') && Math.random() < 0.55) {
      const at = dwell * (0.25 + Math.random() * 0.4)
      this.rollTimer = setTimeout(() => {
        this.rollTimer = null
        if (this.clip !== 'flop' || this.dragging) return
        // Back to the flop when the roll finishes; the dwell timer is separate
        // and still running, so the pet gets up when it was always going to.
        this.playOneShot('roll', () => this.setClip('flop'))
      }, at)
    }
  }

  // ---- the string toy --------------------------------------------------------

  /** A string drops in and the pet hunts it: stare → stalk → crouch → pounce. */
  private startStringPlay(): void {
    const toy = this.stringToy
    if (!toy || this.dragging || this.stayPut || this.airMode !== 'none') return
    this.abortStringPlay()
    this.cancelWander()
    if (this.ambientTimer) clearTimeout(this.ambientTimer)

    const b = this.win.getBounds()
    const wa = screen.getDisplayMatching(b).workArea
    const dir = this.facing === 'right' ? 1 : -1
    // Hang the knot a bit ahead of the pet and above head height — the only way
    // to reach it is to jump, which is the point.
    const knotX = this.curX + b.width / 2 + dir * Math.round(b.width * 0.55)
    const knotY = this.curY - STRING_KNOT_ABOVE
    this.strOrigin = {
      x: Math.round(Math.max(wa.x, Math.min(wa.x + wa.width - STRING_W, knotX - STRING_W / 2))),
      y: Math.round(Math.max(wa.y - 20, knotY - ROPE_LEN - STRING_PIVOT_REST))
    }
    this.strBaseX = STRING_W / 2
    // The pivot is born above the window top, so the rope descends into view.
    this.strPivot = { x: this.strBaseX, y: -(ROPE_LEN + 20) }
    toy.show(this.strOrigin.x, this.strOrigin.y, STRING_W, STRING_H, {
      pivotX: this.strPivot.x, pivotY: this.strPivot.y, ropeLen: ROPE_LEN
    })

    this.strClock = 0
    this.strRounds = 0
    this.strCaught = false
    this.strDart = 0
    this.setStringPhase('drop')
    this.faceKnot()
    this.setClip('idle', this.facing)
  }

  private abortStringPlay(): void {
    if (this.strPhase === null) return
    this.strPhase = null
    this.stringToy?.hide()
  }

  private setStringPhase(p: StringPhase): void {
    this.strPhase = p
    this.strTicks = 0
  }

  /**
   * The engine's model of where the knot is: hanging at rest below the pivot.
   * The renderer's rope lags this during fast moves, but at pixel-pet scale
   * aiming at the rest point is indistinguishable — and it means one owner of
   * the truth instead of streaming rope positions back over IPC.
   */
  private knotScreen(): { x: number; y: number } {
    return { x: this.strOrigin.x + this.strPivot.x, y: this.strOrigin.y + this.strPivot.y + ROPE_LEN }
  }

  private faceKnot(): void {
    const b = this.win.getBounds()
    this.facing = this.knotScreen().x >= this.curX + b.width / 2 ? 'right' : 'left'
  }

  /** Crouch under the knot; the renderer wiggles, then onLeap() fires the jump. */
  private beginStringCrouch(): void {
    this.faceKnot()
    this.strSwatted = false
    this.setStringPhase('crouch')
    this.setClip('pounce', this.facing)
  }

  /** Solve the leap so the APEX lands on the knot (a climb wants the descent on
   *  a ledge; jumping AT something overhead wants the top of the arc on it). */
  private solveStringLeap(): { vx: number; vy: number } {
    const b = this.win.getBounds()
    const feetX = this.curX + b.width / 2
    const feetY = this.curY + this.feetOffset(b.height)
    const k = this.knotScreen()
    const reach = b.height * 0.5 // forepaws at full stretch, above the feet
    // NB Math.max(24, NaN) is NaN — the clamp alone is not a guard.
    const rise0 = feetY - (k.y + reach)
    const rise = Number.isFinite(rise0) ? Math.max(24, rise0) : 24
    const vy = -Math.sqrt(2 * GRAVITY * rise)
    const tApex = -vy / GRAVITY
    // Cap rather than decline: an undershot jump is a miss, and misses are cat.
    const vx0 = (k.x - feetX) / tApex
    const vx = Number.isFinite(vx0) ? Math.max(-MAX_JUMP_VX, Math.min(MAX_JUMP_VX, vx0)) : 0
    return { vx, vy }
  }

  /** At the top of the arc: did the paw actually reach the knot? */
  private resolveStringSwat(): void {
    this.strSwatted = true
    const toy = this.stringToy
    if (!toy) return
    const b = this.win.getBounds()
    const dir = this.facing === 'right' ? 1 : -1
    const pawX = this.curX + b.width / 2 + dir * b.width * 0.16
    const pawY = this.curY + b.height * 0.2 // the reaching forepaws, mid-leap
    const k = this.knotScreen()
    const radius = Math.max(20, b.width * 0.2)
    if (Math.hypot(k.x - pawX, k.y - pawY) > radius) return // sailed past — prey 1, cat 0
    if (Math.random() < STRING_CATCH_CHANCE) {
      // Caught it! Pin the knot to the paws; the hold phase drags it down.
      this.strCaught = true
      this.setStringPhase('hold')
    } else {
      // A clean swat: throw the rope with the cat's own momentum. Kept modest —
      // the first cut launched the rope clean out of its window.
      toy.hit(this.vx * 1.2 + dir * 1.2, -(1.6 + Math.random() * 1.2))
    }
  }

  /**
   * One engine tick of string play. The drift is the prey act: a slow wander on
   * two incommensurate sines (so it never visibly repeats), plus the occasional
   * upward bolt — which is where misses come from.
   */
  private stringTick(): void {
    const toy = this.stringToy
    if (!toy || this.strPhase === null) return
    this.strClock++
    this.strTicks++
    const t = this.strClock
    const b = this.win.getBounds()

    let px = this.strBaseX + 14 * Math.sin(t * 0.024) + 7 * Math.sin(t * 0.057)
    let py = STRING_PIVOT_REST + 5 * Math.sin(t * 0.031)
    if (this.strDart > 0) {
      this.strDart--
      py -= 85 // bolted upward, right out from under the swat
    }

    switch (this.strPhase) {
      case 'drop': {
        const k = Math.min(1, this.strTicks / 45)
        const ease = 1 - (1 - k) * (1 - k)
        py = -(ROPE_LEN + 20) + (py + ROPE_LEN + 20) * ease
        if (k >= 1) this.setStringPhase('stare')
        break
      }
      case 'stare': {
        // Locked on. If it's hanging too far away, stalk into range first.
        if (this.strTicks > 50) {
          const feetX = this.curX + b.width / 2
          const kx = this.knotScreen().x
          if (Math.abs(kx - feetX) > b.width * 0.7) {
            this.setStringPhase('stalk')
            const dir = kx >= feetX ? 1 : -1
            this.startWander('stalk', kx - dir * b.width * 0.35 - b.width / 2)
          } else {
            this.beginStringCrouch()
          }
        }
        break
      }
      case 'stalk':
        // 500 ticks ≈ 8s: a stalk approach now includes freezes, and the old
        // 4.8s ceiling would cut it short and crouch early.
        if (this.wanderTarget === null || this.strTicks > 500) {
          this.cancelWander()
          this.beginStringCrouch()
        }
        break
      case 'crouch':
        // The renderer is doing the butt-wiggle; onLeap() takes it from here.
        if (this.strTicks > 280) this.setStringPhase('settle') // never left the ground
        break
      case 'air':
        // Apex: rising has just turned to falling — the swat moment.
        if (!this.strSwatted && this.airMode === 'leap' && this.vy >= 0) this.resolveStringSwat()
        if (this.strSwatted && this.airMode === 'none') this.setStringPhase('settle')
        break
      case 'hold': {
        // The knot is in its paws: keep it pinned there while the cat comes
        // down, hold a beat, then the prey squirms free.
        const gx = this.curX + b.width / 2 - this.strOrigin.x
        const gy = Math.min(this.curY + b.height * 0.42 - this.strOrigin.y, STRING_H - 10)
        toy.grab(gx, gy)
        if (this.airMode === 'none' && this.strTicks > 46) {
          toy.release()
          this.setStringPhase('settle')
        }
        break
      }
      case 'settle':
        if (this.airMode === 'none' && this.strTicks > 35) {
          this.strRounds++
          if (this.strRounds >= STRING_MAX_ROUNDS || this.strCaught) {
            this.setStringPhase('retract')
          } else {
            // Cats cycle back along the prey sequence after a miss.
            this.setStringPhase('stare')
            this.faceKnot()
            this.setClip('idle', this.facing)
          }
        }
        break
      case 'retract': {
        // The string leaves — up and away, fast, like something getting out.
        const k = Math.min(1, this.strTicks / 30)
        py = STRING_PIVOT_REST - (ROPE_LEN + STRING_PIVOT_REST + 60) * k * k
        if (this.strTicks > 45) {
          this.strPhase = null
          toy.hide()
          // Compose itself, as if none of that happened.
          this.setClip('sit')
          this.scheduleAmbient(2600)
          return
        }
        break
      }
    }

    this.strPivot = { x: px, y: py }
    if ((t & 1) === 0) toy.pivot(px, py) // every other tick ≈ 30/s is plenty
  }

  // ---- knocking things off ledges --------------------------------------------

  /**
   * Reach over the edge, pat at nothing twice, hold, then swipe something off.
   * The drop is fired on a timer rather than at the end of the clip, because it
   * has to land on the swipe frame — see KNOCK_SWIPE_MS and the frame list in
   * the renderer, which are two halves of the same number.
   */
  private startKnock(): void {
    this.cancelWander()
    const b = this.win.getBounds()
    const dir = this.facing === 'right' ? 1 : -1
    // Just past the paw, over the drop the pet is teetering on.
    const edgeX = this.curX + b.width / 2 + dir * (b.width * 0.30)
    const ledgeY = this.curY + this.feetOffset(b.height)

    this.playOneShot('knock')
    // Afterwards, turn away from the edge so it doesn't immediately teeter again.
    this.afterShot = () => {
      this.facing = this.facing === 'right' ? 'left' : 'right'
      this.setClip('idle', this.facing)
      this.scheduleAmbient(900)
    }
    if (this.knockTimer) clearTimeout(this.knockTimer)
    this.knockTimer = setTimeout(() => {
      this.knockTimer = null
      if (this.clip === 'knock' && !this.dragging) this.knocker?.(edgeX, ledgeY)
    }, KNOCK_SWIPE_MS)
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
    if (this.strPhase === 'crouch') {
      // Aim is taken at the moment of launch — the cat watched the string all
      // through the wiggle. Misses come from the string bolting mid-flight.
      const imp = this.solveStringLeap()
      this.vx = imp.vx
      this.vy = imp.vy
      this.setStringPhase('air')
      if (Math.random() < STRING_DART_CHANCE) this.strDart = 20
      return
    }
    if (this.pendingJump) {
      // A climb: the impulse was solved for a specific ledge.
      this.vx = this.pendingJump.vx
      this.vy = this.pendingJump.vy
      this.pendingJump = null
    } else {
      this.vx = (this.facing === 'right' ? 1 : -1) * 2.1
      this.vy = -5.2
    }
  }

  // ---- climbing onto windows -----------------------------------------------

  /**
   * Try to jump onto a window top above the pet. Returns false if there's nothing
   * in range, so the caller can fall through to an ordinary ambient choice.
   *
   * The arc is solved rather than guessed: pick vy so the apex clears the ledge by
   * JUMP_CLEAR, then read off how long until the descent crosses the ledge height
   * and set vx to cover the horizontal gap in exactly that time. Landing itself
   * needs no new code — once the pet is above a window top, supportY() starts
   * seeing it as a platform and the existing gravity/landAt path takes over.
   */
  private tryJumpUp(): boolean {
    if (this.stayPut || this.dragging || this.airMode !== 'none') return false
    const b = this.win.getBounds()
    const feetX = this.curX + b.width / 2
    const feetY = this.curY + this.feetOffset(b.height)

    const options = ledgesAbove(feetX, feetY, MAX_JUMP_RISE, MAX_JUMP_REACH)
    if (!options.length) return false
    const target = options[Math.floor(Math.random() * options.length)]
    return this.launchTo(target.x, target.y)
  }

  /** Solve and start the arc onto one specific point. False if it's out of range. */
  private launchTo(targetX: number, targetY: number): boolean {
    if (this.stayPut || this.dragging || this.airMode !== 'none') return false
    const b = this.win.getBounds()
    const feetX = this.curX + b.width / 2
    const feetY = this.curY + this.feetOffset(b.height)
    const rise = feetY - targetY
    if (rise <= 0) return false

    const vy = -Math.sqrt(2 * GRAVITY * (rise + JUMP_CLEAR))
    // Descending crossing of the ledge height: 0.5*g*t^2 + vy*t + rise = 0.
    const disc = vy * vy - 2 * GRAVITY * rise
    if (disc < 0) return false // unreachable; shouldn't happen given vy above
    const t = (-vy + Math.sqrt(disc)) / GRAVITY
    const vx = (targetX - feetX) / t
    if (!Number.isFinite(vx) || Math.abs(vx) > MAX_JUMP_VX) return false

    this.cancelWander()
    this.pendingJump = { vx, vy }
    this.facing = vx >= 0 ? 'right' : 'left'
    this.setClip('pounce', this.facing) // the crouch-and-wiggle reads as a wind-up
    if (this.actionTimer) clearTimeout(this.actionTimer)
    this.actionTimer = setTimeout(() => {
      if (this.clip === 'pounce' && this.airMode === 'none') {
        this.pendingJump = null
        this.setClip('idle')
        this.scheduleAmbient()
      }
    }, SHOT_SAFETY_MS)
    return true
  }

  /**
   * Debug/testing: send the pet onto one specific ledge. Waiting for a climb to
   * happen by itself means waiting on a ~20% roll of an ambient tick that fires
   * every 3-8s, which makes any test flaky; this makes it deterministic.
   *
   * If the ledge is further away than a single jump can carry, the pet walks
   * under it first and the climb resumes when the walk ends.
   */
  climbToward(x: number, y: number): void {
    this.climbGoal = { x, y }
    this.climbGoalAt = Date.now()
    this.pursueClimbGoal()
  }

  private pursueClimbGoal(): void {
    const g = this.climbGoal
    if (!g || this.dragging) return
    const b = this.win.getBounds()
    const feetX = this.curX + b.width / 2
    const feetY = this.curY + this.feetOffset(b.height)
    if (feetY <= g.y + 6) { this.climbGoal = null; return } // already up there
    if (Math.abs(g.x - feetX) <= MAX_JUMP_REACH && this.launchTo(g.x, g.y)) {
      this.climbGoal = null
      return
    }
    this.startWander(undefined, g.x - b.width / 2) // get under it, then try again
  }

  private finishWander(): void {
    this.wanderTarget = null
    if (this.dragging) return
    // Mid-fit? Turn round and go again instead of settling.
    if (this.zoomiesLeft > 0) return this.nextDash()
    this.setClip(this.settleClip())
    // Arrived under a debug climb target? Take the jump now rather than waiting
    // for the next ambient roll.
    if (this.climbGoal) {
      this.pursueClimbGoal()
      if (this.climbGoal === null || this.clip === 'pounce') return
    }
    this.scheduleAmbient()
  }

  private cancelWander(): void {
    this.wanderTarget = null
    this.zoomiesLeft = 0 // anything that interrupts a walk ends the fit
  }

  // ---- zoomies ---------------------------------------------------------------

  /** A fit of several fast sprints with hard turns between them, then a breather. */
  private startZoomies(): void {
    const [lo, hi] = ZOOMIES_DASHES
    this.zoomiesLeft = lo + Math.floor(Math.random() * (hi - lo + 1))
    this.nextDash()
  }

  private endZoomies(): void {
    this.zoomiesLeft = 0
    this.wanderTarget = null
    this.setClip('idle')
    this.scheduleAmbient(1400) // stand there a moment, as if surprised at itself
  }

  private nextDash(): void {
    if (this.zoomiesLeft <= 0 || this.dragging || this.win.isDestroyed()) return this.endZoomies()
    this.zoomiesLeft--

    const b = this.win.getBounds()
    const wa = screen.getDisplayMatching(b).workArea
    const minX = wa.x, maxX = wa.x + wa.width - b.width
    const [legLo, legHi] = ZOOMIES_LEG
    const leg = legLo + Math.random() * (legHi - legLo)
    // Turn on a sixpence: each sprint goes back the way it came, bouncing off
    // the screen edges rather than piling into them.
    let dir = this.facing === 'right' ? -1 : 1
    let target = this.curX + dir * leg
    if (target < minX || target > maxX) {
      dir = -dir
      target = this.curX + dir * leg
    }
    target = Math.max(minX, Math.min(maxX, target))
    // Boxed into a corner — stop rather than judder on the spot.
    if (Math.abs(target - this.curX) < 40) return this.endZoomies()

    this.wanderTarget = Math.round(target)
    this.walkDist = 0
    this.facing = dir > 0 ? 'right' : 'left'
    this.walkAskedAt = Date.now()
    this.setClip('zoomies', this.facing)
  }

  // ---- personality-weighted ambient loop ---------------------------------------

  /**
   * How long the cat holds a resting state before the next ambient decision.
   * Restful states dwell much longer than fidgety ones — a nap is minutes-ish,
   * not seconds — and personality stretches them (a sleepy cat sleeps far
   * longer). These are floors-with-jitter, so sleep is never a 2-second blip.
   */
  private dwellFor(state: 'sleep' | 'loaf' | 'sphinx' | 'groom' | 'sit' | 'idle' | 'flop'): number {
    const p = this.personality
    const r = (min: number, max: number): number => min + Math.random() * (max - min)
    switch (state) {
      case 'sleep': return r(15000, 26000) * (0.75 + p.sleepiness * 0.9) // ~12s floor, much longer for sleepy cats
      case 'loaf': return r(11000, 19000) * (0.8 + p.sleepiness * 0.45)
      case 'sphinx': return r(11000, 19000) * (0.8 + p.sleepiness * 0.45)
      case 'groom': return r(5000, 9000)
      // Flopped out on its side. Wide on purpose: sometimes a brief flop and up
      // again, sometimes it just lies there for the better part of half a minute.
      case 'flop': return r(7000, 28000) * (0.8 + p.sleepiness * 0.5)
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
    if (this.dragging || this.busy || this.airMode !== 'none' || this.clip === 'teeter' || this.clip === 'pounce' || this.strPhase !== null) {
      this.scheduleAmbient(2000)
      return
    }
    // A pending climb goal outranks ambient life. It is retried here as well as
    // from finishWander(), because the goal can arrive while the pet is airborne
    // or mid-one-shot — the first pursue then fails and, with finishWander the
    // only other retry, the goal used to be orphaned for good.
    if (this.climbGoal) {
      if (Date.now() - this.climbGoalAt > CLIMB_GOAL_TTL_MS) {
        this.climbGoal = null
      } else {
        this.pursueClimbGoal()
        if (this.climbGoal !== null && this.wanderTarget === null) this.scheduleAmbient(900)
        return
      }
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

    // Climbing gets first refusal, before the ordinary ambient choice. Gravity is
    // the only vertical force otherwise, so the pet drifts downhill and parks on
    // the taskbar; a periodic look upward keeps it living on your actual windows.
    // tryJumpUp() returns false when nothing is in range, so this is a no-op on a
    // bare desktop.
    const climbUrge = (0.06 + p.curiosity * 0.18 + p.energy * 0.12 + p.mischief * 0.08) * (1 - tired * 0.7) * (1 - sick)
    if (!wasAsleep && Math.random() < climbUrge && this.tryJumpUp()) return

    const action = weightedPick<'wander' | 'sleep' | 'loaf' | 'sphinx' | 'groom' | 'pounce' | 'paw' | 'sit' | 'linger' | 'sick' | 'sulk' | 'zoomies' | 'knead' | 'kneadboth' | 'bat' | 'scratch' | 'flop'>([
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
      // Making biscuits: a contented, settled thing, so it leans on affection and
      // sleepiness rather than energy. The two-paw version is the showier one.
      // A string turns up and the pet has a go at it — playful, so it leans on
      // mischief and curiosity, and a tired or unwell cat can't be bothered.
      { item: 'bat', weight: this.stayPut || !this.allowed('bat') ? 0 : (0.05 + p.mischief * 0.24 + p.curiosity * 0.18 + bored * 0.4) * (1 - tired * 0.8) * (1 - sick) },
      // An ear scratch is an itch, so it leans on hygiene rather than mood.
      // Research puts scratch-grooming at a tiny fraction of a cat's grooming
      // time, so the base rate stays low — it is punctuation, not an activity.
      { item: 'scratch', weight: this.allowed('scratch') ? 0.10 + dirty * 0.85 : 0 },
      // The social roll. Showing a belly is a trust and contentment display, so
      // it leans hard on affection — an aloof cat should rarely do it, and an
      // unwell or exhausted one not at all.
      { item: 'flop', weight: this.allowed('flop') ? (0.05 + p.affection * 0.34 + p.energy * 0.08) * (1 - tired * 0.7) * (1 - sick) : 0 },
      { item: 'knead', weight: this.allowed('knead') ? (0.08 + p.affection * 0.30 + p.sleepiness * 0.16) * (1 - sick * 0.8) : 0 },
      { item: 'kneadboth', weight: this.allowed('kneadboth') ? (0.06 + p.affection * 0.26 + p.sleepiness * 0.14) * (1 - sick * 0.8) : 0 },
      // Deliberately tiny: at these weights an energetic cat has a fit every few
      // minutes, which is the point. Turn it up and the pet stops being calming.
      { item: 'zoomies', weight: this.stayPut || !this.allowed('zoomies') ? 0 : (0.02 + p.energy * 0.10 + p.mischief * 0.04) * (1 - tired * 0.9) * (1 - sick) },
      { item: 'sit', weight: 0.2 + (1 - p.energy) * 0.2 + sick * 0.3 },
      { item: 'linger', weight: 0.3 + (1 - p.energy) * 0.3 + sick * 0.4 }
    ])
    const go = (): void => {
      switch (action) {
        case 'wander':
          this.startWander()
          break
        case 'zoomies':
          this.startZoomies()
          break
        case 'knead':
        case 'kneadboth':
        case 'scratch':
          this.playOneShot(action)
          break
        case 'flop':
          this.startFlop()
          break
        case 'bat':
          this.startStringPlay()
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
          this.setClip(this.settleClip())
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
