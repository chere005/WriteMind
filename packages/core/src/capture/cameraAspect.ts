/**
 * WHAT SHAPE THE VIEWFINDER IS (Sean, 2026-09-21: "add aspect ratio control",
 * then "aspect ratio control should be in the video input dropdown"). Ported
 * from `WriteMind/Camera/CameraAspect.swift` (Mac commit c98c067).
 *
 * A ratio here is the SHAPE OF THE VIEWFINDER, not a crop of the camera's own
 * frame and not a setting on the device. The pane lays the whole camera view
 * out inside the largest rectangle of this shape that fits in it, and
 * everything that already worked in pane points — the box you drag, the zoom,
 * what the capture button brings in — goes on working unchanged inside that
 * rectangle, because it is the rectangle they are measured against.
 *
 * Both orientations are on the list rather than a ratio plus a flip: a page is
 * photographed upright and a whiteboard sideways, and which one you want is not
 * a modifier of the other. `free` is the picture as the camera hands it over,
 * which is what the app did before there was a choice.
 */

import type { Size } from "../drawing/geometry"

/** The stored names are the Mac's raw values: the choice is remembered, so they are a stored format. */
export type CameraAspect =
  | "free" | "square" | "fourThree" | "threeFour" | "threeTwo" | "twoThree" | "sixteenNine" | "nineSixteen"

/** Every shape, in the Mac's order (`CameraAspect.allCases`). */
export const CAMERA_ASPECTS: readonly CameraAspect[] = [
  "free", "square", "fourThree", "threeFour", "threeTwo", "twoThree", "sixteenNine", "nineSixteen",
]

const TITLES: Record<CameraAspect, string> = {
  free: "Free", square: "1:1", fourThree: "4:3", threeFour: "3:4",
  threeTwo: "3:2", twoThree: "2:3", sixteenNine: "16:9", nineSixteen: "9:16",
}

const RATIOS: Record<CameraAspect, number | null> = {
  free: null, square: 1, fourThree: 4 / 3, threeFour: 3 / 4,
  threeTwo: 3 / 2, twoThree: 2 / 3, sixteenNine: 16 / 9, nineSixteen: 9 / 16,
}

export const cameraAspectTitle = (aspect: CameraAspect): string => TITLES[aspect]

/** Width over height. Null for `free`, which has no shape of its own. */
export const cameraAspectRatio = (aspect: CameraAspect): number | null => RATIOS[aspect]

/** Taller than it is wide — what the choices are grouped by, so the upright ones are together. */
export const isUprightAspect = (aspect: CameraAspect): boolean => (RATIOS[aspect] ?? 1) < 1

/** A remembered value made safe: anything that is not one of the names is `free`. */
export const parseCameraAspect = (raw: unknown): CameraAspect =>
  (CAMERA_ASPECTS as readonly unknown[]).includes(raw) ? raw as CameraAspect : "free"

/**
 * The largest rectangle of this shape that fits in the pane. `free` is the pane
 * itself, so nothing is given away when nothing is asked for.
 *
 * A pane too small to hold anything hands back what it was given: a zero-sized
 * viewfinder is a divider dragged shut, not a choice, and every coordinate
 * downstream divides by these numbers.
 */
export function fitAspect(aspect: CameraAspect, pane: Size): Size {
  const ratio = RATIOS[aspect]
  if (ratio === null || !(ratio > 0) || !(pane.width > 1) || !(pane.height > 1)) return pane
  const byWidth = { width: pane.width, height: pane.width / ratio }
  const byHeight = { width: pane.height * ratio, height: pane.height }
  return byWidth.height <= pane.height ? byWidth : byHeight
}
