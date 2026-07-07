// Generates assets/icon.png (app/installer icon) and assets/tray.png (system tray)
// from the default white cat grid, using the dependency-free PNG encoder.
//
// The grid/palette are duplicated here (kept small) so this build script has no
// dependency on the TypeScript sources. Keep in sync with src/shared/catSprite.ts.

import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { encodePNG, encodeICO } from './pngEncoder.mjs'

const __dirname = dirname(fileURLToPath(import.meta.url))
const root = resolve(__dirname, '..')

const PALETTE = {
  o: '#2b2b33',
  b: '#f4f4f6',
  s: '#d3d3dd',
  h: '#ffffff',
  p: '#e4e4ee',
  e: '#5cbf74',
  k: '#22303a',
  n: '#e98aa0'
}

// Left half (16 wide); mirrored to 32x32. Keep in sync with catSprite.ts LEFT.
const LEFT = [
  '................',
  '.......o........',
  '......ohho......',
  '......ohhho.....',
  '.....ohhhno.....',
  '.....ohhhno.....',
  '....ohhhbno.....',
  '....ohhbbbo.....',
  '...ohbbbbbbo....',
  '...ohbbbbbbbbbbh',
  '..ohbbbbbbbbbbbh',
  '..obbbbbbbbbbbbb',
  '..obbbbbbbbbbbbb',
  '..obbbeeebbbbbbb',
  '..obbbekebbbbbbb',
  '..obbbeeebbbbbbb',
  '..obbbbbbbbbbbbb',
  '..obbbbbbbbbbsnn',
  '...obbbbbbbbbsnn',
  '...obbbbbbbbbbbb',
  '....obbbbbbbbbbb',
  '....obsbbbbbbbbb',
  '...obssbbbbbbbbb',
  '..obbssbbbbbbbbb',
  '..obbsbbbbbbbbbb',
  '.obbbbbbbbbbbbbb',
  '.obbbbbbbbbbbbbb',
  '.obbbbbbbbbbbbbb',
  '.obbbbbbbbbbbbbb',
  '.obbsppppsbbbbbb',
  '.obbsppppsbbbsbb',
  '.ooooooooooooooo'
]

const GRID = LEFT.map((row) => row + [...row].reverse().join(''))

function hexToRgb(hex) {
  const h = hex.replace('#', '')
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)]
}

/** Render the grid at an integer scale into an RGBA buffer. */
function renderIcon(scale) {
  const gw = GRID[0].length
  const gh = GRID.length
  const w = gw * scale
  const h = gh * scale
  const rgba = new Uint8Array(w * h * 4)

  for (let y = 0; y < gh; y++) {
    for (let x = 0; x < gw; x++) {
      const ch = GRID[y][x]
      if (ch === '.' || !PALETTE[ch]) continue
      const [r, g, b] = hexToRgb(PALETTE[ch])
      for (let dy = 0; dy < scale; dy++) {
        for (let dx = 0; dx < scale; dx++) {
          const px = x * scale + dx
          const py = y * scale + dy
          const o = (py * w + px) * 4
          rgba[o] = r
          rgba[o + 1] = g
          rgba[o + 2] = b
          rgba[o + 3] = 255
        }
      }
    }
  }
  return { w, h, rgba }
}

function pngAt(scale) {
  const { w, h, rgba } = renderIcon(scale)
  return { size: w, png: encodePNG(w, h, rgba) }
}

function write(name, buf, label) {
  const out = resolve(root, 'assets', name)
  mkdirSync(dirname(out), { recursive: true })
  writeFileSync(out, buf)
  console.log(`wrote ${out} ${label}`)
}

// Base grid is 32px; integer scales give 32/64/128/256.
const png256 = pngAt(8)
const png32 = pngAt(1)
write('icon.png', png256.png, '(256x256)') // app / docs
write('tray.png', png32.png, '(32x32)') // system tray
write(
  'icon.ico',
  encodeICO([pngAt(1), pngAt(2), pngAt(4), png256]),
  '(multi-size .ico for the installer)'
)
