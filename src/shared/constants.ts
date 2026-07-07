// Shared rendering constants used by both the main process (window sizing)
// and the renderer (canvas drawing).

import { W, H } from './catgen'

/** Native sprite dimensions in pixels, from the generator. */
export const SPRITE_W = W
export const SPRITE_H = H

/** Integer upscale factor from native pixels to on-screen pixels (nearest-neighbor). */
export const SCALE = 4

/**
 * Vertical headroom, in native sprite pixels, reserved above and below the sprite
 * so idle bob / walk hop / react pop can move it without clipping the window.
 */
export const BOB_AMPLITUDE = 3

/**
 * Pet window content size. We add vertical headroom equal to the bob amplitude
 * (top and bottom) so the sprite can bob without being clipped.
 */
export const PET_W = SPRITE_W * SCALE
export const PET_H = (SPRITE_H + BOB_AMPLITUDE * 2) * SCALE

/** Where, within the window, the sprite sits when bob offset is zero (native px from top). */
export const SPRITE_TOP = BOB_AMPLITUDE
