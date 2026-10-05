import { EditorState, type Extension, type Transaction, type TransactionSpec } from "@codemirror/state"
import { describe, expect, it } from "vitest"
import { RangeSet } from "@codemirror/state"
import type { Decoration } from "@codemirror/view"
import { foldField, setFolds } from "../src/fold"
import { notebookField } from "../src/notebook"
import { renderedField, setRendered } from "../src/rendered"
import { armedField } from "../src/seams"
import { BlockWidget, previewField } from "../src/preview/field"
import { holdingField, setHolding } from "../src/preview/hold"

/**
 * e3-editor-perf (2026-10-04): the rendered page is patched, not rebuilt, on a keystroke (the decorations are mapped
 * through the change and only the cells the change could have touched are made again). The page built from nothing
 * is the reference: after every transaction of long random chains of edits, selections, picks and folds, the patched
 * page must be the very same decorations.
 */

let seed = 1
const rnd = () => (seed = (seed * 48271) % 2147483647) / 2147483647
const pick = <T,>(items: T[]): T => items[Math.floor(rnd() * items.length)]!

const LINES = [
  "", "", "", "   ", "text of a paragraph", "more words here", "  indented words", "# Heading", "## Sub heading", "### Third",
  "# Heading", "## Sub heading", "- bullet", "- [ ] todo", "- [x] done", "* star item", "1. one", "> quote", "---", "```", "```ts",
  "  ```", "let a = 1", "```wl", "Sqrt[x]", "`inline` code", "text with trailing  ",
]
const randomDoc = (lines: number): string => Array.from({ length: lines }, () => pick(LINES)).join("\n") + (rnd() < 0.3 ? "\n" : "")
const FRAGMENTS = ["\n", "\n\n", "\n\n\n", "x", "# ", "- ", "```", "\n```\n", "> ", "---", " ", "a b c", "\n# H\n", "- [ ] ", "1. ", "```ts\n", "\n\n\n\n", "\n\nword\n\n"]

const extensions: Extension = [notebookField, renderedField, holdingField, foldField, armedField, previewField]

/** The decorations of a set, as comparable text. */
function show(set: RangeSet<Decoration>): string[] {
  const out: string[] = []
  for (const cursor = set.iter(); cursor.value; cursor.next()) {
    const value = cursor.value
    const widget = (value.spec as { widget?: unknown }).widget
    let what: string
    if (widget instanceof BlockWidget) what = `block ${JSON.stringify(widget.source)} held=${widget.held} touching=${widget.touching} kind=${widget.block.kind}`
    else if (widget) what = "widget"
    else what = `class ${String((value.spec as { class?: string }).class)}`
    out.push(`${cursor.from}-${cursor.to} ${what}`)
  }
  return out
}

/** The same note, selection, picks and folds, with the page built from nothing. */
function fresh(state: EditorState): EditorState {
  const base = EditorState.create({ doc: state.doc.toString(), extensions })
  const keys = [...state.field(foldField).collapsed]
  return base.update({
    selection: state.selection,
    effects: [setRendered.of(true), setFolds.of(keys), setHolding.of(state.field(holdingField))],
  }).state
}

function agree(state: EditorState, label: string): void {
  const patched = state.field(previewField)
  const built = fresh(state).field(previewField)
  const a = show(patched.decorations)
  const b = show(built.decorations)
  if (JSON.stringify(a) !== JSON.stringify(b)) {
    const at = a.findIndex((line, i) => line !== b[i])
    throw new Error(`${label}\ndoc ${JSON.stringify(state.doc.toString())}\nselection ${JSON.stringify(state.selection.toJSON())}\n`
      + `first difference at #${at}\npatched ${JSON.stringify(a.slice(Math.max(0, at - 1), at + 3))}\nbuilt   ${JSON.stringify(b.slice(Math.max(0, at - 1), at + 3))}`)
  }
  expect(show(patched.blocks)).toEqual(show(built.blocks))
  expect(patched.heldOnly).toBe(built.heldOnly)
}

function randomStep(state: EditorState): TransactionSpec {
  const length = state.doc.length
  const kind = rnd()
  if (kind < 0.55) {
    const from = Math.floor(rnd() * (length + 1))
    const to = rnd() < 0.35 ? from : Math.min(length, from + Math.floor(rnd() * (rnd() < 0.15 ? 80 : 6)))
    const insert = rnd() < 0.2 ? "" : pick(FRAGMENTS) + (rnd() < 0.3 ? pick(FRAGMENTS) : "")
    const caret = from + insert.length
    // usually the caret goes with the typing, sometimes it stays where it was
    return rnd() < 0.8 ? { changes: { from, to, insert }, selection: { anchor: caret } } : { changes: { from, to, insert } }
  }
  if (kind < 0.8) {
    const at = Math.floor(rnd() * (length + 1))
    if (rnd() < 0.5) return { selection: { anchor: at } }
    return { selection: { anchor: at, head: Math.min(length, at + Math.floor(rnd() * 200)) } }
  }
  if (kind < 0.88) return { effects: setHolding.of(rnd() < 0.6) }
  if (kind < 0.94) {
    const keys = state.field(notebookField).sections.map((s) => s.key)
    const chosen = keys.filter(() => rnd() < 0.3)
    return { effects: setFolds.of(rnd() < 0.2 ? [] : chosen) }
  }
  // several cursors / ranges at once
  const a = Math.floor(rnd() * (length + 1))
  const b = Math.floor(rnd() * (length + 1))
  return { selection: { anchor: Math.min(a, b), head: Math.min(a, b) + (rnd() < 0.5 ? 0 : Math.min(length - Math.min(a, b), 5)) } }
}

describe("the rendered page, patched", () => {
  it("is the page built from nothing after every step of long random chains", () => {
    seed = 17
    let steps = 0
    for (let chain = 0; chain < 70; chain++) {
      let state = EditorState.create({ doc: randomDoc(4 + Math.floor(rnd() * 50)), extensions })
      state = state.update({ effects: setRendered.of(true), selection: { anchor: 0 } }).state
      agree(state, `chain ${chain} start`)
      for (let step = 0; step < 40; step++) {
        const spec = randomStep(state)
        let tr: Transaction
        try { tr = state.update(spec) } catch { continue }
        state = tr.state
        agree(state, `chain ${chain} step ${step}: ${JSON.stringify(spec)}`)
        steps++
      }
    }
    expect(steps).toBeGreaterThan(2000)
  })

  it("survives the rendered switch being turned off and on mid-chain, and an empty note", () => {
    seed = 29
    let state = EditorState.create({ doc: "", extensions })
    state = state.update({ effects: setRendered.of(true) }).state
    agree(state, "empty")
    state = state.update({ changes: { from: 0, insert: "a" }, selection: { anchor: 1 } }).state
    agree(state, "one letter")
    state = state.update({ changes: { from: 1, insert: "\n\n" }, selection: { anchor: 3 } }).state
    agree(state, "paragraph break at the end")
    state = state.update({ effects: setRendered.of(false) }).state
    state = state.update({ changes: { from: 0, to: 1, insert: "# Title" } }).state
    state = state.update({ effects: setRendered.of(true) }).state
    agree(state, "switched back on")
    state = state.update({ changes: { from: 0, to: state.doc.length, insert: "" } }).state
    agree(state, "emptied")
  })
})

