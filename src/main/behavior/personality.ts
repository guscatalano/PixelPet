import type { Personality } from '../../shared/types'

/** Default personality for the built-in white cat: a balanced, slightly lazy cat. */
export const DEFAULT_PERSONALITY: Personality = {
  energy: 0.55,
  sleepiness: 0.4,
  affection: 0.6,
  mischief: 0.35,
  curiosity: 0.5,
  independence: 0.4
}

/** Pick one item at random, weighted. Negative weights are clamped to 0. */
export function weightedPick<T>(entries: Array<{ item: T; weight: number }>): T | null {
  const total = entries.reduce((sum, e) => sum + Math.max(0, e.weight), 0)
  if (total <= 0) return null
  let r = Math.random() * total
  for (const e of entries) {
    r -= Math.max(0, e.weight)
    if (r <= 0) return e.item
  }
  return entries[entries.length - 1].item
}
