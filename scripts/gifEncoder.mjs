// Minimal animated GIF89a encoder (no dependencies). Palette-indexed with one
// transparent color; uses the "clear-code" trick so no real LZW dictionary is
// needed (bulletproof, slightly larger files). Good enough for previewing the
// pet's animations.

function lzwClearCoded(minCode, pixels) {
  const CLEAR = 1 << minCode
  const EOI = CLEAR + 1
  const codeSize = minCode + 1
  const bytes = []
  let acc = 0
  let accBits = 0
  const emit = (code) => {
    acc |= code << accBits
    accBits += codeSize
    while (accBits >= 8) {
      bytes.push(acc & 255)
      acc >>= 8
      accBits -= 8
    }
  }
  emit(CLEAR)
  // The decoder grows its table by one entry per code read; emit CLEAR before it
  // would need a wider code, so the code width stays fixed at minCode+1.
  const maxRun = CLEAR - 2
  let run = 0
  for (let i = 0; i < pixels.length; i++) {
    emit(pixels[i])
    if (++run >= maxRun) {
      emit(CLEAR)
      run = 0
    }
  }
  emit(EOI)
  if (accBits > 0) bytes.push(acc & 255)
  return bytes
}

function subBlocks(bytes) {
  const out = []
  for (let i = 0; i < bytes.length; i += 255) {
    const chunk = bytes.slice(i, i + 255)
    out.push(chunk.length, ...chunk)
  }
  out.push(0)
  return out
}

/**
 * @param {number} width
 * @param {number} height
 * @param {Uint8ClampedArray[]} framesRGBA  RGBA buffers, one per frame
 * @param {{delayCs?:number, loop?:number}} opts  frame delay in centiseconds
 * @returns {Buffer}
 */
export function encodeGIF(width, height, framesRGBA, opts = {}) {
  const delayCs = opts.delayCs ?? 8
  const loop = opts.loop ?? 0

  // Index 0 = transparent. Remaining indices are unique opaque colors.
  const colorMap = new Map()
  const palette = [[0, 0, 0]]
  const indexed = framesRGBA.map((rgba) => {
    const idx = new Uint8Array(width * height)
    for (let i = 0; i < width * height; i++) {
      if (rgba[i * 4 + 3] < 128) { idx[i] = 0; continue }
      const r = rgba[i * 4], g = rgba[i * 4 + 1], b = rgba[i * 4 + 2]
      const key = (r << 16) | (g << 8) | b
      let ci = colorMap.get(key)
      if (ci === undefined) { ci = palette.length; palette.push([r, g, b]); colorMap.set(key, ci) }
      idx[i] = ci
    }
    return idx
  })
  if (palette.length > 256) throw new Error('GIF: too many colors ' + palette.length)

  let minCode = 2
  while ((1 << minCode) < palette.length) minCode++
  const gctSize = 1 << minCode

  const b = []
  const u16 = (v) => { b.push(v & 255, (v >> 8) & 255) }
  const str = (s) => { for (const c of s) b.push(c.charCodeAt(0)) }

  str('GIF89a')
  u16(width); u16(height)
  b.push(0x80 | ((minCode - 1) << 4) | (minCode - 1), 0, 0) // packed, bg, aspect
  for (let i = 0; i < gctSize; i++) {
    const c = palette[i] || [0, 0, 0]
    b.push(c[0], c[1], c[2])
  }

  // NETSCAPE looping extension
  b.push(0x21, 0xff, 0x0b)
  str('NETSCAPE2.0')
  b.push(0x03, 0x01); u16(loop); b.push(0x00)

  for (const idx of indexed) {
    // Graphic Control Extension: disposal=2 (restore to bg), transparent index 0
    b.push(0x21, 0xf9, 0x04, (2 << 2) | 1); u16(delayCs); b.push(0x00, 0x00)
    // Image Descriptor
    b.push(0x2c); u16(0); u16(0); u16(width); u16(height); b.push(0x00)
    b.push(minCode)
    const data = subBlocks(lzwClearCoded(minCode, idx))
    for (const v of data) b.push(v)
  }
  b.push(0x3b)
  return Buffer.from(b)
}
