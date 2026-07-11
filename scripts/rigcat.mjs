// Posable side-view cat that renders in OUR cat's exact style (reuses the walk
// pose's head / ears / eye / nose / tail / leg / shading code), so the rig looks
// like our cat. Each pose is a set of joint positions; the app can interpolate
// them for articulated get-up / lie-down transitions.
//
// Preview:  node scripts/rigcat.mjs [out.png]
import { W, H, render } from './catgen.mjs'

// ---- helpers copied from catgen.mjs (module-private there) ------------------
const HI = 1, BASE = 2, SHADOW = 3, DEEP = 4
const O = { NONE: 0, OUTLINE: 1, IRIS: 2, PUPIL: 3, GLINT: 4, NOSE: 5, INEAR: 6, MOUTH: 7, WHISK: 8 }
const idx = (x, y) => y * W + x
const inB = (x, y) => x >= 0 && x < W && y >= 0 && y < H
function ellipse(cb, cx, cy, rx, ry) {
  for (let y = Math.floor(cy - ry); y <= Math.ceil(cy + ry); y++)
    for (let x = Math.floor(cx - rx); x <= Math.ceil(cx + rx); x++) {
      const dx = (x - cx) / rx, dy = (y - cy) / ry
      if (dx * dx + dy * dy <= 1) cb(x, y)
    }
}
function triangle(cb, ax, ay, bx, by, cx, cy) {
  const mnX = Math.floor(Math.min(ax, bx, cx)), mxX = Math.ceil(Math.max(ax, bx, cx))
  const mnY = Math.floor(Math.min(ay, by, cy)), mxY = Math.ceil(Math.max(ay, by, cy))
  for (let y = mnY; y <= mxY; y++)
    for (let x = mnX; x <= mxX; x++) {
      const w0 = (bx - ax) * (y - ay) - (by - ay) * (x - ax), w1 = (cx - bx) * (y - by) - (cy - by) * (x - bx), w2 = (ax - cx) * (y - cy) - (ay - cy) * (x - cx)
      if ((w0 >= 0 && w1 >= 0 && w2 >= 0) || (w0 <= 0 && w1 <= 0 && w2 <= 0)) cb(x, y)
    }
}
function seg(cb, x0, y0, x1, y1, r0, r1) { const n = 7; for (let t = 0; t <= 1.0001; t += 1 / n) ellipse(cb, x0 + (x1 - x0) * t, y0 + (y1 - y0) * t, r0 + (r1 - r0) * t, r0 + (r1 - r0) * t) }
const LIGHT = (() => { const v = [-0.35, -0.5, 0.79]; const m = Math.hypot(...v); return v.map((c) => c / m) })()
function sphereBright(x, y, cx, cy, rx, ry) { const nx = (x - cx) / rx, ny = (y - cy) / ry; const nz = Math.sqrt(Math.max(0, 1 - nx * nx - ny * ny)); return nx * LIGHT[0] + ny * LIGHT[1] + nz * LIGHT[2] }
function shadeLevel(b) { return b > 0.62 ? HI : b > 0.2 ? BASE : b > -0.15 ? SHADOW : DEEP }
function put(overlay, x, y, role) { if (inB(x, y)) overlay[idx(x, y)] = role }

// ---- the posable rig -------------------------------------------------------
// pose = { body:[cx,cy,rx,ry], head:[cx,cy,r], neck:[cx,cy,rx,ry],
//          tail:{root:[x,y],ctrl:[x,y],tip:[x,y]}, eye:0|1,
//          legs:[ {hip:[x,y],mid:[x,y],foot:[x,y],near:bool} x4 (hindFar,frontFar,hindNear,frontNear) ] }
export function generateRigGrid(_pet, pose) {
  const fur = new Uint8Array(W * H), legTag = new Uint8Array(W * H)
  const set = (x, y) => { if (inB(x, y)) fur[idx(x, y)] = 1 }
  const [bcx, bcy, brx, bry] = pose.body
  const [hcx, hcy, hr] = pose.head

  const drawLeg = (lg) => {
    const tag = lg.near ? 1 : 2
    const paint = (x, y) => { set(x, y); if (inB(x, y)) legTag[idx(x, y)] = tag }
    seg(paint, lg.hip[0], lg.hip[1], lg.mid[0], lg.mid[1], 2.2, 1.5) // upper (thigh / upper-arm)
    seg(paint, lg.mid[0], lg.mid[1], lg.foot[0], lg.foot[1], 1.5, 1.0) // lower (shank)
    ellipse(paint, lg.foot[0], lg.foot[1] + 0.2, 1.8, 1.2) // paw
  }
  pose.legs.filter((l) => !l.near).forEach(drawLeg) // far legs behind

  ellipse(set, bcx, bcy, brx, bry) // body
  ellipse(set, pose.neck[0], pose.neck[1], pose.neck[2], pose.neck[3]) // neck
  ellipse(set, hcx, hcy, hr * 1.02, hr * 0.98) // round head (our cat's head)
  triangle(set, hcx - 4, hcy - hr + 2, hcx, hcy - hr + 2, hcx - 4.5, hcy - hr - 4) // back ear
  triangle(set, hcx + 1, hcy - hr + 2, hcx + 5, hcy - hr + 2, hcx + 4, hcy - hr - 4) // front ear
  { const p0 = pose.tail.root, p1 = pose.tail.ctrl, p2 = pose.tail.tip
    for (let t = 0; t <= 1.0001; t += 0.05) { const it = 1 - t
      ellipse(set, it * it * p0[0] + 2 * it * t * p1[0] + t * t * p2[0], it * it * p0[1] + 2 * it * t * p1[1] + t * t * p2[1], 2.6 - t * 1.1, 2.6 - t * 1.1) } }
  pose.legs.filter((l) => l.near).forEach(drawLeg) // near legs on top

  const shade = new Uint8Array(W * H), region = new Uint8Array(W * H), overlay = new Uint8Array(W * H)
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    if (fur[idx(x, y)]) continue
    let near = false
    for (let dy = -1; dy <= 1 && !near; dy++) for (let dx = -1; dx <= 1; dx++) if (inB(x + dx, y + dy) && fur[idx(x + dx, y + dy)]) { near = true; break }
    if (near) overlay[idx(x, y)] = O.OUTLINE
  }
  const inHead = (x, y) => ((x - hcx) / (hr + 0.5)) ** 2 + ((y - hcy) / (hr + 0.5)) ** 2 <= 1.05
  const inBody = (x, y) => ((x - bcx) / (brx + 0.5)) ** 2 + ((y - bcy) / (bry + 0.5)) ** 2 <= 1.05
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    if (!fur[idx(x, y)]) continue
    const tag = legTag[idx(x, y)]
    if (tag === 2) shade[idx(x, y)] = SHADOW
    else if (tag === 1) shade[idx(x, y)] = BASE
    else if (inHead(x, y)) shade[idx(x, y)] = shadeLevel(sphereBright(x, y, hcx, hcy, hr, hr))
    else if (inBody(x, y)) shade[idx(x, y)] = shadeLevel(sphereBright(x, y, bcx, bcy, brx, bry))
    else shade[idx(x, y)] = BASE
  }
  // Face (matches the walk pose exactly).
  triangle((x, y) => { if (fur[idx(x, y)] && overlay[idx(x, y)] !== O.OUTLINE) put(overlay, x, y, O.INEAR) },
    hcx + 2, hcy - hr + 1.5, hcx + 3.6, hcy - hr + 1.5, hcx + 3.2, hcy - hr - 1)
  if (pose.eye > 0.5) {
    ellipse((x, y) => put(overlay, x, y, O.IRIS), hcx + 1.6, hcy - 0.5, 1.7, 2)
    ellipse((x, y) => put(overlay, x, y, O.PUPIL), hcx + 2, hcy - 0.3, 0.9, 1.4)
    put(overlay, Math.round(hcx + 1.2), Math.round(hcy - 1.3), O.GLINT)
  } else {
    for (const dx of [0, 1, 2]) put(overlay, Math.round(hcx + 1 + dx), Math.round(hcy - 0.3), O.OUTLINE)
  }
  const nfx = hcx + hr - 1, nfy = hcy + 0.8
  if (fur[idx(Math.round(nfx), Math.round(nfy))]) put(overlay, Math.round(nfx), Math.round(nfy), O.NOSE)

  return { shade, region, overlay, geom: {}, fur }
}

// ---- pose library (side view, head on the right; ground ~43) ---------------
const GROUND = 43
export const POSES = {
  stand: {
    body: [18, 30, 11.5, 7.4], head: [32, 24, 7], neck: [27, 28, 6, 5],
    tail: { root: [7, 29], ctrl: [3, 21], tip: [8, 12] }, eye: 1,
    legs: [
      { hip: [14, 33.7], mid: [12, 38], foot: [13, GROUND], near: false }, // hind far
      { hip: [26, 33.7], mid: [26.5, 38], foot: [26, GROUND], near: false }, // front far
      { hip: [16, 33.7], mid: [14, 38], foot: [15, GROUND], near: true }, // hind near
      { hip: [28, 33.7], mid: [28.5, 38], foot: [28, GROUND], near: true } // front near
    ]
  },
  sit: {
    body: [17, 31, 11, 8], head: [33, 21, 7], neck: [27, 26, 6, 5.5],
    tail: { root: [7, 33], ctrl: [7, 42], tip: [22, 42] }, eye: 1,
    legs: [
      { hip: [14, 34], mid: [10, 39], foot: [19, 42], near: false }, // hind folded
      { hip: [27, 33], mid: [27, 38], foot: [27, GROUND], near: false }, // front straight
      { hip: [16, 34], mid: [12, 39], foot: [21, 42], near: true },
      { hip: [29, 33], mid: [29, 38], foot: [29, GROUND], near: true }
    ]
  },
  curl: {
    body: [20, 35, 12.5, 7.5], head: [31, 37, 6], neck: [27, 36, 4.5, 4],
    tail: { root: [8, 36], ctrl: [14, 45], tip: [30, 41] }, eye: 0,
    legs: [
      { hip: [16, 38], mid: [14, 41], foot: [19, 42], near: false },
      { hip: [26, 39], mid: [27, 41], foot: [25, 42], near: false },
      { hip: [18, 38], mid: [16, 41], foot: [21, 42], near: true },
      { hip: [28, 39], mid: [29, 41], foot: [27, 42], near: true }
    ]
  }
}

// ---- preview: rig poses next to our real walk + curl for comparison --------
if (process.argv[1] && process.argv[1].endsWith('rigcat.mjs')) {
  const { writeFileSync } = await import('node:fs')
  const { encodePNG } = await import('./pngEncoder.mjs')
  const { generateWalkGrid, generateCurlGrid } = await import('./catgen.mjs')
  const { PRESETS } = await import('./presets.mjs')
  const ash = PRESETS.find((p) => p.id === 'ash')
  const cells = [
    ['rig sit', render(generateRigGrid(ash, POSES.sit), ash.coat)],
    ['rig stand', render(generateRigGrid(ash, POSES.stand), ash.coat)],
    ['rig curl', render(generateRigGrid(ash, POSES.curl), ash.coat)],
    ['real walk', render(generateWalkGrid(ash, 0.6), ash.coat)],
    ['real curl', render(generateCurlGrid(ash, 0.6), ash.coat)]
  ]
  const S = 8, GAP = 10, BG = [18, 20, 28], cols = cells.length
  const outW = cols * W * S + (cols + 1) * GAP, outH = H * S + 2 * GAP
  const out = new Uint8ClampedArray(outW * outH * 4)
  for (let i = 0; i < outW * outH; i++) { out[i * 4] = BG[0]; out[i * 4 + 1] = BG[1]; out[i * 4 + 2] = BG[2]; out[i * 4 + 3] = 255 }
  cells.forEach(([, rgba], ci) => { const ox = GAP + ci * (W * S + GAP)
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) { if (!rgba[(y * W + x) * 4 + 3]) continue
      for (let sy = 0; sy < S; sy++) for (let sx = 0; sx < S; sx++) { const q = ((GAP + y * S + sy) * outW + (ox + x * S + sx)) * 4
        out[q] = rgba[(y * W + x) * 4]; out[q + 1] = rgba[(y * W + x) * 4 + 1]; out[q + 2] = rgba[(y * W + x) * 4 + 2]; out[q + 3] = 255 } } })
  const path = process.argv[2] || '.rigcat.png'
  writeFileSync(path, encodePNG(outW, outH, out))
  console.log('wrote ' + path)
}
