/**
 * View ▸ Collapse Subsections (Ctrl+;): what is UNDER the cells in play, and
 * never the cell itself. Ported from `NotebookOutline.subsections(of:in:)` and
 * `folding(_:collapsed:)` (here `subsectionsFolding`, the editor package has a `folding` of its own) (Mac e8b3266; Sean, 2026-09-21: "collapse current
 * cell's subsections (or highlighted cells) is cmd+;").
 *
 * The cell's OWN section is left open: folding that would take the cell you
 * are standing in off the screen, which is the one thing a fold must never
 * do. A cell before the first heading has no section and nothing under it.
 */

import { end, type Range } from "../text/range"
import { sectionContaining, sections } from "./outline"

/** The sections nested inside the ones these cells are in, in the note's order, with no key twice. */
export function subsections(cells: readonly Range[], text: string): string[] {
  const all = sections(text)
  const keys: string[] = []
  for (const cell of cells) {
    const here = sectionContaining(cell.location, all)
    if (!here) continue
    for (const section of all) {
      if (section.key === here.key) continue
      if (section.range.location > here.range.location && end(section.range) <= end(here.range)
        && !keys.includes(section.key)) keys.push(section.key)
    }
  }
  return keys
}

/**
 * One key both ways, because there is no second one to open them with (the
 * caret's own fold keys went the same day): any of them still open means
 * fold; all of them closed means open.
 */
export function subsectionsFolding(keys: readonly string[], collapsed: ReadonlySet<string>): boolean {
  return keys.some((key) => !collapsed.has(key))
}
