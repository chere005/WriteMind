/**
 * THE JOURNAL'S WORDS (docs/PLAN-undo.md): what the main process (main/undoJournal.ts) and the page (renderer/useUndo.ts,
 * App.tsx) say to each other about file steps, and the one rule that picks which step a press of Undo takes. Pure: shared by
 * both sides and tested without either.
 *
 * Sean, 2026-10-10: "make sure undo is always able to undo up to 3 steps, even if it involves file changes, which may mean
 * keeping file backups until undo goes out of scope."
 */

/**
 * The wall-clock both processes order steps by: the epoch in milliseconds with the browser's sub-millisecond fraction. The
 * page and the main process read the same machine clock, and an IPC hop is longer than its resolution, so a text edit and the
 * file operation that follows it never tie in practice (on a tie the file step counts as the newer: `pickStep`).
 */
export const wallNow = (): number => performance.timeOrigin + performance.now()

/** How many FILE steps back the journal keeps (and keeps backups for). Text keeps at least 200 (the note's own history). */
export const UNDO_DEPTH = 3

/** The file operations that are steps. */
export type StepKind =
  | "newNote" | "duplicateNote" | "renameNote" | "moveNote" | "reorder" | "trashNote"
  | "newSection" | "renameSection" | "moveSection" | "trashSection" | "cleanUp" | "importNote"

/** What Edit ▸ Undo calls each ("Undo Rename Note"). */
export const STEP_LABELS: Record<StepKind, string> = {
  newNote: "New Note",
  duplicateNote: "Duplicate Note",
  renameNote: "Rename Note",
  moveNote: "Move Note",
  reorder: "Reorder",
  trashNote: "Move to Trash",
  newSection: "New Section",
  renameSection: "Rename Section",
  moveSection: "Move Section",
  trashSection: "Move Section to Trash",
  cleanUp: "Clean Up Unused Files",
  importNote: "Import Note",
}

/** One step as the page sees it. `at` is when it was made, `undoneAt` when an Undo took it (a redo step only). */
export interface StepInfo {
  id: string
  kind: StepKind
  label: string
  at: number
  undoneAt: number | null
}

/** The top of both stacks, and when the newest step was recorded (a text Redo older than that is dead). */
export interface UndoState {
  undo: StepInfo | null
  redo: StepInfo | null
  undoCount: number
  redoCount: number
  /** The wall-clock of the newest step ever recorded since the journal was last cleared (0 before any). */
  newestAt: number
}

export const EMPTY_UNDO: UndoState = { undo: null, redo: null, undoCount: 0, redoCount: 0, newestAt: 0 }

/** What an Undo or Redo of a file step did to the notes folder, for the page to follow. */
export interface UndoEffects {
  /** Files or folders that are now somewhere else: `from` is where the page knew them. */
  moved: { from: string; to: string }[]
  /** Files or folders that are gone (a tab on one closes). */
  removed: string[]
  /** Files or folders that are back (a note trashed while open is reopened). `was` is the path they had when they went. */
  restored: { path: string; was: string }[]
  /** Said to the person (a name that was taken, a note that was left alone). */
  notices: string[]
}

export const noEffects = (): UndoEffects => ({ moved: [], removed: [], restored: [], notices: [] })

export type UndoOutcome =
  | { ok: true; which: "undo" | "redo"; label: string; effects: UndoEffects }
  | {
    ok: false
    which: "undo" | "redo"
    label: string
    /** Why, in words ("the note was changed by another program, so it was not removed"). */
    why: string
    /** The step was dropped (what it was about has gone): the next press goes on to the older one. */
    dropped: boolean
  }
  /** Nothing to do (the stacks were empty). */
  | { ok: null; which: "undo" | "redo" }

// MARK: - Which step a press takes

/** What the page can take back in the open note: the label and the time of the edit (undo) or of the undo (redo). */
export interface TextCandidate { label: string; at: number }

export type Pick = { from: "text" | "file"; label: string } | null

/**
 * The step a press of Undo takes: the newest of the open note's own newest edit and the journal's newest file step; the
 * file step on a tie (the operation was asked for after the typing it flushed). For Redo, the one undone LAST: the
 * greatest `undoneAt`; on a tie the file step again (its Redo was recorded with its own clock).
 *
 * A text Redo is only valid if it was undone after the newest file step was recorded (`state.newestAt`): a new step of either
 * kind ends the redo path. The page applies that when it builds the candidate; this function takes candidates as given.
 */
export function pickStep(which: "undo" | "redo", text: TextCandidate | null, file: StepInfo | null): Pick {
  const fileAt = file === null ? null : which === "undo" ? file.at : (file.undoneAt ?? file.at)
  if (text === null && file === null) return null
  if (text === null) return { from: "file", label: file!.label }
  if (file === null) return { from: "text", label: text.label }
  return text.at > (fileAt as number) ? { from: "text", label: text.label } : { from: "file", label: file.label }
}

/** A text Redo that was undone before the newest file step was recorded is dead (a new step ends the redo path). */
export const textRedoAlive = (undoneAt: number, newestFileStepAt: number): boolean => undoneAt > newestFileStepAt

/** "Undo Rename Note": the menu's text. */
export const menuText = (verb: "Undo" | "Redo", label: string | null): string => (label ? `${verb} ${label}` : verb)

/** The sentence for a name that was taken. */
export const takenNotice = (wanted: string, got: string): string =>
  `“${wanted}” was put back as “${got}” because something called “${wanted}” is there now.`
