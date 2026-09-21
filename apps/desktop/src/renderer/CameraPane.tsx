/**
 * The camera: a viewfinder, a box drawn on it by hand, and two ways to take
 * what is inside the box — the WRITING lifted off the paper, or the page as
 * a photograph.
 *
 * What is Apple's and what is ours, in one place. Finding the page in the
 * frame is Vision's document segmentation on the Mac and does not exist on
 * Windows, so the box is dragged by hand on both until the helper lands —
 * and the ONE line under the viewfinder says so, because that absence
 * changes what the user has to do. Everything else — the local-mean
 * threshold that lifts ink off paper, the connected components that drop
 * the printed dot grid, the page shape that keeps two captures the same
 * size — is `@writemind/core` and runs the same on either platform.
 */

import { useCallback, useEffect, useRef, useState } from "react"
import {
  displayedFrame, inkBox, inkMask, placement, regionOf, resolveShape, shapeSize,
  type Rect, type Size,
} from "@writemind/core"
import type { Platform } from "./wm"

export interface Capture {
  /** The picture's bytes, ready for `saveMedia`. */
  blob: Blob
  /** Where it goes and how big, as fractions of the notes pane. */
  center: { x: number; y: number }
  width: number
  aspect: number
}

interface Props {
  platform: Platform | null
  penColour: string
  /** The notes pane, which is what a capture is measured against. */
  pane: Size
  onCapture(capture: Capture): void
  onHide(): void
}

type Mode = "ink" | "page"

export function CameraPane({ platform, penColour, pane, onCapture, onHide }: Props) {
  const video = useRef<HTMLVideoElement | null>(null)
  const host = useRef<HTMLDivElement | null>(null)
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([])
  const [device, setDevice] = useState<string>("")
  const [trouble, setTrouble] = useState<string | null>(null)
  const [box, setBox] = useState<Rect | null>(null)
  const [drag, setDrag] = useState<{ x: number; y: number } | null>(null)
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
  }, [device])

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
   * page and two of them are the same size.
   */
  const take = useCallback(async (mode: Mode) => {
    const element = video.current
    if (!element || element.videoWidth === 0) return
    const frame: Size = { width: element.videoWidth, height: element.videoHeight }
    const region = box
      ? regionOf(box, frame, paneSize())
      : { x: 0, y: 0, width: 1, height: 1 }
    if (!region) return

    // The page is the frame: without Vision finding the paper there is no
    // perspective to undo, and the box the user drew IS the answer.
    const portrait = frame.height >= frame.width
    const measured = Math.max(frame.width, frame.height) / Math.max(1, Math.min(frame.width, frame.height))
    const page = resolveShape(measured, shape.current)
    shape.current = page.ratio
    const pageSize = shapeSize(page, portrait)
    const onPage: Rect = {
      x: region.x * pageSize.width, y: region.y * pageSize.height,
      width: region.width * pageSize.width, height: region.height * pageSize.height,
    }

    // The frame's pixels for that region.
    const sx = Math.round(region.x * frame.width), sy = Math.round(region.y * frame.height)
    const sw = Math.max(1, Math.round(region.width * frame.width))
    const sh = Math.max(1, Math.round(region.height * frame.height))
    const cut = document.createElement("canvas")
    cut.width = sw
    cut.height = sh
    const context = cut.getContext("2d", { willReadFrequently: true })!
    context.drawImage(element, sx, sy, sw, sh, 0, 0, sw, sh)

    let blob: Blob | null = null
    let frameOnPage = onPage
    if (mode === "page") {
      blob = await new Promise((resolve) => cut.toBlob(resolve, "image/jpeg", 0.9))
    } else {
      // THE INK, lifted off the paper by the core's own pipeline.
      const pixels = context.getImageData(0, 0, sw, sh)
      const gray = new Uint8Array(sw * sh)
      for (let index = 0; index < sw * sh; index++) {
        const r = pixels.data[index * 4]!, g = pixels.data[index * 4 + 1]!, b = pixels.data[index * 4 + 2]!
        gray[index] = Math.round(0.299 * r + 0.587 * g + 0.114 * b)
      }
      const mask = inkMask(gray, sw, sh)
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
    setTrouble(null)
    onCapture({
      blob,
      center: where.center,
      width: where.width,
      aspect: frameOnPage.height / Math.max(1, frameOnPage.width),
    })
  }, [box, onCapture, pane, penColour])

  const shown = displayedFrame(frameSize(), paneSize())

  return (
    <div className="camera" ref={host}
         onPointerDown={(event) => {
           if (event.button !== 0) return
           const point = at(event)
           setDrag(point)
           setBox({ x: point.x, y: point.y, width: 0, height: 0 })
         }}
         onPointerMove={(event) => {
           if (!drag) return
           const point = at(event)
           setBox({
             x: Math.min(drag.x, point.x), y: Math.min(drag.y, point.y),
             width: Math.abs(point.x - drag.x), height: Math.abs(point.y - drag.y),
           })
         }}
         onPointerUp={() => {
           setDrag(null)
           setBox((was) => (was && was.width > 8 && was.height > 8 ? was : null))
         }}>
      <video ref={video} muted playsInline />
      {box && (
        <div className="box" style={{
          left: box.x, top: box.y, width: box.width, height: box.height,
        }} />
      )}
      {trouble && <div className="trouble">{trouble}</div>}
      <div className="camera-bar" onPointerDown={(event) => event.stopPropagation()}>
        {devices.length > 1 && (
          <select className="icon-button" style={{ width: "auto", padding: "0 4px", fontSize: 11 }}
                  value={device} onChange={(event) => setDevice(event.target.value)}>
            <option value="">Default camera</option>
            {devices.map((one) => (
              <option key={one.deviceId} value={one.deviceId}>{one.label || "Camera"}</option>
            ))}
          </select>
        )}
        <button className="icon-button" title="Take the writing off the page"
                onClick={() => { void take("ink") }}
                style={{ width: "auto", padding: "0 8px", fontSize: 11 }}>Writing</button>
        <button className="icon-button" title="Take the page as a photograph"
                onClick={() => { void take("page") }}
                style={{ width: "auto", padding: "0 8px", fontSize: 11 }}>Page</button>
        <button className="icon-button" title="Put the camera away" onClick={onHide}>✕</button>
      </div>
      <div className="note">
        {/*
          THE ONE PLACE A MISSING CAPABILITY IS MENTIONED, because this one
          changes what the user does. Everything else the platform cannot
          do is simply not offered.
        */}
        {platform && !platform.findsThePage
          ? "Drag a box over the writing, then take it."
          : "Point it at a page."}
        {shown.width > 0 ? "" : " No picture yet."}
      </div>
    </div>
  )
}
