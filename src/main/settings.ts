// Persisted app settings: which pet is active, the display scale, and any
// per-pet personality tweaks. Stored as JSON in the OS userData dir so choices
// survive restarts. Reads are tolerant (missing/corrupt file -> defaults).

import { app } from 'electron'
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { AppSettings, Personality } from '../shared/types'
import { TRAIT_KEYS } from '../shared/types'
import { DEFAULT_SCALE, MIN_SCALE, MAX_SCALE } from '../shared/constants'
import { DEFAULT_PET, PETS } from '../shared/pets'

function settingsPath(): string {
  return join(app.getPath('userData'), 'settings.json')
}

function defaults(): AppSettings {
  return { activePetId: DEFAULT_PET.id, scale: DEFAULT_SCALE, overrides: {} }
}

const clamp01 = (n: number): number => Math.max(0, Math.min(1, n))

/** Coerce arbitrary parsed JSON into a valid AppSettings, dropping junk. */
function sanitize(raw: unknown): AppSettings {
  const s = defaults()
  if (!raw || typeof raw !== 'object') return s
  const r = raw as Record<string, unknown>
  if (typeof r.activePetId === 'string' && PETS.some((p) => p.id === r.activePetId)) s.activePetId = r.activePetId
  if (typeof r.scale === 'number' && Number.isFinite(r.scale)) {
    s.scale = Math.max(MIN_SCALE, Math.min(MAX_SCALE, Math.round(r.scale)))
  }
  if (r.overrides && typeof r.overrides === 'object') {
    for (const [petId, ov] of Object.entries(r.overrides as Record<string, unknown>)) {
      if (!PETS.some((p) => p.id === petId) || !ov || typeof ov !== 'object') continue
      const clean: Partial<Personality> = {}
      for (const k of TRAIT_KEYS) {
        const v = (ov as Record<string, unknown>)[k]
        if (typeof v === 'number' && Number.isFinite(v)) clean[k] = clamp01(v)
      }
      if (Object.keys(clean).length) s.overrides[petId] = clean
    }
  }
  return s
}

export function loadSettings(): AppSettings {
  try {
    return sanitize(JSON.parse(readFileSync(settingsPath(), 'utf8')))
  } catch {
    return defaults()
  }
}

export function saveSettings(s: AppSettings): void {
  try {
    writeFileSync(settingsPath(), JSON.stringify(s, null, 2))
  } catch (err) {
    console.error('[settings] failed to write', err)
  }
}

/** A pet's effective personality: its preset traits merged with user overrides. */
export function effectivePersonality(s: AppSettings, petId: string): Personality {
  const pet = PETS.find((p) => p.id === petId) ?? DEFAULT_PET
  return { ...pet.personality, ...(s.overrides[petId] ?? {}) }
}
