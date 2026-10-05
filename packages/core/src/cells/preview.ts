/**
 * The rendered page's own rules: where the stack of blocks sits, what a key
 * means in a seam and over held cells, which blocks are open for typing, and
 * what Return and Backspace do to a block. Ported from
 * `WriteMind/Editor/MarkdownPreview.swift` (its static, pure half),
 * `PreviewLayout.swift` and the block rules of `BlockEditor.swift`.
 *
 * The Mac keeps these inside the SwiftUI view because that is where they
 * were first needed, and tests them through it. Here they are plain functions
 * so the CodeMirror page and the test runner ask the same ones.
 */

import { blockContaining, listContinuation, removeBlock } from "./editing"
import { openCell, type CellKind } from "./types"
import { GAP_HEIGHT, seams, structuralLines, plusTarget, type CellBox, type Seam } from "./seams"
import { firstCellFromBy, picked } from "./selection"
import { positioned, type Block } from "../markdown/parser"
import { fenced } from "../markdown/formatting"
import { reminderBox } from "../markdown/sourceStyle"
import {
  edit, end, lineRange, range, replacing, substring, type Edit, type Range,
} from "../text/range"

// MARK: - Layout

/** The air above the first cell. */
export const PREVIEW_TOP_INSET = 22
/** The page's left and right margin, the same both sides. */
export const PREVIEW_SIDE_INSET = 28
/**
 * The FLOOR under a seam — "enough to put the pointer in" — and nothing more since Mac 0cde812: the air between two
 * cells is `PREVIEW_BLOCK_GAP`.
 */
export const PREVIEW_GAP_HEIGHT = GAP_HEIGHT
/** One line of the markdown side: 15px set at a line height of 1.45 (the notebook theme's). */
export const SOURCE_LINE_HEIGHT = 15 * 1.45
/** The space the markdown side adds between lines on top of that: none — the 1.45 is all of it. */
export const SOURCE_LINE_SPACING = 0
/** The size the markdown side sets code at, a little under the body. */
export const SOURCE_CODE_SIZE = 14.2
/**
 * THE AIR BETWEEN TWO CELLS ON THE PAGE, which is the other side's rhythm and not a number of this page's own (Mac
 * 0cde812; Sean, 2026-09-22: "make the spacing more uniform.. it's ok on markdown mode but in rendered mode things
 * get scrunched together"). The markdown side puts a blank line of the note between two cells, and the spacing round
 * it; the page used to stack them `PREVIEW_GAP_HEIGHT` apart, a third of that.
 */
export const PREVIEW_BLOCK_GAP = SOURCE_LINE_HEIGHT + SOURCE_LINE_SPACING
/**
 * The air above and below a drawn code block: HALF THE TEXT IT HOLDS, so the box hugs the code (Mac e66379c; Sean,
 * 2026-09-22: "there shouldn't be so much padding in the cells themselves, it should be about the size of the text a
 * little bigger"). It used to be a whole source line, so that a code cell was as tall on both sides; nothing depended
 * on that — the two modes come back to the same cell by its offset, never by a measurement.
 */
export const PREVIEW_CODE_PADDING = Math.round(SOURCE_CODE_SIZE / 2)
/** And either side of it. */
export const PREVIEW_CODE_SIDE_PADDING = 12
/** All of the tail seam under the last cell, so there is somewhere to put a cell down there. */
export const PREVIEW_TAIL_HEIGHT = 80 + PREVIEW_TOP_INSET + PREVIEW_GAP_HEIGHT
/** How tall the insertion mark itself is. */
export const PREVIEW_MARK_HEIGHT = 12

export interface PreviewRow { id: number; height: number }
export interface PreviewPlace { top: number; bottom: number }

/** Where every block ends up, in the scroll content's own coordinates — what the brackets are drawn from. */
export function previewPositions(rows: PreviewRow[], spacing: number, top: number): Map<number, PreviewPlace> {
  const out = new Map<number, PreviewPlace>()
  let y = top
  for (const row of rows) {
    out.set(row.id, { top: y, bottom: y + row.height })
    y += row.height + spacing
  }
  return out
}

/**
 * Which row is at the top of the window, given how far the page has
 * scrolled: the last one that starts at or above the fold. It is what the two
 * modes agree on when you switch between them — the same cell is put back at
 * the top, whatever height the other side lays the note out at.
 */
export function topRow(positions: Map<number, PreviewPlace>, scroll: number): number | null {
  const ordered = [...positions.entries()].sort((a, b) => a[1].top - b[1].top)
  if (ordered.length === 0) return null
  // A tolerance of a line, so a page scrolled a hair past a cell's top still
  // counts as being on that cell rather than the one before.
  const fold = scroll + 8
  let found = ordered[0]![0]
  for (const [id, place] of ordered) if (place.top <= fold) found = id
  return found
}

/**
 * Whether a place on the page is in front of the reader right now (Mac b98a7a5, `PreviewLayout.onScreen`): asked
 * before the page is moved for a cursor put somewhere from OUTSIDE it — the bar under an answer a run has just
 * written — so a one-line answer does not jerk the note under somebody who can already see it. A `margin` off each
 * edge, because a place a point inside the fold is on screen by arithmetic and not by eye; a window nobody has
 * measured yet holds nothing.
 */
export function previewOnScreen(y: number, scroll: number, height: number, margin = 24): boolean {
  if (height <= margin * 2) return false
  return y >= scroll + margin && y <= scroll + height - margin
}

/** Where a place that is NOT on screen is carried to (not jumped): this far down the window (Mac b98a7a5). */
export const PREVIEW_LANDING = 0.8

/**
 * The seams of the rendered page, measured off a stack of blocks instead of
 * off the glyphs: the same model the markdown pane uses, so a seam means the
 * same thing on both sides.
 *
 * `pageHeight` is the window on the page. The tail reaches the bottom of it
 * when the note is shorter than the window, and `PREVIEW_TAIL_HEIGHT` under
 * the last cell when it is longer — either way everything below the last cell
 * is seam.
 */
export function previewSeams(rows: PreviewRow[], noteLength: number, pageHeight: number): Seam[] {
  const places = previewPositions(rows, PREVIEW_BLOCK_GAP, PREVIEW_TOP_INSET + PREVIEW_GAP_HEIGHT)
  const cells: CellBox[] = []
  for (const row of rows) {
    const place = places.get(row.id)
    if (place) cells.push({ top: place.top, bottom: place.bottom, offset: row.id })
  }
  const bottom = (cells[cells.length - 1]?.bottom ?? 0) + PREVIEW_TAIL_HEIGHT
  return seams({
    cells,
    pageTop: 0,
    pageBottom: Math.max(pageHeight, bottom),
    noteLength,
    // An empty note has no cell for the bar to sit against; the stack says
    // where the first one would land.
    firstCellTop: PREVIEW_TOP_INSET + PREVIEW_GAP_HEIGHT,
  })
}

/**
 * The + on a seam, in the seam view's OWN coordinates — the same region the
 * markdown pane gets, moved to the top of the seam because that is where the
 * rendered page's hover reports from. Without the four points of slack: the
 * press here is a real button, so the hand must not be wider than it.
 */
export function previewPlusTarget(seam: Seam): { x: number; y: number; width: number; height: number } {
  const target = plusTarget(seam, PREVIEW_SIDE_INSET, 0)
  return { ...target, y: target.y - seam.top }
}

/** WHICH seam — its place down the page, and the offset a cell would be opened at. */
export interface SeamID { index: number; offset: number }

export const sameSeam = (a: SeamID | null, b: SeamID | null): boolean =>
  a !== null && b !== null && a.index === b.index && a.offset === b.offset

/**
 * What the kind on a bar becomes when the bar is armed at `id`. Re-arming the
 * seam that is ALREADY armed keeps whatever the + chose for it, and arming
 * anywhere else is plain text.
 */
export function arming(id: SeamID, over: SeamID | null, keeping: CellKind): CellKind {
  return sameSeam(over, id) ? keeping : { kind: "text" }
}

// MARK: - Keys

/** A key as the page hears it: `key` is `KeyboardEvent.key`, so "a", "Enter", "ArrowDown". */
export interface KeyInfo {
  key: string
  ctrl?: boolean
  meta?: boolean
  alt?: boolean
  shift?: boolean
}

/** What a key pressed in an armed seam means. */
export type SeamKey =
  /** A printable character: the cell opens and this goes in it. */
  | { kind: "write"; text: string }
  /** Return: an empty cell, open for typing. */
  | { kind: "empty" }
  /** Escape: the bar goes out and the note is untouched. */
  | { kind: "disarm" }
  /** An arrow: the bar walks into the cell beside it. It writes nothing. */
  | { kind: "step"; up: boolean }
  /** Nobody's business here; whoever else wants the key can have it. */
  | { kind: "pass" }

/** One character, as a user would count it (an emoji is two UTF-16 units and one letter). */
const typed = (key: string): boolean => {
  if (key.length === 0) return false
  const points = [...key]
  if (points.length !== 1) return false
  // Control characters and the private-use range where function keys can be kept.
  const code = points[0]!.codePointAt(0)!
  return code >= 0x20 && code !== 0x7f && !(code >= 0xf700 && code <= 0xf8ff)
}

export function seamKey(info: KeyInfo): SeamKey {
  if (info.key === "Escape") return { kind: "disarm" }
  if (info.key === "Enter") return { kind: "empty" }
  if (info.key === "ArrowUp") return { kind: "step", up: true }
  if (info.key === "ArrowDown") return { kind: "step", up: false }
  // ⌘S is not an S. Shift is, though — it is how a capital arrives.
  if (info.ctrl || info.meta) return { kind: "pass" }
  return typed(info.key) ? { kind: "write", text: info.key } : { kind: "pass" }
}

export interface Fence { open: string; close: string }

/**
 * What that key does to the NOTE: the cell the seam stands for, of whatever
 * kind the + chose, with what was typed already in it. Null for a key that
 * only takes the bar back — arming and then clicking away leaves the markdown
 * byte for byte as it was.
 */
export function opened(key: SeamKey, kind: CellKind, offset: number, markdown: string):
  { markdown: string; editing: Range; draft: string; fence: Fence | null } | null {
  let written: string
  switch (key.kind) {
    case "write": written = key.text; break
    case "empty": written = ""; break
    default: return null
  }
  const made = openCell(kind, markdown, offset, written)
  const source = substring(made.markdown, made.cell)
  // A fenced cell is opened as its CODE: the fences stay put.
  const parts = fenced(source)
  if (!parts) return { markdown: made.markdown, editing: made.cell, draft: source, fence: null }
  return { markdown: made.markdown, editing: made.cell, draft: parts.body, fence: { open: parts.open, close: parts.close } }
}

/** What a key means while cells are HELD, which is not what the same key means in a seam. */
export type CellKey =
  /** A printable character: the cells go, and one cell with this already in it takes their place. */
  | { kind: "replace"; text: string }
  /** Backspace or Delete: they go, and nothing takes their place. */
  | { kind: "remove" }
  /** Escape: the brackets go out and the note is untouched. */
  | { kind: "clear" }
  | { kind: "pass" }

export function cellKey(info: KeyInfo): CellKey {
  // Ctrl+Backspace is the Delete Cell menu item and never reaches this.
  if (info.ctrl || info.meta) return { kind: "pass" }
  if (info.key === "Escape") return { kind: "clear" }
  if (info.key === "Backspace" || info.key === "Delete") return { kind: "remove" }
  return typed(info.key) ? { kind: "replace", text: info.key } : { kind: "pass" }
}

/**
 * What is still held after a whole-cell command: the cells the edit's
 * landing selection covers. Three cells moved or duplicated stay held, so
 * pressing the move twice walks the same three down the page.
 */
export function stillHeld(landing: Range, text: string): Range[] {
  return picked(positioned(text).map((block) => block.range), [landing])
}

/** Return adds a line to a list, a quote or a fenced block; anywhere else it starts the next block. */
export function keepsNewlines(block: Block | null | undefined): boolean {
  switch (block?.kind) {
    case "bullets": case "todos": case "dashes": case "numbered": case "quote": case "code": return true
    default: return false
  }
}

// MARK: - Which blocks are open

/**
 * - `open`: a caret or a piece of selection is in it; its markdown is showing, styled.
 * - `held`: picked up as a whole (by its bracket, or inside a wider selection); drawn, and lit.
 * - `closed`: drawn.
 */
export type CellState = "closed" | "open" | "held"

/**
 * Cells that touch — one newline between them, no blank line — are one thing
 * to type in. A list carried on by Return has a new line the parser reads as
 * a paragraph of its own until a word is typed after the marker; opening only
 * the cell the caret is in would draw the list above it as a list and the
 * new line as raw source. Returns, for every cell, the first and the last of
 * the run of touching cells it belongs to.
 */
export function touchingRuns(cells: Range[]): { first: number; last: number }[] {
  const out: { first: number; last: number }[] = []
  let start = 0
  for (let i = 0; i < cells.length; i++) {
    const next = cells[i + 1]
    const joined = next !== undefined && cells[i]!.length > 0 && next.length > 0
      && next.location === end(cells[i]!) + 1
    if (!joined) {
      for (let k = start; k <= i; k++) out[k] = { first: start, last: i }
      start = i + 1
    }
  }
  return out
}

/**
 * Which cells of the page are open for typing and which are held.
 *
 * The page holds ONE selection and every rule about it is here. `holding` is
 * the bracket gesture's own word ("these cells are picked up"): without it, a
 * selection that happens to be exactly one cell's words is a text selection in
 * that cell and the cell stays open; with it, the same selection is the cell
 * held and nothing opens. A bar that is the cursor opens nothing either.
 */
export function cellStates(cells: Range[], selection: Range[], holding: boolean, armed: boolean): CellState[] {
  const own = cells.map((cell): CellState => {
    if (cell.length <= 0) {
      // An empty cell is only ever open: there is nothing in it to draw.
      return !armed && selection.some((r) => r.length === 0 && r.location === cell.location) ? "open" : "closed"
    }
    let isOpen = false
    let isHeld = false
    for (const r of selection) {
      const from = r.location
      const to = end(r)
      if (r.length === 0) {
        if (!armed && from >= cell.location && from <= end(cell)) isOpen = true
        continue
      }
      const wholly = from <= cell.location && to >= end(cell)
      const beyond = from < cell.location || to > end(cell)
      if (wholly && (beyond || holding)) { isHeld = true; continue }
      // A text selection with an end in the cell keeps the cell open, so
      // what is being selected is what is on the screen.
      if (!holding && ((from >= cell.location && from <= end(cell)) || (to >= cell.location && to <= end(cell)))) {
        isOpen = true
      }
    }
    if (isHeld) return "held"
    return isOpen ? "open" : "closed"
  })
  const runs = touchingRuns(cells)
  return own.map((state, index) => {
    const run = runs[index]!
    for (let k = run.first; k <= run.last; k++) if (own[k] === "open") return "open"
    return state
  })
}

/**
 * `cellStates`, but only for the cells that are not closed, as a map from the cell's place in the list: with a caret
 * (or any selection) it is the few cells the selection reaches, found by search, instead of a state for every cell of
 * a note of five thousand on every keystroke. A differential test holds it to `cellStates` on random notes and
 * selections. `of` says how to read a cell's range (the editor's cells carry one).
 */
export function cellStatesSparse<T>(cells: readonly T[], of: (cell: T) => Range, selection: Range[], holding: boolean,
  armed: boolean): Map<number, CellState> {
  const own = new Map<number, CellState>()
  for (const r of selection) {
    const from = r.location
    const to = end(r)
    // The cells that can have anything to do with this range start at or before its end and stop at or after its start.
    for (let i = Math.max(0, firstCellFromBy(cells, from, of) - 1); i < cells.length; i++) {
      const cell = of(cells[i]!)
      if (cell.location > to) break
      if (end(cell) < from) continue
      let now: CellState = "closed"
      if (cell.length <= 0) {
        if (!armed && r.length === 0 && r.location === cell.location) now = "open"
      } else if (r.length === 0) {
        if (!armed && from >= cell.location && from <= end(cell)) now = "open"
      } else {
        const wholly = from <= cell.location && to >= end(cell)
        const beyond = from < cell.location || to > end(cell)
        if (wholly && (beyond || holding)) now = "held"
        else if (!holding && ((from >= cell.location && from <= end(cell)) || (to >= cell.location && to <= end(cell)))) now = "open"
      }
      if (now === "closed") continue
      // A cell held by any range is held; open only when no range holds it.
      if (now === "held" || own.get(i) === undefined) own.set(i, now)
    }
  }
  // A cell that touches an open one is open with it (`touchingRuns`): the run is walked out from each open cell.
  const joined = (i: number): boolean => {
    const a = of(cells[i]!)
    const b = i + 1 < cells.length ? of(cells[i + 1]!) : undefined
    return b !== undefined && a.length > 0 && b.length > 0 && b.location === end(a) + 1
  }
  const result = new Map<number, CellState>(own)
  const opened = [...own].filter(([, state]) => state === "open").map(([i]) => i).sort((a, b) => a - b)
  let reached = -1
  for (const i of opened) {
    if (i <= reached) continue
    let first = i
    while (first > 0 && joined(first - 1)) first--
    let last = i
    while (last + 1 < cells.length && joined(last)) last++
    for (let k = first; k <= last; k++) result.set(k, "open")
    reached = last
  }
  return result
}

// MARK: - Return and Backspace in an open block

/**
 * Return in an open block. Null means "an ordinary newline will do" — a code
 * cell, a line that is not a list item, or a caret in no block at all.
 *
 * A list, a to-do list or a quote carries on (and an empty item ends it, the
 * rest of the note after the caret becoming the next block); anywhere else
 * Return starts the next block — what is behind the caret stays, what is in
 * front of it becomes the next block. Only the block's own range is rewritten.
 */
export function returnInBlock(markdown: string, selection: Range): Edit | null {
  const caret = Math.min(Math.max(selection.location, 0), markdown.length)
  const cells = positioned(markdown)
  const cell = blockContaining(caret, markdown)
  if (!cell) return null
  const at = cell.range
  if (cell.block.kind === "code") return null

  // A list item, wherever the parser put it: "- " with nothing after it is a
  // paragraph of one dash to the parser, and it is still a list item here.
  const line = lineRange(markdown, caret)
  const body = substring(markdown, line).replace(/\n$/, "")
  const continuation = (keepsNewlines(cell.block) || cell.block.kind === "paragraph")
    ? listContinuation(body) : null
  if (continuation !== null) {
    if (continuation !== "") {
      return edit(selection, "\n" + continuation, range(selection.location + 1 + continuation.length, 0))
    }
    // An empty item: it goes, and what is above it and what is below it
    // become two blocks. The list is every cell touching this one.
    const index = cells.findIndex((c) => c.range.location === at.location && c.range.length === at.length)
    const run = touchingRuns(cells.map((c) => c.range))[index] ?? { first: index, last: index }
    const whole = range(cells[run.first]!.range.location,
      end(cells[run.last]!.range) - cells[run.first]!.range.location)
    const text = substring(markdown, whole)
    const lineStart = Math.max(line.location, whole.location) - whole.location
    const lineStop = Math.min(end(line), end(whole)) - whole.location
    const rest = text.slice(0, lineStart) + text.slice(lineStop)
    const head = rest.slice(0, lineStart).replace(/\n+$/, "")
    const tail = rest.slice(lineStart).replace(/^\n+/, "")
    return edit(whole, head + "\n\n" + tail, range(whole.location + head.length + 2, 0))
  }
  if (keepsNewlines(cell.block) && cell.block.kind !== "quote" && cell.block.kind !== "paragraph") {
    // A list line the continuation rules do not know: an ordinary newline.
    return null
  }

  const text = substring(markdown, at)
  const from = Math.max(selection.location, at.location) - at.location
  const to = Math.min(end(selection), end(at)) - at.location
  const head = text.slice(0, from)
  // The spaces a break absorbs: the new block does not begin with an indent.
  const tail = text.slice(to).replace(/^[ \t]+/, "")
  return edit(at, head + "\n\n" + tail, range(at.location + head.length + 2, 0))
}

/**
 * Backspace in a block with nothing in it: the block goes, and so do the
 * blank lines holding it apart from its neighbours, and the caret lands at
 * the end of the block before. Null when the caret is not in an empty block —
 * a bar between two cells is NOT one (the line is the structure, not a block)
 * and neither is a caret in a block with words in it.
 */
export function backspaceInEmptyBlock(markdown: string, caret: number):
  { markdown: string; caret: number } | null {
  if (caret < 0 || caret > markdown.length) return null
  const line = lineRange(markdown, caret)
  if (substring(markdown, line).trim().length !== 0) return null
  // Any word-bearing cell that holds the caret keeps it.
  const cells = positioned(markdown)
  if (cells.some((cell) => cell.block.kind !== "blank" && caret >= cell.range.location && caret <= end(cell.range))) return null
  // The separators between two cells are bars, not empty blocks.
  if (structuralLines(markdown).some((r) => caret >= r.location && caret < end(r))) return null
  const out = removeBlock(markdown, range(caret, 0))
  if (out.markdown === markdown) return null
  return {
    markdown: out.markdown,
    caret: out.previous ? Math.min(end(out.previous), out.markdown.length) : 0,
  }
}

// MARK: - One reminder of a checklist at a time (Mac `ListEditing.swift`, 0fdd031)

/**
 * One reminder of a task list, as offsets in the note. `text` is the WORDS and
 * nothing else — everything before them is the box and its marker, which on
 * the rendered page is a live checkbox and not something to be typed (Sean,
 * 2026-09-21: "when modifying a checklist.. the checkboxes remain in tact and
 * just the text part of the list becomes editable, one at a time").
 */
export interface Reminder {
  /** The whole line, newline and all. */
  line: Range
  /** Just the words. */
  text: Range
  /** The character between the brackets — what a tick replaces. */
  box: number
  ticked: boolean
}

/**
 * Every reminder inside `cell`, in order. Lines that are not reminders are
 * skipped rather than counted — the rule `toggleTodo` follows, so the tick and
 * the editing agree about which reminder is the third one (ONE WALK).
 */
export function remindersIn(cell: Range, text: string): Reminder[] {
  const out: Reminder[] = []
  let start = Math.max(0, cell.location)
  const stop = Math.min(end(cell), text.length)
  while (start < stop) {
    const line = lineRange(text, start)
    if (line.length <= 0) break
    const found = reminderOnLine(line, text)
    if (found) out.push(found)
    start = end(line)
  }
  return out
}

/** The reminder on one line (a line range, newline and all), or null when that line is not one. */
export function reminderOnLine(line: Range, text: string): Reminder | null {
  const box = reminderBox(line, text)
  if (!box) return null
  // `box.end` is past the box and the space after it: the words.
  const bare = end(line) - (substring(text, line).endsWith("\n") ? 1 : 0)
  return { line, text: range(box.end, Math.max(0, bare - box.end)), box: box.state, ticked: box.ticked }
}

/** The reminder whose WORDS start where `words` does — how an open item is found again after the note has changed. */
export function reminderForText(words: Range, text: string): Reminder | null {
  if (words.location > text.length) return null
  const line = lineRange(text, Math.min(words.location, Math.max(text.length - 1, 0)))
  const found = reminderOnLine(line, text)
  return found && found.text.location === words.location ? found : null
}

/** The reminder on the line above `line`, when that line is one too. */
export function previousReminder(line: Range, text: string): Reminder | null {
  if (line.location <= 0) return null
  return reminderOnLine(lineRange(text, line.location - 1), text)
}

/** The reminder on the line below `line`, when that line is one too. */
export function nextReminder(line: Range, text: string): Reminder | null {
  if (end(line) >= text.length || !substring(text, line).endsWith("\n")) return null
  return reminderOnLine(lineRange(text, end(line)), text)
}

/**
 * The marker this line carries with its box UNTICKED — what the next reminder
 * starts with. A new task is not a done one (the answer `listContinuation`
 * gives too).
 */
export function freshMarker(line: Range, text: string): string | null {
  const box = reminderBox(line, text)
  if (!box || box.end > text.length) return null
  const head = text.slice(line.location, box.end)
  const at = box.state - line.location
  if (at < 0 || at >= head.length) return null
  return head.slice(0, at) + " " + head.slice(at + 1)
}

/**
 * RETURN inside an item: what is behind the caret (`head`) stays, what is in
 * front of it (`tail`) becomes the next reminder, and that is the one open
 * afterwards. `item` is the item's words.
 */
export function splitReminder(markdown: string, item: Range, head: string, tail: string):
  { markdown: string; editing: Range } | null {
  if (end(item) > markdown.length) return null
  const line = lineRange(markdown, item.location)
  const marker = freshMarker(line, markdown)
  if (marker === null) return null
  const updated = replacing(markdown, item, head + "\n" + marker + tail)
  return { markdown: updated, editing: range(item.location + head.length + 1 + marker.length, tail.length) }
}

/**
 * BACKSPACE in an item with nothing in it: the item goes, and the one above it
 * is open at its end. `editing` is null when there was no reminder above — the
 * caller takes the whole cell away instead.
 */
export function removeEmptyReminder(markdown: string, item: Range): { markdown: string; editing: Range | null } | null {
  if (end(item) > markdown.length || item.length !== 0) return null
  const line = lineRange(markdown, item.location)
  const above = previousReminder(line, markdown)
  const updated = replacing(markdown, line, "")
  return { markdown: updated, editing: above ? range(end(above.text), 0) : null }
}

/**
 * BACKSPACE at the start of an item that is NOT empty: its words join the end
 * of the one above, and the caret sits at the seam between what was there and
 * what has arrived. Null when there is nothing above to join to.
 */
export function joinPreviousReminder(markdown: string, item: Range): { markdown: string; editing: Range } | null {
  if (end(item) > markdown.length) return null
  const line = lineRange(markdown, item.location)
  const above = previousReminder(line, markdown)
  if (!above) return null
  const words = substring(markdown, item)
  // Everything from the end of the words above to the end of this item goes, and the words come back on that line.
  const cut = range(end(above.text), end(item) - end(above.text))
  return { markdown: replacing(markdown, cut, words), editing: range(end(above.text), 0) }
}
