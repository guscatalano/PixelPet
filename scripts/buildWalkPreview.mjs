// Builds a self-contained artifact that animates Ash's walk at the real app
// cadence, with a speed slider so we can pick the pace. Uses the same generator
// the app uses (inlined).

import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const read = (p) => readFileSync(resolve(__dirname, p), 'utf8')
const strip = (s) => s.replace(/^\s*export\s+/gm, '')
const catgen = strip(read('catgen.mjs'))
const presets = strip(read('presets.mjs'))
const out = resolve(process.argv[2] || resolve(__dirname, '../.walk-preview.html'))

const client = `
const ash = PRESETS.find(p => p.id === 'ash')
const STRIDE = 12
const QUANT = 24
const SCALE = 6
const cache = new Map()
function toCanvas(rgba) {
  const c = document.createElement('canvas'); c.width = W; c.height = H
  const cx = c.getContext('2d'); const img = cx.createImageData(W, H); img.data.set(rgba); cx.putImageData(img, 0, 0); return c
}
function walkFrame(step) {
  const s = ((Math.round(step * QUANT) % QUANT) + QUANT) % QUANT
  let c = cache.get(s); if (!c) { c = toCanvas(render(generateWalkGrid(ash, s / QUANT), ash.coat)); cache.set(s, c) }
  return c
}
const idle = toCanvas(render(generateGrid(ash, { eyeOpen: true }), ash.coat))

const stage = document.getElementById('stage')
const dpr = Math.min(2, window.devicePixelRatio || 1)
const cw = 520, ch = 220
stage.style.width = cw + 'px'; stage.style.height = ch + 'px'
stage.width = cw * dpr; stage.height = ch * dpr
const ctx = stage.getContext('2d'); ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.imageSmoothingEnabled = false

let speed = 22
const slider = document.getElementById('speed')
const readout = document.getElementById('readout')
function updateReadout() { readout.textContent = speed + ' px/s  ·  ' + (speed / STRIDE).toFixed(1) + ' strides/s' }
slider.addEventListener('input', () => { speed = +slider.value; updateReadout() })
updateReadout()

const catW = W * SCALE, catH = H * SCALE
const floorY = ch - 18
let dist = 0, last = performance.now()
function loop(now) {
  const dt = Math.min(0.05, (now - last) / 1000); last = now
  dist += speed * dt
  const step = (dist / STRIDE) % 1
  const track = cw + catW
  const x = ((dist % track) + track) % track - catW
  ctx.clearRect(0, 0, cw, ch)
  // ground line
  ctx.strokeStyle = 'rgba(140,150,170,0.25)'; ctx.beginPath(); ctx.moveTo(0, floorY + catH * 0 + 2); ctx.lineTo(cw, floorY + 2); ctx.stroke()
  ctx.drawImage(walkFrame(step), Math.round(x), floorY - catH + 6, catW, catH)
  requestAnimationFrame(loop)
}
requestAnimationFrame(loop)

// Reference: the idle sit, drawn once.
const sit = document.getElementById('sit')
sit.width = W * 4; sit.height = H * 4
const sx = sit.getContext('2d'); sx.imageSmoothingEnabled = false
sx.drawImage(idle, 0, 0, W * 4, H * 4)
`

const html = `<title>Ash — Walk Preview</title>
<style>
  * { box-sizing: border-box; }
  body { margin: 0; background: #14171b; color: #e9ece7; font-family: ui-monospace, "Cascadia Code", Consolas, monospace; }
  .wrap { max-width: 640px; margin: 0 auto; padding: 32px 20px 60px; }
  h1 { font-size: 1.2rem; letter-spacing: 0.02em; margin: 0 0 4px; }
  p.sub { color: #9aa69c; font-size: 0.85rem; margin: 0 0 24px; }
  .panel { background: #1b1f24; border: 1px solid #2a3037; border-radius: 14px; padding: 18px; }
  canvas#stage { display: block; image-rendering: pixelated; background: #14171b; border-radius: 10px; width: 100%; }
  .controls { display: flex; align-items: center; gap: 14px; margin-top: 16px; }
  .controls label { font-size: 0.72rem; text-transform: uppercase; letter-spacing: 0.1em; color: #6f7a71; }
  input[type=range] { flex: 1; accent-color: #58cb8c; }
  #readout { color: #58cb8c; font-size: 0.85rem; white-space: nowrap; min-width: 150px; text-align: right; }
  .ref { display: flex; align-items: center; gap: 14px; margin-top: 22px; color: #9aa69c; font-size: 0.82rem; }
  canvas#sit { image-rendering: pixelated; }
</style>
<div class="wrap">
  <h1>Ash — walk preview</h1>
  <p class="sub">Animated at the app's real cadence. Drag the slider to find the pace you like and tell me the number.</p>
  <div class="panel">
    <canvas id="stage"></canvas>
    <div class="controls">
      <label for="speed">Speed</label>
      <input id="speed" type="range" min="8" max="70" value="22" />
      <span id="readout"></span>
    </div>
  </div>
  <div class="ref"><canvas id="sit"></canvas><span>← her idle sit, for reference</span></div>
</div>
<script>
${catgen}
;
${presets}
;
${client}
</script>
`

writeFileSync(out, html)
console.log('wrote ' + out + ' (' + (html.length / 1024).toFixed(0) + ' KB)')
