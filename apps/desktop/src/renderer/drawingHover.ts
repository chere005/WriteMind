/**
 * WHAT A CLICK WOULD TAKE, shown before the click (docs/TODO.md "Drawing polish", 2026-10-06; the Mac's `hovered`,
 * DrawingCanvas.swift `chromeIDs` / `handleIDs` / `hover(_:in:)`): the object under the pointer, on the page or in a
 * live drawing cell, while nothing is picked. The drawing layer (Canvas.tsx) draws its outline and its handles faintly;
 * nothing on hover changes the document, and a press on one of those handles picks the object first. A hovered picture
 * gets the outline only (Sean, 2026-09-18, on the Mac: "edit buttons on an image selection should only appear after
 * the image is clicked").
 *
 * Pure: the rules, for the layer and the tests.
 */

import type { CanvasItem } from "@writemind/core"

/** The object a click would take: its surface (the page, null, or an ink cell's id) and its id. */
export interface Hover { on: string | null; id: string }

/** The layer's mode (Canvas.tsx `CanvasMode`). */
type Mode = "cursor" | "pen"

/**
 * Whether hovering may show what a click would take: only where a plain press PICKS an object -- the cursor (the pen
 * up), or the Select tool -- with no button held, no Ctrl (that is the marquee), and no gesture, tool or pick of its
 * own under way (`busy`). Under the pen, with the eraser, or from a tablet pen that always draws, a press draws or rubs
 * out instead, and handles round a hovered object would promise a drag that does something else (the Mac: "Only the
 * cursor mode hovers").
 */
export function hoverWanted(at: {
  mode: Mode; pen: boolean; penDraws: boolean; selectTool: boolean; eraser: boolean; command: boolean
  buttons: number; busy: boolean
}): boolean {
  if (at.busy || at.buttons !== 0 || at.command || at.eraser) return false
  if (at.selectTool) return true
  return at.mode === "cursor" && !(at.pen && at.penDraws)
}

/** Whether a hovered object shows its handles too, or (a picture) its outline only. */
export const hoverHandles = (item: CanvasItem): boolean => item.kind !== "image"

/** The same hover, or not: a pointer moving over one object changes nothing (no render per pointer move). */
export const sameHover = (a: Hover | null, b: Hover | null): boolean =>
  a === b || (a !== null && b !== null && a.on === b.on && a.id === b.id)
