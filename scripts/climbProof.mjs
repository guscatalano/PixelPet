// Proves the pet can climb onto a window, and loses its footing when that window
// is covered. Both behaviours are emergent and depend on the live desktop, so
// this drives them deliberately instead of waiting for an ambient roll.
//
//   npm run build && npx electron scripts/climbProof.mjs
//
// Phase 1 is pure math (the jump arc). Phase 2 spawns a real pet against decoy
// windows at known rects and watches where it ends up. Exits non-zero on failure.
import { app, BrowserWindow, screen } from 'electron'
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
const MAX_JUMP_RISE = 300

// Where the decoys go, laid out against the primary work area rather than fixed
// coordinates. They were once hard-coded for a 1920x1080 screen; on a smaller
// one the "ledge" sat at floor level and off the right edge, so the climb passed
// trivially (the pet was already standing at that height) and the knock and the
// fall could never happen. The pet starts bottom-right (index.ts
// defaultPetPosition) and stands on the floor, i.e. the work area's bottom edge,
// so: a ledge whose top is RISE above the floor — within MAX_JUMP_RISE, and tall
// enough that a fall is unmistakable — spanning the pet's starting x; and a
// cover that buries the ledge's top edge where the pet stands on it.
const RISE = 240
let LEDGE, COVER
function layout() {
  const wa = screen.getPrimaryDisplay().workArea
  const floor = wa.y + wa.height
  const rise = Math.min(RISE, Math.round(wa.height * 0.4))
  const w = Math.min(560, Math.round(wa.width * 0.45))
  const x = wa.x + wa.width - 60 - w
  LEDGE = { title: 'PIXELPET-DECOY', x, y: floor - rise, w, h: rise }
  COVER = { title: 'PIXELPET-COVER', x: x + 60, y: floor - rise - 70, w: 620, h: 340 }
  console.log(`   work area ${wa.width}x${wa.height}: ledge ${LEDGE.w}x${LEDGE.h} at ${LEDGE.x},${LEDGE.y} (${rise}px up)`)
  return rise
}

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
/** The string toy: a taller-than-wide overlay hung above the pet. Matched by
 *  aspect (outer bounds, so 180x340 measures a touch wider) — distinct from the
 *  pet, whose window is squarer at every size. */
const stringOf = (wins) => wins.find((w) => w.h > w.w * 1.4 && w.h > 250 && w.w < 260) ?? null

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
    title: spec.title, backgroundColor: '#204060', autoHideMenuBar: true,
    // On top, so a stray desktop window can't bury the ledge mid-test: the pet
    // now (correctly) refuses to stand on a window edge it can't see, which
    // otherwise makes this test hostage to whatever else is open. The cover
    // window is also topmost and shown later, so it still lands above.
    alwaysOnTop: true
  })
  w.setTitle(spec.title)
  w.loadURL(`data:text/html,<title>${spec.title}</title><body style="background:%23204060">`)
  return w
}

// ---- Phase 2: a real pet on a real desktop ------------------------------------
async function phaseLive() {
  console.log('\n2. live climb onto a window, then lose the footing under it')
  const rise = layout()
  // A fall is only told apart from standing still by a 120px drop (see the cover
  // check), and a ledge the pet can't reach proves nothing, so refuse to run on a
  // screen that can't fit a meaningful one rather than pass vacuously.
  if (rise < 150 || rise > MAX_JUMP_RISE) {
    check(false, 'screen is big enough for a meaningful ledge', `only ${rise}px of rise available`)
    return
  }
  const probe = makeProbe()
  const profile = mkdtempSync(join(tmpdir(), 'pixelpet-climb-'))
  // 'bat' is disabled so an AMBIENT string hunt can't leap the pet off the ledge
  // mid-assertion — the forced --play-clip=bat below bypasses the toggle.
  writeFileSync(join(profile, 'settings.json'), '{"scale":4,"detail":1,"disabledAnims":["bat"]}')

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

  // Nudge every ~8s rather than betting everything on one command landing at a
  // good moment: ambient life can pull the pet off the ledge (a wander off the
  // far side, a bold hop down), which is the pet being a cat, not a failure.
  // Success is four consecutive samples on the ledge, i.e. it settled there.
  const NUDGE_EVERY = 16 // samples (× 500ms)
  let settled = 0, best = Infinity, nudges = 0
  for (let i = 0; i < 120 && settled < 4; i++) {
    if (i % NUDGE_EVERY === 0) {
      nudges++
      spawnSync(process.execPath, ['.', `--user-data-dir=${profile}`, `--goto-window=${LEDGE.title}`], { cwd: root, stdio: 'ignore' })
    }
    await sleep(500)
    const r = petOf(probe(pet.pid))
    if (!r) continue
    const bottom = r.y + r.h
    best = Math.min(best, bottom)
    settled = Math.abs(bottom - LEDGE.y) <= 30 ? settled + 1 : 0
  }
  check(settled >= 4, 'climbed onto the ledge and stayed', `ledge y=${LEDGE.y}, best bottom edge y=${best}, ${nudges} nudge(s)`)

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

  // The string toy needs no ledge — force a hunt and watch it happen: the
  // overlay appears, the pet leaves the ground at it at least once, and the
  // whole session cleans itself up. (Whether the rope LOOKS right needs eyes.)
  {
    const before = probe(pet.pid).length
    const ground = petOf(probe(pet.pid))
    spawnSync(process.execPath, ['.', `--user-data-dir=${profile}`, '--play-clip=bat'], { cwd: root, stdio: 'ignore' })
    let str = null
    for (let i = 0; i < 30 && !str; i++) {
      await sleep(150)
      str = stringOf(probe(pet.pid))
    }
    check(!!str, 'the string toy appeared', str ? `overlay ${str.w}x${str.h} at ${str.x},${str.y}` : `no new overlay (had ${before} windows)`)
    if (str && ground) {
      // A session is stare→stalk→crouch→LEAP — the pet must leave the ground.
      // A session is up to two rounds, each possibly with a stalk — allow 40s.
      let jumped = false, highest = ground.y + ground.h
      let gone = false
      for (let i = 0; i < 160 && !gone; i++) {
        await sleep(250)
        const p = petOf(probe(pet.pid))
        if (p) {
          const bottom = p.y + p.h
          highest = Math.min(highest, bottom)
          if (ground.y + ground.h - bottom > 25) jumped = true
        }
        gone = !stringOf(probe(pet.pid))
      }
      check(jumped, 'the pet leapt at the string', `rose ${ground.y + ground.h - highest}px off the ground`)
      check(gone, 'the session ended and the string left')
    }
  }

  // Hiding the pet must take its other windows with it. Reported from the field:
  // hide the cat mid-string-play and the string was left hanging on an empty
  // desktop. Worse, the engine kept running, so a hidden cat could start a fresh
  // hunt and put a NEW string up on its own — hence the second wait below.
  {
    const cli = (...a) => spawnSync(process.execPath, ['.', `--user-data-dir=${profile}`, ...a], { cwd: root, stdio: 'ignore' })
    cli('--set-visible=1') // make sure we start from shown
    cli('--play-clip=bat')
    let str = null
    for (let i = 0; i < 30 && !str; i++) { await sleep(150); str = stringOf(probe(pet.pid)) }
    if (!str) {
      check(false, 'string toy came back up for the hide test', 'never appeared, so the hide could not be tested')
    } else {
      cli('--set-visible=0')
      let cleared = false
      for (let i = 0; i < 20 && !cleared; i++) { await sleep(200); cleared = !stringOf(probe(pet.pid)) }
      check(cleared, 'hiding the pet took the string toy with it')
      // Nothing may reappear while hidden — the behaviour has to be stood down.
      let respawn = null
      for (let i = 0; i < 24 && !respawn; i++) { await sleep(250); respawn = stringOf(probe(pet.pid)) }
      check(!respawn, 'no overlay came back while the pet was hidden', respawn ? `a ${respawn.w}x${respawn.h} window reappeared` : 'quiet for 6s')
      cli('--set-visible=1')
      let back = null
      for (let i = 0; i < 20 && !back; i++) { await sleep(200); back = petOf(probe(pet.pid)) }
      check(!!back, 'the pet came back when shown again')
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
