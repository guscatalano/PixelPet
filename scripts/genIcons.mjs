// Generates assets/icon.png (app/installer), assets/icon.ico (installer), and
// assets/tray.png (system tray) — rendering the ACTIVE PET (Ash) via the same
// generator the app uses, cropped to the cat and scaled to each size.

import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { encodePNG, encodeICO } from './pngEncoder.mjs'
import { renderCat, W, H } from './catgen.mjs'
import { PRESETS } from './presets.mjs'

const __dirname = dirname(fileURLToPath(import.meta.url))
const root = resolve(__dirname, '..')

const ash = PRESETS.find((p) => p.id === 'ash') || PRESETS[0]
const { rgba } = renderCat(ash, { eyeOpen: true, tailPhase: 0.15 })

// Crop to the opaque bounding box, then center in a padded square.
let minx = W, miny = H, maxx = 0, maxy = 0
for (let y = 0; y < H; y++)
  for (let x = 0; x < W; x++)
    if (rgba[(y * W + x) * 4 + 3]) {
      if (x < minx) minx = x
      if (x > maxx) maxx = x
      if (y < miny) miny = y
      if (y > maxy) maxy = y
    }
const cw = maxx - minx + 1
const ch = maxy - miny + 1
const pad = Math.round(Math.max(cw, ch) * 0.12)
const side = Math.max(cw, ch) + pad * 2
const src = new Uint8Array(side * side * 4)
const offx = Math.floor((side - cw) / 2)
const offy = Math.floor((side - ch) / 2)
for (let y = 0; y < ch; y++)
  for (let x = 0; x < cw; x++) {
    const s = ((y + miny) * W + (x + minx)) * 4
    const d = ((y + offy) * side + (x + offx)) * 4
    src[d] = rgba[s]; src[d + 1] = rgba[s + 1]; src[d + 2] = rgba[s + 2]; src[d + 3] = rgba[s + 3]
  }

/** Nearest-neighbor scale of the padded cat square to a target size. */
function scale(size) {
  const dst = new Uint8Array(size * size * 4)
  for (let y = 0; y < size; y++)
    for (let x = 0; x < size; x++) {
      const sx = Math.min(side - 1, Math.floor((x * side) / size))
      const sy = Math.min(side - 1, Math.floor((y * side) / size))
      const s = (sy * side + sx) * 4
      const d = (y * size + x) * 4
      dst[d] = src[s]; dst[d + 1] = src[s + 1]; dst[d + 2] = src[s + 2]; dst[d + 3] = src[s + 3]
    }
  return dst
}
const pngAt = (size) => ({ size, png: encodePNG(size, size, scale(size)) })

function write(name, buf, label) {
  const out = resolve(root, 'assets', name)
  mkdirSync(dirname(out), { recursive: true })
  writeFileSync(out, buf)
  console.log(`wrote ${out} ${label}`)
}

const p256 = pngAt(256)
write('icon.png', p256.png, '(256x256, Ash)')
write('tray.png', pngAt(32).png, '(32x32)')
write('icon.ico', encodeICO([pngAt(32), pngAt(64), pngAt(128), p256]), '(multi-size .ico)')
