// Shared rendering constants used by both the main process (window sizing)
// and the renderer (canvas drawing).

import { W, H } from './catgen'

/** Native sprite dimensions in pixels, from the generator. */
export const SPRITE_W = W
export const SPRITE_H = H

/**
 * Integer upscale factor from native pixels to on-screen pixels (nearest-neighbor).
 * This is the *default*; the user can change it in Settings, so treat the live
 * value as runtime state (main tracks it; the renderer derives it from its window
 * size). Kept integer so pixels stay crisp.
 */
export const DEFAULT_SCALE = 4

/**
 * The selectable pet sizes. Steps are deliberately uneven: at the small end each
 * whole step DOUBLES the pet (1 -> 2 is +100%), while at the large end it adds a
 * sixth (6 -> 7 is +17%), so the bottom of the range gets quarter-steps and the
 * top keeps whole ones.
 *
 * Quarter-steps are the finest that stay honest: 44 divides by 4, so the window
 * WIDTH is always a whole number of pixels and the renderer can recover the exact
 * scale from it. (The height is rounded — a half pixel of slack below the feet.)
 */
export const SIZE_LEVELS: readonly number[] = [1, 1.25, 1.5, 1.75, 2, 3, 4, 5, 6, 7]
export const MIN_SCALE: number = SIZE_LEVELS[0] // 44px — a tiny 1:1 pet
export const MAX_SCALE: number = SIZE_LEVELS[SIZE_LEVELS.length - 1]

/** Snap an arbitrary scale to the nearest selectable size. */
export function snapScale(v: number): number {
  if (!Number.isFinite(v)) return DEFAULT_SCALE
  let best = SIZE_LEVELS[0]
  for (const s of SIZE_LEVELS) if (Math.abs(s - v) < Math.abs(best - v)) best = s
  return best
}

/**
 * Vertical headroom, in native sprite pixels, reserved above and below the sprite
 * so idle bob / walk hop / react pop can move it without clipping the window.
 */
export const BOB_AMPLITUDE = 3

/** Where, within the window, the sprite sits when bob offset is zero (native px from top). */
export const SPRITE_TOP = BOB_AMPLITUDE

/** Pet window content size for a given scale (vertical headroom added top & bottom).
 *  Rounded, since fractional sizes can land the height on a half pixel. */
export function petWindowSize(scale: number): { width: number; height: number } {
  return {
    width: Math.round(SPRITE_W * scale),
    height: Math.round((SPRITE_H + BOB_AMPLITUDE * 2) * scale)
  }
}
