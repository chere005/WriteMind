import { describe, expect, it } from "vitest"
import { codeBackspace, codeTabbing, codeTyping, inFence, strippedLevel, CODE_TAB } from "../src/markdown/codeTyping"
import { INDENT_UNIT } from "../src/markdown/formatting"
import { range, replacing } from "../src/text/range"

/** Transcribed from `WriteMindTests/CodeTypingTests.swift`. */
const typing = (input: string, text: string, caret: number, length = 0) => {
  const edit = codeTyping(input, text, range(caret, length))
  return edit ? { text: replacing(text, edit.range, edit.replacement), selection: edit.selection } : null
}

describe("typing in a code cell", () => {
  it("a bracket brings its partner", () => {
    for (const [open, close] of [["(", ")"], ["[", "]"], ["{", "}"]] as const) {
      const typed = typing(open, "let x = ", 8)
      expect(typed?.text).toBe(`let x = ${open}${close}`)
      expect(typed?.selection).toEqual(range(9, 0)) // the caret is between them
    }
  })

  it("quotes pair too", () => {
    expect(typing("\"", "print(", 6)?.text).toBe("print(\"\"")
    expect(typing("`", "", 0)?.text).toBe("``")
  })

  it("typing the closer steps over it", () => {
    // Otherwise finishing the call you just opened doubles the bracket.
    const typed = typing(")", "f()", 2)
    expect(typed?.text).toBe("f()")
    expect(typed?.selection).toEqual(range(3, 0))
  })

  it("a bracket wraps what is selected", () => {
    const typed = typing("(", "let x = a + b", 8, 5)
    expect(typed?.text).toBe("let x = (a + b)")
    expect(typed?.selection).toEqual(range(9, 5)) // still selected, inside
  })

  it("an apostrophe in a word is just an apostrophe", () => {
    expect(codeTyping("'", "don", range(3, 0))).toBeNull()
    expect(codeTyping("'", "x = it", range(6, 0))).toBeNull()
  })

  it("an ordinary character is left alone", () => {
    expect(codeTyping("a", "let ", range(4, 0))).toBeNull()
    // a closer with nothing to step over goes in as itself
    expect(codeTyping(")", "f(", range(2, 0))).toBeNull()
  })

  it("only a single character is a keystroke (a paste is not)", () => {
    expect(codeTyping("((", "", range(0, 0))).toBeNull()
    expect(codeTyping("", "", range(0, 0))).toBeNull()
  })
})

describe("backspace in a code cell", () => {
  it("between a pair takes both", () => {
    const edit = codeBackspace("f()", range(2, 0))
    expect(edit?.range).toEqual(range(1, 2))
    expect(edit?.replacement).toBe("")
  })

  it("anywhere else is ordinary", () => {
    expect(codeBackspace("f(x)", range(3, 0))).toBeNull()
    expect(codeBackspace("f()", range(0, 0))).toBeNull()
    expect(codeBackspace("f()", range(2, 1))).toBeNull()
  })
})

describe("tab in a code cell", () => {
  const apply = (code: string, edit: { range: ReturnType<typeof range>; replacement: string }) =>
    replacing(code, edit.range, edit.replacement)

  it("puts in a tab", () => {
    const edit = codeTabbing("let x", range(0, 0), false)
    expect(edit.replacement).toBe("\t")
    expect(edit.selection).toEqual(range(1, 0))
  })

  it("over several lines indents every one", () => {
    const code = "a = 1\nb = 2\nc = 3"
    expect(apply(code, codeTabbing(code, range(0, 11), false))).toBe("\ta = 1\n\tb = 2\nc = 3")
  })

  it("Shift-Tab takes a level off", () => {
    const code = "\ta = 1\n    b = 2"
    expect(apply(code, codeTabbing(code, range(0, 15), true))).toBe("a = 1\nb = 2") // a tab, or up to four spaces
  })

  it("outdenting a line with no indentation leaves it alone", () => {
    expect(strippedLevel("a = 1")).toBe("a = 1")
    expect(strippedLevel("  a = 1")).toBe("a = 1")
    expect(strippedLevel("\t\ta = 1")).toBe("\ta = 1")
  })

  it("the markdown pane writes four spaces in a fence", () => {
    // The file should hold spaces: every other reader shows them the same width.
    const edit = codeTabbing("let x", range(0, 0), false, INDENT_UNIT)
    expect(edit.replacement).toBe("    ")
    expect(edit.selection).toEqual(range(4, 0))
  })

  it("a code cell writes a real tab so a copy carries one", () => {
    expect(codeTabbing("let x", range(0, 0), false).replacement).toBe("\t")
  })

  it("four spaces go on every line of a selection too", () => {
    const code = "a = 1\nb = 2"
    expect(apply(code, codeTabbing(code, range(0, 11), false, "    "))).toBe("    a = 1\n    b = 2")
  })

  it("only indents inside a fence", () => {
    const note = "Just a paragraph\n\n```swift\nlet a = 1\n```"
    expect(inFence(note, range(3, 0))).toBe(false)
    expect(inFence(note, range(30, 0))).toBe(true)
  })

  it("the tab character is a tab (the editor's grid makes it four wide)", () => {
    expect(CODE_TAB).toBe("\t")
  })
})
