/**
 * `/link`: "Select section to point to", up until the target is picked or the
 * user backs out. Type `/link` in a note, open another one, put the cursor in
 * a block (or highlight a run) and press Link Here. The anchor is written
 * into the OTHER note, the link replaces what was typed, and the note it was
 * typed in is opened again. The rules are `@writemind/core`'s `linking`.
 */

import { useEffect, useState } from "react"
import type { EditorView } from "@codemirror/view"
import {
  anchorIn, linkMarkdown, makeNote, stem, triggerRange, writeRich, type Note,
} from "@writemind/core"
import type { Section } from "./wm"

export interface LinkRequest { file: string; caret: number }

interface Props {
  request: LinkRequest | null
  /** The note in front right now — the target, whichever it is. */
  current: string | null
  view: EditorView | null
  root: Section | null
  openNote(note: Note): Promise<void>
  /** The link was written into `file` at [from, to): the note comes back with it selected. */
  onLanded?(file: string, from: number, to: number): void
  onDone(): void
}

const baseName = (path: string): string => path.split(/[\\/]/).pop() ?? path

const flatten = (section: Section): Note[] =>
  [...section.notes, ...section.sections.flatMap(flatten)]

/** The smallest single edit that turns `before` into `after`. */
export function minimalChange(before: string, after: string): { from: number; to: number; insert: string } {
  let start = 0
  const shortest = Math.min(before.length, after.length)
  while (start < shortest && before[start] === after[start]) start++
  let stopBefore = before.length
  let stopAfter = after.length
  while (stopBefore > start && stopAfter > start && before[stopBefore - 1] === after[stopAfter - 1]) {
    stopBefore--
    stopAfter--
  }
  return { from: start, to: stopBefore, insert: after.slice(start, stopAfter) }
}

export function LinkBanner({ request, current, view, root, openNote, onLanded, onDone }: Props) {
  const [problem, setProblem] = useState<string | null>(null)
  // Whether a run of text is highlighted in the note in front (the detail line says which kind of target it is).
  const [highlighted, setHighlighted] = useState(false)
  useEffect(() => {
    if (!request || !view) return
    const look = () => setHighlighted(!view.state.selection.main.empty)
    look()
    const tick = window.setInterval(look, 200)
    return () => window.clearInterval(tick)
  }, [request, view, current])

  useEffect(() => {
    setProblem(null)
    if (!request) return
    const key = (event: KeyboardEvent) => { if (event.key === "Escape") onDone() }
    window.addEventListener("keydown", key)
    return () => window.removeEventListener("keydown", key)
  }, [request, onDone])

  if (!request) return null

  // The Mac's banner (LinkBanner.swift): "Select section to point to", a second line that says what Link Here
  // will do, and Link Here OFF while the note in front is the one the /link was typed in ("a note to itself").
  const isSource = current === request.file
  const sourceTitle = (root ? flatten(root).find((note) => note.path === request.file)?.title : undefined)
    ?? stem(request.file)
  const detail = problem
    ?? (isSource ? `Open the note you want to point at — from “${sourceTitle}”.`
      : highlighted ? "Links to the highlighted text, and marks it in this note as linked."
      : "Links to the block the cursor is in. Highlight text first to point at just that.")

  const complete = async () => {
    if (!view || !current || current === request.file) return
    const text = view.state.doc.toString()
    const main = view.state.selection.main
    const anchor = anchorIn(text, { location: main.from, length: main.to - main.from })
    const markdown = linkMarkdown(anchor.title, baseName(current), anchor.id)

    // The anchor goes into the target — through the open note, so the
    // editor never shows a stale copy of a file that changed underneath it.
    if (anchor.rewrittenText !== null) {
      view.dispatch({ changes: minimalChange(text, anchor.rewrittenText) })
      await window.wm.writeNote(current, anchor.rewrittenText)
    }
    // The link goes into the source, on disk, and the source is opened again.
    const source = await window.wm.readNote(request.file).catch(() => null)
    if (source === null) { setProblem("The note with the /link has gone."); return }
    const at = triggerRange(source, request.caret)
    if (!at) { setProblem("The /link is gone from that note."); return }
    // A link in a text cell makes it a markdown cell first (docs/PLAN-text-cells.md, "Automatic").
    const { text: finished, link } = writeRich(source, at, markdown)
    const out = await window.wm.writeNote(request.file, finished)
    if (!out.written) { setProblem("That note changed on disk; nothing was overwritten."); return }
    const known = root ? flatten(root).find((note) => note.path === request.file) : undefined
    onDone()
    // Where the link landed, as the switch says (it can take backslashes out and put markers in on both sides of it).
    onLanded?.(request.file, link.location, link.location + link.length)
    await openNote(known ?? makeNote(request.file, Date.now(), finished))
  }

  return (
    <div className="link-banner" role="status">
      <span className="text">
        <b className="title">Select section to point to</b>
        <span className="detail">{detail}</span>
      </span>
      <div className="spacer" />
      <button onClick={onDone}>Cancel</button>
      <button className="default" disabled={isSource} onClick={() => { void complete() }}>Link Here</button>
    </div>
  )
}
