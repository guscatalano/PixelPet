import { contextBridge, ipcRenderer } from 'electron'
import type { AppSettings, AiConfig, AiStatus, ClipName, Personality } from '../shared/types'
import type { AppPet } from '../shared/pets'
import type { CareStatus, CareAction, Difficulty } from '../shared/care'
import type { ImmichStatus, ImmichConfig } from '../shared/types'

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
  /** Toggle dream bubbles while the cat sleeps. */
  setDreamMode: (v: boolean): void => ipcRenderer.send('settings:set-dreammode', v),
  /** Set the chance (0..1) that a nap shows a dream. */
  setDreamChance: (v: number): void => ipcRenderer.send('settings:set-dreamchance', v),
  /** Set the dream bubble size multiplier (~0.6–2). */
  setDreamBubbleScale: (v: number): void => ipcRenderer.send('settings:set-dreambubblescale', v),

  // ---- Immich dream album ----
  immichStatus: (): Promise<ImmichStatus> => ipcRenderer.invoke('immich:status'),
  setImmichConfig: (cfg: Partial<ImmichConfig>): void => ipcRenderer.send('immich:set-config', cfg),
  setImmichKey: (key: string): Promise<ImmichStatus> => ipcRenderer.invoke('immich:set-key', key),
  clearImmichKey: (): Promise<ImmichStatus> => ipcRenderer.invoke('immich:clear-key'),
  testImmich: (): Promise<{ ok: boolean; message: string }> => ipcRenderer.invoke('immich:test'),

  // ---- Care Mode ----
  /** Turn Care ("Tamagotchi") mode on/off. */
  setCareMode: (v: boolean): void => ipcRenderer.send('settings:set-caremode', v),
  /** Set how fast needs decay. */
  setDifficulty: (d: Difficulty): void => ipcRenderer.send('settings:set-difficulty', d),
  /** Current needs + felt state (null if the engine isn't up yet). */
  careStatus: (): Promise<CareStatus | null> => ipcRenderer.invoke('care:get'),
  /** Feed / play / rest / groom / heal the cat. */
  careAction: (action: CareAction): void => ipcRenderer.send('care:action', action),
  /** Replace the set of turned-off animations. */
  setDisabledAnims: (disabled: ClipName[]): void => ipcRenderer.send('settings:set-anims', disabled),
  /** Remember the pet-picker filter. */
  setPetFilter: (f: 'all' | 'builtin' | 'user'): void => ipcRenderer.send('settings:set-petfilter', f),
  /** Play a clip on the live desktop cat (the "try an animation" gallery). */
  playClip: (clip: ClipName): void => ipcRenderer.send('settings:play-clip', clip),
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
  deleteUserPet: (petId: string): void => ipcRenderer.send('pets:delete-user', petId),
  /** Rename any cat (empty name clears the override back to its default). */
  renamePet: (petId: string, name: string): void => ipcRenderer.send('pets:rename', { petId, name })
}

contextBridge.exposeInMainWorld('settings', api)

export type SettingsApi = typeof api
