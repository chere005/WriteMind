// The Quick Reference opens on the rendered page EVERY time it is in front (renderer/welcomeView.ts; Sean, 2026-10-05:
// "open on rendered page"; 2026-10-07: "make sure the features md file that ships is rendered by default"), and no other
// note's mode is changed by it: the mode the other notes are in comes back when it leaves the front. Port-only: the Mac
// has no Quick Reference note.
import { describe, expect, it } from "vitest"
import { QUICK_AWAY, quickStep, samePath, type QuickView } from "../src/renderer/welcomeView"

const QUICK = "C:\\notes\\WriteMind Quick Reference.wm"
const OTHER = "C:\\notes\\Physics.wm"

/** The page as App.tsx keeps it: the state and the mode, stepped until nothing changes, with notes coming to the front. */
function page(start: { rendered: boolean }) {
  let state: QuickView = QUICK_AWAY
  let rendered = start.rendered
  let asked = 0
  let front: string | null = null
  const settle = () => {
    for (let i = 0; i < 5; i++) {
      const step = quickStep(state, front, QUICK, rendered, asked)
      const moved = step.state !== state || step.rendered !== undefined
      state = step.state
      if (step.rendered !== undefined) rendered = step.rendered
      if (!moved) return
    }
    throw new Error("the page never settled")
  }
  return {
    open(file: string | null) { front = file; settle() },
    toggle() { rendered = !rendered; settle() },
    choose() { asked++; settle() },
    get rendered() { return rendered },
    get state() { return state },
  }
}

describe("the Quick Reference is always rendered when it is in front", () => {
  it("until it is known where it is, nothing is touched", () => {
    expect(quickStep(QUICK_AWAY, QUICK, null, false, 0)).toEqual({ state: QUICK_AWAY })
    expect(quickStep(QUICK_AWAY, OTHER, null, true, 0)).toEqual({ state: QUICK_AWAY })
  })

  it("a note that is not it is never touched, in either mode", () => {
    for (const rendered of [false, true]) {
      const step = quickStep(QUICK_AWAY, OTHER, QUICK, rendered, 0)
      expect(step).toEqual({ state: QUICK_AWAY })
      expect(step.state).toBe(QUICK_AWAY)
    }
    expect(quickStep(QUICK_AWAY, null, QUICK, false, 0).state).toBe(QUICK_AWAY)
  })

  it("it comes to the front in the markdown pane: the rendered page goes up, and the other notes' mode is remembered", () => {
    const step = quickStep(QUICK_AWAY, QUICK, QUICK, false, 0)
    expect(step.rendered).toBe(true)
    expect(step.state).toEqual({ away: false, asked: 0 })
  })

  it("it comes to the front already rendered: nothing to change, the mode is still remembered", () => {
    const step = quickStep(QUICK_AWAY, QUICK, QUICK, true, 0)
    expect(step.rendered).toBeUndefined()
    expect(step.state).toEqual({ away: true, asked: 0 })
  })

  it("drawn again, still in front: nothing more (the same state object)", () => {
    const first = quickStep(QUICK_AWAY, QUICK, QUICK, false, 0)
    expect(quickStep(first.state, QUICK, QUICK, true, 0)).toEqual({ state: first.state })
    expect(quickStep(first.state, QUICK, QUICK, true, 0).state).toBe(first.state)
  })

  it("one path written two ways is the same note", () => {
    expect(samePath(QUICK, "c:/notes/WriteMind Quick Reference.wm")).toBe(true)
    expect(quickStep(QUICK_AWAY, "c:/notes/WriteMind Quick Reference.wm", QUICK, false, 0).rendered).toBe(true)
    expect(samePath(QUICK, OTHER)).toBe(false)
  })
})

describe("every time, and no other note's mode changes", () => {
  it("every open of it is rendered, not only the first: open, leave, open again, leave again", () => {
    const view = page({ rendered: false })
    view.open(QUICK)
    expect(view.rendered).toBe(true)
    view.open(OTHER)
    expect(view.rendered).toBe(false)
    view.open(QUICK)
    expect(view.rendered).toBe(true)
    view.open(OTHER)
    expect(view.rendered).toBe(false)
    view.open(QUICK)
    expect(view.rendered).toBe(true)
  })

  it("the other notes stay in the mode they were in: markdown stays markdown, a rendered page stays rendered", () => {
    const markdown = page({ rendered: false })
    markdown.open(OTHER); markdown.open(QUICK); markdown.open(OTHER)
    expect(markdown.rendered).toBe(false)
    expect(markdown.state).toEqual({ away: null, asked: 0 })

    const rendered = page({ rendered: true })
    rendered.open(OTHER); rendered.open(QUICK)
    expect(rendered.rendered).toBe(true)
    rendered.open(OTHER)
    expect(rendered.rendered).toBe(true)
  })

  it("a mode changed while it is in front does not leak into the other notes", () => {
    const view = page({ rendered: false })
    view.open(OTHER)
    view.open(QUICK)
    view.toggle() // read it as markdown by hand: allowed, it stays so while it is in front
    expect(view.rendered).toBe(false)
    view.open(OTHER)
    expect(view.rendered).toBe(false) // the other notes' own mode
    const other = page({ rendered: true })
    other.open(QUICK)
    other.toggle()
    expect(other.rendered).toBe(false)
    other.open(OTHER)
    expect(other.rendered).toBe(true) // back to what they were in, not what it was turned to
  })

  it("closing it (no note in front, or another one) puts the other notes' mode back too", () => {
    const view = page({ rendered: false })
    view.open(QUICK)
    expect(view.rendered).toBe(true)
    view.open(null)
    expect(view.rendered).toBe(false)
    view.open(QUICK)
    expect(view.rendered).toBe(true)
  })

  it("Help ▸ Quick Reference chosen again brings the rendered page back, even if it was turned off by hand", () => {
    const view = page({ rendered: false })
    view.open(QUICK)
    view.toggle()
    expect(view.rendered).toBe(false)
    view.choose()
    expect(view.rendered).toBe(true)
    // chosen while another note is in front: nothing now; the open that follows is rendered all the same
    view.open(OTHER)
    expect(view.rendered).toBe(false)
    view.choose()
    expect(view.rendered).toBe(false)
    view.open(QUICK)
    expect(view.rendered).toBe(true)
  })

  it("a session that restores it as the front note starts rendered, and the app's first note after it is not", () => {
    const view = page({ rendered: false })
    view.open(QUICK)
    expect(view.rendered).toBe(true)
    view.open(OTHER)
    expect(view.rendered).toBe(false)
  })
})
