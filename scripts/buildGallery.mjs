// Assembles the self-contained cat gallery HTML from the generator, presets,
// stylesheet, and client script. Output is body content (no <html>/<head>/<body>)
// suitable for publishing as an Artifact.
//
//   node scripts/buildGallery.mjs [out.html]

import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const read = (p) => readFileSync(resolve(__dirname, p), 'utf8')
const stripExports = (s) => s.replace(/^\s*export\s+/gm, '')

const catgen = stripExports(read('catgen.mjs'))
const presets = stripExports(read('presets.mjs'))
const css = read('gallery.css')
const client = read('galleryClient.js')

const outPath = resolve(process.argv[2] || resolve(__dirname, '../.gallery.html'))

const html = `<title>PixelPet — Choose Your Cat</title>
<style>${css}</style>

<header class="top">
  <div class="top-inner">
    <div class="brand">
      <canvas id="mark-cat" width="30" height="30" aria-hidden="true"></canvas>
      <span class="wordmark">Pixel<b>Pet</b></span>
    </div>
    <div class="pickbar">
      <span class="count" id="pick-count">No favorites yet</span>
      <button class="btn" id="copy-btn" type="button">Copy picks</button>
    </div>
  </div>
</header>

<div class="wrap">
  <section class="hero">
    <p class="eyebrow">Adoption gallery · 20 variations</p>
    <h1>Choose your desktop cat.</h1>
    <p class="lede">Twenty pixel cats, each procedurally generated and quietly alive — breathing,
      blinking, tails swaying. Browse the litter, click the ones you love, and tell me which to
      bring home as your desktop pet.</p>
  </section>

  <div class="controls">
    <span class="seg-label">Backdrop</span>
    <div class="seg" role="group" aria-label="Preview backdrop">
      <button data-bg="studio" type="button" aria-pressed="true">Studio</button>
      <button data-bg="light" type="button" aria-pressed="false">Light</button>
      <button data-bg="dark" type="button" aria-pressed="false">Dark</button>
      <button data-bg="desktop" type="button" aria-pressed="false">Desktop</button>
    </div>
    <span class="hint">Click a cat to favorite it · pick as many as you like</span>
  </div>

  <div class="grid" id="grid"></div>

  <footer class="note">
    Every cat is drawn from the same generator — a silhouette, an auto-outline, spherical
    shading, then coat &amp; markings — so the winner drops straight into the app. <b>Tell me
    the name (or names) you like best</b> and I'll make it your pet, or blend traits you liked
    across a few.
  </footer>
</div>

<script>
${catgen}
;
${presets}
;
${client}
</script>
`

writeFileSync(outPath, html)
console.log(`wrote ${outPath} (${(html.length / 1024).toFixed(1)} KB)`)
