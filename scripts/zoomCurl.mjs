import { writeFileSync } from 'node:fs'
import { encodePNG } from './pngEncoder.mjs'
import { render, generateCurlGrid, W, H } from './catgen.mjs'
import { PRESETS } from './presets.mjs'
const ash = PRESETS.find((p) => p.id === 'ash')
const rgba = render(generateCurlGrid(ash, 0.6), ash.coat)
const S = 16, BG = [40, 40, 50]
const out = new Uint8ClampedArray(W * S * H * S * 4)
for (let i = 0; i < W * S * H * S; i++) { out[i * 4] = BG[0]; out[i * 4 + 1] = BG[1]; out[i * 4 + 2] = BG[2]; out[i * 4 + 3] = 255 }
for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
  if (!rgba[(y * W + x) * 4 + 3]) continue
  for (let sy = 0; sy < S; sy++) for (let sx = 0; sx < S; sx++) {
    const o = ((y * S + sy) * W * S + (x * S + sx)) * 4
    out[o] = rgba[(y * W + x) * 4]; out[o + 1] = rgba[(y * W + x) * 4 + 1]; out[o + 2] = rgba[(y * W + x) * 4 + 2]; out[o + 3] = 255
  }
}
writeFileSync(process.argv[2], encodePNG(W * S, H * S, out))
console.log('wrote', process.argv[2])
