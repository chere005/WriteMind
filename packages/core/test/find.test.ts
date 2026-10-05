import { describe, expect, it } from "vitest"
import { findAll, matchAt, nextMatch, replacingAll } from "../src/text/find"
import { range } from "../src/text/range"

// Port-only model behind the find bar (the Mac's text view has `usesFindBar = true`).
describe("finding words", () => {
  const text = "Note one, note two. A notebook has NOTE pages."

  it("ignores case unless asked not to", () => {
    expect(findAll(text, "note").map((r) => r.location)).toEqual([0, 10, 22, 35])
    expect(findAll(text, "note", { caseSensitive: true, wholeWord: false }).map((r) => r.location)).toEqual([10, 22])
  })

  it("can be limited to whole words", () => {
    expect(findAll(text, "note", { caseSensitive: false, wholeWord: true }).map((r) => r.location)).toEqual([0, 10, 35])
    expect(findAll("a_note note-x", "note", { caseSensitive: false, wholeWord: true }).map((r) => r.location)).toEqual([7])
  })

  it("an empty query matches nothing, and matches never overlap", () => {
    expect(findAll(text, "")).toEqual([])
    expect(findAll("aaaa", "aa")).toEqual([range(0, 2), range(2, 2)])
  })

  it("is not fooled by letters whose lower case is longer", () => {
    // "İ" lower-cases to two code units; positions must still mean the original text.
    const hits = findAll("İ x İ", "x")
    expect(hits.length).toBe(1)
    expect("İ x İ".slice(hits[0]!.location, hits[0]!.location + 1)).toBe("x")
  })

  it("goes to the next match from a place, and wraps round", () => {
    const matches = findAll(text, "note")
    expect(nextMatch(matches, 0)).toBe(0)
    expect(nextMatch(matches, 1)).toBe(1)
    expect(nextMatch(matches, 37)).toBe(0) // past the last: round to the first
    expect(nextMatch([], 0)).toBeNull()
  })

  it("goes to the previous one the same way", () => {
    const matches = findAll(text, "note")
    expect(nextMatch(matches, 10, true)).toBe(0)
    expect(nextMatch(matches, 14, true)).toBe(1)
    expect(nextMatch(matches, 0, true)).toBe(3) // before the first: round to the last
  })

  it("knows which match is the selection", () => {
    const matches = findAll(text, "note")
    expect(matchAt(matches, range(10, 4))).toBe(1)
    expect(matchAt(matches, range(10, 3))).toBeNull()
  })

  it("replaces every match", () => {
    expect(replacingAll("a b a c a", findAll("a b a c a", "a"), "X")).toBe("X b X c X")
    expect(replacingAll("none", [], "X")).toBe("none")
  })
})
