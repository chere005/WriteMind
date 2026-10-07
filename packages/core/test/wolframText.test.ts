// Port-only: no XCTest. Strings, colours and linear syntax as the Wolfram Language writes them
// (src/export/wolfram/text.ts): every string 7-bit ASCII, whatever the note held.
import { describe, expect, it } from "vitest"
import { linearSyntax, wlColor, wlString } from "../src/export/wolfram/text"

describe("wlString", () => {
  it("escapes what the language escapes, by its own escapes", () => {
    expect(wlString("a\\b")).toBe(`"a\\\\b"`)
    expect(wlString(`say "hi"`)).toBe(`"say \\"hi\\""`)
    expect(wlString("one\ntwo\tthree\rfour")).toBe(`"one\\ntwo\\tthree\\rfour"`)
  })

  it("writes every other control character and DEL as \\:00hh", () => {
    expect(wlString("\u0001")).toBe(`"\\:0001"`)
    expect(wlString("\u001f")).toBe(`"\\:001f"`)
    expect(wlString("\u007f")).toBe(`"\\:007f"`)
  })

  it("keeps printable ASCII and writes the rest of the BMP as \\:hhhh and beyond it as \\|hhhhhh", () => {
    expect(wlString("Hello, world ~!")).toBe(`"Hello, world ~!"`)
    expect(wlString("é")).toBe(`"\\:00e9"`)
    expect(wlString("中")).toBe(`"\\:4e2d"`)
    expect(wlString("😀")).toBe(`"\\|01f600"`)
  })

  it("writes half of a broken surrogate pair as U+FFFD", () => {
    expect(wlString("a\ud83db")).toBe(`"a\\:fffdb"`)
    expect(wlString("\ude00")).toBe(`"\\:fffd"`)
  })

  it("is ASCII whatever it is handed", () => {
    const all = Array.from({ length: 0x2fff }, (_, i) => String.fromCharCode(i)).join("") + "😀𝔸\ud800"
    const out = wlString(all)
    expect([...out].every((character) => character.charCodeAt(0) < 128)).toBe(true)
  })
})

describe("wlColor", () => {
  it("is an RGBColor of the colour's channels, three places each", () => {
    expect(wlColor("#2D7DD2")).toBe("RGBColor[0.176, 0.490, 0.824]")
    expect(wlColor("#000")).toBe("RGBColor[0.000, 0.000, 0.000]")
  })
  it("swaps a colour that cannot be read on the white page, as the PDF does", () => {
    expect(wlColor("#FFFFF0")).toBe("RGBColor[0.000, 0.000, 0.000]")
  })
  it("is null for anything that is not a hex colour", () => {
    expect(wlColor("red")).toBeNull()
    expect(wlColor("rgb(1, 2, 3)")).toBeNull()
    expect(wlColor("#12")).toBeNull()
  })
})

describe("linearSyntax", () => {
  it("is the front end's \\!\\(\\*boxes\\)", () => {
    expect(linearSyntax(`RowBox[{"a", "+", "b"}]`)).toBe(`\\!\\(\\*RowBox[{"a", "+", "b"}]\\)`)
  })
})
