/**
 * A maths cell's source as the Wolfram kernel reads it, for the notebook export (export/wolfram/plan.ts).
 *
 * Port-only: the Mac has no Wolfram export (docs/PARITY.md).
 *
 * THE NOTE'S MATHS IS WL, WITH TWO SPELLINGS OF ITS OWN. The port's parser (math/expression.ts) reads a lone `=` as an
 * equals sign, because a line of algebra written by hand — `y = 2x + 1` — is an equation; and it keeps the round
 * brackets written straight after a name, `f(2)`, because that is what a reader expects to see. The kernel reads
 * both differently: `=` is an ASSIGNMENT (evaluating the cell would set `y`), and `f(2)` is `f` times 2. So the
 * export undoes exactly those two, and nothing else: `=` is written `==`, and brackets after a name become the call
 * they were written as (`f(2)` → `f[2]`, `2 f(x)` → `2*f[x]`, `f(x)^2` → `f[x]^2`). Brackets after anything else
 * keep grouping (`2(x+1)` → `2*(x + 1)`). The signs typed for the eye (`×` `·` `≤` `≥` `≠` `÷` `−`, a raised `²`) are
 * already read as their ASCII operators and print as them.
 */

import {
  binary, call, endsWithName, group, list, negate, opensWithGroup, parseWL, printWL, type WLExpr,
} from "../../math/expression"

/**
 * A maths cell's body as one line of source: each line trimmed, joined by a space. The one reading of a ```wl
 * fence's body, shared with the page that typesets it (@writemind/editor's math.ts).
 */
export const mathsCellSource = (body: string): string =>
  body.split("\n").map((line) => line.trim()).join(" ").trim()

/** `operand` (brackets written after a name, perhaps raised to a power) applied to the rightmost name in `named`. */
function applied(named: WLExpr, operand: WLExpr): WLExpr {
  // `2 f` (2 × f): the call goes on the name at the right, the product round it stays.
  if (named.kind === "binary" && named.op === "*") return binary("*", named.left, applied(named.right, operand), named.written)
  // `f(x)^2`: the call is the power's base.
  if (operand.kind === "binary" && operand.op === "^") return binary("^", applied(named, operand.left), kernelTree(operand.right))
  return call(named, [kernelTree(operand.kind === "group" ? operand.inner : operand)])
}

function kernelTree(expr: WLExpr): WLExpr {
  switch (expr.kind) {
    case "list": return list(expr.items.map(kernelTree))
    case "call": return call(kernelTree(expr.head), expr.args.map(kernelTree))
    case "negate": return negate(kernelTree(expr.operand))
    case "group": return group(kernelTree(expr.inner))
    case "binary": {
      // A product with no sign whose right-hand side opens with written brackets, after a name: a call.
      // (Only an implicit product keeps a `group` at all: brackets after a written sign only group.)
      if (expr.op === "*" && endsWithName(expr.left) && opensWithGroup(expr.right)) {
        return applied(kernelTree(expr.left), expr.right)
      }
      return binary(expr.op === "=" ? "==" : expr.op, kernelTree(expr.left), kernelTree(expr.right))
    }
    default: return expr
  }
}

/** The signs typed for the eye, as the port's tokenizer reads them (math/expression.ts), in the kernel's ASCII. */
const TYPED_SIGNS: Record<string, string> = { "·": "*", "×": "*", "÷": "/", "−": "-", "≤": "<=", "≥": ">=", "≠": "!=" }
const RAISED = "⁰¹²³⁴⁵⁶⁷⁸⁹"

/**
 * The signs the port reads as ASCII operators, written as them, one character at a time, string literals left alone.
 * For the source the port's parser cannot read: the kernel reads `²` as a letter of a symbol's name (`x²` is a symbol,
 * not x squared) and `·` as CenterDot, which means nothing, so a cell that did not parse for some OTHER reason
 * (`f[x_] := x²`, `Solve[x² == 4, x] /. x -> 1`) must still get these right.
 */
export function asciiSigns(source: string): string {
  const chars = Array.from(source)
  let out = ""
  let at = 0
  while (at < chars.length) {
    const ch = chars[at]!
    if (ch === "\"") {
      // A string literal runs to its closing quote, a backslash taking the character after it along.
      out += ch
      at += 1
      while (at < chars.length) {
        const inside = chars[at]!
        out += inside
        at += 1
        if (inside === "\\" && at < chars.length) { out += chars[at]!; at += 1 }
        else if (inside === "\"") break
      }
    } else if (RAISED.includes(ch) || (ch === "⁻" && RAISED.includes(chars[at + 1] ?? "-"))) {
      out += "^"
      if (ch === "⁻") { out += "-"; at += 1 }
      while (at < chars.length && RAISED.includes(chars[at]!)) { out += RAISED.indexOf(chars[at]!); at += 1 }
    } else {
      out += TYPED_SIGNS[ch] ?? ch
      at += 1
    }
  }
  return out
}

/**
 * The source as the kernel should read it (above); source the port's parser cannot read is handed over as it is
 * written — the kernel's own parser may well read it (`f[x_] := x^2`), and if it cannot, the cell says so itself —
 * but with the signs typed for the eye written as the ASCII operators they are (`asciiSigns`).
 */
export function kernelSpelling(source: string): string {
  const expr = parseWL(source)
  return expr === null ? asciiSigns(source) : printWL(kernelTree(expr))
}
