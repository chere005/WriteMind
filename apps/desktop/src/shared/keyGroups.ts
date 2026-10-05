/**
 * The Keyboard Shortcuts list (F1) shows the ten number keys together, first: Ctrl / ⌘ + 1 … 9, 0 make the cells (Title …
 * Body Text, Code Block, Evaluation Cell, Drawing Cell), and they are scattered over the Format and Insert menus otherwise.
 * Sean, 2026-10-05: "group the ctrl/cmd + 1-0 keystrokes", in his quick reference and in this list. Pure: the rows still
 * come from the one key table (keyList.ts); only their order and grouping change here.
 */

import type { KeyGroup, KeyRow } from "./keyList"

/** A chord that is the command key and one digit, alone: "Ctrl+7" on a PC, "Cmd+7" on a Mac (commands.ts `shown`). */
const NUMBER = /^(?:Ctrl|Cmd)\+(\d)$/

const digitOf = (row: KeyRow): number | null => {
  const match = NUMBER.exec(row.keys)
  return match ? Number(match[1]) : null
}

/** 1 … 9, then 0: the keyboard's own order. */
const place = (digit: number): number => (digit === 0 ? 10 : digit)

export function cellKeysTitle(platform: string): string {
  return `Cell Types — ${platform === "darwin" ? "Cmd" : "Ctrl"} + a Number`
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
  numbers.sort((a, b) => place(a.digit) - place(b.digit))
  return [{ menu: cellKeysTitle(platform), rows: numbers.map((n) => n.row) }, ...rest]
}
