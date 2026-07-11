// Prototype: natural-feeling transitions for the CURRENT cat poses using motion
// (squash/stretch/translate) instead of a fade. node scripts/buildMotionDemo.mjs <out.html>
import { writeFileSync } from 'node:fs'
import { encodePNG } from './pngEncoder.mjs'
import { render, generateGrid, generateWalkGrid, generateCurlGrid, W, H } from './catgen.mjs'
import { PRESETS } from './presets.mjs'

const out = process.argv[2]
const ash = PRESETS.find((p) => p.id === 'ash')
const uri = (rgba) => 'data:image/png;base64,' + Buffer.from(encodePNG(W, H, rgba)).toString('base64')

const idle = Array.from({ length: 8 }, (_, i) => uri(render(generateGrid(ash, { eyeOpen: i !== 5, tailPhase: Math.sin((i / 8) * Math.PI * 2) * 0.9 }), ash.coat)))
const walk = Array.from({ length: 8 }, (_, i) => uri(render(generateWalkGrid(ash, i / 8), ash.coat)))
const sleep = Array.from({ length: 10 }, (_, i) => uri(render(generateCurlGrid(ash, (i / 10) * Math.PI * 2), ash.coat)))
const data = JSON.stringify({ w: W, h: H, idle, walk, sleep })

const html = `<title>Ash · natural transitions</title>
<style>
  :root{ --bg:#14161f; --panel:#1d2030; --hair:#2c3048; --ink:#cdd0e2; --dim:#7f83a0; --accent:#9caf6e; --stage:#0f1119;
    --sans:ui-rounded,"SF Pro Rounded","Segoe UI",system-ui,sans-serif; --mono:ui-monospace,"Cascadia Code",monospace; }
  @media (prefers-color-scheme: light){:root{--bg:#eceae3;--panel:#f6f5f0;--hair:#dcd8cc;--ink:#33313c;--dim:#87856f;--accent:#6f8a3e;--stage:#e6e3da}}
  :root[data-theme="light"]{--bg:#eceae3;--panel:#f6f5f0;--hair:#dcd8cc;--ink:#33313c;--dim:#87856f;--accent:#6f8a3e;--stage:#e6e3da}
  :root[data-theme="dark"]{--bg:#14161f;--panel:#1d2030;--hair:#2c3048;--ink:#cdd0e2;--dim:#7f83a0;--accent:#9caf6e;--stage:#0f1119}
  *{box-sizing:border-box} body{margin:0;min-height:100vh;background:var(--bg);color:var(--ink);font-family:var(--sans);
    display:flex;align-items:center;justify-content:center;padding:28px 18px}
  .card{width:100%;max-width:520px;background:var(--panel);border:1px solid var(--hair);border-radius:18px;overflow:hidden}
  header{padding:20px 24px 14px;border-bottom:1px solid var(--hair)}
  h1{font-size:19px;font-weight:650;margin:0} h1 b{color:var(--accent)}
  .sub{color:var(--dim);font-size:12.5px;margin-top:3px}
  .now{font-family:var(--mono);font-size:11px;color:var(--accent);text-transform:uppercase;letter-spacing:.14em;margin-top:8px}
  .stage{background:var(--stage);display:flex;justify-content:center;position:relative;padding:18px 0 4px}
  canvas{image-rendering:pixelated;display:block}
  .floor{position:absolute;left:24%;right:24%;bottom:22px;height:10px;border-radius:50%;background:radial-gradient(50% 100% at 50% 0,rgba(0,0,0,.42),transparent)}
  .controls{display:flex;gap:10px;align-items:center;flex-wrap:wrap;padding:14px 24px 18px;border-top:1px solid var(--hair)}
  button{font-family:var(--sans);font-size:13px;color:var(--ink);background:transparent;border:1px solid var(--hair);border-radius:9px;padding:8px 15px;cursor:pointer}
  button:hover{border-color:var(--accent);color:var(--accent)}
  button.on{background:color-mix(in srgb,var(--accent) 16%,transparent);border-color:var(--accent);color:var(--accent)}
  .spacer{flex:1} .hint{font-family:var(--mono);font-size:11px;color:var(--dim)}
  input[type=range]{accent-color:var(--accent)}
</style>
<div class="card">
  <header>
    <h1>Meet <b>Ash</b> — natural transitions (no rig)</h1>
    <div class="sub">Same poses we have now. Transitions use <b>motion</b>: sink + squash to lie down, rise + stretch to get up, a crouch to set off walking — instead of a fade.</div>
    <div class="now" id="now">idle</div>
  </header>
  <div class="stage"><div class="floor"></div><canvas id="c"></canvas></div>
  <div class="controls">
    <button data-s="idle">Idle</button>
    <button data-s="walk">Walk</button>
    <button data-s="sleep">Sleep</button>
    <button id="auto" class="on">Auto</button>
    <span class="spacer"></span>
    <span class="hint">speed <span id="ms">1.0</span>×</span>
    <input type="range" id="spd" min="50" max="160" step="10" value="100">
  </div>
</div>
<script>
const DATA=${data}, S=6, GW=DATA.w, GH=DATA.h;
const cv=document.getElementById('c'); cv.width=GW*S; cv.height=(GH+6)*S;
const ctx=cv.getContext('2d'); ctx.imageSmoothingEnabled=false;
const FEETX=cv.width/2, FEETY=(GH+3)*S; // feet baseline
const load=s=>{const i=new Image();i.src=s;return i};
const FR={idle:DATA.idle.map(load), walk:DATA.walk.map(load), sleep:DATA.sleep.map(load)};
const FACE={idle:1, walk:1, sleep:1};

// Draw a sprite anchored at the feet, with squash (sx,sy about the feet) + vertical offset.
function drawLayer(img, facing, yOff, sx, sy, alpha){ if(!img||!img.complete||alpha<=0) return;
  ctx.save(); ctx.globalAlpha=alpha; ctx.translate(FEETX, FEETY+yOff); ctx.scale(sx*facing, sy);
  ctx.drawImage(img,0,0,GW,GH, -GW*S/2, -GH*S, GW*S, GH*S); ctx.restore(); }
const clamp=(v,a,b)=>Math.max(a,Math.min(b,v)), smooth=s=>s*s*(3-2*s);
function frameOf(st,t){ const a=FR[st]; const fps=st==='walk'?9:st==='sleep'?5:7; return a[Math.floor(t/1000*fps)%a.length]; }

// transition kinds by (from -> to)
function kind(a,b){ if(b==='sleep')return 'lie'; if(a==='sleep')return 'rise'; if(b==='walk')return 'gather'; return 'settle'; }
const DUR={lie:560, rise:560, gather:380, settle:340};

let state='idle', arriveT=0, playing=true, spd=1, tl=0;
let trans=null; // {from,fromFrame,to,type,dur,start}
const AUTO=[['idle',2000],['walk',2600],['idle',1500],['sleep',2800]]; let ai=0, aNext=0;
const nowEl=document.getElementById('now');
function go(to,now){ if(to===state && !trans) return; const type=kind(state,to);
  trans={from:state, fromFrame:frameOf(state, now-arriveT), to, type, dur:DUR[type]/spd, start:now}; state=to; arriveT=now; nowEl.textContent=to; }

function render(now){ requestAnimationFrame(render); if(!tl)tl=now; if(!playing)return;
  if(!autoOff && now>=aNext){ const [s,d]=AUTO[ai]; go(s,now); aNext=now+d/spd; ai=(ai+1)%AUTO.length; }
  ctx.clearRect(0,0,cv.width,cv.height);
  const curFrame=frameOf(state, now-arriveT);
  if(trans){ const p=clamp((now-trans.start)/trans.dur,0,1); const e=smooth(p), DOWN=GH*S*0.16;
    const pf=trans.fromFrame, pFace=FACE[trans.from], cFace=FACE[trans.to];
    if(trans.type==='lie'){
      drawLayer(pf,pFace, e*DOWN, 1+e*0.14, 1-e*0.42, 1-clamp((p-0.55)/0.45,0,1));   // sink + flatten out
      drawLayer(curFrame,cFace, 0, 1, 1, clamp((p-0.5)/0.5,0,1));                      // curl settles at ground
    } else if(trans.type==='rise'){
      drawLayer(pf,pFace, 0, 1, 1, 1-clamp(p/0.5,0,1));                                // curl fades
      drawLayer(curFrame,cFace, (1-e)*DOWN, 1+(1-e)*0.14, 1-(1-e)*0.42, clamp((p-0.35)/0.65,0,1)); // rise + stretch up
    } else if(trans.type==='gather'){
      const crouch=Math.sin(clamp(p/0.5,0,1)*Math.PI)*0.16;                            // quick anticipation dip
      drawLayer(pf,pFace, crouch*DOWN, 1+crouch*0.4, 1-crouch, 1-clamp((p-0.5)/0.5,0,1));
      drawLayer(curFrame,cFace, 0,1,1, clamp((p-0.45)/0.55,0,1));
    } else { // settle
      drawLayer(pf,pFace, 0,1,1, 1-clamp((p-0.25)/0.45,0,1));
      const land=Math.sin(clamp((p-0.3)/0.7,0,1)*Math.PI)*0.1;                         // small settle bounce
      drawLayer(curFrame,cFace, land*DOWN, 1+land*0.3, 1-land, clamp((p-0.2)/0.6,0,1));
    }
    if(p>=1) trans=null;
  } else drawLayer(curFrame, FACE[state], 0,1,1,1);
}
requestAnimationFrame(render);

let autoOff=false;
for(const b of document.querySelectorAll('[data-s]')) b.onclick=()=>{ autoOff=true; document.getElementById('auto').classList.remove('on'); go(b.dataset.s, performance.now()); };
document.getElementById('auto').onclick=(e)=>{ autoOff=!autoOff; e.target.classList.toggle('on',!autoOff); if(!autoOff)aNext=performance.now(); };
const spdEl=document.getElementById('spd'), ms=document.getElementById('ms'); spdEl.oninput=()=>{spd=+spdEl.value/100; ms.textContent=(spd).toFixed(1);};
</script>`

writeFileSync(out, html)
console.log('wrote ' + out + ' (' + html.length + ' bytes)')
