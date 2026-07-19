// The posable side-view cat rig (TypeScript port for the app).
//
// Mirrors scripts/rigcat.mjs (the prototype/tooling copy) — keep the two in
// sync. Renders in our cat's exact style (same head / ears / eye / nose /
// tail / leg treatment and shading as the walk pose), parameterized by a pose:
// a set of joint positions. Poses share one joint structure, so transitions
// interpolate the joints (lerpPose) — the cat physically gets up, sits down,
// lies down, loafs, teeters, pounces.

import { W, H, internals, sideMarking, type Pet, type Parts, defaultGeom } from './catgen'

const { ellipse, triangle, idx, inB, put, sphereBright, shadeLevel, O, BASE, SHADOW } = internals

export interface RigLeg { hip: number[]; mid: number[]; foot: number[]; near: boolean }
export interface RigPose {
  /** [cx, cy, rx, ry] main torso mass. */
  body: number[]
  /** Optional second torso mass (e.g. the stretch's raised rear, the poof's arch). */
  body2?: number[]
  /** [cx, cy, r] head. */
  head: number[]
  /** [cx, cy, rx, ry] neck filler. */
  neck: number[]
  tail: { root: number[]; ctrl: number[]; tip: number[] }
  /** Base tail radius (2.6 normal; ~4.4 = scared poof). */
  tailR?: number
  /** 0 = ears normal, 1 = fully perked (taller, more upright). */
  earPerk?: number
  /** 0 = ears normal, 1 = flattened down and back (grumpy/sulky). */
  earsBack?: number
  /**
   * Where the head faces: 0 = side profile (default), ~0.5 = mid-turn (eyes
   * closed — the blink masks the profile->front pop), 1 = facing the viewer
   * (both eyes + centred nose) while the body stays side-on.
   */
  headFace?: number
  /** Draw an Elizabethan collar (cone of shame) around the head — the sick look. */
  cone?: boolean
  /** 1 = open, 0 = closed. */
  eye: number
  /** [hindFar, frontFar, hindNear, frontNear] — index order matters for lerp! */
  legs: RigLeg[]
}

function seg(cb: (x: number, y: number) => void, x0: number, y0: number, x1: number, y1: number, r0: number, r1: number): void {
  const n = 8
  for (let i = 0; i <= n; i++) {
    const k = i / n
    ellipse(cb, x0 + (x1 - x0) * k, y0 + (y1 - y0) * k, r0 + (r1 - r0) * k, r0 + (r1 - r0) * k)
  }
}

/**
 * Fit a pose to the pet's build: body width/height scale about the GROUND
 * anchor (feet stay planted, the mass changes), the head rides the new body
 * top and scales with the pet's head size, hips/mids follow the body while
 * anything at or below the old body bottom (paws) stays put.
 */
function adaptPose(p: RigPose, kbx: number, kby: number, kh: number): RigPose {
  if (Math.abs(kbx - 1) < 0.02 && Math.abs(kby - 1) < 0.02 && Math.abs(kh - 1) < 0.02) return p
  const [bcx, bcy, brx, bry] = p.body
  const bottom = bcy + bry
  const nbry = bry * kby
  const dTop = (bottom - 2 * nbry) - (bcy - bry) // how far the body's top moved
  const sx = (x: number): number => bcx + (x - bcx) * kbx
  const sy = (y: number): number => (y >= bottom ? y : bottom - (bottom - y) * kby)
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
      foot: [sx(l.foot[0]), l.foot[1]] // stance widens with the build; feet stay grounded
    }))
  }
}

export function generateRigGrid(pet: Pet, pose: RigPose): Parts {
  const g = { ...defaultGeom(), ...(pet.geom || {}) }
  const kbx = g.bodyRx / 12, kby = g.bodyRy / 11, kh = g.headRx / 11
  const eW = kh * (g.earW / 7.5), eH = kh * (g.earH / 8.5)
  pose = adaptPose(pose, kbx, kby, kh)
  const fur = new Uint8Array(W * H), legTag = new Uint8Array(W * H)
  const set = (x: number, y: number): void => { if (inB(x, y)) fur[idx(x, y)] = 1 }
  const [bcx, bcy, brx, bry] = pose.body
  const [hcx, hcy, hr] = pose.head

  const drawLeg = (lg: RigLeg): void => {
    const tag = lg.near ? 1 : 2
    const paint = (x: number, y: number): void => { set(x, y); if (inB(x, y)) legTag[idx(x, y)] = tag }
    seg(paint, lg.hip[0], lg.hip[1], lg.mid[0], lg.mid[1], 2.2, 1.5) // upper (thigh / upper-arm)
    seg(paint, lg.mid[0], lg.mid[1], lg.foot[0], lg.foot[1], 1.5, 1.0) // lower (shank)
    ellipse(paint, lg.foot[0], lg.foot[1] + 0.2, 1.8, 1.2) // paw
  }
  pose.legs.filter((l) => !l.near).forEach(drawLeg) // far legs behind

  ellipse(set, bcx, bcy, brx, bry) // body
  if (pose.body2) ellipse(set, pose.body2[0], pose.body2[1], pose.body2[2], pose.body2[3])
  ellipse(set, pose.neck[0], pose.neck[1], pose.neck[2], pose.neck[3]) // neck
  ellipse(set, hcx, hcy, hr * 1.02, hr * 0.98) // round head
  const faceSign = hcx >= bcx ? 1 : -1 // which way the head faces
  if (g.snout > 0) { // dog-style muzzle projecting forward from the head
    ellipse(set, hcx + faceSign * hr * 0.82, hcy + hr * 0.3, g.snout, g.snout * 0.62)
  }
  if (g.cheekFluff > 0) { // fluffy pets get a jowl tuft at the back of the head
    ellipse(set, hcx - hr * 0.72, hcy + hr * 0.42, g.cheekFluff * 0.45, g.cheekFluff * 0.35)
  }
  const perk = pose.earPerk ?? 0
  // earsBack (0..1) flattens the ears down and back — the grumpy/sulky signal.
  const back = pose.earsBack ?? 0
  if (g.earStyle === 'floppy') {
    // Dog-style ears: soft flaps hanging down the sides of the head.
    for (const s of [-1, 1]) {
      seg(set, hcx + s * hr * 0.5, hcy - hr + 3, hcx + s * hr * 0.95, hcy + hr * (0.3 - back * 0.15), 2.4 * eW, 1.5 * eW)
    }
  } else {
    // Cat-style ears: two upright triangles. A perked ear rises only modestly.
    const earTipL = hcy - hr - (3.4 + perk * 1.2) * eH * (1 - back * 0.6) + back * 2
    const bk = back * 5 * eW
    triangle(set, hcx - 4 * eW, hcy - hr + 2, hcx, hcy - hr + 2, hcx + (-4.5 + perk * 0.8) * eW - bk, earTipL)
    triangle(set, hcx + 1 * eW, hcy - hr + 2, hcx + 5 * eW, hcy - hr + 2, hcx + (4 - perk * 0.8) * eW - bk, earTipL)
    if (g.earStyle === 'tufted') { // short lynx tufts at the ear tips
      triangle(set, hcx - 5 * eW, earTipL + 1.5, hcx - 3.5 * eW, earTipL + 1.5, hcx - 5 * eW, earTipL - 1.5)
      triangle(set, hcx + 3.3 * eW, earTipL + 1.5, hcx + 4.8 * eW, earTipL + 1.5, hcx + 4.6 * eW, earTipL - 1.5)
    }
  }
  {
    const p0 = pose.tail.root, p1 = pose.tail.ctrl, p2 = pose.tail.tip
    const ts = g.tailStyle // default | bushy | thin | nub
    const base = (pose.tailR ?? 2.6) * (ts === 'bushy' ? 1.8 : ts === 'thin' ? 0.6 : 1)
    const taper = ts === 'bushy' ? 0.5 : 1.1
    const tEnd = ts === 'nub' ? 0.34 : 1.0001 // a nub is just the stubby base
    for (let t = 0; t <= tEnd; t += 0.05) {
      const it = 1 - t
      const r = ts === 'nub' ? base * (1 - t * 0.4) : base - t * taper
      ellipse(set, it * it * p0[0] + 2 * it * t * p1[0] + t * t * p2[0], it * it * p0[1] + 2 * it * t * p1[1] + t * t * p2[1], r, r)
    }
  }
  pose.legs.filter((l) => l.near).forEach(drawLeg) // near legs on top

  const shade = new Uint8Array(W * H), region = new Uint8Array(W * H), overlay = new Uint8Array(W * H)
  const groundY = Math.max(...pose.legs.map((l) => l.foot[1]))
  sideMarking(region, fur, { hcx, hcy, hr, bcx, bcy, brx, bry, groundY, faceSign: hcx >= bcx ? 1 : -1 }, pet.marking || 'solid')
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) {
      if (fur[idx(x, y)]) continue
      let near = false
      for (let dy = -1; dy <= 1 && !near; dy++)
        for (let dx = -1; dx <= 1; dx++)
          if (inB(x + dx, y + dy) && fur[idx(x + dx, y + dy)]) { near = true; break }
      if (near) overlay[idx(x, y)] = O.OUTLINE
    }
  const inHead = (x: number, y: number): boolean => ((x - hcx) / (hr + 0.5)) ** 2 + ((y - hcy) / (hr + 0.5)) ** 2 <= 1.05
  const inBody = (x: number, y: number): boolean => ((x - bcx) / (brx + 0.5)) ** 2 + ((y - bcy) / (bry + 0.5)) ** 2 <= 1.05
  const b2 = pose.body2
  const inBody2 = (x: number, y: number): boolean => !!b2 && ((x - b2[0]) / (b2[2] + 0.5)) ** 2 + ((y - b2[1]) / (b2[3] + 0.5)) ** 2 <= 1.05
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) {
      if (!fur[idx(x, y)]) continue
      const tag = legTag[idx(x, y)]
      if (tag === 2) shade[idx(x, y)] = SHADOW
      else if (tag === 1) shade[idx(x, y)] = BASE
      else if (inHead(x, y)) shade[idx(x, y)] = shadeLevel(sphereBright(x, y, hcx, hcy, hr, hr))
      else if (inBody(x, y)) shade[idx(x, y)] = shadeLevel(sphereBright(x, y, bcx, bcy, brx, bry))
      else if (inBody2(x, y)) shade[idx(x, y)] = shadeLevel(sphereBright(x, y, b2![0], b2![1], b2![2], b2![3]))
      else shade[idx(x, y)] = BASE
    }
  // Face (offsets scale with the head, eye sizes with the pet's eyes).
  // headFace turns the head to the viewer while the body stays side-on:
  // profile (default) -> mid-turn blink (masks the pop) -> front face.
  const face = pose.headFace ?? 0
  const kEye = g.eyeRx / 2.5
  const inear = (ax: number, bx: number, tx: number): void =>
    triangle((x, y) => { if (fur[idx(x, y)] && overlay[idx(x, y)] !== O.OUTLINE) put(overlay, x, y, O.INEAR) },
      ax, hcy - hr + 1.5, bx, hcy - hr + 1.5, tx, hcy - hr - 1)
  if (face >= 0.75) {
    // Facing you: both eyes, centred pink nose, pink in both ears.
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
    // Mid-turn: eyes shut (the blink hides the eye-count change), nose sliding in.
    inear(hcx + 2 * eW, hcx + 3.6 * eW, hcx + 3.2 * eW)
    for (const s of [-1, 1]) {
      const ex = hcx + s * 2.6 * kh
      for (const dx of [-1, 0, 1]) put(overlay, Math.round(ex + dx), Math.round(hcy - 0.4), O.OUTLINE)
    }
    put(overlay, Math.round(hcx + 2 * kh), Math.round(hcy + 1.6 * kh), O.NOSE)
  } else {
    // Side profile (matches the walk pose exactly).
    inear(hcx + 2 * eW, hcx + 3.6 * eW, hcx + 3.2 * eW)
    if (pose.eye > 0.5) {
      ellipse((x, y) => put(overlay, x, y, O.IRIS), hcx + 1.6 * kh, hcy - 0.5, 1.7 * kEye, 2 * kEye)
      ellipse((x, y) => put(overlay, x, y, O.PUPIL), hcx + 2 * kh, hcy - 0.3, 0.9 * kEye, 1.4 * kEye)
      put(overlay, Math.round(hcx + 1.2 * kh), Math.round(hcy - 1.3), O.GLINT)
    } else {
      for (const dx of [0, 1, 2]) put(overlay, Math.round(hcx + 1 * kh + dx), Math.round(hcy - 0.3), O.OUTLINE)
    }
    if (g.snout > 0) { // dog nose sits on the tip of the muzzle
      const nfx = hcx + faceSign * (hr * 0.82 + g.snout * 0.85), nfy = hcy + hr * 0.32
      ellipse((x, y) => { if (fur[idx(x, y)]) put(overlay, x, y, O.NOSE) }, nfx, nfy, 1.3, 1.1)
    } else {
      const nfx = hcx + hr - 1, nfy = hcy + 0.8
      if (fur[idx(Math.round(nfx), Math.round(nfy))]) put(overlay, Math.round(nfx), Math.round(nfy), O.NOSE)
    }
  }

  // Cone of shame: a translucent funnel opening toward the viewer — two edges
  // flaring from behind the head to an oval rim in front of the face (drawn as
  // an outline so the face shows through, like clear plastic).
  if (pose.cone) {
    // A big oval opening that encircles the head (the cat looks out through it),
    // with two funnel edges running back to the neck. Drawn with a dark outer
    // edge + light rim so it reads on any coat.
    const ccx = hcx + hr * 0.4, ccy = hcy + 0.5, crx = hr * 1.05, cry = hr * 1.75
    const putc = (x: number, y: number, role: number): void => { const rx = Math.round(x), ry = Math.round(y); if (inB(rx, ry)) overlay[idx(rx, ry)] = role }
    const linec = (a: number[], b: number[], role: number): void => {
      const n = Math.max(1, Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1])))
      for (let i = 0; i <= n; i++) putc(a[0] + (b[0] - a[0]) * i / n, a[1] + (b[1] - a[1]) * i / n, role)
    }
    linec([hcx - hr * 0.9, hcy - hr * 0.4], [ccx - crx, ccy - cry * 0.65], O.CONE)
    linec([hcx - hr * 0.9, hcy + hr * 0.65], [ccx - crx, ccy + cry * 0.65], O.CONE)
    for (let a = 0; a < Math.PI * 2; a += 0.035) {
      const c = Math.cos(a), s = Math.sin(a)
      putc(ccx + c * (crx + 1), ccy + s * (cry + 1), O.OUTLINE) // dark outer lip
      putc(ccx + c * crx, ccy + s * cry, c >= 0 ? O.CONE_HI : O.CONE) // bright rim
    }
  }

  return { shade, region, overlay, geom: defaultGeom(), fur }
}

// ---- interpolation ----------------------------------------------------------
const lerp = (a: number, b: number, k: number): number => a + (b - a) * k
const lerpA = (a: number[], b: number[], k: number): number[] => a.map((v, i) => lerp(v, b[i], k))
const lerpLeg = (a: RigLeg, b: RigLeg, k: number): RigLeg =>
  ({ hip: lerpA(a.hip, b.hip, k), mid: lerpA(a.mid, b.mid, k), foot: lerpA(a.foot, b.foot, k), near: a.near })

/** Interpolate two poses (k 0..1). Legs lerp BY INDEX — keep pose leg order aligned. */
export function lerpPose(A: RigPose, B: RigPose, k: number): RigPose {
  return {
    body: lerpA(A.body, B.body, k),
    // A body2 grows out of / melts into the main body when only one side has it.
    body2: (A.body2 || B.body2) ? lerpA(A.body2 || A.body, B.body2 || B.body, k) : undefined,
    head: lerpA(A.head, B.head, k),
    neck: lerpA(A.neck, B.neck, k),
    tail: { root: lerpA(A.tail.root, B.tail.root, k), ctrl: lerpA(A.tail.ctrl, B.tail.ctrl, k), tip: lerpA(A.tail.tip, B.tail.tip, k) },
    tailR: lerp(A.tailR ?? 2.6, B.tailR ?? 2.6, k),
    earPerk: lerp(A.earPerk ?? 0, B.earPerk ?? 0, k),
    earsBack: lerp(A.earsBack ?? 0, B.earsBack ?? 0, k),
    headFace: lerp(A.headFace ?? 0, B.headFace ?? 0, k),
    cone: k >= 0.5 ? B.cone : A.cone, // the cone appears/vanishes at the midpoint of a transition
    eye: lerp(A.eye, B.eye, k),
    legs: A.legs.map((l, i) => lerpLeg(l, B.legs[i], k))
  }
}

// ---- pose library (side view, head on the right; ground ~43) ----------------
const GROUND = 43

export const POSES: Record<string, RigPose> = {
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
      { hip: [25, 33], mid: [25, 38], foot: [25, GROUND], near: false }, // front straight (tucked back under the chest)
      { hip: [16, 34], mid: [12, 39], foot: [21, 42], near: true },
      { hip: [27, 33], mid: [27, 38], foot: [27, GROUND], near: true }
    ]
  },
  // Sulking: sitting hunched with ears flattened back and the tail drooped low
  // along the ground — the "leave me alone" mood when it's bored/neglected.
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
  // A looser curl: not tucked into a tight ball — the head rests higher and
  // forward, the body a touch longer, tail draped rather than wrapped tight.
  curlLoose: {
    body: [19, 35, 13, 7], head: [32.5, 34, 6], neck: [28, 35, 5, 4.2],
    tail: { root: [7, 37], ctrl: [10, 44], tip: [24, 40] }, eye: 0,
    legs: [
      { hip: [15, 38], mid: [13, 41], foot: [17, 42], near: false },
      { hip: [27, 38.5], mid: [30, 41], foot: [33, 42], near: false }, // front paw stretched out
      { hip: [17, 38], mid: [15, 41], foot: [19, 42], near: true },
      { hip: [29, 38.5], mid: [32, 41], foot: [35, 42], near: true }
    ]
  },
  // Nose-to-tail donut: a very tight ball, head tucked right down into the side.
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
  // head sits LOW with the chin resting on the mound, tail wrapped along the base.
  loaf: {
    body: [21, 35.5, 13.5, 7.2], head: [32, 27, 7], neck: [29, 31.5, 6.5, 5.5],
    tail: { root: [8, 38], ctrl: [9, 44], tip: [26, 42.5] }, eye: 1,
    legs: [
      { hip: [15, 37], mid: [13, 40], foot: [16, 41], near: false },
      { hip: [28, 37], mid: [28, 40], foot: [27, 41], near: false },
      { hip: [17, 37], mid: [15, 40], foot: [18, 41], near: true },
      { hip: [30, 37], mid: [30, 40], foot: [29, 41], near: true }
    ]
  },
  // The settled loaf: same bread, but the head has sunk low toward the chest —
  // deeply relaxed, on the way to a doze. The loaf node lerps loaf -> loafLow
  // after the cat has loafed for a while.
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
  // The sphinx: belly down like a loaf, but the front legs stretch forward
  // along the ground (paws poking out ahead of the chest), head upright.
  sphinx: {
    body: [20, 36, 13, 7], head: [32, 26.5, 7], neck: [29, 31.5, 6.5, 5.5],
    tail: { root: [8, 38], ctrl: [9, 44], tip: [25, 42.5] }, eye: 1,
    legs: [
      { hip: [15, 38], mid: [13, 40], foot: [16, 41], near: false },       // hind tucked in the mound
      { hip: [27, 38.5], mid: [32, 40.8], foot: [36.5, 41.8], near: false }, // foreleg stretched forward
      { hip: [17, 38], mid: [15, 40], foot: [18, 41], near: true },
      { hip: [29, 38.5], mid: [34, 40.8], foot: [38.5, 41.8], near: true }   // foreleg stretched forward
    ]
  },
  // Washing up: sitting, one front paw raised to the mouth, head dipped toward
  // it, eyes squeezed in concentration. Lerp groom <-> groomLick for the licks.
  groom: {
    body: [17, 31, 11, 8], head: [31, 24, 7], neck: [26, 28, 6, 5.5],
    tail: { root: [7, 33], ctrl: [7, 42], tip: [22, 42] }, eye: 0,
    legs: [
      { hip: [14, 34], mid: [10, 39], foot: [19, 42], near: false },
      { hip: [27, 33], mid: [27, 38], foot: [27, GROUND], near: false }, // far paw planted
      { hip: [16, 34], mid: [12, 39], foot: [21, 42], near: true },
      { hip: [29, 33], mid: [32.5, 30.5], foot: [31.5, 28.5], near: true } // near paw up at the mouth
    ]
  },
  groomLick: {
    body: [17, 31, 11, 8], head: [31, 25.2, 7], neck: [26, 28.5, 6, 5.5],
    tail: { root: [7, 33], ctrl: [7, 42], tip: [23, 41.5] }, eye: 0,
    legs: [
      { hip: [14, 34], mid: [10, 39], foot: [19, 42], near: false },
      { hip: [27, 33], mid: [27, 38], foot: [27, GROUND], near: false },
      { hip: [16, 34], mid: [12, 39], foot: [21, 42], near: true },
      { hip: [29, 33], mid: [32.5, 31], foot: [31.5, 29.2], near: true } // paw meets the dip
    ]
  },
  // Pre-pounce crouch; lerp crouch <-> crouchWiggle for the butt-wiggle.
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
      { hip: [27, 33], mid: [27, 38], foot: [27, GROUND], near: false },
      { hip: [16, 33], mid: [15.5, 38], foot: [16, GROUND], near: true },
      { hip: [29, 33], mid: [29, 38], foot: [29, GROUND], near: true }
    ]
  },
  // Teetering at a ledge edge (the edge is to the RIGHT): weight rocked back on
  // crouched hind legs, one front paw braced, the other raised over the void,
  // head craned forward-down, tail high as a counterbalance.
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
  // The classic wake-up stretch: chest low, butt up (body2), front legs
  // extended flat forward, tail high, eyes squeezed shut.
  stretch: {
    body: [25, 35, 8, 5.5], body2: [13, 28, 8.5, 7.5], head: [35, 30, 7], neck: [30, 32, 5.5, 4.5],
    tail: { root: [7, 27], ctrl: [3, 18], tip: [8, 11] }, eye: 0,
    legs: [
      { hip: [12, 32], mid: [11, 38], foot: [12, GROUND], near: false },
      { hip: [29, 37], mid: [34, 41], foot: [39, GROUND], near: false },
      { hip: [15, 32], mid: [14, 38], foot: [15, GROUND], near: true },
      { hip: [31, 37], mid: [36, 41], foot: [41, GROUND], near: true }
    ]
  },
  // Under the weather: a flat, low, lethargic lie with the cone of shame — the
  // head rests forward and the front paws splay out limply.
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
