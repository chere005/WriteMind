// Transcribed from WriteMindTests/CameraAspectTests.swift (Mac commit c98c067): the shape of the viewfinder
// (Sean, 2026-09-21: "add aspect ratio control").
import { describe, expect, it } from "vitest"
import {
  CAMERA_ASPECTS, cameraAspectRatio, cameraAspectTitle, fitAspect, isUprightAspect, parseCameraAspect,
} from "../src/capture/cameraAspect"

const wide = { width: 800, height: 400 }
const tall = { width: 400, height: 800 }

describe("the shape of the viewfinder", () => {
  it("free hands the pane straight back", () => {
    expect(fitAspect("free", wide)).toEqual(wide)
    expect(fitAspect("free", tall)).toEqual(tall)
    expect(cameraAspectRatio("free")).toBeNull()
  })

  it("every shape is the largest one that fits", () => {
    for (const aspect of CAMERA_ASPECTS) {
      const ratio = cameraAspectRatio(aspect)
      if (ratio === null) continue
      for (const pane of [wide, tall, { width: 500, height: 500 }]) {
        const size = fitAspect(aspect, pane)
        expect(Math.abs(size.width / size.height - ratio), `${cameraAspectTitle(aspect)} in ${JSON.stringify(pane)}`).toBeLessThan(0.0001)
        expect(size.width).toBeLessThanOrEqual(pane.width + 0.001)
        expect(size.height).toBeLessThanOrEqual(pane.height + 0.001)
        // Largest: one side touches the pane.
        const touches = Math.abs(size.width - pane.width) < 0.001 || Math.abs(size.height - pane.height) < 0.001
        expect(touches, `${cameraAspectTitle(aspect)} in ${JSON.stringify(pane)} left room on both sides`).toBe(true)
      }
    }
  })

  it("a wide shape in a wide pane is held by its height", () => {
    // 16:9 in a 2:1 pane: the pane is wider than the shape, so the height is what runs out first.
    const size = fitAspect("sixteenNine", wide)
    expect(size.height).toBeCloseTo(400, 3)
    expect(size.width).toBeCloseTo(400 * 16 / 9, 3)
    // And the same shape in a tall pane is held by its width.
    expect(fitAspect("sixteenNine", tall).width).toBeCloseTo(400, 3)
  })

  it("the upright shapes are the upright ones", () => {
    const upright = CAMERA_ASPECTS.filter(isUprightAspect).map(cameraAspectTitle)
    expect(upright).toEqual(["3:4", "2:3", "9:16"])
    const across = CAMERA_ASPECTS.filter((one) => !isUprightAspect(one)).map(cameraAspectTitle)
    expect(across).toEqual(["Free", "1:1", "4:3", "3:2", "16:9"])
    expect(upright.length + across.length).toBe(CAMERA_ASPECTS.length)
  })

  // A pane dragged shut is not a choice, and every coordinate downstream divides by these numbers.
  it("a pane with no room in it hands back what it was given", () => {
    for (const pane of [{ width: 0, height: 0 }, { width: 1, height: 400 }, { width: 400, height: 0 }]) {
      expect(fitAspect("fourThree", pane)).toEqual(pane)
    }
  })

  // It is remembered, so the raw values are a stored format.
  it("every shape has a stable name", () => {
    expect([...CAMERA_ASPECTS]).toEqual(["free", "square", "fourThree", "threeFour",
      "threeTwo", "twoThree", "sixteenNine", "nineSixteen"])
    expect(parseCameraAspect("nonsense")).toBe("free")
    expect(parseCameraAspect(null)).toBe("free")
    expect(parseCameraAspect("nineSixteen")).toBe("nineSixteen")
  })
})
