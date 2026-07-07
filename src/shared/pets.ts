// The pet roster for the app. All 20 generated cats are kept here so the future
// pet-picker (M3) can offer them; `DEFAULT_PET` is the one currently active.
//
// Mirrors scripts/presets.mjs (the gallery copy) — keep in sync. NOTE the naming:
// the white solid cat is "Ash" (the user's pet, given yellow eyes) and the gray
// mackerel tabby is "Snowbell" (names were swapped per the user's request).

import type { Pet } from './catgen'

const NORMAL = {}
const CHONKY = { bodyRx: 15, bodyRy: 12.5, headRx: 11.5, headRy: 10.5, earSpread: 8 }
const SLIM = { bodyRx: 9.8, bodyRy: 9.5, headRx: 9.8, headRy: 9, earH: 9 }
const KITTEN = { headRx: 12.5, headRy: 11.2, bodyRx: 9.8, bodyRy: 8.2, eyeRx: 3.1, eyeRy: 3.7, eyeDX: 5.4, earW: 8, noseY: 22 }
const FLUFFY = { earH: 11, earStyle: 'tufted', cheekFluff: 5, bodyRx: 14, bodyRy: 12 }
const BIGEARS = { earH: 12.5, earW: 8.5, earSpread: 8 }

const g = (arch: object, extra: object = {}): object => ({ ...arch, ...extra })

export const PETS: Pet[] = [
  // The user's pet: the white solid cat, named "Ash", with yellow eyes.
  { id: 'ash', name: 'Ash', blurb: 'A serene, cloud-soft house cat.',
    geom: g(NORMAL), marking: 'solid',
    coat: { primary: '#f2f2f4', iris: '#f3c73e' },
    personality: { energy: 0.4, sleepiness: 0.5, affection: 0.7, mischief: 0.2, curiosity: 0.5, independence: 0.4 } },

  { id: 'shadow', name: 'Shadow', blurb: 'A sleek midnight prowler.',
    geom: g(SLIM, { eyeStyle: 'almond' }), marking: 'solid',
    coat: { primary: '#33333c', iris: '#e6b24e', innerEar: '#5a4650', whisk: '#9a9aa6', nose: '#4a3a40' },
    personality: { energy: 0.7, sleepiness: 0.3, affection: 0.4, mischief: 0.6, curiosity: 0.7, independence: 0.7 } },

  { id: 'smokey', name: 'Smokey', blurb: 'A round, easygoing gray gentleman.',
    geom: g(CHONKY), marking: 'solid',
    coat: { primary: '#9a9aa6', secondary: '#6f6f7d', iris: '#e0a94e' },
    personality: { energy: 0.35, sleepiness: 0.7, affection: 0.6, mischief: 0.2, curiosity: 0.4, independence: 0.5 } },

  { id: 'tiger', name: 'Tiger', blurb: 'A bold ginger tabby with big energy.',
    geom: g(NORMAL), marking: 'tabby',
    coat: { primary: '#e8944a', secondary: '#c56a24', iris: '#8fbf5e' },
    personality: { energy: 0.85, sleepiness: 0.2, affection: 0.5, mischief: 0.7, curiosity: 0.8, independence: 0.5 } },

  // The gray mackerel tabby, now named "Snowbell".
  { id: 'snowbell', name: 'Snowbell', blurb: 'A classic mackerel gray tabby.',
    geom: g(NORMAL), marking: 'tabby',
    coat: { primary: '#9a9aa6', secondary: '#63636f', iris: '#e0a94e' },
    personality: { energy: 0.55, sleepiness: 0.4, affection: 0.55, mischief: 0.45, curiosity: 0.6, independence: 0.5 } },

  { id: 'milo', name: 'Milo', blurb: 'A dapper tuxedo in a permanent suit.',
    geom: g(NORMAL), marking: 'tuxedo',
    coat: { primary: '#2f2f38', white: '#f4f4f7', iris: '#e7b24e', innerEar: '#6b5560', whisk: '#c9c9d4', nose: '#4a3a40' },
    personality: { energy: 0.5, sleepiness: 0.4, affection: 0.7, mischief: 0.4, curiosity: 0.6, independence: 0.4 } },

  { id: 'patches', name: 'Patches', blurb: 'A cheerful calico, no two sides alike.',
    geom: g(FLUFFY), marking: 'calico',
    coat: { primary: '#f4f4f7', secondary: '#e2963f', tertiary: '#3a3038', iris: '#7bb35a' },
    personality: { energy: 0.6, sleepiness: 0.4, affection: 0.6, mischief: 0.5, curiosity: 0.7, independence: 0.5 } },

  { id: 'coco', name: 'Coco', blurb: 'An elegant siamese with sky-blue eyes.',
    geom: g(SLIM, { eyeStyle: 'almond' }), marking: 'points',
    coat: { primary: '#efe6d2', secondary: '#7a5a48', iris: '#5aa9e6', nose: '#8a6a68', innerEar: '#8a6a68' },
    personality: { energy: 0.6, sleepiness: 0.35, affection: 0.6, mischief: 0.5, curiosity: 0.8, independence: 0.6 } },

  { id: 'ginger', name: 'Ginger', blurb: 'A creamy, mellow lap cat.',
    geom: g(CHONKY), marking: 'solid',
    coat: { primary: '#f0c98f', secondary: '#d8a662', iris: '#d98a4a' },
    personality: { energy: 0.3, sleepiness: 0.7, affection: 0.8, mischief: 0.2, curiosity: 0.4, independence: 0.3 } },

  { id: 'pumpkin', name: 'Pumpkin', blurb: 'A chunky orange tabby who loves snacks.',
    geom: g(CHONKY), marking: 'tabby',
    coat: { primary: '#e79246', secondary: '#bd6420', iris: '#8fbf5e' },
    personality: { energy: 0.45, sleepiness: 0.6, affection: 0.7, mischief: 0.4, curiosity: 0.5, independence: 0.4 } },

  { id: 'luna', name: 'Luna', blurb: 'A gray-and-white dreamer.',
    geom: g(NORMAL), marking: 'bicolor',
    coat: { primary: '#8a8a97', white: '#f4f4f7', iris: '#6aa9e0' },
    personality: { energy: 0.45, sleepiness: 0.55, affection: 0.65, mischief: 0.3, curiosity: 0.6, independence: 0.45 } },

  { id: 'boots', name: 'Boots', blurb: 'A playful tuxedo kitten in white socks.',
    geom: g(KITTEN), marking: 'tuxedo',
    coat: { primary: '#2f2f38', white: '#f4f4f7', iris: '#7bd08a', innerEar: '#6b5560', whisk: '#c9c9d4', nose: '#4a3a40' },
    personality: { energy: 0.9, sleepiness: 0.2, affection: 0.7, mischief: 0.8, curiosity: 0.9, independence: 0.3 } },

  { id: 'biscuit', name: 'Biscuit', blurb: 'A fluffy cream-and-orange sweetheart.',
    geom: g(FLUFFY), marking: 'bicolor',
    coat: { primary: '#e79246', white: '#f6ecd8', iris: '#7bb35a' },
    personality: { energy: 0.5, sleepiness: 0.5, affection: 0.8, mischief: 0.35, curiosity: 0.55, independence: 0.35 } },

  { id: 'hazel', name: 'Hazel', blurb: 'A warm brown tabby with woodland eyes.',
    geom: g(NORMAL), marking: 'tabby',
    coat: { primary: '#977152', secondary: '#5f4530', iris: '#8fbf5e' },
    personality: { energy: 0.55, sleepiness: 0.45, affection: 0.6, mischief: 0.45, curiosity: 0.65, independence: 0.5 } },

  { id: 'pepper', name: 'Pepper', blurb: 'A drowsy charcoal cat with big ears.',
    geom: g(BIGEARS, { eyeStyle: 'sleepy' }), marking: 'solid',
    coat: { primary: '#4a4a55', secondary: '#33333c', iris: '#e6cf4e', innerEar: '#6b5560', whisk: '#9a9aa6' },
    personality: { energy: 0.25, sleepiness: 0.85, affection: 0.5, mischief: 0.2, curiosity: 0.35, independence: 0.6 } },

  { id: 'blue', name: 'Blue', blurb: 'A refined Russian-blue with almond eyes.',
    geom: g(SLIM, { eyeStyle: 'almond' }), marking: 'solid',
    coat: { primary: '#7d8a99', secondary: '#5a6472', iris: '#7bd08a' },
    personality: { energy: 0.5, sleepiness: 0.45, affection: 0.45, mischief: 0.35, curiosity: 0.6, independence: 0.7 } },

  { id: 'marble', name: 'Marble', blurb: 'A tortoiseshell of fire and shadow.',
    geom: g(NORMAL), marking: 'calico',
    coat: { primary: '#3a3038', secondary: '#c8763a', tertiary: '#25201f', white: '#3a3038', iris: '#d98a4a' },
    personality: { energy: 0.6, sleepiness: 0.4, affection: 0.5, mischief: 0.65, curiosity: 0.65, independence: 0.65 } },

  { id: 'snickers', name: 'Snickers', blurb: 'A rich chocolate-brown softie.',
    geom: g(CHONKY), marking: 'solid',
    coat: { primary: '#5b4636', secondary: '#3f3025', iris: '#e0a94e', nose: '#7a5a58' },
    personality: { energy: 0.35, sleepiness: 0.6, affection: 0.75, mischief: 0.3, curiosity: 0.45, independence: 0.4 } },

  { id: 'midnight', name: 'Midnight', blurb: 'A fluffy black cat with lantern eyes.',
    geom: g(FLUFFY, { earH: 11 }), marking: 'solid',
    coat: { primary: '#2b2b34', secondary: '#1c1c24', iris: '#f0c24e', innerEar: '#5a4650', whisk: '#9a9aa6', nose: '#4a3a40' },
    personality: { energy: 0.55, sleepiness: 0.45, affection: 0.5, mischief: 0.6, curiosity: 0.7, independence: 0.6 } },

  { id: 'peaches', name: 'Peaches', blurb: 'A friendly orange-and-white greeter.',
    geom: g(NORMAL), marking: 'bicolor',
    coat: { primary: '#e89250', white: '#f6ecd8', iris: '#7bb35a' },
    personality: { energy: 0.6, sleepiness: 0.4, affection: 0.85, mischief: 0.4, curiosity: 0.6, independence: 0.3 } }
]

/** The currently active desktop pet. */
export const DEFAULT_PET: Pet = PETS.find((p) => p.id === 'ash') as Pet
