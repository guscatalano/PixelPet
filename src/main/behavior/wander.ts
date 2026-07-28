// Choosing WHERE to wander to.
//
// Split out from engine.ts and kept free of imports so it can be tested on its
// own (see scripts/wanderProof.mjs) — "an aloof cat takes itself off somewhere
// else" is a statistical claim about many walks, which is exactly the kind of
// thing that is easy to get backwards and impossible to eyeball.

export interface WanderPick {
  /** Leftmost / rightmost window x the pet may end up at. */
  minX: number
  maxX: number
  /** Half the pet window's width — candidates are compared centre to cursor. */
  halfW: number
  /** Pointer x, or null when it isn't on this display (then the choice is free). */
  cursorX: number | null
  /** 0 = clingy, 1 = aloof. */
  independence: number
  /** Injected so the proof can drive it deterministically. */
  rnd: () => number
}

/** How many candidate spots to weigh up. More = a stronger, less varied lean. */
const CANDIDATES = 3
/** Below this the pull is not worth acting on, so the walk stays plain random. */
const DEADZONE = 0.15

/**
 * Pick a wander destination. Independence decides which end of the room looks
 * appealing: a self-contained cat takes itself away from your pointer, a
 * dependent one comes and settles near it. We sample a few random spots and keep
 * the best rather than aiming straight at the cursor, so the walk still looks
 * like a cat choosing somewhere and not a magnet.
 */
export function pickWanderTarget(o: WanderPick): number {
  const span = Math.max(1, o.maxX - o.minX)
  // The floor on `span` keeps the score finite when there is nowhere to go, but
  // it would also let the pick land past maxX — so clamp rather than trust it.
  const pick = (): number => Math.min(o.maxX, Math.max(o.minX, Math.round(o.minX + o.rnd() * span)))
  const pull = 1 - 2 * o.independence // +1 toward you, -1 away
  if (o.cursorX === null || Math.abs(pull) <= DEADZONE) return pick()
  let best = pick(), bestScore = -Infinity
  for (let k = 0; k < CANDIDATES; k++) {
    const cand = k === 0 ? best : pick()
    // 1 next to the pointer, 0 at the far end; `pull` flips it for an aloof cat.
    const near = 1 - Math.abs(cand + o.halfW - o.cursorX) / span
    const score = pull * near
    if (score > bestScore) { bestScore = score; best = cand }
  }
  return best
}
