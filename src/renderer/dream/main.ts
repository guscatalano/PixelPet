export {} // module (for the global augmentation below)

interface DreamApi {
  onPhoto: (handler: (dataUrl: string) => void) => void
}
declare global {
  interface Window { dream: DreamApi }
}

const bubble = document.getElementById('b') as HTMLDivElement
const img = document.getElementById('p') as HTMLImageElement

// Cross-fade to each new dream photo.
window.dream.onPhoto((dataUrl: string) => {
  const next = new Image()
  next.onload = () => {
    bubble.classList.remove('show')
    setTimeout(() => {
      img.src = dataUrl
      requestAnimationFrame(() => bubble.classList.add('show'))
    }, img.src ? 260 : 0)
  }
  next.src = dataUrl
})
