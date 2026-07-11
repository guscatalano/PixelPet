// Animated demo of the OUR-CAT-styled rig: articulated get-up / lie-down by
// interpolating shared joints. Pre-renders frames and plays them.
//   node scripts/buildRigCatDemo.mjs <out.html>
import { writeFileSync } from 'node:fs'
import { encodePNG } from './pngEncoder.mjs'
import { W, H, render } from './catgen.mjs'
import { generateRigGrid, POSES } from './rigcat.mjs'
import { PRESETS } from './presets.mjs'

const out = process.argv[2]
const ash = PRESETS.find((p) => p.id === 'ash')
const uri = (pose) => 'data:image/png;base64,' + Buffer.from(encodePNG(W, H, render(generateRigGrid(ash, pose), ash.coat))).toString('base64')

const lerp = (a, b, k) => a + (b - a) * k
const lerpA = (a, b, k) => a.map((v, i) => lerp(v, b[i], k))
const lerpLeg = (a, b, k) => ({ hip: lerpA(a.hip, b.hip, k), mid: lerpA(a.mid, b.mid, k), foot: lerpA(a.foot, b.foot, k), near: a.near })
const lerpPose = (A, B, k) => ({
  body: lerpA(A.body, B.body, k), head: lerpA(A.head, B.head, k), neck: lerpA(A.neck, B.neck, k),
  tail: { root: lerpA(A.tail.root, B.tail.root, k), ctrl: lerpA(A.tail.ctrl, B.tail.ctrl, k), tip: lerpA(A.tail.tip, B.tail.tip, k) },
  eye: lerp(A.eye, B.eye, k), legs: A.legs.map((l, i) => lerpLeg(l, B.legs[i], k))
})
const ease = (k) => (k < 0.5 ? 2 * k * k : 1 - Math.pow(-2 * k + 2, 2) / 2)

// Build a frame sequence (dedup identical held frames by index).
const uniq = [], order = [], keyToIdx = new Map()
function push(pose) { const u = uri(pose); let i = keyToIdx.get(u); if (i === undefined) { i = uniq.length; uniq.push(u); keyToIdx.set(u, i) } order.push(i) }
function hold(pose, n) { for (let i = 0; i < n; i++) push(pose) }
function trans(A, B, n) { for (let i = 1; i <= n; i++) push(lerpPose(A, B, ease(i / n))) }

const { sit, stand, curl } = POSES
hold(sit, 10)
trans(sit, stand, 12)   // stand up
hold(stand, 12)
trans(stand, sit, 13)   // sit down
hold(sit, 12)
trans(sit, curl, 14)    // lie down
hold(curl, 16)
trans(curl, sit, 14)    // get back up to sit

const data = JSON.stringify({ w: W, h: H, uniq, order })
const html = `<title>Ash · articulated transitions</title>
<style>
  :root{ --bg:#14161f; --panel:#1d2030; --hair:#2c3048; --ink:#cdd0e2; --dim:#7f83a0; --accent:#9caf6e; --stage:#0f1119;
    --sans:ui-rounded,"SF Pro Rounded","Segoe UI",system-ui,sans-serif; --mono:ui-monospace,"Cascadia Code",monospace; }
  @media (prefers-color-scheme: light){:root{--bg:#eceae3;--panel:#f6f5f0;--hair:#dcd8cc;--ink:#33313c;--dim:#87856f;--accent:#6f8a3e;--stage:#e6e3da}}
  :root[data-theme="light"]{--bg:#eceae3;--panel:#f6f5f0;--hair:#dcd8cc;--ink:#33313c;--dim:#87856f;--accent:#6f8a3e;--stage:#e6e3da}
  :root[data-theme="dark"]{--bg:#14161f;--panel:#1d2030;--hair:#2c3048;--ink:#cdd0e2;--dim:#7f83a0;--accent:#9caf6e;--stage:#0f1119}
  *{box-sizing:border-box} body{margin:0;min-height:100vh;background:var(--bg);color:var(--ink);font-family:var(--sans);display:flex;align-items:center;justify-content:center;padding:28px 18px}
  .card{width:100%;max-width:520px;background:var(--panel);border:1px solid var(--hair);border-radius:18px;overflow:hidden}
  header{padding:20px 24px 14px;border-bottom:1px solid var(--hair)} h1{font-size:19px;font-weight:650;margin:0} h1 b{color:var(--accent)}
  .sub{color:var(--dim);font-size:12.5px;margin-top:3px}
  .stage{background:var(--stage);display:flex;justify-content:center;position:relative;padding:20px 0 6px}
  canvas{image-rendering:pixelated;display:block}
  .floor{position:absolute;left:20%;right:20%;bottom:24px;height:11px;border-radius:50%;background:radial-gradient(50% 100% at 50% 0,rgba(0,0,0,.42),transparent)}
  .controls{display:flex;gap:12px;align-items:center;padding:14px 24px 18px;border-top:1px solid var(--hair)}
  button{font-family:var(--sans);font-size:13px;color:var(--ink);background:transparent;border:1px solid var(--hair);border-radius:9px;padding:8px 15px;cursor:pointer}
  button:hover{border-color:var(--accent);color:var(--accent)} .spacer{flex:1} .hint{font-family:var(--mono);font-size:11px;color:var(--dim)}
  input[type=range]{accent-color:var(--accent)}
</style>
<div class="card">
  <header><h1>Meet <b>Ash</b> — articulated transitions, our cat's look</h1>
  <div class="sub">One rig, rendered with our real cat art. It <b>gets up</b> and <b>lies down</b> by moving its legs & body — no fade.</div></header>
  <div class="stage"><div class="floor"></div><canvas id="c"></canvas></div>
  <div class="controls"><button id="play">Pause</button><span class="spacer"></span><span class="hint">speed <span id="v">1.0</span>×</span><input type="range" id="s" min="50" max="180" step="10" value="100"></div>
</div>
<script>
const D=${data}, S=7; const cv=document.getElementById('c'); cv.width=D.w*S; cv.height=D.h*S;
const ctx=cv.getContext('2d'); ctx.imageSmoothingEnabled=false;
const imgs=D.uniq.map(u=>{const i=new Image();i.src=u;return i});
let f=0, acc=0, last=0, playing=true, spd=1; const FPS=22;
function loop(now){ requestAnimationFrame(loop); if(!last)last=now; const dt=now-last; last=now; if(!playing) return;
  acc+=dt*spd; while(acc>1000/FPS){ acc-=1000/FPS; f=(f+1)%D.order.length; }
  const im=imgs[D.order[f]]; if(im&&im.complete){ ctx.clearRect(0,0,cv.width,cv.height); ctx.drawImage(im,0,0,D.w,D.h,0,0,cv.width,cv.height); } }
requestAnimationFrame(loop);
const pb=document.getElementById('play'); pb.onclick=()=>{playing=!playing; pb.textContent=playing?'Pause':'Play';};
const sl=document.getElementById('s'), vv=document.getElementById('v'); sl.oninput=()=>{spd=+sl.value/100; vv.textContent=spd.toFixed(1);};
</script>`
writeFileSync(out, html)
console.log('wrote ' + out + ' (' + html.length + ' bytes, ' + uniq.length + ' unique frames)')
