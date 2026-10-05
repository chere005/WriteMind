// The tablet sheet's dot-grid paper in a Page picture is found and painted out before Aa reads it, the way the Mac's
// `TextRecognition.withoutDotGrid` does for a photographed dotted page. The port's Aa runs `prepareForReading`
// (ocrClient.ts): the picture at most GRID_SEARCH_WIDTH across, `readingPageOf`, then `paintOutDots`. That needs a
// DOM canvas, so the Page picture is rasterised here the way `paintPaper` paints it (filled discs of the paper's
// strong colour on whole-pixel centres, anti-aliased) and handed straight to the same two core functions.
import { describe, expect, it } from "vitest"
import { GRID_SEARCH_WIDTH, paintOutDots, readingPageOf, resolveShape, shapeSize } from "@writemind/core"
import { colourOfPaper, DEFAULT_PAPER, paperMarks, type Paper } from "../src/renderer/tabletPaper"

const grey = (hex: string): number => {
  const v = parseInt(hex.slice(1), 16)
  return Math.round(0.299 * ((v >> 16) & 255) + 0.587 * ((v >> 8) & 255) + 0.114 * (v & 255))
}

/** The Page picture of the part `view` of a sheet of `units`, at `px` pixels, as grey levels (and some writing). */
function pagePicture(paper: Paper, units: { width: number; height: number }, view: { x: number; y: number; width: number; height: number },
  px: { width: number; height: number }) {
  const colours = colourOfPaper(paper.colour)
  const ground = grey(colours.paper), dot = grey(colours.strong)
  const cover = new Float32Array(px.width * px.height)
  const marks = paperMarks(paper, units)
  const dx = px.width / view.width, dy = px.height / view.height
  const radius = Math.max(1, marks.dotRadius * Math.min(dx, dy))
  for (const one of marks.dots) {
    const cx = Math.round((one.x - view.x) * dx) + 0.5, cy = Math.round((one.y - view.y) * dy) + 0.5
    for (let y = Math.floor(cy - radius - 1); y <= Math.ceil(cy + radius + 1); y++) {
      for (let x = Math.floor(cx - radius - 1); x <= Math.ceil(cx + radius + 1); x++) {
        if (x < 0 || y < 0 || x >= px.width || y >= px.height) continue
        let inside = 0   // 4x4 supersampling, as the canvas's anti-aliasing would
        for (let sy = 0; sy < 4; sy++) for (let sx = 0; sx < 4; sx++) {
          if ((x + (sx + 0.5) / 4 - cx) ** 2 + (y + (sy + 0.5) / 4 - cy) ** 2 <= radius * radius) inside++
        }
        cover[y * px.width + x] = Math.max(cover[y * px.width + x]!, inside / 16)
      }
    }
  }
  const gray = new Uint8Array(px.width * px.height)
  for (let i = 0; i < gray.length; i++) gray[i] = Math.round(ground + (dot - ground) * cover[i]!)
  // A line of heavy writing across the middle: the dots under it are not what is being asked about.
  const y0 = Math.round(px.height * 0.5)
  for (let y = y0; y < y0 + 6; y++) for (let x = Math.round(px.width * 0.2); x < Math.round(px.width * 0.8); x++) gray[y * px.width + x] = 30
  return gray
}

/** The Page picture's size: what `takeFromSheet` makes it (the sheet stands for a page of its own shape). */
const units = { width: 1000, height: 625 }
const pageSize = shapeSize(resolveShape(1.6, null), false)

/** As prepareForReading looks for the grid: at most GRID_SEARCH_WIDTH across. */
function asSearched(region: { x: number; y: number; width: number; height: number }) {
  const onPage = { width: region.width * pageSize.width, height: region.height * pageSize.height }
  const s = Math.min(1, GRID_SEARCH_WIDTH / onPage.width)
  const px = { width: Math.round(onPage.width * s), height: Math.round(onPage.height * s) }
  const view = { x: region.x * units.width, y: region.y * units.height, width: region.width * units.width, height: region.height * units.height }
  return { px, gray: pagePicture(DEFAULT_PAPER, units, view, px) }
}

describe("the sheet's dot-grid paper, in a Page picture Aa reads", () => {
  // KNOWN GAP (docs/TODO.md): a Page picture of a BOXED PART of the sheet is not cut down to GRID_SEARCH_WIDTH, so its
  // dots stay at the page's scale (radius 1.56 units x 1.92 px = 3 px, 7 px across once anti-aliased) - over the
  // lattice's size limit for a picture that small (`dotLattice`: the Mac's max(6, short side / 80)). The grid is not
  // found and the dots go to the reader as they are. Pinned here so a fix shows up; the whole sheet is fine.
  it("a boxed part of it: the grid is NOT found (the known gap)", () => {
    const region = { x: 0.3, y: 0.3, width: 0.35, height: 0.35 }
    const { px, gray } = asSearched(region)
    const page = readingPageOf(gray, px.width, px.height)!
    expect(page.marks.lattice).toBeNull()
  })

  for (const [name, region] of [
    ["the whole sheet", { x: 0, y: 0, width: 1, height: 1 }],
    ["a big part of it", { x: 0.05, y: 0.05, width: 0.9, height: 0.9 }],
  ] as const) {
    it(`${name}: the dots are found as a grid and painted out, the writing is not`, () => {
      const { px, gray } = asSearched(region)
      const page = readingPageOf(gray, px.width, px.height)!
      expect(page).not.toBeNull()
      const lattice = page.marks.lattice
      expect(lattice, "the grid is found").not.toBeNull()
      const dots = paperMarks(DEFAULT_PAPER, units).dots.filter((one) =>
        one.x >= region.x * units.width && one.x <= (region.x + region.width) * units.width
        && one.y >= region.y * units.height && one.y <= (region.y + region.height) * units.height).length
      // Nearly every printed dot is on it (the ones the writing touches, or cut at the edge, may not be).
      expect(lattice!.size).toBeGreaterThan(dots * 0.8)
      const rgba = new Uint8ClampedArray(px.width * px.height * 4)
      for (let i = 0; i < gray.length; i++) { rgba[i * 4] = rgba[i * 4 + 1] = rgba[i * 4 + 2] = gray[i]!; rgba[i * 4 + 3] = 255 }
      expect(paintOutDots(rgba, px.width, px.height, gray, page)).toBe(true)
      // What is left darker than the paper is the writing.
      let dark = 0, darkOffWriting = 0
      const y0 = Math.round(px.height * 0.5)
      for (let y = 0; y < px.height; y++) for (let x = 0; x < px.width; x++) {
        if (rgba[(y * px.width + x) * 4]! > 200) continue
        dark++
        if (y < y0 - 3 || y > y0 + 8) darkOffWriting++
      }
      expect(dark).toBeGreaterThan(0)
      expect(darkOffWriting, "no printed dot is left to read as a full stop").toBe(0)
    })
  }
})
