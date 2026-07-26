export {} // module (for the global augmentation below)

interface StringApi {
  onCfg: (handler: (cfg: { pivotX: number; pivotY: number; ropeLen: number }) => void) => void
  onPivot: (handler: (p: { x: number; y: number }) => void) => void
  onHit: (handler: (v: { vx: number; vy: number }) => void) => void
  onCatch: (handler: (p: { x: number; y: number }) => void) => void
  onRelease: (handler: () => void) => void
}
declare global {
  interface Window { stringToy: StringApi }
}

// ---- A small Verlet rope ------------------------------------------------------
// The reason this file exists: a string is floppy. The bottom lags the top,
// bends, whips on a hit and settles — none of which a rotated line does. Ten
// points, gravity, and a few constraint passes are all it takes.

const N = 10 // rope points, pivot included
const GRAV = 0.28 // per substep — a light string, so it floats a little
const DAMP = 0.988 // air drag; lower = the whip dies faster
const ITER = 4 // constraint passes per substep
const SUBSTEPS = 2

const canvas = document.getElementById('c') as HTMLCanvasElement
const ctx = canvas.getContext('2d')!
const dpr = window.devicePixelRatio || 1

interface Pt { x: number; y: number; px: number; py: number }
let pts: Pt[] = []
let segLen = 15
let pivotTarget = { x: 0, y: -200 }
let pivot = { x: 0, y: -200 }
let pin: { x: number; y: number } | null = null
let started = false

function initRope(px: number, py: number, ropeLen: number): void {
  segLen = ropeLen / (N - 1)
  pivot = { x: px, y: py }
  pivotTarget = { x: px, y: py }
  // Born hanging straight down from the pivot (usually above the window top, so
  // the drop-in is just the pivot descending and the rope following).
  pts = Array.from({ length: N }, (_, i) => ({ x: px, y: py + i * segLen, px, py: py + i * segLen }))
  started = true
}

function substep(): void {
  // The pivot chases its target — the lag is what makes fast pulls whip.
  pivot.x += (pivotTarget.x - pivot.x) * 0.30
  pivot.y += (pivotTarget.y - pivot.y) * 0.30

  for (let i = 1; i < N; i++) {
    const p = pts[i]
    const vx = (p.x - p.px) * DAMP
    const vy = (p.y - p.py) * DAMP
    p.px = p.x
    p.py = p.y
    p.x += vx
    p.y += vy + GRAV
  }
  // Distance constraints, with the pinned ends re-asserted each pass — a few
  // iterations converge fine at this length and it keeps the solver dumb.
  for (let k = 0; k < ITER; k++) {
    pts[0].x = pivot.x
    pts[0].y = pivot.y
    if (pin) { pts[N - 1].x = pin.x; pts[N - 1].y = pin.y }
    for (let i = 0; i < N - 1; i++) {
      const a = pts[i], b = pts[i + 1]
      const dx = b.x - a.x, dy = b.y - a.y
      const d = Math.hypot(dx, dy) || 0.0001
      const off = ((d - segLen) / d) * 0.5
      a.x += dx * off
      a.y += dy * off
      b.x -= dx * off
      b.y -= dy * off
    }
  }
  pts[0].x = pivot.x
  pts[0].y = pivot.y
  if (pin) { pts[N - 1].x = pin.x; pts[N - 1].y = pin.y }

  // Soft boundary: a hard whip must not throw the rope out of the window. Damp
  // the velocity as points cross back in, so it settles rather than pinballing.
  const margin = 6
  const maxX = window.innerWidth - margin
  const maxY = window.innerHeight - margin
  for (let i = 1; i < N; i++) {
    const p = pts[i]
    if (p.x < margin) { p.px = p.x + (p.x - p.px) * 0.4; p.x = margin }
    else if (p.x > maxX) { p.px = p.x + (p.x - p.px) * 0.4; p.x = maxX }
    if (p.y > maxY) { p.py = p.y + (p.y - p.py) * 0.4; p.y = maxY }
  }
}

function draw(): void {
  ctx.clearRect(0, 0, canvas.width, canvas.height)
  ctx.save()
  ctx.scale(dpr, dpr)
  // The cord: a smooth curve through the points, pale with a darker core so it
  // reads against both light and dark desktops.
  for (const [width, color] of [[3, 'rgba(38,40,56,0.55)'], [1.6, '#e6eaf6']] as Array<[number, string]>) {
    ctx.beginPath()
    ctx.moveTo(pts[0].x, pts[0].y)
    for (let i = 1; i < N - 1; i++) {
      const mx = (pts[i].x + pts[i + 1].x) / 2
      const my = (pts[i].y + pts[i + 1].y) / 2
      ctx.quadraticCurveTo(pts[i].x, pts[i].y, mx, my)
    }
    ctx.lineTo(pts[N - 1].x, pts[N - 1].y)
    ctx.lineWidth = width
    ctx.strokeStyle = color
    ctx.lineCap = 'round'
    ctx.stroke()
  }
  // The knot on the end — the thing the eye (and the cat) tracks.
  const k = pts[N - 1]
  ctx.beginPath()
  ctx.arc(k.x, k.y, 5, 0, Math.PI * 2)
  ctx.fillStyle = '#f3c73e'
  ctx.fill()
  ctx.beginPath()
  ctx.arc(k.x + 1.2, k.y + 1.4, 5, 0, Math.PI * 2)
  ctx.strokeStyle = 'rgba(0,0,0,0.28)'
  ctx.lineWidth = 1.6
  ctx.stroke()
  ctx.restore()
}

function frame(): void {
  if (started) {
    for (let s = 0; s < SUBSTEPS; s++) substep()
    draw()
  }
  requestAnimationFrame(frame)
}

function resize(): void {
  canvas.width = Math.round(window.innerWidth * dpr)
  canvas.height = Math.round(window.innerHeight * dpr)
}
resize()
window.addEventListener('resize', resize)
requestAnimationFrame(frame)

// ---- driven by the engine, via main -------------------------------------------
window.stringToy.onCfg((cfg) => initRope(cfg.pivotX, cfg.pivotY, cfg.ropeLen))
window.stringToy.onPivot((p) => { pivotTarget = { x: p.x, y: p.y } })
window.stringToy.onHit((v) => {
  // A paw connected: throw the lower third of the rope. Velocity in Verlet is
  // position minus previous position, so an impulse is just shoving `p`.
  if (!started) return
  for (let i = N - 4; i < N; i++) {
    const w = (i - (N - 5)) / 4 // heavier toward the knot
    pts[i].x += v.vx * w
    pts[i].y += v.vy * w
  }
})
window.stringToy.onCatch((p) => { pin = { x: p.x, y: p.y } })
window.stringToy.onRelease(() => {
  pin = null
  // Prey squirming free: a little upward kick as it escapes.
  for (let i = N - 3; i < N; i++) { pts[i].y -= 3; pts[i].x += 2 - Math.random() * 4 }
})
