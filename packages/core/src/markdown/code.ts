/**
 * The colouring of fenced code. Ported from `WriteMind/Editor/CodeHighlighter.swift`.
 *
 * A small hand-written scanner — one left-to-right pass in which comments and
 * strings are found FIRST, so a `//` inside a string is not a comment and a
 * quote inside a comment opens nothing. Anything unterminated runs to the end
 * of the text rather than hanging: a note is edited mid-token all the time.
 *
 * Offsets are UTF-16 code units, which is what `NSString` counted on the Mac
 * and what a JavaScript string counts, so the ranges mean the same thing.
 */

import { range, type Range } from "../text/range"

export type CodeLanguage =
  | "plain" | "c" | "cpp" | "wolfram" | "python" | "typescript" | "rust" | "java" | "bash" | "zsh"

export const CODE_LANGUAGES: CodeLanguage[] =
  ["plain", "c", "cpp", "wolfram", "python", "typescript", "rust", "java", "bash", "zsh"]

/** What goes after the fence. */
export const fenceOf = (language: CodeLanguage): string => (language === "plain" ? "" : language)

export function languageTitle(language: CodeLanguage): string {
  switch (language) {
    case "plain": return "Plain Text"
    case "c": return "C"
    case "cpp": return "C++"
    case "wolfram": return "Wolfram Language"
    case "python": return "Python"
    case "typescript": return "TypeScript"
    case "rust": return "Rust"
    case "java": return "Java"
    case "bash": return "Bash"
    case "zsh": return "Zsh"
  }
}

/**
 * The language a fence tag names, or null when it names something else.
 * `wl` is NOT here: that is this app's maths fence, and maths is set, not
 * coloured.
 */
export function languageFrom(fence: string | null | undefined): CodeLanguage | null {
  const tag = (fence ?? "").trim().toLowerCase()
  switch (tag) {
    case "": return "plain"
    case "c": return "c"
    case "cpp": case "c++": case "cc": case "cxx": case "hpp": case "h": return "cpp"
    case "wolfram": case "mathematica": case "wls": case "m": return "wolfram"
    case "python": case "py": case "python3": return "python"
    case "typescript": case "ts": case "tsx": case "javascript": case "js": return "typescript"
    case "rust": case "rs": return "rust"
    case "java": return "java"
    // `sh` and `shell` are Bash's: the colouring is the same and the fence
    // is what most notes write.
    case "bash": case "sh": case "shell": return "bash"
    case "zsh": return "zsh"
    default: return null
  }
}

export type CodeTokenKind = "keyword" | "type" | "string" | "comment" | "number" | "function" | "symbol"

export interface CodeToken { range: Range; kind: CodeTokenKind }

const set = (words: string): Set<string> => new Set(words.split(/\s+/).filter((w) => w.length > 0))

const C_KEYWORDS = set(`if else for while do switch case default break continue return goto sizeof
  typedef struct union enum static extern const volatile inline register restrict signed unsigned auto
  _Static_assert _Atomic include define ifdef ifndef endif pragma`)
const CPP_KEYWORDS = set(`class namespace template typename public private protected virtual override
  final new delete this nullptr constexpr consteval concept requires using try catch throw noexcept
  operator friend explicit mutable static_cast dynamic_cast reinterpret_cast const_cast decltype
  co_await co_return co_yield true false`)
const C_TYPES = set(`int char short long float double void bool wchar_t char8_t char16_t char32_t
  size_t ssize_t ptrdiff_t intptr_t uintptr_t int8_t int16_t int32_t int64_t uint8_t uint16_t uint32_t
  uint64_t FILE va_list string vector map set pair shared_ptr unique_ptr`)
const PYTHON_KEYWORDS = set(`and as assert async await break class continue def del elif else except
  finally for from global if import in is lambda match case nonlocal not or pass raise return try while
  with yield True False None self cls`)
const PYTHON_TYPES = set(`int str float complex list dict set frozenset tuple bool bytes bytearray
  object type range`)
const TS_KEYWORDS = set(`abstract as async await break case catch class const continue debugger declare
  default delete do else enum export extends false finally for from function get if implements import in
  infer instanceof interface is keyof let module namespace new null of package private protected public
  readonly require return satisfies set static super switch this throw true try type typeof var void
  while with yield`)
const TS_TYPES = set(`string number boolean any never unknown object symbol bigint undefined Array
  Promise Record Partial Readonly Map Set Date`)
const RUST_KEYWORDS = set(`as async await break const continue crate dyn else enum extern false fn for
  if impl in let loop match mod move mut pub ref return self Self static struct super trait true type
  unsafe use where while union macro_rules`)
const RUST_TYPES = set(`i8 i16 i32 i64 i128 isize u8 u16 u32 u64 u128 usize f32 f64 bool char str
  String Vec Option Result Box Rc Arc RefCell Cell HashMap HashSet BTreeMap BTreeSet Some None Ok Err`)
const JAVA_KEYWORDS = set(`abstract assert break case catch class const continue default do else enum
  extends final finally for goto if implements import instanceof interface native new package private
  protected public return static strictfp super switch synchronized this throw throws transient try
  volatile while var record sealed permits yield true false null`)
const JAVA_TYPES = set(`int long short byte char float double boolean void String Object Integer Long
  Double Boolean Character List ArrayList Map HashMap Set HashSet Optional Stream Exception
  RuntimeException`)
const SHELL_KEYWORDS = set(`if then elif else fi case esac for select while until do done function in
  time coproc return break continue exit local declare typeset readonly export unset shift trap set`)
const SHELL_BUILTINS = set(`echo printf read cd pwd test eval exec source alias unalias wait jobs kill
  let getopts shopt setopt emulate autoload zmodload true false`)

/** The Wolfram built-ins worth marking; a capitalised name not here is still a symbol. */
const WOLFRAM_BUILTINS = set(`Module With Block Function If Which Switch Do For While Table Map
  MapThread Apply Nest NestList Fold FoldList Plot Plot3D ListPlot ListLinePlot Histogram Integrate
  NIntegrate D Dt Sum Product Limit Series Solve NSolve DSolve FindRoot Simplify FullSimplify Expand
  Factor Together Apart Collect Coefficient Sin Cos Tan ArcSin ArcCos ArcTan Sinh Cosh Tanh Exp Log Sqrt
  Abs Sign Floor Ceiling Round Mod Max Min Total Mean Median Variance StandardDeviation Pi E I Infinity
  Degree GoldenRatio EulerGamma True False None Null List Length First Last Rest Most Part Take Drop
  Range Select Cases Count Position Join Flatten Partition Sort SortBy Reverse Union Intersection
  Complement Append Prepend Insert Delete Times Plus Print Echo StringJoin StringSplit StringReplace
  StringLength StringTake ToString ToExpression Characters Graphics Graphics3D Line Circle Disk
  Rectangle Polygon Point Arrow Text Style RGBColor Hue Red Blue Green Black White Gray Orange Thick
  Thin Dashed PointSize Return Throw Catch Sow Reap Set SetDelayed Rule RuleDelayed Association Keys
  Values Lookup AssociationMap Dataset Import Export Manipulate Dynamic Animate Show Grid Column Row
  Framed Tooltip RandomReal RandomInteger RandomChoice SeedRandom Timing AbsoluteTiming Quiet Check
  Assert Head Depth AtomQ NumberQ StringQ ListQ MemberQ FreeQ MatchQ Replace ReplaceAll ReplaceRepeated
  Nothing Missing Automatic All Options SetOptions Clear Remove Needs Get Compile Parallelize`)

const keywordsOf = (language: CodeLanguage): Set<string> => {
  switch (language) {
    case "c": return C_KEYWORDS
    case "cpp": return new Set([...C_KEYWORDS, ...CPP_KEYWORDS])
    case "python": return PYTHON_KEYWORDS
    case "typescript": return TS_KEYWORDS
    case "rust": return RUST_KEYWORDS
    case "java": return JAVA_KEYWORDS
    case "bash": case "zsh": return SHELL_KEYWORDS
    default: return new Set()
  }
}

const typesOf = (language: CodeLanguage): Set<string> => {
  switch (language) {
    case "c": case "cpp": return C_TYPES
    case "python": return PYTHON_TYPES
    case "typescript": return TS_TYPES
    case "rust": return RUST_TYPES
    case "java": return JAVA_TYPES
    // A shell has no types; the builtins are the words worth marking.
    case "bash": case "zsh": return SHELL_BUILTINS
    default: return new Set()
  }
}

const hasSlashComments = (l: CodeLanguage) =>
  l === "c" || l === "cpp" || l === "typescript" || l === "rust" || l === "java"
const hasHashComments = (l: CodeLanguage) => l === "python" || l === "bash" || l === "zsh"

const QUOTE = 0x22, APOS = 0x27, TICK = 0x60
const quotesOf = (l: CodeLanguage): number[] => {
  switch (l) {
    case "plain": return []
    case "c": case "cpp": case "python": case "rust": case "java": return [QUOTE, APOS]
    case "wolfram": return [QUOTE]
    case "typescript": case "bash": case "zsh": return [QUOTE, APOS, TICK]
  }
}

const isSpace = (u: number) => u === 0x20 || u === 0x09
const isDigit = (u: number) => u >= 0x30 && u <= 0x39
const isHex = (u: number) => isDigit(u) || (u >= 0x41 && u <= 0x46) || (u >= 0x61 && u <= 0x66)
const isIdentStart = (u: number) =>
  (u >= 0x41 && u <= 0x5a) || (u >= 0x61 && u <= 0x7a) || u === 0x5f || u === 0x24 || u > 0x7f
const isIdentPart = (u: number) => isIdentStart(u) || isDigit(u)

const WOLFRAM_OPERATORS = ["@@@", "//.", ":>", ":=", "/;", "/@", "@@", "//", "->", "/.", "&", "@", "|>", "<|"]

export function codeTokens(code: string, language: CodeLanguage): CodeToken[] {
  if (language === "plain") return []
  const length = code.length
  if (length === 0) return []

  const keywords = keywordsOf(language)
  const types = typesOf(language)
  const quotes = quotesOf(language)
  const tokens: CodeToken[] = []
  let index = 0
  /** The last character that was not a space — what tells `x: Foo` from a `Foo` on its own. */
  let previousSymbol = 0
  let previousWord = ""

  const at = (i: number) => (i >= 0 && i < length ? code.charCodeAt(i) : 0)
  const matches = (s: string, i: number) => code.startsWith(s, i)
  const emit = (from: number, to: number, kind: CodeTokenKind) => {
    if (to > from) tokens.push({ range: range(from, to - from), kind })
  }
  // Wolfram spells a pattern `x_`, so an underscore ENDS a symbol there.
  const identPart = (u: number) => (language === "wolfram" ? isIdentPart(u) && u !== 0x5f : isIdentPart(u))
  const nextNonSpace = (from: number) => {
    let cursor = from
    while (cursor < length && isSpace(at(cursor))) cursor++
    return cursor
  }

  const simpleString = (from: number, quote: number, escapes: boolean): number => {
    let cursor = from + 1
    while (cursor < length) {
      const unit = at(cursor)
      if (escapes && unit === 0x5c) { cursor += 2; continue }
      if (unit === quote) return cursor + 1
      // A plain quote does not run past its line; a template literal does.
      if (unit === 0x0a && quote !== TICK) return cursor
      cursor++
    }
    return length
  }

  /** `"""…"""` and `'''…'''`, or null when this is not one. */
  const tripleQuote = (from: number): number | null => {
    const unit = at(from)
    if ((unit !== QUOTE && unit !== APOS) || from + 2 >= length) return null
    if (at(from + 1) !== unit || at(from + 2) !== unit) return null
    let cursor = from + 3
    while (cursor < length) {
      if (at(cursor) === 0x5c) { cursor += 2; continue }
      if (at(cursor) === unit && cursor + 2 < length && at(cursor + 1) === unit && at(cursor + 2) === unit) {
        return cursor + 3
      }
      cursor++
    }
    return length
  }

  const number = (from: number): number => {
    let cursor = from
    if (at(cursor) === 0x30 && cursor + 1 < length && (at(cursor + 1) === 0x78 || at(cursor + 1) === 0x58)) {
      cursor += 2
      while (cursor < length && (isHex(at(cursor)) || at(cursor) === 0x5f)) cursor++
    } else {
      while (cursor < length) {
        const unit = at(cursor)
        if (isDigit(unit) || unit === 0x5f || unit === 0x2e) { cursor++; continue }
        if (unit === 0x65 || unit === 0x45) {
          const next = cursor + 1 < length ? at(cursor + 1) : 0
          if (isDigit(next) || ((next === 0x2b || next === 0x2d) && cursor + 2 < length && isDigit(at(cursor + 2)))) {
            cursor += 2
            continue
          }
        }
        break
      }
    }
    // Suffixes: 10ul, 1.5f, Wolfram's 2.5`.
    while (cursor < length && "uUlLfF".includes(code[cursor]!)) cursor++
    if (language === "wolfram" && cursor < length && at(cursor) === 0x60) cursor++
    return cursor
  }

  /** `_`, `__`, `_Integer`, `_?NumberQ`, `x_` (the `x` is already behind us). */
  const wolframPattern = (from: number): number => {
    let cursor = from
    while (cursor < length && at(cursor) === 0x5f) cursor++
    if (cursor < length && at(cursor) === 0x3f) cursor++
    while (cursor < length && isIdentPart(at(cursor))) cursor++
    return cursor
  }

  const wolframOperator = (from: number): number | null => {
    for (const op of WOLFRAM_OPERATORS) if (matches(op, from)) return from + op.length
    return null
  }

  const classify = (word: string, callsOut: boolean): CodeTokenKind => {
    if (keywords.has(word)) return "keyword"
    if (types.has(word)) return "type"
    const upper = /^\p{Lu}/u.test(word)
    if (language === "wolfram") {
      if (upper) return WOLFRAM_BUILTINS.has(word) ? "keyword" : (callsOut ? "function" : "symbol")
      return callsOut ? "function" : "symbol"
    }
    if (language === "typescript" && upper) {
      // `x: Foo`, `extends Foo`, `new Foo`, `<Foo>` — a name in a type position.
      const typePosition = previousSymbol === 0x3a || previousSymbol === 0x3c
        || ["extends", "implements", "new", "as", "instanceof", "interface", "type", "class"].includes(previousWord)
      if (typePosition) return "type"
    }
    return callsOut ? "function" : "symbol"
  }

  while (index < length) {
    const start = index
    const unit = at(index)

    // Whitespace colours nothing, and does not break the "what came before" context.
    if (isSpace(unit) || unit === 0x0a || unit === 0x0d) { index++; continue }

    // ---- comments
    if (hasSlashComments(language) && matches("//", index)) {
      let cursor = index + 2
      while (cursor < length && at(cursor) !== 0x0a) cursor++
      emit(start, cursor, "comment"); index = cursor; continue
    }
    if (hasSlashComments(language) && matches("/*", index)) {
      let cursor = index + 2
      while (cursor < length && !matches("*/", cursor)) cursor++
      cursor = Math.min(length, cursor + 2)
      emit(start, cursor, "comment"); index = cursor; continue
    }
    if (hasHashComments(language) && unit === 0x23) {
      let cursor = index + 1
      while (cursor < length && at(cursor) !== 0x0a) cursor++
      emit(start, cursor, "comment"); index = cursor; continue
    }
    if (language === "wolfram" && matches("(*", index)) {
      // Wolfram's comments nest: (* a (* b *) c *) is one comment.
      let cursor = index + 2
      let depth = 1
      while (cursor < length && depth > 0) {
        if (matches("(*", cursor)) { depth++; cursor += 2 }
        else if (matches("*)", cursor)) { depth--; cursor += 2 }
        else cursor++
      }
      const stop = Math.min(cursor, length)
      emit(start, stop, "comment"); index = stop; continue
    }

    // ---- strings
    if (language === "python") {
      const triple = tripleQuote(index)
      if (triple !== null) {
        emit(start, triple, "string"); index = triple
        previousSymbol = 0x22; previousWord = ""
        continue
      }
    }
    if (quotes.includes(unit)) {
      const stop = simpleString(index, unit, language !== "wolfram" || unit === QUOTE)
      emit(start, stop, "string"); index = stop
      previousSymbol = unit; previousWord = ""
      continue
    }

    // ---- numbers
    if (isDigit(unit) || (unit === 0x2e && isDigit(at(index + 1)))) {
      const stop = number(index)
      emit(start, stop, "number"); index = stop
      previousSymbol = 0x30; previousWord = ""
      continue
    }

    // ---- Wolfram patterns and slots, which start where nothing else does
    if (language === "wolfram") {
      if (unit === 0x5f) {
        const stop = wolframPattern(index)
        emit(start, stop, "type"); index = stop
        previousSymbol = unit; previousWord = ""
        continue
      }
      if (unit === 0x23) {
        let cursor = index + 1
        while (cursor < length && (at(cursor) === 0x23 || isDigit(at(cursor)))) cursor++
        emit(start, cursor, "symbol"); index = cursor
        previousSymbol = unit; previousWord = ""
        continue
      }
      const operatorEnd = wolframOperator(index)
      if (operatorEnd !== null) {
        emit(start, operatorEnd, "symbol"); index = operatorEnd
        previousSymbol = unit; previousWord = ""
        continue
      }
    }

    // ---- identifiers
    if (isIdentStart(unit)) {
      let cursor = index + 1
      while (cursor < length && identPart(at(cursor))) cursor++
      const word = code.slice(index, cursor)

      // A Python string prefix is part of the string: rb"…", f'…'.
      if (language === "python" && word.length <= 2 && /^[fFrRbBuU]+$/.test(word) && quotes.includes(at(cursor))) {
        const stop = tripleQuote(cursor) ?? simpleString(cursor, at(cursor), true)
        emit(start, stop, "string"); index = stop
        previousSymbol = 0x22; previousWord = ""
        continue
      }
      // `std::vector` reads as one name.
      if (language === "cpp" && word === "std" && matches("::", cursor) && isIdentStart(at(cursor + 2))) {
        cursor += 2
        while (cursor < length && identPart(at(cursor))) cursor++
        emit(start, cursor, "type"); index = cursor
        previousSymbol = 0x3a; previousWord = "std"
        continue
      }
      // `x_Integer` — the pattern is the whole thing.
      if (language === "wolfram" && at(cursor) === 0x5f) {
        const stop = wolframPattern(cursor)
        emit(start, stop, "type"); index = stop
        previousSymbol = 0x5f; previousWord = word
        continue
      }

      const after = nextNonSpace(cursor)
      const callBracket = language === "wolfram" ? 0x5b : 0x28
      emit(start, cursor, classify(word, at(after) === callBracket))
      index = cursor
      previousWord = word
      previousSymbol = 0
      continue
    }

    previousSymbol = unit
    previousWord = ""
    index++
  }
  return tokens
}
