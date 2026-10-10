/**
 * The Keyboard Shortcuts list (F1) shows the number keys together, first: Ctrl / ⌘ (+ Shift) + 1 … 9, 0 make the cells
 * (Title … Text, Markdown, Code Block, Evaluation Cell, Maths Cell, Drawing Cell), and they are scattered over the
 * Format and Insert menus otherwise. Sean, 2026-10-05: "group the ctrl/cmd + 1-0 keystrokes", in his quick reference and in this list; and
 * the same day the Shift row joined it (docs/PLAN-text-cells.md: Ctrl+Shift+7 Markdown, Ctrl+Shift+8 Runnable code).
 * Pure: the rows still come from the one key table (keyList.ts); only their order and grouping change here.
 */

import { chordCaps, chordParts } from "./chord"
import type { KeyGroup, KeyRow } from "./keyList"

/** A chord that is the command key, maybe Shift, and one digit: "Ctrl+7", "Ctrl+Shift+7" (commands.ts `shown`). */
const NUMBER = /^(?:Ctrl|Cmd)\+(Shift\+)?(\d)$/

const digitOf = (row: KeyRow): number | null => {
  const match = NUMBER.exec(row.keys)
  // 1 … 9 then 0, the keyboard's order; a digit's Shift chord right after the digit's own.
  return match ? (match[2] === "0" ? 10 : Number(match[2])) * 2 + (match[1] ? 1 : 0) : null
}

export function cellKeysTitle(platform: string): string {
  return `Cell Types — ${platform === "darwin" ? "Cmd" : "Ctrl"} (+Shift) + a Number`
}

/** The groups with every number key taken out of its menu and put first, in one group, in keyboard order. */
export function withNumberKeysFirst(groups: KeyGroup[], platform: string): KeyGroup[] {
  const numbers: { row: KeyRow; digit: number }[] = []
  const rest = groups
    .map((group) => ({
      menu: group.menu,
      rows: group.rows.filter((row) => {
        const digit = digitOf(row)
        if (digit === null) return true
        numbers.push({ row, digit })
        return false
      }),
    }))
    .filter((group) => group.rows.length > 0)
  if (numbers.length === 0) return rest
  numbers.sort((a, b) => a.digit - b.digit)
  return [{ menu: cellKeysTitle(platform), rows: numbers.map((n) => n.row) }, ...rest]
}

// MARK: - Searching the list

/** Lower case, no accents: "Cafe" finds "café", "CMD" finds "Cmd". */
const fold = (text: string): string => text.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase()

/** The words a person may type for a modifier, on top of what the chord prints: ⌘ is also "command". */
const ALIASES: Record<string, string> = { Ctrl: "control ctrl ⌃", Alt: "option opt alt ⌥", Shift: "shift ⇧", Cmd: "command cmd ⌘" }

/** Everything a row can be found by: its name, its menu, its chord as words and as caps, the words for its modifiers. */
function haystack(menu: string, row: KeyRow, platform: string): string {
  const { modifiers } = chordParts(row.keys)
  return fold([menu, row.name, row.keys, ...chordCaps(row.keys, platform), ...modifiers.map((name) => ALIASES[name] ?? name)].join(" "))
}

/**
 * The key list narrowed to a query: every word of it (split on spaces) must be somewhere in the row's name, its menu or
 * its chord ("save", "cmd shift", "⌥", "undo"), case and accents aside. A word that is only the chord's own plus signs
 * ("cmd+s") is read as its parts. An empty query is the whole list; a group with no row left goes.
 */
export function searchKeys(groups: KeyGroup[], query: string, platform: string): KeyGroup[] {
  const words = fold(query).split(/[\s+]+/).filter((word) => word.length > 0)
  if (words.length === 0) return groups
  return groups
    .map((group) => ({ menu: group.menu, rows: group.rows.filter((row) => {
      const text = haystack(group.menu, row, platform)
      return words.every((word) => text.includes(word))
    }) }))
    .filter((group) => group.rows.length > 0)
}
