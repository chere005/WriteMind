/**
 * The Keyboard Shortcuts list (F1) shows the number keys together, first: Ctrl / ⌘ (+ Shift) + 1 … 9 make the cells
 * (Title … Text, Markdown, Code Block, Evaluation Cell, Drawing Cell), and they are scattered over the Format and Insert
 * menus otherwise. Sean, 2026-10-05: "group the ctrl/cmd + 1-0 keystrokes", in his quick reference and in this list; and
 * the same day the Shift row joined it (docs/PLAN-text-cells.md: Ctrl+Shift+7 Markdown, Ctrl+Shift+8 Runnable code).
 * Pure: the rows still come from the one key table (keyList.ts); only their order and grouping change here.
 */

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
