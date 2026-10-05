/**
 * Zooming the video pane into a box that was dragged on it, and the rule that
 * says what a gesture on the picture means.
 *
 * Ported from `WriteMind/Camera/CameraZoom.swift` and `SectionBox.action` in
 * `WriteMind/Views/CameraPane.swift` (Sean, 2026-09-19: "drag a square to
 * resize camera"). The box is kept in PANE fractions of the unzoomed picture,
 * so it survives the pane being resized, and everything else — what the
 * capture button brings in, where a section drawn on the zoomed picture
 * really is — comes from these functions and their inverses.
 */

import type { Point, Rect } from "../drawing/shapes"
import type { Size } from "../drawing/geometry"

/** Nothing smaller than this can be zoomed into: a stray click is not a box. */
export const ZOOM_MINIMUM_SIDE = 0.04

export const zoomIsUsable = (box: Rect): boolean =>
  box.width >= ZOOM_MINIMUM_SIDE && box.height >= ZOOM_MINIMUM_SIDE && box.width <= 1 && box.height <= 1

/** The box in the pane's own points. */
export const zoomRect = (box: Rect, pane: Size): Rect => ({
  x: box.x * pane.width, y: box.y * pane.height, width: box.width * pane.width, height: box.height * pane.height,
})

/** How much the picture grows so the box fills the pane. */
export function zoomScale(box: Rect, pane: Size): number {
  const area = zoomRect(box, pane)
  if (area.width <= 1 || area.height <= 1 || pane.width <= 1 || pane.height <= 1) return 1
  return Math.min(pane.width / area.width, pane.height / area.height)
}

/** Where the picture moves to, scaled about the pane's centre, so the box ends up in the middle. */
export function zoomOffset(box: Rect, pane: Size): Size {
  const area = zoomRect(box, pane)
  const factor = zoomScale(box, pane)
  return {
    width: (pane.width / 2 - (area.x + area.width / 2)) * factor,
    height: (pane.height / 2 - (area.y + area.height / 2)) * factor,
  }
}

/** A point on the ZOOMED pane, where it is on the unzoomed picture. */
export function unzoomedPoint(point: Point, box: Rect, pane: Size): Point {
  const area = zoomRect(box, pane)
  const factor = zoomScale(box, pane)
  if (factor <= 0) return point
  return {
    x: area.x + area.width / 2 + (point.x - pane.width / 2) / factor,
    y: area.y + area.height / 2 + (point.y - pane.height / 2) / factor,
  }
}

const spanning = (a: Point, b: Point): Rect => ({
  x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), width: Math.abs(b.x - a.x), height: Math.abs(b.y - a.y),
})

/** The same for a box dragged on the zoomed picture. */
export function unzoomedRect(rect: Rect, box: Rect, pane: Size): Rect {
  return spanning(
    unzoomedPoint({ x: rect.x, y: rect.y }, box, pane),
    unzoomedPoint({ x: rect.x + rect.width, y: rect.y + rect.height }, box, pane))
}

/**
 * The other way: a point on the UNZOOMED picture, where it is drawn on the
 * zoomed pane. The exact inverse of `unzoomedPoint`.
 */
export function zoomedPoint(point: Point, box: Rect, pane: Size): Point {
  const area = zoomRect(box, pane)
  const factor = zoomScale(box, pane)
  return {
    x: pane.width / 2 + (point.x - (area.x + area.width / 2)) * factor,
    y: pane.height / 2 + (point.y - (area.y + area.height / 2)) * factor,
  }
}

export function zoomedRect(rect: Rect, box: Rect, pane: Size): Rect {
  return spanning(
    zoomedPoint({ x: rect.x, y: rect.y }, box, pane),
    zoomedPoint({ x: rect.x + rect.width, y: rect.y + rect.height }, box, pane))
}

/** A new box dragged while already zoomed in, as a fraction of the WHOLE picture — so zooming twice keeps working. */
export function composeZoom(dragged: Rect, current: Rect | null, pane: Size): Rect | null {
  if (pane.width <= 1 || pane.height <= 1) return null
  const inPane = current ? unzoomedRect(dragged, current, pane) : dragged
  const x0 = Math.max(0, inPane.x / pane.width), y0 = Math.max(0, inPane.y / pane.height)
  const x1 = Math.min(1, (inPane.x + inPane.width) / pane.width)
  const y1 = Math.min(1, (inPane.y + inPane.height) / pane.height)
  if (x1 <= x0 || y1 <= y0) return null
  const clamped = { x: x0, y: y0, width: x1 - x0, height: y1 - y0 }
  return zoomIsUsable(clamped) ? clamped : null
}

// MARK: - what a gesture on the picture means

/** Four points of slack, so a click stays a click. */
export const isBoxDrag = (dx: number, dy: number): boolean => Math.max(Math.abs(dx), Math.abs(dy)) >= 4

export type BoxAction = "keep" | "clear" | "whole" | "fullWindow"

/**
 * What the end of a gesture means (`SectionBox.action`, Mac commit 0edfc08). A
 * drag leaves its box alone. TWO CLICKS FILL THE WINDOW WITH THE PICTURE and two
 * more put it back (Sean, 2026-09-21: "doubleclick the camera to make the whole
 * window the camera.. double click again to exit"). One click clears a box, and
 * — with no box to clear — takes the whole picture, which is the gesture the
 * double-click used to be: the capture buttons only appear once something is
 * boxed, so without it the only way to photograph the whole frame was to drag a
 * box round all of it by hand.
 *
 * The second click of a double arrives as its own event, so the first has
 * already done its half by then — which is what makes the clearing instant.
 * (The window filled is the app's own window, never the display: nothing in
 * this app goes full screen.)
 */
export function boxAction(dx: number, dy: number, clicks: number, hasBox: boolean): BoxAction {
  if (isBoxDrag(dx, dy)) return "keep"
  if (clicks >= 2) return "fullWindow"
  return hasBox ? "clear" : "whole"
}
