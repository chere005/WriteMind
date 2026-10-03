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

import { useEffect, useState } from "react"
import type { Note } from "@writemind/core"
import { shown, TABLET_SOURCE } from "../shared/commands"
import { tip } from "./TopBar"
import type { Section } from "./wm"

type Row =
  | { kind: "add"; section: Section; indent: number }
  | { kind: "note"; note: Note; section: Section; indent: number }
  | { kind: "section"; section: Section; indent: number }

function flatten(root: Section, open: Set<string>): Row[] {
  const out: Row[] = []
  const walk = (section: Section, indent: number) => {
    // The + comes FIRST, so the way to make a note is where the note
    // will appear rather than up on the bar.
    out.push({ kind: "add", section, indent })
    for (const note of section.notes) out.push({ kind: "note", note, section, indent })
    for (const child of section.sections) {
      out.push({ kind: "section", section: child, indent })
      if (open.has(child.path)) walk(child, indent + 1)
    }
  }
  walk(root, 0)
  return out
}

const PageIcon = () => (
  <svg width="11" height="13" viewBox="0 0 11 13" fill="none" aria-hidden>
    <rect x="0.5" y="0.5" width="10" height="12" rx="2" stroke="currentColor"
          strokeDasharray="2.5 2" />
    <path d="M5.5 3.8v5M3 6.3h5" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
  </svg>
)

const FolderIcon = () => (
  <svg width="15" height="13" viewBox="0 0 15 13" fill="none" aria-hidden>
    <path d="M0.5 3.2V11a1 1 0 0 0 1 1h9" stroke="currentColor" />
    <path d="M0.5 3.2V2a1 1 0 0 1 1-1h3l1.4 1.6h4.6a1 1 0 0 1 1 1v2"
          stroke="currentColor" />
    <path d="M12 7.2v4.4M9.8 9.4h4.4" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
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

const countNotes = (section: Section): number =>
  section.notes.length + section.sections.reduce((sum, one) => sum + countNotes(one), 0)

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
  header: React.ReactNode
}

/** What a row being dragged carries. */
const MIME = "application/x-writemind-row"
interface Dragged { kind: "note" | "section"; path: string }

const folderOf = (path: string): string => path.replace(/[\\/][^\\/]*$/, "")
const baseName = (path: string): string => path.split(/[\\/]/).pop() ?? path

export function Sidebar({
  root, openNote, editing, onOpen, onNewNote, onNewSection, onPlaceNote, onMoveSection,
  onDuplicate, onTrashNote, onTrashSection, header,
}: Props) {
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
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
  // A project of several folders opens with each folder showing.
  useEffect(() => {
    if (root && root.path === "") {
      setExpanded((was) => new Set([...was, ...root.sections.map((one) => one.path)]))
    }
  }, [root?.sections.map((one) => one.path).join("|")])  // eslint-disable-line react-hooks/exhaustive-deps

  const trash = (key: string, what: string, act: () => void) => (
    <button className={`row-button trash${armed === key ? " armed" : ""}`} data-trash={key}
            title={armed === key ? `Click again to move this ${what} to the Trash` : "Move to Trash (click twice)"}
            onClick={(event) => {
              event.stopPropagation()
              if (armed === key) { setArmed(null); act() } else setArmed(key)
            }}><TrashIcon /></button>
  )

  const toggle = (path: string) => {
    setExpanded((was) => {
      const next = new Set(was)
      if (next.has(path)) next.delete(path)
      else next.add(path)
      return next
    })
  }

  const rows = root ? flatten(root, expanded) : []

  const carried = (event: React.DragEvent): Dragged | null => {
    try {
      const raw = event.dataTransfer.getData(MIME)
      if (raw) return JSON.parse(raw) as Dragged
    } catch { /* not ours */ }
    return dragging
  }
  const accepts = (event: React.DragEvent) => event.dataTransfer.types.includes(MIME)
  const end = () => { setDragging(null); setOver(null) }

  const dragSource = (item: Dragged) => ({
    draggable: true,
    onDragStart: (event: React.DragEvent) => {
      event.dataTransfer.setData(MIME, JSON.stringify(item))
      event.dataTransfer.effectAllowed = "move"
      setDragging(item)
    },
    onDragEnd: end,
  })

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

  return (
    <div className="sidebar">
      {header}
      <div className={`rows${over?.path === "" ? " drop-root" : ""}`}
           onDragOver={(event) => {
             if (!accepts(event)) return
             event.preventDefault()
             if (over?.path !== "") setOver({ path: "", mode: "into" })
           }}
           onDragLeave={(event) => {
             if (event.currentTarget === event.target) setOver(null)
           }}
           onDrop={(event) => { if (root && root.path !== "") dropInto(event, root.path) }}>
        {rows.map((row, index) => {
          const pad = { paddingLeft: row.indent * 14 }
          // A project of several folders has no folder of its own to add to.
          if (row.kind === "add" && row.section.path === "") return null
          if (row.kind === "add") {
            return (
              <div className="add-row" key={`add:${row.section.path}`} style={pad}>
                <button onClick={() => onNewNote(row.section.path)}
                        title={`New note in ${row.section.name}`}>
                  <PageIcon /> New note
                </button>
                <div className="split" />
                <button onClick={() => onNewSection(row.section.path)}
                        title={`New section in ${row.section.name}`}>
                  <FolderIcon /> New section
                </button>
              </div>
            )
          }
          if (row.kind === "section") {
            const path = row.section.path
            const classes = ["section-row"]
            if (dragging?.path === path) classes.push("dragging")
            if (over?.path === path) classes.push("drop-into")
            return (
              <div role="button" tabIndex={0} className={classes.join(" ")} key={`s:${path}`} style={pad}
                   data-path={path}
                   onClick={() => toggle(path)}
                   {...dragSource({ kind: "section", path })}
                   onDragOver={(event) => {
                     if (!accepts(event)) return
                     event.preventDefault()
                     event.stopPropagation()
                     if (over?.path !== path) setOver({ path, mode: "into" })
                   }}
                   onDrop={(event) => dropInto(event, path)}>
                <span className="name">{expanded.has(path) ? "▾ " : "▸ "}{row.section.name}</span>
                {editing
                  ? trash(`section:${path}`, "section and its notes", () => onTrashSection(row.section))
                  : <span className="count">{countNotes(row.section)}</span>}
              </div>
            )
          }
          const note = row.note
          const classes = ["note-row"]
          if (note.path === openNote) classes.push("open")
          if (dragging?.path === note.path) classes.push("dragging")
          if (over?.path === note.path) classes.push("drop-above")
          return (
            <div role="button" tabIndex={0} className={classes.join(" ")}
                 key={`n:${note.path}:${index}`} style={pad} data-path={note.path}
                 onClick={() => onOpen(note)}
                 {...dragSource({ kind: "note", path: note.path })}
                 onDragOver={(event) => {
                   if (!accepts(event)) return
                   event.preventDefault()
                   event.stopPropagation()
                   if (over?.path !== note.path) setOver({ path: note.path, mode: "above" })
                 }}
                 onDrop={(event) => dropOnNote(event, note)}>
              <div className="text">
                <div className="title">{note.title}</div>
                {note.snippet && <div className="snippet">{note.snippet}</div>}
              </div>
              {editing && (
                <span className="row-buttons">
                  <button className="row-button" data-duplicate={note.path} title="Duplicate"
                          onClick={(event) => { event.stopPropagation(); onDuplicate(note) }}>
                    <DuplicateIcon />
                  </button>
                  {trash(`note:${note.path}`, "note", () => onTrashNote(note))}
                </span>
              )}
            </div>
          )
        })}
      </div>
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
          </div>
        )}
      </span>
    </div>
  )
}
