/**
 * The notebook itself: CodeMirror with WriteMind's extensions on it.
 *
 * The component owns the view and nothing else — every rule it obeys is in
 * `@writemind/editor`, and every rule THAT obeys is in `@writemind/core`.
 */

import { useEffect, useRef, useState } from "react"
import { Compartment, EditorState, StateEffect, type Extension } from "@codemirror/state"
import { EditorView, drawSelection, rectangularSelection } from "@codemirror/view"
import { history, historyKeymap, defaultKeymap, isolateHistory, standardKeymap } from "@codemirror/commands"
import { keymap } from "@codemirror/view"
import {
  armAt, armedField, cellBrackets, folding, foldField, foldedKeys, linkClicks, linkTrigger, mathRendering, notebookDecorations, notebookKeys,
  notebookState, notebookTheme, textConventions, pasteHtmlAsText, drawingPasted, pasteDrawing, hiddenMarkerDeletion, find, preview, rendered, renderedField, markersField, seamExtensions,
  setFolds, setPreview, setRendered, setMarkers, listStyleSource, revealAt, PLUS_CENTRE_X, PLUS_DIAMETER,
} from "@writemind/editor"
import { ALL_KINDS, openCell, type CodeLanguage, type ListStyle, type Seam } from "@writemind/core"
import { textTimeline } from "./editTimeline"
import { historyOf, stashText, takeText } from "./noteHistory"
import { cellsCopied, evaluationCells, evalHost, inkCellPainter, pictureCells, type InkCellPainter } from "@writemind/editor"
import { tables, textCells } from "@writemind/editor"
import { evalHostOfApp } from "./evalHost"
import { FloatingMenu, type MenuItem } from "./FloatingMenu"
import { runEditorCommand } from "./editorCommands"
import { kindMenuItems, type KindPick } from "./kindMenu"
import { modChord } from "../shared/chord"
import "./editor.css"

export interface NotebookHandle { view: EditorView | null }

/** A note of a newer format is read-only here (SPEC-WM 1.8): the editor takes no edit, whatever state it is brought back with. */
const readOnlySwitch = new Compartment()

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
  /** The note is read-only (a newer WriteMind wrote it): no edit is taken. */
  readOnly?: boolean
  /** The rendered page: every block drawn but the one being written in (see `preview` in the editor package). */
  rendered?: boolean
  /** View ▸ Hide / Show Markdown Markers (default shown): put away on the markdown side, apart from the rendered page. */
  markers?: boolean
  /** The style Format ▸ List and its key write (the chevron beside the list button). */
  listStyle?: ListStyle
  /** The language Code Block's key and the + menu's Code write (the chevron beside the code button); plain by default. */
  codeLanguage?: CodeLanguage
  /** The document changed: its words as a function (a snapshot), so a keystroke does not copy the whole note. */
  onChange(text: () => string): void
  onReady(view: EditorView): void
  /** The caret moved, or a section was opened or closed. */
  onViewState?(file: string, state: ViewState): void
  /** `/link` was typed at the caret. */
  onLink?(file: string, caret: number): void
  /** A link was followed (a click on the rendered page, Alt-click on the markdown). */
  onFollow?(file: string, href: string): void
  /** What draws and resizes the note's ink cells (docs\PLAN-docking-ink-cells.md (c)); none: ink cells are read-only. */
  inkPainter?: InkCellPainter | null
  /** The + menu's Drawing Cell at a bar: the app writes the ink cell's line and its sidecar item there. */
  onInsertInkCell?(offset: number): void
  /** Held cells were copied or cut (before the cut takes them out): the app copies their drawing cells for Mathematica. */
  onCellsCopied?(copy: { markdown: string; plain: string }): void
  /** A paste of a drawing cell copied from the tablet box (Copy Cell; packages/editor paste.ts): true when it is one, and landed. */
  onDrawingPasted?(data: DataTransfer): boolean
  /** This machine's platform, for the keys the menus print ("Cmd+X" on a Mac, "Ctrl+X" elsewhere). */
  platform?: string
}

export function Notebook({ file, text, version, restore, readOnly, rendered: showRendered, markers: showMarkers, listStyle, codeLanguage, onChange, onReady,
  onViewState, onLink, onFollow, inkPainter, onInsertInkCell, onCellsCopied, onDrawingPasted, platform = "win32" }: Props) {
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
  const readOnlyRef = useRef(readOnly === true)
  readOnlyRef.current = readOnly === true
  const renderedRef = useRef(showRendered)
  renderedRef.current = showRendered
  const markersRef = useRef(showMarkers)
  markersRef.current = showMarkers
  const listRef = useRef<ListStyle>(listStyle ?? "dots")
  listRef.current = listStyle ?? "dots"
  const codeRef = useRef<CodeLanguage>(codeLanguage ?? "plain")
  codeRef.current = codeLanguage ?? "plain"
  const painterRef = useRef(inkPainter ?? null)
  painterRef.current = inkPainter ?? null
  const insertInkRef = useRef(onInsertInkCell)
  insertInkRef.current = onInsertInkCell
  const copiedRef = useRef(onCellsCopied)
  copiedRef.current = onCellsCopied
  const pastedRef = useRef(onDrawingPasted)
  pastedRef.current = onDrawingPasted
  // ONE painter object for the editor's whole life (the facet never changes); it asks whatever the app gives now.
  const painter = useRef<InkCellPainter>({
    aspect: (id) => painterRef.current?.aspect(id) ?? null,
    minAspect: (id) => painterRef.current?.minAspect(id) ?? 0,
    paint: (id, canvas, size) => painterRef.current?.paint(id, canvas, size),
    resized: (id, aspect) => painterRef.current?.resized(id, aspect),
  }).current
  const [menu, setMenu] = useState<{ x: number; y: number; seam: Seam } | null>(null)
  // The right-click menu: Windows has no native one in this shell, and a page
  // you cannot right-click Copy/Paste on feels broken on that platform.
  const [context, setContext] = useState<{ x: number; y: number; hasSelection: boolean } | null>(null)

  useEffect(() => {
    if (!host.current) return
    const extensions: Extension[] = [
      readOnlySwitch.of(EditorState.readOnly.of(readOnlyRef.current)),
      // (Sean, 2026-10-10: Undo reaches back at least 200 steps of typing; CodeMirror keeps between this and twice it.)
      history({ minDepth: 200 }),
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
      // Text cells and markdown cells (docs/PLAN-text-cells.md): the marker hidden, typing literal, copy plain.
      textCells,
      hiddenMarkerDeletion,
      find,
      cellBrackets,
      // Evaluation cells: Shift+Enter runs one (in the shell, main/eval), Ctrl+Shift+8 makes one, the In/Out marks.
      evaluationCells,
      evalHost.of(evalHostOfApp),
      mathRendering,
      linkTrigger((_editor, caret) => linkRef.current?.(file, caret)),
      linkClicks((href) => followRef.current?.(file, href)),
      seamExtensions((editor, seam) => {
        // The menu opens beside the marker, which is drawn on the bar's line in the left margin. (The content box's top
        // already moves with the scroll: the page's own y is added to it as it is.)
        const box = editor.contentDOM.getBoundingClientRect()
        setMenu({ x: box.left + PLUS_CENTRE_X + PLUS_DIAMETER / 2 + 6, y: box.top + seam.line - 10, seam })
      }),
      // Tables: the grid in the markdown, Tab / Shift+Tab cell to cell, Return adds a row (ahead of the page's Return).
      tables,
      // The rendered page: blocks drawn, the open one styled markdown; Return, Backspace, arrows.
      preview,
      // Picture and ink cells, both panes: block widgets the caret and text go above and below.
      pictureCells,
      inkCellPainter.of(painter),
      cellsCopied.of((copy) => copiedRef.current?.(copy)),
      drawingPasted.of((data) => pastedRef.current?.(data) ?? false),
      pasteDrawing,
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
    // A note coming back to the front finds its undo where it was left — under the same name or a new one (a rename or a move
    // carries it: noteHistory.ts). The state that was put aside is given THIS path's extensions (the closures name `file`).
    const aside = takeText(file, text)
    const editor = new EditorView({
      state: aside ? aside.update({ effects: StateEffect.reconfigure.of(extensions) }).state : EditorState.create({ doc: text, extensions }),
      parent: host.current,
    })
    // A note coming back where it was left: its closed sections, and its caret.
    const back = restoreRef.current
    const effects: StateEffect<unknown>[] = [setRendered.of(renderedRef.current === true), setMarkers.of(markersRef.current !== false), readOnlySwitch.reconfigure(EditorState.readOnly.of(readOnlyRef.current))]
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
    // Its own undo step, never joined to typing: Undo brings the words that were there back ("Undo Edit"). Not an edit that
    // was not wanted: the same words arriving again change nothing (the early return above), so a reload that did not change
    // the text leaves the note's history alone.
    editor.dispatch({ changes: { from: 0, to: editor.state.doc.length, insert: text }, annotations: isolateHistory.of("full") })
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

  useEffect(() => {
    const editor = view.current
    if (!editor) return
    if (editor.state.readOnly !== (readOnly === true)) editor.dispatch({ effects: readOnlySwitch.reconfigure(EditorState.readOnly.of(readOnly === true)) })
  }, [readOnly, file])

  // View ▸ Hide / Show Markdown Markers: the marks on the lines the caret is not in.
  useEffect(() => {
    const editor = view.current
    if (!editor) return
    const want = showMarkers !== false
    if (editor.state.field(markersField) !== want) editor.dispatch({ effects: setMarkers.of(want) })
  }, [showMarkers, file])

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

  // A kind picked from the + menu: the bar is up where the + was pressed (the press armed it), and the cell is made there NOW,
  // empty, the caret in it where its words go (Sean, 2026-10-05: "selecting a cell type ... should create a new cell with the
  // cursor ready to start typing"), by THE command the key and the Style menu run (`runEditorCommand`: a kind at a bar makes
  // the cell there, keys.ts `nameKind`). A Drawing Cell is made by the app: its line names a cell in the drawing (the bar's
  // typing never makes one), and the pointer becomes a pen for that cell alone (inkScope.ts).
  const choose = (pick: KindPick) => {
    const editor = view.current
    const seam = menu?.seam
    setMenu(null)
    if (!editor || !seam) return
    if ((editor.state.field(armedField, false) ?? null) !== seam.offset) armAt(editor, seam.offset)
    if (pick.command === "insertInkCell") insertInkRef.current?.(seam.offset)
    else runEditorCommand(editor, pick.command, { listStyle: pick.listStyle ?? listRef.current, codeLanguage: codeRef.current })
    editor.focus()
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

  const contextItems = (hasSelection: boolean): MenuItem[] => [
    { label: "Cut", hint: modChord(platform, "X"), disabled: !hasSelection, onClick: () => clipboard("cut") },
    { label: "Copy", hint: modChord(platform, "C"), disabled: !hasSelection, onClick: () => clipboard("copy") },
    { label: "Paste", hint: modChord(platform, "V"), onClick: () => clipboard("paste") },
    "-",
    { label: "Select All", hint: modChord(platform, "A"), onClick: () => clipboard("selectAll") },
  ]

  return (
    <div className="editor" ref={host} onMouseDown={() => menu && setMenu(null)} onContextMenu={showContext}>
      {/* Both menus are the page's FloatingMenu: the arrow keys, Escape, a press elsewhere, the window's edge and the
          keyboard handed back are its own (docs/PLAN-bars-2026-10.md, P6; they were two hand-made boxes with half of that each). */}
      {context && (
        <FloatingMenu id="context-menu" x={context.x} y={context.y} items={contextItems(context.hasSelection)}
                      onClose={() => setContext(null)} />
      )}
      {menu && (
        <FloatingMenu x={menu.x} y={menu.y} id="seam-kinds" onClose={() => setMenu(null)}
                      items={kindMenuItems(platform, null, choose)} />
      )}
    </div>
  )
}

/** Used by the tests and by the + menu: every kind the list can name. */
export const kinds = ALL_KINDS
export const openACell = openCell
