import { contextBridge, ipcRenderer } from 'electron'

// The dangling string toy. One channel: main tells the string when a paw
// connected, so it can swing properly instead of the swing being guessed from a
// timeline that has to stay in step with the cat's animation.
const api = {
  /** A paw just hit the string — swing it. */
  onHit: (handler: () => void): void => {
    ipcRenderer.on('string:hit', () => handler())
  }
}

contextBridge.exposeInMainWorld('stringToy', api)

export type StringToyApi = typeof api
