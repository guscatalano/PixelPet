// Generates Microsoft Store listing art (logos + promo images) — branded
// twilight plates with Ash, no text (so every image is safe for placements that
// forbid the title, e.g. hero/promo). Output: store-assets/. Run on demand:
//   node scripts/genStoreAssets.mjs
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { encodePNG } from './pngEncoder.mjs'
import { renderCat, W, H } from './catgen.mjs'
import { PRESETS } from './presets.mjs'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const outDir = resolve(root, 'store-assets')
mkdirSync(outDir, { recursive: true })

const ash = PRESETS.find((p) => p.id === 'ash') || PRESETS[0]
const { rgba } = renderCat(ash, { eyeOpen: true, tailPhase: 0.15 })

// Crop the cat to its opaque bounding box, padded square.
let minx = W, miny = H, maxx = 0, maxy = 0
for (let y = 0; y < H; y++)
  for (let x = 0; x < W; x++)
    if (rgba[(y * W + x) * 4 + 3]) { if (x < minx) minx = x; if (x > maxx) maxx = x; if (y < miny) miny = y; if (y > maxy) maxy = y }
const cw = maxx - minx + 1, ch = maxy - miny + 1
const side = Math.max(cw, ch)
const catSq = new Uint8Array(side * side * 4)
const offx = Math.floor((side - cw) / 2), offy = Math.floor((side - ch) / 2)
for (let y = 0; y < ch; y++)
  for (let x = 0; x < cw; x++) {
    const s = ((y + miny) * W + (x + minx)) * 4, d = ((y + offy) * side + (x + offx)) * 4
    catSq[d] = rgba[s]; catSq[d + 1] = rgba[s + 1]; catSq[d + 2] = rgba[s + 2]; catSq[d + 3] = rgba[s + 3]
  }
function scaleCat(size) {
  const dst = new Uint8Array(size * size * 4)
  for (let y = 0; y < size; y++)
    for (let x = 0; x < size; x++) {
      const sx = Math.min(side - 1, Math.floor((x * side) / size)), sy = Math.min(side - 1, Math.floor((y * side) / size))
      const s = (sy * side + sx) * 4, d = (y * size + x) * 4
      dst[d] = catSq[s]; dst[d + 1] = catSq[s + 1]; dst[d + 2] = catSq[s + 2]; dst[d + 3] = catSq[s + 3]
    }
  return dst
}

const mix = (a, b, t) => [Math.round(a[0] + (b[0] - a[0]) * t), Math.round(a[1] + (b[1] - a[1]) * t), Math.round(a[2] + (b[2] - a[2]) * t)]
const TL = [63, 66, 112], BR = [28, 29, 48]

function brandedRect(w, h, catFrac, biasY = 0) {
  const out = new Uint8Array(w * h * 4)
  const diag = w + h
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      let g = mix(TL, BR, (x + y) / diag)
      const glow = Math.max(0, 1 - Math.hypot(x - w * 0.4, y - h * 0.34) / (Math.max(w, h) * 0.62)) * 0.16
      g = mix(g, [255, 255, 255], glow)
      const d = (y * w + x) * 4
      out[d] = g[0]; out[d + 1] = g[1]; out[d + 2] = g[2]; out[d + 3] = 255
    }
  const cs = Math.round(Math.min(w, h) * catFrac)
  const cat = scaleCat(cs)
  const ox = Math.floor((w - cs) / 2), oy = Math.floor((h - cs) / 2) + Math.round(h * biasY)
  for (let y = 0; y < cs; y++)
    for (let x = 0; x < cs; x++) {
      const a = cat[(y * cs + x) * 4 + 3]
      if (!a) continue
      const dx = ox + x, dy = oy + y
      if (dx < 0 || dx >= w || dy < 0 || dy >= h) continue
      const s = (y * cs + x) * 4, d = (dy * w + dx) * 4, af = a / 255
      out[d] = Math.round(cat[s] * af + out[d] * (1 - af))
      out[d + 1] = Math.round(cat[s + 1] * af + out[d + 1] * (1 - af))
      out[d + 2] = Math.round(cat[s + 2] * af + out[d + 2] * (1 - af))
      out[d + 3] = 255
    }
  return out
}

function write(name, w, h, f, bias = 0) {
  writeFileSync(resolve(outDir, name), encodePNG(w, h, brandedRect(w, h, f, bias)))
  console.log(`wrote store-assets/${name} (${w}x${h})`)
}

// Store display images (1:1)
write('AppTileIcon-300.png', 300, 300, 0.6)
write('Square-150.png', 150, 150, 0.62)
write('Square-71.png', 71, 71, 0.68)
// Logos / promo (no text — safe everywhere incl. hero)
write('BoxArt-1x1-1080.png', 1080, 1080, 0.56)
write('PosterArt-9x16-720x1080.png', 720, 1080, 0.42)
write('SuperHero-16x9-1920x1080.png', 1920, 1080, 0.34)
