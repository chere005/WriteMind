/**
 * What each note remembers about its own edits, so that Undo is per note:
 * the clock its edits are numbered by, the drawing's snapshots, and — while
 * its tab is behind another — the editor's state (CodeMirror's history lives
 * in it). Switching tabs used to throw all of that away; coming back to a
 * note now finds Ctrl+Z exactly where it was left.
 *
 * THE TEXT HISTORY SURVIVES WHAT HAPPENS TO ITS NOTE (docs/PLAN-undo.md): a rename or a move carries the history to the new
 * path (the editor is rebuilt for the new path from the state that was put aside, `Notebook.tsx`), and a note whose tab was
 * closed — or whose file went to the bin and was put back by Undo — keeps its history with the last `CLOSED_KEEP` closed
 * notes, so Ctrl+Z still has it when the note comes back.
 *
 * The editor state is only used when the words are still what they were (the note was not changed under it from outside).
 */

import type { EditorState } from "@codemirror/state"
import { DrawingHistory } from "./drawingHistory"
import { EditClock } from "./editTimeline"

export class NoteHistory {
  readonly clock = new EditClock()
  readonly drawing = new DrawingHistory(this.clock)
  /** The editor's state, kept while the note's tab is not in front. */
  text: EditorState | null = null
}

/** The histories of the notes that are open. */
const notes = new Map<string, NoteHistory>()

/** The histories of notes that are not open, the most recently closed last: the last few are kept. */
const closed = new Map<string, NoteHistory>()
export const CLOSED_KEEP = 8

/**
 * A path a note has just left, and where it went. The editor of a renamed note is torn down AFTER the rename, and what it
 * puts aside on the way out is under the name it was built with: it is stored under the name the note has now.
 */
const moved = new Map<string, string>()
function nowAt(path: string): string {
  let at = path
  for (let step = 0; step < 8; step++) {
    const next = moved.get(at)
    if (!next || next === at) break
    at = next
  }
  return at
}

/** The history of a note (made on first ask; a closed note's comes back). */
export function historyOf(path: string): NoteHistory {
  let held = notes.get(path)
  if (!held) {
    held = closed.get(path) ?? new NoteHistory()
    closed.delete(path)
    notes.set(path, held)
  }
  return held
}

/** The editor's state is put aside as the note's tab goes behind another (or the note is renamed under the editor). */
export function stashText(path: string, state: EditorState): void {
  historyOf(nowAt(path)).text = state
}

/** The state put aside for a note, if the words in it are the words now in hand. */
export function takeText(path: string, words: string): EditorState | null {
  // (the editor for this path is being made: what it left under an old name has arrived)
  for (const [from, to] of [...moved]) if (to === path) moved.delete(from)
  const held = notes.get(path)
  const state = held?.text ?? null
  if (!held) return null
  held.text = null
  return state && state.doc.length === words.length && state.doc.toString() === words ? state : null
}

/**
 * A note that was renamed or moved keeps ALL of its history, the editor's state included: the page rebuilds the editor for the
 * new path from it (Notebook.tsx puts the new path's extensions on it). A closed note moves with its history too.
 */
export function renameNote(from: string, to: string): void {
  if (from === to) return
  for (const where of [notes, closed]) {
    const held = where.get(from)
    if (!held) continue
    where.delete(from)
    where.set(to, held)
  }
  moved.delete(to)
  moved.set(from, to)
}

/** Everything about notes that are not open any more is put aside: the last few closed notes keep theirs. */
export function keepOnly(open: Iterable<string>): void {
  const alive = new Set(open)
  for (const [path, held] of [...notes]) {
    if (alive.has(path)) continue
    notes.delete(path)
    closed.delete(path)
    closed.set(path, held)
  }
  while (closed.size > CLOSED_KEEP) closed.delete(closed.keys().next().value as string)
}

/** The histories of the closed notes kept: Clean Up must not offer a picture one of their Undos could bring back. */
export function closedHistories(): NoteHistory[] { return [...closed.values()] }

export function forgetAll(): void { notes.clear(); closed.clear(); moved.clear() }
