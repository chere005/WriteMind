/**
 * The window: sidebar · tabs · bar · notebook · footer.
 *
 * The state here is the app's, not the notebook's — which note is open,
 * which are in the tab row, when the last save was. The note's own rules
 * live in the core, and this file may not have an opinion about any of them.
 */

import { useCallback, useEffect, useRef, useState } from "react"
import type { EditorView } from "@codemirror/view"
import {
  anchorOffset, emptyDrawing, insertBlock, languageTitle, listTitle, makeNote, newID, noTransform,
  parseLink, placedCentre, PRESET_COLOURS, readDrawing, writeDrawing,
  type CanvasItem, type CodeLanguage, type Drawing, type ListStyle, type Note, type Placement,
} from "@writemind/core"
import { Canvas, type CanvasMode } from "./Canvas"
import { DrawingHistory } from "./drawingHistory"
import { useUndo } from "./useUndo"
import { CameraPane, type Capture } from "./CameraPane"
import { PadMode } from "./PadMode"
import { Notebook, type ViewState } from "./Notebook"
import { LinkBanner, type LinkRequest } from "./LinkBanner"
import { Sidebar, SidebarBar } from "./Sidebar"
import { TopBar, TOOL_GROUPS, type ToolGroupId } from "./TopBar"
import { runEditorCommand } from "./editorCommands"
import { useChrome } from "./useChrome"
import { putToolsDown, usePenSettings } from "./penSettings"
import { registerPenHandlers, runPenCommand } from "./penActions"
import { cycleColour, stepWidth, PEN_WIDTHS } from "./penButtons"
import { setPenLook } from "./penCursor"
import { TABLET_SOURCE } from "../shared/commands"
import { joinPath, folderOf, notesIn } from "./paths"
import { useSession } from "./useSession"
import type { Platform, Section } from "./wm"

/** How long after the last keystroke the note is written. */
const SAVE_AFTER = 500

/** Small per-viewer choices (which toolbar sections are put away, the list style). */
function remembered<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(`writemind.${key}`)
    return raw === null ? fallback : (JSON.parse(raw) as T)
  } catch { return fallback }
}
function remember(key: string, value: unknown): void {
  try { localStorage.setItem(`writemind.${key}`, JSON.stringify(value)) } catch { /* private window */ }
}

const countWords = (text: string): number =>
  text.split(/\s+/).filter((word) => word.length > 0).length

export function App() {
  const [platform, setPlatform] = useState<Platform | null>(null)
  const [root, setRoot] = useState<Section | null>(null)
  const [open, setOpen] = useState<Note[]>([])
  const [current, setCurrent] = useState<string | null>(null)
  // The words are held in a REF while they are being typed: a state that
  // changed on every keystroke re-rendered the whole window for each letter.
  // `loaded` is only for text arriving from OUTSIDE the editor (opening a
  // note, the folder watcher, a picture read), which the notebook must be
  // told about; `version` makes the same text arriving twice still a change.
  const [loaded, setLoaded] = useState({ text: "", version: 0 })
  const [words, setWords] = useState(0)
  const textRef = useRef("")
  const [saved, setSaved] = useState<Date | null>(null)
  const [stale, setStale] = useState(false)
  const [view, setView] = useState<EditorView | null>(null)
  const [showSidebar, setShowSidebar] = useState(true)
  // The caret and the closed sections of every note, kept for the session.
  const viewStates = useRef(new Map<string, ViewState>())
  const [linking, setLinking] = useState<LinkRequest | null>(null)
  // The rendered page: the same editor with the markdown's marks put away.
  const [rendered, setRendered] = useState(false)
  // The camera is not opened until it is asked for: a writing app that
  // comes up with a camera dialog is the wrong first impression, and on
  // the web the permission prompt IS that dialog.
  const [showCamera, setShowCamera] = useState(false)
  // View > Hide Notes Pane: either pane can be put away, never both.
  const [showEditor, setShowEditor] = useState(true)
  // Sidebar edit mode: duplicate and trash on every row.
  const [editing, setEditing] = useState(false)
  // The toolbar's sections that are put away, and what the list and code
  // buttons write — remembered, as the Mac keeps them in its defaults.
  const [collapsedGroups, setCollapsedGroups] = useState<ToolGroupId[]>(() =>
    remembered<string[]>("collapsedGroups", []).filter(
      (id): id is ToolGroupId => TOOL_GROUPS.some((group) => group.id === id)))
  const [listStyle, setListStyle] = useState<ListStyle>(() => remembered<ListStyle>("listStyle", "dots"))
  const [codeLanguage, setCodeLanguage] = useState<CodeLanguage>(() =>
    remembered<CodeLanguage>("codeLanguage", "plain"))
  // The cameras the machine has, and the one picked from a menu.
  const [cameras, setCameras] = useState<{ id: string; name: string }[]>([])
  // The tablet, picked as a source, is remembered; a camera is chosen afresh.
  const [cameraPick, setCameraPick] = useState<string | null>(() =>
    remembered<string | null>("videoSource", null) === TABLET_SOURCE ? TABLET_SOURCE : null)
  // The drawing is a SIDECAR, not part of the note: it lives in its own
  // file beside the markdown and nothing on it ever edits the text.
  const [drawing, setDrawing] = useState<Drawing>(emptyDrawing())
  const [mode, setMode] = useState<CanvasMode>("cursor")
  const [penColour, setPenColour] = useState("#2D7DD2")
  const [penWidth, setPenWidth] = useState(3)
  const [placing, setPlacing] = useState<Placement | null>(null)
  // PAD MODE: the window is full screen and shows only the tablet sheet. The
  // notes pane's size is taken on the way in, so what is sent from the pad is
  // measured against the pane the note really has, not the full-screen one.
  const [pad, setPad] = useState(false)
  const padPane = useRef({ width: 800, height: 600 })
  const padRef = useRef(false)
  useEffect(() => { setPenLook(penColour, penWidth) }, [penColour, penWidth])
  const drawingTimer = useRef<number | null>(null)
  const drawingDirty = useRef(false)
  // The drawing's undo, shared with the canvas; and when the words were last
  // edited, so that ONE Undo can take back whichever of the two came last.
  const history = useRef(new DrawingHistory()).current
  const textEditedAt = useRef(0)

  const timer = useRef<number | null>(null)
  const dirty = useRef(false)

  const lastTree = useRef("")
  const reload = useCallback(async () => {
    const next = await window.wm.tree()
    // A tree that has not changed is not a new tree: the sidebar keeps its
    // rows instead of re-rendering all of them after every save.
    const fingerprint = JSON.stringify(next)
    if (fingerprint === lastTree.current) return
    lastTree.current = fingerprint
    setRoot(next)
  }, [])

  const wordTimer = useRef<number | null>(null)
  /** Text that came from outside the editor. */
  const setDocument = useCallback((next: string) => {
    textRef.current = next
    setLoaded((was) => ({ text: next, version: was.version + 1 }))
    setWords(countWords(next))
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
        if (fresh !== null && fresh !== textRef.current) setDocument(fresh)
        // The sidecar too: the drawing is the note's other half, and an
        // edit to it from outside — another window, a sync — has to show
        // up the same way the words do.
        if (drawingDirty.current) return
        const sidecar = await window.wm.readDrawing(file).catch(() => null)
        const next = readDrawing(sidecar)
        setDrawing((was) => (writeDrawing(was) === writeDrawing(next) ? was : next))
      })()
    })
  }, [reload, setDocument])

  const openNote = useCallback(async (note: Note) => {
    // Save what is in hand before letting go of it: the publisher fires in
    // willSet on the Mac and the same mistake is available here — reading
    // the new note and writing it over the old one.
    if (timer.current) window.clearTimeout(timer.current)
    if (openRef.current && dirty.current) await window.wm.writeNote(openRef.current, textRef.current)
    dirty.current = false
    const contents = await window.wm.readNote(note.path)
    const sidecar = await window.wm.readDrawing(note.path)
    setOpen((was) => (was.some((other) => other.path === note.path) ? was : [...was, note]))
    setCurrent(note.path)
    setDocument(contents)
    setDrawing(readDrawing(sidecar))
    history.clear()
    drawingDirty.current = false
    setStale(false)
  }, [setDocument])

  // The autosave: debounced, and it never clobbers. `writeNote` asks the
  // core's `mayWrite` first, and a refusal leaves the buffer alone and says
  // so in the footer. It is scheduled from the edit itself rather than from
  // an effect on the text, so typing does not render this component.
  const save = useCallback(() => {
    const file = openRef.current
    if (!file || !dirty.current) return
    void (async () => {
      const out = await window.wm.writeNote(file, textRef.current)
      if (openRef.current === file) dirty.current = false
      if (out.written) { setSaved(new Date()); setStale(false) } else setStale(true)
      void reload()
    })()
  }, [reload])

  const change = useCallback((next: string) => {
    textEditedAt.current = performance.now()
    dirty.current = true
    textRef.current = next
    if (timer.current) window.clearTimeout(timer.current)
    timer.current = window.setTimeout(save, SAVE_AFTER)
    if (wordTimer.current) window.clearTimeout(wordTimer.current)
    wordTimer.current = window.setTimeout(() => setWords(countWords(textRef.current)), 300)
  }, [save])

  const changeDrawing = useCallback((next: Drawing) => {
    drawingDirty.current = true
    setDrawing(next)
  }, [])

  /** A change made outside the canvas (a paste, a capture): one Undo takes it back. */
  const drawingRef = useRef(drawing)
  drawingRef.current = drawing
  const editDrawing = useCallback((next: Drawing) => {
    history.record(drawingRef.current)
    changeDrawing(next)
  }, [changeDrawing, history])
  useUndo({ view, history, drawing, apply: changeDrawing, textEditedAt })

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
    if (next) { setMode("cursor"); putToolsDown() }
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
    editDrawing({
      items: [...drawingRef.current.items, {
        kind: "image",
        image: {
          id: newID(), file: saved.file, center: centre, width: width / pane.width,
          aspect, transform: noTransform(), hidden: false, group: null,
        },
      }],
    })
  }, [editDrawing, view])

  /**
   * A capture off the camera, landing where it was on the page — and, when
   * the camera read a flow chart off it, the chart as real nodes and arrows
   * under it (the canvas routes the arrows when the drawing arrives).
   */
  const addCapture = useCallback(async (capture: Capture) => {
    const picture: CanvasItem[] = []
    if (capture.blob) {
      const bytes = new Uint8Array(await capture.blob.arrayBuffer())
      const saved = await window.wm.saveMedia(bytes,
        capture.blob.type.includes("png") ? ".png" : ".jpg")
      picture.push({
        kind: "image",
        image: {
          id: newID(), file: saved.file, center: capture.center, width: capture.width,
          aspect: capture.aspect, transform: noTransform(), hidden: false, group: null,
        },
      })
    }
    editDrawing({
      items: [...drawingRef.current.items, ...picture, ...(capture.strokes ?? []), ...(capture.chart ?? [])],
    })
  }, [editDrawing])

  /**
   * The words out of a picture, into the note as a cell of its own — and
   * the picture is PUT AWAY rather than thrown away, so nothing is lost
   * if the reading was wrong.
   */
  const readPicture = useCallback(async (file: string, id: string) => {
    const out = await window.wm.readPicture(file)
    const words = out.lines.filter((line) => line.confidence >= 0.3).map((line) => line.text)
    if (words.length === 0) {
      console.error("WriteMind: the reader found no words in that picture")
      return
    }
    const editor = view
    const text = textRef.current
    const at = editor ? editor.state.selection.main.head : text.length
    const opened = insertBlock(text, at)
    const written = opened.markdown.slice(0, opened.caret) + words.join("\n")
      + opened.markdown.slice(opened.caret)
    change(written)
    setDocument(written)
    editDrawing({
      items: drawingRef.current.items.map((item) =>
        item.kind === "image" && item.image.id === id
          ? { kind: "image", image: { ...item.image, hidden: true } }
          : item),
    })
  }, [change, editDrawing, setDocument, view])

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

  const enterPad = useCallback(() => {
    if (padRef.current) return
    padPane.current = view
      ? { width: view.scrollDOM.clientWidth, height: view.scrollDOM.clientHeight }
      : { width: 800, height: 600 }
    padRef.current = true
    setPad(true)
    void window.wm.padEnter().then((ok) => { if (!ok) { padRef.current = false; setPad(false) } })
  }, [view])
  const exitPad = useCallback(() => {
    padRef.current = false
    setPad(false)
    void window.wm.padExit()
  }, [])
  // The shell says when the pad ends by itself (full screen lost some other way).
  useEffect(() => window.wm.onPadState((active) => {
    padRef.current = active
    setPad(active)
  }), [])

  const toggleMode = useCallback(() => {
    setPlacing(null)
    putToolsDown()
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

  // The session: what is open, what is in front, where the caret was.
  const session = useSession({ root, open, current, states: viewStates, setOpen, openNote })
  const onViewState = useCallback((file: string, state: ViewState) => {
    viewStates.current.set(file, state)
    session.touch()
  }, [session])
  /**
   * A link followed: the note it names (relative to the one it is in) is
   * opened, at the part it points to — a `<mark>` or `<a id>` written by
   * `/link`, or a heading's slug. A link to somewhere else is not ours to open.
   */
  const followLink = useCallback(async (from: string, href: string) => {
    if (/^[a-z][a-z0-9+.-]*:/i.test(href)) return
    const { file, anchor } = parseLink(href)
    const target = file ? joinPath(folderOf(from), file) : from
    if ((await window.wm.existing([target])).length === 0) return
    const text = target === from ? textRef.current : await window.wm.readNote(target).catch(() => "")
    const offset = anchor ? anchorOffset(text, anchor) : null
    if (target === from) {
      if (offset !== null && view) {
        view.dispatch({ selection: { anchor: offset }, scrollIntoView: true })
        view.focus()
      }
      return
    }
    const known = root ? notesIn(root).find((note) => note.path === target) : undefined
    const was = viewStates.current.get(target)
    if (offset !== null) viewStates.current.set(target, { caret: offset, collapsed: was?.collapsed ?? [] })
    await openNote(known ?? makeNote(target, Date.now(), text))
  }, [openNote, root, view])
  const onFollow = useCallback((from: string, href: string) => { void followLink(from, href) }, [followLink])
  const onLink = useCallback((file: string, caret: number) => setLinking({ file, caret }), [])
  const doneLinking = useCallback(() => setLinking(null), [])

  /**
   * A row dragged onto another: the file moves (if the folder is another)
   * and takes its place in the order. What is open follows the file, and a
   * note being typed in is written first, so nothing is lost on the way.
   */
  const followMoved = useCallback((from: string, to: string) => {
    if (from === to) return
    const rename = (path: string) =>
      (path === from ? to : path.startsWith(from + "/") || path.startsWith(from + "\\")
        ? to + path.slice(from.length) : path)
    setOpen((was) => was.map((note) => ({ ...note, path: rename(note.path) })))
    for (const [path, state] of [...viewStates.current]) {
      if (rename(path) !== path) { viewStates.current.delete(path); viewStates.current.set(rename(path), state) }
    }
    const front = openRef.current
    if (front && rename(front) !== front) {
      openRef.current = rename(front)
      setCurrent(rename(front))
    }
  }, [])

  const placeNote = useCallback(async (file: string, folder: string, before: string | null) => {
    if (timer.current) window.clearTimeout(timer.current)
    if (openRef.current === file && dirty.current) {
      await window.wm.writeNote(file, textRef.current)
      dirty.current = false
    }
    const landed = await window.wm.placeNote(file, folder, before)
    followMoved(file, landed)
    lastTree.current = ""
    await reload()
  }, [followMoved, reload])

  const moveSection = useCallback(async (folder: string, target: string) => {
    if (timer.current) window.clearTimeout(timer.current)
    if (openRef.current && dirty.current) {
      await window.wm.writeNote(openRef.current, textRef.current)
      dirty.current = false
    }
    const landed = await window.wm.moveSection(folder, target)
    if (landed) followMoved(folder, landed)
    lastTree.current = ""
    await reload()
  }, [followMoved, reload])

  const close = useCallback((path: string) => {
    viewStates.current.delete(path)
    setOpen((was) => was.filter((note) => note.path !== path))
    if (current === path) {
      const left = open.filter((note) => note.path !== path)
      const next = left[left.length - 1]
      if (next) void openNote(next)
      else { setCurrent(null); setDocument("") }
    }
  }, [current, open, openNote, setDocument])

  // MARK: - Edit mode in the sidebar

  /** Letting go of a note that is about to be trashed: what is in hand must not be written back after it. */
  const letGo = useCallback((paths: (path: string) => boolean) => {
    if (openRef.current && paths(openRef.current)) {
      if (timer.current) window.clearTimeout(timer.current)
      if (drawingTimer.current) window.clearTimeout(drawingTimer.current)
      dirty.current = false
      drawingDirty.current = false
    }
  }, [])

  const trashNote = useCallback(async (note: Note) => {
    letGo((path) => path === note.path)
    await window.wm.trashNote(note.path)
    close(note.path)
    lastTree.current = ""
    await reload()
  }, [close, letGo, reload])

  const trashSection = useCallback(async (section: Section) => {
    const inside = (path: string) => path.startsWith(section.path + "/") || path.startsWith(section.path + "\\")
    letGo(inside)
    await window.wm.trashSection(section.path)
    for (const note of open) if (inside(note.path)) close(note.path)
    lastTree.current = ""
    await reload()
  }, [close, letGo, open, reload])

  const duplicate = useCallback(async (note: Note) => {
    if (openRef.current === note.path && dirty.current) {
      await window.wm.writeNote(note.path, textRef.current)
      dirty.current = false
    }
    await window.wm.duplicateNote(note.path)
    lastTree.current = ""
    await reload()
  }, [reload])

  // MARK: - The cameras (Input Devices)

  const refreshCameras = useCallback(async () => {
    try {
      const found = (await navigator.mediaDevices.enumerateDevices()).filter((one) => one.kind === "videoinput")
      setCameras(found.map((one, index) => ({
        id: one.deviceId || `unknown-${index}`, name: one.label || `Camera ${index + 1}`,
      })))
    } catch { setCameras([]) }
  }, [])
  useEffect(() => {
    void refreshCameras()
    // Labels arrive once the pane has been given the camera.
    const later = showCamera ? window.setTimeout(() => { void refreshCameras() }, 1500) : null
    navigator.mediaDevices?.addEventListener?.("devicechange", refreshCameras)
    return () => {
      if (later) window.clearTimeout(later)
      navigator.mediaDevices?.removeEventListener?.("devicechange", refreshCameras)
    }
  }, [refreshCameras, showCamera])

  // MARK: - The menu bar's commands

  const kind = platform?.platform ?? (navigator.userAgent.includes("Mac") ? "darwin" : "win32")
  const hasNote = current !== null
  /** Either pane can be put away, never both (`AppState` keeps at least one up). */
  const toggleCameraPane = () => {
    if (showCamera && !showEditor) setShowEditor(true)
    setShowCamera(!showCamera)
  }
  const toggleEditorPane = () => {
    if (showEditor && !showCamera) setShowCamera(true)
    setShowEditor(!showEditor)
  }
  const targetFolder = (): string =>
    current ? folderOf(current) : (root && root.path !== "" ? root.path : root?.sections[0]?.path ?? platform?.root ?? "")

  // The pen's buttons and ExpressKeys, for what only this component owns: the
  // pen's colour and width and whether the pen is down (penActions.ts).
  const penTools = usePenSettings()
  useEffect(() => registerPenHandlers({
    togglePen: toggleMode,
    nextColour: () => setPenColour((now) => cycleColour(now, PRESET_COLOURS.slice(0, 4), 1)),
    prevColour: () => setPenColour((now) => cycleColour(now, PRESET_COLOURS.slice(0, 4), -1)),
    wider: () => setPenWidth((now) => stepWidth(now, PEN_WIDTHS, 1)),
    thinner: () => setPenWidth((now) => stepWidth(now, PEN_WIDTHS, -1)),
  }), [toggleMode])

  const run = (id: string) => {
    if (id.startsWith("camera:")) {
      const pick = id.slice("camera:".length)
      const next = pick.startsWith("unknown-") ? null : pick
      setCameraPick(next)
      remember("videoSource", next === TABLET_SOURCE ? TABLET_SOURCE : null)
      setShowCamera(true)
      return
    }
    // The pen's tools and the keys the tablet's ExpressKeys type (penActions.ts).
    if (id.startsWith("pen") && runPenCommand(id)) return
    switch (id) {
      case "newNote": void newNote(targetFolder()); return
      case "closeTab": if (current) close(current); return
      case "openFolder": void window.wm.revealNotes(); return
      case "exportPDF":
        if (current) void window.wm.exportPDF(title.replace(/\.md$/, ""))
        return
      case "undoDrawing": {
        const back = history.undo(drawingRef.current)
        if (back) changeDrawing(back)
        return
      }
      case "redoDrawing": {
        const forward = history.redo(drawingRef.current)
        if (forward) changeDrawing(forward)
        return
      }
      case "toggleSidebar": setShowSidebar((was) => !was); return
      // The port has one dress for "no markers": the rendered page. Markers
      // shown are the markdown; the two View items are one switch.
      case "toggleMode": case "toggleMarkers":
        if (hasNote) setRendered((was) => !was)
        return
      case "toggleCamera": toggleCameraPane(); return
      case "toggleEditorPane": toggleEditorPane(); return
      case "cameraOff": setShowCamera(false); setCameraPick(null); remember("videoSource", null); return
      case "cameraRefresh": void refreshCameras(); return
      case "tabletPad": if (padRef.current) exitPad(); else enterPad(); return
      case "insertImage": if (hasNote) void choosePicture(); return
      case "insertTextBox": if (hasNote) arm({ kind: "shape", shape: "text" }); return
      default:
        if (view && hasNote) runEditorCommand(view, id, { listStyle, codeLanguage })
    }
  }

  useChrome({
    platform: kind,
    run,
    state: {
      hasNote,
      sidebar: showSidebar,
      rendered,
      camera: showCamera,
      pad,
      editorPane: showEditor,
      markers: !rendered,
      canUndoDrawing: history.canUndo,
      canRedoDrawing: history.canRedo,
      listStyle: listTitle(listStyle),
      codeLanguage: codeLanguage === "plain" ? null : languageTitle(codeLanguage),
      cameras,
      cameraId: showCamera ? (cameraPick ?? cameras[0]?.id ?? null) : null,
      penDown: mode === "pen",
      penErase: penTools.eraser,
      penSelect: penTools.selectTool,
      penAlwaysDraws: penTools.penDraws,
    },
  })

  const collapseGroup = useCallback((group: ToolGroupId, away: boolean) => {
    setCollapsedGroups((was) => {
      const next = away ? [...new Set([...was, group])] : was.filter((one) => one !== group)
      remember("collapsedGroups", next)
      return next
    })
  }, [])

  const placed = useCallback(() => setPlacing(null), [])
  const readOn = platform?.handwritingOCR === true
  const onReadPicture = useCallback((file: string, id: string) => { void readPicture(file, id) },
    [readPicture])
  const title = current ? current.split(/[\\/]/).pop() ?? "" : ""

  return (
    <div className={`app${platform?.platform === "darwin" ? " mac" : ""}${showEditor ? "" : " no-editor"}`}>
      {showSidebar && (
        <Sidebar
          root={root}
          openNote={current}
          editing={editing}
          onOpen={(note) => { void openNote(note) }}
          onNewNote={(folder) => { void newNote(folder) }}
          onNewSection={(parent) => { void newSection(parent) }}
          onPlaceNote={(file, folder, before) => { void placeNote(file, folder, before) }}
          onMoveSection={(folder, target) => { void moveSection(folder, target) }}
          onDuplicate={(note) => { void duplicate(note) }}
          onTrashNote={(note) => { void trashNote(note) }}
          onTrashSection={(section) => { void trashSection(section) }}
          header={(
            <SidebarBar
              platform={kind}
              editing={editing} onEditing={setEditing}
              onNewSection={() => { void newSection(targetFolder()) }}
              newSectionIn={targetFolder().split(/[\\/]/).pop() || "the notes folder"}
              rendered={rendered} hasNote={hasNote}
              onToggleRendered={() => setRendered((was) => !was)}
              camera={showCamera} onToggleCamera={toggleCameraPane}
              cameras={cameras} cameraId={showCamera ? (cameraPick ?? cameras[0]?.id ?? null) : null}
              onPickCamera={(id) => run(`camera:${id}`)}
              onCameraOff={() => run("cameraOff")}
              onRefreshCameras={() => { void refreshCameras() }}
            />
          )}
        />
      )}
      <div className="pane" style={showEditor ? undefined : { display: "none" }}>
        <div className="tab-bar">
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
        {/* The bar is always there — the sidebar's switch is its first
            button — and its tools wait for a note. */}
        <TopBar view={view} platform={kind} hasNote={hasNote}
                sidebar={showSidebar} onToggleSidebar={() => setShowSidebar((was) => !was)}
                collapsed={collapsedGroups} onCollapse={collapseGroup}
                listStyle={listStyle}
                onListStyle={(style) => { setListStyle(style); remember("listStyle", style) }}
                codeLanguage={codeLanguage}
                onCodeLanguage={(language) => { setCodeLanguage(language); remember("codeLanguage", language) }}
                onAddPicture={() => { void choosePicture() }}
                mode={mode} onToggleMode={toggleMode}
                penColour={penColour} onPenColour={setPenColour}
                penWidth={penWidth} onPenWidth={setPenWidth}
                onPlace={arm} placing={placing} />
        {current ? (
          <>
            <LinkBanner request={linking} current={current} view={view} root={root}
                        openNote={openNote} onDone={doneLinking} />
            <div className="stack"
                 onDragOver={(event) => { event.preventDefault() }}
                 onDrop={(event) => {
                   const file = [...event.dataTransfer.files].find((one) => one.type.startsWith("image/"))
                   if (!file) return
                   event.preventDefault()
                   void addPicture(file)
                 }}>
              <Notebook file={current} text={loaded.text} version={loaded.version}
                        restore={viewStates.current.get(current) ?? null} rendered={rendered}
                        onChange={change} onReady={setView}
                        onViewState={onViewState} onLink={onLink} onFollow={onFollow} />
              <Canvas drawing={drawing} onChange={changeDrawing} mode={mode} history={history}
                      colorHex={penColour} penWidth={penWidth}
                      placing={placing} onPlaced={placed}
                      scroller={view ? view.scrollDOM : null}
                      onReadPicture={readOn ? onReadPicture : undefined} />
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
      {showCamera && (
        <CameraPane
          platform={platform}
          penColour={penColour}
          penWidth={penWidth}
          pane={view
            ? { width: view.scrollDOM.clientWidth, height: view.scrollDOM.clientHeight }
            : { width: 800, height: 600 }}
          onCapture={(capture) => { void addCapture(capture) }}
          onHide={() => setShowCamera(false)}
          onPad={enterPad}
          preferred={cameraPick}
        />
      )}
      {pad && (
        <PadMode penColour={penColour} onPenColour={setPenColour} penWidth={penWidth} onPenWidth={setPenWidth}
                 pane={padPane.current} onCapture={(capture) => { void addCapture(capture) }} onExit={exitPad} />
      )}
    </div>
  )
}
