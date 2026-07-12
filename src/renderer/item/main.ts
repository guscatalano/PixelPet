// A draggable care item (food bowl / yarn ball / medicine capsule). The whole
// window is the item; press and drag it onto the cat to use it (main handles the
// cursor-follow move + drop-on-cat detection).

export {} // make this a module so the global augmentation below is allowed

interface ItemApi {
  dragStart: () => void
  dragEnd: () => void
  onSetItem: (handler: (kind: string) => void) => void
}
declare global {
  interface Window { item: ItemApi }
}

const S = 52
const canvas = document.getElementById('i') as HTMLCanvasElement
canvas.width = S
canvas.height = S
const g = canvas.getContext('2d')!

const outline = (): void => { g.strokeStyle = '#232530'; g.lineWidth = 3; g.lineJoin = 'round'; g.lineCap = 'round' }

function draw(kind: string): void {
  g.clearRect(0, 0, S, S)
  if (kind === 'toy') {
    // Ball of yarn.
    outline()
    g.fillStyle = '#e88bb0'
    g.beginPath(); g.arc(26, 28, 15, 0, Math.PI * 2); g.fill(); g.stroke()
    g.strokeStyle = '#c96a92'; g.lineWidth = 2
    for (const a of [-0.7, -0.2, 0.35]) {
      g.beginPath(); g.moveTo(26 + Math.cos(a) * 15, 28 + Math.sin(a) * 15); g.lineTo(26 - Math.cos(a) * 15, 28 - Math.sin(a) * 15); g.stroke()
    }
    // a loose end
    g.beginPath(); g.moveTo(38, 36); g.quadraticCurveTo(46, 40, 42, 47); g.stroke()
  } else if (kind === 'medicine') {
    // Capsule, half red / half white.
    const x = 9, y = 20, w = 34, h = 13, r = h / 2
    g.beginPath()
    g.moveTo(x + r, y); g.lineTo(x + w - r, y); g.arc(x + w - r, y + r, r, -Math.PI / 2, Math.PI / 2)
    g.lineTo(x + r, y + h); g.arc(x + r, y + r, r, Math.PI / 2, -Math.PI / 2); g.closePath()
    g.fillStyle = '#f0f0f4'; g.fill()
    g.save(); g.clip(); g.fillStyle = '#e05a5a'; g.fillRect(x, y, w / 2, h); g.restore()
    outline(); g.stroke()
    g.fillStyle = 'rgba(255,255,255,0.5)'; g.fillRect(x + 3, y + 3, w - 6, 2)
  } else {
    // Food bowl with a kibble mound.
    outline()
    g.fillStyle = '#a3703f'
    g.beginPath(); g.arc(26, 31, 13, Math.PI, 0); g.closePath(); g.fill(); g.stroke()
    g.fillStyle = '#c7c7d2'
    g.beginPath()
    g.moveTo(10, 31); g.lineTo(42, 31); g.lineTo(37, 44); g.quadraticCurveTo(26, 47, 15, 44); g.closePath()
    g.fill(); g.stroke()
    g.strokeStyle = '#232530'; g.beginPath(); g.moveTo(10, 31); g.lineTo(42, 31); g.stroke()
  }
}

window.item.onSetItem(draw)
draw('food')

let dragging = false
window.addEventListener('mousedown', (e) => {
  if (e.button !== 0) return
  dragging = true
  document.body.classList.add('drag')
  window.item.dragStart()
})
window.addEventListener('mouseup', () => {
  if (!dragging) return
  dragging = false
  document.body.classList.remove('drag')
  window.item.dragEnd()
})
