/**
 * What typing does inside a code cell. Ported from `WriteMind/Editor/CodeTyping.swift`
 * (Sean, 2026-09-19: "in a code cell in wysiwyg add basic features like auto {} () []
 * and tab inserts a 4space width tab").
 *
 * The rules every code editor has and prose does not: a bracket brings its partner,
 * typing the partner steps over it instead of doubling it, backspace between the two
 * takes both, and Tab is indentation rather than the markdown indent command. All of
 * it is decided here, over a string and a selection, so the editor only has to apply
 * the answer.
 */

import { blockContaining } from "../cells/editing"
import { end, lineRange, range, substring, type Edit, type Range } from "../text/range"

/**
 * The pairs that close themselves. The quotes are in it too: they are their own
 * closer, which is why they need the "typing it again steps over it" rule more than
 * the brackets do.
 */
export const CODE_PAIRS: Readonly<Record<string, string>> = {
  "(": ")", "[": "]", "{": "}", "\"": "\"", "'": "'", "`": "`",
}
const CLOSERS = new Set(Object.values(CODE_PAIRS))

/** A tab, shown four spaces wide by the editor. */
export const CODE_TAB = "\t"

const isLetterOrDigit = (character: string): boolean => /[\p{L}\p{N}]/u.test(character)

/** Null means "nothing special": the character goes in as it would anywhere else. */
export function codeTyping(input: string, text: string, selection: Range): Edit | null {
  if ([...input].length !== 1) return null
  const character = input
  const caret = Math.min(Math.max(selection.location, 0), text.length)

  // Wrap what is selected, rather than replacing it.
  const closerForWrap = CODE_PAIRS[character]
  if (selection.length > 0 && closerForWrap !== undefined) {
    const inner = substring(text, selection)
    return {
      range: selection,
      replacement: `${character}${inner}${closerForWrap}`,
      selection: range(selection.location + 1, selection.length),
    }
  }

  const next = caret < text.length ? text[caret]! : null
  const previous = caret > 0 ? text[caret - 1]! : null

  // Typing the closer that is already there steps over it, so the pair does not end up doubled.
  if (next !== null && next === character && CLOSERS.has(character)) {
    return { range: range(caret, 1), replacement: input, selection: range(caret + 1, 0) }
  }

  const closer = CODE_PAIRS[character]
  if (closer === undefined) return null

  // An apostrophe in a word is an apostrophe, not an opening quote.
  if (character === closer && previous !== null && isLetterOrDigit(previous)) return null
  // Nor does a quote pair up when it is closing one already open.
  if (character === closer && next !== null && isLetterOrDigit(next)) return null

  return { range: range(caret, 0), replacement: `${character}${closer}`, selection: range(caret + 1, 0) }
}

/** Backspace between the two halves of a pair takes both. */
export function codeBackspace(text: string, selection: Range): Edit | null {
  if (selection.length !== 0 || selection.location <= 0) return null
  const caret = selection.location
  if (caret >= text.length) return null
  const before = text[caret - 1]!
  const after = text[caret]!
  const closer = CODE_PAIRS[before]
  if (closer === undefined || closer !== after) return null
  return { range: range(caret - 1, 2), replacement: "", selection: range(caret - 1, 0) }
}

/** One level off the front of a line: a tab, or up to four spaces. */
export function strippedLevel(line: string): string {
  if (line.startsWith(CODE_TAB)) return line.slice(1)
  // The spaces at the FRONT, up to four.
  let taken = 0
  for (const character of line) {
    if (character !== " " || taken >= 4) break
    taken++
  }
  return line.slice(taken)
}

/**
 * Tab in code is indentation: one `unit` where the caret is, or a level on every line
 * of a selection. Shift-Tab takes one off. The unit differs by where the typing is
 * happening: the markdown pane writes four spaces, because that is what the file
 * should hold and what every other reader will show; a code cell on the rendered page
 * writes a real tab, so what you copy out of it is a tab.
 */
export function codeTabbing(text: string, selection: Range, outdent: boolean, unit: string = CODE_TAB): Edit {
  // NSString.lineRange(for: selection): from the line the selection starts on to the line holding its last character.
  const first = lineRange(text, selection.location)
  const lastCharacter = selection.length > 0 ? selection.location + selection.length - 1 : selection.location
  const lines = range(first.location, end(lineRange(text, lastCharacter)) - first.location)
  const spansLines = selection.length > 0 && substring(text, selection).includes("\n")

  if (!spansLines && !outdent) {
    return { range: selection, replacement: unit, selection: range(selection.location + unit.length, 0) }
  }

  // Every line of the selection, in or out by one level.
  const parts = substring(text, lines).split("\n")
  const changed: string[] = []
  let removedFirst = 0
  let removed = 0
  parts.forEach((line, index) => {
    if (line.length === 0 && index === parts.length - 1) { changed.push(line); return }
    if (outdent) {
      const taken = strippedLevel(line)
      if (index === 0) removedFirst = line.length - taken.length
      removed += line.length - taken.length
      changed.push(taken)
    } else {
      changed.push(unit + line)
    }
  })
  // (the Swift counts with `filter { !($0.isEmpty && $0 == parts.last) }`, which drops every empty part when the last is empty)
  const last = parts[parts.length - 1]
  const count = parts.filter((part) => !(part.length === 0 && part === last)).length
  const width = unit.length
  const selected = outdent
    ? range(Math.max(lines.location, selection.location - removedFirst), Math.max(0, selection.length - (removed - removedFirst)))
    : range(selection.location + width, selection.length + Math.max(0, count - 1) * width)
  return { range: lines, replacement: changed.join("\n"), selection: selected }
}

/** Whether the caret is inside a fenced code block — where Tab is indentation rather than the markdown indent command. */
export function inFence(text: string, selection: Range): boolean {
  const block = blockContaining(selection.location, text)
  return block !== null && block.block.kind === "code"
}
