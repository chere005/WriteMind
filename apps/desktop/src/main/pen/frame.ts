/**
 * main/pen/frame.ts - the 8 frame transforms, which of them keep the sheet LANDSCAPE, the default guess and the device key.
 * Pure: no Node, no Electron, no koffi.
 *
 * Nothing is detected and nothing is asked: the device's frame (`defaultFrame`) follows from its extents, and it never makes the sheet
 * portrait (`landscapeFrames`): the sheet is the tablet as it lies on the desk, wider than it is tall. The Orientation menu (a renderer
 * matter) turns it on top when the tablet lies another way.
 */
import { applyFrame, type FrameTransform } from "../../shared/pen"

export const FRAME_CANDIDATES: FrameTransform[] = ([0, 1, 2, 3] as const).flatMap((turn) => [false, true].map((flipY) => ({ turn, flipY })))

/** Does this frame swap the device's x and y (a quarter turn)? */
export const swapsAxes = (f: FrameTransform): boolean => f.turn % 2 === 1

/**
 * The frames under which a device of extents `rawX` x `rawY` (as Wintab reports them, which can be PORTRAIT on a landscape tablet) reads
 * LANDSCAPE: width of the sheet at least its height. Square or unknown extents allow all 8.
 */
export function landscapeFrames(rawX: number | null, rawY: number | null): FrameTransform[] {
  if (!rawX || !rawY || rawX <= 0 || rawY <= 0 || rawX === rawY) return FRAME_CANDIDATES
  const swapNeeded = rawX < rawY
  return FRAME_CANDIDATES.filter((f) => swapsAxes(f) === swapNeeded)
}

/**
 * The device's frame, always landscape. Wintab's y points UP, so y is mirrored; a device that reports PORTRAIT extents on a landscape
 * tablet (Sean's Intuos S, CTL-472: x 0..9499, y 0..15199) is also turned a quarter. Checked on that tablet (2026-10-05): with it in
 * Portrait (flipped), "1 2 / 3 4" written in its four corners came out mirrored top-to-bottom under {turn 1, NO flipY}, and the Orientation
 * menu only TURNS, so a wrong mirror here can never be fixed there. (That morning's two-touch calibration had picked the mirrored frame
 * because the tablet was lying in portrait while it assumed landscape.)
 */
export function defaultFrame(rawX: number | null, rawY: number | null): FrameTransform {
  const portrait = rawX !== null && rawY !== null && rawX < rawY
  return portrait ? { turn: 1, flipY: true } : { turn: 0, flipY: true }
}

/** The persistence key of a device: family:deviceName:rawXxrawY. */
export function frameKey(family: string, name: string, rawX: number | null, rawY: number | null): string {
  return family + ":" + name + ":" + (rawX ?? "?") + "x" + (rawY ?? "?")
}

/** The device's raw axis lengths (max - min), or null when unknown. */
export function deviceExtents(device: { rawX: [number, number] | null; rawY: [number, number] | null } | null): { width: number | null; height: number | null } {
  if (!device) return { width: null, height: null }
  const w = device.rawX ? Math.abs(device.rawX[1] - device.rawX[0]) : null
  const h = device.rawY ? Math.abs(device.rawY[1] - device.rawY[0]) : null
  return { width: w, height: h }
}

/** The sheet's long side over its short side for a device (>= 1); 1.6 when unknown. */
export function tabletAspect(width: number | null, height: number | null): number {
  if (!width || !height || width <= 0 || height <= 0) return 1.6
  return Math.round((Math.max(width, height) / Math.min(width, height)) * 1000) / 1000
}

/** A device point (0..1 over the active area, y as the driver gives it) in the sheet's frame, clamped. Re-exported for the manager and the tests. */
export function toSheet(x: number, y: number, f: FrameTransform): [number, number] {
  const [u, v] = applyFrame(x, y, f)
  return [u < 0 ? 0 : u > 1 ? 1 : u, v < 0 ? 0 : v > 1 ? 1 : v]
}
