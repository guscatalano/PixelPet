// A "creature" is the portable, safe-by-construction description of an animal a
// user (or a 3rd-party pack) can bring to PixelPet — cat, dog, rabbit, fox…. It
// extends the coat/build DNA (see petdna.ts) with the silhouette knobs that make
// a *species*: ear style, a muzzle/snout, and finer proportions. loadCreature()
// validates + CLAMPS everything into a renderable AppPet, so a malformed or
// hostile pack can never produce a broken pet or run code — it's pure data,
// interpreted by the built-in rig. (Custom poses/animations come next; for now a
// creature reuses the shared pose set and animation graph.)

import type { Geom } from './catgen'
import type { AppPet } from './pets'
import { dnaToPet, EYE_STYLES } from './petdna'

const EAR_STYLES = ['pointy', 'tufted', 'floppy'] as const

/** The silhouette knobs a creature may set, beyond coat/build DNA. */
export interface CreatureStyle {
  build?: string      // proportion archetype (normal/chonky/slim/kitten/fluffy/bigears)
  eyeStyle?: string   // round | almond | sleepy
  earStyle?: string   // pointy | tufted | floppy
  snout?: number      // 0 = flat cat face, >0 = a dog-like muzzle
  headRx?: number; headRy?: number
  bodyRx?: number; bodyRy?: number
  earW?: number; earH?: number; earSpread?: number
  cheekFluff?: number
}

/** A whole creature: identity + look (style) + coat + behavior defaults. */
export interface CreatureDef {
  id?: string
  name?: string
  species?: string
  author?: string
  style?: CreatureStyle
  coat?: Record<string, unknown>
  marking?: string
  personality?: Record<string, number>
}

const obj = (v: unknown): Record<string, unknown> => (v && typeof v === 'object' ? (v as Record<string, unknown>) : {})
const oneOf = (v: unknown, allowed: readonly string[]): string | undefined =>
  (typeof v === 'string' && allowed.includes(v) ? v : undefined)
/** Set g[key] to a clamped number only when the pack actually provided one. */
function clampInto(g: Partial<Geom>, key: keyof Geom, v: unknown, lo: number, hi: number): void {
  if (typeof v === 'number' && Number.isFinite(v)) (g[key] as number) = Math.max(lo, Math.min(hi, v))
}

/**
 * Turn a creature definition into a validated, renderable AppPet. Coat, build,
 * marking and personality are validated by dnaToPet(); the species-specific
 * silhouette knobs are then clamped and layered on top.
 */
export function loadCreature(raw: unknown, id: string): AppPet {
  const r = obj(raw)
  const s = obj(r.style)
  // Reuse all the coat/personality/build/eye validation from the DNA path.
  const pet = dnaToPet(
    {
      name: r.name,
      blurb: typeof r.species === 'string' ? r.species : undefined,
      build: s.build,
      marking: r.marking,
      eyeStyle: s.eyeStyle,
      colors: obj(r.coat),
      personality: obj(r.personality)
    },
    id
  )
  // Layer the creature silhouette over the validated geom.
  const g = pet.geom as Partial<Geom>
  const ear = oneOf(s.earStyle, EAR_STYLES)
  if (ear) g.earStyle = ear
  const eye = oneOf(s.eyeStyle, EYE_STYLES)
  if (eye) g.eyeStyle = eye
  clampInto(g, 'snout', s.snout, 0, 6)
  clampInto(g, 'headRx', s.headRx, 6, 14)
  clampInto(g, 'headRy', s.headRy, 6, 14)
  clampInto(g, 'bodyRx', s.bodyRx, 8, 16)
  clampInto(g, 'bodyRy', s.bodyRy, 8, 14)
  clampInto(g, 'earW', s.earW, 3, 10)
  clampInto(g, 'earH', s.earH, 4, 20)
  clampInto(g, 'earSpread', s.earSpread, 4, 12)
  clampInto(g, 'cheekFluff', s.cheekFluff, 0, 8)
  return pet
}
