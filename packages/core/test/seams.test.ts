import { describe, expect, it } from "vitest"
import {
  arm, GAP_HEIGHT, moved, onPlus, pointerSeam, seamAt, seamContains, seams, structuralLines,
  type CellBox, type Seam,
} from "../src/cells/seams"
import { range } from "../src/text/range"

/** Transcribed from `WriteMindTests/CellSeamTests.swift`. */
describe("the spaces between the cells", () => {
  /** Three cells down a 300 pt page, offsets as a note of 44 characters gives them. */
  const page: CellBox[] = [
    { top: 20, bottom: 60, offset: 0 },
    { top: 80, bottom: 120, offset: 12 },
    { top: 140, bottom: 200, offset: 30 },
  ]
  const of = (cells: CellBox[], pageTop = 0, pageBottom = 300, noteLength = 44): Seam[] =>
    seams({ cells, pageTop, pageBottom, noteLength })

  it("gives every cell a seam above it and the last one a seam under it", () => {
    expect(of(page)).toHaveLength(4)
    expect(of([page[0]!])).toHaveLength(2)
    expect(of([])).toHaveLength(1)
  })

  it("starts the first seam at the top of the page and runs the last to the bottom", () => {
    const out = of(page, 4)
    expect(out[0]!.top).toBe(4)
    expect(out[0]!.bottom).toBe(20)
    expect(out.at(-1)!.top).toBe(200)
    expect(out.at(-1)!.bottom).toBe(300)
  })

  it("puts every point between two cells in exactly one seam and no point on a cell in any", () => {
    const out = of(page)
    for (let y = 60.5; y < 80; y += 0.5) {
      expect(out.filter((seam) => seamContains(seam, y))).toHaveLength(1)
    }
    for (let y = 20.5; y < 60; y += 0.5) {
      expect(out.some((seam) => seamContains(seam, y))).toBe(false)
    }
  })

  it("opens the cell below it, and the last opens at the end of the note", () => {
    expect(of(page, 0, 300, 44).map((seam) => seam.offset)).toEqual([0, 12, 30, 44])
  })

  it("makes an empty note one seam over the whole page", () => {
    expect(seams({ cells: [], pageTop: 0, pageBottom: 420, noteLength: 0 }))
      .toEqual([{ top: 0, bottom: 420, offset: 0, line: GAP_HEIGHT / 2 }])
    expect(seams({ cells: [], pageTop: 0, pageBottom: 420, noteLength: 3 })[0]!.offset).toBe(3)
  })

  it("answers with the seam a point is inside and no other", () => {
    const out = of(page)
    expect(seamAt(70, out)?.offset).toBe(12)
    expect(seamAt(250, out)?.offset).toBe(44)
    expect(seamAt(10, out)?.offset).toBe(0)
    expect(seamAt(60, out)?.offset).toBe(12)
    expect(seamAt(100, out)).toBeNull()
  })

  it("draws an ordinary seam's bar where it always did", () => {
    const snug: CellBox[] = [{ top: 20, bottom: 60, offset: 0 }, { top: 68, bottom: 120, offset: 12 }]
    const between = of(snug)[1]!
    expect(between.bottom - between.top).toBe(GAP_HEIGHT)
    expect(between.line).toBe(64)
  })

  it("draws the bar under the last cell against it, not halfway down the page", () => {
    const tail = of(page).at(-1)!
    expect(tail.top).toBe(200)
    expect(tail.bottom).toBe(300)
    expect(tail.line).toBe(200 + GAP_HEIGHT / 2)
  })

  it("draws the bar above the first cell against it too", () => {
    const head = of(page)[0]!
    expect(head.top).toBe(0)
    expect(head.line).toBe(20 - GAP_HEIGHT / 2)
  })

  it("puts an empty page's bar where the first cell will land", () => {
    const empty = seams({ cells: [], pageTop: 0, pageBottom: 420, noteLength: 0, firstCellTop: 30 })
    expect(empty[0]!.line).toBe(30 - GAP_HEIGHT / 2)
    expect(empty[0]!.top).toBe(0)
    expect(empty[0]!.bottom).toBe(420)
  })

  it("widens a seam too thin to hit about its middle", () => {
    const tight: CellBox[] = [{ top: 20, bottom: 60, offset: 0 }, { top: 62, bottom: 100, offset: 9 }]
    const middle = of(tight)[1]!
    expect(middle.line).toBe(61)
    expect(middle.top).toBe(61 - GAP_HEIGHT / 2)
    expect(middle.bottom).toBe(61 + GAP_HEIGHT / 2)
    const fat = seams({ cells: tight, pageTop: 0, pageBottom: 300, noteLength: 44, minimum: 20 })[1]!
    expect(fat.bottom - fat.top).toBe(20)
    expect(fat.line).toBe(61)
  })

  it("grows a thin seam at the edge of the page inward rather than off it", () => {
    const out = of([{ top: 2, bottom: 60, offset: 0 }], 0, 63)
    expect(out[0]!.top).toBe(0)
    expect(out[0]!.bottom).toBe(GAP_HEIGHT)
    expect(out[1]!.bottom).toBe(63)
    expect(out[1]!.top).toBe(63 - GAP_HEIGHT)
  })

  it("reads cells handed in out of order down the page all the same", () => {
    const jumbled: CellBox[] = [
      { top: 140, bottom: 200, offset: 30 },
      { top: 20, bottom: 60, offset: 0 },
      { top: 80, bottom: 120, offset: 12 },
    ]
    expect(of(jumbled)).toEqual(of(page))
  })

  it("turns a box handed in upside down the right way up", () => {
    const out = of([{ top: 60, bottom: 20, offset: 0 }])
    expect(out[0]!.bottom).toBe(20)
    expect(out[1]!.top).toBe(60)
  })

  it("still gives a cell of no height a seam either side of it", () => {
    const flat: CellBox[] = [
      { top: 20, bottom: 60, offset: 0 },
      { top: 100, bottom: 100, offset: 12 },
      { top: 140, bottom: 200, offset: 30 },
    ]
    const out = of(flat)
    expect(out).toHaveLength(4)
    expect(out[1]).toEqual({ top: 60, bottom: 100, offset: 12, line: 80 })
    expect(out[2]).toEqual({ top: 100, bottom: 140, offset: 30, line: 120 })
  })

  it("spaces the bar between two cells equally between them", () => {
    const out = of([{ top: 20, bottom: 60, offset: 0 }, { top: 100, bottom: 140, offset: 12 }])
    expect(out[1]!.line).toBe(80)
    expect(out[1]!.line - out[1]!.top).toBeCloseTo(out[1]!.bottom - out[1]!.line, 3)
  })

  it("still hugs the cell with the bars at the two ends", () => {
    const out = of([{ top: 200, bottom: 240, offset: 0 }], 0, 2000)
    expect(out[0]!.line).toBe(196)
    expect(out[1]!.line).toBe(244)
  })

  it("does not fold the seam between two overlapping cells inside out", () => {
    const out = of([{ top: 20, bottom: 80, offset: 0 }, { top: 60, bottom: 120, offset: 12 }])
    expect(out).toHaveLength(3)
    expect(out.every((seam) => seam.top <= seam.bottom)).toBe(true)
    expect(out[1]!.line).toBe(80)
    expect(out[2]!.top).toBe(120)
  })

  it("still leaves a seam under the last cell on a page that ends above it", () => {
    const out = of(page, 0, 100)
    expect(out).toHaveLength(4)
    expect(out[3]!.bottom).toBe(200)
    expect(out[3]!.bottom - out[3]!.top).toBe(GAP_HEIGHT)
    expect(out[3]!.offset).toBe(44)
  })
})

/** Transcribed from `PointerSeamTests` — the sticky reading that killed the flicker. */
describe("which seam the pointer is shown in", () => {
  const page: CellBox[] = [{ top: 20, bottom: 60.4, offset: 0 }, { top: 80, bottom: 120, offset: 12 }]
  const all = () => seams({ cells: page, pageTop: 0, pageBottom: 300, noteLength: 30 })

  it("answers with the seam under the pointer when nothing is being shown", () => {
    expect(pointerSeam(70, all(), null)?.offset).toBe(12)
    expect(pointerSeam(100, all(), null)).toBeNull()
  })

  it("keeps the seam it is already showing until the pointer is clearly out", () => {
    const inside = pointerSeam(70, all(), null)!
    // A hair over the edge, where the rect and the point test disagreed.
    expect(pointerSeam(79.6, all(), inside.offset)?.offset).toBe(12)
    expect(pointerSeam(85, all(), inside.offset)).toBeNull()
  })

  it("says nothing has moved for a re-measure under half a point", () => {
    const fresh = all().map((seam) => ({ ...seam, top: seam.top + 0.2 }))
    expect(moved(fresh, all())).toBe(false)
    expect(moved(all().slice(1), all())).toBe(true)
  })
})

/** Transcribed from `ArmedBarTests` — arming is a reading of where the caret is. */
describe("arming a seam", () => {
  const note = "one\n\ntwo\n\nthree"

  it("arms the seam the caret has arrived in", () => {
    expect(arm(range(4, 0), note, null)).toBe(5)
  })

  it("arms nothing for a caret inside a cell", () => {
    expect(arm(range(1, 0), note, null)).toBeNull()
    expect(arm(range(6, 0), note, null)).toBeNull()
  })

  it("arms nothing for a selection, however small", () => {
    expect(arm(range(4, 1), note, null)).toBeNull()
  })

  it("keeps an arm that is already where the caret is", () => {
    // Offset 0 is both the seam above the first cell and the start of it.
    expect(arm(range(0, 0), note, 0)).toBe(0)
    expect(arm(range(0, 0), note, null)).toBeNull()
  })

  it("does not arm inside a run of blank lines the note is holding", () => {
    // The first and last of a run separate two cells; the rest are a cell.
    const held = "a\n\n\n\n\n\nb"
    expect(arm(range(3, 0), held, null)).toBeNull()
    expect(structuralLines(held)).toHaveLength(2)
  })

  it("does not arm on the empty line inside a fenced block", () => {
    const fence = "```\n\n```"
    expect(arm(range(4, 0), fence, null)).toBeNull()
  })
})

describe("the + on the bar", () => {
  const seam: Seam = { top: 60, bottom: 68, offset: 12, line: 64 }

  it("answers for the dot with its slack, clipped to the seam", () => {
    expect(onPlus(8, 64, seam, 4)).toBe(true)
    expect(onPlus(8, 61, seam, 4)).toBe(true)
    // Five points up into the cell above would promise a press that
    // never arrives.
    expect(onPlus(8, 55, seam, 4)).toBe(false)
    expect(onPlus(40, 64, seam, 4)).toBe(false)
  })
})
