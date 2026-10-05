/**
 * What each OPEN note remembers about its own edits, so that Undo is per note:
 * the clock its edits are numbered by, the drawing's snapshots, and — while
 * its tab is behind another — the editor's state (CodeMirror's history lives
 * in it). Switching tabs used to throw all of that away; coming back to a
 * note now finds Ctrl+Z exactly where it was left.
 *
 * The editor state is only kept when the words are still what they were
 * (the note was not changed under it from outside), and a note that is no
 * longer open is forgotten.
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

const notes = new Map<string, NoteHistory>()

/** The history of a note (made on first ask). */
export function historyOf(path: string): NoteHistory {
  let held = notes.get(path)
  if (!held) { held = new NoteHistory(); notes.set(path, held) }
  return held
}

/** The editor's state is put aside as the note's tab goes behind another. */
export function stashText(path: string, state: EditorState): void {
  historyOf(path).text = state
}

/** The state put aside for a note, if the words in it are the words now in hand. */
export function takeText(path: string, words: string): EditorState | null {
  const held = notes.get(path)
  const state = held?.text ?? null
  if (!held) return null
  held.text = null
  return state && state.doc.length === words.length && state.doc.toString() === words ? state : null
}

/** A note that was renamed or moved keeps its drawing's history, not its editor state. */
export function renameNote(from: string, to: string): void {
  const held = notes.get(from)
  if (!held || from === to) return
  notes.delete(from)
  held.text = null
  notes.set(to, held)
}

/** Everything about notes that are not open any more is let go. */
export function keepOnly(open: Iterable<string>): void {
  const alive = new Set(open)
  for (const path of [...notes.keys()]) if (!alive.has(path)) notes.delete(path)
}

export function forgetAll(): void { notes.clear() }
