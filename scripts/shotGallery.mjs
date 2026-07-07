// Loads the built gallery in Electron and screenshots it, so we can verify it
// renders/animates without a manual browser.  Run: npx electron scripts/shotGallery.mjs [out.png]
import { app, BrowserWindow } from 'electron'
import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const body = readFileSync(resolve(__dirname, '../.gallery.html'), 'utf8')
const theme = process.env.THEME ? ` data-theme="${process.env.THEME}"` : ''
const full = `<!doctype html><html${theme}><head><meta charset="utf-8"><style>html,body{margin:0}</style></head><body>${body}</body></html>`
const tmp = resolve(__dirname, '../.gallery.full.html')
writeFileSync(tmp, full)

const outPath = resolve(process.argv[2] || resolve(__dirname, '../.gallery.png'))

app.whenReady().then(async () => {
  const win = new BrowserWindow({
    width: 1320,
    height: 1500,
    show: true,
    backgroundColor: '#eceee7',
    webPreferences: { offscreen: false }
  })
  win.webContents.setBackgroundThrottling(false)
  win.webContents.on('console-message', (_e, level, message, line, source) => {
    console.log(`[console:${level}] ${message} (${source}:${line})`)
  })
  await win.loadFile(tmp)
  const cardCount = await win.webContents.executeJavaScript('document.querySelectorAll(".card").length').catch((e) => 'err:' + e)
  console.log('cards after load: ' + cardCount)
  win.show()
  win.focus()
  if (process.env.INTERACT) {
    await win.webContents.executeJavaScript(`
      document.querySelector('.seg [data-bg="desktop"]').click();
      const cards = document.querySelectorAll('.card');
      cards[0].click(); cards[3].click();
      document.querySelectorAll('.card')[0].scrollIntoView();
    `).catch((e) => console.log('interact err: ' + e))
  }
  await new Promise((r) => setTimeout(r, 4500))
  const img = await win.webContents.capturePage()
  const size = img.getSize()
  console.log('captured ' + size.width + 'x' + size.height)
  const png = img.toPNG()
  writeFileSync(outPath, png)
  console.log('saved ' + outPath + ' (' + png.length + ' bytes)')
  app.quit()
})
