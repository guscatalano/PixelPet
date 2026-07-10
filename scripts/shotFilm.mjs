// Load a local HTML file and capture N frames into a horizontal filmstrip.
//   npx electron scripts/shotFilm.mjs <file.html> <out.png> [everyMs] [count]
import { app, BrowserWindow } from 'electron'
import { writeFileSync } from 'node:fs'
import { pathToFileURL } from 'node:url'

const file = process.argv[2], out = process.argv[3]
const every = Number(process.argv[4] || 300), count = Number(process.argv[5] || 8)

app.whenReady().then(async () => {
  const win = new BrowserWindow({ width: 600, height: 460, show: true, webPreferences: { offscreen: false } })
  win.webContents.setBackgroundThrottling(false)
  await win.loadURL(pathToFileURL(file).href)
  await new Promise((r) => setTimeout(r, 400))
  const shots = []
  for (let i = 0; i < count; i++) {
    const img = await win.webContents.capturePage()
    shots.push(img)
    await new Promise((r) => setTimeout(r, every))
  }
  // stack vertically (simplest): compose via nativeImage toBitmap is complex; save each and a contact sheet horizontally by drawing on a canvas in the page.
  // Simpler: crop each to the canvas area and tile in the renderer.
  const dataUrls = shots.map((s) => s.toDataURL())
  const sheet = await win.webContents.executeJavaScript(`(async()=>{
    const urls=${JSON.stringify(dataUrls)};
    const imgs=await Promise.all(urls.map(u=>new Promise(res=>{const i=new Image();i.onload=()=>res(i);i.src=u;})));
    const w=imgs[0].width, h=imgs[0].height, cols=${count};
    const c=document.createElement('canvas'); c.width=w*cols; c.height=h; const g=c.getContext('2d');
    imgs.forEach((im,i)=>g.drawImage(im,i*w,0)); return c.toDataURL('image/png');
  })()`)
  writeFileSync(out, Buffer.from(dataUrls[0].split(',')[1], 'base64')) // fallback single
  writeFileSync(out.replace('.png', '-strip.png'), Buffer.from(sheet.split(',')[1], 'base64'))
  console.log('saved ' + out.replace('.png', '-strip.png'))
  app.quit()
})
