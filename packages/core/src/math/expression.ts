/**
 * Maths is kept in Wolfram Language, so what a note holds is text anything
 * can read — `Integrate[x^2, {x, 0, 1}]` — and this reads it back so it can
 * be typeset.
 *
 * Ported from `WriteMind/Math/WLExpression.swift` (WLExpr, WLParser,
 * WLPrinter).
 */

export type WLExpr =
  | { kind: "number"; value: string }
  | { kind: "symbol"; name: string }
  | { kind: "text"; value: string }
  | { kind: "list"; items: WLExpr[] }
  | { kind: "call"; head: WLExpr; args: WLExpr[] }
  | { kind: "binary"; op: string; left: WLExpr; right: WLExpr; written?: string }
  | { kind: "negate"; operand: WLExpr }
  | { kind: "group"; inner: WLExpr }

export const num = (value: string): WLExpr => ({ kind: "number", value })
export const sym = (name: string): WLExpr => ({ kind: "symbol", name })
export const txt = (value: string): WLExpr => ({ kind: "text", value })
export const list = (items: WLExpr[]): WLExpr => ({ kind: "list", items })
export const call = (head: WLExpr, args: WLExpr[]): WLExpr => ({ kind: "call", head, args })
/**
 * `written` (PORT-ONLY) is the multiplication sign a person actually wrote -- `×` or `·` -- so that the
 * typeset form can keep it. It is left off a node that was spelled `*` or had no sign at all (`2 x`).
 */
export const binary = (op: string, left: WLExpr, right: WLExpr, written?: string): WLExpr =>
  written === undefined ? { kind: "binary", op, left, right } : { kind: "binary", op, left, right, written }
export const negate = (operand: WLExpr): WLExpr => ({ kind: "negate", operand })
/**
 * (PORT-ONLY) Round brackets that were WRITTEN right after another factor: the `(2)` of `f(2)`, the `(x + 1)` of
 * `2(x + 1)`. Everywhere else brackets only group, and the parser drops them (the printer puts back the ones
 * the reading needs); here they are what the person wrote and what a reader expects to see, so they stay. A
 * parenthesised operand used to lose them and be drawn as a product: `f(2) = 4` came out as `f·2 = 4` (the dot
 * is the rule that a number after a factor needs a sign), `y(0)` as `y·0`, `f(x)` as `f x`.
 */
export const group = (inner: WLExpr): WLExpr => ({ kind: "group", inner })

/** `Integrate[…]` and friends: a named head with its arguments. */
export function application(expr: WLExpr): { name: string; args: WLExpr[] } | null {
  if (expr.kind === "call" && expr.head.kind === "symbol") {
    return { name: expr.head.name, args: expr.args }
  }
  return null
}

/** Nothing that needs brackets round it when something is done to it. */
export function isAtom(expr: WLExpr): boolean {
  return expr.kind !== "binary" && expr.kind !== "negate"
}

/** Whether an operand opens with brackets that were written after a factor: the `(2)` of `f(2)`, the `(x)^2` of `f(x)^2`. */
export function opensWithGroup(expr: WLExpr): boolean {
  return expr.kind === "group" || (expr.kind === "binary" && expr.op === "^" && opensWithGroup(expr.left))
}

/** Whether the last thing in a product is a name that a bracket after it applies: `f` in `f(2)`, `2 f` in `2 f(x)`. */
export function endsWithName(expr: WLExpr): boolean {
  if (expr.kind === "symbol" || expr.kind === "call") return true
  return expr.kind === "binary" && expr.op === "*" && endsWithName(expr.right)
}

interface Token {
  kind: "number" | "symbol" | "text" | "op" | "punct"
  value: string
  /** For an operator that was typed as another sign (× and ·, both read as `*`): the sign as typed. */
  written?: string
}

// A lone "=" is read as an equals sign (PORT-ONLY: WL means Set by it, but a line of
// algebra written by hand -- "y = 2x + 1", which the handwriting reader hands over as
// exactly that -- is an equation, and left unparsed it was shown as source).
const OPERATORS = ["->", "==", "!=", "<=", ">=", "=", "+", "-", "*", "/", "^", "<", ">"]

const WRITTEN_OPERATORS: Record<string, string> = {
  "≤": "<=", "≥": ">=", "≠": "!=", "×": "*", "·": "*", "÷": "/", "−": "-",
}

/** The written signs the typeset form keeps: `3 × 4` is drawn with its ×, not as `3 4` (which reads as 34). */
const KEPT_SIGNS = new Set(["×", "·"])

/** x² as it arrives from a reader that gives the raised character itself: the same as x^2. */
const SUPERSCRIPTS = "⁰¹²³⁴⁵⁶⁷⁸⁹"

const isNumberCh = (c: string): boolean => /^\p{N}$/u.test(c)
const isLetterCh = (c: string): boolean => /^\p{L}$/u.test(c)
const isSpaceCh = (c: string): boolean => /^\s$/u.test(c)

export function tokenize(source: string): Token[] {
  const tokens: Token[] = []
  const chars = Array.from(source)
  let index = 0

  while (index < chars.length) {
    const ch = chars[index]!

    if (isSpaceCh(ch)) { index += 1; continue }

    // \[Alpha] — WL spells Greek letters like this, and they are names.
    if (ch === "\\" && index + 1 < chars.length && chars[index + 1] === "[") {
      let name = "\\["
      index += 2
      while (index < chars.length && chars[index] !== "]") { name += chars[index]; index += 1 }
      if (index < chars.length) index += 1
      tokens.push({ kind: "symbol", value: name + "]" })
      continue
    }

    if (SUPERSCRIPTS.includes(ch) || (ch === "⁻" && SUPERSCRIPTS.includes(chars[index + 1] ?? "-"))) {
      let value = ""
      tokens.push({ kind: "op", value: "^" })
      if (ch === "⁻") { tokens.push({ kind: "op", value: "-" }); index += 1 }
      while (index < chars.length && SUPERSCRIPTS.includes(chars[index]!)) {
        value += SUPERSCRIPTS.indexOf(chars[index]!); index += 1
      }
      tokens.push({ kind: "number", value })
      continue
    }

    if (isNumberCh(ch) || (ch === "." && index + 1 < chars.length && isNumberCh(chars[index + 1]!))) {
      let value = ""
      while (index < chars.length && (isNumberCh(chars[index]!) || chars[index] === ".")) {
        value += chars[index]; index += 1
      }
      tokens.push({ kind: "number", value })
      continue
    }

    if (isLetterCh(ch) || ch === "$") {
      let name = ""
      while (index < chars.length
        && (isLetterCh(chars[index]!) || (isNumberCh(chars[index]!) && !SUPERSCRIPTS.includes(chars[index]!))
          || chars[index] === "$")) {
        name += chars[index]; index += 1
      }
      tokens.push({ kind: "symbol", value: name })
      continue
    }

    if (ch === "\"") {
      let value = ""
      index += 1
      while (index < chars.length && chars[index] !== "\"") { value += chars[index]; index += 1 }
      if (index < chars.length) index += 1
      tokens.push({ kind: "text", value })
      continue
    }

    // The signs a person (or a reader of handwriting) types instead of the ASCII spelling.
    const typed = WRITTEN_OPERATORS[ch]
    if (typed !== undefined) {
      tokens.push(KEPT_SIGNS.has(ch) ? { kind: "op", value: typed, written: ch } : { kind: "op", value: typed })
      index += 1
      continue
    }

    const rest = chars.slice(index).join("")
    const match = OPERATORS.find((op) => rest.startsWith(op))
    if (match !== undefined) {
      tokens.push({ kind: "op", value: match })
      index += match.length
      continue
    }

    tokens.push({ kind: "punct", value: ch })
    index += 1
  }
  return tokens
}

export function precedence(op: string): number {
  switch (op) {
    case "->": return 1
    case "=": case "==": case "!=": case "<": case "<=": case ">": case ">=": return 2
    case "+": case "-": return 3
    case "*": case "/": return 4
    case "^": return 5
    default: return 0
  }
}

export const isRightAssociative = (op: string): boolean => op === "^" || op === "->"

class Parser {
  index = 0
  /** Set when the next primary is the right-hand factor of a product with no sign: its brackets, if any, are kept. */
  private afterFactor = false
  constructor(readonly tokens: Token[]) {}

  get isFinished(): boolean { return this.index >= this.tokens.length }
  get current(): Token | undefined { return this.tokens[this.index] }

  expression(minimum: number): WLExpr | null {
    let left = this.unary()
    if (left === null) return null

    for (;;) {
      const token = this.current
      if (token === undefined) break
      if (token.kind === "op" && precedence(token.value) >= minimum && precedence(token.value) > 0) {
        const op = token.value
        this.index += 1
        const next = isRightAssociative(op) ? precedence(op) : precedence(op) + 1
        const right = this.expression(next)
        if (right === null) return null
        left = binary(op, left, right, token.written)
        continue
      }
      // `2 x` is a product in WL, and someone typing into a slot will
      // write it that way.
      if (this.startsPrimary(token) && precedence("*") >= minimum) {
        this.afterFactor = true
        const right = this.expression(precedence("*") + 1)
        this.afterFactor = false
        if (right === null) return null
        left = binary("*", left, right)
        continue
      }
      break
    }
    return left
  }

  private startsPrimary(token: Token): boolean {
    switch (token.kind) {
      case "number": case "symbol": case "text": return true
      case "punct": return token.value === "(" || token.value === "{"
      case "op": return false
    }
  }

  unary(): WLExpr | null {
    const token = this.current
    if (token !== undefined && token.kind === "op" && token.value === "-") {
      this.index += 1
      // `-x^2` is -(x^2): a power binds tighter than the sign in front of it.
      // (The Swift parser took only the `x` and gave (-x)^2, which typeset
      // `Exp[-x^2]` — the Gaussian — as e to the power (-x)².)
      const operand = this.expression(precedence("^"))
      return operand === null ? null : negate(operand)
    }
    if (token !== undefined && token.kind === "op" && token.value === "+") {
      this.index += 1
      return this.unary()
    }
    return this.postfix()
  }

  postfix(): WLExpr | null {
    let value = this.primary()
    if (value === null) return null
    for (;;) {
      const token = this.current
      if (token === undefined || token.kind !== "punct" || token.value !== "[") break
      this.index += 1
      const args = this.items("]")
      if (args === null) return null
      value = call(value, args)
    }
    return value
  }

  primary(): WLExpr | null {
    // Only the first primary after a factor is "after a factor"; anything nested inside it is not.
    const keepBrackets = this.afterFactor
    this.afterFactor = false
    const token = this.current
    if (token === undefined) return null
    switch (token.kind) {
      case "number": this.index += 1; return num(token.value)
      case "symbol": this.index += 1; return sym(token.value)
      case "text": this.index += 1; return txt(token.value)
      case "op": return null
      case "punct":
        if (token.value === "(") {
          this.index += 1
          const inner = this.expression(0)
          const close = this.current
          if (inner === null || close === undefined || close.kind !== "punct" || close.value !== ")") {
            return null
          }
          this.index += 1
          return keepBrackets ? group(inner) : inner
        }
        if (token.value === "{") {
          this.index += 1
          const items = this.items("}")
          return items === null ? null : list(items)
        }
        return null
    }
  }

  /** Comma-separated expressions up to a closing bracket. */
  items(close: string): WLExpr[] | null {
    const out: WLExpr[] = []
    const first = this.current
    if (first !== undefined && first.kind === "punct" && first.value === close) {
      this.index += 1
      return out
    }
    for (;;) {
      const item = this.expression(0)
      if (item === null) return null
      out.push(item)
      const token = this.current
      if (token === undefined || token.kind !== "punct") return null
      if (token.value === ",") { this.index += 1; continue }
      if (token.value === close) { this.index += 1; return out }
      return null
    }
  }
}

/** Reads WL: the arithmetic, brackets, lists and calls, which is all a note holds. */
export function parseWL(source: string): WLExpr | null {
  const parser = new Parser(tokenize(source))
  const expression = parser.expression(0)
  if (expression === null || !parser.isFinished) return null
  return expression
}

function wrapped(expr: WLExpr, level: number): string {
  if (expr.kind === "binary" && precedence(expr.op) < level) return "(" + printWL(expr) + ")"
  if (expr.kind === "negate" && level > 3) return "(" + printWL(expr) + ")"
  return printWL(expr)
}

/**
 * Back to WL text — the canonical spelling, with the brackets it needs and
 * none it does not.
 */
export function printWL(expr: WLExpr): string {
  switch (expr.kind) {
    case "number": return expr.value
    case "symbol": return expr.name
    case "text": return `"${expr.value}"`
    case "list": return "{" + expr.items.map(printWL).join(", ") + "}"
    case "call": return printWL(expr.head) + "[" + expr.args.map(printWL).join(", ") + "]"
    case "negate": return "-" + wrapped(expr.operand, 5)
    case "group": return "(" + printWL(expr.inner) + ")"
    case "binary": {
      const level = precedence(expr.op)
      const spacing = level <= 3 ? " " : ""
      const right = isRightAssociative(expr.op)
      const leftText = wrapped(expr.left, right ? level + 1 : level)
      const rightText = wrapped(expr.right, right ? level : level + 1)
      return leftText + spacing + expr.op + spacing + rightText
    }
  }
}

/**
 * Whatever was typed, in canonical form — and left alone if it does not
 * parse, because half-typed maths is still the user's text.
 */
export function canonicalWL(source: string): string {
  const expr = parseWL(source)
  return expr === null ? source : printWL(expr)
}
