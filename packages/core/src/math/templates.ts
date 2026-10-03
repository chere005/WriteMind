/**
 * What the maths button offers. Every one of them writes Wolfram Language,
 * which is what a note actually holds — `#1`, `#2` … are the slots the
 * fields fill in.
 *
 * Ported from `WriteMind/Math/MathTemplates.swift`, plus
 * `MarkdownFormatting.insertMath` (the edit that puts the result in a note).
 */

import { clamped, edit, end, range, type Edit, type Range } from "../text/range"
import { mathBlock, mathInline } from "./typesetter"

export type MathGroup = "Calculus" | "Algebra" | "Functions" | "Relations" | "Symbols" | "Greek"

export const MATH_GROUPS: MathGroup[] =
  ["Calculus", "Algebra", "Functions", "Relations", "Symbols", "Greek"]

export interface MathSlot {
  label: string
  initial: string
}

export interface MathTemplate {
  id: string
  group: MathGroup
  name: string
  /** What the palette button shows. */
  glyph: string
  form: string
  slots: MathSlot[]
}

const slot = (label: string, initial: string): MathSlot => ({ label, initial })

const make = (
  id: string, group: MathGroup, name: string, glyph: string, form: string, slots: MathSlot[] = [],
): MathTemplate => ({ id, group, name, glyph, form, slots })

export const initialValues = (t: MathTemplate): string[] => t.slots.map((s) => s.initial)

/**
 * The WL this writes. A slot left empty falls back to what it suggested —
 * an empty integrand is a slip, not an intention.
 */
export function templateWL(t: MathTemplate, values: string[]): string {
  let out = t.form
  t.slots.forEach((s, index) => {
    const typed = index < values.length ? values[index]!.trim() : ""
    out = out.split(`#${index + 1}`).join(typed === "" ? s.initial : typed)
  })
  return out
}

const calc = (id: string, name: string, glyph: string, form: string, slots: MathSlot[]) =>
  make(id, "Calculus", name, glyph, form, slots)
const alg = (id: string, name: string, glyph: string, form: string, slots: MathSlot[]) =>
  make(id, "Algebra", name, glyph, form, slots)
const fn = (id: string, name: string, glyph: string, form: string, slots: MathSlot[]) =>
  make(id, "Functions", name, glyph, form, slots)
const rel = (id: string, name: string, glyph: string, form: string, slots: MathSlot[]) =>
  make(id, "Relations", name, glyph, form, slots)

const calculus: MathTemplate[] = [
  calc("integrate.definite", "Definite integral", "∫ᵃᵇ", "Integrate[#1, {#2, #3, #4}]",
    [slot("Integrand", "x^2"), slot("Variable", "x"), slot("From", "0"), slot("To", "1")]),
  calc("integrate", "Integral", "∫", "Integrate[#1, #2]",
    [slot("Integrand", "f[x]"), slot("Variable", "x")]),
  calc("sum", "Sum", "∑", "Sum[#1, {#2, #3, #4}]",
    [slot("Term", "i^2"), slot("Index", "i"), slot("From", "1"), slot("To", "n")]),
  calc("product", "Product", "∏", "Product[#1, {#2, #3, #4}]",
    [slot("Term", "i"), slot("Index", "i"), slot("From", "1"), slot("To", "n")]),
  calc("derivative", "Derivative", "d/dx", "D[#1, #2]",
    [slot("Of", "f[x]"), slot("With respect to", "x")]),
  calc("derivative.n", "nth derivative", "dⁿ/dxⁿ", "D[#1, {#2, #3}]",
    [slot("Of", "f[x]"), slot("With respect to", "x"), slot("Times", "2")]),
  calc("limit", "Limit", "lim", "Limit[#1, #2 -> #3]",
    [slot("Of", "Sin[x]/x"), slot("Variable", "x"), slot("Approaches", "0")]),
  calc("derivative.partial", "Partial derivative", "∂/∂x", "D[#1, #2]",
    [slot("Of", "f[x, y]"), slot("With respect to", "x")]),
  calc("derivative.partial.second", "Second partial", "∂²/∂x²", "D[#1, {#2, 2}]",
    [slot("Of", "f[x, y]"), slot("With respect to", "x")]),
  calc("derivative.partial.mixed", "Mixed partial", "∂²/∂x∂y", "D[#1, #2, #3]",
    [slot("Of", "f[x, y]"), slot("First", "x"), slot("Then", "y")]),
  calc("total.derivative", "Total derivative", "df/dt", "Dt[#1, #2]",
    [slot("Of", "f[x, t]"), slot("With respect to", "t")]),
  calc("integrate.double", "Double integral", "∬", "Integrate[#1, {#2, #3, #4}, {#5, #6, #7}]",
    [slot("Integrand", "f[x, y]"), slot("First variable", "x"), slot("From", "0"), slot("To", "1"),
      slot("Second variable", "y"), slot("From", "0"), slot("To", "1")]),
  calc("integrate.improper", "Improper integral", "∫₋∞", "Integrate[#1, {#2, -Infinity, Infinity}]",
    [slot("Integrand", "Exp[-x^2]"), slot("Variable", "x")]),
  calc("integrate.contour", "Contour integral", "∮", "ContourIntegrate[#1, #2]",
    [slot("Integrand", "f[z]"), slot("Variable", "z")]),
  calc("series.infinite", "Infinite series", "∑∞", "Sum[#1, {#2, #3, Infinity}]",
    [slot("Term", "1/n^2"), slot("Index", "n"), slot("From", "1")]),
  calc("series.taylor", "Taylor series", "Σₜ", "Series[#1, {#2, #3, #4}]",
    [slot("Of", "Exp[x]"), slot("Variable", "x"), slot("About", "0"), slot("Order", "5")]),
  calc("limit.infinity", "Limit at infinity", "lim∞", "Limit[#1, #2 -> Infinity]",
    [slot("Of", "1/x"), slot("Variable", "x")]),
  calc("limit.above", "Limit from above", "lim⁺", "Limit[#1, #2 -> #3, Direction -> \"FromAbove\"]",
    [slot("Of", "1/x"), slot("Variable", "x"), slot("Approaches", "0")]),
  calc("limit.below", "Limit from below", "lim⁻", "Limit[#1, #2 -> #3, Direction -> \"FromBelow\"]",
    [slot("Of", "1/x"), slot("Variable", "x"), slot("Approaches", "0")]),
  calc("grad", "Gradient", "∇f", "Grad[#1, {#2, #3, #4}]",
    [slot("Of", "f[x, y, z]"), slot("x", "x"), slot("y", "y"), slot("z", "z")]),
  calc("div", "Divergence", "∇·F", "Div[#1, {#2, #3, #4}]",
    [slot("Of", "{P, Q, R}"), slot("x", "x"), slot("y", "y"), slot("z", "z")]),
  calc("curl", "Curl", "∇×F", "Curl[#1, {#2, #3, #4}]",
    [slot("Of", "{P, Q, R}"), slot("x", "x"), slot("y", "y"), slot("z", "z")]),
  calc("laplacian", "Laplacian", "∇²f", "Laplacian[#1, {#2, #3}]",
    [slot("Of", "f[x, y]"), slot("x", "x"), slot("y", "y")]),
  calc("integrate.indefinite.n", "Antiderivative", "∫f dx", "Integrate[#1, #2]",
    [slot("Integrand", "1/x"), slot("Variable", "x")]),
]

const algebra: MathTemplate[] = [
  alg("power", "Exponent", "xⁿ", "#1^#2", [slot("Base", "x"), slot("Exponent", "2")]),
  alg("fraction", "Fraction", "a⁄b", "(#1)/(#2)", [slot("Top", "a"), slot("Bottom", "b")]),
  alg("sqrt", "Square root", "√", "Sqrt[#1]", [slot("Of", "x")]),
  alg("root", "nth root", "ⁿ√", "#1^(1/#2)", [slot("Of", "x"), slot("Root", "3")]),
  alg("abs", "Absolute value", "|x|", "Abs[#1]", [slot("Of", "x")]),
  alg("subscript", "Subscript", "xᵢ", "Subscript[#1, #2]", [slot("Symbol", "x"), slot("Index", "i")]),
  alg("factorial", "Factorial", "n!", "Factorial[#1]", [slot("Of", "n")]),
  alg("binomial", "Binomial", "(ⁿₖ)", "Binomial[#1, #2]", [slot("n", "n"), slot("k", "k")]),
  alg("solve", "Solve", "x=?", "Solve[#1 == #2, #3]",
    [slot("Left", "x^2 - 1"), slot("Right", "0"), slot("For", "x")]),
  alg("expand", "Expand", "( )ⁿ", "Expand[#1]", [slot("Of", "(x + 1)^2")]),
  alg("factor", "Factor", "ab", "Factor[#1]", [slot("Of", "x^2 - 1")]),
  alg("matrix", "Matrix 2×2", "⌈⌉", "{{#1, #2}, {#3, #4}}",
    [slot("a", "a"), slot("b", "b"), slot("c", "c"), slot("d", "d")]),
]

const functions: MathTemplate[] = [
  fn("sin", "Sine", "sin", "Sin[#1]", [slot("Of", "x")]),
  fn("cos", "Cosine", "cos", "Cos[#1]", [slot("Of", "x")]),
  fn("tan", "Tangent", "tan", "Tan[#1]", [slot("Of", "x")]),
  fn("arctan", "Arctangent", "arctan", "ArcTan[#1]", [slot("Of", "x")]),
  fn("log", "Natural log", "ln", "Log[#1]", [slot("Of", "x")]),
  fn("logbase", "Log to a base", "log", "Log[#1, #2]", [slot("Base", "2"), slot("Of", "x")]),
  fn("exp", "Exponential", "eˣ", "Exp[#1]", [slot("Of", "x")]),
  fn("arcsin", "Arcsine", "arcsin", "ArcSin[#1]", [slot("Of", "x")]),
  fn("arccos", "Arccosine", "arccos", "ArcCos[#1]", [slot("Of", "x")]),
  fn("sinh", "Hyperbolic sine", "sinh", "Sinh[#1]", [slot("Of", "x")]),
  fn("cosh", "Hyperbolic cosine", "cosh", "Cosh[#1]", [slot("Of", "x")]),
  fn("tanh", "Hyperbolic tangent", "tanh", "Tanh[#1]", [slot("Of", "x")]),
  fn("log10", "Log base 10", "log₁₀", "Log10[#1]", [slot("Of", "x")]),
  fn("erf", "Error function", "erf", "Erf[#1]", [slot("Of", "x")]),
  fn("gammaf", "Gamma function", "Γ(x)", "Gamma[#1]", [slot("Of", "x")]),
  fn("floor", "Floor", "⌊x⌋", "Floor[#1]", [slot("Of", "x")]),
  fn("ceiling", "Ceiling", "⌈x⌉", "Ceiling[#1]", [slot("Of", "x")]),
  fn("norm", "Norm", "‖x‖", "Norm[#1]", [slot("Of", "v")]),
  fn("dot", "Dot product", "a·b", "Dot[#1, #2]", [slot("First", "a"), slot("Second", "b")]),
  fn("cross", "Cross product", "a×b", "Cross[#1, #2]", [slot("First", "a"), slot("Second", "b")]),
]

const relations: MathTemplate[] = [
  rel("equal", "Equals", "=", "#1 == #2", [slot("Left", "x"), slot("Right", "y")]),
  rel("notequal", "Not equal", "≠", "#1 != #2", [slot("Left", "x"), slot("Right", "y")]),
  rel("le", "At most", "≤", "#1 <= #2", [slot("Left", "x"), slot("Right", "y")]),
  rel("ge", "At least", "≥", "#1 >= #2", [slot("Left", "x"), slot("Right", "y")]),
  rel("rule", "Goes to", "→", "#1 -> #2", [slot("From", "x"), slot("To", "0")]),
]

const symbolHead: MathTemplate[] = [
  make("pi", "Symbols", "Pi", "π", "Pi"),
  make("e", "Symbols", "e", "e", "E"),
  make("i", "Symbols", "i", "i", "I"),
  make("infinity", "Symbols", "Infinity", "∞", "Infinity"),
  make("degree", "Symbols", "Degree", "°", "Degree"),
  make("gamma", "Symbols", "Euler's constant", "γ", "EulerGamma"),
  make("phi", "Symbols", "Golden ratio", "φ", "GoldenRatio"),
  make("partial", "Symbols", "Partial", "∂", "\\[PartialD]"),
  make("nabla", "Symbols", "Nabla", "∇", "\\[Nabla]"),
  make("element", "Symbols", "Element of", "∈", "\\[Element]"),
]

// The rest as a table: an id, a name, the glyph, and the WL that writes it.
const symbolTable: [string, string, string, string][] = [
  ["plusminus", "Plus or minus", "±", "\\[PlusMinus]"],
  ["minusplus", "Minus or plus", "∓", "\\[MinusPlus]"],
  ["approx", "Approximately", "≈", "\\[TildeTilde]"],
  ["congruent", "Identical to", "≡", "\\[Congruent]"],
  ["proportional", "Proportional to", "∝", "\\[Proportional]"],
  ["centerdot", "Centre dot", "⋅", "\\[CenterDot]"],
  ["times", "Times", "×", "\\[Times]"],
  ["compose", "Composed with", "∘", "\\[SmallCircle]"],
  ["oplus", "Direct sum", "⊕", "\\[CirclePlus]"],
  ["otimes", "Tensor product", "⊗", "\\[CircleTimes]"],
  ["union", "Union", "∪", "\\[Union]"],
  ["intersection", "Intersection", "∩", "\\[Intersection]"],
  ["subset", "Subset of", "⊂", "\\[Subset]"],
  ["subseteq", "Subset or equal", "⊆", "\\[SubsetEqual]"],
  ["notelement", "Not an element of", "∉", "\\[NotElement]"],
  ["forall", "For all", "∀", "\\[ForAll]"],
  ["exists", "There exists", "∃", "\\[Exists]"],
  ["not", "Not", "¬", "\\[Not]"],
  ["and", "And", "∧", "\\[And]"],
  ["or", "Or", "∨", "\\[Or]"],
  ["implies", "Implies", "⇒", "\\[Implies]"],
  ["equivalent", "If and only if", "⇔", "\\[Equivalent]"],
  ["leftarrow", "Left arrow", "←", "\\[LeftArrow]"],
  ["therefore", "Therefore", "∴", "\\[Therefore]"],
  ["because", "Because", "∵", "\\[Because]"],
  ["perpendicular", "Perpendicular to", "⊥", "\\[Perpendicular]"],
  ["parallel", "Parallel to", "∥", "\\[DoubleVerticalBar]"],
  ["angle", "Angle", "∠", "\\[Angle]"],
  ["prime", "Prime", "′", "\\[Prime]"],
  ["doubleprime", "Double prime", "″", "\\[DoublePrime]"],
  ["ellipsis", "And so on", "⋯", "\\[CenterEllipsis]"],
  ["contourintegral", "Contour integral", "∮", "\\[ContourIntegral]"],
  ["aleph", "Aleph", "ℵ", "\\[Aleph]"],
  ["emptyset", "Empty set", "∅", "\\[EmptySet]"],
  ["hbar", "h-bar", "ħ", "\\[HBar]"],
  ["reals", "The reals", "ℝ", "Reals"],
  ["integers", "The integers", "ℤ", "Integers"],
  ["rationals", "The rationals", "ℚ", "Rationals"],
  ["complexes", "The complex numbers", "ℂ", "Complexes"],
]

const symbols: MathTemplate[] = [
  ...symbolHead,
  ...symbolTable.map(([id, name, glyph, form]) => make("symbol." + id, "Symbols", name, glyph, form)),
]

const greek: MathTemplate[] = ([
  ["Alpha", "α"], ["Beta", "β"], ["Gamma", "γ"], ["Delta", "δ"], ["Epsilon", "ε"],
  ["Theta", "θ"], ["Lambda", "λ"], ["Mu", "μ"], ["Pi", "π"], ["Rho", "ρ"],
  ["Sigma", "σ"], ["Tau", "τ"], ["Phi", "φ"], ["Psi", "ψ"], ["Omega", "ω"],
  ["CapitalDelta", "Δ"], ["CapitalSigma", "Σ"], ["CapitalOmega", "Ω"],
  ["CapitalPhi", "Φ"], ["CapitalTheta", "Θ"],
] as [string, string][]).map(([name, glyph]) =>
  make("greek." + name, "Greek", name, glyph, "\\[" + name + "]"))

export const MATH_TEMPLATES: MathTemplate[] =
  [...calculus, ...algebra, ...functions, ...relations, ...symbols, ...greek]

export const templatesIn = (group: MathGroup): MathTemplate[] =>
  MATH_TEMPLATES.filter((t) => t.group === group)

/**
 * Put maths in, as WL. Inline it is a code span the preview typesets; on its
 * own line it is a ```wl block, and this is where the line breaks around it
 * come from — a fence that starts mid-line is not a fence.
 */
export function insertMath(text: string, selection: Range, wl: string, display: boolean): Edit {
  const where = clamped(selection, text.length)
  let body: string
  if (display) {
    const before = where.location > 0 ? text.slice(0, where.location) : ""
    const after = text.slice(end(where))
    const lead = before === "" || before.endsWith("\n") ? "" : "\n"
    const tail = after.startsWith("\n") ? "" : "\n"
    body = lead + mathBlock(wl) + tail
  } else {
    body = mathInline(wl)
  }
  return edit(where, body, range(where.location + body.length, 0))
}
