/**
 * The video button's menu, as data (the tab row's, FinalStates.png "The video button's menu"): Show video, the
 * cameras with the live one checked, the tablet sheet, the turns, refresh. It is the sidebar's old `video-pop` moved
 * to the button that governs the pane (Sean, 2026-10-10: "keep the rendered and video buttons to the right of the
 * sidebar always"), in the page's own menu: Turn Left, Turn Right and Refresh Devices keep it up (a picture is turned
 * two or three times in a row, and the list is refreshed to watch it change).
 */

import { shown, TABLET_SOURCE } from "../shared/commands"
import type { MenuItem } from "./FloatingMenu"

export interface VideoMenuState {
  platform: string
  /** The video pane is showing. */
  camera: boolean
  cameras: { id: string; name: string }[]
  /** The source that is open: a camera's id, the tablet, or null for none. */
  cameraId: string | null
  /** The notes pane is showing (false: the video has the window). */
  notesPane: boolean
}

export interface VideoMenuActions {
  toggleVideo(): void
  pick(id: string): void
  off(): void
  refresh(): void
  /** The pane owns the picture: a turn is asked of it by event (CameraPane's `wm:camera-action`). */
  turn(direction: "turn-left" | "turn-right"): void
  toggleNotesPane(): void
}

export function videoMenu(state: VideoMenuState, act: VideoMenuActions): MenuItem[] {
  const { platform, camera, cameras, cameraId, notesPane } = state
  // A camera can be turned; the tablet's sheet is not a picture, and with nothing open there is nothing to turn.
  const turnable = cameraId !== null && cameraId !== TABLET_SOURCE
  const sources: MenuItem[] = cameras.length === 0
    ? [{ label: "No cameras found", disabled: true }]
    : cameras.map((one): MenuItem => ({
      label: one.name, checked: cameraId === one.id, onClick: () => act.pick(one.id), dataBar: "video-source",
    }))
  return [
    { label: "Show video", checked: camera, hint: shown("toggleCamera", platform), onClick: act.toggleVideo, dataBar: "video-show" },
    "-",
    ...sources,
    { label: "Tablet sheet", checked: cameraId === TABLET_SOURCE, onClick: () => act.pick(TABLET_SOURCE), dataBar: "video-tablet" },
    { label: "Turn camera off", disabled: cameraId === null, onClick: act.off, dataBar: "video-off" },
    "-",
    { label: "Turn left", keepOpen: true, disabled: !turnable, onClick: () => act.turn("turn-left"), dataBar: "video-turn-left" },
    { label: "Turn right", keepOpen: true, disabled: !turnable, onClick: () => act.turn("turn-right"), dataBar: "video-turn-right" },
    { label: "Refresh devices", keepOpen: true, hint: shown("cameraRefresh", platform), onClick: act.refresh, dataBar: "video-refresh" },
    "-",
    {
      label: notesPane ? "Video Only (Hide Notes Pane)" : "Back to Side by Side", disabled: !camera,
      onClick: act.toggleNotesPane, dataBar: "video-only",
    },
  ]
}
