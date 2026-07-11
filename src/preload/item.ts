import { contextBridge, ipcRenderer } from 'electron'

// Bridge for a draggable care item (food bowl / toy / medicine). The whole tiny
// window is the item; main cursor-follows it while dragging and, on release,
// checks whether it landed on the cat.
const api = {
  dragStart: (): void => ipcRenderer.send('item:drag-start'),
  dragEnd: (): void => ipcRenderer.send('item:drag-end'),
  onSetItem: (handler: (kind: string) => void): void => {
    ipcRenderer.on('item:set', (_e, kind: string) => handler(kind))
  }
}

contextBridge.exposeInMainWorld('item', api)

export type ItemApi = typeof api
