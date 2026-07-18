// Generates the app icon set from the active pet (Ash): a branded rounded-tile
// icon (twilight gradient background + the cat) for the app/installer (icon.png,
// icon.ico), and a crisp transparent cat for the system tray (tray.png). The
// same tile design is drawn in the settings header (see settings/main.ts).

import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { encodePNG, encodeICO } from './pngEncoder.mjs'
import { renderCat, W, H } from './catgen.mjs'
import { PRESETS } from './presets.mjs'

const __dirname = dirname(fileURLToPath(import.meta.url))
const root = resolve(__dirname, '..')

const ash = PRESETS.find((p) => p.id === 'ash') || PRESETS[0]
const { rgba } = renderCat(ash, { eyeOpen: true, tailPhase: 0.15 })

// Crop the cat to its opaque bounding box, centered in a small padded square.
let minx = W, miny = H, maxx = 0, maxy = 0
for (let y = 0; y < H; y++)
  for (let x = 0; x < W; x++)
    if (rgba[(y * W + x) * 4 + 3]) {
      if (x < minx) minx = x
      if (x > maxx) maxx = x
      if (y < miny) miny = y
      if (y > maxy) maxy = y
    }
const cw = maxx - minx + 1, ch = maxy - miny + 1
const pad = Math.round(Math.max(cw, ch) * 0.1)
const side = Math.max(cw, ch) + pad * 2
const catSq = new Uint8Array(side * side * 4)
const offx = Math.floor((side - cw) / 2), offy = Math.floor((side - ch) / 2)
for (let y = 0; y < ch; y++)
  for (let x = 0; x < cw; x++) {
    const s = ((y + miny) * W + (x + minx)) * 4
    const d = ((y + offy) * side + (x + offx)) * 4
    catSq[d] = rgba[s]; catSq[d + 1] = rgba[s + 1]; catSq[d + 2] = rgba[s + 2]; catSq[d + 3] = rgba[s + 3]
  }

/** Nearest-neighbor scale of the padded cat square to `size`. */
function scaleCat(size) {
  const dst = new Uint8Array(size * size * 4)
  for (let y = 0; y < size; y++)
    for (let x = 0; x < size; x++) {
      const sx = Math.min(side - 1, Math.floor((x * side) / size))
      const sy = Math.min(side - 1, Math.floor((y * side) / size))
      const s = (sy * side + sx) * 4, d = (y * size + x) * 4
      dst[d] = catSq[s]; dst[d + 1] = catSq[s + 1]; dst[d + 2] = catSq[s + 2]; dst[d + 3] = catSq[s + 3]
    }
  return dst
}
const catOnly = (size) => ({ size, png: encodePNG(size, size, scaleCat(size)) })

// macOS menu-bar icons are "template" images: black shape + alpha, tinted by the
// system for light/dark menu bars. Recolor the cat silhouette to solid black.
function catSilhouette(size) {
  const src = scaleCat(size), dst = new Uint8Array(size * size * 4)
  for (let i = 0; i < size * size; i++) { dst[i * 4] = 0; dst[i * 4 + 1] = 0; dst[i * 4 + 2] = 0; dst[i * 4 + 3] = src[i * 4 + 3] }
  return dst
}

// ---- the branded rounded-tile icon: twilight gradient + the cat ----
const mix = (a, b, t) => [Math.round(a[0] + (b[0] - a[0]) * t), Math.round(a[1] + (b[1] - a[1]) * t), Math.round(a[2] + (b[2] - a[2]) * t)]
const TL = [63, 66, 112], BR = [28, 29, 48] // twilight (periwinkle -> deep navy)

function appIcon(size) {
  const out = new Uint8Array(size * size * 4)
  const r = size * 0.22 // corner radius
  const lo = r, hi = size - 1 - r
  for (let y = 0; y < size; y++)
    for (let x = 0; x < size; x++) {
      const nx = Math.min(Math.max(x, lo), hi), ny = Math.min(Math.max(y, lo), hi)
      const dist = Math.hypot(x - nx, y - ny)
      const cover = Math.max(0, Math.min(1, r + 0.5 - dist)) // 1px anti-aliased corner
      if (cover <= 0) continue
      let g = mix(TL, BR, (x + y) / (2 * size)) // diagonal gradient
      const glow = Math.max(0, 1 - Math.hypot(x - size * 0.4, y - size * 0.32) / (size * 0.55)) * 0.16
      g = mix(g, [255, 255, 255], glow) // soft top-left light
      const d = (y * size + x) * 4
      out[d] = g[0]; out[d + 1] = g[1]; out[d + 2] = g[2]; out[d + 3] = Math.round(255 * cover)
    }
  // the cat, ~72% of the tile, centered a touch high
  const cs = Math.round(size * 0.72)
  const cat = scaleCat(cs)
  const ox = Math.floor((size - cs) / 2), oy = Math.floor((size - cs) / 2) - Math.round(size * 0.02)
  for (let y = 0; y < cs; y++)
    for (let x = 0; x < cs; x++) {
      const a = cat[(y * cs + x) * 4 + 3]
      if (!a) continue
      const dx = ox + x, dy = oy + y
      if (dx < 0 || dx >= size || dy < 0 || dy >= size) continue
      const s = (y * cs + x) * 4, d = (dy * size + dx) * 4, af = a / 255
      out[d] = Math.round(cat[s] * af + out[d] * (1 - af))
      out[d + 1] = Math.round(cat[s + 1] * af + out[d + 1] * (1 - af))
      out[d + 2] = Math.round(cat[s + 2] * af + out[d + 2] * (1 - af))
      out[d + 3] = Math.max(out[d + 3], a)
    }
  return out
}
const iconAt = (size) => ({ size, png: encodePNG(size, size, appIcon(size)) })

function write(name, buf, label) {
  const out = resolve(root, 'assets', name)
  mkdirSync(dirname(out), { recursive: true })
  writeFileSync(out, buf)
  console.log(`wrote ${out} ${label}`)
}

const p256 = iconAt(256)
write('icon.png', p256.png, '(256x256, branded tile)')
write('tray.png', catOnly(32).png, '(32x32, cat only)')
write('icon.ico', encodeICO([iconAt(32), iconAt(64), iconAt(128), p256]), '(multi-size .ico)')

// ---- macOS ----
write('trayTemplate.png', encodePNG(16, 16, catSilhouette(16)), '(16x16 mac menu-bar template)')
write('trayTemplate@2x.png', encodePNG(32, 32, catSilhouette(32)), '(32x32 mac menu-bar template @2x)')
write('icon-mac.png', encodePNG(1024, 1024, appIcon(1024)), '(1024x1024 mac app icon -> .icns)')

// ---- Microsoft Store (MSIX/APPX) tiles ----
// Full-bleed square/rectangular branded plates (no rounded corners — Windows
// applies its own tile masking). electron-builder looks for these by filename in
// the `appx` SUBFOLDER of buildResources (assets/appx/) — getResource(_, "appx")
// — so writing them to assets/ root is silently ignored and it uses its generic
// defaults (a Store certification failure, policy 10.1.1.11). Write to assets/appx/.
function brandedRect(w, h, catFrac, biasY = 0) {
  const out = new Uint8Array(w * h * 4)
  const diag = w + h
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      let g = mix(TL, BR, (x + y) / diag) // diagonal twilight gradient
      const glow = Math.max(0, 1 - Math.hypot(x - w * 0.4, y - h * 0.34) / (Math.max(w, h) * 0.6)) * 0.16
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
const tile = (name, w, h, f, bias = 0) => write(join('appx', name), encodePNG(w, h, brandedRect(w, h, f, bias)), `(${w}x${h} Store tile)`)
tile('Square44x44Logo.png', 44, 44, 0.78)
tile('Square71x71Logo.png', 71, 71, 0.72)
tile('Square150x150Logo.png', 150, 150, 0.64)
tile('Square310x310Logo.png', 310, 310, 0.58)
tile('Wide310x150Logo.png', 310, 150, 0.72)
tile('StoreLogo.png', 50, 50, 0.74)
tile('SplashScreen.png', 620, 300, 0.5)
