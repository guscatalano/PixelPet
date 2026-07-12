export {} // module (for the global augmentation below)

interface DreamApi {
  onPhoto: (handler: (dataUrl: string) => void) => void
  setInteractive: (on: boolean) => void
  openViewer: () => void
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

// The window is click-through by default. Watch the (forwarded) cursor: while
// it's over the bubble, flip the window interactive so the double-click lands;
// as soon as it leaves, hand clicks back to whatever is behind the bubble.
let interactive = false
function setInteractive(on: boolean): void {
  if (on === interactive) return
  interactive = on
  bubble.classList.toggle('hot', on)
  window.dream.setInteractive(on)
}
function overBubble(x: number, y: number): boolean {
  const r = bubble.getBoundingClientRect()
  return x >= r.left && x <= r.right && y >= r.top && y <= r.bottom
}
window.addEventListener('mousemove', (e) => setInteractive(overBubble(e.clientX, e.clientY)))
window.addEventListener('mouseleave', () => setInteractive(false))
bubble.addEventListener('dblclick', () => { if (img.src) window.dream.openViewer() })
