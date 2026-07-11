// Loads the built settings window with a stubbed IPC and screenshots it, to
// verify the pet picker / sliders render.  npx electron scripts/shotSettings.mjs [out.png]
import { app, BrowserWindow, ipcMain } from 'electron'
import { writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const root = resolve(__dirname, '..')
const outPath = resolve(process.argv[2] || resolve(root, '.settings.png'))

app.whenReady().then(async () => {
  ipcMain.handle('settings:get', () => ({ activePetId: 'tiger', scale: 5, turnMs: 80, stayPut: false, overrides: {} }))
  for (const ch of ['settings:set-pet', 'settings:set-scale', 'settings:set-trait', 'settings:reset-traits']) {
    ipcMain.on(ch, (_e, arg) => console.log(`[ipc] ${ch}`, JSON.stringify(arg)))
  }

  const win = new BrowserWindow({
    width: 720, height: 620, show: true, backgroundColor: '#1a1b24',
    webPreferences: { preload: resolve(root, 'out/preload/settings.js'), sandbox: false }
  })
  win.webContents.on('console-message', (_e, lvl, msg, line, src) => console.log(`[console:${lvl}] ${msg} (${src}:${line})`))
  win.webContents.on('render-process-gone', (_e, d) => console.log('[gone] ' + d.reason))
  if (process.env.DEVURL) await win.loadURL(process.env.DEVURL)
  else await win.loadFile(resolve(root, 'out/renderer/settings.html'))
  await new Promise((r) => setTimeout(r, 900))
  if (process.env.SCROLLTO) await win.webContents.executeJavaScript(`document.getElementById('${process.env.SCROLLTO}').scrollIntoView({block:'center'})`)
  else if (process.env.SCROLL) await win.webContents.executeJavaScript('window.scrollTo(0, document.body.scrollHeight)')
  await new Promise((r) => setTimeout(r, 400))
  const img = await win.webContents.capturePage()
  writeFileSync(outPath, img.toPNG())
  console.log('saved ' + outPath)
  app.quit()
})
