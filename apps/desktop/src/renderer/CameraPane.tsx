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
 * THE LAYOUT (docs/PLAN-bars-2026-10.md P4, the wireframes in docs/ui-2026-10/): a 36px header (CameraHeader.tsx), the
 * strip of tabs (SheetStrip.tsx), the picture or sheet in what is left, and ONE footer line. They are stacked, not
 * laid over each other, so the sheet is letterboxed in what is left under a header that never moves, and nothing the
 * header does can land on the sheet (the pen's tablet maps onto the sheet alone). The source is not chosen here: the
 * video menu in the tab row (and Input Devices) does that; this pane only asks, when it has none.
 *
 * WHAT THE PANE SAYS has three places (cameraStatus.ts): the footer's one standing line and its fact (the picture's
 * size, "mouse: box a part"), and a toast under the header's right edge for what an action just did or why it could
 * not. The result of a capture is never part of the standing line.
 *
 * THE TABLET IS A SECOND SOURCE for this same pane (picked beside the cameras
 * in Input Devices): a sheet to write on with the pen instead of a page under
 * a document camera. The box, the Writing and Image buttons, the page shape,
 * the placement, the flow-chart reader and the one-step undo are all this
 * file's, shared; only where the picture comes from differs (`takeTablet`).
 *
 * SCANNED PAGES ARE TABS (scanTabs.ts, scanSet.ts; the strip is SheetStrip.tsx): "+" keeps the camera's picture (the held
 * one with Hold image) as a page of its own, with its box, corners, learned page shape and what was read off it, and
 * opens it. A stored page stands in the video's place (`page-still`) and EVERYTHING below works on it as on the held
 * frame: the box, Straighten, Zoom, the quarter turns (each page has its own), Image / Writing / Text and the header's
 * Writing / Image / Raw. What the person did to a page (box, corners, turn) is the page's and is kept with it; the
 * camera tab keeps its own. Only Hold image is the camera's.
 *
 * THE STREAM is `useCameraStream`: opened when the pane is on screen, every
 * track stopped when it is put away, the source changes or the camera is
 * unplugged. The pane draws the Mac's four stand-ins when there is no picture
 * (no camera selected, access off, unavailable, starting).
 */

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react"
import {
  boxAction, composeZoom, displayedFrame, fitAspect, isBoxDrag, placement, regionOf, resolveShape, unzoomedPoint, unzoomedRect,
  zoomedPoint, zoomedRect, zoomOffset, zoomScale, type Rect, type Size,
} from "@writemind/core"
import { bandUnder, chartFromLabelled, chartSummary, measuredPage, type Corners } from "./capturePipeline"
import { detectPage, takePicture, uprightPicture, uprightSize } from "./cameraTake"
import {
  normalRotation, rememberBringTo, rememberCaptureMode, rememberedBringTo, rememberedCaptureMode, rememberedRotation,
  rememberedShape, rememberedZoom, rememberRotation, rememberShape, rememberZoom, useCameraAspect, type BringTo, type CaptureMode, type Rotation, type ZoomBox,
} from "./cameraSettings"
import { idleProblem } from "./cameraDevices"
import { Icon } from "./icons"
import { CameraHeader, TabletHeader } from "./CameraHeader"
import { headerFit } from "./cameraHeaderFit"
import {
  busyToast, cameraLine, capturedToast, deviceName, doneToast, errorToast, infoToast, pictureFact, SHEET_FACT, sheetLine, toastMs, type Toast,
} from "./cameraStatus"
import { useCameraStream, useHeldFrame } from "./useCameraStream"
import { ocrAvailable, readCanvasLines, wordsForChart } from "./ocrClient"
import { CAMERA_OFF, shown as shownKey, TABLET_SOURCE } from "../shared/commands"
import { usePenSettings, useSheetTools } from "./penSettings"
import { TabletSurface, type SurfaceHandle } from "./TabletSurface"
import { eraseFromSheet, takeFromSheet, type Capture } from "./tabletCapture"
import { currentSheet, stepSheet, useSheetTabs } from "./tabletSheets"
import { SheetStrip } from "./SheetStrip"
import { boxOnPane, MAX_PAGES, readKey } from "./scanSet"
import { changeScan, keepPage, pageBytes, useScans } from "./scanTabs"
import { stepNote, useCellSheet } from "./cellSheets"
import { registerPenHandlers } from "./penActions"
import { paper as currentPaper } from "./tabletPaper"
import { usePenWord, usePenWordNote } from "./penWord"
import { usePenFeed } from "./usePenFeed"
import type { Platform } from "./wm"
import "./camera.css"

export type { Capture }


interface Props {
  platform: Platform | null
  /** The OS the keys are shown for ("darwin", "win32", ...): the status line names the Erase Tool's key the way this machine writes it. */
  kind?: string
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
  /**
   * The tablet box's "Copy Cell": the same capture, put on the system clipboard as a drawing cell and left out of the note
   * (App.tsx `copySheetCell`). Needs no note. False when it could not be copied.
   */
  onCopyCell?(capture: Capture): boolean
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
  /** Its title, for "✓ Writing added to Demo note". */
  noteTitle?: string | null
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

const DEFAULT_QUAD: Quad01 = inset(0.08)

const SWITCHED = "You opened another note while that was being read, so it was not added - take it again."

const hex = (colour: string): string => (/^#[0-9a-f]{6}$/i.test(colour) ? colour : "#2D7DD2")

/** What the Input Devices menu and the video menu can ask of the pane (`wm:camera-action`). */
export type CameraAction = "turn-left" | "turn-right" | "original-size" | "resize-by-square"

export function CameraPane({
  platform, kind = "", penColour, penWidth = 2, pane, onCapture, onDockCell, onCopyCell, onHide, preferred,
  cameras = [], onPickSource, onRefreshCameras, onActiveCamera, showEditor = true, onToggleEditor, onReadText, note = null,
  noteTitle = null, fullWindow = false, onFullWindow,
}: Props) {
  /** The open note NOW (a capture remembers the one it was taken in). */
  const noteRef = useRef<string | null>(note)
  noteRef.current = note
  /** What a toast calls the open note: its title, else its file's name. */
  const noteName = noteTitle ?? (note ? (note.split(/[\\/]/).pop() ?? note).replace(/\.[^.]+$/, "") : null)
  const noteNameRef = useRef<string | null>(noteName)
  noteNameRef.current = noteName
  const video = useRef<HTMLVideoElement | null>(null)
  /** The area under the header and the strip, over the footer: the picture or the sheet, and everything laid on it. */
  const host = useRef<HTMLDivElement | null>(null)
  /** The whole pane: it takes the keyboard when the picture (or anything in it) is clicked, so Esc there lets go of a held picture. */
  const root = useRef<HTMLDivElement | null>(null)
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
  // The sheet's own Erase / Select (never the notebook toolbar's: penSettings.ts). Select is a header toggle; Erase has
  // no button (Sean, 2026-10-05): the pen's button held rubs out, the box row has Erase, and the pen's Erase Tool
  // toggle (Ctrl+Alt+2, the menu, a double tap set to it) still turns the sheet's eraser on, so the hint says so.
  const pen = useSheetTools()
  const buttons = usePenSettings().buttons
  const rubButton = buttons.upper.hold === "erase" ? "first" : buttons.lower.hold === "erase" ? "second" : null
  const penWord = usePenWord()
  const penWordNote = usePenWordNote()
  const [, edited] = useState(0)
  /** Why the last thing could not be done, said once (a toast); and what the last one did (also a toast). */
  const [trouble, setTrouble] = useState<string | null>(null)
  const [read, setRead] = useState<Toast | null>(null)
  /** Whether the last look for a page in this picture found one: null until it looked (the footer's "Page found"). */
  const [found, setFound] = useState<boolean | null>(null)
  /** The lifted one of the header's Writing | Image | Raw: what was taken last (cameraSettings.ts). */
  const [mode, setMode] = useState<CaptureMode>(rememberedCaptureMode)
  /** Where the header's Writing puts the writing (BringInMenu.tsx): the note's page, or a new docked drawing cell. */
  const [bringTo, setBringTo] = useState<BringTo>(rememberedBringTo)
  /** The box dragged on the live picture, in the pane's own points as the person sees it (a page's box is kept with it). */
  const [liveBox, setLiveBox] = useState<Rect | null>(null)
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
  const [liveStraighten, setLiveStraighten] = useState(false)
  const [liveQuad, setLiveQuad] = useState<Quad01>(DEFAULT_QUAD)
  const [, redraw] = useState(0)
  /** The page's shape, learned from the first page that was found and kept (across launches). */
  const shape = useRef<number | null>(rememberedShape())
  /** So two captures in a row do not land exactly on top of each other. */
  const nudge = useRef(0)
  const [busy, setBusy] = useState(false)
  const [liveRotation, setLiveRotation] = useState<Rotation>(rememberedRotation)
  /** THE SCANNED PAGES (scanTabs.ts): the open one, when a page and not the camera is open. */
  const kept = useScans()
  const page = !tablet ? (kept.pages.find((one) => one.id === kept.current) ?? null) : null
  /** The page whose picture is on the page canvas (decoded from its file), and the one whose file could not be read. */
  const [shownPage, setShownPage] = useState<string | null>(null)
  const [lostPage, setLostPage] = useState<string | null>(null)
  const pageCanvas = useRef<HTMLCanvasElement | null>(null)
  /** `shownPage`, for callbacks made in an earlier render (a capture is memoised; the picture arrives later). */
  const shownRef = useRef<string | null>(null)
  shownRef.current = shownPage
  /** What the setters below read, so they stay the same functions render after render (callbacks made earlier use them). */
  const latest = useRef<{ page: typeof page; size: Size; frame: Size; zoom: ZoomBox | null; zooming: boolean }>({
    page: null, size: { width: 0, height: 0 }, frame: { width: 0, height: 0 }, zoom: null, zooming: false,
  })
  const rotation: Rotation = page ? page.rotation : liveRotation
  const straighten = page ? page.straighten : liveStraighten
  const quad: Quad01 = page ? (page.quad ?? DEFAULT_QUAD) : liveQuad
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
  const rawSize = (): Size => page
    ? { width: page.width, height: page.height }
    : frozen.heldSize() ?? { width: video.current?.videoWidth ?? 0, height: video.current?.videoHeight ?? 0 }
  const frameSize = (): Size => uprightSize(rawSize(), rotation)
  const paneSize = (): Size => size
  const frame = frameSize()
  const shown = displayedFrame(frame, size)
  const running = !tablet && stream.status === "running" && shown.width > 0
  /** There is a picture to work on: the camera's, or the open page's once it is decoded. */
  const pictured = page ? shownPage === page.id : running
  /** Hold image is the camera's: while a page is open the pane is not holding anything. */
  const holding = held && !page
  latest.current = { page, size, frame, zoom, zooming }

  // The open page's picture is read from its file and drawn on the page canvas (at the camera's own size, not turned).
  useEffect(() => {
    setShownPage(null)
    setLostPage(null)
    const id = page?.id
    const canvas = pageCanvas.current
    if (!id) { if (canvas && canvas.width > 0) { canvas.width = 0; canvas.height = 0 } return }
    let cancelled = false
    void (async () => {
      const bytes = await pageBytes(id)
      if (cancelled) return
      if (!bytes) { setLostPage(id); return }
      try {
        const bitmap = await createImageBitmap(new Blob([bytes as BlobPart], { type: "image/jpeg" }))
        const target = pageCanvas.current
        if (cancelled || !target) { bitmap.close(); return }
        target.width = bitmap.width
        target.height = bitmap.height
        target.getContext("2d")?.drawImage(bitmap, 0, 0)
        bitmap.close()
        setShownPage(id)
      } catch {
        if (!cancelled) setLostPage(id)
      }
    })()
    return () => { cancelled = true }
  }, [page?.id])

  // What the person does to the open tab's picture goes to the tab: the camera's own state, or the page, kept with it.
  const setBox = useCallback((next: Rect | null) => {
    const now = latest.current
    // A page's box is kept as fractions of its upright picture; the zoom's own box (armed) is only ever drawn.
    if (!now.page || now.zooming) { setLiveBox(next); return }
    const drawn = next && now.zoom ? unzoomedRect(next, now.zoom, now.size) : next
    changeScan(now.page.id, { box: drawn ? regionOf(drawn, now.frame, now.size) : null })
  }, [])
  const setStraighten = useCallback((next: boolean) => {
    const now = latest.current.page
    if (now) changeScan(now.id, { straighten: next }); else setLiveStraighten(next)
  }, [])
  const setQuad = useCallback((next: Quad01 | ((was: Quad01) => Quad01)) => {
    const now = latest.current.page
    if (!now) { setLiveQuad(next); return }
    const was = now.quad ?? DEFAULT_QUAD
    changeScan(now.id, { quad: typeof next === "function" ? next(was) : next })
  }, [])
  /** The box on screen: the camera's as dragged (or the zoom's, while it is armed), a page's as it was kept. */
  // (Memoised: a new object every render would count as a new box to everything that watches it.)
  const keptBox = useMemo(
    () => (page?.box ? boxOnPane(page.box, { width: frame.width, height: frame.height }, size, zoom) : null),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- the frame's and the pane's sizes, by value
    [page?.box, frame.width, frame.height, size.width, size.height, zoom],
  )
  const box: Rect | null = page && !zooming ? keptBox : liveBox

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
    const now = latest.current.page
    // A box drawn on the picture is not on it any more.
    if (now) { changeScan(now.id, { rotation: normalRotation(now.rotation + by), box: null }); return }
    setLiveRotation((was) => {
      const next = normalRotation(was + by)
      rememberRotation(next)
      return next
    })
    setBox(null)
  }, [setBox])

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

  useEffect(() => { if (stream.status !== "running" && !latest.current.page) { setLiveBox(null); setZooming(false) } }, [stream.status])
  // A box drawn in a viewfinder of another shape is somewhere else in this one (a page's box is kept as fractions: it is not).
  useEffect(() => { setLiveBox(null) }, [aspect])
  // Escape lets go of a zoom that was armed (and of a box that was drawn). Then, with the pane focused (a click on the
  // picture or on one of its buttons), it lets go of a held picture: one thing per press, the box first.
  const letGo = frozen.letGo
  useEffect(() => {
    if (!zooming && !box && !holding) return
    const key = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return
      if (zooming || box) { setZooming(false); setBox(null); return }
      if (event.defaultPrevented || !root.current?.contains(document.activeElement)) return
      event.preventDefault()
      letGo()
    }
    window.addEventListener("keydown", key)
    return () => window.removeEventListener("keydown", key)
  }, [zooming, box, holding, letGo, setBox])

  // MARK: the frame, upright, as one snapshot

  /** The picture being worked on: the open page's (once decoded), else the held still, else the video's current frame. */
  const pictureNow = (): { image: CanvasImageSource; size: Size } | null => {
    const open = latest.current.page
    if (!open) return frozen.picture()
    const canvas = pageCanvas.current
    return canvas && canvas.width > 0 && shownRef.current === open.id ? { image: canvas, size: { width: canvas.width, height: canvas.height } } : null
  }

  /**
   * The frame on screen right now (the page's, or the held still while one is held), turned upright, as a canvas of its
   * own (one frame for the whole capture).
   */
  const snapshot = (): { picture: HTMLCanvasElement; frame: Size } | null => {
    const source = pictureNow()
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
      setFound(false)
      setRead(infoToast("No page found: drag the corners onto the page's corners"))
      return
    }
    const f = taken.frame
    const to = (p: { x: number; y: number }) => ({ x: p.x / f.width, y: p.y / f.height })
    setQuad({
      topLeft: to(found.corners.topLeft), topRight: to(found.corners.topRight),
      bottomRight: to(found.corners.bottomRight), bottomLeft: to(found.corners.bottomLeft),
    })
    setFound(true)
    setRead(doneToast("Found the page: drag a corner if it is off"))
    // eslint-disable-next-line react-hooks/exhaustive-deps -- reads the current frame
  }, [rotation, shownPage, setQuad])

  const toggleStraighten = () => {
    const next = !straighten
    setStraighten(next)
    // A page found on the page when it was kept is where its corners start; the camera looks now.
    if (next && !page?.quad) findNow()
  }
  // The picture turned under the corners: look again (a tab switch is not a turn).
  const turnedFrom = useRef({ tab: page?.id ?? "", rotation })
  useEffect(() => {
    const before = turnedFrom.current
    turnedFrom.current = { tab: page?.id ?? "", rotation }
    if (before.tab !== (page?.id ?? "") || before.rotation === rotation) return
    if (straighten) findNow()
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only a turn asks again
  }, [rotation, page?.id])

  // MARK: the box, and taking what is in it

  /** The box as a fraction of the upright picture (top-left origin), clipped to it; null without a box. */
  const regionOfBox = (): { region: Rect | null; offPicture: boolean } => {
    // A page's box is kept as exactly this.
    const open = latest.current.page
    if (open && !latest.current.zooming) return { region: open.box, offPicture: false }
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
    // The one taken is the lifted one in the header (and in the box's row) from now on.
    setMode(mode)
    rememberCaptureMode(mode)
    const startedIn = noteRef.current
    const startedOn = latest.current.page?.id ?? null
    const taken = snapshot()
    if (!taken) { setTrouble("There is no camera picture to take."); return }
    const { region, offPicture } = regionOfBox()
    if (offPicture) { setTrouble("That box is not on the picture."); return }
    setBusy(true)
    try {
      const result = await takePicture({
        mode, picture: taken.picture, frame: taken.frame, region,
        corners: straighten && mode !== "raw" ? cornersPx(taken.frame) : null,
        rememberedShape: latest.current.page?.shape ?? rememberedShape() ?? shape.current, colour: hex(penColour),
      })
      if ("trouble" in result) { setTrouble(result.trouble); setRead(null); return }
      if (mode !== "raw") setFound(result.pageFound)
      // Only a page that was actually found sets the notebook's shape (and a kept page's own).
      if (result.pageFound && result.learnedShape !== null) {
        shape.current = result.learnedShape
        rememberShape(result.learnedShape)
        if (startedOn) changeScan(startedOn, { shape: result.learnedShape })
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
      if (mode !== "raw") setRead(busyToast("Reading"))
      const chart = mode === "raw" ? [] : await chartFromLabelled(
        result.cut, { width: result.cut.width, height: result.cut.height }, pane, penColour, penWidth,
        bandUnder(where.center, where.width, aspect, pane), (canvas) => wordsForChart(canvas))

      // The reading took a moment and the person may have opened another note meanwhile: this capture is of the
      // note it was taken in, so it is not put in the one that is open now.
      if (noteRef.current !== startedIn) { setTrouble(SWITCHED); setRead(null); return }
      setTrouble(null)
      // Said only when it is news: a page found and squared is what is expected.
      const how = mode === "raw" ? null
        : result.how === "hand" ? "squared with your corners"
        : result.how ? null
        : "no page found"
      setRead(capturedToast(mode, noteNameRef.current, [how, chartSummary(chart)]))
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
  }, [box, busy, onCapture, pane, penColour, penWidth, quad, rotation, straighten, size, zoom, setBox])

  /** The box read into the note as words. */
  const takeText = useCallback(async () => {
    if (busy) return
    const startedIn = noteRef.current
    const startedOn = latest.current.page?.id ?? null
    const taken = snapshot()
    if (!taken) { setTrouble("There is no camera picture to read."); return }
    const { region, offPicture } = regionOfBox()
    if (offPicture) { setTrouble("That box is not on the picture."); return }
    // A page that was read through this very box, corners and turn already has the words: they come in again, unread.
    const key = readKey(region, straighten ? quad : null, rotation)
    const before = latest.current.page?.read
    if (before && before.key === key && before.lines.length > 0) {
      setTrouble(null)
      setRead(capturedToast("text", noteNameRef.current, [`${before.lines.length === 1 ? "1 line" : `${before.lines.length} lines`}, read off this page before`]))
      setBox(null)
      onReadText?.(before.lines)
      return
    }
    setBusy(true)
    try {
      const result = await takePicture({
        mode: "page", picture: taken.picture, frame: taken.frame, region,
        corners: straighten ? cornersPx(taken.frame) : null,
        rememberedShape: latest.current.page?.shape ?? rememberedShape() ?? shape.current, colour: hex(penColour),
      })
      if ("trouble" in result) { setTrouble(result.trouble); return }
      setRead(busyToast("Reading"))
      const lines = await readCanvasLines(result.cut)
      if (noteRef.current !== startedIn) { setTrouble(SWITCHED); setRead(null); return }
      if (lines === null || lines.length === 0) { setTrouble("No text could be read in that box."); setRead(null); return }
      // What was read is kept with the page it was read off.
      if (startedOn) changeScan(startedOn, { read: { key, lines } })
      setTrouble(null)
      setRead(capturedToast("text", noteNameRef.current, [lines.length === 1 ? "1 line" : `${lines.length} lines`]))
      setBox(null)
      onReadText?.(lines)
    } catch (error) {
      console.warn("WriteMind: reading the box failed:", error)
      setTrouble("That could not be read - try again."); setRead(null)
    } finally {
      setBusy(false)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- reads the current frame, box and corners
  }, [box, busy, onReadText, penColour, quad, rotation, straighten, size, zoom, setBox])

  /**
   * "+" on the tab row: the camera's picture (the held still with Hold image, else the live frame) kept as a page of
   * its own, and opened. It is kept as the camera gave it, with the turn it is shown with; from the Camera tab the box
   * and the corners go with it (the camera's box is spent, as after a capture), from another tab it is the plain
   * picture. The page it holds is looked for now, so Straighten starts on it and its shape is the learned one.
   */
  const keepNow = useCallback(async () => {
    if (busy) return
    const source = frozen.picture()
    if (!source) { setTrouble("There is no camera picture to keep."); return }
    const onCamera = latest.current.page === null
    setBusy(true)
    try {
      const raw = document.createElement("canvas")
      raw.width = source.size.width
      raw.height = source.size.height
      raw.getContext("2d")?.drawImage(source.image, 0, 0, raw.width, raw.height)
      const blob = await new Promise<Blob | null>((resolve) => raw.toBlob(resolve, "image/jpeg", 0.92))
      if (!blob) { setTrouble("That could not be kept - try again."); return }
      const upright = uprightPicture(raw, source.size, liveRotation)
      const f = { width: upright.width, height: upright.height }
      const found = detectPage(upright, f)
      const fractions = (c: Corners): Quad01 => {
        const to = (p: { x: number; y: number }) => ({ x: p.x / f.width, y: p.y / f.height })
        return { topLeft: to(c.topLeft), topRight: to(c.topRight), bottomRight: to(c.bottomRight), bottomLeft: to(c.bottomLeft) }
      }
      // The page's learned shape: what was measured, snapped to the notebook's shape when it is near it (so a stack of
      // pages of one notebook comes in one size); only a page that was found teaches the notebook its shape.
      const learned = found ? resolveShape(measuredPage(found.corners, f).ratio, rememberedShape() ?? shape.current).ratio : null
      if (learned !== null && rememberedShape() === null) { shape.current = learned; rememberShape(learned) }
      const region = onCamera ? regionOfBox().region : null
      const straight = onCamera && liveStraighten
      const id = await keepPage(new Uint8Array(await blob.arrayBuffer()), {
        width: source.size.width, height: source.size.height, rotation: liveRotation,
        box: region, straighten: straight,
        quad: straight ? liveQuad : found ? fractions(found.corners) : null,
        shape: learned, read: null,
      })
      if (!id) { setTrouble("That page could not be kept - too many pages, or the disk would not take it."); return }
      if (onCamera) setLiveBox(null)
      setTrouble(null)
      setFound(found !== null)
      setRead(found ? doneToast("Kept the page: its corners are on it") : infoToast("Kept the picture: no page was found in it"))
    } catch (error) {
      console.warn("WriteMind: keeping the page failed:", error)
      setTrouble("That could not be kept - try again.")
    } finally {
      setBusy(false)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- reads the current frame, box and corners
  }, [busy, liveRotation, liveStraighten, liveQuad, box, size, zoom])
  /** Why "+" cannot keep a page now, or null. */
  const keepOff = busy ? "Busy: one moment"
    : !running ? "There is no camera picture to keep"
    : kept.pages.length >= MAX_PAGES ? "There are as many pages as can be kept: close one first"
    : null

  /**
   * Take what is on the tablet's sheet (tabletCapture.ts): WRITING brings
   * the strokes themselves, PAGE the sheet as a picture.
   */
  const takeTablet = useCallback(async (mode: "ink" | "page") => {
    const startedIn = noteRef.current
    const takenFrom = sheets.current
    // The sheet keeps the writing, so the next Ctrl+Z is the note's (taking the capture back), not a stroke's.
    surface.current?.leave()
    const out = await takeFromSheet(mode, {
      box: sheetBox, shown: surface.current?.size() ?? { width: 0, height: 0 }, pane,
      penColour, penWidth, paper: currentPaper(),
    })
    if ("trouble" in out) { setTrouble(out.trouble); return }
    if (noteRef.current !== startedIn) {
      // The sheet still has it: take it again from there.
      setTrouble(SWITCHED); return
    }
    setTrouble(null)
    setRead(capturedToast(mode, noteNameRef.current, [out.read]))
    // The sheet keeps what was brought in (tabletCapture.ts); the box goes, as on the Mac.
    boxOn(takenFrom, null)
    edited((was) => was + 1)
    onCapture(out.capture)
  }, [sheetBox, sheets.current, boxOn, onCapture, pane, penColour, penWidth])

  /**
   * The box's row (BoxActions.tsx). ERASE rubs out what is inside the box (one Undo on the sheet; the box stays).
   * BRING IN AS DRAWING CELL takes the boxed writing as Writing does and docks it as a NEW drawing cell at the input
   * cursor (App.tsx `dockSheetCell`: the armed bar, else after the caret's cell; one Undo in the note). The sheet keeps
   * the writing, as Writing does.
   */
  const eraseBox = useCallback(() => {
    const out = eraseFromSheet(sheetBox, surface.current?.size() ?? { width: 0, height: 0 })
    if ("trouble" in out) { setTrouble(out.trouble); return }
    setTrouble(null)
    setRead(doneToast(out.removed === 1 ? "Erased 1 stroke" : `Erased ${out.removed} strokes`))
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
    setTrouble(null)
    setRead(capturedToast("cell", noteNameRef.current))
    boxOn(takenFrom, null)
    edited((was) => was + 1)
  }, [sheetBox, sheets.current, boxOn, onDockCell, pane, penColour, penWidth])

  /** COPY CELL: the boxed writing as a drawing cell on the clipboard, the note and the sheet as they were (the box stays). */
  const boxToClipboard = useCallback(async () => {
    const out = await takeFromSheet("cell", {
      box: sheetBox, shown: surface.current?.size() ?? { width: 0, height: 0 }, pane,
      penColour, penWidth, paper: currentPaper(),
    })
    if ("trouble" in out) { setTrouble(out.trouble); return }
    if (!onCopyCell?.(out.capture)) { setTrouble("the drawing cell could not be copied"); return }
    setTrouble(null)
    setRead(doneToast("Copied as a drawing cell"))
  }, [sheetBox, onCopyCell, pane, penColour, penWidth])

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
    if (tablet || event.button !== 0 || !pictured) return
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

  // A result says itself for a few seconds and goes; an error likewise, and at the next thing the person does (a stroke,
  // a box, a capture). Both are toasts under the header's right edge (cameraStatus.ts), never part of the standing line.
  useEffect(() => {
    if (!trouble) return
    const timer = window.setTimeout(() => setTrouble(null), toastMs("error"))
    return () => window.clearTimeout(timer)
  }, [trouble])
  useEffect(() => {
    if (!read) return
    const timer = window.setTimeout(() => setRead(null), toastMs(read.kind))
    return () => window.clearTimeout(timer)
  }, [read])
  useEffect(() => { setTrouble(null) }, [box])
  // What the camera said about its last capture is not about the tablet's sheet (or the other way round).
  useEffect(() => { setRead(null); setTrouble(null) }, [tablet])
  // "Page found" is about the picture it was looked for in: another page, the live camera again or a turn starts over.
  useEffect(() => { setFound(null) }, [page?.id, tablet, rotation, preferred])

  // MARK: what the pane says when there is no picture

  const problem = stream.problem ?? (off ? idleProblem() : null)
  const showPlaceholder = !tablet && !page && (off || stream.status === "failed")
  const starting = !tablet && !page && !off && stream.status === "starting"

  const choose = (id: string) => { onPickSource?.(id); setAttempt((was) => was + 1) }

  const shaped = !tablet && aspect !== "free"
  const videoBox = turned ? { width: size.height, height: size.width } : { width: size.width, height: size.height }
  /** The held still in the video's place: fitted in the video's box the way the video fits its frame, turned the same. */
  const stillOf = (raw: Size | null): React.CSSProperties => {
    if (!raw) return { display: "none" }
    const scale = Math.min(videoBox.width / raw.width, videoBox.height / raw.height)
    return { width: raw.width * scale, height: raw.height * scale, transform: `translate(-50%, -50%) rotate(${rotation}deg)` }
  }
  const stillStyle = stillOf(page ? null : frozen.heldSize())
  /** An open page stands in the same place, turned with ITS turn. */
  const pageStyle = stillOf(page && shownPage === page.id ? { width: page.width, height: page.height } : null)

  // MARK: the box's corners (the tablet's own four handles): a drag from one resizes the box about the opposite corner

  const resizing = useRef<{ id: number; fixed: { x: number; y: number } } | null>(null)
  const cornerDown = (corner: "nw" | "ne" | "sw" | "se") => (event: React.PointerEvent) => {
    event.stopPropagation()
    if (event.button !== 0 || !box) return
    resizing.current = {
      id: event.pointerId,
      fixed: { x: corner.endsWith("w") ? box.x + box.width : box.x, y: corner.startsWith("n") ? box.y + box.height : box.y },
    }
    setDragging(true)
    try { event.currentTarget.setPointerCapture(event.pointerId) } catch { /* the pointer is gone */ }
  }
  const cornerMove = (event: React.PointerEvent) => {
    const now = resizing.current
    if (!now || now.id !== event.pointerId) return
    event.stopPropagation()
    const point = at(event)
    const x = Math.min(Math.max(point.x, 0), size.width), y = Math.min(Math.max(point.y, 0), size.height)
    setBox({ x: Math.min(now.fixed.x, x), y: Math.min(now.fixed.y, y), width: Math.abs(x - now.fixed.x), height: Math.abs(y - now.fixed.y) })
  }
  const cornerUp = (event: React.PointerEvent) => {
    const now = resizing.current
    if (!now || now.id !== event.pointerId) return
    event.stopPropagation()
    resizing.current = null
    setDragging(false)
    try { event.currentTarget.releasePointerCapture(event.pointerId) } catch { /* already released */ }
  }

  // MARK: the header's state, and the footer's words

  const fit = headerFit({ width: outer.width, zoomed, backToNotes: !showEditor })
  const zoomPercent = zoom ? Math.round(zoomScale(zoom, size) * 100) : 100
  const holdTitle = page ? "A kept page is already still: open the Live tab to hold the live picture"
    : held ? "Back to the live picture (Esc does it too)"
    : "Hold image: keep this picture still - the box, Straighten and every capture use it"
  const bringOff = binding.bound ? "This sheet is a drawing cell of the note already"
    : note === null ? "Open a note to bring the writing into" : null
  const bringTitle = bringTo === "cell"
    ? "Bring the writing in as a new drawing cell at the input cursor: the boxed part, or the whole sheet. The sheet keeps it. Its menu says how."
    : "Bring the writing in as strokes on the note's page: the boxed part, or the whole sheet. The sheet keeps it. Its menu says how."
  const canUndoSheet = binding.bound && !binding.away ? true : sheet.canUndo
  const undoTitle = binding.bound && binding.away
    ? "Take back what was written here since its note was put away (it has not reached the drawing cell yet)"
    : binding.bound
    ? "Take back the last change in the note (this sheet writes into its drawing cell: its Undo is the note's)"
    : `Take back the last stroke on the sheet (${shownKey("undo", kind) || "Ctrl+Z"} while the pen is over it). Its menu clears the sheet.`

  const line = tablet
    ? sheetLine({
      eraser: pen.eraser, select: pen.selectTool, rubButton, eraseKey: shownKey("penErase", kind),
      bound: binding.bound ? { title: binding.title, away: binding.away } : null, notice: binding.bound ? null : binding.notice ?? null,
    })
    : starting ? "Starting the camera…"
    : showPlaceholder ? ""
    : cameraLine({
      page: page?.name ?? null, straighten, holding, pictured, found, findsThePage: !platform || platform.findsThePage,
    })
  const fact = tablet ? SHEET_FACT : pictured ? pictureFact(frame) : ""
  const shownToast: Toast | null = trouble ? errorToast(trouble)
    : page && lostPage === page.id ? errorToast("This page's picture is gone (its file was removed). Close the tab")
    : read

  return (
    <div className={`camera${zooming ? " zooming" : ""}${shaped ? " shaped" : ""}${fullWindow ? " full-window" : ""}${tablet ? " tablet-source" : ""}`}
         data-aspect={tablet ? undefined : aspect} ref={root}
         // The pane takes the keyboard when its picture is clicked, so Esc there lets go of a held picture.
         tabIndex={tablet ? undefined : -1}>
      {tablet
        ? (
          <TabletHeader canUndo={canUndoSheet} undoTitle={undoTitle}
                        onUndo={() => { if (binding.bound && !binding.away) stepNote("undo"); else surface.current?.undo() }}
                        canClear={sheet.strokes.length > 0}
                        onClear={() => { surface.current?.clear(); setSheetBox(null) }}
                        to={bringTo} onBringTo={(next) => { setBringTo(next); rememberBringTo(next) }}
                        bringTitle={bringTitle} bringOff={bringOff}
                        onBring={(to) => { if (to === "cell") { surface.current?.leave(); void boxToCell() } else void takeTablet("ink") }}
                        onBringPage={() => { void takeTablet("page") }}
                        onHide={onHide} showEditor={showEditor} onToggleEditor={onToggleEditor} />
        )
        : (
          <CameraHeader fit={fit} pictured={pictured} busy={busy} turn={turn}
                        zoomed={zoomed} zoomPercent={zoomPercent} zooming={zooming}
                        onZoom={() => setZooming((was) => !was)} onOriginalSize={() => { setZoom(null); rememberZoom(null) }}
                        holding={holding} holdOff={!running || !!page} holdTitle={holdTitle}
                        onHold={() => { if (held) letGo(); else frozen.hold() }}
                        straighten={straighten} onStraighten={toggleStraighten} onFindPage={findNow}
                        mode={mode} onTake={(next) => { void take(next) }}
                        onHide={onHide} showEditor={showEditor} onToggleEditor={onToggleEditor} />
        )}
      {/* The tabs: one slim row under the header, so the sheet (below it) is never under it. */}
      <SheetStrip mode={tablet ? "tablet" : "camera"}
                  scan={{ onAdd: () => { void keepNow() }, addOff: keepOff, live: running && deviceName(stream.label) ? deviceName(stream.label) : null }} />
      {/* WHAT THE PANE SHOWS: the picture (or the sheet) in everything between the strip and the footer, and what is laid on it. */}
      <div className="camera-body" ref={host} data-camera="body"
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
                           copy: boxToClipboard,
                           // As the header's Bring in: off on a drawing cell's own tab; and with no note to bring into.
                           bringOff,
                         }} />
        )
        : (
          // THE VIEWFINDER: the pane, or the shape asked for centred in it. The picture, the box and the corners are
          // all laid out in it and measured against it.
          <div className="viewfinder" style={{ left: finder.x, top: finder.y, width: size.width, height: size.height }}>
          {/* The video element is always here (so the stream can be let go of cleanly); it is only SEEN once it is running. */}
          <div className="stage" style={{ visibility: pictured ? "visible" : "hidden" }}>
            <div className="zoomer" style={stageStyle}>
              <video ref={video} muted playsInline data-turn={liveRotation}
                     style={{ ...videoBox, transform: `translate(-50%, -50%) rotate(${rotation}deg)`, visibility: held || page ? "hidden" : undefined }} />
              {/* Hold image: the still stands in for the video, which plays on under it. */}
              <canvas ref={frozen.still} className="still" data-held={holding ? "1" : "0"} aria-hidden style={stillStyle} />
              {/* A kept page (the tab row): its picture in the same place, under the same box, corners and zoom. */}
              <canvas ref={pageCanvas} className="page-still" data-page={page?.id ?? ""} aria-hidden style={pageStyle} />
            </div>
          </div>
      {/* A held picture is framed and says so (Esc lets it go): the pane would otherwise look live. */}
      {holding && pictured && (
        <>
          <div className="held-frame" aria-hidden />
          <div className="held-badge" data-camera="held"><Icon name="pause" size={12} />Held &middot; Esc</div>
        </>
      )}
      {box && pictured && (
        <div className="box-clip">
          <div className={`box${zooming ? " zoom" : ""}`} data-camera="box" style={{
            left: box.x, top: box.y, width: box.width, height: box.height,
          }}>
            {!zooming && !dragging && (["nw", "ne", "sw", "se"] as const).map((corner) => (
              <span key={corner} className="handle" data-handle={corner}
                    onPointerDown={cornerDown(corner)} onPointerMove={cornerMove} onPointerUp={cornerUp} onPointerCancel={cornerUp} />
            ))}
          </div>
        </div>
      )}
      {box && pictured && !zooming && !dragging && box.width > 8 && box.height > 8 && (
        <div className="box-choices box-actions" data-busy={busy ? "1" : "0"} data-camera="box-actions" role="group" aria-label="The box"
             style={{
               left: Math.min(Math.max(box.x + box.width / 2, 130), Math.max(size.width - 130, 130)),
               top: Math.min(box.y + box.height + 22, Math.max(size.height - 18, 18)),
             }}
             onPointerDown={(event) => event.stopPropagation()} onPointerUp={(event) => event.stopPropagation()}>
          <button disabled={busy} data-section="writing" className={mode !== "page" ? "primary" : undefined}
                  title="Lift the writing inside the box onto the page as ink"
                  onClick={() => { void take("ink") }}>Writing</button>
          <button disabled={busy} data-section="image" className={mode === "page" ? "primary" : undefined}
                  title="Put the picture inside the box on the page, squared up"
                  onClick={() => { void take("page") }}>Image</button>
          {reader && onReadText && (
            <button disabled={busy} data-section="text" title="Read the writing inside the box into the note as words"
                    onClick={() => { void takeText() }}>Text</button>
          )}
          <span className="sep" aria-hidden />
          <button data-box-action="clear" aria-label="Clear the box" title="Clear the box (Esc does it too)"
                  onClick={() => setBox(null)}><Icon name="close" size={11} /></button>
        </div>
      )}
      {straighten && pictured && (
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
      {zooming && pictured && <div className="zoom-hint">Drag a box - the pane shows that much</div>}
      {fullWindow && (
        // The way out he asked for, drawn ON the picture: the window is the picture, so there is no bar to put it on.
        <button className="full-window-exit" data-camera="leave-full-window" aria-label="Leave Full-Window Video"
                title="Back to the notes - double-clicking the picture does it too"
                onPointerDown={(event) => event.stopPropagation()} onPointerUp={(event) => event.stopPropagation()}
                onClick={() => onFullWindow?.()}><Icon name="close" size={12} /></button>
      )}
      {showPlaceholder && problem && (
        // NO SOURCE (or one that would not start): the pane asks what it should show, with a card for each way (the wireframe).
        <div className="placeholder" data-problem={problem.kind} onPointerDown={(event) => event.stopPropagation()}>
          <div className="title">{off ? "What should this pane show?" : problem.title}</div>
          <div className="detail">{off ? "A document camera, the Wacom tablet as a sheet, or nothing." : problem.detail}</div>
          <div className="source-cards" role="listbox" aria-label="Input Devices">
            {cameras.map((one) => (
              <button key={one.id} type="button" className="source-card" data-camera={one.id} onClick={() => choose(one.id)}>
                <Icon name="camera" size={22} /><span className="name">{one.name}</span><span className="sub">point it at a page</span>
              </button>
            ))}
            <button type="button" className="source-card" data-source="tablet" onClick={() => choose(TABLET_SOURCE)}>
              <Icon name="tablet" size={22} /><span className="name">Tablet sheet</span><span className="sub">write with the pen</span>
            </button>
          </div>
          {cameras.length === 0 && <div className="none">No cameras found</div>}
          <div className="source-links">
            <button type="button" data-action="refresh" onClick={() => { onRefreshCameras?.(); setAttempt((was) => was + 1) }}>Refresh devices</button>
            <button type="button" data-action="hide" onClick={onHide}>Hide this pane</button>
          </div>
        </div>
      )}
      {starting && <div className="starting" aria-label="Starting the camera"><span className="spinner" /></div>}
      {shownToast && (
        <div className={`toast ${shownToast.kind}`} data-toast={shownToast.kind} role={shownToast.kind === "error" ? "alert" : "status"}>{shownToast.text}</div>
      )}
      </div>
      {/* The footer: ONE short line about the pane as it is, and one fact. The result of an action is the toast's, not this line's. */}
      <div className="camera-foot" data-camera="status">
        <span className="line" title={[line, penWordNote ?? penWord].filter(Boolean).join(" · ")} data-camera="status-line">{line}</span>
        {fact && <span className="fact" data-camera="status-fact">{fact}</span>}
      </div>
    </div>
  )
}
