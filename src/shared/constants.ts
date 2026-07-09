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
export const MIN_SCALE = 3
export const MAX_SCALE = 7

/**
 * Vertical headroom, in native sprite pixels, reserved above and below the sprite
 * so idle bob / walk hop / react pop can move it without clipping the window.
 */
export const BOB_AMPLITUDE = 3

/** Where, within the window, the sprite sits when bob offset is zero (native px from top). */
export const SPRITE_TOP = BOB_AMPLITUDE

/** Pet window content size for a given scale (vertical headroom added top & bottom). */
export function petWindowSize(scale: number): { width: number; height: number } {
  return { width: SPRITE_W * scale, height: (SPRITE_H + BOB_AMPLITUDE * 2) * scale }
}
