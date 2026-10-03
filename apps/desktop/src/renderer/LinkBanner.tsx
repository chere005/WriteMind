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
  anchorIn, linkMarkdown, makeNote, triggerRange, type Note,
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

export function LinkBanner({ request, current, view, root, openNote, onDone }: Props) {
  const [problem, setProblem] = useState<string | null>(null)

  useEffect(() => {
    setProblem(null)
    if (!request) return
    const key = (event: KeyboardEvent) => { if (event.key === "Escape") onDone() }
    window.addEventListener("keydown", key)
    return () => window.removeEventListener("keydown", key)
  }, [request, onDone])

  if (!request) return null

  const complete = async () => {
    if (!view || !current) return
    const text = view.state.doc.toString()
    const main = view.state.selection.main
    const anchor = anchorIn(text, { location: main.from, length: main.to - main.from })
    const markdown = linkMarkdown(anchor.title, baseName(current), anchor.id)

    if (current === request.file) {
      // The link points into the note it is typed in.
      const written = anchor.rewrittenText ?? text
      const at = triggerRange(written, request.caret + (written.length - text.length))
      if (!at) { setProblem("The /link is gone from this note."); return }
      const finished = written.slice(0, at.location) + markdown + written.slice(at.location + at.length)
      view.dispatch({ changes: minimalChange(text, finished) })
      onDone()
      return
    }

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
    const finished = source.slice(0, at.location) + markdown + source.slice(at.location + at.length)
    const out = await window.wm.writeNote(request.file, finished)
    if (!out.written) { setProblem("That note changed on disk; nothing was overwritten."); return }
    const known = root ? flatten(root).find((note) => note.path === request.file) : undefined
    onDone()
    await openNote(known ?? makeNote(request.file, Date.now(), finished))
  }

  return (
    <div className="link-banner" role="status">
      <span>
        {problem ?? "Select section to point to — open a note, put the cursor in a block or highlight a run, then Link Here."}
      </span>
      <div className="spacer" />
      <button onClick={() => { void complete() }}>Link Here</button>
      <button onClick={onDone}>Cancel</button>
    </div>
  )
}
