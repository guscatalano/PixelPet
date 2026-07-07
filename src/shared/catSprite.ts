// The default white cat, authored as a role-indexed pixel grid.
//
// Each character is a *role* (outline, fur base, shadow, ...), NOT a literal color.
// A pet's appearance is produced by mapping roles -> colors (a "palette"), which is
// exactly the M3 `recolor` generation mode. For M1 we only ship the default white cat.
//
// The cat is drawn as a 16-wide LEFT HALF and mirrored to a full 32x32 sprite, which
// keeps it perfectly symmetric and halves the authoring/editing effort.
//
// Legend:
//   .  transparent      o  outline        b  fur base
//   s  fur shadow       h  fur highlight  p  paw / secondary
//   e  eye iris         k  pupil          n  nose / inner-ear (pink)

/** Role -> hex color for the default white cat. */
export const WHITE_CAT_PALETTE: Record<string, string> = {
  o: '#2b2b33', // outline
  b: '#f4f4f6', // fur base
  s: '#d3d3dd', // fur shadow
  h: '#ffffff', // fur highlight
  p: '#e4e4ee', // paw / secondary
  e: '#5cbf74', // eye iris (green)
  k: '#22303a', // pupil
  n: '#e98aa0' // nose / inner-ear (pink)
}

// Left half only (x = 0..15). Rightmost column (x15) must be interior fur so the
// mirrored seam is continuous; the outline lives on the outer (low-x) side.
const LEFT: readonly string[] = [
  '................', // 0
  '.......o........', // 1  ear tip
  '......ohho......', // 2
  '......ohhho.....', // 3
  '.....ohhhno.....', // 4  inner-ear pink
  '.....ohhhno.....', // 5
  '....ohhhbno.....', // 6
  '....ohhbbbo.....', // 7
  '...ohbbbbbbo....', // 8  head crown
  '...ohbbbbbbbbbbh', // 9
  '..ohbbbbbbbbbbbh', // 10
  '..obbbbbbbbbbbbb', // 11
  '..obbbbbbbbbbbbb', // 12
  '..obbbeeebbbbbbb', // 13 eye (3x3, centered pupil)
  '..obbbekebbbbbbb', // 14
  '..obbbeeebbbbbbb', // 15
  '..obbbbbbbbbbbbb', // 16
  '..obbbbbbbbbbsnn', // 17 nose (n at x14-15) + cheek shadow at x13
  '...obbbbbbbbbsnn', // 18
  '...obbbbbbbbbbbb', // 19
  '....obbbbbbbbbbb', // 20 neck
  '....obsbbbbbbbbb', // 21
  '...obssbbbbbbbbb', // 22 body
  '..obbssbbbbbbbbb', // 23
  '..obbsbbbbbbbbbb', // 24
  '.obbbbbbbbbbbbbb', // 25
  '.obbbbbbbbbbbbbb', // 26
  '.obbbbbbbbbbbbbb', // 27
  '.obbbbbbbbbbbbbb', // 28
  '.obbsppppsbbbbbb', // 29 front paw
  '.obbsppppsbbbsbb', // 30
  '.ooooooooooooooo' // 31 base outline
]

/** Build a full symmetric sprite row from a left-half row. */
function mirrorRow(left: string): string {
  return left + [...left].reverse().join('')
}

function mirror(left: readonly string[]): string[] {
  return left.map(mirrorRow)
}

/** Idle pose, full 32x32. */
export const CAT_IDLE: readonly string[] = mirror(LEFT)

/** Produce a blink frame by closing the eyes (iris/pupil become a shadow line). */
export function makeBlinkFrame(grid: readonly string[]): string[] {
  return grid.map((row) => row.replace(/[ek]/g, 's'))
}

export interface ParsedSprite {
  width: number
  height: number
  /** RGBA bytes, length width*height*4. */
  rgba: Uint8ClampedArray
  /** Per-pixel opacity (true = drawn), length width*height. Used for hit-testing. */
  mask: boolean[]
}

function hexToRgb(hex: string): [number, number, number] {
  const h = hex.replace('#', '')
  return [
    parseInt(h.slice(0, 2), 16),
    parseInt(h.slice(2, 4), 16),
    parseInt(h.slice(4, 6), 16)
  ]
}

/** Convert a role grid + palette into RGBA bytes and an opacity mask. */
export function parseSprite(
  grid: readonly string[],
  palette: Record<string, string>
): ParsedSprite {
  const height = grid.length
  const width = grid[0].length
  const rgba = new Uint8ClampedArray(width * height * 4)
  const mask = new Array<boolean>(width * height).fill(false)

  for (let y = 0; y < height; y++) {
    const row = grid[y]
    for (let x = 0; x < width; x++) {
      const ch = row[x]
      const idx = y * width + x
      if (ch === '.' || ch === undefined) continue
      const color = palette[ch]
      if (!color) continue
      const [r, g, b] = hexToRgb(color)
      const o = idx * 4
      rgba[o] = r
      rgba[o + 1] = g
      rgba[o + 2] = b
      rgba[o + 3] = 255
      mask[idx] = true
    }
  }

  return { width, height, rgba, mask }
}
