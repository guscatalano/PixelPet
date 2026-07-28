// Proves Independence actually changes where your pet goes.
//
//   npm run proof:wander
//
// "An aloof cat takes itself off somewhere else" is a claim about many walks, so
// it can't be eyeballed — and a sign error would produce the exact opposite
// personality while looking perfectly plausible on screen.
//
// wander.ts is pure TypeScript with no imports, so this runs the REAL chooser:
// transpile it with the esbuild electron-vite already ships and import that.
import { transformSync } from 'esbuild'
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const src = readFileSync(resolve(root, 'src/main/behavior/wander.ts'), 'utf8')
const js = transformSync(src, { loader: 'ts', format: 'esm' }).code
const { pickWanderTarget } = await import('data:text/javascript;base64,' + Buffer.from(js).toString('base64'))

// A fixed 1920-wide desktop, the pet 220px wide, you at the far left (x = 200).
const MIN_X = 0, MAX_X = 1700, HALF_W = 110, CURSOR = 200
// Deterministic RNG so a run either always passes or always fails.
let seed = 12345
const rnd = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff }

/** Mean distance from the cursor over many walks, at one independence level. */
const meanDistance = (independence, n = 4000) => {
  let total = 0
  for (let i = 0; i < n; i++) {
    const t = pickWanderTarget({ minX: MIN_X, maxX: MAX_X, halfW: HALF_W, cursorX: CURSOR, independence, rnd })
    total += Math.abs(t + HALF_W - CURSOR)
  }
  return total / n
}

let failures = 0
const check = (ok, msg) => { if (!ok) { failures++; console.log(`  FAIL  ${msg}`) } else console.log(`  PASS  ${msg}`) }

console.log('\nmean distance from the pointer, over 4000 walks each\n')
const clingy = meanDistance(0)
const neutral = meanDistance(0.5)
const aloof = meanDistance(1)
for (const [label, v] of [['independence 0.0 (clingy) ', clingy], ['independence 0.5 (neutral)', neutral], ['independence 1.0 (aloof)  ', aloof]]) {
  console.log(`  ${label}  ${Math.round(v)}px`)
}

console.log('\n1. the trait points the right way\n')
check(clingy < neutral, 'a dependent pet settles CLOSER to you than a neutral one')
check(aloof > neutral, 'an independent pet goes FURTHER away than a neutral one')
check(aloof - clingy > 250, `the two ends are clearly different (${Math.round(aloof - clingy)}px apart)`)

console.log('\n2. it leans, it does not lock on\n')
const spread = new Set()
for (let i = 0; i < 400; i++) spread.add(Math.round(pickWanderTarget({ minX: MIN_X, maxX: MAX_X, halfW: HALF_W, cursorX: CURSOR, independence: 0, rnd }) / 100))
check(spread.size >= 6, `even at full clinginess it still picks varied spots (${spread.size} distinct bands)`)

console.log('\n3. degenerate inputs stay in bounds\n')
for (const [label, o] of [
  ['pointer on another display', { cursorX: null, independence: 1 }],
  ['neutral trait, no lean    ', { cursorX: CURSOR, independence: 0.5 }],
  ['zero-width work area      ', { cursorX: CURSOR, independence: 1, minX: 500, maxX: 500 }]
]) {
  const opts = { minX: MIN_X, maxX: MAX_X, halfW: HALF_W, rnd, ...o }
  let ok = true
  for (let i = 0; i < 200; i++) {
    const t = pickWanderTarget(opts)
    if (!Number.isFinite(t) || t < opts.minX || t > opts.maxX) { ok = false; break }
  }
  check(ok, `${label} — always a finite in-range target`)
}

console.log(failures ? `\n${failures} check(s) failed\n` : '\nall checks passed\n')
process.exit(failures ? 1 : 0)
