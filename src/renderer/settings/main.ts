import { generateGrid, generateWalkGrid, render as renderPet, setFrontScale, type AnimState } from '../../shared/catgen'
import { generateRigGrid, lerpPose, POSES as RIG } from '../../shared/rigcat'
import { generate34Grid } from '../../shared/turn34'
import { PETS, type AppPet } from '../../shared/pets'
import { MIN_SCALE, MAX_SCALE, SPRITE_W, SPRITE_H } from '../../shared/constants'
import { TRAIT_KEYS, TOGGLEABLE_ANIMS, type AppSettings, type AiConfig, type AiStatus, type AiProviderId, type ClipName, type Personality } from '../../shared/types'

type GenResult = { ok: true; pet: AppPet } | { ok: false; error: string }

// ---- Bridge typing (exposed by preload/settings.ts) ------------------------
interface SettingsApi {
  get: () => Promise<AppSettings>
  setPet: (petId: string) => void
  setScale: (scale: number) => void
  setTurnMs: (ms: number) => void
  setStayPut: (v: boolean) => void
  setFrontScale: (k: number) => void
  setDisabledAnims: (disabled: ClipName[]) => void
  setTrait: (petId: string, key: keyof Personality, value: number) => void
  resetTraits: (petId: string) => void
  aiStatus: () => Promise<AiStatus>
  setAiConfig: (cfg: Partial<AiConfig>) => void
  setAiKey: (key: string) => Promise<AiStatus>
  clearAiKey: () => Promise<AiStatus>
  testAi: () => Promise<{ ok: boolean; message: string }>
  generateFromPhotos: (dataUrls: string[]) => Promise<GenResult>
  deleteUserPet: (petId: string) => void
}
declare global {
  interface Window { settings: SettingsApi }
}

const SIZE_LABELS: Record<number, string> = { 2: 'XS', 3: 'S', 4: 'M', 5: 'L', 6: 'XL', 7: 'XXL' }

const $ = <T extends HTMLElement>(id: string): T => document.getElementById(id) as T
const grid = $('grid'), sizes = $('sizes'), rows = $('rows'), who = $('who'), resetBtn = $<HTMLButtonElement>('reset')
const posesEl = $('poses'), poseWho = $('poseWho'), petid = $('petid'), mod = $('mod')

let state: AppSettings

/** The full roster shown in the picker: built-in presets plus user-generated pets. */
const roster = (): AppPet[] => [...PETS, ...(state.userPets ?? [])]
const findPet = (id: string): AppPet => roster().find((p) => p.id === id) ?? PETS[0]
const isUserPet = (id: string): boolean => (state.userPets ?? []).some((p) => p.id === id)

/** True if the active pet has any user-customized traits. */
function isCustomized(petId: string): boolean {
  const ov = state.overrides[petId]
  return !!ov && Object.keys(ov).length > 0
}

/** Reflect the active pet's identity + whether its traits are customized. */
function refreshMeta(): void {
  const pet = findPet(state.activePetId)
  petid.replaceChildren(Object.assign(document.createElement('b'), { textContent: pet.name }),
    document.createTextNode(` — ${pet.blurb}`))
  poseWho.textContent = pet.name
  const custom = isCustomized(pet.id)
  mod.textContent = custom ? '· customized' : ''
  resetBtn.disabled = !custom
}

// ---- Pose previews: the active pet animated in each clip --------------------
// A blit target per pose; a single rAF loop redraws them (throttled) from the
// generator, so you can see how a pet looks idling, walking, sleeping, reacting.
function idleState(t: number): AnimState {
  const blink = t % 3200 < 140
  return { eyeOpen: !blink, tailPhase: Math.sin(t / 1600), look: 0, earPhase: 0 }
}
function reactState(t: number): AnimState {
  const p = t % 2000
  if (p < 140) return { eyeOpen: false, tailPhase: 0.2, look: 0, earPhase: 1 }
  if (p < 950) return { eyeOpen: true, tailPhase: 0.3, look: 1, earPhase: 0 }
  return { eyeOpen: true, tailPhase: Math.sin(t / 1400), look: 0, earPhase: 0 }
}
const easeIn = (k: number): number => (k < 0.5 ? 2 * k * k : 1 - Math.pow(-2 * k + 2, 2) / 2)
const clamp01 = (v: number): number => Math.max(0, Math.min(1, v))

function sleepPose(t: number): ReturnType<typeof lerpPose> {
  const br = Math.sin(t / 900)
  const p = lerpPose(RIG.curl, RIG.curl, 0)
  p.body = [p.body[0], p.body[1] - br * 0.25, p.body[2], p.body[3] + br * 0.5]
  return p
}
function loafPose(t: number): ReturnType<typeof lerpPose> {
  // Breathes, and slowly settles into the dozy low loaf and back.
  const relax = 0.5 + 0.5 * Math.sin(t / 2600 - Math.PI / 2)
  const p = lerpPose(RIG.loaf, RIG.loafLow, relax)
  const br = Math.sin(t / 1100)
  p.body = [p.body[0], p.body[1] - br * 0.2, p.body[2], p.body[3] + br * 0.35]
  p.eye = relax > 0.7 ? 0 : (t % 4200 > 160 ? 1 : 0)
  return p
}
function sitPose(t: number): ReturnType<typeof lerpPose> {
  const p = lerpPose(RIG.sit, RIG.sit, 0)
  p.eye = t % 4200 > 160 ? 1 : 0
  return p
}
function sphinxPose(t: number): ReturnType<typeof lerpPose> {
  const br = Math.sin(t / 1000)
  const p = lerpPose(RIG.sphinx, RIG.sphinx, 0)
  p.body = [p.body[0], p.body[1] - br * 0.2, p.body[2], p.body[3] + br * 0.35]
  p.eye = t % 4200 > 160 ? 1 : 0
  return p
}
function stretchPose(t: number): ReturnType<typeof lerpPose> {
  const ph = t % 3000
  if (ph < 700) return lerpPose(RIG.stand, RIG.stretch, easeIn(ph / 700))
  if (ph < 1800) return lerpPose(RIG.stretch, RIG.stretch, 0)
  if (ph < 2500) return lerpPose(RIG.stretch, RIG.stand, easeIn((ph - 1800) / 700))
  return lerpPose(RIG.stand, RIG.stand, 0)
}
function pouncePose(t: number): ReturnType<typeof lerpPose> {
  const ph = t % 2400
  if (ph < 1300) return lerpPose(RIG.crouch, RIG.crouchWiggle, 0.5 + 0.5 * Math.sin(ph / 150)) // butt wiggle…
  if (ph < 1500) return lerpPose(RIG.crouch, RIG.pounce, easeIn((ph - 1300) / 200))
  if (ph < 2100) return lerpPose(RIG.pounce, RIG.pounce, 0) // airborne!
  return lerpPose(RIG.pounce, RIG.crouch, easeIn((ph - 2100) / 300))
}
function poofPose(t: number): ReturnType<typeof lerpPose> {
  const ph = t % 2800
  if (ph < 350) return lerpPose(RIG.stand, RIG.poof, easeIn(ph / 350)) // !!!
  if (ph < 2000) return lerpPose(RIG.poof, RIG.poof, 0)
  if (ph < 2600) return lerpPose(RIG.poof, RIG.stand, easeIn((ph - 2000) / 600))
  return lerpPose(RIG.stand, RIG.stand, 0)
}
const yawnK = (t: number): number => clamp01(Math.sin(((t % 3400) / 3400) * Math.PI * 2) * 1.4)
function pawState(t: number): { paw: number; pawX: number } {
  const ph = t % 2600
  if (ph < 400) return { paw: easeIn(ph / 400), pawX: 0 }
  if (ph < 1800) return { paw: 1, pawX: Math.max(0, Math.sin((ph - 400) / 145)) } // down-pats with recoveries
  if (ph < 2200) return { paw: 1 - easeIn((ph - 1800) / 400), pawX: 0 }
  return { paw: 0, pawX: 0 }
}

const POSES: Array<{ key: string; label: string; rgba: (pet: AppPet, t: number) => Uint8ClampedArray }> = [
  { key: 'idle', label: 'Idle', rgba: (pet, t) => renderPet(generateGrid(pet, idleState(t)), pet.coat) },
  { key: 'walk', label: 'Walk', rgba: (pet, t) => renderPet(generateWalkGrid(pet, (t / 900) % 1), pet.coat) },
  { key: 'sit', label: 'Sit', rgba: (pet, t) => renderPet(generateRigGrid(pet, sitPose(t)), pet.coat) },
  { key: 'loaf', label: 'Loaf', rgba: (pet, t) => renderPet(generateRigGrid(pet, loafPose(t)), pet.coat) },
  { key: 'sphinx', label: 'Sphinx', rgba: (pet, t) => renderPet(generateRigGrid(pet, sphinxPose(t)), pet.coat) },
  { key: 'sleep', label: 'Sleep', rgba: (pet, t) => renderPet(generateRigGrid(pet, sleepPose(t)), pet.coat) },
  { key: 'groom', label: 'Groom', rgba: (pet, t) => renderPet(generateRigGrid(pet, lerpPose(RIG.groom, RIG.groomLick, 0.5 + 0.5 * Math.sin(t / 140))), pet.coat) },
  { key: 'stretch', label: 'Stretch', rgba: (pet, t) => renderPet(generateRigGrid(pet, stretchPose(t)), pet.coat) },
  { key: 'pounce', label: 'Pounce', rgba: (pet, t) => renderPet(generateRigGrid(pet, pouncePose(t)), pet.coat) },
  { key: 'teeter', label: 'Teeter', rgba: (pet, t) => renderPet(generateRigGrid(pet, lerpPose(RIG.teeter, RIG.teeterFwd, 0.5 + 0.5 * Math.sin(t / 260))), pet.coat) },
  { key: 'poof', label: 'Poof!', rgba: (pet, t) => renderPet(generateRigGrid(pet, poofPose(t)), pet.coat) },
  { key: 'yawn', label: 'Yawn', rgba: (pet, t) => renderPet(generate34Grid(pet, 0, { yawn: yawnK(t) }), pet.coat) },
  { key: 'paw', label: 'Paw', rgba: (pet, t) => renderPet(generate34Grid(pet, 0, pawState(t)), pet.coat) },
  { key: 'react', label: 'React', rgba: (pet, t) => renderPet(generateGrid(pet, reactState(t)), pet.coat) }
]
const poseCanvases: CanvasRenderingContext2D[] = []

function buildPoses(): void {
  posesEl.innerHTML = ''
  poseCanvases.length = 0
  const disabled = new Set<string>(state.disabledAnims ?? [])
  for (const pose of POSES) {
    const tile = document.createElement('div')
    const togglable = (TOGGLEABLE_ANIMS as string[]).includes(pose.key)
    tile.className = 'pose' + (togglable ? ' togglable' : '') + (disabled.has(pose.key) ? ' off' : '')
    const c = document.createElement('canvas')
    c.width = SPRITE_W
    c.height = SPRITE_H
    const label = document.createElement('div')
    label.className = 'pl'
    label.textContent = pose.label
    tile.append(c, label)
    if (togglable) {
      tile.tabIndex = 0
      tile.setAttribute('role', 'switch')
      tile.title = `Click to turn the ${pose.label.toLowerCase()} animation on/off`
      const flip = (): void => {
        const nowOff = !tile.classList.contains('off')
        tile.classList.toggle('off', nowOff)
        tile.setAttribute('aria-checked', String(!nowOff))
        if (nowOff) disabled.add(pose.key)
        else disabled.delete(pose.key)
        state.disabledAnims = [...disabled] as AppSettings['disabledAnims']
        window.settings.setDisabledAnims(state.disabledAnims)
      }
      tile.setAttribute('aria-checked', String(!disabled.has(pose.key)))
      tile.addEventListener('click', flip)
      tile.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); flip() }
      })
    }
    posesEl.append(tile)
    poseCanvases.push(c.getContext('2d')!)
  }
}

let poseLast = 0
function animatePoses(t: number): void {
  requestAnimationFrame(animatePoses)
  if (t - poseLast < 66) return // ~15fps is plenty for these gentle loops
  poseLast = t
  if (!state) return
  const pet = findPet(state.activePetId)
  POSES.forEach((pose, i) => {
    const cx = poseCanvases[i]
    if (!cx) return
    const img = cx.createImageData(SPRITE_W, SPRITE_H)
    img.data.set(pose.rgba(pet, t))
    cx.clearRect(0, 0, SPRITE_W, SPRITE_H)
    cx.putImageData(img, 0, 0)
  })
}

/** A pet's effective traits: preset defaults merged with the user's overrides. */
function effective(petId: string): Personality {
  const pet = findPet(petId)
  return { ...pet.personality, ...(state.overrides[petId] ?? {}) }
}

/** Render a pet's idle frame into a small canvas thumbnail. */
function thumbnail(petId: string): HTMLCanvasElement {
  const pet = findPet(petId)
  const rgba = renderPet(generateGrid(pet, { eyeOpen: true, tailPhase: 0.3 }), pet.coat)
  const c = document.createElement('canvas')
  c.width = SPRITE_W
  c.height = SPRITE_H
  const cx = c.getContext('2d')!
  const img = cx.createImageData(SPRITE_W, SPRITE_H)
  img.data.set(rgba)
  cx.putImageData(img, 0, 0)
  return c
}

function buildGrid(): void {
  grid.innerHTML = ''
  for (const pet of roster()) {
    const card = document.createElement('div')
    card.className = 'card' + (pet.id === state.activePetId ? ' active' : '')
    card.dataset.id = pet.id
    card.title = pet.blurb
    card.tabIndex = 0 // keyboard focusable
    card.setAttribute('role', 'button')
    card.setAttribute('aria-label', `${pet.name} — ${pet.blurb}`)
    card.append(thumbnail(pet.id))
    const nm = document.createElement('div')
    nm.className = 'nm'
    nm.textContent = pet.name
    card.append(nm)
    card.addEventListener('click', () => selectPet(pet.id))
    card.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); selectPet(pet.id) }
    })
    if (isUserPet(pet.id)) {
      const del = document.createElement('button')
      del.className = 'del'
      del.textContent = '×' // ×
      del.title = `Delete ${pet.name}`
      del.addEventListener('click', (e) => {
        e.stopPropagation()
        window.settings.deleteUserPet(pet.id)
        state.userPets = (state.userPets ?? []).filter((p) => p.id !== pet.id)
        if (state.activePetId === pet.id) state.activePetId = 'ash'
        buildGrid()
        buildTraits()
        refreshMeta()
      })
      card.append(del)
    }
    grid.append(card)
  }
}

function buildSizes(): void {
  sizes.innerHTML = ''
  for (let s = MIN_SCALE; s <= MAX_SCALE; s++) {
    const b = document.createElement('button')
    b.textContent = SIZE_LABELS[s] ?? String(s)
    b.className = s === state.scale ? 'on' : ''
    b.addEventListener('click', () => {
      state.scale = s
      window.settings.setScale(s)
      for (const child of sizes.children) child.classList.toggle('on', child === b)
    })
    sizes.append(b)
  }
}

function buildTraits(): void {
  const pet = findPet(state.activePetId)
  who.textContent = pet.name
  const eff = effective(pet.id)
  rows.innerHTML = ''
  for (const key of TRAIT_KEYS) {
    const row = document.createElement('div')
    row.className = 'trow'
    const name = document.createElement('div')
    name.className = 'tn'
    name.textContent = key
    const slider = document.createElement('input')
    slider.type = 'range'
    slider.min = '0'; slider.max = '100'; slider.step = '1'
    slider.value = String(Math.round(eff[key] * 100))
    const val = document.createElement('div')
    val.className = 'tv'
    val.textContent = slider.value
    slider.addEventListener('input', () => {
      val.textContent = slider.value
      const v = Number(slider.value) / 100
      ;(state.overrides[pet.id] ??= {})[key] = v
      window.settings.setTrait(pet.id, key, v)
      refreshMeta()
    })
    row.append(name, slider, val)
    rows.append(row)
  }
}

function selectPet(petId: string): void {
  if (petId === state.activePetId) return
  state.activePetId = petId
  window.settings.setPet(petId)
  for (const card of grid.children) card.classList.toggle('active', (card as HTMLElement).dataset.id === petId)
  buildTraits()
  refreshMeta()
}

resetBtn.addEventListener('click', () => {
  if (resetBtn.disabled) return
  delete state.overrides[state.activePetId]
  window.settings.resetTraits(state.activePetId)
  buildTraits()
  refreshMeta()
})

function buildAnimation(): void {
  const slider = $<HTMLInputElement>('turnms'), label = $('turnmsv')
  const show = (): void => { label.textContent = `${slider.value}ms` }
  slider.value = String(state.turnMs ?? 80)
  show()
  slider.addEventListener('input', () => {
    show()
    window.settings.setTurnMs(Number(slider.value))
  })

  const fs = $<HTMLInputElement>('frontscale'), fsLabel = $('frontscalev')
  const showFs = (): void => { fsLabel.textContent = `${fs.value}%` }
  fs.value = String(Math.round((state.frontScale ?? 0.8) * 100))
  showFs()
  setFrontScale(Number(fs.value) / 100) // previews match the pet
  fs.addEventListener('input', () => {
    showFs()
    const k = Number(fs.value) / 100
    setFrontScale(k)
    window.settings.setFrontScale(k)
  })

  const stay = $<HTMLButtonElement>('stayput')
  const paint = (on: boolean): void => {
    stay.classList.toggle('on', on)
    stay.setAttribute('aria-pressed', String(on))
    stay.textContent = on ? 'On — holding this spot' : 'Off — free to roam'
  }
  paint(state.stayPut ?? false)
  stay.addEventListener('click', () => {
    state.stayPut = !state.stayPut
    paint(state.stayPut)
    window.settings.setStayPut(state.stayPut)
  })
}

const DEFAULT_MODELS: Record<AiProviderId, string> = { openai: 'gpt-4o', anthropic: 'claude-sonnet-5' }

function buildAi(): void {
  const provider = $<HTMLSelectElement>('aiprovider')
  const model = $<HTMLInputElement>('aimodel')
  const endpoint = $<HTMLInputElement>('aiendpoint')
  const key = $<HTMLInputElement>('aikey')
  const saveKey = $<HTMLButtonElement>('aisavekey')
  const test = $<HTMLButtonElement>('aitest')
  const keystate = $('aikeystate')
  const drop = $('aidrop'), thumbs = $('aithumbs'), droptext = $('aidroptext')
  const file = $<HTMLInputElement>('aifile'), gen = $<HTMLButtonElement>('aigen'), status = $('aistatus')

  const MAX_PHOTOS = 4
  let chosen: string[] = [] // downscaled photo data URLs
  const setStatus = (msg: string, cls = ''): void => { status.textContent = msg; status.className = 'status' + (cls ? ' ' + cls : '') }
  const paintKeyState = (st: AiStatus): void => {
    keystate.textContent = st.hasKey
      ? '✓ key saved' + (st.encryptionAvailable ? ' (encrypted on this PC)' : ' (stored plaintext — OS encryption unavailable)')
      : 'No key saved yet.'
    keystate.className = 'keystate' + (st.hasKey ? ' saved' : '')
  }
  const pushConfig = (): void => window.settings.setAiConfig({
    provider: provider.value as AiProviderId, model: model.value, endpoint: endpoint.value
  })
  // If a key was typed but not explicitly saved, persist it before a call.
  const flushKey = async (): Promise<void> => {
    if (!key.value.trim()) return
    const st = await window.settings.setAiKey(key.value.trim())
    key.value = ''
    paintKeyState(st)
  }

  window.settings.aiStatus().then((st) => {
    provider.value = st.provider
    model.value = st.model
    endpoint.value = /api\.(openai|anthropic)\.com/.test(st.endpoint) ? '' : st.endpoint
    paintKeyState(st)
  })

  provider.addEventListener('change', () => {
    const other = provider.value === 'openai' ? DEFAULT_MODELS.anthropic : DEFAULT_MODELS.openai
    if (!model.value.trim() || model.value.trim() === other) model.value = DEFAULT_MODELS[provider.value as AiProviderId]
    pushConfig()
  })
  model.addEventListener('change', pushConfig)
  endpoint.addEventListener('change', pushConfig)

  saveKey.addEventListener('click', async () => {
    if (!key.value.trim()) { setStatus('Enter a key first.', 'err'); return }
    pushConfig()
    await flushKey()
    setStatus('Key saved.', 'ok')
  })
  test.addEventListener('click', async () => {
    pushConfig()
    await flushKey()
    setStatus('Testing…', 'busy')
    const r = await window.settings.testAi()
    setStatus(r.message, r.ok ? 'ok' : 'err')
  })

  const readAsDataUrl = (f: File): Promise<string> => new Promise((res, rej) => {
    const r = new FileReader()
    r.onload = () => res(String(r.result))
    r.onerror = () => rej(r.error)
    r.readAsDataURL(f)
  })
  // Shrink big photos so several fit in one request (vision models don't need full res).
  const downscale = (dataUrl: string, max = 768): Promise<string> => new Promise((res) => {
    const img = new Image()
    img.onload = () => {
      const s = Math.min(1, max / Math.max(img.width, img.height))
      const w = Math.max(1, Math.round(img.width * s)), h = Math.max(1, Math.round(img.height * s))
      const c = document.createElement('canvas')
      c.width = w; c.height = h
      c.getContext('2d')?.drawImage(img, 0, 0, w, h)
      try { res(c.toDataURL('image/jpeg', 0.85)) } catch { res(dataUrl) }
    }
    img.onerror = () => res(dataUrl)
    img.src = dataUrl
  })

  drop.addEventListener('click', () => file.click())
  file.addEventListener('change', async () => {
    const files = [...(file.files ?? [])].slice(0, MAX_PHOTOS)
    if (!files.length) return
    setStatus('Reading photos…', 'busy')
    chosen = await Promise.all(files.map(async (f) => downscale(await readAsDataUrl(f))))
    thumbs.replaceChildren(...chosen.map((u) => Object.assign(new Image(), { src: u, alt: '' })))
    drop.classList.add('has')
    droptext.textContent = chosen.length === 1 ? '1 photo — Generate when ready' : `${chosen.length} photos — Generate when ready`
    gen.disabled = false
    setStatus('', '')
  })

  gen.addEventListener('click', async () => {
    if (!chosen.length) return
    pushConfig()
    await flushKey()
    gen.disabled = true
    setStatus(`Generating from ${chosen.length} photo${chosen.length > 1 ? 's' : ''}… this can take a few seconds.`, 'busy')
    const r = await window.settings.generateFromPhotos(chosen)
    gen.disabled = false
    if (!r.ok) { setStatus(r.error, 'err'); return }
    setStatus(`Created ${r.pet.name} — added to your pets and made active.`, 'ok')
    state = await window.settings.get() // main added the pet + made it active
    buildGrid()
    buildTraits()
    refreshMeta()
    grid.querySelector('.card.active')?.scrollIntoView({ block: 'nearest' })
  })
}

async function init(): Promise<void> {
  state = await window.settings.get()
  buildGrid()
  buildPoses()
  buildSizes()
  buildAnimation()
  buildAi()
  buildTraits()
  refreshMeta()
  // Make sure the current cat is visible even if it's far down the grid.
  grid.querySelector('.card.active')?.scrollIntoView({ block: 'nearest' })
  requestAnimationFrame(animatePoses)
}
init()
