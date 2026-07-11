// Parametric pixel-cat generator.
//
// Pure JS (no Node/DOM APIs) so it runs both in Node (preview PNGs) and the browser
// (inlined into the gallery artifact). Produces an RGBA buffer for a cat from a
// preset (geometry + coat) and an animation state (blink / tail / ear phase).
//
// Architecture (keeps markings properly shaded):
//   - shade grid:  per fur pixel, a light level (HI / BASE / SHADOW / DEEP)
//   - region grid: per fur pixel, which coat area it belongs to (primary / mark /
//                  white / tertiary) — set by the marking pattern
//   - overlay grid: outline + face features drawn on top (eyes, nose, ears, ...)
//   Final color = overlay ? featureColor : ramp[region][shade].
//
// Silhouette is rasterized from simple shapes, then auto-outlined (dilate by 1px),
// then shaded by treating head & body as spheres lit from the top-left.

export const W = 44
export const H = 44

// Shade levels (1..4); 0 = not fur.
const HI = 1, BASE = 2, SHADOW = 3, DEEP = 4
// Coat regions.
const P = 0, S = 1, WHITE = 2, T = 3
// Overlay roles (0 = none).
const O = {
  NONE: 0, OUTLINE: 1, IRIS: 2, PUPIL: 3, GLINT: 4, NOSE: 5, INEAR: 6, MOUTH: 7, WHISK: 8
}

const LIGHT = (() => {
  const v = [-0.35, -0.5, 0.79]
  const m = Math.hypot(v[0], v[1], v[2])
  return [v[0] / m, v[1] / m, v[2] / m]
})()

// ---- geometry --------------------------------------------------------------
export function defaultGeom() {
  return {
    headCx: 22, headCy: 16, headRx: 11, headRy: 10,
    bodyCx: 22, bodyCy: 33, bodyRx: 12, bodyRy: 11,
    earW: 7.5, earH: 8.5, earSpread: 7.5, earLean: 1.5, earStyle: 'pointy',
    eyeDX: 5.2, eyeY: 17, eyeRx: 2.5, eyeRy: 3.0, eyeStyle: 'round',
    noseY: 22,
    hasTail: true, tailSide: 1, cheekFluff: 0
  }
}

// ---- raster helpers --------------------------------------------------------
function ellipse(cb, cx, cy, rx, ry) {
  const x0 = Math.floor(cx - rx), x1 = Math.ceil(cx + rx)
  const y0 = Math.floor(cy - ry), y1 = Math.ceil(cy + ry)
  for (let y = y0; y <= y1; y++)
    for (let x = x0; x <= x1; x++) {
      const dx = (x - cx) / rx, dy = (y - cy) / ry
      if (dx * dx + dy * dy <= 1) cb(x, y)
    }
}
function triangle(cb, ax, ay, bx, by, cx, cy) {
  const minX = Math.floor(Math.min(ax, bx, cx)), maxX = Math.ceil(Math.max(ax, bx, cx))
  const minY = Math.floor(Math.min(ay, by, cy)), maxY = Math.ceil(Math.max(ay, by, cy))
  for (let y = minY; y <= maxY; y++)
    for (let x = minX; x <= maxX; x++) {
      const w0 = (bx - ax) * (y - ay) - (by - ay) * (x - ax)
      const w1 = (cx - bx) * (y - by) - (cy - by) * (x - bx)
      const w2 = (ax - cx) * (y - cy) - (ay - cy) * (x - cx)
      if ((w0 >= 0 && w1 >= 0 && w2 >= 0) || (w0 <= 0 && w1 <= 0 && w2 <= 0)) cb(x, y)
    }
}
const idx = (x, y) => y * W + x
const inB = (x, y) => x >= 0 && x < W && y >= 0 && y < H

// ---- silhouette ------------------------------------------------------------
function buildFur(g, state) {
  const fur = new Uint8Array(W * H)
  const set = (x, y) => { if (inB(x, y)) fur[idx(x, y)] = 1 }

  ellipse(set, g.bodyCx, g.bodyCy, g.bodyRx, g.bodyRy)
  ellipse(set, g.bodyCx, g.bodyCy + g.bodyRy * 0.45, g.bodyRx * 0.94, g.bodyRy * 0.72)

  if (g.hasTail) {
    const s = g.tailSide
    const p0 = [g.bodyCx + s * g.bodyRx * 0.5, g.bodyCy + g.bodyRy * 0.45]
    const p1 = [g.bodyCx + s * (g.bodyRx + 4), g.bodyCy - g.bodyRy * 0.1]
    const sway = (state.tailPhase || 0) * 3.5
    const p2 = [g.bodyCx + s * g.bodyRx * 0.62 + s * sway, g.bodyCy - g.bodyRy * 0.7]
    for (let t = 0; t <= 1.001; t += 0.05) {
      const it = 1 - t
      const px = it * it * p0[0] + 2 * it * t * p1[0] + t * t * p2[0]
      const py = it * it * p0[1] + 2 * it * t * p1[1] + t * t * p2[1]
      ellipse(set, px, py, 3.1 - t * 1.2, 3.1 - t * 1.2)
    }
  }

  // Front legs + paws, sitting close together at the front.
  {
    const legDX = g.bodyRx * 0.3
    const legTop = g.bodyCy + g.bodyRy * 0.32
    const pawY = g.bodyCy + g.bodyRy * 0.98
    for (const s of [-1, 1]) {
      const lx = g.bodyCx + s * legDX
      for (let y = legTop; y <= pawY; y += 0.5) ellipse(set, lx, y, 2.3, 1.6)
      ellipse(set, lx, pawY, 3, 2.3)
    }
  }

  ellipse(set, g.headCx, (g.headCy + g.bodyCy) / 2 + 1, g.headRx * 0.78, (g.bodyCy - g.headCy) * 0.55)

  // Head: a touch wider than tall with cheeks, so it reads as a cat's head
  // rather than a perfect ball.
  ellipse(set, g.headCx, g.headCy, g.headRx, g.headRy * 0.96)
  {
    const chR = g.headRx * 0.46
    ellipse(set, g.headCx - g.headRx * 0.64, g.headCy + g.headRy * 0.3, chR, chR * 0.8)
    ellipse(set, g.headCx + g.headRx * 0.64, g.headCy + g.headRy * 0.3, chR, chR * 0.8)
  }
  if (g.cheekFluff > 0) {
    ellipse(set, g.headCx - g.headRx * 0.8, g.headCy + g.headRy * 0.4, g.cheekFluff, g.cheekFluff * 0.8)
    ellipse(set, g.headCx + g.headRx * 0.8, g.headCy + g.headRy * 0.4, g.cheekFluff, g.cheekFluff * 0.8)
  }

  const earBaseY = g.headCy - g.headRy * 0.55
  const twitch = (state.earPhase || 0) * 1.2
  for (const s of [-1, 1]) {
    const bx = g.headCx + s * g.earSpread
    const half = g.earW / 2
    const tipX = bx + s * g.earLean
    const tipY = earBaseY - g.earH + (s > 0 ? twitch : 0)
    triangle(set, bx - half, earBaseY + 1, bx + half, earBaseY + 1, tipX, tipY)
    if (g.earStyle === 'tufted') {
      // lynx tuft sprouting from the ear tip
      triangle(set, tipX - 1, tipY + 1, tipX + 1, tipY + 1, tipX + s * 1.6, tipY - 3.2)
    }
  }
  return fur
}

function sphereBright(x, y, cx, cy, rx, ry) {
  const nx = (x - cx) / rx, ny = (y - cy) / ry
  const nz = Math.sqrt(Math.max(0, 1 - nx * nx - ny * ny))
  return nx * LIGHT[0] + ny * LIGHT[1] + nz * LIGHT[2]
}
function shadeLevel(b) {
  if (b > 0.62) return HI
  if (b > 0.2) return BASE
  if (b > -0.15) return SHADOW
  return DEEP
}

// ---- markings --------------------------------------------------------------
function applyMarking(region, fur, g, kind) {
  const forEachFur = (fn) => {
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (fur[idx(x, y)]) fn(x, y)
  }
  const inEllipse = (x, y, cx, cy, rx, ry) => {
    const dx = (x - cx) / rx, dy = (y - cy) / ry
    return dx * dx + dy * dy <= 1
  }
  switch (kind) {
    case 'tabby': {
      forEachFur((x, y) => {
        if (inEllipse(x, y, g.bodyCx, g.bodyCy, g.bodyRx, g.bodyRy)) {
          // mackerel stripes: vertical bands that follow the body curve
          const v = (x - g.bodyCx) + Math.sin((y - g.bodyCy) * 0.45) * 2.6
          if (((Math.round(v) % 5) + 5) % 5 === 0) region[idx(x, y)] = S
        } else if (inEllipse(x, y, g.headCx, g.headCy, g.headRx, g.headRy)) {
          // temple stripes on the upper sides of the head
          if (y < g.headCy - 1 && Math.abs(x - g.headCx) > 3 && (((y - g.headCy) % 2) + 2) % 2 === 0)
            region[idx(x, y)] = S
        } else if (((Math.round(y) % 3) + 3) % 3 === 0) {
          // tail rings
          region[idx(x, y)] = S
        }
      })
      // forehead "M" dashes above the eyes
      for (let yy = Math.round(g.headCy - 6); yy <= Math.round(g.headCy - 2); yy++)
        for (const xx of [g.headCx - 2, g.headCx, g.headCx + 2]) {
          const rx = Math.round(xx)
          if (inB(rx, yy) && fur[idx(rx, yy)]) region[idx(rx, yy)] = S
        }
      break
    }
    case 'tuxedo':
      // start all primary(black); paint white bib, chin, paws
      forEachFur((x, y) => {
        if (inEllipse(x, y, g.bodyCx, g.bodyCy + 2, 6, 9)) region[idx(x, y)] = WHITE
        if (inEllipse(x, y, g.headCx, g.noseY + 1, 4.5, 4)) region[idx(x, y)] = WHITE
        if (y > g.bodyCy + g.bodyRy * 0.55 && Math.abs(Math.abs(x - g.bodyCx) - g.bodyRx * 0.42) < 3.4)
          region[idx(x, y)] = WHITE
      })
      break
    case 'socks':
      forEachFur((x, y) => {
        if (y > g.bodyCy + g.bodyRy * 0.5 && Math.abs(Math.abs(x - g.bodyCx) - g.bodyRx * 0.42) < 3.6)
          region[idx(x, y)] = WHITE
      })
      break
    case 'points': // siamese: dark ears, mask, paws, tail
      forEachFur((x, y) => {
        if (y < g.headCy - g.headRy * 0.5) region[idx(x, y)] = S // ears
        if (inEllipse(x, y, g.headCx, g.noseY, 5.5, 5)) region[idx(x, y)] = S // muzzle mask
        if (y > g.bodyCy + g.bodyRy * 0.55) region[idx(x, y)] = S // paws
        if (!inEllipse(x, y, g.headCx, g.headCy, g.headRx + 1, g.headRy + 1) &&
            !inEllipse(x, y, g.bodyCx, g.bodyCy, g.bodyRx + 1, g.bodyRy + 1)) region[idx(x, y)] = S // tail
      })
      break
    case 'calico': // white base + orange(S) + black(T) patches
      forEachFur((x, y) => {
        if (inEllipse(x, y, g.headCx - 4, g.headCy - 2, 6, 6)) region[idx(x, y)] = S
        if (inEllipse(x, y, g.bodyCx + 5, g.bodyCy + 1, 7, 7)) region[idx(x, y)] = T
        if (inEllipse(x, y, g.bodyCx - 6, g.bodyCy + 4, 5, 6)) region[idx(x, y)] = S
        if (inEllipse(x, y, g.headCx + 5, g.headCy + 3, 4, 4)) region[idx(x, y)] = T
      })
      break
    case 'bicolor': // colored top/back, white front/underside
      forEachFur((x, y) => {
        if (inEllipse(x, y, g.bodyCx, g.bodyCy + 3, 7, 9)) region[idx(x, y)] = WHITE
        if (inEllipse(x, y, g.headCx, g.noseY + 2, 5, 4)) region[idx(x, y)] = WHITE
        if (y > g.bodyCy + g.bodyRy * 0.55) region[idx(x, y)] = WHITE
      })
      break
    default:
      break // solid
  }
}

// ---- generate --------------------------------------------------------------
// Scale the front pose about the feet anchor so facing-you keeps the same
// visual mass as the side rig (head r=7) — see catgen.ts frontScaled.
export const FRONT_VIEW_SCALE = 0.8
export function frontScaled(g, k = FRONT_VIEW_SCALE) {
  const sx = (x) => W / 2 + (x - W / 2) * k
  const sy = (y) => 43 - (43 - y) * k
  return {
    ...g,
    headCx: sx(g.headCx), headCy: sy(g.headCy), headRx: g.headRx * k, headRy: g.headRy * k,
    bodyCx: sx(g.bodyCx), bodyCy: sy(g.bodyCy), bodyRx: g.bodyRx * k, bodyRy: g.bodyRy * k,
    earW: g.earW * k, earH: g.earH * k, earSpread: g.earSpread * k, earLean: g.earLean * k,
    eyeDX: g.eyeDX * k, eyeY: sy(g.eyeY), eyeRx: g.eyeRx * k, eyeRy: g.eyeRy * k,
    noseY: sy(g.noseY), cheekFluff: g.cheekFluff * k
  }
}

export function generateGrid(preset, state = {}) {
  const g = frontScaled({ ...defaultGeom(), ...(preset.geom || {}) })
  const marking = preset.marking || 'solid'
  const fur = buildFur(g, state)
  const shade = new Uint8Array(W * H)
  const region = new Uint8Array(W * H)
  const overlay = new Uint8Array(W * H)

  // Outline (dilate).
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) {
      if (fur[idx(x, y)]) continue
      let near = false
      for (let dy = -1; dy <= 1 && !near; dy++)
        for (let dx = -1; dx <= 1; dx++)
          if (inB(x + dx, y + dy) && fur[idx(x + dx, y + dy)]) { near = true; break }
      if (near) overlay[idx(x, y)] = O.OUTLINE
    }

  const inHead = (x, y) => {
    const dx = (x - g.headCx) / (g.headRx + 0.5), dy = (y - g.headCy) / (g.headRy + 0.5)
    return dx * dx + dy * dy <= 1.05
  }
  const inBody = (x, y) => {
    const dx = (x - g.bodyCx) / (g.bodyRx + 0.5), dy = (y - g.bodyCy) / (g.bodyRy + 0.5)
    return dx * dx + dy * dy <= 1.05
  }
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) {
      if (!fur[idx(x, y)]) continue
      if (inHead(x, y)) shade[idx(x, y)] = shadeLevel(sphereBright(x, y, g.headCx, g.headCy, g.headRx, g.headRy))
      else if (inBody(x, y)) shade[idx(x, y)] = shadeLevel(sphereBright(x, y, g.bodyCx, g.bodyCy, g.bodyRx, g.bodyRy))
      else shade[idx(x, y)] = BASE
    }
  // Contact shadow under the head.
  for (let y = 0; y < H - 1; y++)
    for (let x = 0; x < W; x++)
      if (fur[idx(x, y)] && overlay[idx(x, y + 1)] === O.OUTLINE && shade[idx(x, y)] === BASE)
        shade[idx(x, y)] = SHADOW

  // Soft lighter chest/belly for form.
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) {
      if (!fur[idx(x, y)]) continue
      const dx = (x - g.bodyCx) / 5.5, dy = (y - (g.bodyCy + 2)) / 7.5
      if (dx * dx + dy * dy <= 1 && shade[idx(x, y)] > HI) shade[idx(x, y)] -= 1
    }

  // Front-leg definition: a shadow crease down the middle separates the two
  // front legs, and toe ticks hint at paws.
  {
    const legDX = g.bodyRx * 0.3
    const legTop = Math.round(g.bodyCy + g.bodyRy * 0.42)
    const pawY = Math.round(g.bodyCy + g.bodyRy * 0.98)
    const cxp = Math.round(g.bodyCx)
    for (let y = legTop; y <= pawY; y++) {
      if (inB(cxp, y) && fur[idx(cxp, y)]) shade[idx(cxp, y)] = DEEP
      if (inB(cxp - 1, y) && fur[idx(cxp - 1, y)] && shade[idx(cxp - 1, y)] < SHADOW) shade[idx(cxp - 1, y)] = SHADOW
    }
    for (const s of [-1, 1]) {
      const px = Math.round(g.bodyCx + s * legDX) // paw center: a toe division
      if (inB(px, pawY) && fur[idx(px, pawY)]) shade[idx(px, pawY)] = DEEP
      if (inB(px, pawY - 1) && fur[idx(px, pawY - 1)] && shade[idx(px, pawY - 1)] < SHADOW) shade[idx(px, pawY - 1)] = SHADOW
    }
  }

  applyMarking(region, fur, g, marking)
  drawFace(overlay, fur, g, state)

  return { shade, region, overlay, geom: g, fur }
}

function put(overlay, x, y, role) { if (inB(x, y)) overlay[idx(x, y)] = role }

function drawFace(overlay, fur, g, state) {
  const earBaseY = g.headCy - g.headRy * 0.55
  for (const s of [-1, 1]) {
    const bx = g.headCx + s * g.earSpread
    // Inner ear: a smaller triangle nudged toward the face centre, leaving a
    // white rim, so it reads as the ear's pink lining from the front.
    const iw = g.earW * 0.26
    const icx = bx - s * 0.5
    triangle((x, y) => { if (fur[idx(x, y)] && overlay[idx(x, y)] !== O.OUTLINE) put(overlay, x, y, O.INEAR) },
      icx - iw, earBaseY - 0.5, icx + iw, earBaseY - 0.5, icx + s * g.earLean * 0.4, earBaseY - g.earH * 0.5)
  }

  const eyeOpen = state.eyeOpen !== false
  for (const s of [-1, 1]) {
    const ex = g.headCx + s * g.eyeDX, ey = g.eyeY
    if (!eyeOpen) {
      for (let x = Math.round(ex - g.eyeRx); x <= Math.round(ex + g.eyeRx); x++) put(overlay, x, ey, O.OUTLINE)
      continue
    }
    ellipse((x, y) => put(overlay, x, y, O.IRIS), ex, ey, g.eyeRx, g.eyeRy)
    if (g.eyeStyle === 'sleepy')
      for (let x = Math.round(ex - g.eyeRx - 1); x <= Math.round(ex + g.eyeRx + 1); x++) {
        put(overlay, x, ey - Math.round(g.eyeRy) + 1, O.OUTLINE)
        put(overlay, x, ey - Math.round(g.eyeRy), O.OUTLINE)
      }
    const pupRy = g.eyeStyle === 'round' ? g.eyeRy * 0.72 : g.eyeRy * 0.9
    const look = (state.look || 0) * (g.eyeRx * 0.5) // horizontal glance
    ellipse((x, y) => put(overlay, x, y, O.PUPIL), ex + look, ey + 0.3, Math.max(0.85, g.eyeRx * 0.45), pupRy)
    put(overlay, Math.round(ex + look - g.eyeRx * 0.35), Math.round(ey - g.eyeRy * 0.4), O.GLINT)
  }

  const nx = g.headCx, ny = g.noseY
  triangle((x, y) => put(overlay, x, y, O.NOSE), nx - 1.6, ny - 1, nx + 1.6, ny - 1, nx, ny + 1.2)
  put(overlay, nx, ny + 2, O.MOUTH)
  for (const dx of [-2, -1, 1, 2]) put(overlay, nx + dx, ny + 3, O.MOUTH)

  for (const s of [-1, 1]) {
    const wx = g.headCx + s * (g.headRx * 0.5)
    for (let k = 0; k < 3; k++) {
      const wy = g.noseY - 1 + k
      for (let i = 1; i <= 5; i++) {
        const x = Math.round(wx + s * (g.headRx * 0.35 + i)), y = Math.round(wy + (k - 1) * 0.6)
        if (inB(x, y) && overlay[idx(x, y)] === O.NONE && !fur[idx(x, y)]) put(overlay, x, y, O.WHISK)
      }
    }
  }
}

// ---- side-profile walk pose ------------------------------------------------
// A separate pose used while the pet travels: a side view with four legs doing a
// walk cycle (driven by `step` 0..1). Faces right; the renderer flips for left.
// Uses the same shade/region/overlay output so render() works unchanged.
export function generateWalkGrid(preset, step = 0, motion = 1) {
  const fur = new Uint8Array(W * H)
  const legTag = new Uint8Array(W * H) // 1 = near leg, 2 = far leg
  const set = (x, y) => { if (inB(x, y)) fur[idx(x, y)] = 1 }

  const groundY = 43
  // The torso oscillates vertically with the gait (two dips per stride) while the
  // feet stay planted — the legs stretch/compress, so the body doesn't look static.
  // Head and body move as one unit. `motion` (0..) scales the whole effect.
  const bob = Math.sin(step * Math.PI * 4) * 1.3 * motion
  const bodyCx = 18, bodyCy = 30 + bob, bodyRx = 11.5, bodyRy = 7.4
  const headCx = 32, headCy = 24 + bob, headR = 7
  const bodyBottom = bodyCy + bodyRy * 0.5

  // Legs: two pairs in a diagonal gait. Draw far pair first (behind the body).
  // Each leg is two tapered segments with a joint so it reads as a cat leg
  // (back legs kick the hock backward; front legs stay near-straight).
  // 4-beat LATERAL-SEQUENCE walk (real cat gait): RH -> RF -> LH -> LF.
  const legs = [
    { x: 14, ph: 0.0, near: false, back: true }, // RH (back far)
    { x: 26, ph: 0.25, near: false, back: false }, // RF (front far) — under the chest, not the head
    { x: 16, ph: 0.5, near: true, back: true }, // LH (back near)
    { x: 28, ph: 0.75, near: true, back: false } // LF (front near)
  ]
  const seg = (paint, x0, y0, x1, y1, r0, r1) => {
    const n = 7
    for (let t = 0; t <= 1.0001; t += 1 / n) ellipse(paint, x0 + (x1 - x0) * t, y0 + (y1 - y0) * t, r0 + (r1 - r0) * t, r0 + (r1 - r0) * t)
  }
  // Stance = 75% of the cycle. A sets the horizontal foot range so a planted foot
  // slides back exactly as fast as the body advances: STRIDE = 2*A/0.75. (=12.)
  const A = 4.5, LIFT = 3.4, SWING = 0.25
  const drawLeg = (lg) => {
    const p = (((step + lg.ph) % 1) + 1) % 1
    let offX, lift, flex
    if (p < SWING) { const s = p / SWING; offX = -A + s * 2 * A; flex = Math.sin(s * Math.PI); lift = flex * LIFT * (lg.back ? 0.95 : 0.85) }
    else { const s = (p - SWING) / (1 - SWING); offX = A - s * 2 * A; flex = 0; lift = 0 }
    const tag = lg.near ? 1 : 2
    const paint = (x, y) => { set(x, y); if (inB(x, y)) legTag[idx(x, y)] = tag }
    const hipX = lg.x
    const hipY = bodyBottom
    const footX = lg.x + offX
    const footY = groundY - lift
    // The joint folds up a little during swing (knee/hock flexes to lift the paw);
    // kept modest so the step doesn't jump across the few frames.
    const midY = hipY + (footY - hipY) * 0.5 - flex * 1.3
    const jointX = lg.back ? hipX - 2.2 - flex * 0.8 : hipX + offX * 0.2 + 0.5 + flex * 0.7
    seg(paint, hipX, hipY, jointX, midY, 2.2, 1.5) // upper (thigh / upper-arm)
    seg(paint, jointX, midY, footX, footY, 1.5, 1.0) // lower (shank)
    ellipse(paint, footX, footY + 0.2, 1.8, 1.2) // paw
  }
  legs.filter((l) => !l.near).forEach(drawLeg)

  // Body + neck + head (with a muzzle pushing forward so it's not a plain ball).
  ellipse(set, bodyCx, bodyCy, bodyRx, bodyRy)
  ellipse(set, (bodyCx + headCx) / 2 + 2, (bodyCy + headCy) / 2 + 1, 6, 5)
  // Round head, no protruding muzzle — pixel cats read better with a rounded
  // head + a tiny nose near the eye than with a snout + a lone nose (ref study).
  ellipse(set, headCx, headCy, headR * 1.02, headR * 0.98)

  // Ears.
  triangle(set, headCx - 4, headCy - headR + 2, headCx, headCy - headR + 2, headCx - 4.5, headCy - headR - 4)
  triangle(set, headCx + 1, headCy - headR + 2, headCx + 5, headCy - headR + 2, headCx + 4, headCy - headR - 4)

  // Tail: a long tail held up and curving from the rear (cats walk tail-up).
  {
    const tailSway = Math.sin(step * Math.PI * 2) * 2 * motion
    const p0 = [bodyCx - bodyRx * 0.7, bodyCy - 1], p1 = [bodyCx - bodyRx - 4, bodyCy - 9], p2 = [bodyCx - bodyRx + 3 + tailSway, bodyCy - 18]
    for (let t = 0; t <= 1.0001; t += 0.05) {
      const it = 1 - t
      ellipse(set, it * it * p0[0] + 2 * it * t * p1[0] + t * t * p2[0], it * it * p0[1] + 2 * it * t * p1[1] + t * t * p2[1], 2.6 - t * 1.1, 2.6 - t * 1.1)
    }
  }

  // Near legs on top.
  legs.filter((l) => l.near).forEach(drawLeg)

  const shade = new Uint8Array(W * H)
  const region = new Uint8Array(W * H)
  const overlay = new Uint8Array(W * H)

  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) {
      if (fur[idx(x, y)]) continue
      let near = false
      for (let dy = -1; dy <= 1 && !near; dy++)
        for (let dx = -1; dx <= 1; dx++)
          if (inB(x + dx, y + dy) && fur[idx(x + dx, y + dy)]) { near = true; break }
      if (near) overlay[idx(x, y)] = O.OUTLINE
    }

  const inHead = (x, y) => ((x - headCx) / (headR + 0.5)) ** 2 + ((y - headCy) / (headR + 0.5)) ** 2 <= 1.05
  const inBody = (x, y) => ((x - bodyCx) / (bodyRx + 0.5)) ** 2 + ((y - bodyCy) / (bodyRy + 0.5)) ** 2 <= 1.05
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) {
      if (!fur[idx(x, y)]) continue
      const tag = legTag[idx(x, y)]
      // Legs are the same white fur as the body — only lightly shaded for depth,
      // not a dark gray (which read as a different color on a white cat).
      if (tag === 2) shade[idx(x, y)] = SHADOW // far legs a touch darker
      else if (tag === 1) shade[idx(x, y)] = BASE // near legs = body tone
      else if (inHead(x, y)) shade[idx(x, y)] = shadeLevel(sphereBright(x, y, headCx, headCy, headR, headR))
      else if (inBody(x, y)) shade[idx(x, y)] = shadeLevel(sphereBright(x, y, bodyCx, bodyCy, bodyRx, bodyRy))
      else shade[idx(x, y)] = BASE
    }

  // Face (one side): inner ear (smaller, white rim), eye, nose on the muzzle, mouth.
  triangle((x, y) => { if (fur[idx(x, y)] && overlay[idx(x, y)] !== O.OUTLINE) put(overlay, x, y, O.INEAR) },
    headCx + 2, headCy - headR + 1.5, headCx + 3.6, headCy - headR + 1.5, headCx + 3.2, headCy - headR - 1)
  ellipse((x, y) => put(overlay, x, y, O.IRIS), headCx + 1.6, headCy - 0.5, 1.7, 2)
  ellipse((x, y) => put(overlay, x, y, O.PUPIL), headCx + 2, headCy - 0.3, 0.9, 1.4)
  put(overlay, Math.round(headCx + 1.2), Math.round(headCy - 1.3), O.GLINT)
  // Just a tiny nose at the front of the face (no mouth line — a dark trail on
  // a white profile reads as a smudge, ref cats keep it to the nose).
  const nfx = headCx + headR - 1, nfy = headCy + 0.8
  if (fur[idx(Math.round(nfx), Math.round(nfy))]) put(overlay, Math.round(nfx), Math.round(nfy), O.NOSE)

  return { shade, region, overlay, geom: {}, fur }
}

// ---- curled-up sleep pose --------------------------------------------------
// A cat curled into a ball: a rounded body, head tucked at the front, ears up,
// tail wrapped around the front, eyes closed. `breath` (radians) drives a slow
// belly rise/fall (the ball's bottom stays on the ground).
export function generateCurlGrid(preset, breath = 0) {
  // Side profile of a curled sleeping cat (ref: a cat curled nose-to-paws).
  // Head lowered on the LEFT resting by the front paws, back arching up behind,
  // tail wrapping the base to close the loop. One coherent viewing angle.
  const fur = new Uint8Array(W * H)
  const head = new Uint8Array(W * H), tail = new Uint8Array(W * H), paw = new Uint8Array(W * H)
  const stamp = (mask) => (x, y) => { if (inB(x, y)) { fur[idx(x, y)] = 1; if (mask) mask[idx(x, y)] = 1 } }
  const body = stamp(null)

  const g = 41
  const br = Math.sin(breath)
  const brx = 13.5, bry = 11 + br * 0.5
  const bcx = 25, bcy = g - bry                  // rounded body mound
  const hx = 14, hy = g - 9, hr = 7.2            // head lowered, front-left

  // Tail wraps the base from the right haunch around to the front paws (drawn under).
  {
    const p0 = [36, bcy + 5], p1 = [27, g + 1], p2 = [18, g - 1]
    for (let t = 0; t <= 1.0001; t += 0.04) {
      const it = 1 - t
      ellipse(stamp(tail), it * it * p0[0] + 2 * it * t * p1[0] + t * t * p2[0], it * it * p0[1] + 2 * it * t * p1[1] + t * t * p2[1], 2.3, 2.3)
    }
  }
  ellipse(body, bcx, bcy, brx, bry)
  ellipse(body, 33, bcy + 2, 8.5, 9)             // haunch rising behind the head
  ellipse(stamp(paw), 18, g - 1.2, 3, 2.3)       // front paws tucked under the chin
  ellipse(stamp(paw), 22.5, g - 1, 3, 2.2)
  ellipse(stamp(head), hx, hy, hr, hr * 0.94)    // head
  ellipse(stamp(head), hx - 4.2, hy + 2.4, 3.2, 2.7) // muzzle/chin
  triangle(stamp(head), hx - 5, hy - hr + 2, hx - 1, hy - hr + 2.5, hx - 5.5, hy - hr - 3.5) // near ear
  triangle(stamp(head), hx + 1, hy - hr + 1, hx + 4.5, hy - hr + 1.5, hx + 4, hy - hr - 2.5) // far ear (behind)

  const shade = new Uint8Array(W * H)
  const region = new Uint8Array(W * H)
  const overlay = new Uint8Array(W * H)
  const is = (mask, x, y) => inB(x, y) && mask[idx(x, y)]

  // Outer outline (dilate the silhouette by 1px).
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) {
      if (fur[idx(x, y)]) continue
      let near = false
      for (let dy = -1; dy <= 1 && !near; dy++)
        for (let dx = -1; dx <= 1; dx++)
          if (inB(x + dx, y + dy) && fur[idx(x + dx, y + dy)]) { near = true; break }
      if (near) overlay[idx(x, y)] = O.OUTLINE
    }

  const tailTop = new Int16Array(W).fill(999)
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (tail[idx(x, y)] && y < tailTop[x]) tailTop[x] = y

  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) {
      const i = idx(x, y)
      if (!fur[i]) continue
      if (head[i]) shade[i] = shadeLevel(sphereBright(x, y, hx, hy, hr, hr))
      else if (tail[i]) { const d = y - tailTop[x]; shade[i] = d <= 1 ? BASE : SHADOW } // soft curl, same fur
      else if (paw[i]) shade[i] = BASE
      else shade[i] = shadeLevel(sphereBright(x, y, bcx, bcy, brx, bry))
      if (!head[i] && y >= g - 1) shade[i] = SHADOW // grounded base
    }

  // Soft creases only where forms overlap — a light touch keeps it from looking busy.
  const crease = (mask, aboveOnly) => {
    for (let y = 0; y < H; y++)
      for (let x = 0; x < W; x++) {
        if (!mask[idx(x, y)]) continue
        for (let dy = -1; dy <= 1; dy++)
          for (let dx = -1; dx <= 1; dx++) {
            if (aboveOnly && dy > 0) continue
            const nx = x + dx, ny = y + dy
            if (is(mask, nx, ny) || !inB(nx, ny) || !fur[idx(nx, ny)] || overlay[idx(nx, ny)] === O.OUTLINE) continue
            if (mask === paw && is(tail, nx, ny)) continue
            shade[idx(nx, ny)] = Math.max(shade[idx(nx, ny)], SHADOW) // shadow crease, not a hard line
          }
      }
  }
  crease(tail, true)  // shade the body just above the wrapping tail
  crease(paw, true)   // shade above the tucked paws
  put(overlay, 20.5 | 0, g - 3, O.OUTLINE) // hint of a gap between the two paws

  // Closed eye (a short down-curved line), pink nose at the muzzle tip, inner near-ear.
  put(overlay, hx - 4, hy, O.OUTLINE); put(overlay, hx - 3, hy + 1, O.OUTLINE)
  put(overlay, hx - 2, hy + 1, O.OUTLINE); put(overlay, hx - 1, hy + 1, O.OUTLINE)
  put(overlay, hx - 7, hy + 3, O.NOSE); put(overlay, hx - 6, hy + 3, O.NOSE); put(overlay, hx - 6, hy + 4, O.NOSE)
  triangle((x, y) => { if (head[idx(x, y)] && overlay[idx(x, y)] !== O.OUTLINE) put(overlay, x, y, O.INEAR) },
    hx - 4.2, hy - hr + 2.5, hx - 2.8, hy - hr + 2.5, hx - 3.6, hy - hr)

  return { shade, region, overlay, geom: {}, fur }
}

// ---- color -----------------------------------------------------------------
function hexToRgb(h) { h = h.replace('#', ''); return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)] }
function mix(a, b, t) { return [Math.round(a[0] + (b[0] - a[0]) * t), Math.round(a[1] + (b[1] - a[1]) * t), Math.round(a[2] + (b[2] - a[2]) * t)] }
/** Build a 4-stop shade ramp [HI, BASE, SHADOW, DEEP] from a base hex. */
export function ramp(hex) {
  const c = hexToRgb(hex)
  return [mix(c, [255, 255, 255], 0.34), c, mix(c, [0, 0, 0], 0.16), mix(c, [0, 0, 0], 0.34)]
}

/**
 * Resolve a coat spec into ramps + feature colors.
 * spec: { primary, secondary?, white?, tertiary?, iris, pupil?, nose?, innerEar?, whisk?, outline? }
 */
export function resolveCoat(spec) {
  const white = spec.white || '#f6f6f8'
  return {
    ramps: {
      [P]: ramp(spec.primary),
      [S]: ramp(spec.secondary || spec.primary),
      [WHITE]: ramp(white),
      [T]: ramp(spec.tertiary || '#33333a')
    },
    iris: hexToRgb(spec.iris || '#5cbf74'),
    pupil: hexToRgb(spec.pupil || '#20303a'),
    glint: hexToRgb(spec.glint || '#ffffff'),
    nose: hexToRgb(spec.nose || '#e98aa0'),
    inEar: hexToRgb(spec.innerEar || '#f0b2c0'),
    mouth: hexToRgb(spec.outline || '#2b2b33'),
    whisk: hexToRgb(spec.whisk || '#d7d7e0'),
    outline: hexToRgb(spec.outline || '#2b2b33')
  }
}

export function render(parts, coatSpec) {
  const coat = resolveCoat(coatSpec)
  const { shade, region, overlay } = parts
  const rgba = new Uint8ClampedArray(W * H * 4)
  for (let i = 0; i < W * H; i++) {
    let col = null
    const ov = overlay[i]
    if (ov === O.OUTLINE) col = coat.outline
    else if (ov === O.IRIS) col = coat.iris
    else if (ov === O.PUPIL) col = coat.pupil
    else if (ov === O.GLINT) col = coat.glint
    else if (ov === O.NOSE) col = coat.nose
    else if (ov === O.INEAR) col = coat.inEar
    else if (ov === O.MOUTH) col = coat.mouth
    else if (ov === O.WHISK) col = coat.whisk
    else if (shade[i]) col = coat.ramps[region[i]][shade[i] - 1]
    if (!col) continue
    rgba[i * 4] = col[0]
    rgba[i * 4 + 1] = col[1]
    rgba[i * 4 + 2] = col[2]
    rgba[i * 4 + 3] = 255
  }
  return rgba
}

/** Convenience: preset + state -> RGBA. */
export function renderCat(preset, state = {}) {
  return { w: W, h: H, rgba: render(generateGrid(preset, state), preset.coat || { primary: '#f2f2f4' }) }
}
