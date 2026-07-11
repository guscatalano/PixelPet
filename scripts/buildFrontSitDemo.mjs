// Demo: cat walks (side), then sits down (articulated) AND turns to face you,
// ending in our front-facing idle. node scripts/buildFrontSitDemo.mjs <out.html>
import { writeFileSync } from 'node:fs'
import { encodePNG } from './pngEncoder.mjs'
import { W, H, render, generateGrid, generateWalkGrid } from './catgen.mjs'
import { generateRigGrid, POSES } from './rigcat.mjs'
import { PRESETS } from './presets.mjs'

const out = process.argv[2]
const ash = PRESETS.find((p) => p.id === 'ash')
const uri = (rgba) => 'data:image/png;base64,' + Buffer.from(encodePNG(W, H, rgba)).toString('base64')

// Interpolate rig stand -> sit for the articulated (side) sit-down.
const lerp = (a, b, k) => a + (b - a) * k, lerpA = (a, b, k) => a.map((v, i) => lerp(v, b[i], k))
const lerpLeg = (a, b, k) => ({ hip: lerpA(a.hip, b.hip, k), mid: lerpA(a.mid, b.mid, k), foot: lerpA(a.foot, b.foot, k), near: a.near })
const lerpPose = (A, B, k) => ({ body: lerpA(A.body, B.body, k), head: lerpA(A.head, B.head, k), neck: lerpA(A.neck, B.neck, k),
  tail: { root: lerpA(A.tail.root, B.tail.root, k), ctrl: lerpA(A.tail.ctrl, B.tail.ctrl, k), tip: lerpA(A.tail.tip, B.tail.tip, k) },
  eye: lerp(A.eye, B.eye, k), legs: A.legs.map((l, i) => lerpLeg(l, B.legs[i], k)) })
const ease = (k) => (k < 0.5 ? 2 * k * k : 1 - Math.pow(-2 * k + 2, 2) / 2)

const WALK = Array.from({ length: 8 }, (_, i) => uri(render(generateWalkGrid(ash, i / 8), ash.coat)))
const SITDOWN = Array.from({ length: 8 }, (_, i) => uri(render(generateRigGrid(ash, lerpPose(POSES.stand, POSES.sit, ease(i / 7))), ash.coat)))
const FRONT = Array.from({ length: 4 }, (_, i) => uri(render(generateGrid(ash, { eyeOpen: i !== 2, tailPhase: Math.sin(i / 4 * Math.PI * 2) * 0.8 }), ash.coat)))
const data = JSON.stringify({ w: W, h: H, walk: WALK, sitdown: SITDOWN, front: FRONT })

const html = `<title>Ash · sit facing you</title>
<style>
  :root{ --bg:#14161f; --panel:#1d2030; --hair:#2c3048; --ink:#cdd0e2; --dim:#7f83a0; --accent:#9caf6e; --stage:#0f1119;
    --sans:ui-rounded,"SF Pro Rounded","Segoe UI",system-ui,sans-serif; --mono:ui-monospace,"Cascadia Code",monospace; }
  @media (prefers-color-scheme: light){:root{--bg:#eceae3;--panel:#f6f5f0;--hair:#dcd8cc;--ink:#33313c;--dim:#87856f;--accent:#6f8a3e;--stage:#e6e3da}}
  :root[data-theme="light"]{--bg:#eceae3;--panel:#f6f5f0;--hair:#dcd8cc;--ink:#33313c;--dim:#87856f;--accent:#6f8a3e;--stage:#e6e3da}
  :root[data-theme="dark"]{--bg:#14161f;--panel:#1d2030;--hair:#2c3048;--ink:#cdd0e2;--dim:#7f83a0;--accent:#9caf6e;--stage:#0f1119}
  *{box-sizing:border-box} body{margin:0;min-height:100vh;background:var(--bg);color:var(--ink);font-family:var(--sans);display:flex;align-items:center;justify-content:center;padding:28px 18px}
  .card{width:100%;max-width:520px;background:var(--panel);border:1px solid var(--hair);border-radius:18px;overflow:hidden}
  header{padding:20px 24px 14px;border-bottom:1px solid var(--hair)} h1{font-size:19px;font-weight:650;margin:0} h1 b{color:var(--accent)}
  .sub{color:var(--dim);font-size:12.5px;margin-top:3px} .now{font-family:var(--mono);font-size:11px;color:var(--accent);text-transform:uppercase;letter-spacing:.14em;margin-top:8px}
  .stage{background:var(--stage);display:flex;justify-content:center;position:relative;padding:20px 0 6px}
  canvas{image-rendering:pixelated;display:block}
  .floor{position:absolute;left:26%;right:26%;bottom:24px;height:11px;border-radius:50%;background:radial-gradient(50% 100% at 50% 0,rgba(0,0,0,.42),transparent)}
  .controls{display:flex;gap:12px;align-items:center;padding:14px 24px 18px;border-top:1px solid var(--hair)}
  button{font-family:var(--sans);font-size:13px;color:var(--ink);background:transparent;border:1px solid var(--hair);border-radius:9px;padding:8px 15px;cursor:pointer}
  button:hover{border-color:var(--accent);color:var(--accent)} .spacer{flex:1} .hint{font-family:var(--mono);font-size:11px;color:var(--dim)}
</style>
<div class="card">
  <header><h1>Meet <b>Ash</b> — sits facing you</h1>
  <div class="sub">Walks side-on, sits down (rear lowers, articulated), then <b>turns to face you</b> into the front idle. Only the side↔front turn is a pivot; the sitting is real motion.</div>
  <div class="now" id="now">walking</div></header>
  <div class="stage"><div class="floor"></div><canvas id="c"></canvas></div>
  <div class="controls"><button id="play">Pause</button><span class="spacer"></span><span class="hint" id="lab">auto loop</span></div>
</div>
<script>
const D=${data}, S=7; const cv=document.getElementById('c'); cv.width=D.w*S; cv.height=(D.h+3)*S;
const ctx=cv.getContext('2d'); ctx.imageSmoothingEnabled=false; const FX=cv.width/2, FY=cv.height-3;
const mk=a=>a.map(u=>{const i=new Image();i.src=u;return i}); const WALK=mk(D.walk),SIT=mk(D.sitdown),FRONT=mk(D.front);
function draw(img,sx){ if(!img||!img.complete) return; ctx.save(); ctx.translate(FX,FY); ctx.scale(sx,1);
  ctx.drawImage(img,0,0,D.w,D.h, -D.w*S/2, -D.h*S, D.w*S, D.h*S); ctx.restore(); }
const lerp=(a,b,k)=>a+(b-a)*k, clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
let playing=true, t0=0, phase='walk', pStart=0;
const SEQ={walk:2000, toSit:820, sit:2400, toWalk:820}; const NEXT={walk:'toSit',toSit:'sit',sit:'toWalk',toWalk:'walk'};
const nowEl=document.getElementById('now'), NAME={walk:'walking',toSit:'sitting down',sit:'sitting (facing you)',toWalk:'getting up'};
function loop(now){ requestAnimationFrame(loop); if(!t0){t0=now;pStart=now;} if(!playing)return;
  const el=now-pStart;
  if(el>SEQ[phase]){ phase=NEXT[phase]; pStart=now; nowEl.textContent=NAME[phase]; }
  ctx.clearRect(0,0,cv.width,cv.height); const p=clamp((now-pStart)/SEQ[phase],0,1);
  if(phase==='walk'){ draw(WALK[Math.floor((now/110)%WALK.length)],1); }
  else if(phase==='sit'){ draw(FRONT[Math.floor((now/300)%FRONT.length)],1); }
  else if(phase==='toSit'){
    if(p<0.55){ draw(SIT[Math.floor(p/0.55*(SIT.length-1))],1); }              // lower rear (side, articulated)
    else { const tt=(p-0.55)/0.45; if(tt<0.5) draw(SIT[SIT.length-1], lerp(1,0.12,tt/0.5)); else draw(FRONT[0], lerp(0.12,1,(tt-0.5)/0.5)); } // turn to face you
  } else { // toWalk: front -> turn -> stand up (side) -> walk
    if(p<0.45){ const tt=p/0.45; if(tt<0.5) draw(FRONT[0], lerp(1,0.12,tt/0.5)); else draw(SIT[SIT.length-1], lerp(0.12,1,(tt-0.5)/0.5)); }
    else { const s=(p-0.45)/0.55; draw(SIT[Math.floor((1-s)*(SIT.length-1))],1); }
  }
}
requestAnimationFrame(loop);
const pb=document.getElementById('play'); pb.onclick=()=>{playing=!playing; pb.textContent=playing?'Pause':'Play';};
</script>`
writeFileSync(out, html)
console.log('wrote ' + out)
