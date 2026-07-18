// Enumerate other apps' top-level windows (position + size) via the Win32 API,
// so the pet can be "aware of what it's standing on". Uses koffi (FFI, prebuilt —
// no native compile). Windows-only; callers guard on process.platform.
//
// koffi is loaded LAZILY (require inside init, not a top-level import) so that
// importing this module on macOS/Linux never touches koffi or loads user32.dll —
// and koffi can be excluded from the non-Windows builds entirely.

import { screen } from 'electron'

/** A window's on-screen rectangle in DIP (Electron) coordinates, z-order topmost-first. */
export interface WinRect { x: number; y: number; w: number; h: number }

let selfHandle = 0n
let acc: WinRect[] = []
let run: (() => WinRect[]) | null = null
let initTried = false

/** Build the Win32/koffi bindings on first use. Returns false (fail-soft) if the
 *  FFI isn't available (any non-Windows platform, or a load error). */
function init(): boolean {
  if (run) return true
  if (initTried) return false
  initTried = true
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const koffi = require('koffi') as typeof import('koffi')
    const user32 = koffi.load('user32.dll')
    const dwmapi = koffi.load('dwmapi.dll')
    koffi.struct('RECT', { left: 'long', top: 'long', right: 'long', bottom: 'long' })
    const EnumWindows = user32.func('bool __stdcall EnumWindows(void* lpEnumFunc, intptr lParam)')
    const GetWindowRect = user32.func('bool __stdcall GetWindowRect(void* hWnd, _Out_ RECT* lpRect)')
    const IsWindowVisible = user32.func('bool __stdcall IsWindowVisible(void* hWnd)')
    const IsIconic = user32.func('bool __stdcall IsIconic(void* hWnd)')
    const GetWindowLongPtrW = user32.func('intptr __stdcall GetWindowLongPtrW(void* hWnd, int nIndex)')
    const DwmGetWindowAttribute = dwmapi.func('int __stdcall DwmGetWindowAttribute(void* hWnd, uint32 dwAttribute, _Out_ void* pvAttribute, uint32 cbAttribute)')
    const WNDENUMPROC = koffi.proto('bool __stdcall WNDENUMPROC(void* hwnd, intptr lParam)')
    const GWL_EXSTYLE = -20, WS_EX_TOOLWINDOW = 0x80, DWMWA_CLOAKED = 14

    // One persistent native callback that collects visible, real, top-level windows.
    const enumProc = koffi.register((hwnd: unknown, _lparam: unknown): boolean => {
      try {
        if (BigInt(koffi.address(hwnd) as number | bigint) === selfHandle) return true
        if (!IsWindowVisible(hwnd) || IsIconic(hwnd)) return true
        // UWP/store apps stay "visible" while cloaked (off-screen) — skip those.
        const cloak = Buffer.alloc(4)
        if (DwmGetWindowAttribute(hwnd, DWMWA_CLOAKED, cloak, 4) === 0 && cloak.readUInt32LE(0) !== 0) return true
        if (Number(GetWindowLongPtrW(hwnd, GWL_EXSTYLE)) & WS_EX_TOOLWINDOW) return true
        const r = { left: 0, top: 0, right: 0, bottom: 0 }
        if (!GetWindowRect(hwnd, r)) return true
        const w = r.right - r.left, h = r.bottom - r.top
        if (w < 120 || h < 60) return true // ignore slivers
        const dip = screen.screenToDipRect(null, { x: r.left, y: r.top, width: w, height: h })
        acc.push({ x: dip.x, y: dip.y, w: dip.width, h: dip.height })
      } catch { /* a window can vanish mid-enum; ignore it */ }
      return true
    }, koffi.pointer(WNDENUMPROC))

    run = (): WinRect[] => { acc = []; EnumWindows(enumProc, 0); return acc }
    return true
  } catch (e) {
    console.error('[desktop] Win32 window enumeration unavailable', e)
    return false
  }
}

/** Remember our own pet window so we never treat it as a platform. */
export function setSelfWindow(handleBuf: Buffer): void {
  selfHandle = handleBuf.length >= 8 ? handleBuf.readBigUInt64LE(0) : BigInt(handleBuf.readUInt32LE(0))
}

/** Snapshot of visible top-level windows, topmost-first, in DIP coords (empty off-Windows). */
export function enumWindows(): WinRect[] {
  return init() ? run!() : []
}
