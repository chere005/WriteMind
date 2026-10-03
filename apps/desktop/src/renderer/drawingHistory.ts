/**
 * The drawing layer's undo, held where the app can reach it.
 *
 * It used to live inside the canvas and answer only to a private key
 * (⌥⌘Z on the layer). The app's own Undo — Ctrl+Z, and Edit ▸ Undo in the
 * menu — has to be able to take back a picture that was pasted or a chart
 * that came off the camera, none of which the canvas itself ever sees, so the
 * stacks are a thing of their own and everyone who changes the drawing
 * records into the same one.
 *
 * Each entry knows WHEN it was made: that is what lets one Undo serve two
 * histories — the note's text and its drawing — by taking back whichever of
 * the two was edited last (`useUndo.ts`).
 */

import type { Drawing } from "@writemind/core"

interface Entry { drawing: Drawing; at: number }

export class DrawingHistory {
  private past: Entry[] = []
  private future: Entry[] = []

  get canUndo(): boolean { return this.past.length > 0 }
  get canRedo(): boolean { return this.future.length > 0 }
  /** When the edit an Undo would take back was made (performance.now); 0 when there is none. */
  get topAt(): number { return this.past.at(-1)?.at ?? 0 }

  /** `before` is what the drawing was just before an edit. */
  record(before: Drawing): void {
    this.past.push({ drawing: before, at: performance.now() })
    if (this.past.length > 200) this.past.shift()
    this.future = []
  }

  /** The drawing to go back to, or null; `current` is kept for Redo. */
  undo(current: Drawing): Drawing | null {
    const back = this.past.pop()
    if (!back) return null
    this.future.push({ drawing: current, at: back.at })
    return back.drawing
  }

  redo(current: Drawing): Drawing | null {
    const forward = this.future.pop()
    if (!forward) return null
    this.past.push({ drawing: current, at: forward.at })
    return forward.drawing
  }

  clear(): void {
    this.past = []
    this.future = []
  }
}
