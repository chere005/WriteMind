// A frozen copy of `arm` / `structuralLines` as they were before the incremental rewrite (2026-10-03, e3-editor-perf).
import { end, lineRange, substring, type Range } from "../../src/text/range"
import { positioned } from "./parserOld"

export function structuralLinesOld(source: string): Range[] {
  const runs: Range[][] = []
  let current: Range[] = []
  let index = 0
  while (index < source.length) {
    const line = lineRange(source, index)
    if (substring(source, line).trim().length === 0) current.push(line)
    else if (current.length > 0) { runs.push(current); current = [] }
    index = Math.max(end(line), index + 1)
  }
  if (current.length > 0) runs.push(current)
  return runs.flatMap((run) => (run.length <= 2 ? run : [run[0]!, run[run.length - 1]!]))
}

export function armOld(caret: Range, markdown: string, current: number | null): number | null {
  if (caret.length !== 0) return null
  const offset = caret.location
  if (current !== null && current === offset) return current
  if (offset <= 0 || offset >= markdown.length) return null
  const line = lineRange(markdown, offset)
  if (offset >= end(line) || substring(markdown, line).trim().length !== 0) return null
  if (!structuralLinesOld(markdown).some((r) => offset >= r.location && offset < end(r))) return null
  const blocks = positioned(markdown)
  if (blocks.some((block) => block.range.location < offset && offset < end(block.range))) return null
  return blocks.find((block) => block.range.location >= offset)?.range.location ?? markdown.length
}
