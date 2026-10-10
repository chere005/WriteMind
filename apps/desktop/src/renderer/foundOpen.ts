/**
 * Opening a result of the sidebar's search (Sidebar.tsx): the note opens, the caret goes to the FIRST place the words are in
 * it, and the Find bar comes up on those words, so Enter and Shift+Enter walk the rest (docs/PLAN-bars-2026-10.md P3).
 *
 * The note's editor is made after the note is opened (a new document is a new view), so what is wanted waits here until the
 * page holds the note's own words; a wish that is not met in a few seconds (the note did not open) is let go, so it can never
 * fire later on a note the person opened by hand.
 */

import { useCallback, useEffect, useRef, useState } from "react"
import { EditorView } from "@codemirror/view"
import { findAll, findSeed, type Note, type Range } from "@writemind/core"
import { revealAt } from "@writemind/editor"
import type { FindRequest } from "./FindBar"

/** How long a result waits for its note to be on the page. */
const WAIT_MS = 5000

/** What the page's `view` is, as far as this file needs to know. */
export interface LiveView { connected: boolean; doc: string }

/**
 * Whether the page is ready for a wanted result to be shown: "ready" when the view in hand is the live editor of the note
 * wanted (its words are the page's), "wait" while it is not, "expired" when the wait has gone on too long. A view that is no
 * longer on the page is not the note's: the page keeps the last editor it was handed after its tab is closed, and a result
 * opened next in a note with the same words as that note matched ITS words, put the caret on the dead editor and the Find bar
 * on a live one that never got the caret (found by e2e/suites/integration/06).
 */
export function readiness(want: { path: string; at: number }, now: number, current: string | null, view: LiveView | null, words: string): "ready" | "wait" | "expired" {
  if (now - want.at > WAIT_MS) return "expired"
  if (!view || current !== want.path || !view.connected) return "wait"
  return view.doc === words ? "ready" : "wait"
}

/** The words to find in `text` for a result, and where the first of them is (null when the note has changed so that they are not there). */
export function firstMatch(text: string, hit: { matched: string }, typed: string): { seed: string; first: Range | null } {
  const seed = findSeed(text, hit, typed)
  return { seed, first: findAll(text, seed)[0] ?? null }
}

interface Options {
  view: EditorView | null
  /** The note on the page. */
  current: string | null
  /** Its text as it is now. */
  text(): string
  openNote(note: Note): Promise<void>
  finding: FindRequest | null
  setFinding(request: FindRequest): void
}

/** The way to open a result: `(note, hit, typed)`. */
export function useOpenFound({ view, current, text, openNote, finding, setFinding }: Options): (note: Note, hit: { matched: string }, typed: string) => void {
  const wanted = useRef<{ path: string; hit: { matched: string }; typed: string; at: number } | null>(null)
  const [tick, setTick] = useState(0)
  const latest = useRef({ text, finding, setFinding, openNote, current })
  latest.current = { text, finding, setFinding, openNote, current }

  const open = useCallback((note: Note, hit: { matched: string }, typed: string) => {
    wanted.current = { path: note.path, hit, typed, at: Date.now() }
    // The note already in front is not read again (that would put its caret and its undo back): it is only looked in.
    if (latest.current.current === note.path) { setTick((was) => was + 1); return }
    void latest.current.openNote(note).then(() => setTick((was) => was + 1))
  }, [])

  useEffect(() => {
    const want = wanted.current
    if (!want) return
    const words = latest.current.text()
    // (Not the view of the note that was in front before, nor one whose tab has gone: the next view is the one.)
    const state = readiness(want, Date.now(), current, view ? { connected: view.dom.isConnected, doc: view.state.doc.toString() } : null, words)
    if (state === "expired") { wanted.current = null; return }
    if (state === "wait" || !view) return
    wanted.current = null
    const { seed, first } = firstMatch(words, want.hit, want.typed)
    if (first) {
      revealAt(view, first.location)
      view.dispatch({
        selection: { anchor: first.location, head: first.location + first.length },
        effects: EditorView.scrollIntoView(first.location, { y: "center" }),
      })
    }
    const was = latest.current.finding
    latest.current.setFinding({ mode: "find", seed, tick: (was?.tick ?? 0) + 1 })
  }, [view, current, tick])

  return open
}
