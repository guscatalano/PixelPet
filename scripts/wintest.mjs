// Quick check that koffi can enumerate top-level window rects via Win32.
//   node scripts/wintest.mjs
import koffi from 'koffi'

const user32 = koffi.load('user32.dll')
const dwmapi = koffi.load('dwmapi.dll')
koffi.struct('RECT', { left: 'long', top: 'long', right: 'long', bottom: 'long' })

const EnumWindows = user32.func('bool __stdcall EnumWindows(void* lpEnumFunc, intptr lParam)')
const GetWindowRect = user32.func('bool __stdcall GetWindowRect(void* hWnd, _Out_ RECT* lpRect)')
const IsWindowVisible = user32.func('bool __stdcall IsWindowVisible(void* hWnd)')
const IsIconic = user32.func('bool __stdcall IsIconic(void* hWnd)')
const GetWindowTextW = user32.func('int __stdcall GetWindowTextW(void* hWnd, _Out_ uint16_t* lpString, int nMaxCount)')
const GetWindowLongPtrW = user32.func('intptr __stdcall GetWindowLongPtrW(void* hWnd, int nIndex)')
const DwmGetWindowAttribute = dwmapi.func('int __stdcall DwmGetWindowAttribute(void* hWnd, uint32 dwAttribute, _Out_ void* pvAttribute, uint32 cbAttribute)')

const GWL_EXSTYLE = -20, WS_EX_TOOLWINDOW = 0x80, DWMWA_CLOAKED = 14
const WNDENUMPROC = koffi.proto('bool __stdcall WNDENUMPROC(void* hwnd, intptr lParam)')

function title(hwnd) {
  const buf = new Uint16Array(256)
  const n = GetWindowTextW(hwnd, buf, 256)
  return Buffer.from(buf.buffer, 0, n * 2).toString('utf16le')
}
function cloaked(hwnd) {
  const out = Buffer.alloc(4)
  if (DwmGetWindowAttribute(hwnd, DWMWA_CLOAKED, out, 4) === 0) return out.readUInt32LE(0) !== 0
  return false
}

const wins = []
const cb = koffi.register((hwnd, _l) => {
  if (IsWindowVisible(hwnd) && !IsIconic(hwnd) && !cloaked(hwnd)) {
    const ex = GetWindowLongPtrW(hwnd, GWL_EXSTYLE)
    if (!(Number(ex) & WS_EX_TOOLWINDOW)) {
      const r = {}
      if (GetWindowRect(hwnd, r)) {
        const w = r.right - r.left, h = r.bottom - r.top, t = title(hwnd)
        if (w > 120 && h > 60 && t) wins.push({ t, x: r.left, y: r.top, w, h })
      }
    }
  }
  return true
}, koffi.pointer(WNDENUMPROC))

EnumWindows(cb, 0)
koffi.unregister(cb)
console.log(`found ${wins.length} windows (z-order, topmost first):`)
for (const w of wins.slice(0, 14)) console.log(`  [${w.x},${w.y} ${w.w}x${w.h}]  ${w.t.slice(0, 42)}`)
