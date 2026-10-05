/**
 * The page of a tablet sheet BOUND to an ink cell (cellSheets.ts). It is a `TabletPage` (the surface, the tabs, the
 * file treat it as any sheet) with three differences while it is bound:
 *
 * - It has NO undo of its own: every change it makes is one step of the NOTE's timeline, so the sheet's Undo (the
 *   button, Ctrl+Z over the sheet, the pen's double tap) falls through to the note's Undo (`tabletUndo` answers false).
 * - A stroke stops at the cell's frame (`frame`, fractions of the sheet): the sheet keeps the tablet's shape and the
 *   cell sits in it.
 * - Every change it makes is told to the binding (`CellPage.edited`), which writes it into the cell; the cell's own
 *   changes come back through `show` (no change is told for those, and the history is dropped).
 *
 * While its note is not the one in front (`away`, cellSheets.ts), its Undo / Redo are its OWN again, for what was
 * written since it went away (that is what will land), and are used up there even when there is nothing to take back:
 * they never reach the timeline of the note that IS in front.
 *
 * Once the cell or its note is gone, `ref` is null and it is a plain sheet again (its own undo, no frame).
 */

import type { InkCell, Rect } from "@writemind/core"
import { cellFrameOn, clampToFrame, newLinks, type Links } from "./cellSheet"
import type { CellRef } from "./sheetSet"
import { TabletPage, type InkStroke, type SheetOp } from "./tabletPage"

export class CellPage extends TabletPage {
  /** Told every change the sheet makes while bound (the binding writes it into the cell). */
  static edited: ((page: CellPage, op: SheetOp) => void) | null = null
  /** Told when the sheet's shape changes (the tablet turned): the cell is placed again. */
  static reshaped: ((page: CellPage) => void) | null = null
  /** Is this page's note not the one in front (cellSheets.ts)? */
  static away: ((page: CellPage) => boolean) | null = null

  /** The cell this sheet writes into; null once it is gone. */
  ref: CellRef | null
  /** Written on while the cell's note was not in front: it lands in the cell when the note is (kept on disk). */
  pending: boolean
  /** The tab this page belongs to. */
  readonly sheet: string
  readonly links: Links = newLinks()
  /** The cell as last shown or written, and the placement it was shown at (both the same: nothing to do). */
  seen: InkCell | null = null
  seenKey = ""
  /** The cell on this sheet, in fractions of the sheet; null until the cell's shape is known. */
  frame: Rect | null = null
  /** The cell's aspect (height / width) as last seen, kept on disk: its frame shows before its note is open. */
  shape: number | null
  /** An erase began (`mark`): its first rub starts the note's undo step, the others join it. */
  stepWaiting = false
  /** How deep the sheet's own history was when writing began to wait (`pending`): Undo away goes no further back. */
  awayDepth = 0

  constructor(aspect: number, sheet: string, ref: CellRef, pending = false, shape: number | null = null) {
    super(aspect)
    this.sheet = sheet
    this.ref = ref
    this.pending = pending
    this.shape = shape
    if (shape !== null) this.frame = cellFrameOn(this.aspect, shape)
    this.onOp((op) => { if (this.ref) CellPage.edited?.(this, op) })
  }

  /** Bound, and its note is not in front. */
  get isAway(): boolean { return !!this.ref && (this.pending || (CellPage.away?.(this) ?? false)) }
  private get ownSteps(): number { return this.pending ? this.exportState().past.length - this.awayDepth : 0 }

  override get canUndo(): boolean { return !this.ref ? super.canUndo : this.isAway && this.ownSteps > 0 }
  override get canRedo(): boolean { return !this.ref ? super.canRedo : this.isAway && this.pending && super.canRedo }
  override undo(): boolean {
    if (!this.ref) return super.undo()
    if (!this.isAway) return false
    if (this.ownSteps > 0) super.undo()
    return true
  }
  override redo(): boolean {
    if (!this.ref) return super.redo()
    if (!this.isAway) return false
    if (this.pending) super.redo()
    return true
  }

  /** Writing begins to wait for the note (`pending`); `marked`: the change that made it wait is already in the history. */
  beginWaiting(marked: boolean): void {
    if (this.pending) return
    this.pending = true
    this.awayDepth = Math.max(0, this.exportState().past.length - (marked ? 1 : 0))
  }

  override add(stroke: InkStroke): void {
    super.add(this.ref && this.frame ? clampToFrame(stroke, this.frame) : stroke)
  }

  override setAspect(aspect: number): void {
    const was = this.aspect
    super.setAspect(aspect)
    if (!this.ref || this.aspect === was) return
    if (this.shape !== null) this.frame = cellFrameOn(this.aspect, this.shape)
    CellPage.reshaped?.(this)
  }

  /** The cell's strokes, shown: not a change of the sheet's (nothing is told), and there is nothing to undo here. */
  show(strokes: InkStroke[]): void {
    this.importState({ strokes, past: [], future: [] })
  }

  /** The cell is gone: a plain sheet from now on, keeping its ink. */
  unbind(): void {
    this.ref = null
    this.pending = false
    this.frame = null
    this.seen = null
    this.importState({ strokes: this.strokes, past: [], future: [] })
  }
}
