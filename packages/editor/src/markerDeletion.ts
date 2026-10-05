/**
 * An edit over hidden markers takes them whole, and takes a pair together
 * (`WriteMind/Editor/MarkerDeletion.swift`, applied by `widenedEdit` in the Mac's text view).
 *
 * The markers are still in the note, only drawn with no width, so a selection made with the
 * eye can cut a pair in half: take "**bo" out of "**bold**" and what is left is `ld**` — a
 * closing pair with nothing to close, drawn as two stray asterisks. A delete, a typed
 * character over a selection and a paste into one all go through here: the replaced range
 * is widened to whole markers, the partner of a half-taken pair is removed, and what was
 * typed lands where the selection was.
 *
 * Only while the marks ARE put away (the rendered page, or Hide Markdown Markers): with
 * the raw markdown showing, what is selected is what the eye saw, and half a `**` is then
 * a fair thing to delete. Commands (the formatting keys, the cell commands) are untouched:
 * only the user's own typing, deleting and pasting is read.
 */

import { EditorState, Transaction, type Extension } from "@codemirror/state"
import { askedDeletion, widenedDeletions, type Range } from "@writemind/core"
import { markerStructureAround } from "./decorations"
import { marksAway } from "./rendered"

export const hiddenMarkerDeletion: Extension = EditorState.transactionFilter.of((transaction) => {
  if (!transaction.docChanged) return transaction
  if (!(transaction.isUserEvent("input") || transaction.isUserEvent("delete"))) return transaction
  if (!marksAway(transaction.startState)) return transaction

  // One ordinary edit: a single replaced range with something in it.
  let only: { from: number; to: number; insert: string } | null = null
  let count = 0
  transaction.changes.iterChanges((from, to, _fromB, _toB, inserted) => {
    count++
    only = { from, to, insert: inserted.toString() }
  })
  if (count !== 1 || only === null) return transaction
  const edit = only as { from: number; to: number; insert: string }
  if (edit.to <= edit.from) return transaction

  const state = transaction.startState
  const asked: Range = { location: edit.from, length: edit.to - edit.from }
  const structure = markerStructureAround(state, edit.from, edit.to)
  const ranges = widenedDeletions(asked, state.doc.length, structure)
  if (ranges.length === 1 && ranges[0]!.location === asked.location && ranges[0]!.length === asked.length) return transaction

  const target = askedDeletion(asked, ranges)
  const changes = ranges.map((one) => ({
    from: one.location,
    to: one.location + one.length,
    insert: one.location === target.location && one.length === target.length ? edit.insert : "",
  }))
  // After whatever went in, not before it (the lowest range's place is not moved by the others).
  const last = ranges[ranges.length - 1]!
  const typed = last.location === target.location && last.length === target.length ? edit.insert.length : 0
  return [{
    changes,
    selection: { anchor: last.location + typed },
    scrollIntoView: true,
    userEvent: transaction.annotation(Transaction.userEvent) ?? "input",
  }]
})
