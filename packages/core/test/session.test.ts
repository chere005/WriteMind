import { describe, expect, it } from "vitest"
import {
  closing, emptySession, readSession, remembering, sessionFileName, surviving, writeSession,
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
