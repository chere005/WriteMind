/**
 * The window: sidebar · tabs · bar · notebook · footer.
 *
 * The state here is the app's, not the notebook's — which note is open,
 * which are in the tab row, when the last save was. The note's own rules
 * live in the core, and this file may not have an opinion about any of them.
 */

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react"
import { EditorView } from "@codemirror/view"
import { columnBox, cursorSeam, DRAWING_MIME, findNextMatch, revealAt, takesPastedPicture, type InkCellPainter } from "@writemind/editor"
import {
  anchorOffset, bounds as itemBounds, capturePlacedCentre, columnWidth, decodeDrawing, emptyDrawing, insertBlock, insertionPointBelow,
  languageTitle, listTitle, makeNote, newID, noTransform, parseCameraAspect, parseLink, placedCentre, PRESET_COLOURS, readDrawing,
  resolveLinkTarget, shifted, textFingerprint, writeDrawing, inkCellOf, inkFileName, inkIdsIn, visibleItems, withInkCell,
  type CanvasItem, type CodeLanguage, type Drawing, type Evaluator, type ListStyle, type Note, type Placement, type Rect,
} from "@writemind/core"
import { Canvas, clipboardDrawing, type CanvasMode } from "./Canvas"
import { depthOf, dockNewInk, insertInkCell } from "./dock"
import { cellOfCopied, copiedCellForShell, copiedCellOf, encodeCopiedCell, readCopiedCell, rememberCopiedCell } from "./copiedCell"
import { scopePenTo } from "./inkScope"
import { withSnapshots, wolframMedia } from "./wolframMedia"
import { dockHostFor, inkPainter, shownWidth, snapshotNow, snapshotsAfterSave, snapshotsOnOpen, syncInkCells } from "./inkCells"
import { cellSheetsSaw, setCellSheetHost } from "./cellSheets"
import { CellMenu } from "./CellMenu"
import { renameBoundNotes } from "./tabletSheets"
import { QUICK_AWAY, quickStep, samePath, type QuickView } from "./welcomeView"
import { DrawingHistory } from "./drawingHistory"
import { useUndo } from "./useUndo"
import { lazyText } from "./lazyText"
import { reloadFromDisk } from "./diskReload"
import { forgetAll, historyOf, keepOnly as keepHistory, renameNote } from "./noteHistory"
import { readPictureResult } from "./ocrClient"
import { CameraPane, type Capture } from "./CameraPane"
import { PaneDivider } from "./PaneDivider"
import { TabBar } from "./TabBar"
import { Notebook, type ViewState } from "./Notebook"
import { LinkBanner, type LinkRequest } from "./LinkBanner"
import { FindBar, type FindRequest } from "./FindBar"
import { KeyList } from "./KeyList"
import { Sidebar, SidebarBar } from "./Sidebar"
import { TopBar, TOOL_GROUPS, type ToolGroupId } from "./TopBar"
import { runEditorCommand } from "./editorCommands"
import { useChrome } from "./useChrome"
import { putToolsDown, usePenSettings, useSheetTools } from "./penSettings"
import { usePenOnSheet } from "./tabletFocus"
import { registerPenHandlers, runPenCommand } from "./penActions"
import { cycleColour, stepWidth, PEN_WIDTHS } from "./penButtons"
import { setPenLook } from "./penCursor"
import { CAMERA_OFF, shown, TABLET_SOURCE } from "../shared/commands"
import { setCameraAspect, useCameraAspect } from "./cameraSettings"
import { joinPath, folderOf, notesIn } from "./paths"
import { useSession } from "./useSession"
import { MATH_OPEN_EVENT } from "./MathPalette"
import { useProject, type SessionApi } from "./useProject"
import type { Platform, Section } from "./wm"
import { friendly, leaf } from "./errors"
import { NO_FOLDER_TEXT, targetFolderOf } from "./sidebarTree"
import { UpdateDialog } from "./UpdateDialog"
import { CleanUpDialog } from "./CleanUpDialog"
import { heldBy } from "./cleanUp"
import { AboutDialog } from "./AboutDialog"
import { LanguageSetupDialog } from "./LanguageSetupDialog"
import { setLanguageSetupOpener } from "./evalHost"
import { FolderNotice } from "./FolderNotice"

/** How long after the last keystroke the note is written. */
const SAVE_AFTER = 500

/** How long after a save that the system refused (a lock, a read-only file) it is tried again. */
const RETRY_AFTER = 3000

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

interface PaneSize { width: number; height: number }

/**
 * The notes pane's size: what it is now, else what it was the last time it showed. A pane put away (View > Hide
 * Notes Pane) is `display: none` and measures 0 x 0, and a PDF or a capture placed by that is laid out for another
 * width than the note has — smaller type, different wrapping, ink no longer over the words it was drawn on.
 */
function currentPane(view: EditorView | null, last: { current: PaneSize }): PaneSize {
  const width = view?.scrollDOM.clientWidth ?? 0
  const height = view?.scrollDOM.clientHeight ?? 0
  if (width > 0 && height > 0) last.current = { width, height }
  return last.current
}

/** The fingerprint of the file an edit started from, made once: the hot-exit buffer asks for it every time it is written. */
let lastFingerprint: { text: string; print: string } | null = null
function fingerprintOf(text: string): string {
  if (lastFingerprint && lastFingerprint.text === text) return lastFingerprint.print
  const print = textFingerprint(text)
  lastFingerprint = { text, print }
  return print
}

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
  const textRef = useMemo(() => lazyText(), [])
  const [saved, setSaved] = useState<Date | null>(null)
  const [stale, setStale] = useState(false)
  // A note a NEWER WriteMind wrote (manifest.version above ours, SPEC-WM 1.8) is open read-only: nothing is saved or changed.
  const [readOnly, setReadOnly] = useState(false)
  const readOnlyRef = useRef(false)
  readOnlyRef.current = readOnly
  const [view, setView] = useState<EditorView | null>(null)
  const viewRef = useRef<EditorView | null>(null)
  viewRef.current = view
  // Remembered across launches, as the Mac keeps `showSidebar` in its defaults.
  const [showSidebar, setShowSidebar] = useState<boolean>(() => remembered<boolean>("showSidebar", true))
  useEffect(() => { remember("showSidebar", showSidebar) }, [showSidebar])
  // The caret and the closed sections of every note, kept for the session.
  const viewStates = useRef(new Map<string, ViewState>())
  const [linking, setLinking] = useState<LinkRequest | null>(null)
  // Find in the note (the Mac's find bar); `lastQuery` is what Find Next goes on looking for with the bar away.
  const [finding, setFinding] = useState<FindRequest | null>(null)
  /** Help ▸ Keyboard Shortcuts is up (KeyList.tsx). */
  const [showKeys, setShowKeys] = useState(false)
  // File ▸ Clean Up Unused Files… (CleanUpDialog.tsx, main/housekeeping.ts).
  const [cleanUp, setCleanUp] = useState(false)
  // Help ▸ About WriteMind (AboutDialog.tsx, main/about.ts): one dialog on every platform, the Mac's app menu included.
  const [about, setAbout] = useState(false)
  // File ▸ Language Setup… (LanguageSetupDialog.tsx, main/eval/languages.ts), opened at a language from a cell's
  // Runs As menu (`focus`), or at the top from the menu bar.
  const [languageSetup, setLanguageSetup] = useState<{ focus: Evaluator | null } | null>(null)
  useEffect(() => {
    setLanguageSetupOpener((evaluator) => setLanguageSetup({ focus: evaluator }))
    return () => setLanguageSetupOpener(null)
  }, [])
  const lastQuery = useRef("")
  // The rendered page: the same editor with the markdown's marks put away.
  const [rendered, setRendered] = useState(false)
  // THE QUICK REFERENCE IS ALWAYS ON THE RENDERED PAGE (welcomeView.ts): whenever it comes to the front the rendered
  // page is put up, and when another note does the mode the other notes were in comes back. Before the paint, so it
  // never shows as markdown first. `quickPath` is where it is (main/welcome.ts); `quickAsked` counts Help ▸ Quick Reference.
  const [quickPath, setQuickPath] = useState<string | null>(null)
  useEffect(() => { void window.wm.quickReferencePath?.().then(setQuickPath, () => undefined) }, [])
  const [quick, setQuick] = useState<QuickView>(QUICK_AWAY)
  const [quickAsked, setQuickAsked] = useState(0)
  useLayoutEffect(() => {
    const step = quickStep(quick, current, quickPath, rendered, quickAsked)
    if (step.state !== quick) setQuick(step.state)
    if (step.rendered !== undefined) setRendered(step.rendered)
  }, [quick, current, quickPath, rendered, quickAsked])
  // View ▸ Hide / Show Markdown Markers: a second, independent switch (the Mac keeps it in its defaults, shown by default).
  const [markers, setMarkers] = useState<boolean>(() => remembered<boolean>("markers", true))
  // BOTH PANES, EVERY LAUNCH (the Mac: "default video always to side by
  // side"). Putting the video away is a thing done for a minute, not a
  // setting, so it is not remembered; the divider's position is.
  const [showCamera, setShowCamera] = useState(true)
  // View > Hide Notes Pane: either pane can be put away, never both.
  const [showEditor, setShowEditor] = useState(true)
  // THE PICTURE ON ITS OWN, filling the WINDOW (double-click it; Mac commit 0edfc08). Never the display. Not
  // remembered across a launch, the same rule the two panes follow.
  const [cameraFullWindow, setCameraFullWindow] = useState(false)
  const aspect = useCameraAspect()
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
  // The source picked for the video pane is remembered across launches (the Mac: "the camera you pick is
  // remembered"): a camera's id, the tablet, or "off". Nothing remembered opens the system's default camera.
  const [cameraPick, setCameraPick] = useState<string | null>(() => {
    const kept = remembered<unknown>("videoSource", null)
    return typeof kept === "string" && kept !== "" ? kept : null
  })
  // The camera the pane actually has open (what the tick goes on), reported by the pane.
  const [activeCamera, setActiveCamera] = useState<string | null>(null)
  // The drawing is a SIDECAR, not part of the note: it lives in its own
  // file beside the markdown and nothing on it ever edits the text.
  const [drawing, setDrawing] = useState<Drawing>(emptyDrawing())
  // What the pen is, remembered across launches as the Mac keeps `canvasMode`, `penColorHex` and `penWidth` in
  // its defaults ("a launch comes up in whichever mode it was left in"). The footer says when the pen is down.
  const [mode, setMode] = useState<CanvasMode>(() => (remembered<unknown>("canvasMode", "cursor") === "pen" ? "pen" : "cursor"))
  const [penColour, setPenColour] = useState<string>(() => {
    const kept = remembered<unknown>("penColour", null)
    return typeof kept === "string" && /^#[0-9a-fA-F]{6}$/.test(kept) ? kept : "#2D7DD2"
  })
  const [penWidth, setPenWidth] = useState<number>(() => {
    const kept = remembered<unknown>("penWidth", null)
    return typeof kept === "number" && Number.isFinite(kept) && kept >= 0.5 && kept <= 64 ? kept : 3
  })
  const [placing, setPlacing] = useState<Placement | null>(null)
  useEffect(() => { setPenLook(penColour, penWidth) }, [penColour, penWidth])
  useEffect(() => { remember("canvasMode", mode) }, [mode])
  useEffect(() => { remember("penColour", penColour) }, [penColour])
  useEffect(() => { remember("penWidth", penWidth) }, [penWidth])
  const drawingTimer = useRef<number | null>(null)
  const drawingDirty = useRef(false)
  // The drawing's undo, shared with the canvas. It belongs to the NOTE in front
  // (each open note keeps its own, noteHistory.ts), and shares that note's
  // clock with the words' history: ONE Undo takes back the most recent edit
  // of either (useUndo.ts).
  const noHistory = useRef(new DrawingHistory()).current
  const history = current ? historyOf(current).drawing : noHistory

  const timer = useRef<number | null>(null)
  const dirty = useRef(false)

  // The notes pane's last real size, for a PDF or a capture placed while the pane is put away (see `currentPane`).
  const lastPane = useRef<PaneSize>({ width: 800, height: 600 })
  useEffect(() => {
    const scroller = view?.scrollDOM
    if (!scroller || typeof ResizeObserver === "undefined") return
    const note = () => { currentPane(view, lastPane) }
    note()
    const observer = new ResizeObserver(note)
    observer.observe(scroller)
    return () => observer.disconnect()
  }, [view])

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
    // The notes list does not wait for the reader's probe (a PowerShell that is slow to start would hold the
    // whole sidebar for up to 20 s): what the machine can do arrives when it arrives.
    void window.wm.capabilities().then(setPlatform).catch(() => undefined)
    void reload()
    // A note edited in another app shows up here: the folder watcher says
    // something moved, and the open note is read again unless there is an
    // edit in hand that has not reached disk yet — that one is ours, and
    // the save will answer for it. (Asked again after each read: diskReload.ts.)
    return window.wm.onNotesChanged(() => {
      void (async () => {
        await reload()
        await reloadFromDisk({
          open: () => openRef.current,
          text: () => textRef.current,
          wordsDirty: () => dirty.current,
          drawingDirty: () => drawingDirty.current,
          readNote: (file) => window.wm.readNote(file).catch(() => null),
          readDrawing: (file) => window.wm.readDrawing(file).catch(() => null),
          setDocument,
          setDrawing: (sidecar) => {
            // (A file caught half written, or one that is not a sidecar, is not the drawing: the one in hand stays.)
            const read = decodeDrawing(sidecar)
            if (read.damaged) return
            const next = read.drawing
            setDrawing((was) => (writeDrawing(was) === writeDrawing(next) ? was : next))
          },
        })
      })()
    })
  }, [reload, setDocument])

  // The text that is not in its file yet is carried by the session (hot exit): see useSession. `baseText` is the
  // text of the file that edit started from, so a launch can tell whether the file moved on meanwhile.
  const baseText = useRef("")
  const touchBuffer = useRef<() => void>(() => undefined)
  const saveRef = useRef<() => void>(() => undefined)

  // WHAT COULD NOT BE SAVED. A note that cannot be written (read-only, held by a sync client or an antivirus, a
  // full disk) used to make every way out of it fail, with the raw error in a red bar: another note did nothing,
  // Open Project half-switched, New Note made a file and never opened it, and closing the tab threw the typing
  // away. Now a write that fails is SAID, in words, and tried again; and when the note is about to be let go of
  // (another note, a project, closing the tab, quitting) the text that could not be written is kept in Recovered,
  // so the way out is always open and nothing typed is lost.
  const [problem, setProblem] = useState<{ text: string; kept: string | null } | null>(null)
  const problemKey = useRef<string | null>(null)
  const problemText = useRef("")
  const say = useCallback((text: string, kept: string | null = null, key: string | null = null) => {
    // The same sentence again (a retry that fails the same way) is not a new render.
    if (problemText.current === text) return
    problemKey.current = key
    problemText.current = text
    setProblem({ text, kept })
  }, [])
  const clearProblem = useCallback((key?: string) => {
    if (key !== undefined && problemKey.current !== key) return
    problemKey.current = null
    problemText.current = ""
    setProblem(null)
  }, [])
  /** Copies already made, so a refusal that repeats does not fill Recovered with the same text. */
  const copies = useRef(new Map<string, { text: string; where: string }>())
  const keepCopy = useCallback(async (file: string, text: string, kind: "note" | "drawing"): Promise<string | null> => {
    const key = `${kind}:${file}`
    const held = copies.current.get(key)
    if (held && held.text === text) return held.where
    const where = await window.wm.rescue(file, text, kind).catch(() => null)
    if (where) copies.current.set(key, { text, where })
    return where
  }, [])

  type Outcome = "saved" | "refused" | "failed"
  /**
   * Write the note in front. "refused" is the core's `mayWrite` saying the file changed under us: nothing is
   * overwritten, the watcher brings the newer file in, and what was typed is kept in Recovered (the Mac simply
   * loses it). "failed" is the system saying no; the text stays in the editor and is tried again, and when the
   * note is being let go of it is kept in Recovered instead.
   */
  const writeText = useCallback(async (file: string, leaving: boolean): Promise<Outcome> => {
    const text = textRef.current
    const key = `note:${file}`
    let outcome: Outcome
    let why: string
    try {
      const out = await window.wm.writeNote(file, text)
      if (out.written) {
        if (openRef.current === file && textRef.current === text) dirty.current = false
        setSaved(new Date())
        setStale(false)
        clearProblem(key)
        return "saved"
      }
      outcome = "refused"
      why = "the file changed on disk, so it was not overwritten"
      setStale(true)
    } catch (error) {
      outcome = "failed"
      why = friendly(error)
    }
    const copy = outcome === "refused" || leaving ? await keepCopy(file, text, "note") : null
    if (copy) {
      if (openRef.current === file && textRef.current === text) dirty.current = false
      say(`Could not save ${leaf(file)}: ${why}. Your text is kept in Recovered\\${leaf(copy)}`, copy, key)
    } else if (leaving) {
      say(`Could not save ${leaf(file)}: ${why}. The text could not be kept either.`, null, key)
    } else {
      say(`Could not save ${leaf(file)}: ${why}. WriteMind will keep trying.`, null, key)
      if (openRef.current === file) {
        if (timer.current) window.clearTimeout(timer.current)
        timer.current = window.setTimeout(() => saveRef.current(), RETRY_AFTER)
      }
    }
    return outcome
  }, [clearProblem, keepCopy, say])

  /** The same for the drawing's sidecar. True when it reached its file. */
  const writeDrawingNow = useCallback(async (file: string, leaving: boolean): Promise<boolean> => {
    const drawn = drawingRef.current
    const json = writeDrawing(drawn)
    const key = `drawing:${file}`
    try {
      await window.wm.writeDrawing(file, json)
      if (openRef.current === file && writeDrawing(drawingRef.current) === json) drawingDirty.current = false
      // Each ink cell whose strokes, size or very existence changed since its snapshot was last written: written
      // again, so other markdown viewers show what the sidecar now holds (docs\PLAN-docking-ink-cells.md (f)).
      snapshotsAfterSave(file, drawn, (id) => shownWidth(viewRef.current, id))
      clearProblem(key)
      return true
    } catch (error) {
      const why = friendly(error)
      const copy = leaving ? await keepCopy(file, json, "drawing") : null
      if (copy) {
        if (openRef.current === file && writeDrawing(drawingRef.current) === json) drawingDirty.current = false
        say(`Could not save the drawing of ${leaf(file)}: ${why}. It is kept in Recovered\\${leaf(copy)}`, copy, key)
      } else if (leaving) {
        say(`Could not save the drawing of ${leaf(file)}: ${why}. It could not be kept either.`, null, key)
      } else {
        say(`Could not save the drawing of ${leaf(file)}: ${why}. WriteMind will keep trying.`, null, key)
      }
      return false
    }
  }, [clearProblem, keepCopy, say])

  /**
   * EVERYTHING IN HAND, WRITTEN NOW — the note and its drawing, without waiting for the debounce — and it never
   * throws, so a way out (another note, closing the tab, a project, the window) is never closed by a file that
   * will not take a save. `leaving`: the note is about to be let go of, so what cannot be written is kept in
   * Recovered. Resolves true when it all reached its files (the Mac's `flushPendingSave`).
   */
  const flushNow = useCallback(async (leaving: boolean): Promise<boolean> => {
    if (timer.current) { window.clearTimeout(timer.current); timer.current = null }
    if (drawingTimer.current) { window.clearTimeout(drawingTimer.current); drawingTimer.current = null }
    const file = openRef.current
    if (!file) return true
    let whole = true
    if (dirty.current && (await writeText(file, leaving)) !== "saved") whole = false
    if (drawingDirty.current && !(await writeDrawingNow(file, leaving))) whole = false
    return whole
  }, [writeDrawingNow, writeText])

  const openNote = useCallback(async (note: Note) => {
    // Save what is in hand before letting go of it: the publisher fires in
    // willSet on the Mac and the same mistake is available here — reading
    // the new note and writing it over the old one. The drawing too: its save is
    // debounced as well, and an edit made in the last half second before a tab
    // switch used to be lost.
    const same = openRef.current === note.path
    const whole = await flushNow(!same)
    // The note asked for is the one in front and what was typed in it could not be written: the editor holds the
    // only copy, so the old file is not read over it.
    if (same && !whole) return
    dirty.current = false
    drawingDirty.current = false
    const contents = await window.wm.readNote(note.path)
    const sidecar = await window.wm.readDrawing(note.path)
    const info = await window.wm.noteInfo(note.path).catch(() => ({ readOnly: false }))
    // The sidecar is decoded BEFORE the note is switched (the decode cannot throw, but whatever happens in it
    // must not leave the new note on screen with the old note's drawing, which the next stroke would save into
    // the new note's file). A sidecar that is not all readable is KEPT in Recovered and said so: the next edit
    // would write the smaller drawing over it, and nothing else would have a copy.
    const decoded = decodeDrawing(sidecar)
    const kept = decoded.damaged && sidecar !== null ? await keepCopy(note.path, sidecar, "drawing") : null
    setOpen((was) => (was.some((other) => other.path === note.path) ? was : [...was, note]))
    // (The ref names the new note before its words go on the page, not at the next render: a read from disk still
    // in flight for the old note asks it — diskReload.ts — and two notes can hold the same words.)
    openRef.current = note.path
    setCurrent(note.path)
    setDocument(contents)
    setDrawing(decoded.drawing)
    drawingDirty.current = false
    // An ink cell whose snapshot is missing (a sidecar from before, a lost file) gets one.
    snapshotsOnOpen(note.path, decoded.drawing, () => null)
    if (decoded.damaged) {
      const left = decoded.dropped > 0 ? ` (${decoded.dropped} object${decoded.dropped === 1 ? "" : "s"} left out)` : ""
      const where = kept
        ? `The file is kept as it was in Recovered\\${leaf(kept)}.`
        : "It could not be kept either, so the next change to the drawing replaces it."
      say(`The drawing of ${leaf(note.path)} could not be read in full${left}. ${where}`, kept, `drawing-unreadable:${note.path}`)
    }
    setStale(false)
    setReadOnly(info.readOnly === true)
    readOnlyRef.current = info.readOnly === true
    if (info.readOnly === true) {
      say(`${leaf(note.path)} was written by a newer WriteMind, so it is open read-only here.`, null, `newer:${note.path}`)
    }
  }, [flushNow, keepCopy, say, setDocument])

  // The autosave: debounced, and it never clobbers. `writeNote` asks the
  // core's `mayWrite` first, and a refusal leaves the buffer alone and says
  // so in the footer. It is scheduled from the edit itself rather than from
  // an effect on the text, so typing does not render this component.
  const save = useCallback(() => {
    const file = openRef.current
    if (!file || !dirty.current || readOnlyRef.current) return
    void (async () => {
      await writeText(file, false)
      void reload()
      // It is in its file now (or the session goes on carrying it): see useSession.
      touchBuffer.current()
    })()
  }, [reload, writeText])
  saveRef.current = save

  const titleTimer = useRef<number | null>(null)
  const change = useCallback((next: string | (() => string)) => {
    // (The text of the note BEFORE this edit is wanted once, as the base of a hot-exit buffer; after that a key
    // does not make a string of the note: see lazyText.ts.)
    if (!dirty.current) baseText.current = textRef.current
    dirty.current = true
    textRef.hold(next)
    touchBuffer.current()
    // The tab takes the note's heading as it is typed, not after the save and the tree read.
    if (titleTimer.current) window.clearTimeout(titleTimer.current)
    titleTimer.current = window.setTimeout(() => {
      const file = openRef.current
      if (!file) return
      const title = makeNote(file, 0, textRef.current).title
      setOpen((was) => (was.some((note) => note.path === file && note.title !== title)
        ? was.map((note) => (note.path === file ? { ...note, title } : note)) : was))
    }, 120)
    if (timer.current) window.clearTimeout(timer.current)
    timer.current = window.setTimeout(save, SAVE_AFTER)
    if (wordTimer.current) window.clearTimeout(wordTimer.current)
    wordTimer.current = window.setTimeout(() => setWords(countWords(textRef.current)), 300)
  }, [save])

  const changeDrawing = useCallback((next: Drawing) => {
    if (readOnlyRef.current) return
    drawingDirty.current = true
    // At once, not at the next render: a dock writes the words and the drawing in one go, and what it wrote is
    // read back before React has drawn it (an ink cell's widget, its snapshot).
    drawingRef.current = next
    pendingDrawing.current = null
    setDrawing(next)
  }, [])

  /** A change made outside the canvas (a paste, a capture): one Undo takes it back. */
  const drawingRef = useRef(drawing)
  drawingRef.current = drawing
  /** The drawing a dock is about to apply, while its line is written (DockDeps.ahead). */
  const pendingDrawing = useRef<Drawing | null>(null)
  const editDrawing = useCallback((next: Drawing) => {
    history.record(drawingRef.current)
    changeDrawing(next)
  }, [changeDrawing, history])
  useUndo({ view, history, drawing, platform: platform?.platform ?? null, apply: changeDrawing })

  // INK CELLS (docs\PLAN-docking-ink-cells.md). The editor draws each cell's line as a widget and paints its canvas
  // with this one painter, from the drawing as it is now; a resize by the cell's bottom edge is one undo step.
  const historyRef = useRef(history)
  historyRef.current = history
  const painter = useRef<InkCellPainter | null>(null)
  painter.current ??= inkPainter(() => pendingDrawing.current ?? drawingRef.current, (id, aspect) => {
    const whole = drawingRef.current
    const cell = inkCellOf(whole, id)
    if (!cell || Math.abs(cell.aspect - aspect) < 1e-6) return
    historyRef.current.record(whole)
    changeDrawing(withInkCell(whole, { ...cell, aspect }))
  })
  // Every change of the drawing reaches the cells: their aspects, and a repaint of the ones that changed.
  const synced = useRef<{ view: EditorView | null; drawing: Drawing | null }>({ view: null, drawing: null })
  useEffect(() => {
    if (!view || !view.dom.isConnected) return
    const was = synced.current
    syncInkCells(view, was.view === view ? was.drawing : null, drawing)
    synced.current = { view, drawing }
  }, [view, drawing])
  // TABLET SHEETS BOUND TO INK CELLS (cellSheets.ts: right-click a drawing cell ▸ Open in Tablet Sheet). The sheet
  // writes into the cell through this note's own history and `changeDrawing`: one undo step per change.
  // A bound tab picked by hand brings its note to the front and its cell into view (sheetFollow.ts).
  const openNoteRef = useRef(openNote)
  openNoteRef.current = openNote
  const rootRef = useRef(root)
  rootRef.current = root
  useEffect(() => setCellSheetHost({
    bring: async (note) => {
      if (openRef.current === note) return
      const known = openList.current.find((one) => one.path === note)
        ?? (rootRef.current ? notesIn(rootRef.current).find((one) => one.path === note) : undefined)
      // Read first when it is not a known note: a note that is gone rejects here, before anything is switched.
      const text = known ? "" : await window.wm.readNote(note)
      await openNoteRef.current(known ?? makeNote(note, Date.now(), text))
    },
    reveal: (ref) => {
      let tries = 0
      const look = () => {
        const editor = viewRef.current
        const at = editor && openRef.current === ref.note ? editor.state.doc.toString().indexOf(inkFileName(ref.cell)) : -1
        if (!editor || at < 0) { if (++tries < 30) requestAnimationFrame(look); return }
        // Already whole in view: left alone. Else the cell is brought to the middle (its top 24 px down when taller).
        const box = editor.scrollDOM.getBoundingClientRect()
        const shown = editor.dom.querySelector(`[data-ink-cell="${ref.cell}"]`)?.getBoundingClientRect()
        if (shown && shown.top >= box.top && shown.bottom <= box.bottom) return
        const block = editor.lineBlockAt(at)
        const margin = Math.max(24, (editor.scrollDOM.clientHeight - block.height) / 2)
        editor.dispatch({ effects: EditorView.scrollIntoView(block.from, { y: "start", yMargin: margin }) })
      }
      requestAnimationFrame(look)
    },
    front: () => (openRef.current ? { note: openRef.current, drawing: drawingRef.current } : null),
    edit: (next, record) => { if (record) historyRef.current.record(drawingRef.current); changeDrawing(next) },
    // A cell not drawn now (scrolled away) is as wide as the column it is made at.
    width: (id) => shownWidth(viewRef.current, id) ?? (viewRef.current ? columnBox(viewRef.current).width || null : null),
    title: (note) => openList.current.find((one) => one.path === note)?.title ?? leaf(note).replace(/\.[^.]+$/, ""),
    showTablet: () => { setCameraPick(TABLET_SOURCE); remember("videoSource", TABLET_SOURCE); setShowCamera(true) },
  }), [changeDrawing])
  // Before the paint: a note coming to the front and the sheet that follows it (sheetFollow.ts) show in one frame.
  useLayoutEffect(() => { cellSheetsSaw(current, drawing) }, [current, drawing])

  // The sidecar saves on the same debounce as the note, and separately
  // from it: a drawing is never part of the markdown.
  useEffect(() => {
    if (!current || !drawingDirty.current) return
    if (drawingTimer.current) window.clearTimeout(drawingTimer.current)
    const file = current
    const attempt = () => {
      drawingTimer.current = null
      void writeDrawingNow(file, false).then((written) => {
        // A drawing the system would not take is tried again, for as long as it is in front and unsaved.
        if (!written && openRef.current === file && drawingDirty.current) {
          drawingTimer.current = window.setTimeout(attempt, RETRY_AFTER)
        }
      })
    }
    drawingTimer.current = window.setTimeout(attempt, SAVE_AFTER)
    return () => { if (drawingTimer.current) window.clearTimeout(drawingTimer.current) }
  }, [drawing, current, writeDrawingNow])

  // A page that is RELOADED hands what it holds to the main process on the way out: the process outlives the
  // page, so the write does not need the page to finish. CLOSING THE WINDOW is not that — the page goes with
  // the process, and a fire-and-forget write from here never arrived (0 of 4 kept a keystroke typed just
  // before the X). The shell holds the close, asks the page to flush and to say when it has, and only then
  // closes: see `onFlushRequest` below and main.ts.
  useEffect(() => {
    const flush = () => {
      const file = openRef.current
      if (!file) return
      if (dirty.current) void window.wm.writeNote(file, textRef.current)
      if (drawingDirty.current) void window.wm.writeDrawing(file, writeDrawing(drawingRef.current))
    }
    window.addEventListener("beforeunload", flush)
    return () => window.removeEventListener("beforeunload", flush)
  }, [])

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
  const addPicture = useCallback(async (blob: Blob, drop?: { x: number; y: number }) => {
    const bytes = new Uint8Array(await blob.arrayBuffer())
    const bitmap = await createImageBitmap(blob).catch(() => null)
    if (!bitmap) return
    const extension = blob.type.includes("jpeg") ? ".jpg"
      : blob.type.includes("gif") ? ".gif"
      : blob.type.includes("webp") ? ".webp" : ".png"
    const saved = await window.wm.saveMedia(bytes, extension, openRef.current)
    const pane = currentPane(view, lastPane)
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
    let centre = placedCentre({ width, height: width * aspect, pane, scroll, caretLine })
    const box = view ? view.scrollDOM.getBoundingClientRect() : null
    if (drop && view && box && drop.x >= box.left && drop.x <= box.right && drop.y >= box.top && drop.y <= box.bottom) {
      // A picture dropped on the page lands where it was let go (centred there, kept inside the pane);
      // a drop that carries no place on the page (a script's) goes under the caret like a paste.
      const half = { x: width / 2, y: (width * aspect) / 2 }
      const x = Math.min(Math.max(drop.x - box.left, half.x), Math.max(pane.width - half.x, half.x))
      const y = Math.max(drop.y - box.top + scroll, half.y)
      centre = { x: x / Math.max(pane.width, 1), y: y / Math.max(pane.height, 1) }
    }
    const id = newID()
    // It arrives picked up, with its handles, as a shape does.
    history.select([id])
    editDrawing({
      items: [...drawingRef.current.items, {
        kind: "image",
        image: {
          id, file: saved.file, center: centre, width: width / pane.width,
          aspect, transform: noTransform(), hidden: false, group: null,
        },
      }],
    })
  }, [editDrawing, history, view])

  /**
   * A capture off the camera, landing where it was on the page — and, when
   * the camera read a flow chart off it, the chart as real nodes and arrows
   * under it (the canvas routes the arrows when the drawing arrives).
   */
  const addCapture = useCallback(async (capture: Capture) => {
    const picture: CanvasItem[] = []
    if (capture.blob) {
      const bytes = new Uint8Array(await capture.blob.arrayBuffer())
      // The writing traced into outlines is an SVG (it scales without going soft); a page is a JPEG.
      const saved = await window.wm.saveMedia(bytes,
        capture.blob.type.includes("svg") ? ".svg" : capture.blob.type.includes("png") ? ".png" : ".jpg", openRef.current)
      const id = newID()
      history.select([id])
      picture.push({
        kind: "image",
        image: {
          id, file: saved.file, center: capture.center, width: capture.width,
          aspect: capture.aspect, transform: noTransform(), hidden: false, group: null,
        },
      })
    }
    // WHERE it lands is the note's business, as on the Mac (placeCapture): one gap under the caret's line, else
    // where it sat on the pane carried down by how far the note is scrolled. Whatever travels with the picture
    // (the writing's own strokes, a chart read from it) moves by the same amount.
    const pane = currentPane(view, lastPane)
    const scroll = view ? view.scrollDOM.scrollTop : 0
    let caretLine = null as null | { x: number; y: number; width: number; height: number }
    if (view) {
      const block = view.lineBlockAt(view.state.selection.main.head)
      caretLine = { x: 30, y: block.top, width: pane.width - 60, height: block.height }
    }
    const taken = drawingRef.current.items.flatMap((item) => (item.kind === "image" ? [item.image.center] : []))
    const centre = capturePlacedCentre({
      center: capture.center, width: capture.width, aspect: capture.aspect, pane, scroll, caretLine, taken,
    })
    const dx = (centre.x - capture.center.x) * pane.width, dy = (centre.y - capture.center.y) * pane.height
    const carried = (items: CanvasItem[] | undefined): CanvasItem[] =>
      !items || items.length === 0 ? [] : Math.abs(dx) < 0.01 && Math.abs(dy) < 0.01 ? items : shifted(items, dx, dy, pane)
    editDrawing({
      items: [...drawingRef.current.items,
        ...picture.map((item) => (item.kind === "image" ? { ...item, image: { ...item.image, center: centre } } : item)),
        ...carried(capture.strokes), ...carried(capture.chart)],
    })
  }, [editDrawing, history, view])

  /**
   * The words out of a picture, into the note as a cell of their own, right UNDER the picture (the Mac's
   * `NoteStore.readText`: Sean, 2026-09-19, "converting an image ... to text should not replace the object itself,
   * but insert the text underneath it"). The picture STAYS - reading it is not a conversion - and one Undo takes
   * the words back out.
   */
  // A picture being read: asking again while it is, does nothing; leaving the app or the note takes every request
  // back so no reader is left running for a note that is no longer open.
  const reading = useRef(new Map<string, AbortController>())
  useEffect(() => () => { reading.current.forEach((job) => job.abort()) }, [])
  useEffect(() => () => { reading.current.forEach((job) => job.abort()) }, [current])
  /** A short line in the footer about a read (Reading..., what it came to); it goes by itself. */
  const [readNotice, setReadNotice] = useState<string | null>(null)
  const readNoticeTimer = useRef<number | null>(null)
  const tellRead = useCallback((text: string | null, forMs = 5000) => {
    if (readNoticeTimer.current !== null) window.clearTimeout(readNoticeTimer.current)
    readNoticeTimer.current = null
    setReadNotice(text)
    if (text !== null && forMs > 0) readNoticeTimer.current = window.setTimeout(() => setReadNotice(null), forMs)
  }, [])
  const readPicture = useCallback(async (file: string, id: string) => {
    if (reading.current.has(id)) return
    // The result belongs to the note the picture is in: the reader takes a moment (the first read after launch
    // the longest) and the person may open another note meanwhile.
    const note = openRef.current
    const job = new AbortController()
    reading.current.set(id, job)
    tellRead("Reading...", 0)
    // Markdown lines with the Mac's rules (struck, ringed, arrows, tasks, maths),
    // made off the page's thread: see ocrClient.ts.
    let result: Awaited<ReturnType<typeof readPictureResult>>
    try { result = await readPictureResult(file, job.signal) } finally { reading.current.delete(id) }
    if (result === null || job.signal.aborted || openRef.current !== note) { tellRead(null); return }
    const words = result.lines
    if (words.length === 0) {
      tellRead(result.failed ? "The picture reader did not answer - try again." : "No text could be read in that picture.")
      return
    }
    const editor = view
    const text = textRef.current
    // Directly under the picture's bottom edge: in front of the first line that starts at or below it.
    const picture = drawingRef.current.items.find((item) => item.kind === "image" && item.image.id === id)
    let at = editor ? editor.state.selection.main.head : text.length
    if (editor && picture) {
      const pane = currentPane(editor, lastPane)
      const bottom = itemBounds(picture, pane)
      const y = bottom.y + bottom.height - editor.documentPadding.top
      const block = editor.state.doc.length > 0 ? editor.lineBlockAtHeight(Math.max(0, y)) : null
      at = insertionPointBelow(block ? { from: block.from, to: block.to, bottom: block.bottom } : null, y, editor.state.doc.length)
    }
    const opened = insertBlock(text, at)
    const written = opened.markdown.slice(0, opened.caret) + words.join("\n")
      + opened.markdown.slice(opened.caret)
    change(written)
    setDocument(written)
    tellRead(words.length === 1 ? "Read 1 line into the note." : `Read ${words.length} lines into the note.`)
  }, [change, setDocument, tellRead, view])

  /** The words read out of a box on the camera's page, into the note as a cell of their own (no picture to put away). */
  const readCameraText = useCallback((words: string[]) => {
    if (words.length === 0) return
    const editor = view
    const text = textRef.current
    const at = editor ? editor.state.selection.main.head : text.length
    const opened = insertBlock(text, at)
    const written = opened.markdown.slice(0, opened.caret) + words.join("\n")
      + opened.markdown.slice(opened.caret)
    change(written)
    setDocument(written)
  }, [change, setDocument, view])

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
      // A paste carrying WriteMind's own cells is the cells and nothing else (a drawing cell copied for Mathematica has
      // a PNG beside them, which would otherwise land as a floating picture too).
      if (!takesPastedPicture([...(event.clipboardData?.types ?? [])])) return
      // (nor WriteMind's own copied drawing cell, which a system that shows a pasted file as only that file gives as its
      // SVG file: `pasteSheetCell` lands it)
      if (event.clipboardData && copiedCellOf(event.clipboardData) !== null) return
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
    putToolsDown()
    setMode((was) => (was === "pen" ? "cursor" : "pen"))
  }, [])

  const newNote = useCallback(async (folder: string) => {
    // No folder of the project is there: say so, and make nothing (not in the app's own notes folder, which the
    // project may not contain, where the note would be one the sidebar never lists).
    if (folder === "") { say(NO_FOLDER_TEXT); return }
    const file = await window.wm.createNote(folder)
    await reload()
    await openNote({ path: file, modified: Date.now(), title: "Untitled", snippet: "" })
  }, [openNote, reload, say])

  const newSection = useCallback(async (parent: string) => {
    if (parent === "") { say(NO_FOLDER_TEXT); return }
    await window.wm.createSection(parent)
    await reload()
  }, [reload, say])

  // MARK: - Projects

  /**
   * Let go of every open note: the one in front is written first (and its
   * drawing), then the tabs, the carets and the page go. A project switch.
   */
  const closeAll = useCallback(async () => {
    // The note in front is written, or kept in Recovered: never an error, so a switch cannot stop half way
    // (the project label and the sidebar of one project over the open tab of another).
    await flushNow(true)
    dirty.current = false
    drawingDirty.current = false
    viewStates.current.clear()
    openRef.current = null
    openList.current = []
    setOpen([])
    setCurrent(null)
    setDocument("")
    setDrawing(emptyDrawing())
    forgetAll()
  }, [flushNow, setDocument])

  /**
   * The notes the tree no longer holds are closed — a folder taken out of the
   * project, a file trashed or moved from outside (the Mac's `reload` drops
   * them from `openNoteIDs`). If the one in front goes, the first tab left
   * comes forward, and with none left the project's first note.
   */
  const openList = useRef(open)
  openList.current = open
  // A note that is no longer open takes its undo with it.
  useEffect(() => { keepHistory(open.map((note) => note.path)) }, [open])
  const keepOnly = useCallback(async (tree: Section) => {
    const alive = new Set(notesIn(tree).map((note) => note.path))
    const left = openList.current.filter((note) => alive.has(note.path))
    if (left.length === openList.current.length) {
      // Nothing left the project; the tabs take the titles the tree now has (a note whose first
      // heading changed was "Untitled" in its tab until the next launch).
      const fresh = new Map(notesIn(tree).map((note) => [note.path, note]))
      const titled = left.map((note) => {
        const known = fresh.get(note.path)
        // The note being typed in is ahead of the disk: its tab already has the title it is typing.
        if (note.path === openRef.current && dirty.current) return note
        return known && known.title !== note.title ? { ...note, title: known.title } : note
      })
      if (titled.some((note, index) => note !== left[index])) setOpen(titled)
      return
    }
    const front = openRef.current
    const frontGone = front !== null && !alive.has(front)
    if (frontGone) {
      // Written first if it was being typed in: the file is still there when the project merely stopped showing
      // it, and `mayWrite` refuses when it is not (the typing is then kept in Recovered).
      await flushNow(true)
      dirty.current = false
      drawingDirty.current = false
    }
    for (const note of openList.current) if (!alive.has(note.path)) viewStates.current.delete(note.path)
    setOpen(left)
    if (!frontGone) return
    const next = left[0] ?? notesIn(tree)[0]
    if (next) await openNote(next)
    else {
      openRef.current = null
      setCurrent(null)
      setDocument("")
      setDrawing(emptyDrawing())
    }
  }, [flushNow, openNote, setDocument])

  // The session: what is open, what is in front, where the caret was — one per project.
  const sessionRef = useRef<SessionApi | null>(null)
  const { project, switching } = useProject({ session: sessionRef, reload, lastTree })

  // DOCKING (docs\PLAN-docking-ink-cells.md (d)): the editor's side of it, for the drawing layer's dock handle, and a
  // new empty ink cell (Insert ▸ Drawing Cell, Ctrl+0, the + menu's Drawing Cell). A picture line's path climbs out
  // of the note's section folders to its project folder's `.drawings/media` (`depth`), so other viewers find it.
  const depth = useMemo(() => (current
    ? depthOf(current, (project?.folders ?? []).map((one) => one.path), platform?.root ?? null) : 0),
  [current, project, platform])
  const dockHost = useMemo(() => (view
    ? dockHostFor(view, depth, (next) => { pendingDrawing.current = next }, () => pendingDrawing.current ?? drawingRef.current)
    : undefined), [view, depth])
  const insertInk = useCallback((offset?: number) => {
    const editor = viewRef.current
    const file = openRef.current
    if (!editor || !file || !dockHost) return
    const width = columnBox(editor).width
    const id = insertInkCell({
      history, drawing: () => drawingRef.current, apply: changeDrawing, words: dockHost.words, depth,
      ahead: dockHost.ahead,
    }, offset ?? cursorSeam(editor.state), width)
    const cell = id ? inkCellOf(drawingRef.current, id) : null
    // Its line points at its snapshot at once: an empty svg of its size.
    if (cell) snapshotNow(file, cell, width)
    // The pointer becomes a pen for this cell alone (inkScope.ts: Sean, 2026-10-05).
    if (id) scopePenTo(id)
  }, [changeDrawing, depth, dockHost, history])
  // COPY OR CUT OF HELD CELLS with a drawing cell among them: the shell writes the clipboard again for Mathematica
  // (the image itself; main/wolfram/clipboard.ts). Synchronous and before a cut takes the cells out of the note.
  // A copy with no drawing cell in it starts nothing.
  const onCellsCopied = useCallback((copy: { markdown: string; plain: string }) => {
    const editor = viewRef.current
    const ids = inkIdsIn(copy.markdown)
    if (!editor || ids.length === 0 || !window.wm.wolframCopy) return
    const media = wolframMedia(editor, drawingRef.current, currentPane(editor, lastPane), new Set(ids))
    if (Object.keys(media.inks).length === 0) return
    window.wm.wolframCopy({ plain: copy.plain, markdown: copy.markdown, media, noteFile: openRef.current })
  }, [])
  // The tablet box's "Bring in as Drawing Cell" (BoxActions.tsx): the boxed writing, landed in the pane as Bring in
  // Writing lands it, docked as a NEW drawing cell at the input cursor (the armed bar, else after the caret's cell),
  // its snapshot written at once. One Undo step in the note.
  const dockCapturedInk = useCallback((strokes: CanvasItem[], pane: PaneSize, frame?: Rect): boolean => {
    const editor = viewRef.current
    const file = openRef.current
    if (!editor || !file || !dockHost || strokes.length === 0) return false
    const column = columnBox(editor)
    const left = editor.scrollDOM.getBoundingClientRect().left
    const id = dockNewInk({
      history, drawing: () => drawingRef.current, apply: changeDrawing, words: dockHost.words, depth,
      ahead: dockHost.ahead,
    }, strokes, pane, { left: column.left - left, width: column.width }, cursorSeam(editor.state), frame)
    const cell = id ? inkCellOf(drawingRef.current, id) : null
    if (cell) snapshotNow(file, cell, column.width)
    return id !== null
  }, [changeDrawing, depth, dockHost, history])
  const dockSheetCell = useCallback((capture: Capture): boolean => {
    const editor = viewRef.current
    if (!editor || !capture.strokes || capture.strokes.length === 0) return false
    return dockCapturedInk(capture.strokes, currentPane(editor, lastPane), capture.frame)
  }, [dockCapturedInk])
  // The tablet box's "Copy Cell" (BoxActions.tsx): the same capture as Bring in as Drawing Cell, put on the clipboard as a
  // drawing cell and left out of the note. The page's own copy event writes WriteMind's words and its custom type (the
  // strokes, the box and the pane: `DRAWING_MIME`, which a paste in a note takes as a NEW drawing cell); the shell then
  // adds the rest (main/wolfram/clipboard.ts `cell`: the SVG file for the other apps and Mathematica's own type). Needs no
  // note: the cell's width is the column's, else the pane's. False when the page could not copy.
  const copySheetCell = useCallback((capture: Capture): boolean => {
    if (!window.wm.wolframCopy || !capture.strokes || capture.strokes.length === 0) return false
    const editor = viewRef.current
    const pane = currentPane(editor, lastPane)
    const width = editor ? columnBox(editor).width : columnWidth(pane)
    const cell = cellOfCopied({ strokes: capture.strokes, frame: capture.frame ?? null, pane }, width)
    if (!cell) return false
    const shell = copiedCellForShell(cell, width, depth, openRef.current)
    const json = encodeCopiedCell({ strokes: capture.strokes, frame: capture.frame ?? null, pane })
    let wrote = false
    const onCopy = (event: ClipboardEvent) => {
      if (!event.clipboardData) return
      event.clipboardData.setData("text/plain", shell.plain)
      event.clipboardData.setData(DRAWING_MIME, json)
      event.preventDefault()
      wrote = true
    }
    document.addEventListener("copy", onCopy, true)
    try { document.execCommand("copy") } catch { /* no copy */ } finally { document.removeEventListener("copy", onCopy, true) }
    if (!wrote) return false
    rememberCopiedCell(json, shell.plain)
    window.wm.wolframCopy(shell)
    return true
  }, [depth])
  // A PASTE carrying a drawing cell copied from the tablet box: a NEW drawing cell at the caret or the armed bar, exactly as
  // Bring in as Drawing Cell lands it (one Undo step). The editor takes it when it has the focus (packages/editor
  // `pasteDrawing`); this window listener when it does not. The paste is never also a picture (`takesPastedPicture`).
  const pasteSheetCell = useCallback((data: DataTransfer): boolean => {
    const json = copiedCellOf(data)
    if (json === null) return false
    const copied = readCopiedCell(json)
    if (copied) dockCapturedInk(copied.strokes, copied.pane, copied.frame ?? undefined)
    return true
  }, [dockCapturedInk])
  useEffect(() => {
    const paste = (event: ClipboardEvent) => {
      if (!event.clipboardData || event.defaultPrevented) return
      if (pasteSheetCell(event.clipboardData)) event.preventDefault()
    }
    window.addEventListener("paste", paste)
    return () => window.removeEventListener("paste", paste)
  }, [pasteSheetCell])
  // "None of the project's folders is there" is taken back when one is (a drive plugged in, a share back).
  useEffect(() => {
    if (problemText.current === NO_FOLDER_TEXT && project?.folders.some((one) => one.exists)) clearProblem()
  }, [project, clearProblem])
  const session = useSession({
    root, open, current, states: viewStates, setOpen, openNote, closeAll,
    projectFile: project ? project.file : undefined,
    buffer: () => (dirty.current && openRef.current
      ? { path: openRef.current, text: textRef.current, base: fingerprintOf(baseText.current) } : null),
  })
  sessionRef.current = session
  touchBuffer.current = session.touchBuffer
  // NOTES OPENED FROM OUTSIDE (main/openFiles.ts): a .wm double-clicked in Finder or Explorer, a .wm or .md dropped on the
  // window (a .md has been made a .wm beside it by now). They open as tabs, the last one in front, once the session is
  // back (so they come over the notes that were open) and whenever the shell says there is more.
  useEffect(() => {
    if (!session.ready) return
    let live = true
    const pull = () => {
      void (async () => {
        const files = (await window.wm.takeOpenFiles?.().catch(() => [] as string[])) ?? []
        for (const file of files) {
          if (!live) return
          try {
            const known = openList.current.find((one) => one.path === file)
              ?? (rootRef.current ? notesIn(rootRef.current).find((one) => one.path === file) : undefined)
            await openNoteRef.current(known ?? makeNote(file, Date.now(), await window.wm.readNote(file)))
          } catch (error) {
            say(`${friendly(error)}`, null, `open:${file}`)
          }
        }
      })()
    }
    pull()
    const stop = window.wm.onOpenPending?.(pull)
    return () => { live = false; stop?.() }
  }, [session.ready, say])
  // A .wm or a .md let go on the window opens (the page's own drop, on a picture, is handled where the picture lands).
  useEffect(() => {
    const drop = (event: DragEvent) => {
      const files = [...(event.dataTransfer?.files ?? [])].filter((one) => /\.(wm|mdwm|md|markdown)$/i.test(one.name))
      if (files.length === 0 || !window.wm.pathOfFile || !window.wm.openFile) return
      event.preventDefault()
      for (const one of files) void window.wm.openFile(window.wm.pathOfFile(one))
    }
    window.addEventListener("drop", drop)
    return () => window.removeEventListener("drop", drop)
  }, [])
  // CLOSING THE WINDOW: the shell holds the close until this has run (main.ts `askPageToFlush`) — the note and its
  // drawing written (or kept in Recovered), and the session. A keystroke typed just before the X is on disk.
  useEffect(() => window.wm.onFlushRequest(async () => {
    await flushNow(true)
    await sessionRef.current?.flush()
  }), [flushNow])
  useEffect(() => {
    if (root && session.ready && !switching.current) void keepOnly(root)
  }, [root]) // eslint-disable-line react-hooks/exhaustive-deps
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
    // `/link` writes only the target's file NAME, so the note is looked up among every note of the project, in
    // any section (the Mac's `follow(destination:)`); a path written by hand is taken from this note's folder.
    let target: string | null = from
    if (file) {
      target = resolveLinkTarget(root ? notesIn(root).map((note) => note.path) : [], from, file)
      if (!target) {
        const guess = joinPath(folderOf(from), file)
        target = (await window.wm.existing([guess])).length > 0 ? guess : null
      }
    }
    if (!target) return
    const text = target === from ? textRef.current : await window.wm.readNote(target).catch(() => "")
    const offset = anchor ? anchorOffset(text, anchor) : null
    if (target === from) {
      if (offset !== null && view) {
        revealAt(view, offset)
        view.dispatch({ selection: { anchor: offset }, effects: EditorView.scrollIntoView(offset, { y: "center" }) })
        view.focus()
      }
      return
    }
    const known = root ? notesIn(root).find((note) => note.path === target) : undefined
    const was = viewStates.current.get(target)
    if (offset !== null) viewStates.current.set(target, { caret: offset, collapsed: was?.collapsed ?? [], reveal: true })
    await openNote(known ?? makeNote(target, Date.now(), text))
  }, [openNote, root, view])
  const onFollow = useCallback((from: string, href: string) => { void followLink(from, href) }, [followLink])
  const onLink = useCallback((file: string, caret: number) => setLinking({ file, caret }), [])
  const doneLinking = useCallback(() => setLinking(null), [])
  /** A link was just written into a note: it comes back with the link selected (the Mac's pendingLinkInsertion). */
  const landed = useCallback((file: string, from: number, to: number) => {
    viewStates.current.set(file, { caret: to, anchor: from, collapsed: viewStates.current.get(file)?.collapsed ?? [] })
  }, [])

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
    for (const note of openList.current) if (rename(note.path) !== note.path) renameNote(note.path, rename(note.path))
    // A tablet sheet bound to a cell of a moved note follows it (cellSheets.ts).
    renameBoundNotes(from, to)
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
    await flushNow(false)
    const landed = await window.wm.placeNote(file, folder, before)
    followMoved(file, landed)
    lastTree.current = ""
    await reload()
  }, [flushNow, followMoved, reload])

  const moveSection = useCallback(async (folder: string, target: string) => {
    await flushNow(false)
    const landed = await window.wm.moveSection(folder, target)
    if (landed) followMoved(folder, landed)
    lastTree.current = ""
    await reload()
  }, [flushNow, followMoved, reload])

  /**
   * Take tabs out of the row. The one in front is written first (or, failing that, kept in Recovered): closing the
   * LAST tab used to drop the typing of the last half second, because nothing wrote it before the page was
   * emptied (the Mac's closeTab calls flushPendingSave). The tab that takes the front one's place is the one now
   * at its index, else the last.
   */
  const closeWhere = useCallback(async (gone: (path: string) => boolean) => {
    const was = openList.current
    const front = openRef.current
    const frontGone = front !== null && gone(front)
    if (frontGone) await flushNow(true)
    for (const note of was) if (gone(note.path)) viewStates.current.delete(note.path)
    const left = was.filter((note) => !gone(note.path))
    openList.current = left
    setOpen(left)
    if (!frontGone) return
    const at = was.findIndex((note) => note.path === front)
    const next = left[Math.min(at, left.length - 1)]
    if (next) await openNote(next)
    else {
      dirty.current = false
      drawingDirty.current = false
      openRef.current = null
      setCurrent(null)
      setDocument("")
      setDrawing(emptyDrawing())
    }
  }, [flushNow, openNote, setDocument])
  const close = useCallback((path: string) => closeWhere((one) => one === path), [closeWhere])

  /**
   * Rename… on a note: the file keeps its extension; what is open follows the file, and what is being typed is
   * written first. A string back says why it did not work, and the dialog stays up with it.
   */
  const renameNoteTo = useCallback(async (note: Note, name: string): Promise<string | void> => {
    await flushNow(false)
    try {
      const next = await window.wm.renameNote(note.path, name)
      if (next !== note.path) followMoved(note.path, next)
    } catch (error) {
      return `Could not rename “${leaf(note.path).replace(/\.[^.]+$/, "")}”: ${friendly(error)}.`
    }
    lastTree.current = ""
    await reload()
  }, [flushNow, followMoved, reload])

  /** Rename… on a section: the folder is renamed on disk, and every tab inside it follows. */
  const renameSectionTo = useCallback(async (section: Section, name: string): Promise<string | void> => {
    await flushNow(false)
    try {
      const next = await window.wm.renameSection(section.path, name)
      if (next === null) return "That name cannot be used here."
      if (next !== section.path) followMoved(section.path, next)
    } catch (error) {
      return `Could not rename “${section.name}”: ${friendly(error)}.`
    }
    lastTree.current = ""
    await reload()
  }, [flushNow, followMoved, reload])

  /** Close Other Tabs: only `path` stays, and it comes to the front. */
  const closeOthers = useCallback((path: string) => {
    const keep = open.find((note) => note.path === path)
    if (!keep) return
    for (const note of open) if (note.path !== path) viewStates.current.delete(note.path)
    setOpen([keep])
    if (current !== path) void openNote(keep)
  }, [current, open, openNote])

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
    await close(note.path)
    lastTree.current = ""
    await reload()
  }, [close, letGo, reload])

  const trashSection = useCallback(async (section: Section) => {
    const inside = (path: string) => path.startsWith(section.path + "/") || path.startsWith(section.path + "\\")
    // No save while the folder is on its way to the bin (a write after it would make the file again) — but the
    // typing is only let go of once the bin has the folder.
    const front = openRef.current
    if (front && inside(front)) {
      if (timer.current) window.clearTimeout(timer.current)
      if (drawingTimer.current) window.clearTimeout(drawingTimer.current)
    }
    const trashed = await window.wm.trashSection(section.path)
    if (!trashed) {
      // A project folder (or anything outside the project) is not the sidebar's to bin: nothing changed.
      if (front && inside(front) && dirty.current) saveRef.current()
      say(`“${section.name}” is a project folder, so it was not moved to the bin. Remove Folder from Project takes it out of the project and leaves it on disk.`)
      return
    }
    letGo(inside)
    await closeWhere(inside)
    lastTree.current = ""
    await reload()
  }, [closeWhere, letGo, reload, say])

  const duplicate = useCallback(async (note: Note) => {
    await flushNow(false)
    await window.wm.duplicateNote(note.path)
    lastTree.current = ""
    await reload()
  }, [flushNow, reload])

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
    // The pane says when a camera has opened (labels arrive then) or gone away.
    const changed = () => { void refreshCameras() }
    window.addEventListener("wm:cameras-changed", changed)
    return () => {
      if (later) window.clearTimeout(later)
      navigator.mediaDevices?.removeEventListener?.("devicechange", refreshCameras)
      window.removeEventListener("wm:cameras-changed", changed)
    }
  }, [refreshCameras, showCamera])
  /** The source the menus tick: the camera that is open, the tablet, or nothing when it is off. */
  const sourceId = cameraPick === TABLET_SOURCE ? TABLET_SOURCE
    : cameraPick === CAMERA_OFF ? null
    : showCamera ? (activeCamera ?? cameraPick) : cameraPick

  // MARK: - The menu bar's commands

  const kind = platform?.platform ?? (navigator.userAgent.includes("Mac") ? "darwin" : "win32")
  const hasNote = current !== null
  /** Either pane can be put away, never both (`AppState` keeps at least one up). */
  const toggleCameraPane = () => {
    if (showCamera && !showEditor) setShowEditor(true)
    // Hiding the video leaves full-window behind it.
    if (showCamera) setCameraFullWindow(false)
    setShowCamera(!showCamera)
  }
  /** Filling the window with a pane that had been put away would be a black rectangle with no way out: it comes back. */
  const toggleCameraFullWindow = () => {
    setCameraFullWindow((was) => !was)
    setShowCamera(true)
  }
  const toggleEditorPane = () => {
    if (showEditor && !showCamera) setShowCamera(true)
    setShowEditor(!showEditor)
  }
  const targetFolder = (): string => targetFolderOf(current, root)

  // The pen's buttons and ExpressKeys, for what only this component owns: the
  // pen's colour and width and whether the pen is down (penActions.ts).
  const penTools = usePenSettings()
  // The Pen menu's Erase / Select checks: the tools of the surface the pen is on (the sheet has its own, penActions.ts).
  const sheetTools = useSheetTools()
  const toolsHere = usePenOnSheet() ? sheetTools : penTools
  useEffect(() => registerPenHandlers({
    togglePen: toggleMode,
    nextColour: () => setPenColour((now) => cycleColour(now, PRESET_COLOURS.slice(0, 4), 1)),
    prevColour: () => setPenColour((now) => cycleColour(now, PRESET_COLOURS.slice(0, 4), -1)),
    wider: () => setPenWidth((now) => stepWidth(now, PEN_WIDTHS, 1)),
    thinner: () => setPenWidth((now) => stepWidth(now, PEN_WIDTHS, -1)),
  }), [toggleMode])

  // HELP ▸ QUICK REFERENCE (main/welcome.ts): the note is written if it is missing and rewritten with this app's text if
  // it is out of date (any edit to it is overwritten: it is the app's, not the person's), then opened in a tab and shown
  // rendered (welcomeView.ts). What is typed into it and not yet written goes to the file FIRST, so the rewrite is the
  // newer of the two and the guard has nothing to refuse.
  const openQuickReference = useCallback(async () => {
    const ensure = window.wm.quickReference
    if (!ensure) return
    try {
      if (openRef.current && quickPath && samePath(openRef.current, quickPath)) await flushNow(false)
      const file = await ensure()
      setQuickPath(file)
      await reload()
      await openNote(makeNote(file, Date.now(), await window.wm.readNote(file)))
      setQuickAsked((was) => was + 1)
    } catch (error) {
      say(`The Quick Reference could not be opened: ${friendly(error)}`, null, "quick-reference")
    }
  }, [flushNow, openNote, quickPath, reload, say])

  const run = (id: string) => {
    // Input Devices ▸ Aspect Ratio: the shape of the viewfinder (cameraSettings.ts, CameraPane's viewfinder).
    if (id.startsWith("cameraAspect:")) { setCameraAspect(parseCameraAspect(id.slice("cameraAspect:".length))); return }
    if (id.startsWith("camera:")) {
      const pick = id.slice("camera:".length)
      const next = pick.startsWith("unknown-") ? null : pick
      setCameraPick(next)
      remember("videoSource", next)
      setShowCamera(true)
      // The same camera picked again (it was busy, or access was off, and is free now) changes no state: say so.
      window.dispatchEvent(new Event("wm:camera-retry"))
      return
    }
    // The pen's tools and the keys the tablet's ExpressKeys type (penActions.ts).
    if (id.startsWith("pen") && runPenCommand(id)) return
    switch (id) {
      case "newNote": void newNote(targetFolder()); return
      case "closeTab": if (current) void close(current); return
      case "openFolder": void window.wm.revealNotes(); return
      // Ctrl+S: what is pending (the note and its drawing) is written now (the Mac's flushPendingSave).
      case "save": if (current) void flushNow(false); return
      // Ctrl+E: one panel, and PDF, Wolfram Notebook or Project is chosen in it (main/exportFile.ts). With no note open, the project.
      case "export": {
        // The text as it is in the editor, not as it is on disk: what is on screen is "this note".
        const pane = currentPane(view, lastPane)
        const markdown = textRef.current
        void (async () => {
          await window.wm.exportFile(current ? {
            noteFile: current, title: title.replace(/\.(wm|md|markdown|txt)$/i, ""),
            markdown, drawing: writeDrawing(drawingRef.current),
            // The pane the ink was placed against: its last real size when the notes pane is put away.
            pane,
            // The drawings as this page measured them, for a Wolfram notebook (a PDF takes the sidecar's own).
            wolfram: await withSnapshots(wolframMedia(view, drawingRef.current, pane), markdown),
          } : null)
        })()
        return
      }
      // Ctrl+P: the same writer as Pen ▸ Pen Down and the pen button.
      case "togglePen": runPenCommand("penToggle"); return
      case "keyList": setShowKeys((was) => !was); return
      case "quickReference": void openQuickReference(); return
      case "cleanUp": setCleanUp(true); return
      case "languageSetup": setLanguageSetup({ focus: null }); return
      case "about": setAbout(true); return
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
      // Two independent switches, as on the Mac: the preview / editor mode, and whether the
      // markdown editor shows its markers (the choice is remembered; it is the editor's, so the
      // rendered page, which always puts its marks away, does not need it).
      case "toggleMode":
        if (hasNote) setRendered((was) => !was)
        return
      case "toggleMarkers":
        setMarkers((was) => { remember("markers", !was); return !was })
        return
      case "toggleCamera": toggleCameraPane(); return
      case "toggleEditorPane": toggleEditorPane(); return
      // The Mac's `turnOff`: no camera at all, and the pane says so (it stays where it is).
      case "cameraOff": setCameraPick(CAMERA_OFF); remember("videoSource", CAMERA_OFF); return
      case "cameraRefresh": void refreshCameras(); window.dispatchEvent(new Event("wm:camera-retry")); return
      case "insertImage": if (hasNote) void choosePicture(); return
      case "insertTextBox": if (hasNote) arm({ kind: "shape", shape: "text" }); return
      case "insertMath": if (hasNote) window.dispatchEvent(new Event(MATH_OPEN_EVENT)); return
      // An empty ink cell at the armed bar, else after the caret's cell (one Undo takes its line and its item).
      case "insertInkCell": if (hasNote) insertInk(); return
      // Find: ⌘F opens the bar on the selection's words, ⌘G / ⇧⌘G go on, ⌘E takes the selection, ⌥⌘F replaces.
      case "find": case "findReplace": case "findNext": case "findPrevious": case "useSelectionForFind": case "jumpToSelection": {
        if (!hasNote || !view) return
        const main = view.state.selection.main
        const selected = main.empty ? "" : view.state.sliceDoc(main.from, main.to)
        const words = selected.length > 0 && selected.length <= 200 && !selected.includes("\n") ? selected : null
        if (id === "jumpToSelection") {
          view.dispatch({ effects: EditorView.scrollIntoView(main.head, { y: "center" }) })
          return
        }
        if (id === "useSelectionForFind") {
          if (words !== null) { lastQuery.current = words; if (finding) setFinding({ ...finding, seed: words, tick: finding.tick + 1 }) }
          return
        }
        if (id === "findNext" || id === "findPrevious") {
          // With the bar away it goes on looking for the words last looked for.
          if (!finding) {
            if (lastQuery.current.length === 0) { setFinding({ mode: "find", seed: words, tick: 1 }); return }
            setFinding({ mode: "find", seed: lastQuery.current, tick: 1 })
            return
          }
          findNextMatch(view, id === "findPrevious")
          return
        }
        setFinding({ mode: id === "findReplace" ? "replace" : "find", seed: words ?? (finding ? null : lastQuery.current || null), tick: (finding?.tick ?? 0) + 1 })
        return
      }
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
      editorPane: showEditor,
      markers,
      canUndoDrawing: history.canUndo,
      canRedoDrawing: history.canRedo,
      listStyle: listTitle(listStyle),
      codeLanguage: codeLanguage === "plain" ? null : languageTitle(codeLanguage),
      cameras,
      cameraId: sourceId,
      cameraAspect: aspect,
      penDown: mode === "pen",
      penErase: toolsHere.eraser,
      penSelect: toolsHere.selectTool,
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
    <div className={`app${platform?.platform === "darwin" ? " mac" : ""}${showEditor && !cameraFullWindow ? "" : " no-editor"}`}>
      {/* The picture filling the window puts the sidebar out of sight, not away: it comes back as it was. */}
      {showSidebar && (<div style={{ display: cameraFullWindow ? "none" : "contents" }}>
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
          onRenameNote={(note, name) => renameNoteTo(note, name)}
          onRenameSection={(section, name) => renameSectionTo(section, name)}
          project={project} platform={kind}
          onProjectCommand={(id) => { if (id === "cleanUp") setCleanUp(true); else void window.wm.runMain(id) }}
          onReveal={(path) => { void window.wm.reveal(path) }}
          header={(
            <SidebarBar
              platform={kind}
              editing={editing} onEditing={setEditing}
              onNewSection={() => { void newSection(targetFolder()) }}
              newSectionIn={targetFolder().split(/[\\/]/).pop() || "the notes folder"}
              rendered={rendered} hasNote={hasNote}
              onToggleRendered={() => setRendered((was) => !was)}
              camera={showCamera} onToggleCamera={toggleCameraPane}
              cameras={cameras} cameraId={sourceId}
              onPickCamera={(id) => run(`camera:${id}`)}
              onCameraOff={() => run("cameraOff")}
              onRefreshCameras={() => { void refreshCameras() }}
              notesPane={showEditor} onToggleNotesPane={toggleEditorPane}
            />
          )}
        />
      </div>)}
      <div className="pane" style={showEditor && !cameraFullWindow ? undefined : { display: "none" }}>
        <TabBar platform={kind} open={open} current={current}
                onSelect={(note) => { void openNote(note) }} onClose={close} onCloseOthers={closeOthers}
                onNew={() => { void newNote(targetFolder()) }} onReveal={(path) => { void window.wm.reveal(path) }} />
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
            {finding && (
              <FindBar view={view} request={finding}
                       onQuery={(query) => { lastQuery.current = query }} onClose={() => setFinding(null)} />
            )}
            <LinkBanner request={linking} current={current} view={view} root={root}
                        openNote={openNote} onLanded={landed} onDone={doneLinking} />
            <div className="stack"
                 onDragOver={(event) => { event.preventDefault() }}
                 onDrop={(event) => {
                   const file = [...event.dataTransfer.files].find((one) => one.type.startsWith("image/"))
                   if (!file) return
                   event.preventDefault()
                   void addPicture(file, { x: event.clientX, y: event.clientY })
                 }}>
              <Notebook file={current} text={loaded.text} version={loaded.version}
                        restore={viewStates.current.get(current) ?? null} rendered={rendered}
                        markers={markers} listStyle={listStyle}
                        onChange={change} onReady={setView}
                        onViewState={onViewState} onLink={onLink} onFollow={onFollow}
                        readOnly={readOnly}
                        inkPainter={painter.current} onInsertInkCell={(offset) => insertInk(offset)}
                        onCellsCopied={onCellsCopied} onDrawingPasted={pasteSheetCell} />
              {/* The page drawing layer belongs to the rendered notebook: unmount it in source mode so its marks
                  are hidden and none of its pointer or keyboard handlers can take input from the Markdown editor. */}
              {rendered && <Canvas key={current ?? ""} drawing={drawing} onChange={changeDrawing} mode={mode} history={history}
                                   colorHex={penColour} penWidth={penWidth}
                                   placing={placing} onPlaced={placed}
                                   scroller={view ? view.scrollDOM : null}
                                   onReadPicture={readOn ? onReadPicture : undefined}
                                   dock={dockHost} />}
            </div>
            <div className="footer">
              <span>{title}</span>
              <div className="spacer" />
              {stale && <span title="The file changed under the app; nothing was overwritten (what was typed is kept in Recovered)">
                file changed on disk — not saved
              </span>}
              {readNotice && <span data-footer="read-notice" role="status">{readNotice}</span>}
              {mode === "pen" && <span>Pen</span>}
              {/* (What floats on the page: an ink cell's item is in the note's flow, and a picture read into words is put away.) */}
              {(() => {
                const objects = visibleItems(drawing).length
                return objects > 0 && <span>{objects === 1 ? "1 object" : `${objects} objects`}</span>
              })()}
              <span>{words === 1 ? "1 word" : `${words} words`}</span>
              {saved && <span>Saved {saved.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</span>}
            </div>
          </>
        ) : (
          <div className="empty" data-pane="empty">
            <svg width="40" height="40" viewBox="0 0 40 40" fill="none" aria-hidden>
              <path d="M8 31l-1 6 6-1 20-20-5-5z" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" />
              <path d="M24 9l5 5M6 37h16" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
            </svg>
            <div style={{ fontSize: 15 }}>No note open</div>
            <button className="icon-button" data-pane="new-note" style={{ width: "auto", padding: "0 10px" }}
                    onClick={() => { void newNote(targetFolder()) }}>
              New Note  {shown("newNote", kind)}
            </button>
          </div>
        )}
        <FolderNotice />
        {problem && (
          <div className="save-problem" role="alert" data-footer="problem">
            <span className="text">{problem.text}</span>
            {problem.kept && <button type="button" onClick={() => { void window.wm.reveal(problem.kept!) }}>Show</button>}
            <button type="button" aria-label="Dismiss" title="Dismiss" onClick={() => clearProblem()}>×</button>
          </div>
        )}
      </div>
      {showCamera && showEditor && !cameraFullWindow && <PaneDivider sidebar={showSidebar} />}
      {showCamera && (
        <CameraPane
          platform={platform}
          penColour={penColour}
          penWidth={penWidth}
          pane={currentPane(view, lastPane)}
          onCapture={(capture) => { void addCapture(capture) }}
          onDockCell={dockSheetCell}
          onCopyCell={copySheetCell}
          // The Mac's toggleCameraPane: the notes come back and full-window is left behind with the video.
          onHide={toggleCameraPane}
          preferred={cameraPick}
          cameras={cameras}
          onPickSource={(id) => run(`camera:${id}`)}
          onRefreshCameras={() => { void refreshCameras() }}
          onActiveCamera={setActiveCamera}
          showEditor={showEditor || cameraFullWindow}
          onToggleEditor={toggleEditorPane}
          onReadText={readCameraText}
          note={current}
          fullWindow={cameraFullWindow}
          onFullWindow={toggleCameraFullWindow}
        />
      )}
      {showKeys && <KeyList platform={kind} onClose={() => setShowKeys(false)} />}
      {cleanUp && <CleanUpDialog platform={kind} onClose={() => setCleanUp(false)} held={() => heldBy({
        state: view?.state ?? null, text: textRef.current, drawings: [drawingRef.current, pendingDrawing.current, clipboardDrawing()],
        open: open.map((note) => note.path),
      })} />}
      {languageSetup && <LanguageSetupDialog platform={kind} capabilities={platform} focus={languageSetup.focus}
                                             onClose={() => setLanguageSetup(null)} />}
      {about && <AboutDialog platform={kind} onClose={() => setAbout(false)} />}
      <UpdateDialog />{/* "Updates available" and Help ▸ Check for Updates…'s answers (main/updater.ts); otherwise nothing */}
      <CellMenu onPlace={arm} />
    </div>
  )
}
