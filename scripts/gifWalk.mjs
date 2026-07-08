// Renders the walk gait cycle to an animated GIF for motion analysis.
//   node scripts/gifWalk.mjs [frames] [scale] [delayCs] [out.gif]

import { writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { encodeGIF } from './gifEncoder.mjs'
import { generateWalkGrid, render, W, H } from './catgen.mjs'
import { PRESETS } from './presets.mjs'

const __dirname = dirname(fileURLToPath(import.meta.url))
const N = parseInt(process.argv[2] || '12', 10)
const S = parseInt(process.argv[3] || '6', 10)
const DELAY = parseInt(process.argv[4] || '8', 10)
const out = resolve(process.argv[5] || resolve(__dirname, '../.walk.gif'))

const ash = PRESETS.find((p) => p.id === 'ash')
const BG = [40, 40, 48]
const ow = W * S
const oh = H * S

function scaleFrame(rgba) {
  const dst = new Uint8ClampedArray(ow * oh * 4)
  for (let y = 0; y < oh; y++)
    for (let x = 0; x < ow; x++) {
      const sx = Math.floor(x / S), sy = Math.floor(y / S)
      const si = (sy * W + sx) * 4
      const di = (y * ow + x) * 4
      if (rgba[si + 3] > 128) {
        dst[di] = rgba[si]; dst[di + 1] = rgba[si + 1]; dst[di + 2] = rgba[si + 2]; dst[di + 3] = 255
      } else {
        dst[di] = BG[0]; dst[di + 1] = BG[1]; dst[di + 2] = BG[2]; dst[di + 3] = 255
      }
    }
  return dst
}

const frames = []
for (let i = 0; i < N; i++) {
  // Match the app: the renderer quantizes step to whole 1/N buckets.
  const rgba = render(generateWalkGrid(ash, i / N), ash.coat)
  frames.push(scaleFrame(rgba))
}

writeFileSync(out, encodeGIF(ow, oh, frames, { delayCs: DELAY, loop: 0 }))
console.log(`wrote ${out} (${ow}x${oh}, ${N} frames, ${DELAY}cs)`)
