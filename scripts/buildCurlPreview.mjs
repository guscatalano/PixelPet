// Build a self-contained animated preview of the curled sleep pose.
//   node scripts/buildCurlPreview.mjs <out.html>
import { writeFileSync } from 'node:fs'
import { encodePNG } from './pngEncoder.mjs'
import { render, generateGrid, generateCurlGrid, W, H } from './catgen.mjs'
import { PRESETS } from './presets.mjs'

const out = process.argv[2]
const ash = PRESETS.find((p) => p.id === 'ash')
const uri = (rgba) => 'data:image/png;base64,' + Buffer.from(encodePNG(W, H, rgba)).toString('base64')

const N = 16
const curl = Array.from({ length: N }, (_, i) => uri(render(generateCurlGrid(ash, (i / N) * Math.PI * 2), ash.coat)))
const idle = uri(render(generateGrid(ash, { eyeOpen: true }), ash.coat))
const data = JSON.stringify({ w: W, h: H, n: N, idle, curl })

const html = `<title>Ash · sleep pose</title>
<style>
  :root{
    --ground:#161826; --panel:#1e2132; --panel-2:#181b28; --hair:#2b2f47;
    --ink:#cdd0e2; --dim:#787da0; --faint:#565b7d; --accent:#f3c73e; --stage:#12141f;
    --shadow:rgba(0,0,0,.45);
    --sans:ui-rounded,"SF Pro Rounded","Segoe UI Variable Display","Segoe UI",system-ui,sans-serif;
    --mono:ui-monospace,"SF Mono","Cascadia Code","Roboto Mono",Menlo,monospace;
  }
  @media (prefers-color-scheme: light){
    :root{ --ground:#e9e7df; --panel:#f7f6f1; --panel-2:#efece3; --hair:#dcd8cc;
      --ink:#33313c; --dim:#88856f; --faint:#a9a690; --accent:#c9931a; --stage:#e2dfd4;
      --shadow:rgba(60,55,40,.18); }
  }
  :root[data-theme="dark"]{ --ground:#161826; --panel:#1e2132; --panel-2:#181b28; --hair:#2b2f47;
    --ink:#cdd0e2; --dim:#787da0; --faint:#565b7d; --accent:#f3c73e; --stage:#12141f; --shadow:rgba(0,0,0,.45); }
  :root[data-theme="light"]{ --ground:#e9e7df; --panel:#f7f6f1; --panel-2:#efece3; --hair:#dcd8cc;
    --ink:#33313c; --dim:#88856f; --faint:#a9a690; --accent:#c9931a; --stage:#e2dfd4; --shadow:rgba(60,55,40,.18); }

  *{box-sizing:border-box}
  body{margin:0;min-height:100vh;background:var(--ground);color:var(--ink);
    font-family:var(--sans);display:flex;align-items:center;justify-content:center;padding:32px 20px}
  .card{width:100%;max-width:560px;background:var(--panel);border:1px solid var(--hair);
    border-radius:18px;overflow:hidden;box-shadow:0 24px 60px -30px var(--shadow)}
  header{padding:22px 24px 16px;display:flex;align-items:baseline;justify-content:space-between;gap:12px;
    border-bottom:1px solid var(--hair)}
  .name{font-size:20px;font-weight:650;letter-spacing:-.01em}
  .name b{color:var(--accent);font-weight:650}
  .eyebrow{font-family:var(--mono);font-size:11px;letter-spacing:.14em;text-transform:uppercase;color:var(--dim)}
  .live{display:inline-flex;align-items:center;gap:6px}
  .dot{width:7px;height:7px;border-radius:50%;background:var(--accent);
    box-shadow:0 0 0 0 var(--accent);animation:pulse 4.6s ease-in-out infinite}
  @keyframes pulse{0%,100%{opacity:.4;transform:scale(.85)}50%{opacity:1;transform:scale(1.1)}}

  .stage{position:relative;background:
    radial-gradient(120% 90% at 50% 30%, color-mix(in srgb, var(--stage) 70%, transparent), var(--stage));
    background-color:var(--stage);min-height:280px;display:flex;align-items:center;justify-content:center;
    gap:36px;padding:34px 24px 40px}
  .floor{position:absolute;left:12%;right:12%;bottom:30px;height:14px;border-radius:50%;
    background:radial-gradient(50% 100% at 50% 0,var(--shadow),transparent);opacity:.9}
  .subject{position:relative;display:flex;flex-direction:column;align-items:center;gap:12px}
  canvas{image-rendering:pixelated;display:block;filter:drop-shadow(0 8px 10px rgba(0,0,0,.28))}
  .tag{font-family:var(--mono);font-size:10.5px;letter-spacing:.12em;text-transform:uppercase;color:var(--faint)}
  .cmp{display:none;opacity:.9}
  body.compare .cmp{display:flex}

  .zzz{position:absolute;top:26px;left:calc(50% + 40px);pointer-events:none}
  body.compare .zzz{left:calc(50% + 96px)}
  .zzz span{position:absolute;font-family:var(--mono);font-weight:700;color:var(--accent);opacity:0;
    animation:drift 5s linear infinite}
  .zzz span:nth-child(1){font-size:12px;animation-delay:0s}
  .zzz span:nth-child(2){font-size:15px;animation-delay:1.7s;left:9px}
  .zzz span:nth-child(3){font-size:18px;animation-delay:3.4s;left:20px}
  @keyframes drift{0%{opacity:0;transform:translate(0,6px)}18%{opacity:.85}100%{opacity:0;transform:translate(16px,-30px)}}

  .controls{display:flex;align-items:center;gap:14px;flex-wrap:wrap;padding:16px 24px 20px;
    background:var(--panel-2);border-top:1px solid var(--hair)}
  button{font-family:var(--sans);font-size:13px;color:var(--ink);background:transparent;
    border:1px solid var(--hair);border-radius:9px;padding:7px 13px;cursor:pointer;transition:.15s}
  button:hover{border-color:var(--accent);color:var(--accent)}
  button:focus-visible{outline:2px solid var(--accent);outline-offset:2px}
  button.on{background:color-mix(in srgb,var(--accent) 16%,transparent);border-color:var(--accent);color:var(--accent)}
  .seg{display:inline-flex;border:1px solid var(--hair);border-radius:9px;overflow:hidden}
  .seg button{border:0;border-radius:0;border-left:1px solid var(--hair)}
  .seg button:first-child{border-left:0}
  .spacer{flex:1}
  .meta{font-family:var(--mono);font-size:11px;color:var(--dim);font-variant-numeric:tabular-nums}
  @media (prefers-reduced-motion: reduce){.dot,.zzz span{animation:none}}
</style>

<div class="card">
  <header>
    <div>
      <div class="name">Meet <b>Ash</b>, curled up</div>
      <div class="eyebrow" style="margin-top:6px">Sleep clip · breathing loop</div>
    </div>
    <div class="eyebrow live"><span class="dot"></span> asleep</div>
  </header>

  <div class="stage" id="stage">
    <div class="floor"></div>
    <div class="subject cmp"><canvas id="idle"></canvas><div class="tag">standing · idle</div></div>
    <div class="subject"><canvas id="curl"></canvas><div class="tag">curled · sleeping</div></div>
    <div class="zzz" aria-hidden="true"><span>z</span><span>z</span><span>z</span></div>
  </div>

  <div class="controls">
    <button id="play" aria-pressed="true">Pause</button>
    <div class="seg" role="group" aria-label="Breathing speed">
      <button data-rate="0.5">Slow</button>
      <button data-rate="1" class="on">1×</button>
      <button data-rate="2">Quick</button>
    </div>
    <button id="cmp" aria-pressed="false">Compare</button>
    <span class="spacer"></span>
    <span class="meta" id="meta">frame 00 / ${N}</span>
  </div>
</div>

<script>
  const DATA = ${data};
  const SCALE = 5;              // 44px sprite -> 220px, crisp integer scale
  const BASE_MS = 5200;         // one calm breath at 1x
  const cv = document.getElementById('curl'), iv = document.getElementById('idle');
  const meta = document.getElementById('meta'), stage = document.body;
  for (const c of [cv, iv]){ c.width = DATA.w*SCALE; c.height = DATA.h*SCALE;
    const g = c.getContext('2d'); g.imageSmoothingEnabled = false; c._g = g; }
  const load = (src)=>{ const im = new Image(); im.src = src; return im; };
  const frames = DATA.curl.map(load), idleImg = load(DATA.idle);
  const draw = (canvas,img)=>{ const g = canvas._g; g.clearRect(0,0,canvas.width,canvas.height);
    if (img.complete) g.drawImage(img,0,0,canvas.width,canvas.height);
    else img.onload = ()=>g.drawImage(img,0,0,canvas.width,canvas.height); };
  draw(iv, idleImg);

  let rate = 1, playing = true, t0 = 0, idx = -1;
  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (reduce) playing = false;

  function show(i){ if (i===idx) return; idx=i; draw(cv, frames[i]);
    meta.textContent = 'frame ' + String(i+1).padStart(2,'0') + ' / ' + DATA.n; }

  function tick(now){ if (!t0) t0 = now;
    if (playing){ const cycle = BASE_MS/rate; const p = ((now - t0)/cycle) % 1;
      show(Math.floor(p*DATA.n) % DATA.n); }
    requestAnimationFrame(tick); }
  requestAnimationFrame(tick);
  show(reduce ? Math.floor(DATA.n/4) : 0); // mid-breath if paused

  const playBtn = document.getElementById('play');
  playBtn.textContent = playing ? 'Pause' : 'Play';
  playBtn.onclick = ()=>{ playing = !playing; if (playing) t0 = 0;
    playBtn.textContent = playing ? 'Pause' : 'Play'; playBtn.setAttribute('aria-pressed', playing); };

  for (const b of document.querySelectorAll('.seg button')) b.onclick = ()=>{
    document.querySelectorAll('.seg button').forEach((x)=>x.classList.remove('on'));
    b.classList.add('on'); rate = parseFloat(b.dataset.rate); t0 = 0; };

  const cmpBtn = document.getElementById('cmp');
  cmpBtn.onclick = ()=>{ const on = stage.classList.toggle('compare');
    cmpBtn.classList.toggle('on', on); cmpBtn.setAttribute('aria-pressed', on); };
</script>`

writeFileSync(out, html)
console.log('wrote ' + out + ' (' + html.length + ' bytes)')
