export {} // module (for the global augmentation below)

interface StringApi {
  onHit: (handler: () => void) => void
}
declare global {
  interface Window { stringToy: StringApi }
}

const pivot = document.getElementById('p') as HTMLDivElement

// Swap to the swing animation on a hit, then hand back to the idle sway once it
// has damped out. Removing and re-adding the class in separate frames is what
// makes a second hit restart the swing instead of being swallowed.
let settle: ReturnType<typeof setTimeout> | null = null
window.stringToy.onHit(() => {
  if (settle) clearTimeout(settle)
  pivot.classList.remove('hit')
  void pivot.offsetWidth // force a reflow so the animation can restart
  pivot.classList.add('hit')
  settle = setTimeout(() => {
    pivot.classList.remove('hit')
    settle = null
  }, 1050)
})
