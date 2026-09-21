/**
 * The window: sidebar · tabs · bar · notebook · footer.
 *
 * The state here is the app's, not the notebook's — which note is open,
 * which are in the tab row, when the last save was. The note's own rules
 * live in the core, and this file may not have an opinion about any of them.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import type { EditorView } from "@codemirror/view"
import type { Note } from "@writemind/core"
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
    setOpen((was) => (was.some((other) => other.path === note.path) ? was : [...was, note]))
    setCurrent(note.path)
    setText(contents)
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
            <TopBar view={view} onExportPDF={() => { void window.wm.exportPDF(title.replace(/\.md$/, "")) }} />
            <Notebook file={current} text={text} onChange={change} onReady={setView} />
            <div className="footer">
              <span>{title}</span>
              <div className="spacer" />
              {stale && <span title="The file changed under the app; nothing was overwritten">
                file changed on disk — not saved
              </span>}
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
