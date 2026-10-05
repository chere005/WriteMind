import { describe, expect, it } from "vitest"
import {
  boxAction, composeZoom, displayedFrame, isBoxDrag, quarterTurned, regionOf, unzoomedPoint, unzoomedRect,
  zoomIsUsable, zoomOffset, zoomScale, zoomedPoint, zoomedRect,
} from "../src/index"

/**
 * Transcribed from `WriteMindTests/CameraZoomTests.swift` (CameraZoomTests and
 * SectionBoxGestureTests) and `CameraZoomBoxTests.swift`, plus the quarter-turn
 * test of `NotebookCaptureTests.swift` (`testAQuarterTurnKeepsTheFrameAtTheOrigin`).
 */
const pane = { width: 800, height: 600 }
const box = (x: number, y: number, width: number, height: number) => ({ x, y, width, height })

describe("zooming the video pane into a dragged box", () => {
  it("the box is blown up until it fills the pane", () => {
    const half = box(0.25, 0.25, 0.5, 0.5)   // 400 x 300 in the middle
    expect(zoomScale(half, pane)).toBeCloseTo(2, 3)
    const offset = zoomOffset(half, pane)    // already centred, so it does not have to move
    expect(offset.width).toBeCloseTo(0, 3)
    expect(offset.height).toBeCloseTo(0, 3)
  })

  it("a box off to one side is brought to the middle", () => {
    const offset = zoomOffset(box(0, 0, 0.5, 0.5), pane)
    expect(offset.width).toBeCloseTo(400, 3)
    expect(offset.height).toBeCloseTo(300, 3)
  })

  it("a point on the zoomed pane is found on the real picture", () => {
    const half = box(0.25, 0.25, 0.5, 0.5)
    const middle = unzoomedPoint({ x: 400, y: 300 }, half, pane)
    expect(middle.x).toBeCloseTo(400, 3)
    expect(middle.y).toBeCloseTo(300, 3)
    const corner = unzoomedPoint({ x: 0, y: 0 }, half, pane)
    expect(corner.x).toBeCloseTo(200, 3)
    expect(corner.y).toBeCloseTo(150, 3)
  })

  it("a rectangle drawn on the zoomed pane comes back smaller", () => {
    const real = unzoomedRect(box(200, 150, 400, 300), box(0.25, 0.25, 0.5, 0.5), pane)
    expect(real.width).toBeCloseTo(200, 3)   // half the size, since the pane is doubled
    expect(real.height).toBeCloseTo(150, 3)
  })

  it("zooming twice composes into one box of the whole picture", () => {
    const first = composeZoom(box(200, 150, 400, 300), null, pane)!
    expect(first).toEqual(box(0.25, 0.25, 0.5, 0.5))
    // Now the middle half of the ZOOMED pane: a quarter of the picture.
    const second = composeZoom(box(200, 150, 400, 300), first, pane)!
    expect(second.width).toBeCloseTo(0.25, 3)
    expect(second.height).toBeCloseTo(0.25, 3)
    expect(second.x + second.width / 2).toBeCloseTo(0.5, 3)   // still round the middle
  })

  it("a speck of a box is not a zoom", () => {
    expect(composeZoom(box(10, 10, 4, 4), null, pane)).toBeNull()
    expect(zoomIsUsable(box(0, 0, 0.01, 0.5))).toBe(false)
    expect(zoomIsUsable(box(0, 0, 0.2, 0.2))).toBe(true)
  })

  it("a box dragged past the edge is clipped", () => {
    const clipped = composeZoom(box(-100, -100, 400, 300), null, pane)!
    expect(clipped.x).toBeCloseTo(0, 3)
    expect(clipped.y).toBeCloseTo(0, 3)
  })

  it("no zoom means no change", () => {
    expect(zoomScale(box(0, 0, 1, 1), pane)).toBeCloseTo(1, 3)
  })
})

describe("a box round the whole picture", () => {
  it("the picture is fitted inside a pane of a different shape", () => {
    // A 16:9 camera in a 4:3 pane: full width, bars above and below.
    const shown = displayedFrame({ width: 1920, height: 1080 }, pane)
    expect(shown.width).toBeCloseTo(800, 3)
    expect(shown.height).toBeCloseTo(450, 3)
    expect(shown.y).toBeCloseTo(75, 3)   // centred, so the bars are equal
    expect(shown.height).toBeLessThan(pane.height)
  })

  it("zoomed is the exact inverse of unzoomed", () => {
    const half = box(0.25, 0.25, 0.5, 0.5)
    for (const point of [{ x: 0, y: 0 }, { x: 400, y: 300 }, { x: 799, y: 599 }]) {
      const back = unzoomedPoint(zoomedPoint(point, half, pane), half, pane)
      expect(back.x).toBeCloseTo(point.x, 4)
      expect(back.y).toBeCloseTo(point.y, 4)
    }
  })

  it("the zoomed box round-trips as a rectangle too", () => {
    const zoom = box(0.1, 0.2, 0.4, 0.4)
    const picture = displayedFrame({ width: 1920, height: 1080 }, pane)
    const back = unzoomedRect(zoomedRect(picture, zoom, pane), zoom, pane)
    expect(back.x).toBeCloseTo(picture.x, 3)
    expect(back.y).toBeCloseTo(picture.y, 3)
    expect(back.width).toBeCloseTo(picture.width, 3)
    expect(back.height).toBeCloseTo(picture.height, 3)
  })

  it("a zoomed-in picture is drawn bigger than the pane", () => {
    const picture = displayedFrame({ width: 1600, height: 1200 }, pane)
    const drawn = zoomedRect(picture, box(0.25, 0.25, 0.25, 0.25), pane)
    expect(drawn.width).toBeGreaterThan(pane.width)
  })

  it("the whole-picture box captures the whole picture", () => {
    const frame = { width: 1920, height: 1080 }
    const region = regionOf(displayedFrame(frame, pane), frame, pane)!
    expect(region.x).toBeCloseTo(0, 3)
    expect(region.y).toBeCloseTo(0, 3)
    expect(region.width).toBeCloseTo(1, 3)
    expect(region.height).toBeCloseTo(1, 3)
  })
})

// SectionBoxGestureTests (WriteMindTests/CameraZoomTests.swift, as changed by Mac commit 0edfc08).
describe("what a gesture on the camera picture means", () => {
  it("a drag leaves its box alone", () => {
    expect(boxAction(40, 3, 1, true)).toBe("keep")
    expect(boxAction(0, -30, 1, false)).toBe("keep")
  })

  it("one click clears the box and, with no box, takes the whole picture", () => {
    expect(boxAction(0, 0, 1, true)).toBe("clear")
    expect(boxAction(2, 2, 1, true)).toBe("clear")   // two points of wobble is still a click
    // The gesture the double-click used to be: the capture buttons only appear once something is
    // boxed, so without this the whole frame could only be had by dragging a box round it.
    expect(boxAction(0, 0, 1, false)).toBe("whole")
  })

  // Sean, 2026-09-21: "doubleclick the camera to make the whole window the camera.. double click again to exit".
  it("two clicks fill the window whatever is boxed", () => {
    expect(boxAction(0, 0, 2, false)).toBe("fullWindow")
    expect(boxAction(0, 0, 2, true)).toBe("fullWindow")
    expect(boxAction(0, 0, 3, false)).toBe("fullWindow")
  })

  it("four points of slack, so a click stays a click", () => {
    expect(isBoxDrag(3.9, 3.9)).toBe(false)
    expect(isBoxDrag(4, 0)).toBe(true)
    // A double-click that wobbled three points is still a double-click.
    expect(boxAction(3, 1, 2, true)).toBe("fullWindow")
  })
})

describe("turning the picture a quarter turn", () => {
  // A 3x2 picture: a top row of red, green, blue and a bottom row of white, black, yellow.
  const rgba = (...cells: number[][]): Uint8ClampedArray =>
    Uint8ClampedArray.from(cells.flatMap((c) => [c[0]!, c[1]!, c[2]!, 255]))
  const R = [255, 0, 0], G = [0, 255, 0], B = [0, 0, 255], Wh = [255, 255, 255], K = [0, 0, 0], Y = [255, 255, 0]
  const picture = rgba(R, G, B, Wh, K, Y)
  const cells = (data: Uint8ClampedArray): number[][] =>
    Array.from({ length: data.length / 4 }, (_, i) => [data[i * 4]!, data[i * 4 + 1]!, data[i * 4 + 2]!])

  it("a quarter turn swaps the width and the height and keeps the picture whole", () => {
    const turned = quarterTurned(picture, 3, 2, 1)
    expect([turned.width, turned.height]).toEqual([2, 3])
    expect(turned.data.length).toBe(2 * 3 * 4)
    const same = quarterTurned(picture, 3, 2, 0)
    expect([same.width, same.height]).toEqual([3, 2])
    expect(Array.from(same.data)).toEqual(Array.from(picture))
  })

  it("clockwise: what was the left column becomes the top row", () => {
    // Turned 90 degrees clockwise, the top-left (red) goes to the top-right, the bottom-left (white) to the top-left.
    expect(cells(quarterTurned(picture, 3, 2, 1).data)).toEqual([Wh, R, K, G, Y, B])
  })

  it("two turns is upside down, three is one turn back", () => {
    expect(cells(quarterTurned(picture, 3, 2, 2).data)).toEqual([Y, K, Wh, B, G, R])
    expect(cells(quarterTurned(picture, 3, 2, 3).data)).toEqual([B, Y, G, K, R, Wh])
    const back = quarterTurned(quarterTurned(picture, 3, 2, 3).data, 2, 3, 1)
    expect(Array.from(back.data)).toEqual(Array.from(picture))
  })

  it("a turn of -1 is three and four is none", () => {
    expect(Array.from(quarterTurned(picture, 3, 2, -1).data)).toEqual(Array.from(quarterTurned(picture, 3, 2, 3).data))
    expect(Array.from(quarterTurned(picture, 3, 2, 4).data)).toEqual(Array.from(picture))
  })
})
