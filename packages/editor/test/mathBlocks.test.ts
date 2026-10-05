import { EditorState } from "@codemirror/state"
import { describe, expect, it } from "vitest"
import { typesetBlocks } from "../src/math"

/**
 * Which ```wl blocks are drawn as maths, as a function of the document and the caret (no view needed). Port-only:
 * the Mac's source pane is always on show, so it has nothing to lose; here the page is the source.
 */

const F = "```"
const state = (doc: string, caret = doc.length) =>
  EditorState.create({ doc, selection: { anchor: Math.min(caret, doc.length) } })

describe("a ```wl block is typeset unless that would hide words", () => {
  it("an ordinary block, caret away, is typeset; with the caret in it, it is source", () => {
    const doc = `before\n\n${F}wl\nSqrt[x^2 + 1]\n${F}\n\nafter`
    expect(typesetBlocks(state(doc)).map((b) => b.source)).toEqual(["Sqrt[x^2 + 1]"])
    expect(typesetBlocks(state(doc, doc.indexOf("Sqrt") + 3))).toEqual([])
  })

  it("the range is the opening fence to the end of the closing fence's line", () => {
    const doc = `x\n${F}wl\nPi\n${F}\ny`
    const [block] = typesetBlocks(state(doc))
    expect(doc.slice(block!.from, block!.to)).toBe(`${F}wl\nPi\n${F}`)
  })

  it("words on the closing fence's line keep the block as source: they would be replaced with it and vanish", () => {
    const doc = `${F}wl\nPi\n${F} and this follows the equation\n\nend`
    expect(typesetBlocks(state(doc))).toEqual([])
  })

  it("a fourth backtick, or words joined onto the fence, count as words", () => {
    expect(typesetBlocks(state(`${F}wl\nPi\n${F}\`\n\nend`))).toEqual([])
    expect(typesetBlocks(state(`${F}wl\nPi\n${F}text right under the equation\n\nend`))).toEqual([])
  })

  it("spaces after the backticks are nothing: the block is still typeset", () => {
    expect(typesetBlocks(state(`${F}wl\nPi\n${F}   \n\nend`))).toHaveLength(1)
    expect(typesetBlocks(state(`${F}wl\nPi\n${F}\t\n\nend`))).toHaveLength(1)
  })

  it("an indented fence (a block in a list item) follows the same rules", () => {
    expect(typesetBlocks(state(`- item\n  ${F}wl\n  Pi\n  ${F}\n\nend`))).toHaveLength(1)
    expect(typesetBlocks(state(`- item\n  ${F}wl\n  Pi\n  ${F} words\n\nend`))).toEqual([])
  })

  it("Backspace at the start of the line under a block (the join) takes the block back to source; the line break typesets it again", () => {
    const before = `intro\n\n${F}wl\nSum[1/n^2, {n, 1, Infinity}]\n${F}\ntext right under the equation\n\nend`
    expect(typesetBlocks(state(before, 0))).toHaveLength(1)
    const at = before.indexOf("text right under")
    const joined = state(before, at).update({ changes: { from: at - 1, to: at }, selection: { anchor: at - 1 } }).state
    expect(joined.doc.toString()).toContain(`${F}text right under the equation`)
    expect(typesetBlocks(joined)).toEqual([])
    // the caret away: still source (the words are on the page)
    expect(typesetBlocks(joined.update({ selection: { anchor: joined.doc.length } }).state)).toEqual([])
    // the line break back: typeset
    const split = joined.update({ changes: { from: at - 1, insert: "\n" }, selection: { anchor: joined.doc.length } }).state
    expect(typesetBlocks(split)).toHaveLength(1)
  })

  it("two blocks in one note are each judged on their own closing line", () => {
    const doc = `${F}wl\nPi\n${F}\n\n${F}wl\nE\n${F} oops\n\nz`
    expect(typesetBlocks(state(doc)).map((b) => b.source)).toEqual(["Pi"])
  })

  it("an unclosed fence, another language, and an empty body are not maths", () => {
    expect(typesetBlocks(state(`${F}wl\nPi\n`))).toEqual([])
    expect(typesetBlocks(state(`${F}swift\nlet x = 1\n${F}\nz`))).toEqual([])
    expect(typesetBlocks(state(`${F}wl\n${F}\nz`))).toEqual([])
    expect(typesetBlocks(state(`${F}wl\nIntegrate[\n${F}\nz`))).toEqual([])
  })
})
