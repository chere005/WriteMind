/**
 * hid/rawNative.ts - Raw Input registration and reading through koffi (Windows only).
 *
 * The only OS state this file creates is a RegisterRawInputDevices registration; `unregisterRawInput` removes it
 * (RIDEV_REMOVE) and Windows drops it by itself when the process ends (measured: a killed process left nothing behind).
 * Registrations are made WITHOUT the no-legacy flag, always: that flag is rejected for the pen usage and would stop the mouse
 * for the mouse usage (both measured), so it is neither declared nor used here.
 *
 * Nothing throws out of the read path: `readRawInput` answers null when Windows refuses. The one exception is FfiOverrun (the call wrote
 * past the size Windows itself reported): that is fatal for the backend and propagates (design 4.2 "FFI safety").
 *
 * GetRawInputData is the one native call that HAS to run inside the window procedure: the HRAWINPUT of a WM_INPUT is only valid until
 * DefWindowProc has seen the message. Everything after the read (parsing, decoding, tracing) is done by the caller outside the callback.
 */

import { bind, canaryBuffer, FfiOverrun, isWin32, loadWin32, registerRelease } from "../win32"

export const WM_INPUT = 0x00ff
export const WM_INPUT_DEVICE_CHANGE = 0x00fe
export const GIDC_ARRIVAL = 1
export const GIDC_REMOVAL = 2
export const RID_INPUT = 0x10000003

export const RIDEV_REMOVE = 0x00000001
export const RIDEV_PAGEONLY = 0x00000020
export const RIDEV_INPUTSINK = 0x00000100
export const RIDEV_DEVNOTIFY = 0x00002000

export interface RawDeviceReg {
  usagePage: number
  usage: number
  flags: number
  /** HWND; 0n for RIDEV_REMOVE. */
  hwnd: bigint
}

export interface RegisterResult { ok: boolean; error: number }

interface RawApi {
  RegisterRawInputDevices: (devs: Buffer, n: number, cb: number) => boolean
  GetRegisteredRawInputDevices: (devs: Buffer | null, n: number[], cb: number) => number
  GetRawInputData: (h: bigint, cmd: number, data: Buffer | null, cb: number[], cbHeader: number) => number
  lastError: () => number
}

let api: RawApi | { error: string } | null = null

function load(): RawApi | { error: string } {
  if (api) return api
  const w = loadWin32()
  if (!isWin32(w)) return (api = { error: w.error })
  try {
    return (api = {
      RegisterRawInputDevices: bind(w.user32, "bool RegisterRawInputDevices(void *devs, uint32 n, uint32 cb)"),
      GetRegisteredRawInputDevices: bind(w.user32, "uint32 GetRegisteredRawInputDevices(void *devs, _Inout_ uint32 *n, uint32 cb)"),
      GetRawInputData: bind(w.user32, "uint32 GetRawInputData(uintptr_t h, uint32 cmd, void *data, _Inout_ uint32 *cb, uint32 cbHeader)"),
      lastError: w.lastError,
    })
  } catch (e) {
    return (api = { error: `Raw Input API did not load: ${e instanceof Error ? e.message : String(e)}` })
  }
}

export function rawInputAvailable(): { ok: true } | { ok: false; reason: string } {
  const a = load()
  return "error" in a ? { ok: false, reason: a.error } : { ok: true }
}

function packDevices(devs: readonly RawDeviceReg[]): Buffer {
  const b = canaryBuffer(16 * devs.length).buf
  devs.forEach((d, i) => {
    b.writeUInt16LE(d.usagePage, i * 16)
    b.writeUInt16LE(d.usage, i * 16 + 2)
    b.writeUInt32LE(d.flags >>> 0, i * 16 + 4)
    b.writeBigUInt64LE(d.hwnd, i * 16 + 8)
  })
  return b
}

/** Every usage this process registered and has not removed yet (the exit releaser removes them). */
const registered = new Map<string, { usagePage: number; usage: number; pageOnly: boolean }>()
let releaseHooked = false

const regKey = (usagePage: number, usage: number): string => `${usagePage}/${usage}`

export function registerRawInput(devs: readonly RawDeviceReg[]): RegisterResult {
  const a = load()
  if ("error" in a) return { ok: false, error: -1 }
  try {
    const ok = a.RegisterRawInputDevices(packDevices(devs), devs.length, 16)
    if (ok) {
      if (!releaseHooked) { releaseHooked = true; registerRelease(unregisterAllRawInput) }
      for (const d of devs) {
        if (d.flags & RIDEV_REMOVE) registered.delete(regKey(d.usagePage, d.usage))
        else registered.set(regKey(d.usagePage, d.usage), { usagePage: d.usagePage, usage: d.usage, pageOnly: (d.flags & RIDEV_PAGEONLY) !== 0 })
      }
    }
    return { ok, error: ok ? 0 : a.lastError() }
  } catch {
    return { ok: false, error: -1 }
  }
}

/** Remove registrations (RIDEV_REMOVE with a NULL target). Never throws. */
export function unregisterRawInput(usages: readonly { usagePage: number; usage: number; pageOnly?: boolean }[]): RegisterResult {
  const a = load()
  if ("error" in a) return { ok: false, error: -1 }
  try {
    const devs = usages.map((u) => ({ usagePage: u.usagePage, usage: u.pageOnly ? 0 : u.usage, flags: RIDEV_REMOVE | (u.pageOnly ? RIDEV_PAGEONLY : 0), hwnd: 0n }))
    const ok = a.RegisterRawInputDevices(packDevices(devs), devs.length, 16)
    for (const u of usages) registered.delete(regKey(u.usagePage, u.usage))
    return { ok, error: ok ? 0 : a.lastError() }
  } catch {
    return { ok: false, error: -1 }
  }
}

/** Remove everything this process registered. */
export function unregisterAllRawInput(): void {
  if (!registered.size) return
  unregisterRawInput([...registered.values()])
}

export const ownRegistrations = (): number => registered.size

/** What Windows says this process has registered (GetRegisteredRawInputDevices): the release check of the real-OS test. */
export function registeredRawInput(): { usagePage: number; usage: number; flags: number; hwnd: bigint }[] {
  const a = load()
  if ("error" in a) return []
  try {
    const n = [0]
    a.GetRegisteredRawInputDevices(null, n, 16)
    if (!n[0]) return []
    const c = canaryBuffer(16 * n[0])
    const b = c.buf
    const got = a.GetRegisteredRawInputDevices(b, [n[0]], 16)
    c.check("GetRegisteredRawInputDevices")
    const out: { usagePage: number; usage: number; flags: number; hwnd: bigint }[] = []
    for (let i = 0; i < got && got !== 0xffffffff; i++) {
      out.push({ usagePage: b.readUInt16LE(i * 16), usage: b.readUInt16LE(i * 16 + 2), flags: b.readUInt32LE(i * 16 + 4), hwnd: b.readBigUInt64LE(i * 16 + 8) })
    }
    return out
  } catch {
    return []
  }
}

/**
 * GetRawInputData(RID_INPUT) for a WM_INPUT lParam. The size comes from Windows itself (a first call with a NULL buffer), the data goes
 * into a canary buffer of exactly that size, and the canary is checked after the call. Returns a COPY, or null if Windows refuses (handle already consumed, bogus lParam). Throws FfiOverrun when the canary is broken.
 */
export function readRawInput(hRawInput: bigint): Uint8Array | null {
  const a = load()
  if ("error" in a) return null
  try {
    const size = [0]
    a.GetRawInputData(hRawInput, RID_INPUT, null, size, 24)
    const need = size[0] ?? 0
    if (need < 24 || need > 1 << 20) return null
    // a fresh canary buffer per message: its canary sits exactly at the size Windows reported (a few hundred ns at 200 Hz)
    const c = canaryBuffer(need)
    const r = a.GetRawInputData(hRawInput, RID_INPUT, c.buf, [need], 24)
    c.check("GetRawInputData")
    if (r === 0xffffffff || r > need) return null
    return new Uint8Array(c.buf.subarray(0, r))
  } catch (e) {
    if (e instanceof FfiOverrun) throw e
    return null
  }
}
