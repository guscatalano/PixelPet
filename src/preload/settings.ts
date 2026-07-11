import { contextBridge, ipcRenderer } from 'electron'
import type { AppSettings, Personality } from '../shared/types'

// Typed bridge exposed to the settings window as `window.settings`.
const api = {
  /** Fetch the current persisted settings. */
  get: (): Promise<AppSettings> => ipcRenderer.invoke('settings:get'),
  /** Make `petId` the active desktop pet (swaps live + persists). */
  setPet: (petId: string): void => ipcRenderer.send('settings:set-pet', petId),
  /** Set the on-screen pet size (integer upscale factor). */
  setScale: (scale: number): void => ipcRenderer.send('settings:set-scale', scale),
  /** Set the ¾-turn speed (ms per keyframe; lower = snappier). */
  setTurnMs: (ms: number): void => ipcRenderer.send('settings:set-turnms', ms),
  /** Override one personality trait of a pet (live if it's the active pet). */
  setTrait: (petId: string, key: keyof Personality, value: number): void =>
    ipcRenderer.send('settings:set-trait', { petId, key, value }),
  /** Reset a pet's personality back to its preset defaults. */
  resetTraits: (petId: string): void => ipcRenderer.send('settings:reset-traits', petId)
}

contextBridge.exposeInMainWorld('settings', api)

export type SettingsApi = typeof api
