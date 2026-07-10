// Build a self-contained demo comparing hard-cut vs cross-fade pose transitions.
//   node scripts/buildTransitionsDemo.mjs <out.html>
import { writeFileSync } from 'node:fs'
import { encodePNG } from './pngEncoder.mjs'
import { render, generateGrid, generateWalkGrid, generateCurlGrid, W, H } from './catgen.mjs'
import { PRESETS } from './presets.mjs'

const out = process.argv[2]
const ash = PRESETS.find((p) => p.id === 'ash')
const uri = (rgba) => 'data:image/png;base64,' + Buffer.from(encodePNG(W, H, rgba)).toString('base64')

// A handful of frames per clip (the demo loops them while a clip is active).
const idle = Array.from({ length: 8 }, (_, i) => uri(render(generateGrid(ash, { eyeOpen: i !== 5, tailPhase: Math.sin((i / 8) * Math.PI * 2) * 0.9 }), ash.coat)))
const walk = Array.from({ length: 8 }, (_, i) => uri(render(generateWalkGrid(ash, i / 8), ash.coat)))
const sleep = Array.from({ length: 10 }, (_, i) => uri(render(generateCurlGrid(ash, (i / 10) * Math.PI * 2), ash.coat)))
const react = [
  uri(render(generateGrid(ash, { eyeOpen: false, tailPhase: 0.2 }), ash.coat)),
  uri(render(generateGrid(ash, { eyeOpen: true, look: 1, tailPhase: 0.3 }), ash.coat)),
  uri(render(generateGrid(ash, { eyeOpen: true, look: 1, tailPhase: 0.4 }), ash.coat))
]
const data = JSON.stringify({ w: W, h: H, idle, walk, sleep, react })

const html = `<title>Ash · pose transitions</title>
<style>
  :root{
    --bg:#14161f; --panel:#1d2030; --hair:#2c3048; --ink:#cdd0e2; --dim:#7f83a0; --accent:#9caf6e; --stage:#0f1119;
    --sans:ui-rounded,"SF Pro Rounded","Segoe UI",system-ui,sans-serif; --mono:ui-monospace,"Cascadia Code",monospace;
  }
  @media (prefers-color-scheme: light){:root{--bg:#eceae3;--panel:#f6f5f0;--hair:#dcd8cc;--ink:#33313c;--dim:#87856f;--accent:#6f8a3e;--stage:#e2dfd4}}
  :root[data-theme="light"]{--bg:#eceae3;--panel:#f6f5f0;--hair:#dcd8cc;--ink:#33313c;--dim:#87856f;--accent:#6f8a3e;--stage:#e2dfd4}
  :root[data-theme="dark"]{--bg:#14161f;--panel:#1d2030;--hair:#2c3048;--ink:#cdd0e2;--dim:#7f83a0;--accent:#9caf6e;--stage:#0f1119}
  *{box-sizing:border-box} body{margin:0;min-height:100vh;background:var(--bg);color:var(--ink);font-family:var(--sans);
    display:flex;align-items:center;justify-content:center;padding:28px 18px}
  .card{width:100%;max-width:600px;background:var(--panel);border:1px solid var(--hair);border-radius:18px;overflow:hidden}
  header{padding:20px 24px 14px;border-bottom:1px solid var(--hair)}
  h1{font-size:19px;font-weight:650;margin:0} h1 b{color:var(--accent)}
  .sub{color:var(--dim);font-size:12.5px;margin-top:3px}
  .now{font-family:var(--mono);font-size:11px;color:var(--accent);text-transform:uppercase;letter-spacing:.12em;margin-top:8px}
  .stage{display:flex;gap:1px;background:var(--hair)}
  .col{flex:1;background:var(--stage);display:flex;flex-direction:column;align-items:center;gap:8px;padding:22px 10px 18px;position:relative}
  .col h2{font-family:var(--mono);font-size:11px;letter-spacing:.12em;text-transform:uppercase;color:var(--dim);margin:0}
  canvas{image-rendering:pixelated;display:block}
  .floor{position:absolute;left:20%;right:20%;bottom:44px;height:10px;border-radius:50%;background:radial-gradient(50% 100% at 50% 0,rgba(0,0,0,.4),transparent)}
  .controls{display:flex;gap:12px;align-items:center;flex-wrap:wrap;padding:14px 24px 18px;background:var(--panel);border-top:1px solid var(--hair)}
  button{font-family:var(--sans);font-size:13px;color:var(--ink);background:transparent;border:1px solid var(--hair);border-radius:9px;padding:7px 14px;cursor:pointer}
  button:hover{border-color:var(--accent);color:var(--accent)}
  .spacer{flex:1} .hint{font-family:var(--mono);font-size:11px;color:var(--dim)}
  input[type=range]{accent-color:var(--accent)}
</style>
<div class="card">
  <header>
    <h1>Meet <b>Ash</b> — pose transitions</h1>
    <div class="sub">Same clip sequence on both sides. Left cuts instantly; right <b>turns</b> — the cat squashes as it pivots to the new pose (no fade). Watch the idle↔walk↔sleep switches.</div>
    <div class="now" id="now">idle</div>
  </header>
  <div class="stage">
    <div class="col"><h2>Hard cut</h2><div class="floor"></div><canvas id="snap"></canvas></div>
    <div class="col"><h2>Turn — animate through</h2><div class="floor"></div><canvas id="fade"></canvas></div>
  </div>
  <div class="controls">
    <button id="play">Pause</button>
    <button id="trig">Trigger next now</button>
    <span class="spacer"></span>
    <span class="hint">turn&nbsp;<span id="ms">280</span>ms</span>
    <input type="range" id="dur" min="140" max="520" step="20" value="280">
  </div>
</div>
<script>
  const DATA = ${data}, SCALE = 5;
  const SEQ = [
    {clip:'idle', ms:2200, fps:8, face:1},
    {clip:'walk', ms:2400, fps:10, face:1},
    {clip:'sleep', ms:2600, fps:6, face:1},
    {clip:'react', ms:1500, fps:3, face:1},
  ];
  const load = (s)=>{const i=new Image();i.src=s;return i};
  const FR = {idle:DATA.idle.map(load), walk:DATA.walk.map(load), sleep:DATA.sleep.map(load), react:DATA.react.map(load)};
  const cw = DATA.w*SCALE, ch = (DATA.h+8)*SCALE;
  const snap = document.getElementById('snap'), fade = document.getElementById('fade');
  for (const c of [snap,fade]){ c.width=cw; c.height=ch; const g=c.getContext('2d'); g.imageSmoothingEnabled=false; c._g=g; }

  let idx=0, clipStart=0, playing=true, turnMs=280, t0=0;
  let prev=null; // {clip, frame, at, face}
  const nowEl=document.getElementById('now');

  function frameOf(s, t){ const arr=FR[s.clip]; const i=Math.floor(t/1000*s.fps)%arr.length; return arr[i]; }
  // Draw a frame at scaleX = sx about the vertical centre (sx<0 flips for facing).
  function drawScaled(g, img, sx){ if(!img||!img.complete) return; g.save();
    g.translate(cw/2,0); g.scale(sx,1); g.translate(-cw/2,0);
    g.drawImage(img,0,0,DATA.w,DATA.h, 0, 8*SCALE, DATA.w*SCALE, DATA.h*SCALE); g.restore(); }

  function step(now){
    requestAnimationFrame(step);
    if(!t0) t0=now;
    if(!playing){ return; }
    const el = now - clipStart;
    const s = SEQ[idx];
    if(el > s.ms){ // advance
      prev = {clip:s.clip, frame:frameOf(s, el), face:s.face, at:now};
      idx=(idx+1)%SEQ.length; clipStart=now; nowEl.textContent=SEQ[idx].clip;
    }
    const cur = SEQ[idx];
    const curImg = frameOf(cur, now-clipStart);
    // Hard-cut canvas: just the current frame.
    let g=snap._g; g.clearRect(0,0,cw,ch); drawScaled(g, curImg, cur.face);
    // Turn canvas: squash horizontally to a sliver, swap pose at the pinch, expand.
    g=fade._g; g.clearRect(0,0,cw,ch);
    const p = prev ? (now - prev.at)/turnMs : 1;
    if(prev && p<1){
      const sx = Math.abs(Math.cos(p*Math.PI))*0.9 + 0.1; // 1 -> 0.1 -> 1
      const half = p<0.5 ? prev : cur;
      const img = p<0.5 ? prev.frame : curImg;
      drawScaled(g, img, sx*half.face);
    } else { prev=null; drawScaled(g, curImg, cur.face); }
  }
  requestAnimationFrame(step);

  const playBtn=document.getElementById('play');
  playBtn.onclick=()=>{ playing=!playing; playBtn.textContent=playing?'Pause':'Play'; if(playing){ const j=performance.now(); clipStart=j-0; } };
  document.getElementById('trig').onclick=()=>{ const now=performance.now(); const s=SEQ[idx];
    prev={clip:s.clip, frame:frameOf(s, now-clipStart), face:s.face, at:now}; idx=(idx+1)%SEQ.length; clipStart=now; nowEl.textContent=SEQ[idx].clip; };
  const dur=document.getElementById('dur'), msEl=document.getElementById('ms');
  dur.oninput=()=>{ turnMs=+dur.value; msEl.textContent=dur.value; };
</script>`

writeFileSync(out, html)
console.log('wrote ' + out + ' (' + html.length + ' bytes)')
