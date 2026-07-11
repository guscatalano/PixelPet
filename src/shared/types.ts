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
  | 'idle' | 'sit' | 'walk' | 'sleep' | 'react' | 'fall'
  | 'loaf' | 'sphinx' | 'groom' | 'teeter' | 'poof' | 'pounce' | 'yawn' | 'stretch' | 'paw'

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
  /** Pupils dilate/contract with the time of day (round at night, slits at midday). */
  pupilsByTime: boolean
  /** Care ("Tamagotchi") mode: the cat has needs that decay and shape its behavior. */
  careMode: boolean
  /** How fast needs decay in Care Mode. */
  difficulty: Difficulty
  /** Dream mode: a sleeping cat shows a floating photo thumbnail it dreams of. */
  dreamMode: boolean
  /** Animations the user turned off (subset of TOGGLEABLE_ANIMS). */
  disabledAnims: ClipName[]
  /** Non-secret AI config (provider/model/endpoint). The API key lives elsewhere (safeStorage). */
  ai: AiConfig
  /** Pets the user generated from photos (M4). Merged with the built-in PETS roster. */
  userPets: AppPet[]
  overrides: Record<string, Partial<Personality>>
}

/** Which vision provider backs "generate a pet from a photo". */
export type AiProviderId = 'openai' | 'anthropic'

/** Non-secret AI settings persisted in settings.json (the key is stored separately). */
export interface AiConfig {
  provider: AiProviderId
  model: string
  endpoint?: string
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
  'sleep', 'loaf', 'sphinx', 'groom', 'stretch', 'pounce', 'teeter', 'poof', 'yawn', 'paw', 'react'
]

/** Live-tunable renderer config pushed over pet:set-config. */
export interface PetConfig {
  turnMs?: number
  frontScale?: number
  pupilsByTime?: boolean
}
