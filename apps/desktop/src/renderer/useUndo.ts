/**
 * ONE Undo for a note's two histories. The words have CodeMirror's, the
 * drawing has `DrawingHistory`, and every edit on either side is numbered on
 * the note's `EditClock` (editTimeline.ts), so Ctrl+Z (and Edit ▸ Undo in the
 * menu, which the main process sends here) takes back exactly the most recent
 * edit — whichever side made it — and Ctrl+Shift+Z / Ctrl+Y brings back the
 * one that was undone last. Edit ▸ Undo Drawing / Redo Drawing (App.tsx) stay
 * the drawing's own pair.
 *
 * The keys are heard in the capture phase and swallowed whenever the target
 * is not a text field, even with nothing behind them: the browser's own
 * undo of the editor's contenteditable must never run behind CodeMirror's
 * back (it would undo text CodeMirror does not know it changed).
 */

import { useEffect, useRef } from "react"
import type { EditorView } from "@codemirror/view"
import type { Drawing } from "@writemind/core"
import type { DrawingHistory } from "./drawingHistory"
import { changedBox, stepAcross, type EditClock } from "./editTimeline"
import { tabletUndo } from "./tabletFocus"
import { registerPenHandlers } from "./penActions"

interface Options {
  view: EditorView | null
  history: DrawingHistory
  drawing: Drawing
  /** Put a drawing back (it is saved like any other edit). */
  apply(next: Drawing): void
}

export function useUndo(options: Options): void {
  const latest = useRef(options)
  latest.current = options

  useEffect(() => {
    /** Returns whether anything was undone or redone. */
    const run = (which: "undo" | "redo"): boolean => {
      // The tablet's sheet has its own strokes to take back, when the pen is on it.
      if (tabletUndo(which)) return true
      const { view, history, drawing, apply } = latest.current
      const clock: EditClock = history.clock
      let held = drawing
      const took = stepAcross(which, {
        clock, text: view, history,
        current: () => held,
        apply: (next) => {
          const was = held
          held = next
          apply(next)
          if (view) reveal(view, was, next)
        },
      })
      return took !== null
    }

    const key = (event: KeyboardEvent) => {
      if (event.altKey) return
      const mod = event.ctrlKey || event.metaKey
      if (!mod) return
      // A label being typed has its own undo.
      if (event.target instanceof Element && event.target.closest("input, textarea")) return
      const k = event.key.toLowerCase()
      const which = k === "z" ? (event.shiftKey ? "redo" : "undo") : k === "y" && !event.metaKey ? "redo" : null
      if (!which) return
      run(which)
      event.preventDefault(); event.stopPropagation()
    }
    window.addEventListener("keydown", key, true)
    // The pen's Undo and Redo buttons are this same Undo.
    const penHandlers = registerPenHandlers({ undo: () => { run("undo") }, redo: () => { run("redo") } })
    const unlisten = window.wm.onEdit?.((which) => {
      // The menu's Undo while a label or a text box is being typed in is that field's own.
      const field = document.activeElement
      if (field instanceof HTMLInputElement || field instanceof HTMLTextAreaElement) { document.execCommand(which); return }
      run(which)
    })
    return () => {
      window.removeEventListener("keydown", key, true)
      unlisten?.()
      penHandlers()
    }
  }, [])
}

/** Scroll the page so that what an Undo just changed is in view. */
function reveal(view: EditorView, before: Drawing, after: Drawing): void {
  const scroller = view.scrollDOM
  const pane = { width: scroller.clientWidth, height: scroller.clientHeight }
  if (pane.height === 0) return
  const box = changedBox(before, after, pane)
  if (!box) return
  const top = scroller.scrollTop
  if (box.y + box.height > top && box.y < top + pane.height) return
  scroller.scrollTop = Math.max(0, box.y + box.height / 2 - pane.height / 2)
}
