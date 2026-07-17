// Generates Microsoft Store SCREENSHOTS (1920x1080) — real pixel-cat sprites and
// the real settings window composed onto branded desktop scenes with captions.
// Run:  npx electron scripts/genStoreScreens.mjs
import { app, BrowserWindow, ipcMain, nativeImage } from 'electron'
import { writeFileSync, mkdirSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { renderCat, render, generateWalkGrid, W, H } from './catgen.mjs'
import { generateRigGrid, POSES } from './rigcat.mjs'
import { encodePNG } from './pngEncoder.mjs'
import { PRESETS } from './presets.mjs'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const outDir = resolve(root, 'store-assets')
mkdirSync(outDir, { recursive: true })
const pet = (id) => PRESETS.find((p) => p.id === id) || PRESETS[0]
const url = (rgba) => 'data:image/png;base64,' + Buffer.from(encodePNG(W, H, rgba)).toString('base64')
const front = (id) => url(renderCat(pet(id), { eyeOpen: true, tailPhase: 0.15 }).rgba)
const rig = (id, pose) => url(render(generateRigGrid(pet(id), pose), pet(id).coat))
const walk = (id, exc = 0) => url(render(generateWalkGrid(pet(id), 0.13, 1, exc), pet(id).coat))
const iconUrl = () => {
  // small branded plate for the faux taskbar
  return front('ash')
}

const CSS = `
  * { margin: 0; box-sizing: border-box; }
  html, body { width: 1920px; height: 1080px; overflow: hidden; font-family: 'Segoe UI', system-ui, sans-serif; }
  .wall { position: absolute; inset: 0; background:
      radial-gradient(130% 120% at 24% 12%, #4a5488 0%, #2b2f4e 46%, #191c30 100%); }
  .grain { position: absolute; inset: 0; opacity: .05;
      background-image: radial-gradient(rgba(255,255,255,.6) 1px, transparent 1px); background-size: 4px 4px; }
  .taskbar { position: absolute; left: 0; right: 0; bottom: 0; height: 54px;
      background: rgba(18,20,32,.72); display: flex; align-items: center; gap: 16px; padding-left: 26px;
      box-shadow: 0 -1px 0 rgba(255,255,255,.06); }
  .taskbar .app { width: 34px; height: 34px; border-radius: 8px; image-rendering: pixelated; box-shadow: 0 2px 6px rgba(0,0,0,.4); }
  .taskbar .ph { width: 30px; height: 30px; border-radius: 7px; background: rgba(255,255,255,.13); }
  .copy { position: absolute; left: 116px; top: 96px; max-width: 900px; color: #fff; }
  h1 { font-size: 66px; font-weight: 750; line-height: 1.04; letter-spacing: -.02em; text-shadow: 0 3px 20px rgba(0,0,0,.4); }
  .sub { font-size: 31px; font-weight: 400; color: #d7ddf2; margin-top: 20px; line-height: 1.35; }
  img.cat { image-rendering: pixelated; position: absolute; filter: drop-shadow(0 10px 16px rgba(0,0,0,.45)); }
  .row { position: absolute; left: 0; right: 0; display: flex; justify-content: center; align-items: flex-end; }
  .row img { image-rendering: pixelated; filter: drop-shadow(0 10px 16px rgba(0,0,0,.4)); }
  .emoji { position: absolute; filter: drop-shadow(0 6px 10px rgba(0,0,0,.4)); }
  .win { position: absolute; border-radius: 13px; overflow: hidden; box-shadow: 0 40px 90px rgba(0,0,0,.6), 0 0 0 1px rgba(255,255,255,.06); }
  /* dream photo bubble (matches the in-app bubble, scaled up) */
  .dbubble { position: absolute; background: #eef1f8; border: 7px solid #2a2c38; border-radius: 30px; padding: 12px; box-shadow: 0 16px 38px rgba(0,0,0,.5); width: 280px; height: 224px; }
  .dphoto { width: 100%; height: 100%; border-radius: 19px; background: linear-gradient(135deg, #f7dcae 0%, #e79a6b 60%, #d97e57 100%); display: flex; align-items: center; justify-content: center; font-size: 150px; box-shadow: inset 0 0 26px rgba(0,0,0,.14); }
  .dzzz { position: absolute; top: -46px; right: -10px; color: #d7ddf2; font: 800 46px 'Cascadia Code', 'Segoe UI', monospace; text-shadow: 0 2px 8px rgba(0,0,0,.5); }
  .dtail { position: absolute; bottom: -27px; left: 50%; margin-left: -18px; width: 0; height: 0; border: 18px solid transparent; border-top-color: #2a2c38; }
`

const taskbar = (ic) => `<div class="taskbar"><img class="app" src="${ic}"><span class="ph"></span><span class="ph"></span><span class="ph"></span></div>`

function scenes(ic, settingsShot) {
  return [
    { // 1 — hero
      name: 'screenshot-1-hero.png',
      body: `<div class="copy"><h1>Your desktop<br>just got a cat.</h1>
        <div class="sub">A tiny pixel companion that sits on your windows, wanders around, naps, and says hi when you do.</div></div>
        <img class="cat" src="${front('ash')}" style="width:470px; left:1230px; bottom:54px;">
        ${taskbar(ic)}`
    },
    { // 2 — roster
      name: 'screenshot-2-roster.png',
      body: `<div class="copy"><h1>Pick your cat.</h1>
        <div class="sub">Tabbies, tuxedos, calicos, Siamese and more — each with its own look and personality.</div></div>
        <div class="row" style="bottom:120px; gap:34px;">
          ${['ash', 'tiger', 'milo', 'patches', 'coco', 'luna'].map((c) => `<img src="${front(c)}" style="width:232px;">`).join('')}
        </div>`
    },
    { // 3 — behaviors
      name: 'screenshot-3-life.png',
      body: `<div class="copy"><h1>It lives its<br>own little life.</h1>
        <div class="sub">Sitting, walking, loafing, sleeping, grooming, and an excited prance — all on its own.</div></div>
        <div class="row" style="bottom:110px; gap:26px;">
          <img src="${rig('tiger', POSES.sit)}" style="width:196px;">
          <img src="${walk('tiger')}" style="width:196px;">
          <img src="${rig('tiger', POSES.loaf)}" style="width:196px;">
          <img src="${rig('tiger', POSES.curl)}" style="width:196px;">
          <img src="${rig('tiger', POSES.groom)}" style="width:196px;">
          <img src="${walk('tiger', 1)}" style="width:196px;">
        </div>`
    },
    { // 4 — care
      name: 'screenshot-4-care.png',
      body: `<div class="copy"><h1>Care for it<br>(if you want to).</h1>
        <div class="sub">Optional Care Mode: feed, play with, and look after your pet — or just let it be.</div></div>
        <img class="cat" src="${front('patches')}" style="width:430px; left:1170px; bottom:120px;">
        <div class="emoji" style="font-size:96px; left:1080px; bottom:360px;">🐟</div>
        <div class="emoji" style="font-size:70px; left:1520px; bottom:430px;">💗</div>
        <div class="emoji" style="font-size:52px; left:1430px; bottom:520px;">💗</div>
        ${taskbar(ic)}`
    },
    { // 6 — dream mode
      name: 'screenshot-6-dream.png',
      body: `<div class="copy"><h1>It dreams of<br>your photos.</h1>
        <div class="sub">While your cat naps, it drifts through little photo bubbles of the pictures you love.</div></div>
        <img class="cat" src="${rig('ash', POSES.curl)}" style="width:360px; left:1290px; bottom:150px;">
        <div class="dbubble" style="left:1330px; bottom:360px;">
          <div class="dphoto">🐈</div>
          <div class="dzzz">z</div>
          <div class="dtail"></div>
        </div>
        ${taskbar(ic)}`
    },
    { // 5 — settings (real window)
      name: 'screenshot-5-settings.png',
      body: `<div class="copy"><h1>Make it<br>yours.</h1>
        <div class="sub">Resize your pet, tune its personality, toggle animations, and manage your cats — all in one place.</div></div>
        <img class="win" src="${settingsShot}" style="width:760px; right:120px; bottom:90px;">
        ${taskbar(ic)}`
    }
  ]
}

process.on('unhandledRejection', (e) => { console.error('UNHANDLED', e); app.exit(1) })
app.on('window-all-closed', () => {}) // don't auto-quit between the settings capture and the scenes
app.whenReady().then(async () => {
 try {
  // --- capture the REAL settings window (stubbed IPC) ---
  const userPets = []
  ipcMain.handle('settings:get', () => ({ activePetId: 'patches', scale: 5, turnMs: 80, stayPut: false, frontScale: 0.8, pupilsByTime: false, careMode: true, difficulty: 'normal', dreamMode: true, dreamChance: 0.55, dreamBubbleScale: 1, petFilter: 'all', nameOverrides: {}, disabledAnims: [], ai: { provider: 'openai', model: 'gpt-4o' }, userPets, overrides: {} }))
  ipcMain.handle('care:get', () => ({ enabled: true, needs: { hunger: 0.55, energy: 0.7, fun: 0.4, hygiene: 0.85, health: 0.95 }, state: { key: 'content', label: 'Content', emoji: '😺' } }))
  ipcMain.handle('care:status', () => ({ needs: { hunger: 0.55, energy: 0.7, fun: 0.4, hygiene: 0.85, health: 0.95 }, state: { key: 'content', label: 'Content', emoji: '😺' } }))
  ipcMain.handle('ai:status', () => ({ provider: 'openai', model: 'gpt-4o', endpoint: 'https://api.openai.com/v1', hasKey: false, encryptionAvailable: true }))
  ipcMain.handle('immich:status', () => ({ serverUrl: '', albumId: '', hasKey: false }))
  for (const ch of ['settings:set-pet', 'settings:set-scale', 'settings:set-trait', 'settings:reset-traits', 'ai:set-config', 'pets:delete-user', 'settings:set-pupils', 'settings:set-caremode', 'settings:set-difficulty', 'care:action', 'settings:set-dreammode', 'settings:set-dreamchance', 'settings:set-dreambubblescale', 'settings:set-petfilter', 'settings:play-clip', 'pets:rename']) {
    ipcMain.on(ch, () => {})
  }
  const sw = new BrowserWindow({ width: 720, height: 720, show: true, backgroundColor: '#1a1b24', webPreferences: { preload: resolve(root, 'out/preload/settings.js'), sandbox: false } })
  await sw.loadFile(resolve(root, 'out/renderer/settings.html'))
  await new Promise((r) => setTimeout(r, 1100))
  const settingsShot = 'data:image/png;base64,' + (await sw.webContents.capturePage()).toPNG().toString('base64')
  sw.destroy()

  // --- render the scenes ---
  const ic = iconUrl()
  const win = new BrowserWindow({ width: 1920, height: 1080, useContentSize: true, show: true, webPreferences: { offscreen: false } })
  const tmp = resolve(outDir, '_scene.html')
  for (const s of scenes(ic, settingsShot)) {
    writeFileSync(tmp, `<!doctype html><meta charset="utf-8"><style>${CSS}</style><body><div class="wall"></div><div class="grain"></div>${s.body}</body>`)
    await win.loadFile(tmp)
    await new Promise((r) => setTimeout(r, 500))
    let img = await win.webContents.capturePage()
    const sz = img.getSize()
    if (sz.width !== 1920) img = img.resize({ width: 1920, height: 1080 })
    writeFileSync(resolve(outDir, s.name), img.toPNG())
    console.log('wrote store-assets/' + s.name)
  }
  app.quit()
 } catch (e) { console.error('SCENE ERROR', e); app.exit(1) }
})
