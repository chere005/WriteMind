import { describe, expect, it } from "vitest"
import { MATH_TEMPLATES, initialValues, inlineSpans, mathText, templateWL, typesetInline, type InlineSpan } from "../src/index"

/**
 * Independent verification of the maths lane, second round (Mathslane-fix1). Port-only: none of this is in the Swift
 * tests. Each block names the defect the verifiers found, so a failure says what came back.
 */

const nest = (depth: number, open: string, close: string, inner = "x"): string => {
  let out = inner
  for (let i = 0; i < depth; i++) out = open + out + close
  return out
}

describe("the linear typesetter takes time in proportion to the source, however deep it is nested", () => {
  // Before: standsAlone() DREW the arguments of a call just to ask whether it is drawn specially, and powerBase() drew
  // them again, so each level of nesting doubled the work (22 nested Exp[...]^2: 4 s; 30: minutes). The editor draws
  // every `wl:` span in view on every caret move, so a short pasted span could freeze the renderer for good.
  const FORMS: [string, string, string][] = [
    ["Exp", "Exp[", "]^2"], ["Sqrt", "Sqrt[", "]^2"], ["Abs", "Abs[", "]^2"], ["Floor", "Floor[", "]^2"],
    ["Ceiling", "Ceiling[", "]^2"], ["Norm", "Norm[", "]^2"], ["Factorial", "Factorial[", "]"],
    ["Sin", "Sin[", "]^2"], ["Log", "Log[2, ", "]^2"], ["Subscript", "Subscript[", ", i]^2"], ["Dot", "Dot[", ", x]^2"],
    ["Cross", "Cross[", ", x]^2"], ["a call of f", "f[", "]^2"], ["a group", "(", ")^2"], ["D", "D[", ", x]^2"],
    ["Binomial", "Binomial[", ", 2]^2"], ["Limit", "Limit[", ", x -> 0]^2"],
  ]

  it("the work does not double per level (24 nested Factorial and Exp-squared took over a second each before)", () => {
    // Timing ratios are noisy at sub-millisecond scale, so the check is on a generous absolute bound (the two
    // together took 20 seconds before; they take about a millisecond).
    const started = performance.now()
    inlineSpans(nest(24, "Factorial[", "]"))
    inlineSpans(nest(24, "Exp[", "]^2"))
    expect(performance.now() - started).toBeLessThan(100)
  })

  it("every form of call that can be the base of a power, 40 deep, is set in well under 100 ms", () => {
    for (const [name, open, close] of FORMS) {
      const source = nest(40, open, close)
      expect(source.length, name).toBeLessThan(2000)
      const started = performance.now()
      const spans = inlineSpans(source)
      const took = performance.now() - started
      expect(spans, name).not.toBeNull()
      expect(took, `${name} 40 deep took ${took.toFixed(1)} ms`).toBeLessThan(100)
    }
  })

  it("...and as deep as the 2000-character cap allows", () => {
    const started = performance.now()
    for (const [name, open, close] of FORMS) {
      let depth = 1
      while (nest(depth + 1, open, close).length < 1990) depth++
      const spans = inlineSpans(nest(depth, open, close))
      // (a source the parser's own depth cap refuses is null, which is fine; it must just not take long)
      expect(spans === null || spans.length > 0, name).toBe(true)
    }
    expect(performance.now() - started).toBeLessThan(1000)
  })

  it("what is drawn does not change: the same characters as the structural reading says", () => {
    expect(mathText(typesetInline("Exp[x]^2", 1)!)).toBe("(ex)2")
    expect(mathText(typesetInline("Factorial[Factorial[n]]", 1)!)).toBe("(n!)!")
    expect(mathText(typesetInline("Sqrt[Sqrt[x]^2]^2", 1)!)).toBe("(√((√x)2))2")
    expect(mathText(typesetInline("Abs[Abs[x]^2]", 1)!)).toBe("||x|2|")  // |x| stands alone: no brackets
  })
})

describe("scripts compose: a power inside a power keeps its own level", () => {
  // Before: mathScript() set EVERY run of the piece to one size and one offset, so `e^(-x^2)` was drawn e^(-x2),
  // `x^y^z` as x^(yz), `x_(n^2)` as x_(n2) and the Gaussian of the palette (Integrate[Exp[-x^2], ...]) as
  // ∫ e^(-x2) dx -- while the block form of the same source, MathML, was right.
  const levels = (spans: InlineSpan[]): Set<string> => new Set(spans.map((span) => `${span.size}/${span.raise}`))
  /** How far a piece is above the baseline of the line, in ems of the text round it. */
  const height = (span: InlineSpan): number => span.raise * span.size
  const piece = (spans: InlineSpan[], text: string): InlineSpan => {
    const found = spans.find((span) => span.text === text)
    expect(found, `a piece "${text}" in ${JSON.stringify(spans.map((s) => s.text))}`).toBeDefined()
    return found!
  }

  it("Exp[-x^2]: e, then the exponent and the exponent's exponent, at three levels", () => {
    const spans = inlineSpans("Exp[-x^2]")!
    expect(spans.map((span) => span.text).join("")).toBe("e−x2")
    expect(levels(spans).size).toBe(3)
    const e = piece(spans, "e"), x = piece(spans, "x"), two = piece(spans, "2")
    expect(e.size).toBe(1)
    expect(x.size).toBeCloseTo(0.7, 5)
    expect(two.size).toBeLessThan(x.size)
    expect(height(x)).toBeCloseTo(0.36, 5)
    expect(height(two)).toBeGreaterThan(height(x))
    expect(x.italic, "a variable in an exponent stays italic").toBe(true)
  })

  it("x^y^z: x, y raised once, z raised again", () => {
    const spans = inlineSpans("x^y^z")!
    expect(levels(spans).size).toBe(3)
    const [x, y, z] = ["x", "y", "z"].map((text) => piece(spans, text)) as [InlineSpan, InlineSpan, InlineSpan]
    expect(height(x)).toBe(0)
    expect(height(y)).toBeCloseTo(0.36, 5)
    expect(height(z)).toBeCloseTo(0.36 * 0.7 + 0.36, 5)
    expect(z.size).toBeLessThan(y.size)
    expect(y.size).toBeLessThan(x.size)
  })

  it("Exp[x^2] and Subscript[x, n^2]: a power in a power, a power in a subscript", () => {
    expect(levels(inlineSpans("Exp[x^2]")!).size).toBe(3)
    const spans = inlineSpans("Subscript[x, n^2]")!
    expect(levels(spans).size).toBe(3)
    expect(height(piece(spans, "n"))).toBeCloseTo(-0.22, 5)
    // the 2 is raised above the n, which is itself lowered: still above the baseline of the n, below the line's top
    expect(height(piece(spans, "2"))).toBeGreaterThan(height(piece(spans, "n")))
  })

  it("the palette's Gaussian reads as e to the minus x squared, not minus x2", () => {
    const gauss = MATH_TEMPLATES.find((t) => t.id === "integrate.improper")!
    const spans = inlineSpans(templateWL(gauss, initialValues(gauss)))!
    const squared = piece(spans, "2")
    const base = piece(spans, "e")
    expect(squared.size).toBeLessThan(0.7)
    expect(height(squared)).toBeGreaterThan(height(base) + 0.4)
    expect(piece(spans, "−").size, "the minus is a first-level script").toBeCloseTo(0.7, 5)
  })

  it("a subscript lowers what is already raised, and the other way round", () => {
    const spans = inlineSpans("Binomial[n^2, k]")!
    // C, then n^2 raised (a script of size 0.7 with its own 2 at 0.5), then k lowered
    expect(levels(spans).size).toBeGreaterThanOrEqual(4)
    expect(height(piece(spans, "k"))).toBeLessThan(0)
    expect(height(piece(spans, "2"))).toBeGreaterThan(height(piece(spans, "n")))
  })

  it("a tower of powers stays legible: the sizes stop at half the text and the heights stay bounded", () => {
    const tower = Array(30).fill("x").join("^")
    const spans = inlineSpans(tower)!
    expect(spans).not.toBeNull()
    for (const span of spans) {
      expect(span.size, JSON.stringify(span)).toBeGreaterThanOrEqual(0.5)
      expect(height(span), JSON.stringify(span)).toBeLessThan(1.3)
    }
    expect(spans.map((span) => span.text).join("")).toBe("x".repeat(30))
  })

  it("nothing changes for maths with no script inside a script", () => {
    expect(inlineSpans("x^2")).toEqual([
      { text: "x", size: 1, italic: true, raise: 0 },
      { text: "2", size: 0.7, italic: false, raise: 0.36 / 0.7 },
    ])
    expect(inlineSpans("Subscript[x, i]")).toEqual([
      { text: "x", size: 1, italic: true, raise: 0 },
      { text: "i", size: 0.7, italic: true, raise: -0.22 / 0.7 },
    ])
  })

  it("the characters are the same in every case: only the levels change", () => {
    for (const wl of ["x^y^z", "Exp[-x^2]", "Subscript[x, n^2]", "Sum[x^2^3, {i, 1, n^2}]", "Integrate[Exp[-x^2], {x, -Infinity, Infinity}]"]) {
      const spans = inlineSpans(wl)!
      expect(spans.map((span) => span.text).join(""), wl).toBe(mathText(typesetInline(wl, 1)!))
    }
  })
})
