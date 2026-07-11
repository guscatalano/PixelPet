// The desktop as a set of "platforms" (window top edges + the work-area floor)
// that the pet can stand on. Refreshed periodically from the live window list.

import { screen } from 'electron'
import { enumWindows, type WinRect } from './windows'

let platforms: WinRect[] = []

/** Re-read the live window list (call on a throttle; FFI is cheap but not free). */
export function refreshPlatforms(): void {
  platforms = process.platform === 'win32' ? enumWindows() : []
}

/**
 * The surface the pet's feet rest on at horizontal position `feetX`, given its
 * current `feetY`: the highest window-top that is at or below the feet and
 * horizontally under them, or the work-area bottom (taskbar top / screen floor).
 */
export function supportY(feetX: number, feetY: number): number {
  const tol = 6 // lets the pet "stick" to a ledge it's standing on
  let best = Infinity
  for (const w of platforms) {
    if (feetX < w.x || feetX > w.x + w.w) continue // not over this window
    if (w.y >= feetY - tol && w.y < best) best = w.y // nearest top at/below the feet
  }
  const disp = screen.getDisplayNearestPoint({ x: Math.round(feetX), y: Math.round(feetY) })
  const floor = disp.workArea.y + disp.workArea.height
  return Math.min(best, floor)
}
