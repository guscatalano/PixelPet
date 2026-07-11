// Types shared across main, preload, and renderer.

/** Animation clips the renderer knows how to play. */
export type ClipName = 'idle' | 'sit' | 'walk' | 'sleep' | 'react' | 'fall'

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
  overrides: Record<string, Partial<Personality>>
}
