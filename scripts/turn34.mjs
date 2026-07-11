// ¾ view derived FROM the front pose: the same cute front cat with small,
// controlled asymmetries (features shifted toward the facing side, far eye
// narrowed, ears offset, tail visible on the near side). Because it's 90% the
// front drawing, it stays on-model — unlike a parametric side<->front morph.
//
// t = 0   -> exactly the front idle
// t = 1   -> strongest ¾ (cat's face angled toward viewer-right)
//
//   node scripts/turn34.mjs [out.png]   (renders a strip of t values)
import { W, H, render } from './catgen.mjs'

const HI = 1, BASE = 2, SHADOW = 3, DEEP = 4
const O = { NONE: 0, OUTLINE: 1, IRIS: 2, PUPIL: 3, GLINT: 4, NOSE: 5, INEAR: 6, MOUTH: 7, WHISK: 8 }
const idx = (x, y) => y * W + x, inB = (x, y) => x >= 0 && x < W && y >= 0 && y < H
function ellipse(cb, cx, cy, rx, ry) { for (let y = Math.floor(cy - ry); y <= Math.ceil(cy + ry); y++) for (let x = Math.floor(cx - rx); x <= Math.ceil(cx + rx); x++) { if (!inB(x, y)) continue; const dx = (x - cx) / rx, dy = (y - cy) / ry; if (dx * dx + dy * dy <= 1) cb(x, y) } }
function triangle(cb, ax, ay, bx, by, cx, cy) { const mnX = Math.floor(Math.min(ax, bx, cx)), mxX = Math.ceil(Math.max(ax, bx, cx)), mnY = Math.floor(Math.min(ay, by, cy)), mxY = Math.ceil(Math.max(ay, by, cy)); for (let y = mnY; y <= mxY; y++) for (let x = mnX; x <= mxX; x++) { if (!inB(x, y)) continue; const w0 = (bx - ax) * (y - ay) - (by - ay) * (x - ax), w1 = (cx - bx) * (y - by) - (cy - by) * (x - bx), w2 = (ax - cx) * (y - cy) - (ay - cy) * (x - cx); if ((w0 >= 0 && w1 >= 0 && w2 >= 0) || (w0 <= 0 && w1 <= 0 && w2 <= 0)) cb(x, y) } }
const LIGHT = (() => { const v = [-0.35, -0.5, 0.79]; const m = Math.hypot(...v); return v.map((c) => c / m) })()
function sphereBright(x, y, cx, cy, rx, ry) { const nx = (x - cx) / rx, ny = (y - cy) / ry; const nz = Math.sqrt(Math.max(0, 1 - nx * nx - ny * ny)); return nx * LIGHT[0] + ny * LIGHT[1] + nz * LIGHT[2] }
function shadeLevel(b) { return b > 0.62 ? HI : b > 0.2 ? BASE : b > -0.15 ? SHADOW : DEEP }
function put(overlay, x, y, role) { if (inB(x, y)) overlay[idx(x, y)] = role }
const defaultGeom = () => ({ headCx: 22, headCy: 16, headRx: 11, headRy: 10, bodyCx: 22, bodyCy: 33, bodyRx: 12, bodyRy: 11,
  earW: 7.5, earH: 8.5, earSpread: 7.5, earLean: 1.5, eyeDX: 5.2, eyeY: 17, eyeRx: 2.5, eyeRy: 3.0, noseY: 22 })

export function generate34Grid(preset, t, state = {}) {
  const g = { ...defaultGeom(), ...(preset.geom || {}) }
  const fur = new Uint8Array(W * H)
  const set = (x, y) => { if (inB(x, y)) fur[idx(x, y)] = 1 }

  // --- asymmetric geometry (face angled toward viewer-right) ---
  const hx = g.headCx + 1.3 * t            // head mass eases right
  const bx = g.bodyCx - 0.7 * t            // rear hints left
  const noseX = hx + 2.2 * t               // nose travels toward the facing side
  const noseY = g.noseY + 0.4 * t          // ...and a touch down (muzzle turning)

  // --- silhouette: body, tail (near side), legs, neck, head, cheeks, ears ---
  ellipse(set, bx, g.bodyCy, g.bodyRx, g.bodyRy)
  ellipse(set, bx, g.bodyCy + g.bodyRy * 0.45, g.bodyRx * 0.94, g.bodyRy * 0.72)
  if (t > 0.25) { // tail wraps into view on the left as the body angles
    const ta = (t - 0.25) / 0.75
    const p0 = [bx - g.bodyRx * 0.55, g.bodyCy + g.bodyRy * 0.5]
    const p1 = [bx - g.bodyRx - 3 * ta, g.bodyCy + 2]
    const p2 = [bx - g.bodyRx * 0.7 - 2 * ta, g.bodyCy - g.bodyRy * 0.55]
    for (let k = 0; k <= 1.001; k += 0.05) { const it = 1 - k
      ellipse(set, it * it * p0[0] + 2 * it * k * p1[0] + k * k * p2[0], it * it * p0[1] + 2 * it * k * p1[1] + k * k * p2[1], (3.0 - k * 1.2) * Math.min(1, ta + 0.4), (3.0 - k * 1.2) * Math.min(1, ta + 0.4)) }
  }
  { // front legs, shifted with the chest
    const legDX = g.bodyRx * 0.3
    const legTop = g.bodyCy + g.bodyRy * 0.32, pawY = g.bodyCy + g.bodyRy * 0.98
    for (const s of [-1, 1]) {
      const lx = bx + 0.9 * t + s * legDX
      for (let y = legTop; y <= pawY; y += 0.5) ellipse(set, lx, y, 2.3, 1.6)
      ellipse(set, lx, pawY, 3, 2.3)
    }
  }
  ellipse(set, (hx + bx) / 2, (g.headCy + g.bodyCy) / 2 + 1, g.headRx * 0.78, (g.bodyCy - g.headCy) * 0.55) // neck
  ellipse(set, hx, g.headCy, g.headRx, g.headRy * 0.96) // head (front shape)
  { // cheeks: near (left) cheek fuller, far (right) reduced — sells the angle
    const chR = g.headRx * 0.46
    ellipse(set, hx - g.headRx * (0.64 + 0.06 * t), g.headCy + g.headRy * 0.3, chR * (1 + 0.12 * t), chR * 0.8)
    ellipse(set, hx + g.headRx * (0.64 - 0.10 * t), g.headCy + g.headRy * 0.3, chR * (1 - 0.22 * t), chR * 0.8)
  }
  const earBaseY = g.headCy - g.headRy * 0.55
  const earL = hx - g.earSpread * (1 + 0.10 * t)          // near ear drifts out
  const earR = hx + g.earSpread * (1 - 0.28 * t)          // far ear folds toward centre
  const earRW = g.earW * (1 - 0.22 * t), earRH = g.earH * (1 - 0.15 * t)
  triangle(set, earL - g.earW / 2, earBaseY + 1, earL + g.earW / 2, earBaseY + 1, earL - g.earLean, earBaseY - g.earH)
  triangle(set, earR - earRW / 2, earBaseY + 1, earR + earRW / 2, earBaseY + 1, earR + g.earLean * (1 - 0.4 * t), earBaseY - earRH)

  // --- outline, shading (same treatment as the front pose) ---
  const shade = new Uint8Array(W * H), region = new Uint8Array(W * H), overlay = new Uint8Array(W * H)
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) { if (fur[idx(x, y)]) continue; let near = false
    for (let dy = -1; dy <= 1 && !near; dy++) for (let dx = -1; dx <= 1; dx++) if (inB(x + dx, y + dy) && fur[idx(x + dx, y + dy)]) { near = true; break }
    if (near) overlay[idx(x, y)] = O.OUTLINE }
  const inHead = (x, y) => { const dx = (x - hx) / (g.headRx + 0.5), dy = (y - g.headCy) / (g.headRy + 0.5); return dx * dx + dy * dy <= 1.05 }
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) { if (!fur[idx(x, y)]) continue
    if (inHead(x, y)) shade[idx(x, y)] = shadeLevel(sphereBright(x, y, hx, g.headCy, g.headRx, g.headRy))
    else shade[idx(x, y)] = shadeLevel(sphereBright(x, y, bx, g.bodyCy, g.bodyRx, g.bodyRy)) }
  for (let y = 0; y < H - 1; y++) for (let x = 0; x < W; x++)
    if (fur[idx(x, y)] && overlay[idx(x, y + 1)] === O.OUTLINE && shade[idx(x, y)] === BASE) shade[idx(x, y)] = SHADOW
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) { if (!fur[idx(x, y)]) continue
    const dx = (x - bx) / 5.5, dy = (y - (g.bodyCy + 2)) / 7.5
    if (dx * dx + dy * dy <= 1 && shade[idx(x, y)] > HI) shade[idx(x, y)] -= 1 }
  { // front-leg crease + toes, shifted with the chest
    const legDX = g.bodyRx * 0.3, cxp = Math.round(bx + 0.9 * t)
    const legTop = Math.round(g.bodyCy + g.bodyRy * 0.42), pawY = Math.round(g.bodyCy + g.bodyRy * 0.98)
    for (let y = legTop; y <= pawY; y++) {
      if (inB(cxp, y) && fur[idx(cxp, y)]) shade[idx(cxp, y)] = DEEP
      if (inB(cxp - 1, y) && fur[idx(cxp - 1, y)] && shade[idx(cxp - 1, y)] < SHADOW) shade[idx(cxp - 1, y)] = SHADOW }
    for (const s of [-1, 1]) { const px = Math.round(bx + 0.9 * t + s * legDX)
      if (inB(px, pawY) && fur[idx(px, pawY)]) shade[idx(px, pawY)] = DEEP }
  }

  // --- face: near (left) eye full, far (right) eye narrowed & closer to nose ---
  const eyeOpen = state.eyeOpen !== false
  const eyeY = g.eyeY + 0.3 * t
  const eyes = [
    { ex: noseX - g.eyeDX * (1 + 0.10 * t), rx: g.eyeRx, ry: g.eyeRy },                       // near (left)
    { ex: noseX + g.eyeDX * (1 - 0.34 * t), rx: g.eyeRx * (1 - 0.36 * t), ry: g.eyeRy * (1 - 0.10 * t) } // far (right)
  ]
  for (const e of eyes) {
    if (!eyeOpen) { for (let x = Math.round(e.ex - e.rx); x <= Math.round(e.ex + e.rx); x++) put(overlay, x, Math.round(eyeY), O.OUTLINE); continue }
    ellipse((x, y) => put(overlay, x, y, O.IRIS), e.ex, eyeY, e.rx, e.ry)
    const look = (state.look ?? 0.35 * t) * (e.rx * 0.9) // pupils drift toward facing side mid-turn
    ellipse((x, y) => put(overlay, x, y, O.PUPIL), e.ex + look, eyeY + 0.3, Math.max(0.85, e.rx * 0.45), e.ry * 0.72)
    put(overlay, Math.round(e.ex + look - e.rx * 0.35), Math.round(eyeY - e.ry * 0.4), O.GLINT)
  }
  triangle((x, y) => put(overlay, x, y, O.NOSE), noseX - 1.6, noseY - 1, noseX + 1.6, noseY - 1, noseX, noseY + 1.2)
  put(overlay, Math.round(noseX), Math.round(noseY) + 2, O.MOUTH)
  for (const dx of [-2, -1, 1, 2]) put(overlay, Math.round(noseX) + dx, Math.round(noseY) + 3, O.MOUTH)
  { // inner ears (white-rimmed, like the front pose)
    const iw = g.earW * 0.26
    triangle((x, y) => { if (fur[idx(x, y)] && overlay[idx(x, y)] !== O.OUTLINE) put(overlay, x, y, O.INEAR) },
      earL + 0.5 - iw, earBaseY - 0.5, earL + 0.5 + iw, earBaseY - 0.5, earL + 0.3 - g.earLean * 0.4, earBaseY - g.earH * 0.5)
    const iwR = iw * (1 - 0.25 * t)
    triangle((x, y) => { if (fur[idx(x, y)] && overlay[idx(x, y)] !== O.OUTLINE) put(overlay, x, y, O.INEAR) },
      earR - 0.5 - iwR, earBaseY - 0.5, earR - 0.5 + iwR, earBaseY - 0.5, earR - 0.3 + g.earLean * 0.3, earBaseY - earRH * 0.5)
  }
  // whiskers: near side full, far side shortened (turning away from viewer)
  for (const s of [-1, 1]) {
    const wx = noseX + s * (g.headRx * 0.5)
    const len = s < 0 ? 5 : Math.max(1, Math.round(5 * (1 - 0.6 * t)))
    for (let k = 0; k < 3; k++) {
      const wy = noseY - 1 + k
      for (let i = 1; i <= len; i++) {
        const x = Math.round(wx + s * (g.headRx * 0.35 + i)), y = Math.round(wy + (k - 1) * 0.6)
        if (inB(x, y) && overlay[idx(x, y)] === O.NONE && !fur[idx(x, y)]) put(overlay, x, y, O.WHISK)
      }
    }
  }

  return { shade, region, overlay, geom: g, fur }
}

if (process.argv[1] && process.argv[1].endsWith('turn34.mjs')) {
  const { writeFileSync } = await import('node:fs')
  const { encodePNG } = await import('./pngEncoder.mjs')
  const { PRESETS } = await import('./presets.mjs')
  const ash = PRESETS.find((p) => p.id === 'ash')
  const ts = [0, 0.35, 0.7, 1]
  const cells = ts.map((t) => render(generate34Grid(ash, t), ash.coat))
  const S = 9, GAP = 10, BG = [18, 20, 28], cols = cells.length
  const outW = cols * W * S + (cols + 1) * GAP, outH = H * S + 2 * GAP
  const out = new Uint8ClampedArray(outW * outH * 4)
  for (let i = 0; i < outW * outH; i++) { out[i * 4] = BG[0]; out[i * 4 + 1] = BG[1]; out[i * 4 + 2] = BG[2]; out[i * 4 + 3] = 255 }
  cells.forEach((rgba, ci) => { const ox = GAP + ci * (W * S + GAP)
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) { if (!rgba[(y * W + x) * 4 + 3]) continue
      for (let sy = 0; sy < S; sy++) for (let sx = 0; sx < S; sx++) { const q = ((GAP + y * S + sy) * outW + (ox + x * S + sx)) * 4
        out[q] = rgba[(y * W + x) * 4]; out[q + 1] = rgba[(y * W + x) * 4 + 1]; out[q + 2] = rgba[(y * W + x) * 4 + 2]; out[q + 3] = 255 } } })
  const path = process.argv[2] || '.turn34.png'
  writeFileSync(path, encodePNG(outW, outH, out)); console.log('wrote ' + path)
}
