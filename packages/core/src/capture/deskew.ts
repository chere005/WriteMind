/**
 * Putting a picture, and the boxes a reader drew on it, in the SAME frame.
 *
 * Windows' OCR engine straightens a tilted picture before it reads and reports
 * every line and word box in the STRAIGHTENED frame, together with the angle it
 * turned by (`OcrResult.TextAngle`, degrees, positive = the text runs downhill,
 * i.e. clockwise on screen). The picture's own pixels are not straightened, so
 * the ink under a word's box is somewhere else: a 5 degree page puts the end
 * of a line 56 pixels away from where its box says, and every rule that looks
 * at the ink under a box (a bar through a word, an arrow in a gap, a ring)
 * misfires. Vision on the Mac gives no angle and nothing here changes for it.
 *
 * Two ways to bring the two together, and each caller takes the cheaper one:
 *   - the INK is turned the way the engine turned the picture (`deskewGray`),
 *     which is what the marks of a whole page want: the boxes then sit on the
 *     ink, lines are horizontal again, and the rules need no idea of a tilt;
 *   - a BOX is turned back (`boxToPicture`), which is what a word standing on
 *     its own wants (the flow chart's labels).
 * Both turn about the picture's centre.
 */

import type { Rect } from "../drawing/shapes"

/** Below this the engine's own estimate is noise and nothing is turned. */
export const MIN_SKEW_DEGREES = 0.4

/** The angle to act on: null, not finite or negligible is no angle at all. */
export function usableAngle(degrees: number | null | undefined): number {
  if (typeof degrees !== "number" || !Number.isFinite(degrees)) return 0
  // A page never reads at more than a quarter turn; anything wilder is not a tilt.
  if (Math.abs(degrees) < MIN_SKEW_DEGREES || Math.abs(degrees) > 45) return 0
  return degrees
}

/** The most common level of a grey picture - the paper, whatever colour it is. */
export function paperLevel(gray: Uint8Array): number {
  const counts = new Uint32Array(256)
  // Every pixel of a big picture is not needed to know what the paper is.
  const step = Math.max(1, Math.floor(gray.length / 200000))
  let seen = 0
  for (let i = 0; i < gray.length; i += step) { counts[gray[i]!]!++; seen++ }
  let sum = 0
  for (let level = 0; level < 256; level++) {
    sum += counts[level]!
    if (sum * 2 >= seen) return level
  }
  return 255
}

/**
 * `gray` (top row first) turned back by `degrees` about its centre: the pixel
 * at p in the result is the pixel of the picture at R(degrees)(p - c) + c, with
 * R the clockwise turn on screen (y down). That is the frame a reader that
 * reported `angle = degrees` drew its boxes in. What the turn uncovers is filled
 * with the paper's own level so it is never mistaken for ink.
 */
export function deskewGray(gray: Uint8Array, width: number, height: number, degrees: number): Uint8Array {
  const out = new Uint8Array(width * height)
  const fill = paperLevel(gray)
  const radians = (degrees * Math.PI) / 180
  const cos = Math.cos(radians), sin = Math.sin(radians)
  const cx = width / 2, cy = height / 2
  for (let y = 0; y < height; y++) {
    const dy = y + 0.5 - cy
    for (let x = 0; x < width; x++) {
      const dx = x + 0.5 - cx
      // Pixel centres sit half a pixel in.
      const sx = cx + dx * cos - dy * sin - 0.5
      const sy = cy + dx * sin + dy * cos - 0.5
      const x0 = Math.floor(sx), y0 = Math.floor(sy)
      if (x0 < -1 || y0 < -1 || x0 >= width || y0 >= height) { out[y * width + x] = fill; continue }
      const fx = sx - x0, fy = sy - y0
      const at = (px: number, py: number): number =>
        (px < 0 || py < 0 || px >= width || py >= height) ? fill : gray[py * width + px]!
      const top = at(x0, y0) * (1 - fx) + at(x0 + 1, y0) * fx
      const bottom = at(x0, y0 + 1) * (1 - fx) + at(x0 + 1, y0 + 1) * fx
      out[y * width + x] = Math.round(top * (1 - fy) + bottom * fy)
    }
  }
  return out
}

/**
 * A box in the reader's straightened frame, as the box of the picture's own
 * pixels it covers: its four corners turned by `degrees` about the centre of a
 * `width` x `height` picture, then boxed. The same units in and out.
 */
export function boxToPicture(box: Rect, width: number, height: number, degrees: number): Rect {
  if (degrees === 0) return box
  const radians = (degrees * Math.PI) / 180
  const cos = Math.cos(radians), sin = Math.sin(radians)
  const cx = width / 2, cy = height / 2
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
  for (const [px, py] of [[box.x, box.y], [box.x + box.width, box.y], [box.x, box.y + box.height],
    [box.x + box.width, box.y + box.height]] as const) {
    const dx = px - cx, dy = py - cy
    const x = cx + dx * cos - dy * sin, y = cy + dx * sin + dy * cos
    if (x < minX) minX = x
    if (x > maxX) maxX = x
    if (y < minY) minY = y
    if (y > maxY) maxY = y
  }
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY }
}
