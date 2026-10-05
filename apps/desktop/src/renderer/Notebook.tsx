/**
 * The notebook itself: CodeMirror with WriteMind's extensions on it.
 *
 * The component owns the view and nothing else — every rule it obeys is in
 * `@writemind/editor`, and every rule THAT obeys is in `@writemind/core`.
 */

import { useEffect, useLayoutEffect, useRef, useState } from "react"
import { EditorState, type Extension, type StateEffect } from "@codemirror/state"
import { EditorView, drawSelection, rectangularSelection } from "@codemirror/view"
import { history, historyKeymap, defaultKeymap, standardKeymap } from "@codemirror/commands"
import { keymap } from "@codemirror/view"
import {
  cellBrackets, folding, foldField, foldedKeys, linkClicks, linkTrigger, mathRendering, notebookDecorations, notebookKeys,
  notebookState, notebookTheme, textConventions, pasteHtmlAsText, hiddenMarkerDeletion, find, preview, rendered, renderedField, markersField, seamExtensions, setArmedType, armSeam,
  setFolds, setPreview, setRendered, setMarkers, listStyleSource, revealAt,
} from "@writemind/editor"
import { ALL_KINDS, KIND_GROUPS, kindName, openCell, type CellKind, type ListStyle, type Seam } from "@writemind/core"
import { textTimeline } from "./editTimeline"
import { historyOf, stashText, takeText } from "./noteHistory"
import "./editor.css"

export interface NotebookHandle { view: EditorView | null }

/** What the session remembers about a note's view of itself. */
export interface ViewState {
  caret: number
  collapsed: string[]
  /** A selection to come back with: from here to `caret` (a link just written is selected, as on the Mac). */
  anchor?: number
  /** Open any closed section that hides the caret (a link landed in it). */
  reveal?: boolean
}

interface Props {
  /** The note's path: a change here is a different document, not an edit. */
  file: string
  text: string
  /** Bumped when `text` arrives from outside, even if it reads the same as before. */
  version: number
  /** Where the caret was and what was closed, when the note was last open. */
  restore?: ViewState | null
  /** The rendered page: every block drawn but the one being written in (see `preview` in the editor package). */
  rendered?: boolean
  /** View ▸ Hide / Show Markdown Markers (default shown): put away on the markdown side, apart from the rendered page. */
  markers?: boolean
  /** The style Format ▸ List and its key write (the chevron beside the list button). */
  listStyle?: ListStyle
  /** The document changed: its words as a function (a snapshot), so a keystroke does not copy the whole note. */
  onChange(text: () => string): void
  onReady(view: EditorView): void
  /** The caret moved, or a section was opened or closed. */
  onViewState?(file: string, state: ViewState): void
  /** `/link` was typed at the caret. */
  onLink?(file: string, caret: number): void
  /** A link was followed (a click on the rendered page, Alt-click on the markdown). */
  onFollow?(file: string, href: string): void
}

export function Notebook({ file, text, version, restore, rendered: showRendered, markers: showMarkers, listStyle, onChange, onReady,
  onViewState, onLink, onFollow }: Props) {
  const host = useRef<HTMLDivElement | null>(null)
  const view = useRef<EditorView | null>(null)
  const latest = useRef(onChange)
  latest.current = onChange
  const reportRef = useRef(onViewState)
  reportRef.current = onViewState
  const followRef = useRef(onFollow)
  followRef.current = onFollow
  const linkRef = useRef(onLink)
  linkRef.current = onLink
  const restoreRef = useRef(restore)
  restoreRef.current = restore
  const renderedRef = useRef(showRendered)
  renderedRef.current = showRendered
  const markersRef = useRef(showMarkers)
  markersRef.current = showMarkers
  const listRef = useRef<ListStyle>(listStyle ?? "dots")
  listRef.current = listStyle ?? "dots"
  const [menu, setMenu] = useState<{ x: number; y: number; seam: Seam } | null>(null)
  // The right-click menu: Windows has no native one in this shell, and a page
  // you cannot right-click Copy/Paste on feels broken on that platform.
  const [context, setContext] = useState<{ x: number; y: number; hasSelection: boolean } | null>(null)
  const menuBox = useRef<HTMLDivElement | null>(null)
  const contextBox = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    if (!host.current) return
    const extensions: Extension[] = [
      history(),
      // Every edit of the words is numbered on the note's clock, so one Undo
      // can take back the words and the drawing in the order they were made.
      textTimeline(historyOf(file).clock),
      drawSelection(),
      // Several cells held at once are several ranges; without this CodeMirror
      // collapses them to the last.
      EditorState.allowMultipleSelections.of(true),
      rectangularSelection(),

      EditorView.lineWrapping,
      notebookState,
      folding,
      rendered,
      listStyleSource.of(() => listRef.current),
      notebookDecorations,
      hiddenMarkerDeletion,
      find,
      cellBrackets,
      mathRendering,
      linkTrigger((_editor, caret) => linkRef.current?.(file, caret)),
      linkClicks((href) => followRef.current?.(file, href)),
      seamExtensions((editor, seam) => {
        const box = editor.contentDOM.getBoundingClientRect()
        setMenu({ x: box.left + 24, y: box.top + seam.line - editor.scrollDOM.scrollTop + 8, seam })
      }),
      // The rendered page: blocks drawn, the open one styled markdown; Return, Backspace, arrows.
      preview,
      notebookKeys,
      textConventions,
      pasteHtmlAsText,
      keymap.of([...standardKeymap, ...historyKeymap, ...defaultKeymap]),
      notebookTheme,
      EditorView.updateListener.of((update) => {
        if (update.docChanged) {
          const snapshot = update.state.doc
          latest.current(() => snapshot.toString())
        }
        // The session keeps the caret and what was closed, per note.
        const foldsMoved = update.state.field(foldField) !== update.startState.field(foldField)
        if (update.selectionSet || foldsMoved || update.docChanged) {
          reportRef.current?.(file, {
            caret: update.state.selection.main.head,
            collapsed: foldedKeys(update.state),
          })
        }
      }),
    ]
    const editor = new EditorView({
      // A note coming back to the front finds its undo where it was left.
      state: takeText(file, text) ?? EditorState.create({ doc: text, extensions }),
      parent: host.current,
    })
    // A note coming back where it was left: its closed sections, and its caret.
    const back = restoreRef.current
    const effects: StateEffect<unknown>[] = [setRendered.of(renderedRef.current === true), setMarkers.of(markersRef.current !== false)]
    if (back && back.collapsed.length > 0) effects.push(setFolds.of(back.collapsed))
    editor.dispatch({ effects })
    // A link that lands in a closed section opens it first (before the caret goes in, or it would step out).
    if (back?.reveal) revealAt(editor, Math.min(Math.max(0, back.caret), editor.state.doc.length))
    if (back) {
      editor.dispatch({
        selection: {
          anchor: Math.min(Math.max(0, back.anchor ?? back.caret), editor.state.doc.length),
          head: Math.min(Math.max(0, back.caret), editor.state.doc.length),
        },
      })
    }
    if (back && back.caret > 0) {
      editor.dispatch({ effects: EditorView.scrollIntoView(editor.state.selection.main.head, { y: "center" }) })
    }
    view.current = editor
    onReady(editor)
    editor.focus()
    return () => { stashText(file, editor.state); editor.destroy(); view.current = null }
    // A new FILE is a new document; text arriving from outside is handled
    // below, so this must not run for every keystroke.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [file])

  // The note changed under us — the folder watcher, another editor, a
  // rename. Replace the document, never the letters one at a time.
  useEffect(() => {
    const editor = view.current
    if (!editor) return
    if (editor.state.doc.length === text.length && editor.state.doc.toString() === text) return
    editor.dispatch({ changes: { from: 0, to: editor.state.doc.length, insert: text } })
    // `version` is a dependency on purpose: the same words arriving twice
    // are still an instruction to replace what is in the editor.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [text, version])

  // The rendered page and the markdown are one document in two dresses, so
  // the toggle changes how it is drawn and nothing about where anything is:
  // the cell at the top of the window is put back at the top of the other side.
  useEffect(() => {
    const editor = view.current
    if (!editor) return
    if (editor.state.field(renderedField) !== (showRendered === true)) setPreview(editor, showRendered === true)
  }, [showRendered, file])

  // View ▸ Hide / Show Markdown Markers: the marks on the lines the caret is not in.
  useEffect(() => {
    const editor = view.current
    if (!editor) return
    const want = showMarkers !== false
    if (editor.state.field(markersField) !== want) editor.dispatch({ effects: setMarkers.of(want) })
  }, [showMarkers, file])

  // Escape puts either menu away and gives the keyboard back to the page.
  useEffect(() => {
    if (!menu && !context) return
    const away = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return
      event.preventDefault()
      setMenu(null)
      setContext(null)
      view.current?.focus()
    }
    const click = (event: MouseEvent) => {
      if (event.target instanceof Element && event.target.closest(".kind-menu, .context-menu")) return
      setMenu(null)
      setContext(null)
    }
    window.addEventListener("keydown", away, true)
    window.addEventListener("mousedown", click, true)
    const blur = () => { setMenu(null); setContext(null) }
    window.addEventListener("blur", blur)
    return () => {
      window.removeEventListener("keydown", away, true)
      window.removeEventListener("mousedown", click, true)
      window.removeEventListener("blur", blur)
    }
  }, [menu, context])

  // A menu opened near the bottom or right edge is moved back inside the window
  // rather than cut off by it.
  useLayoutEffect(() => {
    for (const [box, at] of [[menuBox.current, menu], [contextBox.current, context]] as const) {
      if (!box || !at) continue
      const rect = box.getBoundingClientRect()
      const top = Math.max(4, Math.min(at.y, window.innerHeight - rect.height - 6))
      const left = Math.max(4, Math.min(at.x, window.innerWidth - rect.width - 6))
      box.style.top = `${top}px`
      box.style.left = `${left}px`
    }
  }, [menu, context])

  const showContext = (event: React.MouseEvent) => {
    const editor = view.current
    if (!editor || !(event.target instanceof Element) || !event.target.closest(".cm-content")) return
    event.preventDefault()
    setMenu(null)
    // A right-click outside the selection moves the caret there first, as every editor does.
    const at = editor.posAtCoords({ x: event.clientX, y: event.clientY })
    const inside = at !== null && editor.state.selection.ranges.some((r) => !r.empty && at >= r.from && at <= r.to)
    if (at !== null && !inside) editor.dispatch({ selection: { anchor: at } })
    editor.focus()
    setContext({ x: event.clientX, y: event.clientY, hasSelection: editor.state.selection.ranges.some((r) => !r.empty) })
  }

  const clipboard = (command: "cut" | "copy" | "paste" | "selectAll") => {
    const editor = view.current
    setContext(null)
    if (!editor) return
    editor.focus()
    if (command === "selectAll") { editor.dispatch({ selection: { anchor: 0, head: editor.state.doc.length } }); return }
    // The shell does it: a page may not paste on its own say-so.
    void window.wm.editNative(command)
  }

  const choose = (kind: CellKind) => {
    const editor = view.current
    if (!editor || !menu) return
    setMenu(null)
    // The + does not open the cell: it says what the next character will
    // open, and the bar stays armed. Arming it again keeps the choice.
    // The caret goes to the blank line the bar stands on (or the end of the
    // page the bar is at), so the bar is the cursor and nothing else is.
    const at = menu.seam.offset === 0 || menu.seam.offset >= editor.state.doc.length
      ? menu.seam.offset : menu.seam.offset - 1
    editor.dispatch({
      selection: { anchor: at },
      effects: [armSeam.of(menu.seam.offset), setArmedType.of(kind)],
    })
    editor.focus()
  }

  return (
    <div className="editor" ref={host} onMouseDown={() => menu && setMenu(null)} onContextMenu={showContext}>
      {context && (
        <div className="context-menu" ref={contextBox} style={{ left: context.x, top: context.y }}
             onMouseDown={(event) => event.stopPropagation()}>
          <button disabled={!context.hasSelection} onClick={() => clipboard("cut")}>Cut<kbd>Ctrl+X</kbd></button>
          <button disabled={!context.hasSelection} onClick={() => clipboard("copy")}>Copy<kbd>Ctrl+C</kbd></button>
          <button onClick={() => clipboard("paste")}>Paste<kbd>Ctrl+V</kbd></button>
          <hr />
          <button onClick={() => clipboard("selectAll")}>Select All<kbd>Ctrl+A</kbd></button>
        </div>
      )}
      {menu && (
        <div className="kind-menu" ref={menuBox} style={{ left: menu.x, top: menu.y }}
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
