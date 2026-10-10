/**
 * What can go wrong with a camera, said in words a person can act on.
 *
 * The Mac's pane has four stand-ins for a picture: "No camera selected",
 * "Camera access is off" (with a button to the privacy settings), "Camera
 * unavailable" (with the reason) and a spinner while one starts
 * (`CameraPane.swift`). A browser's `getUserMedia` reports those as named
 * errors; this maps them, so the pane can show the same four things, with the
 * Windows way to fix each.
 */

export type CameraProblemKind = "denied" | "missing" | "busy" | "gone" | "unplugged" | "other"

export interface CameraProblem {
  kind: CameraProblemKind
  title: string
  detail: string
}

/** Where the camera's privacy switch is, in the words of the platform the person is on. */
export function privacyHint(system: string = typeof navigator !== "undefined" ? navigator.userAgent : ""): string {
  if (/Mac/i.test(system)) return "Allow WriteMind in System Settings › Privacy & Security › Camera, then pick the camera again."
  if (/Windows|Win32|Win64/i.test(system)) {
    return "Allow desktop apps to use the camera in Settings › Privacy › Camera (Windows 11: Privacy & security › Camera), then pick the camera again."
  }
  return "Check that this user may use the camera in the system's privacy or permission settings, then pick the camera again."
}

export function describeCameraError(error: unknown, system?: string): CameraProblem {
  const name = String((error as { name?: string } | null)?.name ?? "")
  const message = String((error as { message?: string } | null)?.message ?? error ?? "")
  if (name === "NotAllowedError" || name === "SecurityError") {
    return {
      kind: "denied",
      title: "Camera access is off",
      detail: /system/i.test(message) && /Windows|Win32|Win64/i.test(system ?? (typeof navigator !== "undefined" ? navigator.userAgent : ""))
        ? "Windows is blocking the camera. " + privacyHint(system)
        : privacyHint(system),
    }
  }
  if (name === "NotFoundError" || name === "DevicesNotFoundError") {
    return { kind: "missing", title: "No camera found", detail: "Plug one in; it appears in the list by itself, or choose Refresh Device List." }
  }
  if (name === "NotReadableError" || name === "TrackStartError") {
    return {
      kind: "busy", title: "The camera is busy",
      detail: "Another program is using it. Close that program, then pick the camera again.",
    }
  }
  if (name === "OverconstrainedError" || name === "ConstraintNotSatisfiedError") {
    return { kind: "gone", title: "That camera is no longer available", detail: "Pick another from the list." }
  }
  return { kind: "other", title: "Camera unavailable", detail: message || "The camera could not be started." }
}

/** The camera went away while it was running: unplugged, or taken by another program. */
export const unpluggedProblem = (): CameraProblem => ({
  kind: "unplugged", title: "The camera was unplugged",
  detail: "Plug it back in and pick it from the list.",
})

/** The pane when no source is chosen (the Mac's "No camera selected"). */
export const idleProblem = (): CameraProblem => ({
  kind: "other", title: "No camera selected",
  // It points at the list drawn UNDER it (docs/PLAN-bars-2026-10.md, P6): the old line sent a person to a menu that is not on this
  // pane (a Mac's menu bar, the video button) while the list they could press was right there.
  detail: "Pick one from the list below.",
})
