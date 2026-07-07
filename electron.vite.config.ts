import { resolve } from 'node:path'
import { defineConfig } from 'electron-vite'

// Multi-window renderer: each HTML entry is one BrowserWindow.
// `pet` is the desktop pet overlay. `settings` will be added in a later milestone.
export default defineConfig({
  main: {
    build: {
      rollupOptions: {
        input: { index: resolve(__dirname, 'src/main/index.ts') }
      }
    }
  },
  preload: {
    build: {
      rollupOptions: {
        input: { index: resolve(__dirname, 'src/preload/index.ts') }
      }
    }
  },
  renderer: {
    root: 'src/renderer',
    build: {
      rollupOptions: {
        input: {
          pet: resolve(__dirname, 'src/renderer/pet.html')
        }
      }
    }
  }
})
