/**
 * THE COMMANDS, once: the menu bar, the tooltips and the key handler all read
 * this table, so a key shown is a key that works and a key that works is
 * shown. Nothing here knows about Electron or React; the main process builds
 * the application menu from it and the page matches key events against it.
 *
 * WHO HEARS THE KEY. A menu accelerator is DISPLAYED and never registered
 * (`registerAccelerator: false`), because a registered one is a second
 * listener beside the page's own and one press would then be two actions.
 * Instead each command names its `owner`:
 *
 *  - "editor"  CodeMirror's keymap hears it (`packages/editor/src/keys.ts`,
 *              `extras.ts`); the page's handler leaves it alone.
 *  - "history" `useUndo` hears it (the words and the drawing share one Undo).
 *  - "page"    `useChrome` hears it, in the page.
 *  - "main"    `useChrome` hears it and hands it to the main process (a
 *              dialog, the project file).
 *
 * THE MAPPING FROM THE MAC. ⌘ becomes Ctrl. The Mac's ⌃ shortcuts keep what
 * the editor already used on Windows (⌃D split, ⌃M merge, ⌃⇧D duplicate,
 * ⌃⇧↑/↓ move cell) — except where Ctrl alone would collide with Windows:
 * the ⌥⌘ chords (refresh, drawing undo, folding) become Ctrl+Alt, and ⌘Y
 * (the video) is Ctrl+Shift+Y because Ctrl+Y is Redo on a PC.
 *
 * ONE LIST OF EVERY KEY (the Mac's `Shortcut`, 2026-09-21: Sean asked for
 * ⌘S, ⌘P, ⌘E, ⌘T, ⌘Y, ⌘K and ⌘; "unless there's conflicts with those?"):
 * this table is it. `test/keyList.test.ts` holds it to the rule that no two
 * commands want one chord, that the editor's keymaps bind no menu chord
 * outside it, and that `docs/KEYS.md` and Help ▸ Keyboard Shortcuts
 * (`shared/keyList.ts`) list exactly these keys.
 */

export type Owner = "editor" | "history" | "page" | "main"

export interface CommandDef {
  id: string
  /** The menu's wording; a few are toggles and the menu rewrites them. */
  label: string
  /** Electron accelerator syntax; `CmdOrCtrl` is Ctrl here and ⌘ on a Mac. */
  key?: string
  /** What a Mac shows when it is not the same as `key` (a ⌃⌘ chord). */
  macKey?: string
  owner: Owner
}

const c = (id: string, label: string, owner: Owner, key?: string, macKey?: string): CommandDef =>
  ({ id, label, owner, ...(key ? { key } : {}), ...(macKey ? { macKey } : {}) })

/** The heading ladder, in the Mac's order: Title, Chapter, Author, Section, … Body. */
export const HEADING_COMMANDS: { level: number; id: string; key: string }[] =
  [1, 2, 6, 3, 4, 5, 0].map((level, index) => ({ level, id: `heading:${level}`, key: `CmdOrCtrl+${index + 1}` }))

export const COMMANDS: CommandDef[] = [
  // File
  c("newNote", "New Note", "page", "CmdOrCtrl+N"),
  c("closeTab", "Close Tab", "page", "CmdOrCtrl+W"),
  c("openFolder", "Open Notes Folder", "page", "CmdOrCtrl+Shift+O"),
  // ⌘S, the key every app has: what is pending (the note and its drawing) is written now.
  c("save", "Save", "page", "CmdOrCtrl+S"),
  // One command; PDF or Project is chosen in the save panel (main/exportFile.ts).
  c("export", "Export…", "page", "CmdOrCtrl+E"),
  // Project
  c("addFolder", "Add Folder to Project…", "main", "CmdOrCtrl+Shift+A"),
  // ⇧⌘S on the Mac too, since 2026-09-21: ⌃⌘S was the sidebar's as well, and
  // a chord claimed twice goes to the first menu, so this one could not be pressed.
  c("saveProject", "Save Project", "main", "CmdOrCtrl+Shift+S"),
  c("saveProjectAs", "Save Project As…", "main"),
  c("openProject", "Open Project…", "main"),
  c("newProject", "New Project", "main"),
  // Edit
  c("undo", "Undo", "history", "CmdOrCtrl+Z"),
  c("redo", "Redo", "history", "Ctrl+Y", "Shift+Cmd+Z"),
  c("undoDrawing", "Undo Drawing", "page", "CmdOrCtrl+Alt+Z"),
  c("redoDrawing", "Redo Drawing", "page", "CmdOrCtrl+Alt+Shift+Z"),
  c("expandSelection", "Expand Selection", "page", "CmdOrCtrl+."),
  c("selectNext", "Select Next Occurrence", "editor", "Alt+D"),
  c("selectAll", "Select All Occurrences", "editor", "Alt+Shift+D"),
  // Find (the Mac's text view has a find bar: usesFindBar): ⌘F, ⌘G / ⇧⌘G, ⌘E, ⌥⌘F, ⌘J.
  c("find", "Find…", "page", "CmdOrCtrl+F"),
  c("findReplace", "Find and Replace…", "page", "CmdOrCtrl+H", "Alt+Cmd+F"),
  // F3 / Shift+F3 here: Ctrl+G is Group on the drawing layer (the Mac's ⌃G; its find next is ⌘G, which is Ctrl on a PC).
  c("findNext", "Find Next", "page", "F3", "Cmd+G"),
  c("findPrevious", "Find Previous", "page", "Shift+F3", "Shift+Cmd+G"),
  // No key: Ctrl+E is Export (Sean's ⌘E, 2026-09-21).
  c("useSelectionForFind", "Use Selection for Find", "page"),
  c("jumpToSelection", "Jump to Selection", "page", "CmdOrCtrl+J"),
  // View. ⌘K, ⌘T, ⌘Y, ⌘P (Sean, 2026-09-21), MOVED rather than added: two keys
  // for one action is two things to remember and one of them always the wrong one.
  c("toggleSidebar", "Hide Notes Sidebar", "page", "CmdOrCtrl+K"),
  c("toggleMode", "Show Markdown Preview", "page", "CmdOrCtrl+T"),
  c("toggleCamera", "Hide Video", "page", "CmdOrCtrl+Shift+Y", "Cmd+Y"),
  // The pen goes up or comes down: the same writer as Pen ▸ Pen Down (Ctrl+Alt+1, the ExpressKeys' chord).
  c("togglePen", "Draw", "page", "CmdOrCtrl+P"),
  // No key on these two (Sean, 2026-09-21: "get rid of ^cmd+e and opt+cmd+m"); the commands stay.
  c("toggleEditorPane", "Hide Notes Pane", "page"),
  c("toggleMarkers", "Show Markdown Markers", "page"),
  // ⌘; folds what is UNDER the cells in play, never the cell itself; one key both ways.
  // It replaces the caret's own Fold / Unfold Section keys (⌥⌘← / ⌥⌘→), which are gone.
  c("collapseSubsections", "Collapse Subsections", "page", "CmdOrCtrl+;"),
  c("foldAll", "Fold All Sections", "page", "CmdOrCtrl+Alt+Shift+Left", "Alt+Shift+Cmd+Left"),
  c("unfoldAll", "Unfold All Sections", "page", "CmdOrCtrl+Alt+Shift+Right", "Alt+Shift+Cmd+Right"),
  // Format
  ...HEADING_COMMANDS.map((h) => c(h.id, "", "editor", h.key)),
  // Ctrl+7 is the ladder's last rung, Text (a plain-text cell); Ctrl+Shift+7 its markdown twin (docs/PLAN-text-cells.md).
  c("markdownCell", "Markdown", "editor", "CmdOrCtrl+Shift+7"),
  c("bold", "Bold", "editor", "CmdOrCtrl+B"),
  c("italic", "Italic", "editor", "CmdOrCtrl+I"),
  c("underline", "Underline", "editor", "CmdOrCtrl+U"),
  c("strike", "Strikethrough", "editor", "CmdOrCtrl+Shift+X"),
  c("list", "List", "editor", "CmdOrCtrl+Shift+L"),
  c("quote", "Quote", "editor", "Ctrl+Q", "Ctrl+Cmd+Q"),
  c("outdent", "Decrease Indentation", "editor", "CmdOrCtrl+["),
  c("indent", "Increase Indentation", "editor", "CmdOrCtrl+]"),
  c("splitCell", "Split Cell", "editor", "Ctrl+D"),
  c("mergeCells", "Merge Cells", "editor", "Ctrl+M"),
  c("duplicateCell", "Duplicate Cell", "editor", "Ctrl+Shift+D"),
  // The Mac's ⌘9: an evaluation cell (main/eval runs it; Shift+Enter in the cell, which is NOT a menu key — an
  // accelerator would take Shift+Enter from every field in the app). Ctrl+Shift+8 here, beside Ctrl+8 Code Block
  // (Sean, 2026-10-05: "ctrl + shift + 8 runnable code"; docs/PLAN-text-cells.md).
  c("evaluationCell", "Evaluation Cell", "editor", "CmdOrCtrl+Shift+8"),
  // No key (Sean, 2026-09-21: "backspace is enough to delete the selected cell so no need for ^+backspace").
  c("deleteCell", "Delete Cell", "editor"),
  c("moveCellUp", "Move Cell Up", "editor", "Ctrl+Shift+Up"),
  c("moveCellDown", "Move Cell Down", "editor", "Ctrl+Shift+Down"),
  c("moveSectionUp", "Move Section Up", "editor", "Ctrl+Up", "Ctrl+Cmd+Up"),
  c("moveSectionDown", "Move Section Down", "editor", "Ctrl+Down", "Ctrl+Cmd+Down"),
  // Insert
  c("insertImage", "Image…", "page", "CmdOrCtrl+Shift+I"),
  c("insertTextBox", "Text Box", "page"),
  // The toolbar's Table button (docs/PLAN-bars-2026-10.md P1): an empty two-column table as a cell of its own. No key
  // (Sean, 2026-10-10: the inserts are buttons); the editor's own table keys (Tab, Return) take over inside it.
  c("insertTable", "Table", "editor"),
  // Port-only key: the Mac opens the maths popover from the bar only.
  c("insertMath", "Maths…", "page", "CmdOrCtrl+Shift+M"),
  c("codeBlock", "Code Block", "editor", "CmdOrCtrl+8"),
  // A maths cell, the ```wl fence typeset when the caret leaves it (Sean, 2026-10-06: "ctrl + 7 should be PURELY
  // plaintext.. so clearly we need a math cell type.. that should be ctrl + 9"). Port-only: the Mac's ⌘9 is its
  // evaluation cell (Ctrl+Shift+8 here).
  c("mathsCell", "Maths Cell", "editor", "CmdOrCtrl+9"),
  // An empty ink cell (docs\PLAN-docking-ink-cells.md): at the armed bar, else after the caret's cell. Port-only;
  // Ctrl+0 (Sean, 2026-10-06: "make ctrl + 10 drawing cells"; it was Ctrl+9 for a day, and Ctrl+0 before that).
  c("insertInkCell", "Drawing Cell", "page", "CmdOrCtrl+0"),
  // Pen (port-only): the tablet's ExpressKeys type these. Ctrl+Alt+digit and
  // a few Ctrl+Alt+letters, none of which anything else uses.
  c("penToggle", "Pen Down", "page", "CmdOrCtrl+Alt+1"),
  c("penErase", "Erase Tool", "page", "CmdOrCtrl+Alt+2"),
  c("penSelect", "Select Tool", "page", "CmdOrCtrl+Alt+3"),
  c("penNextColour", "Next Colour", "page", "CmdOrCtrl+Alt+4"),
  c("penPrevColour", "Previous Colour", "page", "CmdOrCtrl+Alt+5"),
  c("penWider", "Wider Line", "page", "CmdOrCtrl+Alt+6"),
  c("penThinner", "Thinner Line", "page", "CmdOrCtrl+Alt+7"),
  c("penAlwaysDraws", "Pen Always Draws", "page", "CmdOrCtrl+Alt+8"),
  c("penDelete", "Delete Selection", "page", "CmdOrCtrl+Alt+9"),
  c("penClearSelection", "Clear Selection", "page", "CmdOrCtrl+Alt+0"),
  c("penSendWriting", "Send Writing", "page", "CmdOrCtrl+Alt+W"),
  c("penSendPage", "Send Page", "page", "CmdOrCtrl+Alt+Shift+W"),
  c("penClearSheet", "Clear Sheet", "page", "CmdOrCtrl+Alt+X"),
  // The tablet's sheets are tabs; the hand without the pen changes sheet (the pen cannot reach the tabs: the whole tablet is the sheet).
  c("penNextSheet", "Next Sheet", "page", "CmdOrCtrl+Alt+PageDown"),
  c("penPrevSheet", "Previous Sheet", "page", "CmdOrCtrl+Alt+PageUp"),
  // Input Devices
  c("cameraOff", "Turn Camera Off", "page"),
  c("cameraRefresh", "Refresh Device List", "page", "CmdOrCtrl+Alt+R", "Alt+Cmd+R"),
  // Help: every key in one list (shared/keyList.ts). F1 is a PC's help key; the Mac's is ⌘?.
  c("keyList", "Keyboard Shortcuts", "page", "F1", "Shift+Cmd+/"),
  // The Quick Reference note (shared/welcome.ts, main/welcome.ts): written or brought up to date, opened, shown rendered.
  // No key (Help's own item, as About and Check for Updates are): so the key list, which lists keys, does not name it.
  c("quickReference", "Quick Reference", "page"),
]

const byId = new Map(COMMANDS.map((command) => [command.id, command]))
export const commandById = (id: string): CommandDef | undefined => byId.get(id)

/** The accelerator a menu item carries for this platform. */
export function acceleratorFor(id: string, platform: string): string | undefined {
  const command = byId.get(id)
  if (!command) return undefined
  return platform === "darwin" ? command.macKey ?? command.key : command.key
}

/** "CmdOrCtrl+Alt+S" as a person reads it: "Ctrl+Alt+S" here, "⌥⌘S" is the Mac's own business. */
export function shown(id: string, platform: string): string {
  const key = acceleratorFor(id, platform)
  if (!key) return ""
  return key.replace(/CmdOrCtrl|CommandOrControl/g, platform === "darwin" ? "Cmd" : "Ctrl")
}

// MARK: - Matching a key event

export interface KeyLike {
  key: string
  /** The physical key (`KeyboardEvent.code`): Ctrl+Alt is AltGr on some layouts and changes `key`. */
  code?: string
  ctrlKey: boolean
  metaKey: boolean
  altKey: boolean
  shiftKey: boolean
}

interface Chord { mod: boolean; cmd: boolean; ctrl: boolean; alt: boolean; shift: boolean; key: string }

const NAMED: Record<string, string> = {
  left: "arrowleft", right: "arrowright", up: "arrowup", down: "arrowdown",
}

function parse(accelerator: string): Chord {
  const parts = accelerator.split("+")
  const key = parts.pop()!.toLowerCase()
  const has = (name: string) => parts.some((part) => part.toLowerCase() === name)
  return {
    mod: has("cmdorctrl") || has("commandorcontrol"),
    cmd: has("cmd") || has("command") || has("meta"),
    ctrl: has("ctrl") || has("control"),
    alt: has("alt"),
    shift: has("shift"),
    key: NAMED[key] ?? key,
  }
}

/**
 * Whether a key event is this accelerator. `Mod` is Ctrl off a Mac and ⌘ on
 * one; every modifier must match exactly, so Ctrl+Z is not Ctrl+Alt+Z.
 */
export function matches(event: KeyLike, accelerator: string, platform: string): boolean {
  const chord = parse(accelerator)
  const mac = platform === "darwin"
  const wantCtrl = chord.ctrl || (chord.mod && !mac)
  const wantMeta = chord.cmd || (chord.mod && mac)
  if (event.ctrlKey !== wantCtrl || event.metaKey !== wantMeta) return false
  if (event.altKey !== chord.alt || event.shiftKey !== chord.shift) return false
  const typed = event.key.toLowerCase()
  // A digit is its PHYSICAL key (docs/PLAN-text-cells.md): Shift+7 types "&" on a US keyboard, and Ctrl+Shift+7 is
  // still the 7 key.
  if (/^\d$/.test(chord.key) && event.code && /^Digit\d$/.test(event.code)) return event.code === `Digit${chord.key}`
  if (typed === chord.key) return true
  // Ctrl+Alt is AltGr on layouts that have one, and then `key` is the typed
  // character; a chord of one letter or digit still means its physical key.
  if (chord.alt && wantCtrl && chord.key.length === 1 && event.code) {
    return event.code === (/\d/.test(chord.key) ? `Digit${chord.key}` : `Key${chord.key.toUpperCase()}`)
  }
  return false
}

/** The page-owned command a key event is, if any. Editor- and history-owned keys are theirs. */
export function commandForKey(event: KeyLike, platform: string): CommandDef | null {
  for (const command of COMMANDS) {
    if (command.owner !== "page" && command.owner !== "main") continue
    const key = acceleratorFor(command.id, platform)
    if (key && matches(event, key, platform)) return command
  }
  return null
}

// MARK: - What the menu needs to know

/**
 * The Input Devices menu lists the tablet next to the cameras, as a source for
 * the video pane: the pane shows a sheet to write on instead of a camera feed.
 * It travels as a camera id (`camera:tablet`), so the menu, the sidebar's
 * chevron and the pane all speak one language.
 */
export const TABLET_SOURCE = "tablet"

/** "Turn Camera Off": no source at all, the pane shows its placeholder (the Mac's `CameraController.turnOff`). */
export const CAMERA_OFF = "off"

/** The page tells the shell this, and the shell builds the menu from it. */
export interface MenuState {
  /** A note is open (`store.selectedNote != nil`). */
  hasNote: boolean
  sidebar: boolean
  /** The rendered page is showing (Mac: `appState.mode == .preview`). */
  rendered: boolean
  camera: boolean
  editorPane: boolean
  /** Markdown markers are shown (View ▸ Hide Markdown Markers is offered); independent of `rendered`. */
  markers: boolean
  canUndoDrawing: boolean
  canRedoDrawing: boolean
  /** "Dots", "Dashes", "Numbers", "To-do": the style the list button writes. */
  listStyle: string
  /** The language a new code block is tagged with, or null for plain. */
  codeLanguage: string | null
  cameras: { id: string; name: string }[]
  cameraId: string | null
  /** Input Devices ▸ Aspect Ratio: the shape of the viewfinder (`CameraAspect`'s stored name; "free" when none). */
  cameraAspect?: string
  /** The pen is down (✎ lit), the Erase and Select tools are on, the pen writes whatever the mode. */
  penDown: boolean
  penErase: boolean
  penSelect: boolean
  penAlwaysDraws: boolean
}

export const initialMenuState: MenuState = {
  hasNote: false, sidebar: true, rendered: false, camera: false, editorPane: true, markers: true,
  canUndoDrawing: false, canRedoDrawing: false, listStyle: "Dots", codeLanguage: null,
  cameras: [], cameraId: null, penDown: false, penErase: false, penSelect: false, penAlwaysDraws: true,
}
