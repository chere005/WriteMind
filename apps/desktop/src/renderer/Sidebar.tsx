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

import { useState } from "react"
import type { Note } from "@writemind/core"
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

interface Props {
  root: Section | null
  openNote: string | null
  onOpen(note: Note): void
  onNewNote(folder: string): void
  onNewSection(parent: string): void
  header: React.ReactNode
}

export function Sidebar({ root, openNote, onOpen, onNewNote, onNewSection, header }: Props) {
  const [expanded, setExpanded] = useState<Set<string>>(new Set())

  const toggle = (path: string) => {
    setExpanded((was) => {
      const next = new Set(was)
      if (next.has(path)) next.delete(path)
      else next.add(path)
      return next
    })
  }

  const rows = root ? flatten(root, expanded) : []

  return (
    <div className="sidebar">
      {header}
      <div className="rows">
        {rows.map((row, index) => {
          const pad = { paddingLeft: row.indent * 14 }
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
            return (
              <button className="section-row" key={`s:${row.section.path}`} style={pad}
                      onClick={() => toggle(row.section.path)}>
                {expanded.has(row.section.path) ? "▾ " : "▸ "}{row.section.name}
              </button>
            )
          }
          const note = row.note
          return (
            <button className={`note-row${note.path === openNote ? " open" : ""}`}
                    key={`n:${note.path}:${index}`} style={pad} onClick={() => onOpen(note)}>
              <div className="title">{note.title}</div>
              {note.snippet && <div className="snippet">{note.snippet}</div>}
            </button>
          )
        })}
      </div>
    </div>
  )
}
