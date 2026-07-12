import { contextBridge, ipcRenderer } from 'electron'

// Bridge for the dream bubble window. Main pushes a photo (data URL) to show.
// The window is normally click-through; when the pointer is over the bubble the
// renderer flips it interactive so a double-click can open the photo full-size.
const api = {
  onPhoto: (handler: (dataUrl: string) => void): void => {
    ipcRenderer.on('dream:photo', (_e, dataUrl: string) => handler(dataUrl))
  },
  /** Toggle whether the window captures the mouse (over the bubble) or is click-through. */
  setInteractive: (on: boolean): void => { ipcRenderer.send('dream:set-interactive', on) },
  /** Ask main to open the current dream photo in a large viewer. */
  openViewer: (): void => { ipcRenderer.send('dream:open-viewer') }
}

contextBridge.exposeInMainWorld('dream', api)

export type DreamApi = typeof api
