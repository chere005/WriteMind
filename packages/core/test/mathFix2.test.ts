import { describe, expect, it } from "vitest"
import {
  MATH_TEMPLATES, binary, call, canonicalWL, group, initialValues, inlineSpans, insertMath, mathText, mathmlFor,
  mathmlString, num, parseWL, sym, templateWL, typesetInline,
} from "../src/index"
import { applied, range } from "../src/text/range"

/**
 * Second independent check of the maths lane (Mathslane-fix2). Port-only: none of this is in the Swift tests.
 * Each block names the defect the verifier found, so a failure says what came back.
 */

const FENCE = "```"

describe("insertMath puts the caret OFF the closing fence's line (a typeset block swallows what is on it)", () => {
  const caretAfter = (text: string, at: number, display = true) => {
    const e = insertMath(text, range(at, 0), "Pi", display)
    const out = applied(text, e).text
    return { out, caret: e.selection.location, rest: out.slice(e.selection.location) }
  }

  // (A cell of its own since 2026-10-05, Sean: a blank line either side of the block, and the caret on the blank line
  // UNDER it — the bar there — rather than on the words below.)
  it("on a blank line between two paragraphs: after the closing fence's line break, not before it", () => {
    const text = "first paragraph\n\nsecond paragraph"
    const { out, caret, rest } = caretAfter(text, "first paragraph\n".length)
    expect(out).toBe(`first paragraph\n\n${FENCE}wl\nPi\n${FENCE}\n\nsecond paragraph`)
    expect(rest, "the caret is on the blank line under the block").toBe("\nsecond paragraph")
    expect(out.slice(0, caret).endsWith(`${FENCE}\n`)).toBe(true)
  })

  it("at the end of a line that has more below it", () => {
    const { out, rest } = caretAfter("first\nsecond", "first".length)
    expect(out).toBe(`first\n\n${FENCE}wl\nPi\n${FENCE}\n\nsecond`)
    expect(rest).toBe("\nsecond")
  })

  it("at the end of the note the caret ends it (the palette arms the bar under the block)", () => {
    expect(caretAfter("before", 6).out).toBe(`before\n\n${FENCE}wl\nPi\n${FENCE}`)
    expect(caretAfter("before", 6).rest).toBe("")
    expect(caretAfter("before\n\nafter", 8).rest).toBe("\nafter")
  })

  it("never at the end of the closing fence, wherever it goes, but at the very end of the note", () => {
    for (const [text, at] of [["a\nb", 1], ["\nb", 0], ["a\n\n\nb", 2], ["a\n", 1]] as [string, number][]) {
      const { out, caret } = caretAfter(text, at)
      const lineStart = out.lastIndexOf("\n", caret - 1) + 1
      expect(out.slice(lineStart, caret), JSON.stringify(text)).not.toMatch(/```$/)
    }
    for (const [text, at] of [["", 0], ["a", 1], ["a\n", 2]] as [string, number][]) {
      const { out, caret } = caretAfter(text, at)
      expect(caret, JSON.stringify(text)).toBe(out.length)
    }
  })

  it("inline maths is unchanged: the caret is just after the code span", () => {
    const { out, caret } = caretAfter("a b", 1, false)
    expect(out).toBe("a`wl:Pi` b")
    expect(caret).toBe(1 + "`wl:Pi`".length)
  })
})

describe("brackets written after a factor are kept (f(2) is not f times 2)", () => {
  it("they parse as a group, and only there", () => {
    expect(parseWL("f(2)")).toEqual(binary("*", sym("f"), group(num("2"))))
    expect(parseWL("2(x + 1)")).toEqual(binary("*", num("2"), group(binary("+", sym("x"), num("1")))))
    // elsewhere brackets only group: nothing to keep
    expect(parseWL("(x + 1)/(2)")).toEqual(binary("/", binary("+", sym("x"), num("1")), num("2")))
    expect(parseWL("a*(b)")).toEqual(binary("*", sym("a"), sym("b")))
    expect(parseWL("x^(2)")).toEqual(binary("^", sym("x"), num("2")))
    expect(parseWL("f[(2)]")).toEqual(call(sym("f"), [num("2")]))
  })

  it("only the first bracket after a factor is the factor's; what is inside is as it was", () => {
    expect(parseWL("f((x + 1))")).toEqual(binary("*", sym("f"), group(binary("+", sym("x"), num("1")))))
    expect(parseWL("f(x)^2")).toEqual(binary("*", sym("f"), binary("^", group(sym("x")), num("2"))))
  })

  it("they print back as WL that reads the same way", () => {
    expect(canonicalWL("f(2)")).toBe("f*(2)")
    expect(canonicalWL("2(x+1)")).toBe("2*(x + 1)")
  })

  const mathml = (wl: string) => mathmlString(wl, "inline")!
  const OPEN = '<mo stretchy="false" form="prefix">(</mo>', CLOSE = '<mo stretchy="false" form="postfix">)</mo>'

  it("f(2), y(0) and f(x) are drawn as function applications, exactly as f[2] is", () => {
    expect(mathml("f(2)")).toBe(mathml("f[2]"))
    expect(mathml("y(0)")).toBe(mathml("y[0]"))
    expect(mathml("f(x)")).toBe(mathml("f[x]"))
    expect(mathml("sin(x)")).toBe(mathml("sin[x]"))
    expect(mathml("f(2)")).toBe(`<math display="inline"><mrow><mi>f</mi><mo>⁡</mo><mrow>${OPEN}<mn>2</mn>${CLOSE}</mrow></mrow></math>`)
  })

  it("so a line of algebra reads as written: f(2) = 4, y(0) = 1, f(x) = 2x -- no dot, no lost brackets", () => {
    const text = (wl: string) => mathText(typesetInline(wl, 1)!)
    expect(text("f(2) = 4")).toBe("f(2) = 4")
    expect(text("y(0) = 1")).toBe("y(0) = 1")
    expect(text("f(x) = 2x")).toBe("f(x) = 2\u2009x")
    expect(mathml("f(2) = 4")).not.toContain("<mo>·</mo>")
    expect(mathml("y(0) = 1")).not.toContain("<mo>·</mo>")
    expect(mathml("f(x) = 2x")).toContain(`<mi>f</mi><mo>⁡</mo><mrow>${OPEN}<mi>x</mi>${CLOSE}</mrow>`)
  })

  it("the same in a line of text, for sums and products of brackets", () => {
    const text = (wl: string) => mathText(typesetInline(wl, 1)!)
    expect(text("f(x+1)")).toBe("f(x + 1)")
    expect(text("2(x + 1)")).toBe("2(x + 1)")
    expect(text("3(2)")).toBe("3(2)")
    expect(text("(a + b)(c + d)")).toBe("(a + b)(c + d)")
  })

  it("a name before a power of brackets: f(x)^2 keeps its brackets and its exponent", () => {
    expect(mathml("f(x)^2")).toBe(`<math display="inline"><mrow><mi>f</mi><mo>⁡</mo><msup><mrow>${OPEN}<mi>x</mi>${CLOSE}</mrow><mn>2</mn></msup></mrow></math>`)
    expect(mathText(typesetInline("f(x)^2", 1)!)).toBe("f(x)2")
  })

  it("a number in brackets after a number is still a product the page shows", () => {
    expect(mathml("3(2)")).toContain(`<mn>3</mn>`)
    expect(mathml("3(2)")).toContain(`${OPEN}<mn>2</mn>${CLOSE}`)
    expect(mathml("3(2)")).not.toContain("·")
  })

  it("an explicit sign is still the written one: a*(b) and 2*(x + 1) are as before", () => {
    expect(mathml("2*(x + 1)")).toContain('<mo lspace="0em" rspace="0.12em">⁢</mo>')
    expect(mathml("2*3")).toContain("<mo>·</mo>")
  })
})

describe("a power is drawn as applying to ALL of its base", () => {
  const linear = (wl: string) => mathText(typesetInline(wl, 1)!)
  const mathml = (wl: string) => mathmlString(wl, "inline")!
  /** The base of the outermost power, as drawn: its first child. */
  const OPEN = '<mo stretchy="false" form="prefix">(</mo>', CLOSE = '<mo stretchy="false" form="postfix">)</mo>'

  it("MathML: a call drawn as a script row, a product or a log is bracketed", () => {
    expect(mathml("Exp[x]^2")).toBe(`<math display="inline"><msup><mrow>${OPEN}<msup><mi>e</mi><mi>x</mi></msup>${CLOSE}</mrow><mn>2</mn></msup></math>`)
    expect(mathml("Dot[a, b]^2")).toBe(`<math display="inline"><msup><mrow>${OPEN}<mrow><mi>a</mi><mo>·</mo><mi>b</mi></mrow>${CLOSE}</mrow><mn>2</mn></msup></math>`)
    expect(mathml("Log[2, x]^2")).toBe(`<math display="inline"><msup><mrow>${OPEN}<mrow><msub><mi>log</mi><mn>2</mn></msub><mo>⁡</mo><mi>x</mi></mrow>${CLOSE}</mrow><mn>2</mn></msup></math>`)
  })

  it("MathML: the rest that can be misread -- Cross, a sum, a derivative, a factorial, a fraction -- are bracketed too", () => {
    for (const wl of ["Cross[a, b]^2", "Sum[i, {i, 1, n}]^2", "Product[i, {i, 1, n}]^2", "Integrate[x, x]^2",
      "Limit[1/x, x -> 0]^2", "D[f, x]^2", "Factorial[n]^2", "Divide[a, b]^2", "Binomial[n, k]^2"]) {
      const out = mathml(wl)
      expect(out.startsWith("<math display=\"inline\"><msup><mrow><mo"), wl).toBe(true)
      expect(out, wl).toMatch(/form="prefix">[(]<\/mo>/)
    }
  })

  it("MathML: what stands alone gets no brackets of its own", () => {
    for (const [wl, base] of [
      ["x^2", "<mi>x</mi>"], ["2^2", "<mn>2</mn>"], ["Pi^2", "<mi>π</mi>"], ["Sqrt[x]^2", "<msqrt><mi>x</mi></msqrt>"],
      ["Subscript[x, i]^2", "<msub><mi>x</mi><mi>i</mi></msub>"],
    ] as [string, string][]) {
      expect(mathml(wl), wl).toBe(`<math display="inline"><msup>${base}<mn>2</mn></msup></math>`)
    }
    // a name applied to bracketed arguments, and things in brackets already, are not wrapped again
    expect(mathml("Sin[x]^2")).toBe(`<math display="inline"><msup><mrow><mi>sin</mi><mo>⁡</mo><mrow>${OPEN}<mi>x</mi>${CLOSE}</mrow></mrow><mn>2</mn></msup></math>`)
    expect(mathml("f[x]^2")).toContain(`<msup><mrow><mi>f</mi><mo>⁡</mo>`)
    expect(mathml("Abs[x]^2")).toBe('<math display="inline"><msup><mrow><mo stretchy="false" form="prefix">|</mo><mi>x</mi><mo stretchy="false" form="postfix">|</mo></mrow><mn>2</mn></msup></math>')
    expect(mathml("{a, b}^2").match(/form="prefix"/g)).toHaveLength(1)
    expect(mathml("(a + b)^2").match(/form="prefix"/g), "a sum is bracketed once, as before").toHaveLength(1)
  })

  it("MathML: a factorial takes the same brackets (x² then ! is (x²)!)", () => {
    expect(mathml("Factorial[x^2]")).toBe(`<math display="inline"><mrow><mrow>${OPEN}<msup><mi>x</mi><mn>2</mn></msup>${CLOSE}</mrow><mo>!</mo></mrow></math>`)
    expect(mathml("Factorial[n]")).toBe('<math display="inline"><mrow><mi>n</mi><mo>!</mo></mrow></math>')
  })

  it("a line of text: a call drawn as a sum, a product or a script row is bracketed", () => {
    expect(linear("Exp[x]^2")).toBe("(ex)2")
    expect(linear("Dot[a, b]^2")).toBe("(a·b)2")
    expect(linear("Cross[a, b]^2")).toBe("(a×b)2")
    expect(linear("Log[2, x]^2")).toBe("(log2 x)2")
    expect(linear("Sin[x]^2")).toBe("(sin\u2009x)2")
    expect(linear("Sqrt[x]^2")).toBe("(√x)2")
    expect(linear("(x^2)^3")).toBe("(x2)3")
    expect(linear("(a + b)^2")).toBe("(a + b)2")
    expect(linear("(-x)^2")).toBe("(−x)2")
    expect(linear("Factorial[x^2]")).toBe("(x2)!")
    expect(linear("Factorial[n]^2")).toBe("(n!)2")
    expect(linear("Sum[i, {i, 1, n}]^2").startsWith("(")).toBe(true)
  })

  it("a line of text: what stands alone is not bracketed", () => {
    expect(linear("x^2")).toBe("x2")
    expect(linear("f[x]^2")).toBe("f(x)2")
    expect(linear("Abs[x]^2")).toBe("|x|2")
    expect(linear("Floor[x]^2")).toBe("⌊x⌋2")
    expect(linear("{a, b}^2")).toBe("{a, b}2")
    expect(linear("Subscript[x, i]^2")).toBe("xi2")
    expect(linear("Factorial[n]")).toBe("n!")
  })

  it("Dot and Cross are products in a line of text too (the Swift drew Dot(a, b))", () => {
    expect(linear("Dot[a, b]")).toBe("a·b")
    expect(linear("Cross[a, b]")).toBe("a×b")
  })
})

describe("a product keeps its sign in a line of text too (3 × 4 is not 34)", () => {
  const linear = (wl: string) => mathText(typesetInline(wl, 1)!)
  it("the written sign stays, with room round it", () => {
    expect(linear("3 × 4 = 12")).toBe("3 × 4 = 12")
    expect(linear("a · b")).toBe("a · b")
    expect(linear("x = 2 × 3 + 1")).toBe("x = 2 × 3 + 1")
  })
  it("a number after any factor takes a dot, written or not", () => {
    expect(linear("2*3")).toBe("2 · 3")
    expect(linear("2 3")).toBe("2 · 3")
    expect(linear("x*2")).toBe("x · 2")
    expect(linear("(a + b)*2")).toBe("(a + b) · 2")
  })
  it("letters and brackets side by side stay side by side", () => {
    expect(linear("2 x")).toBe("2\u2009x")
    expect(linear("a*b")).toBe("a\u2009b")
    expect(linear("2*(x + 1)")).toBe("2\u2009(x + 1)")
  })
})

describe("inlineSpans (what the page draws for maths in a line of prose)", () => {
  it("an integral: a big sign, bounds lowered and raised, an italic variable, an upright d", () => {
    const all = inlineSpans("Integrate[x^2, {x, 0, 1}]")!
    expect(all.map((one) => one.text).join("")).toBe("∫01 x2 dx")
    const sign = all[0]!
    expect(sign.text).toBe("∫")
    expect(sign.size).toBeGreaterThan(1)
    const lower = all.find((one) => one.text === "0")!
    const upper = all.find((one) => one.text === "1")!
    expect(lower.raise).toBeLessThan(0)
    expect(upper.raise).toBeGreaterThan(0)
    expect(lower.size).toBeLessThan(1)
    expect(all.find((one) => one.text === "x" && one.italic), "the variable is italic").toBeDefined()
  })

  it("neighbours with the same look are one span", () => {
    expect(inlineSpans("a + b + c")).toEqual([
      { text: "a", size: 1, italic: true, raise: 0 },
      { text: " + ", size: 1, italic: false, raise: 0 },
      { text: "b", size: 1, italic: true, raise: 0 },
      { text: " + ", size: 1, italic: false, raise: 0 },
      { text: "c", size: 1, italic: true, raise: 0 },
    ])
  })

  it("nothing is taller than a line: a fraction, a derivative, a limit and a matrix are all runs of text", () => {
    for (const wl of ["(a + b)/2", "D[f, x]", "Limit[Sin[x]/x, x -> 0]", "{{a, b}, {c, d}}", "Binomial[n, k]",
      "Sum[1/n^2, {n, 1, Infinity}]"]) {
      const all = inlineSpans(wl)!
      expect(all, wl).not.toBeNull()
      for (const one of all) {
        // no piece is bigger than a big operator sign, and a script is only moved by a fraction of an em
        expect(one.size, wl).toBeLessThanOrEqual(1.3)
        expect(Math.abs(one.raise) * one.size, wl).toBeLessThan(0.5)
      }
    }
  })

  it("half-typed maths, a long source and a pathological one are not maths, and never throw", () => {
    expect(inlineSpans("Integrate[")).toBeNull()
    expect(inlineSpans("")).toBeNull()
    expect(inlineSpans("x + ".repeat(600) + "1")).toBeNull()
    const started = Date.now()
    expect(() => inlineSpans("(".repeat(900) + "x" + ")".repeat(900))).not.toThrow()
    expect(inlineSpans("Sqrt[".repeat(3000) + "x" + "]".repeat(3000))).toBeNull()
    expect(Date.now() - started).toBeLessThan(1000)
  })

  it("every template in the palette sets as a line of text", () => {
    for (const t of MATH_TEMPLATES) {
      const wl = templateWL(t, initialValues(t))
      const all = inlineSpans(wl)
      expect(all, `${t.id}: ${wl}`).not.toBeNull()
      expect(all!.map((one) => one.text).join("").includes("?"), `${t.id} drew a question mark`).toBe(false)
    }
  })

  it("whatever is in view, the two forms are the same maths: block and inline are built from one parse", () => {
    for (const wl of ["f(2) = 4", "Exp[x]^2", "Dot[a, b]^2", "3 × 4 = 12", "(a+b)(c+d)"]) {
      expect(mathmlFor(wl, "inline"), wl).not.toBeNull()
      expect(inlineSpans(wl), wl).not.toBeNull()
    }
  })
})
