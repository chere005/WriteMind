/**
 * The tree, flattened to the rows that show — a view that recursed here
 * could not be type-checked on the Mac and would be slower here, and the
 * flat list is what both sides draw.
 *
 * The bar above it reads edit · add section · separator · markdown · video,
 * and NEW NOTE IS NOT ON IT: it is the add row, a box split down the middle
 * at the top of the list and at the top of every section, so the way to make
 * a note is where the note will land.
 */

import { memo, useEffect, useMemo, useRef, useState } from "react"
import { stem, type Note } from "@writemind/core"
import { shown, TABLET_SOURCE } from "../shared/commands"
import { tip } from "./TopBar"
import { FloatingMenu, type MenuItem } from "./FloatingMenu"
import {
  EmptyList, isEmptyTree, listMenu, MissingFolders, noteMenu, sectionMenu, SidebarFooter, trashWord,
  type RowActions,
} from "./SidebarProject"
import { Prompt, type PromptSpec } from "./Prompt"
import { canTrashSection, flatten, newlySeen, rowKeys, sectionAt } from "./sidebarTree"
import type { ProjectInfo, Section } from "./wm"

/**
 * How tall the two icons on the add row are — one number, so they cannot be different heights (Mac 2ea0dcb; Sean:
 * "make the new note and new section icons the same height"). Both shapes are drawn from the top of the box to its
 * bottom: the folder used to stop half a pixel short at each end, a point shorter than the page beside it.
 */
const ADD_ICON_HEIGHT = 13

const PageIcon = () => (
  <svg width="11" height={ADD_ICON_HEIGHT} viewBox="0 0 11 13" fill="none" aria-hidden>
    <rect x="0.5" y="0.5" width="10" height="12" rx="2" stroke="currentColor"
          strokeDasharray="2.5 2" />
    <path d="M5.5 3.8v5M3 6.3h5" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
  </svg>
)

const FolderIcon = () => (
  <svg width="15" height={ADD_ICON_HEIGHT} viewBox="0 0 15 13" fill="none" aria-hidden>
    <path d="M0.5 3.2V11.5a1 1 0 0 0 1 1h9" stroke="currentColor" />
    <path d="M0.5 3.2V1.5a1 1 0 0 1 1-1h3l1.4 1.6h4.6a1 1 0 0 1 1 1v2"
          stroke="currentColor" />
    <path d="M12 7.6v4.4M9.8 9.8h4.4" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
  </svg>
)

const TrashIcon = () => (
  <svg width="12" height="13" viewBox="0 0 12 13" fill="none" aria-hidden>
    <path d="M1 3h10M4.2 3V1.6h3.6V3M2.2 3l.6 8.4h6.4l.6-8.4M4.8 5.2v4M7.2 5.2v4"
          stroke="currentColor" strokeWidth="1.1" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
)

const DuplicateIcon = () => (
  <svg width="13" height="13" viewBox="0 0 13 13" fill="none" aria-hidden>
    <rect x="3.5" y="3.5" width="8" height="8" rx="1.6" stroke="currentColor" strokeWidth="1.1" />
    <path d="M9 1.6H3.1a1.5 1.5 0 0 0-1.5 1.5V9M7.5 5.6v4M5.5 7.6h4"
          stroke="currentColor" strokeWidth="1.1" strokeLinecap="round" />
  </svg>
)

interface Props {
  root: Section | null
  openNote: string | null
  /** Edit mode: duplicate and delete on every row. */
  editing: boolean
  onOpen(note: Note): void
  onNewNote(folder: string): void
  onNewSection(parent: string): void
  /** A note dropped on a row: into that row's folder, at that row's place (null = the end). */
  onPlaceNote(file: string, folder: string, before: string | null): void
  /** A section dropped on a section. */
  onMoveSection(folder: string, target: string): void
  onDuplicate(note: Note): void
  /** The second click on an armed trash button. */
  onTrashNote(note: Note): void
  onTrashSection(section: Section): void
  /**
   * Rename… in the right-click menu: the file keeps its extension; a folder is renamed on disk. A string
   * (or a promise of one) back says why it did not work, and the dialog stays up with it.
   */
  onRenameNote?(note: Note, name: string): void | string | Promise<void | string>
  onRenameSection?(section: Section, name: string): void | string | Promise<void | string>
  header: React.ReactNode
  /** The open project (its folders and the ones hidden), for the footer and the folder menus. */
  project?: ProjectInfo | null
  platform?: string
  /** A command the main process owns: addFolder, removeFolder:<path>, excludeFolder:<path>, includeFolder:<path>. */
  onProjectCommand?(id: string): void
  onReveal?(path: string): void
}

/** What a row being dragged carries. */
const MIME = "application/x-writemind-row"
interface Dragged { kind: "note" | "section"; path: string }

const folderOf = (path: string): string => path.replace(/[\\/][^\\/]*$/, "")
const baseName = (path: string): string => path.split(/[\\/]/).pop() ?? path

/**
 * What a row calls when something happens to it. It is ONE object that lives as long as the sidebar does (a ref), and
 * its members are replaced on every render with ones that see the latest state — so the rows, which are memoised, are
 * given nothing that changes when the list does, and a save that retitles one note no longer renders every row of a
 * 3,000-note list (it was 16 ms of React work and 12,000 DOM nodes touched per save).
 */
interface RowCtx {
  open(note: Note): void
  newNote(folder: string): void
  newSection(parent: string): void
  duplicate(note: Note): void
  arm(key: string | null): void
  trashNote(note: Note): void
  trashSection(path: string, depth: number): void
  toggle(path: string): void
  noteMenu(event: React.MouseEvent, note: Note, sectionPath: string): void
  /** (`depth` says WHICH row: a folder inside another project folder is a row twice, as itself and as a subsection.) */
  sectionMenu(event: React.MouseEvent, path: string, depth: number): void
  dragStart(event: React.DragEvent, item: Dragged): void
  dragEnd(): void
  dragOver(event: React.DragEvent, path: string, mode: "above" | "into"): void
  dropOnNote(event: React.DragEvent, note: Note): void
  dropInto(event: React.DragEvent, folder: string): void
}
type Ctx = { readonly current: RowCtx }

interface NoteRowProps {
  ctx: Ctx
  note: Note
  indent: number
  sectionPath: string
  open: boolean
  dragging: boolean
  over: boolean
  editing: boolean
  armed: boolean
}

const sameNoteRow = (a: NoteRowProps, b: NoteRowProps): boolean =>
  a.note.path === b.note.path && a.note.title === b.note.title && a.note.snippet === b.note.snippet
  && a.indent === b.indent && a.sectionPath === b.sectionPath && a.open === b.open && a.dragging === b.dragging
  && a.over === b.over && a.editing === b.editing && a.armed === b.armed

const TrashButton = ({ ctx, armedNow, id, what, act }: { ctx: Ctx; armedNow: boolean; id: string; what: string; act: () => void }) => (
  <button className={`row-button trash${armedNow ? " armed" : ""}`} data-trash={id}
          title={armedNow ? `Click again to move this ${what} to the Trash` : "Move to Trash (click twice)"}
          onClick={(event) => {
            event.stopPropagation()
            if (armedNow) { ctx.current.arm(null); act() } else ctx.current.arm(id)
          }}><TrashIcon /></button>
)

const NoteRow = memo(function NoteRow({ ctx, note, indent, sectionPath, open, dragging, over, editing, armed }: NoteRowProps) {
  const classes = ["note-row"]
  if (open) classes.push("open")
  if (dragging) classes.push("dragging")
  if (over) classes.push("drop-above")
  return (
    <div role="button" tabIndex={0} className={classes.join(" ")} style={{ paddingLeft: indent * 14 }} data-path={note.path}
         onClick={() => ctx.current.open(note)}
         onContextMenu={(event) => ctx.current.noteMenu(event, note, sectionPath)}
         draggable
         onDragStart={(event) => ctx.current.dragStart(event, { kind: "note", path: note.path })}
         onDragEnd={() => ctx.current.dragEnd()}
         onDragOver={(event) => ctx.current.dragOver(event, note.path, "above")}
         onDrop={(event) => ctx.current.dropOnNote(event, note)}>
      <div className="text">
        <div className="title">{note.title}</div>
        {note.snippet && <div className="snippet">{note.snippet}</div>}
      </div>
      {editing && (
        <span className="row-buttons">
          <button className="row-button" data-duplicate={note.path} title="Duplicate"
                  onClick={(event) => { event.stopPropagation(); ctx.current.duplicate(note) }}>
            <DuplicateIcon />
          </button>
          <TrashButton ctx={ctx} armedNow={armed} id={`note:${note.path}`} what="note" act={() => ctx.current.trashNote(note)} />
        </span>
      )}
    </div>
  )
}, sameNoteRow)

interface SectionRowProps {
  ctx: Ctx
  path: string
  name: string
  /** The section's own depth (0 = a project folder): the same path can be two rows, at two depths. */
  depth: number
  indent: number
  expanded: boolean
  dragging: boolean
  over: boolean
  /** Edit mode on a folder that may go to the Trash. */
  trashable: boolean
  armed: boolean
  count: number
}

const SectionRow = memo(function SectionRow({ ctx, path, name, depth, indent, expanded, dragging, over, trashable, armed, count }: SectionRowProps) {
  const classes = ["section-row"]
  if (dragging) classes.push("dragging")
  if (over) classes.push("drop-into")
  return (
    <div role="button" tabIndex={0} className={classes.join(" ")} style={{ paddingLeft: indent * 14 }} data-path={path}
         onClick={() => ctx.current.toggle(path)}
         onContextMenu={(event) => ctx.current.sectionMenu(event, path, depth)}
         draggable
         onDragStart={(event) => ctx.current.dragStart(event, { kind: "section", path })}
         onDragEnd={() => ctx.current.dragEnd()}
         onDragOver={(event) => ctx.current.dragOver(event, path, "into")}
         onDrop={(event) => ctx.current.dropInto(event, path)}>
      <span className="name">{expanded ? "▾ " : "▸ "}{name}</span>
      {trashable
        ? <TrashButton ctx={ctx} armedNow={armed} id={`section:${path}`} what="section and its notes" act={() => ctx.current.trashSection(path, depth)} />
        : <span className="count">{count}</span>}
    </div>
  )
})

const AddRow = memo(function AddRow({ ctx, path, name, indent }: { ctx: Ctx; path: string; name: string; indent: number }) {
  return (
    <div className="add-row" style={{ paddingLeft: indent * 14 }}>
      <button onClick={() => ctx.current.newNote(path)} title={`New note in ${name}`}>
        <PageIcon /> New note
      </button>
      <div className="split" />
      <button onClick={() => ctx.current.newSection(path)} title={`New section in ${name}`}>
        <FolderIcon /> New section
      </button>
    </div>
  )
})

export function Sidebar({
  root, openNote, editing, onOpen, onNewNote, onNewSection, onPlaceNote, onMoveSection,
  onDuplicate, onTrashNote, onTrashSection, header, project = null, platform = "win32",
  onProjectCommand, onReveal, onRenameNote, onRenameSection,
}: Props) {
  const [menu, setMenu] = useState<{ x: number; y: number; items: MenuItem[] } | null>(null)
  const [prompt, setPrompt] = useState<PromptSpec | null>(null)
  const bin = trashWord(platform)
  const actions: RowActions = {
    run: (id) => onProjectCommand?.(id),
    reveal: (path) => onReveal?.(path),
    newNote: onNewNote,
    newSection: onNewSection,
    renameNote: (note) => setPrompt({
      title: "Rename", message: "The file keeps its extension.", value: stem(note.path), ok: "Rename",
      onSubmit: (name) => onRenameNote?.(note, name),
    }),
    renameSection: (section) => setPrompt({
      title: "Rename", message: "This renames the folder on disk.", value: section.name, ok: "Rename",
      onSubmit: (name) => onRenameSection?.(section, name),
    }),
    duplicate: onDuplicate,
    // A menu item has no second click to give, so it asks (the edit-mode icon arms itself red instead).
    trashNote: (note) => setPrompt({
      title: `Move “${note.title}” to the ${bin}?`, message: `It goes to the ${bin}, where you can put it back.`,
      ok: `Move to ${bin}`, destructive: true, onSubmit: () => onTrashNote(note),
    }),
    trashSection: (section) => setPrompt({
      title: `Move “${section.name}” to the ${bin}?`,
      message: `The folder and every note in it go to the ${bin}, where you can put them back.`,
      ok: `Move to ${bin}`, destructive: true, onSubmit: () => onTrashSection(section),
    }),
    moveNote: (note, folder) => onPlaceNote(note.path, folder, null),
  }
  const missing = project !== null && !project.folders.some((one) => one.exists)
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  // EVERY SECTION STARTS OPEN (the Mac: `.onAppear { expanded = Set(store.allSections.map(.id)) }`, and a section
  // is opened the moment it is made). A section is opened when it first shows up in the tree — at launch, with a
  // project switch, when one is made or moved in — and one the person has closed stays closed, so a restored
  // session's open note is never hidden inside a collapsed section.
  const seen = useRef(new Set<string>())
  useEffect(() => {
    if (!root) return
    const fresh = newlySeen(root, seen.current)
    if (fresh.length === 0) return
    setExpanded((was) => new Set([...was, ...fresh]))
  }, [root])
  const [dragging, setDragging] = useState<Dragged | null>(null)
  const [over, setOver] = useState<{ path: string; mode: "above" | "into" } | null>(null)
  // THE TRASH BUTTON THAT HAS BEEN CLICKED ONCE: red, and the next click on it
  // deletes. There is no dialog — the Trash is the undo — and it disarms on
  // its own after a moment, or when editing ends.
  const [armed, setArmed] = useState<string | null>(null)
  useEffect(() => {
    if (armed === null) return
    const timer = window.setTimeout(() => setArmed(null), 4000)
    return () => window.clearTimeout(timer)
  }, [armed])
  useEffect(() => { if (!editing) setArmed(null) }, [editing])

  const toggle = (path: string) => {
    setExpanded((was) => {
      const next = new Set(was)
      if (next.has(path)) next.delete(path)
      else next.add(path)
      return next
    })
  }

  const rows = useMemo(() => (root ? flatten(root, expanded) : []), [root, expanded])
  // The number a folder shows is worked out once per tree, not once per render of a row.
  const counts = useMemo(() => {
    const out = new Map<string, number>()
    const walk = (section: Section): number => {
      const total = section.notes.length + section.sections.reduce((sum, one) => sum + walk(one), 0)
      out.set(section.path, total)
      return total
    }
    if (root) walk(root)
    return out
  }, [root])

  const carried = (event: React.DragEvent): Dragged | null => {
    try {
      const raw = event.dataTransfer.getData(MIME)
      if (raw) return JSON.parse(raw) as Dragged
    } catch { /* not ours */ }
    return dragging
  }
  const accepts = (event: React.DragEvent) => event.dataTransfer.types.includes(MIME)
  const end = () => { setDragging(null); setOver(null) }

  /** A drop on a note row: the dragged note takes this row's place. */
  const dropOnNote = (event: React.DragEvent, note: Note) => {
    const item = carried(event)
    end()
    if (!item) return
    event.preventDefault()
    event.stopPropagation()
    if (item.kind === "note") {
      if (item.path !== note.path) onPlaceNote(item.path, folderOf(note.path), baseName(note.path))
    } else {
      onMoveSection(item.path, folderOf(note.path))
    }
  }

  /** A drop on a section row, or on the blank list (the root): into it. */
  const dropInto = (event: React.DragEvent, folder: string) => {
    const item = carried(event)
    end()
    if (!item) return
    event.preventDefault()
    event.stopPropagation()
    if (item.kind === "note") onPlaceNote(item.path, folder, null)
    else onMoveSection(item.path, folder)
  }

  // What the rows call. Rebuilt every render (it sees this render's state); the rows hold the ref, not its members.
  const latest: RowCtx = {
    open: onOpen,
    newNote: onNewNote,
    newSection: onNewSection,
    duplicate: onDuplicate,
    arm: setArmed,
    trashNote: onTrashNote,
    trashSection: (path, depth) => { const section = sectionAt(root, path, depth); if (section) onTrashSection(section) },
    toggle,
    noteMenu: (event, note, sectionPath) => {
      event.preventDefault()
      event.stopPropagation()
      const section = sectionAt(root, sectionPath)
      if (section) setMenu({ x: event.clientX, y: event.clientY, items: noteMenu(note, section, root, platform, actions) })
    },
    sectionMenu: (event, path, depth) => {
      event.preventDefault()
      event.stopPropagation()
      const { clientX: x, clientY: y } = event
      const section = sectionAt(root, path, depth)
      if (!section) return
      // Asked now, at the right-click: a folder Explorer took since the last read is not real.
      void window.wm.existing([path]).then((found) => {
        setMenu({ x, y, items: sectionMenu(section, found.length > 0, project, platform, actions) })
      })
    },
    dragStart: (event, item) => {
      event.dataTransfer.setData(MIME, JSON.stringify(item))
      event.dataTransfer.effectAllowed = "move"
      setDragging(item)
    },
    dragEnd: end,
    dragOver: (event, path, mode) => {
      if (!accepts(event)) return
      event.preventDefault()
      event.stopPropagation()
      if (over?.path !== path) setOver({ path, mode })
    },
    dropOnNote,
    dropInto,
  }
  const ctxRef = useRef<RowCtx>(latest)
  ctxRef.current = latest

  // (Memoised on what a row is made from: a render for any other reason — a word count, a clock — makes no rows.)
  const list = useMemo(() => {
    // (A key is the row's own name made unique among the rows: the same folder or note can be in the list twice.)
    const keys = rowKeys(rows)
    return rows.map((row, index) => {
      // A project of several folders has no folder of its own to add to.
      if (row.kind === "add") {
        if (row.section.path === "") return null
        return <AddRow key={keys[index]} ctx={ctxRef} path={row.section.path} name={row.section.name} indent={row.indent} />
      }
      if (row.kind === "section") {
        const path = row.section.path
        return (
          <SectionRow key={keys[index]} ctx={ctxRef} path={path} name={row.section.name} depth={row.section.depth} indent={row.indent}
                      expanded={expanded.has(path)} dragging={dragging?.path === path} over={over?.path === path}
                      trashable={editing && canTrashSection(row.section)} armed={armed === `section:${path}`}
                      count={counts.get(path) ?? 0} />
        )
      }
      const note = row.note
      return (
        <NoteRow key={keys[index]} ctx={ctxRef} note={note} indent={row.indent} sectionPath={row.section.path}
                 open={note.path === openNote} dragging={dragging?.path === note.path} over={over?.path === note.path}
                 editing={editing} armed={armed === `note:${note.path}`} />
      )
    })
  }, [rows, counts, expanded, dragging, over, editing, armed, openNote])

  return (
    <div className="sidebar">
      {header}
      {missing && project ? <MissingFolders project={project} actions={actions} />
        : isEmptyTree(root) && root ? <EmptyList root={root} project={project} actions={actions} /> : (
      <div className={`rows${over?.path === "" ? " drop-root" : ""}`}
           onContextMenu={(event) => {
             // The blank part of the list (a row's own menu stops here).
             if ((event.target as Element).closest(".section-row, .note-row")) return
             event.preventDefault()
             setMenu({ x: event.clientX, y: event.clientY, items: listMenu(root, project, platform, actions) })
           }}
           onDragOver={(event) => {
             if (!accepts(event)) return
             event.preventDefault()
             if (over?.path !== "") setOver({ path: "", mode: "into" })
           }}
           onDragLeave={(event) => {
             if (event.currentTarget === event.target) setOver(null)
           }}
           onDrop={(event) => { if (root && root.path !== "") dropInto(event, root.path) }}>
        {list}
      </div>
        )}
      <SidebarFooter platform={platform} root={root} project={project} actions={actions} />
      {menu && <FloatingMenu x={menu.x} y={menu.y} items={menu.items} onClose={() => setMenu(null)} id="sidebar-menu" />}
      {prompt && <Prompt spec={prompt} onClose={() => setPrompt(null)} />}
    </div>
  )
}

// MARK: - The bar over the list

const SlidersIcon = () => (
  <svg width="14" height="12" viewBox="0 0 14 12" fill="none" aria-hidden>
    <path d="M1 3h12M1 9h12" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
    <circle cx="4.5" cy="3" r="1.7" fill="var(--wm-chrome)" stroke="currentColor" strokeWidth="1.2" />
    <circle cx="9.5" cy="9" r="1.7" fill="var(--wm-chrome)" stroke="currentColor" strokeWidth="1.2" />
  </svg>
)

const CheckIcon = () => (
  <svg width="13" height="12" viewBox="0 0 13 12" fill="none" aria-hidden>
    <path d="M1.5 6.5l3.4 3.4L11.5 2.5" stroke="currentColor" strokeWidth="1.6"
          strokeLinecap="round" strokeLinejoin="round" />
  </svg>
)

const DocIcon = ({ rich }: { rich: boolean }) => (
  <svg width="12" height="14" viewBox="0 0 12 14" fill="none" aria-hidden>
    <path d="M1.5 1h6l3 3v9h-9z" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round" />
    {rich
      ? <path d="M3.6 6.2h4.8M3.6 8.4h4.8M3.6 10.6h3" stroke="currentColor" strokeWidth="1.1" strokeLinecap="round" />
      : <path d="M3.6 7h4.8M3.6 9.4h4.8" stroke="currentColor" strokeWidth="1.1" strokeLinecap="round" opacity="0.7" />}
  </svg>
)

const VideoIcon = ({ on }: { on: boolean }) => (
  <svg width="16" height="12" viewBox="0 0 16 12" fill="none" aria-hidden>
    <rect x="0.8" y="1.8" width="9.4" height="8.4" rx="1.8" stroke="currentColor" strokeWidth="1.2"
          fill={on ? "currentColor" : "none"} />
    <path d="M10.6 5l4-2.2v6.4l-4-2.2z" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round"
          fill={on ? "currentColor" : "none"} />
    {!on && <path d="M1 11.5L15 .5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />}
  </svg>
)

export interface SidebarBarProps {
  platform: string
  editing: boolean
  onEditing(on: boolean): void
  onNewSection(): void
  newSectionIn: string
  rendered: boolean
  hasNote: boolean
  onToggleRendered(): void
  camera: boolean
  onToggleCamera(): void
  cameras: { id: string; name: string }[]
  cameraId: string | null
  onPickCamera(id: string): void
  onCameraOff(): void
  onRefreshCameras(): void
  /** The notes pane is showing, and the video menu's way to put it away (the Mac's "Whole Screen"; here it is the window, never the display). */
  notesPane?: boolean
  onToggleNotesPane?(): void
}

/**
 * The bar over the list — the Mac's `SidebarView.header`: a spacer, Edit
 * Notes, New Section, a separator, the markdown toggle and the video's
 * switch, right-aligned, 44 points tall. New Note is not here: it is the
 * add row at the top of the list and of every section. The sidebar's own
 * switch is not here either: it is the first button of the text bar.
 */
export function SidebarBar(props: SidebarBarProps) {
  const [videoMenu, setVideoMenu] = useState(false)
  useEffect(() => {
    if (!videoMenu) return
    const close = () => setVideoMenu(false)
    window.addEventListener("pointerdown", close)
    return () => window.removeEventListener("pointerdown", close)
  }, [videoMenu])
  const { platform, editing, camera } = props
  return (
    <div className="sidebar-bar">
      <div className="spacer" />
      <button className={`icon-button${editing ? " on" : ""}`} data-bar="edit"
              aria-label={editing ? "Done Editing" : "Edit Notes"} aria-pressed={editing}
              title={tip(editing ? "Done Editing" : "Edit Notes", "", editing ? "Done" : "Duplicate and delete")}
              onClick={() => props.onEditing(!editing)}>
        {editing ? <CheckIcon /> : <SlidersIcon />}
      </button>
      <button className="icon-button" data-bar="new-section" aria-label="New Section"
              title={tip("New Section", "", `New section in ${props.newSectionIn}`)}
              onClick={props.onNewSection}><FolderIcon /></button>
      <div className="bar-divider" />
      <button className={`icon-button${props.rendered ? " on" : ""}`} data-bar="markdown"
              disabled={!props.hasNote}
              aria-label={props.rendered ? "Rendered" : "Markdown"} aria-pressed={props.rendered}
              title={tip(props.rendered ? "Rendered" : "Markdown", shown("toggleMode", platform),
                props.rendered ? "Showing the note rendered — click for the markdown behind it"
                  : "Showing the markdown — click to render it and go on typing")}
              onClick={props.onToggleRendered}><DocIcon rich={props.rendered} /></button>
      {/* A PANE'S SWITCH LIVES ON A DIFFERENT PANE: the video's is here, and
          its chevron lists the cameras, as the Input Devices menu does. */}
      <span className={`bar-split${camera ? " on" : ""}`}>
        <button className={`icon-button${camera ? " on" : ""}`} data-bar="video"
                aria-label={camera ? "Hide Video" : "Show Video"} aria-pressed={camera}
                title={tip(camera ? "Hide Video" : "Show Video", shown("toggleCamera", platform),
                  camera ? "Put the camera pane away" : "Bring the camera pane back")}
                onClick={props.onToggleCamera}><VideoIcon on={camera} /></button>
        <button className="icon-button chevron-button" data-bar="video-options" aria-label="Video Options"
                title={tip("Video Options", "", "Which camera (or the tablet), and turning it off")}
                onPointerDown={(event) => event.stopPropagation()}
                onClick={() => setVideoMenu((was) => !was)}>▾</button>
        {videoMenu && (
          <div className="video-pop" onPointerDown={(event) => event.stopPropagation()}>
            {props.cameras.length === 0 && <div className="none">No cameras found</div>}
            {props.cameras.map((one) => (
              <button key={one.id} onClick={() => { props.onPickCamera(one.id); setVideoMenu(false) }}>
                <span className="tick">{props.cameraId === one.id ? "✓" : ""}</span>{one.name}
              </button>
            ))}
            <button data-source="tablet" onClick={() => { props.onPickCamera(TABLET_SOURCE); setVideoMenu(false) }}>
              <span className="tick">{props.cameraId === TABLET_SOURCE ? "✓" : ""}</span>Tablet
            </button>
            <hr />
            <button disabled={props.cameraId === null}
                    onClick={() => { props.onCameraOff(); setVideoMenu(false) }}>
              <span className="tick" />Turn Camera Off
            </button>
            <button onClick={() => { props.onRefreshCameras() }}>
              <span className="tick" />Refresh Device List
            </button>
            {/* The Mac's "Picture" panel: turn it, put it back to its own size, zoom into a box. The pane owns the picture. */}
            <hr />
            {([
              ["turn-left", "Turn Left", "A quarter turn anticlockwise", false],
              ["turn-right", "Turn Right", "A quarter turn clockwise", false],
              ["original-size", "Original Size", "The whole camera picture again, at the size it comes in", false],
              ["resize-by-square", "Resize by Square", "Drag a box on the picture and the pane shows just that much", true],
            ] as const).map(([action, label, help, close]) => (
              <button key={action} data-camera-action={action} title={help}
                      disabled={props.cameraId === null || props.cameraId === TABLET_SOURCE}
                      onClick={() => {
                        window.dispatchEvent(new CustomEvent("wm:camera-action", { detail: action }))
                        // Turning is done two or three times in a row: the panel stays up. A box is finished on the picture.
                        if (close) setVideoMenu(false)
                      }}>
                <span className="tick" />{label}
              </button>
            ))}
            {props.onToggleNotesPane && (
              <>
                <hr />
                <button data-camera-action="notes-pane" disabled={!camera}
                        title={props.notesPane === false ? "The notes and the video side by side again" : "Put the notes away and give the window to the video"}
                        onClick={() => { props.onToggleNotesPane?.(); setVideoMenu(false) }}>
                  <span className="tick" />{props.notesPane === false ? "Back to Side by Side" : "Video Only (Hide Notes Pane)"}
                </button>
              </>
            )}
          </div>
        )}
      </span>
    </div>
  )
}
