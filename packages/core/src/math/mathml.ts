/**
 * Maths in two dimensions: a parsed WL expression turned into a tree of
 * MathML elements. Chromium lays MathML out natively (MathML Core), so a
 * stacked fraction, a radical with its roof, a big operator with its limits
 * above and below, a matrix between brackets that grow with it — all of them
 * are elements here, and the browser does the drawing.
 *
 * Ported from `WriteMind/Math/MathView.swift` (MathView, MathExpressionView,
 * MathGroup, MathCall, MathIntegral, MathBigOperator, MathRadical,
 * MathLimit, MathMatrix …). Where the Swift SwiftUI view had a gap that its
 * own linear typesetter (`MathTypesetter`) filled — `Exp[x]` as a power of
 * e, `Subscript`, `Factorial`, `Log` with a base — the same shape is used
 * here, and the few places the Swift is plainly wrong (a floor drawn as
 * `⌊⌋(x)`) are fixed; each is noted where it happens.
 *
 * It is a PURE tree builder: no DOM, so it is tested with strings
 * (`serializeMathML`) and turned into live elements by `@writemind/editor`.
 */

import {
  application, endsWithName, isAtom, opensWithGroup, parseWL, precedence,
  type WLExpr,
} from "./expression"
import {
  MATH_FUNCTIONS, MATH_RELATIONS, MAX_MATH_SOURCE, isMathVariable, mathGlyph,
} from "./typesetter"

/** One MathML element, or (with `text`) a leaf holding characters. */
export interface MathNode {
  tag: string
  attrs?: Record<string, string>
  children?: MathNode[]
  text?: string
}

const own = (table: Record<string, string>, key: string): string | undefined =>
  Object.prototype.hasOwnProperty.call(table, key) ? table[key] : undefined

// MARK: - Element helpers

const leaf = (tag: string, text: string, attrs?: Record<string, string>): MathNode =>
  attrs === undefined ? { tag, text } : { tag, text, attrs }

const node = (tag: string, children: MathNode[], attrs?: Record<string, string>): MathNode =>
  attrs === undefined ? { tag, children } : { tag, children, attrs }

const mi = (value: string): MathNode => leaf("mi", value)
const mn = (value: string): MathNode => leaf("mn", value)
const mtext = (value: string): MathNode => leaf("mtext", value)
const mo = (value: string, attrs?: Record<string, string>): MathNode => leaf("mo", value, attrs)

/** Upright, whatever it is: `d` in `dx`, the `g` of a function called `g`. */
const upright = (value: string): MathNode => leaf("mi", value, { mathvariant: "normal" })

/** A run of nodes as one: a lone child needs no `mrow` of its own. */
const row = (children: MathNode[]): MathNode =>
  children.length === 1 ? children[0]! : node("mrow", children)

/** An invisible gap, in em. */
const gap = (em: number): MathNode => node("mspace", [], { width: `${em}em` })

const INVISIBLE_TIMES = "⁢"
const FUNCTION_APPLICATION = "⁡"

/**
 * What makes a thing taller than a line of text. Brackets round these grow
 * (Chromium picks a taller glyph from the font's MATH table); round anything
 * else they stay the size of the text, because a stretchy bracket is a wider
 * one and `f(x, y)` set with them looks gappy.
 */
const TALL = new Set(["mfrac", "mtable", "msqrt", "mroot", "munder", "mover", "munderover"])

function isTall(nodes: MathNode[]): boolean {
  return nodes.some((child) => TALL.has(child.tag) || isTall(child.children ?? []))
}

/** Brackets round `inner`, growing with it when it is tall. */
function fence(open: string, close: string, inner: MathNode[]): MathNode {
  const stretchy = isTall(inner) ? "true" : "false"
  return node("mrow", [mo(open, { stretchy, form: "prefix" }), ...inner,
    mo(close, { stretchy, form: "postfix" })])
}

const comma = (): MathNode => mo(",", { separator: "true" })

function commaSeparated(items: MathNode[]): MathNode[] {
  const out: MathNode[] = []
  items.forEach((item, index) => {
    if (index > 0) out.push(comma())
    out.push(item)
  })
  return out
}

// MARK: - Symbols

/** Glyphs that are names of things rather than operators, though not letters. */
const NAME_GLYPHS = new Set(["∞", "°", "?", "∅", "ℵ", "ħ", "ℓ", "µ", "Å"])

const isCapitalGreek = (glyph: string): boolean => /^[Α-Ω]$/u.test(glyph)

function symbolNode(name: string): MathNode {
  const glyph = mathGlyph(name)
  const chars = Array.from(glyph)
  if (chars.length > 1) return leaf("mi", glyph)           // True, sin: upright by default
  if (isMathVariable(glyph)) {
    // x is italic (a single-letter <mi> is, by default); Δ is not.
    return isCapitalGreek(glyph) ? upright(glyph) : leaf("mi", glyph)
  }
  if (NAME_GLYPHS.has(glyph)) return leaf("mi", glyph)
  return mo(glyph)
}

/** `sin`, `ln`, `Γ` — set upright and lower case, the way they are read. */
function functionName(name: string): MathNode {
  const short = own(MATH_FUNCTIONS, name)
  if (short !== undefined) return Array.from(short).length === 1 ? upright(short) : leaf("mi", short)
  return leaf("mi", mathGlyph(name))
}

// MARK: - Brackets

/**
 * Brackets, but only where the reading needs them — a stacked fraction is
 * its own bracket (Swift `MathGroup`).
 */
function needsBrackets(expr: WLExpr, below: number): boolean {
  if (expr.kind === "binary") {
    if (expr.op === "/") return false
    return precedence(expr.op) < below
  }
  if (expr.kind === "negate") return below > 3
  return false
}

function group(expr: WLExpr, below: number): MathNode {
  const inner = nodeFor(expr)
  return needsBrackets(expr, below) ? fence("(", ")", [inner]) : inner
}

/** Only an atom stands without brackets when something is done to it. */
function bracketed(expr: WLExpr): MathNode {
  const inner = nodeFor(expr)
  return isAtom(expr) ? inner : fence("(", ")", [inner])
}

/** A fenced row: brackets round something, whatever the brackets are (( ), { }, | |, ⌊ ⌋, ‖ ‖). */
function isFenced(drawn: MathNode): boolean {
  if (drawn.tag !== "mrow") return false
  const first = drawn.children?.[0], last = drawn.children?.[(drawn.children?.length ?? 0) - 1]
  return first?.tag === "mo" && first.attrs?.form === "prefix" && last?.tag === "mo" && last.attrs?.form === "postfix"
}

/** `f(x)`: a name, the invisible function application, and the brackets of its arguments. */
function isApplication(drawn: MathNode): boolean {
  if (drawn.tag !== "mrow" || drawn.children?.length !== 3) return false
  const [head, applied, args] = drawn.children
  return head !== undefined && head.tag !== "mo" && applied?.tag === "mo" && applied.text === FUNCTION_APPLICATION
    && args !== undefined && isFenced(args)
}

/**
 * Whether something can stand as the base of a power (or take a `!`) as it is drawn, so that what follows
 * clearly belongs to ALL of it: one token, a root, a subscripted name, something in brackets, a name applied
 * to bracketed arguments. Anything else -- a sum, a product, `e` with its own exponent, `a·b`, `log₂ x`, a
 * fraction, a sum with limits -- has an end that the raised exponent would be read as belonging to
 * (`Exp[x]^2` is (eˣ)², and drawn bare it reads as e to the power x², or e to the x and then a 2).
 */
function standsAlone(drawn: MathNode): boolean {
  if (drawn.text !== undefined) return true
  if (drawn.tag === "msqrt" || drawn.tag === "mroot" || drawn.tag === "msub") return true
  return isFenced(drawn) || isApplication(drawn)
}

/** The base of a power, or what a `!` is put after: brackets unless it stands alone as drawn. */
function powerBase(expr: WLExpr): MathNode {
  const inner = nodeFor(expr)
  const needs = expr.kind === "binary" || expr.kind === "negate" || !standsAlone(inner)
  return needs ? fence("(", ")", [inner]) : inner
}

// MARK: - The tree

/** The MathML for one expression (without the `<math>` around it). */
function nodeFor(expr: WLExpr): MathNode {
  switch (expr.kind) {
    case "number": return mn(expr.value)
    case "text": return mtext(expr.value)
    case "symbol": return symbolNode(expr.name)
    case "negate": return row([mo("−"), group(expr.operand, 4)])
    case "group": return fence("(", ")", [nodeFor(expr.inner)])
    case "binary": return binaryNode(expr.op, expr.left, expr.right, expr.written)
    case "list": return listNode(expr.items)
    case "call": return callNode(expr)
  }
}

const isRow = (expr: WLExpr): boolean => expr.kind === "list"

function listNode(items: WLExpr[]): MathNode {
  // {{a, b}, {c, d}} is a matrix: every item a row, and more than one of them.
  if (items.length > 1 && items.every(isRow)) {
    const rows = items.map((rowExpr) => node("mtr",
      (rowExpr.kind === "list" ? rowExpr.items : []).map((cell) => node("mtd", [nodeFor(cell)]))))
    return fence("(", ")", [node("mtable", rows)])
  }
  return fence("{", "}", commaSeparated(items.map(nodeFor)))
}

/**
 * Whether what is drawn starts with a number (a fraction by its numerator, a power by its base, a sum
 * by its first term). Brackets, signs, roots and the like start with something else.
 */
function startsWithNumber(drawn: MathNode): boolean {
  if (drawn.tag === "mn") return true
  if (!["mrow", "msup", "msub", "msubsup", "mfrac"].includes(drawn.tag)) return false
  const first = drawn.children?.[0]
  return first !== undefined && startsWithNumber(first)
}

/**
 * The sign between two factors, or null when they just stand side by side (`2x`, `a b`, `2(x + 1)`).
 *
 * The sign a person WROTE is kept (PORT-ONLY: the Mac's reader does not know × or ·, so it never had
 * to): `3 × 4` is drawn `3 × 4`, not `3 4`, which reads as thirty-four. A number can never stand next to
 * a factor without one, written or not -- `2 3`, `x 2`, `2 ¾` -- so `2*3` gets a dot (the Mac drew
 * `2 3`, which is the same misreading).
 */
function timesSign(written: string | undefined, right: MathNode): MathNode | null {
  if (written !== undefined) return mo(written)
  if (startsWithNumber(right)) return mo("·")
  return null
}

function binaryNode(op: string, left: WLExpr, right: WLExpr, written?: string): MathNode {
  switch (op) {
    case "/":
      return node("mfrac", [nodeFor(left), nodeFor(right)])
    case "^":
      return node("msup", [powerBase(left), nodeFor(right)])
    case "*": {
      const first = group(left, 4), second = group(right, 5)
      // Brackets written after a factor stay (`f(2)`, `2(x + 1)`), and the name before them applies: drawn
      // exactly as `f[2]` is, with no sign and no gap. A bare number after the name would take a dot.
      if (opensWithGroup(right)) {
        return row([first, endsWithName(left) ? mo(FUNCTION_APPLICATION)
          : mo(INVISIBLE_TIMES, { lspace: "0em", rspace: "0.12em" }), second])
      }
      // No sign: nothing drawn, a little room left.
      const sign = timesSign(written, second)
        ?? mo(INVISIBLE_TIMES, { lspace: "0em", rspace: "0.12em" })
      return row([first, sign, second])
    }
    default: {
      const level = precedence(op)
      return row([group(left, level), mo(own(MATH_RELATIONS, op) ?? op), group(right, level + 1)])
    }
  }
}

/** `dx`: the d upright, the variable as it is, a thin space before. */
const differential = (variable: WLExpr): MathNode[] => [gap(0.17), upright("d"), nodeFor(variable)]

/** ∂f, df: the operator, then what it applies to. */
const differentialOf = (glyph: string, expr: WLExpr): MathNode =>
  row([glyph === "d" ? upright("d") : mo(glyph), group(expr, 5)])

/** ∂ⁿ, with the order raised. */
const orderedOperator = (glyph: string, order: WLExpr): MathNode =>
  node("msup", [mo(glyph), nodeFor(order)])

function callNode(expr: WLExpr): MathNode {
  const app = application(expr)
  if (app === null) {
    if (expr.kind === "call") return row([nodeFor(expr.head), ...argumentsNodes(expr.args)])
    return mi("?")
  }
  const { name, args } = app
  const n = args.length
  const a = (i: number): WLExpr => args[i]!

  if (name === "Integrate" && n === 2) {
    const bounds = a(1)
    if (bounds.kind === "list" && bounds.items.length === 3) {
      const b = bounds.items
      return row([node("msubsup", [mo("∫"), nodeFor(b[1]!), nodeFor(b[2]!)]),
        nodeFor(a(0)), ...differential(b[0]!)])
    }
    return row([mo("∫"), nodeFor(a(0)), ...differential(bounds)])
  }

  if ((name === "Sum" || name === "Product") && n === 2) {
    const operator = mo(name === "Sum" ? "∑" : "∏", { largeop: "true", movablelimits: "true" })
    const bounds = a(1)
    let head: MathNode = operator
    if (bounds.kind === "list" && bounds.items.length >= 2) {
      const b = bounds.items
      const lower = row([nodeFor(b[0]!), mo("="), nodeFor(b[1]!)])
      head = b.length >= 3
        ? node("munderover", [operator, lower, nodeFor(b[2]!)])
        : node("munder", [operator, lower])
    }
    return row([head, group(a(0), 3)])
  }

  if (name === "Divide" && n === 2) return node("mfrac", [nodeFor(a(0)), nodeFor(a(1))])

  if (name === "Sqrt" && n === 1) return node("msqrt", [nodeFor(a(0))])
  if (name === "CubeRoot" && n === 1) return node("mroot", [nodeFor(a(0)), mn("3")])
  if ((name === "Surd" || name === "Root") && n === 2) {
    return node("mroot", [nodeFor(a(0)), nodeFor(a(1))])
  }

  if (name === "Abs" && n === 1) return fence("|", "|", [nodeFor(a(0))])
  if (name === "Floor" && n === 1) return fence("⌊", "⌋", [nodeFor(a(0))])
  if (name === "Ceiling" && n === 1) return fence("⌈", "⌉", [nodeFor(a(0))])
  if (name === "Norm" && n === 1) return fence("‖", "‖", [nodeFor(a(0))])

  if (name === "D" && n === 2) {
    // ∂f over ∂x; `{x, n}` in the second slot is the nth derivative, with
    // its order over both the ∂s.
    const second = a(1)
    if (second.kind === "list" && second.items.length === 2) {
      const [variable, order] = second.items as [WLExpr, WLExpr]
      return node("mfrac", [
        row([orderedOperator("∂", order), group(a(0), 5)]),
        row([mo("∂"), node("msup", [group(variable, 5), nodeFor(order)])]),
      ])
    }
    return node("mfrac", [differentialOf("∂", a(0)), differentialOf("∂", second)])
  }

  if (name === "D" && n === 3) {
    // A mixed partial: ∂²f over ∂x ∂y.
    return node("mfrac", [
      row([orderedOperator("∂", { kind: "number", value: "2" }), group(a(0), 5)]),
      row([differentialOf("∂", a(1)), gap(0.15), differentialOf("∂", a(2))]),
    ])
  }

  if (name === "Dt" && n === 2) {
    return node("mfrac", [differentialOf("d", a(0)), differentialOf("d", a(1))])
  }

  if ((name === "Integrate") && (n === 3 || n === 4)) {
    // ∬ and ∭: one sign per variable, then the integrand and its differentials.
    const signs: MathNode[] = []
    const diffs: MathNode[] = []
    for (const bound of args.slice(1)) {
      if (bound.kind === "list" && bound.items.length === 3) {
        signs.push(node("msubsup", [mo("∫"), nodeFor(bound.items[1]!), nodeFor(bound.items[2]!)]))
      } else {
        signs.push(mo("∫"))
      }
      if (bound.kind === "list" && bound.items.length > 0) diffs.push(...differential(bound.items[0]!))
    }
    return row([...signs, nodeFor(a(0)), ...diffs])
  }

  if (name === "ContourIntegrate" && n === 2) {
    return row([mo("∮"), nodeFor(a(0)), ...differential(a(1))])
  }

  if (name === "Grad" || name === "Laplacian" || name === "Div" || name === "Curl") {
    const operator = name === "Laplacian" ? node("msup", [mo("∇"), mn("2")]) : mo("∇")
    const parts: MathNode[] = [operator]
    if (name === "Div") parts.push(mo("·"))
    if (name === "Curl") parts.push(mo("×"))
    parts.push(gap(0.1), group(args[0] ?? { kind: "symbol", name: "f" }, 5))
    return row(parts)
  }

  if (name === "Limit" && (n === 2 || n === 3)) {
    const lim = mo("lim", { movablelimits: "true" })
    return row([node("munder", [lim, approachNode(a(1), n === 3 ? a(2) : null)]), group(a(0), 3)])
  }

  if (name === "Binomial" && n === 2) {
    return fence("(", ")", [node("mfrac", [nodeFor(a(0)), nodeFor(a(1))], { linethickness: "0" })])
  }

  if (name === "Subscript" && n === 2) {
    return node("msub", [group(a(0), 5), nodeFor(a(1))])
  }

  if (name === "Exp" && n === 1) {
    return node("msup", [leaf("mi", "e"), nodeFor(a(0))])
  }

  if (name === "Log" && n === 2) {
    return row([node("msub", [leaf("mi", "log"), nodeFor(a(0))]), mo(FUNCTION_APPLICATION),
      bracketed(a(1))])
  }

  if (name === "Factorial" && n === 1) return row([powerBase(a(0)), mo("!")])

  if (name === "Dot" && n === 2) return row([group(a(0), 4), mo("·"), group(a(1), 5)])
  if (name === "Cross" && n === 2) return row([group(a(0), 4), mo("×"), group(a(1), 5)])

  // `sin(x)`, `f(x, y)`: the name upright, the arguments set properly.
  const head = functionName(name)
  if (args.length === 0) return head
  return row([head, mo(FUNCTION_APPLICATION), ...argumentsNodes(args)])
}

function argumentsNodes(args: WLExpr[]): MathNode[] {
  return [fence("(", ")", commaSeparated(args.map(nodeFor)))]
}

/**
 * The thing a limit approaches: `x → 0`, and when it has a side a little + or
 * − on the 0 says which (`Direction -> "FromAbove"`).
 */
function approachNode(approach: WLExpr, direction: WLExpr | null): MathNode {
  const side = direction !== null && direction.kind === "binary" && direction.op === "->"
    && direction.right.kind === "text"
    ? (direction.right.value === "FromBelow" ? "−" : "+")
    : null
  if (side === null) return nodeFor(approach)
  if (approach.kind === "binary" && approach.op === "->") {
    return row([nodeFor(approach.left), mo("→"),
      node("msup", [group(approach.right, 5), mo(side)])])
  }
  return node("msup", [group(approach, 5), mo(side)])
}

// MARK: - The page

export type MathDisplay = "block" | "inline"

/** `<math>` around an expression. `block` is display style: limits above and below, a taller operator. */
export function mathRoot(expr: WLExpr, display: MathDisplay): MathNode {
  return node("math", [nodeFor(expr)], { display })
}

/** The MathML for WL source, or null while it is not an expression (half-typed maths is left as text). */
export function mathmlFor(source: string, display: MathDisplay = "block"): MathNode | null {
  if (source.length > MAX_MATH_SOURCE) return null
  try {
    const expr = parseWL(source)
    if (expr === null) return null
    const tree = mathRoot(expr, display)
    return deeperThan(tree, MAX_DEPTH) ? null : tree
  } catch {
    // A pathological source (thousands of nested brackets) overflows the stack of the
    // recursive parser or builder. It is not maths anyone typed: leave it as the user's text,
    // exactly as a half-typed one is — the editor's decorations must never throw.
    return null
  }
}

/** Deeper than this a tree is left as text: the page could not lay it out in time anyway. */
const MAX_DEPTH = 400

function deeperThan(tree: MathNode, limit: number, depth = 0): boolean {
  if (depth > limit) return true
  for (const child of tree.children ?? []) if (deeperThan(child, limit, depth + 1)) return true
  return false
}

const escapeXml = (text: string): string =>
  text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")

/** MathML as a string — what the tests compare, and what could be pasted into any page. */
export function serializeMathML(tree: MathNode): string {
  const attrs = tree.attrs === undefined ? "" : Object.entries(tree.attrs)
    .map(([key, value]) => ` ${key}="${escapeXml(value).replace(/"/g, "&quot;")}"`).join("")
  if (tree.text !== undefined) return `<${tree.tag}${attrs}>${escapeXml(tree.text)}</${tree.tag}>`
  const children = tree.children ?? []
  if (children.length === 0) return `<${tree.tag}${attrs}/>`
  return `<${tree.tag}${attrs}>${children.map(serializeMathML).join("")}</${tree.tag}>`
}

/** The characters of a tree, in order, with nothing between them. */
export function mathNodeText(tree: MathNode): string {
  if (tree.text !== undefined) return tree.text
  return (tree.children ?? []).map(mathNodeText).join("")
}

/** Source straight to a MathML string (null if it does not parse). */
export function mathmlString(source: string, display: MathDisplay = "block"): string | null {
  const tree = mathmlFor(source, display)
  return tree === null ? null : serializeMathML(tree)
}

/** The MathML for one expression (without the `<math>` around it). */
export const mathNodeFor = nodeFor
