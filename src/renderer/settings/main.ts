import { generateGrid, generateWalkGrid, render as renderPet, setFrontScale, type AnimState } from '../../shared/catgen'
import { generateRigGrid, lerpPose, POSES as RIG } from '../../shared/rigcat'
import { generate34Grid } from '../../shared/turn34'
import { PETS, type AppPet } from '../../shared/pets'
import { randomPetDNA, BUILD_NAMES, MARKING_NAMES, EYE_STYLES, type PetDNA } from '../../shared/petdna'
import { loadCreature, EAR_STYLES, TAIL_STYLES, GAITS, type CreatureDef } from '../../shared/creature'
import { ashPhoto } from '../ashPhoto'
import { MIN_SCALE, MAX_SCALE, SPRITE_W, SPRITE_H } from '../../shared/constants'
import { TRAIT_KEYS, TOGGLEABLE_ANIMS, type AppSettings, type AiConfig, type AiStatus, type AiProviderId, type ClipName, type Personality } from '../../shared/types'
import { NEED_KEYS, type CareStatus, type CareAction, type Difficulty, type Needs } from '../../shared/care'

type GenResult = { ok: true; pet: AppPet } | { ok: false; error: string }

// ---- Bridge typing (exposed by preload/settings.ts) ------------------------
interface SettingsApi {
  get: () => Promise<AppSettings>
  setPet: (petId: string) => void
  setScale: (scale: number) => void
  setTurnMs: (ms: number) => void
  setStayPut: (v: boolean) => void
  setFrontScale: (k: number) => void
  setPupilsByTime: (v: boolean) => void
  setDreamMode: (v: boolean) => void
  setDreamChance: (v: number) => void
  setDreamBubbleScale: (v: number) => void
  setCareMode: (v: boolean) => void
  setDifficulty: (d: Difficulty) => void
  careStatus: () => Promise<CareStatus | null>
  careAction: (action: CareAction) => void
  setDisabledAnims: (disabled: ClipName[]) => void
  setPetFilter: (f: 'all' | 'builtin' | 'user') => void
  playClip: (clip: ClipName) => void
  setTrait: (petId: string, key: keyof Personality, value: number) => void
  resetTraits: (petId: string) => void
  aiStatus: () => Promise<AiStatus>
  setAiConfig: (cfg: Partial<AiConfig>) => void
  setAiKey: (key: string) => Promise<AiStatus>
  clearAiKey: () => Promise<AiStatus>
  testAi: () => Promise<{ ok: boolean; message: string }>
  generateFromPhotos: (dataUrls: string[]) => Promise<GenResult>
  createPet: (def: CreatureDef) => Promise<GenResult>
  exportCreature: (def: CreatureDef) => Promise<{ ok: boolean; error?: string }>
  importCreature: () => Promise<GenResult>
  getVersion: () => Promise<string>
  deleteUserPet: (petId: string) => void
  renamePet: (petId: string, name: string) => void
  immichStatus: () => Promise<{ serverUrl: string; albumId: string; hasKey: boolean }>
  setImmichConfig: (cfg: { serverUrl?: string; albumId?: string }) => void
  setImmichKey: (key: string) => Promise<{ serverUrl: string; albumId: string; hasKey: boolean }>
  clearImmichKey: () => Promise<{ serverUrl: string; albumId: string; hasKey: boolean }>
  testImmich: () => Promise<{ ok: boolean; message: string }>
}
declare global {
  interface Window { settings: SettingsApi }
}

const SIZE_LABELS: Record<number, string> = { 1: 'XXS', 2: 'XS', 3: 'S', 4: 'M', 5: 'L', 6: 'XL', 7: 'XXL' }

const $ = <T extends HTMLElement>(id: string): T => document.getElementById(id) as T
const grid = $('grid'), sizes = $('sizes'), rows = $('rows'), who = $('who'), resetBtn = $<HTMLButtonElement>('reset')
const posesEl = $('poses'), poseWho = $('poseWho'), petid = $('petid'), mod = $('mod')

let state: AppSettings

/** The full roster shown in the picker: built-in presets + user pets, with renames applied. */
const roster = (): AppPet[] =>
  [...PETS, ...(state.userPets ?? [])].map((p) => (state.nameOverrides?.[p.id] ? { ...p, name: state.nameOverrides[p.id] } : p))
const findPet = (id: string): AppPet => roster().find((p) => p.id === id) ?? PETS[0]
const isUserPet = (id: string): boolean => (state.userPets ?? []).some((p) => p.id === id)

/** True if the active pet has any user-customized traits. */
function isCustomized(petId: string): boolean {
  const ov = state.overrides[petId]
  return !!ov && Object.keys(ov).length > 0
}

/** Reflect the active pet's identity + whether its traits are customized. */
function startRename(pet: AppPet): void {
  const input = document.createElement('input')
  input.type = 'text'
  input.value = pet.name
  input.maxLength = 24
  input.className = 'renameinput'
  petid.replaceChildren(input)
  input.focus()
  input.select()
  let done = false
  const commit = (save: boolean): void => {
    if (done) return
    done = true
    if (save) {
      const name = input.value.trim()
      state.nameOverrides = state.nameOverrides ?? {}
      if (name) state.nameOverrides[pet.id] = name
      else delete state.nameOverrides[pet.id]
      window.settings.renamePet(pet.id, name)
      buildGrid()
    }
    refreshMeta()
  }
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); commit(true) }
    else if (e.key === 'Escape') { e.preventDefault(); commit(false) }
  })
  input.addEventListener('blur', () => commit(true))
}

function refreshMeta(): void {
  const pet = findPet(state.activePetId)
  const name = Object.assign(document.createElement('b'), { textContent: pet.name })
  name.className = 'rename'
  name.title = 'Click to rename'
  name.addEventListener('click', () => startRename(pet))
  petid.replaceChildren(name, document.createTextNode(` — ${pet.blurb}`))
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

// The four sleep positions the live cat rotates through — the preview cycles
// them so you can see the variety (tight curl / loose curl / donut / loaf-sleep).
const SLEEP_VARIANTS = [RIG.curl, RIG.curlLoose, RIG.curlTight, RIG.loafLow]
function sleepPose(t: number): ReturnType<typeof lerpPose> {
  const base = SLEEP_VARIANTS[Math.floor(t / 3600) % SLEEP_VARIANTS.length]
  const br = Math.sin(t / 900)
  const p = lerpPose(base, base, 0)
  p.eye = 0
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
  { key: 'prance', label: 'Prance', rgba: (pet, t) => renderPet(generateWalkGrid(pet, (t / 620) % 1, 1, 1), pet.coat) },
  { key: 'trot', label: 'Trot', rgba: (pet, t) => renderPet(generateWalkGrid({ ...pet, geom: { ...pet.geom, gait: 'trot' } }, (t / 700) % 1), pet.coat) },
  { key: 'stalk', label: 'Stalk', rgba: (pet, t) => renderPet(generateWalkGrid({ ...pet, geom: { ...pet.geom, gait: 'stalk' } }, (t / 1100) % 1), pet.coat) },
  { key: 'hop', label: 'Hop', rgba: (pet, t) => renderPet(generateWalkGrid({ ...pet, geom: { ...pet.geom, gait: 'hop' } }, (t / 700) % 1), pet.coat) },
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
  { key: 'react', label: 'React', rgba: (pet, t) => renderPet(generateGrid(pet, reactState(t)), pet.coat) },
  { key: 'sulk', label: 'Sulk', rgba: (pet, t) => renderPet(generateRigGrid(pet, { ...RIG.sulk, eye: t % 4200 > 160 ? 1 : 0 }), pet.coat) },
  { key: 'sick', label: 'Sick', rgba: (pet, t) => renderPet(generateRigGrid(pet, { ...RIG.sick, eye: t % 5000 > 320 ? 1 : 0 }), pet.coat) }
]
const poseCanvases: CanvasRenderingContext2D[] = []

// Each tile PLAYS its animation on the live cat when clicked; toggleable ones
// carry a small corner dot to turn the animation on/off in the ambient loop.
function buildPoses(): void {
  posesEl.innerHTML = ''
  poseCanvases.length = 0
  const disabled = new Set<string>(state.disabledAnims ?? [])
  for (const pose of POSES) {
    const tile = document.createElement('div')
    const togglable = (TOGGLEABLE_ANIMS as string[]).includes(pose.key)
    tile.className = 'pose playable' + (disabled.has(pose.key) ? ' off' : '')
    const c = document.createElement('canvas')
    c.width = SPRITE_W
    c.height = SPRITE_H
    const label = document.createElement('div')
    label.className = 'pl'
    label.textContent = pose.label
    tile.append(c, label)
    tile.tabIndex = 0
    tile.setAttribute('role', 'button')
    tile.title = `Play the ${pose.label.toLowerCase()} animation on your cat`
    const play = (): void => window.settings.playClip(pose.key as ClipName)
    tile.addEventListener('click', play)
    tile.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); play() }
    })
    if (togglable) {
      const dot = document.createElement('button')
      dot.className = 'posetoggle'
      const paint = (): void => {
        const off = tile.classList.contains('off')
        dot.textContent = off ? '○' : '●'
        dot.title = off ? `${pose.label} is off — click to enable` : `Turn ${pose.label.toLowerCase()} off`
      }
      paint()
      dot.addEventListener('click', (e) => {
        e.stopPropagation()
        const nowOff = !tile.classList.contains('off')
        tile.classList.toggle('off', nowOff)
        if (nowOff) disabled.add(pose.key)
        else disabled.delete(pose.key)
        state.disabledAnims = [...disabled] as AppSettings['disabledAnims']
        window.settings.setDisabledAnims(state.disabledAnims)
        paint()
      })
      tile.append(dot)
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

// The app icon in the header — the same branded rounded twilight tile + Ash as
// the installer/app icon (scripts/genIcons.mjs), drawn live in a canvas.
function drawAppIcon(): void {
  const el = $<HTMLCanvasElement>('appicon')
  const S = 46
  el.width = S
  el.height = S
  const g = el.getContext('2d')!
  const r = S * 0.24
  const round = (): void => { g.beginPath(); g.roundRect(0, 0, S, S, r) }
  const grad = g.createLinearGradient(0, 0, S, S)
  grad.addColorStop(0, '#3f4270')
  grad.addColorStop(1, '#1c1d30')
  round(); g.fillStyle = grad; g.fill()
  g.save(); round(); g.clip()
  const rg = g.createRadialGradient(S * 0.4, S * 0.32, 0, S * 0.4, S * 0.32, S * 0.55)
  rg.addColorStop(0, 'rgba(255,255,255,0.16)')
  rg.addColorStop(1, 'rgba(255,255,255,0)')
  g.fillStyle = rg; g.fillRect(0, 0, S, S)
  const ash = PETS[0] // Ash — the brand cat, regardless of the active pet
  const rgba = renderPet(generateGrid(ash, { eyeOpen: true, tailPhase: 0.15 }), ash.coat)
  let minx = SPRITE_W, miny = SPRITE_H, maxx = 0, maxy = 0
  for (let y = 0; y < SPRITE_H; y++)
    for (let x = 0; x < SPRITE_W; x++)
      if (rgba[(y * SPRITE_W + x) * 4 + 3]) {
        if (x < minx) minx = x; if (x > maxx) maxx = x; if (y < miny) miny = y; if (y > maxy) maxy = y
      }
  const cw = maxx - minx + 1, ch = maxy - miny + 1
  const tmp = document.createElement('canvas')
  tmp.width = SPRITE_W; tmp.height = SPRITE_H
  const tctx = tmp.getContext('2d')!
  const timg = tctx.createImageData(SPRITE_W, SPRITE_H)
  timg.data.set(rgba)
  tctx.putImageData(timg, 0, 0)
  g.imageSmoothingEnabled = false
  const sc = (S * 0.74) / Math.max(cw, ch)
  const dw = cw * sc, dh = ch * sc
  g.drawImage(tmp, minx, miny, cw, ch, (S - dw) / 2, (S - dh) / 2 - S * 0.02, dw, dh)
  g.restore()
}

// The quiet dedication footer: Ash's photo, her pixel form, and the version.
async function buildAbout(): Promise<void> {
  $<HTMLImageElement>('aboutphoto').src = ashPhoto
  const cv = $<HTMLCanvasElement>('aboutcat')
  const S = cv.width
  const g = cv.getContext('2d')!
  const ash = PETS[0] // Ash — always Ash here
  const rgba = renderPet(generateGrid(ash, { eyeOpen: true, tailPhase: 0.15 }), ash.coat)
  let minx = SPRITE_W, miny = SPRITE_H, maxx = 0, maxy = 0
  for (let y = 0; y < SPRITE_H; y++)
    for (let x = 0; x < SPRITE_W; x++)
      if (rgba[(y * SPRITE_W + x) * 4 + 3]) {
        if (x < minx) minx = x; if (x > maxx) maxx = x; if (y < miny) miny = y; if (y > maxy) maxy = y
      }
  const cw = maxx - minx + 1, ch = maxy - miny + 1
  const tmp = document.createElement('canvas')
  tmp.width = SPRITE_W; tmp.height = SPRITE_H
  const tctx = tmp.getContext('2d')!
  const timg = tctx.createImageData(SPRITE_W, SPRITE_H)
  timg.data.set(rgba); tctx.putImageData(timg, 0, 0)
  g.clearRect(0, 0, S, S)
  g.imageSmoothingEnabled = false
  const sc = S / Math.max(cw, ch)
  const dw = cw * sc, dh = ch * sc
  g.drawImage(tmp, minx, miny, cw, ch, (S - dw) / 2, (S - dh) / 2, dw, dh)
  try { $('aboutver').textContent = 'v' + (await window.settings.getVersion()) } catch { /* ignore */ }
}

// Tab navigation + search across the settings sections.
function buildNav(): void {
  const tabsBar = $('tabs')
  const search = $<HTMLInputElement>('search')
  const secs = Array.from(document.querySelectorAll<HTMLElement>('.sec'))
  const tabBtns = Array.from(tabsBar.querySelectorAll('button'))
  // Remember the open tab across reloads (dev HMR reloads the page otherwise).
  let activeTab = sessionStorage.getItem('tab') ?? 'pet'
  if (!tabBtns.some((b) => (b as HTMLElement).dataset.tab === activeTab)) activeTab = 'pet'
  const showTab = (): void => {
    $('noresults').style.display = 'none'
    for (const s of secs) s.style.display = s.dataset.tab === activeTab ? '' : 'none'
    for (const c of tabBtns) c.classList.toggle('on', (c as HTMLElement).dataset.tab === activeTab)
  }
  for (const b of tabBtns) {
    b.addEventListener('click', () => {
      activeTab = (b as HTMLElement).dataset.tab as string
      sessionStorage.setItem('tab', activeTab)
      showTab()
      document.scrollingElement?.scrollTo(0, 0)
    })
  }
  const runSearch = (): void => {
    const q = search.value.trim().toLowerCase()
    if (!q) { tabsBar.style.display = ''; showTab(); return }
    tabsBar.style.display = 'none'
    let any = false
    for (const s of secs) {
      const match = (s.textContent ?? '').toLowerCase().includes(q)
      s.style.display = match ? '' : 'none'
      if (match) any = true
    }
    $('noresults').style.display = any ? 'none' : 'block'
  }
  search.addEventListener('input', runSearch)
  search.addEventListener('search', runSearch)
  showTab()
}

type GridFilter = 'all' | 'builtin' | 'user'
let gridFilter: GridFilter = 'all'

function buildGridFilter(): void {
  gridFilter = state.petFilter ?? 'all'
  const bar = $('gridfilter')
  for (const b of Array.from(bar.querySelectorAll('button'))) {
    b.classList.toggle('on', (b as HTMLElement).dataset.f === gridFilter)
    b.addEventListener('click', () => {
      gridFilter = (b as HTMLElement).dataset.f as GridFilter
      state.petFilter = gridFilter
      window.settings.setPetFilter(gridFilter)
      for (const child of bar.children) child.classList.toggle('on', child === b)
      buildGrid()
    })
  }
}

function buildGrid(): void {
  grid.innerHTML = ''
  const list = roster().filter((p) => gridFilter === 'all' || (gridFilter === 'user' ? isUserPet(p.id) : !isUserPet(p.id)))
  $('gridempty').style.display = list.length ? 'none' : 'block'
  for (const pet of list) {
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

  const pupils = $<HTMLButtonElement>('pupils')
  const paintPupils = (on: boolean): void => {
    pupils.classList.toggle('on', on)
    pupils.setAttribute('aria-pressed', String(on))
    pupils.textContent = on ? 'On — dilate with the day' : 'Off — fixed pupils'
  }
  paintPupils(state.pupilsByTime ?? false)
  pupils.addEventListener('click', () => {
    state.pupilsByTime = !state.pupilsByTime
    paintPupils(state.pupilsByTime)
    window.settings.setPupilsByTime(state.pupilsByTime)
  })

  const dream = $<HTMLButtonElement>('dream')
  const paintDream = (on: boolean): void => {
    dream.classList.toggle('on', on)
    dream.setAttribute('aria-pressed', String(on))
    dream.textContent = on ? 'On — dreams while sleeping' : 'Off — no dreams'
  }
  paintDream(state.dreamMode ?? false)
  dream.addEventListener('click', () => {
    state.dreamMode = !state.dreamMode
    paintDream(state.dreamMode)
    window.settings.setDreamMode(state.dreamMode)
  })

  const dc = $<HTMLInputElement>('dreamchance'), dcLabel = $('dreamchancev')
  const showDc = (): void => { dcLabel.textContent = `${dc.value}%` }
  dc.value = String(Math.round((state.dreamChance ?? 0.55) * 100))
  showDc()
  dc.addEventListener('input', () => {
    showDc()
    window.settings.setDreamChance(Number(dc.value) / 100)
  })

  const bs = $<HTMLInputElement>('dreambubblescale'), bsLabel = $('dreambubblescalev')
  const showBs = (): void => { bsLabel.textContent = `${bs.value}%` }
  bs.value = String(Math.round((state.dreamBubbleScale ?? 1) * 100))
  showBs()
  bs.addEventListener('input', () => {
    showBs()
    window.settings.setDreamBubbleScale(Number(bs.value) / 100)
  })
}

// ---- Build a cat (no AI): manual DNA editor + live preview + randomizer ------
const BUILD_LABELS: Record<string, string> = { normal: 'Normal', chonky: 'Chonky', slim: 'Slim', kitten: 'Kitten', fluffy: 'Fluffy', bigears: 'Big ears' }
const MARKING_LABELS: Record<string, string> = { solid: 'Solid', tabby: 'Tabby', tuxedo: 'Tuxedo', calico: 'Calico', points: 'Color-points', bicolor: 'Bicolor' }
const EYE_LABELS: Record<string, string> = { round: 'Round', almond: 'Almond', sleepy: 'Sleepy' }
const EAR_LABELS: Record<string, string> = { pointy: 'Pointy', tufted: 'Tufted', floppy: 'Floppy' }
const TAIL_LABELS: Record<string, string> = { default: 'Normal', bushy: 'Bushy', thin: 'Thin', nub: 'Nub' }
const GAIT_LABELS: Record<string, string> = { walk: 'Walk', trot: 'Trot', stalk: 'Stalk', hop: 'Hop' }

function buildBuilder(): void {
  const name = $<HTMLInputElement>('bname'), build = $<HTMLSelectElement>('bbuild')
  const marking = $<HTMLSelectElement>('bmarking'), eyes = $<HTMLSelectElement>('beyes'), ears = $<HTMLSelectElement>('bears')
  const tail = $<HTMLSelectElement>('btail'), gaitSel = $<HTMLSelectElement>('bgait'), snout = $<HTMLInputElement>('bsnout')
  const primary = $<HTMLInputElement>('bprimary'), iris = $<HTMLInputElement>('biris')
  const secondary = $<HTMLInputElement>('bsecondary'), white = $<HTMLInputElement>('bwhite'), tertiary = $<HTMLInputElement>('btertiary')
  const secWrap = $('bsecwrap'), whiteWrap = $('bwhitewrap'), tertWrap = $('btertwrap')
  const preview = $<HTMLCanvasElement>('bpreview'), pctx = preview.getContext('2d')!
  const preAnim = $<HTMLSelectElement>('bpreanim')
  const create = $<HTMLButtonElement>('bcreate'), status = $('bstatus')

  // What the preview plays. "Move" follows the creature's chosen gait; the rest let
  // you watch the same creature in every resting/idle animation before you Create it.
  const PREVIEW_ANIMS: Array<{ key: string; label: string; rgba: (pet: AppPet, t: number) => Uint8ClampedArray }> = [
    { key: 'move', label: 'Move', rgba: (pet, t) => renderPet(generateWalkGrid(pet, (t / 720) % 1, 1), pet.coat) },
    { key: 'idle', label: 'Idle', rgba: (pet, t) => renderPet(generateGrid(pet, idleState(t)), pet.coat) },
    { key: 'sit', label: 'Sit', rgba: (pet, t) => renderPet(generateRigGrid(pet, sitPose(t)), pet.coat) },
    { key: 'loaf', label: 'Loaf', rgba: (pet, t) => renderPet(generateRigGrid(pet, loafPose(t)), pet.coat) },
    { key: 'sphinx', label: 'Sphinx', rgba: (pet, t) => renderPet(generateRigGrid(pet, sphinxPose(t)), pet.coat) },
    { key: 'sleep', label: 'Sleep', rgba: (pet, t) => renderPet(generateRigGrid(pet, sleepPose(t)), pet.coat) },
    { key: 'groom', label: 'Groom', rgba: (pet, t) => renderPet(generateRigGrid(pet, lerpPose(RIG.groom, RIG.groomLick, 0.5 + 0.5 * Math.sin(t / 140))), pet.coat) },
    { key: 'stretch', label: 'Stretch', rgba: (pet, t) => renderPet(generateRigGrid(pet, stretchPose(t)), pet.coat) },
    { key: 'pounce', label: 'Pounce', rgba: (pet, t) => renderPet(generateRigGrid(pet, pouncePose(t)), pet.coat) }
  ]
  for (const a of PREVIEW_ANIMS) preAnim.append(new Option(a.label, a.key))

  for (const b of BUILD_NAMES) build.append(new Option(BUILD_LABELS[b] ?? b, b))
  for (const e of EAR_STYLES) ears.append(new Option(EAR_LABELS[e] ?? e, e))
  for (const e of EYE_STYLES) eyes.append(new Option(EYE_LABELS[e] ?? e, e))
  for (const m of MARKING_NAMES) marking.append(new Option(MARKING_LABELS[m] ?? m, m))
  for (const t of TAIL_STYLES) tail.append(new Option(TAIL_LABELS[t] ?? t, t))
  for (const gt of GAITS) gaitSel.append(new Option(GAIT_LABELS[gt] ?? gt, gt))

  let personality = randomPetDNA().personality as unknown as Record<string, number> // hidden; randomizer refreshes it

  // The editor now builds a CreatureDef (style + coat), so it can make dogs/rabbits too.
  const def = (): CreatureDef => {
    const mk = marking.value
    const coat: Record<string, string> = { primary: primary.value, iris: iris.value }
    if (mk === 'tabby' || mk === 'points') coat.secondary = secondary.value
    if (mk === 'tuxedo' || mk === 'bicolor') coat.white = white.value
    if (mk === 'calico') { coat.secondary = secondary.value; coat.tertiary = tertiary.value; coat.white = white.value }
    return {
      name: name.value.trim() || 'New Friend',
      style: { build: build.value, eyeStyle: eyes.value, earStyle: ears.value, tailStyle: tail.value, gait: gaitSel.value, snout: Number(snout.value) / 10 },
      coat, marking: mk, personality
    }
  }

  const syncFields = (): void => {
    const mk = marking.value
    secWrap.classList.toggle('hide', !(mk === 'tabby' || mk === 'points' || mk === 'calico'))
    whiteWrap.classList.toggle('hide', !(mk === 'tuxedo' || mk === 'bicolor' || mk === 'calico'))
    tertWrap.classList.toggle('hide', mk !== 'calico')
    if (secWrap.firstChild) secWrap.firstChild.nodeValue = mk === 'points' ? 'Points' : mk === 'calico' ? 'Ginger' : 'Stripes'
  }

  // Live preview: the creature walking (or hopping) in place, so every control —
  // ears, eyes, tail, snout, and the gait itself — is visible in motion.
  const tmp = document.createElement('canvas'); tmp.width = SPRITE_W; tmp.height = SPRITE_H
  const tc = tmp.getContext('2d')!
  let previewPet = loadCreature(def(), 'preview')
  const draw = (): void => { previewPet = loadCreature(def(), 'preview') } // rebuild on any change
  const animate = (now: number): void => {
    const anim = PREVIEW_ANIMS.find(a => a.key === preAnim.value) ?? PREVIEW_ANIMS[0]
    const rgba = anim.rgba(previewPet, now)
    const img = tc.createImageData(SPRITE_W, SPRITE_H); img.data.set(rgba); tc.putImageData(img, 0, 0)
    pctx.clearRect(0, 0, preview.width, preview.height); pctx.imageSmoothingEnabled = false
    pctx.drawImage(tmp, 0, 0, SPRITE_W, SPRITE_H, 0, 0, preview.width, preview.height)
    requestAnimationFrame(animate)
  }
  requestAnimationFrame(animate)

  const load = (d: PetDNA, style?: { earStyle?: string; tailStyle?: string; gait?: string; snout?: number }): void => {
    name.value = d.name; build.value = d.build; marking.value = d.marking; eyes.value = d.eyeStyle
    ears.value = style?.earStyle ?? 'pointy'
    tail.value = style?.tailStyle ?? 'default'
    gaitSel.value = style?.gait ?? 'walk'
    snout.value = String(Math.round((style?.snout ?? 0) * 10))
    primary.value = d.colors.primary; iris.value = d.colors.iris
    secondary.value = d.colors.secondary ?? '#c56a24'
    tertiary.value = d.colors.tertiary ?? '#3a3038'
    white.value = d.colors.white ?? '#f4f4f7'
    personality = d.personality as unknown as Record<string, number>
    syncFields(); draw()
  }

  for (const el of [name, build, marking, eyes, ears, tail, gaitSel, snout, primary, iris, secondary, white, tertiary]) {
    el.addEventListener('input', () => { syncFields(); draw() })
  }
  $<HTMLButtonElement>('brandom').addEventListener('click', () => {
    // Sometimes roll a floppy-eared, snouted friend (a dog!) to show the range.
    const dog = Math.random() < 0.3
    load(randomPetDNA(), dog ? { earStyle: 'floppy', snout: 2.6 + Math.random() * 2 } : {})
    status.textContent = ''; status.className = 'status'
  })
  create.addEventListener('click', async () => {
    create.disabled = true
    const r = await window.settings.createPet(def())
    create.disabled = false
    status.className = 'status ' + (r.ok ? 'ok' : 'err')
    if (!r.ok) { status.textContent = r.error; return }
    status.textContent = `Created ${r.pet.name} — added to your pets and made active.`
    state = await window.settings.get() // main added it + made it active
    buildGrid(); buildTraits(); refreshMeta()
    grid.querySelector('.card.active')?.scrollIntoView({ block: 'nearest' })
  })
  // Share: export the current creature to a file, or import someone else's.
  $<HTMLButtonElement>('bexport').addEventListener('click', async () => {
    const r = await window.settings.exportCreature(def())
    if (r.ok) { status.className = 'status ok'; status.textContent = 'Exported to a .pixelpet.json file.' }
    else if (r.error !== 'Cancelled') { status.className = 'status err'; status.textContent = r.error ?? 'Export failed.' }
  })
  $<HTMLButtonElement>('bimport').addEventListener('click', async () => {
    const r = await window.settings.importCreature()
    if (!r.ok) { if (r.error !== 'Cancelled') { status.className = 'status err'; status.textContent = r.error } return }
    status.className = 'status ok'; status.textContent = `Imported ${r.pet.name} — added to your pets and made active.`
    state = await window.settings.get()
    buildGrid(); buildTraits(); refreshMeta()
    grid.querySelector('.card.active')?.scrollIntoView({ block: 'nearest' })
  })

  load(randomPetDNA()) // start on a random creature so the editor isn't empty
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

const needColor = (v: number): string => (v > 0.5 ? '#7bbf5e' : v > 0.28 ? '#e0a94e' : '#e06a5a')

function buildCare(): void {
  const toggle = $<HTMLButtonElement>('caremode')
  const body = $('carebody')
  const diffBar = $('difficulty')
  const bars = $('needbars')

  const paintToggle = (on: boolean): void => {
    toggle.classList.toggle('on', on)
    toggle.setAttribute('aria-pressed', String(on))
    toggle.textContent = on ? 'On' : 'Off'
    body.classList.toggle('off', !on)
  }
  paintToggle(state.careMode ?? false)
  toggle.addEventListener('click', () => {
    state.careMode = !state.careMode
    paintToggle(state.careMode)
    window.settings.setCareMode(state.careMode)
    if (state.careMode) refreshCare()
  })

  for (const b of Array.from(diffBar.querySelectorAll('button'))) {
    b.classList.toggle('on', (b as HTMLElement).dataset.d === (state.difficulty ?? 'normal'))
    b.addEventListener('click', () => {
      const d = (b as HTMLElement).dataset.d as Difficulty
      state.difficulty = d
      for (const c of diffBar.children) c.classList.toggle('on', c === b)
      window.settings.setDifficulty(d)
    })
  }

  for (const b of Array.from(document.querySelectorAll('.careactions .btn'))) {
    b.addEventListener('click', () => {
      window.settings.careAction((b as HTMLElement).dataset.a as CareAction)
      setTimeout(refreshCare, 120) // reflect the boost promptly
    })
  }

  // Render the need bars once; refreshCare updates their fills.
  const ORDER: Array<keyof Needs> = [...NEED_KEYS, 'health']
  for (const key of ORDER) {
    const row = document.createElement('div')
    row.className = 'needbar'
    row.innerHTML = `<div class="nn">${key}</div><div class="track"><div class="fill" data-k="${key}"></div></div><div class="nv" data-v="${key}"></div>`
    bars.append(row)
  }

  refreshCare()
  setInterval(() => { if (state.careMode) refreshCare() }, 1600)
}

async function refreshCare(): Promise<void> {
  const st = await window.settings.careStatus()
  if (!st) return
  $('caremood').textContent = `${st.state.emoji} ${st.state.label}`
  for (const key of [...NEED_KEYS, 'health'] as Array<keyof Needs>) {
    const v = st.needs[key]
    const fill = document.querySelector<HTMLElement>(`.fill[data-k="${key}"]`)
    const val = document.querySelector<HTMLElement>(`.nv[data-v="${key}"]`)
    if (fill) { fill.style.width = `${Math.round(v * 100)}%`; fill.style.background = needColor(v) }
    if (val) val.textContent = `${Math.round(v * 100)}`
  }
}

function buildImmich(): void {
  const server = $<HTMLInputElement>('imserver'), album = $<HTMLInputElement>('imalbum'), key = $<HTMLInputElement>('imkey')
  const save = $<HTMLButtonElement>('imsave'), test = $<HTMLButtonElement>('imtest')
  const keystate = $('imkeystate'), status = $('imstatus')
  const setStatus = (m: string, cls = ''): void => { status.textContent = m; status.className = 'status' + (cls ? ' ' + cls : '') }
  const paintKey = (st: { hasKey: boolean }): void => {
    keystate.textContent = st.hasKey ? '✓ key saved (encrypted on this PC)' : 'No key saved yet.'
    keystate.className = 'keystate' + (st.hasKey ? ' saved' : '')
  }
  window.settings.immichStatus().then((st) => { server.value = st.serverUrl; album.value = st.albumId; paintKey(st) })

  // Accept a pasted album URL — pull the UUID out of it.
  const albumId = (): string => /([0-9a-fA-F-]{36})/.exec(album.value)?.[1] ?? album.value.trim()
  const pushCfg = (): void => window.settings.setImmichConfig({ serverUrl: server.value.trim(), albumId: albumId() })
  server.addEventListener('change', pushCfg)
  album.addEventListener('change', () => { album.value = albumId(); pushCfg() })

  const flushKey = async (): Promise<void> => {
    if (!key.value.trim()) return
    paintKey(await window.settings.setImmichKey(key.value.trim()))
    key.value = ''
  }
  save.addEventListener('click', async () => {
    if (!key.value.trim()) { setStatus('Enter a key first.', 'err'); return }
    pushCfg(); await flushKey(); setStatus('Key saved.', 'ok')
  })
  test.addEventListener('click', async () => {
    pushCfg(); await flushKey()
    setStatus('Testing…', 'busy')
    const r = await window.settings.testImmich()
    setStatus(r.message, r.ok ? 'ok' : 'err')
  })
}

async function init(): Promise<void> {
  state = await window.settings.get()
  drawAppIcon()
  void buildAbout()
  buildNav()
  buildGridFilter()
  buildGrid()
  buildPoses()
  buildSizes()
  buildAnimation()
  buildCare()
  buildBuilder()
  buildAi()
  buildImmich()
  buildTraits()
  refreshMeta()
  // Make sure the current cat is visible even if it's far down the grid.
  grid.querySelector('.card.active')?.scrollIntoView({ block: 'nearest' })
  // Restore scroll position (dev HMR reloads the page and would otherwise jump to top).
  const savedY = Number(sessionStorage.getItem('scrollY') ?? 0)
  if (savedY > 0) document.scrollingElement?.scrollTo(0, savedY)
  let raf = 0
  window.addEventListener('scroll', () => {
    if (raf) return
    raf = requestAnimationFrame(() => {
      raf = 0
      sessionStorage.setItem('scrollY', String(document.scrollingElement?.scrollTop ?? 0))
    })
  }, { passive: true })
  requestAnimationFrame(animatePoses)
}
init()
