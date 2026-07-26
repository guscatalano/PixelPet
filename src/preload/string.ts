import { contextBridge, ipcRenderer } from 'electron'

// The dangling string toy. The ENGINE owns where the string hangs and what
// happens to it — this window just simulates and draws the rope. Channels:
//   string:cfg     initial pivot + rope length (sent once the page is ready)
//   string:pivot   the pivot moved (engine drifts it like prey; streams ~30/s)
//   string:hit     a paw connected — apply an impulse to the rope's lower end
//   string:catch   the knot is caught: pin it to this point (the cat's paws)
//   string:release let go — unpin, with a little escape kick
const api = {
  onCfg: (handler: (cfg: { pivotX: number; pivotY: number; ropeLen: number }) => void): void => {
    ipcRenderer.on('string:cfg', (_e, cfg) => handler(cfg))
  },
  onPivot: (handler: (p: { x: number; y: number }) => void): void => {
    ipcRenderer.on('string:pivot', (_e, p) => handler(p))
  },
  onHit: (handler: (v: { vx: number; vy: number }) => void): void => {
    ipcRenderer.on('string:hit', (_e, v) => handler(v))
  },
  onCatch: (handler: (p: { x: number; y: number }) => void): void => {
    ipcRenderer.on('string:catch', (_e, p) => handler(p))
  },
  onRelease: (handler: () => void): void => {
    ipcRenderer.on('string:release', () => handler())
  }
}

contextBridge.exposeInMainWorld('stringToy', api)

export type StringToyApi = typeof api
