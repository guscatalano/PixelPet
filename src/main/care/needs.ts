// The Care Mode needs engine (main process). Needs decay in real time — even
// while the app is closed — and feed into a slowly-integrating Health. It's a
// COZY design: nothing is ever lost; a neglected cat gets hungry, sleepy, dirty,
// then unwell, and bounces back once you tend to it. Difficulty scales the pace.

import { app } from 'electron'
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { Needs, Difficulty, CareAction, CareState } from '../../shared/care'

// Base decay per hour at "normal" difficulty (a need drains from full to empty
// in roughly 1/rate hours). Gentle by design — this is an ambient companion.
const DECAY = { hunger: 1 / 11, energy: 1 / 15, fun: 1 / 9, hygiene: 1 / 28 }
const DIFFICULTY_MULT: Record<Difficulty, number> = { relaxed: 0.5, normal: 1, demanding: 1.9 }
const MAX_CATCHUP_H = 48 // cap offline decay so a long absence just = "very neglected", not NaN

const clamp01 = (n: number): number => Math.max(0, Math.min(1, n))
export const freshNeeds = (): Needs => ({ hunger: 0.85, energy: 0.85, fun: 0.8, hygiene: 0.85, health: 1 })

/**
 * Advance needs by `hours` of elapsed time. Hunger/fun always drain (they need
 * YOU — food and play); energy/hygiene drain too but the cat self-manages them
 * by sleeping/grooming (see engine). Health integrates: it sinks while any need
 * is critically low, and recovers while the cat is reasonably content.
 */
export function decay(n: Needs, hours: number, difficulty: Difficulty): Needs {
  const h = Math.max(0, Math.min(MAX_CATCHUP_H, hours))
  const m = DIFFICULTY_MULT[difficulty] * h
  const next: Needs = {
    hunger: clamp01(n.hunger - DECAY.hunger * m),
    energy: clamp01(n.energy - DECAY.energy * m),
    fun: clamp01(n.fun - DECAY.fun * m),
    hygiene: clamp01(n.hygiene - DECAY.hygiene * m),
    health: n.health
  }
  // Health: each critically-low need (<0.2) drags it down; otherwise it heals.
  let critical = 0
  for (const v of [next.hunger, next.energy, next.fun, next.hygiene]) if (v < 0.2) critical++
  const healthRate = critical > 0 ? -0.14 * critical : 0.16
  next.health = clamp01(n.health + healthRate * DIFFICULTY_MULT[difficulty] * h)
  return next
}

/** Restore needs from a care action. Returns a new Needs. */
export function apply(n: Needs, action: CareAction): Needs {
  const next = { ...n }
  switch (action) {
    case 'feed': next.hunger = clamp01(n.hunger + 0.55); break
    case 'play': next.fun = clamp01(n.fun + 0.55); next.energy = clamp01(n.energy - 0.08); break
    case 'rest': next.energy = clamp01(n.energy + 0.6); break
    case 'groom': next.hygiene = clamp01(n.hygiene + 0.65); break
    case 'heal': next.health = clamp01(n.health + 0.45); break
  }
  return next
}

/** A small nudge to one need (e.g. petting boosts fun; sleeping restores energy). */
export function nudge(n: Needs, key: keyof Needs, delta: number): Needs {
  return { ...n, [key]: clamp01(n[key] + delta) }
}

/** The dominant felt state, worst-first, for behavior + the status readout. */
export function careState(n: Needs): CareState {
  if (n.health < 0.35) return { key: 'sick', label: 'Unwell', emoji: '🤒' }
  if (n.hunger < 0.28) return { key: 'hungry', label: 'Hungry', emoji: '🍽️' }
  if (n.energy < 0.28) return { key: 'sleepy', label: 'Sleepy', emoji: '😴' }
  if (n.hygiene < 0.25) return { key: 'dirty', label: 'Scruffy', emoji: '🧼' }
  if (n.fun < 0.28) return { key: 'bored', label: 'Bored', emoji: '🥱' }
  return { key: 'content', label: 'Content', emoji: '😻' }
}

// ---- persistence: per-pet needs + last-seen, so decay continues while closed --
interface CareFile { pets: Record<string, { needs: Needs; lastSeen: number }> }
const carePath = (): string => join(app.getPath('userData'), 'care.json')

function readFile(): CareFile {
  try {
    const j = JSON.parse(readFileSync(carePath(), 'utf8'))
    if (j && typeof j === 'object' && j.pets && typeof j.pets === 'object') return j as CareFile
  } catch { /* missing/corrupt */ }
  return { pets: {} }
}

const validNeeds = (raw: unknown): Needs => {
  const f = freshNeeds()
  if (!raw || typeof raw !== 'object') return f
  const r = raw as Record<string, unknown>
  for (const k of Object.keys(f) as Array<keyof Needs>) {
    if (typeof r[k] === 'number' && Number.isFinite(r[k])) f[k] = clamp01(r[k] as number)
  }
  return f
}

/** Load a pet's needs, applying decay for the time since it was last seen. */
export function loadNeeds(petId: string, difficulty: Difficulty, now: number): Needs {
  const file = readFile()
  const rec = file.pets[petId]
  if (!rec) return freshNeeds()
  const hours = (now - (typeof rec.lastSeen === 'number' ? rec.lastSeen : now)) / 3_600_000
  return decay(validNeeds(rec.needs), hours, difficulty)
}

/** Persist a pet's current needs + timestamp. */
export function saveNeeds(petId: string, needs: Needs, now: number): void {
  const file = readFile()
  file.pets[petId] = { needs, lastSeen: now }
  try {
    writeFileSync(carePath(), JSON.stringify(file, null, 2))
  } catch (err) {
    console.error('[care] failed to write', err)
  }
}
