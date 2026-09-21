/**
 * The window: sidebar · tabs · bar · notebook · footer.
 *
 * The state here is the app's, not the notebook's — which note is open,
 * which are in the tab row, when the last save was. The note's own rules
 * live in the core, and this file may not have an opinion about any of them.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import type { EditorView } from "@codemirror/view"
import {
  emptyDrawing, newID, noTransform, placedCentre, readDrawing, writeDrawing,
  type Drawing, type Note, type Placement,
} from "@writemind/core"
import { Canvas, type CanvasMode } from "./Canvas"
import { Notebook } from "./Notebook"
import { Sidebar } from "./Sidebar"
import { TopBar } from "./TopBar"
import type { Platform, Section } from "./wm"

/** How long after the last keystroke the note is written. */
const SAVE_AFTER = 500

const countWords = (text: string): number =>
  text.split(/\s+/).filter((word) => word.length > 0).length

export function App() {
  const [platform, setPlatform] = useState<Platform | null>(null)
  const [root, setRoot] = useState<Section | null>(null)
  const [open, setOpen] = useState<Note[]>([])
  const [current, setCurrent] = useState<string | null>(null)
  const [text, setText] = useState("")
  const [saved, setSaved] = useState<Date | null>(null)
  const [stale, setStale] = useState(false)
  const [view, setView] = useState<EditorView | null>(null)
  const [showSidebar, setShowSidebar] = useState(true)
  // The drawing is a SIDECAR, not part of the note: it lives in its own
  // file beside the markdown and nothing on it ever edits the text.
  const [drawing, setDrawing] = useState<Drawing>(emptyDrawing())
  const [mode, setMode] = useState<CanvasMode>("cursor")
  const [penColour, setPenColour] = useState("#2D7DD2")
  const [penWidth, setPenWidth] = useState(3)
  const [placing, setPlacing] = useState<Placement | null>(null)
  const drawingTimer = useRef<number | null>(null)
  const drawingDirty = useRef(false)

  const timer = useRef<number | null>(null)
  const dirty = useRef(false)

  const reload = useCallback(async () => {
    setRoot(await window.wm.tree())
  }, [])

  const openRef = useRef<string | null>(null)
  openRef.current = current

  useEffect(() => {
    void (async () => {
      setPlatform(await window.wm.capabilities())
      await reload()
    })()
    // A note edited in another app shows up here: the folder watcher says
    // something moved, and the open note is read again unless there is an
    // edit in hand that has not reached disk yet — that one is ours, and
    // the save will answer for it.
    return window.wm.onNotesChanged(() => {
      void (async () => {
        await reload()
        const file = openRef.current
        if (!file || dirty.current) return
        const fresh = await window.wm.readNote(file).catch(() => null)
        if (fresh !== null) setText((was) => (was === fresh ? was : fresh))
        // The sidecar too: the drawing is the note's other half, and an
        // edit to it from outside — another window, a sync — has to show
        // up the same way the words do.
        if (drawingDirty.current) return
        const sidecar = await window.wm.readDrawing(file).catch(() => null)
        const next = readDrawing(sidecar)
        setDrawing((was) => (writeDrawing(was) === writeDrawing(next) ? was : next))
      })()
    })
  }, [reload])

  const openNote = useCallback(async (note: Note) => {
    // Save what is in hand before letting go of it: the publisher fires in
    // willSet on the Mac and the same mistake is available here — reading
    // the new note and writing it over the old one.
    if (current && dirty.current) await window.wm.writeNote(current, text)
    dirty.current = false
    const contents = await window.wm.readNote(note.path)
    const sidecar = await window.wm.readDrawing(note.path)
    setOpen((was) => (was.some((other) => other.path === note.path) ? was : [...was, note]))
    setCurrent(note.path)
    setText(contents)
    setDrawing(readDrawing(sidecar))
    drawingDirty.current = false
    setStale(false)
  }, [current, text])

  // The autosave: debounced, and it never clobbers. `writeNote` asks the
  // core's `mayWrite` first, and a refusal leaves the buffer alone and says
  // so in the footer.
  useEffect(() => {
    if (!current || !dirty.current) return
    if (timer.current) window.clearTimeout(timer.current)
    timer.current = window.setTimeout(() => {
      void (async () => {
        const out = await window.wm.writeNote(current, text)
        dirty.current = false
        if (out.written) { setSaved(new Date()); setStale(false) } else setStale(true)
        void reload()
      })()
    }, SAVE_AFTER)
    return () => { if (timer.current) window.clearTimeout(timer.current) }
  }, [text, current, reload])

  const change = useCallback((next: string) => {
    dirty.current = true
    setText(next)
  }, [])

  const changeDrawing = useCallback((next: Drawing) => {
    drawingDirty.current = true
    setDrawing(next)
  }, [])

  // The sidecar saves on the same debounce as the note, and separately
  // from it: a drawing is never part of the markdown.
  useEffect(() => {
    if (!current || !drawingDirty.current) return
    if (drawingTimer.current) window.clearTimeout(drawingTimer.current)
    drawingTimer.current = window.setTimeout(() => {
      void window.wm.writeDrawing(current, writeDrawing(drawing))
      drawingDirty.current = false
    }, SAVE_AFTER)
    return () => { if (drawingTimer.current) window.clearTimeout(drawingTimer.current) }
  }, [drawing, current])

  // The arrow tool and an armed placement are NOT modes: they take the
  // pane for one gesture and hand it back, so picking either puts the pen
  // down and picking the pen puts them away.
  const arm = useCallback((next: Placement | null) => {
    setPlacing(next)
    if (next) setMode("cursor")
  }, [])

  /**
   * A picture pasted or dropped on the page. It goes one gap UNDER the
   * caret's line and flush with the text, and NOTHING MOVES to make room:
   * the picture floats over the note and the note does not know it is
   * there.
   */
  const addPicture = useCallback(async (blob: Blob) => {
    const bytes = new Uint8Array(await blob.arrayBuffer())
    const bitmap = await createImageBitmap(blob).catch(() => null)
    if (!bitmap) return
    const extension = blob.type.includes("jpeg") ? ".jpg"
      : blob.type.includes("gif") ? ".gif"
      : blob.type.includes("webp") ? ".webp" : ".png"
    const saved = await window.wm.saveMedia(bytes, extension)
    const pane = view
      ? { width: view.scrollDOM.clientWidth, height: view.scrollDOM.clientHeight }
      : { width: 800, height: 600 }
    const scroll = view ? view.scrollDOM.scrollTop : 0
    const aspect = bitmap.height / Math.max(bitmap.width, 1)
    const width = Math.min(pane.width * 0.45, bitmap.width)
    // Where the caret's line is, in the same coordinates the layer uses.
    let caretLine = null as null | { x: number; y: number; width: number; height: number }
    if (view) {
      const main = view.state.selection.main
      const block = view.lineBlockAt(main.head)
      caretLine = { x: 30, y: block.top, width: pane.width - 60, height: block.height }
    }
    const centre = placedCentre({ width, height: width * aspect, pane, scroll, caretLine })
    changeDrawing({
      items: [...drawing.items, {
        kind: "image",
        image: {
          id: newID(), file: saved.file, center: centre, width: width / pane.width,
          aspect, transform: noTransform(), hidden: false, group: null,
        },
      }],
    })
  }, [changeDrawing, drawing.items, view])

  /** Insert ▸ Image: the third way in, landing where the other two do. */
  const choosePicture = useCallback(async () => {
    const chosen = await window.wm.choosePicture()
    if (!chosen) return
    await addPicture(new Blob([new Uint8Array(chosen.bytes)],
      { type: chosen.extension === ".png" ? "image/png" : "image/jpeg" }))
  }, [addPicture])

  // ⌘V pastes a picture straight in — and only when the clipboard has one:
  // text pasted into the notebook is the editor's business, never ours.
  useEffect(() => {
    const paste = (event: ClipboardEvent) => {
      const file = [...(event.clipboardData?.items ?? [])]
        .find((item) => item.kind === "file" && item.type.startsWith("image/"))
        ?.getAsFile()
      if (!file) return
      event.preventDefault()
      void addPicture(file)
    }
    window.addEventListener("paste", paste)
    return () => window.removeEventListener("paste", paste)
  }, [addPicture])

  const toggleMode = useCallback(() => {
    setPlacing(null)
    setMode((was) => (was === "pen" ? "cursor" : "pen"))
  }, [])

  const newNote = useCallback(async (folder: string) => {
    const file = await window.wm.createNote(folder)
    await reload()
    await openNote({ path: file, modified: Date.now(), title: "Untitled", snippet: "" })
  }, [openNote, reload])

  const newSection = useCallback(async (parent: string) => {
    await window.wm.createSection(parent)
    await reload()
  }, [reload])

  const close = useCallback((path: string) => {
    setOpen((was) => was.filter((note) => note.path !== path))
    if (current === path) {
      const left = open.filter((note) => note.path !== path)
      const next = left[left.length - 1]
      if (next) void openNote(next)
      else { setCurrent(null); setText("") }
    }
  }, [current, open, openNote])

  const words = useMemo(() => countWords(text), [text])
  const title = current ? current.split("/").pop() ?? "" : ""

  return (
    <div className={`app${platform?.platform === "darwin" ? " mac" : ""}`}>
      {showSidebar && (
        <Sidebar
          root={root}
          openNote={current}
          onOpen={(note) => { void openNote(note) }}
          onNewNote={(folder) => { void newNote(folder) }}
          onNewSection={(parent) => { void newSection(parent) }}
          header={(
            <div className="sidebar-bar">
              <button className="icon-button" title="Hide the notes list"
                      onClick={() => setShowSidebar(false)}>‹</button>
              <div className="bar-divider" />
              <button className="icon-button" title="Open the notes folder"
                      onClick={() => { void window.wm.revealNotes() }}>⤢</button>
              <div className="spacer" />
            </div>
          )}
        />
      )}
      <div className="pane">
        <div className="tab-bar">
          {!showSidebar && (
            <button className="icon-button" title="Show the notes list"
                    onClick={() => setShowSidebar(true)}>›</button>
          )}
          {open.map((note) => (
            <button key={note.path}
                    className={`tab${note.path === current ? " open" : ""}`}
                    onClick={() => { void openNote(note) }}
                    onAuxClick={(event) => { if (event.button === 1) close(note.path) }}>
              <span>{note.title}</span>
              <span className="close" onClick={(event) => { event.stopPropagation(); close(note.path) }}>×</span>
            </button>
          ))}
        </div>
        {current ? (
          <>
            <TopBar view={view} onExportPDF={() => { void window.wm.exportPDF(title.replace(/\.md$/, "")) }}
                    onAddPicture={() => { void choosePicture() }}
                    mode={mode} onToggleMode={toggleMode}
                    penColour={penColour} onPenColour={setPenColour}
                    penWidth={penWidth} onPenWidth={setPenWidth}
                    onPlace={arm} placing={placing} />
            <div className="stack"
                 onDragOver={(event) => { event.preventDefault() }}
                 onDrop={(event) => {
                   const file = [...event.dataTransfer.files].find((one) => one.type.startsWith("image/"))
                   if (!file) return
                   event.preventDefault()
                   void addPicture(file)
                 }}>
              <Notebook file={current} text={text} onChange={change} onReady={setView} />
              <Canvas drawing={drawing} onChange={changeDrawing} mode={mode}
                      colorHex={penColour} penWidth={penWidth}
                      placing={placing} onPlaced={() => setPlacing(null)}
                      scroller={view ? view.scrollDOM : null} />
            </div>
            <div className="footer">
              <span>{title}</span>
              <div className="spacer" />
              {stale && <span title="The file changed under the app; nothing was overwritten">
                file changed on disk — not saved
              </span>}
              {mode === "pen" && <span>Pen</span>}
              {drawing.items.length > 0 && (
                <span>{drawing.items.length === 1 ? "1 object" : `${drawing.items.length} objects`}</span>
              )}
              <span>{words === 1 ? "1 word" : `${words} words`}</span>
              {saved && <span>Saved {saved.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</span>}
            </div>
          </>
        ) : (
          <div className="empty">
            <div style={{ fontSize: 15 }}>No note open</div>
            <div style={{ fontSize: 12 }}>
              {platform ? platform.root : ""}
            </div>
            <button className="icon-button" style={{ width: "auto", padding: "0 10px" }}
                    onClick={() => { void newNote(platform?.root ?? "") }}>
              New note
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
