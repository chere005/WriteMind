/**
 * THE SHEET AND THE NOTE FOLLOW EACH OTHER (Sean, 2026-10-05: "automatically switch to the right note tab when
 * selecting a drawing tab that matches it.. when the drawing is open, switching to another note tab goes back to the
 * previous non-page specific drawing tab"). Pure: the rules only; tabletSheets.ts keeps the remembered plain tab and
 * cellSheets.ts applies the rules (test/sheetFollow.test.ts).
 *
 * - A tab BOUND to a drawing cell ("<note> Drawing") picked by hand (a click on it, Pen ▸ Next / Previous Sheet)
 *   brings its note to the front first (`pickTab`: "bring"); the tab opens when the note is there, so the sheet never
 *   shows a bound tab with its note away. A plain tab, or one bound to the note in front, opens at once.
 * - Any OTHER note coming to the front while a bound tab is open sends the sheet back to the last PLAIN tab that was
 *   open (`rememberPlain`), else the first plain tab, else a new "Sheet 1" (`sheetForFront`). The bound note itself
 *   coming to the front changes nothing.
 * - No loops: a pick only ever brings a NOTE, and a note coming to the front only ever opens a PLAIN tab (or the
 *   bound tab that asked for that very note), so neither sets the other off again.
 */

import type { CellRef } from "./sheetSet"

/** A tab as these rules see it: its id and the cell it is bound to (null: a plain sheet). */
export interface FollowTab { id: string; cell: CellRef | null }
export interface FollowSheets { tabs: FollowTab[]; current: string }

/** A bound tab that was picked and waits for its note to come to the front. */
export interface Waiting { sheet: string; note: string }

/** What a pick does: open the tab now (`cell`: it is bound to the note in front), or bring its note first. */
export type Pick =
  | { kind: "open"; id: string; cell: CellRef | null }
  | { kind: "bring"; id: string; cell: CellRef }

/** What the sheet does when a note comes to the front. */
export type SheetMove = { kind: "keep" } | { kind: "open"; id: string } | { kind: "new" }

const KEEP: SheetMove = { kind: "keep" }

const tabOf = (sheets: FollowSheets, id: string | null | undefined): FollowTab | undefined =>
  id ? sheets.tabs.find((tab) => tab.id === id) : undefined

/** Tab `id` picked by hand while `front` is the note in front; null for a tab that is not there. */
export function pickTab(sheets: FollowSheets, id: string, front: string | null): Pick | null {
  const tab = tabOf(sheets, id)
  if (!tab) return null
  if (!tab.cell) return { kind: "open", id, cell: null }
  return tab.cell.note === front ? { kind: "open", id, cell: tab.cell } : { kind: "bring", id, cell: tab.cell }
}

/** The plain tab to remember: the open one when it is plain, else the one remembered before. */
export function rememberPlain(sheets: FollowSheets, remembered: string | null): string | null {
  const open = tabOf(sheets, sheets.current)
  return open && !open.cell ? open.id : remembered
}

/**
 * `front` came to the front (null: no note is). `waiting`: a bound tab picked for a note (it opens when that note is
 * the one). Else a bound tab of another note gives way to `remembered` (when it is still a plain tab), the first
 * plain tab, or a new one.
 */
export function sheetForFront(
  sheets: FollowSheets, front: string | null, remembered: string | null, waiting: Waiting | null = null,
): SheetMove {
  if (waiting && front !== null && waiting.note === front) {
    const asked = tabOf(sheets, waiting.sheet)
    if (asked?.cell?.note === front) return asked.id === sheets.current ? KEEP : { kind: "open", id: asked.id }
  }
  const open = tabOf(sheets, sheets.current)
  if (!open?.cell || open.cell.note === front) return KEEP
  const back = tabOf(sheets, remembered)
  if (back && !back.cell) return { kind: "open", id: back.id }
  const plain = sheets.tabs.find((tab) => !tab.cell)
  return plain ? { kind: "open", id: plain.id } : { kind: "new" }
}
