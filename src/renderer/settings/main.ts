import { generateGrid, generateWalkGrid, generateCurlGrid, render as renderPet, type AnimState } from '../../shared/catgen'
import { PETS, type AppPet } from '../../shared/pets'
import { MIN_SCALE, MAX_SCALE, SPRITE_W, SPRITE_H } from '../../shared/constants'
import { TRAIT_KEYS, type AppSettings, type Personality } from '../../shared/types'

// ---- Bridge typing (exposed by preload/settings.ts) ------------------------
interface SettingsApi {
  get: () => Promise<AppSettings>
  setPet: (petId: string) => void
  setScale: (scale: number) => void
  setTrait: (petId: string, key: keyof Personality, value: number) => void
  resetTraits: (petId: string) => void
}
declare global {
  interface Window { settings: SettingsApi }
}

const SIZE_LABELS: Record<number, string> = { 3: 'S', 4: 'M', 5: 'L', 6: 'XL', 7: 'XXL' }

const $ = <T extends HTMLElement>(id: string): T => document.getElementById(id) as T
const grid = $('grid'), sizes = $('sizes'), rows = $('rows'), who = $('who'), resetBtn = $<HTMLButtonElement>('reset')
const posesEl = $('poses'), poseWho = $('poseWho'), petid = $('petid'), mod = $('mod')

let state: AppSettings

/** True if the active pet has any user-customized traits. */
function isCustomized(petId: string): boolean {
  const ov = state.overrides[petId]
  return !!ov && Object.keys(ov).length > 0
}

/** Reflect the active pet's identity + whether its traits are customized. */
function refreshMeta(): void {
  const pet = PETS.find((p) => p.id === state.activePetId)!
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
const POSES: Array<{ key: string; label: string; rgba: (pet: AppPet, t: number) => Uint8ClampedArray }> = [
  { key: 'idle', label: 'Idle', rgba: (pet, t) => renderPet(generateGrid(pet, idleState(t)), pet.coat) },
  { key: 'walk', label: 'Walk', rgba: (pet, t) => renderPet(generateWalkGrid(pet, (t / 900) % 1), pet.coat) },
  { key: 'sleep', label: 'Sleep', rgba: (pet, t) => renderPet(generateCurlGrid(pet, (t / 1500) % (Math.PI * 2)), pet.coat) },
  { key: 'react', label: 'React', rgba: (pet, t) => renderPet(generateGrid(pet, reactState(t)), pet.coat) }
]
const poseCanvases: CanvasRenderingContext2D[] = []

function buildPoses(): void {
  posesEl.innerHTML = ''
  poseCanvases.length = 0
  for (const pose of POSES) {
    const tile = document.createElement('div')
    tile.className = 'pose'
    const c = document.createElement('canvas')
    c.width = SPRITE_W
    c.height = SPRITE_H
    const label = document.createElement('div')
    label.className = 'pl'
    label.textContent = pose.label
    tile.append(c, label)
    posesEl.append(tile)
    poseCanvases.push(c.getContext('2d')!)
  }
}

let poseLast = 0
function animatePoses(t: number): void {
  requestAnimationFrame(animatePoses)
  if (t - poseLast < 66) return // ~15fps is plenty for these gentle loops
  poseLast = t
  const pet = PETS.find((p) => p.id === state?.activePetId)
  if (!pet) return
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
  const pet = PETS.find((p) => p.id === petId)!
  return { ...pet.personality, ...(state.overrides[petId] ?? {}) }
}

/** Render a pet's idle frame into a small canvas thumbnail. */
function thumbnail(petId: string): HTMLCanvasElement {
  const pet = PETS.find((p) => p.id === petId)!
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
  for (const pet of PETS) {
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
  const pet = PETS.find((p) => p.id === state.activePetId)!
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

async function init(): Promise<void> {
  state = await window.settings.get()
  buildGrid()
  buildPoses()
  buildSizes()
  buildTraits()
  refreshMeta()
  // Make sure the current cat is visible even if it's far down the grid.
  grid.querySelector('.card.active')?.scrollIntoView({ block: 'nearest' })
  requestAnimationFrame(animatePoses)
}
init()
