// Full natural sequence with a keyframe ¾ turn: walk (side) -> sit down
// (articulated rig) -> turn to face you (¾ keyframes, blinking through the
// turn) -> front idle -> reverse. node scripts/buildTurn34Demo.mjs <out.html>
import { writeFileSync } from 'node:fs'
import { encodePNG } from './pngEncoder.mjs'
import { W, H, render, generateGrid, generateWalkGrid } from './catgen.mjs'
import { generateRigGrid, POSES } from './rigcat.mjs'
import { generate34Grid } from './turn34.mjs'
import { PRESETS } from './presets.mjs'

const out = process.argv[2]
const ash = PRESETS.find((p) => p.id === 'ash')
const uri = (rgba) => 'data:image/png;base64,' + Buffer.from(encodePNG(W, H, rgba)).toString('base64')

// rig pose lerp (same as buildRigCatDemo)
const lerp = (a, b, k) => a + (b - a) * k, lerpA = (a, b, k) => a.map((v, i) => lerp(v, b[i], k))
const lerpLeg = (a, b, k) => ({ hip: lerpA(a.hip, b.hip, k), mid: lerpA(a.mid, b.mid, k), foot: lerpA(a.foot, b.foot, k), near: a.near })
const lerpPose = (A, B, k) => ({ body: lerpA(A.body, B.body, k), head: lerpA(A.head, B.head, k), neck: lerpA(A.neck, B.neck, k),
  // body2 (e.g. the stretch's raised rear) grows out of / melts into the main body when only one side has it
  body2: (A.body2 || B.body2) ? lerpA(A.body2 || A.body, B.body2 || B.body, k) : undefined,
  tail: { root: lerpA(A.tail.root, B.tail.root, k), ctrl: lerpA(A.tail.ctrl, B.tail.ctrl, k), tip: lerpA(A.tail.tip, B.tail.tip, k) },
  eye: lerp(A.eye, B.eye, k), legs: A.legs.map((l, i) => lerpLeg(l, B.legs[i], k)) })
const ease = (k) => (k < 0.5 ? 2 * k * k : 1 - Math.pow(-2 * k + 2, 2) / 2)

// ---- frames ----------------------------------------------------------------
const walk = Array.from({ length: 8 }, (_, i) => uri(render(generateWalkGrid(ash, i / 8), ash.coat)))
// stand -> sit (articulated, side view)
const sitdown = Array.from({ length: 7 }, (_, i) => uri(render(generateRigGrid(ash, lerpPose(POSES.stand, POSES.sit, ease(i / 6))), ash.coat)))
// ¾ turn keyframes, EYES CLOSED through the turn (blink masks the eye-count change),
// each with a draw offset so the head tracks from its side position to centre.
const TURN = [
  { t: 1.0, blink: true, ox: 8, oy: 2 },
  { t: 0.62, blink: true, ox: 4, oy: 1 },
  { t: 0.28, blink: false, ox: 1, oy: 0 }
]
const turn = TURN.map((k) => ({ u: uri(render(generate34Grid(ash, k.t, { eyeOpen: !k.blink }), ash.coat)), ox: k.ox, oy: k.oy }))
// front idle (tail sway + occasional blink)
const front = Array.from({ length: 10 }, (_, i) =>
  uri(render(generateGrid(ash, { eyeOpen: i !== 6, tailPhase: Math.sin((i / 10) * Math.PI * 2) * 0.9 }), ash.coat)))
// yawn (front-facing): mouth opens wide, eyes squeezed, then closes
const yawnKs = [0.3, 0.65, 1, 1, 1, 0.6, 0.25]
const yawn = yawnKs.map((k) => uri(render(generate34Grid(ash, 0, { yawn: k }), ash.coat)))
// lie down: side sit -> curl (articulated)
const lie = Array.from({ length: 7 }, (_, i) => uri(render(generateRigGrid(ash, lerpPose(POSES.sit, POSES.curl, ease(i / 6))), ash.coat)))
// sleeping: the curl breathing (body swells gently)
const sleep = Array.from({ length: 6 }, (_, i) => {
  const br = Math.sin((i / 6) * Math.PI * 2)
  const p = lerpPose(POSES.curl, POSES.curl, 0)
  p.body = [p.body[0], p.body[1] - br * 0.25, p.body[2], p.body[3] + br * 0.5]
  return uri(render(generateRigGrid(ash, p), ash.coat))
})
// the wake-up stretch: stand -> stretch (chest sinks, butt up, front legs slide out)
const stretch = Array.from({ length: 6 }, (_, i) => uri(render(generateRigGrid(ash, lerpPose(POSES.stand, POSES.stretch, ease(i / 5))), ash.coat)))
// teetering at an edge: enter from stand, wobble teeter <-> teeterFwd, recover
const teeterIn = Array.from({ length: 4 }, (_, i) => uri(render(generateRigGrid(ash, lerpPose(POSES.stand, POSES.teeter, ease(i / 3))), ash.coat)))
const wobble = Array.from({ length: 8 }, (_, i) => {
  const k = 0.5 + 0.5 * Math.sin((i / 8) * Math.PI * 2)
  return uri(render(generateRigGrid(ash, lerpPose(POSES.teeter, POSES.teeterFwd, k)), ash.coat))
})
// the bread loaf: settle from sit (front legs slide back under the chest), then loaf idle (breath + a slow blink)
const loafdown = Array.from({ length: 6 }, (_, i) => uri(render(generateRigGrid(ash, lerpPose(POSES.sit, POSES.loaf, ease(i / 5))), ash.coat)))
const loaf = Array.from({ length: 8 }, (_, i) => {
  const br = Math.sin((i / 8) * Math.PI * 2)
  const p = lerpPose(POSES.loaf, POSES.loaf, 0)
  p.body = [p.body[0], p.body[1] - br * 0.2, p.body[2], p.body[3] + br * 0.35]
  if (i === 5) p.eye = 0 // a slow content blink
  return uri(render(generateRigGrid(ash, p), ash.coat))
})
const data = JSON.stringify({ w: W, h: H, walk, sitdown, turn, front, yawn, lie, sleep, stretch, teeterIn, wobble, loafdown, loaf })

const html = `<title>Ash · walk → sit → face you</title>
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
  .now{font-family:var(--mono);font-size:11px;color:var(--accent);text-transform:uppercase;letter-spacing:.14em;margin-top:8px}
  .stage{background:var(--stage);display:flex;justify-content:center;position:relative;padding:20px 0 6px}
  canvas{image-rendering:pixelated;display:block}
  .floor{position:absolute;left:26%;right:26%;bottom:24px;height:11px;border-radius:50%;background:radial-gradient(50% 100% at 50% 0,rgba(0,0,0,.42),transparent)}
  .controls{display:flex;gap:12px;align-items:center;padding:14px 24px 18px;border-top:1px solid var(--hair)}
  button{font-family:var(--sans);font-size:13px;color:var(--ink);background:transparent;border:1px solid var(--hair);border-radius:9px;padding:8px 15px;cursor:pointer}
  button:hover{border-color:var(--accent);color:var(--accent)} .spacer{flex:1} .hint{font-family:var(--mono);font-size:11px;color:var(--dim)}
  input[type=range]{accent-color:var(--accent)}
</style>
<div class="card">
  <header><h1>Meet <b>Ash</b> — a full day in the life</h1>
  <div class="sub">walk → sit → turn to you → rest → <b>yawn</b> → turn away → lie down → sleep → wake → <b>stretch</b> → walk. All articulated / keyframed, our cat's art throughout.</div>
  <div class="now" id="now">walking</div></header>
  <div class="stage"><div class="floor"></div><canvas id="c"></canvas></div>
  <div class="controls"><button id="play">Pause</button><span class="spacer"></span><span class="hint">turn speed <span id="v">80</span>ms/frame</span><input type="range" id="s" min="50" max="220" step="10" value="80"></div>
</div>
<script>
const D=${data}, S=7; const cv=document.getElementById('c'); cv.width=D.w*S; cv.height=(D.h+2)*S;
const ctx=cv.getContext('2d'); ctx.imageSmoothingEnabled=false;
const mk=a=>a.map(u=>{const i=new Image();i.src=(typeof u==='string')?u:u.u;return i});
const WALK=mk(D.walk), SIT=mk(D.sitdown), TURN=mk(D.turn), FRONT=mk(D.front);
const YAWN=mk(D.yawn), LIE=mk(D.lie), SLEEP=mk(D.sleep), STRETCH=mk(D.stretch);
const TEETIN=mk(D.teeterIn), WOBBLE=mk(D.wobble), LOAFDOWN=mk(D.loafdown), LOAF=mk(D.loaf);
const TOFF=D.turn.map(t=>({ox:t.ox,oy:t.oy}));
function draw(img, ox=0, oy=0){ if(!img||!img.complete) return; ctx.clearRect(0,0,cv.width,cv.height);
  ctx.drawImage(img,0,0,D.w,D.h, ox*S, (2+oy)*S, D.w*S, D.h*S); }
let turnMs=80, playing=true;
const nowEl=document.getElementById('now');
// timeline: phases with per-frame timing
function phases(){ return [
  { n:'walking',        frames: WALK.map((f,i)=>({img:f})), ms:110, loop: 3 },
  { n:'ooh, an edge…',  frames: TEETIN.map(f=>({img:f})), ms:100 },
  { n:'teetering!',     frames: WOBBLE.map(f=>({img:f})), ms:90, loop: 2 },
  { n:'nope — backing up', frames: [...TEETIN].reverse().map(f=>({img:f})), ms:100 },
  { n:'sitting down',   frames: SIT.map(f=>({img:f})), ms:95 },
  { n:'bread mode',     frames: LOAFDOWN.map(f=>({img:f})), ms:105 },
  { n:'loafing',        frames: LOAF.map(f=>({img:f})), ms:260, loop: 2 },
  { n:'un-loafing',     frames: [...LOAFDOWN].reverse().map(f=>({img:f})), ms:105 },
  { n:'turning to you', frames: TURN.map((f,i)=>({img:f,ox:TOFF[i].ox,oy:TOFF[i].oy})), ms:turnMs },
  { n:'resting',        frames: FRONT.map(f=>({img:f})), ms:280, loop: 2 },
  { n:'yawning',        frames: YAWN.map(f=>({img:f})), ms:130 },
  { n:'turning away',   frames: [...TURN].reverse().map((f)=>{const i=TURN.indexOf(f);return {img:f,ox:TOFF[i].ox,oy:TOFF[i].oy}}), ms:turnMs },
  { n:'lying down',     frames: LIE.map(f=>({img:f})), ms:105 },
  { n:'sleeping',       frames: SLEEP.map(f=>({img:f})), ms:300, loop: 3 },
  { n:'waking up',      frames: [...LIE].reverse().map(f=>({img:f})), ms:105 },
  { n:'standing up',    frames: [...SIT].reverse().map(f=>({img:f})), ms:95 },
  { n:'stretching',     frames: [...STRETCH.map(f=>({img:f})), {img:STRETCH[5]}, {img:STRETCH[5]}, {img:STRETCH[5]}, ...[...STRETCH].reverse().map(f=>({img:f}))], ms:110 }
]}
let ph=0, fi=0, li=0, acc=0, last=0
function loop(now){ requestAnimationFrame(loop); if(!last)last=now; const dt=now-last; last=now; if(!playing)return;
  const P=phases()[ph]; acc+=dt;
  if(acc>=P.ms){ acc=0; fi++;
    if(fi>=P.frames.length){ fi=0;
      if(P.loop && ++li<P.loop){} else { li=0; ph=(ph+1)%phases().length; nowEl.textContent=phases()[ph].n; } } }
  const F=phases()[ph].frames[fi]; draw(F.img,F.ox||0,F.oy||0);
}
requestAnimationFrame(loop);
const pb=document.getElementById('play'); pb.onclick=()=>{playing=!playing; pb.textContent=playing?'Pause':'Play';};
const sl=document.getElementById('s'), vv=document.getElementById('v'); sl.oninput=()=>{turnMs=+sl.value; vv.textContent=sl.value;};
</script>`
writeFileSync(out, html); console.log('wrote ' + out)
