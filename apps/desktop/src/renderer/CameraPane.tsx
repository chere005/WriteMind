/**
 * The camera: a viewfinder, a box drawn on it by hand, and two ways to take
 * what is inside the box — the WRITING lifted off the paper, or the page as
 * a photograph.
 *
 * What is Apple's and what is ours, in one place. Finding the page in the
 * frame is Vision's document segmentation on the Mac and does not exist on
 * Windows, so the page's four corners are dragged by hand on both ("Straighten")
 * and the perspective is undone HERE, in `@writemind/core`'s `warpToPage` —
 * the one line under the viewfinder says so, because that absence changes
 * what the user has to do. Everything else — the local-mean threshold that
 * lifts ink off paper, the connected components that drop the printed dot
 * grid, the page shape that keeps two captures the same size, the flow-chart
 * reader that turns a sketched chart into real nodes and arrows — is
 * `@writemind/core` and runs the same on either platform.
 *
 * THE TABLET IS A SECOND SOURCE for this same pane (picked beside the cameras
 * in Input Devices): a sheet to write on with the pen instead of a page under
 * a document camera. The box, the Writing and Page buttons, the page shape,
 * the placement, the flow-chart reader and the one-step undo are all this
 * file's, shared; only where the picture comes from differs (`takeTablet`).
 */

import { useCallback, useEffect, useRef, useState } from "react"
import {
  displayedFrame, EDGE_INSET, inkBox, inkMask, pageBox, placement, quadFromPixels, regionOf,
  resolveShape, shapeSize, type CanvasItem, type Rect, type Size,
} from "@writemind/core"
import { bandUnder, chartFrom, grayOf, measuredPage, straightened, type Corners } from "./capturePipeline"
import { TABLET_SOURCE } from "../shared/commands"
import { setEraser, usePenSettings } from "./penSettings"
import { TabletSurface, type SurfaceHandle } from "./TabletSurface"
import { keepClearAfter, keptClearAfter, sheet, takeFromSheet, type Capture } from "./tabletCapture"
import { TabletAreaHelp } from "./tabletArea"
import type { Platform } from "./wm"

export type { Capture }

interface Props {
  platform: Platform | null
  penColour: string
  penWidth?: number
  /** The notes pane, which is what a capture is measured against. */
  pane: Size
  onCapture(capture: Capture): void
  onHide(): void
  /** Take the whole tablet for the sheet: the full-screen pad. */
  onPad?(): void
  /** The camera picked from the Input Devices menu (or the sidebar's video menu). */
  preferred?: string | null
}

type Mode = "ink" | "page"
type CornerName = keyof Corners
const CORNER_NAMES: CornerName[] = ["topLeft", "topRight", "bottomRight", "bottomLeft"]

/** The page's corners as fractions of the picture shown (top-left origin). */
type Quad01 = Record<CornerName, { x: number; y: number }>
const inset = (by: number): Quad01 => ({
  topLeft: { x: by, y: by }, topRight: { x: 1 - by, y: by },
  bottomRight: { x: 1 - by, y: 1 - by }, bottomLeft: { x: by, y: 1 - by },
})

export function CameraPane({ platform, penColour, penWidth = 2, pane, onCapture, onHide, onPad, preferred }: Props) {
  const video = useRef<HTMLVideoElement | null>(null)
  const host = useRef<HTMLDivElement | null>(null)
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([])
  /** The tablet is the source: a sheet to write on, no camera is opened. */
  const tablet = preferred === TABLET_SOURCE
  const [device, setDevice] = useState<string>(preferred && preferred !== TABLET_SOURCE ? preferred : "")
  useEffect(() => { if (preferred && preferred !== TABLET_SOURCE) setDevice(preferred) }, [preferred])
  const surface = useRef<SurfaceHandle | null>(null)
  const pen = usePenSettings()
  const [boxTool, setBoxTool] = useState(false)
  const [clearAfter, setClearAfter] = useState(keptClearAfter)
  const [, edited] = useState(0)
  const [trouble, setTrouble] = useState<string | null>(null)
  const [read, setRead] = useState<string | null>(null)
  const [box, setBox] = useState<Rect | null>(null)
  /** The tablet sheet's dashed box, in FRACTIONS of the sheet (the sheet is shown at any size). */
  const [sheetBox, setSheetBox] = useState<Rect | null>(null)
  const [areaOpen, setAreaOpen] = useState(false)
  const [drag, setDrag] = useState<{ x: number; y: number } | null>(null)
  /** "Straighten" is on: the page's four corners are showing, and a capture is warped through them. */
  const [straighten, setStraighten] = useState(false)
  const [quad, setQuad] = useState<Quad01>(inset(0.08))
  const [, redraw] = useState(0)
  /** The page's shape, learned from the first capture and kept. */
  const shape = useRef<number | null>(null)
  /** So two captures in a row do not land exactly on top of each other. */
  const nudge = useRef(0)

  // A FIRST LAUNCH NEVER ASKS FOR THE CAMERA on the Mac app, and this one
  // keeps that: the stream is only opened once the pane is on screen,
  // which is a thing the user asked for.
  useEffect(() => {
    let stream: MediaStream | null = null
    let stopped = false
    if (tablet) { setTrouble(null); return }
    void (async () => {
      try {
        // The app's own grant first: a page cannot have a camera the app
        // has not been given.
        const allowed = await window.wm.askForCamera()
        if (!allowed) { setTrouble("no camera permission"); return }
        stream = await navigator.mediaDevices.getUserMedia({
          video: device ? { deviceId: { exact: device } } : true,
        })
        if (stopped) { stream.getTracks().forEach((track) => track.stop()); return }
        if (video.current) {
          video.current.srcObject = stream
          await video.current.play().catch(() => {})
        }
        setDevices((await navigator.mediaDevices.enumerateDevices())
          .filter((one) => one.kind === "videoinput"))
        setTrouble(null)
      } catch (error) {
        setTrouble((error as Error).message || "no camera")
      }
    })()
    return () => {
      stopped = true
      stream?.getTracks().forEach((track) => track.stop())
    }
  }, [device, tablet])

  // The picture's size is only known once a frame has arrived, and the
  // corners are drawn against it: one more render when it does.
  useEffect(() => {
    const element = video.current
    if (!element) return
    const again = () => redraw((was) => was + 1)
    element.addEventListener("loadedmetadata", again)
    window.addEventListener("resize", again)
    return () => {
      element.removeEventListener("loadedmetadata", again)
      window.removeEventListener("resize", again)
    }
  }, [])

  const frameSize = (): Size => ({
    width: video.current?.videoWidth ?? 0,
    height: video.current?.videoHeight ?? 0,
  })

  const paneSize = (): Size => {
    const rect = host.current?.getBoundingClientRect()
    return { width: rect?.width ?? 0, height: rect?.height ?? 0 }
  }

  const at = (event: React.PointerEvent): { x: number; y: number } => {
    const rect = host.current!.getBoundingClientRect()
    return { x: event.clientX - rect.left, y: event.clientY - rect.top }
  }

  /**
   * Take what is in the box. The region goes through the same arithmetic
   * the Mac's does — a fraction of the picture shown, then a box on the
   * page at the page's own scale — so a capture lands where it was on the
   * page and two of them are the same size. With "Straighten" on, the frame
   * is first squared up through the four corners, and the box is carried
   * through the same perspective onto the squared page.
   */
  const take = useCallback(async (mode: Mode) => {
    const element = video.current
    if (!element || element.videoWidth === 0) return
    const frame: Size = { width: element.videoWidth, height: element.videoHeight }
    const region = box
      ? regionOf(box, frame, paneSize())
      : { x: 0, y: 0, width: 1, height: 1 }
    if (!region) return

    let source: CanvasImageSource = element
    let pageSize: Size
    let onPage: Rect
    /** The part to cut, in `source`'s own pixels. */
    let cutRect: Rect
    if (straighten) {
      const corners: Corners = {
        topLeft: { x: quad.topLeft.x * frame.width, y: quad.topLeft.y * frame.height },
        topRight: { x: quad.topRight.x * frame.width, y: quad.topRight.y * frame.height },
        bottomRight: { x: quad.bottomRight.x * frame.width, y: quad.bottomRight.y * frame.height },
        bottomLeft: { x: quad.bottomLeft.x * frame.width, y: quad.bottomLeft.y * frame.height },
      }
      const measured = measuredPage(corners, frame)
      const page = resolveShape(measured.ratio, shape.current)
      shape.current = page.ratio
      pageSize = shapeSize(page, measured.portrait)
      source = straightened(element, frame, corners, pageSize, EDGE_INSET)
      const placed = box
        ? pageBox({
          region, quad: quadFromPixels(corners, frame.height),
          frame: { x: 0, y: 0, width: frame.width, height: frame.height },
          inset: EDGE_INSET, pageSize,
        })
        : { x: 0, y: 0, width: pageSize.width, height: pageSize.height }
      if (!placed) { setTrouble("that box is not on the page"); return }
      cutRect = placed
      onPage = placed
    } else {
      // The page is the frame: without the page's corners there is no
      // perspective to undo, and the box the user drew IS the answer.
      const portrait = frame.height >= frame.width
      const measured = Math.max(frame.width, frame.height) / Math.max(1, Math.min(frame.width, frame.height))
      const page = resolveShape(measured, shape.current)
      shape.current = page.ratio
      pageSize = shapeSize(page, portrait)
      onPage = {
        x: region.x * pageSize.width, y: region.y * pageSize.height,
        width: region.width * pageSize.width, height: region.height * pageSize.height,
      }
      cutRect = {
        x: Math.round(region.x * frame.width), y: Math.round(region.y * frame.height),
        width: Math.max(1, Math.round(region.width * frame.width)),
        height: Math.max(1, Math.round(region.height * frame.height)),
      }
    }

    const sw = Math.max(1, Math.round(cutRect.width)), sh = Math.max(1, Math.round(cutRect.height))
    const cut = document.createElement("canvas")
    cut.width = sw
    cut.height = sh
    const context = cut.getContext("2d", { willReadFrequently: true })!
    context.drawImage(source, Math.round(cutRect.x), Math.round(cutRect.y), sw, sh, 0, 0, sw, sh)

    let blob: Blob | null = null
    let frameOnPage = onPage
    if (mode === "page") {
      blob = await new Promise((resolve) => cut.toBlob(resolve, "image/jpeg", 0.9))
    } else {
      // THE INK, lifted off the paper by the core's own pipeline.
      const pixels = context.getImageData(0, 0, sw, sh)
      const mask = inkMask(grayOf(pixels.data, sw * sh), sw, sh)
      const inked = inkBox(mask, sw, sh)
      if (!inked) { setTrouble("nothing written in that box"); return }
      const out = document.createElement("canvas")
      out.width = inked.width
      out.height = inked.height
      const ink = out.getContext("2d")!
      const image = ink.createImageData(inked.width, inked.height)
      const colour = penColour.replace("#", "")
      const cr = parseInt(colour.slice(0, 2), 16), cg = parseInt(colour.slice(2, 4), 16)
      const cb = parseInt(colour.slice(4, 6), 16)
      for (let y = 0; y < inked.height; y++) {
        for (let x = 0; x < inked.width; x++) {
          if (!mask[(inked.y + y) * sw + inked.x + x]) continue
          const to = (y * inked.width + x) * 4
          image.data[to] = cr
          image.data[to + 1] = cg
          image.data[to + 2] = cb
          image.data[to + 3] = 255
        }
      }
      ink.putImageData(image, 0, 0)
      blob = await new Promise((resolve) => out.toBlob(resolve, "image/png"))
      // The writing's own box on the page, so it lands where it was.
      const scaleX = onPage.width / sw, scaleY = onPage.height / sh
      frameOnPage = {
        x: onPage.x + inked.x * scaleX, y: onPage.y + inked.y * scaleY,
        width: inked.width * scaleX, height: inked.height * scaleY,
      }
    }
    if (!blob) return

    const where = placement({ frame: frameOnPage, pageSize, pane, nudge: nudge.current })
    nudge.current = (nudge.current + 0.02) % 0.1
    const aspect = frameOnPage.height / Math.max(1, frameOnPage.width)

    // A FLOW CHART on the page comes in as real nodes and arrows, in a band
    // just under the picture (the Mac's rule), and only when the reader is
    // sure it is one — a page of prose gives nothing. There are no words
    // to label them with where nothing reads handwriting; a node's label is
    // typed on it by double-click.
    const chart = chartFrom(cut, { width: sw, height: sh }, [], pane, penColour, penWidth,
      bandUnder(where.center, where.width, aspect, pane))

    setTrouble(null)
    const nodes = chart.filter((item) => item.kind === "shape").length
    setRead(chart.length > 0
      ? `Read a flow chart: ${nodes} ${nodes === 1 ? "node" : "nodes"}.` : null)
    onCapture({
      blob,
      center: where.center,
      width: where.width,
      aspect,
      ...(chart.length > 0 ? { chart } : {}),
    })
  }, [box, onCapture, pane, penColour, penWidth, quad, straighten])

  /**
   * Take what is on the tablet's sheet (tabletCapture.ts, shared with the
   * full-screen pad): WRITING brings the strokes themselves, PAGE the sheet as
   * a picture.
   */
  const takeTablet = useCallback(async (mode: Mode) => {
    const out = await takeFromSheet(mode, {
      box: sheetBox, shown: surface.current?.size() ?? { width: 0, height: 0 }, pane,
      penColour, penWidth, clearAfter,
    })
    if ("trouble" in out) { setTrouble(out.trouble); return }
    setTrouble(null)
    setRead(out.read)
    // What was sent leaves the sheet (one Undo on the sheet brings it back).
    if (out.cleared) {
      surface.current?.repaint()
      setSheetBox(null)
      edited((was) => was + 1)
    }
    onCapture(out.capture)
  }, [sheetBox, clearAfter, onCapture, pane, penColour, penWidth])

  const shown = displayedFrame(frameSize(), paneSize())
  const corner = (name: CornerName) => ({
    x: shown.x + quad[name].x * shown.width, y: shown.y + quad[name].y * shown.height,
  })

  return (
    <div className="camera" ref={host}
         onPointerDown={(event) => {
           if (tablet || event.button !== 0) return
           const point = at(event)
           setDrag(point)
           setBox({ x: point.x, y: point.y, width: 0, height: 0 })
         }}
         onPointerMove={(event) => {
           if (tablet || !drag) return
           const point = at(event)
           setBox({
             x: Math.min(drag.x, point.x), y: Math.min(drag.y, point.y),
             width: Math.abs(point.x - drag.x), height: Math.abs(point.y - drag.y),
           })
         }}
         onPointerUp={() => {
           if (tablet) return
           setDrag(null)
           setBox((was) => (was && was.width > 8 && was.height > 8 ? was : null))
         }}>
      {tablet
        ? (
          <TabletSurface ref={surface} page={sheet} colour={penColour} width={penWidth}
                         boxTool={boxTool} box={sheetBox}
                         onBox={(rect, done) => { setSheetBox(rect); if (done) setBoxTool(false) }}
                         onEdited={() => edited((was) => was + 1)} />
        )
        : <video ref={video} muted playsInline />}
      {!tablet && box && (
        <div className="box" style={{
          left: box.x, top: box.y, width: box.width, height: box.height,
        }} />
      )}
      {!tablet && straighten && shown.width > 0 && (
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
                   const point = at(event)
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
      {trouble && <div className="trouble">{trouble}</div>}
      {tablet && areaOpen && (
        <div className="area-pop" onPointerDown={(event) => event.stopPropagation()}>
          <TabletAreaHelp />
        </div>
      )}
      <div className="camera-bar" onPointerDown={(event) => event.stopPropagation()}>
        {tablet && (
          <>
            <button className={`icon-button${boxTool ? " on" : ""}`} data-tablet="box"
                    title="Drag a dashed box over the part to bring in (or hold the pen's side button, or Ctrl, and drag). A tiny drag takes the box away."
                    onClick={() => setBoxTool((was) => !was)}
                    style={{ width: "auto", padding: "0 8px", fontSize: 11 }}>Box</button>
            <button className={`icon-button${pen.eraser ? " on" : ""}`} data-tablet="erase"
                    title="Rub out whole strokes by touching them"
                    onClick={() => setEraser(!pen.eraser)}
                    style={{ width: "auto", padding: "0 8px", fontSize: 11 }}>Erase</button>
            <button className="icon-button" data-tablet="undo" disabled={!sheet.canUndo}
                    title="Take back the last stroke on the sheet (Ctrl+Z while the pen is over it)"
                    onClick={() => surface.current?.undo()}
                    style={{ width: "auto", padding: "0 8px", fontSize: 11 }}>Undo</button>
            <button className="icon-button" data-tablet="clear" disabled={sheet.strokes.length === 0}
                    title="Wipe the sheet"
                    onClick={() => { surface.current?.clear(); setSheetBox(null) }}
                    style={{ width: "auto", padding: "0 8px", fontSize: 11 }}>Clear</button>
            <button className={`icon-button${clearAfter ? " on" : ""}`} data-tablet="clear-after"
                    title="Wipe what was taken from the sheet once it is in the note"
                    onClick={() => {
                      const next = !clearAfter
                      setClearAfter(next)
                      keepClearAfter(next)
                    }}
                    style={{ width: "auto", padding: "0 8px", fontSize: 11 }}>Clear after</button>
            {onPad && (
              <button className="icon-button" data-tablet="pad"
                      title="Pad mode: the window goes full screen and the whole tablet becomes the sheet (Ctrl+Alt+T)"
                      onClick={onPad}
                      style={{ width: "auto", padding: "0 8px", fontSize: 11 }}>Pad</button>
            )}
            <button className={`icon-button${areaOpen ? " on" : ""}`} data-tablet="area"
                    title="Which part of the screen is this sheet? For the tablet driver's Mapping settings"
                    onClick={() => setAreaOpen((was) => !was)}
                    style={{ width: "auto", padding: "0 8px", fontSize: 11 }}>Area</button>
          </>
        )}
        {!tablet && devices.length > 1 && (
          <select className="icon-button" style={{ width: "auto", padding: "0 4px", fontSize: 11 }}
                  value={device} onChange={(event) => setDevice(event.target.value)}>
            <option value="">Default camera</option>
            {devices.map((one) => (
              <option key={one.deviceId} value={one.deviceId}>{one.label || "Camera"}</option>
            ))}
          </select>
        )}
        {!tablet && <button className={`icon-button${straighten ? " on" : ""}`}
                title="Square the page up: drag the four corners onto the page's corners"
                onClick={() => setStraighten((was) => !was)}
                style={{ width: "auto", padding: "0 8px", fontSize: 11 }}>Straighten</button>}
        <button className="icon-button" title={tablet ? "Bring the writing in as strokes" : "Take the writing off the page"}
                onClick={() => { void (tablet ? takeTablet("ink") : take("ink")) }}
                style={{ width: "auto", padding: "0 8px", fontSize: 11 }}>Writing</button>
        <button className="icon-button" title={tablet ? "Bring the sheet in as a picture (read its words with Aa)" : "Take the page as a photograph"}
                onClick={() => { void (tablet ? takeTablet("page") : take("page")) }}
                style={{ width: "auto", padding: "0 8px", fontSize: 11 }}>Page</button>
        <button className="icon-button" title="Put the camera away" onClick={onHide}>✕</button>
      </div>
      <div className="note">
        {/*
          THE ONE PLACE A MISSING CAPABILITY IS MENTIONED, because this one
          changes what the user does. Everything else the platform cannot
          do is simply not offered.
        */}
        {tablet
          ? `Write with the pen${pen.eraser ? " — erasing" : pen.sideButton === "erases" ? " (side button erases)" : ""}, then take it.`
          : straighten
            ? "Drag the four corners onto the page's corners, then take it."
            : platform && !platform.findsThePage
              ? "Drag a box over the writing, then take it."
              : "Point it at a page."}
        {tablet || shown.width > 0 ? "" : " No picture yet."}
        {read ? ` ${read}` : ""}
      </div>
    </div>
  )
}
