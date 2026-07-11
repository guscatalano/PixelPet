import { contextBridge, ipcRenderer } from 'electron'

// Bridge for the dream bubble window. Main pushes a photo (data URL) to show;
// the window is decorative (click-through), so this is receive-only.
const api = {
  onPhoto: (handler: (dataUrl: string) => void): void => {
    ipcRenderer.on('dream:photo', (_e, dataUrl: string) => handler(dataUrl))
  }
}

contextBridge.exposeInMainWorld('dream', api)

export type DreamApi = typeof api
