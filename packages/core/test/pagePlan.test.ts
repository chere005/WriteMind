/**
 * Transcribed from `WriteMindTests/NotePDFTests.swift` (the page-break half;
 * the half that opens a PDF with CoreGraphics is checked by the app's own
 * e2e, which renders the file back to PNG).
 */
import { describe, expect, it } from "vitest"
import { paperContent, layoutSheets, MARGIN, PAPER, pagesFor, type PagePiece } from "../src/export/pagePlan"

const piece = (id: number, top: number, bottom: number): PagePiece => ({ id, top, bottom })

/** Every piece is on exactly one sheet, and wholly inside it. */
function expectNothingCut(pieces: PagePiece[], pages: ReturnType<typeof pagesFor>, pageHeight: number): void {
  expect(pages.flatMap((page) => page.pieces).sort()).toEqual(pieces.map((one) => one.id).sort())
  for (const page of pages) {
    const room = pageHeight / page.scale
    for (const id of page.pieces) {
      const one = pieces.find((candidate) => candidate.id === id)!
      expect(one.top).toBeGreaterThanOrEqual(page.top - 0.001)
      expect(one.bottom).toBeLessThanOrEqual(page.top + room + 0.001)
    }
  }
}

describe("where the breaks land (PagePlan)", () => {
  it("a page break lands between cells and never inside one", () => {
    const cells = [piece(0, 0, 300), piece(1, 320, 620), piece(2, 640, 940)]
    const pages = pagesFor(cells, 700)
    expect(pages.map((page) => page.pieces)).toEqual([[0, 1], [2]])
    expect(pages[0]!.top).toBe(0)
    expect(pages[1]!.top).toBe(640)
    expect(pages.map((page) => page.scale)).toEqual([1, 1])
    expectNothingCut(cells, pages, 700)
  })

  it("an object taller than a page gets one to itself, shrunk to fit", () => {
    const pieces = [piece(0, 0, 100), piece(1, 120, 1120), piece(2, 1140, 1240)]
    const pages = pagesFor(pieces, 500)
    expect(pages.map((page) => page.pieces)).toEqual([[0], [1], [2]])
    expect(pages[1]!.top).toBe(120)
    expect(pages[1]!.scale).toBeCloseTo(0.5, 9)
    expect(pages[0]!.scale).toBe(1)
    expect(pages[2]!.scale).toBe(1)
    expectNothingCut(pieces, pages, 500)
  })

  it("two things that overlap are never parted by a break", () => {
    const pages = pagesFor([piece(0, 0, 400), piece(1, 380, 700)], 600)
    expect(pages).toHaveLength(1)
    expect(pages[0]!.pieces).toEqual([0, 1])
    expect(pages[0]!.scale).toBeCloseTo(600 / 700, 9)
  })

  it("a note with nothing in it is still one sheet of paper", () => {
    expect(pagesFor([], 700)).toEqual([{ top: 0, scale: 1, pieces: [] }])
  })
})

describe("the document laid onto US Letter (NotePDF.data)", () => {
  it("is 612x792 with three quarters of an inch of margin", () => {
    expect(PAPER).toEqual({ width: 612, height: 792 })
    expect(MARGIN).toBe(54)
    expect(paperContent()).toEqual({ width: 504, height: 684 })
  })

  it("four 200pt blocks 220pt apart in a 400pt-wide document make two sheets", () => {
    // US Letter leaves 504pt across, so the document is blown up by 1.26 and
    // a sheet holds 684 / 1.26 = 542pt of it: two blocks (420pt) fit and
    // three (640pt) do not.
    const pieces = [0, 1, 2, 3].map((index) => piece(index, index * 220, index * 220 + 200))
    const sheet = layoutSheets(pieces, 400)!
    expect(sheet.fit).toBeCloseTo(1.26, 9)
    expect(sheet.pages).toHaveLength(2)
    expect(sheet.pages.map((page) => page.pieces)).toEqual([[0, 1], [2, 3]])
    expect(sheet.paper).toEqual(PAPER)
  })

  it("centres a page that had to be shrunk and bottoms the page at its last piece", () => {
    const sheet = layoutSheets([piece(0, 0, 100), piece(1, 120, 2000)], 400)!
    const tall = sheet.pages[1]!
    expect(tall.scale).toBeLessThan(sheet.fit)
    expect(tall.left).toBeGreaterThan(MARGIN)
    expect(tall.bottom).toBe(2000)
    expect(sheet.pages[0]!.left).toBe(MARGIN)
    expect(sheet.pages[0]!.bottom).toBe(100)
  })

  it("refuses a document with no width or paper with no room", () => {
    expect(layoutSheets([], 0)).toBeNull()
    expect(layoutSheets([], 400, { width: 100, height: 100 }, 60)).toBeNull()
  })
})
