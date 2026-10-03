/**
 * ONE Undo for two histories. The note's words have CodeMirror's; its
 * drawing has `DrawingHistory`. Ctrl+Z (and Edit ▸ Undo in the menu, which
 * the main process sends here) takes back whichever of the two was edited
 * LAST, and goes on down that one until it is empty before it turns to the
 * other. Redo goes back to whichever Undo last took from.
 *
 * The keys are heard in the capture phase and are swallowed only when there
 * was something to undo, so a Ctrl+Z with nothing behind it is still the
 * browser's.
 */

import { useEffect, useRef, type MutableRefObject } from "react"
import { redo, redoDepth, undo, undoDepth } from "@codemirror/commands"
import type { EditorView } from "@codemirror/view"
import type { Drawing } from "@writemind/core"
import type { DrawingHistory } from "./drawingHistory"
import { tabletUndo } from "./tabletFocus"
import { registerPenHandlers } from "./penActions"

interface Options {
  view: EditorView | null
  history: DrawingHistory
  drawing: Drawing
  /** Put a drawing back (it is saved like any other edit). */
  apply(next: Drawing): void
  /** performance.now() of the last edit the USER made to the words. */
  textEditedAt: MutableRefObject<number>
}

export function useUndo(options: Options): void {
  const latest = useRef(options)
  latest.current = options
  const undoneDrawing = useRef(false)

  useEffect(() => {
    /** Returns whether anything was undone or redone. */
    const run = (which: "undo" | "redo"): boolean => {
      // The tablet's sheet has its own strokes to take back, when the pen is on it.
      if (tabletUndo(which)) return true
      const { view, history, drawing, apply, textEditedAt } = latest.current
      const takeDrawing = (): boolean => {
        const next = which === "undo" ? history.undo(drawing) : history.redo(drawing)
        if (!next) return false
        apply(next)
        undoneDrawing.current = which === "undo"
        return true
      }
      const takeText = (): boolean => {
        if (!view) return false
        const depth = which === "undo" ? undoDepth(view.state) : redoDepth(view.state)
        if (depth === 0) return false
        which === "undo" ? undo(view) : redo(view)
        undoneDrawing.current = false
        return true
      }
      if (which === "undo") {
        const drawingNewer = history.canUndo && history.topAt >= textEditedAt.current
        return drawingNewer ? takeDrawing() || takeText() : takeText() || takeDrawing()
      }
      return undoneDrawing.current ? takeDrawing() || takeText() : takeText() || takeDrawing()
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
      if (run(which)) { event.preventDefault(); event.stopPropagation() }
    }
    window.addEventListener("keydown", key, true)
    // The pen's Undo and Redo buttons are this same Undo.
    const penHandlers = registerPenHandlers({ undo: () => { run("undo") }, redo: () => { run("redo") } })
    const unlisten = window.wm.onEdit?.((which) => { run(which) })
    return () => {
      window.removeEventListener("keydown", key, true)
      unlisten?.()
      penHandlers()
    }
  }, [])
}
