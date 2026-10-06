/**
 * The project's side of the sidebar (`SidebarView.swift`): the footer with its
 * Folder menu, the right-click menus on a folder and on the blank list, and
 * the two states a list can have instead of rows — nothing in it yet, and a
 * project whose folders are not there.
 *
 * "Remove Folder from Project" is offered ONLY for a folder that is really on
 * disk at the moment the menu opens (Sean, 2026-09-19: "remove folder on
 * project only if it's a real folder that exists"): hiding a ghost would only
 * put its path in `excluded` for good.
 */

import { useCallback, useState } from "react"
import type { Note } from "@writemind/core"
import { FloatingMenu, type MenuItem } from "./FloatingMenu"
import { distinctNotes } from "./sidebarTree"
import type { ProjectInfo, Section } from "./wm"

export const fileManagerName = (platform: string): string =>
  platform === "darwin" ? "Finder" : platform === "win32" ? "Explorer" : "the file manager"

const countNotes = (section: Section): number =>
  section.notes.length + section.sections.reduce((sum, one) => sum + countNotes(one), 0)

export const isEmptyTree = (root: Section | null): boolean =>
  !root || (root.notes.length === 0 && root.sections.every((one) => countNotes(one) === 0 && one.sections.length === 0))

/** What a row can do beyond the project (the Mac's row menus): rename, duplicate, move and the Trash. */
export interface RowActions extends ProjectActions {
  renameNote(note: Note): void
  renameSection(section: Section): void
  duplicate(note: Note): void
  /** Asks first ("Move “X” to the Trash?"), then trashes. */
  trashNote(note: Note): void
  trashSection(section: Section): void
  moveNote(note: Note, folder: string): void
}

export interface ProjectActions {
  /** A command the main process owns: addFolder, removeFolder:<path>, excludeFolder:<path>, includeFolder:<path>; and
   *  cleanUp, the page's (CleanUpDialog.tsx), which App answers itself. */
  run(id: string): void
  reveal(path: string): void
  newNote(folder: string): void
  newSection(parent: string): void
}

/**
 * The right-click menu on a folder row. `isRoot` is a project folder (a
 * row of depth 0 in a project of several), anything else is a section inside
 * one. `real` is whether the folder is on disk right now.
 */
export function sectionMenu(section: Section, real: boolean, project: ProjectInfo | null, platform: string,
  actions: RowActions): MenuItem[] {
  const isRoot = section.depth === 0
  const folders = project?.folders.length ?? 1
  const items: MenuItem[] = [
    { label: "New Note Here", onClick: () => actions.newNote(section.path) },
    { label: isRoot ? "New Section" : "New Subsection", onClick: () => actions.newSection(section.path) },
  ]
  if (!isRoot) items.push({ label: "Rename…", disabled: !real, onClick: () => actions.renameSection(section) })
  items.push({ label: `Reveal in ${fileManagerName(platform)}`, onClick: () => actions.reveal(section.path), disabled: !real })
  if (!real) return items
  items.push("-")
  if (isRoot) {
    // A project folder is not this app's to trash — it is only in the project because the project says so.
    items.push({
      label: "Remove Folder from Project",
      disabled: folders <= 1,
      onClick: () => actions.run(`removeFolder:${section.path}`),
    })
    // The whole project is looked at (a picture in one folder can be used by a note in another): main/housekeeping.ts.
    items.push("-", { label: "Clean Up Unused Files…", onClick: () => actions.run("cleanUp") })
  } else {
    // A folder can be taken OUT of the project and left where it is — the Trash is for one that should go.
    items.push(
      { label: "Remove Folder from Project", onClick: () => actions.run(`excludeFolder:${section.path}`) },
      { label: `Move to ${trashWord(platform)}…`, onClick: () => actions.trashSection(section) },
    )
  }
  return items
}

const sectionsOf = (section: Section): Section[] => section.sections.flatMap((one) => [one, ...sectionsOf(one)])

/** The right-click menu on a note's row (`SidebarView.noteRow`'s `.contextMenu`). */
export function noteMenu(note: Note, section: Section, root: Section | null, platform: string,
  actions: RowActions): MenuItem[] {
  // Move to: the project's folders, a line, then every section inside them.
  const roots = !root ? [] : root.path === "" ? root.sections : [root]
  const inside = roots.flatMap(sectionsOf)
  const where: MenuItem[] = roots.map((one) => ({ label: one.name, onClick: () => actions.moveNote(note, one.path) }))
  if (inside.length > 0) {
    where.push("-", ...inside.map((one): MenuItem => ({ label: one.name, onClick: () => actions.moveNote(note, one.path) })))
  }
  return [
    { label: "New Note Here", onClick: () => actions.newNote(section.path) },
    { label: "New Section Here", onClick: () => actions.newSection(section.path) },
    "-",
    { label: "Rename…", onClick: () => actions.renameNote(note) },
    { label: "Duplicate", onClick: () => actions.duplicate(note) },
    { label: `Reveal in ${fileManagerName(platform)}`, onClick: () => actions.reveal(note.path) },
    "-",
    { label: "Move to", submenu: where, disabled: where.length === 0 },
    "-",
    { label: `Move to ${trashWord(platform)}…`, onClick: () => actions.trashNote(note) },
  ]
}

/** The right-click menu on the blank part of the list. */
export function listMenu(root: Section | null, project: ProjectInfo | null, platform: string,
  actions: ProjectActions): MenuItem[] {
  const home = project?.folders.find((one) => one.exists)?.path ?? root?.path ?? ""
  return [
    { label: "New Note", onClick: () => actions.newNote(home) },
    { label: "New Section", onClick: () => actions.newSection(home) },
    "-",
    { label: "Add Folder to Project…", onClick: () => actions.run("addFolder") },
    "-",
    { label: `Reveal Folder in ${fileManagerName(platform)}`, onClick: () => actions.reveal(home), disabled: !home },
  ]
}

interface FooterProps {
  platform: string
  root: Section | null
  project: ProjectInfo | null
  actions: ProjectActions
}

/** "12 notes · 3 folders" and the Folder menu (`SidebarView.footer`). */
export function SidebarFooter({ platform, root, project, actions }: FooterProps) {
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null)
  // (A folder inside another project folder shows twice; a note in it is still one note.)
  const notes = root ? distinctNotes(root, platform === "win32") : 0
  const folders = project?.folders.length ?? 1
  // A folder of the project that is not on disk right now (a stick pulled, a folder deleted) still counts as one of the
  // project's, but is not in the list: the footer says so rather than seem to count notes that are not there.
  const gone = (project?.folders ?? []).filter((one) => !one.exists).length
  const others = (project?.folders ?? []).slice(1).filter((one) => one.exists)
  const hidden = (project?.excluded ?? []).filter((one) => one.exists)
  const primary = project?.folders[0]?.path ?? root?.path ?? ""
  const close = useCallback(() => setMenu(null), [])

  const items: MenuItem[] = [
    { label: "Add Folder to Project…", onClick: () => actions.run("addFolder") },
  ]
  // Only folders that are really on disk are offered, to remove or to show again.
  if (others.length > 0) {
    items.push({
      label: "Remove Folder from Project",
      submenu: others.map((one) => ({ label: one.name, onClick: () => actions.run(`removeFolder:${one.path}`) })),
    })
  }
  if (hidden.length > 0) {
    items.push({
      label: "Hidden Folders",
      submenu: hidden.map((one) => ({ label: `Show ${one.name}`, onClick: () => actions.run(`includeFolder:${one.path}`) })),
    })
  }
  items.push("-", {
    label: `Reveal in ${fileManagerName(platform)}`, onClick: () => actions.reveal(primary), disabled: !primary,
  }, "-", { label: "Clean Up Unused Files…", onClick: () => actions.run("cleanUp"), disabled: !primary })

  return (
    <div className="sidebar-footer" data-sidebar="footer">
      <span>{notes === 1 ? "1 note" : `${notes} notes`}</span>
      {folders > 1 && <span>· {folders} folders{gone > 0 && gone < folders ? ` (${gone} not there)` : ""}</span>}
      <div className="spacer" />
      <button className="folder-button" data-sidebar="folder-menu" aria-haspopup="menu"
              aria-expanded={menu !== null} title={primary}
              onMouseDown={(event) => event.preventDefault()}
              onClick={(event) => {
                const box = event.currentTarget.getBoundingClientRect()
                setMenu(menu ? null : { x: box.left, y: box.top })
              }}>
        <svg width="13" height="11" viewBox="0 0 15 13" fill="none" aria-hidden>
          <path d="M0.5 2a1 1 0 0 1 1-1h3l1.4 1.6h6.6a1 1 0 0 1 1 1V11a1 1 0 0 1-1 1h-11a1 1 0 0 1-1-1z"
                stroke="currentColor" />
        </svg>
        Folder
      </button>
      {menu && <FloatingMenu x={menu.x} y={menu.y} above items={items} onClose={close} id="folder-menu" />}
    </div>
  )
}

interface StateProps {
  root: Section | null
  project: ProjectInfo | null
  actions: ProjectActions
}

/** No notes yet (`SidebarView.empty`). */
export function EmptyList({ project, root, actions }: StateProps) {
  const home = project?.folders.find((one) => one.exists)?.path ?? root?.path ?? ""
  return (
    <div className="sidebar-empty" data-sidebar="empty">
      <svg width="30" height="34" viewBox="0 0 12 14" fill="none" aria-hidden>
        <path d="M1.5 1h6l3 3v9h-9z" stroke="currentColor" strokeWidth="0.8" strokeLinejoin="round" />
        <path d="M3.6 7h4.8M3.6 9.4h4.8" stroke="currentColor" strokeWidth="0.8" strokeLinecap="round" />
      </svg>
      <div className="title">No notes yet</div>
      <div className="buttons">
        <button onClick={() => actions.newNote(home)}>New Note</button>
        <button onClick={() => actions.newSection(home)}>New Section</button>
      </div>
    </div>
  )
}

/** The project's folders are not there — a drive that is gone, a project written on another machine. */
export function MissingFolders({ project, actions }: { project: ProjectInfo; actions: ProjectActions }) {
  return (
    <div className="sidebar-empty" data-sidebar="missing">
      <div className="title">Can’t open the notes folder</div>
      {project.folders.map((one) => (
        <div className="path" key={one.path} title={one.path}>{one.path}</div>
      ))}
      <div className="why">
        {project.folders.length === 1 ? "This folder is not there" : "These folders are not there"} — a drive that
        is not connected, or a project that was written on another computer. They are looked for again every few
        seconds, and when the window comes forward.
      </div>
      <div className="buttons">
        <button data-sidebar="check-again" onClick={() => actions.run("checkFolders")}>Check Again</button>
        <button onClick={() => actions.run("addFolder")}>Add Folder to Project…</button>
        <button onClick={() => actions.run("newProject")}>New Project</button>
      </div>
    </div>
  )
}

/** What the bin is called where this runs. */
export const trashWord = (platform: string): string => (platform === "win32" ? "Recycle Bin" : "Trash")
