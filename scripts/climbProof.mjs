// Proves the pet can climb onto a window, and loses its footing when that window
// is covered. Both behaviours are emergent and depend on the live desktop, so
// this drives them deliberately instead of waiting for an ambient roll.
//
//   npm run build && npx electron scripts/climbProof.mjs
//
// Phase 1 is pure math (the jump arc). Phase 2 spawns a real pet against decoy
// windows at known rects and watches where it ends up. Exits non-zero on failure.
import { app, BrowserWindow } from 'electron'
import { spawn, spawnSync } from 'node:child_process'
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, resolve, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url) // koffi is a native CJS addon

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')

// Keep in sync with the same constants in src/main/behavior/engine.ts.
const GRAVITY = 0.45
const JUMP_CLEAR = 16
const MAX_JUMP_VX = 5.5

// Where the decoys go. The ledge must be within MAX_JUMP_RISE of where the pet
// starts (bottom-right of the work area) or no single jump can reach it.
const LEDGE = { title: 'PIXELPET-DECOY', x: 1300, y: 760, w: 560, h: 280 }
const COVER = { title: 'PIXELPET-COVER', x: 1360, y: 690, w: 620, h: 340 }

let failures = 0
const check = (ok, label, detail = '') => {
  if (!ok) failures++
  console.log(`   ${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? '  —  ' + detail : ''}`)
}

// ---- Phase 1: the arc ---------------------------------------------------------
// The impulse is derived from continuous motion but executed by a discrete
// per-tick loop, so re-run it through the real integration and confirm the pet
// still clears the ledge and lands close enough to the aim point.
function simulate(rise, dx) {
  const vy = -Math.sqrt(2 * GRAVITY * (rise + JUMP_CLEAR))
  const disc = vy * vy - 2 * GRAVITY * rise
  if (disc < 0) return { rejected: 'unreachable' }
  const t = (-vy + Math.sqrt(disc)) / GRAVITY
  const vx = dx / t
  if (!Number.isFinite(vx) || Math.abs(vx) > MAX_JUMP_VX) return { rejected: 'vx over cap' }
  let x = 0, y = 0, v = vy, apex = 0
  for (let tick = 0; tick < 600; tick++) {
    v = Math.min(9, v + GRAVITY)
    y += v
    x += vx
    apex = Math.min(apex, y)
    if (v > 0 && y >= -rise) return { clear: -apex - rise, xErr: x - dx, ticks: tick + 1 }
  }
  return { rejected: 'never landed' }
}

function phaseArc() {
  console.log('\n1. jump arc, run through the engine\'s discrete integration')
  for (const [rise, dx] of [[40, 60], [90, 120], [150, 80], [220, 180], [300, 120]]) {
    const r = simulate(rise, dx)
    if (r.rejected) { check(false, `rise ${rise} dx ${dx}`, r.rejected); continue }
    check(
      r.clear > 0 && Math.abs(r.xErr) < 26,
      `rise ${rise} dx ${dx}`,
      `clearance ${r.clear.toFixed(1)}px, landing error ${r.xErr.toFixed(1)}px, ${(r.ticks * 16 / 1000).toFixed(2)}s`
    )
  }
  // The cap must actually reject absurd arcs rather than letting the pet fly.
  check(simulate(150, 200).rejected === 'vx over cap', 'a 200px sideways jump at 150px up is declined')
}

// ---- Win32 polling ------------------------------------------------------------
// GetWindowRect by pid. Screenshots are useless here: the pet moves every 16ms,
// so capture-then-locate is never atomic.
function makeProbe() {
  const koffi = require('koffi')
  const user32 = koffi.load('user32.dll')
  koffi.struct('PRECT', { left: 'long', top: 'long', right: 'long', bottom: 'long' })
  const EnumWindows = user32.func('bool __stdcall EnumWindows(void* lpEnumFunc, intptr lParam)')
  const GetWindowRect = user32.func('bool __stdcall GetWindowRect(void* hWnd, _Out_ PRECT* r)')
  const IsWindowVisible = user32.func('bool __stdcall IsWindowVisible(void* hWnd)')
  const GetWindowThreadProcessId = user32.func('uint32 __stdcall GetWindowThreadProcessId(void* hWnd, _Out_ uint32* pid)')
  const PROC = koffi.proto('bool __stdcall PROC(void* hwnd, intptr lParam)')

  // Returns every visible window owned by the pid, so callers can pick out the
  // pet overlay or the transient knocked-object strip by shape.
  return (wantPid) => {
    const all = []
    const cb = koffi.register((hwnd) => {
      try {
        const out = [0]
        GetWindowThreadProcessId(hwnd, out)
        if (out[0] !== wantPid || !IsWindowVisible(hwnd)) return true
        const r = { left: 0, top: 0, right: 0, bottom: 0 }
        if (!GetWindowRect(hwnd, r)) return true
        all.push({ x: r.left, y: r.top, w: r.right - r.left, h: r.bottom - r.top })
      } catch { /* a window can vanish mid-enum */ }
      return true
    }, koffi.pointer(PROC))
    EnumWindows(cb, 0)
    koffi.unregister(cb)
    return all
  }
}

/** The pet overlay: the package's only small roughly-square window. */
const petOf = (wins) => wins.find((w) => w.w > 20 && w.w < 400 && w.h > 20 && w.h < 400 && w.h < w.w * 3) ?? null
/** The knocked object: a narrow vertical strip spanning ledge to floor. Matched
 *  by aspect, not width — GetWindowRect includes invisible borders, so the 40px
 *  strip measures wider than it was asked to be. */
const knockedOf = (wins) => wins.find((w) => w.h > w.w * 2.5 && w.h > 100) ?? null

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
/** Bin the throwaway profile. The just-killed pet may still hold GPU cache
 *  handles for a moment, and a leaked temp dir must never fail the run. */
function cleanup(dir) {
  try {
    rmSync(dir, { recursive: true, force: true, maxRetries: 8, retryDelay: 250 })
  } catch {
    console.log(`   (left ${dir} behind — the pet still had it open)`)
  }
}
const decoy = (spec) => {
  const w = new BrowserWindow({
    x: spec.x, y: spec.y, width: spec.w, height: spec.h,
    title: spec.title, backgroundColor: '#204060', autoHideMenuBar: true
  })
  w.setTitle(spec.title)
  w.loadURL(`data:text/html,<title>${spec.title}</title><body style="background:%23204060">`)
  return w
}

// ---- Phase 2: a real pet on a real desktop ------------------------------------
async function phaseLive() {
  console.log('\n2. live climb onto a window, then lose the footing under it')
  const probe = makeProbe()
  const profile = mkdtempSync(join(tmpdir(), 'pixelpet-climb-'))
  writeFileSync(join(profile, 'settings.json'), '{"scale":4,"detail":1}')

  const ledge = decoy(LEDGE)
  await sleep(1500)

  // process.execPath is the electron binary we're already running under.
  // inherit: the pet's own main-process logs land in the harness output, which is
  // the only way to see them (Electron does not write to stdout on Windows).
  const pet = spawn(process.execPath, ['.', `--user-data-dir=${profile}`], { cwd: root, stdio: 'inherit' })
  await sleep(8000)

  const start = petOf(probe(pet.pid))
  if (!start) {
    check(false, 'pet window found')
    pet.kill(); ledge.destroy(); rmSync(profile, { recursive: true, force: true })
    return
  }
  console.log(`   pet starts at ${start.x},${start.y} — bottom edge y=${start.y + start.h}`)

  // Drive the climb deliberately. The =value form is required: Chromium rewrites
  // the forwarded command line, so a space-separated value does not survive.
  spawnSync(process.execPath, ['.', `--user-data-dir=${profile}`, `--goto-window=${LEDGE.title}`], { cwd: root, stdio: 'ignore' })

  let settled = 0, best = Infinity
  for (let i = 0; i < 90 && settled < 4; i++) {
    await sleep(500)
    const r = petOf(probe(pet.pid))
    if (!r) continue
    const bottom = r.y + r.h
    best = Math.min(best, bottom)
    settled = Math.abs(bottom - LEDGE.y) <= 30 ? settled + 1 : 0
  }
  check(settled >= 4, 'climbed onto the ledge and stayed', `ledge y=${LEDGE.y}, best bottom edge y=${best}`)

  if (settled >= 4) {
    // Knock something off. There is nothing to drop unless the pet is genuinely
    // up on the ledge at the moment of the swipe, and it may well have wandered
    // back down while the previous check was settling — so put it back first,
    // and give it a couple of goes.
    let obj = null
    for (let attempt = 0; attempt < 3 && !obj; attempt++) {
      const up = () => { const p = petOf(probe(pet.pid)); return p && Math.abs(p.y + p.h - LEDGE.y) <= 30 }
      if (!up()) {
        spawnSync(process.execPath, ['.', `--user-data-dir=${profile}`, `--goto-window=${LEDGE.title}`], { cwd: root, stdio: 'ignore' })
        for (let i = 0; i < 30 && !up(); i++) await sleep(500)
      }
      if (!up()) continue
      spawnSync(process.execPath, ['.', `--user-data-dir=${profile}`, '--play-clip=knock'], { cwd: root, stdio: 'ignore' })
      // The swipe lands ~1.3s in and the object lives ~1.15s after that.
      for (let i = 0; i < 26 && !obj; i++) {
        await sleep(150)
        obj = knockedOf(probe(pet.pid))
      }
    }
    check(
      !!obj,
      'something went over the edge',
      obj ? `strip ${obj.w}x${obj.h} at ${obj.x},${obj.y} — falls to y=${obj.y + obj.h}` : 'no falling object appeared'
    )
    if (obj) {
      // And it must clean itself up rather than sitting on the desktop forever.
      let gone = false
      for (let i = 0; i < 20 && !gone; i++) { await sleep(200); gone = !knockedOf(probe(pet.pid)) }
      check(gone, 'the object cleaned itself up')
    }
  }

  if (settled >= 4) {
    const cover = decoy(COVER)
    cover.moveTop()
    let fell = false, last = 0
    for (let i = 0; i < 30 && !fell; i++) {
      await sleep(500)
      const r = petOf(probe(pet.pid))
      if (!r) continue
      last = r.y + r.h
      if (last > LEDGE.y + 120) fell = true
    }
    check(fell, 'fell once its window was covered', `bottom edge y=${last}`)
    cover.destroy()
  }

  pet.kill()
  ledge.destroy()
  cleanup(profile)
}

app.on('window-all-closed', () => {})
app.whenReady().then(async () => {
  try {
    phaseArc()
    if (process.platform === 'win32') await phaseLive()
    else console.log('\n2. skipped — the live phase needs Win32 window enumeration')
  } catch (e) {
    console.error('harness error', e)
    failures++
  }
  console.log(failures ? `\n${failures} check(s) FAILED` : '\nall checks passed')
  app.exit(failures ? 1 : 0)
})
