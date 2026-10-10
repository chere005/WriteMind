/**
 * What the sidebar's search sends the page (main/notesSearch.ts makes it, Sidebar.tsx draws it). Types only: the page
 * and the main process share the shape and nothing else.
 */

import type { NoteHit } from "@writemind/core"

/** One result, as the sidebar draws it. */
export interface FoundNote extends NoteHit {
  path: string
  title: string
  /** Where the note is: its section's name, or its folders from the project's folder (`Research Projects › Quantum`). */
  where: string
  modified: number
}

export interface SearchOutcome {
  /** What was searched for (as typed, trimmed). */
  query: string
  hits: FoundNote[]
  /** There were more than the page is sent: these are the best of them. */
  more: boolean
  /** Notes whose words could not be read (found by title and file name only). */
  unreadable: number
  /** How many notes were looked at. */
  searched: number
  /** Stopped before it finished (a newer search began): `hits` is empty. */
  cancelled: boolean
}
