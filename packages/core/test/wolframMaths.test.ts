// Port-only: no XCTest. A maths cell's source as the kernel reads it (src/export/wolfram/maths.ts): the port's two
// spellings of its own — a lone `=`, brackets written after a name — undone, and nothing else touched.
import { describe, expect, it } from "vitest"
import { kernelSpelling, mathsCellSource } from "../src/export/wolfram/maths"

describe("kernelSpelling", () => {
  it("writes an equation's = as ==, so evaluating it assigns nothing", () => {
    expect(kernelSpelling("y = 2x + 1")).toBe("y == 2*x + 1")
  })

  it("makes brackets written after a name the call they are", () => {
    expect(kernelSpelling("f(2) = 4")).toBe("f[2] == 4")
    expect(kernelSpelling("2 f(x)")).toBe("2*f[x]")
    expect(kernelSpelling("f(x)^2")).toBe("f[x]^2")
    expect(kernelSpelling("f(g(x))")).toBe("f[g[x]]")
    expect(kernelSpelling("3 × f(x)")).toBe("3*f[x]")
  })

  it("keeps brackets after anything else, where they only group", () => {
    expect(kernelSpelling("2(x+1)")).toBe("2*(x + 1)")
    expect(kernelSpelling("(a + b)(a - b)")).toBe("(a + b)*(a - b)")
  })

  it("writes the signs typed for the eye as their ASCII operators", () => {
    expect(kernelSpelling("3 × 4")).toBe("3*4")
    expect(kernelSpelling("a · b")).toBe("a*b")
    expect(kernelSpelling("x²")).toBe("x^2")
    expect(kernelSpelling("a ≤ b")).toBe("a <= b")
    expect(kernelSpelling("a ≠ b")).toBe("a != b")
    expect(kernelSpelling("6 ÷ 2 − 1")).toBe("6/2 - 1")
  })

  it("keeps a named character and what the parser already spells the kernel's way", () => {
    expect(kernelSpelling("\\[Alpha] + 1")).toBe("\\[Alpha] + 1")
    expect(kernelSpelling("Integrate[x^2, {x, 0, 1}]")).toBe("Integrate[x^2, {x, 0, 1}]")
    expect(kernelSpelling("a == b")).toBe("a == b")
  })

  it("hands over source it cannot read as it is written", () => {
    expect(kernelSpelling("f[x_] := x^2")).toBe("f[x_] := x^2")
    expect(kernelSpelling("2 +")).toBe("2 +")
  })

  it("still writes the signs typed for the eye as ASCII in source it cannot read (the kernel reads x² as a symbol)", () => {
    // None of these parse in the port, so the character-level pass is the only thing between them and the kernel.
    expect(kernelSpelling("f[x_] := x²")).toBe("f[x_] := x^2")
    expect(kernelSpelling("f[x_] := a·x")).toBe("f[x_] := a*x")
    expect(kernelSpelling("Solve[x² == 4, x] /. x -> 1")).toBe("Solve[x^2 == 4, x] /. x -> 1")
    expect(kernelSpelling("a·b // N")).toBe("a*b // N")
    expect(kernelSpelling("Map[#² &, {1, 2}]")).toBe("Map[#^2 &, {1, 2}]")
    expect(kernelSpelling("π r² + √2 // N")).toBe("π r^2 + √2 // N")
    expect(kernelSpelling("f[x_] := (x + 1)³ − x⁻¹⁰ ≤ 6 ÷ 3 × y ≥ 1 ≠ 2")).toBe("f[x_] := (x + 1)^3 - x^-10 <= 6 / 3 * y >= 1 != 2")
  })

  it("leaves a string literal's characters alone in source it cannot read", () => {
    expect(kernelSpelling("f[x_] := StringJoin[\"x²·y \\\" −\", x²]")).toBe("f[x_] := StringJoin[\"x²·y \\\" −\", x^2]")
  })
})

describe("mathsCellSource", () => {
  it("is the body's lines trimmed and joined by a space", () => {
    expect(mathsCellSource("  Integrate[x^2,\n   {x, 0, 1}]  \n")).toBe("Integrate[x^2, {x, 0, 1}]")
    expect(mathsCellSource("")).toBe("")
  })
})
