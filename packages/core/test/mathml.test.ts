import { describe, expect, it } from "vitest"
import {
  MATH_TEMPLATES, canonicalWL, initialValues, mathNodeText, mathmlFor, mathmlString, parseWL,
  serializeMathML, templateWL, typesetInline, mathText, templatesIn,
} from "../src/index"

/**
 * The two-dimensional maths view. The Swift `MathView` is SwiftUI, which has
 * no XCTest of its own (`WriteMindTests/MathTests.swift` covers the parser,
 * printer, templates and the linear typesetter — see `math.test.ts`); these
 * are the shapes `MathView.swift` draws, written down as the MathML that
 * draws them here. Each row: what it is, the WL, the display, and the MathML.
 * Regenerate with C:/CLAUDIO/agents/e2e/maths/gen_mathml_test.mjs and READ
 * the diff.
 */

const SNAPSHOTS: [string, string, "block" | "inline", string][] = [
  ["a fraction stacks its parts", "x/y", "block",
    "<math display=\"block\"><mfrac><mi>x</mi><mi>y</mi></mfrac></math>"],
  ["a sum on top of a fraction needs no brackets of its own", "(x + 1)/2", "block",
    "<math display=\"block\"><mfrac><mrow><mi>x</mi><mo>+</mo><mn>1</mn></mrow><mn>2</mn></mfrac></math>"],
  ["a power raises its exponent", "x^2", "inline",
    "<math display=\"inline\"><msup><mi>x</mi><mn>2</mn></msup></math>"],
  ["a stacked fraction under a power is bracketed so the exponent reads as the whole", "(a/b)^2", "block",
    "<math display=\"block\"><msup><mrow><mo stretchy=\"true\" form=\"prefix\">(</mo><mfrac><mi>a</mi><mi>b</mi></mfrac><mo stretchy=\"true\" form=\"postfix\">)</mo></mrow><mn>2</mn></msup></math>"],
  ["a power of a power keeps its brackets", "(2^3)^4", "block",
    "<math display=\"block\"><msup><mrow><mo stretchy=\"false\" form=\"prefix\">(</mo><msup><mn>2</mn><mn>3</mn></msup><mo stretchy=\"false\" form=\"postfix\">)</mo></mrow><mn>4</mn></msup></math>"],
  ["a sum in a power is bracketed", "(a + b)^2", "block",
    "<math display=\"block\"><msup><mrow><mo stretchy=\"false\" form=\"prefix\">(</mo><mrow><mi>a</mi><mo>+</mo><mi>b</mi></mrow><mo stretchy=\"false\" form=\"postfix\">)</mo></mrow><mn>2</mn></msup></math>"],
  ["a minus sign does not take the power with it", "-x^2", "inline",
    "<math display=\"inline\"><mrow><mo>−</mo><msup><mi>x</mi><mn>2</mn></msup></mrow></math>"],
  ["a root gets its roof", "Sqrt[x^2 + 1]", "block",
    "<math display=\"block\"><msqrt><mrow><msup><mi>x</mi><mn>2</mn></msup><mo>+</mo><mn>1</mn></mrow></msqrt></math>"],
  ["an nth root", "Surd[x, 3]", "block",
    "<math display=\"block\"><mroot><mi>x</mi><mn>3</mn></mroot></math>"],
  ["a definite integral carries its bounds on the sign", "Integrate[x^2, {x, 0, 1}]", "block",
    "<math display=\"block\"><mrow><msubsup><mo>∫</mo><mn>0</mn><mn>1</mn></msubsup><msup><mi>x</mi><mn>2</mn></msup><mspace width=\"0.17em\"/><mi mathvariant=\"normal\">d</mi><mi>x</mi></mrow></math>"],
  ["an indefinite integral ends in its differential", "Integrate[f[x], x]", "block",
    "<math display=\"block\"><mrow><mo>∫</mo><mrow><mi>f</mi><mo>⁡</mo><mrow><mo stretchy=\"false\" form=\"prefix\">(</mo><mi>x</mi><mo stretchy=\"false\" form=\"postfix\">)</mo></mrow></mrow><mspace width=\"0.17em\"/><mi mathvariant=\"normal\">d</mi><mi>x</mi></mrow></math>"],
  ["a double integral has a sign per variable", "Integrate[f, {x, 0, 1}, {y, 0, 1}]", "block",
    "<math display=\"block\"><mrow><msubsup><mo>∫</mo><mn>0</mn><mn>1</mn></msubsup><msubsup><mo>∫</mo><mn>0</mn><mn>1</mn></msubsup><mi>f</mi><mspace width=\"0.17em\"/><mi mathvariant=\"normal\">d</mi><mi>x</mi><mspace width=\"0.17em\"/><mi mathvariant=\"normal\">d</mi><mi>y</mi></mrow></math>"],
  ["a contour integral", "ContourIntegrate[f[z], z]", "block",
    "<math display=\"block\"><mrow><mo>∮</mo><mrow><mi>f</mi><mo>⁡</mo><mrow><mo stretchy=\"false\" form=\"prefix\">(</mo><mi>z</mi><mo stretchy=\"false\" form=\"postfix\">)</mo></mrow></mrow><mspace width=\"0.17em\"/><mi mathvariant=\"normal\">d</mi><mi>z</mi></mrow></math>"],
  ["a sum carries its limits above and below", "Sum[i^2, {i, 1, n}]", "block",
    "<math display=\"block\"><mrow><munderover><mo largeop=\"true\" movablelimits=\"true\">∑</mo><mrow><mi>i</mi><mo>=</mo><mn>1</mn></mrow><mi>n</mi></munderover><msup><mi>i</mi><mn>2</mn></msup></mrow></math>"],
  ["a product likewise", "Product[i, {i, 1, n}]", "block",
    "<math display=\"block\"><mrow><munderover><mo largeop=\"true\" movablelimits=\"true\">∏</mo><mrow><mi>i</mi><mo>=</mo><mn>1</mn></mrow><mi>n</mi></munderover><mi>i</mi></mrow></math>"],
  ["a limit has its approach under it", "Limit[Sin[x]/x, x -> 0]", "block",
    "<math display=\"block\"><mrow><munder><mo movablelimits=\"true\">lim</mo><mrow><mi>x</mi><mo>→</mo><mn>0</mn></mrow></munder><mfrac><mrow><mi>sin</mi><mo>⁡</mo><mrow><mo stretchy=\"false\" form=\"prefix\">(</mo><mi>x</mi><mo stretchy=\"false\" form=\"postfix\">)</mo></mrow></mrow><mi>x</mi></mfrac></mrow></math>"],
  ["a one-sided limit says which side", "Limit[1/x, x -> 0, Direction -> \"FromBelow\"]", "block",
    "<math display=\"block\"><mrow><munder><mo movablelimits=\"true\">lim</mo><mrow><mi>x</mi><mo>→</mo><msup><mn>0</mn><mo>−</mo></msup></mrow></munder><mfrac><mn>1</mn><mi>x</mi></mfrac></mrow></math>"],
  ["a matrix is a table between brackets", "{{a, b}, {c, d}}", "block",
    "<math display=\"block\"><mrow><mo stretchy=\"true\" form=\"prefix\">(</mo><mtable><mtr><mtd><mi>a</mi></mtd><mtd><mi>b</mi></mtd></mtr><mtr><mtd><mi>c</mi></mtd><mtd><mi>d</mi></mtd></mtr></mtable><mo stretchy=\"true\" form=\"postfix\">)</mo></mrow></math>"],
  ["a list that is not a matrix is just braces", "{1, 2, 3}", "inline",
    "<math display=\"inline\"><mrow><mo stretchy=\"false\" form=\"prefix\">{</mo><mn>1</mn><mo separator=\"true\">,</mo><mn>2</mn><mo separator=\"true\">,</mo><mn>3</mn><mo stretchy=\"false\" form=\"postfix\">}</mo></mrow></math>"],
  ["a binomial is a fraction with no bar", "Binomial[n, k]", "block",
    "<math display=\"block\"><mrow><mo stretchy=\"true\" form=\"prefix\">(</mo><mfrac linethickness=\"0\"><mi>n</mi><mi>k</mi></mfrac><mo stretchy=\"true\" form=\"postfix\">)</mo></mrow></math>"],
  ["a partial derivative is a fraction of differentials", "D[f, x]", "block",
    "<math display=\"block\"><mfrac><mrow><mo>∂</mo><mi>f</mi></mrow><mrow><mo>∂</mo><mi>x</mi></mrow></mfrac></math>"],
  ["the nth derivative has its order on both", "D[f, {x, 2}]", "block",
    "<math display=\"block\"><mfrac><mrow><msup><mo>∂</mo><mn>2</mn></msup><mi>f</mi></mrow><mrow><mo>∂</mo><msup><mi>x</mi><mn>2</mn></msup></mrow></mfrac></math>"],
  ["a mixed partial", "D[f, x, y]", "block",
    "<math display=\"block\"><mfrac><mrow><msup><mo>∂</mo><mn>2</mn></msup><mi>f</mi></mrow><mrow><mrow><mo>∂</mo><mi>x</mi></mrow><mspace width=\"0.15em\"/><mrow><mo>∂</mo><mi>y</mi></mrow></mrow></mfrac></math>"],
  ["a total derivative", "Dt[f, t]", "block",
    "<math display=\"block\"><mfrac><mrow><mi mathvariant=\"normal\">d</mi><mi>f</mi></mrow><mrow><mi mathvariant=\"normal\">d</mi><mi>t</mi></mrow></mfrac></math>"],
  ["the vector operators", "Curl[v, {x, y, z}]", "block",
    "<math display=\"block\"><mrow><mo>∇</mo><mo>×</mo><mspace width=\"0.1em\"/><mi>v</mi></mrow></math>"],
  ["a function name is upright and its argument bracketed", "Sin[x]", "block",
    "<math display=\"block\"><mrow><mi>sin</mi><mo>⁡</mo><mrow><mo stretchy=\"false\" form=\"prefix\">(</mo><mi>x</mi><mo stretchy=\"false\" form=\"postfix\">)</mo></mrow></mrow></math>"],
  ["a function of several arguments", "f[x, y]", "block",
    "<math display=\"block\"><mrow><mi>f</mi><mo>⁡</mo><mrow><mo stretchy=\"false\" form=\"prefix\">(</mo><mi>x</mi><mo separator=\"true\">,</mo><mi>y</mi><mo stretchy=\"false\" form=\"postfix\">)</mo></mrow></mrow></math>"],
  ["two things side by side are a product", "2 x", "inline",
    "<math display=\"inline\"><mrow><mn>2</mn><mo lspace=\"0em\" rspace=\"0.12em\">⁢</mo><mi>x</mi></mrow></math>"],
  ["a negative sign and a sum", "-x + 1", "inline",
    "<math display=\"inline\"><mrow><mrow><mo>−</mo><mi>x</mi></mrow><mo>+</mo><mn>1</mn></mrow></math>"],
  ["the relations have their glyphs", "a <= b", "inline",
    "<math display=\"inline\"><mrow><mi>a</mi><mo>≤</mo><mi>b</mi></mrow></math>"],
  ["greek letters and constants", "\\[Alpha] + Pi", "inline",
    "<math display=\"inline\"><mrow><mi>α</mi><mo>+</mo><mi>π</mi></mrow></math>"],
  ["the number sets and infinity", "Reals + Infinity", "inline",
    "<math display=\"inline\"><mrow><mi>ℝ</mi><mo>+</mo><mi>∞</mi></mrow></math>"],
  ["exp is a power of e", "Exp[-x^2]", "block",
    "<math display=\"block\"><msup><mi>e</mi><mrow><mo>−</mo><msup><mi>x</mi><mn>2</mn></msup></mrow></msup></math>"],
  ["a log to a base", "Log[2, x]", "block",
    "<math display=\"block\"><mrow><msub><mi>log</mi><mn>2</mn></msub><mo>⁡</mo><mi>x</mi></mrow></math>"],
  ["a subscript", "Subscript[x, i]", "inline",
    "<math display=\"inline\"><msub><mi>x</mi><mi>i</mi></msub></math>"],
  ["floor and absolute value are fences", "Floor[Abs[x]]", "block",
    "<math display=\"block\"><mrow><mo stretchy=\"false\" form=\"prefix\">⌊</mo><mrow><mo stretchy=\"false\" form=\"prefix\">|</mo><mi>x</mi><mo stretchy=\"false\" form=\"postfix\">|</mo></mrow><mo stretchy=\"false\" form=\"postfix\">⌋</mo></mrow></math>"],
  ["text is text, and < is escaped", "\"a < b\"", "inline",
    "<math display=\"inline\"><mtext>a &lt; b</mtext></math>"],
]

describe("MathML builder (the shapes MathView.swift draws)", () => {
  for (const [name, source, display, expected] of SNAPSHOTS) {
    it(name, () => {
      expect(mathmlString(source, display)).toBe(expected)
    })
  }

  it("half-typed maths is not an expression, so there is nothing to draw", () => {
    expect(mathmlString("Integrate[")).toBeNull()
    expect(mathmlFor("x +")).toBeNull()
  })

  it("a minus sign in front of a power now parses as -(x^2) and prints back the same", () => {
    expect(canonicalWL("-x^2")).toBe("-x^2")
    expect(canonicalWL("(-x)^2")).toBe("(-x)^2")
    expect(canonicalWL("Exp[-x^2]")).toBe("Exp[-x^2]")
    expect(parseWL("-x^2")).toEqual({ kind: "negate", operand: parseWL("x^2") })
    expect(parseWL("2 - -x")).not.toBeNull()
  })

  it("the same characters are on the page in two dimensions as in one", () => {
    // The linear typesetter and the MathML must agree on every glyph, so a
    // note reads the same whichever draws it (spaces and the invisible
    // operators aside).
    const squash = (text: string) => text.replace(/[\s\u2009\u2061\u2062]/g, "")
    for (const source of ["x + 1", "\\[Alpha] + Pi", "Sum[i, {i, 1, n}]", "a <= b", "Reals", "-x"]) {
      const tree = mathmlFor(source)!
      const runs = typesetInline(source)!
      expect(squash(mathNodeText(tree)), source).toBe(squash(mathText(runs)))
    }
  })

  it("every template in the palette has a two-dimensional form", () => {
    for (const t of MATH_TEMPLATES) {
      const wl = templateWL(t, initialValues(t))
      const out = mathmlString(wl)
      expect(out, `${t.id}: ${wl}`).not.toBeNull()
      expect(out!.includes("<mi>?</mi>"), `${t.id} drew a question mark`).toBe(false)
    }
  })

  it("the big operators put their limits where the display style wants them", () => {
    expect(mathmlString("Sum[i, {i, 1, n}]")).toContain("<munderover>")
    expect(mathmlString("Sum[i, {i, 1, Infinity}]")).toContain("<mi>∞</mi>")
    expect(mathmlString("Sum[i, {i}]")).not.toContain("munder")
    expect(mathmlString("Integrate[f, {x, a, b}]")).toContain("<msubsup>")
  })

  it("the calculus group all draw something with the right sign on it", () => {
    const sign = (id: string) => {
      const t = MATH_TEMPLATES.find((one) => one.id === id)!
      return mathNodeText(mathmlFor(templateWL(t, initialValues(t)))!)
    }
    expect(sign("grad")).toContain("∇")
    expect(sign("div")).toContain("∇·")
    expect(sign("curl")).toContain("∇×")
    expect(sign("laplacian")).toContain("∇2")
    expect(sign("integrate.double").split("∫").length - 1).toBe(2)
    expect(sign("integrate.contour")).toContain("∮")
    expect(sign("derivative.partial.mixed")).toContain("∂")
    expect(sign("limit.above")).toContain("+")
    expect(templatesIn("Calculus").length).toBeGreaterThan(15)
  })

  it("serialising escapes what XML would take for markup", () => {
    expect(serializeMathML({ tag: "mtext", text: "a & b < c" })).toBe("<mtext>a &amp; b &lt; c</mtext>")
    expect(serializeMathML({ tag: "mspace", children: [], attrs: { width: "1em" } })).toBe('<mspace width="1em"/>')
  })
})

describe("the linear typesetter agrees where the Swift one was off", () => {
  const linear = (wl: string) => mathText(typesetInline(wl)!)
  it("a floor, a ceiling and a norm are round their argument", () => {
    expect(linear("Floor[x]")).toBe("⌊x⌋")
    expect(linear("Ceiling[x]")).toBe("⌈x⌉")
    expect(linear("Norm[v]")).toBe("‖v‖")
  })
  it("roots other than the square one", () => {
    expect(linear("CubeRoot[x]")).toBe("∛x")
    expect(linear("Surd[x, 5]")).toBe("5√x")
  })
})

describe("pathological sources are left as text, never thrown (port-only: the notebook's decorations must not throw)", () => {
  it("thousands of nested brackets are text, quickly", () => {
    const started = Date.now()
    expect(mathmlFor("Sqrt[".repeat(3000) + "x" + "]".repeat(3000))).toBeNull()
    expect(mathmlFor("(".repeat(5000) + "x" + ")".repeat(5000))).toBeNull()
    expect(mathmlFor("{".repeat(2000) + "1" + "}".repeat(2000))).toBeNull()
    expect(Date.now() - started).toBeLessThan(500)
  })
  it("a 20000-term sum is text, not a 27-second freeze", () => {
    const started = Date.now()
    expect(mathmlFor(Array.from({ length: 20000 }, (_, i) => "a" + i).join(" + "))).toBeNull()
    expect(Date.now() - started).toBeLessThan(500)
  })
  it("a tree too deep to lay out is text even when it parses", () => {
    expect(mathmlFor("x" + "^x".repeat(500))).toBeNull()
  })
  it("ordinary deep maths still sets", () => {
    expect(mathmlFor("(".repeat(60) + "x" + ")".repeat(60))).not.toBeNull()
    expect(mathmlFor(Array.from({ length: 100 }, (_, i) => "a" + i).join(" + "))).not.toBeNull()
  })
})

describe("what handwriting and keyboards hand over (port-only tolerance in the WL reader)", () => {
  const inline = (wl: string) => mathmlString(wl, "inline")
  it("a lone = is an equals sign: the reader turns \"y = 2x + 1\" into exactly that", () => {
    expect(inline("y = x")).toBe('<math display="inline"><mrow><mi>y</mi><mo>=</mo><mi>x</mi></mrow></math>')
    expect(inline("x ==")).toBeNull()
    expect(inline("x =")).toBeNull()
    // == still means equals, <= and >= and != are untouched by the new operator
    expect(inline("a <= b")).toContain("<mo>≤</mo>")
    expect(inline("a != b")).toContain("<mo>≠</mo>")
  })
  it("raised digits are powers: x² is x^2, x¹⁰ is x^10, x⁻¹ is x^-1, and a name does not swallow them", () => {
    expect(inline("x²")).toBe(inline("x^2"))
    expect(inline("x¹⁰")).toBe(inline("x^10"))
    expect(inline("x⁻¹")).toBe(inline("x^(-1)"))
    expect(inline("a²b")).toBe(inline("a^2 b"))
  })
  it("the signs typed instead of the ASCII spelling: ≤ ≥ ≠ × · ÷ −", () => {
    expect(inline("x ≥ 2")).toBe(inline("x >= 2"))
    expect(inline("x ≤ 2")).toBe(inline("x <= 2"))
    expect(inline("x ≠ 2")).toBe(inline("x != 2"))
    // (× and · are NOT the same as * on the page: they are read as a product but drawn as written -- below.)
    expect(inline("3 ÷ 4")).toBe(inline("3 / 4"))
    expect(inline("3 − 4")).toBe(inline("3 - 4"))
  })
})

describe("a product keeps the sign it was written with (port-only; the fix for '3 × 4' drawn as '3 4', which reads as 34)", () => {
  // CHANGED from the first port, which asserted `3 × 4` == `3 * 4` (both invisible times): that equality
  // WAS the defect, so the test was changed and the behaviour with it.
  const inline = (wl: string) => mathmlString(wl, "inline")
  const sign = (wl: string) => {
    const html = inline(wl)!
    return /<mo>([×·])<\/mo>/.exec(html)?.[1] ?? (html.includes("⁢") ? "invisible" : "none")
  }

  it("× and · stay on the page, between numbers and between letters", () => {
    expect(inline("3 × 4")).toBe('<math display="inline"><mrow><mn>3</mn><mo>×</mo><mn>4</mn></mrow></math>')
    expect(inline("3 · 4")).toBe('<math display="inline"><mrow><mn>3</mn><mo>·</mo><mn>4</mn></mrow></math>')
    expect(sign("a × b")).toBe("×")
    expect(sign("a · b")).toBe("·")
    expect(sign("2 × x")).toBe("×")
  })

  it("a handwritten line of arithmetic keeps every sign it has", () => {
    const html = inline("x = 2 × 3 + 1")!
    expect(html).toContain("<mn>2</mn><mo>×</mo><mn>3</mn>")
    expect(html.match(/<mo>×<\/mo>/g)).toHaveLength(1)
    expect(inline("3 × 4 = 12")).toBe('<math display="inline"><mrow><mrow><mn>3</mn><mo>×</mo><mn>4</mn></mrow><mo>=</mo><mn>12</mn></mrow></math>')
  })

  it("a chain of them keeps them all", () => {
    expect(inline("2 × 3 × 4")!.match(/<mo>×<\/mo>/g)).toHaveLength(2)
  })

  it("a number that follows anything is multiplied by a visible dot, written or not: 2*3 is 2·3, not 23", () => {
    expect(inline("2*3")).toBe('<math display="inline"><mrow><mn>2</mn><mo>·</mo><mn>3</mn></mrow></math>')
    expect(inline("2 3")).toBe(inline("2*3"))
    expect(sign("x*2")).toBe("·")
    expect(sign("(a + b)*2")).toBe("·")
    expect(sign("2*3^2")).toBe("·")
    expect(inline("2*3*4")!.match(/<mo>·<\/mo>/g)).toHaveLength(2)
    // 2 and then a stacked 3/4 would read as two and three quarters
    expect(sign("2*(3/4)")).toBe("·")
  })

  it("everything that reads as a product with no number in the way stays side by side", () => {
    expect(inline("2 x")).toBe('<math display="inline"><mrow><mn>2</mn><mo lspace="0em" rspace="0.12em">⁢</mo><mi>x</mi></mrow></math>')
    expect(sign("a*b")).toBe("invisible")
    expect(sign("2*(x + 1)")).toBe("invisible")
    expect(sign("2 Pi")).toBe("invisible")
    expect(sign("x*(a/b)")).toBe("invisible")
    expect(sign("2*Sqrt[x]")).toBe("invisible")
    expect(sign("(a + b)*(c + d)")).toBe("invisible")
  })

  it("the sign is a matter of how it is drawn: the expression still prints back as the same WL product", () => {
    expect(canonicalWL("3 × 4")).toBe("3*4")
    expect(canonicalWL("a · b")).toBe("a*b")
    // and the ASCII star carries no sign of its own
    expect(parseWL("3 * 4")).toEqual({ kind: "binary", op: "*", left: { kind: "number", value: "3" }, right: { kind: "number", value: "4" } })
    expect(parseWL("3 × 4")).toEqual({ kind: "binary", op: "*", left: { kind: "number", value: "3" }, right: { kind: "number", value: "4" }, written: "×" })
  })

  it("a source typed with no space at all (what a reader of handwriting hands over) is the same", () => {
    expect(inline("3×4")).toBe(inline("3 × 4"))
    expect(inline("a·b")).toBe(inline("a · b"))
  })
})
