import { describe, expect, it, vi } from "vitest"
import { TABLET_SOURCE } from "../src/renderer/../shared/commands"
import type { MenuItem } from "../src/renderer/FloatingMenu"
import { videoMenu, type VideoMenuActions, type VideoMenuState } from "../src/renderer/videoMenu"

/**
 * THE VIDEO BUTTON'S MENU (docs/ui-2026-10/FinalStates.png), the sidebar's old `video-pop` moved to the tab row: Show video,
 * the cameras (the live one ticked), the tablet sheet, Turn left / Turn right (the menu stays up for them), Refresh devices.
 */

const state = (over: Partial<VideoMenuState> = {}): VideoMenuState => ({
  platform: "darwin", camera: true, cameras: [{ id: "a", name: "FaceTime HD Camera" }, { id: "b", name: "Desk View Camera" }],
  cameraId: "a", notesPane: true, ...over,
})
const actions = (): VideoMenuActions => ({
  toggleVideo: vi.fn(), pick: vi.fn(), off: vi.fn(), refresh: vi.fn(), turn: vi.fn(), toggleNotesPane: vi.fn(),
})
const rows = (items: MenuItem[]) => items.filter((item): item is Extract<MenuItem, { label: string }> => typeof item === "object" && "label" in item)
const row = (items: MenuItem[], label: string) => rows(items).find((one) => one.label === label)!

describe("the video menu", () => {
  it("lists what the wireframe does, in its order", () => {
    expect(rows(videoMenu(state(), actions())).map((one) => one.label)).toEqual([
      "Show video", "FaceTime HD Camera", "Desk View Camera", "Tablet sheet", "Turn camera off",
      "Turn left", "Turn right", "Refresh devices", "Video Only (Hide Notes Pane)",
    ])
  })

  it("Show video is ticked while the pane shows and carries the key for this machine", () => {
    expect(row(videoMenu(state(), actions()), "Show video")).toMatchObject({ checked: true, hint: "Cmd+Y" })
    expect(row(videoMenu(state({ camera: false }), actions()), "Show video").checked).toBe(false)
    expect(row(videoMenu(state({ platform: "win32" }), actions()), "Show video").hint).toBe("Ctrl+Shift+Y")
  })

  it("ticks the source that is open: a camera, or the tablet", () => {
    const ticks = (items: MenuItem[]) => rows(items).filter((one) => one.checked).map((one) => one.label)
    expect(ticks(videoMenu(state(), actions()))).toEqual(["Show video", "FaceTime HD Camera"])
    expect(ticks(videoMenu(state({ cameraId: TABLET_SOURCE }), actions()))).toEqual(["Show video", "Tablet sheet"])
    expect(ticks(videoMenu(state({ cameraId: null }), actions()))).toEqual(["Show video"])
  })

  it("picking a source asks for it by id, the tablet by its own", () => {
    const a = actions()
    const items = videoMenu(state(), a)
    row(items, "Desk View Camera").onClick!(); expect(a.pick).toHaveBeenLastCalledWith("b")
    row(items, "Tablet sheet").onClick!(); expect(a.pick).toHaveBeenLastCalledWith(TABLET_SOURCE)
  })

  it("Turn left, Turn right and Refresh devices keep the menu up; picking a source does not", () => {
    const items = videoMenu(state(), actions())
    expect(["Turn left", "Turn right", "Refresh devices"].map((label) => row(items, label).keepOpen)).toEqual([true, true, true])
    expect(row(items, "FaceTime HD Camera").keepOpen).toBeUndefined()
    expect(row(items, "Show video").keepOpen).toBeUndefined()
  })

  it("the turns go to the picture's owner and are greyed with nothing to turn (no camera, or the tablet's sheet)", () => {
    const a = actions()
    const items = videoMenu(state(), a)
    row(items, "Turn left").onClick!(); expect(a.turn).toHaveBeenLastCalledWith("turn-left")
    row(items, "Turn right").onClick!(); expect(a.turn).toHaveBeenLastCalledWith("turn-right")
    for (const cameraId of [null, TABLET_SOURCE]) {
      const none = videoMenu(state({ cameraId }), a)
      expect([row(none, "Turn left").disabled, row(none, "Turn right").disabled]).toEqual([true, true])
    }
  })

  it("Refresh devices carries its key", () => {
    expect(row(videoMenu(state(), actions()), "Refresh devices").hint).toBe("Alt+Cmd+R")
  })

  it("says so with no camera, and still offers the tablet", () => {
    const items = videoMenu(state({ cameras: [] }), actions())
    expect(row(items, "No cameras found").disabled).toBe(true)
    expect(row(items, "Tablet sheet")).toBeDefined()
  })

  it("keeps Video Only / Back to Side by Side, greyed while the pane is not showing", () => {
    expect(row(videoMenu(state(), actions()), "Video Only (Hide Notes Pane)").disabled).toBe(false)
    expect(row(videoMenu(state({ notesPane: false }), actions()), "Back to Side by Side")).toBeDefined()
    expect(row(videoMenu(state({ camera: false }), actions()), "Video Only (Hide Notes Pane)").disabled).toBe(true)
  })

  it("Turn camera off waits for a source", () => {
    expect(row(videoMenu(state({ cameraId: null }), actions()), "Turn camera off").disabled).toBe(true)
    const a = actions()
    row(videoMenu(state(), a), "Turn camera off").onClick!(); expect(a.off).toHaveBeenCalled()
  })
})
