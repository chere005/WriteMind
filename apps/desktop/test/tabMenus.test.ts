import { describe, expect, it, vi } from "vitest"
import { makeNote } from "@writemind/core"
import type { MenuItem } from "../src/renderer/FloatingMenu"
import { barTip, moveTargets, openCount, openListMenu, tabMenu, walkTo, wheelSteps, type TabMenuActions } from "../src/renderer/tabMenus"
import { renamePrompt, trashPrompt } from "../src/renderer/notePrompts"
import type { Section } from "../src/renderer/wm"

/**
 * THE TAB ROW'S MENUS (docs/PLAN-bars-2026-10.md, P2): the right-click menu on a tab gains Rename…, Duplicate, Move to
 * and Move to Trash… beside Close / Close Others / Reveal, the list of open notes has a real check column, and the wheel
 * walks the strip a tab a notch. All of it is data, so it is read here without a window.
 */

const note = (file: string, title = file.split(/[\\/]/).pop()!.replace(/\.md$/, "")) => ({ ...makeNote(file, 1, `# ${title}\n`), title })
const section = (path: string, depth: number, notes: string[] = [], sections: Section[] = []): Section =>
  ({ path, name: path.split(/[\\/]/).pop()!, depth, notes: notes.map((one) => note(one)), sections })

const labels = (items: MenuItem[]) => items.map((item) => (item === "-" ? "-" : "header" in item ? `# ${item.header}` : "custom" in item ? "(custom)" : item.label))
const rows = (items: MenuItem[]) => items.filter((item): item is Extract<MenuItem, { label: string }> => typeof item === "object" && "label" in item)

/** One folder holding two sections, one of them with a section in it. */
const tree = (): Section => section("/n", 0, ["/n/a.md"], [section("/n/Ideas", 1, ["/n/Ideas/b.md"], [section("/n/Ideas/2026", 2)]), section("/n/Work", 1)])

const actions = (over: Partial<TabMenuActions> = {}): TabMenuActions => ({
  platform: "darwin", openCount: 3, root: tree(),
  close: vi.fn(), closeOthers: vi.fn(), reveal: vi.fn(), rename: vi.fn(), duplicate: vi.fn(), moveTo: vi.fn(), trash: vi.fn(),
  ...over,
})

describe("a tab's right-click menu", () => {
  it("has the sidebar row's four actions beside Close, Close Others and Reveal", () => {
    const menu = tabMenu(note("/n/a.md"), actions())
    expect(labels(menu)).toEqual([
      "Close Tab", "Close Other Tabs", "-", "Rename…", "Duplicate", "Move to", "Reveal in Finder", "-", "Move to Trash…",
    ])
  })

  it("each action is the handler the page gave it, with this tab's note", () => {
    const a = actions()
    const one = note("/n/a.md")
    const find = (label: string) => rows(tabMenu(one, a)).find((row) => row.label === label)!
    find("Close Tab").onClick!(); expect(a.close).toHaveBeenCalledWith("/n/a.md")
    find("Close Other Tabs").onClick!(); expect(a.closeOthers).toHaveBeenCalledWith("/n/a.md")
    find("Rename…").onClick!(); expect(a.rename).toHaveBeenCalledWith(one)
    find("Duplicate").onClick!(); expect(a.duplicate).toHaveBeenCalledWith(one)
    find("Reveal in Finder").onClick!(); expect(a.reveal).toHaveBeenCalledWith("/n/a.md")
    find("Move to Trash…").onClick!(); expect(a.trash).toHaveBeenCalledWith(one)
  })

  it("Close Other Tabs waits for a second tab, and the trash is drawn as a warning", () => {
    const alone = rows(tabMenu(note("/n/a.md"), actions({ openCount: 1 })))
    expect(alone.find((row) => row.label === "Close Other Tabs")!.disabled).toBe(true)
    expect(alone.find((row) => row.label === "Move to Trash…")!.danger).toBe(true)
  })

  it("names this machine's file manager and bin, and carries the close key without a literal Ctrl on a Mac", () => {
    const win = rows(tabMenu(note("C:\\n\\a.md"), actions({ platform: "win32" })))
    expect(win.map((row) => row.label)).toContain("Reveal in Explorer")
    expect(win.map((row) => row.label)).toContain("Move to Recycle Bin…")
    expect(win[0]!.hint).toBe("Ctrl+W")
    expect(rows(tabMenu(note("/n/a.md"), actions()))[0]!.hint).toBe("Cmd+W")
  })

  it("Move to lists the folders in the tree's order, indented to depth, with the note's own greyed", () => {
    const menu = rows(tabMenu(note("/n/Ideas/b.md"), actions()))
    const sub = rows(menu.find((row) => row.label === "Move to")!.submenu!)
    expect(sub.map((row) => row.label)).toEqual(["n", "Ideas", "2026", "Work"])
    expect(sub.map((row) => row.labelStyle?.paddingLeft)).toEqual([undefined, 12, 24, 12].map((x) => x))
    expect(sub.map((row) => row.disabled)).toEqual([false, true, false, false])
  })

  it("Move to sends the note to the folder it names", () => {
    const a = actions()
    const one = note("/n/a.md")
    const sub = rows(rows(tabMenu(one, a)).find((row) => row.label === "Move to")!.submenu!)
    sub.find((row) => row.label === "Work")!.onClick!()
    expect(a.moveTo).toHaveBeenCalledWith(one, "/n/Work")
  })

  it("Move to is greyed when the project has no folder to offer", () => {
    const move = rows(tabMenu(note("/n/a.md"), actions({ root: null }))).find((row) => row.label === "Move to")!
    expect(move.disabled).toBe(true)
  })
})

describe("where Move to can send a note", () => {
  it("a project of several folders has them as its roots, a lone folder is its own", () => {
    const several: Section = { path: "", name: "Untitled Project", depth: -1, notes: [], sections: [tree(), section("/m", 0)] }
    expect(moveTargets(several, note("/m/x.md")).map((one) => [one.name, one.depth, one.here])).toEqual([
      ["n", 0, false], ["Ideas", 1, false], ["2026", 2, false], ["Work", 1, false], ["m", 0, true],
    ])
    expect(moveTargets(tree(), note("/n/x.md"))[0]).toMatchObject({ name: "n", depth: 0, here: true })
    expect(moveTargets(null, note("/n/x.md"))).toEqual([])
  })

  it("a Windows path is the same folder whichever separator it was written with", () => {
    const win = section("C:\\n\\Ideas", 1)
    const root: Section = { path: "C:\\n", name: "n", depth: 0, notes: [], sections: [win] }
    expect(moveTargets(root, note("C:\\n\\Ideas\\b.md")).map((one) => one.here)).toEqual([false, true])
    expect(moveTargets(root, note("C:/n/Ideas/b.md")).map((one) => one.here)).toEqual([false, true])
  })
})

describe("the list of open notes", () => {
  const open = [note("/n/a.md", "Alpha"), note("/n/b.md", "Beta")]

  it("has a check column: the note in front is checked and the others keep the column", () => {
    const menu = rows(openListMenu(open, "/n/b.md", vi.fn(), vi.fn()))
    expect(menu.slice(0, 2).map((row) => [row.label, row.checked])).toEqual([["Alpha", false], ["Beta", true]])
    // (No spaces or ✓ typed into the label: the column is the menu's.)
    expect(menu.slice(0, 2).every((row) => !/^\s|✓/.test(row.label))).toBe(true)
  })

  it("a row brings its tab to the front; Close Other Tabs keeps the one in front", () => {
    const select = vi.fn(); const closeOthers = vi.fn()
    const menu = rows(openListMenu(open, "/n/b.md", select, closeOthers))
    menu[0]!.onClick!(); expect(select).toHaveBeenCalledWith(open[0])
    menu.find((row) => row.label === "Close Other Tabs")!.onClick!(); expect(closeOthers).toHaveBeenCalledWith("/n/b.md")
  })

  it("says so when nothing is open, and Close Other Tabs needs a second note", () => {
    expect(labels(openListMenu([], null, vi.fn(), vi.fn()))).toEqual(["No open notes"])
    const one = rows(openListMenu([open[0]!], "/n/a.md", vi.fn(), vi.fn()))
    expect(one.find((row) => row.label === "Close Other Tabs")!.disabled).toBe(true)
  })

  it("the count has a sentence for one and for many", () => {
    expect(openCount(1)).toBe("1 open note")
    expect(openCount(7)).toBe("7 open notes")
  })
})

describe("the wheel along the strip", () => {
  it("walks a tab a notch, carrying the pixels that did not make a notch", () => {
    expect(wheelSteps(0, 5)).toEqual({ steps: 0, carried: 5 })
    expect(wheelSteps(5, 8)).toEqual({ steps: 1, carried: 1 })
    expect(wheelSteps(0, -30)).toEqual({ steps: -2, carried: -6 })
  })

  // Five tabs 100 wide in a strip whose left edge is at 0, scrolled so the first one is just out of sight.
  const rights = [0, 100, 200, 300, 400]
  it("starts from the first tab that shows, and never leaves the row", () => {
    expect(walkTo(rights, 0, 1)).toBe(2)     // tab 0 is gone (its right edge is not past the left), tab 1 is first; one notch on is 2
    expect(walkTo(rights, 0, -1)).toBe(0)
    expect(walkTo(rights, 0, 99)).toBe(4)    // never more than three at once, and never past the last
    expect(walkTo([100, 200, 300], 0, -5)).toBe(0)
    expect(walkTo([], 0, 1)).toBe(0)
  })
})

describe("the dialogs a menu asks with", () => {
  it("Rename… starts on the stem, so the extension stays", () => {
    const spec = renamePrompt(note("/n/Ideas/b.md"), () => undefined)
    expect(spec).toMatchObject({ title: "Rename", value: "b", ok: "Rename" })
  })

  it("Move to Trash… names the note and the bin, and its OK is the dangerous one", () => {
    const trash = vi.fn()
    const spec = trashPrompt(note("/n/a.md", "Alpha"), "Recycle Bin", trash)
    expect(spec.title).toBe("Move “Alpha” to the Recycle Bin?")
    expect(spec.destructive).toBe(true)
    void spec.onSubmit("")
    expect(trash).toHaveBeenCalled()
  })
})

describe("the buttons' tooltips", () => {
  it("name the key, then say what the button does", () => {
    expect(barTip("Hide Video", "Cmd+Y", "Put it away")).toBe("Hide Video  (Cmd+Y)\nPut it away")
    expect(barTip("Show Video", "", "x")).toBe("Show Video\nx")
  })
})
