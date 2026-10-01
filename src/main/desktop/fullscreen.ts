// "Is the user in a game or a presentation right now?" — so the pet can get out
// of the way. Windows already answers this for its own notifications:
// SHQueryUserNotificationState says when a full-screen app, a Direct3D
// exclusive-mode game, or presentation mode is up. Asking the shell the same
// question it asks itself beats guessing from window rectangles, which can't
// tell a borderless game from a maximized editor.
//
// Windows-only, and koffi is loaded lazily for the same reason as windows.ts:
// importing this on macOS/Linux must never touch koffi.

// QUERY_USER_NOTIFICATION_STATE values that mean "don't intrude".
const QUNS_BUSY = 2 // a full-screen app (borderless games, F11 video, …)
const QUNS_RUNNING_D3D_FULL_SCREEN = 3 // exclusive-mode Direct3D
const QUNS_PRESENTATION_MODE = 4 // PowerPoint slideshow / presentation settings
const QUNS_APP = 7 // a full-screen Store app
const INTRUSIVE = new Set([QUNS_BUSY, QUNS_RUNNING_D3D_FULL_SCREEN, QUNS_PRESENTATION_MODE, QUNS_APP])

type QueryFn = (out: number[]) => number
let query: QueryFn | null = null
let initTried = false

function init(): boolean {
  if (query) return true
  if (initTried) return false
  initTried = true
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const koffi = require('koffi') as typeof import('koffi')
    const shell32 = koffi.load('shell32.dll')
    query = shell32.func('long __stdcall SHQueryUserNotificationState(_Out_ int* pquns)') as unknown as QueryFn
    return true
  } catch (e) {
    console.error('[fullscreen] SHQueryUserNotificationState unavailable', e)
    return false
  }
}

/** True while a full-screen app, game, or presentation has the screen. */
export function somethingIsFullscreen(): boolean {
  if (process.platform !== 'win32' || !init() || !query) return false
  const out = [0]
  try {
    if (query(out) !== 0) return false // S_OK only; anything else, don't hide on a guess
  } catch {
    return false
  }
  return INTRUSIVE.has(out[0])
}
