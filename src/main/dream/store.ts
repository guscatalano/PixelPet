// Dream Mode photo storage. A cat's source photos (what it was generated from)
// are saved per-pet so it can dream of them while sleeping. Files live under
// userData/pets/<petId>/; the dream window never touches disk — main reads a
// file to a data URL and hands it over.

import { app } from 'electron'
import { mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from 'node:fs'
import { join } from 'node:path'

const petDir = (petId: string): string => join(app.getPath('userData'), 'pets', petId)

/** Save downscaled source photos (data URLs) for a pet; returns the file paths. */
export function saveSourcePhotos(petId: string, dataUrls: string[]): string[] {
  const dir = petDir(petId)
  const paths: string[] = []
  try {
    mkdirSync(dir, { recursive: true })
    dataUrls.slice(0, 4).forEach((url, i) => {
      const m = /^data:([^;]+);base64,(.+)$/s.exec(url)
      if (!m) return
      const ext = m[1].includes('png') ? 'png' : m[1].includes('webp') ? 'webp' : 'jpg'
      const p = join(dir, `dream-${i}.${ext}`)
      writeFileSync(p, Buffer.from(m[2], 'base64'))
      paths.push(p)
    })
  } catch (err) {
    console.error('[dream] failed to save source photos', err)
  }
  return paths
}

/** Read a photo file as a data URL for the dream window (null if missing/unreadable). */
export function readPhotoDataUrl(path: string): string | null {
  try {
    if (!existsSync(path)) return null
    const ext = path.split('.').pop()?.toLowerCase()
    const mime = ext === 'png' ? 'image/png' : ext === 'webp' ? 'image/webp' : 'image/jpeg'
    return `data:${mime};base64,` + readFileSync(path).toString('base64')
  } catch {
    return null
  }
}

/** Remove a pet's saved photos (on delete). */
export function deletePetPhotos(petId: string): void {
  try {
    rmSync(petDir(petId), { recursive: true, force: true })
  } catch {
    /* already gone */
  }
}
