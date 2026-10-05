import { describe, expect, it } from "vitest"
import { askedDeletion, markerDeletions } from "../src/markdown/markerDeletion"
import { range, replacing, type Range } from "../src/text/range"

/** Transcribed from `WriteMindTests/MarkerDeletionTests.swift`. */
const deleting = (r: Range, text: string): string =>
  markerDeletions(r, text).reduce((out, one) => replacing(out, one, ""), text)

const replacingWith = (r: Range, text: string, typed: string): string => {
  const ranges = markerDeletions(r, text)
  const asked = askedDeletion(r, ranges)
  return ranges.reduce((out, one) => replacing(out, one, one.location === asked.location && one.length === asked.length ? typed : ""), text)
}

describe("deleting text whose markers are hidden", () => {
  it("typing over half a pair takes the other half with it", () => {
    // Left alone this was "xld** here" — a closing pair with nothing to close.
    expect(replacingWith(range(0, 4), "**bold** here", "x")).toBe("xld here")
  })

  it("the typed text lands where the selection was", () => {
    expect(replacingWith(range(6, 2), "**bold** here", "X")).toBe("boldX here")
  })

  it("pasting several words in is the same rule", () => {
    expect(replacingWith(range(1, 3), "**bold** here", "one two")).toBe("one twold here")
  })

  it("asked names the selection and not the orphaned partner", () => {
    const text = "**bold** here"
    const r = range(0, 4)
    const ranges = markerDeletions(r, text)
    expect(ranges.length).toBe(2) // the selection, widened, and the closing pair
    expect(askedDeletion(r, ranges)).toEqual(range(0, 4))
  })

  it("a range past the end is clamped, not applied", () => {
    const ranges = markerDeletions(range(4, 80), "**a**\n**b**")
    for (const one of ranges) expect(one.location + one.length).toBeLessThanOrEqual(11)
  })

  it("half a marker is never left behind", () => {
    // "**bo" selected out of "**bold** here".
    expect(deleting(range(0, 4), "**bold** here")).toBe("ld here")
  })

  it("taking one half of a pair takes the other", () => {
    expect(deleting(range(0, 2), "**bold** here")).toBe("bold here")
  })

  it("the other way round", () => {
    expect(deleting(range(6, 2), "**bold** here")).toBe("bold here")
  })

  it("a pair taken whole is just taken whole", () => {
    expect(deleting(range(0, 8), "**bold** here")).toBe(" here")
  })

  it("ordinary text is deleted exactly as asked", () => {
    const text = "plain words here"
    expect(markerDeletions(range(6, 6), text)).toEqual([range(6, 6)])
    expect(deleting(range(6, 6), text)).toBe("plain here")
  })

  it("text inside a pair is deleted without touching the markers", () => {
    expect(deleting(range(2, 2), "**bold** here")).toBe("**ld** here")
  })

  it("works for the other kinds of marker", () => {
    expect(deleting(range(0, 3), "~~gone~~ here")).toBe("one here")
    expect(deleting(range(0, 1), "`code` here")).toBe("code here")
    expect(deleting(range(0, 1), "_slanted_ here")).toBe("slanted here")
  })

  it("an empty range is left alone", () => {
    expect(markerDeletions(range(3, 0), "**bold**")).toEqual([range(3, 0)])
  })

  it("the ranges come back back to front", () => {
    const ranges = markerDeletions(range(0, 2), "**bold** here")
    expect(ranges).toEqual([...ranges].sort((a, b) => b.location - a.location))
  })
})
