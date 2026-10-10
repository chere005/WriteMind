import { describe, expect, it } from "vitest"
import { apply } from "../src/markdown/formatting"
import { moveSection } from "../src/cells/outline"
import { range } from "../src/text/range"

/**
 * Move Section Up / Down (Ctrl+Up / Ctrl+Down; ⌃⌘↑ ⌃⌘↓): the sections swap, the blank line between them stays, the caret and
 * the selection stay on the same words. (Found 2026-10-10, docs/PLAN-bars-2026-10.md P7 (f): the LAST section of a note with no
 * newline at its end took the newline of the one it swapped with, and landed glued to the text above it.)
 */
const D = "# Alpha\n\nalpha words\n\n# Beta\n\nbeta words\n\n# Gamma\n\ngamma words"
const at = (text: string, word: string, plus = 0) => range(text.indexOf(word) + plus, 0)
const moved = (text: string, where: ReturnType<typeof range>, up: boolean) => {
  const change = moveSection(text, where, up)
  return change ? { text: apply(text, change), selection: change.selection } : null
}
const blocks = (text: string) => text.split("\n\n")

describe("moving a section", () => {
  for (const tail of ["", "\n", "\n\n"]) {
    const text = D + tail
    const name = JSON.stringify(tail)
    it(`swaps the middle one down past the last, blank lines kept (the note ends ${name})`, () => {
      const result = moved(text, at(text, "beta", 2), false)!
      expect(result.text).toBe("# Alpha\n\nalpha words\n\n# Gamma\n\ngamma words\n\n# Beta\n\nbeta words" + (tail === "" ? "" : tail === "\n" ? "\n" : "\n\n"))
      expect(result.text.slice(result.selection.location - 2, result.selection.location + 2)).toBe("beta")
    })

    it(`swaps the last one up, and leaves the end of the note as it was (${name})`, () => {
      const result = moved(text, at(text, "gamma w", 3), true)!
      expect(result.text).toBe("# Alpha\n\nalpha words\n\n# Gamma\n\ngamma words\n\n# Beta\n\nbeta words" + (tail === "" ? "" : tail === "\n" ? "\n" : "\n\n"))
    })

    it(`and is its own inverse (${name})`, () => {
      const down = moved(text, at(text, "beta", 2), false)!
      const back = moved(down.text, down.selection, true)!
      expect(back.text).toBe(text)
    })
  }

  it("never glues a section to the text above it: every heading still has a blank line before it", () => {
    for (const up of [true, false]) {
      for (const word of ["alpha", "beta", "gamma"]) {
        const result = moved(D, at(D, word + " words", 2), up)
        if (!result) continue
        for (const block of blocks(result.text)) expect(block.split("\n").filter((line) => line.startsWith("# ")).length).toBeLessThanOrEqual(1)
        expect(result.text.split("\n").filter((line) => line.startsWith("# ")).length).toBe(3)
        expect(result.text).not.toMatch(/[^\n]\n# /)
      }
    }
  })

  it("keeps the caret on the same character of the same words, going either way", () => {
    const down = moved(D, at(D, "beta words", 5), false)!
    expect(down.text.slice(down.selection.location - 5, down.selection.location + 5)).toBe("beta words")
    const up = moved(D, at(D, "beta words", 5), true)!
    expect(up.text.slice(up.selection.location - 5, up.selection.location + 5)).toBe("beta words")
  })

  it("keeps a selection inside the moved section: the same words, still selected", () => {
    const from = D.indexOf("beta words")
    const result = moved(D, range(from, 4), true)!
    expect(result.text.slice(result.selection.location, result.selection.location + result.selection.length)).toBe("beta")
  })

  it("does nothing at the first section going up and the last going down", () => {
    expect(moveSection(D, at(D, "alpha words", 2), true)).toBeNull()
    expect(moveSection(D, at(D, "gamma words", 2), false)).toBeNull()
  })

  it("moves a section with everything nested in it", () => {
    const nested = "# One\n\nbody\n\n## Two\n\nmore\n\n# Three\n\nlast"
    const result = moved(nested, at(nested, "body", 1), false)!
    expect(result.text).toBe("# Three\n\nlast\n\n# One\n\nbody\n\n## Two\n\nmore")
  })

  it("with no heading yet, the paragraphs are what moves, blank lines kept, at the end of the note too", () => {
    for (const tail of ["", "\n"]) {
      const text = "one\n\ntwo\n\nthree" + tail
      expect(moved(text, at(text, "three", 2), true)!.text).toBe("one\n\nthree\n\ntwo" + tail)
      expect(moved(text, at(text, "one", 1), false)!.text).toBe("two\n\none\n\nthree" + tail)
      expect(moved(text, at(text, "two", 1), false)!.text).toBe("one\n\nthree\n\ntwo" + tail)
    }
  })
})
