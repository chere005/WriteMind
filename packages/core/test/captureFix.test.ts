import { describe, expect, it } from "vitest"
import {
  capturePlacedCentre, flowChartItems, inkMask, isPlausiblePage, placement,
} from "../src/index"
import { Canvas } from "./raster"

/** The camera lane's second round: what the tablet's e2e and the verifiers found (port-only tests). */

/** The tablet's sheet as it is read: three boxes and two arrows drawn right across it, black on white. */
function sheetChart(): { gray: Uint8Array; width: number; height: number } {
  const width = 1200, height = 775
  const c = new Canvas(width, height)
  c.lineWidth = 6
  const boxes = [90, 485, 880]
  for (const x of boxes) c.strokeRect(x, 245, 235, 120)
  for (let i = 0; i < 2; i++) {
    const x0 = boxes[i]! + 235, x1 = boxes[i + 1]!
    c.line({ x: x0, y: 305 }, { x: x1, y: 305 })
    c.line({ x: x1 - 24, y: 285 }, { x: x1, y: 305 }); c.line({ x: x1 - 24, y: 325 }, { x: x1, y: 305 })
  }
  const gray = new Uint8Array(width * height)
  for (let i = 0; i < gray.length; i++) gray[i] = c.data[i]!
  return { gray, width, height }
}

describe("a chart drawn right across the tablet's sheet", () => {
  it("is one mark nearly as wide as the picture: a camera takes that for the page's edge, the sheet has none", () => {
    const { gray, width, height } = sheetChart()
    const camera = inkMask(gray, width, height)
    expect(camera.reduce((n, v) => n + v, 0)).toBe(0)
    const sheet = inkMask(gray, width, height, { keepEdges: true })
    expect(sheet.reduce((n, v) => n + v, 0)).toBeGreaterThan(10000)
  })
  it("reads as three nodes and two arrows", () => {
    const { gray, width, height } = sheetChart()
    const mask = inkMask(gray, width, height, { keepEdges: true })
    const found = flowChartItems(mask, width, height, [], { width: 800, height: 600 }, "#000000", 2)
    expect(found.filter((item) => item.kind === "shape")).toHaveLength(3)
    const connectors = found.flatMap((item) => (item.kind === "connector" ? [item.connector] : []))
    expect(connectors).toHaveLength(2)
    expect(connectors.every((one) => one.startNode !== null && one.endNode !== null)).toBe(true)
  })
})

describe("a pane with no size (View > Hide Notes Pane)", () => {
  it("places a capture at finite numbers, not NaN", () => {
    const where = placement({
      frame: { x: 100, y: 100, width: 400, height: 300 }, pageSize: { width: 1200, height: 1600 },
      pane: { width: 0, height: 0 }, nudge: 0,
    })
    expect(Number.isFinite(where.center.x) && Number.isFinite(where.center.y) && Number.isFinite(where.width)).toBe(true)
    const centre = capturePlacedCentre({ center: where.center, width: where.width, aspect: 0.75, pane: { width: 0, height: 0 }, scroll: 0 })
    expect(Number.isFinite(centre.x) && Number.isFinite(centre.y)).toBe(true)
  })
})

describe("corners dragged by hand (isPlausiblePage)", () => {
  const quad = (a: [number, number], b: [number, number], c: [number, number], d: [number, number]) => ({
    topLeft: { x: a[0], y: a[1] }, topRight: { x: b[0], y: b[1] },
    bottomRight: { x: c[0], y: c[1] }, bottomLeft: { x: d[0], y: d[1] },
  })
  it("a page is one", () => {
    expect(isPlausiblePage(quad([100, 80], [500, 90], [520, 600], [90, 590]))).toBe(true)
  })
  it("a sliver is not (310 px by 8 px froze the page for 4 seconds)", () => {
    expect(isPlausiblePage(quad([100, 100], [410, 100], [410, 108], [100, 108]))).toBe(false)
    expect(isPlausiblePage(quad([100, 100], [410, 100], [410, 100], [100, 100]))).toBe(false)
  })
  it("a crossed (bow-tie) or mirrored set is not (it would capture a mirrored page)", () => {
    expect(isPlausiblePage(quad([100, 80], [500, 600], [520, 90], [90, 590]))).toBe(false)
    expect(isPlausiblePage(quad([500, 90], [100, 80], [90, 590], [520, 600]))).toBe(false)
  })
  it("a corner that is not a number is not", () => {
    expect(isPlausiblePage(quad([NaN, 80], [500, 90], [520, 600], [90, 590]))).toBe(false)
  })
})
