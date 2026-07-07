// Fast visual QA for the cat generator. Renders a set of cats/states into one
// PNG on a dark background (so white cats are visible). No Electron needed.
//
//   node scripts/preview.mjs [out.png]

import { writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { encodePNG } from './pngEncoder.mjs'
import { renderCat, W, H } from './catgen.mjs'
import { PRESETS } from './presets.mjs'

const __dirname = dirname(fileURLToPath(import.meta.url))
const outPath = resolve(process.argv[2] || resolve(__dirname, '../.preview.png'))

const SCALE = 7
const GAP = 8
const BG = [46, 46, 56]

/** Lay out a list of {rgba} cats in a grid, scaled, on a dark background. */
function compose(cells, cols) {
  const rows = Math.ceil(cells.length / cols)
  const cw = W * SCALE, ch = H * SCALE
  const outW = cols * cw + (cols + 1) * GAP
  const outH = rows * ch + (rows + 1) * GAP
  const out = new Uint8ClampedArray(outW * outH * 4)
  // fill background
  for (let i = 0; i < outW * outH; i++) {
    out[i * 4] = BG[0]
    out[i * 4 + 1] = BG[1]
    out[i * 4 + 2] = BG[2]
    out[i * 4 + 3] = 255
  }
  cells.forEach((cell, i) => {
    const col = i % cols, row = Math.floor(i / cols)
    const ox = GAP + col * (cw + GAP)
    const oy = GAP + row * (ch + GAP)
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        const a = cell.rgba[(y * W + x) * 4 + 3]
        if (!a) continue
        const r = cell.rgba[(y * W + x) * 4]
        const g = cell.rgba[(y * W + x) * 4 + 1]
        const b = cell.rgba[(y * W + x) * 4 + 2]
        for (let sy = 0; sy < SCALE; sy++) {
          for (let sx = 0; sx < SCALE; sx++) {
            const px = ox + x * SCALE + sx
            const py = oy + y * SCALE + sy
            const o = (py * outW + px) * 4
            out[o] = r
            out[o + 1] = g
            out[o + 2] = b
            out[o + 3] = 255
          }
        }
      }
    }
  })
  return { rgba: out, w: outW, h: outH }
}

const cells = PRESETS.map((p) => ({ rgba: renderCat(p, { eyeOpen: true, tailPhase: 0.4 }).rgba }))

const { rgba, w, h } = compose(cells, 5)
writeFileSync(outPath, encodePNG(w, h, rgba))
console.log(`wrote ${outPath} (${w}x${h})`)
