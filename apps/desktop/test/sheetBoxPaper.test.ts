// The Tablet sheet's dashed box (mouse selects a section) and its paper (backgrounds). Port-only: the Mac's box is over the
// camera's picture (CameraZoom.swift `boxAction`, transcribed in packages/core), and the Mac has no paper chooser
// (its dotted notebook is the physical paper the camera recognises, NotebookCapture.swift).
import { describe, expect, it } from "vitest"
import { pressAction } from "../src/renderer/penButtons"
import {
  boxCorner, boxFromPoints, hitBox, moveBox, regionOfSheetBox, resizeBox, splitByRegion, type InkStroke,
} from "../src/renderer/tabletPage"
import {
  contrastRatio, DEFAULT_PAPER, DEFAULT_PEN_COLOUR, inkOn, paperMarks, PAPER_COLOURS, PAPER_KINDS, parsePaper, pitchOf,
  type Paper,
} from "../src/renderer/tabletPaper"

const SHEET = { width: 1000, height: 562.5 }
const shown = { width: 800, height: 450 }

describe("the dashed box: geometry", () => {
  const box = { x: 0.2, y: 0.2, width: 0.4, height: 0.3 }
  it("is made from two corners in any order", () => {
    expect(boxFromPoints({ x: 0.6, y: 0.5 }, { x: 0.2, y: 0.2 })).toEqual({ x: 0.2, y: 0.2, width: expect.closeTo(0.4, 9), height: expect.closeTo(0.3, 9) })
  })
  it("hit-tests a handle within the grab radius, then the inside, then nothing", () => {
    expect(hitBox(box, { x: 0.2, y: 0.2 }, shown)).toBe("nw")
    expect(hitBox(box, { x: 0.6 + 5 / 800, y: 0.5 }, shown)).toBe("se")
    expect(hitBox(box, { x: 0.6, y: 0.2 }, shown)).toBe("ne")
    expect(hitBox(box, { x: 0.2, y: 0.5 }, shown)).toBe("sw")
    expect(hitBox(box, { x: 0.4, y: 0.35 }, shown)).toBe("inside")
    expect(hitBox(box, { x: 0.9, y: 0.9 }, shown)).toBeNull()
    // Just past the grab radius from a corner, outside the box: nothing.
    expect(hitBox(box, { x: 0.2 - 30 / 800, y: 0.2 - 30 / 450 }, shown)).toBeNull()
  })
  it("moves by a drag and stays on the sheet", () => {
    expect(moveBox(box, 0.1, 0.1)).toEqual({ x: expect.closeTo(0.3, 9), y: expect.closeTo(0.3, 9), width: 0.4, height: 0.3 })
    expect(moveBox(box, 5, 5)).toEqual({ x: expect.closeTo(0.6, 9), y: expect.closeTo(0.7, 9), width: 0.4, height: 0.3 })
    expect(moveBox(box, -5, -5)).toEqual({ x: 0, y: 0, width: 0.4, height: 0.3 })
  })
  it("resizes from a corner with the opposite corner fixed", () => {
    const out = resizeBox(box, "se", { x: 0.8, y: 0.7 }, shown)
    expect(out.x).toBeCloseTo(0.2); expect(out.y).toBeCloseTo(0.2)
    expect(out.width).toBeCloseTo(0.6); expect(out.height).toBeCloseTo(0.5)
    const nw = resizeBox(box, "nw", { x: 0.1, y: 0.05 }, shown)
    expect(boxCorner(nw, "se").x).toBeCloseTo(0.6); expect(boxCorner(nw, "se").y).toBeCloseTo(0.5)
    expect(nw.x).toBeCloseTo(0.1); expect(nw.y).toBeCloseTo(0.05)
  })
  it("turns over when dragged across the opposite corner, stays on the sheet, never under the minimum", () => {
    const over = resizeBox(box, "se", { x: 0.1, y: 0.1 }, shown)
    expect(over.x).toBeCloseTo(0.1); expect(over.width).toBeCloseTo(0.1); expect(over.y).toBeCloseTo(0.1); expect(over.height).toBeCloseTo(0.1)
    const out = resizeBox(box, "se", { x: 4, y: 4 }, shown)
    expect(out.x + out.width).toBeCloseTo(1); expect(out.y + out.height).toBeCloseTo(1)
    const tiny = resizeBox(box, "se", { x: 0.2, y: 0.2 }, shown, 8)
    expect(tiny.width * shown.width).toBeGreaterThanOrEqual(8 - 1e-9)
    expect(tiny.height * shown.height).toBeGreaterThanOrEqual(8 - 1e-9)
    const edge = resizeBox({ x: 0.99, y: 0.99, width: 0.01, height: 0.01 }, "nw", { x: 0.999, y: 0.999 }, shown, 8)
    expect(edge.x + edge.width).toBeLessThanOrEqual(1 + 1e-9)
  })
})

describe("the dashed box: from the box to the region taken", () => {
  it("no box is the whole sheet", () => {
    expect(regionOfSheetBox(null, shown)).toEqual({ x: 0, y: 0, width: 1, height: 1 })
  })
  it("a box is clipped to the sheet; one off it, or under 2 px, is nothing", () => {
    expect(regionOfSheetBox({ x: -0.5, y: 0.5, width: 1, height: 1 }, shown)).toEqual({ x: 0, y: 0.5, width: 0.5, height: 0.5 })
    expect(regionOfSheetBox({ x: 1.2, y: 0.1, width: 0.3, height: 0.3 }, shown)).toBeNull()
    expect(regionOfSheetBox({ x: 0.1, y: 0.1, width: 1 / 800, height: 0.3 }, shown)).toBeNull()
  })
  it("brings in only the writing inside the box, cutting a stroke where it leaves", () => {
    const s = (x0: number, x1: number, y: number): InkStroke => ({
      colorHex: "#2D7DD2", width: 3, points: [{ x: x0, y }, { x: (x0 + x1) / 2, y }, { x: x1, y }], pressures: [0.3, 0.5, 0.7],
    })
    const left = s(0.05, 0.25, 0.3), right = s(0.6, 0.9, 0.3), across = s(0.1, 0.7, 0.4)
    const region = regionOfSheetBox({ x: 0.0, y: 0.2, width: 0.4, height: 0.3 }, shown)!
    const { inside, outside } = splitByRegion([left, right, across], region)
    expect(inside.map((one) => one.points.length)).toEqual([3, 2])
    expect(inside.every((one) => one.pressures?.length === one.points.length)).toBe(true)
    expect(outside.some((one) => one.points[0]!.x === 0.6)).toBe(true)
    expect(inside.some((one) => one.points[0]!.x === 0.6)).toBe(false)
  })
})

describe("the input split: the pen writes, the mouse never does", () => {
  const settings = { sideButton: "selects" as const, eraser: false }
  it("the pen tip draws; the mouse press also resolves to draw here, and the SURFACE turns that into the box", () => {
    expect(pressAction({ pointerType: "pen", button: 0, buttons: 1 }, settings)).toBe("draw")
    expect(pressAction({ pointerType: "mouse", button: 0, buttons: 1 }, settings)).toBe("draw")
  })
  it("a side button in the air and Pan do nothing on the sheet (they are 'ignore' / 'pan', which the surface returns on)", () => {
    expect(pressAction({ pointerType: "pen", button: 1, buttons: 4, pressure: 0 }, settings)).toBe("ignore")
    expect(pressAction({ pointerType: "pen", button: 2, buttons: 2, pressure: 0 }, settings)).toBe("ignore")
    expect(pressAction({ pointerType: "pen", button: 0, buttons: 5 }, { ...settings, buttons: { upper: { hold: "pan", double: "redo" } } })).toBe("pan")
    // The upper button held as the pen touches: Erase (the default, DEFAULT_BUTTONS); the lower one: Select, the dashed box.
    expect(pressAction({ pointerType: "pen", button: 0, buttons: 5 }, settings)).toBe("erase")
    expect(pressAction({ pointerType: "pen", button: 0, buttons: 3, pressure: 0.5 }, settings)).toBe("select")
  })
})

describe("paper: what is offered", () => {
  it("is the standard set, each at three spacings", () => {
    expect(PAPER_KINDS.map((one) => one.label)).toEqual(["Blank", "Dot grid", "Lines", "Grid", "Isometric dots", "Cornell notes"])
    expect(PAPER_COLOURS.map((one) => one.value)).toEqual(["white", "cream", "dark"])
    for (const { value } of PAPER_KINDS.filter((one) => one.value !== "blank")) {
      const [s, m, l] = (["small", "medium", "large"] as const).map((sp) => pitchOf(value, sp)) as [number, number, number]
      expect(s).toBeGreaterThan(0)
      expect(s).toBeLessThan(m); expect(m).toBeLessThan(l)
    }
    expect(pitchOf("blank", "medium")).toBe(0)
  })
  it("starts as the notebook's dotted paper, white", () => {
    expect(DEFAULT_PAPER).toEqual({ kind: "dots", spacing: "medium", colour: "white" })
  })
  it("reads a kept choice safely: junk falls back part by part", () => {
    expect(parsePaper(JSON.stringify({ kind: "lines", spacing: "large", colour: "dark" }))).toEqual({ kind: "lines", spacing: "large", colour: "dark" })
    expect(parsePaper("{not json")).toEqual(DEFAULT_PAPER)
    expect(parsePaper({ kind: "hexagons", spacing: "small", colour: 7 })).toEqual({ kind: "dots", spacing: "small", colour: "white" })
    expect(parsePaper(null)).toEqual(DEFAULT_PAPER)
  })
})

describe("paper: where the marks are", () => {
  const paper = (kind: Paper["kind"], spacing: Paper["spacing"] = "medium"): Paper => ({ kind, spacing, colour: "white" })
  it("blank has no marks", () => {
    const m = paperMarks(paper("blank"), SHEET)
    expect(m.dots).toHaveLength(0); expect(m.lines).toHaveLength(0)
  })
  it("a dot grid is dots one pitch apart both ways, all on the sheet; smaller spacing is more dots", () => {
    const m = paperMarks(paper("dots"), SHEET)
    const s = pitchOf("dots", "medium")
    expect(m.dots.length).toBeGreaterThan(500)
    expect(m.dots.every((d) => d.x > 0 && d.x < SHEET.width && d.y > 0 && d.y < SHEET.height)).toBe(true)
    const xs = [...new Set(m.dots.map((d) => d.x))].sort((a, b) => a - b)
    expect(xs[1]! - xs[0]!).toBeCloseTo(s)
    expect(paperMarks(paper("dots", "small"), SHEET).dots.length).toBeGreaterThan(m.dots.length)
    expect(paperMarks(paper("dots", "large"), SHEET).dots.length).toBeLessThan(m.dots.length)
  })
  it("lines are full-width rulings one pitch apart, below a top margin", () => {
    const m = paperMarks(paper("lines"), SHEET)
    const s = pitchOf("lines", "medium")
    expect(m.dots).toHaveLength(0)
    expect(m.lines.every((l) => l.y0 === l.y1 && l.x0 === 0 && l.x1 === SHEET.width)).toBe(true)
    expect(m.lines[0]!.y0).toBeCloseTo(2 * s)
    expect(m.lines[1]!.y0 - m.lines[0]!.y0).toBeCloseTo(s)
    expect(m.lines.at(-1)!.y0).toBeLessThan(SHEET.height)
  })
  it("a grid has the same number of verticals and horizontals as its pitch gives", () => {
    const m = paperMarks(paper("grid"), SHEET)
    const s = pitchOf("grid", "medium")
    const v = m.lines.filter((l) => l.x0 === l.x1), h = m.lines.filter((l) => l.y0 === l.y1)
    expect(v.length).toBe(Math.floor((SHEET.width - s / 2) / s))
    expect(h.length).toBe(Math.floor((SHEET.height - s / 2) / s))
  })
  it("isometric dots are a triangular lattice: rows sqrt(3)/2 apart, every other row shifted half a pitch", () => {
    const m = paperMarks(paper("isometric"), SHEET)
    const s = pitchOf("isometric", "medium")
    const rows = [...new Set(m.dots.map((d) => d.y))].sort((a, b) => a - b)
    expect(rows[1]! - rows[0]!).toBeCloseTo(s * Math.sqrt(3) / 2)
    const first = m.dots.filter((d) => d.y === rows[0]!).map((d) => d.x)[0]!
    const second = m.dots.filter((d) => d.y === rows[1]!).map((d) => d.x)[0]!
    expect(second - first).toBeCloseTo(s / 2)
    // Every dot is one pitch from a neighbour in its row and from two in the next: a lattice, not a grid.
    const d0 = m.dots[Math.floor(m.dots.length / 2)]!
    const near = m.dots.filter((d) => Math.abs(Math.hypot(d.x - d0.x, d.y - d0.y) - s) < 1e-6)
    expect(near.length).toBe(6)
  })
  it("Cornell has a title strip, a cue column and a summary strip, ruled only in the notes area", () => {
    const m = paperMarks(paper("cornell"), SHEET)
    const strong = m.lines.filter((l) => l.strong)
    expect(strong).toHaveLength(3)
    const cue = strong.find((l) => l.x0 === l.x1)!
    expect(cue.x0).toBeCloseTo(SHEET.width * 0.3)
    const light = m.lines.filter((l) => !l.strong)
    expect(light.length).toBeGreaterThan(5)
    expect(light.every((l) => l.x0 === cue.x0 && l.y0 > cue.y0 && l.y0 < cue.y1)).toBe(true)
  })
  it("no mark is ever part of the ink: paper is geometry, strokes are a separate list", () => {
    // paperMarks takes no strokes and returns no InkStroke; a stroke list is never touched by painting a paper.
    const keys = Object.keys(paperMarks(paper("cornell"), SHEET)).sort()
    expect(keys).toEqual(["dotRadius", "dots", "lines"])
  })
})

describe("paper: colour and the contrast of ink", () => {
  const dark: Paper = { kind: "dots", spacing: "medium", colour: "dark" }
  const white: Paper = { kind: "dots", spacing: "medium", colour: "white" }
  const paperOf = (c: Paper["colour"]) => PAPER_COLOURS.find((one) => one.value === c)!.paper
  it("the default ink, and the black preset, are lifted on dark paper and stay readable", () => {
    expect(inkOn(dark, DEFAULT_PEN_COLOUR)).not.toBe(DEFAULT_PEN_COLOUR)
    expect(contrastRatio(inkOn(dark, DEFAULT_PEN_COLOUR), paperOf("dark"))).toBeGreaterThan(4.5)
    expect(inkOn(dark, "#1C1C1E")).not.toBe("#1C1C1E")
    expect(contrastRatio(inkOn(dark, "#1C1C1E"), paperOf("dark"))).toBeGreaterThan(10)
    expect(inkOn(dark, "#000000")).toBe(inkOn(dark, "#1c1c1e"))
  })
  it("a colour the person chose is shown as chosen, on any paper", () => {
    for (const hex of ["#F2542D", "#F5B700", "#2FBF71", "#8E44AD", "#123456"]) {
      expect(inkOn(dark, hex)).toBe(hex)
      expect(inkOn(white, hex)).toBe(hex)
    }
  })
  it("on white and cream nothing changes, the default included", () => {
    expect(inkOn(white, DEFAULT_PEN_COLOUR)).toBe(DEFAULT_PEN_COLOUR)
    expect(inkOn({ colour: "cream" }, "#1C1C1E")).toBe("#1C1C1E")
  })
  it("the default ink is readable on every paper", () => {
    for (const c of ["white", "cream", "dark"] as const) {
      expect(contrastRatio(inkOn({ colour: c }, DEFAULT_PEN_COLOUR), paperOf(c))).toBeGreaterThan(3)
    }
  })
  it("the printed marks stay quieter than the ink on every paper", () => {
    for (const one of PAPER_COLOURS) {
      expect(contrastRatio(one.mark, one.paper)).toBeLessThan(contrastRatio(inkOn({ colour: one.value }, DEFAULT_PEN_COLOUR), one.paper))
      expect(contrastRatio(one.mark, one.paper)).toBeGreaterThan(1.1)
    }
  })
})
