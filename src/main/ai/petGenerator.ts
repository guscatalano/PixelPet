// Orchestrates "generate a pet from photos": run the configured vision provider,
// then map its structured DNA to a renderable AppPet with a fresh user id.

import { randomUUID } from 'node:crypto'
import { describeCat, type VisionImage, type VisionConfig } from './providers'
import { dnaToPet } from '../../shared/petdna'
import type { AppPet } from '../../shared/pets'

/** Parse a `data:<mediaType>;base64,<data>` URL into a VisionImage. */
export function dataUrlToImage(dataUrl: string): VisionImage {
  const m = /^data:([^;]+);base64,(.+)$/s.exec(dataUrl)
  if (!m) throw new Error('Unsupported image (expected a base64 data URL).')
  return { mediaType: m[1], data: m[2] }
}

export async function generatePetFromPhotos(images: VisionImage[], cfg: VisionConfig): Promise<AppPet> {
  if (!images.length) throw new Error('No photo provided.')
  const raw = await describeCat(images, cfg)
  return dnaToPet(raw, `user-${randomUUID().slice(0, 8)}`)
}
