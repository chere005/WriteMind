import { describe, expect, it } from "vitest"
import {
  bufferDecisions, closing, emptySession, readSession, surviving, textFingerprint, writeSession,
} from "../src/notes/session"

/**
 * `ProjectSession.unsavedBuffers` (WriteMind/Notes/Project.swift): "Note path -> text that had not been written
 * when the app closed", applied on the next launch BEFORE the tabs are restored (WriteMindApp.restoreSession).
 * The Swift test (ProjectTests.testSessionRoundTrip) round-trips `["/a.md": "half a sentence"]`; the older-file
 * test reads `"unsavedBuffers":{}`. The port also records which file text the buffer was an edit of.
 */
describe("unsaved buffers in the session", () => {
  it("round-trip with the session", () => {
    const session = {
      ...emptySession("/notes"),
      open: [{ path: "/a.md", caret: 3, collapsed: [] }],
      active: "/a.md",
      unsavedBuffers: { "/a.md": { text: "half a sentence", base: textFingerprint("half") } },
    }
    expect(readSession(writeSession(session))).toEqual(session)
  })

  it("reads the Mac's shape (a plain string per path) and a session from before buffers existed", () => {
    const mac = readSession(JSON.stringify({ open: [], unsavedBuffers: { "/a.md": "half a sentence" } }))
    expect(mac.unsavedBuffers).toEqual({ "/a.md": { text: "half a sentence", base: null } })
    expect(readSession(JSON.stringify({ open: [] })).unsavedBuffers).toEqual({})
    expect(readSession(JSON.stringify({ open: [], unsavedBuffers: { "/a.md": 4, "/b.md": { text: 1 } } })).unsavedBuffers)
      .toEqual({})
  })

  it("a note that is gone, or whose tab was closed, takes its buffer with it", () => {
    const session = readSession(JSON.stringify({
      open: [{ path: "/a.md" }, { path: "/b.md" }], active: "/a.md",
      unsavedBuffers: { "/a.md": "x", "/b.md": "y" },
    }))
    expect(Object.keys(surviving(session, (path) => path !== "/b.md").unsavedBuffers)).toEqual(["/a.md"])
    expect(Object.keys(closing(session, "/a.md").unsavedBuffers)).toEqual(["/b.md"])
  })

  it("a fingerprint tells one text from another, and the same text from itself", () => {
    expect(textFingerprint("hello")).toBe(textFingerprint("hello"))
    expect(textFingerprint("hello")).not.toBe(textFingerprint("hellp"))
    expect(textFingerprint("")).not.toBe(textFingerprint(" "))
  })
})

describe("what a launch does with the buffers", () => {
  const disk = (files: Record<string, string>) => (path: string) => files[path] ?? null

  it("writes a buffer into a file that is as the edit left it", () => {
    const buffers = { "/a.md": { text: "# A\nnew words", base: textFingerprint("# A\n") } }
    expect(bufferDecisions(buffers, disk({ "/a.md": "# A\n" })))
      .toEqual([{ path: "/a.md", action: "apply", text: "# A\nnew words" }])
  })

  it("does nothing when the file already holds the text (the save made it), or the note is gone", () => {
    const buffers = {
      "/a.md": { text: "same", base: textFingerprint("old") },
      "/b.md": { text: "orphan", base: null },
    }
    expect(bufferDecisions(buffers, disk({ "/a.md": "same" })))
      .toEqual([{ path: "/a.md", action: "skip" }, { path: "/b.md", action: "skip" }])
  })

  it("keeps a copy, never overwriting, when somebody else wrote the file meanwhile", () => {
    const buffers = { "/a.md": { text: "mine", base: textFingerprint("what I opened") } }
    expect(bufferDecisions(buffers, disk({ "/a.md": "theirs" })))
      .toEqual([{ path: "/a.md", action: "keep-copy", text: "mine" }])
  })

  it("follows the Mac when the buffer has no base: the cached text wins", () => {
    expect(bufferDecisions({ "/a.md": { text: "cached", base: null } }, disk({ "/a.md": "disk" })))
      .toEqual([{ path: "/a.md", action: "apply", text: "cached" }])
  })
})
