import { generateGrid, render as renderPet } from '../../shared/catgen'
import { PETS } from '../../shared/pets'
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

let state: AppSettings

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
    card.append(thumbnail(pet.id))
    const nm = document.createElement('div')
    nm.className = 'nm'
    nm.textContent = pet.name
    card.append(nm)
    card.addEventListener('click', () => selectPet(pet.id))
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
}

resetBtn.addEventListener('click', () => {
  delete state.overrides[state.activePetId]
  window.settings.resetTraits(state.activePetId)
  buildTraits()
})

async function init(): Promise<void> {
  state = await window.settings.get()
  buildGrid()
  buildSizes()
  buildTraits()
}
init()
