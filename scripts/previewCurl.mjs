// Quick visual QA for the curled-up sleep pose.  node scripts/previewCurl.mjs
import { writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { encodePNG } from './pngEncoder.mjs'
import { render, generateGrid, generateCurlGrid, W, H } from './catgen.mjs'
import { PRESETS } from './presets.mjs'

const __dirname = dirname(fileURLToPath(import.meta.url))
const outPath = resolve(__dirname, '../.preview-curl.png')
const ash = PRESETS.find((p) => p.id === 'ash')

const SCALE = 9, GAP = 10, BG = [46, 46, 56]
const cells = []
// standing idle for size/style comparison
cells.push({ rgba: render(generateGrid(ash, { eyeOpen: true }), ash.coat) })
// curl across the breathing cycle
for (const t of [0, 0.25, 0.5, 0.75]) cells.push({ rgba: render(generateCurlGrid(ash, t * Math.PI * 2), ash.coat) })

const cols = cells.length
const cw = W * SCALE, ch = H * SCALE
const outW = cols * cw + (cols + 1) * GAP, outH = ch + 2 * GAP
const out = new Uint8ClampedArray(outW * outH * 4)
for (let i = 0; i < outW * outH; i++) { out[i * 4] = BG[0]; out[i * 4 + 1] = BG[1]; out[i * 4 + 2] = BG[2]; out[i * 4 + 3] = 255 }
cells.forEach((cell, i) => {
  const ox = GAP + i * (cw + GAP), oy = GAP
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const a = cell.rgba[(y * W + x) * 4 + 3]; if (!a) continue
    for (let sy = 0; sy < SCALE; sy++) for (let sx = 0; sx < SCALE; sx++) {
      const o = ((oy + y * SCALE + sy) * outW + (ox + x * SCALE + sx)) * 4
      out[o] = cell.rgba[(y * W + x) * 4]; out[o + 1] = cell.rgba[(y * W + x) * 4 + 1]; out[o + 2] = cell.rgba[(y * W + x) * 4 + 2]; out[o + 3] = 255
    }
  }
})
writeFileSync(outPath, encodePNG(outW, outH, out))
console.log(`wrote ${outPath} (${outW}x${outH})`)
