import { describe, expect, it } from "vitest"
import {
  MATH_GROUPS, MATH_TEMPLATES, binary, call, canonicalWL, initialValues, insertMath, isMathFence,
  list, mathExpressionInCode, mathBlock, mathGlyph, mathInline, mathText, num, parseWL, sym,
  templateWL, templatesIn, typesetInline,
} from "../src/index"
import { applied, range } from "../src/text/range"

/**
 * Transcribed from `WriteMindTests/MathTests.swift`: WLParserTests,
 * WLPrinterTests, MathTemplateTests, MathMarkupTests, InsertMathTests and
 * CalculusTypesettingTests.
 */

describe("WLParser", () => {
  it("an integral parses into its head and its bounds", () => {
    expect(parseWL("Integrate[x^2, {x, 0, 1}]")).toEqual(call(sym("Integrate"), [
      binary("^", sym("x"), num("2")),
      list([sym("x"), num("0"), num("1")]),
    ]))
  })

  it("times binds tighter than plus and power tighter than both", () => {
    expect(parseWL("a + b*c^2")).toEqual(
      binary("+", sym("a"), binary("*", sym("b"), binary("^", sym("c"), num("2")))))
  })

  it("powers associate to the right", () => {
    expect(parseWL("2^3^4")).toEqual(
      binary("^", num("2"), binary("^", num("3"), num("4"))))
  })

  it("two things side by side are a product", () => {
    expect(parseWL("2 x")).toEqual(binary("*", num("2"), sym("x")))
  })

  it("greek arrives as one name", () => {
    expect(parseWL("\\[Alpha] + 1")).toEqual(binary("+", sym("\\[Alpha]"), num("1")))
    expect(mathGlyph("\\[Alpha]")).toBe("α")
    expect(mathGlyph("Pi")).toBe("π")
  })

  it("half-typed maths is not an expression", () => {
    expect(parseWL("Integrate[")).toBeNull()
    expect(parseWL("x +")).toBeNull()
    expect(parseWL("{1, 2")).toBeNull()
  })
})

describe("WLPrinter", () => {
  it("canonical form drops brackets it does not need and keeps the ones it does", () => {
    expect(canonicalWL("(x+1)/(2)")).toBe("(x + 1)/2")
    expect(canonicalWL("Sum[i^2,{i,1,n}]")).toBe("Sum[i^2, {i, 1, n}]")
    expect(canonicalWL("a*(b + c)")).toBe("a*(b + c)")
  })

  it("anything that does not parse is left exactly as it was typed", () => {
    expect(canonicalWL("Integrate[x")).toBe("Integrate[x")
  })

  it("every spelling of the same thing lands on one form", () => {
    expect(canonicalWL("x^2+1")).toBe(canonicalWL("x ^ 2 + 1"))
  })
})

describe("MathTemplate", () => {
  const byId = (id: string) => MATH_TEMPLATES.find((t) => t.id === id)!

  it("the fields fill in the slots", () => {
    expect(templateWL(byId("integrate.definite"), ["Sin[x]", "x", "0", "Pi"]))
      .toBe("Integrate[Sin[x], {x, 0, Pi}]")
  })

  it("an empty field falls back to what the slot suggested", () => {
    expect(templateWL(byId("sum"), ["", "k", " ", "10"])).toBe("Sum[i^2, {k, 1, 10}]")
  })

  it("every template in the palette writes WL that parses", () => {
    for (const t of MATH_TEMPLATES) {
      const wl = templateWL(t, initialValues(t))
      expect(parseWL(wl), `${t.id} wrote unparseable WL: ${wl}`).not.toBeNull()
      expect(wl.includes("#"), `${t.id} left a slot unfilled: ${wl}`).toBe(false)
    }
  })

  it("every group has something in it", () => {
    for (const g of MATH_GROUPS) expect(templatesIn(g).length, `${g} is empty`).toBeGreaterThan(0)
  })
})

describe("MathMarkup", () => {
  it("maths is spelled as ordinary markdown", () => {
    expect(mathInline("Pi")).toBe("`wl:Pi`")
    expect(mathBlock("Pi")).toBe("```wl\nPi\n```")
    expect(isMathFence("wl")).toBe(true)
    expect(isMathFence("swift")).toBe(false)
    expect(isMathFence("wolfram"), "a wolfram fence is code").toBe(false)
    expect(isMathFence(null)).toBe(false)
  })

  it("only a code span that says wl is maths", () => {
    expect(mathExpressionInCode("wl:Sqrt[2]")).toBe("Sqrt[2]")
    expect(mathExpressionInCode("let x = 1")).toBeNull()
    expect(mathExpressionInCode("wl:")).toBeNull()
  })

  it("typesetting gives up on what is not an expression", () => {
    expect(typesetInline("Integrate[")).toBeNull()
    expect(typesetInline("Integrate[x^2, {x, 0, 1}]")).not.toBeNull()
  })
})

describe("insertMath", () => {
  const after = (text: string, selection: ReturnType<typeof range>, wl: string, display: boolean) => {
    const e = insertMath(text, selection, wl, display)
    return { out: applied(text, e).text, e }
  }

  it("inline maths goes in where the caret is", () => {
    const { out, e } = after("the area is  here", range(12, 0), "Pi", false)
    expect(out).toBe("the area is `wl:Pi` here")
    expect(e.selection.length).toBe(0)
  })

  it("maths on its own line opens a line for itself", () => {
    expect(after("before", range(6, 0), "Sqrt[2]", true).out).toBe("before\n```wl\nSqrt[2]\n```\n")
  })

  it("maths at the start of a line does not add an empty one", () => {
    expect(after("before\n\nafter", range(8, 0), "Pi", true).out)
      .toBe("before\n\n```wl\nPi\n```\nafter")
  })

  it("the selection is replaced, not wrapped", () => {
    expect(after("keep this", range(5, 4), "E", false).out).toBe("keep `wl:E`")
  })
})

describe("calculus typesetting", () => {
  const set = (wl: string): string => {
    const runs = typesetInline(wl)
    return runs === null ? "" : mathText(runs)
  }

  it("partials read as partials", () => {
    expect(set("D[f[x, y], x]")).toContain("∂")
    expect(set("D[f[x, y], x, y]")).toContain("∂")
    expect(set("Dt[f[x, t], t]").startsWith("d")).toBe(true)
  })

  it("the vector operators use nabla", () => {
    expect(set("Grad[f, {x, y, z}]")).toContain("∇")
    expect(set("Div[v, {x, y, z}]")).toContain("∇·")
    expect(set("Curl[v, {x, y, z}]")).toContain("∇×")
    expect(set("Laplacian[f, {x, y}]")).toContain("∇")
  })

  it("a double integral gets two signs", () => {
    expect(set("Integrate[f, {x, 0, 1}, {y, 0, 1}]")).toContain("∫∫")
    expect(set("ContourIntegrate[f[z], z]")).toContain("∮")
  })

  it("a one-sided limit shows which side", () => {
    expect(set("Limit[1/x, x -> 0, Direction -> \"FromAbove\"]")).toContain("⁺")
    expect(set("Limit[1/x, x -> 0, Direction -> \"FromBelow\"]")).toContain("⁻")
  })

  it("the new symbols have glyphs", () => {
    expect(mathGlyph("\\[PlusMinus]")).toBe("±")
    expect(mathGlyph("\\[Implies]")).toBe("⇒")
    expect(mathGlyph("\\[ContourIntegral]")).toBe("∮")
    expect(mathGlyph("Reals")).toBe("ℝ")
    expect(mathGlyph("\\[Alpha]"), "the greek table still wins").toBe("α")
  })

  it("every template writes something the parser understands", () => {
    for (const t of MATH_TEMPLATES) {
      const wl = templateWL(t, initialValues(t))
      expect(wl.length, t.id).toBeGreaterThan(0)
      expect(parseWL(wl), `${t.id} wrote ${wl}`).not.toBeNull()
    }
  })

  it("the calculus group grew", () => {
    expect(templatesIn("Calculus").length).toBeGreaterThan(15)
    expect(templatesIn("Symbols").length).toBeGreaterThan(30)
    expect(new Set(MATH_TEMPLATES.map((t) => t.id)).size, "ids are unique").toBe(MATH_TEMPLATES.length)
  })
})
