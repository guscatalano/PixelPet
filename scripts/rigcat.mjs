// Posable side-view cat that renders in OUR cat's exact style (reuses the walk
// pose's head / ears / eye / nose / tail / leg / shading code), so the rig looks
// like our cat. Each pose is a set of joint positions; the app can interpolate
// them for articulated get-up / lie-down transitions.
//
// Preview:  node scripts/rigcat.mjs [out.png]
import { W, H, render, sideMarking } from './catgen.mjs'

// ---- helpers copied from catgen.mjs (module-private there) ------------------
const HI = 1, BASE = 2, SHADOW = 3, DEEP = 4
const O = { NONE: 0, OUTLINE: 1, IRIS: 2, PUPIL: 3, GLINT: 4, NOSE: 5, INEAR: 6, MOUTH: 7, WHISK: 8, CONE: 9, CONE_HI: 10 }
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
// Fit a pose to the pet's build (mirror of rigcat.ts adaptPose).
function adaptPose(p, kbx, kby, kh) {
  if (Math.abs(kbx - 1) < 0.02 && Math.abs(kby - 1) < 0.02 && Math.abs(kh - 1) < 0.02) return p
  const [bcx, bcy, brx, bry] = p.body
  const bottom = bcy + bry
  const nbry = bry * kby
  const dTop = (bottom - 2 * nbry) - (bcy - bry)
  const sx = (x) => bcx + (x - bcx) * kbx
  const sy = (y) => (y >= bottom ? y : bottom - (bottom - y) * kby)
  return {
    ...p,
    body: [bcx, bottom - nbry, brx * kbx, nbry],
    body2: p.body2 ? [sx(p.body2[0]), sy(p.body2[1]), p.body2[2] * kbx, p.body2[3] * kby] : undefined,
    head: [p.head[0], p.head[1] + dTop * 0.85, p.head[2] * kh],
    neck: [p.neck[0], p.neck[1] + dTop * 0.7, p.neck[2] * (kbx + kh) / 2, p.neck[3] * (kby + kh) / 2],
    tail: { root: [sx(p.tail.root[0]), sy(p.tail.root[1])], ctrl: p.tail.ctrl, tip: p.tail.tip },
    tailR: (p.tailR ?? 2.6) * Math.min(1.2, Math.max(0.85, (kbx + kby) / 2)),
    legs: p.legs.map((l) => ({
      ...l,
      hip: [sx(l.hip[0]), sy(l.hip[1])],
      mid: [sx(l.mid[0]), sy(l.mid[1])],
      foot: [sx(l.foot[0]), l.foot[1]]
    }))
  }
}

const RIG_DEFAULT_GEOM = { headRx: 11, bodyRx: 12, bodyRy: 11, earW: 7.5, earH: 8.5, eyeRx: 2.5, earStyle: 'pointy', cheekFluff: 0 }

export function generateRigGrid(pet, pose) {
  const g = { ...RIG_DEFAULT_GEOM, ...(pet.geom || {}) }
  const kbx = g.bodyRx / 12, kby = g.bodyRy / 11, kh = g.headRx / 11
  const eW = kh * (g.earW / 7.5), eH = kh * (g.earH / 8.5)
  const kEye = g.eyeRx / 2.5
  pose = adaptPose(pose, kbx, kby, kh)
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
  if (pose.body2) ellipse(set, pose.body2[0], pose.body2[1], pose.body2[2], pose.body2[3]) // optional 2nd mass (e.g. raised rear in a stretch)
  ellipse(set, pose.neck[0], pose.neck[1], pose.neck[2], pose.neck[3]) // neck
  ellipse(set, hcx, hcy, hr * 1.02, hr * 0.98) // round head (our cat's head)
  if (g.cheekFluff > 0) ellipse(set, hcx - hr * 0.72, hcy + hr * 0.42, g.cheekFluff * 0.45, g.cheekFluff * 0.35)
  const perk = pose.earPerk ?? 0 // 0 = normal; 1 = ears fully perked (taller, more upright)
  const back = pose.earsBack ?? 0
  const earTipL = hcy - hr - (3.4 + perk * 1.2) * eH * (1 - back * 0.6) + back * 2
  const bk = back * 5 * eW
  triangle(set, hcx - 4 * eW, hcy - hr + 2, hcx, hcy - hr + 2, hcx + (-4.5 + perk * 0.8) * eW - bk, earTipL)
  triangle(set, hcx + 1 * eW, hcy - hr + 2, hcx + 5 * eW, hcy - hr + 2, hcx + (4 - perk * 0.8) * eW - bk, earTipL)
  if (g.earStyle === 'tufted') {
    triangle(set, hcx - 5 * eW, earTipL + 1.5, hcx - 3.5 * eW, earTipL + 1.5, hcx - 5 * eW, earTipL - 1.5)
    triangle(set, hcx + 3.3 * eW, earTipL + 1.5, hcx + 4.8 * eW, earTipL + 1.5, hcx + 4.6 * eW, earTipL - 1.5)
  }
  { const p0 = pose.tail.root, p1 = pose.tail.ctrl, p2 = pose.tail.tip
    const tr = pose.tailR ?? 2.6 // base tail radius; crank it up for the scared poof
    for (let t = 0; t <= 1.0001; t += 0.05) { const it = 1 - t
      ellipse(set, it * it * p0[0] + 2 * it * t * p1[0] + t * t * p2[0], it * it * p0[1] + 2 * it * t * p1[1] + t * t * p2[1], tr - t * 1.1, tr - t * 1.1) } }
  pose.legs.filter((l) => l.near).forEach(drawLeg) // near legs on top

  const shade = new Uint8Array(W * H), region = new Uint8Array(W * H), overlay = new Uint8Array(W * H)
  const groundY = Math.max(...pose.legs.map((l) => l.foot[1]))
  sideMarking(region, fur, { hcx, hcy, hr, bcx, bcy, brx, bry, groundY, faceSign: hcx >= bcx ? 1 : -1 }, pet.marking || 'solid')
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    if (fur[idx(x, y)]) continue
    let near = false
    for (let dy = -1; dy <= 1 && !near; dy++) for (let dx = -1; dx <= 1; dx++) if (inB(x + dx, y + dy) && fur[idx(x + dx, y + dy)]) { near = true; break }
    if (near) overlay[idx(x, y)] = O.OUTLINE
  }
  const inHead = (x, y) => ((x - hcx) / (hr + 0.5)) ** 2 + ((y - hcy) / (hr + 0.5)) ** 2 <= 1.05
  const inBody = (x, y) => ((x - bcx) / (brx + 0.5)) ** 2 + ((y - bcy) / (bry + 0.5)) ** 2 <= 1.05
  const b2 = pose.body2
  const inBody2 = (x, y) => b2 && ((x - b2[0]) / (b2[2] + 0.5)) ** 2 + ((y - b2[1]) / (b2[3] + 0.5)) ** 2 <= 1.05
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    if (!fur[idx(x, y)]) continue
    const tag = legTag[idx(x, y)]
    if (tag === 2) shade[idx(x, y)] = SHADOW
    else if (tag === 1) shade[idx(x, y)] = BASE
    else if (inHead(x, y)) shade[idx(x, y)] = shadeLevel(sphereBright(x, y, hcx, hcy, hr, hr))
    else if (inBody(x, y)) shade[idx(x, y)] = shadeLevel(sphereBright(x, y, bcx, bcy, brx, bry))
    else if (inBody2(x, y)) shade[idx(x, y)] = shadeLevel(sphereBright(x, y, b2[0], b2[1], b2[2], b2[3]))
    else shade[idx(x, y)] = BASE
  }
  // Face. pose.headFace turns the head to the viewer while the body stays
  // side-on: 0 profile (default) -> ~0.5 mid-turn blink -> 1 front face.
  const face = pose.headFace ?? 0
  const inear = (ax, bx, tx) =>
    triangle((x, y) => { if (fur[idx(x, y)] && overlay[idx(x, y)] !== O.OUTLINE) put(overlay, x, y, O.INEAR) },
      ax, hcy - hr + 1.5, bx, hcy - hr + 1.5, tx, hcy - hr - 1)
  if (face >= 0.75) {
    inear(hcx + 2 * eW, hcx + 3.6 * eW, hcx + 3.2 * eW)
    inear(hcx - 3.6 * eW, hcx - 2 * eW, hcx - 3.2 * eW)
    for (const s of [-1, 1]) {
      const ex = hcx + s * 2.6 * kh, ey = hcy - 0.4
      if (pose.eye > 0.5) {
        ellipse((x, y) => put(overlay, x, y, O.IRIS), ex, ey, 1.45 * kEye, 1.75 * kEye)
        ellipse((x, y) => put(overlay, x, y, O.PUPIL), ex, ey + 0.2, 0.8 * kEye, 1.2 * kEye)
        put(overlay, Math.round(ex - 0.5), Math.round(ey - 0.9), O.GLINT)
      } else {
        for (const dx of [-1, 0, 1]) put(overlay, Math.round(ex + dx), Math.round(ey), O.OUTLINE)
      }
    }
    triangle((x, y) => { if (fur[idx(x, y)]) put(overlay, x, y, O.NOSE) }, hcx - 1.2 * kh, hcy + 1.6 * kh, hcx + 1.2 * kh, hcy + 1.6 * kh, hcx, hcy + 3 * kh)
  } else if (face >= 0.25) {
    inear(hcx + 2 * eW, hcx + 3.6 * eW, hcx + 3.2 * eW)
    for (const s of [-1, 1]) {
      const ex = hcx + s * 2.6 * kh
      for (const dx of [-1, 0, 1]) put(overlay, Math.round(ex + dx), Math.round(hcy - 0.4), O.OUTLINE)
    }
    put(overlay, Math.round(hcx + 2 * kh), Math.round(hcy + 1.6 * kh), O.NOSE)
  } else {
    inear(hcx + 2 * eW, hcx + 3.6 * eW, hcx + 3.2 * eW)
    if (pose.eye > 0.5) {
      ellipse((x, y) => put(overlay, x, y, O.IRIS), hcx + 1.6 * kh, hcy - 0.5, 1.7 * kEye, 2 * kEye)
      ellipse((x, y) => put(overlay, x, y, O.PUPIL), hcx + 2 * kh, hcy - 0.3, 0.9 * kEye, 1.4 * kEye)
      put(overlay, Math.round(hcx + 1.2 * kh), Math.round(hcy - 1.3), O.GLINT)
    } else {
      for (const dx of [0, 1, 2]) put(overlay, Math.round(hcx + 1 * kh + dx), Math.round(hcy - 0.3), O.OUTLINE)
    }
    const nfx = hcx + hr - 1, nfy = hcy + 0.8
    if (fur[idx(Math.round(nfx), Math.round(nfy))]) put(overlay, Math.round(nfx), Math.round(nfy), O.NOSE)
  }

  if (pose.cone) {
    const ccx = hcx + hr * 0.4, ccy = hcy + 0.5, crx = hr * 1.05, cry = hr * 1.75
    const putc = (x, y, role) => { const rx = Math.round(x), ry = Math.round(y); if (inB(rx, ry)) overlay[idx(rx, ry)] = role }
    const linec = (a, b, role) => { const n = Math.max(1, Math.ceil(Math.hypot(b[0]-a[0], b[1]-a[1]))); for (let i=0;i<=n;i++) putc(a[0]+(b[0]-a[0])*i/n, a[1]+(b[1]-a[1])*i/n, role) }
    linec([hcx - hr*0.9, hcy - hr*0.4], [ccx - crx, ccy - cry*0.65], O.CONE)
    linec([hcx - hr*0.9, hcy + hr*0.65], [ccx - crx, ccy + cry*0.65], O.CONE)
    for (let a=0;a<Math.PI*2;a+=0.035) { const c=Math.cos(a), s=Math.sin(a); putc(ccx+c*(crx+1), ccy+s*(cry+1), O.OUTLINE); putc(ccx+c*crx, ccy+s*cry, c>=0 ? O.CONE_HI : O.CONE) }
  }

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
    body: [17, 31, 11, 8], head: [32, 22.5, 7], neck: [27.5, 28, 5.5, 4.4],
    tail: { root: [7, 33], ctrl: [7, 42], tip: [22, 42] }, eye: 1,
    legs: [
      { hip: [14, 34], mid: [10, 39], foot: [19, 42], near: false }, // hind folded
      { hip: [25, 33], mid: [25, 38], foot: [25, GROUND], near: false }, // front straight
      { hip: [16, 34], mid: [12, 39], foot: [21, 42], near: true },
      { hip: [27, 33], mid: [27, 38], foot: [27, GROUND], near: true }
    ]
  },
  sulk: {
    body: [17, 31.5, 11, 8], head: [32, 24, 6.8], neck: [27.5, 28.8, 5.5, 4.4], eye: 1, earsBack: 1,
    tail: { root: [7, 35], ctrl: [4, 43], tip: [17, 43] },
    legs: [
      { hip: [14, 34], mid: [10, 39], foot: [19, 42], near: false },
      { hip: [25, 33], mid: [25, 38], foot: [25, GROUND], near: false },
      { hip: [16, 34], mid: [12, 39], foot: [21, 42], near: true },
      { hip: [27, 33], mid: [27, 38], foot: [27, GROUND], near: true }
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
  },
  curlLoose: {
    body: [19, 35, 13, 7], head: [32.5, 34, 6], neck: [28, 35, 5, 4.2],
    tail: { root: [7, 37], ctrl: [10, 44], tip: [24, 40] }, eye: 0,
    legs: [
      { hip: [15, 38], mid: [13, 41], foot: [17, 42], near: false },
      { hip: [27, 38.5], mid: [30, 41], foot: [33, 42], near: false },
      { hip: [17, 38], mid: [15, 41], foot: [19, 42], near: true },
      { hip: [29, 38.5], mid: [32, 41], foot: [35, 42], near: true }
    ]
  },
  curlTight: {
    body: [21, 36, 12, 6.8], head: [29, 38.5, 5.6], neck: [25.5, 37.5, 4.2, 3.6],
    tail: { root: [9, 35], ctrl: [17, 45], tip: [31, 38] }, eye: 0,
    legs: [
      { hip: [17, 39], mid: [15, 41.5], foot: [20, 42], near: false },
      { hip: [25, 39.5], mid: [26, 41.5], foot: [24, 42], near: false },
      { hip: [19, 39], mid: [17, 41.5], foot: [22, 42], near: true },
      { hip: [27, 39.5], mid: [28, 41.5], foot: [26, 42], near: true }
    ]
  },
  // The bread loaf: a smooth rounded mound with all four paws tucked underneath
  // (the legs are posed fully inside the body silhouette, so they vanish). The
  // head sits LOW with the chin resting on the mound — proper brioche, not a
  // craned neck — tail wrapped along the base.
  loaf: {
    body: [21, 35.5, 13.5, 7.2], head: [32, 27, 7], neck: [29, 31.5, 6.5, 5.5],
    tail: { root: [8, 38], ctrl: [9, 44], tip: [26, 42.5] }, eye: 1,
    legs: [
      { hip: [15, 37], mid: [13, 40], foot: [16, 41], near: false }, // all tucked under —
      { hip: [28, 37], mid: [28, 40], foot: [27, 41], near: false }, // inside the mound
      { hip: [17, 37], mid: [15, 40], foot: [18, 41], near: true },
      { hip: [30, 37], mid: [30, 40], foot: [29, 41], near: true }
    ]
  },
  // The settled loaf: same bread, head sunk low toward the chest (dozy).
  loafLow: {
    body: [21, 35.5, 13.5, 7.2], head: [32.5, 30.5, 7], neck: [29.5, 34, 6.5, 5],
    tail: { root: [8, 38], ctrl: [9, 44], tip: [26, 42.5] }, eye: 1,
    legs: [
      { hip: [15, 37], mid: [13, 40], foot: [16, 41], near: false },
      { hip: [28, 37], mid: [28, 40], foot: [27, 41], near: false },
      { hip: [17, 37], mid: [15, 40], foot: [18, 41], near: true },
      { hip: [30, 37], mid: [30, 40], foot: [29, 41], near: true }
    ]
  },
  // The sphinx: belly down like a loaf, front legs stretched forward, head up.
  sphinx: {
    body: [20, 36, 13, 7], head: [32, 26.5, 7], neck: [29, 31.5, 6.5, 5.5],
    tail: { root: [8, 38], ctrl: [9, 44], tip: [25, 42.5] }, eye: 1,
    legs: [
      { hip: [15, 38], mid: [13, 40], foot: [16, 41], near: false },
      { hip: [27, 38.5], mid: [32, 40.8], foot: [36.5, 41.8], near: false },
      { hip: [17, 38], mid: [15, 40], foot: [18, 41], near: true },
      { hip: [29, 38.5], mid: [34, 40.8], foot: [38.5, 41.8], near: true }
    ]
  },
  // Washing up: sitting, one front paw raised to the mouth, head dipped toward
  // it, eyes squeezed in concentration. Lerp groom <-> groomLick for the licks.
  groom: {
    body: [17, 31, 11, 8], head: [31, 24, 7], neck: [26, 28, 6, 5.5],
    tail: { root: [7, 33], ctrl: [7, 42], tip: [22, 42] }, eye: 0,
    legs: [
      { hip: [14, 34], mid: [10, 39], foot: [19, 42], near: false },
      { hip: [25, 33], mid: [25, 38], foot: [25, GROUND], near: false }, // far paw planted
      { hip: [16, 34], mid: [12, 39], foot: [21, 42], near: true },
      { hip: [29, 33], mid: [32.5, 30.5], foot: [31.5, 28.5], near: true } // near paw up at the mouth
    ]
  },
  groomLick: {
    body: [17, 31, 11, 8], head: [31, 25.2, 7], neck: [26, 28.5, 6, 5.5],
    tail: { root: [7, 33], ctrl: [7, 42], tip: [23, 41.5] }, eye: 0,
    legs: [
      { hip: [14, 34], mid: [10, 39], foot: [19, 42], near: false },
      { hip: [25, 33], mid: [25, 38], foot: [25, GROUND], near: false },
      { hip: [16, 34], mid: [12, 39], foot: [21, 42], near: true },
      { hip: [29, 33], mid: [32.5, 31], foot: [31.5, 29.2], near: true } // paw meets the dip
    ]
  },
  // Pre-pounce crouch: body flat and low, head locked forward, tail low.
  // Lerp crouch <-> crouchWiggle for the butt-wiggle.
  crouch: {
    body: [19, 35, 11.5, 5.8], head: [32, 30, 7], neck: [27, 32, 5.5, 4.5],
    tail: { root: [8, 34], ctrl: [3, 30], tip: [4, 22] }, eye: 1,
    legs: [
      { hip: [15, 37], mid: [11, 40], foot: [15, GROUND], near: false },
      { hip: [27, 37], mid: [27, 40], foot: [27, GROUND], near: false },
      { hip: [17, 37], mid: [13, 40], foot: [17, GROUND], near: true },
      { hip: [29, 37], mid: [29, 40], foot: [29, GROUND], near: true }
    ]
  },
  crouchWiggle: {
    body: [19, 34, 11.5, 6.2], head: [32, 30.2, 7], neck: [27, 32, 5.5, 4.5],
    tail: { root: [8, 33], ctrl: [3, 28], tip: [6, 20] }, eye: 1,
    legs: [
      { hip: [15, 36], mid: [11, 40], foot: [15, GROUND], near: false },
      { hip: [27, 37], mid: [27, 40], foot: [27, GROUND], near: false },
      { hip: [17, 36], mid: [13, 40], foot: [17, GROUND], near: true },
      { hip: [29, 37], mid: [29, 40], foot: [29, GROUND], near: true }
    ]
  },
  // Airborne mid-pounce: body extended, front paws reaching, hind legs trailing.
  pounce: {
    body: [22, 30, 11, 6], head: [35, 25, 7], neck: [29, 28, 5.5, 5],
    tail: { root: [11, 29], ctrl: [5, 26], tip: [2, 18] }, eye: 1,
    legs: [
      { hip: [13, 32], mid: [9, 36], foot: [6, 39], near: false },  // hind trailing
      { hip: [30, 32], mid: [35, 34], foot: [39, 37], near: false }, // front reaching
      { hip: [15, 32], mid: [11, 36], foot: [8, 39], near: true },
      { hip: [32, 32], mid: [37, 34], foot: [41, 37], near: true }
    ]
  },
  // Landing: compressed onto bent front legs.
  land: {
    body: [22, 34.5, 10.5, 6], head: [34, 29.5, 7], neck: [29, 32, 5.5, 4.5],
    tail: { root: [10, 32], ctrl: [4, 28], tip: [5, 20] }, eye: 1,
    legs: [
      { hip: [16, 36], mid: [12, 40], foot: [14, GROUND], near: false },
      { hip: [29, 36], mid: [31, 40], foot: [32, GROUND], near: false },
      { hip: [18, 36], mid: [14, 40], foot: [16, GROUND], near: true },
      { hip: [31, 36], mid: [33, 40], foot: [34, GROUND], near: true }
    ]
  },
  // The Halloween-cat scare: up on straight legs, back arched (body2 bump),
  // head dipped, and the tail POOFED (tailR way up) in a fat upright curve.
  poof: {
    body: [21, 30, 11, 6.5], body2: [20, 27.5, 7, 5], head: [33, 25, 7], neck: [28, 27.5, 5.5, 5],
    tail: { root: [10, 28], ctrl: [4, 18], tip: [12, 9] }, tailR: 4.4, eye: 1,
    legs: [
      { hip: [14, 33], mid: [13.5, 38], foot: [14, GROUND], near: false }, // straight, on tiptoe
      { hip: [25, 33], mid: [25, 38], foot: [25, GROUND], near: false },
      { hip: [16, 33], mid: [15.5, 38], foot: [16, GROUND], near: true },
      { hip: [27, 33], mid: [27, 38], foot: [27, GROUND], near: true }
    ]
  },
  // Teetering at a ledge edge (the edge is to the RIGHT): weight rocked back on
  // crouched hind legs, one front paw braced, the other raised over the void,
  // head craned forward-down, tail high as a counterbalance. Lerp teeter <->
  // teeterFwd for the wobble.
  teeter: {
    body: [18, 32, 11, 7], head: [32, 26, 7], neck: [27, 29, 5.5, 5],
    tail: { root: [8, 30], ctrl: [2, 21], tip: [8, 12] }, eye: 1,
    legs: [
      { hip: [14, 35], mid: [11, 39], foot: [14, GROUND], near: false }, // hind crouched
      { hip: [26, 35], mid: [28, 39], foot: [29, GROUND], near: false }, // front braced
      { hip: [16, 35], mid: [13, 39], foot: [16, GROUND], near: true },
      { hip: [28, 34], mid: [32, 36], foot: [35, 39], near: true }       // paw raised over the edge
    ]
  },
  teeterFwd: {
    body: [19.5, 32.5, 11, 7], head: [34, 28, 7], neck: [28.5, 30.5, 5.5, 5],
    tail: { root: [9, 30], ctrl: [4, 20], tip: [11, 11] }, eye: 1,
    legs: [
      { hip: [15.5, 35.5], mid: [12.5, 39.5], foot: [14, GROUND], near: false },
      { hip: [27.5, 35.5], mid: [29.5, 39.5], foot: [29, GROUND], near: false },
      { hip: [17.5, 35.5], mid: [14.5, 39.5], foot: [16, GROUND], near: true },
      { hip: [29.5, 34.5], mid: [34, 37], foot: [37.5, 40.5], near: true }   // reaching further out
    ]
  },
  // The classic wake-up stretch: chest low, butt up, front legs extended flat
  // forward, tail high. Eyes closed (cats squeeze them shut mid-stretch).
  stretch: {
    body: [25, 35, 8, 5.5], body2: [13, 28, 8.5, 7.5], head: [35, 30, 7], neck: [30, 32, 5.5, 4.5],
    tail: { root: [7, 27], ctrl: [3, 18], tip: [8, 11] }, eye: 0,
    legs: [
      { hip: [12, 32], mid: [11, 38], foot: [12, GROUND], near: false }, // hind far (under the raised rear)
      { hip: [29, 37], mid: [34, 41], foot: [39, GROUND], near: false }, // front far, stretched forward
      { hip: [15, 32], mid: [14, 38], foot: [15, GROUND], near: true },  // hind near
      { hip: [31, 37], mid: [36, 41], foot: [41, GROUND], near: true }   // front near, stretched forward
    ]
  },
  sick: {
    body: [20, 37.5, 13, 5.5], head: [32, 31, 6.5], neck: [29, 34.5, 6, 5],
    tail: { root: [8, 39.5], ctrl: [9, 44], tip: [23, 43] }, eye: 1, cone: true,
    legs: [
      { hip: [15, 39], mid: [13, 41], foot: [16, 42], near: false },
      { hip: [27, 39], mid: [30, 41], foot: [33, 42], near: false },
      { hip: [17, 39], mid: [15, 41], foot: [18, 42], near: true },
      { hip: [29, 39], mid: [32, 41], foot: [35, 42], near: true }
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
