import { describe, expect, it } from "vitest"
import type { MenuItemConstructorOptions } from "electron"
import {
  COMMANDS, acceleratorFor, commandById, commandForKey, initialMenuState, matches, type MenuState,
} from "../src/shared/commands"
import { buildMenu } from "../src/main/menu"

const project = { name: "Untitled Project", edited: false, folders: [{ path: "/a", name: "a" }] }

function menu(state: Partial<MenuState> = {}, platform = "win32", folders = project.folders) {
  return buildMenu({
    platform, state: { ...initialMenuState, ...state }, project: { ...project, folders }, run: () => {},
  })
}

const labels = (items: MenuItemConstructorOptions[]): string[] =>
  items.map((one) => (one.type === "separator" ? "-" : one.label ?? `role:${one.role}`))

const sub = (items: MenuItemConstructorOptions[], label: string): MenuItemConstructorOptions[] => {
  const found = items.find((one) => one.label === label)
  return (found?.submenu ?? []) as MenuItemConstructorOptions[]
}

describe("the application menu is the Mac's", () => {
  // "Pen" is the port's own menu (the Mac has no tablet), between Insert and Input Devices.
  it("has WriteMindApp.swift's menus in the order the Mac has them", () => {
    expect(labels(menu())).toEqual([
      "File", "Project", "Edit", "View", "Format", "Insert", "Pen", "Input Devices", "Window", "role:help",
    ])
  })

  // Mac e8b3266: Save (⌘S), and ONE Export… (⌘E) whose panel asks PDF or Project (no submenu).
  it("File: New Note, Close Tab, Open Notes Folder, Save, Export…, Quit", () => {
    expect(labels(sub(menu(), "File"))).toEqual([
      "New Note", "-", "Close Tab", "-", "Open Notes Folder", "-", "Save", "Export…", "-", "Quit",
    ])
    const file = (state: Partial<MenuState>, folders = project.folders) => sub(menu(state, "win32", folders), "File")
    expect(file({}).find((one) => one.label === "Save")!.enabled).toBe(false)
    expect(file({ hasNote: true }).find((one) => one.label === "Save")!.enabled).toBe(true)
    // Export… with no note still exports the project; with no note and no folders there is nothing to make.
    expect(file({}).find((one) => one.label === "Export…")!.enabled).toBe(true)
    expect(file({}, []).find((one) => one.label === "Export…")!.enabled).toBe(false)
    expect(file({ hasNote: true }, []).find((one) => one.label === "Export…")!.enabled).toBe(true)
  })

  it("Help: Keyboard Shortcuts (F1), then Check for Updates… and its startup box (main/updater.ts) and About", () => {
    const help = sub(menu().map((one) => (one.role === "help" ? { ...one, label: "Help" } : one)), "Help")
    expect(labels(help)).toEqual(["Keyboard Shortcuts", "-", "Check for Updates…", "Check for Updates on Startup", "-", "About WriteMind"])
    expect(help[0]!.accelerator).toBe("F1")
    expect(help[2]!.id).toBe("checkForUpdates")
    // A Mac looks too (download mode: its dialog opens the release's page), and never has an install item.
    const mac = sub(menu({}, "darwin").map((one) => (one.role === "help" ? { ...one, label: "Help" } : one)), "Help")
    expect(labels(mac)).toEqual(["Keyboard Shortcuts", "-", "Check for Updates…", "Check for Updates on Startup", "-", "About WriteMind"])
    expect(mac[2]!.id).toBe("checkForUpdates")
    const macReady = buildMenu({
      platform: "darwin", state: initialMenuState, project, run: () => {},
      update: { label: "Restart to Update to 1.0.1", ready: true, checkOnStartup: true, canCheck: true },
    }).find((one) => one.role === "help")!.submenu as MenuItemConstructorOptions[]
    expect(macReady.map((one) => one.id)).not.toContain("installUpdate")
    expect(macReady.find((one) => one.id === "checkForUpdates")!.label).toBe("Check for Updates…")
    const linux = sub(menu({}, "linux").map((one) => (one.role === "help" ? { ...one, label: "Help" } : one)), "Help")
    expect(labels(linux)).toEqual(["Keyboard Shortcuts", "-", "About WriteMind"])
  })

  it("Project: the name, Add Folder, Remove Folder, Save, Save As, Open, New", () => {
    expect(labels(sub(menu(), "Project"))).toEqual([
      "Untitled Project", "-", "Add Folder to Project…", "Remove Folder", "-", "Save Project",
      "Save Project As…", "-", "Open Project…", "New Project",
    ])
  })

  it("Project: says when the saved project has been edited, and will not remove the last folder", () => {
    const edited = buildMenu({
      platform: "win32", state: initialMenuState, run: () => {},
      project: { name: "Notes", edited: true, folders: [{ path: "/a", name: "a" }] },
    })
    expect(sub(edited, "Project")[0]!.label).toBe("Notes — edited")
    const remove = sub(sub(menu(), "Project"), "Remove Folder")
    expect(remove).toHaveLength(1)
    expect(remove[0]!.enabled).toBe(false)
    const two = sub(sub(menu({}, "win32", [{ path: "/a", name: "a" }, { path: "/b", name: "b" }]),
      "Project"), "Remove Folder")
    expect(two.map((one) => one.enabled)).toEqual([true, true])
  })

  it("Edit: Undo, Redo, the drawing's pair, the clipboard, then the selections", () => {
    expect(labels(sub(menu(), "Edit"))).toEqual([
      "Undo", "Redo", "Undo Drawing", "Redo Drawing", "-", "role:cut", "role:copy", "role:paste",
      "role:selectAll", "-", "Expand Selection", "Select Next Occurrence", "Select All Occurrences",
      "-", "Find",
    ])
  })

  it("Undo Drawing and Redo Drawing are disabled until there is something to take back", () => {
    const off = sub(menu(), "Edit")
    expect([off[2]!.enabled, off[3]!.enabled]).toEqual([false, false])
    const on = sub(menu({ canUndoDrawing: true, canRedoDrawing: true }), "Edit")
    expect([on[2]!.enabled, on[3]!.enabled]).toEqual([true, true])
  })

  // The markers are their own switch (the Mac's showMarkers), independent of the preview toggle.
  it("View: the markers label follows the markers, not the preview mode", () => {
    expect(labels(sub(menu({ rendered: true, markers: true }), "View"))[5]).toBe("Hide Markdown Markers")
    expect(labels(sub(menu({ rendered: false, markers: false }), "View"))[5]).toBe("Show Markdown Markers")
  })

  it("View: the toggles read as the Mac's do, in both states", () => {
    expect(labels(sub(menu({ camera: true }), "View")).slice(0, 6)).toEqual([
      "Hide Notes Sidebar", "Show Markdown Preview", "Hide Video", "Draw", "Hide Notes Pane", "Hide Markdown Markers",
    ])
    const flipped = menu({ sidebar: false, rendered: true, camera: false, editorPane: false, markers: false, penDown: true })
    expect(labels(sub(flipped, "View")).slice(0, 6)).toEqual([
      "Show Notes Sidebar", "Show Markdown Editor", "Show Video", "Stop Drawing", "Show Notes Pane", "Show Markdown Markers",
    ])
    // Mac e8b3266: the caret's own Fold / Unfold Section are gone; Collapse Subsections (⌘;) folds what is under it.
    expect(labels(sub(menu(), "View")).slice(6, 10)).toEqual([
      "-", "Collapse Subsections", "Fold All Sections", "Unfold All Sections",
    ])
  })

  it("Format: the heading ladder, marks, list, quote, indentation, cells, sections", () => {
    expect(labels(sub(menu(), "Format"))).toEqual([
      "Title", "Chapter", "Author", "Section", "Subsection", "Subsubsection", "Text", "Markdown", "-",
      "Bold", "Italic", "Underline", "Strikethrough", "-",
      "Dots List", "Quote", "-",
      "Decrease Indentation", "Increase Indentation", "-",
      "Split Cell", "Merge Cells", "-",
      "Duplicate Cell", "-", "Evaluation Cell", "Delete Cell", "Move Cell Up", "Move Cell Down", "-",
      "Move Section Up", "Move Section Down",
    ])
    expect(labels(sub(menu({ listStyle: "To-do" }), "Format"))).toContain("To-do List")
  })

  it("the cell commands wait for a note, like the Mac's .disabled(store.selectedNote == nil)", () => {
    const format = sub(menu(), "Format")
    for (const label of ["Split Cell", "Merge Cells", "Duplicate Cell", "Delete Cell", "Move Cell Up", "Move Cell Down"]) {
      expect(format.find((one) => one.label === label)!.enabled).toBe(false)
    }
    const withNote = sub(menu({ hasNote: true }), "Format")
    expect(withNote.find((one) => one.label === "Split Cell")!.enabled).toBe(true)
    expect(sub(menu(), "File").find((one) => one.label === "Close Tab")!.enabled).toBe(false)
  })

  it("Insert: Image…, Text Box, Maths… (port-only key), a separator, Code Block (named for its language), Drawing Cell", () => {
    expect(labels(sub(menu(), "Insert"))).toEqual(["Image…", "Text Box", "Maths…", "-", "Code Block", "Drawing Cell"])
    expect(labels(sub(menu({ codeLanguage: "Python" }), "Insert"))).toEqual(["Image…", "Text Box", "Maths…", "-", "Python Block", "Drawing Cell"])
  })

  it("Input Devices: the cameras with a tick on the live one, the Tablet source, Turn Camera Off, Refresh", () => {
    const none = sub(menu(), "Input Devices")
    expect(labels(none)).toEqual(["No cameras found", "-", "Tablet", "-", "Turn Camera Off", "-", "Aspect Ratio", "Refresh Device List"])
    expect(none[4]!.enabled).toBe(false)
    const some = sub(menu({ cameras: [{ id: "x", name: "Desk" }, { id: "y", name: "Phone" }], cameraId: "y" }),
      "Input Devices")
    expect(labels(some)).toEqual(["Desk", "Phone", "-", "Tablet", "-", "Turn Camera Off", "-", "Aspect Ratio", "Refresh Device List"])
    expect(some.map((one) => one.checked)).toEqual([false, true, undefined, false, undefined, undefined, undefined, undefined, undefined])
    expect(some[5]!.enabled).toBe(true)
  })

  // Mac commit c98c067: Input Devices ▸ Aspect Ratio, every shape in the Mac's order, ticked like the cameras.
  it("Input Devices ▸ Aspect Ratio: Free and the ratios both ways up, the one in use ticked", () => {
    const shapes = sub(sub(menu(), "Input Devices"), "Aspect Ratio")
    expect(labels(shapes)).toEqual(["Free — as the camera sends it", "1:1", "4:3", "3:4", "3:2", "2:3", "16:9", "9:16"])
    expect(shapes.filter((one) => one.checked).map((one) => one.label)).toEqual(["Free — as the camera sends it"])
    const tall = sub(sub(menu({ cameraAspect: "threeFour" }), "Input Devices"), "Aspect Ratio")
    expect(tall.filter((one) => one.checked).map((one) => one.id)).toEqual(["cameraAspect:threeFour"])
    const asked: string[] = []
    const clicked = sub(sub(buildMenu({
      platform: "win32", state: initialMenuState, project, run: (id) => asked.push(id),
    }), "Input Devices"), "Aspect Ratio")
    ;(clicked[7]!.click as () => void)()
    expect(asked).toEqual(["cameraAspect:nineSixteen"])
  })

  it("NOTHING goes full screen: no menu item, no role, no Ctrl+Alt+T command (Sean never asked for it)", () => {
    const every = (items: MenuItemConstructorOptions[]): MenuItemConstructorOptions[] =>
      items.flatMap((one) => [one, ...every((one.submenu ?? []) as MenuItemConstructorOptions[])])
    for (const dev of [false, true]) {
      const all = every(buildMenu({ platform: "win32", state: initialMenuState, project, dev, run: () => {} }))
      for (const one of all) {
        expect(String(one.role ?? "").toLowerCase(), one.label).not.toContain("fullscreen")
        expect(String(one.label ?? "").toLowerCase(), one.label).not.toMatch(/full.?screen|pad/)
        expect(one.id ?? "", one.label).not.toBe("tabletPad")
      }
    }
    expect(commandForKey({ key: "t", ctrlKey: true, altKey: true, shiftKey: false, metaKey: false }, "win32")).toBeNull()
    expect(commandById("tabletPad")).toBeUndefined()
  })

  it("shows the keys and registers none of them (one press is one action)", () => {
    const every = (items: MenuItemConstructorOptions[]): MenuItemConstructorOptions[] =>
      items.flatMap((one) => [one, ...every((one.submenu ?? []) as MenuItemConstructorOptions[])])
    const keyed = every(menu()).filter((one) => one.accelerator)
    expect(keyed.length).toBeGreaterThan(30)
    for (const one of keyed) expect(one.registerAccelerator, one.label).toBe(false)
  })

  it("uses no role that carries a REGISTERED accelerator of its own against ours", () => {
    // `windowMenu` brought Minimize = Ctrl+M (Merge Cells) and Close = Ctrl+W (Close Tab).
    const every = (items: MenuItemConstructorOptions[]): MenuItemConstructorOptions[] =>
      items.flatMap((one) => [one, ...every((one.submenu ?? []) as MenuItemConstructorOptions[])])
    const roles = new Set(every(menu({}, "win32")).map((one) => one.role).filter(Boolean))
    for (const role of roles) {
      expect(["cut", "copy", "paste", "selectAll", "quit", "toggleDevTools", "help"])
        .toContain(role)
    }
    const dev = every(buildMenu({ platform: "win32", state: initialMenuState, project, dev: true, run: () => {} }))
      .find((one) => one.role === "toggleDevTools")
    expect(dev!.accelerator).toBe("F12")
  })

  it("the Mac's chords land where the mapping says", () => {
    const view = sub(menu({ camera: true }), "View")
    const key = (label: string) => view.find((one) => one.label === label)!.accelerator
    // Mac e8b3266: ⌘K, ⌘Y (Ctrl+Shift+Y: Ctrl+Y is Redo on a PC), ⌘T, ⌘P; the notes pane has no key.
    expect(key("Hide Notes Sidebar")).toBe("CmdOrCtrl+K")
    expect(key("Hide Video")).toBe("CmdOrCtrl+Shift+Y")
    expect(key("Hide Notes Pane")).toBeUndefined()
    expect(key("Show Markdown Preview")).toBe("CmdOrCtrl+T")
    expect(key("Draw")).toBe("CmdOrCtrl+P")
    const format = sub(menu(), "Format")
    const fk = (label: string) => format.find((one) => one.label === label)!.accelerator
    expect(fk("Split Cell")).toBe("Ctrl+D")
    expect(fk("Merge Cells")).toBe("Ctrl+M")
    expect(fk("Duplicate Cell")).toBe("Ctrl+Shift+D")
    expect(fk("Title")).toBe("CmdOrCtrl+1")
    expect(fk("Text")).toBe("CmdOrCtrl+7")
    expect(fk("Markdown")).toBe("CmdOrCtrl+Shift+7")
    expect(fk("Evaluation Cell")).toBe("CmdOrCtrl+Shift+8")
    expect(sub(menu({ camera: true }, "darwin"), "View")[2]!.accelerator).toBe("Cmd+Y")
  })
})

describe("the key table", () => {
  it("never gives one chord to two commands", () => {
    const seen = new Map<string, string>()
    for (const platform of ["win32", "darwin"]) {
      seen.clear()
      for (const command of COMMANDS) {
        const key = acceleratorFor(command.id, platform)
        if (!key) continue
        const normal = key.replace(/CmdOrCtrl/g, platform === "darwin" ? "Cmd" : "Ctrl").toLowerCase()
        expect(seen.get(normal), `${platform}: ${command.id} vs ${seen.get(normal)} on ${key}`).toBeUndefined()
        seen.set(normal, command.id)
      }
    }
  })

  const event = (key: string, mods: Partial<Record<"ctrlKey" | "metaKey" | "altKey" | "shiftKey", boolean>> = {}) =>
    ({ key, ctrlKey: false, metaKey: false, altKey: false, shiftKey: false, ...mods })

  it("matches exactly: Ctrl+Z is not Ctrl+Alt+Z, and Shift counts", () => {
    expect(matches(event("z", { ctrlKey: true }), "CmdOrCtrl+Z", "win32")).toBe(true)
    expect(matches(event("z", { ctrlKey: true, altKey: true }), "CmdOrCtrl+Z", "win32")).toBe(false)
    expect(matches(event("Z", { ctrlKey: true, altKey: true, shiftKey: true }), "CmdOrCtrl+Alt+Shift+Z", "win32")).toBe(true)
    expect(matches(event("z", { metaKey: true }), "CmdOrCtrl+Z", "darwin")).toBe(true)
    expect(matches(event("ArrowLeft", { ctrlKey: true, altKey: true }), "CmdOrCtrl+Alt+Left", "win32")).toBe(true)
  })

  it("finds the page's commands by key and leaves the editor's alone", () => {
    expect(commandForKey(event("k", { ctrlKey: true }), "win32")?.id).toBe("toggleSidebar")
    expect(commandForKey(event("t", { ctrlKey: true }), "win32")?.id).toBe("toggleMode")
    expect(commandForKey(event("s", { ctrlKey: true, altKey: true }), "win32")).toBeNull()
    expect(commandForKey(event("A", { ctrlKey: true, shiftKey: true }), "win32")?.id).toBe("addFolder")
    // Bold is CodeMirror's key; the page must not run it as well.
    expect(commandForKey(event("b", { ctrlKey: true }), "win32")).toBeNull()
    expect(commandForKey(event("d", { altKey: true }), "win32")).toBeNull()
    // And Ctrl+Z is useUndo's.
    expect(commandForKey(event("z", { ctrlKey: true }), "win32")).toBeNull()
  })
})
