/**
 * The notebook itself: CodeMirror with WriteMind's extensions on it.
 *
 * The component owns the view and nothing else — every rule it obeys is in
 * `@writemind/editor`, and every rule THAT obeys is in `@writemind/core`.
 */

import { useEffect, useRef, useState } from "react"
import { EditorState, type Extension } from "@codemirror/state"
import { EditorView, drawSelection, highlightActiveLine, rectangularSelection } from "@codemirror/view"
import { history, historyKeymap, defaultKeymap, standardKeymap } from "@codemirror/commands"
import { keymap } from "@codemirror/view"
import {
  cellBrackets, notebookDecorations, notebookKeys, notebookState, notebookTheme,
  seamExtensions, setArmedType, armSeam,
} from "@writemind/editor"
import { ALL_KINDS, KIND_GROUPS, kindName, openCell, type CellKind, type Seam } from "@writemind/core"

export interface NotebookHandle { view: EditorView | null }

interface Props {
  /** The note's path: a change here is a different document, not an edit. */
  file: string
  text: string
  onChange(text: string): void
  onReady(view: EditorView): void
}

export function Notebook({ file, text, onChange, onReady }: Props) {
  const host = useRef<HTMLDivElement | null>(null)
  const view = useRef<EditorView | null>(null)
  const latest = useRef(onChange)
  latest.current = onChange
  const [menu, setMenu] = useState<{ x: number; y: number; seam: Seam } | null>(null)

  useEffect(() => {
    if (!host.current) return
    const extensions: Extension[] = [
      history(),
      drawSelection(),
      rectangularSelection(),
      highlightActiveLine(),
      EditorView.lineWrapping,
      notebookState,
      notebookDecorations,
      cellBrackets,
      seamExtensions((editor, seam) => {
        const box = editor.contentDOM.getBoundingClientRect()
        setMenu({ x: box.left + 24, y: box.top + seam.line - editor.scrollDOM.scrollTop + 8, seam })
      }),
      notebookKeys,
      keymap.of([...standardKeymap, ...historyKeymap, ...defaultKeymap]),
      notebookTheme,
      EditorView.updateListener.of((update) => {
        if (update.docChanged) latest.current(update.state.doc.toString())
      }),
    ]
    const editor = new EditorView({
      state: EditorState.create({ doc: text, extensions }),
      parent: host.current,
    })
    view.current = editor
    onReady(editor)
    editor.focus()
    return () => { editor.destroy(); view.current = null }
    // A new FILE is a new document; text arriving from outside is handled
    // below, so this must not run for every keystroke.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [file])

  // The note changed under us — the folder watcher, another editor, a
  // rename. Replace the document, never the letters one at a time.
  useEffect(() => {
    const editor = view.current
    if (!editor) return
    if (editor.state.doc.toString() === text) return
    editor.dispatch({ changes: { from: 0, to: editor.state.doc.length, insert: text } })
  }, [text])

  const choose = (kind: CellKind) => {
    const editor = view.current
    if (!editor || !menu) return
    setMenu(null)
    // The + does not open the cell: it says what the next character will
    // open, and the bar stays armed. Arming it again keeps the choice.
    editor.dispatch({ effects: [armSeam.of(menu.seam.offset), setArmedType.of(kind)] })
    editor.focus()
  }

  return (
    <div className="editor" ref={host} onMouseDown={() => menu && setMenu(null)}>
      {menu && (
        <div className="kind-menu" style={{ left: menu.x, top: menu.y }}
             onMouseDown={(event) => event.stopPropagation()}>
          {KIND_GROUPS.map((group, index) => (
            <div key={index}>
              {index > 0 && <hr />}
              {group.map((kind) => (
                <button key={kindName(kind)} onClick={() => choose(kind)}>{kindName(kind)}</button>
              ))}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

/** Used by the tests and by the + menu: every kind the list can name. */
export const kinds = ALL_KINDS
export const openACell = openCell
