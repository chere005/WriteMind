/**
 * The notes list: the tree flattened to the rows that show — a view that recursed here could not be type-checked on the
 * Mac and would be slower here, and the flat list is what both sides draw — and, over it, the search.
 *
 * THE BAR (36px, after the macOS traffic lights; docs/PLAN-bars-2026-10.md P3, Sean 2026-10-10: "i like the side bar...
 * make the section flow better but keep the overall sidebar ux"): a search field, + (New Note; its corner triangle, a
 * half-second hold or a right-click open New Note / New Section) and the pencil, which is today's edit mode (Sean:
 * "yes sidebar pencil for edit"). The markdown and video buttons are not here any more: they are the tab row's, to the right
 * of the sidebar's own button, whether the sidebar is open or shut (Sean: "keep the rendered and video buttons to the right
 * of the sidebar always").
 *
 * NEW NOTE IS ALSO THE ADD ROW, one quiet row at the top of the list and of every section (Sean, 2026-09-21: "a small
 * entry that looks like a note, where the note will land"). It is a drop target: a row dropped on it moves into that section,
 * at the top, where a new note would land.
 *
 * SEARCH replaces the tree while there is a query: each result is a note's title, the section it is in and one line with the
 * match marked (main/notesSearch.ts does the work, off the page). The arrow keys walk the results, Enter opens one and puts
 * the Find bar on the words at the first match, Escape clears and gives the keyboard back to the notes.
 */

import { memo, useEffect, useMemo, useRef, useState } from "react"
import { stem, type Note } from "@writemind/core"
import { shown } from "../shared/commands"
import type { FoundNote, SearchOutcome } from "../shared/search"
import { FloatingMenu, type MenuItem } from "./FloatingMenu"
import { Icon } from "./icons"
import { MenuButton } from "./MenuButton"
import {
  EmptyList, isEmptyTree, listMenu, MissingFolders, noteMenu, sectionMenu, SidebarFooter, trashWord,
  type RowActions,
} from "./SidebarProject"
import { Prompt, type PromptSpec } from "./Prompt"
import { returnFocus } from "./focusReturn"
import {
  addRowDrop, canTrashSection, flatten, newlySeen, rowKeys, sectionAt, stepResult, type DraggedRow,
} from "./sidebarTree"
import { useNoteSearch } from "./useNoteSearch"
import type { ProjectInfo, Section } from "./wm"

interface Props {
  root: Section | null
  openNote: string | null
  /** Edit mode (the pencil): duplicate and delete on every row. */
  editing: boolean
  onEditing(on: boolean): void
  /** The folder + (and the empty list's buttons) work in: the open note's own, else the project's. "" when none is there. */
  newIn: string
  onOpen(note: Note): void
  /** A search result opened: the page puts the Find bar on `hit`'s words at the first match. */
  onOpenFound(note: Note, hit: FoundNote, typed: string): void
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
  /** Search Notes (⇧⌘F) was asked for: the field takes the keyboard, and `onSearchTaken` says it did. */
  searchAsk: boolean
  onSearchTaken(): void
  /** The open project (its folders and the ones hidden), for the footer and the folder menus. */
  project?: ProjectInfo | null
  platform?: string
  /** A command the main process owns: addFolder, removeFolder:<path>, excludeFolder:<path>, includeFolder:<path>. */
  onProjectCommand?(id: string): void
  onReveal?(path: string): void
}

/** What a row being dragged carries. */
const MIME = "application/x-writemind-row"
type Dragged = DraggedRow

const folderOf = (path: string): string => path.replace(/[\\/][^\\/]*$/, "")
const baseName = (path: string): string => path.split(/[\\/]/).pop() ?? path

/** A tooltip: the name, its key, and what it does. */
const titled = (label: string, keys: string, help: string): string => `${label}${keys ? `  (${keys})` : ""}\n${help}`

/**
 * What a row calls when something happens to it. It is ONE object that lives as long as the sidebar does (a ref), and
 * its members are replaced on every render with ones that see the latest state — so the rows, which are memoised, are
 * given nothing that changes when the list does, and a save that retitles one note no longer renders every row of a
 * 3,000-note list (it was 16 ms of React work and 12,000 DOM nodes touched per save).
 */
interface RowCtx {
  open(note: Note): void
  newNote(folder: string): void
  duplicate(note: Note): void
  arm(key: string | null): void
  trashNote(note: Note): void
  trashSection(path: string, depth: number): void
  toggle(path: string): void
  /** (`x`, `y` is where the menu opens: the pointer for a right-click, the ⋯ button's corner.) */
  noteMenu(x: number, y: number, note: Note): void
  /** (`depth` says WHICH row: a folder inside another project folder is a row twice, as itself and as a subsection.) */
  sectionMenu(x: number, y: number, path: string, depth: number): void
  dragStart(event: React.DragEvent, item: Dragged): void
  dragEnd(): void
  dragOver(event: React.DragEvent, path: string, mode: "above" | "into" | "add"): void
  dropOnNote(event: React.DragEvent, note: Note): void
  dropInto(event: React.DragEvent, folder: string): void
  dropOnAdd(event: React.DragEvent, path: string, depth: number): void
}
type Ctx = { readonly current: RowCtx }

/** Where a ⋯ button opens its menu: under its left edge. */
const under = (button: HTMLElement): { x: number; y: number } => {
  const box = button.getBoundingClientRect()
  return { x: box.left, y: box.bottom + 2 }
}

const MoreButton = ({ open }: { open(x: number, y: number): void }) => (
  <button type="button" className="row-more" data-row="more" tabIndex={-1} aria-haspopup="menu" aria-label="More"
          title="More"
          onClick={(event) => { event.stopPropagation(); const at = under(event.currentTarget); open(at.x, at.y) }}
          onDoubleClick={(event) => event.stopPropagation()}>
    <Icon name="more" size={14} />
  </button>
)

interface NoteRowProps {
  ctx: Ctx
  note: Note
  indent: number
  open: boolean
  dragging: boolean
  over: boolean
  editing: boolean
  armed: boolean
}

const sameNoteRow = (a: NoteRowProps, b: NoteRowProps): boolean =>
  a.note.path === b.note.path && a.note.title === b.note.title && a.note.snippet === b.note.snippet
  && a.indent === b.indent && a.open === b.open && a.dragging === b.dragging
  && a.over === b.over && a.editing === b.editing && a.armed === b.armed

const TrashButton = ({ ctx, armedNow, id, what, act }: { ctx: Ctx; armedNow: boolean; id: string; what: string; act: () => void }) => (
  <button className={`row-button trash${armedNow ? " armed" : ""}`} data-trash={id}
          title={armedNow ? `Click again to move this ${what} to the Trash` : "Move to Trash (click twice)"}
          onClick={(event) => {
            event.stopPropagation()
            if (armedNow) { ctx.current.arm(null); act() } else ctx.current.arm(id)
          }}><Icon name="trash" size={14} /></button>
)

/** A row is a button: Enter and Space press it, and the menu key (or Shift+F10) opens its menu where it stands. */
function rowPress(event: React.KeyboardEvent<HTMLElement>, press: () => void, menu: (x: number, y: number) => void): void {
  if (event.target !== event.currentTarget) return
  if (event.key === "Enter" || event.key === " ") { event.preventDefault(); press() }
  else if (event.key === "ContextMenu" || (event.key === "F10" && event.shiftKey)) {
    event.preventDefault()
    const box = event.currentTarget.getBoundingClientRect()
    menu(box.left + 24, box.bottom - 4)
  }
}

const NoteRow = memo(function NoteRow({ ctx, note, indent, open, dragging, over, editing, armed }: NoteRowProps) {
  const classes = ["note-row"]
  if (open) classes.push("open")
  if (dragging) classes.push("dragging")
  if (over) classes.push("drop-above")
  const menu = (x: number, y: number) => ctx.current.noteMenu(x, y, note)
  return (
    <div role="button" tabIndex={0} className={classes.join(" ")} style={{ paddingLeft: 8 + indent * 16 }} data-path={note.path}
         onClick={() => ctx.current.open(note)}
         onKeyDown={(event) => rowPress(event, () => ctx.current.open(note), menu)}
         onContextMenu={(event) => { event.preventDefault(); event.stopPropagation(); menu(event.clientX, event.clientY) }}
         draggable
         onDragStart={(event) => ctx.current.dragStart(event, { kind: "note", path: note.path })}
         onDragEnd={() => ctx.current.dragEnd()}
         onDragOver={(event) => ctx.current.dragOver(event, note.path, "above")}
         onDrop={(event) => ctx.current.dropOnNote(event, note)}>
      <Icon name="doc" size={15} className="row-icon" />
      <div className="text">
        <div className="title" title={note.title}>{note.title}</div>
        {note.snippet && <div className="snippet">{note.snippet}</div>}
      </div>
      {editing ? (
        <span className="row-buttons">
          <button className="row-button" data-duplicate={note.path} title="Duplicate"
                  onClick={(event) => { event.stopPropagation(); ctx.current.duplicate(note) }}>
            <Icon name="dup" size={14} />
          </button>
          <TrashButton ctx={ctx} armedNow={armed} id={`note:${note.path}`} what="note" act={() => ctx.current.trashNote(note)} />
        </span>
      ) : <MoreButton open={menu} />}
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
  const menu = (x: number, y: number) => ctx.current.sectionMenu(x, y, path, depth)
  return (
    <div role="button" tabIndex={0} className={classes.join(" ")} style={{ paddingLeft: 4 + indent * 16 }} data-path={path}
         aria-expanded={expanded}
         onClick={() => ctx.current.toggle(path)}
         onKeyDown={(event) => rowPress(event, () => ctx.current.toggle(path), menu)}
         onContextMenu={(event) => { event.preventDefault(); event.stopPropagation(); menu(event.clientX, event.clientY) }}
         draggable
         onDragStart={(event) => ctx.current.dragStart(event, { kind: "section", path })}
         onDragEnd={() => ctx.current.dragEnd()}
         onDragOver={(event) => ctx.current.dragOver(event, path, "into")}
         onDrop={(event) => ctx.current.dropInto(event, path)}>
      <Icon name={expanded ? "chev" : "chevr"} size={12} className="disclosure" />
      <Icon name="folder" size={15} className="row-icon" />
      <span className="name">{name}</span>
      {trashable
        ? <TrashButton ctx={ctx} armedNow={armed} id={`section:${path}`} what="section and its notes" act={() => ctx.current.trashSection(path, depth)} />
        : <><span className="count">{count}</span><MoreButton open={menu} /></>}
    </div>
  )
})

const AddRow = memo(function AddRow({ ctx, path, depth, name, indent, over }: { ctx: Ctx; path: string; depth: number; name: string; indent: number; over: boolean }) {
  return (
    <button type="button" className={`add-row${over ? " drop-over" : ""}`} style={{ paddingLeft: 8 + indent * 16 }}
            data-add={path} title={`New note in ${name}`}
            onClick={() => ctx.current.newNote(path)}
            onDragOver={(event) => ctx.current.dragOver(event, path, "add")}
            onDrop={(event) => ctx.current.dropOnAdd(event, path, depth)}>
      <Icon name="plus" size={14} />
      New note
    </button>
  )
})

/** The words with the match marked. */
function Marked({ text, mark }: { text: string; mark: { from: number; to: number } | null }) {
  if (!mark || mark.to <= mark.from) return <>{text}</>
  return <>{text.slice(0, mark.from)}<mark>{text.slice(mark.from, mark.to)}</mark>{text.slice(mark.to)}</>
}

/** The row a search result stands for, so the menus and Open can work on it. */
const noteOfHit = (hit: FoundNote): Note => ({ path: hit.path, modified: hit.modified, title: hit.title, snippet: hit.snippet.text })

interface ResultsProps {
  outcome: SearchOutcome | null
  busy: boolean
  query: string
  openNote: string | null
  active: string | null
  onActive(path: string | null): void
  onOpen(hit: FoundNote): void
  onMenu(event: { x: number; y: number }, hit: FoundNote): void
}

/** What the list shows while there is a query. */
function Results({ outcome, busy, query, openNote, active, onActive, onOpen, onMenu }: ResultsProps) {
  const list = useRef<HTMLDivElement>(null)
  // The result the arrow keys are on stays in view.
  useEffect(() => {
    if (active === null) return
    for (const row of list.current?.querySelectorAll<HTMLElement>("[data-hit]") ?? []) {
      if (row.dataset.hit === active) { row.scrollIntoView({ block: "nearest" }); break }
    }
  }, [active])
  const hits = outcome?.hits ?? []
  return (
    <div className="results" id="sidebar-results" ref={list} role="listbox" aria-label="Search results" aria-busy={busy} data-sidebar="results">
      {hits.map((hit) => (
        <div key={hit.path} role="option" id={`hit-${hit.path}`} aria-selected={hit.path === active}
             className={`hit-row${hit.path === active ? " active" : ""}${hit.path === openNote ? " open" : ""}`}
             data-hit={hit.path}
             onMouseMove={() => { if (hit.path !== active) onActive(hit.path) }}
             onClick={() => onOpen(hit)}
             onContextMenu={(event) => { event.preventDefault(); onMenu({ x: event.clientX, y: event.clientY }, hit) }}>
          <Icon name="doc" size={15} className="row-icon" />
          <div className="text">
            <div className="title" title={hit.title}><Marked text={hit.title} mark={hit.titleMark} /></div>
            {hit.snippet.text && <div className="snippet"><Marked text={hit.snippet.text} mark={hit.snippet.mark} /></div>}
            <div className="where"><Icon name="folder" size={11} /><span>{hit.where}</span></div>
          </div>
          <MoreButton open={(x, y) => onMenu({ x, y }, hit)} />
        </div>
      ))}
      {hits.length === 0 && (outcome === null || outcome.query !== query) && busy && <div className="status" data-sidebar="searching">Searching…</div>}
      {hits.length === 0 && outcome !== null && outcome.query === query && (
        <div className="status" data-sidebar="no-matches" role="status">No notes match “{query}”.</div>
      )}
      {outcome !== null && outcome.more && <div className="note">Showing the best {hits.length}. Type more to narrow it.</div>}
      {outcome !== null && outcome.unreadable > 0 && (
        <div className="note" data-sidebar="unreadable">
          {outcome.unreadable === 1 ? "1 note could not be read" : `${outcome.unreadable} notes could not be read`}; found by name only.
        </div>
      )}
    </div>
  )
}

export function Sidebar({
  root, openNote, editing, onEditing, newIn, onOpen, onOpenFound, onNewNote, onNewSection, onPlaceNote, onMoveSection,
  onDuplicate, onTrashNote, onTrashSection, searchAsk, onSearchTaken, project = null, platform = "win32",
  onProjectCommand, onReveal, onRenameNote, onRenameSection,
}: Props) {
  const [menu, setMenu] = useState<{ x: number; y: number; items: MenuItem[] } | null>(null)
  const [prompt, setPrompt] = useState<PromptSpec | null>(null)
  const bin = trashWord(platform)
  const actions: RowActions = {
    run: (id) => onProjectCommand?.(id),
    reveal: (path) => onReveal?.(path),
    open: onOpen,
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
  const [over, setOver] = useState<{ path: string; mode: "above" | "into" | "add" } | null>(null)
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

  /** A drop on a section's add row: into that section, at the top, where a new note lands. */
  const dropOnAdd = (event: React.DragEvent, path: string, depth: number) => {
    const item = carried(event)
    end()
    if (!item) return
    event.preventDefault()
    event.stopPropagation()
    const section = sectionAt(root, path, depth)
    const move = section ? addRowDrop(item, section, platform === "win32") : null
    if (!move) return
    if (move.kind === "place") onPlaceNote(move.file, move.folder, move.before)
    else onMoveSection(move.folder, move.target)
  }

  // What the rows call. Rebuilt every render (it sees this render's state); the rows hold the ref, not its members.
  const latest: RowCtx = {
    open: onOpen,
    newNote: onNewNote,
    duplicate: onDuplicate,
    arm: setArmed,
    trashNote: onTrashNote,
    trashSection: (path, depth) => { const section = sectionAt(root, path, depth); if (section) onTrashSection(section) },
    toggle,
    noteMenu: (x, y, note) => setMenu({ x, y, items: noteMenu(note, root, platform, actions) }),
    sectionMenu: (x, y, path, depth) => {
      const section = sectionAt(root, path, depth)
      if (!section) return
      // Asked now, at the click: a folder Explorer took since the last read is not real.
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
      if (over?.path !== path || over.mode !== mode) setOver({ path, mode })
    },
    dropOnNote,
    dropInto,
    dropOnAdd,
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
        return <AddRow key={keys[index]} ctx={ctxRef} path={row.section.path} depth={row.section.depth} name={row.section.name}
                       indent={row.indent} over={over?.mode === "add" && over.path === row.section.path} />
      }
      if (row.kind === "section") {
        const path = row.section.path
        return (
          <SectionRow key={keys[index]} ctx={ctxRef} path={path} name={row.section.name} depth={row.section.depth} indent={row.indent}
                      expanded={expanded.has(path)} dragging={dragging?.path === path} over={over?.mode === "into" && over.path === path}
                      trashable={editing && canTrashSection(row.section)} armed={armed === `section:${path}`}
                      count={counts.get(path) ?? 0} />
        )
      }
      const note = row.note
      return (
        <NoteRow key={keys[index]} ctx={ctxRef} note={note} indent={row.indent}
                 open={note.path === openNote} dragging={dragging?.path === note.path}
                 over={over?.mode === "above" && over.path === note.path}
                 editing={editing} armed={armed === `note:${note.path}`} />
      )
    })
  }, [rows, counts, expanded, dragging, over, editing, armed, openNote])

  // MARK: Search

  const [query, setQuery] = useState("")
  const typed = query.trim()
  const { outcome, busy } = useNoteSearch(typed, root)
  const searching = typed.length > 0
  const hits = outcome?.hits ?? []
  // The result the arrow keys are on, by its note (a result list that is searched again keeps its place).
  const [active, setActive] = useState<string | null>(null)
  const activeIndex = active === null ? -1 : hits.findIndex((hit) => hit.path === active)
  const field = useRef<HTMLInputElement>(null)
  // Enter pressed before the results for the words typed had come back: it opens the best one when they do.
  const openWhenReady = useRef(false)

  const openHit = (hit: FoundNote) => {
    openWhenReady.current = false
    onOpenFound(noteOfHit(hit), hit, typed)
  }
  useEffect(() => {
    if (!openWhenReady.current || !outcome || outcome.query !== typed) return
    openWhenReady.current = false
    const first = outcome.hits[0]
    if (first) onOpenFound(noteOfHit(first), first, typed)
  }, [outcome]) // eslint-disable-line react-hooks/exhaustive-deps
  // A new list starts with nothing chosen; a list searched again keeps the choice if it is still there.
  useEffect(() => {
    if (active !== null && !hits.some((hit) => hit.path === active)) setActive(null)
  }, [hits]) // eslint-disable-line react-hooks/exhaustive-deps

  // ⇧⌘F: the field takes the keyboard (with what was in it selected, to type over).
  useEffect(() => {
    if (!searchAsk) return
    field.current?.focus()
    field.current?.select()
    onSearchTaken()
  }, [searchAsk]) // eslint-disable-line react-hooks/exhaustive-deps

  const leave = () => {
    setQuery("")
    setActive(null)
    openWhenReady.current = false
    field.current?.blur()
    // The keyboard goes back to the notes (the field was the one thing that had it).
    window.setTimeout(returnFocus, 0)
  }
  const fieldKeys = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.nativeEvent.isComposing) return
    if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); leave(); return }
    if (!searching) return
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault()
      const next = stepResult(activeIndex, event.key, hits.length)
      setActive(next < 0 ? null : hits[next]!.path)
    } else if (event.key === "Enter") {
      event.preventDefault()
      const chosen = activeIndex >= 0 ? hits[activeIndex] : outcome !== null && outcome.query === typed ? hits[0] : undefined
      if (chosen) openHit(chosen)
      else if (outcome === null || outcome.query !== typed) openWhenReady.current = true
    }
  }

  const newMenu: MenuItem[] = [
    { label: "New Note", icon: "docnew", hint: shown("newNote", platform), onClick: () => onNewNote(newIn) },
    { label: "New Section", icon: "foldernew", dataBar: "new-section", onClick: () => onNewSection(newIn) },
  ]

  return (
    <div className="sidebar">
      <div className="bar-row under-lights sidebar-bar" data-sidebar="bar">
        <label className="side-search" data-sidebar="search-field">
          <Icon name="search" size={14} />
          <input ref={field} type="text" role="searchbox" data-sidebar="search" placeholder="Search notes"
                 aria-label="Search notes" aria-controls={searching ? "sidebar-results" : undefined}
                 aria-activedescendant={searching && active !== null ? `hit-${active}` : undefined}
                 title={titled("Search Notes", shown("searchNotes", platform), "Every note of the project, by its title and its words")}
                 spellCheck={false} autoComplete="off" value={query}
                 onChange={(event) => setQuery(event.target.value)} onKeyDown={fieldKeys} />
          {query.length > 0 && (
            <button type="button" className="clear" data-sidebar="search-clear" aria-label="Clear search" tabIndex={-1}
                    onMouseDown={(event) => event.preventDefault()}
                    onClick={() => { setQuery(""); setActive(null); field.current?.focus() }}>
              <Icon name="close" size={10} />
            </button>
          )}
        </label>
        <MenuButton icon="plus" dataBar="new-note" title={titled("New Note", shown("newNote", platform), "In the open note's section. The corner opens New Note and New Section")}
                    items={newMenu} onMain={() => onNewNote(newIn)} />
        <button type="button" className={`bar-btn${editing ? " on" : ""}`} data-bar="edit"
                aria-label={editing ? "Done Editing" : "Edit Notes"} aria-pressed={editing}
                title={titled(editing ? "Done Editing" : "Edit Notes", "", editing ? "Put the duplicate and delete buttons away" : "Duplicate and delete on every row")}
                onClick={() => onEditing(!editing)}>
          <Icon name="edit" />
        </button>
      </div>
      {searching ? (
        <Results outcome={outcome} busy={busy} query={typed} openNote={openNote} active={active} onActive={setActive}
                 onOpen={openHit}
                 onMenu={(at, hit) => setMenu({ x: at.x, y: at.y, items: noteMenu(noteOfHit(hit), root, platform, actions) })} />
      ) : missing && project ? <MissingFolders project={project} actions={actions} />
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
