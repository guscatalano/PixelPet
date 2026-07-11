// API-key storage, kept out of settings.json and never sent to the renderer.
// Encrypted at rest with Electron safeStorage (DPAPI on Windows) when available;
// falls back to obfuscated-but-plaintext with a flag so load knows how to read it.

import { app, safeStorage } from 'electron'
import { readFileSync, writeFileSync, existsSync, rmSync } from 'node:fs'
import { join } from 'node:path'

const keyPath = (): string => join(app.getPath('userData'), 'ai-key.json')

export function encryptionAvailable(): boolean {
  try {
    return safeStorage.isEncryptionAvailable()
  } catch {
    return false
  }
}

export function saveApiKey(plain: string): void {
  if (!plain) {
    clearApiKey()
    return
  }
  const enc = encryptionAvailable()
  const data = enc
    ? safeStorage.encryptString(plain).toString('base64')
    : Buffer.from(plain, 'utf8').toString('base64')
  writeFileSync(keyPath(), JSON.stringify({ enc, data }))
}

export function loadApiKey(): string | null {
  try {
    const j = JSON.parse(readFileSync(keyPath(), 'utf8')) as { enc?: boolean; data?: unknown }
    if (typeof j.data !== 'string') return null
    const buf = Buffer.from(j.data, 'base64')
    return j.enc ? safeStorage.decryptString(buf) : buf.toString('utf8')
  } catch {
    return null
  }
}

export function hasApiKey(): boolean {
  return existsSync(keyPath())
}

export function clearApiKey(): void {
  try {
    rmSync(keyPath())
  } catch {
    /* already gone */
  }
}
