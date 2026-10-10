/**
 * The project's side of the sidebar (`SidebarView.swift`): the footer with its
 * project menu, the right-click menus on a folder, a note and the blank list, and
 * the two states a list can have instead of rows — nothing in it yet, and a
 * project whose folders are not there.
 *
 * ONE PLACE FOR THE PROJECT (docs/PLAN-bars-2026-10.md, P3): the footer's project button opens a menu that has
 * everything the menu bar's Project menu has (Add Folder, Remove Folder, Save, Save As, Open, New) and the sidebar's own
 * (Hidden Sections, Reveal, Clean Up). It was a "Folder" button with half of that.
 *
 * "Remove Folder from Project" is offered ONLY for a folder that is really on
 * disk at the moment the menu opens (Sean, 2026-09-19: "remove folder on
 * project only if it's a real folder that exists"): hiding a ghost would only
 * put its path in `excluded` for good.
 */

import { useCallback, useState } from "react"
import type { Note } from "@writemind/core"
import { shown } from "../shared/commands"
import { FloatingMenu, type MenuItem } from "./FloatingMenu"
import { Icon } from "./icons"
import { distinctNotes, moveTargets } from "./sidebarTree"
import type { ProjectInfo, Section } from "./wm"

export const fileManagerName = (platform: string): string =>
  platform === "darwin" ? "Finder" : platform === "win32" ? "Explorer" : "the file manager"

const countNotes = (section: Section): number =>
  section.notes.length + section.sections.reduce((sum, one) => sum + countNotes(one), 0)

export const isEmptyTree = (root: Section | null): boolean =>
  !root || (root.notes.length === 0 && root.sections.every((one) => countNotes(one) === 0 && one.sections.length === 0))

/** What a row can do beyond the project (the Mac's row menus): rename, duplicate, move and the Trash. */
export interface RowActions extends ProjectActions {
  open(note: Note): void
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
 * The right-click menu on a folder row (and its ⋯). `isRoot` is a project folder (a row of depth 0 in a project of
 * several), anything else is a section inside one. `real` is whether the folder is on disk right now. A new section
 * is "New Section" on a project folder and in a section alike: one label, one meaning.
 */
export function sectionMenu(section: Section, real: boolean, project: ProjectInfo | null, platform: string,
  actions: RowActions): MenuItem[] {
  const isRoot = section.depth === 0
  const folders = project?.folders.length ?? 1
  const items: MenuItem[] = [
    { label: "New Note Here", onClick: () => actions.newNote(section.path) },
    { label: "New Section", dataBar: "new-section", onClick: () => actions.newSection(section.path) },
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
      { label: `Move to ${trashWord(platform)}…`, danger: true, onClick: () => actions.trashSection(section) },
    )
  }
  return items
}

/**
 * The right-click menu on a note's row, and on a search result (`SidebarView.noteRow`'s `.contextMenu`, as the wireframe
 * draws it): Open, Rename…, Duplicate, Move to ▸, Reveal, Move to Trash…. Move to lists the project's folders and every
 * section in the tree's own order, each indented to the depth it has there, and greys the note's own section (it is where
 * the note already is).
 */
export function noteMenu(note: Note, root: Section | null, platform: string, actions: RowActions): MenuItem[] {
  const where: MenuItem[] = moveTargets(root, note.path, platform === "win32").map((target): MenuItem => ({
    label: target.name,
    icon: "folder",
    disabled: target.here,
    labelStyle: target.depth > 0 ? { paddingLeft: target.depth * 12 } : undefined,
    onClick: () => actions.moveNote(note, target.path),
  }))
  return [
    { label: "Open", onClick: () => actions.open(note) },
    { label: "Rename…", onClick: () => actions.renameNote(note) },
    { label: "Duplicate", onClick: () => actions.duplicate(note) },
    { label: "Move to", submenu: where, disabled: where.length === 0 },
    "-",
    { label: `Reveal in ${fileManagerName(platform)}`, onClick: () => actions.reveal(note.path) },
    "-",
    { label: `Move to ${trashWord(platform)}…`, danger: true, onClick: () => actions.trashNote(note) },
  ]
}

/** The right-click menu on the blank part of the list. */
export function listMenu(root: Section | null, project: ProjectInfo | null, platform: string,
  actions: ProjectActions): MenuItem[] {
  const home = project?.folders.find((one) => one.exists)?.path ?? root?.path ?? ""
  return [
    { label: "New Note", onClick: () => actions.newNote(home) },
    { label: "New Section", dataBar: "new-section", onClick: () => actions.newSection(home) },
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

/**
 * The project menu: every item of the menu bar's Project menu (the same commands, so the keys shown are the keys that
 * work), then what only the sidebar knows — the folders hidden from it, where the project is on disk, Clean Up.
 */
export function projectMenu(platform: string, project: ProjectInfo | null, root: Section | null, actions: ProjectActions): MenuItem[] {
  const folders = (project?.folders ?? []).filter((one) => one.exists)
  const hidden = (project?.excluded ?? []).filter((one) => one.exists)
  const primary = project?.folders[0]?.path ?? root?.path ?? ""
  const items: MenuItem[] = [
    { label: "Add Folder to Project…", hint: shown("addFolder", platform), onClick: () => actions.run("addFolder") },
  ]
  // As the menu bar's Remove Folder: every folder that is there, greyed while it is the only one.
  if (folders.length > 0) {
    items.push({
      label: "Remove Folder from Project",
      disabled: folders.length <= 1,
      submenu: folders.map((one) => ({ label: one.name, onClick: () => actions.run(`removeFolder:${one.path}`) })),
    })
  }
  if (hidden.length > 0) {
    items.push({
      label: "Hidden Sections",
      submenu: hidden.map((one) => ({ label: `Show ${one.name}`, onClick: () => actions.run(`includeFolder:${one.path}`) })),
    })
  }
  items.push(
    "-",
    { label: "Save Project", hint: shown("saveProject", platform), onClick: () => actions.run("saveProject") },
    { label: "Save Project As…", onClick: () => actions.run("saveProjectAs") },
    { label: "Open Project…", onClick: () => actions.run("openProject") },
    { label: "New Project", onClick: () => actions.run("newProject") },
    "-",
    { label: `Reveal in ${fileManagerName(platform)}`, onClick: () => actions.reveal(primary), disabled: !primary },
    { label: "Clean Up Unused Files…", onClick: () => actions.run("cleanUp"), disabled: !primary },
  )
  return items
}

/** The project's name with its menu, and how many notes it holds (`SidebarView.footer`). */
export function SidebarFooter({ platform, root, project, actions }: FooterProps) {
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null)
  // (A folder inside another project folder shows twice; a note in it is still one note.)
  const notes = root ? distinctNotes(root, platform === "win32") : 0
  const folders = project?.folders.length ?? 1
  // A folder of the project that is not on disk right now (a stick pulled, a folder deleted) still counts as one of the
  // project's, but is not in the list: the footer says so rather than seem to count notes that are not there.
  const gone = (project?.folders ?? []).filter((one) => !one.exists).length
  const primary = project?.folders[0]?.path ?? root?.path ?? ""
  const name = project?.name ?? root?.name ?? "Notes"
  const close = useCallback(() => setMenu(null), [])
  const items = projectMenu(platform, project, root, actions)

  return (
    <div className="sidebar-footer" data-sidebar="footer">
      <button className="bar-btn menu label folder-button" data-sidebar="folder-menu" aria-haspopup="menu"
              aria-expanded={menu !== null} title={`${name}\n${primary}`}
              onMouseDown={(event) => event.preventDefault()}
              onClick={(event) => {
                const box = event.currentTarget.getBoundingClientRect()
                setMenu(menu ? null : { x: box.left, y: box.top })
              }}>
        <Icon name="folder" size={15} />
        <span className="project-name">{name}</span>
      </button>
      <div className="spacer" />
      <span className="note-count" data-sidebar="count">
        {notes === 1 ? "1 note" : `${notes} notes`}
        {folders > 1 && ` · ${folders} folders${gone > 0 && gone < folders ? ` (${gone} not there)` : ""}`}
      </span>
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
