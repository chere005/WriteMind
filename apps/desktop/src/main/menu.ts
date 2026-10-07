/**
 * The application menu, built to be the Mac's: `WriteMindApp.swift`'s
 * `.commands` — File, Project, Edit, View, Format, Insert, Input Devices —
 * with Window and Help beside them. Pure: a state in, a template out, so the
 * order of the items and the separators between them are a test and not a
 * thing to look at.
 *
 * A click on a page-owned item is `run(id)`, which the shell turns into an
 * IPC message to the page; the accelerators are DISPLAYED and not registered
 * (`registerAccelerator: false`) — see `shared/commands.ts` for who hears
 * each key.
 */

import type { MenuItemConstructorOptions } from "electron"
import { CAMERA_ASPECTS, cameraAspectTitle, HEADING_LADDER, headingName } from "@writemind/core"
import { acceleratorFor, HEADING_COMMANDS, TABLET_SOURCE, type MenuState } from "../shared/commands"


export interface ProjectInfo {
  name: string
  edited: boolean
  folders: { path: string; name: string }[]
}

export interface MenuOptions {
  platform: string
  state: MenuState
  project: ProjectInfo
  /** Developer tools in the View menu. */
  dev?: boolean
  /**
   * Help's update items (Windows and Mac; shared/update.ts updateMenu): Check for Updates…'s wording and whether it
   * restarts into a ready update (Windows only), and the Check for Updates on Startup box (greyed in a copy that does
   * not look).
   */
  update?: { label: string; ready: boolean; checkOnStartup?: boolean; canCheck?: boolean }
  /** Run a command by id: the page's, or the main process's own. */
  run(id: string): void
}

const SEPARATOR: MenuItemConstructorOptions = { type: "separator" }

export function buildMenu(options: MenuOptions): MenuItemConstructorOptions[] {
  const { platform, state, project, run } = options

  /** An item that runs a command; the key is shown and not registered. */
  const item = (id: string, label: string, extra: Partial<MenuItemConstructorOptions> = {}):
  MenuItemConstructorOptions => {
    const accelerator = acceleratorFor(id, platform)
    return {
      id, label,
      ...(accelerator ? { accelerator, registerAccelerator: false } : {}),
      click: () => run(id),
      ...extra,
    }
  }

  const file: MenuItemConstructorOptions[] = [
    item("newNote", "New Note"),
    SEPARATOR,
    item("closeTab", "Close Tab", { enabled: state.hasNote }),
    SEPARATOR,
    item("openFolder", "Open Notes Folder"),
    SEPARATOR,
    item("save", "Save", { enabled: state.hasNote }),
    // One item; PDF or Project is chosen in the save panel (exportFile.ts). Nothing to make
    // without a note or a folder (the Mac: `store.selectedNote == nil && store.folders.isEmpty`).
    item("export", "Export…", { enabled: state.hasNote || project.folders.length > 0 }),
    // The port's own (docs\TODO.md "Housekeeping"): drawings and pictures nothing uses, to the bin after a yes.
    item("cleanUp", "Clean Up Unused Files…", { enabled: project.folders.length > 0 }),
    SEPARATOR,
    // The port's own (PARITY ▸ per-tool override): one place on every platform, like Help ▸ Check for Updates…. The
    // page's dialog (LanguageSetupDialog.tsx), no key, and always there: it is how a missing language is set up.
    item("languageSetup", "Language Setup…"),
    ...(platform === "darwin" ? [] : [SEPARATOR, { role: "quit" as const, label: "Quit" }]),
  ]

  const projectMenu: MenuItemConstructorOptions[] = [
    { label: project.name + (project.edited ? " — edited" : ""), enabled: false },
    SEPARATOR,
    item("addFolder", "Add Folder to Project…"),
    {
      label: "Remove Folder",
      submenu: project.folders.length === 0
        ? [{ label: "No folders", enabled: false }]
        : project.folders.map((folder) => ({
          id: `removeFolder:${folder.path}`,
          label: folder.name,
          enabled: project.folders.length > 1,
          click: () => run(`removeFolder:${folder.path}`),
        })),
    },
    SEPARATOR,
    item("saveProject", "Save Project"),
    item("saveProjectAs", "Save Project As…"),
    SEPARATOR,
    item("openProject", "Open Project…"),
    item("newProject", "New Project"),
  ]

  const edit: MenuItemConstructorOptions[] = [
    item("undo", "Undo"),
    item("redo", "Redo"),
    item("undoDrawing", "Undo Drawing", { enabled: state.canUndoDrawing }),
    item("redoDrawing", "Redo Drawing", { enabled: state.canRedoDrawing }),
    SEPARATOR,
    { role: "cut" }, { role: "copy" }, { role: "paste" }, { role: "selectAll" },
    SEPARATOR,
    item("expandSelection", "Expand Selection"),
    item("selectNext", "Select Next Occurrence"),
    item("selectAll", "Select All Occurrences"),
    SEPARATOR,
    {
      label: "Find",
      submenu: [
        item("find", "Find…"),
        item("findReplace", "Find and Replace…"),
        item("findNext", "Find Next"),
        item("findPrevious", "Find Previous"),
        item("useSelectionForFind", "Use Selection for Find"),
        item("jumpToSelection", "Jump to Selection"),
      ],
    },
  ]

  const view: MenuItemConstructorOptions[] = [
    item("toggleSidebar", state.sidebar ? "Hide Notes Sidebar" : "Show Notes Sidebar"),
    item("toggleMode", state.rendered ? "Show Markdown Editor" : "Show Markdown Preview"),
    item("toggleCamera", state.camera ? "Hide Video" : "Show Video"),
    item("togglePen", state.penDown ? "Stop Drawing" : "Draw"),
    item("toggleEditorPane", state.editorPane ? "Hide Notes Pane" : "Show Notes Pane"),
    item("toggleMarkers", state.markers ? "Hide Markdown Markers" : "Show Markdown Markers"),
    SEPARATOR,
    // What is UNDER the cells in play, never the cell itself (the caret's own Fold / Unfold Section are gone).
    item("collapseSubsections", "Collapse Subsections"),
    item("foldAll", "Fold All Sections"),
    item("unfoldAll", "Unfold All Sections"),
    // No Toggle Full Screen: nothing in this app goes full screen (Sean's rule).
    ...(options.dev ? [SEPARATOR, { role: "toggleDevTools" as const, accelerator: "F12" }] : []),
  ]

  const format: MenuItemConstructorOptions[] = [
    ...HEADING_LADDER.map((level) => {
      const command = HEADING_COMMANDS.find((h) => h.level === level)!
      return item(command.id, headingName(level))
    }),
    // Text's markdown twin (docs/PLAN-text-cells.md): the paragraph read as markdown.
    item("markdownCell", "Markdown"),
    SEPARATOR,
    item("bold", "Bold"), item("italic", "Italic"), item("underline", "Underline"),
    item("strike", "Strikethrough"),
    SEPARATOR,
    item("list", `${state.listStyle} List`),
    item("quote", "Quote"),
    SEPARATOR,
    item("outdent", "Decrease Indentation"),
    item("indent", "Increase Indentation"),
    SEPARATOR,
    item("splitCell", "Split Cell", { enabled: state.hasNote }),
    item("mergeCells", "Merge Cells", { enabled: state.hasNote }),
    SEPARATOR,
    item("duplicateCell", "Duplicate Cell", { enabled: state.hasNote }),
    // The Mac's order: a divider, then ⌘9 Evaluation Cell above Delete Cell (WriteMindApp.swift FormatMenu).
    SEPARATOR,
    item("evaluationCell", "Evaluation Cell", { enabled: state.hasNote }),
    item("deleteCell", "Delete Cell", { enabled: state.hasNote }),
    item("moveCellUp", "Move Cell Up", { enabled: state.hasNote }),
    item("moveCellDown", "Move Cell Down", { enabled: state.hasNote }),
    SEPARATOR,
    item("moveSectionUp", "Move Section Up"),
    item("moveSectionDown", "Move Section Down"),
  ]

  const insert: MenuItemConstructorOptions[] = [
    item("insertImage", "Image…", { enabled: state.hasNote }),
    item("insertTextBox", "Text Box", { enabled: state.hasNote }),
    item("insertMath", "Maths…", { enabled: state.hasNote }),
    SEPARATOR,
    item("codeBlock", state.codeLanguage ? `${state.codeLanguage} Block` : "Code Block",
      { enabled: state.hasNote }),
    item("mathsCell", "Maths Cell", { enabled: state.hasNote }),
    item("insertInkCell", "Drawing Cell", { enabled: state.hasNote }),
  ]

  // Port-only (the Mac has no tablet): the pen's tools, on keys the tablet's
  // ExpressKeys can type. Between Insert and Input Devices, where the things
  // that go on the page and the things that make it sit.
  const check = (id: string, label: string, checked: boolean): MenuItemConstructorOptions =>
    item(id, label, { type: "checkbox", checked, enabled: state.hasNote })
  const sheet = state.cameraId === TABLET_SOURCE
  const pen: MenuItemConstructorOptions[] = [
    check("penToggle", "Pen Down", state.penDown),
    check("penErase", "Erase Tool", state.penErase),
    check("penSelect", "Select Tool", state.penSelect),
    check("penAlwaysDraws", "Pen Always Draws", state.penAlwaysDraws),
    SEPARATOR,
    item("penNextColour", "Next Colour"),
    item("penPrevColour", "Previous Colour"),
    item("penWider", "Wider Line"),
    item("penThinner", "Thinner Line"),
    SEPARATOR,
    item("penDelete", "Delete Selection", { enabled: state.hasNote }),
    item("penClearSelection", "Clear Selection", { enabled: state.hasNote }),
    SEPARATOR,
    item("penSendWriting", "Send Writing", { enabled: sheet }),
    item("penSendPage", "Send Page", { enabled: sheet }),
    item("penClearSheet", "Clear Sheet", { enabled: sheet }),
    item("penNextSheet", "Next Sheet", { enabled: sheet }),
    item("penPrevSheet", "Previous Sheet", { enabled: sheet }),
  ]

  const devices: MenuItemConstructorOptions[] = [
    ...(state.cameras.length === 0
      ? [{ label: "No cameras found", enabled: false } as MenuItemConstructorOptions]
      : state.cameras.map((camera): MenuItemConstructorOptions => ({
        id: `camera:${camera.id}`,
        label: camera.name,
        type: "checkbox",
        checked: state.cameraId === camera.id,
        click: () => run(`camera:${camera.id}`),
      }))),
    SEPARATOR,
    // The tablet is a source like a camera: write on it instead of putting a page under one.
    {
      id: `camera:${TABLET_SOURCE}`,
      label: "Tablet",
      type: "checkbox",
      checked: state.cameraId === TABLET_SOURCE,
      click: () => run(`camera:${TABLET_SOURCE}`),
    },
    SEPARATOR,
    item("cameraOff", "Turn Camera Off", { enabled: state.cameraId !== null }),
    SEPARATOR,
    // THE VIEWFINDER'S SHAPE (Mac commit c98c067: "aspect ratio control should be in the video input dropdown").
    // Ticked the way the cameras above are, because it is the same kind of choice: what am I pointing this at.
    {
      label: "Aspect Ratio",
      submenu: CAMERA_ASPECTS.map((choice): MenuItemConstructorOptions => ({
        id: `cameraAspect:${choice}`,
        label: choice === "free" ? "Free — as the camera sends it" : cameraAspectTitle(choice),
        type: "checkbox",
        checked: (state.cameraAspect ?? "free") === choice,
        click: () => run(`cameraAspect:${choice}`),
      })),
    },
    item("cameraRefresh", "Refresh Device List"),
  ]

  // Not `role: "windowMenu"`: its Minimize (Ctrl+M) and Close (Ctrl+W) are
  // REGISTERED accelerators, and those are Merge Cells and Close Tab.
  const windowItems: MenuItemConstructorOptions[] = [
    { label: "Minimize", click: (_item, win) => win?.minimize() },
    { label: "Zoom", click: (_item, win) => { if (win?.isMaximized()) win.unmaximize(); else win?.maximize() } },
    SEPARATOR,
    { label: "Close Window", click: (_item, win) => win?.close() },
  ]

  // Updates come with the Windows installer (main/updater.ts): Check for Updates… looks now and answers in the page's
  // own dialog ("Restart to Update to x" once one is downloaded); the box under it is the dialog's "Check on startup".
  // A Mac looks too but only offers the download (its dialog's Download opens the release's page): never an install item.
  const mac = platform === "darwin"
  const updateId = options.update?.ready && !mac ? "installUpdate" : "checkForUpdates"
  const canCheck = options.update?.canCheck ?? false
  const updateItems: MenuItemConstructorOptions[] = platform === "win32" || mac
    ? [
        { id: updateId, label: mac ? "Check for Updates…" : options.update?.label ?? "Check for Updates…", click: () => run(updateId) },
        {
          id: "checkUpdatesOnStartup", label: "Check for Updates on Startup", type: "checkbox",
          checked: canCheck && (options.update?.checkOnStartup ?? true), enabled: canCheck,
          click: () => run("checkUpdatesOnStartup"),
        },
        SEPARATOR,
      ]
    : []

  return [
    // THE MAC'S APP MENU is `role: "appMenu"` item for item, except About: the role opens Apple's own panel, and
    // WriteMind has ONE About dialog on every platform (AboutDialog.tsx), so the item is ours and runs "about".
    ...(platform === "darwin"
      ? [{
          label: "WriteMind",
          submenu: [
            { id: "aboutApp", label: "About WriteMind", click: () => run("about") },
            SEPARATOR,
            { role: "services" as const },
            SEPARATOR,
            { role: "hide" as const },
            { role: "hideOthers" as const },
            { role: "unhide" as const },
            SEPARATOR,
            { role: "quit" as const },
          ],
        } satisfies MenuItemConstructorOptions]
      : []),
    { label: "File", submenu: file },
    { label: "Project", submenu: projectMenu },
    { label: "Edit", submenu: edit },
    { label: "View", submenu: view },
    { label: "Format", submenu: format },
    { label: "Insert", submenu: insert },
    { label: "Pen", submenu: pen },
    { label: "Input Devices", submenu: devices },
    { label: "Window", submenu: windowItems },
    {
      role: "help",
      submenu: [
        // The app's own one-page reference (shared/welcome.ts): no key; written if missing, rewritten if out of date.
        item("quickReference", "Quick Reference"),
        item("keyList", "Keyboard Shortcuts"),
        SEPARATOR,
        ...updateItems,
        { id: "about", label: "About WriteMind", click: () => run("about") },
      ],
    },
  ]
}
