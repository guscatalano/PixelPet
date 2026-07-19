// Proof that a DNA blob (the AI's structured output) renders as a good cat.
// Mirrors src/shared/petdna.ts's dnaToPet mapping + src/shared/pets.ts BUILDS,
// then draws several hand-authored DNAs (one per marking) via the real generator.
//   node scripts/dnaProof.mjs <out.png>
import { writeFileSync } from 'node:fs'
import { encodePNG } from './pngEncoder.mjs'
import { W, H, render, generateGrid } from './catgen.mjs'

const BUILDS = {
  normal: {},
  chonky: { bodyRx: 15, bodyRy: 12.5, headRx: 11.5, headRy: 10.5, earSpread: 8 },
  slim: { bodyRx: 9.8, bodyRy: 9.5, headRx: 9.8, headRy: 9, earH: 9 },
  kitten: { headRx: 10.6, headRy: 9.7, bodyRx: 10.2, bodyRy: 8.7, eyeRx: 3.1, eyeRy: 3.7, eyeDX: 5.2, earW: 7.8, noseY: 21 },
  fluffy: { earH: 11, earStyle: 'tufted', cheekFluff: 5, bodyRx: 14, bodyRy: 12 },
  bigears: { earH: 12.5, earW: 8.5, earSpread: 8 }
}
const darken = (h, amt = 0.32) => {
  const n = parseInt(h.slice(1), 16), r = (n >> 16) & 255, gg = (n >> 8) & 255, b = n & 255
  const d = (v) => Math.max(0, Math.round(v * (1 - amt)))
  return '#' + ((d(r) << 16) | (d(gg) << 8) | d(b)).toString(16).padStart(6, '0')
}
function buildCoat(dna) {
  const c = dna.colors, coat = { primary: c.primary, iris: c.iris }
  if (c.nose) coat.nose = c.nose
  if (c.innerEar) coat.innerEar = c.innerEar
  if (c.whisk) coat.whisk = c.whisk
  const white = c.white ?? '#f4f4f7'
  switch (dna.marking) {
    case 'tabby': coat.secondary = c.secondary ?? darken(c.primary); break
    case 'tuxedo': coat.white = white; break
    case 'bicolor': coat.white = white; break
    case 'points': coat.secondary = c.secondary ?? darken(c.primary, 0.45); break
    case 'calico': coat.secondary = c.secondary ?? '#e2963f'; coat.tertiary = c.tertiary ?? '#3a3038'; coat.white = c.white ?? white; break
    default: if (c.secondary) coat.secondary = c.secondary
  }
  return coat
}
const dnaToPet = (dna) => ({ geom: { ...BUILDS[dna.build], eyeStyle: dna.eyeStyle }, marking: dna.marking, coat: buildCoat(dna) })

// Hand-authored DNAs, as if returned by the vision model from real cat photos.
const DNAS = [
  { name: 'Marmalade', build: 'normal', marking: 'tabby', eyeStyle: 'round', colors: { primary: '#e8944a', iris: '#8fbf5e' } },
  { name: 'Tux', build: 'slim', marking: 'tuxedo', eyeStyle: 'almond', colors: { primary: '#2b2b32', white: '#f4f4f7', iris: '#e7b24e' } },
  { name: 'Biscuit', build: 'chonky', marking: 'solid', eyeStyle: 'sleepy', colors: { primary: '#f0c98f', secondary: '#d8a662', iris: '#d98a4a' } },
  { name: 'Patch', build: 'fluffy', marking: 'calico', eyeStyle: 'round', colors: { primary: '#f4f4f7', secondary: '#e2963f', tertiary: '#3a3038', iris: '#7bb35a' } },
  { name: 'Sky', build: 'slim', marking: 'points', eyeStyle: 'almond', colors: { primary: '#efe6d2', secondary: '#7a5a48', iris: '#5aa9e6', nose: '#8a6a68' } },
  { name: 'Mochi', build: 'kitten', marking: 'bicolor', eyeStyle: 'round', colors: { primary: '#8a8a97', white: '#f4f4f7', iris: '#6aa9e0' } }
]

const S = 7, GAP = 8, BG = [18, 20, 28], cols = 3, rows = 2
const cells = DNAS.map((d) => render(generateGrid(dnaToPet(d), { eyeOpen: true, tailPhase: 0.3 }), dnaToPet(d).coat))
const outW = cols * W * S + (cols + 1) * GAP, outH = rows * H * S + (rows + 1) * GAP
const out = new Uint8ClampedArray(outW * outH * 4)
for (let i = 0; i < outW * outH; i++) { out[i * 4] = BG[0]; out[i * 4 + 1] = BG[1]; out[i * 4 + 2] = BG[2]; out[i * 4 + 3] = 255 }
cells.forEach((rgba, ci) => {
  const col = ci % cols, row = Math.floor(ci / cols)
  const ox = GAP + col * (W * S + GAP), oy = GAP + row * (H * S + GAP)
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    if (!rgba[(y * W + x) * 4 + 3]) continue
    for (let sy = 0; sy < S; sy++) for (let sx = 0; sx < S; sx++) {
      const q = ((oy + y * S + sy) * outW + (ox + x * S + sx)) * 4
      out[q] = rgba[(y * W + x) * 4]; out[q + 1] = rgba[(y * W + x) * 4 + 1]; out[q + 2] = rgba[(y * W + x) * 4 + 2]; out[q + 3] = 255
    }
  }
})
writeFileSync(process.argv[2], encodePNG(outW, outH, out))
console.log('wrote', process.argv[2])
