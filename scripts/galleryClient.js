/* Gallery client. Depends on the inlined generator (generateGrid, render, W, H)
   and PRESETS. Builds cards, precomputes animation frames, and runs one shared
   animation loop (breathing + blink + tail-sway + ground shadow). */
(function () {
  const dpr = Math.max(1, Math.min(3, window.devicePixelRatio || 1))
  const reduce = window.matchMedia('(prefers-color-scheme: reduce)').matches ||
    window.matchMedia('(prefers-reduced-motion: reduce)').matches
  const TAIL_FRAMES = 16

  function isDark() {
    const attr = document.documentElement.getAttribute('data-theme')
    if (attr) return attr === 'dark'
    return window.matchMedia('(prefers-color-scheme: dark)').matches
  }

  function makeFrame(preset, state) {
    const parts = generateGrid(preset, state)
    const rgba = render(parts, preset.coat || { primary: '#f2f2f4' })
    const c = document.createElement('canvas')
    c.width = W
    c.height = H
    const cx = c.getContext('2d')
    const img = cx.createImageData(W, H)
    img.data.set(rgba)
    cx.putImageData(img, 0, 0)
    return c
  }

  // ---- personality / body-type labels -------------------------------------
  const TRAIT_HI = {
    energy: 'Energetic', sleepiness: 'Sleepy', affection: 'Affectionate',
    mischief: 'Mischievous', curiosity: 'Curious', independence: 'Independent'
  }
  const COAT_LABEL = {
    solid: 'Solid', tabby: 'Tabby', tuxedo: 'Tuxedo', calico: 'Calico',
    points: 'Siamese', bicolor: 'Bicolor'
  }
  function bodyTag(geom) {
    const g = geom || {}
    if (g.cheekFluff) return 'Fluffy'
    if (g.headRx >= 12) return 'Kitten'
    if (g.bodyRx >= 14) return 'Chonky'
    if (g.bodyRx && g.bodyRx <= 10.6) return 'Slim'
    return 'Classic'
  }
  function topTraits(p, n) {
    if (!p) return []
    return Object.keys(p)
      .map((k) => [k, p[k]])
      .filter((e) => e[1] >= 0.6)
      .sort((a, b) => b[1] - a[1])
      .slice(0, n)
      .map((e) => TRAIT_HI[e[0]])
  }

  // ---- backdrops ----------------------------------------------------------
  let bgMode = 'studio'
  function drawBackdrop(cx, w, h) {
    const dark = isDark()
    if (bgMode === 'studio') {
      const gr = cx.createLinearGradient(0, 0, 0, h)
      if (dark) { gr.addColorStop(0, '#262b31'); gr.addColorStop(1, '#191d22') }
      else { gr.addColorStop(0, '#ffffff'); gr.addColorStop(1, '#eef0ea') }
      cx.fillStyle = gr
    } else if (bgMode === 'light') {
      cx.fillStyle = '#eef0ea'
    } else if (bgMode === 'dark') {
      cx.fillStyle = '#141519'
    } else { // desktop
      const gr = cx.createLinearGradient(0, 0, w, h)
      gr.addColorStop(0, '#33507a'); gr.addColorStop(1, '#20304d')
      cx.fillStyle = gr
    }
    cx.fillRect(0, 0, w, h)
  }
  function shadowAlpha() {
    if (bgMode === 'desktop') return 0.28
    if (bgMode === 'dark' || (bgMode === 'studio' && isDark())) return 0.34
    return 0.2
  }

  // ---- build cards --------------------------------------------------------
  const grid = document.getElementById('grid')
  const CATS = PRESETS.map((preset, i) => {
    const open = []
    for (let k = 0; k < TAIL_FRAMES; k++) {
      const tp = Math.sin((k / TAIL_FRAMES) * Math.PI * 2)
      const ep = k === 4 ? 0.7 : k === 12 ? 0.4 : 0
      open.push(makeFrame(preset, { eyeOpen: true, tailPhase: tp, earPhase: ep }))
    }
    const blink = makeFrame(preset, { eyeOpen: false, tailPhase: 0 })

    const card = document.createElement('button')
    card.className = 'card'
    card.type = 'button'
    card.setAttribute('aria-pressed', 'false')
    card.setAttribute('aria-label', preset.name + ' — ' + preset.blurb)

    const stage = document.createElement('canvas')
    stage.className = 'stage'
    card.appendChild(stage)

    const heart = document.createElement('div')
    heart.className = 'heart'
    heart.textContent = '♡'
    card.appendChild(heart)

    const meta = document.createElement('div')
    meta.className = 'meta'
    const traitTags = topTraits(preset.personality, 2)
      .map((t) => '<span class="tag trait">' + t + '</span>').join('')
    meta.innerHTML =
      '<div class="name">' + preset.name + '</div>' +
      '<div class="blurb">' + preset.blurb + '</div>' +
      '<div class="tags">' +
        '<span class="tag">' + (COAT_LABEL[preset.marking || 'solid']) + '</span>' +
        '<span class="tag">' + bodyTag(preset.geom) + '</span>' +
        traitTags +
      '</div>'
    card.appendChild(meta)

    card.addEventListener('click', () => toggle(cat, card, heart))
    grid.appendChild(card)

    const cat = {
      preset, open, blink, stage, sctx: stage.getContext('2d'),
      cssW: 0, cssH: 176, scale: 3.4,
      phase: i * 3, breath: i * 1.3,
      nextBlink: 700 + i * 260, blinkEvery: 2500 + (i % 6) * 720, blinkUntil: 0,
      selected: false, card, heart
    }
    return cat
  })

  // ---- selection ----------------------------------------------------------
  const pickCount = document.getElementById('pick-count')
  function updatePickbar() {
    const picks = CATS.filter((c) => c.selected).map((c) => c.preset.name)
    if (!picks.length) { pickCount.innerHTML = 'No favorites yet' }
    else { pickCount.innerHTML = '<b>' + picks.length + '</b> picked: ' + picks.join(', ') }
    window.__picks = picks
  }
  function toggle(cat, card, heart) {
    cat.selected = !cat.selected
    card.setAttribute('aria-pressed', cat.selected ? 'true' : 'false')
    heart.textContent = cat.selected ? '♥' : '♡'
    updatePickbar()
  }
  document.getElementById('copy-btn').addEventListener('click', async () => {
    const picks = CATS.filter((c) => c.selected).map((c) => c.preset.name)
    const text = picks.length ? picks.join(', ') : 'no favorites selected'
    try { await navigator.clipboard.writeText(text) } catch (e) { /* ignore */ }
    const btn = document.getElementById('copy-btn')
    const old = btn.textContent
    btn.textContent = picks.length ? 'Copied!' : 'Nothing to copy'
    setTimeout(() => { btn.textContent = old }, 1400)
  })

  // ---- background toggle --------------------------------------------------
  document.querySelectorAll('.seg [data-bg]').forEach((b) => {
    b.addEventListener('click', () => {
      bgMode = b.getAttribute('data-bg')
      document.querySelectorAll('.seg [data-bg]').forEach((x) =>
        x.setAttribute('aria-pressed', x === b ? 'true' : 'false'))
      if (reduce) drawAll(performance.now())
    })
  })

  // ---- sizing -------------------------------------------------------------
  function fit() {
    for (const cat of CATS) {
      const w = cat.stage.clientWidth || 200
      cat.cssW = w
      cat.stage.width = Math.round(w * dpr)
      cat.stage.height = Math.round(cat.cssH * dpr)
      cat.sctx.setTransform(dpr, 0, 0, dpr, 0, 0)
      cat.sctx.imageSmoothingEnabled = false
    }
    if (reduce) drawAll(performance.now())
  }
  window.addEventListener('resize', () => { clearTimeout(fit._t); fit._t = setTimeout(fit, 120) })

  // ---- draw ---------------------------------------------------------------
  function drawCat(cat, now) {
    const cx = cat.sctx
    const w = cat.cssW, h = cat.cssH
    drawBackdrop(cx, w, h)

    let sy = 1, bob = 0
    if (!reduce) {
      sy = 1 + 0.028 * Math.sin(now / 1250 + cat.breath)
      bob = Math.sin(now / 950 + cat.breath * 1.1) * 1.1
    }
    const catW = W * cat.scale
    const catH = H * cat.scale
    const cxp = w / 2
    const feetY = h - 15

    // ground shadow
    cx.save()
    cx.globalAlpha = shadowAlpha() * (2 - sy)
    cx.fillStyle = '#000'
    cx.beginPath()
    cx.ellipse(cxp, feetY + 2, catW * 0.3, 5, 0, 0, Math.PI * 2)
    cx.fill()
    cx.restore()

    // frame selection
    let frame = cat.open[0]
    if (!reduce) {
      if (now > cat.nextBlink) { cat.blinkUntil = now + 130; cat.nextBlink = now + cat.blinkEvery }
      const blinking = now < cat.blinkUntil
      const idx = ((Math.floor(now / 235 + cat.phase) % TAIL_FRAMES) + TAIL_FRAMES) % TAIL_FRAMES
      frame = blinking ? cat.blink : cat.open[idx]
    }

    const drawH = catH * sy
    cx.imageSmoothingEnabled = false
    cx.drawImage(frame, cxp - catW / 2, feetY - drawH + bob, catW, drawH)
  }

  function drawAll(now) { for (const cat of CATS) drawCat(cat, now) }

  function loop(now) { drawAll(now); requestAnimationFrame(loop) }

  // ---- header mascot ------------------------------------------------------
  const mark = document.getElementById('mark-cat')
  if (mark) {
    const mctx = mark.getContext('2d')
    mark.width = 30 * dpr; mark.height = 30 * dpr
    mctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    mctx.imageSmoothingEnabled = false
    const f = makeFrame(PRESETS[0], { eyeOpen: true, tailPhase: 0.3 })
    mctx.drawImage(f, 1, -1, 30, 30)
  }

  // ---- go -----------------------------------------------------------------
  updatePickbar()
  requestAnimationFrame(() => {
    fit()
    if (!reduce) requestAnimationFrame(loop)
    else drawAll(performance.now())
  })
})()
