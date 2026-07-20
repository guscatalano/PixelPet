// Parametric pixel-cat generator (TypeScript port for the app).
//
// Mirrors scripts/catgen.mjs (the tooling/gallery copy) — keep the two in sync.
// Produces an RGBA buffer for a cat from a pet spec (geometry + coat) and an
// animation state (blink / tail / ear / glance). Silhouette -> auto-outline ->
// spherical top-left shading -> face + coat markings, with shade/region/overlay
// layers so markings stay properly shaded.

// Logical sprite is 44×44 units. The raster grid (W×H) can be supersampled by a
// "detail" factor SS so the same geometry is drawn into more (or fewer) pixels:
// SS=1 is the classic chunky look (default), 2 = finer/higher-res, 0.5 = chunkier.
// All geometry is authored in the 44-unit space; only the rasterizer scales.
export const BASE_W = 44
export const BASE_H = 44
export let W = 44
export let H = 44
let SS = 1
/** Set the supersample/detail factor (0.5 chunky · 1 default · 2 fine). */
export function setDetail(mult: number): void {
  SS = mult > 0 ? mult : 1
  W = Math.max(1, Math.round(BASE_W * SS))
  H = Math.max(1, Math.round(BASE_H * SS))
}
export function getDetail(): number { return SS }

// Shade levels (1..4); 0 = not fur.
const HI = 1, BASE = 2, SHADOW = 3, DEEP = 4
// Coat regions.
const P = 0, S = 1, WHITE = 2, T = 3
// Overlay roles (0 = none).
const O = { NONE: 0, OUTLINE: 1, IRIS: 2, PUPIL: 3, GLINT: 4, NOSE: 5, INEAR: 6, MOUTH: 7, WHISK: 8, CONE: 9, CONE_HI: 10 }
// The cone of shame — a translucent-plastic look: a light body + a brighter rim/edge.
const CONE_COLOR = [176, 196, 224]
const CONE_HI_COLOR = [225, 234, 247]

const LIGHT: [number, number, number] = (() => {
  const v: [number, number, number] = [-0.35, -0.5, 0.79]
  const m = Math.hypot(v[0], v[1], v[2])
  return [v[0] / m, v[1] / m, v[2] / m]
})()

export interface Geom {
  headCx: number; headCy: number; headRx: number; headRy: number
  bodyCx: number; bodyCy: number; bodyRx: number; bodyRy: number
  earW: number; earH: number; earSpread: number; earLean: number; earStyle: string
  eyeDX: number; eyeY: number; eyeRx: number; eyeRy: number; eyeStyle: string
  noseY: number; hasTail: boolean; tailSide: number; cheekFluff: number
  /** Muzzle length forward of the head (0 = flat cat face; >0 = a dog-like snout). */
  snout: number
  /** Tail shape: default | bushy (fox/husky) | thin | nub (short stub). */
  tailStyle: string
  /** How it travels: walk (4-beat) | hop (bunny bound). */
  gait: string
}
export interface CoatSpec {
  primary: string; secondary?: string; white?: string; tertiary?: string
  iris?: string; pupil?: string; glint?: string; nose?: string
  innerEar?: string; whisk?: string; outline?: string
}
export interface Pet {
  id?: string; name?: string; blurb?: string
  geom?: Partial<Geom>; marking?: string; coat: CoatSpec
  personality?: Record<string, number>
}
export interface AnimState { eyeOpen?: boolean; tailPhase?: number; earPhase?: number; look?: number; dilation?: number }
export interface Parts { shade: Uint8Array; region: Uint8Array; overlay: Uint8Array; geom: Geom; fur: Uint8Array }

type SetFn = (x: number, y: number) => void

export function defaultGeom(): Geom {
  return {
    headCx: 22, headCy: 16, headRx: 11, headRy: 10,
    bodyCx: 22, bodyCy: 33, bodyRx: 12, bodyRy: 11,
    earW: 7.5, earH: 8.5, earSpread: 7.5, earLean: 1.5, earStyle: 'pointy',
    eyeDX: 5.2, eyeY: 17, eyeRx: 2.5, eyeRy: 3.0, eyeStyle: 'round',
    noseY: 22, hasTail: true, tailSide: 1, cheekFluff: 0, snout: 0, tailStyle: 'default', gait: 'walk'
  }
}

// Primitives take authored 44-unit coords and rasterize into the (possibly
// supersampled) device grid; callbacks receive device pixel coords.
function ellipse(cb: SetFn, cx: number, cy: number, rx: number, ry: number): void {
  cx *= SS; cy *= SS; rx *= SS; ry *= SS
  const x0 = Math.floor(cx - rx), x1 = Math.ceil(cx + rx)
  const y0 = Math.floor(cy - ry), y1 = Math.ceil(cy + ry)
  for (let y = y0; y <= y1; y++)
    for (let x = x0; x <= x1; x++) {
      const dx = (x - cx) / rx, dy = (y - cy) / ry
      if (dx * dx + dy * dy <= 1) cb(x, y)
    }
}
function triangle(cb: SetFn, ax: number, ay: number, bx: number, by: number, cx: number, cy: number): void {
  ax *= SS; ay *= SS; bx *= SS; by *= SS; cx *= SS; cy *= SS
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
const idx = (x: number, y: number): number => y * W + x
const inB = (x: number, y: number): boolean => x >= 0 && x < W && y >= 0 && y < H
/** Round an authored-unit block size to whole device pixels (≥1). */
const blk = (): number => Math.max(1, Math.round(SS))

function buildFur(g: Geom, state: AnimState): Uint8Array {
  const fur = new Uint8Array(W * H)
  const set: SetFn = (x, y) => { if (inB(x, y)) fur[idx(x, y)] = 1 }

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

  if (g.snout > 0) ellipse(set, g.headCx, g.noseY + g.snout * 0.35, g.snout * 0.85, g.snout * 0.6) // front muzzle
  const earBaseY = g.headCy - g.headRy * 0.55
  const twitch = (state.earPhase || 0) * 1.2
  for (const s of [-1, 1]) {
    const bx = g.headCx + s * g.earSpread
    const half = g.earW / 2
    if (g.earStyle === 'floppy') { // dog ears: a flap that flares out then hangs down beside the face
      const e = floppyEarPts(g, s)
      triangle(set, e.topI[0], e.topI[1], e.topO[0], e.topO[1], e.botO[0], e.botO[1])
      triangle(set, e.topI[0], e.topI[1], e.botO[0], e.botO[1], e.botI[0], e.botI[1])
    } else {
      const tipX = bx + s * g.earLean
      const tipY = earBaseY - g.earH + (s > 0 ? twitch : 0)
      triangle(set, bx - half, earBaseY + 1, bx + half, earBaseY + 1, tipX, tipY)
      if (g.earStyle === 'tufted') triangle(set, tipX - 1, tipY + 1, tipX + 1, tipY + 1, tipX + s * 1.6, tipY - 3.2)
    }
  }
  return fur
}

function sphereBright(x: number, y: number, cx: number, cy: number, rx: number, ry: number): number {
  // x,y are device pixels; cx,cy,rx,ry are authored 44-unit geometry.
  const nx = (x / SS - cx) / rx, ny = (y / SS - cy) / ry
  const nz = Math.sqrt(Math.max(0, 1 - nx * nx - ny * ny))
  return nx * LIGHT[0] + ny * LIGHT[1] + nz * LIGHT[2]
}
function shadeLevel(b: number): number {
  if (b > 0.62) return HI
  if (b > 0.2) return BASE
  if (b > -0.15) return SHADOW
  return DEEP
}

export function applyMarking(region: Uint8Array, fur: Uint8Array, g: Geom, kind: string): void {
  // fn receives authored 44-unit coords (x,y) plus the device index i to write to.
  const forEachFur = (fn: (x: number, y: number, i: number) => void): void => {
    for (let dy = 0; dy < H; dy++) for (let dx = 0; dx < W; dx++) { const i = idx(dx, dy); if (fur[i]) fn(dx / SS, dy / SS, i) }
  }
  const inEllipse = (x: number, y: number, cx: number, cy: number, rx: number, ry: number): boolean => {
    const dx = (x - cx) / rx, dy = (y - cy) / ry
    return dx * dx + dy * dy <= 1
  }
  // Paint an authored 44-unit pixel as an SS×SS device block, over fur only.
  const paintU = (ux: number, uy: number, val: number): void => {
    const bx = Math.round(ux * SS), by = Math.round(uy * SS), b = blk()
    for (let dy = 0; dy < b; dy++) for (let dx = 0; dx < b; dx++) { const px = bx + dx, py = by + dy; if (inB(px, py) && fur[idx(px, py)]) region[idx(px, py)] = val }
  }
  switch (kind) {
    case 'tabby': {
      forEachFur((x, y, i) => {
        if (inEllipse(x, y, g.bodyCx, g.bodyCy, g.bodyRx, g.bodyRy)) {
          const v = (x - g.bodyCx) + Math.sin((y - g.bodyCy) * 0.45) * 2.6
          if (((Math.round(v) % 5) + 5) % 5 === 0) region[i] = S
        } else if (inEllipse(x, y, g.headCx, g.headCy, g.headRx, g.headRy)) {
          if (y < g.headCy - 1 && Math.abs(x - g.headCx) > 3 && (((Math.round(y - g.headCy)) % 2) + 2) % 2 === 0) region[i] = S
        } else if (((Math.round(y) % 3) + 3) % 3 === 0) {
          region[i] = S
        }
      })
      for (let yy = Math.round(g.headCy - 6); yy <= Math.round(g.headCy - 2); yy++)
        for (const xx of [g.headCx - 2, g.headCx, g.headCx + 2]) paintU(Math.round(xx), yy, S)
      break
    }
    case 'tuxedo':
      forEachFur((x, y, i) => {
        if (inEllipse(x, y, g.bodyCx, g.bodyCy + 2, 6, 9)) region[i] = WHITE
        if (inEllipse(x, y, g.headCx, g.noseY + 1, 4.5, 4)) region[i] = WHITE
        if (y > g.bodyCy + g.bodyRy * 0.55 && Math.abs(Math.abs(x - g.bodyCx) - g.bodyRx * 0.42) < 3.4) region[i] = WHITE
      })
      break
    case 'socks':
      forEachFur((x, y, i) => {
        if (y > g.bodyCy + g.bodyRy * 0.5 && Math.abs(Math.abs(x - g.bodyCx) - g.bodyRx * 0.42) < 3.6) region[i] = WHITE
      })
      break
    case 'points':
      forEachFur((x, y, i) => {
        if (y < g.headCy - g.headRy * 0.5) region[i] = S
        if (inEllipse(x, y, g.headCx, g.noseY, 5.5, 5)) region[i] = S
        if (y > g.bodyCy + g.bodyRy * 0.55) region[i] = S
        if (!inEllipse(x, y, g.headCx, g.headCy, g.headRx + 1, g.headRy + 1) &&
            !inEllipse(x, y, g.bodyCx, g.bodyCy, g.bodyRx + 1, g.bodyRy + 1)) region[i] = S
      })
      break
    case 'calico':
      forEachFur((x, y, i) => {
        if (inEllipse(x, y, g.headCx - 4, g.headCy - 2, 6, 6)) region[i] = S
        if (inEllipse(x, y, g.bodyCx + 5, g.bodyCy + 1, 7, 7)) region[i] = T
        if (inEllipse(x, y, g.bodyCx - 6, g.bodyCy + 4, 5, 6)) region[i] = S
        if (inEllipse(x, y, g.headCx + 5, g.headCy + 3, 4, 4)) region[i] = T
      })
      break
    case 'bicolor':
      forEachFur((x, y, i) => {
        if (inEllipse(x, y, g.bodyCx, g.bodyCy + 3, 7, 9)) region[i] = WHITE
        if (inEllipse(x, y, g.headCx, g.noseY + 2, 5, 4)) region[i] = WHITE
        if (y > g.bodyCy + g.bodyRy * 0.55) region[i] = WHITE
      })
      break
    default:
      break
  }
}

/** Silhouette geometry a side-view pose exposes for marking placement. */
export interface SideGeom {
  hcx: number; hcy: number; hr: number // head centre + radius
  bcx: number; bcy: number; brx: number; bry: number // body ellipse
  groundY: number // where the paws land
  faceSign: number // +1 head is to the right of the body, -1 to the left
}

/**
 * Paint coat markings onto the `region` layer of a SIDE-VIEW pose (rig / walk /
 * turn) so calico, tabby, tuxedo, points, etc. survive every animation — not
 * just the front idle (see applyMarking for the front-view equivalent). Works
 * off the pose silhouette rather than fixed front geometry, so it adapts to any
 * pose. Colours: S = secondary, T = tertiary, WHITE = white belly/socks.
 */
export function sideMarking(region: Uint8Array, fur: Uint8Array, s: SideGeom, kind: string): void {
  // fn receives authored 44-unit coords (x,y) plus the device index i to write to.
  const forEachFur = (fn: (x: number, y: number, i: number) => void): void => {
    for (let dy = 0; dy < H; dy++) for (let dx = 0; dx < W; dx++) { const i = idx(dx, dy); if (fur[i]) fn(dx / SS, dy / SS, i) }
  }
  const inEllipse = (x: number, y: number, cx: number, cy: number, rx: number, ry: number): boolean => {
    const dx = (x - cx) / rx, dy = (y - cy) / ry
    return dx * dx + dy * dy <= 1
  }
  const inHead = (x: number, y: number): boolean => inEllipse(x, y, s.hcx, s.hcy, s.hr + 1, s.hr + 1)
  const inBody = (x: number, y: number): boolean => inEllipse(x, y, s.bcx, s.bcy, s.brx + 1, s.bry + 1)
  const fx = s.faceSign // front direction
  switch (kind) {
    case 'tabby': {
      // Mackerel stripes: vertical bands running down the spine, wrapping legs
      // and tail. A sine warp keeps them from looking like a picket fence.
      forEachFur((x, y, i) => {
        const v = (x - s.bcx) + Math.sin((y - s.bcy) * 0.5) * 2.6
        if (((Math.round(v) % 5) + 5) % 5 === 0) region[i] = S
      })
      // Forehead "M" hint: a couple of short bars between the ears.
      forEachFur((x, y, i) => {
        if (y < s.hcy - 1 && inHead(x, y) && (((Math.round(x - s.hcx) % 2) + 2) % 2 === 0)) region[i] = S
      })
      break
    }
    case 'points':
      // Dark extremities (face, ears, legs, tail); the barrel stays light.
      forEachFur((x, y, i) => {
        if (inHead(x, y)) { region[i] = S; return }
        if (!inBody(x, y)) region[i] = S // legs + tail + neck reach past the body
        else if (y > s.groundY - 6) region[i] = S // lower legs
      })
      break
    case 'tuxedo':
      // Black suit, white shirt: dark back/head dominate; white only on the
      // lower-front chest bib, belly underside, paws and chin.
      forEachFur((x, y, i) => {
        if (y > s.bcy + s.bry * 0.35 && inBody(x, y)) region[i] = WHITE // belly underside
        if (inEllipse(x, y, s.bcx + fx * s.brx * 0.55, s.bcy + s.bry * 0.5, s.brx * 0.42, s.bry * 0.7)) region[i] = WHITE // chest bib
        if (y > s.groundY - 4) region[i] = WHITE // socks
        if (inEllipse(x, y, s.hcx + fx * s.hr * 0.5, s.hcy + s.hr * 0.55, s.hr * 0.5, s.hr * 0.42)) region[i] = WHITE // chin blaze
      })
      break
    case 'bicolor':
      forEachFur((x, y, i) => {
        if (y > s.bcy - s.bry * 0.35 && inBody(x, y)) region[i] = WHITE // most of the body white
        if (inEllipse(x, y, s.hcx + fx * s.hr * 0.35, s.hcy + s.hr * 0.35, s.hr * 0.75, s.hr * 0.7)) region[i] = WHITE // white face/muzzle
        if (y > s.groundY - 6) region[i] = WHITE
      })
      break
    case 'socks':
      forEachFur((x, y, i) => {
        if (y > s.groundY - 5 || (y > s.bcy + s.bry * 0.6 && !inBody(x, y))) region[i] = WHITE
      })
      break
    case 'calico':
      // Irregular tortoiseshell patches of secondary (dark) + tertiary (ginger)
      // over the white base.
      forEachFur((x, y, i) => {
        if (inEllipse(x, y, s.bcx - s.brx * 0.35, s.bcy - s.bry * 0.15, s.brx * 0.5, s.bry * 0.8)) region[i] = S
        if (inEllipse(x, y, s.bcx + s.brx * 0.4, s.bcy + s.bry * 0.1, s.brx * 0.5, s.bry * 0.7)) region[i] = T
        if (inEllipse(x, y, s.hcx - fx * s.hr * 0.3, s.hcy - s.hr * 0.15, s.hr * 0.75, s.hr * 0.8)) region[i] = S
        if (inEllipse(x, y, s.hcx + fx * s.hr * 0.45, s.hcy + s.hr * 0.2, s.hr * 0.55, s.hr * 0.55)) region[i] = T
      })
      break
    default:
      break
  }
}

/**
 * The front view rasterized at full geometry reads ~40% larger than the side
 * rig (whose head is r=7 to match the walk pose), so the cat visibly "grew"
 * when it turned to face you. Scale the whole front pose about the feet anchor
 * so facing-you keeps the same visual mass (a hint larger is kept on purpose —
 * a face turned toward you naturally reads closer).
 */
export const DEFAULT_FRONT_SCALE = 0.8
const FEET_ANCHOR_Y = 43
let frontViewScale = DEFAULT_FRONT_SCALE
/** User setting: how big the facing-you view renders (1.0 = "coming at you"). */
export function setFrontScale(k: number): void { frontViewScale = k }
export function frontScaled(g: Geom, k = frontViewScale): Geom {
  const sx = (x: number): number => BASE_W / 2 + (x - BASE_W / 2) * k // authored 44-unit space
  const sy = (y: number): number => FEET_ANCHOR_Y - (FEET_ANCHOR_Y - y) * k
  return {
    ...g,
    headCx: sx(g.headCx), headCy: sy(g.headCy), headRx: g.headRx * k, headRy: g.headRy * k,
    bodyCx: sx(g.bodyCx), bodyCy: sy(g.bodyCy), bodyRx: g.bodyRx * k, bodyRy: g.bodyRy * k,
    earW: g.earW * k, earH: g.earH * k, earSpread: g.earSpread * k, earLean: g.earLean * k,
    eyeDX: g.eyeDX * k, eyeY: sy(g.eyeY), eyeRx: g.eyeRx * k, eyeRy: g.eyeRy * k,
    noseY: sy(g.noseY), cheekFluff: g.cheekFluff * k
  }
}

export function generateGrid(preset: Pet, state: AnimState = {}): Parts {
  const g: Geom = frontScaled({ ...defaultGeom(), ...(preset.geom || {}) })
  const marking = preset.marking || 'solid'
  const fur = buildFur(g, state)
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

  const inHead = (x: number, y: number): boolean => {
    const dx = (x / SS - g.headCx) / (g.headRx + 0.5), dy = (y / SS - g.headCy) / (g.headRy + 0.5)
    return dx * dx + dy * dy <= 1.05
  }
  const inBody = (x: number, y: number): boolean => {
    const dx = (x / SS - g.bodyCx) / (g.bodyRx + 0.5), dy = (y / SS - g.bodyCy) / (g.bodyRy + 0.5)
    return dx * dx + dy * dy <= 1.05
  }
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) {
      if (!fur[idx(x, y)]) continue
      if (inHead(x, y)) shade[idx(x, y)] = shadeLevel(sphereBright(x, y, g.headCx, g.headCy, g.headRx, g.headRy))
      else if (inBody(x, y)) shade[idx(x, y)] = shadeLevel(sphereBright(x, y, g.bodyCx, g.bodyCy, g.bodyRx, g.bodyRy))
      else shade[idx(x, y)] = BASE
    }
  for (let y = 0; y < H - 1; y++)
    for (let x = 0; x < W; x++)
      if (fur[idx(x, y)] && overlay[idx(x, y + 1)] === O.OUTLINE && shade[idx(x, y)] === BASE) shade[idx(x, y)] = SHADOW

  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) {
      if (!fur[idx(x, y)]) continue
      const dx = (x / SS - g.bodyCx) / 5.5, dy = (y / SS - (g.bodyCy + 2)) / 7.5
      if (dx * dx + dy * dy <= 1 && shade[idx(x, y)] > HI) shade[idx(x, y)] -= 1
    }

  // Front-leg definition: a shadow crease down the middle separates the two
  // front legs, and toe ticks hint at paws.
  {
    const legDX = g.bodyRx * 0.3
    const legTop = Math.round((g.bodyCy + g.bodyRy * 0.42) * SS)
    const pawY = Math.round((g.bodyCy + g.bodyRy * 0.98) * SS)
    const cxp = Math.round(g.bodyCx * SS)
    for (let y = legTop; y <= pawY; y++) {
      if (inB(cxp, y) && fur[idx(cxp, y)]) shade[idx(cxp, y)] = DEEP
      if (inB(cxp - 1, y) && fur[idx(cxp - 1, y)] && shade[idx(cxp - 1, y)] < SHADOW) shade[idx(cxp - 1, y)] = SHADOW
    }
    for (const s of [-1, 1]) {
      const px = Math.round((g.bodyCx + s * legDX) * SS)
      if (inB(px, pawY) && fur[idx(px, pawY)]) shade[idx(px, pawY)] = DEEP
      if (inB(px, pawY - 1) && fur[idx(px, pawY - 1)] && shade[idx(px, pawY - 1)] < SHADOW) shade[idx(px, pawY - 1)] = SHADOW
    }
  }

  applyMarking(region, fur, g, marking)
  drawFace(overlay, fur, g, state)
  return { shade, region, overlay, geom: g, fur }
}

/** Plot one DEVICE pixel (used by primitive callbacks, which already work in device space). */
function put(overlay: Uint8Array, x: number, y: number, role: number): void { if (inB(x, y)) overlay[idx(x, y)] = role }
/** Plot one authored 44-unit point as an SS×SS device block (for hand-placed detail: eyes, nose, glints…). */
function putU(overlay: Uint8Array, ux: number, uy: number, role: number): void {
  const bx = Math.round(ux * SS), by = Math.round(uy * SS), b = blk()
  for (let dy = 0; dy < b; dy++) for (let dx = 0; dx < b; dx++) put(overlay, bx + dx, by + dy, role)
}
/** Like putU, but only over fur pixels (for a nose/detail that must sit on the body). */
function putUFur(overlay: Uint8Array, fur: Uint8Array, ux: number, uy: number, role: number): void {
  const bx = Math.round(ux * SS), by = Math.round(uy * SS), b = blk()
  for (let dy = 0; dy < b; dy++) for (let dx = 0; dx < b; dx++) { const px = bx + dx, py = by + dy; if (inB(px, py) && fur[idx(px, py)]) put(overlay, px, py, role) }
}

/** Corner points of one front-view floppy ear (s = -1 left, +1 right). Shared by the
 * silhouette (buildFur) and the crease (drawFace) so they always line up. */
function floppyEarPts(g: Geom, s: number): { topI: number[]; topO: number[]; botO: number[]; botI: number[] } {
  const earBaseY = g.headCy - g.headRy * 0.55
  const half = g.earW / 2
  const bx = g.headCx + s * g.earSpread
  return {
    topI: [bx - s * half * 0.2, earBaseY - 0.5],                          // inner anchor, on top of the head
    topO: [g.headCx + s * g.headRx * 0.9, earBaseY - 1.5],                // outer anchor, at the head's top edge
    botO: [g.headCx + s * g.headRx * 1.18, g.headCy + g.headRy * 0.62],   // outer tip, flared out past the outline
    botI: [g.headCx + s * g.headRx * 0.66, g.headCy + g.headRy * 0.98]    // inner tip, hanging down by the jaw
  }
}

/** Stamp an OUTLINE stroke along an authored 44-unit segment, but only over fur pixels. */
function lineOutline(overlay: Uint8Array, fur: Uint8Array, x1: number, y1: number, x2: number, y2: number): void {
  x1 *= SS; y1 *= SS; x2 *= SS; y2 *= SS
  const n = Math.ceil(Math.max(Math.abs(x2 - x1), Math.abs(y2 - y1))) * 2 || 1
  const b = blk()
  for (let i = 0; i <= n; i++) {
    const x = Math.round(x1 + (x2 - x1) * (i / n)), y = Math.round(y1 + (y2 - y1) * (i / n))
    for (let dy = 0; dy < b; dy++) for (let dx = 0; dx < b; dx++) if (fur[idx(x + dx, y + dy)]) put(overlay, x + dx, y + dy, O.OUTLINE)
  }
}

function drawFace(overlay: Uint8Array, fur: Uint8Array, g: Geom, state: AnimState): void {
  const earBaseY = g.headCy - g.headRy * 0.55
  if (g.earStyle === 'floppy') for (const s of [-1, 1]) { // crease where the drooping ear overlaps the face
    const e = floppyEarPts(g, s)
    lineOutline(overlay, fur, e.topI[0], e.topI[1], e.botI[0], e.botI[1])
  }
  if (g.earStyle !== 'floppy') for (const s of [-1, 1]) { // floppy (dog) ears show no pink lining from the front
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
      for (let x = Math.round(ex - g.eyeRx); x <= Math.round(ex + g.eyeRx); x++) putU(overlay, x, ey, O.OUTLINE)
      continue
    }
    // Eye shape by style: round = big & open; almond = sleeker/wider with a slit
    // pupil; sleepy = half-lidded under a heavy droop.
    const erx = g.eyeStyle === 'almond' ? g.eyeRx * 1.06 : g.eyeRx
    const ery = g.eyeStyle === 'almond' ? g.eyeRy * 0.72 : g.eyeStyle === 'sleepy' ? g.eyeRy * 0.56 : g.eyeRy
    ellipse((x, y) => put(overlay, x, y, O.IRIS), ex, ey, erx, ery)
    if (g.eyeStyle === 'sleepy') // a heavy droopy lid across the top
      for (let x = Math.round(ex - erx - 1); x <= Math.round(ex + erx + 1); x++) {
        putU(overlay, x, ey - ery, O.OUTLINE)
        putU(overlay, x, ey - ery - 1, O.OUTLINE)
      }
    const look = (state.look || 0) * (g.eyeRx * 0.5)
    // Pupil: round style = a rounder pupil; almond/sleepy = a narrower slit.
    let pupRx = Math.max(0.85, g.eyeRx * (g.eyeStyle === 'round' ? 0.45 : 0.36))
    let pRy = g.eyeStyle === 'round' ? ery * 0.72 : ery * 0.96
    // Pupil dilation (state.dilation 0..1): a narrow slit in bright light (0)
    // widening to a big round pupil in the dark (1). Undefined = resting shape.
    if (state.dilation !== undefined) {
      const d = state.dilation
      pupRx = Math.max(0.6, g.eyeRx * (0.26 + 0.42 * d))
      pRy = ery * (0.96 - 0.24 * d)
    }
    ellipse((x, y) => put(overlay, x, y, O.PUPIL), ex + look, ey + 0.3, pupRx, pRy)
    putU(overlay, ex + look - g.eyeRx * 0.35, ey - ery * 0.4, O.GLINT)
  }

  const nx = g.headCx, ny = g.noseY
  triangle((x, y) => put(overlay, x, y, O.NOSE), nx - 1.6, ny - 1, nx + 1.6, ny - 1, nx, ny + 1.2)
  putU(overlay, nx, ny + 2, O.MOUTH)
  for (const dx of [-2, -1, 1, 2]) putU(overlay, nx + dx, ny + 3, O.MOUTH)

  // Whiskers: a short fan sprouting FROM the cheek. Scan outward per row to find
  // the fur edge, then draw starting immediately adjacent to it (i from 1) so the
  // whiskers attach to the face instead of floating as detached background lines.
  // The middle whisker is longest, so the cluster reads as a whisker fan.
  for (const s of [-1, 1]) {
    for (let k = 0; k < 3; k++) {
      const y = Math.round((g.noseY - 1 + k + (k - 1) * 0.6) * SS) // device row
      let edge = Math.round(g.headCx * SS)
      for (let x = Math.round(g.headCx * SS); inB(x, y); x += s) if (fur[idx(x, y)]) edge = x
      const len = Math.round((k === 1 ? 4 : 3) * SS)
      for (let i = 1; i <= len; i++) {
        const x = edge + s * i
        if (inB(x, y) && overlay[idx(x, y)] === O.NONE && !fur[idx(x, y)]) put(overlay, x, y, O.WHISK)
      }
    }
  }
}

// ---- side-profile walk pose ------------------------------------------------
// A separate pose used while the pet travels: a side view with four legs doing a
// walk cycle (driven by `step` 0..1). Faces right; the renderer flips for left.
// Returns the same shade/region/overlay output so render() works unchanged.
export function generateWalkGrid(preset: Pet, step = 0, motion = 1, excite = 0): Parts {
  // Fit the walk to the pet's build (see rigcat.adaptPose): the barrel grows
  // around the fixed hip line, the head rides the body top and scales, and
  // the stance widens with the body. Feet stay on the ground.
  const g: Geom = { ...defaultGeom(), ...(preset.geom || {}) }
  const kbx = g.bodyRx / 12, kby = g.bodyRy / 11, kh = g.headRx / 11
  const eW = kh * (g.earW / 7.5), eH = kh * (g.earH / 8.5)
  const kLeg = Math.min(1.2, Math.max(0.85, (kbx + kby) / 2))
  const fur = new Uint8Array(W * H)
  const legTag = new Uint8Array(W * H) // 1 = near leg, 2 = far leg
  const set: SetFn = (x, y) => { if (inB(x, y)) fur[idx(x, y)] = 1 }

  const groundY = 43
  // The torso oscillates vertically with the gait (two dips per stride) while the
  // feet stay planted — the legs stretch/compress, so the body doesn't look static.
  // Head and body move as one unit. `motion` (0..) scales the whole effect.
  // `excite` (0..1) turns the calm walk into a prance: bigger bounce, higher
  // knees, a proud lifted head and an upright waving tail.
  // A hop (bunny bound): one big up-arc per cycle with the legs tucking under at
  // the apex, instead of the 4-beat walk. `air` = 0 grounded … 1 at the apex.
  const hop = g.gait === 'hop'
  const ex = Math.min(1.2, excite + (g.gait === 'trot' ? 0.7 : 0)) // trot = a bouncy, lifted walk
  const crouch = g.gait === 'stalk' ? 3 : 0 // stalk = a low, slinking creep
  const air = hop ? Math.sin((((step % 1) + 1) % 1) * Math.PI) : 0
  const bob = hop ? -air * 5 * motion : Math.sin(step * Math.PI * 4) * (1.3 + ex * 1.7) * (g.gait === 'stalk' ? 0.4 : 1) * motion
  const bodyRx = 11.5 * kbx, bodyRy = 7.4 * kby
  const bodyCx = 18, bodyCy = 33.7 - bodyRy * 0.5 + bob + crouch // hip line fixed at 33.7
  const dTop = (bodyCy - bodyRy) - (30 + bob - 7.4)
  const headCx = 32, headCy = 24 + bob + dTop * 0.85 - ex * 2.6 + crouch * 0.7, headR = 7 * kh
  const bodyBottom = bodyCy + bodyRy * 0.5
  const sxw = (x: number): number => bodyCx + (x - bodyCx) * kbx

  // 4-beat LATERAL-SEQUENCE walk (real cat gait): footfalls RH -> RF -> LH -> LF,
  // spaced a quarter-cycle apart, so only one paw is off the ground at a time.
  const legs = [
    { x: 14, ph: 0.0, near: false, back: true }, // RH (back far)
    { x: 26, ph: 0.25, near: false, back: false }, // RF (front far) — under the chest, not the head
    { x: 16, ph: 0.5, near: true, back: true }, // LH (back near)
    { x: 28, ph: 0.75, near: true, back: false } // LF (front near)
  ]
  const seg = (paint: SetFn, x0: number, y0: number, x1: number, y1: number, r0: number, r1: number): void => {
    const n = 7
    for (let t = 0; t <= 1.0001; t += 1 / n) ellipse(paint, x0 + (x1 - x0) * t, y0 + (y1 - y0) * t, r0 + (r1 - r0) * t, r0 + (r1 - r0) * t)
  }
  // Stance = 75% of the cycle. A sets the horizontal foot range so a planted foot
  // slides back exactly as fast as the body advances: STRIDE = 2*A/0.75. (=12.)
  const A = 4.5, LIFT = (3.4 + ex * 2.4) * (g.gait === 'stalk' ? 0.5 : 1), SWING = 0.25
  const drawLeg = (lg: { x: number; ph: number; near: boolean; back: boolean }): void => {
    if (hop) { // all four legs move together: extended at the bottom, tucked at the apex
      const tag = lg.near ? 1 : 2
      const paintH: SetFn = (x, y) => { set(x, y); if (inB(x, y)) legTag[idx(x, y)] = tag }
      const hipX = sxw(lg.x), hipY = bodyBottom
      const footY = groundY - air * (groundY - bodyBottom - 2)
      const footX = hipX + (lg.back ? -2 : 3) * (1 - air)
      const midY = hipY + (footY - hipY) * 0.5 - air * 1.2
      const jointX = lg.back ? hipX - 2 : hipX + 1.5
      seg(paintH, hipX, hipY, jointX, midY, 2.2, 1.5)
      seg(paintH, jointX, midY, footX, footY, 1.5, 1.0)
      ellipse(paintH, footX, footY + 0.2, 1.8, 1.2)
      return
    }
    const p = (((step + lg.ph) % 1) + 1) % 1
    let offX: number, lift: number, flex: number
    if (p < SWING) { const s = p / SWING; offX = -A + s * 2 * A; flex = Math.sin(s * Math.PI); lift = flex * LIFT * (lg.back ? 0.95 : 0.85) }
    else { const s = (p - SWING) / (1 - SWING); offX = A - s * 2 * A; flex = 0; lift = 0 }
    const tag = lg.near ? 1 : 2
    const paint: SetFn = (x, y) => { set(x, y); if (inB(x, y)) legTag[idx(x, y)] = tag }
    const hipX = sxw(lg.x)
    const hipY = bodyBottom
    const footX = sxw(lg.x) + offX
    const footY = groundY - lift
    // The joint folds up a little during swing (knee/hock flexes to lift the paw);
    // kept modest so the step doesn't jump across the few frames.
    const midY = hipY + (footY - hipY) * 0.5 - flex * 1.3
    const jointX = lg.back ? hipX - 2.2 - flex * 0.8 : hipX + offX * 0.2 + 0.5 + flex * 0.7
    seg(paint, hipX, hipY, jointX, midY, 2.2, 1.5)
    seg(paint, jointX, midY, footX, footY, 1.5, 1.0)
    ellipse(paint, footX, footY + 0.2, 1.8, 1.2)
  }
  legs.filter((l) => !l.near).forEach(drawLeg)

  ellipse(set, bodyCx, bodyCy, bodyRx, bodyRy)
  ellipse(set, (bodyCx + headCx) / 2 + 2, (bodyCy + headCy) / 2 + 1, 6, 5)
  // Head with a muzzle pushing forward so it's not a plain ball.
  // Round head, no protruding muzzle — pixel cats read better with a rounded
  // head + a tiny nose near the eye than with a snout + a lone nose (ref study).
  ellipse(set, headCx, headCy, headR * 1.02, headR * 0.98)
  if (g.snout > 0) ellipse(set, headCx + headR * 0.82, headCy + headR * 0.3, g.snout, g.snout * 0.62) // dog muzzle (walk faces right)

  if (g.earStyle === 'floppy') { // a big ear hangs down the side of the head, past the jaw (profile faces right)
    triangle(set, headCx - headR * 0.55, headCy - headR + 2, headCx + headR * 0.12, headCy - headR + 1, headCx + headR * 0.05, headCy + headR * 0.92)
    triangle(set, headCx - headR * 0.55, headCy - headR + 2, headCx + headR * 0.05, headCy + headR * 0.92, headCx - headR * 0.7, headCy + headR * 0.72)
  } else {
    triangle(set, headCx - 4, headCy - headR + 2, headCx, headCy - headR + 2, headCx - 4.5, headCy - headR - 4)
    triangle(set, headCx + 1, headCy - headR + 2, headCx + 5, headCy - headR + 2, headCx + 4, headCy - headR - 4)
  }

  {
    const tailSway = Math.sin(step * Math.PI * 2) * (2 + ex * 1.6) * motion
    // Excited/trotting: the tail rises upright (proud "question-mark" carriage).
    const p0 = [bodyCx - bodyRx * 0.7, bodyCy - 1]
    const p1 = [bodyCx - bodyRx - 4 + ex * 3, bodyCy - 9 - ex * 5]
    const p2 = [bodyCx - bodyRx + 3 + tailSway + ex * 5, bodyCy - 18 - ex * 7]
    const wts = g.tailStyle
    const wtb = 2.6 * (wts === 'bushy' ? 1.8 : wts === 'thin' ? 0.6 : 1)
    const wtEnd = wts === 'nub' ? 0.34 : 1.0001
    for (let t = 0; t <= wtEnd; t += 0.05) {
      const it = 1 - t
      const r = wts === 'nub' ? wtb * (1 - t * 0.4) : wtb - t * (wts === 'bushy' ? 0.5 : 1.1)
      ellipse(set, it * it * p0[0] + 2 * it * t * p1[0] + t * t * p2[0], it * it * p0[1] + 2 * it * t * p1[1] + t * t * p2[1], r, r)
    }
  }

  legs.filter((l) => l.near).forEach(drawLeg)

  const shade = new Uint8Array(W * H)
  const region = new Uint8Array(W * H)
  const overlay = new Uint8Array(W * H)

  // Lock the coat pattern to the ACTUAL body/head position so it moves with the
  // fur as one unit — essential for the big gaits (hop/trot), where anchoring to
  // a rest position would leave the pattern sliding off the airborne body.
  sideMarking(region, fur, { hcx: headCx, hcy: headCy, hr: headR, bcx: bodyCx, bcy: bodyCy, brx: bodyRx, bry: bodyRy, groundY, faceSign: 1 }, preset.marking || 'solid')

  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) {
      if (fur[idx(x, y)]) continue
      let near = false
      for (let dy = -1; dy <= 1 && !near; dy++)
        for (let dx = -1; dx <= 1; dx++)
          if (inB(x + dx, y + dy) && fur[idx(x + dx, y + dy)]) { near = true; break }
      if (near) overlay[idx(x, y)] = O.OUTLINE
    }

  const inHead = (x: number, y: number): boolean => ((x / SS - headCx) / (headR + 0.5)) ** 2 + ((y / SS - headCy) / (headR + 0.5)) ** 2 <= 1.05
  const inBody = (x: number, y: number): boolean => ((x / SS - bodyCx) / (bodyRx + 0.5)) ** 2 + ((y / SS - bodyCy) / (bodyRy + 0.5)) ** 2 <= 1.05
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

  if (g.earStyle === 'floppy') // crease along the ear's front edge, separating the flap from the cheek
    lineOutline(overlay, fur, headCx + headR * 0.12, headCy - headR + 1, headCx + headR * 0.05, headCy + headR * 0.92)
  if (g.earStyle !== 'floppy')
    triangle((x, y) => { if (fur[idx(x, y)] && overlay[idx(x, y)] !== O.OUTLINE) put(overlay, x, y, O.INEAR) },
      headCx + 2, headCy - headR + 1.5, headCx + 3.6, headCy - headR + 1.5, headCx + 3.2, headCy - headR - 1)
  const wes = g.eyeStyle
  const wiry = wes === 'almond' ? 1.5 : wes === 'sleepy' ? 1.15 : 2
  ellipse((x, y) => put(overlay, x, y, O.IRIS), headCx + 1.6, headCy - 0.5, 1.7, wiry)
  ellipse((x, y) => put(overlay, x, y, O.PUPIL), headCx + 2, headCy - 0.3, wes === 'round' ? 0.9 : 0.66, Math.min(1.4, wiry * 0.95))
  putU(overlay, headCx + 1.2, headCy - 1.3, O.GLINT)
  if (wes === 'sleepy') for (const dx of [-1, 0, 1, 2]) putU(overlay, headCx + 1 + dx, headCy - 0.5 - wiry, O.OUTLINE)
  // Just a tiny nose at the front of the face (no mouth line — a dark trail on
  // a white profile reads as a smudge, ref cats keep it to the nose).
  if (g.snout > 0) { // dog nose on the muzzle tip
    ellipse((x, y) => { if (fur[idx(x, y)]) put(overlay, x, y, O.NOSE) }, headCx + headR * 0.82 + g.snout * 0.85, headCy + headR * 0.32, 1.3, 1.1)
  } else {
    putUFur(overlay, fur, headCx + headR - 1, headCy + 0.8, O.NOSE)
  }

  return { shade, region, overlay, geom: defaultGeom(), fur }
}

// ---- curled-up sleep pose --------------------------------------------------
// Side profile of a curled sleeping cat (ref: a cat curled nose-to-paws).
// Head lowered on the LEFT resting by the front paws, back arching up behind,
// tail wrapping the base to close the loop. `breath` (radians) drives a slow
// belly rise/fall (the base stays planted on the ground).
export function generateCurlGrid(_preset: Pet, breath = 0): Parts {
  const fur = new Uint8Array(W * H)
  const head = new Uint8Array(W * H), tail = new Uint8Array(W * H), paw = new Uint8Array(W * H)
  const stamp = (mask: Uint8Array | null): SetFn => (x, y) => { if (inB(x, y)) { fur[idx(x, y)] = 1; if (mask) mask[idx(x, y)] = 1 } }
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
  const is = (mask: Uint8Array, x: number, y: number): boolean => inB(x, y) && !!mask[idx(x, y)]

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
      if (!head[i] && y >= (g - 1) * SS) shade[i] = SHADOW // grounded base
    }

  // Soft creases only where forms overlap — a light touch keeps it from looking busy.
  const crease = (mask: Uint8Array, aboveOnly: boolean): void => {
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
  putU(overlay, 20, g - 3, O.OUTLINE) // hint of a gap between the two paws

  // Closed eye (a short down-curved line), pink nose at the muzzle tip, inner near-ear.
  putU(overlay, hx - 4, hy, O.OUTLINE); putU(overlay, hx - 3, hy + 1, O.OUTLINE)
  putU(overlay, hx - 2, hy + 1, O.OUTLINE); putU(overlay, hx - 1, hy + 1, O.OUTLINE)
  putU(overlay, hx - 7, hy + 3, O.NOSE); putU(overlay, hx - 6, hy + 3, O.NOSE); putU(overlay, hx - 6, hy + 4, O.NOSE)
  triangle((x, y) => { if (head[idx(x, y)] && overlay[idx(x, y)] !== O.OUTLINE) put(overlay, x, y, O.INEAR) },
    hx - 4.2, hy - hr + 2.5, hx - 2.8, hy - hr + 2.5, hx - 3.6, hy - hr)

  return { shade, region, overlay, geom: defaultGeom(), fur }
}

function hexToRgb(h: string): [number, number, number] {
  h = h.replace('#', '')
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)]
}
function mix(a: number[], b: number[], t: number): [number, number, number] {
  return [Math.round(a[0] + (b[0] - a[0]) * t), Math.round(a[1] + (b[1] - a[1]) * t), Math.round(a[2] + (b[2] - a[2]) * t)]
}
export function ramp(hex: string): number[][] {
  const c = hexToRgb(hex)
  return [mix(c, [255, 255, 255], 0.34), c, mix(c, [0, 0, 0], 0.16), mix(c, [0, 0, 0], 0.34)]
}

interface ResolvedCoat {
  ramps: Record<number, number[][]>
  iris: number[]; pupil: number[]; glint: number[]; nose: number[]
  inEar: number[]; mouth: number[]; whisk: number[]; outline: number[]
}
export function resolveCoat(spec: CoatSpec): ResolvedCoat {
  const white = spec.white || '#f6f6f8'
  return {
    ramps: { [P]: ramp(spec.primary), [S]: ramp(spec.secondary || spec.primary), [WHITE]: ramp(white), [T]: ramp(spec.tertiary || '#33333a') },
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

export function render(parts: Parts, coatSpec: CoatSpec): Uint8ClampedArray {
  const coat = resolveCoat(coatSpec)
  const { shade, region, overlay } = parts
  const rgba = new Uint8ClampedArray(W * H * 4)
  for (let i = 0; i < W * H; i++) {
    let col: number[] | null = null
    const ov = overlay[i]
    if (ov === O.OUTLINE) col = coat.outline
    else if (ov === O.IRIS) col = coat.iris
    else if (ov === O.PUPIL) col = coat.pupil
    else if (ov === O.GLINT) col = coat.glint
    else if (ov === O.NOSE) col = coat.nose
    else if (ov === O.INEAR) col = coat.inEar
    else if (ov === O.MOUTH) col = coat.mouth
    else if (ov === O.WHISK) col = coat.whisk
    else if (ov === O.CONE) col = CONE_COLOR
    else if (ov === O.CONE_HI) col = CONE_HI_COLOR
    else if (shade[i]) col = coat.ramps[region[i]][shade[i] - 1]
    if (!col) continue
    rgba[i * 4] = col[0]
    rgba[i * 4 + 1] = col[1]
    rgba[i * 4 + 2] = col[2]
    rgba[i * 4 + 3] = 255
  }
  return rgba
}

/** Convenience: pet + state -> RGBA. */
export function renderCat(pet: Pet, state: AnimState = {}): { w: number; h: number; rgba: Uint8ClampedArray } {
  return { w: W, h: H, rgba: render(generateGrid(pet, state), pet.coat) }
}

/**
 * Internal drawing primitives, shared with the pose/rig generators (rigcat,
 * turn34) so the raster helpers exist in exactly one place.
 */
export const internals = { ellipse, triangle, idx, inB, put, putU, putUFur, lineOutline, sphereBright, shadeLevel, ss: () => SS, O, HI, BASE, SHADOW, DEEP }
