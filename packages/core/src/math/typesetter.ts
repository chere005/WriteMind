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
  application, isAtom, opensWithGroup, parseWL, precedence,
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
  "=": "=", "==": "=", "!=": "≠", "<=": "≤", ">=": "≥", "<": "<", ">": ">",
  "->": "→", "+": "+", "-": "−", "*": "·", "/": "/",
}

const own = <T>(table: Record<string, T>, key: string): T | undefined =>
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

/** A script is this much smaller than what it is a script of. */
const SCRIPT_SCALE = 0.7
/** ...but never smaller than this fraction of the text (TeX's scriptscript size): a tower of powers stays legible. */
const SCRIPT_FLOOR = 0.5

/**
 * Raised or lowered, and smaller — an exponent, or the bounds of a sum. Scripts COMPOSE: the piece is scaled
 * about its own baseline, so what is already a script inside it keeps its level (the Swift `script()`, which
 * this was ported from, set every run to one size and one offset, so `x^y^z` was drawn as x^(yz), `e^(-x^2)` as
 * e^(-x2), and `x_(n^2)` as x_(n2), and the block form of the same source, which is MathML, was right and the
 * inline form wrong). A variable keeps its italic, as it has in the MathML.
 */
export function mathScript(piece: MathRuns, size: number, raised: boolean): MathRuns {
  const shift = raised ? size * 0.36 : -size * 0.22
  return piece.map((r) => ({
    text: r.text,
    size: Math.max(r.size * SCRIPT_SCALE, size * SCRIPT_FLOOR),
    italic: r.italic,
    baseline: r.baseline * SCRIPT_SCALE + shift,
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

/** The calls drawn round their argument with brackets of their own: |x|, ⌊x⌋, ⌈x⌉, ‖x‖. */
const FENCED_CALLS = new Set(["Abs", "Floor", "Ceiling", "Norm"])

/**
 * Whether something can stand as the base of a power (or take a `!`) as it is drawn, so that what follows
 * clearly belongs to ALL of it: one token, a list, something in brackets, a name applied to bracketed
 * arguments, a subscripted name. Anything else -- a sum, a product, `e` with its own exponent, `ln x`, `√x`
 * -- has an end that a raised exponent would be read as belonging to (`Exp[x]^2` is (eˣ)², and drawn bare it
 * reads as e to the power x², or e to the x and then a 2). The same rule as the MathML's (`mathml.ts`).
 */
function standsAlone(expr: WLExpr): boolean {
  switch (expr.kind) {
    case "binary": case "negate": return false
    case "call": {
      const app = application(expr)
      if (app === null) return true
      const { name, args } = app
      if (specialForm(name, args.length) !== null) {
        return (FENCED_CALLS.has(name) && args.length === 1) || (name === "Subscript" && args.length === 2)
      }
      // `sin x` has no brackets round its argument; `f(x)` has.
      return !(own(MATH_FUNCTIONS, name) !== undefined && args.length === 1)
    }
    default: return true
  }
}

/** The base of a power, or what a `!` is put after: brackets unless it stands alone as drawn. */
function powerBase(expr: WLExpr, size: number): MathRuns {
  return standsAlone(expr) ? render(expr, size) : cat(plain("(", size), render(expr, size), plain(")", size))
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

/** Whether what is drawn starts with a digit: a number can never stand next to a factor without a sign. */
const startsWithDigit = (runs: MathRuns): boolean => /^\p{N}/u.test(mathText(runs))

/**
 * A product. The sign a person WROTE is kept (`3 × 4` is not `3 4`, which reads as thirty-four); a number after
 * any factor takes a dot, written or not (`2*3` is `2 · 3`); brackets written after a factor stay (`f(2)`,
 * `2(x + 1)`, see `group` in expression.ts); anything else is a thin space, the way maths multiplies. The
 * same rules as the MathML's (`timesSign` in mathml.ts).
 */
function productRuns(left: WLExpr, right: WLExpr, size: number, written?: string): MathRuns {
  const first = fenced(left, size, 4)
  const second = fenced(right, size, 5)
  if (opensWithGroup(right)) return cat(first, second)
  if (written !== undefined) return cat(first, plain(` ${written} `, size), second)
  if (startsWithDigit(second)) return cat(first, plain(" \u00b7 ", size), second)
  return cat(first, plain("\u2009", size), second)
}

function binaryRuns(op: string, left: WLExpr, right: WLExpr, size: number, written?: string): MathRuns {
  switch (op) {
    case "^":
      return cat(powerBase(left, size), mathScript(render(right, size), size, true))
    case "*":
      return productRuns(left, right, size, written)
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
  const special = specialForm(name, args.length)
  if (special !== null) return special(args, size)
  const short = own(MATH_FUNCTIONS, name)
  if (short !== undefined && args.length === 1) {
    return cat(plain(short, size), plain("\u2009", size), bracketed(args[0]!, size))
  }
  return cat(plain(name, size), argumentsOf(args, size))
}

/** How a call that is drawn in a way of its own is drawn, from its arguments and the size of the text. */
type SpecialForm = (args: WLExpr[], size: number) => MathRuns

/** The same, with `a(i)` for the i-th argument (what the drawing code below is written in). */
type Draw = (a: (i: number) => WLExpr, size: number, args: WLExpr[]) => MathRuns
const special = (draw: Draw): SpecialForm => (args, size) => draw((i) => args[i]!, size, args)

const FENCES: Record<string, [string, string]> = { Floor: ["⌊", "⌋"], Ceiling: ["⌈", "⌉"], Norm: ["‖", "‖"] }

/**
 * The calls drawn in a way of their own (an integral, a root, a derivative ...) -- how, or null for the rest. It is
 * a lookup by NAME and NUMBER OF ARGUMENTS and draws nothing, so asking "is this call drawn specially?" costs the
 * same however deep its arguments go. (`standsAlone` asks at every power and every factorial. It used to draw the
 * arguments to find out, and `powerBase` then drew them again, so every level of nesting doubled the work: 22
 * nested `Exp[...]^2` took 4 seconds, and the editor draws every `wl:` span in view on every caret move.)
 * Whether a call is special and what it draws are the same lookup, so they cannot drift apart.
 */
function specialForm(name: string, n: number): SpecialForm | null {
  if (name === "Integrate" && n === 2) {
    return special((a, size) => {
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
    })
  }

  if ((name === "Sum" || name === "Product") && n === 2) {
    return special((a, size) => {
      let out = plain(name === "Sum" ? "∑" : "∏", size * 1.25)
      const bounds = a(1)
      if (bounds.kind === "list" && bounds.items.length >= 2) {
        const b = bounds.items
        const lower = cat(render(b[0]!, size), plain("=", size), render(b[1]!, size))
        out = cat(out, mathScript(lower, size, false))
        if (b.length >= 3) out = cat(out, mathScript(render(b[2]!, size), size, true))
      }
      return cat(out, plain(" ", size), fenced(a(0), size, 3))
    })
  }

  if (name === "Sqrt" && n === 1) return special((a, size) => cat(plain("√", size), bracketed(a(0), size)))

  if (name === "Abs" && n === 1) {
    return special((a, size) => cat(plain("|", size), render(a(0), size), plain("|", size)))
  }

  // The Swift table maps these to "⌊⌋" and then prints "⌊⌋ x"; the brackets
  // belong round the argument.
  const around = own(FENCES, name)
  if (around !== undefined && n === 1) {
    return special((a, size) => cat(plain(around[0], size), render(a(0), size), plain(around[1], size)))
  }

  if (name === "CubeRoot" && n === 1) return special((a, size) => cat(plain("∛", size), bracketed(a(0), size)))
  if ((name === "Surd" || name === "Root") && n === 2) {
    return special((a, size) => cat(mathScript(render(a(1), size), size, true), plain("√", size), bracketed(a(0), size)))
  }

  if (name === "Limit" && n === 2) {
    return special((a, size) => cat(plain("lim", size), mathScript(render(a(1), size), size, false),
      plain(" ", size), fenced(a(0), size, 3)))
  }

  if (name === "D" && n === 2) {
    return special((a, size) => {
      // ∂f/∂x — a partial; `{x, n}` in the second slot is the nth derivative.
      const second = a(1)
      if (second.kind === "list" && second.items.length === 2) {
        const parts = second.items
        return cat(plain("∂", size), mathScript(render(parts[1]!, size), size, true),
          fenced(a(0), size, 5), plain("/∂", size), render(parts[0]!, size),
          mathScript(render(parts[1]!, size), size, true))
      }
      return cat(plain("∂", size), fenced(a(0), size, 5), plain("/∂", size), render(a(1), size))
    })
  }

  if (name === "D" && n === 3) {
    return special((a, size) => cat(plain("∂", size), mathScript(plain("2", size), size, true),
      fenced(a(0), size, 5), plain("/∂", size), render(a(1), size),
      plain("∂", size), render(a(2), size)))
  }

  if (name === "Dt" && n === 2) {
    return special((a, size) => cat(plain("d", size), fenced(a(0), size, 5), plain("/d", size), render(a(1), size)))
  }

  if (name === "Grad" || name === "Laplacian" || name === "Div" || name === "Curl") {
    return special((_a, size, args) => {
      let out = plain("∇", size)
      if (name === "Laplacian") out = cat(out, mathScript(plain("2", size), size, true))
      if (name === "Div") out = cat(out, plain("·", size))
      if (name === "Curl") out = cat(out, plain("×", size))
      return cat(out, plain("\u2009", size), fenced(args[0] ?? { kind: "symbol", name: "f" }, size, 5))
    })
  }

  if (name === "ContourIntegrate" && n === 2) {
    return special((a, size) => cat(plain("∮", size * 1.3), plain(" ", size), render(a(0), size),
      differential(a(1), size)))
  }

  if (name === "Integrate" && (n === 3 || n === 4)) {
    return special((a, size, args) => {
      // A double or triple integral: one sign per variable.
      let out = cat(plain("∫".repeat(n - 1), size * 1.3), plain(" ", size), render(a(0), size))
      for (const bound of args.slice(1)) {
        if (bound.kind === "list" && bound.items.length > 0) {
          out = cat(out, differential(bound.items[0]!, size))
        }
      }
      return out
    })
  }

  if (name === "Series" && n === 2) return special((a, size) => cat(plain("series ", size), render(a(0), size)))

  if (name === "Limit" && n === 3) {
    return special((a, size) => {
      // The third argument is a Direction rule: a little + or − on the
      // approach says which side it comes from.
      let under = render(a(1), size)
      const rule = a(2)
      if (rule.kind === "binary" && rule.op === "->" && rule.right.kind === "text") {
        under = cat(under, plain(rule.right.value === "FromBelow" ? "⁻" : "⁺", size))
      }
      return cat(plain("lim", size), mathScript(under, size, false), plain(" ", size),
        fenced(a(0), size, 3))
    })
  }

  if (name === "Subscript" && n === 2) {
    return special((a, size) => cat(render(a(0), size), mathScript(render(a(1), size), size, false)))
  }

  if (name === "Exp" && n === 1) {
    return special((a, size) => cat(plain("e", size, true), mathScript(render(a(0), size), size, true)))
  }

  if (name === "Log" && n === 2) {
    return special((a, size) => cat(plain("log", size), mathScript(render(a(0), size), size, false),
      plain(" ", size), bracketed(a(1), size)))
  }

  if (name === "Binomial" && n === 2) {
    return special((a, size) => cat(plain("C", size), mathScript(render(a(0), size), size, true),
      mathScript(render(a(1), size), size, false)))
  }

  if (name === "Factorial" && n === 1) return special((a, size) => cat(powerBase(a(0), size), plain("!", size)))

  // PORT-ONLY (the Swift draws these as `Dot(a, b)`; the MathML has always drawn them as a product).
  if ((name === "Dot" || name === "Cross") && n === 2) {
    return special((a, size) =>
      cat(fenced(a(0), size, 4), plain(name === "Dot" ? "·" : "×", size), fenced(a(1), size, 5)))
  }

  return null
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
    case "group": return cat(plain("(", size), render(expr.inner, size), plain(")", size))
    case "binary": return binaryRuns(expr.op, expr.left, expr.right, size, expr.written)
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

/** Longer than this a source is left as text: nobody types an equation of 2000 characters, and the parser is not linear on one. */
export const MAX_MATH_SOURCE = 2000

/** One piece of an equation set in a line of prose, as the page draws it. */
export interface InlineSpan {
  text: string
  /** The font size, as a multiple of the text round it. */
  size: number
  italic: boolean
  /** How far it is raised (positive) or lowered, in ems of ITS OWN size. */
  raise: number
}

/**
 * Maths in a line of prose, as spans for a page to draw (the Swift `MathTypesetter`'s AttributedString):
 * a LINEAR run, the way the Mac sets inline maths, which is why it cannot be taller than its line and can
 * never overlap the lines above and below it (a stacked fraction in a line of text did, and took the clicks
 * meant for the next line). Two dimensions are for maths on its own line. Null when `source` is not an
 * expression -- half-typed maths is left as the text it is -- or is too long or too deep to set; it never
 * throws, because the editor's decorations call it for every `wl:` span in view.
 */
export function inlineSpans(source: string): InlineSpan[] | null {
  if (source.length > MAX_MATH_SOURCE) return null
  let runs: MathRuns | null
  try {
    runs = typesetInline(source, 1)
  } catch {
    return null
  }
  if (runs === null) return null
  const out: InlineSpan[] = []
  for (const run of runs) {
    if (run.text === "") continue
    const raise = run.baseline / run.size
    const last = out[out.length - 1]
    if (last !== undefined && last.size === run.size && last.italic === run.italic && last.raise === raise) {
      last.text += run.text
    } else {
      out.push({ text: run.text, size: run.size, italic: run.italic, raise })
    }
  }
  return out
}

const escapeText = (text: string): string => text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")

/**
 * The pieces of `inlineSpans` as HTML for paper (the PDF export): a `<span>` each, styled as the notebook styles
 * its own (`INLINE_MATH_CSS` below is the stylesheet for both).
 */
export function inlineSpansHtml(spans: InlineSpan[]): string {
  return spans.map((span) => {
    const classes: string[] = []
    const style: string[] = []
    if (span.size !== 1) { classes.push("wm-math-sz"); style.push(`font-size:${span.size}em`) }
    if (span.italic) style.push("font-style:italic")
    if (span.raise !== 0) { classes.push("wm-math-up"); style.push(`top:${-span.raise}em`) }
    const attributes = (classes.length ? ` class="${classes.join(" ")}"` : "") + (style.length ? ` style="${style.join(";")}"` : "")
    return `<span${attributes}>${escapeText(span.text)}</span>`
  }).join("")
}

/**
 * The look of maths in a line of prose, for the notebook (`MATH_CSS` in @writemind/editor) and for paper alike.
 * It is a run of text in the page's own face (the Mac sets it that way): italic variables, upright names and
 * signs, exponents and limits raised and lowered. It is plain inline text -- as tall as its line, it wraps with
 * the words round it. The pieces that are not the size of the text (scripts, a big integral sign) have no line
 * height of their own, so they cannot make the line taller; raised and lowered pieces are only moved.
 */
export const INLINE_MATH_CSS = `
.wm-math.wm-math-inline {
  font-family: inherit;
  white-space: pre-wrap;
  cursor: text;
}
.wm-math-inline > .wm-math-sz { line-height: 0; }
.wm-math-inline > .wm-math-up { position: relative; }
`

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
