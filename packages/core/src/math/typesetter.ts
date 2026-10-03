/**
 * The glyphs maths is read in, and the linear typesetting of a WL
 * expression.
 *
 * Ported from `WriteMind/Math/MathTypesetter.swift`. Swift built an
 * `AttributedString`; here the same thing is a list of `MathRun`s — text,
 * point size, italic, and a baseline offset (positive is raised) — which a
 * UI turns into spans (`font-size`, `font-style`, `vertical-align`/`top`).
 * Anything that would need two dimensions is written the linear way here.
 */

import {
  application, isAtom, parseWL, precedence,
  type WLExpr,
} from "./expression"

/** WL names on the left, what a reader expects on the right. */
export const MATH_CONSTANTS: Record<string, string> = {
  Pi: "π", E: "e", I: "i", Infinity: "∞", Degree: "°",
  EulerGamma: "γ", GoldenRatio: "φ", ImaginaryI: "i", Indeterminate: "?",
  Reals: "ℝ", Integers: "ℤ", Rationals: "ℚ", Complexes: "ℂ", Primes: "ℙ",
  Booleans: "𝔹", True: "True", False: "False",
}

export const MATH_OPERATORS: Record<string, string> = {
  PlusMinus: "±", MinusPlus: "∓", TildeTilde: "≈", Tilde: "∼", TildeEqual: "≃",
  Congruent: "≡", Proportional: "∝", CenterDot: "⋅", Times: "×", Divide: "÷",
  SmallCircle: "∘", CirclePlus: "⊕", CircleTimes: "⊗", CircleMinus: "⊖",
  Subset: "⊂", Superset: "⊃", SubsetEqual: "⊆", SupersetEqual: "⊇",
  Not: "¬", And: "∧", Or: "∨", Implies: "⇒", Equivalent: "⇔",
  LeftArrow: "←", RightArrow: "→", UpArrow: "↑", DownArrow: "↓",
  LongRightArrow: "⟶", LongLeftArrow: "⟵", DoubleRightArrow: "⇒",
  Because: "∵", Perpendicular: "⊥", DoubleVerticalBar: "∥", Angle: "∠",
  Prime: "′", DoublePrime: "″", CenterEllipsis: "⋯", Ellipsis: "…",
  VerticalEllipsis: "⋮", ContourIntegral: "∮", DoubleContourIntegral: "∯",
  Integral: "∫", Sum: "∑", Product: "∏", SquareRoot: "√", Aleph: "ℵ",
  HBar: "ħ", ScriptL: "ℓ", Micro: "µ", Angstrom: "Å", Star: "⋆",
  LessEqual: "≤", GreaterEqual: "≥", NotEqual: "≠", Equal: "=",
  LeftRightArrow: "↔", Element: "∈", NotElement: "∉", EmptySet: "∅",
  Infinity: "∞", Cross: "✕", Wedge: "∧", Vee: "∨", Del: "∇",
}

export const MATH_GREEK: Record<string, string> = {
  Alpha: "α", Beta: "β", Gamma: "γ", Delta: "δ", Epsilon: "ε", Zeta: "ζ",
  Eta: "η", Theta: "θ", Iota: "ι", Kappa: "κ", Lambda: "λ", Mu: "μ",
  Nu: "ν", Xi: "ξ", Omicron: "ο", Pi: "π", Rho: "ρ", Sigma: "σ",
  Tau: "τ", Upsilon: "υ", Phi: "φ", Chi: "χ", Psi: "ψ", Omega: "ω",
  CapitalDelta: "Δ", CapitalGamma: "Γ", CapitalLambda: "Λ", CapitalOmega: "Ω",
  CapitalPhi: "Φ", CapitalPi: "Π", CapitalPsi: "Ψ", CapitalSigma: "Σ",
  CapitalTheta: "Θ", CapitalXi: "Ξ", Element: "∈", NotElement: "∉",
  Union: "∪", Intersection: "∩", PartialD: "∂", Nabla: "∇",
  Therefore: "∴", ForAll: "∀", Exists: "∃", EmptySet: "∅",
}

/** The functions that are set upright and lower case, the way they are read. */
export const MATH_FUNCTIONS: Record<string, string> = {
  Sin: "sin", Cos: "cos", Tan: "tan", Cot: "cot", Sec: "sec", Csc: "csc",
  ArcSin: "arcsin", ArcCos: "arccos", ArcTan: "arctan",
  Sinh: "sinh", Cosh: "cosh", Tanh: "tanh",
  Log: "ln", Log10: "log₁₀", Log2: "log₂", Exp: "exp",
  Max: "max", Min: "min", Mod: "mod", Gcd: "gcd", Det: "det",
  ArcSinh: "arcsinh", ArcCosh: "arccosh", ArcTanh: "arctanh",
  Erf: "erf", Erfc: "erfc", Gamma: "Γ", Beta: "B", Zeta: "ζ",
  Floor: "⌊⌋", Ceiling: "⌈⌉", Norm: "‖‖", Re: "Re", Im: "Im",
  Arg: "arg", Conjugate: "conj", Tr: "tr", Rank: "rank",
  Dot: "·", Cross: "×", Trace: "tr", Sign: "sgn",
}

export const MATH_RELATIONS: Record<string, string> = {
  "==": "=", "!=": "≠", "<=": "≤", ">=": "≥", "<": "<", ">": ">",
  "->": "→", "+": "+", "-": "−", "*": "·", "/": "/",
}

const own = (table: Record<string, string>, key: string): string | undefined =>
  Object.prototype.hasOwnProperty.call(table, key) ? table[key] : undefined

/** `\[Alpha]` → α, `Pi` → π, anything else as it stands. */
export function mathGlyph(symbol: string): string {
  if (symbol.startsWith("\\[") && symbol.endsWith("]")) {
    const name = symbol.slice(2, -1)
    return own(MATH_GREEK, name) ?? own(MATH_OPERATORS, name) ?? own(MATH_CONSTANTS, name) ?? name
  }
  return own(MATH_CONSTANTS, symbol) ?? symbol
}

/** A single letter is a variable and is set in italic; `sin` and `Δ` are not. */
export function isMathVariable(glyph: string): boolean {
  const chars = Array.from(glyph)
  return chars.length === 1 && /^\p{L}$/u.test(chars[0]!)
}

/** One styled piece of typeset maths. `baseline` is positive when raised. */
export interface MathRun {
  text: string
  size: number
  italic: boolean
  baseline: number
}

export type MathRuns = MathRun[]

/** The characters of a typeset expression, styling dropped. */
export const mathText = (runs: MathRuns): string => runs.map((r) => r.text).join("")

const plain = (text: string, size: number, italic = false): MathRuns =>
  [{ text, size, italic, baseline: 0 }]

/** Raised or lowered, and smaller — an exponent, or the bounds of a sum. */
export function mathScript(piece: MathRuns, size: number, raised: boolean): MathRuns {
  return piece.map((r) => ({
    text: r.text,
    size: size * 0.7,
    italic: false,
    baseline: raised ? size * 0.36 : -size * 0.22,
  }))
}

const cat = (...parts: MathRuns[]): MathRuns => parts.flat()

function fenced(expr: WLExpr, size: number, level: number): MathRuns {
  let needs = false
  if (expr.kind === "binary" && precedence(expr.op) < level) needs = true
  if (expr.kind === "negate" && level > 3) needs = true
  if (!needs) return render(expr, size)
  return cat(plain("(", size), render(expr, size), plain(")", size))
}

/** Brackets only where they are needed to read it right. */
function bracketed(expr: WLExpr, size: number): MathRuns {
  if (isAtom(expr)) return render(expr, size)
  return cat(plain("(", size), render(expr, size), plain(")", size))
}

function argumentsOf(args: WLExpr[], size: number): MathRuns {
  const out: MathRuns = plain("(", size).slice()
  args.forEach((arg, index) => {
    if (index > 0) out.push(...plain(", ", size))
    out.push(...render(arg, size))
  })
  out.push(...plain(")", size))
  return out
}

/** `dx`, with the d upright and the variable italic. */
const differential = (variable: WLExpr, size: number): MathRuns =>
  cat(plain(" d", size), render(variable, size))

function binaryRuns(op: string, left: WLExpr, right: WLExpr, size: number): MathRuns {
  switch (op) {
    case "^":
      return cat(fenced(left, size, 5), mathScript(render(right, size), size, true))
    case "*":
      // a thin space, the way maths multiplies
      return cat(fenced(left, size, 4), plain(" ", size), fenced(right, size, 5))
    case "/":
      return cat(fenced(left, size, 4), plain("/", size), fenced(right, size, 5))
    default: {
      const level = precedence(op)
      return cat(fenced(left, size, level), plain(` ${own(MATH_RELATIONS, op) ?? op} `, size),
        fenced(right, size, level + 1))
    }
  }
}

function callRuns(expr: WLExpr, size: number): MathRuns {
  const app = application(expr)
  if (app === null) {
    if (expr.kind === "call") return cat(render(expr.head, size), argumentsOf(expr.args, size))
    return plain("?", size)
  }
  const { name, args } = app
  const n = args.length
  const a = (i: number): WLExpr => args[i]!

  if (name === "Integrate" && n === 2) {
    let out = plain("∫", size * 1.3)
    const bounds = a(1)
    if (bounds.kind === "list" && bounds.items.length === 3) {
      const b = bounds.items
      out = cat(out,
        mathScript(render(b[1]!, size), size, false),
        mathScript(render(b[2]!, size), size, true),
        plain(" ", size), render(a(0), size), differential(b[0]!, size))
    } else {
      out = cat(out, plain(" ", size), render(a(0), size), differential(a(1), size))
    }
    return out
  }

  if ((name === "Sum" || name === "Product") && n === 2) {
    let out = plain(name === "Sum" ? "∑" : "∏", size * 1.25)
    const bounds = a(1)
    if (bounds.kind === "list" && bounds.items.length >= 2) {
      const b = bounds.items
      const lower = cat(render(b[0]!, size), plain("=", size), render(b[1]!, size))
      out = cat(out, mathScript(lower, size, false))
      if (b.length >= 3) out = cat(out, mathScript(render(b[2]!, size), size, true))
    }
    return cat(out, plain(" ", size), fenced(a(0), size, 3))
  }

  if (name === "Sqrt" && n === 1) return cat(plain("√", size), bracketed(a(0), size))

  if (name === "Abs" && n === 1) return cat(plain("|", size), render(a(0), size), plain("|", size))

  if (name === "Limit" && n === 2) {
    return cat(plain("lim", size), mathScript(render(a(1), size), size, false),
      plain(" ", size), fenced(a(0), size, 3))
  }

  if (name === "D" && n === 2) {
    // ∂f/∂x — a partial; `{x, n}` in the second slot is the nth derivative.
    const second = a(1)
    if (second.kind === "list" && second.items.length === 2) {
      const parts = second.items
      return cat(plain("∂", size), mathScript(render(parts[1]!, size), size, true),
        fenced(a(0), size, 5), plain("/∂", size), render(parts[0]!, size),
        mathScript(render(parts[1]!, size), size, true))
    }
    return cat(plain("∂", size), fenced(a(0), size, 5), plain("/∂", size), render(a(1), size))
  }

  if (name === "D" && n === 3) {
    return cat(plain("∂", size), mathScript(plain("2", size), size, true),
      fenced(a(0), size, 5), plain("/∂", size), render(a(1), size),
      plain("∂", size), render(a(2), size))
  }

  if (name === "Dt" && n === 2) {
    return cat(plain("d", size), fenced(a(0), size, 5), plain("/d", size), render(a(1), size))
  }

  if (name === "Grad" || name === "Laplacian" || name === "Div" || name === "Curl") {
    let out = plain("∇", size)
    if (name === "Laplacian") out = cat(out, mathScript(plain("2", size), size, true))
    if (name === "Div") out = cat(out, plain("·", size))
    if (name === "Curl") out = cat(out, plain("×", size))
    return cat(out, plain(" ", size), fenced(args[0] ?? { kind: "symbol", name: "f" }, size, 5))
  }

  if (name === "ContourIntegrate" && n === 2) {
    return cat(plain("∮", size * 1.3), plain(" ", size), render(a(0), size),
      differential(a(1), size))
  }

  if (name === "Integrate" && (n === 3 || n === 4)) {
    // A double or triple integral: one sign per variable.
    let out = cat(plain("∫".repeat(n - 1), size * 1.3), plain(" ", size), render(a(0), size))
    for (const bound of args.slice(1)) {
      if (bound.kind === "list" && bound.items.length > 0) {
        out = cat(out, differential(bound.items[0]!, size))
      }
    }
    return out
  }

  if (name === "Series" && n === 2) return cat(plain("series ", size), render(a(0), size))

  if (name === "Limit" && n === 3) {
    // The third argument is a Direction rule: a little + or − on the
    // approach says which side it comes from.
    let under = render(a(1), size)
    const rule = a(2)
    if (rule.kind === "binary" && rule.op === "->" && rule.right.kind === "text") {
      under = cat(under, plain(rule.right.value === "FromBelow" ? "⁻" : "⁺", size))
    }
    return cat(plain("lim", size), mathScript(under, size, false), plain(" ", size),
      fenced(a(0), size, 3))
  }

  if (name === "Subscript" && n === 2) {
    return cat(render(a(0), size), mathScript(render(a(1), size), size, false))
  }

  if (name === "Exp" && n === 1) {
    return cat(plain("e", size, true), mathScript(render(a(0), size), size, true))
  }

  if (name === "Log" && n === 2) {
    return cat(plain("log", size), mathScript(render(a(0), size), size, false),
      plain(" ", size), bracketed(a(1), size))
  }

  if (name === "Binomial" && n === 2) {
    return cat(plain("C", size), mathScript(render(a(0), size), size, true),
      mathScript(render(a(1), size), size, false))
  }

  if (name === "Factorial" && n === 1) return cat(fenced(a(0), size, 5), plain("!", size))

  const short = own(MATH_FUNCTIONS, name)
  if (short !== undefined && n === 1) {
    return cat(plain(short, size), plain(" ", size), bracketed(a(0), size))
  }
  return cat(plain(name, size), argumentsOf(args, size))
}

export function render(expr: WLExpr, size: number): MathRuns {
  switch (expr.kind) {
    case "number": return plain(expr.value, size)
    case "text": return plain(expr.value, size)
    case "symbol": {
      const glyph = mathGlyph(expr.name)
      return plain(glyph, size, isMathVariable(glyph))
    }
    case "list": {
      let out = plain("{", size)
      expr.items.forEach((item, index) => {
        if (index > 0) out = cat(out, plain(", ", size))
        out = cat(out, render(item, size))
      })
      return cat(out, plain("}", size))
    }
    case "negate": return cat(plain("−", size), fenced(expr.operand, size, 4))
    case "binary": return binaryRuns(expr.op, expr.left, expr.right, size)
    case "call": return callRuns(expr, size)
  }
}

/**
 * Maths inside a line of prose, or null when `source` is not an expression
 * (half-typed maths is left as the text it is).
 */
export function typesetInline(source: string, size = 15): MathRuns | null {
  const expr = parseWL(source)
  return expr === null ? null : render(expr, size)
}

/**
 * How maths is spelled in a note: WL inside a code span for a line of prose,
 * and a `wl` fence for maths on its own. Both are ordinary markdown.
 */
export const MATH_INLINE_PREFIX = "wl:"
export const MATH_FENCE = "wl"

export const mathInline = (wl: string): string => "`" + MATH_INLINE_PREFIX + wl + "`"
export const mathBlock = (wl: string): string => "```" + MATH_FENCE + "\n" + wl + "\n```"

/** The WL inside a code span, or null when the span is just code. */
export function mathExpressionInCode(text: string): string | null {
  if (!text.startsWith(MATH_INLINE_PREFIX)) return null
  const expression = text.slice(MATH_INLINE_PREFIX.length).replace(/^[ \t]+|[ \t]+$/g, "")
  return expression === "" ? null : expression
}

/** Only `wl` is maths; `wolfram` is a code language. */
export const isMathFence = (language: string | null | undefined): boolean =>
  (language ?? "").toLowerCase() === MATH_FENCE && language !== null && language !== undefined
