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
  const userPets = process.env.WITHUSERPET ? [{ id: 'user-demo', name: 'Mittens', blurb: 'Your photo cat.', geom: { bodyRx: 15, bodyRy: 12.5 }, marking: 'tuxedo', coat: { primary: '#2b2b32', white: '#f4f4f7', iris: '#e7b24e' }, personality: { energy: 0.6, sleepiness: 0.4, affection: 0.8, mischief: 0.4, curiosity: 0.6, independence: 0.4 } }] : []
  ipcMain.handle('settings:get', () => ({ activePetId: 'tiger', scale: 5, turnMs: 80, stayPut: false, frontScale: 0.8, pupilsByTime: false, careMode: true, difficulty: 'normal', dreamMode: false, dreamChance: 0.55, dreamBubbleScale: 1, petFilter: 'all', nameOverrides: {}, disabledAnims: [], ai: { provider: 'openai', model: 'gpt-4o' }, userPets, overrides: {} }))
  ipcMain.handle('care:get', () => ({ enabled: true, needs: { hunger: 0.3, energy: 0.65, fun: 0.15, hygiene: 0.8, health: 0.9 }, state: { key: 'bored', label: 'Bored', emoji: '🥱' } }))
  ipcMain.handle('ai:status', () => ({ provider: 'openai', model: 'gpt-4o', endpoint: 'https://api.openai.com/v1', hasKey: !!process.env.WITHKEY, encryptionAvailable: true }))
  ipcMain.handle('ai:set-key', () => ({ provider: 'openai', model: 'gpt-4o', endpoint: 'https://api.openai.com/v1', hasKey: true, encryptionAvailable: true }))
  ipcMain.handle('ai:clear-key', () => ({ provider: 'openai', model: 'gpt-4o', endpoint: 'https://api.openai.com/v1', hasKey: false, encryptionAvailable: true }))
  ipcMain.handle('ai:test', () => ({ ok: true, message: 'Connected to OpenAI (gpt-4o).' }))
  ipcMain.handle('ai:generate', () => ({ ok: false, error: 'stub' }))
  ipcMain.handle('immich:status', () => ({ serverUrl: '', albumId: '', hasKey: false }))
  for (const ch of ['settings:set-pet', 'settings:set-scale', 'settings:set-trait', 'settings:reset-traits', 'ai:set-config', 'pets:delete-user', 'settings:set-pupils', 'settings:set-caremode', 'settings:set-difficulty', 'care:action', 'settings:set-dreammode']) {
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
