// The document camera's scanned pages as tabs (renderer/scanSet.ts). Port-only: the Mac has no scanned-page tabs, so
// there is no Swift test to transcribe; these hold the rules the strip and the pane lean on (add / close / rename /
// open, the camera tab that is `current: null`, the box's way back onto the pane) and the list read back tolerantly.
import { describe, expect, it } from "vitest"
import {
  addPage, boxOnPane, closePage, emptySet, MAX_PAGES, nextPageName, parseScans, readKey, renamePage, selectPage,
  serialiseScans, updatePage, type Quad01, type ScanPage, type ScanSet,
} from "../src/renderer/scanSet"

const page = (id: string, extra: Partial<ScanPage> = {}): Omit<ScanPage, "name"> => ({
  id, width: 1920, height: 1080, rotation: 0, box: null, straighten: false, quad: null, shape: null, read: null, ...extra,
})
const three = (): ScanSet => addPage(addPage(addPage(emptySet(), page("a")), page("b")), page("c"))
const names = (set: ScanSet) => set.pages.map((one) => one.name)
const QUAD: Quad01 = {
  topLeft: { x: 0.1, y: 0.1 }, topRight: { x: 0.9, y: 0.12 }, bottomRight: { x: 0.88, y: 0.9 }, bottomLeft: { x: 0.08, y: 0.92 },
}

describe("scanned pages as tabs", () => {
  it("starts with no pages, on the camera", () => {
    expect(emptySet()).toEqual({ pages: [], current: null })
  })

  it("+ keeps Page 1, Page 2 at the end and opens the new one", () => {
    const set = three()
    expect(names(set)).toEqual(["Page 1", "Page 2", "Page 3"])
    expect(set.current).toBe("c")
  })

  it("names a page one past the highest Page N, and keeps a name it was given", () => {
    expect(nextPageName([{ name: "Receipt" }])).toBe("Page 1")
    expect(nextPageName([{ name: "Page 2" }, { name: "Page 9" }, { name: "Page 9b" }])).toBe("Page 10")
    expect(names(addPage(emptySet(), { ...page("a"), name: "  Lecture\n 4 " }))).toEqual(["Lecture 4"])
  })

  it("adds nothing past the limit, or for an id that is empty or taken", () => {
    let set = emptySet()
    for (let i = 0; i < MAX_PAGES + 5; i++) set = addPage(set, page(`p${i}`))
    expect(set.pages).toHaveLength(MAX_PAGES)
    const same = three()
    expect(addPage(same, page("b"))).toBe(same)
    expect(addPage(same, page(""))).toBe(same)
  })

  it("closing the open page opens its right-hand neighbour, else the left, else the camera", () => {
    expect(closePage(selectPage(three(), "b"), "b").current).toBe("c")
    expect(closePage(three(), "c").current).toBe("b")
    // Another page closed: the open one stays open.
    expect(closePage(three(), "a").current).toBe("c")
    expect(closePage(addPage(emptySet(), page("only")), "only")).toEqual({ pages: [], current: null })
    // Closing a page that is not there changes nothing.
    const set = three()
    expect(closePage(set, "nope")).toBe(set)
  })

  it("opens a page or the camera, and only a page that is there", () => {
    const set = three()
    expect(selectPage(set, null).current).toBeNull()
    expect(selectPage(selectPage(set, null), "a").current).toBe("a")
    expect(selectPage(set, "nope")).toBe(set)
    expect(selectPage(set, "c")).toBe(set)
    const onCamera = selectPage(set, null)
    expect(selectPage(onCamera, null)).toBe(onCamera)
  })

  it("renames with a clean name; an empty one changes nothing", () => {
    const set = three()
    expect(names(renamePage(set, "b", " Maths\n notes "))).toEqual(["Page 1", "Maths notes", "Page 3"])
    expect(renamePage(set, "b", "   ")).toBe(set)
    expect(renamePage(set, "zz", "X")).toBe(set)
    expect(renamePage(set, "b", "Page 2")).toBe(set)
  })

  it("updates one page, and is the same set when nothing differs (so nothing is saved for nothing)", () => {
    const set = three()
    const boxed = updatePage(set, "b", { box: { x: 0.1, y: 0.2, width: 0.5, height: 0.4 }, straighten: true, quad: QUAD })
    expect(boxed.pages[1]!.box).toEqual({ x: 0.1, y: 0.2, width: 0.5, height: 0.4 })
    expect(boxed.pages[0]!.box).toBeNull()
    expect(updatePage(boxed, "b", { straighten: true })).toBe(boxed)
    expect(updatePage(set, "nope", { straighten: true })).toBe(set)
    expect(boxed.current).toBe("c")
  })
})

describe("the box on the pane, and what a reading was read through", () => {
  const pane = { width: 800, height: 600 }

  it("puts a box kept as fractions back where the picture is shown (letterboxed, and through a zoom)", () => {
    // A 4:3 frame fills the 800 x 600 pane: a box over its middle quarter is the pane's middle quarter.
    expect(boxOnPane({ x: 0.25, y: 0.25, width: 0.5, height: 0.5 }, { width: 640, height: 480 }, pane, null))
      .toEqual({ x: 200, y: 150, width: 400, height: 300 })
    // A square frame is fitted whole, centred: 600 wide with 100 either side.
    const square = boxOnPane({ x: 0, y: 0, width: 1, height: 1 }, { width: 500, height: 500 }, pane, null)!
    expect(square).toEqual({ x: 100, y: 0, width: 600, height: 600 })
    // Zoomed into the pane's middle quarter, that same box is drawn twice the size.
    const zoomed = boxOnPane({ x: 0.25, y: 0.25, width: 0.5, height: 0.5 }, { width: 640, height: 480 }, pane, { x: 0.25, y: 0.25, width: 0.5, height: 0.5 })!
    expect(zoomed.width).toBeCloseTo(800, 6)
    expect(zoomed.height).toBeCloseTo(600, 6)
    expect(boxOnPane({ x: 0, y: 0, width: 1, height: 1 }, { width: 0, height: 0 }, pane, null)).toBeNull()
  })

  it("reads the same key for the same box, corners and turn, and another for any change of them", () => {
    const box = { x: 0.1, y: 0.2, width: 0.3, height: 0.4 }
    const key = readKey(box, QUAD, 90)
    expect(readKey({ ...box, x: 0.1000001 }, QUAD, 90)).toBe(key)
    expect(readKey({ ...box, x: 0.2 }, QUAD, 90)).not.toBe(key)
    expect(readKey(box, null, 90)).not.toBe(key)
    expect(readKey(box, { ...QUAD, topLeft: { x: 0.2, y: 0.1 } }, 90)).not.toBe(key)
    expect(readKey(box, QUAD, 0)).not.toBe(key)
    expect(readKey(null, null, 0)).not.toBe(readKey(box, null, 0))
  })
})

describe("scanned pages on disk", () => {
  const stored = (): ScanSet => {
    let set = addPage(emptySet(), page("a"))
    set = addPage(set, { ...page("b", { width: 1280, height: 720, rotation: 270, straighten: true, quad: QUAD, shape: 1.41421356 }), name: "Receipt" })
    set = updatePage(set, "b", { box: { x: 0.123456789, y: 0.2, width: 0.5, height: 0.4 }, read: { key: readKey(null, null, 270), lines: ["Total 12.40", "Thank you"] } })
    return set
  }

  it("round-trips the pages, their box, corners, turn, learned shape and reading, and opens on the camera", () => {
    const back = parseScans(serialiseScans(stored()))!
    expect(back.current).toBeNull()
    expect(back.pages.map((one) => [one.id, one.name, one.width, one.height, one.rotation])).toEqual([
      ["a", "Page 1", 1920, 1080, 0], ["b", "Receipt", 1280, 720, 270],
    ])
    const [, second] = back.pages
    expect(second!.box!.x).toBeCloseTo(0.1235, 9)
    expect(second!.straighten).toBe(true)
    expect(second!.quad).toEqual(QUAD)
    expect(second!.shape).toBeCloseTo(1.41421, 5)
    expect(second!.read).toEqual({ key: readKey(null, null, 270), lines: ["Total 12.40", "Thank you"] })
    expect(back.pages[0]).toMatchObject({ box: null, straighten: false, quad: null, shape: null, read: null })
  })

  it("reads garbage as nothing, so the caller keeps what it has; no pages is a list", () => {
    for (const text of [null, "", "{", "[]", "42", '{"pages":7}', '{"sheets":[]}']) {
      expect(parseScans(text), String(text)).toBeNull()
    }
    expect(parseScans('{"pages":[]}')).toEqual({ pages: [], current: null })
  })

  it("drops a page that cannot be found or placed, and keeps the rest with safe fields", () => {
    const back = parseScans(JSON.stringify({
      pages: [
        {
          id: "a", name: "", w: 640, h: 480, turn: 95, box: { x: -1, y: 0.5, width: 5, height: 0.2 }, quad: { topLeft: { x: 0, y: 0 } },
          shape: 0.4, read: { key: 5, lines: [] }, straighten: "yes",
        },
        { id: "a", name: "Twin", w: 640, h: 480 },
        { id: "../evil", w: 640, h: 480 },
        { id: "nosize", w: 0, h: 480 },
        { id: "c", w: 100000, h: 480 },
        { name: "No id", w: 1, h: 1 },
        "nonsense",
        { id: "d", name: "Kept", w: 800, h: 600, turn: -90, box: { x: 0.2, y: 0.2, width: 0.001, height: 0.5 } },
      ],
    }))!
    expect(back.pages.map((one) => one.id)).toEqual(["a", "d"])
    expect(back.pages[0]).toMatchObject({ name: "Page 1", rotation: 90, box: { x: 0, y: 0.5, width: 1, height: 0.2 }, quad: null, shape: null, read: null, straighten: false })
    expect(back.pages[1]).toMatchObject({ name: "Kept", rotation: 270, box: null })
  })

  it("keeps no more pages than may be kept", () => {
    const pages = Array.from({ length: MAX_PAGES + 7 }, (_, i) => ({ id: `p${i}`, w: 10, h: 10 }))
    expect(parseScans(JSON.stringify({ pages }))!.pages).toHaveLength(MAX_PAGES)
  })
})
