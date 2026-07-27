// Pet DNA — the portable, vocabulary-constrained description of a cat that the
// AI "generate from a photo" flow (M4) produces and that maps to a renderable
// AppPet. The vision model is constrained to THESE choices (build archetype,
// marking kind, a small set of hex colors, eye style, personality) rather than
// inventing raw geometry, so every generated cat stays on-model. dnaToPet()
// validates and clamps everything — a malformed model response can never yield
// a broken pet; missing/invalid fields fall back to sensible defaults.

import type { CoatSpec } from './catgen'
import { BUILDS, type AppPet, type BuildName } from './pets'
import { TRAIT_KEYS, type Personality } from './types'

export const BUILD_NAMES = Object.keys(BUILDS) as BuildName[]
export const MARKING_NAMES = ['solid', 'tabby', 'tuxedo', 'calico', 'points', 'bicolor'] as const
export type MarkingName = (typeof MARKING_NAMES)[number]
export const EYE_STYLES = ['round', 'almond', 'sleepy'] as const
export type EyeStyle = (typeof EYE_STYLES)[number]

/** The structured output the vision model must return (see ai/prompt.ts). */
export interface PetDNA {
  name: string
  blurb: string
  build: BuildName
  marking: MarkingName
  eyeStyle: EyeStyle
  colors: {
    primary: string
    secondary?: string
    white?: string
    tertiary?: string
    iris: string
    nose?: string
    innerEar?: string
    whisk?: string
  }
  personality: Personality
}

const HEX = /^#[0-9a-fA-F]{6}$/
const clamp01 = (n: number): number => (Number.isFinite(n) ? Math.max(0, Math.min(1, n)) : 0.5)
const hex = (v: unknown, fallback: string): string => (typeof v === 'string' && HEX.test(v) ? v.toLowerCase() : fallback)
const pick = <T extends string>(v: unknown, allowed: readonly T[], fallback: T): T =>
  (typeof v === 'string' && (allowed as readonly string[]).includes(v) ? (v as T) : fallback)

/** Coerce arbitrary parsed JSON from the model into a valid PetDNA. */
export function sanitizeDNA(raw: unknown): PetDNA {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>
  const c = (r.colors && typeof r.colors === 'object' ? r.colors : {}) as Record<string, unknown>
  const p = (r.personality && typeof r.personality === 'object' ? r.personality : {}) as Record<string, unknown>
  const personality = {} as Personality
  for (const k of TRAIT_KEYS) personality[k] = clamp01(Number(p[k]))
  const name = typeof r.name === 'string' && r.name.trim() ? r.name.trim().slice(0, 24) : 'New Cat'
  const blurb = typeof r.blurb === 'string' && r.blurb.trim() ? r.blurb.trim().slice(0, 80) : 'A one-of-a-kind cat.'
  return {
    name,
    blurb,
    build: pick(r.build, BUILD_NAMES, 'normal'),
    marking: pick(r.marking, MARKING_NAMES, 'solid'),
    eyeStyle: pick(r.eyeStyle, EYE_STYLES, 'round'),
    colors: {
      primary: hex(c.primary, '#c8c8d0'),
      secondary: typeof c.secondary === 'string' && HEX.test(c.secondary) ? c.secondary.toLowerCase() : undefined,
      white: typeof c.white === 'string' && HEX.test(c.white) ? c.white.toLowerCase() : undefined,
      tertiary: typeof c.tertiary === 'string' && HEX.test(c.tertiary) ? c.tertiary.toLowerCase() : undefined,
      iris: hex(c.iris, '#9caf6e'),
      nose: typeof c.nose === 'string' && HEX.test(c.nose) ? c.nose.toLowerCase() : undefined,
      innerEar: typeof c.innerEar === 'string' && HEX.test(c.innerEar) ? c.innerEar.toLowerCase() : undefined,
      whisk: typeof c.whisk === 'string' && HEX.test(c.whisk) ? c.whisk.toLowerCase() : undefined
    },
    personality
  }
}

// ---- Random cat (no AI) ----------------------------------------------------
// Produce a curated-random PetDNA that always looks on-model: colors are picked
// PER MARKING (a calico gets a pale base, a tuxedo a dark one, a Siamese-style
// points cat gets a pale body + dark points + blue eyes), then the same
// dnaToPet() the photo flow uses turns it into a real pet.
const RAND_NAMES = ['Mochi', 'Clover', 'Waffles', 'Nimbus', 'Olive', 'Tofu', 'Comet', 'Poppy', 'Bean', 'Maple', 'Dusty', 'Willow', 'Jasper', 'Cinnamon', 'Noodle', 'Suki', 'Gizmo', 'Pip', 'Mango', 'Basil', 'Yuki', 'Cricket', 'Otis', 'Momo', 'Ziggy', 'Pesto', 'Sprout', 'Ember', 'Pixel', 'Biscotti']
const RAND_BLURBS = ['A one-of-a-kind cat.', 'No two are ever the same.', 'Freshly dreamed up.', 'A happy little accident.', 'Rolled fresh off the dice.']
const IRISES = ['#8fae5a', '#e0a93e', '#5b93c9', '#b6772e', '#6fae86', '#c98a3a']
const DARKS = ['#2a2b31', '#33343d', '#3f3a44', '#463b33', '#2e2f39']
const MIDS = ['#d9a35f', '#c8823c', '#9aa0ad', '#6d7280', '#a5734a', '#7a5236', '#b8b0c4', '#8a8f9c']
const PALES = ['#ece7dc', '#e7c9a0', '#eceaf0', '#e6d8c4', '#dcd6e2']
const rpick = <T>(a: readonly T[]): T => a[Math.floor(Math.random() * a.length)]

/** A curated random cat DNA — no AI, no setup. */
export function randomPetDNA(): PetDNA {
  const marking = rpick(MARKING_NAMES)
  const colors = { primary: '#c8c8d0', iris: rpick(IRISES) } as PetDNA['colors']
  switch (marking) {
    case 'tuxedo': colors.primary = rpick(DARKS); break
    case 'bicolor': colors.primary = rpick(MIDS); break
    case 'tabby': colors.primary = rpick([...MIDS, DARKS[0], DARKS[3]]); break
    case 'points': colors.primary = rpick(PALES); colors.iris = '#5b93c9'; colors.secondary = rpick(['#5a4636', '#4a3a30', '#514038']); break
    case 'calico': colors.primary = rpick(PALES); colors.secondary = rpick(['#e2963f', '#d98a35', '#c47a2f']); colors.tertiary = rpick(['#3a3038', '#2e2a2e', '#43373a']); break
    default: colors.primary = rpick([...MIDS, ...DARKS, ...PALES]); break // solid
  }
  const personality = {} as Personality
  for (const k of TRAIT_KEYS) personality[k] = Math.round(Math.random() * 100) / 100
  return { name: rpick(RAND_NAMES), blurb: rpick(RAND_BLURBS), build: rpick(BUILD_NAMES), marking, eyeStyle: rpick(EYE_STYLES), colors, personality }
}

/** A slightly darker shade of a hex color, for auto-filled secondary/shadow. */
function darken(h: string, amt = 0.32): string {
  const n = parseInt(h.slice(1), 16)
  const r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255
  const d = (v: number): number => Math.max(0, Math.round(v * (1 - amt)))
  return '#' + ((d(r) << 16) | (d(g) << 8) | d(b)).toString(16).padStart(6, '0')
}

/**
 * A natural whisker color for a coat. Real whiskers are white/pale (dark cats
 * often black), never a saturated hue — so we derive it from the coat's
 * lightness rather than letting the model pick: pale whiskers on a dark cat,
 * a soft gray on a light cat so they stay visible without looking colored.
 */
export function naturalWhisker(primary: string): string {
  const n = parseInt(primary.slice(1), 16)
  const r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255
  const lum = (0.299 * r + 0.587 * g + 0.114 * b) / 255
  return lum < 0.5 ? '#e8e8ef' : '#b9b9c6'
}

/** Build the coat spec for a marking, filling required-but-missing colors. */
function buildCoat(dna: PetDNA): CoatSpec {
  const c = dna.colors
  const coat: CoatSpec = { primary: c.primary, iris: c.iris }
  if (c.nose) coat.nose = c.nose
  if (c.innerEar) coat.innerEar = c.innerEar
  coat.whisk = naturalWhisker(c.primary) // never AI-chosen — real whiskers aren't colored
  const white = c.white ?? '#f4f4f7'
  switch (dna.marking) {
    case 'tabby':
      coat.secondary = c.secondary ?? darken(c.primary)
      break
    case 'tuxedo':
      coat.white = white
      break
    case 'bicolor':
      coat.white = white
      break
    case 'points':
      coat.secondary = c.secondary ?? darken(c.primary, 0.45)
      break
    case 'calico':
      coat.secondary = c.secondary ?? '#e2963f'
      coat.tertiary = c.tertiary ?? '#3a3038'
      coat.white = c.white ?? white
      break
    case 'solid':
    default:
      if (c.secondary) coat.secondary = c.secondary
      break
  }
  return coat
}

/** Turn validated DNA into a fully-specified, renderable AppPet. */
export function dnaToPet(raw: unknown, id: string): AppPet {
  const dna = sanitizeDNA(raw)
  const geom = { ...BUILDS[dna.build], eyeStyle: dna.eyeStyle }
  return {
    id,
    name: dna.name,
    blurb: dna.blurb,
    geom,
    marking: dna.marking,
    coat: buildCoat(dna),
    // AppPet.personality resolves to Record<string,number> & Personality (Pet's
    // index-signatured personality ∩ our named type); a typed Personality needs
    // the assertion since an interface carries no index signature.
    personality: dna.personality as Record<string, number> & Personality
  }
}
