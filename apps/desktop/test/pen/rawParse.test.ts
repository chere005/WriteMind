// hid/rawParse.ts: the RAWINPUT block that GetRawInputData returns (64-bit layout), built synthetically. Ported from the Raw Input spike's
// decoder.test.ts (the parsing half). dwCount > 1 is the case that loses strokes when it is forgotten.
import { describe, expect, it } from "vitest"
import {
  MOUSE_MOVE_ABSOLUTE, RAW_HEADER_SIZE, RIM_TYPEHID, RIM_TYPEKEYBOARD, RIM_TYPEMOUSE, buildRawHid, buildRawMouse, parseRawInput,
} from "../../src/main/pen/hid/rawParse"

const report = (id: number, ...rest: number[]): Uint8Array => Uint8Array.from([id, ...rest])

describe("HID blocks", () => {
  it("parses one report: header, sizeHid, count, the bytes", () => {
    const block = buildRawHid(0x1234n, [report(213, 1, 2, 3, 4)])
    const raw = parseRawInput(block)
    expect(raw).toMatchObject({ type: RIM_TYPEHID, device: 0x1234n, sizeHid: 5, count: 1 })
    expect(raw && raw.type === 2 && raw.reports.map((r) => [...r])).toEqual([[213, 1, 2, 3, 4]])
  })
  it("parses dwCount > 1: every report, in order (hardware reporting faster than messages are drained)", () => {
    const reps = [report(209, 1), report(209, 2), report(209, 3), report(209, 4)]
    const raw = parseRawInput(buildRawHid(7n, reps))
    expect(raw && raw.type === 2 && raw.count).toBe(4)
    expect(raw && raw.type === 2 && raw.reports.map((r) => r[1])).toEqual([1, 2, 3, 4])
  })
  it("does not trust dwCount beyond what the buffer holds (a short buffer yields the whole reports it has)", () => {
    const block = buildRawHid(7n, [report(209, 1, 1), report(209, 2, 2), report(209, 3, 3)])
    const dv = new DataView(block.buffer)
    dv.setUint32(RAW_HEADER_SIZE + 4, 1000, true) // a lying dwCount
    const raw = parseRawInput(block)
    expect(raw && raw.type === 2 && raw.reports).toHaveLength(3)
    const cut = block.subarray(0, block.length - 2) // the last report is incomplete
    const raw2 = parseRawInput(cut)
    expect(raw2 && raw2.type === 2 && raw2.reports).toHaveLength(2)
  })
  it("a zero sizeHid yields no reports instead of looping", () => {
    const block = buildRawHid(7n, [report(1)])
    new DataView(block.buffer).setUint32(RAW_HEADER_SIZE, 0, true)
    const raw = parseRawInput(block)
    expect(raw && raw.type === 2 && raw.reports).toEqual([])
  })
  it("reports are views into the block (no copy per report) of the right length", () => {
    const raw = parseRawInput(buildRawHid(1n, [report(1, 9, 9), report(1, 8, 8)]))
    expect(raw && raw.type === 2 && raw.reports.every((r) => r.length === 3)).toBe(true)
  })
  it("a block shorter than the header, or than the HID sub-header, is not a block", () => {
    expect(parseRawInput(new Uint8Array(10))).toBeNull()
    const block = buildRawHid(1n, [report(1)])
    expect(parseRawInput(block.subarray(0, RAW_HEADER_SIZE + 4))).toBeNull()
  })
  it("an unknown type is not a block", () => {
    const block = buildRawHid(1n, [report(1)])
    new DataView(block.buffer).setUint32(0, 9, true)
    expect(parseRawInput(block)).toBeNull()
  })
  it("reads a 64-bit device handle", () => {
    const h = 0x1_0000_0001n
    expect(parseRawInput(buildRawHid(h, [report(1)]))?.device).toBe(h)
  })
})

describe("mouse blocks (the pointer node's absolute / relative judgement)", () => {
  it("reads flags, buttons, the deltas and the extra info", () => {
    const raw = parseRawInput(buildRawMouse(5n, 120, -30, MOUSE_MOVE_ABSOLUTE, 0x1))
    expect(raw).toMatchObject({ type: RIM_TYPEMOUSE, device: 5n })
    expect(raw && raw.type === 0 && raw.mouse).toMatchObject({ flags: MOUSE_MOVE_ABSOLUTE, buttonFlags: 1, lastX: 120, lastY: -30 })
  })
  it("a relative mouse has no absolute flag", () => {
    const raw = parseRawInput(buildRawMouse(5n, 1, 1))
    expect(raw && raw.type === 0 && (raw.mouse.flags & MOUSE_MOVE_ABSOLUTE)).toBe(0)
  })
  it("a truncated mouse block is not a block", () => {
    expect(parseRawInput(buildRawMouse(5n, 1, 1).subarray(0, RAW_HEADER_SIZE + 10))).toBeNull()
  })
})

describe("keyboard blocks", () => {
  it("are recognised and carry no payload we read", () => {
    const b = new Uint8Array(RAW_HEADER_SIZE + 16)
    const dv = new DataView(b.buffer)
    dv.setUint32(0, RIM_TYPEKEYBOARD, true)
    dv.setUint32(4, b.length, true)
    expect(parseRawInput(b)).toMatchObject({ type: 1 })
  })
})
