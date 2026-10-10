/**
 * ONE Undo for everything the person did (docs/PLAN-undo.md). A note's words and its drawing share a timeline
 * (editTimeline.ts: the words have CodeMirror's history, the drawing has `DrawingHistory`, every edit on either side is
 * numbered on the note's `EditClock`), and the FILE operations — rename, move, trash, new note, duplicate, the section
 * versions, Clean Up, import — are steps of the main process's journal (main/undoJournal.ts), which keeps the last three
 * with the backups they need. Ctrl+Z (and Edit ▸ Undo in the menu, which the main process sends here) takes back the NEWEST
 * step of either kind, by the wall clock; Ctrl+Shift+Z / Ctrl+Y brings back the one undone last; a new step ends every redo.
 *
 * Text steps are the open note's own (typing in another tab is that tab's); the journal is the window's. Edit ▸ Undo names
 * the step ("Undo Rename Note", "Undo Typing"), so a press never surprises.
 *
 * The keys are heard in the capture phase and swallowed whenever the target is not a text field, even with nothing behind
 * them: the browser's own undo of the editor's contenteditable must never run behind CodeMirror's back (it would undo text
 * CodeMirror does not know it changed). A key pressed while a file step is being taken back waits its turn.
 */

import { useEffect, useRef, useState } from "react"
import { EditorView } from "@codemirror/view"
import type { Drawing } from "@writemind/core"
import { inkCellPlaces } from "@writemind/editor"
import type { DrawingHistory } from "./drawingHistory"
import { changedBox, changedCells, closeTextGroups, editListeners, peekAcross, stepAcross, type Across, type EditClock } from "./editTimeline"
import { tabletUndo } from "./tabletFocus"
import { registerPenHandlers } from "./penActions"
import { EMPTY_UNDO, pickStep, textRedoAlive, type StepInfo, type TextCandidate, type UndoState } from "../shared/undo"

interface Options {
  view: EditorView | null
  history: DrawingHistory
  drawing: Drawing
  platform: string | null
  /** Put a drawing back (it is saved like any other edit). */
  apply(next: Drawing): void
  /**
   * Take back (or bring back) the journal's top file step: the app writes what it holds first, asks the journal, and follows
   * what the step did (tabs, the tree, a notice). True when a step was taken.
   */
  fileStep(which: "undo" | "redo"): Promise<boolean>
}

/** What Edit ▸ Undo and Redo say, or null when there is nothing to take. */
export interface UndoLabels { undo: string | null; redo: string | null }

// MARK: - The journal's state, as the page knows it

let journal: UndoState = EMPTY_UNDO
const listeners = new Set<() => void>()
let watching = false

/** The journal's last-known stacks (kept by its own `undo:changed` word, and fetched once at the start). */
export const journalState = (): UndoState => journal

function watchJournal(): void {
  if (watching || !window.wm.undo) return
  watching = true
  const take = (state: UndoState) => {
    // A step recorded, undone or redone ends the typing group in progress (a redo being cut does not).
    if (state.newestAt !== journal.newestAt || state.undoCount !== journal.undoCount) closeTextGroups()
    journal = state
    for (const listener of listeners) listener()
  }
  void window.wm.undo.state().then(take, () => undefined)
  window.wm.undo.onChanged(take)
}

/** The note's two histories as `peekAcross` / `stepAcross` take them. */
const acrossOf = (view: EditorView | null, history: DrawingHistory, drawing: Drawing, apply: (next: Drawing) => void, reveal: ((was: Drawing, next: Drawing) => void) | null): Across => {
  const clock: EditClock = history.clock
  let held = drawing
  return {
    clock, text: view, history,
    current: () => held,
    apply: (next) => {
      const was = held
      held = next
      apply(next)
      reveal?.(was, next)
    },
  }
}

export function useUndo(options: Options): UndoLabels {
  const latest = useRef(options)
  latest.current = options
  const [labels, setLabels] = useState<UndoLabels>({ undo: null, redo: null })

  useEffect(() => {
    watchJournal()

    /** The open note's own newest step, as a candidate against the journal's (Redo: only while no file step is newer). */
    const candidate = (which: "undo" | "redo"): TextCandidate | null => {
      const { view, history, drawing, apply } = latest.current
      const peek = peekAcross(which, acrossOf(view, history, drawing, apply, null))
      if (!peek) return null
      if (which === "redo" && !textRedoAlive(peek.at, journal.newestAt)) return null
      return peek
    }

    /** What Edit ▸ Undo and Redo say now. */
    const refresh = () => {
      const say = (which: "undo" | "redo"): string | null => {
        const file: StepInfo | null = which === "undo" ? journal.undo : journal.redo
        return pickStep(which, candidate(which), file)?.label ?? null
      }
      const next = { undo: say("undo"), redo: say("redo") }
      setLabels((was) => (was.undo === next.undo && was.redo === next.redo ? was : next))
    }
    let soon: number | null = null
    const refreshSoon = () => {
      if (soon !== null) return
      soon = window.setTimeout(() => { soon = null; refresh() }, 120)
    }
    refresh()
    listeners.add(refresh)

    /** The words and the drawing: exactly one edit of the open note, the newest. True when anything was taken. */
    const runText = (which: "undo" | "redo"): boolean => {
      const { view, history, drawing, apply } = latest.current
      const took = stepAcross(which, acrossOf(view, history, drawing, apply, (was, next) => { if (view) reveal(view, was, next) }))
      return took !== null
    }

    let waiting = 0
    let chain: Promise<unknown> = Promise.resolve()

    /** The newest step of either kind. */
    const runAny = async (which: "undo" | "redo"): Promise<boolean> => {
      // The tablet's sheet has its own strokes to take back, when the pen is on it.
      if (tabletUndo(which)) return true
      // Nothing in the journal (the usual case): the note's own step, as it always was.
      if (!window.wm.undo || (journal.undoCount === 0 && journal.redoCount === 0)) return runText(which)
      // The journal may have moved on since the last word from it: its top is asked for fresh.
      try { journal = await window.wm.undo.state() } catch { /* the last known one will do */ }
      const text = candidate(which)
      const pick = pickStep(which, text, which === "undo" ? journal.undo : journal.redo)
      if (!pick) return false
      if (pick.from === "text") return runText(which)
      return latest.current.fileStep(which)
    }

    const schedule = (which: "undo" | "redo") => {
      // Nothing waiting and nothing in the journal: no round trip, the same instant Undo the editor always had.
      if (waiting === 0 && journal.undoCount === 0 && journal.redoCount === 0) {
        if (!tabletUndo(which)) runText(which)
        refresh()
        return
      }
      waiting += 1
      chain = chain.then(() => runAny(which)).catch((error) => { console.error("WriteMind: undo failed", error) })
        .finally(() => { waiting -= 1; refresh() })
    }

    const key = (event: KeyboardEvent) => {
      if (event.altKey) return
      const mod = event.ctrlKey || event.metaKey
      if (!mod) return
      // A label being typed has its own undo, and so has a dialog's field.
      if (event.target instanceof Element && event.target.closest("input, textarea")) return
      // A dialog is up (a prompt, Clean Up, Language Setup): the keys are the dialog's, not the notes'.
      if (document.querySelector('[aria-modal="true"]')) return
      const k = event.key.toLowerCase()
      // Ctrl+Y is Redo on Windows/Linux only; on the Mac Redo is ⇧⌘Z and ⌘Y toggles the video.
      const which = k === "z" ? (event.shiftKey ? "redo" : "undo")
        : latest.current.platform !== "darwin" && k === "y" && !event.metaKey && !event.shiftKey ? "redo" : null
      if (!which) return
      schedule(which)
      event.preventDefault(); event.stopPropagation()
    }
    window.addEventListener("keydown", key, true)
    // The pen's Undo and Redo buttons are the NOTE's Undo (its words and drawing), never a file step: a stylus button must
    // not rename a note back.
    const penHandlers = registerPenHandlers({ undo: () => { runText("undo"); refresh() }, redo: () => { runText("redo"); refresh() } })
    const unlisten = window.wm.onEdit?.((which) => {
      // The menu's Undo while a label or a text box is being typed in is that field's own.
      const field = document.activeElement
      if (field instanceof HTMLInputElement || field instanceof HTMLTextAreaElement) { document.execCommand(which); return }
      schedule(which)
    })

    // A NEW EDIT ends every redo, the journal's included (a new step of either kind does): told once, not on every key.
    const edited = () => {
      if (journal.redoCount > 0) { void window.wm.undo.cutRedo().catch(() => undefined) }
      refreshSoon()
    }
    editListeners.add(edited)

    return () => {
      window.removeEventListener("keydown", key, true)
      unlisten?.()
      penHandlers()
      editListeners.delete(edited)
      listeners.delete(refresh)
      if (soon !== null) window.clearTimeout(soon)
    }
  }, [])

  // The labels follow the note in front, its drawing and its words.
  const { view, history, drawing } = options
  useEffect(() => {
    for (const listener of listeners) listener()
  }, [view, history, drawing])

  return labels
}

/** Scroll the page so that what an Undo just changed is in view. */
function reveal(view: EditorView, before: Drawing, after: Drawing): void {
  const scroller = view.scrollDOM
  const pane = { width: scroller.clientWidth, height: scroller.clientHeight }
  if (pane.height === 0) return
  const box = changedBox(before, after, pane)
  if (!box) {
    // An edit inside an ink cell (a stroke, a resize, a dock into it): the cell is shown, wherever the note has it.
    const id = changedCells(before, after)[0]
    if (id === undefined) return
    const place = inkCellPlaces.byId(id, view.dom)
    if (place) { place.element.scrollIntoView({ block: "nearest" }); return }
    const at = view.state.doc.toString().indexOf(`ink-${id}.svg`)
    if (at >= 0) view.dispatch({ effects: EditorView.scrollIntoView(at, { y: "center" }) })
    return
  }
  const top = scroller.scrollTop
  if (box.y + box.height > top && box.y < top + pane.height) return
  scroller.scrollTop = Math.max(0, box.y + box.height / 2 - pane.height / 2)
}
