// Types shared across main, preload, and renderer.

import type { AppPet } from './pets'
import type { Difficulty } from './care'

/**
 * Animation clips the renderer knows how to play. Most are stable states the
 * renderer transitions to through the animation graph (real motion — turning,
 * sitting down, tucking into a loaf); yawn/stretch/react/pounce are one-shots
 * that report back via pet:clip-ended when finished.
 */
export type ClipName =
  | 'idle' | 'sit' | 'walk' | 'prance' | 'stalk' | 'trot' | 'hop' | 'sleep' | 'react' | 'fall'
  | 'loaf' | 'sphinx' | 'groom' | 'teeter' | 'poof' | 'pounce' | 'yawn' | 'stretch' | 'paw' | 'sick' | 'sulk'
  | 'zoomies' | 'knock' | 'knead' | 'kneadboth' | 'bat' | 'scratch' | 'flop' | 'roll'

/** Which way the pet faces (affects horizontal flip). */
export type Facing = 'left' | 'right'

/** Main -> renderer: play this animation state. */
export interface PlayCommand {
  clip: ClipName
  facing: Facing
}

/** Renderer -> main: something happened that a trigger may care about. */
export interface TriggerEvent {
  type: string
  payload?: unknown
}

/**
 * Personality: 0..1 trait axes that bias behavior selection. Two pets with the
 * same look can behave very differently. Inferred from photos in M4; for now the
 * default white cat uses DEFAULT_PERSONALITY.
 */
export interface Personality {
  energy: number
  sleepiness: number
  affection: number
  mischief: number
  curiosity: number
  independence: number
}

/** The six personality axes, in display order. */
export const TRAIT_KEYS: Array<keyof Personality> = [
  'energy', 'sleepiness', 'affection', 'mischief', 'curiosity', 'independence'
]

/**
 * Persisted app settings (written to userData/settings.json). `overrides` holds
 * per-pet personality tweaks the user made in Settings; the effective personality
 * of a pet is its preset traits merged with its overrides.
 */
export interface AppSettings {
  activePetId: string
  scale: number
  /** ¾-turn keyframe duration, ms per frame (lower = snappier turn). */
  turnMs: number
  /** "Stay here" mode: the cat holds its spot (no wandering or pounce leaps). */
  stayPut: boolean
  /** Facing-you view scale (0.65 small .. 1.0 = big, "coming at you"). */
  frontScale: number
  /** 0..1 — how often the pet turns to face you when it settles. */
  faceChance: number
  /** Pixel detail / supersample factor (0.5 chunkiest · 1 default · 4 smoothest). */
  detail: number
  /** Pupils dilate/contract with the time of day (round at night, slits at midday). */
  pupilsByTime: boolean
  /** Care ("Tamagotchi") mode: the cat has needs that decay and shape its behavior. */
  careMode: boolean
  /** How fast needs decay in Care Mode. */
  difficulty: Difficulty
  /** Dream mode: a sleeping cat shows a floating photo thumbnail it dreams of. */
  dreamMode: boolean
  /** Chance (0..1) that any given nap shows a dream bubble. */
  dreamChance: number
  /** Dream bubble size multiplier (1 = default; ~0.6–2). */
  dreamBubbleScale: number
  /** Optional Immich album to fold into the dream photo pool (non-secret; key stored apart). */
  immich: ImmichConfig
  /** Animations the user turned off (subset of TOGGLEABLE_ANIMS). */
  disabledAnims: ClipName[]
  /** Non-secret AI config (provider/model/endpoint). The API key lives elsewhere (safeStorage). */
  ai: AiConfig
  /** Pets the user generated from photos (M4). Merged with the built-in PETS roster. */
  userPets: AppPet[]
  /** User-chosen display names, keyed by pet id (overrides the built-in/generated name). */
  nameOverrides: Record<string, string>
  /**
   * Collars the user has put on pets, keyed by pet id. A collar is an
   * ACCESSORY, not part of the animal — it lives here rather than in the pet's
   * DNA so you can put one on any cat (including the built-ins) and take it off
   * again without editing, re-creating, or re-exporting the creature.
   */
  collars: Record<string, Collar>
  /** Remembered pet-picker filter (All / Built-in / Yours). */
  petFilter: 'all' | 'builtin' | 'user'
  overrides: Record<string, Partial<Personality>>
  /** The one-time "here's how to control me" hint has been shown. */
  seenIntro: boolean
  /** Get out of the way while a full-screen game, video or presentation is up (Windows). */
  hideInFullscreen: boolean
}

/** Which vision provider backs "generate a pet from a photo". */
export type AiProviderId = 'openai' | 'anthropic'

/** Non-secret AI settings persisted in settings.json (the key is stored separately). */
export interface AiConfig {
  provider: AiProviderId
  model: string
  endpoint?: string
}

/**
 * Whether the app launches itself at login. Read live from the OS rather than
 * stored, so it can't drift from what Task Manager says.
 * `reason` explains an unsupported platform: 'store' = a packaged Store build,
 * where Windows owns startup; 'unsupported' = the platform has no such concept.
 */
export interface LoginItem {
  supported: boolean
  openAtLogin: boolean
  reason?: 'store' | 'unsupported'
}

/** A collar you can put on a pet: the strap's colour and the hanging tag's. */
export interface Collar {
  band: string
  tag: string
}
export const DEFAULT_COLLAR: Collar = { band: '#c0392b', tag: '#f3c73e' }

/** Immich album config for Dream Mode (non-secret; the API key lives in safeStorage). */
export interface ImmichConfig {
  serverUrl: string
  albumId: string
}

/** Immich status for the settings UI (never carries the key itself). */
export interface ImmichStatus {
  serverUrl: string
  albumId: string
  hasKey: boolean
}

/** AI status surfaced to the settings UI (never carries the key itself). */
export interface AiStatus {
  provider: AiProviderId
  model: string
  endpoint: string
  hasKey: boolean
  encryptionAvailable: boolean
}

/** Behaviors the user may turn off in settings (core locomotion is not toggleable). */
export const TOGGLEABLE_ANIMS: ClipName[] = [
  'sleep', 'loaf', 'sphinx', 'groom', 'stretch', 'pounce', 'teeter', 'poof', 'yawn', 'paw', 'react',
  'zoomies', 'knock', 'knead', 'kneadboth', 'bat', 'scratch', 'flop', 'roll'
]

/** Live-tunable renderer config pushed over pet:set-config. */
export interface PetConfig {
  turnMs?: number
  frontScale?: number
  pupilsByTime?: boolean
  /** Pixel detail / supersample factor (0.5 chunkiest · 1 default · 4 smoothest). */
  detail?: number
}
