/**
 * The camera: a viewfinder, a box drawn on it by hand, and the ways to take
 * what is inside the box — the WRITING lifted off the paper and traced into
 * outlines, the PAGE as a photograph, the RAW picture as the camera sees it.
 *
 * What is Apple's and what is ours, in one place. Finding the page in the
 * frame is Vision's document segmentation on the Mac; here it is
 * `findPage` in `@writemind/core` (a threshold-and-hull finder with a line
 * vote for pale desks, refined along the real edge), so a capture squares the
 * page up by itself and "Straighten" starts its four corners ON the page,
 * ready to be dragged if it got one wrong. The perspective is undone in
 * `warpToPage`, and everything else — the local-mean threshold that lifts ink
 * off paper, the connected components that drop the printed dot grid, the page
 * shape that keeps two captures the same size, the outline tracer, the
 * flow-chart reader that turns a sketched chart into real nodes and arrows —
 * is `@writemind/core` and runs the same on either platform.
 *
 * THE TABLET IS A SECOND SOURCE for this same pane (picked beside the cameras
 * in Input Devices): a sheet to write on with the pen instead of a page under
 * a document camera. The box, the Writing and Page buttons, the page shape,
 * the placement, the flow-chart reader and the one-step undo are all this
 * file's, shared; only where the picture comes from differs (`takeTablet`).
 *
 * THE STREAM is `useCameraStream`: opened when the pane is on screen, every
 * track stopped when it is put away, the source changes or the camera is
 * unplugged. The pane draws the Mac's four stand-ins when there is no picture
 * (no camera selected, access off, unavailable, starting).
 */

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react"
import {
  boxAction, composeZoom, displayedFrame, fitAspect, isBoxDrag, placement, regionOf, unzoomedPoint, unzoomedRect,
  zoomedPoint, zoomedRect, zoomOffset, zoomScale, type Rect, type Size,
} from "@writemind/core"
import { bandUnder, chartFromLabelled, chartSummary, type Corners } from "./capturePipeline"
import { detectPage, takePicture, uprightPicture, uprightSize } from "./cameraTake"
import {
  normalRotation, rememberedRotation, rememberedShape, rememberedZoom, rememberRotation, rememberShape, rememberZoom,
  useCameraAspect, type CaptureMode, type Rotation, type ZoomBox,
} from "./cameraSettings"
import { idleProblem } from "./cameraDevices"
import { useCameraStream, useHeldFrame } from "./useCameraStream"
import { ocrAvailable, readCanvasLines, wordsForChart } from "./ocrClient"
import { CAMERA_OFF, TABLET_SOURCE } from "../shared/commands"
import { setSheetEraser, setSheetSelect, useSheetTools } from "./penSettings"
import { TabletSurface, type SurfaceHandle } from "./TabletSurface"
import { eraseFromSheet, takeFromSheet, type Capture } from "./tabletCapture"
import { currentSheet, stepSheet, useSheetTabs } from "./tabletSheets"
import { SheetStrip } from "./SheetStrip"
import { stepNote, useCellSheet } from "./cellSheets"
import { registerPenHandlers } from "./penActions"
import { OrientationSelect } from "./OrientationSelect"
import { PaperMenu } from "./PaperMenu"
import { paper as currentPaper } from "./tabletPaper"
import { usePenWord, usePenWordNote } from "./penWord"
import { usePenFeed } from "./usePenFeed"
import type { Platform } from "./wm"
import "./camera.css"

export type { Capture }

interface Props {
  platform: Platform | null
  penColour: string
  penWidth?: number
  /** The notes pane, which is what a capture is measured against. */
  pane: Size
  onCapture(capture: Capture): void
  /**
   * The tablet box's "Bring in as Drawing Cell": the writing (landed as Writing lands it) docked as a new drawing cell
   * at the note's input cursor, one Undo step. False when the note could not take it.
   */
  onDockCell?(capture: Capture): boolean
  onHide(): void
  /**
   * The source picked from the Input Devices menu (or the sidebar's video menu): a camera's id, the
   * tablet, "off" (no source, the Mac's placeholder), or null for the system's default camera.
   */
  preferred?: string | null
  /** Every camera the machine has, for the placeholder's own list. */
  cameras?: { id: string; name: string }[]
  onPickSource?(id: string): void
  onRefreshCameras?(): void
  /** The camera actually in use (what the menu puts its tick on), or null. */
  onActiveCamera?(id: string | null): void
  /** The notes pane is showing; when it is not, the corner offers the way back. */
  showEditor?: boolean
  onToggleEditor?(): void
  /** The open note: a capture whose reading finishes after another note was opened is not added to that one. */
  note?: string | null
  /** The words read out of a box, for the note. */
  onReadText?(lines: string[]): void
  /**
   * The picture fills the WINDOW (Mac commit 0edfc08): a double-click on the picture asks for it and again for the
   * way back, and so does the faint × drawn over the top-left corner while it is on. The app's own window only,
   * never the display: nothing in this app goes full screen.
   */
  fullWindow?: boolean
  onFullWindow?(): void
}

type CornerName = keyof Corners
const CORNER_NAMES: CornerName[] = ["topLeft", "topRight", "bottomRight", "bottomLeft"]

/** The page's corners as fractions of the picture shown (top-left origin). */
type Quad01 = Record<CornerName, { x: number; y: number }>
const inset = (by: number): Quad01 => ({
  topLeft: { x: by, y: by }, topRight: { x: 1 - by, y: by },
  bottomRight: { x: 1 - by, y: 1 - by }, bottomLeft: { x: by, y: 1 - by },
})

const SWITCHED = "You opened another note while that was being read, so it was not added - take it again."

const hex = (colour: string): string => (/^#[0-9a-f]{6}$/i.test(colour) ? colour : "#2D7DD2")

/** What the Input Devices menu and the video menu can ask of the pane (`wm:camera-action`). */
export type CameraAction = "turn-left" | "turn-right" | "original-size" | "resize-by-square"

export function CameraPane({
  platform, penColour, penWidth = 2, pane, onCapture, onDockCell, onHide, preferred,
  cameras = [], onPickSource, onRefreshCameras, onActiveCamera, showEditor = true, onToggleEditor, onReadText, note = null,
  fullWindow = false, onFullWindow,
}: Props) {
  /** The open note NOW (a capture remembers the one it was taken in). */
  const noteRef = useRef<string | null>(note)
  noteRef.current = note
  const video = useRef<HTMLVideoElement | null>(null)
  const host = useRef<HTMLDivElement | null>(null)
  const top = useRef<HTMLDivElement | null>(null)
  /** The tablet is the source: a sheet to write on, no camera is opened. */
  const tablet = preferred === TABLET_SOURCE
  /** "Turn Camera Off": nothing is opened and the pane says so. */
  const off = preferred === CAMERA_OFF
  const wanted = preferred && preferred !== TABLET_SOURCE && preferred !== CAMERA_OFF ? preferred : null
  const [attempt, setAttempt] = useState(0)
  const stream = useCameraStream(video, { enabled: !tablet && !off, deviceId: wanted, attempt })
  /** HOLD IMAGE: one frame kept still; the box, the corners and every capture use it (useHeldFrame). */
  const frozen = useHeldFrame(video, { live: !tablet && !off && stream.status === "running", source: preferred ?? null })
  const held = frozen.held
  // Picking a camera again (the menu's, the placeholder's) or Refresh asks it to start again: a camera that was busy
  // or refused is the SAME pick, which changes no state, so the pick says so.
  useEffect(() => {
    const again = () => setAttempt((was) => was + 1)
    window.addEventListener("wm:camera-retry", again)
    return () => window.removeEventListener("wm:camera-retry", again)
  }, [])
  const surface = useRef<SurfaceHandle | null>(null)
  // The sheet's own Erase / Select (never the notebook toolbar's: penSettings.ts).
  const pen = useSheetTools()
  const penWord = usePenWord()
  const penWordNote = usePenWordNote()
  const [, edited] = useState(0)
  const [trouble, setTrouble] = useState<string | null>(null)
  const [read, setRead] = useState<string | null>(null)
  /** The box dragged on the picture, in the pane's own points as the person sees it. */
  const [box, setBox] = useState<Rect | null>(null)
  /** The tablet's sheets (one per tab, tabletSheets.ts) and the open one, which everything below acts on. */
  const sheets = useSheetTabs()
  const sheet = currentSheet()
  /** The open sheet's drawing cell, when it is bound to one (cellSheets.ts): Undo is the note's, Bring in is off. */
  const binding = useCellSheet()
  /** Each sheet's dashed box, in FRACTIONS of the sheet (the sheet is shown at any size). */
  const [sheetBoxes, setSheetBoxes] = useState<Record<string, Rect | null>>({})
  const sheetBox = sheetBoxes[sheets.current] ?? null
  const boxOn = useCallback((id: string, next: Rect | null) => setSheetBoxes((was) => ({ ...was, [id]: next })), [])
  const setSheetBox = (next: Rect | null) => boxOn(sheets.current, next)
  const drag = useRef<{ x: number; y: number; id: number } | null>(null)
  /** The last click on the picture, so a second one close behind it is a double click (a pointer event carries no count). */
  const [dragging, setDragging] = useState(false)
  const lastClick = useRef<{ time: number; x: number; y: number } | null>(null)
  /** "Straighten" is on: the page's four corners are showing, and a capture is warped through them. */
  const [straighten, setStraighten] = useState(false)
  const [quad, setQuad] = useState<Quad01>(inset(0.08))
  const [, redraw] = useState(0)
  /** The page's shape, learned from the first page that was found and kept (across launches). */
  const shape = useRef<number | null>(rememberedShape())
  /** So two captures in a row do not land exactly on top of each other. */
  const nudge = useRef(0)
  const [busy, setBusy] = useState(false)
  const [rotation, setRotation] = useState<Rotation>(rememberedRotation)
  const [zoom, setZoom] = useState<ZoomBox | null>(rememberedZoom)
  /** Armed to drag the box the pane zooms into. */
  const [zooming, setZooming] = useState(false)
  const [reader, setReader] = useState(false)
  /** The pane as the divider makes it. */
  const [outer, setOuter] = useState<Size>({ width: 0, height: 0 })
  /**
   * THE VIEWFINDER IS THE SHAPE THAT WAS ASKED FOR (Input Devices ▸ Aspect Ratio, Mac commit c98c067), centred in
   * the pane. Everything below is measured against `size` and not against the pane, so the box you drag, the zoom
   * and what the capture brings in all go on meaning what they meant, inside the rectangle instead of inside the
   * pane. `free` hands the pane straight back, which is what this was before there was a choice. The tablet's sheet
   * has its own shape (the tablet's) and is not a viewfinder.
   */
  const aspect = useCameraAspect()
  const size = useMemo<Size>(() => (tablet ? outer : fitAspect(aspect, outer)), [tablet, aspect, outer])
  const finder = { x: (outer.width - size.width) / 2, y: (outer.height - size.height) / 2 }

  useEffect(() => { void ocrAvailable().then(setReader) }, [])
  useEffect(() => { onActiveCamera?.(stream.status === "running" ? stream.deviceId : null) }, [onActiveCamera, stream.status, stream.deviceId])

  // The pane's size, as it is laid out (the picture is fitted to it and the corners are drawn against it).
  useLayoutEffect(() => {
    const element = host.current
    if (!element) return
    const measure = () => {
      const rect = element.getBoundingClientRect()
      setOuter((was) => (was.width === rect.width && was.height === rect.height ? was : { width: rect.width, height: rect.height }))
    }
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(element)
    return () => observer.disconnect()
  }, [])

  // The picture's size is only known once a frame has arrived (and changes if the camera does): one more render when it does.
  useEffect(() => {
    const element = video.current
    if (!element) return
    const again = () => redraw((was) => was + 1)
    element.addEventListener("loadedmetadata", again)
    element.addEventListener("resize", again)
    return () => {
      element.removeEventListener("loadedmetadata", again)
      element.removeEventListener("resize", again)
    }
  }, [tablet])

  const turned = rotation === 90 || rotation === 270
  /** The picture as the person sees it: upright, after the quarter turns. */
  /** The picture as the camera gives it (the held still's while one is held), not turned. */
  const rawSize = (): Size => frozen.heldSize() ?? { width: video.current?.videoWidth ?? 0, height: video.current?.videoHeight ?? 0 }
  const frameSize = (): Size => uprightSize(rawSize(), rotation)
  const paneSize = (): Size => size
  const frame = frameSize()
  const shown = displayedFrame(frame, size)
  const running = !tablet && stream.status === "running" && shown.width > 0

  // MARK: the zoom, and the way from a point on screen to a point on the picture

  const zoomed = zoom !== null && !tablet
  /** A point on the unzoomed pane, where it is drawn. */
  const toScreen = (point: { x: number; y: number }) => (zoom ? zoomedPoint(point, zoom, size) : point)
  /** A point on screen, where it is on the unzoomed pane. */
  const fromScreen = (point: { x: number; y: number }) => (zoom ? unzoomedPoint(point, zoom, size) : point)
  const stageStyle = zoom
    ? (() => {
      const offset = zoomOffset(zoom, size)
      return { transform: `translate(${offset.width}px, ${offset.height}px) scale(${zoomScale(zoom, size)})` }
    })()
    : undefined

  /** A point on screen in the viewfinder's own points (the viewfinder is the pane, or the shape centred in it). */
  const at = (event: { clientX: number; clientY: number }): { x: number; y: number } => {
    const rect = host.current!.getBoundingClientRect()
    return { x: event.clientX - rect.left - finder.x, y: event.clientY - rect.top - finder.y }
  }

  // MARK: turning the picture

  const turn = useCallback((by: number) => {
    setRotation((was) => {
      const next = normalRotation(was + by)
      rememberRotation(next)
      return next
    })
    // A box drawn on the picture is not on it any more.
    setBox(null)
  }, [])

  // The video menu (and the corner) ask by event, so the pane owns the picture's state.
  useEffect(() => {
    const act = (event: Event) => {
      const action = (event as CustomEvent<CameraAction>).detail
      if (action === "turn-left") turn(-90)
      else if (action === "turn-right") turn(90)
      else if (action === "original-size") { setZoom(null); rememberZoom(null) }
      else if (action === "resize-by-square") setZooming(true)
    }
    window.addEventListener("wm:camera-action", act)
    return () => window.removeEventListener("wm:camera-action", act)
  }, [turn])

  useEffect(() => { if (stream.status !== "running") { setBox(null); setZooming(false) } }, [stream.status])
  // A box drawn in a viewfinder of another shape is somewhere else in this one.
  useEffect(() => { setBox(null) }, [aspect])
  // Escape lets go of a zoom that was armed (and of a box that was drawn). Then, with the pane focused (a click on the
  // picture or on one of its buttons), it lets go of a held picture: one thing per press, the box first.
  const letGo = frozen.letGo
  useEffect(() => {
    if (!zooming && !box && !held) return
    const key = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return
      if (zooming || box) { setZooming(false); setBox(null); return }
      if (event.defaultPrevented || !host.current?.contains(document.activeElement)) return
      event.preventDefault()
      letGo()
    }
    window.addEventListener("keydown", key)
    return () => window.removeEventListener("keydown", key)
  }, [zooming, box, held, letGo])

  // MARK: the frame, upright, as one snapshot

  /**
   * The frame on screen right now (the held still while one is held), turned upright, as a canvas of its own (one
   * frame for the whole capture).
   */
  const snapshot = (): { picture: HTMLCanvasElement; frame: Size } | null => {
    const source = frozen.picture()
    if (!source) return null
    const canvas = uprightPicture(source.image, source.size, rotation)
    return { picture: canvas, frame: { width: canvas.width, height: canvas.height } }
  }

  /** The page's corners in the picture's pixels, from the fractions the corners are kept in. */
  const cornersPx = (f: Size): Corners => ({
    topLeft: { x: quad.topLeft.x * f.width, y: quad.topLeft.y * f.height },
    topRight: { x: quad.topRight.x * f.width, y: quad.topRight.y * f.height },
    bottomRight: { x: quad.bottomRight.x * f.width, y: quad.bottomRight.y * f.height },
    bottomLeft: { x: quad.bottomLeft.x * f.width, y: quad.bottomLeft.y * f.height },
  })

  /** Look for the page: the four corners go onto it (the person can still drag them). */
  const findNow = useCallback(() => {
    const taken = snapshot()
    if (!taken) return
    const found = detectPage(taken.picture, taken.frame)
    if (!found) {
      setQuad(inset(0.08))
      setRead("No page found - drag the corners onto the page's corners.")
      return
    }
    const f = taken.frame
    const to = (p: { x: number; y: number }) => ({ x: p.x / f.width, y: p.y / f.height })
    setQuad({
      topLeft: to(found.corners.topLeft), topRight: to(found.corners.topRight),
      bottomRight: to(found.corners.bottomRight), bottomLeft: to(found.corners.bottomLeft),
    })
    setRead("Found the page - drag a corner if it is off.")
    // eslint-disable-next-line react-hooks/exhaustive-deps -- reads the current frame
  }, [rotation])

  const toggleStraighten = () => {
    const next = !straighten
    setStraighten(next)
    if (next) findNow()
  }
  // The picture turned under the corners: look again.
  const firstTurn = useRef(true)
  useEffect(() => {
    if (firstTurn.current) { firstTurn.current = false; return }
    if (straighten) findNow()
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only a turn asks again
  }, [rotation])

  // MARK: the box, and taking what is in it

  /** The box as a fraction of the upright picture (top-left origin), clipped to it; null without a box. */
  const regionOfBox = (): { region: Rect | null; offPicture: boolean } => {
    if (!box) return { region: null, offPicture: false }
    // A box drawn on a zoomed picture is somewhere else on the real one.
    const drawn = zoom ? unzoomedRect(box, zoom, size) : box
    const region = regionOf(drawn, frameSize(), paneSize())
    return { region, offPicture: region === null }
  }

  /** The box a double click draws: the picture as it is on screen (letterboxing and zoom allowed for). */
  const wholePictureBox = (): Rect | null => {
    if (shown.width <= 2 || shown.height <= 2) return null
    const drawn = zoom ? zoomedRect(shown, zoom, size) : shown
    const x0 = Math.max(0, drawn.x), y0 = Math.max(0, drawn.y)
    const x1 = Math.min(size.width, drawn.x + drawn.width), y1 = Math.min(size.height, drawn.y + drawn.height)
    return x1 - x0 >= 2 && y1 - y0 >= 2 ? { x: x0, y: y0, width: x1 - x0, height: y1 - y0 } : null
  }

  /**
   * Take what is in the box (or all of it). The page is found by itself, or
   * its corners are the ones dragged ("Straighten"); the box is carried through
   * the same perspective onto the squared page, so a capture lands where it was
   * on the page and two of them are the same size.
   */
  const take = useCallback(async (mode: CaptureMode) => {
    if (busy) return
    const startedIn = noteRef.current
    const taken = snapshot()
    if (!taken) { setTrouble("There is no camera picture to take."); return }
    const { region, offPicture } = regionOfBox()
    if (offPicture) { setTrouble("That box is not on the picture."); return }
    setBusy(true)
    try {
      const result = await takePicture({
        mode, picture: taken.picture, frame: taken.frame, region,
        corners: straighten && mode !== "raw" ? cornersPx(taken.frame) : null,
        rememberedShape: rememberedShape() ?? shape.current, colour: hex(penColour),
      })
      if ("trouble" in result) { setTrouble(result.trouble); setRead(null); return }
      // Only a page that was actually found sets the notebook's shape.
      if (result.pageFound && result.learnedShape !== null) {
        shape.current = result.learnedShape
        rememberShape(result.learnedShape)
      }
      const where = placement({ frame: result.frameOnPage, pageSize: result.pageSize, pane, nudge: nudge.current })
      nudge.current = (nudge.current + 0.02) % 0.1
      const aspect = result.frameOnPage.height / Math.max(1, result.frameOnPage.width)

      // A FLOW CHART on the page comes in as real nodes and arrows, in a band
      // just under the picture (the Mac's rule), and only when the reader is
      // sure it is one — a page of prose gives nothing. The nodes are labelled
      // with the words the machine's text reader finds inside them (only a
      // picture that holds a chart is ever sent to it, and without a reader a
      // node's label is typed on it by double-click).
      if (mode !== "raw") setRead("Reading...")
      const chart = mode === "raw" ? [] : await chartFromLabelled(
        result.cut, { width: result.cut.width, height: result.cut.height }, pane, penColour, penWidth,
        bandUnder(where.center, where.width, aspect, pane), (canvas) => wordsForChart(canvas))

      // The reading took a moment and the person may have opened another note meanwhile: this capture is of the
      // note it was taken in, so it is not put in the one that is open now.
      if (noteRef.current !== startedIn) { setTrouble(SWITCHED); setRead(null); return }
      setTrouble(null)
      const how = mode === "raw" ? null
        : result.how === "hand" ? "The corners you set squared the page up."
        : result.how ? "Found the page and squared it up."
        : "No page found, so it took the whole picture."
      setRead([how, chartSummary(chart)].filter(Boolean).join(" ") || null)
      setBox(null)
      onCapture({
        blob: result.blob, center: where.center, width: where.width, aspect,
        ...(chart.length > 0 ? { chart } : {}),
      })
    } catch (error) {
      console.warn("WriteMind: the capture failed:", error)
      setTrouble("That could not be taken - try again, or drag the corners tighter onto the page."); setRead(null)
    } finally {
      setBusy(false)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- reads the current frame, box and corners
  }, [box, busy, onCapture, pane, penColour, penWidth, quad, rotation, straighten, size, zoom])

  /** The box read into the note as words. */
  const takeText = useCallback(async () => {
    if (busy) return
    const startedIn = noteRef.current
    const taken = snapshot()
    if (!taken) { setTrouble("There is no camera picture to read."); return }
    const { region, offPicture } = regionOfBox()
    if (offPicture) { setTrouble("That box is not on the picture."); return }
    setBusy(true)
    try {
      const result = await takePicture({
        mode: "page", picture: taken.picture, frame: taken.frame, region,
        corners: straighten ? cornersPx(taken.frame) : null, rememberedShape: rememberedShape() ?? shape.current, colour: hex(penColour),
      })
      if ("trouble" in result) { setTrouble(result.trouble); return }
      setRead("Reading...")
      const lines = await readCanvasLines(result.cut)
      if (noteRef.current !== startedIn) { setTrouble(SWITCHED); setRead(null); return }
      if (lines === null || lines.length === 0) { setTrouble("No text could be read in that box."); setRead(null); return }
      setTrouble(null)
      setRead(lines.length === 1 ? "Read 1 line into the note." : `Read ${lines.length} lines into the note.`)
      setBox(null)
      onReadText?.(lines)
    } catch (error) {
      console.warn("WriteMind: reading the box failed:", error)
      setTrouble("That could not be read - try again."); setRead(null)
    } finally {
      setBusy(false)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- reads the current frame, box and corners
  }, [box, busy, onReadText, penColour, quad, rotation, straighten, size, zoom])

  /**
   * Take what is on the tablet's sheet (tabletCapture.ts): WRITING brings
   * the strokes themselves, PAGE the sheet as a picture.
   */
  const takeTablet = useCallback(async (mode: "ink" | "page") => {
    const startedIn = noteRef.current
    const takenFrom = sheets.current
    const out = await takeFromSheet(mode, {
      box: sheetBox, shown: surface.current?.size() ?? { width: 0, height: 0 }, pane,
      penColour, penWidth, paper: currentPaper(),
    })
    if ("trouble" in out) { setTrouble(out.trouble); return }
    if (noteRef.current !== startedIn) {
      // The sheet was already cleared for it: one Undo on the sheet brings the writing back.
      setTrouble(SWITCHED); surface.current?.repaint(); edited((was) => was + 1); return
    }
    setTrouble(null)
    setRead(out.read)
    // Writing leaves the sheet once it is in the note (one Undo on the sheet brings it back); the box goes either way, as on the Mac.
    if (out.cleared) surface.current?.repaint()
    boxOn(takenFrom, null)
    edited((was) => was + 1)
    onCapture(out.capture)
  }, [sheetBox, sheets.current, boxOn, onCapture, pane, penColour, penWidth])

  /**
   * The box's row (BoxActions.tsx). ERASE rubs out what is inside the box (one Undo on the sheet; the box stays).
   * BRING IN AS DRAWING CELL takes the boxed writing as Writing does and docks it as a NEW drawing cell at the input
   * cursor (App.tsx `dockSheetCell`: the armed bar, else after the caret's cell; one Undo in the note), then takes it
   * off the sheet as Writing does; nothing leaves the sheet when the note would not take the cell.
   */
  const eraseBox = useCallback(() => {
    const out = eraseFromSheet(sheetBox, surface.current?.size() ?? { width: 0, height: 0 })
    if ("trouble" in out) { setTrouble(out.trouble); return }
    setTrouble(null)
    surface.current?.repaint()
    edited((was) => was + 1)
  }, [sheetBox])
  const boxToCell = useCallback(async () => {
    const takenFrom = sheets.current
    const out = await takeFromSheet("cell", {
      box: sheetBox, shown: surface.current?.size() ?? { width: 0, height: 0 }, pane,
      penColour, penWidth, paper: currentPaper(),
    })
    if ("trouble" in out) { setTrouble(out.trouble); return }
    if (!onDockCell?.(out.capture)) { setTrouble("the note could not take a drawing cell here"); return }
    out.clear?.()
    setTrouble(null)
    setRead(null)
    surface.current?.repaint()
    boxOn(takenFrom, null)
    edited((was) => was + 1)
  }, [sheetBox, sheets.current, boxOn, onDockCell, pane, penColour, penWidth])

  // Pen ▸ Next / Previous Sheet (Ctrl+Alt+PageDown / PageUp): the hand without the pen changes sheet while the sheet shows.
  useEffect(() => {
    if (!tablet) return
    return registerPenHandlers({ nextSheet: () => { stepSheet(1) }, prevSheet: () => { stepSheet(-1) } })
  }, [tablet])

  // THE PEN FEED: while the Tablet sheet shows, the whole tablet is this sheet (main/pen/*, renderer/penFeed.ts). Nothing to see.
  usePenFeed(tablet)

  const corner = (name: CornerName) => toScreen({
    x: shown.x + quad[name].x * shown.width, y: shown.y + quad[name].y * shown.height,
  })

  // MARK: gestures on the picture

  const pictureDown = (event: React.PointerEvent) => {
    if (tablet || event.button !== 0 || !running) return
    const point = at(event)
    drag.current = { ...point, id: event.pointerId }
    setDragging(true)
    try { host.current?.setPointerCapture(event.pointerId) } catch { /* the pointer is gone */ }
    if (zooming) setBox({ x: point.x, y: point.y, width: 0, height: 0 })
  }
  const pictureMove = (event: React.PointerEvent) => {
    const start = drag.current
    if (tablet || !start || start.id !== event.pointerId) return
    const point = at(event)
    if (!zooming && !isBoxDrag(point.x - start.x, point.y - start.y)) return
    setBox({
      x: Math.min(start.x, point.x), y: Math.min(start.y, point.y),
      width: Math.abs(point.x - start.x), height: Math.abs(point.y - start.y),
    })
  }
  const pictureUp = (event: React.PointerEvent) => {
    const start = drag.current
    if (tablet || !start || start.id !== event.pointerId) return
    drag.current = null
    setDragging(false)
    try { host.current?.releasePointerCapture(event.pointerId) } catch { /* already released */ }
    const point = at(event)
    if (zooming) {
      // The box dragged is the part of the picture the pane then shows.
      const dragged = { x: Math.min(start.x, point.x), y: Math.min(start.y, point.y), width: Math.abs(point.x - start.x), height: Math.abs(point.y - start.y) }
      setBox(null)
      setZooming(false)
      if (dragged.width > 8 && dragged.height > 8) {
        const composed = composeZoom(dragged, zoom, size)
        if (composed) { setZoom(composed); rememberZoom(composed) }
      }
      return
    }
    // A drag leaves its box alone; one click clears a box, or with no box takes the whole picture; two fill the
    // window with the picture, and two more put it back (`boxAction`, Mac commit 0edfc08).
    let clicks = 1
    const before = lastClick.current
    if (before && event.timeStamp - before.time < 450 && Math.hypot(point.x - before.x, point.y - before.y) < 8) clicks = 2
    lastClick.current = isBoxDrag(point.x - start.x, point.y - start.y) || clicks === 2
      ? null : { time: event.timeStamp, x: point.x, y: point.y }
    const action = boxAction(point.x - start.x, point.y - start.y, clicks, box !== null)
    if (action === "clear") setBox(null)
    else if (action === "whole") setBox(wholePictureBox())
    else if (action === "fullWindow") {
      // The first click of the double already did its half (took the whole picture, or cleared a box); the box it
      // left is measured against the pane as it was, so it goes with the change of size. (The Mac keeps it.)
      setBox(null)
      onFullWindow?.()
    }
  }

  // The header (it wraps to two rows in a narrow pane) must never sit on the tablet sheet: the whole tablet maps onto the sheet, so a pen tap
  // anywhere on it has to reach the sheet and nothing else. The sheet host starts below the header (--camera-top, tablet.css).
  useLayoutEffect(() => {
    const element = host.current, header = top.current
    if (!element || !header) return
    const measure = (): void => { element.style.setProperty("--camera-top", `${Math.ceil(header.offsetTop + header.offsetHeight + 4)}px`) }
    measure()
    if (typeof ResizeObserver === "undefined") return
    const observer = new ResizeObserver(measure)
    observer.observe(header)
    return () => observer.disconnect()
  }, [tablet])

  // The one red line says it once: it goes by itself, and at the next thing the person does (a stroke, a box, a capture).
  useEffect(() => {
    if (!trouble) return
    const timer = window.setTimeout(() => setTrouble(null), 6000)
    return () => window.clearTimeout(timer)
  }, [trouble])
  useEffect(() => { setTrouble(null) }, [box])
  // What the camera said about its last capture is not about the tablet's sheet (or the other way round).
  useEffect(() => { setRead(null); setTrouble(null) }, [tablet])

  // MARK: what the pane says when there is no picture

  const problem = stream.problem ?? (off ? idleProblem() : null)
  const showPlaceholder = !tablet && (off || stream.status === "failed")
  const starting = !tablet && !off && stream.status === "starting"

  const choose = (id: string) => { onPickSource?.(id); setAttempt((was) => was + 1) }

  const shaped = !tablet && aspect !== "free"
  const videoBox = turned ? { width: size.height, height: size.width } : { width: size.width, height: size.height }
  /** The held still in the video's place: fitted in the video's box the way the video fits its frame, turned the same. */
  const stillStyle = ((): React.CSSProperties => {
    const raw = frozen.heldSize()
    if (!raw) return { display: "none" }
    const scale = Math.min(videoBox.width / raw.width, videoBox.height / raw.height)
    return { width: raw.width * scale, height: raw.height * scale, transform: `translate(-50%, -50%) rotate(${rotation}deg)` }
  })()
  return (
    <div className={`camera${zooming ? " zooming" : ""}${shaped ? " shaped" : ""}${fullWindow ? " full-window" : ""}`} ref={host}
         data-aspect={tablet ? undefined : aspect}
         // The camera's pane takes the keyboard when its picture is clicked, so Esc there lets go of a held picture.
         tabIndex={tablet ? undefined : -1}
         onPointerDown={pictureDown} onPointerMove={pictureMove} onPointerUp={pictureUp}
         onPointerCancel={() => { drag.current = null; setDragging(false) }}>
      {tablet
        ? (
          <TabletSurface ref={surface} page={sheet} colour={penColour} width={penWidth} frame={binding.frame}
                         box={sheetBox} onBox={(next) => { setSheetBox(next); setTrouble(null) }}
                         onEdited={() => { edited((was) => was + 1); setTrouble(null) }}
                         buttons={{
                           erase: eraseBox,
                           bring: () => takeTablet("ink"),
                           cell: boxToCell,
                           // As the header's Bring in: off on a drawing cell's own tab; and with no note to bring into.
                           bringOff: binding.bound ? "This sheet is a drawing cell of the note already"
                             : note === null ? "Open a note to bring the writing into" : null,
                         }} />
        )
        : (
          // THE VIEWFINDER: the pane, or the shape asked for centred in it. The picture, the box and the corners are
          // all laid out in it and measured against it.
          <div className="viewfinder" style={{ left: finder.x, top: finder.y, width: size.width, height: size.height }}>
          {/* The video element is always here (so the stream can be let go of cleanly); it is only SEEN once it is running. */}
          <div className="stage" style={{ visibility: running ? "visible" : "hidden" }}>
            <div className="zoomer" style={stageStyle}>
              <video ref={video} muted playsInline data-turn={rotation}
                     style={{ ...videoBox, transform: `translate(-50%, -50%) rotate(${rotation}deg)`, visibility: held ? "hidden" : undefined }} />
              {/* Hold image: the still stands in for the video, which plays on under it. */}
              <canvas ref={frozen.still} className="still" data-held={held ? "1" : "0"} aria-hidden style={stillStyle} />
            </div>
          </div>
      {box && running && (
        <div className="box-clip">
          <div className={`box${zooming ? " zoom" : ""}`} style={{
            left: box.x, top: box.y, width: box.width, height: box.height,
          }} />
        </div>
      )}
      {box && running && !zooming && !dragging && box.width > 8 && box.height > 8 && (
        <div className="box-choices" data-busy={busy ? "1" : "0"}
             style={{
               left: Math.min(Math.max(box.x + box.width / 2, 150), Math.max(size.width - 150, 150)),
               top: Math.min(box.y + box.height + 22, Math.max(size.height - 18, 18)),
             }}
             onPointerDown={(event) => event.stopPropagation()} onPointerUp={(event) => event.stopPropagation()}>
          <button disabled={busy} data-section="image" title="Put the picture inside the box on the page, squared up"
                  onClick={() => { void take("page") }}>Image</button>
          <button disabled={busy} data-section="writing" title="Lift the writing inside the box onto the page as ink"
                  onClick={() => { void take("ink") }}>Writing</button>
          {reader && onReadText && (
            <button disabled={busy} data-section="text" title="Read the writing inside the box into the note as words"
                    onClick={() => { void takeText() }}>Text</button>
          )}
        </div>
      )}
      {straighten && running && (
        <>
          <svg className="quad" width="100%" height="100%">
            <polygon points={CORNER_NAMES.map((name) => `${corner(name).x},${corner(name).y}`).join(" ")} />
          </svg>
          {CORNER_NAMES.map((name) => (
            <div key={name} className="quad-corner" data-corner={name}
                 title="Drag onto a corner of the page"
                 style={{ left: corner(name).x, top: corner(name).y }}
                 onPointerDown={(event) => {
                   event.stopPropagation()
                   event.currentTarget.setPointerCapture(event.pointerId)
                 }}
                 onPointerMove={(event) => {
                   if (!event.currentTarget.hasPointerCapture(event.pointerId)) return
                   event.stopPropagation()
                   const point = fromScreen(at(event))
                   const x = Math.min(Math.max((point.x - shown.x) / shown.width, 0), 1)
                   const y = Math.min(Math.max((point.y - shown.y) / shown.height, 0), 1)
                   setQuad((was) => ({ ...was, [name]: { x, y } }))
                 }}
                 onPointerUp={(event) => {
                   event.stopPropagation()
                   event.currentTarget.releasePointerCapture(event.pointerId)
                 }} />
          ))}
        </>
      )}
          </div>
        )}
      {zooming && running && <div className="zoom-hint">Drag a box - the pane shows that much</div>}
      {fullWindow && (
        // The way out he asked for, drawn ON the picture: the window is the picture, so there is no bar to put it on.
        <button className="full-window-exit" data-camera="leave-full-window" aria-label="Leave Full-Window Video"
                title="Back to the notes - double-clicking the picture does it too"
                onPointerDown={(event) => event.stopPropagation()} onPointerUp={(event) => event.stopPropagation()}
                onClick={() => onFullWindow?.()}>{"✕"}</button>
      )}
      {showPlaceholder && problem && (
        <div className="placeholder" data-problem={problem.kind} onPointerDown={(event) => event.stopPropagation()}>
          <div className="glyph" aria-hidden>{problem.kind === "denied" ? "\u{1F6AB}" : "\u{1F4F9}"}</div>
          <div className="title">{problem.title}</div>
          <div className="detail">{problem.detail}</div>
          <div className="device-list" role="listbox" aria-label="Input Devices">
            {cameras.length === 0 && <div className="none">No cameras found</div>}
            {cameras.map((one) => (
              <button key={one.id} data-camera={one.id} onClick={() => choose(one.id)}>{one.name}</button>
            ))}
            <button data-source="tablet" onClick={() => choose(TABLET_SOURCE)}>Tablet</button>
            <button data-action="refresh" onClick={() => { onRefreshCameras?.(); setAttempt((was) => was + 1) }}>Refresh Device List</button>
          </div>
        </div>
      )}
      {starting && <div className="starting" aria-label="Starting the camera"><span className="spinner" /></div>}
      {trouble && <div className="trouble">{trouble}</div>}
      {/* The corner (turn, zoom, back to the notes) and the bar (take, straighten) share one row, and wrap under each other in a narrow pane. */}
      <div className="camera-top" ref={top}>
      <div className="camera-corner" onPointerDown={(event) => event.stopPropagation()}>
        {!tablet && (
          <>
            <button className="icon-button" data-camera-turn="left" title="Turn the picture a quarter turn anticlockwise"
                    disabled={!running} onClick={() => turn(-90)}
                    style={{ width: "auto", padding: "0 8px", fontSize: 13 }}>{"↶"}</button>
            <button className="icon-button" data-camera-turn="right" title="Turn the picture a quarter turn clockwise"
                    disabled={!running} onClick={() => turn(90)}
                    style={{ width: "auto", padding: "0 8px", fontSize: 13 }}>{"↷"}</button>
            <button className={`icon-button${zooming ? " on" : ""}`} data-camera-zoom="square"
                    title="Resize by Square: drag a box on the picture and the pane shows just that much"
                    disabled={!running} onClick={() => setZooming((was) => !was)}
                    style={{ width: "auto", padding: "0 8px", fontSize: 11 }}>Zoom</button>
            {zoomed && (
              <button className="icon-button" data-camera-zoom="original"
                      title={`Original Size: the whole camera picture again (showing ${Math.round(zoom!.width * zoom!.height * 100)}%)`}
                      onClick={() => { setZoom(null); rememberZoom(null) }}
                      style={{ width: "auto", padding: "0 8px", fontSize: 11 }}>Original size</button>
            )}
            <button className={`icon-button${held ? " on" : ""}`} data-camera="hold" aria-pressed={held}
                    title={held
                      ? "Back to the live picture (Esc does it too)"
                      : "Hold image: keep this picture still - the box, Straighten and every capture use it"}
                    disabled={!running} onClick={() => { if (held) letGo(); else frozen.hold() }}
                    style={{ width: "auto", padding: "0 8px", fontSize: 11 }}>Hold image</button>
          </>
        )}
        {!showEditor && (
          <button className="icon-button" data-pane="notes" title="Back to Side by Side: the notes and the video together again"
                  onClick={() => onToggleEditor?.()}
                  style={{ width: "auto", padding: "0 8px", fontSize: 11 }}>Back to Side by Side</button>
        )}
      </div>
      <div className="camera-bar" onPointerDown={(event) => event.stopPropagation()}>
        {tablet && (
          <>
            <PaperMenu />
            <OrientationSelect compact />
            <button className={`icon-button${pen.eraser ? " on" : ""}`} data-tablet="erase" aria-pressed={pen.eraser}
                    title="Erase on the sheet: rub out whole strokes by touching them (the note's page keeps its own Erase)"
                    onClick={() => setSheetEraser(!pen.eraser)}
                    style={{ width: "auto", padding: "0 8px", fontSize: 11 }}>Erase</button>
            <button className={`icon-button${pen.selectTool ? " on" : ""}`} data-tablet="select" aria-pressed={pen.selectTool}
                    title="Select on the sheet: the pen pulls the dashed box too, as the mouse does"
                    onClick={() => setSheetSelect(!pen.selectTool)}
                    style={{ width: "auto", padding: "0 8px", fontSize: 11 }}>Select</button>
            <button className="icon-button" data-tablet="undo" disabled={binding.bound && !binding.away ? false : !sheet.canUndo}
                    title={binding.bound && binding.away
                      ? "Take back what was written here since its note was put away (it has not reached the drawing cell yet)"
                      : binding.bound
                      ? "Take back the last change in the note (this sheet writes into its drawing cell: its Undo is the note's)"
                      : "Take back the last stroke on the sheet (Ctrl+Z while the pen is over it)"}
                    onClick={() => { if (binding.bound && !binding.away) stepNote("undo"); else surface.current?.undo() }}
                    style={{ width: "auto", padding: "0 8px", fontSize: 11 }}>Undo</button>
            <button className="icon-button" data-tablet="clear" disabled={sheet.strokes.length === 0}
                    title={binding.bound ? "Wipe the drawing cell (one Undo in the note brings it back)" : "Wipe the sheet"}
                    onClick={() => { surface.current?.clear(); setSheetBox(null) }}
                    style={{ width: "auto", padding: "0 8px", fontSize: 11 }}>Clear</button>
            <span className="bring-in" role="group" aria-label="Bring in">
              <span className="label">Bring in</span>
              <button className="icon-button" data-capture="ink" disabled={binding.bound}
                      title={binding.bound ? "This sheet is a drawing cell of the note already" : "Bring the writing in as strokes: the boxed part, or the whole sheet. It leaves the sheet (Undo on the sheet brings it back)."}
                      onClick={() => { void takeTablet("ink") }}
                      style={{ width: "auto", padding: "0 8px", fontSize: 11 }}>Writing</button>
              <button className="icon-button" data-capture="page" disabled={binding.bound}
                      title={binding.bound ? "This sheet is a drawing cell of the note already" : "Bring the sheet in as a picture, paper and all: the boxed part, or the whole sheet (read its words with Aa)"}
                      onClick={() => { void takeTablet("page") }}
                      style={{ width: "auto", padding: "0 8px", fontSize: 11 }}>Page</button>
            </span>
            {penWord && <span className="pen-word" data-tablet="pen-word" title={penWordNote ?? undefined}>{penWord}</span>}
          </>
        )}
        {!tablet && (
          <>
            <button className={`icon-button${straighten ? " on" : ""}`}
                    title="Square the page up: drag the four corners onto the page's corners"
                    onClick={toggleStraighten}
                    style={{ width: "auto", padding: "0 8px", fontSize: 11 }}>Straighten</button>
            {straighten && (
              <button className="icon-button" data-camera="find-page" disabled={!running}
                      title="Look for the page again and put the four corners on it"
                      onClick={findNow}
                      style={{ width: "auto", padding: "0 8px", fontSize: 11 }}>Find page</button>
            )}
          </>
        )}
        {!tablet && (
          <>
            <button className="icon-button" data-capture="ink" disabled={!running || busy}
                    title="Take the writing off the page"
                    onClick={() => { void take("ink") }}
                    style={{ width: "auto", padding: "0 8px", fontSize: 11 }}>Writing</button>
            <button className="icon-button" data-capture="page" disabled={!running || busy}
                    title="Take the page as a photograph"
                    onClick={() => { void take("page") }}
                    style={{ width: "auto", padding: "0 8px", fontSize: 11 }}>Page</button>
          </>
        )}
        {!tablet && (
          <button className="icon-button" data-capture="raw" disabled={!running || busy}
                  title="Take the raw picture, exactly as the camera sees it: no page found, nothing squared"
                  onClick={() => { void take("raw") }}
                  style={{ width: "auto", padding: "0 8px", fontSize: 11 }}>Raw</button>
        )}
        <button className="icon-button" title="Put the camera away" onClick={onHide}>{"✕"}</button>
      </div>
      {/* The tabs: one slim row, the header's last, so the sheet (below --camera-top) is never under it. */}
      <SheetStrip mode={tablet ? "tablet" : "camera"} />
      </div>
      <div className="note">
        {running && (stream.label || held) && (
          <span className="camera-name" title={held ? "The picture is held still (Hold image)" : "The camera in use"}>
            {held && <span className="held-word" data-camera="held">Held</span>}{stream.label}
          </span>
        )}
        {/*
          THE ONE PLACE A MISSING CAPABILITY IS MENTIONED, because this one
          changes what the user does. Everything else the platform cannot
          do is simply not offered.
        */}
        {tablet
          ? (binding.bound
            ? (binding.away
              ? `The drawing cell of “${binding.title}”: that note is not open, so what you write here goes into the cell when it is.`
              : `The drawing cell of “${binding.title}”: what you write here is written into the note (Undo is the note's).`)
              + (pen.eraser ? " Erasing: touch a stroke." : "")
            : (binding.notice ? `${binding.notice} ` : "")
              + (pen.eraser ? "Erasing: touch a stroke." : pen.selectTool ? "Selecting: the pen or the mouse boxes a part, then Bring in." : "The pen writes. Drag the mouse to box a part, then Bring in."))
          : straighten
            ? "Drag the four corners onto the page's corners, then take it."
            : platform && !platform.findsThePage
              ? "Drag a box over the writing, then take it."
              : "Point it at a page: it finds the page itself. Drag a box to take just a part."}
        {tablet || shown.width > 0 || showPlaceholder || starting ? "" : " No picture yet."}
        {read ? ` ${read}` : ""}
      </div>
    </div>
  )
}
