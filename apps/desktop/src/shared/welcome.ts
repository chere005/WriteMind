/**
 * THE QUICK REFERENCE, the first note a new install opens (Sean, 2026-10-05: "have the brief summary of feature and
 * keystrokes be the first thing that open on a new install"). `main/welcome.ts` writes it, once, into an empty notes
 * folder; this file is only its text.
 *
 * The feature list is written here and is kept to what is built. The keys are NOT written here: each row names
 * commands of `commands.ts` and its chords are `acceleratorFor()` of them, the source the menu bar and the key
 * handler read, so a key that moves moves here too. `test/welcome.test.ts` holds every row to a command that has a
 * key, and the one row that is not a menu command (Shift+Enter runs a cell) to the editor keymap that binds it.
 */

import { HEADING_LADDER, headingName } from "@writemind/core"
import { HEADING_COMMANDS, acceleratorFor } from "./commands"

/** The file it is written as, in the notes folder's top level. */
export const WELCOME_FILE = "WriteMind Quick Reference.wm"

/** What the app has, in a line or two each: Sean's approved note, kept to what is built. */
export const WELCOME_FEATURES: string[] = [
  "**Cells:** text, markdown, headings, lists, code, runnable code, maths, tables and drawings; the bar between cells adds one.",
  "**Maths cells:** Ctrl+9 makes one, or turns a cell's words into one; Wolfram Language, typeset when the caret leaves.",
  "**Rendered page:** Ctrl+T shows the note as a finished page you can still type in.",
  "**Drawing:** pen ink, shapes, arrows and pictures over the note; the ⤵ handle docks them into it as cells.",
  "**Runnable cells:** Python, Wolfram, C, C++ and Rust, with In[n] / Out[n]; Shift+Enter runs one.",
  "**Video pane:** a document camera or the Wacom tablet's sheets (tabs); bring writing in as ink, a picture or a drawing cell.",
  "**Wacom pen buttons:**\n" +
    "  - First button (Middle Click): hold to erase strokes, double-tap to undo.\n" +
    "  - Second button (Right Click): hold to select, double-tap to redo.\n" +
    "  - Set the first button to Middle Click in Wacom Tablet Properties ▸ Pen (on Pan/Scroll the driver keeps it).",
]

/**
 * One row of the keys table. `ids` are commands (`commands.ts`); `range` shows the first and the last ("Ctrl+1 …
 * Ctrl+7"), `short` drops the shared modifiers after the first ("Ctrl+B / I / U"). `editorKey` is a key the
 * editor's own keymap binds and no menu shows, in CodeMirror's spelling ("Shift-Enter").
 */
export interface WelcomeKey { what: string; ids?: string[]; range?: boolean; short?: boolean; editorKey?: string }

const headingId = (level: number): string => HEADING_COMMANDS.find((one) => one.level === level)!.id

/** A group of rows in the keys table, under a title row of its own. */
export interface WelcomeGroup { title: string; keys: WelcomeKey[] }

/**
 * The most important keys, grouped as Sean's approved note is (2026-10-05: "group the ctrl/cmd + 1-0 keystrokes"): the
 * number keys that make cells first, in keyboard order (the heading ladder down to 7 Text, Shift+7 Markdown, 8 Code
 * block, Shift+8 Runnable code, 9 Maths cell, 0 Drawing cell: docs/PLAN-text-cells.md), then Notes, View, Editing and Help. The F1
 * list groups them the same way (keyGroups.ts).
 */
export const WELCOME_GROUPS: WelcomeGroup[] = [
  {
    title: "Cell types — Ctrl / ⌘ (+ Shift) + a number",
    keys: [
      ...HEADING_LADDER.map((level, index) => ({ what: `${index + 1} ${headingName(level)}`, ids: [headingId(level)] })),
      // docs/PLAN-text-cells.md: 7 plain Text, Shift+7 its markdown twin; 8 Code block, Shift+8 Runnable code; 9 Maths;
      // 0 Drawing.
      { what: "Shift+7 Markdown", ids: ["markdownCell"] },
      { what: "8 Code block", ids: ["codeBlock"] },
      { what: "Shift+8 Runnable code", ids: ["evaluationCell"] },
      { what: "9 Maths cell", ids: ["mathsCell"] },
      { what: "0 Drawing cell", ids: ["insertInkCell"] },
    ],
  },
  {
    title: "Notes",
    keys: [
      { what: "New note", ids: ["newNote"] },
      { what: "Save", ids: ["save"] },
      { what: "Close tab", ids: ["closeTab"] },
      { what: "Export", ids: ["export"] },
      { what: "Undo / Redo", ids: ["undo", "redo"] },
      { what: "Find / Replace", ids: ["find", "findReplace"] },
    ],
  },
  {
    title: "View",
    keys: [
      { what: "Show / hide sidebar", ids: ["toggleSidebar"] },
      { what: "Markdown ⇄ rendered page", ids: ["toggleMode"] },
      { what: "Show / hide video", ids: ["toggleCamera"] },
      { what: "Pen down / up", ids: ["togglePen"] },
      { what: "Fold / unfold all sections", ids: ["foldAll", "unfoldAll"], short: true },
    ],
  },
  {
    title: "Editing",
    keys: [
      { what: "Bold / Italic / Underline", ids: ["bold", "italic", "underline"], short: true },
      { what: "List", ids: ["list"] },
      { what: "Indent / Outdent", ids: ["indent", "outdent"] },
      { what: "Split / Merge cell", ids: ["splitCell", "mergeCells"] },
      { what: "Move cell up / down", ids: ["moveCellUp", "moveCellDown"], short: true },
      { what: "Move section up / down", ids: ["moveSectionUp", "moveSectionDown"], short: true },
      // Not a menu key: an accelerator would take Shift+Enter from every field (commands.ts); packages/editor/src/eval binds it.
      { what: "Run the cell", editorKey: "Shift-Enter" },
      { what: "Insert image", ids: ["insertImage"] },
      { what: "Maths palette", ids: ["insertMath"] },
    ],
  },
  { title: "Help", keys: [{ what: "Every key", ids: ["keyList"] }] },
]

/** Every key row, in table order. */
export const WELCOME_KEYS: WelcomeKey[] = WELCOME_GROUPS.flatMap((group) => group.keys)

/** A group's title row: bold, alone in the first column. */
export const groupTitleCell = (title: string): string => `**${title}**`

const GLYPHS: Record<string, string> = { up: "↑", down: "↓", left: "←", right: "→" }
const MAC_KEYS: Record<string, string> = { enter: "↩", return: "↩", ...GLYPHS }
/** The Mac's modifier order (⌃⌥⇧⌘), as its menus draw a chord. */
const MAC_MODS: [string[], string][] = [
  [["ctrl", "control"], "⌃"], [["alt", "option"], "⌥"], [["shift"], "⇧"], [["cmd", "command", "cmdorctrl", "commandorcontrol", "mod", "meta"], "⌘"],
]

interface Chord { mods: string; key: string }

/** An accelerator ("CmdOrCtrl+Shift+Up", or CodeMirror's "Shift-Enter") as a person reads it on one platform. */
export function chordFor(accelerator: string, mac: boolean): Chord {
  const parts = accelerator.split(/(?<=.)[+-](?=.)/)
  const key = parts.pop()!
  const lower = parts.map((part) => part.toLowerCase())
  if (mac) {
    const mods = MAC_MODS.filter(([names]) => names.some((name) => lower.includes(name))).map(([, glyph]) => glyph).join("")
    const named = MAC_KEYS[key.toLowerCase()]
    return { mods, key: named ?? (key.length === 1 ? key.toUpperCase() : key) }
  }
  const mods = parts.map((part) => (/^(cmdorctrl|commandorcontrol|control|mod)$/i.test(part) ? "Ctrl" : part))
  return { mods: mods.map((one) => `${one}+`).join(""), key: GLYPHS[key.toLowerCase()] ?? (key.length === 1 ? key.toUpperCase() : key) }
}

/** One row's keys on one platform: "Ctrl+Z / Ctrl+Y", "Ctrl+1 … Ctrl+7", "⌘B / I / U"; "—" when it has none there. */
export function welcomeKeys(row: WelcomeKey, mac: boolean): string {
  const platform = mac ? "darwin" : "win32"
  const accelerators = row.editorKey ? [row.editorKey] : (row.ids ?? []).map((id) => acceleratorFor(id, platform) ?? "")
  if (accelerators.length === 0 || accelerators.some((one) => !one)) return "—"
  const chords = accelerators.map((one) => chordFor(one, mac))
  const whole = (chord: Chord) => chord.mods + chord.key
  if (row.range) return `${whole(chords[0]!)} … ${whole(chords[chords.length - 1]!)}`
  if (row.short && chords.every((chord) => chord.mods === chords[0]!.mods)) {
    return [whole(chords[0]!), ...chords.slice(1).map((chord) => chord.key)].join(" / ")
  }
  return chords.map(whole).join(" / ")
}

/** A table cell: a pipe in it would end the cell. */
const cell = (text: string): string => text.replace(/\|/g, "\\|")

/**
 * The keys as a markdown pipe table: What | Windows | Mac. Its columns are padded to one width, so the markdown pane
 * (a monospaced grid, never re-padded) shows them lined up as Sean's note did; the rendered page draws a real table.
 */
export function welcomeKeyTable(): string {
  const lines = [
    ["What", "Windows", "Mac"],
    ...WELCOME_GROUPS.flatMap((group) => [
      [groupTitleCell(cell(group.title)), "", ""],
      ...group.keys.map((row) => [row.what, welcomeKeys(row, false), welcomeKeys(row, true)].map(cell)),
    ]),
  ]
  const widths = [0, 1, 2].map((column) => Math.max(...lines.map((one) => [...one[column]!].length)))
  const pad = (text: string, column: number) => text + " ".repeat(widths[column]! - [...text].length)
  const row = (cells: string[]) => `| ${cells.map(pad).join(" | ")} |`
  return [row(lines[0]!), `|${widths.map((width) => "-".repeat(width + 2)).join("|")}|`, ...lines.slice(1).map(row)].join("\n")
}

/** The whole note. */
export function welcomeNote(): string {
  return [
    "# WriteMind Quick Reference",
    "",
    "## Features",
    "",
    ...WELCOME_FEATURES.map((one) => `- ${one}`),
    "",
    "## Most important keys",
    "",
    welcomeKeyTable(),
    "",
  ].join("\n")
}
