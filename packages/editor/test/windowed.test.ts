import { EditorState } from "@codemirror/state"
import { codeBackspace, codeTabbing, codeTyping, outdentForBackspace, type Edit, type Range } from "@writemind/core"
import { describe, expect, it } from "vitest"
import { aroundSelection, backspaceMayOutdent, overLines } from "../src/windowed"

/**
 * e3-editor-perf (2026-10-04): the rules that read a character or a line are handed that character or line instead of
 * the whole note (a string of 500 KB made for every Backspace, Return and character typed in a code cell). Each is held
 * to its answer over the whole text, on random notes, carets and selections.
 */

let seed = 4
const rnd = () => (seed = (seed * 48271) % 2147483647) / 2147483647
const pick = <T,>(items: T[]): T => items[Math.floor(rnd() * items.length)]!
const LINES = ["", "  indented", "\tfoo(bar)", "- item", "  - nested", "1. one", "> quote", "let a = [1, 2]", "x = \"s\"", "{}", "()", "''", "text", "    ", "- [ ] todo", "```ts", "```"]
const doc = (n: number) => Array.from({ length: n }, () => pick(LINES)).join("\n") + (rnd() < 0.3 ? "\n" : "")
const selections = (text: string): Range[] => {
  const out: Range[] = []
  for (let k = 0; k < 6; k++) {
    const a = Math.floor(rnd() * (text.length + 1))
    out.push({ location: a, length: 0 })
    out.push({ location: a, length: Math.min(text.length - a, Math.floor(rnd() * 25)) })
  }
  return out
}
const same = (a: Edit | null, b: Edit | null) => expect(a).toEqual(b)

describe("windowed rules", () => {
  it("a character typed, a Backspace and a Tab in code: the same answer from the window as from the whole text", () => {
    for (let i = 0; i < 400; i++) {
      const text = doc(1 + Math.floor(rnd() * 30))
      const state = EditorState.create({ doc: text })
      for (const where of selections(text)) {
        for (const input of ["(", "[", "\"", "'", ")", "a", "{"]) {
          same(aroundSelection(state, where, 1, 1, (w, s) => codeTyping(input, w, s)), codeTyping(input, text, where))
        }
        if (where.length === 0) same(aroundSelection(state, where, 1, 1, codeBackspace), codeBackspace(text, where))
        for (const outdent of [false, true]) {
          for (const unit of ["\t", "    "]) {
            expect(overLines(state, where, (w, s) => codeTabbing(w, s, outdent, unit))).toEqual(codeTabbing(text, where, outdent, unit))
          }
        }
        // Backspace in a prefix: when the line says no, the rule says null over the whole text
        if (where.length === 0 && !backspaceMayOutdent(state, where.location)) same(outdentForBackspace(text, where), null)
      }
    }
  })
})
