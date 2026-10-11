import { describe, expect, it } from "vitest"
import { closingReturn } from "../src/cells/newline"
import { growth } from "../src/cells/growth"
import { returnInBlock } from "../src/cells/preview"
import { listContinuation } from "../src/cells/editing"
import { linesOf, positioned } from "../src/markdown/parser"
import { tableReturn } from "../src/markdown/table"
import { range, replacing, type Range } from "../src/text/range"

/**
 * THE SECOND NEWLINE ARMS THE BAR (Sean, 2026-10-11: "a single newline grows all those contents.. the second newline should
 * make the cursor horizontal with the +, not start the next cell"). Port-first: the Mac has no rule for it yet. `|` marks the
 * caret in the notes below. The rule is core `closingReturn`: which line Return is on when it ends the cell, what goes, and
 * on which side of the cell the bar is. The editor applies it (`returnClosesTheCell`, seams.ts; editor/test/newlineBar.test.ts)
 * and e2e/suites/cells/20-newline-bar.mjs presses the real key on both pages.
 */
const note = (marked: string): { text: string; caret: number } => ({
  text: marked.replace("|", ""),
  caret: marked.indexOf("|"),
})

const closedBy = (marked: string, selection?: (caret: number) => Range) => {
  const { text, caret } = note(marked)
  return closingReturn(positioned(text), linesOf(text), selection ? selection(caret) : range(caret, 0))
}

/** The note after the rule has taken the grown line out. */
const after = (marked: string): string | null => {
  const { text } = note(marked)
  const closed = closedBy(marked)
  return closed && closed.remove ? replacing(text, closed.remove, "") : null
}

describe("Return on the empty line a newline opened ends the cell", () => {
  it("takes the line and the newline before it: the note keeps exactly the blank line that separates", () => {
    expect(after("hello\n|")).toBe("hello")
    expect(after("hello\n|\n")).toBe("hello\n")
    expect(after("hello\n|\n\nworld")).toBe("hello\n\nworld")
    expect(after("a\n\nb\n|\n\nc")).toBe("a\n\nb\n\nc")
    expect(after("hello\n   |\n\nworld")).toBe("hello\n\nworld")
  })

  it("is the cell above, with the bar under it", () => {
    expect(closedBy("hello\n|")).toEqual({ index: 0, remove: range(5, 1), below: true })
    expect(closedBy("a\n\nb\n|\n\nc")).toEqual({ index: 1, remove: range(4, 1), below: true })
  })

  it("is every kind's: a heading, a rule, a fence, a table, a markdown cell", () => {
    for (const [marked, expected] of [
      ["# Title\n|", "# Title"], ["---\n|", "---"], ["```\nx\n```\n|", "```\nx\n```"], ["```wl\nx^2\n```\n|", "```wl\nx^2\n```"],
      ["| a | b |\n|---|---|\n| 1 | 2 |\n|", "| a | b |\n|---|---|\n| 1 | 2 |"],
      ["<!-- markdown -->\nsome **words**\n|", "<!-- markdown -->\nsome **words**"],
      ["# Title\n|\n\nbody", "# Title\n\nbody"],
    ] as const) {
      // (The table's pipes are the caret's mark: its last line is written out with the caret after the pipes.)
      if (marked.startsWith("| a")) continue
      expect(after(marked), JSON.stringify(marked)).toBe(expected)
    }
    const table = "| a | b |\n|---|---|\n| 1 | 2 |\n"
    const grown = closingReturn(positioned(table), linesOf(table), range(table.length, 0))
    expect(replacing(table, grown!.remove!, "")).toBe("| a | b |\n|---|---|\n| 1 | 2 |")
  })

  it("is the same on the empty line under a list or a quote (an item Backspace took the marker off)", () => {
    expect(after("- a\n|")).toBe("- a")
    expect(after("> q\n|\n\nb")).toBe("> q\n\nb")
  })

  it("is not on the words, on the lone blank line between two cells, or on the line after a blank line", () => {
    for (const marked of ["hello|", "hel|lo\n", "hello\n|\nworld", "hello\n\n|", "hello\n\n|\nworld", "# Title\n|\nbody", "|"]) {
      expect(closedBy(marked), JSON.stringify(marked)).toBeNull()
    }
  })

  it("is not a selection", () => {
    expect(closedBy("hello\n|", (caret) => range(caret - 2, 2))).toBeNull()
  })
})

describe("Return on the empty item a list, a quote or a table was carried on with ends the cell", () => {
  it("takes the item and the newline before it", () => {
    for (const [marked, expected] of [
      ["- one\n- |", "- one"], ["- one\n-|", "- one"], ["* one\n* |", "* one"], ["+ one\n+ |", "+ one"],
      ["1. one\n2. |", "1. one"], ["1) one\n2)|", "1) one"], ["- [ ] one\n- [ ] |", "- [ ] one"], ["- [x] one\n- [ ]|", "- [x] one"],
      ["> quoted\n> |", "> quoted"], ["> quoted\n>|", "> quoted"],
      ["- one\n  - |", "- one"], ["- one\n- two\n- |\n\nbody", "- one\n- two\n\nbody"],
    ] as const) {
      expect(after(marked), JSON.stringify(marked)).toBe(expected)
    }
  })

  it("is the list, quote or table the bar goes under", () => {
    expect(closedBy("a\n\n- one\n- |")).toEqual({ index: 1, remove: range(8, 3), below: true })
    expect(closedBy("> quoted\n> |")).toEqual({ index: 0, remove: range(8, 3), below: true })
  })

  it("is a table's empty last row, caret in any cell of it", () => {
    const table = "| a | b |\n|---|---|\n| 1 | 2 |\n|  |  |"
    for (const caret of [31, 32, 34, 37]) {
      const closed = closingReturn(positioned(table), linesOf(table), range(caret, 0))
      expect(closed, String(caret)).toEqual({ index: 0, remove: range(29, 8), below: true })
      expect(replacing(table, closed!.remove!, "")).toBe("| a | b |\n|---|---|\n| 1 | 2 |")
    }
    // (The header and the delimiter row are never an empty row, and a row with words in it is a row.)
    expect(closingReturn(positioned(table), linesOf(table), range(3, 0))).toBeNull()
    expect(closingReturn(positioned(table), linesOf(table), range(12, 0))).toBeNull()
    const filled = "| a | b |\n|---|---|\n| 1 | 2 |"
    expect(closingReturn(positioned(filled), linesOf(filled), range(filled.length, 0))).toBeNull()
    // (And a table whose only body row is empty is still a table with lines above it.)
    const only = "| a | b |\n|---|---|\n|  |  |"
    expect(closingReturn(positioned(only), linesOf(only), range(only.length - 2, 0))).toEqual({ index: 0, remove: range(19, 8), below: true })
  })

  it("is not an item with words, an empty item with nothing above it in its cell, or one in the middle of a cell", () => {
    for (const marked of ["- one\n- two|", "- |", "> |", "a\n\n1. |", "- one\n- |\n- three"]) {
      expect(closedBy(marked), JSON.stringify(marked)).toBeNull()
    }
  })
})

describe("Return beside a picture arms the bar on that side", () => {
  const picture = "![](a.png)"

  it("after it the bar goes under, before it above; nothing is taken out", () => {
    const text = `intro\n\n${picture}\n\noutro`
    const cells = positioned(text)
    expect(closingReturn(cells, linesOf(text), range(7 + picture.length, 0))).toEqual({ index: 1, remove: null, below: true })
    expect(closingReturn(cells, linesOf(text), range(7, 0))).toEqual({ index: 1, remove: null, below: false })
  })

  it("is not the picture's middle", () => {
    const text = `intro\n\n${picture}\n\noutro`
    expect(closingReturn(positioned(text), linesOf(text), range(10, 0))).toBeNull()
  })
})

describe("Return, then Return, gives the note back as it was", () => {
  /**
   * The first Return as the editor does it: the newline (and a list's or a quote's marker, a table's empty row) at the end of
   * the cell; the second is the closing rule. What is left is the note you started from, whatever the kind and whatever
   * follows the cell — the bar is what is different.
   */
  const kinds: Array<[string, string]> = [
    ["a paragraph", "hello"], ["a markdown cell", "<!-- markdown -->\nsome **words**"], ["a heading", "## Title"], ["a rule", "---"],
    ["a fence", "```\nx\n```"], ["a maths cell", "```wl\nx^2\n```"], ["a bullet list", "- one\n- two"], ["a dash list", "* one"],
    ["a numbered list", "1. one\n2. two"], ["a to-do list", "- [ ] one"], ["a quote", "> quoted"],
    ["a table", "| a | b |\n|---|---|\n| 1 | 2 |"],
  ]
  const follows = ["", "\n", "\n\nworld", "\n\n\nworld", "\n\n# Next\n\nmore"]

  /** What Return does at the end of the cell's last line, on the markdown side. */
  const firstReturn = (cell: string, kind: string): string => {
    const last = cell.split("\n").pop()!
    if (kind === "a table") return cell + "\n|  |  |"
    const next = kind === "a fence" || kind === "a maths cell" ? null : listContinuation(last)
    return cell + "\n" + (next ?? "")
  }

  for (const [kind, cell] of kinds) {
    for (const tail of follows) {
      it(`${kind}${JSON.stringify(tail)}`, () => {
        const start = cell + tail
        const grown = firstReturn(cell, kind) + tail
        const caret = firstReturn(cell, kind).length
        const closed = closingReturn(positioned(grown), linesOf(grown), range(caret, 0))
        expect(closed, JSON.stringify(grown)).not.toBeNull()
        expect(replacing(grown, closed!.remove!, "")).toBe(start)
        // And the cell it points at is the one that was written first.
        expect(positioned(start)[closed!.index]!.range.location).toBe(0)
      })
    }
  }
})

describe("what the first Return of the rendered page now is", () => {
  it("returnInBlock leaves a paragraph's, a heading's and a rule's end to the ordinary newline", () => {
    for (const marked of ["hello|", "# Title|", "---|", "words and more   |"]) {
      const { text, caret } = note(marked)
      expect(returnInBlock(text, range(caret, 0)), marked).toBeNull()
    }
  })

  it("and the line it leaves is the cell's, for the grown-cell reader", () => {
    const { text, caret } = note("# Title\n|\n\nbody")
    expect(growth(positioned(text), linesOf(text), range(caret, 0))).toEqual({ index: 0, line: range(8, 0) })
  })
})

describe("Return in a table row is still a row", () => {
  it("adds a row; an empty last row is the closing rule's", () => {
    const source = "| a | b |\n|---|---|\n| 1 | 2 |"
    expect(tableReturn(source, source.length)).not.toBeNull()
    expect(tableReturn(source + "\n|  |  |", source.length + 3)).toBeNull()
  })
})
