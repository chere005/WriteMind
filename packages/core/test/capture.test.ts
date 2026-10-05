import { describe, expect, it } from "vitest"
import {
  applyHomography, capturePlacedCentre, displayedFrame, insertionPointBelow, invertHomography, pageBox, placement, PAGE_FRACTION,
  regionOf, resolveShape, shapeSize, unitSquareTo,
} from "../src/capture/page"
import { darkerThanPaper, inkBox, inkMask, localMeanRadius, marks, writingBox } from "../src/capture/ink"

/**
 * A page drawn in code: paper, a grid of printed dots, a shadow down one
 * side, and one thick pen stroke. Only the stroke is ink. Transcribed from
 * `WriteMindTests/NotebookCaptureTests.swift`.
 */
const width = 120, height = 90

function page(shadow = true): Uint8Array {
  const gray = new Uint8Array(width * height).fill(235)
  // A shadow: the left third is darker, evenly — not ink.
  if (shadow) {
    for (let y = 0; y < height; y++) for (let x = 0; x < 40; x++) gray[y * width + x] = 190
  }
  // Printed dots every 12 pixels, 2×2, a little darker than the paper.
  for (let y = 6; y < height; y += 12) {
    for (let x = 6; x < width; x += 12) {
      for (let dy = 0; dy < 2; dy++) {
        for (let dx = 0; dx < 2; dx++) gray[(y + dy) * width + x + dx]! -= 45
      }
    }
  }
  // The pen: a 5-pixel-thick line from (20, 40) to (100, 40).
  for (let y = 38; y <= 42; y++) for (let x = 20; x <= 100; x++) gray[y * width + x] = 25
  return gray
}

describe("lifting the writing off the paper", () => {
  it("takes the stroke and leaves the dots and the shadow", () => {
    const mask = inkMask(page(), width, height)
    expect(mask[40 * width + 60]).toBe(1)
    expect(mask[40 * width + 25]).toBe(1)
    expect(mask[6 * width + 6]).toBe(0)
    expect(mask[20 * width + 10]).toBe(0)
    expect(mask[20 * width + 41]).toBe(0)

    const box = inkBox(mask, width, height, 0)!
    expect(box.y).toBe(38)
    expect(box.height).toBe(5)
    expect(box.x).toBe(20)
    expect(box.width).toBe(81)
  })

  it("finds nothing on a page with nothing written on it", () => {
    const blank = page()
    for (let y = 38; y <= 42; y++) for (let x = 20; x <= 100; x++) blank[y * width + x] = 235
    expect(inkBox(inkMask(blank, width, height), width, height)).toBeNull()
  })

  it("leaves a little room round the writing", () => {
    const box = inkBox(inkMask(page(), width, height), width, height)!
    // 81 wide and 5 tall, plus a 6 pixel margin on each side.
    expect(box.width).toBe(93)
    expect(box.height).toBe(17)
  })

  it("reads a mark the width of the page as an edge, not writing", () => {
    const gray = new Uint8Array(width * height).fill(235)
    for (let x = 0; x < width; x++) {
      gray[45 * width + x] = 20
      gray[46 * width + x] = 20
      gray[47 * width + x] = 20
    }
    expect(inkBox(inkMask(gray, width, height), width, height)).toBeNull()
  })

  it("only the writing inside a window counts", () => {
    const mask = inkMask(page(), width, height)
    // The stroke runs from x 20 to 100; a window over the left of it sees x 20 to 59, plus the 6-pixel margin.
    const box = inkBox(mask, width, height, 6, { x: 0, y: 0, width: 60, height: 90 })!
    expect(box.x).toBe(14)
    expect(box.width).toBe(52)
    expect(box.y).toBe(32)
    expect(box.height).toBe(17)
    expect(inkBox(mask, width, height, 6, { x: 0, y: 0, width: 60, height: 30 })).toBeNull()   // a window with no writing in it
  })

  it("keeps the local-mean radius the one number everything else asks for", () => {
    expect(localMeanRadius(1200, 1600)).toBe(30)
    expect(localMeanRadius(80, 60)).toBe(8)
  })
})

describe("every page the same shape", () => {
  it("remembers the first one and keeps a tilted page on it", () => {
    expect(resolveShape(1.4, null).ratio).toBeCloseTo(1.4, 6)
    expect(resolveShape(1.47, 1.4).ratio).toBeCloseTo(1.4, 6)
    expect(resolveShape(1.62, 1.4).ratio).toBeCloseTo(1.62, 6)
    expect(resolveShape(0.7, null).ratio).toBe(1)
  })

  it("sizes the page from the short side", () => {
    expect(shapeSize({ ratio: 1.4 }, true)).toEqual({ width: 1200, height: 1680 })
    expect(shapeSize({ ratio: 1.4 }, false)).toEqual({ width: 1680, height: 1200 })
  })
})

describe("where a capture lands", () => {
  const pageSize = { width: 1200, height: 1600 }
  const pane = { width: 900, height: 600 }

  it("puts the writing where it was on the page, at the page's scale", () => {
    const pageHeight = 600 * PAGE_FRACTION
    const pageWidth = pageHeight * 1200 / 1600
    const scale = pageWidth / 1200
    const whole = placement({
      frame: { x: 0, y: 0, width: 1200, height: 1600 }, pageSize, pane, nudge: 0,
    })
    expect(whole.center.x).toBeCloseTo(0.5, 4)
    expect(whole.center.y).toBeCloseTo(0.5, 4)
    expect(whole.width).toBeCloseTo(pageWidth / 900, 4)

    const ink = placement({
      frame: { x: 0, y: 0, width: 600, height: 800 }, pageSize, pane, nudge: 0,
    })
    expect(ink.width).toBeCloseTo(600 * scale / 900, 4)
    expect(ink.center.x).toBeCloseTo(0.5 - 300 * scale / 900, 4)
    expect(ink.center.y).toBeCloseTo(0.5 - 400 * scale / 600, 4)

    // Two captures of the same notebook: the same size on the pane.
    const again = placement({
      frame: { x: 0, y: 0, width: 1200, height: 1600 }, pageSize, pane, nudge: 0.03,
    })
    expect(again.width).toBeCloseTo(whole.width, 4)
    expect(again.center.x).toBeCloseTo(0.53, 4)
  })
})

describe("the perspective", () => {
  it("sends the quad's corners to the unit square and back", () => {
    // A page seen tilted: narrower at the top.
    const quad = {
      topLeft: { x: 1, y: 2 }, topRight: { x: 3, y: 2 },
      bottomLeft: { x: 0, y: 0 }, bottomRight: { x: 4, y: 0 },
    }
    const toQuad = unitSquareTo(quad)
    const toSquare = invertHomography(toQuad)
    const near = (a: { x: number; y: number }, b: { x: number; y: number }) => {
      expect(a.x).toBeCloseTo(b.x, 6)
      expect(a.y).toBeCloseTo(b.y, 6)
    }
    near(applyHomography(toQuad, { x: 1, y: 1 }), quad.bottomRight)
    near(applyHomography(toQuad, { x: 0, y: 1 }), quad.bottomLeft)
    near(applyHomography(toSquare, quad.topLeft), { x: 0, y: 0 })
    near(applyHomography(toSquare, quad.topRight), { x: 1, y: 0 })
    near(applyHomography(toSquare, quad.bottomRight), { x: 1, y: 1 })
    near(applyHomography(toSquare, quad.bottomLeft), { x: 0, y: 1 })
    near(applyHomography(toSquare, { x: 2, y: 2 }), { x: 0.5, y: 0 })
  })

  it("turns a box on the pane into a fraction of the picture shown", () => {
    // A 400×300 picture in an 800×400 pane is shown 533 wide and 400 tall.
    const frame = { width: 400, height: 300 }, pane = { width: 800, height: 400 }
    const shown = displayedFrame(frame, pane)
    expect(shown.x).toBeCloseTo(400 / 3, 3)
    expect(shown.width).toBeCloseTo(1600 / 3, 3)
    expect(shown.height).toBeCloseTo(400, 3)

    const region = regionOf({ x: 0, y: 100, width: 400, height: 100 }, frame, pane)!
    expect(region.x).toBeCloseTo(0, 6)
    expect(region.width).toBeCloseTo((400 - 400 / 3) / (1600 / 3), 6)
    expect(region.y).toBeCloseTo(0.25, 6)
    expect(region.height).toBeCloseTo(0.25, 6)
    expect(regionOf({ x: 0, y: 0, width: 100, height: 100 }, frame, pane)).toBeNull()
  })

  it("finds a section's box on the page, past the inset", () => {
    const frame = { x: 0, y: 0, width: 400, height: 300 }
    // A page that fills the frame exactly, y up as the camera counts it.
    const square = {
      topLeft: { x: 0, y: 300 }, topRight: { x: 400, y: 300 },
      bottomLeft: { x: 0, y: 0 }, bottomRight: { x: 400, y: 0 },
    }
    const pageSize = { width: 1200, height: 900 }
    const region = { x: 0.25, y: 0.25, width: 0.5, height: 0.5 }

    const plain = pageBox({ region, quad: square, frame, inset: 0, pageSize })!
    expect(plain).toEqual({ x: 300, y: 225, width: 600, height: 450 })

    // Past a 10% inset, 0.25 of the frame is (0.25 − 0.1) / 0.8 of the
    // page. Boxed to whole pixels, so an edge may sit ONE pixel out —
    // which is the tolerance the Swift suite uses for the same reason.
    const inset = pageBox({ region, quad: square, frame, inset: 0.1, pageSize })!
    const within = (value: number, wanted: number) =>
      expect(Math.abs(value - wanted)).toBeLessThanOrEqual(1)
    within(inset.x, 225)
    within(inset.x + inset.width, 975)
    within(inset.y, 168.75)
    within(inset.y + inset.height, 731.25)

    expect(pageBox({
      region: { x: 0.99, y: 0.99, width: 0.01, height: 0.01 },
      quad: square, frame, inset: 0.1, pageSize,
    })).toBeNull()

    const noPage = pageBox({ region, quad: null, frame, inset: 0, pageSize })!
    expect(noPage).toEqual(plain)
  })
})

describe("the box of the writing proper (the port's refinement of inkBox)", () => {
  // A 200x160 page: a long pen stroke, plus whatever small marks a test adds.
  const w = 200, h = 160
  function pageWith(...marks: [number, number, number, number][]): Uint8Array {
    const gray = new Uint8Array(w * h).fill(235)
    for (let y = 40; y <= 44; y++) for (let x = 30; x <= 120; x++) gray[y * w + x] = 25   // the writing
    for (const [x, y, mw, mh] of marks) for (let yy = y; yy < y + mh; yy++) for (let xx = x; xx < x + mw; xx++) gray[yy * w + xx] = 25
    return gray
  }
  const found = (gray: Uint8Array) => marks(darkerThanPaper(gray, w, h), w, h)

  it("a stray mark far from the writing does not stretch the box", () => {
    // 3 wide and 9 tall: over the speck limit, so it is a mark, but not writing.
    const gray = pageWith([20, 140, 3, 9])
    const loose = inkBox(inkMask(gray, w, h), w, h)!
    expect(loose.y + loose.height).toBeGreaterThan(140)   // the old box reaches the stray mark
    const box = writingBox(found(gray))!
    expect(box.y + box.height).toBeLessThan(60)
    expect(box.x).toBe(24)
    expect(box.width).toBe(103)
  })

  it("an i-dot or a full stop near the writing comes with it", () => {
    const gray = pageWith([60, 22, 8, 8], [128, 38, 8, 8])   // a dot above the line, a full stop after it
    const box = writingBox(found(gray))!
    expect(box.y).toBe(22 - 6)
    expect(box.x + box.width - 1).toBe(135 + 6)
  })

  it("a page whose only marks are small keeps them", () => {
    const gray = new Uint8Array(w * h).fill(235)
    for (let y = 60; y < 69; y++) for (let x = 90; x < 98; x++) gray[y * w + x] = 25
    const box = writingBox(found(gray))!
    expect(box).toEqual({ x: 84, y: 54, width: 20, height: 21 })
  })

  it("only the marks inside a section count, and a blank page has no box", () => {
    const gray = pageWith([20, 140, 3, 9])
    expect(writingBox(found(gray), 6, { x: 0, y: 100, width: 200, height: 60 })!.y).toBe(134)
    expect(writingBox(found(new Uint8Array(w * h).fill(235)))).toBeNull()
    expect(writingBox(found(pageWith()), 6, { x: 150, y: 0, width: 50, height: 160 })).toBeNull()
  })
})

describe("a section of a drawing that is joined up across the page", () => {
  it("counts the part of a big connected mark that lies inside the section", () => {
    // One long wall of ink, 3 thick, from x 10 to 150, with a section over its left end only.
    const w = 200, h = 80
    const gray = new Uint8Array(w * h).fill(235)
    for (let y = 30; y < 33; y++) for (let x = 10; x < 150; x++) gray[y * w + x] = 25
    const found = marks(darkerThanPaper(gray, w, h), w, h)
    const box = writingBox(found, 0, { x: 0, y: 0, width: 50, height: 80 })!
    expect(box.x).toBe(10)
    expect(box.x + box.width - 1).toBe(49)   // cut at the section's edge: its centre (80) is not in the section, but its left end is
    expect(box.y).toBe(30)
    expect(box.height).toBe(3)
    expect(writingBox(found, 0, { x: 0, y: 40, width: 200, height: 40 })).toBeNull()
  })
})

describe("where a capture lands on the note (capturePlacedCentre)", () => {
  const pane = { width: 800, height: 600 }
  const base = { center: { x: 0.5, y: 0.5 }, width: 0.4, aspect: 0.5, pane }

  it("a note that is not scrolled and has no caret: where it sat on the pane", () => {
    expect(capturePlacedCentre({ ...base, scroll: 0 })).toEqual({ x: 0.5, y: 0.5 })
  })
  it("a note scrolled down: the middle of what is on screen, not the top of the note", () => {
    // Scrolled 6006 points down, the old code kept y = 0.5 of the pane = 300 points from the TOP of the document.
    const centre = capturePlacedCentre({ ...base, scroll: 6006 })
    expect(centre.x).toBe(0.5)
    expect(centre.y * pane.height).toBeCloseTo(6006 + 300, 6)
    expect(centre.y * pane.height).toBeGreaterThanOrEqual(6006)
    expect(centre.y * pane.height).toBeLessThanOrEqual(6006 + pane.height)
  })
  it("the offset it had on the pane comes with it", () => {
    const centre = capturePlacedCentre({ ...base, center: { x: 0.6, y: 0.3 }, scroll: 1200 })
    expect(centre).toEqual({ x: 0.6, y: 0.3 + 1200 / 600 })
  })
  it("a caret on screen: one gap under its line, flush with the text", () => {
    const caretLine = { x: 30, y: 6200, width: 740, height: 24 }
    const centre = capturePlacedCentre({ ...base, scroll: 6006, caretLine })
    // width 320, height 160: x = 30 + 160, y = 6200 + 24 + 8 + 80
    expect(centre.x * pane.width).toBeCloseTo(190, 6)
    expect(centre.y * pane.height).toBeCloseTo(6312, 6)
  })
  it("a caret that is off screen does not take the capture off screen", () => {
    const above = capturePlacedCentre({ ...base, scroll: 6006, caretLine: { x: 30, y: 100, width: 740, height: 24 } })
    const below = capturePlacedCentre({ ...base, scroll: 0, caretLine: { x: 30, y: 9000, width: 740, height: 24 } })
    expect(above.y * pane.height).toBeCloseTo(6306, 6)
    expect(below).toEqual({ x: 0.5, y: 0.5 })
  })
  it("a picture too wide for the line stays inside the pane", () => {
    const centre = capturePlacedCentre({ ...base, width: 0.95, scroll: 0, caretLine: { x: 400, y: 10, width: 300, height: 24 } })
    expect(centre.x * pane.width).toBeCloseTo(pane.width - 0.95 * pane.width / 2, 6)
  })
  it("a second capture does not land exactly on the first", () => {
    const first = capturePlacedCentre({ ...base, scroll: 0 })
    const second = capturePlacedCentre({ ...base, scroll: 0, taken: [first] })
    expect(second.x).toBeCloseTo(first.x + 0.03, 9)
    expect(second.y).toBeCloseTo(first.y + 0.03, 9)
    const third = capturePlacedCentre({ ...base, scroll: 0, taken: [first, second] })
    expect(third.x).toBeCloseTo(first.x + 0.06, 9)
  })
})

describe("where the words of a read picture go (insertionPointBelow)", () => {
  // Three lines of 20 points: "alpha\n" 0-5, "beta\n" 6-10, "gamma" 11-16 (document length 16).
  const lines = [{ from: 0, to: 5, top: 0, bottom: 20 }, { from: 6, to: 10, top: 20, bottom: 40 }, { from: 11, to: 16, top: 40, bottom: 60 }]
  const at = (y: number) => insertionPointBelow(lines.find((l) => y >= l.top && y < l.bottom) ?? lines[2]!, y, 16)

  it("a picture whose bottom edge is inside a line: before that line", () => {
    expect(at(30)).toBe(6)
    expect(at(21)).toBe(6)
    expect(at(5)).toBe(0)
  })
  it("a bottom edge on the boundary between two lines: the line that starts there", () => {
    expect(at(40)).toBe(11)
    expect(at(20)).toBe(6)
  })
  it("the nearest line ends above the edge: the line after it; none after: the end of the note", () => {
    expect(insertionPointBelow(lines[1]!, 41, 16)).toBe(11)
    expect(insertionPointBelow(lines[2]!, 500, 16)).toBe(16)
  })
  it("an empty note", () => {
    expect(insertionPointBelow(null, 100, 0)).toBe(0)
  })
})
