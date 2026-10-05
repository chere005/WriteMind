// A tablet sheet BOUND to an ink cell (Sean, 2026-10-05: "right click and open the drawing cell as a new tab in the
// wacom/video editor to write in"): renderer/cellSheet.ts (the geometry and the sync), cellPage.ts, cellSheets.ts (the
// binding, against a fake app), sheetSet.ts (kept on disk). Port-only: the Mac has neither the tablet sheet nor ink
// cells, so there is no Swift test to transcribe.
import { afterEach, describe, expect, it, vi } from "vitest"
import { newID, noTransform, outline, cellFrame, type CanvasItem, type Drawing, type InkCell } from "@writemind/core"
import {
  cellFrameOn, cellWithSheet, clampToFrame, newLinks, placementFor, sheetStrokesOf, strokeToCell, strokeToSheet,
  type Placement,
} from "../src/renderer/cellSheet"
import { boundSheetName, parseCellRef, parseSheets, sameCell, serialiseSheets, MAX_NAME } from "../src/renderer/sheetSet"
import { SHEET_REF, type InkStroke } from "../src/renderer/tabletPage"
import { DEFAULT_PAPER } from "../src/renderer/tabletPaper"

const ID = "0f0e0d0c-0b0a-4908-8706-050403020100"
type StrokeItem = Extract<CanvasItem, { kind: "stroke" }>

const strokeItem = (points: [number, number][], width = 3, transform = noTransform(), pressures?: number[]): StrokeItem => ({
  kind: "stroke",
  stroke: {
    id: newID(), colorHex: "#2D7DD2", width, points: points.map(([x, y]) => ({ x, y })),
    ...(pressures ? { pressures } : {}), transform, group: null,
  },
})
const picture = (): CanvasItem => ({
  kind: "image",
  image: { id: newID(), file: "abc.png", center: { x: 0.5, y: 0.1 }, width: 0.2, aspect: 0.5, transform: noTransform(), hidden: false } as never,
})
const cellOf = (items: CanvasItem[], aspect = 200 / 720): InkCell => ({ id: ID, aspect, items })
const near = (a: number, b: number, eps = 1e-9) => expect(Math.abs(a - b)).toBeLessThan(eps)

describe("the cell's frame on the sheet", () => {
  it("is the largest rectangle of the cell's shape, centred, and keeps that shape in sheet pixels", () => {
    // A wide cell (720 x 200) on a 16:10 sheet: full width, centred top to bottom.
    const wide = cellFrameOn(1.6, 200 / 720)
    near(wide.x, 0); near(wide.width, 1)
    near(wide.y, (1 - wide.height) / 2)
    near((wide.width * 1.6) / wide.height, 720 / 200)
    // A tall cell (300 x 600): full height, centred side to side.
    const tall = cellFrameOn(1.6, 2)
    near(tall.y, 0); near(tall.height, 1)
    near(tall.x, (1 - tall.width) / 2)
    near((tall.width * 1.6) / tall.height, 0.5)
  })

  it("falls back to sane shapes for a bad aspect", () => {
    const frame = cellFrameOn(Number.NaN, 0)
    expect([frame.x, frame.y, frame.width, frame.height].every(Number.isFinite)).toBe(true)
  })
})

describe("cell and sheet coordinates", () => {
  const place: Placement = placementFor(1.6, cellOf([]), 600)

  it("a cell stroke goes to the sheet and back to the same points, width and pressures", () => {
    const item = strokeItem([[0.1, 0.05], [0.5, 0.2], [0.9, 0.25]], 3, noTransform(), [0.2, 0.5, 0.9])
    const sheet = strokeToSheet(item, place)
    // Inside the frame, at the sheet's scale.
    for (const p of sheet.points) {
      expect(p.x).toBeGreaterThanOrEqual(place.frame.x - 1e-12)
      expect(p.y).toBeGreaterThanOrEqual(place.frame.y - 1e-12)
    }
    near(sheet.width, (3 * place.frame.width * SHEET_REF) / 600)
    const back = strokeToCell(sheet, place).stroke
    back.points.forEach((p, i) => { near(p.x, item.stroke.points[i]!.x); near(p.y, item.stroke.points[i]!.y) })
    near(back.width, 3)
    expect(back.pressures).toEqual([0.2, 0.5, 0.9])
    expect(back.transform).toEqual(noTransform())
  })

  it("a moved, scaled, turned cell stroke is shown where it is now, at its scaled width", () => {
    const item = strokeItem([[0.2, 0.1], [0.4, 0.15]], 2, { dx: 0.1, dy: 0.02, scale: 1.5, rotation: 0.3 })
    const sheet = strokeToSheet(item, place)
    const now = outline(item, cellFrame(600))
    sheet.points.forEach((p, i) => {
      near(p.x, place.frame.x + (now[i]!.x / 600) * place.frame.width)
      near(p.y, place.frame.y + (now[i]!.y / (600 * place.aspect)) * place.frame.height)
    })
    near(sheet.width, (2 * 1.5 * place.frame.width * SHEET_REF) / 600)
  })

  it("a stroke past the frame stops at its edge; one inside is left as it is", () => {
    const frame = place.frame
    const inside: InkStroke = { colorHex: "#000000", width: 2, points: [{ x: 0.5, y: frame.y + 0.01 }] }
    expect(clampToFrame(inside, frame)).toBe(inside)
    const out: InkStroke = { colorHex: "#000000", width: 2, points: [{ x: 0.5, y: 0 }, { x: 0.5, y: 1 }] }
    const kept = clampToFrame(out, frame)
    near(kept.points[0]!.y, frame.y)
    near(kept.points[1]!.y, frame.y + frame.height)
    // In the cell: from its top to its bottom (aspect), never outside.
    const item = strokeToCell(out, place).stroke
    near(item.points[0]!.y, 0); near(item.points[1]!.y, place.aspect)
  })
})

describe("the sync (links)", () => {
  const place = (cell: InkCell) => placementFor(1.6, cell, 600)

  it("cell -> sheet -> cell changes nothing: the very same cell comes back", () => {
    const cell = cellOf([strokeItem([[0.1, 0.1], [0.2, 0.2]]), picture(), strokeItem([[0.5, 0.1], [0.6, 0.2]])])
    const links = newLinks()
    const strokes = sheetStrokesOf(cell, links, place(cell))
    expect(strokes).toHaveLength(2)
    expect(cellWithSheet(cell, strokes, links, place(cell))).toBe(cell)
    // And asked again at the same placement, the sheet gets the same objects (nothing repaints for nothing).
    const again = sheetStrokesOf(cell, links, place(cell))
    expect(again[0]).toBe(strokes[0]); expect(again[1]).toBe(strokes[1])
  })

  it("a stroke written on the sheet is a new item after the others; the rest stay the same objects", () => {
    const a = strokeItem([[0.1, 0.1], [0.2, 0.2]]), pic = picture()
    const cell = cellOf([a, pic])
    const links = newLinks()
    const strokes = sheetStrokesOf(cell, links, place(cell))
    const written: InkStroke = { colorHex: "#c0392b", width: 4, points: [{ x: 0.3, y: 0.5 }, { x: 0.4, y: 0.52 }] }
    const next = cellWithSheet(cell, [...strokes, written], links, place(cell))
    expect(next).not.toBe(cell)
    expect(next.items).toHaveLength(3)
    expect(next.items[0]).toBe(a); expect(next.items[1]).toBe(pic)
    expect(next.items[2]!.kind).toBe("stroke")
    // The same sheet again: the same cell items (the new stroke is linked now).
    expect(cellWithSheet(next, [...strokes, written], links, place(next))).toBe(next)
  })

  it("a stroke rubbed out on the sheet leaves the cell; its pictures stay", () => {
    const a = strokeItem([[0.1, 0.1], [0.2, 0.2]]), b = strokeItem([[0.5, 0.1], [0.6, 0.2]]), pic = picture()
    const cell = cellOf([a, pic, b])
    const links = newLinks()
    const strokes = sheetStrokesOf(cell, links, place(cell))
    const next = cellWithSheet(cell, [strokes[1]!], links, place(cell))
    expect(next.items).toEqual([pic, b])
    // Cleared: only the picture.
    expect(cellWithSheet(cell, [], links, place(cell)).items).toEqual([pic])
  })

  it("a change made in the note (an Undo) comes back without remaking the strokes it did not touch", () => {
    const a = strokeItem([[0.1, 0.1], [0.2, 0.2]]), b = strokeItem([[0.5, 0.1], [0.6, 0.2]])
    const cell = cellOf([a, b])
    const links = newLinks()
    const before = sheetStrokesOf(cell, links, place(cell))
    const undone = cellOf([a])
    const after = sheetStrokesOf(undone, links, place(undone))
    expect(after).toEqual([before[0]])
    expect(after[0]).toBe(before[0])
  })

  it("another placement (the cell resized, the tablet turned) makes the sheet strokes again", () => {
    const a = strokeItem([[0.1, 0.1], [0.2, 0.2]])
    const cell = cellOf([a])
    const links = newLinks()
    const first = sheetStrokesOf(cell, links, place(cell))
    const taller = { ...cell, aspect: cell.aspect * 2 }
    const second = sheetStrokesOf(taller, links, place(taller))
    expect(second[0]).not.toBe(first[0])
    // ...and the item is still the same one behind it.
    expect(cellWithSheet(taller, second, links, place(taller))).toBe(taller)
  })

  it("after a restart (no links) a sheet with writing waiting replaces the cell's strokes with its own, pictures kept", () => {
    const a = strokeItem([[0.1, 0.1], [0.2, 0.2]]), pic = picture()
    const cell = cellOf([a, pic])
    const shown = sheetStrokesOf(cell, newLinks(), place(cell))
    const extra: InkStroke = { colorHex: "#000000", width: 3, points: [{ x: 0.5, y: 0.5 }, { x: 0.6, y: 0.5 }] }
    const next = cellWithSheet(cell, [...shown, extra], newLinks(), place(cell))
    expect(next.items.filter((item) => item.kind === "stroke")).toHaveLength(2)
    expect(next.items).toContain(pic)
    expect(next.items).not.toContain(a)
    const copy = next.items.find((item) => item.kind === "stroke") as StrokeItem
    copy.stroke.points.forEach((p, i) => { near(p.x, a.stroke.points[i]!.x); near(p.y, a.stroke.points[i]!.y) })
  })
})

describe("the binding on disk (sheetSet.ts)", () => {
  it("a bound sheet keeps its cell, its waiting writing and the cell's shape", () => {
    const text = serialiseSheets({
      current: "b",
      sheets: [
        { id: "a", name: "Sheet 1", paper: DEFAULT_PAPER, strokes: [] },
        { id: "b", name: "Physics Drawing", paper: DEFAULT_PAPER, strokes: [], cell: { note: "C:\\notes\\physics.md", cell: ID }, pending: true, shape: 0.277778 },
      ],
    })
    const back = parseSheets(text)!
    expect(back.sheets[0]!.cell).toBeUndefined()
    expect(back.sheets[1]!.cell).toEqual({ note: "C:\\notes\\physics.md", cell: ID })
    expect(back.sheets[1]!.pending).toBe(true)
    expect(back.sheets[1]!.shape).toBeCloseTo(0.277778, 5)
  })

  it("a damaged cell is dropped: a plain sheet, ink kept", () => {
    const text = JSON.stringify({
      version: 1, current: "a",
      sheets: [{ id: "a", name: "X", paper: {}, strokes: [{ c: "#000000", w: 2, p: [0.1, 0.1, 0.2, 0.2] }], cell: { note: "a.md", cell: "not-an-id" }, pending: true }],
    })
    const back = parseSheets(text)!
    expect(back.sheets[0]!.cell).toBeUndefined()
    expect(back.sheets[0]!.pending).toBeUndefined()
    expect(back.sheets[0]!.strokes).toHaveLength(1)
    expect(parseCellRef({ note: "", cell: ID })).toBeNull()
    expect(parseCellRef({ note: "a.md", cell: ID })).toEqual({ note: "a.md", cell: ID })
    expect(sameCell({ note: "a.md", cell: ID }, { note: "a.md", cell: ID })).toBe(true)
    expect(sameCell({ note: "b.md", cell: ID }, { note: "a.md", cell: ID })).toBe(false)
  })

  it("a bound sheet is named after its note, numbered when the name is taken, and fits", () => {
    expect(boundSheetName("Physics", [])).toBe("Physics Drawing")
    expect(boundSheetName("Physics", [{ id: "a", name: "Physics Drawing" }])).toBe("Physics Drawing 2")
    const long = boundSheetName("A very long note title that goes on and on and on", [])
    expect(long.endsWith(" Drawing")).toBe(true)
    expect(long.length).toBeLessThanOrEqual(MAX_NAME)
  })
})

// MARK: - The binding, live, against a fake app

const NOTE = "C:/notes/physics.md"

async function live() {
  vi.resetModules()
  const store = new Map<string, string>()
  vi.stubGlobal("localStorage", { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => { store.set(k, v) } })
  vi.stubGlobal("window", {
    screen: { width: 1600, height: 1000 },
    addEventListener: () => undefined, removeEventListener: () => undefined,
  })
  const sheets = await import("../src/renderer/tabletSheets")
  const cells = await import("../src/renderer/cellSheets")
  const { CellPage } = await import("../src/renderer/cellPage")
  const a = strokeItem([[0.1, 0.1], [0.2, 0.2]]), pic = picture()
  const app = {
    note: NOTE as string,
    drawing: { items: [{ kind: "cell", cell: cellOf([a, pic]) }] } as Drawing,
    past: [] as Drawing[],
    shown: 0,
  }
  const host = {
    front: () => ({ note: app.note, drawing: app.drawing }),
    edit: (next: Drawing, record: boolean) => {
      if (record) app.past.push(app.drawing)
      app.drawing = next
      cells.cellSheetsSaw(app.note, app.drawing)
    },
    width: () => 600,
    title: () => "Physics",
    showTablet: () => { app.shown++ },
    bring: async () => undefined,
    reveal: () => undefined,
  }
  cells.setCellSheetHost(host)
  cells.cellSheetsSaw(app.note, app.drawing)
  const cell = () => (app.drawing.items.find((item) => item.kind === "cell") as { cell: InkCell } | undefined)?.cell ?? null
  const page = () => sheets.currentSheet() as InstanceType<typeof CellPage>
  const undo = () => { app.drawing = app.past.pop()!; cells.cellSheetsSaw(app.note, app.drawing) }
  return { sheets, cells, CellPage, app, cell, page, undo, a, pic }
}

afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals() })

describe("a sheet bound to a cell (cellSheets.ts)", () => {
  it("Open in Tablet Sheet shows the Tablet and opens one bound tab, named after the note, with the cell's strokes", async () => {
    const { sheets, cells, CellPage, app, page } = await live()
    expect(cells.openInTabletSheet(ID)).toBe(true)
    expect(app.shown).toBe(1)
    const view = sheets.sheetTabs()
    const tab = view.tabs.find((one) => one.id === view.current)!
    expect(tab.name).toBe("Physics Drawing")
    expect(tab.cell).toEqual({ note: NOTE, cell: ID })
    expect(page()).toBeInstanceOf(CellPage)
    expect(page().strokes).toHaveLength(1)
    expect(page().frame).not.toBeNull()
    // Again: the same tab, not a second one.
    sheets.addSheet()
    expect(cells.openInTabletSheet(ID)).toBe(true)
    expect(sheets.sheetTabs().tabs.filter((one) => one.cell !== null)).toHaveLength(1)
    expect(sheets.sheetTabs().current).toBe(tab.id)
    // A cell the note does not have: nothing.
    expect(cells.openInTabletSheet("11111111-2222-4333-8444-555555555555")).toBe(false)
  })

  it("a stroke on the sheet is ONE undo step of the note, in the cell; the sheet has no undo of its own", async () => {
    const { cells, app, cell, page, undo, a, pic } = await live()
    cells.openInTabletSheet(ID)
    page().add({ colorHex: "#000000", width: 4, points: [{ x: 0.3, y: 0.5 }, { x: 0.5, y: 0.5 }] })
    expect(app.past).toHaveLength(1)
    expect(cell()!.items).toHaveLength(3)
    expect(cell()!.items[0]).toBe(a); expect(cell()!.items[1]).toBe(pic)
    expect(page().canUndo).toBe(false)
    expect(page().undo()).toBe(false)
    // The note's Undo takes it back, and the sheet follows.
    const kept = page().strokes[0]
    undo()
    expect(cell()!.items).toHaveLength(2)
    expect(page().strokes).toHaveLength(1)
    expect(page().strokes[0]).toBe(kept)
  })

  it("an erase gesture is one step however many strokes it rubs out", async () => {
    const { cells, app, cell, page } = await live()
    cells.openInTabletSheet(ID)
    page().add({ colorHex: "#000000", width: 4, points: [{ x: 0.3, y: 0.5 }, { x: 0.5, y: 0.5 }] })
    const steps = app.past.length
    page().mark()
    page().removeAt(0)
    page().removeAt(0)
    expect(app.past.length).toBe(steps + 1)
    expect(cell()!.items.filter((item) => item.kind === "stroke")).toHaveLength(0)
    expect(cell()!.items.filter((item) => item.kind === "image")).toHaveLength(1)
  })

  it("a stroke drawn in the cell in the note shows on the sheet", async () => {
    const { cells, app, cell, page } = await live()
    cells.openInTabletSheet(ID)
    const now = cell()!
    app.drawing = { items: [{ kind: "cell", cell: { ...now, items: [...now.items, strokeItem([[0.7, 0.1], [0.8, 0.2]])] } }] }
    cells.cellSheetsSaw(app.note, app.drawing)
    expect(page().strokes).toHaveLength(2)
  })

  it("written while its note is not in front, the writing waits and lands (one step) when the note is", async () => {
    const { sheets, cells, app, cell, page } = await live()
    cells.openInTabletSheet(ID)
    const bound = page()
    const drawing = app.drawing
    app.note = "C:/notes/other.md"
    app.drawing = { items: [] }
    cells.cellSheetsSaw(app.note, app.drawing)
    // Another note in front: the sheet went back to a plain tab (sheetFollow.ts). The bound page, written all the same
    // (a sheets file from before, the moment a pick waits for its note), keeps the writing for its note.
    expect(sheets.currentSheet()).not.toBe(bound)
    bound.add({ colorHex: "#000000", width: 4, points: [{ x: 0.3, y: 0.5 }, { x: 0.5, y: 0.5 }] })
    expect(bound.pending).toBe(true)
    expect(sheets.boundPages()[0]!.pending).toBe(true)
    app.note = NOTE
    app.drawing = drawing
    app.past = []
    cells.cellSheetsSaw(app.note, app.drawing)
    expect(bound.pending).toBe(false)
    expect(app.past).toHaveLength(1)
    expect(cell()!.items.filter((item) => item.kind === "stroke")).toHaveLength(2)
  })

  it("its cell gone from the note (still gone a moment later): a plain sheet, ink kept, with a quiet word", async () => {
    vi.useFakeTimers()
    const { sheets, cells, app, page } = await live()
    cells.openInTabletSheet(ID)
    const id = sheets.sheetTabs().current
    app.drawing = { items: [] }
    cells.cellSheetsSaw(app.note, app.drawing)
    vi.advanceTimersByTime(2000)
    const tab = sheets.sheetTabs().tabs.find((one) => one.id === id)!
    expect(tab.cell).toBeNull()
    expect(tab.notice).toMatch(/plain sheet/)
    expect(page().strokes).toHaveLength(1)
    page().add({ colorHex: "#000000", width: 4, points: [{ x: 0.3, y: 0.5 }] })
    expect(page().canUndo).toBe(true)
  })

  it("an Undo then a Redo of the cell within a moment is not 'gone'", async () => {
    vi.useFakeTimers()
    const { sheets, cells, app } = await live()
    cells.openInTabletSheet(ID)
    const drawing = app.drawing
    app.drawing = { items: [] }
    cells.cellSheetsSaw(app.note, app.drawing)
    vi.advanceTimersByTime(300)
    app.drawing = drawing
    cells.cellSheetsSaw(app.note, app.drawing)
    vi.advanceTimersByTime(2000)
    expect(sheets.boundPages()).toHaveLength(1)
  })

  it("a renamed note takes its bound sheets with it", async () => {
    const { sheets, cells } = await live()
    cells.openInTabletSheet(ID)
    sheets.renameBoundNotes("C:/notes", "C:/moved")
    expect(sheets.boundPages()[0]!.ref).toEqual({ note: "C:/moved/physics.md", cell: ID })
  })
})
