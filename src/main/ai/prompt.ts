// The vision task: describe a photographed cat as PetDNA. One JSON Schema drives
// structured output on both providers (OpenAI function-calling + Anthropic
// tool-use), and one system prompt frames the task. The model is constrained to
// our vocabulary (see shared/petdna.ts) so results always map to a renderable
// cat; sanitizeDNA() is still the backstop for anything off-spec.

import { BUILD_NAMES, MARKING_NAMES, EYE_STYLES } from '../../shared/petdna'
import { TRAIT_KEYS } from '../../shared/types'

export const TOOL_NAME = 'describe_cat'

const hexProp = (desc: string): object => ({ type: 'string', description: `${desc} — a #RRGGBB hex color` })

/** JSON Schema for the DNA (used as OpenAI function params / Anthropic tool input). */
export const DNA_SCHEMA = {
  type: 'object',
  properties: {
    name: { type: 'string', description: 'A short, fitting name for this cat (1-2 words).' },
    blurb: { type: 'string', description: 'One charming sentence describing the cat (max ~10 words).' },
    build: { type: 'string', enum: BUILD_NAMES, description: 'Body type: normal, chonky (round/heavy), slim (lean), kitten (big head, small body), fluffy (long-haired, tufted ears), bigears.' },
    marking: { type: 'string', enum: MARKING_NAMES, description: 'Coat pattern: solid, tabby (stripes), tuxedo (black+white bib/paws), calico (tri-color patches), points (pale body, dark face/ears/legs like a siamese), bicolor (two-tone).' },
    eyeStyle: { type: 'string', enum: EYE_STYLES, description: 'round, almond (sleek), or sleepy (half-closed).' },
    colors: {
      type: 'object',
      properties: {
        primary: hexProp('The dominant coat color'),
        secondary: hexProp('Stripe / shading / second color (tabby stripes, calico orange, point color)'),
        white: hexProp('White areas for tuxedo/bicolor/calico (usually near #f4f4f7)'),
        tertiary: hexProp('Third color for calico/tortoiseshell'),
        iris: hexProp('Eye color'),
        nose: hexProp('Nose color (optional)'),
        innerEar: hexProp('Inner-ear color (optional)'),
        whisk: hexProp('Whisker color (optional)')
      },
      required: ['primary', 'iris']
    },
    personality: {
      type: 'object',
      description: 'A fun estimate of temperament from visible cues (breed, pose, expression, setting). Each value 0..1.',
      properties: Object.fromEntries(TRAIT_KEYS.map((k) => [k, { type: 'number', minimum: 0, maximum: 1 }])),
      required: [...TRAIT_KEYS]
    }
  },
  required: ['name', 'blurb', 'build', 'marking', 'eyeStyle', 'colors', 'personality']
} as const

export const SYSTEM_PROMPT =
  'You are a pet-portrait analyst for a cute 8-bit pixel-art desktop-pet generator. ' +
  'You are given one or more photos of a real cat. Describe it as structured DNA the ' +
  'generator can render, choosing ONLY from the allowed vocabulary. Match the coat colors ' +
  'to what you see (sample real hex values from the fur, eyes, nose). Pick the closest build ' +
  'and marking. Infer a plausible, playful personality from breed cues, pose, expression, and ' +
  'setting — this is a fun estimate, not science. Always call the describe_cat tool.'

export const USER_PROMPT =
  'Here is my cat. Please describe it as pixel-pet DNA using the describe_cat tool.'

// JSON-mode variant for OpenAI-compatible endpoints. Local vision models (Ollama
// et al.) generally can't do tool-calling, so instead of forcing a function call
// we ask for the JSON object directly and parse it from the reply. Cloud gpt-4o
// follows this just as well.
const list = (a: readonly string[]): string => a.join(' | ')
export const JSON_SYSTEM_PROMPT =
  'You are a pet-portrait analyst for a cute 8-bit pixel-art desktop-pet generator. Given a photo ' +
  'of a real cat, sample real hex colors from the fur, eyes, and nose, pick the closest build and ' +
  'marking, and infer a playful personality from breed cues, pose, expression, and setting. ' +
  'Return ONLY a JSON object — no prose, no markdown code fences — with exactly these fields:\n' +
  `- name: string (short, fitting)\n` +
  `- blurb: string (one charming sentence, max ~10 words)\n` +
  `- build: one of ${list(BUILD_NAMES)}\n` +
  `- marking: one of ${list(MARKING_NAMES)} (points = pale body with a dark face/ears/legs like a siamese)\n` +
  `- eyeStyle: one of ${list(EYE_STYLES)}\n` +
  `- colors: object with "primary" and "iris" as #RRGGBB hex (required); optional "secondary" (stripes/shading/point color), "white" (tuxedo/bicolor/calico areas), "tertiary" (third calico color), "nose", "innerEar", "whisk" (all hex)\n` +
  `- personality: object with ${list(TRAIT_KEYS)} — each a number from 0 to 1`

export const JSON_USER_PROMPT = 'Here is my cat. Return the pixel-pet DNA JSON.'
