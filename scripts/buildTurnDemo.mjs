// Animated smooth ¾ turn: side <-> front, procedural morph frames.
//   node scripts/buildTurnDemo.mjs <out.html>
import { writeFileSync } from 'node:fs'
import { encodePNG } from './pngEncoder.mjs'
import { W, H, render } from './catgen.mjs'
import { generateTurnGrid } from './turncat.mjs'
import { PRESETS } from './presets.mjs'

const out = process.argv[2]
const ash = PRESETS.find((p) => p.id === 'ash')
const uri = (a) => 'data:image/png;base64,' + Buffer.from(encodePNG(W, H, render(generateTurnGrid(ash, a), ash.coat))).toString('base64')
const ease = (k) => (k < 0.5 ? 2 * k * k : 1 - Math.pow(-2 * k + 2, 2) / 2)

const N = 16
const frames = Array.from({ length: N + 1 }, (_, i) => uri(ease(i / N))) // a: 0..1 eased
const data = JSON.stringify({ w: W, h: H, frames })

const html = `<title>Ash · smooth ¾ turn</title>
<style>
  :root{ --bg:#14161f; --panel:#1d2030; --hair:#2c3048; --ink:#cdd0e2; --dim:#7f83a0; --accent:#9caf6e; --stage:#0f1119;
    --sans:ui-rounded,"SF Pro Rounded","Segoe UI",system-ui,sans-serif; --mono:ui-monospace,monospace; }
  @media (prefers-color-scheme: light){:root{--bg:#eceae3;--panel:#f6f5f0;--hair:#dcd8cc;--ink:#33313c;--dim:#87856f;--accent:#6f8a3e;--stage:#e6e3da}}
  :root[data-theme="light"]{--bg:#eceae3;--panel:#f6f5f0;--hair:#dcd8cc;--ink:#33313c;--dim:#87856f;--accent:#6f8a3e;--stage:#e6e3da}
  :root[data-theme="dark"]{--bg:#14161f;--panel:#1d2030;--hair:#2c3048;--ink:#cdd0e2;--dim:#7f83a0;--accent:#9caf6e;--stage:#0f1119}
  *{box-sizing:border-box} body{margin:0;min-height:100vh;background:var(--bg);color:var(--ink);font-family:var(--sans);display:flex;align-items:center;justify-content:center;padding:28px 18px}
  .card{width:100%;max-width:480px;background:var(--panel);border:1px solid var(--hair);border-radius:18px;overflow:hidden}
  header{padding:20px 24px 14px;border-bottom:1px solid var(--hair)} h1{font-size:19px;font-weight:650;margin:0} h1 b{color:var(--accent)}
  .sub{color:var(--dim);font-size:12.5px;margin-top:3px}
  .stage{background:var(--stage);display:flex;justify-content:center;position:relative;padding:20px 0 6px}
  canvas{image-rendering:pixelated;display:block}
  .floor{position:absolute;left:30%;right:30%;bottom:24px;height:10px;border-radius:50%;background:radial-gradient(50% 100% at 50% 0,rgba(0,0,0,.42),transparent)}
  .controls{display:flex;gap:12px;align-items:center;padding:14px 24px 18px;border-top:1px solid var(--hair)}
  button{font-family:var(--sans);font-size:13px;color:var(--ink);background:transparent;border:1px solid var(--hair);border-radius:9px;padding:8px 15px;cursor:pointer}
  button:hover{border-color:var(--accent);color:var(--accent)} .spacer{flex:1} .hint{font-family:var(--mono);font-size:11px;color:var(--dim)} input[type=range]{accent-color:var(--accent)}
</style>
<div class="card">
  <header><h1>Meet <b>Ash</b> — smooth side↔front turn</h1><div class="sub">Procedural ¾ frames: the far eye emerges, nose centres, body foreshortens. A real turn, not a fade or pivot.</div></header>
  <div class="stage"><div class="floor"></div><canvas id="c"></canvas></div>
  <div class="controls"><button id="play">Pause</button><span class="spacer"></span><span class="hint">drag to scrub</span><input type="range" id="sc" min="0" max="${N}" step="1" value="0"></div>
</div>
<script>
const D=${data}, S=8; const cv=document.getElementById('c'); cv.width=D.w*S; cv.height=D.h*S;
const ctx=cv.getContext('2d'); ctx.imageSmoothingEnabled=false; const imgs=D.frames.map(u=>{const i=new Image();i.src=u;return i});
const sc=document.getElementById('sc'); let playing=true, f=0, dir=1, last=0, acc=0; const N=${N}, HOLD=700; let hold=0;
function drawF(i){ const im=imgs[i]; if(im&&im.complete){ ctx.clearRect(0,0,cv.width,cv.height); ctx.drawImage(im,0,0,D.w,D.h,0,0,cv.width,cv.height);} }
function loop(now){ requestAnimationFrame(loop); if(!last)last=now; const dt=now-last; last=now; if(!playing) return;
  if(hold>0){ hold-=dt; return; } acc+=dt; while(acc>55){ acc-=55; f+=dir; if(f>=N){f=N;dir=-1;hold=HOLD;} else if(f<=0){f=0;dir=1;hold=HOLD;} } sc.value=f; drawF(f); }
requestAnimationFrame(loop);
const pb=document.getElementById('play'); pb.onclick=()=>{playing=!playing; pb.textContent=playing?'Pause':'Play';};
sc.oninput=()=>{ playing=false; pb.textContent='Play'; f=+sc.value; drawF(f); };
</script>`
writeFileSync(out, html); console.log('wrote ' + out)
