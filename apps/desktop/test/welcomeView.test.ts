// A new install's quick reference opens on the rendered page, its first open only (renderer/welcomeView.ts; Sean,
// 2026-10-05: "open on rendered page"). Port-only: the Mac has no quick reference note.
import { describe, expect, it } from "vitest"
import { NO_WELCOME, welcomeFor, welcomeStep } from "../src/renderer/welcomeView"

const NOTE = "C:\\notes\\WriteMind Quick Reference.md"
const OTHER = "C:\\notes\\Physics.md"

describe("the quick reference's first open", () => {
  it("an existing install (no note written now) is never touched", () => {
    expect(welcomeFor(null)).toBe(NO_WELCOME)
    expect(welcomeStep(NO_WELCOME, NOTE, false)).toEqual({ state: NO_WELCOME })
    expect(welcomeStep(NO_WELCOME, OTHER, true)).toEqual({ state: NO_WELCOME })
  })

  it("the note in front: the rendered page, once", () => {
    const first = welcomeStep(welcomeFor(NOTE), NOTE, false)
    expect(first.rendered).toBe(true)
    expect(first.state.phase).toBe("shown")
    // Drawn again, still in front: nothing more.
    expect(welcomeStep(first.state, NOTE, true)).toEqual({ state: first.state })
  })

  it("one path written two ways is the same note", () => {
    expect(welcomeStep(welcomeFor(NOTE), "c:/notes/WriteMind Quick Reference.md", false).rendered).toBe(true)
  })

  it("waits while another note is in front, or none", () => {
    const waiting = welcomeFor(NOTE)
    expect(welcomeStep(waiting, null, false)).toEqual({ state: waiting })
    expect(welcomeStep(waiting, OTHER, false)).toEqual({ state: waiting })
  })

  it("another note to the front: the markdown pane comes back, and it is over", () => {
    const shown = welcomeStep(welcomeFor(NOTE), NOTE, false).state
    expect(welcomeStep(shown, OTHER, true)).toEqual({ state: NO_WELCOME, rendered: false })
    // Back to the quick reference later: as it is now, not rendered again.
    expect(welcomeStep(NO_WELCOME, NOTE, false)).toEqual({ state: NO_WELCOME })
  })

  it("the rendered page turned off by hand: that choice stays, and nothing more is done", () => {
    const shown = welcomeStep(welcomeFor(NOTE), NOTE, false).state
    const off = welcomeStep(shown, NOTE, false)
    expect(off).toEqual({ state: NO_WELCOME })
    expect(welcomeStep(off.state, OTHER, true)).toEqual({ state: NO_WELCOME })
  })
})
