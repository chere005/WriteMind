import { describe, expect, it } from "vitest"
import { placement, regionOf, resolveShape, shapeSize } from "@writemind/core"
import { pressAction } from "../src/renderer/penButtons"
import {
  inkExtent, landStrokes, splitByRegion, strokeUnder, TabletPage, type InkStroke,
} from "../src/renderer/tabletPage"
import { initialMenuState, TABLET_SOURCE } from "../src/shared/commands"
import { buildMenu } from "../src/main/menu"

const line = (x0: number, y0: number, x1: number, y1: number, n = 6): InkStroke => ({
  colorHex: "#2D7DD2", width: 3,
  points: Array.from({ length: n }, (_, i) => ({ x: x0 + (x1 - x0) * i / (n - 1), y: y0 + (y1 - y0) * i / (n - 1) })),
  pressures: Array.from({ length: n }, (_, i) => 0.2 + i * 0.1),
})
const pen = { pointerType: "pen", button: 0, buttons: 1 }

describe("what a press of the pen means (penButtons.ts)", () => {
  const selects = { sideButton: "selects" as const, eraser: false }
  const erases = { sideButton: "erases" as const, eraser: false }

  it("draws by default, and the eraser end always erases", () => {
    expect(pressAction(pen, selects)).toBe("draw")
    expect(pressAction({ pointerType: "pen", button: 5, buttons: 32 }, selects)).toBe("erase")
    expect(pressAction({ pointerType: "pen", button: 0, buttons: 33 }, selects)).toBe("erase")
  })
  it("the side button held while the pen touches selects or erases; pressed in the air it does nothing", () => {
    // Windows Ink: the barrel at contact is button 2 with pressure; in the air, no pressure.
    const side = { pointerType: "pen", button: 2, buttons: 2, pressure: 0.5 }
    expect(pressAction(side, selects)).toBe("select")
    expect(pressAction(side, erases)).toBe("erase")
    expect(pressAction({ ...side, pressure: 0 }, erases)).toBe("ignore")
    // Already held at contact: button 0, bit 2 set.
    expect(pressAction({ pointerType: "pen", button: 0, buttons: 3 }, erases)).toBe("erase")
    expect(pressAction({ pointerType: "pen", button: 0, buttons: 3 }, selects)).toBe("select")
  })
  it("the Erase tool makes any pointer erase; a mouse right button is not a pen's side button", () => {
    const tool = { sideButton: "selects" as const, eraser: true }
    expect(pressAction({ pointerType: "mouse", button: 0, buttons: 1 }, tool)).toBe("erase")
    expect(pressAction(pen, tool)).toBe("erase")
    expect(pressAction({ pointerType: "mouse", button: 2, buttons: 2 }, erases)).toBe("draw")
  })
  it("Ctrl selects", () => {
    expect(pressAction({ ...pen, ctrlKey: true }, selects)).toBe("select")
  })
})

describe("the sheet's strokes", () => {
  it("the eraser finds the topmost whole stroke near the pen, and none when far", () => {
    const strokes = [line(0.1, 0.5, 0.9, 0.5), line(0.5, 0.1, 0.5, 0.9)]
    const size = { width: 400, height: 400 }
    expect(strokeUnder(strokes, { x: 0.5, y: 0.5 }, size, 8)).toBe(1)
    expect(strokeUnder(strokes, { x: 0.2, y: 0.5 }, size, 8)).toBe(0)
    expect(strokeUnder(strokes, { x: 0.2, y: 0.8 }, size, 8)).toBe(-1)
  })

  it("a box brings in the part of the writing inside it, cutting a stroke where it leaves", () => {
    const { inside, outside } = splitByRegion([line(0.1, 0.5, 0.9, 0.5, 9)], { x: 0, y: 0, width: 0.5, height: 1 })
    expect(inside).toHaveLength(1)
    expect(outside).toHaveLength(1)
    expect(Math.max(...inside[0]!.points.map((p) => p.x))).toBeLessThanOrEqual(0.5)
    expect(inside[0]!.pressures).toHaveLength(inside[0]!.points.length)
    expect(inside[0]!.points.length + outside[0]!.points.length).toBe(9)
  })

  it("undo and redo walk the stack; an erase is one undo", () => {
    const page = new TabletPage()
    page.add(line(0, 0, 1, 1)); page.add(line(0, 1, 1, 0))
    page.mark(); page.removeAt(0); page.removeAt(0)
    expect(page.strokes).toHaveLength(0)
    expect(page.undo()).toBe(true)
    expect(page.strokes).toHaveLength(2)
    expect(page.redo()).toBe(true)
    expect(page.strokes).toHaveLength(0)
    page.undo(); page.undo(); page.undo()
    expect(page.strokes).toHaveLength(0)
    expect(page.undo()).toBe(false)
  })
})

describe("writing lands on the pane where it was on the sheet, with its pressures", () => {
  const sheet = { width: 450, height: 900 }
  const pane = { width: 900, height: 700 }
  const page = shapeSize(resolveShape(2, null), true)

  it("is the same arithmetic as a camera: relative positions and sizes are kept", () => {
    const strokes = [line(0.2, 0.2, 0.4, 0.2), line(0.2, 0.2, 0.2, 0.4)]
    const region = regionOf({ x: 0, y: 0, width: sheet.width, height: sheet.height }, sheet, sheet)!
    const extent = inkExtent(strokes)!
    const frame = {
      x: extent.x * page.width, y: extent.y * page.height,
      width: extent.width * page.width, height: extent.height * page.height,
    }
    expect(region.width).toBe(1)
    const where = placement({ frame, pageSize: page, pane, nudge: 0 })
    const items = landStrokes(strokes, { surface: sheet, pageSize: page, frame, where, pane })
    expect(items).toHaveLength(2)
    const [a, b] = items.map((i) => (i.kind === "stroke" ? i.stroke : null)!)
    // Both start at the same sheet point, so they start at the same pane point.
    expect(a!.points[0]!.x).toBeCloseTo(b!.points[0]!.x, 9)
    expect(a!.points[0]!.y).toBeCloseTo(b!.points[0]!.y, 9)
    // A horizontal stroke stays horizontal; the pane is wider than the sheet, so lengths scale per axis.
    expect(a!.points.at(-1)!.y).toBeCloseTo(a!.points[0]!.y, 9)
    expect(a!.pressures).toEqual(strokes[0]!.pressures)
    // The writing is centred on the placement (it is all there is).
    const xs = items.flatMap((i) => (i.kind === "stroke" ? i.stroke.points.map((p) => p.x) : []))
    expect((Math.min(...xs) + Math.max(...xs)) / 2).toBeCloseTo(where.center.x, 6)
    // And it came in at the page's scale, not as a full-pane scribble.
    expect(Math.max(...xs) - Math.min(...xs)).toBeLessThan(0.42)
    expect(a!.width).toBeGreaterThanOrEqual(1)
  })
})

describe("Input Devices lists the tablet beside the cameras", () => {
  const run = () => {}
  const devices = (state = {}) => {
    const menu = buildMenu({
      platform: "win32", state: { ...initialMenuState, ...state },
      project: { name: "P", edited: false, folders: [{ path: "/a", name: "a" }] }, run,
    })
    return (menu.find((m) => m.label === "Input Devices")!.submenu as { label?: string; checked?: boolean; id?: string }[])
  }
  it("is an entry that is ticked when it is the source", () => {
    const off = devices({ cameras: [{ id: "c1", name: "Cam" }], cameraId: "c1" })
    expect(off.map((m) => m.label)).toContain("Tablet")
    expect(off.find((m) => m.label === "Tablet")!.checked).toBe(false)
    const on = devices({ cameras: [], cameraId: TABLET_SOURCE })
    expect(on.find((m) => m.label === "Tablet")!.checked).toBe(true)
    expect(on.find((m) => m.label === "Tablet")!.id).toBe(`camera:${TABLET_SOURCE}`)
  })
})
