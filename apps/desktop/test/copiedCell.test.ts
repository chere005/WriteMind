// Port-only: no XCTest. COPY CELL, the page's side (renderer/copiedCell.ts, dock.ts `inkCellForNewInk`): what the clipboard's
// custom type carries, what a paste reads back (untrusted), and that the cell it makes is the one Bring in as Drawing Cell
// docks. The shell's side is in copyCell.test.ts.
import { describe, expect, it } from "vitest"
import { noTransform, wolframInkSvg, type CanvasItem, type Rect } from "@writemind/core"
import { DRAWING_MIME, takesPastedPicture } from "@writemind/editor"
import { cellOfCopied, copiedCellForShell, copiedCellOf, encodeCopiedCell, readCopiedCell, rememberCopiedCell } from "../src/renderer/copiedCell"
import { inkCellForNewInk } from "../src/renderer/dock"

const PANE = { width: 800, height: 600 }
const FRAME: Rect = { x: 0.1, y: 0.1, width: 0.5, height: 0.3 }

const stroke = (id: string, x: number, y: number, w = 0.1, h = 0.05): CanvasItem => ({
  kind: "stroke",
  stroke: {
    id, colorHex: "#1D2B3A", width: 2, points: [{ x, y }, { x: x + w, y: y + h }, { x: x + w / 2, y: y + h }],
    pressures: [0.3, 0.6, 0.4], transform: noTransform(), group: null,
  },
})
const STROKES = [stroke("a", 0.2, 0.15), stroke("b", 0.35, 0.2)]

describe("the custom clipboard type", () => {
  it("has its own name, and a paste carrying it is never also a picture", () => {
    expect(DRAWING_MIME).toBe("application/x-writemind-drawing")
    expect(takesPastedPicture(["text/plain", DRAWING_MIME, "Files", "image/svg+xml"])).toBe(false)
    expect(takesPastedPicture(["Files", "image/png"])).toBe(true)
  })

  it("carries the strokes, the box and the pane, and reads back as it was", () => {
    const back = readCopiedCell(encodeCopiedCell({ strokes: STROKES, frame: FRAME, pane: PANE }))
    expect(back).toEqual({ strokes: STROKES, frame: FRAME, pane: PANE })
    expect(readCopiedCell(encodeCopiedCell({ strokes: STROKES, frame: null, pane: PANE }))?.frame).toBeNull()
  })

  it("reads only what is a copied cell: nothing else from a clipboard is pasted", () => {
    const good = { strokes: STROKES, frame: FRAME, pane: PANE }
    const bad: unknown[] = [
      "not json{", "null", "3", "[]", {}, { ...good, strokes: [] }, { ...good, strokes: "x" }, { ...good, pane: null },
      { ...good, pane: { width: 0, height: 600 } }, { ...good, pane: { width: "800", height: 600 } },
      { ...good, frame: { x: 0, y: 0, width: "1", height: 1 } },
      { ...good, strokes: [{ kind: "image", image: {} }] },
      { ...good, strokes: [{ kind: "stroke", stroke: { id: "a", colorHex: "#000", width: 2, points: [{ x: 0, y: NaN }], transform: {} } }] },
      { ...good, strokes: [{ kind: "stroke", stroke: { id: "a", colorHex: "#000", width: 2, points: [], transform: {} } }] },
      { ...good, strokes: [{ kind: "stroke", stroke: { id: 7, colorHex: "#000", width: 2, points: [{ x: 0, y: 0 }], transform: {} } }] },
    ]
    for (const one of bad) expect(readCopiedCell(typeof one === "string" ? one : JSON.stringify(one)), JSON.stringify(one)?.slice(0, 70)).toBeNull()
    // (a stroke's JSON cannot hold NaN: it travels as null, which is not a number either)
    expect(readCopiedCell(JSON.stringify({ ...good, strokes: [{ kind: "stroke", stroke: { ...(STROKES[0] as { stroke: object }).stroke, points: [{ x: 0, y: null }] } }] }))).toBeNull()
  })

  it("refuses more points than a page of handwriting could hold", () => {
    const many = { kind: "stroke", stroke: { id: "a", colorHex: "#000", width: 2, transform: noTransform(), group: null,
      points: Array.from({ length: 200_001 }, () => ({ x: 0.5, y: 0.5 })) } }
    expect(readCopiedCell(JSON.stringify({ strokes: [many], frame: null, pane: PANE }))).toBeNull()
  })
})

describe("the cell a copy is", () => {
  it("is the cell Bring in as Drawing Cell docks: the box is the cell, the ink where it sat in it", () => {
    const copied = readCopiedCell(encodeCopiedCell({ strokes: STROKES, frame: FRAME, pane: PANE }))!
    const cell = cellOfCopied(copied, 700)!
    const docked = inkCellForNewInk(STROKES, PANE, { left: 0, width: 700 }, FRAME)!
    expect({ ...cell, id: "" }).toEqual({ ...docked, id: "" })
    // The box, not the ink, is the cell: as tall as the box at the ink's scale (0.3 of 600 = 180 px of 800 px wide, shown 700).
    expect(cell.aspect).toBeGreaterThan(0)
  })

  it("without a box falls back to the ink's own extent, and with no strokes there is none", () => {
    const cell = inkCellForNewInk(STROKES, PANE, { left: 0, width: 700 }, null)!
    expect(cell.items.length).toBe(2)
    expect(inkCellForNewInk([], PANE, { left: 0, width: 700 })).toBeNull()
    expect(inkCellForNewInk(STROKES, PANE, { left: 0, width: 0 })).toBeNull()
  })

  it("goes to the shell as one drawing line, with a TRANSPARENT svg that is also its plain text", () => {
    const cell = cellOfCopied({ strokes: STROKES, frame: FRAME, pane: PANE }, 700)!
    const shell = copiedCellForShell(cell, 700, 0, null)
    expect(shell.cell).toBe(true)
    expect(shell.markdown).toBe(`![ink](snapshots/ink-${cell.id}.svg)`)
    expect(Object.keys(shell.media.inks)).toEqual([cell.id])
    expect(shell.media.bands).toEqual([])
    const svg = shell.media.inks[cell.id]!.svg
    expect(svg.startsWith("<svg xmlns=")).toBe(true)
    expect(shell.plain).toBe(svg)
    // No white page under the ink (the same cell not copied has one).
    expect(wolframInkSvg(cell, 700).svg).toContain("#FFFFFF")
    expect(svg).not.toContain("#FFFFFF")
  })
})

describe("which paste is WriteMind's own copied cell (copiedCellOf)", () => {
  const SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="40"/>`
  const JSON_ = `{"strokes":[]}`
  const paste = (types: Record<string, string>, files: { name: string; size: number }[] = []) =>
    ({ getData: (type: string) => types[type] ?? "", files })

  it("knows its custom type", () => {
    expect(copiedCellOf(paste({ [DRAWING_MIME]: JSON_ }))).toBe(JSON_)
    expect(copiedCellOf(paste({ "text/plain": "words" }))).toBeNull()
  })

  it("knows its own file where a paste carrying a file shows nothing but the file (a Mac): by name and size, once copied", () => {
    const own = { name: "Drawing.svg", size: new TextEncoder().encode(SVG).length }
    expect(copiedCellOf(paste({}, [own]))).toBeNull()      // nothing copied yet in this window
    rememberCopiedCell(JSON_, SVG)
    expect(copiedCellOf(paste({}, [own]))).toBe(JSON_)
    // Anybody else's file, a file of another size, several files, and no file at all are ordinary pastes.
    expect(copiedCellOf(paste({}, [{ name: "Drawing.svg", size: own.size + 1 }]))).toBeNull()
    expect(copiedCellOf(paste({}, [{ name: "Other.svg", size: own.size }]))).toBeNull()
    expect(copiedCellOf(paste({}, [own, own]))).toBeNull()
    expect(copiedCellOf(paste({}, []))).toBeNull()
  })
})
