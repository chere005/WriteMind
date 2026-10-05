// The tablet sheet and the note follow each other (renderer/sheetFollow.ts; Sean, 2026-10-05) and the last plain sheet
// kept with the sheets (sheetSet.ts `plain`). Port-only: the Mac has no tablet sheet, so no Swift test to transcribe.
import { afterEach, describe, expect, it, vi } from "vitest"
import { newInkCell, type Drawing } from "@writemind/core"
import { pickTab, rememberPlain, sheetForFront, type FollowSheets } from "../src/renderer/sheetFollow"
import { parseSheets, serialiseSheets } from "../src/renderer/sheetSet"
import { DEFAULT_PAPER } from "../src/renderer/tabletPaper"

const A = "C:/notes/Physics.md", B = "C:/notes/Maths.md", C = "C:/notes/Other.md"
const CELL_A = "11111111-2222-4333-8444-555555555555", CELL_B = "66666666-7777-4888-9999-aaaaaaaaaaaa"
const tabs: FollowSheets["tabs"] = [
  { id: "s1", cell: null },
  { id: "pa", cell: { note: A, cell: CELL_A } },
  { id: "s2", cell: null },
  { id: "pb", cell: { note: B, cell: CELL_B } },
]
const on = (current: string, list = tabs): FollowSheets => ({ tabs: list, current })

describe("picking a tab", () => {
  it("a plain tab opens at once, whatever note is in front", () => {
    expect(pickTab(on("pa"), "s2", A)).toEqual({ kind: "open", id: "s2", cell: null })
  })
  it("a tab bound to the note in front opens at once, with its cell (to show it)", () => {
    expect(pickTab(on("s1"), "pa", A)).toEqual({ kind: "open", id: "pa", cell: { note: A, cell: CELL_A } })
  })
  it("a tab bound to another note brings that note first", () => {
    expect(pickTab(on("s1"), "pb", A)).toEqual({ kind: "bring", id: "pb", cell: { note: B, cell: CELL_B } })
    expect(pickTab(on("s1"), "pa", null)).toEqual({ kind: "bring", id: "pa", cell: { note: A, cell: CELL_A } })
  })
  it("a tab that is not there does nothing", () => {
    expect(pickTab(on("s1"), "gone", A)).toBeNull()
  })
})

describe("remembering the last plain tab", () => {
  it("is the open tab when that is plain", () => {
    expect(rememberPlain(on("s2"), "s1")).toBe("s2")
  })
  it("stays as it was while a bound tab is open", () => {
    expect(rememberPlain(on("pa"), "s2")).toBe("s2")
    expect(rememberPlain(on("pa"), null)).toBeNull()
  })
})

describe("a note coming to the front", () => {
  it("a plain tab open: nothing moves", () => {
    expect(sheetForFront(on("s2"), C, "s1")).toEqual({ kind: "keep" })
  })
  it("the bound tab's own note: nothing moves", () => {
    expect(sheetForFront(on("pa"), A, "s1")).toEqual({ kind: "keep" })
  })
  it("another note: back to the last plain tab", () => {
    expect(sheetForFront(on("pa"), B, "s2")).toEqual({ kind: "open", id: "s2" })
    expect(sheetForFront(on("pa"), C, "s1")).toEqual({ kind: "open", id: "s1" })
  })
  it("no note in front (the last tab closed): back to a plain tab too", () => {
    expect(sheetForFront(on("pa"), null, "s2")).toEqual({ kind: "open", id: "s2" })
  })
  it("the remembered tab gone, or bound since: the first plain tab", () => {
    expect(sheetForFront(on("pa"), B, "closed")).toEqual({ kind: "open", id: "s1" })
    expect(sheetForFront(on("pa"), B, "pb")).toEqual({ kind: "open", id: "s1" })
    expect(sheetForFront(on("pa"), B, null)).toEqual({ kind: "open", id: "s1" })
  })
  it("no plain tab at all: a new one", () => {
    const bound = tabs.filter((tab) => tab.cell)
    expect(sheetForFront(on("pa", bound), B, "s1")).toEqual({ kind: "new" })
  })
  it("the note a picked tab waits for: that tab opens", () => {
    expect(sheetForFront(on("s1"), B, "s1", { sheet: "pb", note: B })).toEqual({ kind: "open", id: "pb" })
    // ...from a bound tab of another note too (the picked tab, not the plain one).
    expect(sheetForFront(on("pa"), B, "s1", { sheet: "pb", note: B })).toEqual({ kind: "open", id: "pb" })
  })
  it("another note than the one waited for: the usual rule (the wait goes on)", () => {
    expect(sheetForFront(on("pa"), C, "s2", { sheet: "pb", note: B })).toEqual({ kind: "open", id: "s2" })
    expect(sheetForFront(on("s1"), C, "s2", { sheet: "pb", note: B })).toEqual({ kind: "keep" })
  })
  it("the waited-for tab gone or let go of its cell: the usual rule", () => {
    const unbound = tabs.map((tab) => (tab.id === "pb" ? { ...tab, cell: null } : tab))
    expect(sheetForFront(on("pa", unbound), B, "s2", { sheet: "pb", note: B })).toEqual({ kind: "open", id: "s2" })
    expect(sheetForFront(on("pa"), B, "s2", { sheet: "closed", note: B })).toEqual({ kind: "open", id: "s2" })
  })

  it("no loop: a pick only brings a note, and that note in front keeps the picked tab", () => {
    // Pick pb with A in front: the note comes, then the tab opens; B in front with pb open changes nothing more.
    const pick = pickTab(on("s1"), "pb", A)
    expect(pick?.kind).toBe("bring")
    const move = sheetForFront(on("s1"), B, "s1", { sheet: "pb", note: B })
    expect(move).toEqual({ kind: "open", id: "pb" })
    expect(sheetForFront(on("pb"), B, "s1")).toEqual({ kind: "keep" })
    // A note coming to the front only ever opens a plain tab (or the picked one): picking a plain tab brings nothing.
    expect(pickTab(on("s1"), "s1", B)).toEqual({ kind: "open", id: "s1", cell: null })
  })
})

describe("the last plain tab on disk", () => {
  const sheet = (id: string, cell?: { note: string; cell: string }) =>
    ({ id, name: id, paper: DEFAULT_PAPER, strokes: [], ...(cell ? { cell } : {}) })
  it("is written and read back", () => {
    const text = serialiseSheets({ current: "pa", plain: "s2", sheets: [sheet("s1"), sheet("pa", { note: A, cell: CELL_A }), sheet("s2")] })
    expect(JSON.parse(text).plain).toBe("s2")
    expect(parseSheets(text)?.plain).toBe("s2")
  })
  it("is dropped when it names no sheet, or a bound one; absent is absent", () => {
    const base = { current: "s1", sheets: [sheet("s1"), sheet("pa", { note: A, cell: CELL_A })] }
    expect(parseSheets(serialiseSheets({ ...base, plain: "gone" }))?.plain).toBeUndefined()
    expect(parseSheets(serialiseSheets({ ...base, plain: "pa" }))?.plain).toBeUndefined()
    expect(JSON.parse(serialiseSheets(base)).plain).toBeUndefined()
    expect(parseSheets(serialiseSheets(base))).not.toHaveProperty("plain")
  })
})

// MARK: - Live: tabletSheets.ts + cellSheets.ts against a fake app

describe("live: the sheet tabs and the notes", () => {
  async function live() {
    vi.resetModules()
    const store = new Map<string, string>()
    vi.stubGlobal("localStorage", { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => { store.set(k, v) } })
    vi.stubGlobal("window", {
      screen: { width: 1600, height: 1000 },
      addEventListener: () => undefined, removeEventListener: () => undefined,
    })
    const sheets = await import("../src/renderer/tabletSheets")
    const cells = await import("../src/renderer/cellSheets")
    const files: Record<string, Drawing> = {
      [A]: { items: [{ kind: "cell", cell: newInkCell(600, CELL_A) }] },
      [B]: { items: [{ kind: "cell", cell: newInkCell(600, CELL_B) }] },
      [C]: { items: [] },
    }
    const app = { note: A as string | null, brought: [] as string[], revealed: [] as string[], fail: null as string | null }
    const drawingOf = (note: string | null): Drawing => (note ? files[note] ?? { items: [] } : { items: [] })
    cells.setCellSheetHost({
      front: () => (app.note ? { note: app.note, drawing: drawingOf(app.note) } : null),
      edit: () => undefined,
      width: () => 600,
      title: (note) => note.split("/").pop()!.replace(/\.md$/, ""),
      showTablet: () => undefined,
      bring: async (note) => { app.brought.push(note); if (app.fail) throw new Error(app.fail) },
      reveal: (ref) => { app.revealed.push(ref.cell) },
    })
    /** A note comes to the front (App.tsx's effect on the note in front). */
    const to = (note: string | null) => { app.note = note; cells.cellSheetsSaw(note, drawingOf(note)) }
    to(A)
    const name = () => sheets.sheetTabs().tabs.find((tab) => tab.id === sheets.sheetTabs().current)?.name
    return { sheets, cells, app, to, name }
  }

  afterEach(() => { vi.unstubAllGlobals() })

  it("a picked bound tab brings its note, opens when it is there, and other notes send the sheet back", async () => {
    const { sheets, cells, app, to, name } = await live()
    const plain = sheets.sheetTabs().current
    // Sheet 1 (plain) and Sheet 2 (plain, the last open), then A's and B's drawing tabs, each opened from its cell.
    sheets.addSheet()
    const sheet2 = sheets.sheetTabs().current
    expect(cells.openInTabletSheet(CELL_A)).toBe(true)
    const pa = sheets.sheetTabs().current
    expect(name()).toBe("Physics Drawing")
    to(B)
    expect(sheets.sheetTabs().current).toBe(sheet2)
    expect(cells.openInTabletSheet(CELL_B)).toBe(true)
    const pb = sheets.sheetTabs().current
    expect(sheets.lastPlainSheet()).toBe(sheet2)

    // A click on A's tab with B in front: A is brought; the sheet stays until A is there.
    expect(sheets.selectSheet(pa)).toBe(true)
    expect(app.brought).toEqual([A])
    expect(sheets.sheetTabs().current).toBe(pb)
    await Promise.resolve()
    to(A)
    expect(sheets.sheetTabs().current).toBe(pa)
    expect(app.revealed).toEqual([CELL_A])
    // A in front again (drawn again): nothing moves; picking A's tab now opens it without bringing anything.
    to(A)
    expect(sheets.sheetTabs().current).toBe(pa)
    sheets.selectSheet(pa)
    expect(app.brought).toEqual([A])

    // Another note (no drawing tab): back to the last plain tab, its ink untouched.
    to(C)
    expect(sheets.sheetTabs().current).toBe(sheet2)
    // Pen ▸ Next Sheet from Sheet 2: A's tab, so A is brought, and opens when it comes.
    expect(sheets.stepSheet(1)).toBe(true)
    expect(app.brought).toEqual([A, A])
    // ...and Next again while A is on its way steps on from A's tab: B's.
    sheets.stepSheet(1)
    expect(app.brought).toEqual([A, A, B])
    to(A)
    // A came, but B was asked for last: A's tab is not opened (and the plain tab stays: no bound tab of a note away).
    expect(sheets.sheetTabs().current).toBe(sheet2)
    to(B)
    expect(sheets.sheetTabs().current).toBe(pb)
    // A plain tab picked by hand: it opens, nothing is brought; then other notes and B again change nothing.
    sheets.selectSheet(plain)
    to(C)
    to(B)
    expect(sheets.sheetTabs().current).toBe(plain)
    expect(sheets.lastPlainSheet()).toBe(plain)
    expect(app.brought).toEqual([A, A, B])
    // Each note to the front moved the sheet at most once: no loop.
    expect(cells.followCounts()).toMatchObject({ follows: 2, arrivals: 2, brings: 3 })
  })

  it("the bound note's tab closed (no note in front): back to a plain tab; no plain tab left: a new Sheet 1", async () => {
    const { sheets, cells, to, name } = await live()
    const first = sheets.sheetTabs().current
    expect(cells.openInTabletSheet(CELL_A)).toBe(true)
    sheets.closeSheet(first)
    expect(sheets.sheetTabs().tabs.every((tab) => tab.cell)).toBe(true)
    to(null)
    expect(name()).toBe("Sheet 1")
    expect(sheets.sheetTabs().tabs.find((tab) => tab.id === sheets.sheetTabs().current)?.cell).toBeNull()
    expect(sheets.sheetTabs().tabs).toHaveLength(2)
  })

  it("a picked tab whose note is gone: nothing is switched; the tab lets go of its cell and opens as a plain sheet", async () => {
    const { sheets, cells, app, to } = await live()
    const plain = sheets.sheetTabs().current
    expect(cells.openInTabletSheet(CELL_A)).toBe(true)
    const pa = sheets.sheetTabs().current
    to(C)
    expect(sheets.sheetTabs().current).toBe(plain)
    app.fail = "ENOENT: no such file or directory"
    sheets.selectSheet(pa)
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(app.note).toBe(C)
    const tab = sheets.sheetTabs().tabs.find((one) => one.id === pa)!
    expect(tab.cell).toBeNull()
    expect(tab.notice).toMatch(/is gone/)
    expect(sheets.sheetTabs().current).toBe(pa)
  })

  it("the open tab closed and its neighbour bound to a note away: a plain tab opens instead (gate)", async () => {
    const { sheets, cells, to } = await live()
    const first = sheets.sheetTabs().current
    to(B)
    expect(cells.openInTabletSheet(CELL_B)).toBe(true)
    const pb = sheets.sheetTabs().current
    to(A)
    expect(sheets.sheetTabs().current).toBe(first)
    // Sheet 1 is open, B's tab is its right-hand neighbour: closing Sheet 1 must not leave B's tab open with A in front.
    sheets.closeSheet(first)
    const now = sheets.sheetTabs().tabs.find((tab) => tab.id === sheets.sheetTabs().current)!
    expect(now.id).not.toBe(pb)
    expect(now.cell).toBeNull()
    // A's own tab as the neighbour stays open (its note is in front).
    expect(cells.openInTabletSheet(CELL_A)).toBe(true)
    const pa = sheets.sheetTabs().current
    sheets.addSheet()
    const extra = sheets.sheetTabs().current
    sheets.selectSheet(now.id)
    expect(sheets.sheetTabs().current).toBe(now.id)
    sheets.closeSheet(now.id)
    expect(sheets.sheetTabs().current).toBe(pa)
    expect(sheets.sheetTabs().tabs.some((tab) => tab.id === extra)).toBe(true)
  })

  it("a pick whose note was brought, then another note in front: the pick is over (gate)", async () => {
    const { sheets, cells, app, to } = await live()
    const plain = sheets.sheetTabs().current
    expect(cells.openInTabletSheet(CELL_A)).toBe(true)
    const pa = sheets.sheetTabs().current
    to(C)
    expect(sheets.sheetTabs().current).toBe(plain)
    sheets.selectSheet(pa)
    expect(app.brought).toEqual([A])
    await new Promise((resolve) => setTimeout(resolve, 0))
    // The person went to C before A arrived (A's open lost the race): the wait ends...
    to(B)
    expect(cells.followCounts().waiting).toBeNull()
    // ...so A coming to the front later by hand opens nothing by itself, and Next Sheet steps from the open tab.
    to(A)
    expect(sheets.sheetTabs().current).toBe(plain)
  })
})
