// Coordinates on their way into Electron's native window APIs (setPosition,
// setBounds, getDisplayNearestPoint). Those take a C++ int, and V8 only calls a
// number an Int32 if it fits in int32 range AND is not negative zero. Anything
// else is rejected with:
//
//   Error processing argument at index 0, conversion failure from
//
// which, thrown from inside the 16ms physics interval, takes the whole app down.
//
// The trap is -0. Math.round() returns -0 for ANY input in (-0.5, 0], so a cat
// resting against the left edge of the primary display at x = -0.2 produces one
// on the very next tick. It slipped past two guards at once: Number.isFinite(-0)
// is true, and -0 === 0 is also true, so the physics tick's "has it actually
// moved?" check saw no change in x and still passed the -0 through when y moved.
// Use these helpers anywhere a computed (rather than integer) coordinate is
// about to cross that boundary.

/** Well past the far corner of any real multi-monitor desktop. */
const LIMIT = 1 << 20

/**
 * Round `n` to a coordinate Electron will accept, or null if it is not a usable
 * position at all — NaN, Infinity, or so far off the desktop that it can only
 * mean the physics has gone wrong and the caller should recover rather than
 * place the window there. Callers that must place something use clampWinCoord.
 */
export function winCoord(n: number): number | null {
  if (!Number.isFinite(n)) return null
  const r = Math.round(n)
  if (r < -LIMIT || r > LIMIT) return null
  // `r === 0` is true for -0 too; returning the literal collapses it to +0.
  return r === 0 ? 0 : r
}

/** Like winCoord, but never fails: unusable values fold to the nearest limit. */
export function clampWinCoord(n: number): number {
  const c = winCoord(n)
  if (c !== null) return c
  return Number.isFinite(n) ? (n < 0 ? -LIMIT : LIMIT) : 0
}

/** A point safe to hand to screen.getDisplayNearestPoint / getDisplayMatching. */
export function winPoint(x: number, y: number): { x: number; y: number } {
  return { x: clampWinCoord(x), y: clampWinCoord(y) }
}
