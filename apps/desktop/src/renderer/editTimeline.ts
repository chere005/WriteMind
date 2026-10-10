/**
 * ONE timeline of edits for a note: its words and its drawing.
 *
 * The words keep CodeMirror's history (it groups typing, maps selections and
 * is the engine that knows how to take a change back), and the drawing keeps
 * its snapshots (`DrawingHistory`). What they did not share was an ORDER: the
 * old Undo guessed ("whichever was edited last, and keep going down it until
 * it is empty") and an interleaving of word edits and drawing edits undid the
 * wrong one. Here every edit, on either side, takes a stamp from the note's
 * `EditClock`, and an Undo takes back whichever side's newest edit has the
 * highest stamp — exactly the most recent edit, whatever it was. Redo is the
 * mirror: the undone edit with the LOWEST stamp comes back first, which is the
 * one that was undone last.
 *
 * CodeMirror's undo stack is opaque (typing is grouped inside it), so the
 * stamps are kept in a state field that mirrors it: after every transaction
 * the change in `undoDepth` says whether the history started a new event
 * (push a stamp), joined the last one (refresh its stamp) or took one back
 * (move a stamp to the redo side). An edit that follows another side's edit
 * is annotated `isolateHistory("before")`, so typing never joins a group
 * that a drawing edit has already come after.
 *
 * A new edit — on either side — kills every redo that was waiting, on both
 * sides: a redo is only valid if it was undone AFTER the last new edit
 * (`undoneAt > clock.lastEdit`), which needs no message between the two
 * histories.
 *
 * Per note: each note has its own clock, its own drawing history, and (while
 * its tab is behind another) its own editor state in `noteHistory.ts`.
 */

import { EditorState, StateField, Transaction, type Extension } from "@codemirror/state"
import { isolateHistory, redo, undo, undoDepth, redoDepth } from "@codemirror/commands"
import { bounds, changedInkCells, inkCells, isHidden, itemId, type Drawing } from "@writemind/core"
import { redoWaiting } from "@writemind/editor"
import type { DrawingHistory } from "./drawingHistory"
import { wallNow } from "../shared/undo"

/**
 * Told on every NEW edit of any note, words or drawing (not an Undo or Redo): the page uses it to end the journal's redo
 * path (a new step ends every redo, file steps included: docs/PLAN-undo.md) and to keep Edit ▸ Undo's label right.
 */
export const editListeners = new Set<() => void>()

/**
 * A FILE STEP CLOSES THE OPEN TYPING GROUP (docs/PLAN-undo.md). CodeMirror joins typing made within half a second into one
 * undo event; typing, a rename and typing again within that half second must not become one event that spans the rename, or
 * Undo would take both runs of typing back after the rename. The page calls this when the journal records, undoes or redoes
 * a step, and the next edit of every note starts a group of its own.
 */
let epoch = 0
export const closeTextGroups = (): void => { epoch += 1 }

/** The numbering of edits for ONE note. */
export class EditClock {
  private n = 0
  private edited = 0
  private counted = 0
  private shared: { stamp: number; left: number; until: number } | null = null
  /**
   * When each recent stamp was made (wall-clock, `wallNow`), and what to call it in Edit ▸ Undo. The journal of file steps
   * is ordered against the words and the drawing by TIME (docs/PLAN-undo.md): the stamps order the two histories of one note
   * among themselves, this orders a note's newest step against a file operation. Only the recent ones are kept (the
   * histories keep a few hundred events).
   */
  private readonly times = new Map<number, number>()
  private readonly labels = new Map<number, string>()

  /** The wall-clock time of the edit with this stamp; 0 for one older than the clock remembers. */
  timeOf(stamp: number): number { return this.times.get(stamp) ?? 0 }

  /** What the edit with this stamp is called ("Typing", "Paste"...), or null for the default. */
  labelOf(stamp: number): string | null { return this.labels.get(stamp) ?? null }

  /** Names the edit with this stamp. */
  name(stamp: number, label: string): void { this.labels.set(stamp, label) }

  /** The stamp of the newest new edit (0 before any). */
  get lastEdit(): number { return this.edited }

  /** How many edits have been made (a shared stamp still counts each one). */
  get edits(): number { return this.counted }

  /** The stamp for an edit being made now. */
  edit(): number {
    this.counted += 1
    const now = typeof performance !== "undefined" ? performance.now() : Date.now()
    let stamp: number
    if (this.shared && now < this.shared.until && this.shared.left > 0) {
      this.shared.left -= 1
      this.edited = Math.max(this.edited, this.shared.stamp)
      stamp = this.shared.stamp
    } else {
      this.shared = null
      this.edited = ++this.n
      stamp = this.edited
    }
    this.times.set(stamp, wallNow())
    if (this.times.size > 1500) {
      // (Maps keep their keys in the order they were first set: the oldest stamps are the first ones.)
      for (const old of [...this.times.keys()].slice(0, 500)) { this.times.delete(old); this.labels.delete(old) }
    }
    for (const listener of editListeners) { try { listener() } catch { /* a listener never stops an edit */ } }
    return stamp
  }

  /** A number for an Undo, to say when it happened relative to the edits. */
  tick(): number { return ++this.n }

  /**
   * Whether something was undone (or a shared stamp taken) since the newest new edit: a Redo MAY be waiting, on either
   * side. Erring towards yes is harmless (an emptied markdown cell just waits for the next edit to go, textCells.ts).
   */
  get undoneSinceEdit(): boolean { return this.n > this.edited }

  /**
   * The next `edits` edits, on either side, are ONE edit: a picture read into
   * words (the words go in AND the picture is put away) is taken back by a
   * single Undo. Whatever is left unused after `ms` is let go.
   */
  together(edits = 2, ms = 2000): void {
    const now = typeof performance !== "undefined" ? performance.now() : Date.now()
    this.shared = { stamp: ++this.n, left: edits, until: now + ms }
  }

  /**
   * Lets go of what `together` left unused, at once (docking, docs\PLAN-docking-ink-cells.md (e)): a dock whose
   * words could not be written must not glue the NEXT edit, made within the two seconds, to a stamp of its own.
   */
  endTogether(): void { this.shared = null }
}

/** `at` is when it was undone on the note's clock (ticks), `when` the wall-clock time of that (the journal orders by it). */
interface Undone { stamp: number; at: number; when: number }
/** `edits` is the clock's count of edits right after the words' own latest one; `epoch` the file-step epoch it was made in. */
interface Stamps { done: number[]; undone: Undone[]; edits: number; epoch: number }

/** One field per clock (a note), however many times the editor is made for it. */
const fields = new WeakMap<EditClock, { field: StateField<Stamps>; extension: Extension }>()

/** The stamps of the words' undo and redo stacks, beside CodeMirror's own. */
export function textTimeline(clock: EditClock): Extension {
  const held = fields.get(clock)
  if (held) return held.extension
  const field = StateField.define<Stamps>({
    create: () => ({ done: [], undone: [], edits: 0, epoch }),
    update(value, tr) {
      // (An undone event whose net change was nothing leaves `docChanged` false.)
      if (!tr.docChanged && !tr.isUserEvent("undo") && !tr.isUserEvent("redo")) return value
      const before = undoDepth(tr.startState)
      const after = undoDepth(tr.state)
      if (tr.isUserEvent("undo")) {
        if (value.done.length === 0) return value
        const done = value.done.slice(0, -1)
        // An event whose net change was nothing is not kept for Redo: it just goes.
        const kept = redoDepth(tr.state) > redoDepth(tr.startState)
        const undone = kept
          ? [...value.undone, { stamp: value.done[value.done.length - 1]!, at: clock.tick(), when: wallNow() }] : value.undone
        return reconcile({ ...value, done, undone }, tr.state)
      }
      if (tr.isUserEvent("redo")) {
        if (value.undone.length === 0) return value
        const done = [...value.done, value.undone[value.undone.length - 1]!.stamp]
        return reconcile({ ...value, done, undone: value.undone.slice(0, -1) }, tr.state)
      }
      // Changes the history does not keep (a mapping only) are not edits.
      if (tr.annotation(Transaction.addToHistory) === false) return value
      const stamp = clock.edit()
      clock.name(stamp, labelOfEdit(tr))
      const done = after === before && value.done.length > 0
        ? [...value.done.slice(0, -1), stamp]   // joined into the last group
        : [...value.done, stamp]                // a group of its own
      // A new edit empties the redo side (CodeMirror does the same).
      return reconcile({ done, undone: [], edits: clock.edits, epoch }, tr.state)
    },
  })
  const extension: Extension = [
    field,
    // An emptied markdown cell is not taken away while the drawing's Redo waits (its going would be a new edit).
    redoWaiting.of(() => clock.undoneSinceEdit),
    // An edit that comes after an edit of the other side starts a group of
    // its own: typing must not join a group that the drawing has since moved past.
    EditorState.transactionExtender.of((tr) => {
      if (!tr.docChanged || tr.annotation(Transaction.addToHistory) === false) return null
      if (tr.isUserEvent("undo") || tr.isUserEvent("redo")) return null
      const mine = tr.startState.field(field, false)
      return mine && (mine.edits !== clock.edits || mine.epoch !== epoch) ? { annotations: isolateHistory.of("before") } : null
    }),
  ]
  fields.set(clock, { field, extension })
  return extension
}

/** Keep the mirror the length of the real stacks (the history trims its oldest in batches). */
function reconcile(value: Stamps, state: EditorState): Stamps {
  const depth = undoDepth(state)
  const redoable = redoDepth(state)
  let { done, undone } = value
  const { edits, epoch: made } = value
  if (done.length > depth) done = done.slice(done.length - depth)
  while (done.length < depth) done = [0, ...done]
  if (undone.length > redoable) undone = undone.slice(undone.length - redoable)
  return { done, undone, edits, epoch: made }
}

/** The stamp of the edit an Undo would take back from the words, or null. */
export function textUndoStamp(state: EditorState, clock: EditClock): number | null {
  const held = fields.get(clock)
  const value = held ? state.field(held.field, false) : undefined
  if (!value || undoDepth(state) === 0) return null
  return value.done.at(-1) ?? null
}

/** What an edit of the words is called in Edit ▸ Undo: by the kind of transaction that made it. */
function labelOfEdit(tr: Transaction): string {
  if (tr.isUserEvent("input.paste")) return "Paste"
  if (tr.isUserEvent("input.drop")) return "Drop"
  if (tr.isUserEvent("delete.cut")) return "Cut"
  if (tr.isUserEvent("input") || tr.isUserEvent("delete.backward") || tr.isUserEvent("delete.forward")) return "Typing"
  if (tr.isUserEvent("delete")) return "Delete"
  return "Edit"
}

/** The wall-clock time the edit a Redo would bring back to the words was undone, or null (none, or killed by a newer edit). */
export function textRedoWhen(state: EditorState, clock: EditClock): number | null {
  const held = fields.get(clock)
  const value = held ? state.field(held.field, false) : undefined
  const top = value?.undone.at(-1)
  if (!top || redoDepth(state) === 0 || top.at <= clock.lastEdit) return null
  return top.when
}

/** The stamp of the edit a Redo would bring back to the words, or null (none, or killed by a newer edit). */
export function textRedoStamp(state: EditorState, clock: EditClock): number | null {
  const held = fields.get(clock)
  const value = held ? state.field(held.field, false) : undefined
  const top = value?.undone.at(-1)
  if (!top || redoDepth(state) === 0 || top.at <= clock.lastEdit) return null
  return top.stamp
}

/** What the words are held in: an editor view, or anything with a state and a dispatch. */
export interface TextHost {
  readonly state: EditorState
  dispatch(tr: Transaction): void
}

export interface Across {
  clock: EditClock
  /** The words; null when no note is open in an editor. */
  text: TextHost | null
  history: DrawingHistory
  /** The drawing as it is now. */
  current(): Drawing
  /** Put a drawing back (saved like any other edit). */
  apply(next: Drawing): void
}

export type Taken = "text" | "drawing" | "both" | null

/**
 * Undo or redo exactly one edit — the most recent one, the words' or the
 * drawing's. Returns what was taken, or null when there was nothing.
 *
 * CodeMirror keeps an event whose net effect is nothing (typed a letter and
 * took it back inside one group): undoing it changes no word on the page, and
 * a key that visibly does nothing reads as broken. Such a step is not counted;
 * the step after it is taken as well.
 */
export function stepAcross(which: "undo" | "redo", across: Across): Taken {
  let last: Taken = null
  for (let guard = 0; guard < 100; guard++) {
    const before = across.text?.state.doc
    const took = stepOnce(which, across)
    if (took === null) return last
    last = took
    if (took === "text" && across.text && before && across.text.state.doc.eq(before)) continue
    return took
  }
  return last
}

/** Which side's edit an Undo or Redo takes (the newest stamp, or for Redo the lowest), and the stamps of both. */
function choose(which: "undo" | "redo", across: Across) {
  const { text, history, clock } = across
  const words = text
    ? (which === "undo" ? textUndoStamp(text.state, clock) : textRedoStamp(text.state, clock)) : null
  const ink = which === "undo" ? history.undoStamp : history.redoStamp(clock)
  const takeText = words !== null && (ink === null || (which === "undo" ? words >= ink : words <= ink))
  const takeDrawing = ink !== null && (words === null || (which === "undo" ? ink >= words : ink <= words))
  return { words, ink, takeText, takeDrawing }
}

/**
 * The edit a press would take, as the journal of file steps needs to see it (docs/PLAN-undo.md): its wall-clock time (for an
 * Undo, when the edit was made; for a Redo, when it was undone) and what Edit ▸ Undo calls it. Null when there is nothing.
 */
export function peekAcross(which: "undo" | "redo", across: Across): { at: number; label: string } | null {
  const { clock, text, history } = across
  const { words, ink, takeText, takeDrawing } = choose(which, across)
  if (words === null && ink === null) return null
  const label = takeText && takeDrawing ? "Edit" : takeText ? (clock.labelOf(words!) ?? "Typing") : "Drawing"
  if (which === "undo") {
    return { at: Math.max(takeText ? clock.timeOf(words!) : 0, takeDrawing ? clock.timeOf(ink!) : 0), label }
  }
  const whens = [takeText && text ? textRedoWhen(text.state, clock) : null, takeDrawing ? history.redoWhen(clock) : null]
    .filter((one): one is number => one !== null)
  return { at: whens.length > 0 ? Math.min(...whens) : 0, label }
}

function stepOnce(which: "undo" | "redo", across: Across): Taken {
  const { text, history } = across
  const { words, ink, takeText, takeDrawing } = choose(which, across)
  if (words === null && ink === null) return null
  let took: Taken = null
  if (takeDrawing) {
    const next = which === "undo" ? history.undo(across.current()) : history.redo(across.current())
    if (next) { across.apply(next); took = "drawing" }
  }
  if (takeText && text) {
    const ok = (which === "undo" ? undo : redo)({ state: text.state, dispatch: (tr) => text.dispatch(tr) })
    if (ok) took = took === "drawing" ? "both" : "text"
  }
  return took
}

/**
 * Where the drawing changed between two states, as one box in document
 * coordinates, or null when nothing differs. An Undo that changes something
 * out of sight would look like a key that did nothing.
 */
export function changedBox(before: Drawing, after: Drawing, pane: { width: number; height: number }) {
  // Hidden items are not on the page (a picture read into words, an ink cell: its ink is in the note's flow, and its
  // bounds would scroll an Undo of a cell stroke to the top of the note). `changedCells` answers for the cells.
  const seen = new Map(before.items.filter((item) => !isHidden(item)).map((item) => [itemId(item), item]))
  const now = new Map(after.items.filter((item) => !isHidden(item)).map((item) => [itemId(item), item]))
  let box: { x: number; y: number; width: number; height: number } | null = null
  const add = (item: Drawing["items"][number]) => {
    const one = bounds(item, pane)
    if (!box) { box = { ...one }; return }
    const right = Math.max(box.x + box.width, one.x + one.width)
    const bottom = Math.max(box.y + box.height, one.y + one.height)
    box.x = Math.min(box.x, one.x); box.y = Math.min(box.y, one.y)
    box.width = right - box.x; box.height = bottom - box.y
  }
  for (const [id, item] of now) if (seen.get(id) !== item) add(item)
  for (const [id, item] of seen) if (!now.has(id)) add(item)
  return box as { x: number; y: number; width: number; height: number } | null
}

/** The ink cells an edit changed, added or took away, by id (an Undo inside a cell is shown by scrolling to it). */
export function changedCells(before: Drawing, after: Drawing): string[] {
  const ids = new Set(changedInkCells(before, after).map((cell) => cell.id))
  const now = new Set(inkCells(after).map((cell) => cell.id))
  for (const cell of inkCells(before)) if (!now.has(cell.id)) ids.add(cell.id)
  return [...ids]
}
