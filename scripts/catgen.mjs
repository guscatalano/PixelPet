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
    earW: 7.5, earH: 8.5, earSpread: 7.5, earLean: 1.5,
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

  ellipse(set, g.bodyCx - g.bodyRx * 0.42, g.bodyCy + g.bodyRy * 0.72, 3.2, 2.6)
  ellipse(set, g.bodyCx + g.bodyRx * 0.42, g.bodyCy + g.bodyRy * 0.72, 3.2, 2.6)

  ellipse(set, g.headCx, (g.headCy + g.bodyCy) / 2 + 1, g.headRx * 0.78, (g.bodyCy - g.headCy) * 0.55)

  ellipse(set, g.headCx, g.headCy, g.headRx, g.headRy)
  if (g.cheekFluff > 0) {
    ellipse(set, g.headCx - g.headRx * 0.8, g.headCy + g.headRy * 0.4, g.cheekFluff, g.cheekFluff * 0.8)
    ellipse(set, g.headCx + g.headRx * 0.8, g.headCy + g.headRy * 0.4, g.cheekFluff, g.cheekFluff * 0.8)
  }

  const earBaseY = g.headCy - g.headRy * 0.55
  const twitch = (state.earPhase || 0) * 1.2
  for (const s of [-1, 1]) {
    const bx = g.headCx + s * g.earSpread
    const half = g.earW / 2
    triangle(set, bx - half, earBaseY + 1, bx + half, earBaseY + 1, bx + s * g.earLean, earBaseY - g.earH + (s > 0 ? twitch : 0))
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
    case 'tabby':
      forEachFur((x, y) => {
        const v = y * 1.05 + Math.sin(x * 0.7 + y * 0.1) * 2.2
        if (((v % 4.6) + 4.6) % 4.6 < 1.7) region[idx(x, y)] = S
      })
      // forehead M + brow
      forEachFur((x, y) => {
        if (y < g.headCy - 2 && y > g.headCy - 7 && Math.abs(x - g.headCx) < 5 && (x + y) % 2 === 0)
          region[idx(x, y)] = S
      })
      break
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
export function generateGrid(preset, state = {}) {
  const g = { ...defaultGeom(), ...(preset.geom || {}) }
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

  applyMarking(region, fur, g, marking)
  drawFace(overlay, fur, g, state)

  return { shade, region, overlay, geom: g, fur }
}

function put(overlay, x, y, role) { if (inB(x, y)) overlay[idx(x, y)] = role }

function drawFace(overlay, fur, g, state) {
  const earBaseY = g.headCy - g.headRy * 0.55
  for (const s of [-1, 1]) {
    const bx = g.headCx + s * g.earSpread
    triangle((x, y) => { if (fur[idx(x, y)] && overlay[idx(x, y)] !== O.OUTLINE) put(overlay, x, y, O.INEAR) },
      bx - g.earW / 4, earBaseY, bx + g.earW / 4, earBaseY, bx + s * g.earLean, earBaseY - g.earH * 0.55)
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
    ellipse((x, y) => put(overlay, x, y, O.PUPIL), ex, ey + 0.3, Math.max(0.85, g.eyeRx * 0.45), pupRy)
    put(overlay, Math.round(ex - g.eyeRx * 0.4), Math.round(ey - g.eyeRy * 0.4), O.GLINT)
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
