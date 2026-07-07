import { contextBridge, ipcRenderer } from 'electron'
import type { PlayCommand, TriggerEvent } from '../shared/types'

// Typed bridge exposed to the pet renderer as `window.pet`.
const api = {
  /** Toggle window click-through. Pass true to let clicks pass through. */
  setIgnoreMouse: (ignore: boolean): void =>
    ipcRenderer.send('pet:set-ignore-mouse', ignore),
  /** Begin cursor-follow dragging (main moves the window). */
  dragStart: (): void => ipcRenderer.send('pet:drag-start'),
  /** End dragging. */
  dragEnd: (): void => ipcRenderer.send('pet:drag-end'),
  /** Report an input event (hover/click/...) to the behavior engine. */
  sendTrigger: (ev: TriggerEvent): void => ipcRenderer.send('pet:trigger', ev),
  /** Notify main that a one-shot clip finished playing. */
  clipEnded: (clip: string): void => ipcRenderer.send('pet:clip-ended', clip),
  /** Subscribe to animation-state commands from the behavior engine. */
  onPlay: (handler: (cmd: PlayCommand) => void): void => {
    ipcRenderer.on('pet:play', (_e, cmd: PlayCommand) => handler(cmd))
  }
}

contextBridge.exposeInMainWorld('pet', api)

export type PetApi = typeof api
