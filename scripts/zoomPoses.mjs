// Zoom render of idle + walk frames for QA.  node scripts/zoomPoses.mjs out.png
import { writeFileSync } from 'node:fs'
import { encodePNG } from './pngEncoder.mjs'
import { render, generateGrid, generateWalkGrid, W, H } from './catgen.mjs'
import { PRESETS } from './presets.mjs'
const ash = PRESETS.find((p) => p.id === 'ash')
const cells = [
  render(generateGrid(ash, { eyeOpen: true, tailPhase: 0.4 }), ash.coat),
  render(generateWalkGrid(ash, 0.1), ash.coat),
  render(generateWalkGrid(ash, 0.6), ash.coat)
]
const S = 11, GAP = 8, BG = [40, 40, 50]
const cols = cells.length, cw = W * S, outW = cols * cw + (cols + 1) * GAP, outH = H * S + 2 * GAP
const out = new Uint8ClampedArray(outW * outH * 4)
for (let i = 0; i < outW * outH; i++) { out[i * 4] = BG[0]; out[i * 4 + 1] = BG[1]; out[i * 4 + 2] = BG[2]; out[i * 4 + 3] = 255 }
cells.forEach((rgba, ci) => {
  const ox = GAP + ci * (cw + GAP), oy = GAP
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    if (!rgba[(y * W + x) * 4 + 3]) continue
    for (let sy = 0; sy < S; sy++) for (let sx = 0; sx < S; sx++) {
      const o = ((oy + y * S + sy) * outW + (ox + x * S + sx)) * 4
      out[o] = rgba[(y * W + x) * 4]; out[o + 1] = rgba[(y * W + x) * 4 + 1]; out[o + 2] = rgba[(y * W + x) * 4 + 2]; out[o + 3] = 255
    }
  }
})
writeFileSync(process.argv[2], encodePNG(outW, outH, out))
console.log('wrote', process.argv[2])
