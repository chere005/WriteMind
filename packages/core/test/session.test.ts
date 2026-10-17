import { describe, expect, it } from "vitest"
import {
  PLACE_WORDS, closing, emptySession, placeIn, placeWords, readPlace, readSession, remembering, sessionFileName, surviving, writeSession,
} from "../src/notes/session"
import { appending, isInside, placing } from "../src/notes/order"
import { foldableKeys, setFolded, snap } from "../src/cells/folding"
import { hiddenRange, hiddenRanges, sections } from "../src/cells/outline"
import { range } from "../src/text/range"

/** Transcribed from `WriteMindTests/ProjectTests.swift` (the session) and `NotebookOutlineTests.swift` (folding). */
describe("the session file", () => {
  it("is named by the folder and a hash of its whole path, so two folders do not share one", () => {
    const one = sessionFileName("C:\\Users\\x\\Documents\\WriteMind")
    const two = sessionFileName("C:\\Users\\y\\Documents\\WriteMind")
    expect(one).not.toBe(two)
    expect(one.endsWith(".json")).toBe(true)
    expect(one).not.toMatch(/[\\/]/)
    expect(sessionFileName("/deep/path/My Notes")).not.toMatch(/[\\/]/)
  })

  it("round-trips", () => {
    let session = emptySession("/notes")
    session = remembering(session, { path: "/notes/a.md", caret: 12, collapsed: ["One"] })
    session = remembering(session, { path: "/notes/b.md", caret: 0, collapsed: [] })
    session = { ...session, active: "/notes/b.md" }
    expect(readSession(writeSession(session))).toEqual(session)
  })

  it("loads an older or damaged file as far as it can", () => {
    expect(readSession(null, "/n")).toEqual(emptySession("/n"))
    expect(readSession("not json", "/n")).toEqual(emptySession("/n"))
    // paths only, no carets: a session cached before carets existed
    const old = readSession(JSON.stringify({ open: ["/a.md", "/b.md"], active: "/a.md" }))
    expect(old.open.map((n) => n.path)).toEqual(["/a.md", "/b.md"])
    expect(old.active).toBe("/a.md")
    expect(old.open[0]).toEqual({ path: "/a.md", caret: 0, collapsed: [] })
    // nonsense entries are dropped, a negative caret is the start
    const odd = readSession(JSON.stringify({ open: [{ path: "/a.md", caret: -4 }, 7, { caret: 3 }], active: "/zzz" }))
    expect(odd.open).toEqual([{ path: "/a.md", caret: 0, collapsed: [] }])
    expect(odd.active).toBe("/a.md")
  })

  it("drops the notes the disk no longer has and moves the front one", () => {
    const session = readSession(JSON.stringify({
      open: [{ path: "/a.md" }, { path: "/b.md" }, { path: "/c.md" }], active: "/c.md",
    }))
    const kept = surviving(session, (path) => path !== "/c.md")
    expect(kept.open.map((n) => n.path)).toEqual(["/a.md", "/b.md"])
    expect(kept.active).toBe("/b.md")
    expect(surviving(session, () => false).active).toBeNull()
  })

  it("closing a tab hands the front to its neighbour", () => {
    const session = readSession(JSON.stringify({
      open: [{ path: "/a.md" }, { path: "/b.md" }, { path: "/c.md" }], active: "/b.md",
    }))
    const next = closing(session, "/b.md")
    expect(next.open.map((n) => n.path)).toEqual(["/a.md", "/c.md"])
    expect(next.active).toBe("/c.md")
    expect(closing(session, "/c.md").active).toBe("/b.md")
    expect(closing(closing(closing(session, "/a.md"), "/b.md"), "/c.md").active).toBeNull()
  })
})

/**
 * Where each note was scrolled to (Sean, 2026-10-16: "remember scroll position when switching tabs or reopening
 * writemind"). Port-only (the Mac's session has no scroll): the place is the text at the top of the page — an offset,
 * how far its line is above the page's edge, and the words there — so it survives a resize, the other pane and an edit
 * made elsewhere. The view's half (put back to the pixel on a tab switch and a restart) is e2e tabs/07 and editor/13.
 */
describe("where a note was scrolled to", () => {
  const note = "# Title\n\nfirst paragraph\n\n## Results\n\nthe second run went well\n\nlast line"
  const at = note.indexOf("the second run")
  const place = { at, offset: 7.5, text: placeWords(note, at) }

  it("round-trips beside the caret, and a note with no place has none", () => {
    let session = emptySession("/notes")
    session = remembering(session, { path: "/notes/a.wm", caret: 12, collapsed: ["One"], scroll: place })
    session = remembering(session, { path: "/notes/b.wm", caret: 3, collapsed: [] })
    session = { ...session, active: "/notes/a.wm" }
    const back = readSession(writeSession(session))
    expect(back).toEqual(session)
    expect(back.open[0]!.scroll).toEqual({ at, offset: 7.5, text: "the second run went well" })
    expect("scroll" in back.open[1]!).toBe(false)
    // (written beside the caret, as the note's own field)
    expect(JSON.parse(writeSession(session)).open[0].scroll).toEqual(place)
  })

  it("an older session file, with no scroll in it, reads as before: the caret's place", () => {
    const old = readSession(JSON.stringify({ open: [{ path: "/a.wm", caret: 40, collapsed: [] }, "/b.wm"], active: "/a.wm" }))
    expect(old.open).toEqual([{ path: "/a.wm", caret: 40, collapsed: [] }, { path: "/b.wm", caret: 0, collapsed: [] }])
  })

  it("junk is no place, and never costs the note its caret", () => {
    for (const junk of [null, 7, "top", [], {}, { at: -1, offset: 0, text: "" }, { at: "12", offset: 0 }, { at: 12 },
      { at: 12, offset: "3" }, { at: Number.NaN, offset: 0 }, { at: 12, offset: Number.POSITIVE_INFINITY }]) {
      const read = readSession(JSON.stringify({ open: [{ path: "/a.wm", caret: 5, collapsed: [], scroll: junk }] }))
      expect(read.open, JSON.stringify(junk)).toEqual([{ path: "/a.wm", caret: 5, collapsed: [] }])
    }
    // what is half right is made right: a fraction of a character, words that are not words, words too long, a wild offset
    expect(readPlace({ at: 12.7, offset: 3, text: 9 })).toEqual({ at: 12, offset: 3, text: "" })
    expect(readPlace({ at: 0, offset: -2e9, text: "x".repeat(500) })).toEqual({ at: 0, offset: -1e5, text: "x".repeat(PLACE_WORDS) })
  })

  it("keeps the words from the place to the end of its line, a line's start at most", () => {
    expect(placeWords(note, at)).toBe("the second run went well")
    expect(placeWords(note, note.indexOf("second"))).toBe("second run went well")
    expect(placeWords("a".repeat(200), 10)).toHaveLength(PLACE_WORDS)
    expect(placeWords(note, note.length)).toBe("")
    expect(placeWords(note, 10_000)).toBe("")
  })

  it("a blank line at the top keeps the words of the line after it, from the blank line on", () => {
    const blank = note.indexOf("\n\nlast") + 1
    expect(placeWords(note, blank)).toBe("\nlast line")
    expect(placeWords("a\n" + "\n".repeat(60) + "b", 2)).toBe("")
    // and they find the blank line again in a note changed above it
    const place = { at: blank, offset: 3, text: placeWords(note, blank) }
    const changed = "A new first line.\n\n" + note
    expect(placeIn(changed, place)).toBe(blank + "A new first line.\n\n".length)
  })

  it("is found where it was when the note is as it was", () => {
    expect(placeIn(note, place)).toBe(at)
  })

  it("follows its words when the note was changed elsewhere: lines came or went above it", () => {
    const more = "# Title\n\nA new line written in another editor.\n\nfirst paragraph\n\n## Results\n\nthe second run went well\n\nlast line"
    expect(placeIn(more, place)).toBe(more.indexOf("the second run"))
    const less = "# Title\n\n## Results\n\nthe second run went well\n\nlast line"
    expect(placeIn(less, place)).toBe(less.indexOf("the second run"))
  })

  it("takes the nearest of words that are there twice", () => {
    const twice = "the second run went well\n" + "x\n".repeat(30) + "the second run went well\n" + "y\n".repeat(30) + "the second run went well"
    const middle = twice.indexOf("the second run", 10)
    expect(placeIn(twice, { at: middle + 4, offset: 0, text: "the second run went well" })).toBe(middle)
    expect(placeIn(twice, { at: twice.length, offset: 0, text: "the second run went well" })).toBe(twice.lastIndexOf("the second run"))
    expect(placeIn(twice, { at: 0, offset: 0, text: "the second run went well" })).toBe(0)
  })

  it("stays inside the note when its words are gone, and does not look for blank words", () => {
    expect(placeIn("short", place)).toBe(5)
    expect(placeIn(note, { at: 3, offset: 0, text: "words that are nowhere" })).toBe(3)
    expect(placeIn("a\n\n\nb", { at: 2, offset: 0, text: "" })).toBe(2)
    expect(placeIn("a\n  \nb", { at: 99, offset: 0, text: "  " })).toBe(6)
  })
})

describe("dragging a row", () => {
  it("takes the target's place, and the dragged row leaves where it was", () => {
    expect(placing(["a", "b", "c", "d"], "d", "b")).toEqual(["a", "d", "b", "c"])
    expect(placing(["a", "b", "c", "d"], "a", "d")).toEqual(["b", "c", "a", "d"])
  })
  it("goes last without a target, or with one that is not there", () => {
    expect(placing(["a", "b"], "a", null)).toEqual(["b", "a"])
    expect(placing(["a", "b"], "c", "zzz")).toEqual(["a", "b", "c"])
  })
  it("a row moved in is appended once", () => {
    expect(appending(["a"], "b")).toEqual(["a", "b"])
    expect(appending(["a", "b"], "b")).toEqual(["a", "b"])
  })
  it("a section cannot be dropped into itself or what is inside it", () => {
    expect(isInside("/n/Ideas", "/n/Ideas")).toBe(true)
    expect(isInside("/n/Ideas/2026", "/n/Ideas")).toBe(true)
    expect(isInside("/n/Ideas2", "/n/Ideas")).toBe(false)
    expect(isInside("C:\\n\\Ideas\\2026", "C:\\n\\Ideas")).toBe(true)
  })
})

describe("folding", () => {
  const hidden = [range(10, 20), range(60, 5)]

  it("a caret going forwards lands after the fold and backwards before it", () => {
    const inside = range(15, 0)
    expect(snap(inside, hidden, false)).toEqual(range(30, 0))
    expect(snap(inside, hidden, true)).toEqual(range(10, 0))
  })
  it("leaves a caret outside every fold where it is", () => {
    for (const location of [0, 10, 30, 45, 65, 100]) {
      expect(snap(range(location, 0), hidden, false)).toEqual(range(location, 0))
    }
  })
  it("does not snap a selection", () => {
    expect(snap(range(15, 4), hidden, false)).toEqual(range(15, 4))
  })
  it("a section's hidden range starts after its heading", () => {
    const note = "# One\n\nbody\n\n# Two\n\nmore"
    const one = sections(note)[0]!
    const r = hiddenRange(one, note.length)
    expect(r.location).toBe(one.headingRange.location + one.headingRange.length)
    const text = note.slice(r.location, r.location + r.length)
    expect(text).toContain("body")
    expect(text).not.toContain("# Two")
  })
  it("folds one section and then all of them", () => {
    const note = "# Title\n\nintro\n\n## One\n\na\n\n## Two\n\nb\n"
    let collapsed = new Set<string>()
    collapsed = setFolded(collapsed, "One", true)
    expect([...collapsed]).toEqual(["One"])
    collapsed = setFolded(collapsed, "One", false)
    expect(collapsed.size).toBe(0)
    expect(foldableKeys(note)).toEqual(["Title", "One", "Two"])
    // the nested ones are hidden once, inside the title's
    expect(hiddenRanges(note, new Set(foldableKeys(note)))).toHaveLength(1)
  })
  it("does not fold a heading with nothing under it", () => {
    expect(foldableKeys("# Alone\n")).toEqual([])
  })
})
