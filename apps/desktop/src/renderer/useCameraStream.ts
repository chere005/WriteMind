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

import { useEffect, useRef, useState, type RefObject } from "react"
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
