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
 * Each entry carries its STAMP on the note's `EditClock`: that is what lets one
 * Undo serve two histories — the note's words and its drawing — by taking back
 * whichever of the two has the newest edit (`editTimeline.ts`, `useUndo.ts`).
 */

import type { Drawing } from "@writemind/core"
import { EditClock } from "./editTimeline"

/** `at` is the edit's stamp on the note's clock; `undoneAt` is when an Undo took it (future only). */
interface Entry { drawing: Drawing; at: number; undoneAt?: number }

export class DrawingHistory {
  private past: Entry[] = []
  private future: Entry[] = []

  /** The clock the words' history stamps its edits from too (editTimeline.ts). */
  constructor(readonly clock: EditClock = new EditClock()) {}

  get canUndo(): boolean { return this.past.length > 0 }
  /** Whether the drawing's OWN Redo (Edit ▸ Redo Drawing) has anything. */
  get canRedo(): boolean { return this.future.length > 0 }
  /** The stamp of the edit an Undo would take back; null when there is none. */
  get undoStamp(): number | null { return this.past.at(-1)?.at ?? null }
  /**
   * The stamp of the edit the app's Redo would bring back — null when there is
   * none, or when a newer edit (of either side) has come since it was undone.
   */
  redoStamp(clock: EditClock = this.clock): number | null {
    const top = this.future.at(-1)
    return top && (top.undoneAt ?? 0) > clock.lastEdit ? top.at : null
  }

  /** `before` is what the drawing was just before an edit. */
  record(before: Drawing): void {
    this.past.push({ drawing: before, at: this.clock.edit() })
    if (this.past.length > 200) this.past.shift()
    this.future = []
  }

  /**
   * An edit that arrives in BURSTS (an arrow key held, a colour dragged, a width slid): one undo for the burst.
   * `before` is the drawing just before THIS edit; it is recorded only when the edit begins a burst, and an
   * edit that carries one on makes no entry. A burst carries on while it is quick (`gap` ms between edits) AND
   * its own entry is still the newest thing on both histories: another edit (the words', a paste) moves the
   * clock, and an Undo or Redo ends it. (A nudge after an Undo used to join the burst whose entry the Undo had
   * just taken: it applied with NO entry, killed no Redo, and the next Undo took away the whole object.)
   * Returns whether it recorded.
   */
  recordBurst(before: Drawing, now: number, gap = 900): boolean {
    const burst = this.burst
    if (burst && now - burst.at <= gap && this.clock.lastEdit === burst.lastEdit && this.undoStamp === burst.entry) {
      burst.at = now
      return false
    }
    this.record(before)
    this.burst = { at: now, lastEdit: this.clock.lastEdit, entry: this.undoStamp }
    return true
  }
  private burst: { at: number; lastEdit: number; entry: number | null } | null = null

  /** The drawing to go back to, or null; `current` is kept for Redo. */
  undo(current: Drawing): Drawing | null {
    this.burst = null
    const back = this.past.pop()
    if (!back) return null
    this.future.push({ drawing: current, at: back.at, undoneAt: this.clock.tick() })
    return back.drawing
  }

  redo(current: Drawing): Drawing | null {
    this.burst = null
    const forward = this.future.pop()
    if (!forward) return null
    this.past.push({ drawing: current, at: forward.at })
    return forward.drawing
  }

  clear(): void {
    this.past = []
    this.future = []
    this.pending = null
    this.burst = null
  }

  /**
   * Objects the app just put on the layer (a pasted picture, a capture) that
   * should arrive picked up, with the handles on them — the canvas owns the
   * selection, and takes this the next time the drawing changes.
   */
  private pending: string[] | null = null
  select(ids: string[]): void { this.pending = ids }
  /** The ids waiting to be picked, once every one of them is on the layer; null otherwise. */
  takeSelection(has: (id: string) => boolean): string[] | null {
    const ids = this.pending
    if (!ids || !ids.every(has)) return null
    this.pending = null
    return ids
  }
}
