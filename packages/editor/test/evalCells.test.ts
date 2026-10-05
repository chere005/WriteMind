/**
 * Evaluation cells in the editor: the pairs read off the notebook field, which cell Shift+Enter belongs to, and the
 * bracket kinds. From `WriteMindTests/CellBracketKindTests.swift` (799b13b: testOnlyACellIsACell,
 * testAGroupStandsProudOfWhatItHolds) and `EvaluationCellTests.swift` (the pair numbering, over the editor's own
 * parse rather than a fresh one).
 */

import { EditorState } from "@codemirror/state"
import { describe, expect, it } from "vitest"
import { pairNumber } from "@writemind/core"
import { isCell, PAIR_OVERHANG } from "../src/brackets"
import { EditorView } from "@codemirror/view"
import { EVAL_MARGIN, evaluatesHere, evaluationCells, groupsIn, holdsEvaluation, markColumn } from "../src/eval/index"
import { PAGE_LEFT } from "../src/theme"
import { notebookState } from "../src/notebook"

const state = (doc: string, caret = 0) => EditorState.create({ doc, selection: { anchor: caret }, extensions: [notebookState] })

describe("CellBracketKindTests (799b13b)", () => {
  it("only a cell is a cell: a section folds and a pair's bracket is furniture round cells", () => {
    expect(isCell({ foldable: false })).toBe(true)
    expect(isCell({ foldable: true })).toBe(false)
    expect(isCell({ foldable: false, group: true })).toBe(false)
  })

  it("a group stands proud of what it holds", () => {
    expect(PAIR_OVERHANG).toBeGreaterThan(0)
  })
})

describe("the pairs, read off the notebook field", () => {
  const note = "# N\n\n```eval python\na\n```\n\n```out\nA\n```\n\nWords.\n\n```eval wl\nb\n```\n\n```out\nB\n```"

  it("finds every In/Out pair, numbered by its place in the note, and follows an edit", () => {
    const s = state(note)
    const groups = groupsIn(s)
    expect(groups.length).toBe(2)
    expect(groups.map((g) => pairNumber(g.input, groups))).toEqual([1, 2])
    // The same parse gives the same answer (cached per parse) …
    expect(groupsIn(s)).toBe(groups)
    // … and an edit that deletes an answer takes its pair away.
    const at = note.indexOf("```out\nA")
    const edited = s.update({ changes: { from: at, to: at + "```out\nA\n```\n\n".length } }).state
    expect(groupsIn(edited).length).toBe(1)
  })

  it("lets Shift+Enter be a run only in an evaluation cell", () => {
    expect(evaluatesHere(state(note, note.indexOf("a\n```")))).toBe(true)
    expect(evaluatesHere(state(note, note.indexOf("Words")))).toBe(false)
    expect(evaluatesHere(state(note, note.indexOf("A\n```")))).toBe(false)
    expect(evaluatesHere(state("```python\nx\n```", 11))).toBe(false)
    // At the very end of the cell's last line too, where a caret sits after typing.
    const one = "```eval python\nx\n```"
    expect(evaluatesHere(state(one, one.length))).toBe(true)
  })
})

describe("the marks' column (Sean, 2026-10-05: keep the In/Out indentation clean)", () => {
  const classes = (doc: string) => EditorState.create({ doc, extensions: [notebookState, evaluationCells] })
    .facet(EditorView.editorAttributes).map((a) => a.class ?? "").join(" ")

  it("is wider than the page's own margin, and only in a note that holds an evaluation cell", () => {
    expect(EVAL_MARGIN).toBeGreaterThan(PAGE_LEFT)
    const fence = "```"
    expect(holdsEvaluation(state(`# N\n\n${fence}eval python\nx\n${fence}`))).toBe(true)
    expect(holdsEvaluation(state(`# N\n\n${fence}python\nx\n${fence}`))).toBe(false)
    expect(holdsEvaluation(state("Words only."))).toBe(false)
    // An answer alone is not an evaluation cell: no column for it.
    expect(holdsEvaluation(state(`${fence}out\n2\n${fence}`))).toBe(false)
    expect(classes(`${fence}eval wl\n1+1\n${fence}`)).toContain("wm-eval-note")
    expect(classes(`${fence}wl\n1+1\n${fence}`)).not.toContain("wm-eval-note")
  })

  it("keeps an older pair (python over out, no eval fence) in the ordinary margin, its Out[n] sized to that margin", () => {
    const fence = "```"
    const old = `# N\n\n${fence}python\nprint(1)\n${fence}\n\n${fence}out\n1\n${fence}`
    expect(groupsIn(state(old)).length).toBe(1)
    // Its text does not move (nor the ink over it) …
    expect(classes(old)).not.toContain("wm-eval-note")
    // … and its Out[n] is drawn in front of the words, never over them.
    expect(markColumn(state(old))).toBeLessThan(PAGE_LEFT)
    const evaluating = state(`${fence}eval python\nx\n${fence}`)
    expect(markColumn(evaluating)).toBeGreaterThan(PAGE_LEFT)
    expect(markColumn(evaluating)).toBeLessThan(EVAL_MARGIN)
  })
})
