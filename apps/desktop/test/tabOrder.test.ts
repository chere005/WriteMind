// REARRANGING TABS (Sean, 2026-10-10: "add rearranging tabs"): the rules a drag, Move Tab Left / Right and the keys lean on, as plain
// data (renderer/tabOrder.ts) — where a tab goes, which slot a dragged tab is over, how far the others step aside, how fast a drag
// at the row's end scrolls it — and the promise that the order is KEPT: the notebook's open notes through the session file, the
// tablet's sheets and the camera's kept pages through theirs. Port-only: the Mac has no draggable tabs, so no Swift test to transcribe.
import { describe, expect, it } from "vitest"
import { emptySession, makeNote, readSession, remembering, surviving, writeSession, type Note, type Session } from "@writemind/core"
import {
  canStep, clampShift, DRAG_THRESHOLD, dropIndex, edgeScroll, moveItem, moveKeyed, outOfRow, pastThreshold, shiftRange, slideBy, stepKeyed,
  type Slot,
} from "../src/renderer/tabOrder"
import { addPage, emptySet, movePage, parseScans, selectPage, serialiseScans, type ScanPage } from "../src/renderer/scanSet"
import { addSheet, firstSet, moveSheet, parseSheets, selectSheet, serialiseSheets, type StoredSheets } from "../src/renderer/sheetSet"
import { DEFAULT_PAPER } from "../src/renderer/tabletPaper"

describe("moving an item to a slot", () => {
  it("takes it out and puts it back so that it ends at that slot", () => {
    const list = ["a", "b", "c", "d"]
    expect(moveItem(list, 0, 2)).toEqual(["b", "c", "a", "d"])
    expect(moveItem(list, 3, 1)).toEqual(["a", "d", "b", "c"])
    expect(moveItem(list, 1, 0)).toEqual(["b", "a", "c", "d"])
    expect(moveItem(list, 2, 3)).toEqual(["a", "b", "d", "c"])
    // (the list it was given is not touched)
    expect(list).toEqual(["a", "b", "c", "d"])
  })

  it("clamps the slot to the list: past either end is the end", () => {
    expect(moveItem(["a", "b", "c"], 1, 99)).toEqual(["a", "c", "b"])
    expect(moveItem(["a", "b", "c"], 1, -4)).toEqual(["b", "a", "c"])
    expect(moveItem(["a", "b", "c"], 0, 2.9)).toEqual(["b", "c", "a"])
  })

  it("is the SAME array when nothing moves, so a stored result is not a change", () => {
    const list = ["a", "b", "c"]
    expect(moveItem(list, 1, 1)).toBe(list)
    expect(moveItem(list, 2, 40)).toBe(list)
    expect(moveItem(list, 0, -1)).toBe(list)
    expect(moveItem(list, -1, 1)).toBe(list)
    expect(moveItem(list, 3, 0)).toBe(list)
    expect(moveItem(list, 1, Number.NaN)).toBe(list)
    expect(moveItem([], 0, 0)).toEqual([])
  })

  it("finds the item by its key: the same list for a key that is not there", () => {
    const notes = ["/n/a.wm", "/n/b.wm", "/n/c.wm"].map((path) => ({ path }))
    const moved = moveKeyed(notes, (note) => note.path, "/n/c.wm", 0)
    expect(moved.map((note) => note.path)).toEqual(["/n/c.wm", "/n/a.wm", "/n/b.wm"])
    // (the same objects, not copies: a tab keeps its title and its identity)
    expect(moved[1]).toBe(notes[0])
    expect(moveKeyed(notes, (note) => note.path, "/n/zzz.wm", 0)).toBe(notes)
  })

  it("steps one place either way, and not past the end (Move Tab Left / Right at the ends do nothing)", () => {
    const list = ["a", "b", "c"]
    const key = (one: string) => one
    expect(stepKeyed(list, key, "b", -1)).toEqual(["b", "a", "c"])
    expect(stepKeyed(list, key, "b", 1)).toEqual(["a", "c", "b"])
    expect(stepKeyed(list, key, "a", -1)).toBe(list)
    expect(stepKeyed(list, key, "c", 1)).toBe(list)
    expect(stepKeyed(list, key, "zzz", 1)).toBe(list)
    expect(canStep(3, 0, -1)).toBe(false)
    expect(canStep(3, 0, 1)).toBe(true)
    expect(canStep(3, 2, 1)).toBe(false)
    expect(canStep(3, 2, -1)).toBe(true)
    // no tab in front, or one tab: nowhere to go
    expect(canStep(3, -1, 1)).toBe(false)
    expect(canStep(1, 0, 1)).toBe(false)
    expect(canStep(1, 0, -1)).toBe(false)
    expect(canStep(0, 0, 1)).toBe(false)
  })
})

/** Five tabs of different widths, edge to edge from 10: a 100, b 150, c 84, d 190, e 100. */
const slots = (): Slot[] => {
  let left = 10
  return [100, 150, 84, 190, 100].map((width) => { const one = { left, width }; left += width; return one })
}

describe("which slot a dragged tab is over", () => {
  it("stays where it is until its centre passes the middle between its slot and the next one", () => {
    // b (150 wide, at 110) has its centre at 185; the slot before it has its centre at 85, the one after at 269 (c, 84 wide,
    // has stepped left of it): the changeover is the middle of those, 227 for the next slot (b moved right by 42) and 135 for
    // the one before (b moved left by 50). Exactly on a middle it is a tie, and a tie goes to the lower slot.
    expect(dropIndex(slots(), 1, 0)).toBe(1)
    expect(dropIndex(slots(), 1, 30)).toBe(1)
    expect(dropIndex(slots(), 1, 41)).toBe(1)
    expect(dropIndex(slots(), 1, 42)).toBe(1)
    expect(dropIndex(slots(), 1, 43)).toBe(2)
    expect(dropIndex(slots(), 1, 120)).toBe(2)
    expect(dropIndex(slots(), 1, -40)).toBe(1)
    expect(dropIndex(slots(), 1, -49)).toBe(1)
    expect(dropIndex(slots(), 1, -51)).toBe(0)
  })

  it("is the first slot at the far left and the last at the far right, however far the pointer went", () => {
    expect(dropIndex(slots(), 3, -5000)).toBe(0)
    expect(dropIndex(slots(), 0, 5000)).toBe(4)
    expect(dropIndex(slots(), 2, 5000)).toBe(4)
  })

  it("moves one tab to the end and back, and answers for a lone tab or a tab that is not there", () => {
    expect(dropIndex(slots(), 0, 600)).toBe(4)
    expect(dropIndex(slots(), 4, -600)).toBe(0)
    expect(dropIndex([{ left: 0, width: 100 }], 0, 500)).toBe(0)
    expect(dropIndex(slots(), 9, 10)).toBe(9)
  })

  it("is the slot the dragged tab would land in: what slideBy then lays out puts its centre nearest the pointer's", () => {
    // for every pointer position, the slot chosen is the nearest of all the slots the tab could take
    const row = slots()
    for (const from of [0, 2, 4]) {
      for (let shift = -500; shift <= 500; shift += 7) {
        const chosen = dropIndex(row, from, shift)
        const centre = row[from]!.left + row[from]!.width / 2 + shift
        const centreOf = (slot: number) => {
          const rest = row.filter((_, index) => index !== from)
          return row[0]!.left + rest.slice(0, slot).reduce((sum, one) => sum + one.width, 0) + row[from]!.width / 2
        }
        const best = Math.min(...row.map((_, slot) => Math.abs(centreOf(slot) - centre)))
        expect(Math.abs(centreOf(chosen) - centre)).toBeCloseTo(best, 9)
      }
    }
  })
})

describe("the tabs stepping aside", () => {
  it("moves the tabs it passed by its width, and lays the dragged tab in its slot", () => {
    const row = slots()
    // a dragged to slot 2 (over b and c): b and c step left by a's width (100); a rests where it will land (150 + 84 further)
    expect(slideBy(row, 0, 2)).toEqual([234, -100, -100, 0, 0])
    // d dragged left over c and b to slot 1: b and c step right by d's width (190); d rests 150 + 84 to the left
    expect(slideBy(row, 3, 1)).toEqual([0, 190, 190, -234, 0])
    // nothing passed: nothing moves
    expect(slideBy(row, 2, 2)).toEqual([0, 0, 0, 0, 0])
  })

  it("never leaves a gap or an overlap: the laid-out tabs are edge to edge from the first slot", () => {
    const row = slots()
    for (const from of [0, 1, 2, 3, 4]) {
      for (const to of [0, 1, 2, 3, 4]) {
        const slide = slideBy(row, from, to)
        const placed = row.map((one, index) => ({ left: one.left + slide[index]!, width: one.width })).sort((a, b) => a.left - b.left)
        expect(placed[0]!.left).toBe(row[0]!.left)
        for (let i = 1; i < placed.length; i++) expect(placed[i]!.left).toBe(placed[i - 1]!.left + placed[i - 1]!.width)
      }
    }
  })

  it("keeps the dragged tab inside the row of tabs: from the first slot's left to the last slot's right", () => {
    const row = slots()
    // (the tabs run from 10 to 634)
    expect(shiftRange(row, 1)).toEqual({ min: -100, max: 374 })
    expect(shiftRange(row, 0)).toEqual({ min: 0, max: 524 })
    expect(shiftRange(row, 4)).toEqual({ min: -524, max: 0 })
    expect(clampShift(-900, shiftRange(row, 1))).toBe(-100)
    expect(clampShift(900, shiftRange(row, 1))).toBe(374)
    expect(clampShift(12, shiftRange(row, 1))).toBe(12)
    expect(shiftRange([], 0)).toEqual({ min: 0, max: 0 })
  })
})

describe("a press, a drag, and the row's edge", () => {
  it("is a click until it has moved a few pixels in any direction", () => {
    expect(DRAG_THRESHOLD).toBeGreaterThanOrEqual(3)
    expect(pastThreshold(0, 0)).toBe(false)
    expect(pastThreshold(2, 1)).toBe(false)
    expect(pastThreshold(DRAG_THRESHOLD, 0)).toBe(true)
    expect(pastThreshold(0, -DRAG_THRESHOLD)).toBe(true)
    expect(pastThreshold(3, 3)).toBe(true)
  })

  it("scrolls the row towards the end the pointer is held near, faster nearer it, and not at all in the middle", () => {
    // the row is 100..500; the edge is the outer 40px of each end
    expect(edgeScroll(300, 100, 500)).toBe(0)
    expect(edgeScroll(141, 100, 500)).toBe(0)
    expect(edgeScroll(120, 100, 500)).toBeLessThan(0)
    expect(edgeScroll(480, 100, 500)).toBeGreaterThan(0)
    expect(Math.abs(edgeScroll(105, 100, 500))).toBeGreaterThan(Math.abs(edgeScroll(130, 100, 500)))
    expect(Math.abs(edgeScroll(495, 100, 500))).toBeGreaterThan(Math.abs(edgeScroll(470, 100, 500)))
    // at the edge and beyond it, the full speed; always at least a pixel a tick once it is in the edge
    expect(edgeScroll(100, 100, 500)).toBe(-18)
    expect(edgeScroll(-300, 100, 500)).toBe(-18)
    expect(edgeScroll(900, 100, 500)).toBe(18)
    expect(edgeScroll(139, 100, 500)).toBe(-1)
    // a row with no width, nothing
    expect(edgeScroll(100, 100, 100)).toBe(0)
  })

  it("lets go outside the row when the pointer is above or below it by more than the slack", () => {
    expect(outOfRow(18, 0, 36)).toBe(false)
    expect(outOfRow(-20, 0, 36)).toBe(false)
    expect(outOfRow(55, 0, 36)).toBe(false)
    expect(outOfRow(-30, 0, 36)).toBe(true)
    expect(outOfRow(61, 0, 36)).toBe(true)
    expect(outOfRow(400, 0, 36)).toBe(true)
  })
})

// THE ORDER IS KEPT. The notebook's tabs are the session's `open` list; the sheets and the pages have files of their own.
describe("the order is kept", () => {
  const note = (name: string): Note => makeNote(`/n/${name}.wm`, 1, `# ${name}\n`)
  const sessionOf = (open: Note[], active: string): Session => {
    let session = emptySession("/n")
    for (const one of open) session = remembering(session, { path: one.path, caret: 0, collapsed: [] })
    return { ...session, active }
  }

  it("the open notes come back from the session file in the order they were dragged to, the one in front still in front", () => {
    const open = ["Alpha", "Bravo", "Charlie", "Delta"].map(note)
    const moved = moveKeyed(open, (one) => one.path, "/n/Delta.wm", 1)
    expect(moved.map((one) => one.title)).toEqual(["Alpha", "Delta", "Bravo", "Charlie"])
    // the note in front is a path, not a place: it is the same note wherever it lands
    const written = writeSession(sessionOf(moved, "/n/Charlie.wm"))
    const back = surviving(readSession(written, "/n"), () => true)
    expect(back.open.map((one) => one.path)).toEqual(["/n/Alpha.wm", "/n/Delta.wm", "/n/Bravo.wm", "/n/Charlie.wm"])
    expect(back.active).toBe("/n/Charlie.wm")
  })

  it("a note that is gone from the disk leaves the others in their dragged order", () => {
    const open = ["Alpha", "Bravo", "Charlie", "Delta"].map(note)
    const moved = moveKeyed(open, (one) => one.path, "/n/Alpha.wm", 3)
    const back = surviving(readSession(writeSession(sessionOf(moved, "/n/Bravo.wm")), "/n"), (path) => path !== "/n/Charlie.wm")
    expect(back.open.map((one) => one.path)).toEqual(["/n/Bravo.wm", "/n/Delta.wm", "/n/Alpha.wm"])
    expect(back.active).toBe("/n/Bravo.wm")
  })

  it("a tab opened or closed after a move does not undo it", () => {
    let open = ["Alpha", "Bravo", "Charlie"].map(note)
    open = moveKeyed(open, (one) => one.path, "/n/Charlie.wm", 0)
    open = [...open, note("Delta")]
    expect(open.map((one) => one.title)).toEqual(["Charlie", "Alpha", "Bravo", "Delta"])
    open = open.filter((one) => one.path !== "/n/Alpha.wm")
    expect(open.map((one) => one.title)).toEqual(["Charlie", "Bravo", "Delta"])
  })

  it("the sheets come back in the order they were dragged to, the open one still open", () => {
    let set = addSheet(addSheet(addSheet(firstSet("a"), "b"), "c"), "d")
    set = selectSheet(set, "b")
    const moved = moveSheet(set, "d", 0)
    expect(moved.tabs.map((tab) => tab.id)).toEqual(["d", "a", "b", "c"])
    expect(moved.current).toBe("b")
    // names, and which one is open, are untouched; the same set when nothing moves
    expect(moved.tabs.find((tab) => tab.id === "d")!.name).toBe("Sheet 4")
    expect(moveSheet(set, "b", 1)).toBe(set)
    expect(moveSheet(set, "zzz", 0)).toBe(set)
    const stored: StoredSheets = {
      current: moved.current,
      sheets: moved.tabs.map((tab) => ({ id: tab.id, name: tab.name, paper: DEFAULT_PAPER, strokes: [] })),
    }
    const back = parseSheets(serialiseSheets(stored))!
    expect(back.sheets.map((sheet) => sheet.id)).toEqual(["d", "a", "b", "c"])
    expect(back.current).toBe("b")
  })

  const page = (id: string): Omit<ScanPage, "name"> =>
    ({ id, width: 1920, height: 1080, rotation: 0, box: null, straighten: false, quad: null, shape: null, read: null })

  it("the kept pages come back in the order they were dragged to; the Camera tab is not one of them, so it stays first", () => {
    let set = addPage(addPage(addPage(emptySet(), page("a")), page("b")), page("c"))
    set = selectPage(set, "b")
    const moved = movePage(set, "c", 0)
    expect(moved.pages.map((one) => one.id)).toEqual(["c", "a", "b"])
    expect(moved.pages.map((one) => one.name)).toEqual(["Page 3", "Page 1", "Page 2"])
    expect(moved.current).toBe("b")
    expect(movePage(set, "b", 1)).toBe(set)
    expect(movePage(set, "zzz", 0)).toBe(set)
    // slot 0 is the first KEPT page: nothing is ever put in front of the Camera tab, whatever slot is asked for
    expect(movePage(set, "b", -5).pages[0]!.id).toBe("b")
    const back = parseScans(serialiseScans(moved))!
    expect(back.pages.map((one) => one.id)).toEqual(["c", "a", "b"])
    // (a launch starts on the camera: which tab is open is not kept)
    expect(back.current).toBeNull()
  })
})
