// A frozen copy of `sections` as it was before the incremental rewrite (2026-10-03, e3-editor-perf): the reference the
// differential tests compare the new one against. Do not edit.
import { end, range, type Range } from "../../src/text/range"
import { heading as headingOf } from "../../src/markdown/parser"
const LEAF_LEVEL = 6
export interface Section {
  key: string; title: string; level: number; depth: number; headingRange: Range; range: Range; contentEnd: number
}
interface OutlineLine { range: Range; level: number; title: string; blank: boolean }
/**
 * Every heading in the text, in order, with its group worked out. A `#`
 * inside a code fence is code, not a heading.
 */
export function sectionsOld(text: string): Section[] {
  const lines: OutlineLine[] = []
  let offset = 0
  let inFence = false
  for (const line of text.split("\n")) {
    const trimmed = line.trim()
    let level = 0
    let title = ""
    if (trimmed.startsWith("```")) {
      inFence = !inFence
    } else if (!inFence) {
      const found = headingOf(trimmed)
      if (found) { level = found.level; title = found.text.trim() }
    }
    lines.push({ range: range(offset, line.length), level, title, blank: trimmed.length === 0 })
    offset += line.length + 1
  }

  const result: Section[] = []
  const headingLines: number[] = []
  const open: number[] = []
  const titles = new Map<string, number>()

  const close = (index: number, beforeLine: number) => {
    const last = lines[beforeLine - 1]!
    const start = result[index]!.range.location
    result[index]!.range = range(start, end(last.range) - start)
    let written = beforeLine - 1
    while (written > headingLines[index]! && lines[written]!.blank) written--
    result[index]!.contentEnd = end(lines[written]!.range)
  }

  lines.forEach((line, index) => {
    if (line.level <= 0) return
    if (line.level < LEAF_LEVEL) {
      while (open.length > 0 && result[open[open.length - 1]!]!.level >= line.level) {
        close(open[open.length - 1]!, index)
        open.pop()
      }
    }
    const count = (titles.get(line.title) ?? 0) + 1
    titles.set(line.title, count)
    const key = count === 1 ? line.title : `${line.title}#${count}`
    result.push({
      key, title: line.title, level: line.level, depth: open.length,
      headingRange: line.range, range: line.range, contentEnd: end(line.range),
    })
    headingLines.push(index)
    if (line.level < LEAF_LEVEL) open.push(result.length - 1)
  })
  while (open.length > 0) {
    close(open[open.length - 1]!, lines.length)
    open.pop()
  }
  return result
}
