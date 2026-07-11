// 10 candidate versions of the "paws at you" animation, side by side, looping.
//   node scripts/buildPawGallery.mjs <out.html>
import { writeFileSync } from 'node:fs'
import { encodePNG } from './pngEncoder.mjs'
import { W, H, render } from './catgen.mjs'
import { generate34Grid } from './turn34.mjs'
import { PRESETS } from './presets.mjs'

const out = process.argv[2]
const ash = PRESETS.find((p) => p.id === 'ash')
const uri = (state) => 'data:image/png;base64,' + Buffer.from(encodePNG(W, H, render(generate34Grid(ash, 0, state), ash.coat))).toString('base64')
const F = (state, ms) => ({ u: uri(state), ms })

// Shared rise/lower helpers (ms per step tunable per variant).
const rise = (h, ms, steps = [0.25, 0.55, 0.8, 1]) => steps.map((k) => F({ paw: k, pawH: h }, ms))
const lower = (h, ms, steps = [0.75, 0.45, 0.2]) => steps.map((k) => F({ paw: k, pawH: h }, ms))

const VARIANTS = [
  { name: '1 · Classic pat', desc: 'raise, two firm down-pats, lower', frames: [
    ...rise(1, 85), F({ paw: 1 }, 170),
    F({ paw: 1, pawX: 1 }, 90), F({ paw: 1, pawX: 0.25 }, 120), F({ paw: 1, pawX: 1 }, 90), F({ paw: 1, pawX: 0.25 }, 120),
    F({ paw: 1 }, 140), ...lower(1, 85), F({}, 900)
  ] },
  { name: '2 · Glass press', desc: 'slow reach, pad pressed + held, release', frames: [
    ...rise(1, 115, [0.2, 0.45, 0.7, 0.9, 1]),
    F({ paw: 1, pawX: 0.35 }, 130), F({ paw: 1, pawX: 0.2 }, 850), F({ paw: 1 }, 160),
    ...lower(1, 110), F({}, 900)
  ] },
  { name: '3 · Double-tap', desc: 'quick up, tap-tap, quick down', frames: [
    ...rise(1, 65, [0.4, 0.8, 1]),
    F({ paw: 1, pawX: 1 }, 85), F({ paw: 1, pawX: 0.15 }, 80), F({ paw: 1, pawX: 1 }, 85), F({ paw: 1, pawX: 0.15 }, 80),
    ...lower(1, 65, [0.6, 0.3]), F({}, 900)
  ] },
  { name: '4 · Insistent', desc: 'hey. hey. hey. hey. hey.', frames: [
    ...rise(1, 75, [0.3, 0.7, 1]),
    ...[1, 2, 3, 4, 5].flatMap(() => [F({ paw: 1, pawX: 1 }, 75), F({ paw: 1, pawX: 0.2 }, 85)]),
    ...lower(1, 75), F({}, 900)
  ] },
  { name: '5 · High reach', desc: 'stretches up higher toward you', frames: [
    ...rise(1.35, 120), F({ paw: 1, pawH: 1.35 }, 250),
    F({ paw: 1, pawH: 1.35, pawX: 0.8 }, 200), F({ paw: 1, pawH: 1.35 }, 400),
    ...lower(1.35, 110), F({}, 900)
  ] },
  { name: '6 · Gentle touch', desc: 'soft single touch, lingers', frames: [
    ...rise(1, 130, [0.2, 0.4, 0.6, 0.8, 1]),
    F({ paw: 1, pawX: 0.5 }, 230), F({ paw: 1, pawX: 0.35 }, 650), F({ paw: 1 }, 180),
    ...lower(1, 120), F({}, 900)
  ] },
  { name: '7 · Making biscuits', desc: 'both paws kneading', frames: [
    F({ paw: 0.35, paw2: 0.35, pawH: 0.68 }, 130),
    ...[1, 2, 3, 4].flatMap(() => [
      F({ paw: 0.95, pawX: 0.4, paw2: 0.45, pawH: 0.68 }, 175),
      F({ paw: 0.45, paw2: 0.95, paw2X: 0.4, pawH: 0.68 }, 175)
    ]),
    F({ paw: 0.35, paw2: 0.35, pawH: 0.68 }, 130), F({}, 900)
  ] },
  { name: '8 · Wave hello', desc: 'raised high, side-to-side wave', frames: [
    ...rise(1.25, 80, [0.4, 0.8, 1]),
    ...[1, 2, 3].flatMap(() => [F({ paw: 1, pawH: 1.25, pawLx: -1.7 }, 115), F({ paw: 1, pawH: 1.25, pawLx: 1.7 }, 115)]),
    F({ paw: 1, pawH: 1.25 }, 120), ...lower(1.25, 80), F({}, 900)
  ] },
  { name: '9 · Yearning', desc: 'very slow reach, long hold, no pats', frames: [
    ...rise(1.1, 150, [0.17, 0.34, 0.5, 0.67, 0.84, 1]),
    F({ paw: 1, pawH: 1.1 }, 950),
    ...lower(1.1, 140, [0.84, 0.67, 0.5, 0.34, 0.17]), F({}, 900)
  ] },
  { name: '10 · Excited', desc: 'fast bouncy pats, big body rock', frames: [
    ...rise(1, 65, [0.5, 1]),
    ...[1, 2, 3, 4].flatMap(() => [F({ paw: 1, pawX: 1 }, 70), F({ paw: 1, pawX: -0.25 }, 80)]),
    ...lower(1, 65, [0.6, 0.25]), F({}, 900)
  ] }
]

const data = JSON.stringify(VARIANTS.map((v) => ({ name: v.name, desc: v.desc, frames: v.frames })))
const html = `<title>Ash · paw-at-you — 10 candidates</title>
<style>
  :root{ --bg:#14161f; --panel:#1d2030; --hair:#2c3048; --ink:#cdd0e2; --dim:#7f83a0; --accent:#9caf6e; --stage:#0f1119;
    --sans:ui-rounded,"SF Pro Rounded","Segoe UI",system-ui,sans-serif; --mono:ui-monospace,"Cascadia Code",monospace; }
  @media (prefers-color-scheme: light){:root{--bg:#eceae3;--panel:#f6f5f0;--hair:#dcd8cc;--ink:#33313c;--dim:#87856f;--accent:#6f8a3e;--stage:#e6e3da}}
  :root[data-theme="light"]{--bg:#eceae3;--panel:#f6f5f0;--hair:#dcd8cc;--ink:#33313c;--dim:#87856f;--accent:#6f8a3e;--stage:#e6e3da}
  :root[data-theme="dark"]{--bg:#14161f;--panel:#1d2030;--hair:#2c3048;--ink:#cdd0e2;--dim:#7f83a0;--accent:#9caf6e;--stage:#0f1119}
  *{box-sizing:border-box} body{margin:0;min-height:100vh;background:var(--bg);color:var(--ink);font-family:var(--sans);padding:26px 18px}
  h1{font-size:20px;font-weight:650;max-width:900px;margin:0 auto 4px} h1 b{color:var(--accent)}
  .sub{color:var(--dim);font-size:13px;max-width:900px;margin:0 auto 18px}
  .grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(196px,1fr));gap:14px;max-width:1100px;margin:0 auto}
  .tile{background:var(--panel);border:1px solid var(--hair);border-radius:14px;padding:12px;display:flex;flex-direction:column;align-items:center;gap:8px}
  canvas{image-rendering:pixelated;background:radial-gradient(60% 60% at 50% 55%,color-mix(in srgb,var(--stage) 60%,var(--panel)),var(--stage));border-radius:10px}
  .nm{font-size:13.5px;font-weight:600} .ds{font-size:11.5px;color:var(--dim);text-align:center}
</style>
<h1>Meet <b>Ash</b> — pick a paw</h1>
<div class="sub">Ten versions of the paws-at-you animation, looping. Tell me the number you like (or which bits to combine).</div>
<div class="grid" id="grid"></div>
<script>
const V=${data}, S=4, W=${W}, H=${H};
const grid=document.getElementById('grid');
V.forEach((v)=>{
  const tile=document.createElement('div'); tile.className='tile';
  const c=document.createElement('canvas'); c.width=W*S; c.height=H*S;
  const g=c.getContext('2d'); g.imageSmoothingEnabled=false;
  const nm=document.createElement('div'); nm.className='nm'; nm.textContent=v.name;
  const ds=document.createElement('div'); ds.className='ds'; ds.textContent=v.desc;
  tile.append(c,nm,ds); grid.append(tile);
  const imgs=v.frames.map(f=>{const i=new Image(); i.src=f.u; return i});
  let fi=0, nextAt=0;
  function loop(now){ requestAnimationFrame(loop);
    if(now>=nextAt){ fi=(fi+1)%v.frames.length; nextAt=now+v.frames[fi].ms;
      const im=imgs[fi]; if(im.complete){ g.clearRect(0,0,c.width,c.height); g.drawImage(im,0,0,W,H,0,0,c.width,c.height); } } }
  requestAnimationFrame(loop);
});
</script>`
writeFileSync(out, html)
console.log('wrote ' + out + ' (' + Math.round(html.length / 1024) + ' KB)')
