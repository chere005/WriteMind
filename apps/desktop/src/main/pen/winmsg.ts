/**
 * winmsg.ts - a message-only window whose WNDPROC is a koffi callback (docs/spikes/DESIGN-pen-capture.md 12.1).
 *
 * Used by the Wintab backend (the context's owner window: WT_PACKET / WT_PROXIMITY arrive here). A message-only window
 * (HWND_MESSAGE parent) has no taskbar button, no z-order and is never visible; Electron's main thread pumps its
 * messages because Chromium owns the thread's loop.
 *
 * The WNDPROC handler is tiny: it calls `onMessage` inside try/catch (a bug in a handler must not break the thread's
 * message loop, and an exception thrown through a native callback would be worse) and ALWAYS calls DefWindowProcW,
 * which WM_INPUT in particular needs so the system can free the input.
 *
 * koffi names are `WMP_` prefixed and declared once per process.
 */

import { bind, isWin32, loadWin32, registerRelease, type Koffi } from "./win32"
import type * as KoffiNS from "koffi"

export type MessageHandler = (msg: number, wParam: bigint, lParam: bigint) => void

export interface MessageWindow {
  readonly hwnd: bigint
  readonly alive: boolean
  post(msg: number, wParam?: bigint, lParam?: bigint): boolean
  /** Destroy the window, unregister its class and its callback. Synchronous and idempotent. */
  destroy(): void
}

interface WinMsgApi {
  koffi: Koffi
  wndProcType: KoffiNS.TypeObject
  defWindowProc: (hwnd: number | bigint, msg: number, wp: number | bigint, lp: number | bigint) => number | bigint
  registerClass: (wc: Record<string, unknown>) => number
  unregisterClass: (name: string, inst: unknown) => boolean
  createWindow: (ex: number, cls: string, name: string, style: number, x: number, y: number, w: number, h: number, parent: number, menu: number, inst: unknown, param: null) => number | bigint
  destroyWindow: (hwnd: number | bigint) => boolean
  postMessage: (hwnd: number | bigint, msg: number, wp: bigint, lp: bigint) => boolean
  getModuleHandle: (name: null) => unknown
  lastError: () => number
}

let api: WinMsgApi | { error: string } | null = null

function loadApi(): WinMsgApi | { error: string } {
  if (api) return api
  const w = loadWin32()
  if (!isWin32(w)) return (api = { error: w.error })
  try {
    const { koffi, user32, kernel32 } = w
    koffi.struct("WMP_WNDCLASSEXW", {
      cbSize: "uint32", style: "uint32", lpfnWndProc: "void *", cbClsExtra: "int32", cbWndExtra: "int32",
      hInstance: "void *", hIcon: "void *", hCursor: "void *", hbrBackground: "void *",
      lpszMenuName: "const char16_t *", lpszClassName: "const char16_t *", hIconSm: "void *",
    })
    const wndProcType = koffi.proto("intptr_t WMP_WNDPROC(uintptr_t hwnd, uint32 msg, uintptr_t wp, intptr_t lp)")
    return (api = {
      koffi, wndProcType,
      defWindowProc: bind(user32, "intptr_t DefWindowProcW(uintptr_t hwnd, uint32 msg, uintptr_t wp, intptr_t lp)"),
      registerClass: bind(user32, "uint16 RegisterClassExW(WMP_WNDCLASSEXW *wc)"),
      unregisterClass: bind(user32, "bool UnregisterClassW(const char16_t *name, void *hInst)"),
      createWindow: bind(user32, "uintptr_t CreateWindowExW(uint32 ex, const char16_t *cls, const char16_t *name, uint32 style, int x, int y, int w, int h, intptr_t parent, intptr_t menu, void *inst, void *param)"),
      destroyWindow: bind(user32, "bool DestroyWindow(uintptr_t hwnd)"),
      postMessage: bind(user32, "bool PostMessageW(uintptr_t hwnd, uint32 msg, uintptr_t wp, intptr_t lp)"),
      getModuleHandle: bind(kernel32, "void *GetModuleHandleW(const char16_t *name)"),
      lastError: w.lastError,
    })
  } catch (e) {
    return (api = { error: `window API did not load: ${e instanceof Error ? e.message : String(e)}` })
  }
}

const live = new Set<MessageWindow>()
let classCounter = 0
let releaseHooked = false

/** Create a message-only window. Throws an Error with a plain reason when it cannot (callers turn that into a status). */
export function createMessageWindow(onMessage: MessageHandler, label = "pen"): MessageWindow {
  const A = loadApi()
  if ("error" in A) throw new Error(A.error)
  if (!releaseHooked) { releaseHooked = true; registerRelease(destroyAllMessageWindows) }
  const { koffi } = A
  const className = `WriteMind${label}${process.pid}_${++classCounter}`
  const inst = A.getModuleHandle(null)
  const proc = koffi.register((hwnd: number | bigint, msg: number, wp: number | bigint, lp: number | bigint): number | bigint => {
    try { onMessage(msg, BigInt(wp), BigInt(lp)) } catch { /* see the header */ }
    return A.defWindowProc(hwnd, msg, wp, lp)
  }, koffi.pointer(A.wndProcType))
  const atom = A.registerClass({
    cbSize: 80, style: 0, lpfnWndProc: proc, cbClsExtra: 0, cbWndExtra: 0, hInstance: inst,
    hIcon: null, hCursor: null, hbrBackground: null, lpszMenuName: null, lpszClassName: className, hIconSm: null,
  })
  if (!atom) { const e = A.lastError(); koffi.unregister(proc); throw new Error(`RegisterClassExW failed (GetLastError ${e})`) }
  const HWND_MESSAGE = -3
  const hwnd = BigInt(A.createWindow(0, className, `WriteMind ${label}`, 0, 0, 0, 0, 0, HWND_MESSAGE, 0, inst, null))
  if (hwnd === 0n) {
    const e = A.lastError()
    try { A.unregisterClass(className, inst) } catch { /* nothing to undo */ }
    koffi.unregister(proc)
    throw new Error(`CreateWindowExW failed (GetLastError ${e})`)
  }
  let alive = true
  const win: MessageWindow = {
    hwnd,
    get alive() { return alive },
    post: (msg, wp = 0n, lp = 0n) => (alive ? A.postMessage(hwnd, msg, wp, lp) : false),
    destroy() {
      if (!alive) return
      alive = false
      live.delete(win)
      try { A.destroyWindow(hwnd) } catch { /* already gone */ }
      try { A.unregisterClass(className, inst) } catch { /* still in use: the OS drops it at exit */ }
      try { koffi.unregister(proc) } catch { /* already */ }
    },
  }
  live.add(win)
  return win
}

/** Destroy every window this process made. Safe to call any number of times. */
export function destroyAllMessageWindows(): void {
  for (const w of [...live]) w.destroy()
}

export const messageWindowCount = (): number => live.size
