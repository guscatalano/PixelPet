// The desktop as a set of "platforms" (window top edges + the work-area floor)
// that the pet can stand on. Refreshed periodically from the live window list.

import { screen } from 'electron'
import { enumWindows, type WinRect } from './windows'
import { winPoint } from './coords'

let platforms: WinRect[] = []

/** Re-read the live window list (call on a throttle; FFI is cheap but not free). */
export function refreshPlatforms(): void {
  platforms = process.platform === 'win32' ? enumWindows() : []
}

/**
 * Is the point (x, y) on platform `i`'s top edge hidden underneath a window that
 * sits above it in the z-order? `platforms` comes back topmost-first, so anything
 * earlier in the list is in front.
 *
 * Without this the pet stands on window tops it can't actually see: raise another
 * window over the one it's on and it keeps standing on the buried edge, apparently
 * floating in the middle of whatever is now in front. Honouring z-order means the
 * support genuinely disappears when a window is covered, and the pet falls to
 * whatever is really beneath it.
 */
function buriedAt(i: number, x: number, y: number): boolean {
  for (let j = 0; j < i; j++) {
    const o = platforms[j]
    if (x >= o.x && x <= o.x + o.w && y >= o.y && y <= o.y + o.h) return true
  }
  return false
}

/** A window top the pet could jump UP onto: where to land, and how high it is. */
export interface Ledge { x: number; y: number }

/** Below this a "climb" is just a hop; the pet should walk instead. */
const MIN_RISE = 34

/**
 * Candidate ledges ABOVE the feet, within `maxRise` up and `maxReach` sideways.
 *
 * This is the complement of supportY(): that answers "what am I standing on", so
 * it deliberately only sees platforms at or below the feet. Nothing asked the
 * opposite question, which is why the pet could only ever fall downhill and
 * ended up living on the taskbar.
 */
export function ledgesAbove(feetX: number, feetY: number, maxRise: number, maxReach: number): Ledge[] {
  const out: Ledge[] = []
  for (let i = 0; i < platforms.length; i++) {
    const w = platforms[i]
    const rise = feetY - w.y
    if (rise < MIN_RISE || rise > maxRise) continue
    // Aim inside the edge, so the pet isn't teetering the instant it lands.
    const margin = Math.min(26, w.w / 2)
    const lo = w.x + margin, hi = w.x + w.w - margin
    if (hi <= lo) continue
    const x = Math.max(lo, Math.min(hi, feetX))
    if (Math.abs(x - feetX) > maxReach) continue
    if (buriedAt(i, x, w.y)) continue // don't jump onto a ledge that's behind something
    out.push({ x, y: w.y })
  }
  return out
}

/**
 * The surface the pet's feet rest on at horizontal position `feetX`, given its
 * current `feetY`: the highest window-top that is at or below the feet and
 * horizontally under them, or the work-area bottom (taskbar top / screen floor).
 */
export function supportY(feetX: number, feetY: number): number {
  const tol = 6 // lets the pet "stick" to a ledge it's standing on
  let best = Infinity
  for (let i = 0; i < platforms.length; i++) {
    const w = platforms[i]
    if (feetX < w.x || feetX > w.x + w.w) continue // not over this window
    if (!(w.y >= feetY - tol && w.y < best)) continue // nearest top at/below the feet
    if (buriedAt(i, feetX, w.y)) continue // that edge is behind another window
    best = w.y
  }
  const disp = screen.getDisplayNearestPoint(winPoint(feetX, feetY))
  const floor = disp.workArea.y + disp.workArea.height
  return Math.min(best, floor)
}
