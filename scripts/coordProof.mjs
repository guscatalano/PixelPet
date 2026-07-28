// Proves window coordinates can never trip Electron's native int conversion.
//
//   npm run proof:coords
//
// Electron's setPosition/setBounds take a C++ int, and V8's IsInt32Double is
// what decides whether a JS number qualifies:
//
//   value >= kMinInt && value <= kMaxInt && !IsMinusZero(value) && integral
//
// Anything else throws "Error processing argument at index N, conversion
// failure from ...". Thrown from inside the pet's 16ms physics interval, that
// takes the whole app down — it has done so in the field twice, most recently
// from a plain Math.round(-0.2), which is -0.
//
// `acceptable` below is that C++ check restated in JS. It was verified against
// a real BrowserWindow: setPosition(-0, 5), (3e9, 5) and (NaN, 5) all throw,
// and every value winCoord returns is accepted.
//
// coords.ts is pure TypeScript with no imports, so this runs the REAL module:
// transpile it with the esbuild electron-vite already ships and import the
// result. No test runner, and no duplicated copy of the logic to drift.
import { transformSync } from 'esbuild'
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const src = readFileSync(resolve(root, 'src/main/desktop/coords.ts'), 'utf8')
const js = transformSync(src, { loader: 'ts', format: 'esm' }).code
const { winCoord, clampWinCoord, winPoint } =
  await import('data:text/javascript;base64,' + Buffer.from(js).toString('base64'))

/** Exactly what Electron will accept in an int slot. */
const acceptable = (n) =>
  Number.isInteger(n) && n >= -(2 ** 31) && n <= 2 ** 31 - 1 && !Object.is(n, -0)

const NASTY = [
  -0.2, -0.4999, -0, 0, 0.2, -1e-9, // the -0 family: the crash we actually saw
  NaN, Infinity, -Infinity,
  3e9, -3e9, 1e300, Number.MAX_SAFE_INTEGER, -Number.MAX_SAFE_INTEGER,
  1919.5, -1080.5, 42, -42, 1 << 20, -(1 << 20), (1 << 20) + 1
]

let failures = 0
const check = (ok, msg) => {
  if (!ok) { failures++; console.log(`  FAIL  ${msg}`) }
  else console.log(`  PASS  ${msg}`)
}
const show = (n) => (Object.is(n, -0) ? '-0' : String(n))

console.log('\n1. winCoord never returns something Electron would reject\n')
for (const n of NASTY) {
  const r = winCoord(n)
  check(r === null || acceptable(r), `winCoord(${show(n)}) -> ${r === null ? 'null' : show(r)}`)
}

console.log('\n2. clampWinCoord always produces a usable coordinate\n')
for (const n of NASTY) {
  const r = clampWinCoord(n)
  check(acceptable(r), `clampWinCoord(${show(n)}) -> ${show(r)}`)
}

console.log('\n3. the -0 case specifically — this is the crash\n')
check(Object.is(Math.round(-0.2), -0), 'Math.round(-0.2) is -0 (the hazard is real)')
check(!acceptable(Math.round(-0.2)), 'Electron would reject a raw Math.round(-0.2)')
check(Object.is(winCoord(-0.2), 0), 'winCoord(-0.2) is +0, not -0')
check(Object.is(clampWinCoord(-0.2), 0), 'clampWinCoord(-0.2) is +0, not -0')
check(Object.is(winPoint(-0.2, -0.3).x, 0) && Object.is(winPoint(-0.2, -0.3).y, 0), 'winPoint collapses both axes')

console.log('\n4. real positions survive unchanged\n')
check(winCoord(1919.5) === 1920, 'winCoord(1919.5) rounds to 1920')
check(winCoord(-1080.4) === -1080, 'winCoord(-1080.4) rounds to -1080 (negative screens are legal)')
check(winCoord(3e9) === null, 'winCoord(3e9) is rejected, not silently wrapped')
check(winCoord(NaN) === null, 'winCoord(NaN) is rejected')

console.log(failures ? `\n${failures} check(s) failed\n` : '\nall checks passed\n')
process.exit(failures ? 1 : 0)
