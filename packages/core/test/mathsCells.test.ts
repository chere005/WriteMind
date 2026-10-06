// THE MATHS CELL (port-only; Sean, 2026-10-06: "ctrl + 7 should be PURELY plaintext.. so clearly we need a math cell
// type.. that should be ctrl + 9"): src/cells/mathsCells.ts and the `maths` kind of src/cells/types.ts. The Mac has no
// maths cell kind (its ⌘9 is the evaluation cell), so there is no Swift test to transcribe; the editor's half (the key,
// one Undo) is packages/editor/test/mathsCells.test.ts, the typesetting e2e/suites/cells/07-maths-cell.mjs.
import { describe, expect, it } from "vitest"
import { applied, type Edit, type Range } from "../src/text/range"
import { blocks } from "../src/markdown/parser"
import { MARKDOWN_MARKER, escapePlain } from "../src/markdown/plainText"
import { isMathsCell, mathsAsCode, mathsAsText, mathsCellPlan, wrapAsMaths } from "../src/cells/mathsCells"
import { KIND_GROUPS, kindName, openCell } from "../src/cells/types"

const M = MARKDOWN_MARKER
const at = (location: number, length = 0): Range => ({ location, length })
const apply = (text: string, change: Edit) => applied(text, change).text
/** Ctrl+9 where `selection` is, when it writes or converts here (the plan's edit). */
function nine(text: string, selection: Range): { text: string; caret: number } {
  const plan = mathsCellPlan(text, selection)
  if (plan.kind !== "edit") throw new Error(`expected an edit, got ${plan.kind}`)
  return { text: apply(text, plan.edit), caret: plan.edit.selection.location }
}
const kinds = (text: string) => blocks(text).map((one) => one.kind === "code" ? `code:${one.language ?? ""}` : one.kind)

describe("Ctrl+9 makes a maths cell", () => {
  it("on an empty line: an empty ```wl fence, a cell of its own, the caret on the line inside it", () => {
    const note = "one\n\n\n\ntwo"
    const out = nine(note, at(5))
    expect(out.text).toBe("one\n\n```wl\n\n```\n\ntwo")
    expect(out.caret).toBe(out.text.indexOf("```wl\n") + 6)
    expect(kinds(out.text)).toEqual(["paragraph", "code:wl", "paragraph"])
    // An empty note too.
    expect(nine("", at(0))).toEqual({ text: "```wl\n\n```", caret: 6 })
  })

  it("in a TEXT cell: the cell becomes one, its words the source with the escapes' backslashes out (maths source is raw)", () => {
    const note = "Before\n\n\\*x\\* \\# y + Integrate[x^2, {x, 0, 1}]\n\nAfter"
    const cell = note.indexOf("\\*x")
    const out = nine(note, at(cell + 2))
    expect(out.text).toBe("Before\n\n```wl\n*x* # y + Integrate[x^2, {x, 0, 1}]\n```\n\nAfter")
    expect(kinds(out.text)).toEqual(["paragraph", "code:wl", "paragraph"])
    // The caret stays on the same character (after the `*` it was after), inside the source.
    expect(out.text.slice(out.caret - 1, out.caret + 1)).toBe("*x")
  })

  it("in a MARKDOWN cell: its markdown, the marker line gone (x*y*z keeps its stars)", () => {
    const note = `${M}\nx*y*z + **b**`
    const out = nine(note, at(note.length))
    expect(out.text).toBe("```wl\nx*y*z + **b**\n```")
    expect(out.caret).toBe(out.text.length - 4)
  })

  it("round SOME of a text cell's words: those words wrapped as Ctrl+8 wraps them, unescaped, the halves kept", () => {
    const note = "total \\# cost x^2 \\* y then more"
    const from = note.indexOf("x^2")
    const to = note.indexOf(" then")
    const out = nine(note, at(from, to - from))
    // (The halves are written by the escape rule again, as Ctrl+8 leaves them: a `#` mid-line needs no backslash.)
    expect(out.text).toBe("total # cost \n\n```wl\nx^2 * y\n```\n\n then more")
    expect(kinds(out.text)).toEqual(["paragraph", "code:wl", "paragraph"])
    // A selection over two cells: wrapped as Ctrl+8 wraps it (one fence round both).
    const two = "one\n\ntwo"
    expect(apply(two, wrapAsMaths(two, at(0, two.length)))).toBe("```wl\none\n\ntwo\n```")
  })

  it("in a code block: its fence becomes ```wl, the code kept (the caret too)", () => {
    const note = "a\n\n```python\nx^2 + y\n```\n\nb"
    const caret = note.indexOf("+ y") + 2
    const out = nine(note, at(caret))
    expect(out.text).toBe("a\n\n```wl\nx^2 + y\n```\n\nb")
    expect(out.text[out.caret]).toBe("y")
    expect(kinds(out.text)).toEqual(["paragraph", "code:wl", "paragraph"])
  })

  it("in an evaluation cell (or its answer): a new maths cell AFTER the pair, the runnable cell left as it is", () => {
    const note = "```eval wl\n1+1\n```\n\n```out\n2\n```\n\nnext"
    const seam = note.indexOf("next")
    expect(mathsCellPlan(note, at(note.indexOf("1+1")))).toEqual({ kind: "after", seam })
    expect(mathsCellPlan(note, at(note.indexOf("2\n```")))).toEqual({ kind: "after", seam })
    // Not run yet: after the cell itself; at the note's end, the note's end.
    const lone = "```eval python\nprint(1)\n```"
    expect(mathsCellPlan(lone, at(16))).toEqual({ kind: "after", seam: lone.length })
  })

  it("in a maths cell: nothing", () => {
    const note = "```wl\nx^2\n```"
    expect(mathsCellPlan(note, at(7))).toEqual({ kind: "none" })
    expect(isMathsCell(blocks(note)[0])).toBe(true)
    expect(isMathsCell(blocks("```wolfram\nx\n```")[0])).toBe(false)
  })

  it("a text cell's escaped ``` line stays escaped in the source: the fence is not closed early (gate, 2026-10-06)", () => {
    const words = escapePlain("see this\n```\nend")
    const note = `Before\n\n${words}\n\nAfter\n\n\`\`\`python\nx = 1\n\`\`\`\n\nTail`
    const out = nine(note, at(note.indexOf("see") + 1))
    expect(kinds(out.text)).toEqual(["paragraph", "code:wl", "paragraph", "code:python", "paragraph"])
    expect(blocks(out.text)[1]).toMatchObject({ kind: "code", body: "see this\n\\```\nend" })
    // Round a selection across that line: the same.
    const from = note.indexOf("this")
    const to = note.indexOf("end") + 2
    const wrappedOut = nine(note, at(from, to - from))
    expect(kinds(wrappedOut.text)).toEqual(["paragraph", "paragraph", "code:wl", "paragraph", "paragraph", "code:python", "paragraph"])
    // An indented one in a markdown-only selection over a code block too: no fence line inside the maths cell.
    const code = "one\n\n```py\nx\n```"
    const over = apply(code, wrapAsMaths(code, at(0, code.length)))
    expect(kinds(over)).toEqual(["code:wl"])
  })

  it("words holding a Link Here anchor: left as they are, a new maths cell after their cell (links still land)", () => {
    const note = "a\n\n<a id=\"here\"></a>Hello x^2\n\nb"
    const cell = note.indexOf("Hello")
    expect(mathsCellPlan(note, at(cell + 2))).toEqual({ kind: "after", seam: note.indexOf("b", cell) })
    // Round a selection holding one too; one without the anchor is wrapped.
    expect(mathsCellPlan(note, at(note.indexOf("<a"), 20)).kind).toBe("after")
    expect(mathsCellPlan(note, at(cell + 6, 3)).kind).toBe("edit")
    const marked = "<mark id=\"m\">x^2</mark> + 1"
    expect(mathsCellPlan(marked, at(3)).kind).toBe("after")
  })

  it("in a heading, a list, a quote: a new one after it (Ctrl+8's rule, the editor's `makesCellAfter`)", () => {
    for (const note of ["# Title", "- one", "> said"]) expect(mathsCellPlan(note, at(note.length)).kind).toBe("new")
  })

  it("at a bar (the + menu's Maths Cell, beside Code Block): an empty fence, a cell of its own, typed WL goes in raw", () => {
    const made = openCell({ kind: "maths" }, "one\n\ntwo", 5, "x*y")
    expect(made.markdown).toBe("one\n\n```wl\nx*y\n```\n\ntwo")
    expect(made.markdown.slice(made.caret - 3, made.caret)).toBe("x*y")
    expect(kindName({ kind: "maths" })).toBe("Maths Cell")
    expect(KIND_GROUPS.find((group) => group.some((kind) => kind.kind === "code"))!.map(kindName)).toEqual(["Code Block", "Maths Cell"])
  })
})

describe("from a maths cell", () => {
  const note = "a\n\n```wl\nIntegrate[x^2, {x, 0, 1}]\n```\n\nb"
  const inside = note.indexOf("Integrate") + 3

  it("Ctrl+7: a TEXT cell of its source, plain words by the escape rule (it never typesets)", () => {
    const change = mathsAsText(note, at(inside))!
    const out = apply(note, change)
    expect(kinds(out)).toEqual(["paragraph", "paragraph", "paragraph"])
    const words = blocks(out)[1]!
    expect(words).toMatchObject({ kind: "paragraph" })
    expect(words.kind === "paragraph" && words.markdown).toBeFalsy()
    // Escaped where it would be markup: a `*` in the source stays a star in a text cell.
    const starred = apply("```wl\nx*y*z\n```", mathsAsText("```wl\nx*y*z\n```", at(7))!)
    expect(starred).toBe(escapePlain("x*y*z"))
    expect(blocks(starred)).toEqual([{ kind: "paragraph", text: "x*y*z" }])
    // Not a maths cell: nothing here (the ladder's own Ctrl+7 runs).
    expect(mathsAsText("```python\nx\n```", at(11))).toBeNull()
    expect(mathsAsText("plain", at(1))).toBeNull()
  })

  it("Ctrl+8: a Wolfram Language CODE block of the same source (```wl would still be the maths cell)", () => {
    const out = apply(note, mathsAsCode(note, at(inside))!)
    expect(out).toBe("a\n\n```wolfram\nIntegrate[x^2, {x, 0, 1}]\n```\n\nb")
    expect(kinds(out)).toEqual(["paragraph", "code:wolfram", "paragraph"])
    expect(mathsAsCode("```python\nx\n```", at(11))).toBeNull()
    // And Ctrl+9 makes it maths again.
    expect(nine(out, at(out.indexOf("Integrate"))).text).toBe(note)
  })
})
