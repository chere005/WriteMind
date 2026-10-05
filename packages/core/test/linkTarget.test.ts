import { describe, expect, it } from "vitest"
import { resolveLinkTarget } from "../src/notes/linking"

// Port-only: the Mac's `NoteStore.follow(destination:)` (WriteMind/Notes/NoteStore.swift) looks a link's file
// NAME up among all the notes, whichever section they are in (`/link` writes only the name), so a link works
// across sections. The port also takes a relative path first, and prefers the note nearest the source.
describe("which note a link names", () => {
  const notes = [
    "C:\\n\\Intro.md", "C:\\n\\Ideas\\Plan.md", "C:\\n\\Ideas\\Deeper\\Plan.md", "C:\\n\\Other\\Plan.md",
    "C:\\n\\Other\\Readme.markdown",
  ]
  it("finds a note by its name in another section", () => {
    expect(resolveLinkTarget(notes, "C:\\n\\Intro.md", "Readme.markdown")).toBe("C:\\n\\Other\\Readme.markdown")
    expect(resolveLinkTarget(notes, "C:\\n\\Other\\Plan.md", "Intro.md")).toBe("C:\\n\\Intro.md")
  })
  it("prefers the note nearest the source when two sections have the name", () => {
    expect(resolveLinkTarget(notes, "C:\\n\\Ideas\\Deeper\\Plan.md", "Plan.md")).toBe("C:\\n\\Ideas\\Deeper\\Plan.md")
    expect(resolveLinkTarget(notes, "C:\\n\\Ideas\\x.md", "Plan.md")).toBe("C:\\n\\Ideas\\Plan.md")
    expect(resolveLinkTarget(notes, "C:\\n\\Other\\x.md", "Plan.md")).toBe("C:\\n\\Other\\Plan.md")
  })
  it("takes a relative path first, and a name without its extension second", () => {
    expect(resolveLinkTarget(notes, "C:\\n\\Other\\x.md", "../Ideas/Plan.md")).toBe("C:\\n\\Ideas\\Plan.md")
    expect(resolveLinkTarget(notes, "C:\\n\\Intro.md", "Readme")).toBe("C:\\n\\Other\\Readme.markdown")
  })
  it("is case-blind as a last resort and null when nothing has the name", () => {
    expect(resolveLinkTarget(notes, "C:\\n\\Intro.md", "intro.MD")).toBe("C:\\n\\Intro.md")
    expect(resolveLinkTarget(notes, "C:\\n\\Intro.md", "Gone.md")).toBeNull()
    expect(resolveLinkTarget(notes, "C:\\n\\Intro.md", "")).toBeNull()
  })
  it("works with POSIX paths too", () => {
    expect(resolveLinkTarget(["/n/a/One.md", "/n/b/Two.md"], "/n/a/One.md", "Two.md")).toBe("/n/b/Two.md")
  })
})
