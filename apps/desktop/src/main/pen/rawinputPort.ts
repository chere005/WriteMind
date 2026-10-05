/**
 * main/pen/rawinputPort.ts - the OS half of the Raw Input backend (docs/spikes/DESIGN-pen-capture.md 4.3, owner IMPL-A).
 *
 * `RawInputPort` is everything rawinputBackend.ts needs from Windows, as plain functions, so the backend's state machine is tested
 * with a fake port and synthetic WM_INPUT blocks while this file is the only one that touches koffi (through hid/rawNative.ts,
 * hid/hidNative.ts and winmsg.ts). Nothing here throws except FfiOverrun (a canary broke: fatal for the backend).
 */

import type { EnvSummary } from "../../shared/pen"
import { layoutFromProbe } from "./hid/fromHidP"
import type { HidLayout } from "./hid/layout"
import {
  describeRawDevice, getPreparsed, listRawDevices, probeLayout, readCaps, type ProbeNote, type RawDevice,
} from "./hid/hidNative"
import { readRawInput, registerRawInput, unregisterRawInput } from "./hid/rawNative"
import { createMessageWindow } from "./winmsg"
import { isWin32, loadWin32, nativeBlockedReason, systemFileExists } from "./win32"

export type { RawDevice }

export interface RawUsage { usagePage: number; usage: number; flags: number }

export interface ProbedDevice {
  layout: HidLayout
  /** Notes from the layout probe ("min == max, cannot locate"...): traced, never fatal. */
  notes: string[]
  inputReportByteLength: number
}

export interface RawInputPort {
  available(): { ok: true } | { ok: false; reason: string }
  createWindow(onMessage: (msg: number, wParam: bigint, lParam: bigint) => void): { hwnd: bigint; destroy(): void }
  register(usages: readonly RawUsage[], hwnd: bigint): { ok: boolean; error: number }
  unregister(usages: readonly { usagePage: number; usage: number }[]): void
  /** The RAWINPUT block behind a WM_INPUT lParam. Must be called inside the window procedure. Throws FfiOverrun. */
  read(lParam: bigint): Uint8Array | null
  listDevices(): RawDevice[]
  describe(handle: bigint, type: 0 | 1 | 2): RawDevice
  /** Windows' own HID parser's view of a device: the neutral layout, or null when it has no preparsed data. Throws on a parser failure. */
  probe(handle: bigint): ProbedDevice | null
  screenSize(): { width: number; height: number }
}

export function realRawInputPort(): RawInputPort {
  return {
    available() {
      const blocked = nativeBlockedReason()
      if (blocked) return { ok: false, reason: blocked }
      if (!systemFileExists("hid.dll")) return { ok: false, reason: "hid.dll not found" }
      const w = loadWin32()
      return isWin32(w) ? { ok: true } : { ok: false, reason: w.error }
    },
    createWindow: (onMessage) => {
      const win = createMessageWindow(onMessage, "rawinput")
      return { hwnd: win.hwnd, destroy: () => win.destroy() }
    },
    register: (usages, hwnd) => registerRawInput(usages.map((u) => ({ usagePage: u.usagePage, usage: u.usage, flags: u.flags, hwnd }))),
    unregister: (usages) => { unregisterRawInput(usages.map((u) => ({ usagePage: u.usagePage, usage: u.usage }))) },
    read: (lParam) => readRawInput(lParam),
    listDevices: () => listRawDevices(),
    describe: (handle, type) => describeRawDevice(handle, type),
    probe(handle) {
      const pp = getPreparsed(handle)
      if (!pp) return null
      const caps = readCaps(pp)
      const notes: ProbeNote[] = []
      const probe = probeLayout(pp, caps, notes)
      return {
        layout: layoutFromProbe(probe),
        notes: notes.map((n) => `${n.usage}: ${n.note}`),
        inputReportByteLength: caps.inputReportByteLength,
      }
    },
    screenSize() {
      const w = loadWin32()
      return isWin32(w) ? w.screenSize() : { width: 1920, height: 1080 }
    },
  }
}

/**
 * The Raw Input devices on the digitizer page or from Wacom (name, vid, pid, usage page / usage, kind), for `EnvDeps.rawDevices`.
 * Read-only: one GetRawInputDeviceList and a few GetRawInputDeviceInfo calls, no registration. Empty under E2E or when anything fails.
 */
export function rawDeviceList(): EnvSummary["rawDevices"] {
  try {
    if (nativeBlockedReason()) return []
    return listRawDevices()
      .filter((d) => d.usagePage === 0x0d || d.vendorId === 0x056a || /VID_056A/i.test(d.name))
      .map((d) => ({
        name: d.name, vid: d.vendorId, pid: d.productId, usagePage: d.usagePage, usage: d.usage,
        kind: d.type === 0 ? "mouse" : d.type === 1 ? "keyboard" : "hid",
      }))
  } catch {
    return []
  }
}
