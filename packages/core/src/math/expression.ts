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
  | { kind: "binary"; op: string; left: WLExpr; right: WLExpr }
  | { kind: "negate"; operand: WLExpr }

export const num = (value: string): WLExpr => ({ kind: "number", value })
export const sym = (name: string): WLExpr => ({ kind: "symbol", name })
export const txt = (value: string): WLExpr => ({ kind: "text", value })
export const list = (items: WLExpr[]): WLExpr => ({ kind: "list", items })
export const call = (head: WLExpr, args: WLExpr[]): WLExpr => ({ kind: "call", head, args })
export const binary = (op: string, left: WLExpr, right: WLExpr): WLExpr =>
  ({ kind: "binary", op, left, right })
export const negate = (operand: WLExpr): WLExpr => ({ kind: "negate", operand })

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

interface Token {
  kind: "number" | "symbol" | "text" | "op" | "punct"
  value: string
}

const OPERATORS = ["->", "==", "!=", "<=", ">=", "+", "-", "*", "/", "^", "<", ">"]

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
        && (isLetterCh(chars[index]!) || isNumberCh(chars[index]!) || chars[index] === "$")) {
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
    case "==": case "!=": case "<": case "<=": case ">": case ">=": return 2
    case "+": case "-": return 3
    case "*": case "/": return 4
    case "^": return 5
    default: return 0
  }
}

export const isRightAssociative = (op: string): boolean => op === "^" || op === "->"

class Parser {
  index = 0
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
        left = binary(op, left, right)
        continue
      }
      // `2 x` is a product in WL, and someone typing into a slot will
      // write it that way.
      if (this.startsPrimary(token) && precedence("*") >= minimum) {
        const right = this.expression(precedence("*") + 1)
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
      const operand = this.unary()
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
          return inner
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
    case "negate": return "-" + wrapped(expr.operand, 6)
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
