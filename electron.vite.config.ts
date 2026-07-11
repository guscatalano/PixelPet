import { resolve } from 'node:path'
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'

// Multi-window renderer: each HTML entry is one BrowserWindow.
// `pet` is the desktop pet overlay; `settings` is the pet-picker/tuning window.
export default defineConfig({
  main: {
    // Keep native deps (koffi) external so they aren't bundled — they load from node_modules.
    plugins: [externalizeDepsPlugin()],
    build: {
      rollupOptions: {
        input: { index: resolve(__dirname, 'src/main/index.ts') }
      }
    }
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    build: {
      rollupOptions: {
        input: {
          index: resolve(__dirname, 'src/preload/index.ts'),
          settings: resolve(__dirname, 'src/preload/settings.ts'),
          item: resolve(__dirname, 'src/preload/item.ts'),
          dream: resolve(__dirname, 'src/preload/dream.ts')
        }
      }
    }
  },
  renderer: {
    root: 'src/renderer',
    build: {
      rollupOptions: {
        input: {
          pet: resolve(__dirname, 'src/renderer/pet.html'),
          settings: resolve(__dirname, 'src/renderer/settings.html'),
          item: resolve(__dirname, 'src/renderer/item.html'),
          dream: resolve(__dirname, 'src/renderer/dream.html')
        }
      }
    }
  }
})
