// Immich album source for Dream Mode. The user's self-hosted Immich holds a big
// photo album; we pull its image thumbnails (small webp, ~16KB) into the dream
// pool. Key is stored encrypted (safeStorage), separate from settings.json.

import { app, safeStorage } from 'electron'
import { readFileSync, writeFileSync, existsSync, rmSync } from 'node:fs'
import { join } from 'node:path'

const keyPath = (): string => join(app.getPath('userData'), 'immich-key.json')

export function saveImmichKey(plain: string): void {
  if (!plain) { clearImmichKey(); return }
  let enc = false
  try { enc = safeStorage.isEncryptionAvailable() } catch { enc = false }
  const data = enc ? safeStorage.encryptString(plain).toString('base64') : Buffer.from(plain, 'utf8').toString('base64')
  writeFileSync(keyPath(), JSON.stringify({ enc, data }))
}
export function loadImmichKey(): string | null {
  try {
    const j = JSON.parse(readFileSync(keyPath(), 'utf8')) as { enc?: boolean; data?: unknown }
    if (typeof j.data !== 'string') return null
    const buf = Buffer.from(j.data, 'base64')
    return j.enc ? safeStorage.decryptString(buf) : buf.toString('utf8')
  } catch {
    return null
  }
}
export function hasImmichKey(): boolean { return existsSync(keyPath()) }
export function clearImmichKey(): void { try { rmSync(keyPath()) } catch { /* gone */ } }

const base = (url: string): string => url.trim().replace(/\/+$/, '')

/** Fetch the album's IMAGE asset ids (shuffled so dreams vary run to run). */
export async function fetchAlbumImageIds(serverUrl: string, albumId: string, key: string): Promise<string[]> {
  const res = await fetch(`${base(serverUrl)}/api/albums/${albumId}`, { headers: { 'x-api-key': key, accept: 'application/json' } })
  if (!res.ok) throw new Error(`Immich album HTTP ${res.status}`)
  const j = (await res.json()) as { assets?: Array<{ id?: string; type?: string }> }
  const ids = (Array.isArray(j.assets) ? j.assets : []).filter((a) => a?.type === 'IMAGE' && a.id).map((a) => a.id as string)
  for (let i = ids.length - 1; i > 0; i--) { const k = Math.floor(Math.random() * (i + 1)); [ids[i], ids[k]] = [ids[k], ids[i]] }
  return ids
}

/** Fetch one asset's small thumbnail as a data URL (null on failure). */
export async function fetchThumbnailDataUrl(serverUrl: string, assetId: string, key: string): Promise<string | null> {
  try {
    const res = await fetch(`${base(serverUrl)}/api/assets/${assetId}/thumbnail?size=thumbnail`, { headers: { 'x-api-key': key } })
    if (!res.ok) return null
    const buf = Buffer.from(await res.arrayBuffer())
    const ct = res.headers.get('content-type') || 'image/webp'
    return `data:${ct};base64,` + buf.toString('base64')
  } catch {
    return null
  }
}

/** Cheap credential/album check for the settings UI. */
export async function testImmich(serverUrl: string, albumId: string, key: string): Promise<{ ok: boolean; message: string }> {
  if (!serverUrl.trim() || !albumId.trim()) return { ok: false, message: 'Enter the server URL and album id.' }
  if (!key) return { ok: false, message: 'Enter an API key.' }
  try {
    const ids = await fetchAlbumImageIds(serverUrl, albumId, key)
    return { ok: true, message: `Connected — ${ids.length} photos in the album.` }
  } catch (err) {
    return { ok: false, message: err instanceof Error ? err.message : String(err) }
  }
}
