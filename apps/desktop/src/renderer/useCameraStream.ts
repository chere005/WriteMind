/**
 * The camera's stream, opened and — above all — CLOSED. A pane that is put
 * away, a source that is changed, a camera that is unplugged: each ends with
 * every track stopped and the video element let go of its MediaStream, so the
 * webcam's light goes out and nothing keeps decoding for a pane nobody can see.
 *
 * Mirrors `CameraController` on the Mac: status idle / starting / running /
 * denied / failed, the selected device, and a device that disappears turns the
 * camera off. The permission is asked for when the pane opens and never before
 * (`askForCamera`; on Windows there is nothing to ask, the browser's own
 * privacy switch is reported as "Camera access is off").
 */

import { useCallback, useEffect, useRef, useState, type RefObject } from "react"
import type { Size } from "@writemind/core"
import { describeCameraError, unpluggedProblem, type CameraProblem } from "./cameraDevices"

export type CameraStatus = "idle" | "starting" | "running" | "failed"

export interface CameraStream {
  status: CameraStatus
  problem: CameraProblem | null
  /** The device actually in use (what the Input Devices menu puts its tick on). */
  deviceId: string | null
  label: string
}

const nothing: CameraStream = { status: "idle", problem: null, deviceId: null, label: "" }

/** Every video track this renderer has open: what a diagnostic asks, and a leak shows up in. */
const live = new Set<MediaStreamTrack>()
export const liveCameraTracks = (): number => [...live].filter((track) => track.readyState === "live").length

if (typeof window !== "undefined") {
  ;(window as unknown as { __wmCamera?: unknown }).__wmCamera = {
    liveTracks: liveCameraTracks,
    tracks: () => [...live].map((track) => ({ label: track.label, state: track.readyState })),
    /** For a test: what the track does when its camera is pulled out (the same path as the real event). */
    simulateUnplug: () => { for (const track of [...live]) track.onended?.(new Event("ended")) },
  }
}

export function useCameraStream(video: RefObject<HTMLVideoElement | null>, options: {
  /** False while the pane shows the tablet, is turned off, or is not on screen. */
  enabled: boolean
  /** The camera asked for, or null for the system's default. */
  deviceId: string | null
  /** Bump to try again (Refresh Device List, a camera plugged in). */
  attempt?: number
}): CameraStream {
  const [state, setState] = useState<CameraStream>(nothing)
  const [plugged, setPlugged] = useState(0)
  const wanted = options.deviceId
  const stateRef = useRef(state)
  stateRef.current = state

  useEffect(() => {
    if (!options.enabled) { setState(nothing); return }
    let cancelled = false
    let stream: MediaStream | null = null
    const release = (): void => {
      if (stream) {
        for (const track of stream.getTracks()) {
          track.onended = null
          track.stop()
          live.delete(track)
        }
        stream = null
      }
      const element = video.current
      if (element) {
        element.pause()
        element.srcObject = null
      }
    }
    setState({ ...nothing, status: "starting" })
    void (async () => {
      try {
        // The app's own grant first: a page cannot have a camera the app has not been given.
        const allowed = await window.wm.askForCamera()
        if (cancelled) return
        if (!allowed) {
          setState({ ...nothing, status: "failed", problem: describeCameraError({ name: "NotAllowedError" }) })
          return
        }
        // The Mac asks for its `.high` preset; a bare `video: true` is often 640x480, too coarse for handwriting.
        // Ideal, not exact: a camera that cannot do it gives what it can.
        const opened = await navigator.mediaDevices.getUserMedia({
          video: {
            width: { ideal: 1920 }, height: { ideal: 1080 }, frameRate: { ideal: 30 },
            ...(wanted ? { deviceId: { exact: wanted } } : {}),
          },
        })
        if (cancelled) { for (const track of opened.getTracks()) track.stop(); return }
        stream = opened
        const track = opened.getVideoTracks()[0]
        if (!track) throw Object.assign(new Error("no video track"), { name: "NotFoundError" })
        live.add(track)
        // A camera pulled out (or taken by another program) ends its track: that is "turned off".
        track.onended = () => {
          if (cancelled) return
          release()
          setState({ ...nothing, status: "failed", problem: unpluggedProblem() })
          window.dispatchEvent(new Event("wm:cameras-changed"))
        }
        const element = video.current
        if (element) {
          element.srcObject = opened
          await element.play().catch(() => undefined)
        }
        // The camera may have been pulled out while the first frame was awaited: `release()` (from the track's own
        // `ended`) has already said so, and "running" must not overwrite it.
        if (cancelled || stream !== opened || track.readyState === "ended") return
        const settings = track.getSettings()
        setState({ status: "running", problem: null, deviceId: settings.deviceId ?? wanted, label: track.label })
        // Labels (and the list itself) are only complete once a camera has been opened.
        window.dispatchEvent(new Event("wm:cameras-changed"))
      } catch (error) {
        if (cancelled) return
        release()
        setState({ ...nothing, status: "failed", problem: describeCameraError(error) })
      }
    })()

    // Hot-plug. A camera that disappears turns the pane off (a track's own `ended` usually says so first);
    // one that appears when the pane was waiting for a camera starts it.
    const changed = async (): Promise<void> => {
      let present: MediaDeviceInfo[] = []
      try {
        present = (await navigator.mediaDevices.enumerateDevices()).filter((one) => one.kind === "videoinput")
      } catch { return }
      if (cancelled) return
      const now = stateRef.current
      if (now.status === "running" && now.deviceId && present.length > 0
        && present.every((one) => one.deviceId !== "" && one.deviceId !== now.deviceId)) {
        release()
        setState({ ...nothing, status: "failed", problem: unpluggedProblem() })
        return
      }
      if (now.status === "failed" && now.problem
        && (now.problem.kind === "missing" || now.problem.kind === "unplugged" || now.problem.kind === "gone")
        && present.some((one) => wanted === null || one.deviceId === wanted)) {
        setPlugged((was) => was + 1)
      }
    }
    navigator.mediaDevices?.addEventListener?.("devicechange", changed)
    return () => {
      cancelled = true
      navigator.mediaDevices?.removeEventListener?.("devicechange", changed)
      release()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- the video element is a ref
  }, [options.enabled, wanted, options.attempt, plugged])

  return state
}

/**
 * HOLD IMAGE (Sean, 2026-10-05; the port's own, the Mac has no such button): the frame on screen kept still, so a
 * page can be framed, held, and taken without the hand or the camera moving. The still is a copy of one frame in the
 * pane's own canvas (`still`), shown in the video's place; the box, Straighten's corners, Find page and every capture
 * are then taken from it (`picture`). The stream plays on underneath, so letting go is the live picture at once.
 *
 * It lets go by itself when the picture it came from is gone: another camera picked (`source`), the camera turned off,
 * the tablet picked, a stream that stops (unplugged, refused, restarted): `live` false.
 */
export interface HeldFrame {
  /** The canvas the still is kept in, and shown from. */
  still: RefObject<HTMLCanvasElement | null>
  held: boolean
  /** Keep the frame on screen now; false when there is none yet. */
  hold(): boolean
  letGo(): void
  /** The held still's size (the camera's own pixels, not turned), or null when nothing is held. */
  heldSize(): Size | null
  /** What a capture is taken from: the still while one is held, else the video's current frame; null with no frame. */
  picture(): { image: CanvasImageSource; size: Size } | null
}

export function useHeldFrame(video: RefObject<HTMLVideoElement | null>, options: {
  /** The camera is delivering a picture (not the tablet, not off, not starting or failed). */
  live: boolean
  /** The source picked: a different one lets go. */
  source: string | null
}): HeldFrame {
  const still = useRef<HTMLCanvasElement | null>(null)
  const [held, setHeld] = useState(false)
  /** Read by captures that were set up before the render that shows the hold. */
  const holding = useRef(false)

  const letGo = useCallback(() => {
    holding.current = false
    setHeld(false)
    // The pixels go with it (a 1080p still is 8 MB).
    const canvas = still.current
    if (canvas && canvas.width > 0) { canvas.width = 0; canvas.height = 0 }
  }, [])

  const hold = useCallback((): boolean => {
    const element = video.current, canvas = still.current
    if (!element || !canvas || element.videoWidth === 0 || element.readyState < 2) return false
    canvas.width = element.videoWidth
    canvas.height = element.videoHeight
    const context = canvas.getContext("2d")
    if (!context) return false
    context.drawImage(element, 0, 0, canvas.width, canvas.height)
    holding.current = true
    setHeld(true)
    return true
  }, [video])

  const heldSize = useCallback((): Size | null => {
    const canvas = still.current
    return holding.current && canvas && canvas.width > 0 ? { width: canvas.width, height: canvas.height } : null
  }, [])

  const picture = useCallback((): { image: CanvasImageSource; size: Size } | null => {
    const kept = heldSize()
    if (kept && still.current) return { image: still.current, size: kept }
    const element = video.current
    if (!element || element.videoWidth === 0 || element.readyState < 2) return null
    return { image: element, size: { width: element.videoWidth, height: element.videoHeight } }
  }, [heldSize, video])

  useEffect(() => { if (!options.live) letGo() }, [options.live, letGo])
  useEffect(() => { letGo() }, [options.source, letGo])

  return { still, held, hold, letGo, heldSize, picture }
}
