/**
 * EVERY KEY, IN ONE LIST: Help ▸ Keyboard Shortcuts (F1) shows this, and
 * `docs/KEYS.md`'s first table is this, row for row. The Mac's README table
 * and its `Shortcut` enum (2026-09-21, Sean: "document the keystrokes in the
 * readme"; "unless there's conflicts with those?").
 *
 * Nothing here chooses a key: each row's chord is `shown()` from the one
 * command table (`commands.ts`), the same one the menu bar shows and the key
 * handler matches, so a key that moves moves here too. What this file adds is
 * only the grouping by menu and a name for the toggles that the menu words
 * by their state. `test/keyList.test.ts` holds the groups to the menu bar
 * (`main/menu.ts`) and the rows to `docs/KEYS.md`, so neither can drift.
 */

import { HEADING_LADDER, headingName } from "@writemind/core"
import { HEADING_COMMANDS, commandById, shown } from "./commands"

/** The menus, in the bar's order, and the commands in each, in the menu's order. */
export const KEY_MENUS: { menu: string; ids: string[] }[] = [
  { menu: "File", ids: ["newNote", "closeTab", "openFolder", "save", "export"] },
  { menu: "Project", ids: ["addFolder", "saveProject", "saveProjectAs", "openProject", "newProject"] },
  {
    menu: "Edit",
    ids: [
      "undo", "redo", "undoDrawing", "redoDrawing", "expandSelection", "selectNext", "selectAll",
      "find", "findReplace", "findNext", "findPrevious", "useSelectionForFind", "jumpToSelection",
    ],
  },
  {
    menu: "View",
    ids: [
      "toggleSidebar", "toggleMode", "toggleCamera", "togglePen", "toggleEditorPane", "toggleMarkers",
      "collapseSubsections", "foldAll", "unfoldAll",
    ],
  },
  {
    menu: "Format",
    ids: [
      ...HEADING_LADDER.map((level) => HEADING_COMMANDS.find((h) => h.level === level)!.id),
      "bold", "italic", "underline", "strike", "list", "quote", "outdent", "indent",
      "splitCell", "mergeCells", "duplicateCell", "evaluationCell", "deleteCell", "moveCellUp", "moveCellDown",
      "moveSectionUp", "moveSectionDown",
    ],
  },
  { menu: "Insert", ids: ["insertImage", "insertTextBox", "insertMath", "codeBlock", "insertInkCell"] },
  {
    menu: "Pen",
    ids: [
      "penToggle", "penErase", "penSelect", "penAlwaysDraws", "penNextColour", "penPrevColour", "penWider",
      "penThinner", "penDelete", "penClearSelection", "penSendWriting", "penSendPage", "penClearSheet",
      "penNextSheet", "penPrevSheet",
    ],
  },
  { menu: "Input Devices", ids: ["cameraOff", "cameraRefresh"] },
  { menu: "Help", ids: ["keyList"] },
]

/** The toggles, named for both of their states (the menu shows one at a time). */
const NAMES: Record<string, string> = {
  toggleSidebar: "Show / Hide Notes Sidebar",
  toggleMode: "Markdown Preview / Editor",
  toggleCamera: "Show / Hide Video",
  togglePen: "Draw / Stop Drawing",
  toggleEditorPane: "Show / Hide Notes Pane",
  toggleMarkers: "Show / Hide Markdown Markers",
  penToggle: "Pen Down / Up",
}

/** What a row calls its command. */
export function keyName(id: string): string {
  const heading = HEADING_COMMANDS.find((h) => h.id === id)
  if (heading) return headingName(heading.level as Parameters<typeof headingName>[0])
  return NAMES[id] ?? commandById(id)?.label ?? id
}

export interface KeyRow { id: string; name: string; keys: string }
export interface KeyGroup { menu: string; rows: KeyRow[] }

/** Every chord bound on `platform`, grouped by the menu its command is in. A command with no key is not listed. */
export function keyList(platform: string): KeyGroup[] {
  return KEY_MENUS
    .map(({ menu, ids }) => ({
      menu,
      rows: ids
        .map((id) => ({ id, name: keyName(id), keys: shown(id, platform) }))
        .filter((row) => row.keys.length > 0),
    }))
    .filter((group) => group.rows.length > 0)
}
