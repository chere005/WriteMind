/**
 * The sidebar's search, as the page asks it (main/notesSearch.ts answers): the words typed are given a moment to settle
 * (a search starts when the typing pauses, not on every key), a search still running is cancelled when a newer one
 * starts or the field is cleared, and an answer that arrives for words that are no longer the field's is dropped.
 *
 * What was found stays on show while the next search runs (the list does not blank between two keystrokes); `busy` says one
 * is on its way. The tree changing (a save retitled a note, a note was made or moved) searches again, because the results
 * are the notes as they are now — the main process only re-reads the notes whose file moved.
 */

import { useEffect, useRef, useState } from "react"
import type { SearchOutcome } from "../shared/search"

/** How long the typing has to pause before a search starts. */
export const SEARCH_DELAY_MS = 140

export interface NoteSearchState {
  /** The last complete answer (`outcome.query` says which words it is for), or null before the first and after the field is cleared. */
  outcome: SearchOutcome | null
  /** A search for the words in the field has not come back yet. */
  busy: boolean
}

export function useNoteSearch(typed: string, tree: unknown): NoteSearchState {
  const [state, setState] = useState<NoteSearchState>({ outcome: null, busy: false })
  /** The id of the search that is running, or 0. */
  const running = useRef(0)
  const next = useRef(0)
  const latest = useRef(typed)
  latest.current = typed

  useEffect(() => {
    // A cleared field: nothing is searched for, and what is running stops.
    if (typed.length === 0) {
      if (running.current !== 0) { void window.wm.cancelSearch(running.current); running.current = 0 }
      setState((was) => (was.outcome === null && !was.busy ? was : { outcome: null, busy: false }))
      return
    }
    setState((was) => (was.busy ? was : { ...was, busy: true }))
    const timer = window.setTimeout(() => {
      // A search still going for older words is of no use now.
      if (running.current !== 0) void window.wm.cancelSearch(running.current)
      const id = ++next.current
      running.current = id
      window.wm.searchNotes(id, typed).then((outcome) => {
        // (a newer search has started, or the field was cleared: this answer is for words nobody is looking at)
        if (running.current !== id) return
        running.current = 0
        if (outcome.cancelled) return
        // (still busy when what came back is for words that have been typed over since)
        setState({ outcome, busy: outcome.query !== latest.current })
      }, () => {
        if (running.current !== id) return
        running.current = 0
        setState((was) => ({ ...was, busy: false }))
      })
    }, SEARCH_DELAY_MS)
    return () => window.clearTimeout(timer)
  }, [typed, tree])

  // Leaving (the sidebar put away): what is running stops.
  useEffect(() => () => { if (running.current !== 0) void window.wm.cancelSearch(running.current) }, [])

  return state
}
