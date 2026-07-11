import { contextBridge, ipcRenderer } from 'electron'
import type { AppSettings, AiConfig, AiStatus, ClipName, Personality } from '../shared/types'
import type { AppPet } from '../shared/pets'

type GenResult = { ok: true; pet: AppPet } | { ok: false; error: string }

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
  /** Toggle "stay here" mode (the cat holds its spot). */
  setStayPut: (v: boolean): void => ipcRenderer.send('settings:set-stayput', v),
  /** Set the facing-you view scale (0.65 small .. 1.0 "coming at you"). */
  setFrontScale: (k: number): void => ipcRenderer.send('settings:set-frontscale', k),
  /** Toggle time-of-day pupil dilation. */
  setPupilsByTime: (v: boolean): void => ipcRenderer.send('settings:set-pupils', v),
  /** Replace the set of turned-off animations. */
  setDisabledAnims: (disabled: ClipName[]): void => ipcRenderer.send('settings:set-anims', disabled),
  /** Override one personality trait of a pet (live if it's the active pet). */
  setTrait: (petId: string, key: keyof Personality, value: number): void =>
    ipcRenderer.send('settings:set-trait', { petId, key, value }),
  /** Reset a pet's personality back to its preset defaults. */
  resetTraits: (petId: string): void => ipcRenderer.send('settings:reset-traits', petId),

  // ---- AI / generate-from-photo ----
  /** Current AI status (provider/model/endpoint/hasKey/encryption); never the key. */
  aiStatus: (): Promise<AiStatus> => ipcRenderer.invoke('ai:status'),
  /** Persist non-secret AI config (provider/model/endpoint). */
  setAiConfig: (cfg: Partial<AiConfig>): void => ipcRenderer.send('ai:set-config', cfg),
  /** Save (encrypt) the API key; returns refreshed status. */
  setAiKey: (key: string): Promise<AiStatus> => ipcRenderer.invoke('ai:set-key', key),
  /** Forget the stored API key; returns refreshed status. */
  clearAiKey: (): Promise<AiStatus> => ipcRenderer.invoke('ai:clear-key'),
  /** Cheap credentials/model check. */
  testAi: (): Promise<{ ok: boolean; message: string }> => ipcRenderer.invoke('ai:test'),
  /** Generate a pet from photo data URLs; on success it's added + made active. */
  generateFromPhotos: (dataUrls: string[]): Promise<GenResult> => ipcRenderer.invoke('ai:generate', dataUrls),
  /** Delete a user-generated pet. */
  deleteUserPet: (petId: string): void => ipcRenderer.send('pets:delete-user', petId)
}

contextBridge.exposeInMainWorld('settings', api)

export type SettingsApi = typeof api
