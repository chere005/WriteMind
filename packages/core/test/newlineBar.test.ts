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

describe("Return on the empty item a list or a quote was carried on with is NOT the bar's (it takes the marker away and stays in the cell)", () => {
  it("closingReturn declines it: the editor's own Return takes the marker off and the line stays", () => {
    for (const marked of [
      "- one\n- |", "- one\n-|", "* one\n* |", "+ one\n+ |", "1. one\n2. |", "1) one\n2)|", "- [ ] one\n- [ ] |", "- [x] one\n- [ ]|",
      "> quoted\n> |", "> quoted\n>|", "- one\n  - |", "- one\n- two\n- |\n\nbody", "a\n\n- one\n- |",
    ]) {
      expect(closedBy(marked), JSON.stringify(marked)).toBeNull()
    }
  })

  it("and once the marker is gone the line is the cell's and the NEXT Return is the bar's (Sean, 2026-10-11)", () => {
    expect(after("- one\n- two\n|")).toBe("- one\n- two")
    expect(after("> quoted\n|")).toBe("> quoted")
    expect(after("1. one\n|\n\nbody")).toBe("1. one\n\nbody")
  })

  it("the rendered page's Return does the same on the LAST item: the marker goes, the line stays (a list is not exited)", () => {
    for (const [marked, expected] of [
      ["- one\n- |", "- one\n"], ["1. one\n2. |", "1. one\n"], ["- [ ] one\n- [ ] |", "- [ ] one\n"], ["> quoted\n> |", "> quoted\n"],
      ["- one\n- two\n- |", "- one\n- two\n"],
      // A list of one empty item touching the cell above (2026-10-11): the cell's grown line is left. (`one\n- |` was here too;
      // since the same day a marker alone under a paragraph's line is the paragraph's words, the parser's `startsEmptyList`.)
      ["# H\n* |", "# H\n"], ["one\n- [ ] |", "one\n"], ["- a\n\n* b\n- |", "- a\n\n* b\n"],
    ] as const) {
      const { text, caret } = note(marked)
      const edit = returnInBlock(text, range(caret, 0))
      expect(edit, marked).not.toBeNull()
      expect(replacing(text, edit!.range, edit!.replacement), marked).toBe(expected)
      expect(edit!.selection.location, marked).toBe(expected.length)
    }
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

  it("is not an item with words, an empty item touching the cell above, or one in the middle of a cell", () => {
    // ("- |", "> |" and "a\n\n1. |" — an empty item with nothing above it in its cell — were here too until 2026-10-11: see below.)
    for (const marked of ["- one\n- two|", "a\n- |", "# H\n* |", "- one\n- |\n- three"]) {
      expect(closedBy(marked), JSON.stringify(marked)).toBeNull()
    }
  })

  it("takes a list that is ONE empty item and a cell of its own away, and the bar is up where it was", () => {
    // Since 2026-10-11 (Sean: "typing a * while the input cursor is horizontal will start a markdown text cell with bullet points";
    // "the input cursor should go to where it is typing when inserting a checklist or bullets") a marker alone is the list's empty
    // item, and the bar opens one: Return on it before a word is typed leaves the note as it was before the list was chosen,
    // with the bar up there. (Taking the marker off and leaving the line, the rule above, left a blank cell between the two.)
    for (const [marked, expected, bar] of [
      ["a\n\n* |\n\nb", "a\n\nb", { index: 1, below: false }],
      ["a\n\n- |", "a", { index: 0, below: true }],
      ["- [ ] |\n\nb", "b", { index: 0, below: false }],
      ["a\n\n1. |\n\nb\n\nc", "a\n\nb\n\nc", { index: 1, below: false }],
      ["a\n\n> |", "a", { index: 0, below: true }],
      ["- |", "", { index: 0, below: false }],
    ] as const) {
      const closed = closedBy(marked)
      expect(closed, marked).not.toBeNull()
      expect(after(marked), marked).toBe(expected)
      expect({ index: closed!.index, below: closed!.below }, marked).toEqual(bar)
    }
  })

  it("takes one TOUCHING the cell below away with its own newline, and keeps the cells above and below apart (2026-10-11)", () => {
    // Reached with real keys: `- Y`, Return, Return, `Zed` (the line the list's Return left, typed on, is the next cell touching
    // it), then Y taken back and Return. The rule used to read the blank line two characters back from `Zed` and took the
    // newlines above and the marker's dash with it: `a \nb`, three cells made one. It keeps the one blank line above.
    for (const [marked, expected, bar] of [
      ["a\n\n- |\nb", "a\n\nb", { index: 1, below: false }],
      ["a\n\n- [ ] |\nb", "a\n\nb", { index: 1, below: false }],
      ["a\n\n1. |\nb", "a\n\nb", { index: 1, below: false }],
      ["a\n\n> |\nb", "a\n\nb", { index: 1, below: false }],
      ["* |\nb", "b", { index: 0, below: false }],
      ["- |\nb\n\nc", "b\n\nc", { index: 0, below: false }],
      // Blank lines of white space either side: the first under the cell above is the one kept.
      ["a\n  \n\n- |\n \nb", "a\n  \nb", { index: 1, below: false }],
      ["a\n\n\n- |\nb", "a\n\nb", { index: 1, below: false }],
    ] as const) {
      const closed = closedBy(marked)
      expect(closed, marked).not.toBeNull()
      expect(after(marked), marked).toBe(expected)
      expect({ index: closed!.index, below: closed!.below }, marked).toEqual(bar)
      // The cells are what they were without the item: the one above and the one below, apart.
      expect(positioned(after(marked)!).length, marked).toBe(positioned(note(marked).text).length - 1)
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

  /**
   * What Return does at the end of the cell's last line, on the markdown side. A list's or a quote's carried-on marker is taken off by
   * the NEXT Return (Sean, 2026-10-11: "exiting bullet points shouldn't exit the cell though, just add a newline after it"), which
   * leaves the empty line the closing rule then ends: so for those the grown line is the empty one.
   */
  const firstReturn = (cell: string, kind: string): string => {
    const last = cell.split("\n").pop()!
    if (kind === "a table") return cell + "\n|  |  |"
    return cell + "\n"
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
