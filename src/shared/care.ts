// Care Mode data model, shared across main (owns the state) and renderer (shows
// the status readout). The needs themselves live in main and persist to
// care.json; these are the types + pure helpers used on both sides.

/** The cat's needs, 0..1 where 1 = fully satisfied / healthy. */
export interface Needs {
  hunger: number
  energy: number
  fun: number
  hygiene: number
  health: number
}

export type NeedKey = 'hunger' | 'energy' | 'fun' | 'hygiene' | 'health'

/** The four tended needs, in display order (health is derived, shown apart). */
export const NEED_KEYS: Array<Exclude<NeedKey, 'health'>> = ['hunger', 'energy', 'fun', 'hygiene']

export type Difficulty = 'relaxed' | 'normal' | 'demanding'
export const DIFFICULTIES: Difficulty[] = ['relaxed', 'normal', 'demanding']

/** A care action the user can take (menu or dragged object). */
export type CareAction = 'feed' | 'play' | 'rest' | 'groom' | 'heal'

/** The cat's dominant felt state, derived from its needs. */
export interface CareState {
  key: 'content' | 'hungry' | 'sleepy' | 'bored' | 'dirty' | 'sick'
  label: string
  emoji: string
}

/** Snapshot pushed to the settings UI. */
export interface CareStatus {
  enabled: boolean
  needs: Needs
  state: CareState
}
