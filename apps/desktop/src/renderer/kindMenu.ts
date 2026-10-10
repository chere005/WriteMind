/**
 * THE ONE LIST OF CELL KINDS (kindMenu.ts): the toolbar's Style menu and the seam's + open this same menu, so what a person
 * can make is said once. (The wireframes: docs/ui-2026-10/FinalToolbar.png.) The levels are shown each in its
 * own style, the lists and the quote have their own group, and the cells that are not text come last. Picking
 * an entry calls `onPick` with the COMMAND to run (the same ids the menu bar and the keys use, shared/commands.ts),
 * so a click and a key are one function.
 */

import { headingName, listTitle, sameKind, type CellKind, type Heading, type ListStyle } from "@writemind/core"
import type { CSSProperties } from "react"
import { shown } from "../shared/commands"
import type { MenuItem } from "./FloatingMenu"
import type { IconName } from "./icons"

/** What picking an entry runs. `listStyle` is set for the lists (the list button writes the style last picked). */
export interface KindPick {
  command: string
  listStyle?: ListStyle
}

/** What the caret's cell is, for the check mark and the Style button's label: a kind, or the runnable code cell. */
export type CurrentKind = CellKind | null

interface Entry extends KindPick {
  label: string
  icon?: IconName
  style?: CSSProperties
  kind: CellKind | { kind: "evaluation" }
}

const LEVELS: { level: Heading; style: CSSProperties }[] = [
  { level: 1, style: { fontSize: 16, fontWeight: 700 } },
  { level: 2, style: { fontSize: 14.5, fontWeight: 700 } },
  { level: 6, style: { fontStyle: "italic" } },
  { level: 3, style: { fontSize: 13.5, fontWeight: 700 } },
  { level: 4, style: { fontWeight: 600 } },
  { level: 5, style: { fontWeight: 600, opacity: 0.8 } },
]

const LISTS: ListStyle[] = ["dots", "dashes", "numbered", "todo"]

/** The text rungs, the lists, then the cells — the order the menu is drawn in. */
export function kindEntries(): { text: Entry; levels: Entry[]; lists: Entry[]; cells: Entry[] } {
  return {
    text: { label: headingName(0), command: "heading:0", kind: { kind: "text" } },
    levels: LEVELS.map(({ level, style }) => ({
      label: headingName(level), command: `heading:${level}`, style, kind: { kind: "heading", level },
    })),
    lists: [
      ...LISTS.map((style): Entry => ({
        label: listTitle(style), command: "list", listStyle: style, icon: "list", kind: { kind: "list", style },
      })),
      { label: "Quote", command: "quote", icon: "quote", kind: { kind: "quote" } },
    ],
    cells: [
      { label: "Markdown", command: "markdownCell", icon: "doc", kind: { kind: "markdown" } },
      { label: "Code", command: "codeBlock", icon: "code", kind: { kind: "code" } },
      { label: "Runnable code", command: "evaluationCell", icon: "code", kind: { kind: "evaluation" } },
      { label: "Maths", command: "mathsCell", icon: "math", kind: { kind: "maths" } },
      { label: "Drawing", command: "insertInkCell", icon: "drawcell", kind: { kind: "ink" } },
    ],
  }
}

const same = (a: CurrentKind, b: CellKind | { kind: "evaluation" }): boolean => {
  if (!a) return false
  if (b.kind === "evaluation") return a.kind === "evaluation"
  if (a.kind === "evaluation") return false
  return sameKind(a, b)
}

/** The words the Style button shows for the caret's cell. */
export function kindLabel(current: CurrentKind): string {
  if (!current) return headingName(0)
  const all = kindEntries()
  const hit = [all.text, ...all.levels, ...all.lists, ...all.cells].find((entry) => same(current, entry.kind))
  return hit?.label ?? headingName(0)
}

/** The menu: the entries with their keys, the caret's own checked. */
export function kindMenuItems(platform: string, current: CurrentKind, onPick: (pick: KindPick) => void): MenuItem[] {
  const all = kindEntries()
  const item = (entry: Entry): MenuItem => ({
    label: entry.label,
    icon: entry.icon,
    checked: same(current, entry.kind),
    labelStyle: entry.style,
    hint: shown(entry.command === "list" && entry.listStyle !== "dots" ? "" : entry.command, platform) || undefined,
    dataBar: `kind-${entry.kind.kind}${"level" in entry.kind ? `-${entry.kind.level}` : "style" in entry.kind ? `-${entry.kind.style}` : ""}`,
    onClick: () => onPick({ command: entry.command, listStyle: entry.listStyle }),
  })
  return [
    item(all.text), "-",
    ...all.levels.map(item), "-",
    { header: "Lists" }, ...all.lists.map(item), "-",
    { header: "Cells" }, ...all.cells.map(item),
  ]
}

/**
 * The cell kind a pick makes, for the seam's + (it opens a cell of that kind at the bar). null for the pick the app
 * makes by itself: Runnable code (which environment is the notebook's own preference) — the caller asks the editor.
 */
export function kindOfPick(pick: KindPick): CellKind | null {
  const all = kindEntries()
  const entry = [all.text, ...all.levels, ...all.lists, ...all.cells]
    .find((one) => one.command === pick.command && one.listStyle === pick.listStyle)
  return entry && entry.kind.kind !== "evaluation" ? entry.kind as CellKind : null
}
