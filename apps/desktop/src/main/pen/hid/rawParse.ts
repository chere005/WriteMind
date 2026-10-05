/**
 * hid/rawParse.ts - pure parsing of a RAWINPUT block (what GetRawInputData(RID_INPUT) returns), 64-bit layout:
 * RAWINPUTHEADER is 24 bytes (dwType, dwSize, hDevice, wParam), followed by RAWMOUSE (24 bytes), RAWKEYBOARD (16) or
 * RAWHID (dwSizeHid, dwCount, bRawData[dwSizeHid * dwCount]).
 *
 * A single WM_INPUT for an HID device can carry SEVERAL reports back to back (dwCount > 1): hardware reporting faster than
 * the app drains messages. Every one must be decoded, in order, or strokes lose points. The parser trusts neither
 * dwCount nor dwSizeHid beyond what the buffer holds.
 */

export const RIM_TYPEMOUSE = 0
export const RIM_TYPEKEYBOARD = 1
export const RIM_TYPEHID = 2
export const RAW_HEADER_SIZE = 24

export interface RawMouse { flags: number; buttonFlags: number; buttonData: number; lastX: number; lastY: number; extra: number }

export type RawInput =
  | { type: 0; device: bigint; size: number; mouse: RawMouse }
  | { type: 1; device: bigint; size: number }
  | { type: 2; device: bigint; size: number; sizeHid: number; count: number; reports: Uint8Array[] }

/** MOUSE_MOVE_ABSOLUTE in RAWMOUSE.usFlags: tablets / pens / injected pointers report absolute positions, ordinary mice relative. */
export const MOUSE_MOVE_ABSOLUTE = 0x01

export function parseRawInput(buf: Uint8Array): RawInput | null {
  if (buf.length < RAW_HEADER_SIZE) return null
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength)
  const type = dv.getUint32(0, true)
  const size = dv.getUint32(4, true)
  const device = dv.getBigUint64(8, true)
  if (type === RIM_TYPEMOUSE) {
    if (buf.length < RAW_HEADER_SIZE + 24) return null
    const o = RAW_HEADER_SIZE
    return {
      type: 0, device, size,
      mouse: {
        flags: dv.getUint16(o, true),
        buttonFlags: dv.getUint16(o + 4, true),
        buttonData: dv.getUint16(o + 6, true),
        lastX: dv.getInt32(o + 12, true),
        lastY: dv.getInt32(o + 16, true),
        extra: dv.getUint32(o + 20, true),
      },
    }
  }
  if (type === RIM_TYPEKEYBOARD) return { type: 1, device, size }
  if (type !== RIM_TYPEHID) return null
  if (buf.length < RAW_HEADER_SIZE + 8) return null
  const sizeHid = dv.getUint32(RAW_HEADER_SIZE, true)
  const count = dv.getUint32(RAW_HEADER_SIZE + 4, true)
  const reports: Uint8Array[] = []
  const base = RAW_HEADER_SIZE + 8
  if (sizeHid > 0) {
    for (let i = 0; i < count; i++) {
      const start = base + i * sizeHid
      if (start + sizeHid > buf.length) break
      reports.push(buf.subarray(start, start + sizeHid))
    }
  }
  return { type: 2, device, size, sizeHid, count, reports }
}

/** Build a RAWINPUT block for an HID device (tests, synthetic traces). */
export function buildRawHid(device: bigint, reports: Uint8Array[]): Uint8Array {
  const sizeHid = reports[0]?.length ?? 0
  const total = RAW_HEADER_SIZE + 8 + sizeHid * reports.length
  const out = new Uint8Array(total)
  const dv = new DataView(out.buffer)
  dv.setUint32(0, RIM_TYPEHID, true)
  dv.setUint32(4, total, true)
  dv.setBigUint64(8, device, true)
  dv.setUint32(RAW_HEADER_SIZE, sizeHid, true)
  dv.setUint32(RAW_HEADER_SIZE + 4, reports.length, true)
  reports.forEach((r, i) => out.set(r, RAW_HEADER_SIZE + 8 + i * sizeHid))
  return out
}

export function buildRawMouse(device: bigint, lastX: number, lastY: number, flags = 0, buttonFlags = 0): Uint8Array {
  const out = new Uint8Array(RAW_HEADER_SIZE + 24)
  const dv = new DataView(out.buffer)
  dv.setUint32(0, RIM_TYPEMOUSE, true)
  dv.setUint32(4, out.length, true)
  dv.setBigUint64(8, device, true)
  dv.setUint16(RAW_HEADER_SIZE, flags, true)
  dv.setUint16(RAW_HEADER_SIZE + 4, buttonFlags, true)
  dv.setInt32(RAW_HEADER_SIZE + 12, lastX, true)
  dv.setInt32(RAW_HEADER_SIZE + 16, lastY, true)
  return out
}
