// Procedural ¾ turn: morph the cat from side-profile (a=0) to facing-you (a=1)
// through real in-between angles — the far eye/ear emerge, the nose slides to
// centre, the body foreshortens. This gives a SMOOTH side<->front turn.
//   node scripts/turncat.mjs [out.png]
import { W, H, render } from './catgen.mjs'

const HI = 1, BASE = 2, SHADOW = 3, DEEP = 4
const O = { NONE: 0, OUTLINE: 1, IRIS: 2, PUPIL: 3, GLINT: 4, NOSE: 5, INEAR: 6, MOUTH: 7, WHISK: 8 }
const idx = (x, y) => y * W + x, inB = (x, y) => x >= 0 && x < W && y >= 0 && y < H
function ellipse(cb, cx, cy, rx, ry) { for (let y = Math.floor(cy - ry); y <= Math.ceil(cy + ry); y++) for (let x = Math.floor(cx - rx); x <= Math.ceil(cx + rx); x++) { if (!inB(x, y)) continue; const dx = (x - cx) / rx, dy = (y - cy) / ry; if (dx * dx + dy * dy <= 1) cb(x, y) } }
function triangle(cb, ax, ay, bx, by, cx, cy) { const mnX = Math.floor(Math.min(ax, bx, cx)), mxX = Math.ceil(Math.max(ax, bx, cx)), mnY = Math.floor(Math.min(ay, by, cy)), mxY = Math.ceil(Math.max(ay, by, cy)); for (let y = mnY; y <= mxY; y++) for (let x = mnX; x <= mxX; x++) { if (!inB(x, y)) continue; const w0 = (bx - ax) * (y - ay) - (by - ay) * (x - ax), w1 = (cx - bx) * (y - by) - (cy - by) * (x - bx), w2 = (ax - cx) * (y - cy) - (ay - cy) * (x - cx); if ((w0 >= 0 && w1 >= 0 && w2 >= 0) || (w0 <= 0 && w1 <= 0 && w2 <= 0)) cb(x, y) } }
function seg(cb, x0, y0, x1, y1, r0, r1) { const n = 7; for (let t = 0; t <= 1.0001; t += 1 / n) ellipse(cb, x0 + (x1 - x0) * t, y0 + (y1 - y0) * t, r0 + (r1 - r0) * t, r0 + (r1 - r0) * t) }
const LIGHT = (() => { const v = [-0.35, -0.5, 0.79]; const m = Math.hypot(...v); return v.map((c) => c / m) })()
function sphereBright(x, y, cx, cy, rx, ry) { const nx = (x - cx) / rx, ny = (y - cy) / ry; const nz = Math.sqrt(Math.max(0, 1 - nx * nx - ny * ny)); return nx * LIGHT[0] + ny * LIGHT[1] + nz * LIGHT[2] }
function shadeLevel(b) { return b > 0.62 ? HI : b > 0.2 ? BASE : b > -0.15 ? SHADOW : DEEP }
function put(overlay, x, y, role) { if (inB(x, y)) overlay[idx(x, y)] = role }
const lerp = (a, b, k) => a + (b - a) * k

// The turn is a morph between two configs. All coords centred so the cat pivots
// in place. a: 0 = side profile (facing right), 1 = facing viewer.
export function generateTurnGrid(_pet, a) {
  const fur = new Uint8Array(W * H), legTag = new Uint8Array(W * H)
  const set = (x, y) => { if (inB(x, y)) fur[idx(x, y)] = 1 }

  // --- body: side (long, low) -> front (round, upright) ---
  const bcx = lerp(20, 22, a), bcy = lerp(31, 32, a)
  const brx = lerp(11.5, 12.5, a), bry = lerp(8, 11, a)
  // --- head: side (right of centre, small) -> front (centred, larger, up) ---
  const hcx = lerp(27, 22, a), hcy = lerp(22, 18, a), hr = lerp(7, 8.6, a)

  // legs: side-sit (front paws forward-right, hind folded) -> front (two paws centre)
  const legFn = (paint) => {
    if (a < 0.55) { // still reads as side: draw a couple of side legs
      seg(paint, lerp(24, 20, a), 33, lerp(24, 20, a), 42, 2.1, 1.2)
      seg(paint, lerp(15, 18, a), 34, lerp(20, 20, a), 41, 2.2, 1.4)
    } else { // front paws, two together at the base
      ellipse(paint, bcx - 3.5, 41.5, 2.6, 2.4); ellipse(paint, bcx + 3.5, 41.5, 2.6, 2.4)
      seg(paint, bcx - 3.5, 37, bcx - 3.5, 41.5, 2.4, 1.6); seg(paint, bcx + 3.5, 37, bcx + 3.5, 41.5, 2.4, 1.6)
    }
  }
  legFn((x, y) => { set(x, y); if (inB(x, y)) legTag[idx(x, y)] = 1 })

  // tail: side (long, to the left) fades/curls away as we face front
  if (a < 0.7) {
    const ta = 1 - a / 0.7
    const p0 = [bcx - brx * 0.6, bcy], p1 = [bcx - brx - 4 * ta, bcy - 8 * ta], p2 = [bcx - brx + 2, bcy - 15 * ta]
    for (let t = 0; t <= 1.0001; t += 0.06) { const it = 1 - t
      ellipse(set, it * it * p0[0] + 2 * it * t * p1[0] + t * t * p2[0], it * it * p0[1] + 2 * it * t * p1[1] + t * t * p2[1], (2.4 - t) * ta + 0.6, (2.4 - t) * ta + 0.6) }
  }

  ellipse(set, bcx, bcy, brx, bry)      // body
  ellipse(set, hcx, hcy, hr * 1.02, hr * 0.98) // head

  // ears: near ear always; far ear emerges as we face front
  const nearEarX = lerp(hcx + 1.5, hcx + 4.5, a)
  triangle(set, nearEarX - 2.5, hcy - hr + 2, nearEarX + 1.5, hcy - hr + 2, nearEarX + 0.5, hcy - hr - 4)
  if (a > 0.12) { const farEarX = lerp(hcx + 0.5, hcx - 4.5, a)
    triangle(set, farEarX - 1.5, hcy - hr + 2, farEarX + 2.5, hcy - hr + 2, farEarX - 0.5, hcy - hr - 4) }

  const shade = new Uint8Array(W * H), region = new Uint8Array(W * H), overlay = new Uint8Array(W * H)
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) { if (fur[idx(x, y)]) continue; let near = false
    for (let dy = -1; dy <= 1 && !near; dy++) for (let dx = -1; dx <= 1; dx++) if (inB(x + dx, y + dy) && fur[idx(x + dx, y + dy)]) { near = true; break }
    if (near) overlay[idx(x, y)] = O.OUTLINE }
  const inHead = (x, y) => ((x - hcx) / (hr + 0.5)) ** 2 + ((y - hcy) / (hr + 0.5)) ** 2 <= 1.05
  const inBody = (x, y) => ((x - bcx) / (brx + 0.5)) ** 2 + ((y - bcy) / (bry + 0.5)) ** 2 <= 1.05
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) { if (!fur[idx(x, y)]) continue
    if (legTag[idx(x, y)]) shade[idx(x, y)] = BASE
    else if (inHead(x, y)) shade[idx(x, y)] = shadeLevel(sphereBright(x, y, hcx, hcy, hr, hr))
    else if (inBody(x, y)) shade[idx(x, y)] = shadeLevel(sphereBright(x, y, bcx, bcy, brx, bry))
    else shade[idx(x, y)] = BASE }

  // --- eyes: near eye always; far eye slides in from behind the muzzle ---
  const eye = (ex, ey, rx, ry) => {
    ellipse((x, y) => put(overlay, x, y, O.IRIS), ex, ey, rx, ry)
    ellipse((x, y) => put(overlay, x, y, O.PUPIL), ex + lerp(0.3, 0, a), ey, rx * 0.55, ry * 0.7)
    put(overlay, Math.round(ex - 0.4), Math.round(ey - 0.9), O.GLINT)
  }
  const nearEyeX = lerp(hcx + 1.8, hcx + 3.2, a), eyeY = hcy - 0.4
  if (a > 0.18) { const fa = (a - 0.18) / 0.82; eye(lerp(hcx + 0.5, hcx - 3.2, a), eyeY, lerp(0.7, 1.7, fa), lerp(1.2, 2.1, fa)) } // far eye grows in
  eye(nearEyeX, eyeY, lerp(1.6, 1.7, a), lerp(1.9, 2.1, a)) // near eye (drawn last = on top)

  // nose: side (right edge of muzzle) -> front (centre-bottom)
  const nx = Math.round(lerp(hcx + hr - 1, hcx, a)), ny = Math.round(lerp(hcy + 0.8, hcy + 2.4, a))
  if (fur[idx(nx, ny)]) put(overlay, nx, ny, O.NOSE)
  if (a > 0.5) { for (const dx of [-1, 0, 1]) { const wx = Math.round(hcx + dx * lerp(0, 4, a)); if (inB(wx, ny) && !fur[idx(wx, ny + 1)]) put(overlay, wx + Math.sign(dx || 1) * 5, ny, O.WHISK) } }

  // inner ear (near)
  triangle((x, y) => { if (fur[idx(x, y)] && overlay[idx(x, y)] !== O.OUTLINE) put(overlay, x, y, O.INEAR) },
    nearEarX - 0.8, hcy - hr + 1.5, nearEarX + 0.8, hcy - hr + 1.5, nearEarX + 0.3, hcy - hr - 1)

  return { shade, region, overlay, geom: {}, fur }
}

if (process.argv[1] && process.argv[1].endsWith('turncat.mjs')) {
  const { writeFileSync } = await import('node:fs')
  const { encodePNG } = await import('./pngEncoder.mjs')
  const { PRESETS } = await import('./presets.mjs')
  const ash = PRESETS.find((p) => p.id === 'ash')
  const angles = [0, 0.25, 0.5, 0.75, 1]
  const cells = angles.map((a) => render(generateTurnGrid(ash, a), ash.coat))
  const S = 9, GAP = 10, BG = [18, 20, 28], cols = cells.length
  const outW = cols * W * S + (cols + 1) * GAP, outH = H * S + 2 * GAP
  const out = new Uint8ClampedArray(outW * outH * 4)
  for (let i = 0; i < outW * outH; i++) { out[i * 4] = BG[0]; out[i * 4 + 1] = BG[1]; out[i * 4 + 2] = BG[2]; out[i * 4 + 3] = 255 }
  cells.forEach((rgba, ci) => { const ox = GAP + ci * (W * S + GAP)
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) { if (!rgba[(y * W + x) * 4 + 3]) continue
      for (let sy = 0; sy < S; sy++) for (let sx = 0; sx < S; sx++) { const q = ((GAP + y * S + sy) * outW + (ox + x * S + sx)) * 4
        out[q] = rgba[(y * W + x) * 4]; out[q + 1] = rgba[(y * W + x) * 4 + 1]; out[q + 2] = rgba[(y * W + x) * 4 + 2]; out[q + 3] = 255 } } })
  const path = process.argv[2] || '.turncat.png'
  writeFileSync(path, encodePNG(outW, outH, out)); console.log('wrote ' + path)
}
