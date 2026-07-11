// Persisted app settings: which pet is active, the display scale, and any
// per-pet personality tweaks. Stored as JSON in the OS userData dir so choices
// survive restarts. Reads are tolerant (missing/corrupt file -> defaults).

import { app } from 'electron'
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { AppSettings, Personality, AiConfig, AiProviderId } from '../shared/types'
import { TRAIT_KEYS, TOGGLEABLE_ANIMS } from '../shared/types'
import { DEFAULT_SCALE, MIN_SCALE, MAX_SCALE } from '../shared/constants'
import { DEFAULT_FRONT_SCALE } from '../shared/catgen'
import { DEFAULT_PET, PETS, type AppPet } from '../shared/pets'
import { MARKING_NAMES } from '../shared/petdna'
import { DEFAULT_MODEL } from './ai/providers'

function settingsPath(): string {
  return join(app.getPath('userData'), 'settings.json')
}

export const DEFAULT_TURN_MS = 80
export const MIN_TURN_MS = 50
export const MAX_TURN_MS = 600 // all the way to a really slow, deliberate turn

export const MIN_FRONT_SCALE = 0.65
export const MAX_FRONT_SCALE = 1.0

export const AI_PROVIDERS: AiProviderId[] = ['openai', 'anthropic']

function defaultAi(): AiConfig {
  return { provider: 'openai', model: DEFAULT_MODEL.openai }
}

function defaults(): AppSettings {
  return {
    activePetId: DEFAULT_PET.id, scale: DEFAULT_SCALE, turnMs: DEFAULT_TURN_MS,
    stayPut: false, frontScale: DEFAULT_FRONT_SCALE, disabledAnims: [],
    ai: defaultAi(), userPets: [], overrides: {}
  }
}

const clamp01 = (n: number): number => Math.max(0, Math.min(1, n))
const HEX = /^#[0-9a-fA-F]{6}$/

/** Validate one stored user-generated pet; returns null if it's too broken to render. */
function sanitizeUserPet(raw: unknown): AppPet | null {
  if (!raw || typeof raw !== 'object') return null
  const r = raw as Record<string, unknown>
  const coat = r.coat as Record<string, unknown> | undefined
  const per = r.personality as Record<string, unknown> | undefined
  if (typeof r.id !== 'string' || !r.id) return null
  if (!coat || typeof coat.primary !== 'string' || !HEX.test(coat.primary)) return null
  const personality = {} as Personality
  for (const k of TRAIT_KEYS) personality[k] = clamp01(Number(per?.[k]))
  const marking = typeof r.marking === 'string' && (MARKING_NAMES as readonly string[]).includes(r.marking) ? r.marking : 'solid'
  return {
    id: r.id,
    name: typeof r.name === 'string' && r.name.trim() ? r.name.slice(0, 24) : 'Cat',
    blurb: typeof r.blurb === 'string' ? r.blurb.slice(0, 80) : 'A one-of-a-kind cat.',
    geom: (r.geom && typeof r.geom === 'object' ? r.geom : {}) as AppPet['geom'],
    marking,
    coat: coat as unknown as AppPet['coat'], // coat.primary hex-validated above
    personality: personality as Record<string, number> & Personality
  }
}

function sanitizeAi(raw: unknown): AiConfig {
  const a = defaultAi()
  if (!raw || typeof raw !== 'object') return a
  const r = raw as Record<string, unknown>
  if (typeof r.provider === 'string' && (AI_PROVIDERS as string[]).includes(r.provider)) a.provider = r.provider as AiProviderId
  a.model = typeof r.model === 'string' && r.model.trim() ? r.model.trim() : DEFAULT_MODEL[a.provider]
  if (typeof r.endpoint === 'string' && r.endpoint.trim()) a.endpoint = r.endpoint.trim()
  return a
}

/** Coerce arbitrary parsed JSON into a valid AppSettings, dropping junk. */
function sanitize(raw: unknown): AppSettings {
  const s = defaults()
  if (!raw || typeof raw !== 'object') return s
  const r = raw as Record<string, unknown>
  // User pets first — activePetId/overrides below are gated against the full roster.
  if (Array.isArray(r.userPets)) {
    for (const raw2 of r.userPets) {
      const pet = sanitizeUserPet(raw2)
      if (pet && !s.userPets.some((p) => p.id === pet.id) && !PETS.some((p) => p.id === pet.id)) s.userPets.push(pet)
    }
  }
  s.ai = sanitizeAi(r.ai)
  const known = (id: string): boolean => PETS.some((p) => p.id === id) || s.userPets.some((p) => p.id === id)
  if (typeof r.activePetId === 'string' && known(r.activePetId)) s.activePetId = r.activePetId
  if (typeof r.scale === 'number' && Number.isFinite(r.scale)) {
    s.scale = Math.max(MIN_SCALE, Math.min(MAX_SCALE, Math.round(r.scale)))
  }
  if (typeof r.turnMs === 'number' && Number.isFinite(r.turnMs)) {
    s.turnMs = Math.max(MIN_TURN_MS, Math.min(MAX_TURN_MS, Math.round(r.turnMs)))
  }
  if (typeof r.stayPut === 'boolean') s.stayPut = r.stayPut
  if (typeof r.frontScale === 'number' && Number.isFinite(r.frontScale)) {
    s.frontScale = Math.max(MIN_FRONT_SCALE, Math.min(MAX_FRONT_SCALE, r.frontScale))
  }
  if (Array.isArray(r.disabledAnims)) {
    s.disabledAnims = (r.disabledAnims as unknown[]).filter(
      (a): a is AppSettings['disabledAnims'][number] => typeof a === 'string' && (TOGGLEABLE_ANIMS as string[]).includes(a)
    )
  }
  if (r.overrides && typeof r.overrides === 'object') {
    for (const [petId, ov] of Object.entries(r.overrides as Record<string, unknown>)) {
      if (!known(petId) || !ov || typeof ov !== 'object') continue
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

/** The full roster the app offers: built-in presets plus user-generated pets. */
export function allPets(s: AppSettings): AppPet[] {
  return [...PETS, ...s.userPets]
}

/** Resolve a pet id against the full roster (built-in + user), falling back to Ash. */
export function findPet(s: AppSettings, petId: string): AppPet {
  return allPets(s).find((p) => p.id === petId) ?? DEFAULT_PET
}

/** A pet's effective personality: its preset traits merged with user overrides. */
export function effectivePersonality(s: AppSettings, petId: string): Personality {
  const pet = findPet(s, petId)
  return { ...pet.personality, ...(s.overrides[petId] ?? {}) }
}
