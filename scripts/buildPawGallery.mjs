// 10 ART STYLES of the paws-at-you (identical motion, different look).
//   node scripts/buildPawGallery.mjs <out.html>
import { writeFileSync } from 'node:fs'
import { encodePNG } from './pngEncoder.mjs'
import { W, H, render } from './catgen.mjs'
import { generate34Grid } from './turn34.mjs'
import { PRESETS } from './presets.mjs'

const out = process.argv[2]
const ash = PRESETS.find((p) => p.id === 'ash')
const uri = (state) => 'data:image/png;base64,' + Buffer.from(encodePNG(W, H, render(generate34Grid(ash, 0, state), ash.coat))).toString('base64')

const STYLES = [
  { key: 'beans', name: '1 · Toe beans', desc: '3 pink beans + pad bean, soft crease (current)' },
  { key: 'splayed', name: '2 · Splayed toes', desc: 'scalloped toe bumps on the silhouette + beans' },
  { key: 'cartoon', name: '3 · Cartoon mitt', desc: 'bigger chunky pad, fat beans' },
  { key: 'dainty', name: '4 · Dainty', desc: 'smaller pad, single soft bean' },
  { key: 'mitten', name: '5 · Clean mitten', desc: 'no pink — just two toe notches' },
  { key: 'toelines', name: '6 · Toe lines', desc: 'classic pixel-cat toe separations, no pink' },
  { key: 'inkring', name: '7 · Bold ink', desc: 'the dark outline ring you asked about + beans' },
  { key: 'button', name: '8 · Jelly button', desc: 'round pad, one big pink center' },
  { key: 'claws', name: '9 · Claws out', desc: 'splayed toes with tiny claw ticks' },
  { key: 'fluffy', name: '10 · Fluffy', desc: 'fur-tufted pad edge + beans' }
]

// One shared choreography (the classic pat) so ONLY the art differs.
const F = (state, ms) => ({ u: uri(state), ms })
const framesFor = (artKey) => {
  const A = { pawArt: artKey }
  return [
    F({ ...A, paw: 0.25 }, 85), F({ ...A, paw: 0.55 }, 85), F({ ...A, paw: 0.8 }, 85), F({ ...A, paw: 1 }, 420),
    F({ ...A, paw: 1, pawX: 1 }, 95), F({ ...A, paw: 1, pawX: 0.25 }, 120), F({ ...A, paw: 1, pawX: 1 }, 95), F({ ...A, paw: 1, pawX: 0.25 }, 120),
    F({ ...A, paw: 1 }, 700), F({ ...A, paw: 0.75 }, 85), F({ ...A, paw: 0.45 }, 85), F({ ...A, paw: 0.2 }, 85), F({}, 800)
  ]
}
// Plus a big still of the fully-raised frame for close art comparison.
const VARIANTS = STYLES.map((s) => ({ name: s.name, desc: s.desc, still: uri({ pawArt: s.key, paw: 1 }), frames: framesFor(s.key) }))

const data = JSON.stringify(VARIANTS)
const html = `<title>Ash · paw art styles — 10 candidates</title>
<style>
  :root{ --bg:#14161f; --panel:#1d2030; --hair:#2c3048; --ink:#cdd0e2; --dim:#7f83a0; --accent:#9caf6e; --stage:#0f1119;
    --sans:ui-rounded,"SF Pro Rounded","Segoe UI",system-ui,sans-serif; --mono:ui-monospace,"Cascadia Code",monospace; }
  @media (prefers-color-scheme: light){:root{--bg:#eceae3;--panel:#f6f5f0;--hair:#dcd8cc;--ink:#33313c;--dim:#87856f;--accent:#6f8a3e;--stage:#e6e3da}}
  :root[data-theme="light"]{--bg:#eceae3;--panel:#f6f5f0;--hair:#dcd8cc;--ink:#33313c;--dim:#87856f;--accent:#6f8a3e;--stage:#e6e3da}
  :root[data-theme="dark"]{--bg:#14161f;--panel:#1d2030;--hair:#2c3048;--ink:#cdd0e2;--dim:#7f83a0;--accent:#9caf6e;--stage:#0f1119}
  *{box-sizing:border-box} body{margin:0;min-height:100vh;background:var(--bg);color:var(--ink);font-family:var(--sans);padding:26px 18px}
  h1{font-size:20px;font-weight:650;max-width:960px;margin:0 auto 4px} h1 b{color:var(--accent)}
  .sub{color:var(--dim);font-size:13px;max-width:960px;margin:0 auto 18px}
  .grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(300px,1fr));gap:14px;max-width:1100px;margin:0 auto}
  .tile{background:var(--panel);border:1px solid var(--hair);border-radius:14px;padding:12px;display:flex;flex-direction:column;gap:8px}
  .row{display:flex;gap:10px;align-items:center;justify-content:center}
  canvas{image-rendering:pixelated;background:radial-gradient(60% 60% at 50% 55%,color-mix(in srgb,var(--stage) 60%,var(--panel)),var(--stage));border-radius:10px}
  .nm{font-size:13.5px;font-weight:600;text-align:center} .ds{font-size:11.5px;color:var(--dim);text-align:center}
  .cap{font-family:var(--mono);font-size:9.5px;color:var(--dim);text-transform:uppercase;letter-spacing:.08em;text-align:center}
</style>
<h1>Meet <b>Ash</b> — paw art styles</h1>
<div class="sub">Same motion in every tile — only the paw's ART changes. Left: the animation. Right: the fully-raised frame, larger, for close comparison. Tell me the number.</div>
<div class="grid" id="grid"></div>
<script>
const V=${data}, W=${W}, H=${H};
const grid=document.getElementById('grid');
V.forEach((v)=>{
  const tile=document.createElement('div'); tile.className='tile';
  const row=document.createElement('div'); row.className='row';
  const c=document.createElement('canvas'); c.width=W*3; c.height=H*3;
  const g=c.getContext('2d'); g.imageSmoothingEnabled=false;
  const big=document.createElement('canvas'); big.width=W*4; big.height=H*4;
  const bg=big.getContext('2d'); bg.imageSmoothingEnabled=false;
  const stillImg=new Image(); stillImg.onload=()=>bg.drawImage(stillImg,0,0,W,H,0,0,big.width,big.height); stillImg.src=v.still;
  const colA=document.createElement('div'); colA.append(c); const capA=document.createElement('div'); capA.className='cap'; capA.textContent='motion'; colA.append(capA);
  const colB=document.createElement('div'); colB.append(big); const capB=document.createElement('div'); capB.className='cap'; capB.textContent='detail'; colB.append(capB);
  row.append(colA,colB);
  const nm=document.createElement('div'); nm.className='nm'; nm.textContent=v.name;
  const ds=document.createElement('div'); ds.className='ds'; ds.textContent=v.desc;
  tile.append(row,nm,ds); grid.append(tile);
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
