// Load a local HTML file, grab #c canvas.toDataURL at several timestamps, tile them.
//   npx electron scripts/shotCanvas.mjs <file.html> <out.png> <ms1,ms2,...>
import { app, BrowserWindow } from 'electron'
import { writeFileSync } from 'node:fs'
import { pathToFileURL } from 'node:url'

const file = process.argv[2], out = process.argv[3]
const times = (process.argv[4] || '1200,3600,7000').split(',').map(Number)

app.whenReady().then(async () => {
  const win = new BrowserWindow({ width: 520, height: 400, show: true, webPreferences: { offscreen: false } })
  win.webContents.setBackgroundThrottling(false)
  await win.loadURL(pathToFileURL(file).href)
  const urls = []
  let last = 0
  for (const t of times) {
    await new Promise((r) => setTimeout(r, Math.max(0, t - last))); last = t
    urls.push(await win.webContents.executeJavaScript(`document.getElementById('c').toDataURL('image/png')`))
  }
  const sheet = await win.webContents.executeJavaScript(`(async()=>{
    const urls=${JSON.stringify(urls)}; const imgs=await Promise.all(urls.map(u=>new Promise(res=>{const i=new Image();i.onload=()=>res(i);i.src=u;})));
    const w=imgs[0].width,h=imgs[0].height,gap=10; const c=document.createElement('canvas'); c.width=w*imgs.length+gap*(imgs.length+1); c.height=h+gap*2;
    const g=c.getContext('2d'); g.fillStyle='#0f1119'; g.fillRect(0,0,c.width,c.height);
    imgs.forEach((im,i)=>g.drawImage(im, gap+i*(w+gap), gap)); return c.toDataURL('image/png');
  })()`)
  writeFileSync(out, Buffer.from(sheet.split(',')[1], 'base64'))
  console.log('saved ' + out)
  app.quit()
})
