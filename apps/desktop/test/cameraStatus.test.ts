/**
 * What the video pane says (renderer/cameraStatus.ts): the footer's one standing line and its fact, and the toast an
 * action leaves under the header. Port-only: the Mac's pane has no footer or toast to transcribe a test from.
 */

import { describe, expect, it } from "vitest"
import {
  busyToast, cameraLine, capturedToast, deviceName, doneToast, errorToast, pictureFact, plain, sheetLine, toastMs, toastText,
  type CameraLineInput, type SheetLineInput,
} from "../src/renderer/cameraStatus"

const camera = (over: Partial<CameraLineInput> = {}): CameraLineInput => ({
  page: null, straighten: false, holding: false, pictured: true, found: null, findsThePage: true, ...over,
})
const sheet = (over: Partial<SheetLineInput> = {}): SheetLineInput => ({
  eraser: false, select: false, rubButton: "first", eraseKey: "Ctrl+Alt+2", bound: null, notice: null, ...over,
})

describe("the camera's standing line", () => {
  it("is one short sentence: what is true now and what to do", () => {
    expect(cameraLine(camera())).toBe("Point it at a page · drag a box for a part")
    expect(cameraLine(camera({ found: true }))).toBe("Page found · drag a box for a part")
  })
  it("says so when the platform cannot find the page by itself", () => {
    expect(cameraLine(camera({ findsThePage: false }))).toBe("Drag a box over the writing")
  })
  it("a held picture, Straighten and a kept page each say their own thing", () => {
    expect(cameraLine(camera({ holding: true }))).toBe("Held still · drag a box for a part")
    expect(cameraLine(camera({ straighten: true }))).toBe("drag the four corners onto the page's corners")
    expect(cameraLine(camera({ page: "Page 2" }))).toBe("Page 2 · drag a box for a part, or take all of it")
    expect(cameraLine(camera({ page: "Page 2", straighten: true }))).toBe("Page 2 · drag the four corners onto the page's corners")
  })
  it("with no picture it only says so", () => {
    expect(cameraLine(camera({ pictured: false }))).toBe("No picture yet")
  })
  it("never carries the result of an action (that is the toast's)", () => {
    for (const line of [cameraLine(camera()), cameraLine(camera({ found: true })), cameraLine(camera({ holding: true }))]) {
      expect(line).not.toMatch(/added|✓|Found the page|Reading/)
    }
  })
  it("the fact is the picture's size, or nothing", () => {
    expect(pictureFact({ width: 1280, height: 720 })).toBe("1280\u00D7720")
    expect(pictureFact({ width: 0, height: 0 })).toBe("")
    expect(pictureFact(null)).toBe("")
  })
})

describe("the sheet's standing line", () => {
  it("the pen writes, and says which button rubs out", () => {
    expect(sheetLine(sheet())).toBe("Pen writing · hold button 1 to erase")
    expect(sheetLine(sheet({ rubButton: "second" }))).toBe("Pen writing · hold button 2 to erase")
    expect(sheetLine(sheet({ rubButton: null }))).toBe("Pen writing")
  })
  it("the eraser names the key that puts it down, as this machine writes it", () => {
    expect(sheetLine(sheet({ eraser: true }))).toBe("Erasing: touch a stroke (Erase Tool, Ctrl+Alt+2, with the pen over the sheet turns it off)")
    expect(sheetLine(sheet({ eraser: true, eraseKey: "Cmd+Alt+2" }))).toContain("Cmd+Alt+2")
    expect(sheetLine(sheet({ eraser: true, eraseKey: "" }))).toBe("Erasing: touch a stroke (Select turns it off)")
  })
  it("select, a drawing cell's sheet, and a remark from the binding", () => {
    expect(sheetLine(sheet({ select: true }))).toBe("Selecting · the pen or the mouse boxes a part")
    expect(sheetLine(sheet({ bound: { title: "Demo", away: false } }))).toBe("Drawing cell of \u201CDemo\u201D · what you write is written into the note (Undo is the note's)")
    expect(sheetLine(sheet({ bound: { title: "Demo", away: true } }))).toContain("that note is not open")
    expect(sheetLine(sheet({ notice: "That cell is gone" }))).toBe("That cell is gone · Pen writing · hold button 1 to erase")
  })
})

describe("toasts", () => {
  it("a capture says what came in and where: ✓ Writing added to Demo note", () => {
    expect(capturedToast("ink", "Demo note")).toEqual({ kind: "ok", text: "\u2713 Writing added to Demo note" })
    expect(capturedToast("page", "Demo note").text).toBe("\u2713 Image added to Demo note")
    expect(capturedToast("raw", null).text).toBe("\u2713 Raw picture added")
    expect(capturedToast("cell", " ").text).toBe("\u2713 Drawing cell added")
  })
  it("what is worth saying about it follows, one line", () => {
    expect(capturedToast("ink", "Demo", ["Read a flow chart: 3 nodes, 2 labelled.", null, ""]).text)
      .toBe("\u2713 Writing added to Demo · Read a flow chart: 3 nodes, 2 labelled")
  })
  it("an error is sentence-cased with no closing full stop", () => {
    expect(errorToast("nothing written in that box").text).toBe("Nothing written in that box")
    expect(errorToast("That box is not on the picture.")).toEqual({ kind: "error", text: "That box is not on the picture" })
  })
  it("a result is a tick and the words; a busy one ends in an ellipsis", () => {
    expect(doneToast("copied as a drawing cell").text).toBe("\u2713 Copied as a drawing cell")
    expect(busyToast("Reading...")).toEqual({ kind: "busy", text: "Reading\u2026" })
  })
  it("a raw path is never shown", () => {
    expect(plain("Could not read /Users/sean/Library/Application Support/WriteMind/scans/a1b2.jpg now")).toBe("Could not read that file now")
    expect(plain("Could not open C:\\Users\\Sean\\AppData\\scans\\a1b2.jpg")).toBe("Could not open that file")
    expect(plain("Could not open \\\\server\\share\\a.jpg")).toBe("Could not open that file")
    expect(toastText("failed: /var/folders/9z/x/cam.y4m.")).toBe("Failed: that file")
    // an ordinary slash in words stays
    expect(plain("Writing / Image / Raw and 3/4 of it")).toBe("Writing / Image / Raw and 3/4 of it")
  })
  it("goes by itself: an error lingers a little longer than a result, a busy one has a ceiling", () => {
    expect(toastMs("error")).toBeGreaterThan(toastMs("ok"))
    expect(toastMs("busy")).toBeGreaterThan(toastMs("error"))
  })
})

describe("the camera's name on its tab", () => {
  it("is the label without a vendor id", () => {
    expect(deviceName("FaceTime HD Camera")).toBe("FaceTime HD Camera")
    expect(deviceName("Logitech BRIO (046d:085e)")).toBe("Logitech BRIO")
  })
  it("a label that is a path is no name (a virtual or file-backed device)", () => {
    expect(deviceName("/var/folders/9z/x/chart.y4m")).toBe("")
    expect(deviceName("C:\\feeds\\chart.y4m")).toBe("")
    expect(deviceName("")).toBe("")
  })
})
