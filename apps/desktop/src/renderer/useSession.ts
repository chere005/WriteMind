/**
 * The session, in the window: which notes are open, which one is in front,
 * where the caret was and which sections were closed — restored on launch
 * and kept as it changes. The rules (what a session is, which notes
 * survive, what closing a tab does to the front one) are
 * `@writemind/core`'s `session`; the file is the main process's, in the
 * app's user-data folder and never beside the notes.
 */

import { useCallback, useEffect, useRef, useState, type MutableRefObject } from "react"
import { readSession, stem, surviving, writeSession, type Note, type Session } from "@writemind/core"
import type { ViewState } from "./Notebook"
import type { Section } from "./wm"

/** How long after the last change the session is written. */
const SAVE_AFTER = 250

const flatten = (section: Section): Note[] =>
  [...section.notes, ...section.sections.flatMap(flatten)]

interface Options {
  root: Section | null
  open: Note[]
  current: string | null
  /** The caret and folds per note, kept by the notebook as it changes. */
  states: MutableRefObject<Map<string, ViewState>>
  setOpen(notes: Note[]): void
  openNote(note: Note): Promise<void>
}

export function useSession({ root, open, current, states, setOpen, openNote }: Options) {
  const [ready, setReady] = useState(false)
  const started = useRef(false)
  const timer = useRef<number | null>(null)
  const latest = useRef({ open, current, rootPath: "" })
  latest.current = { open, current, rootPath: latest.current.rootPath }

  const write = useCallback(() => {
    const { open: notes, current: front, rootPath } = latest.current
    const session: Session = {
      root: rootPath,
      open: notes.map((note) => {
        const state = states.current.get(note.path)
        return { path: note.path, caret: state?.caret ?? 0, collapsed: state?.collapsed ?? [] }
      }),
      active: front,
    }
    void window.wm.writeSession(writeSession(session))
  }, [states])

  /** A caret moved or a section closed: the session is written, shortly. */
  const touch = useCallback(() => {
    if (!ready) return
    if (timer.current) window.clearTimeout(timer.current)
    timer.current = window.setTimeout(write, SAVE_AFTER)
  }, [ready, write])

  // Launch: bring back what was open, in the order it was, with the one in
  // front in front. Notes the disk no longer has are dropped.
  useEffect(() => {
    if (!root || started.current) return
    started.current = true
    latest.current.rootPath = (root.path ?? "")
    void (async () => {
      try {
        const session = readSession(await window.wm.readSession(), root.path)
        const alive = new Set(await window.wm.existing(session.open.map((note) => note.path)))
        const kept = surviving(session, (path) => alive.has(path))
        if (kept.open.length > 0) {
          const known = new Map(flatten(root).map((note) => [note.path, note]))
          for (const note of kept.open) {
            states.current.set(note.path, { caret: note.caret, collapsed: note.collapsed })
          }
          const notes = kept.open.map((note) => known.get(note.path)
            ?? { path: note.path, modified: Date.now(), title: stem(note.path), snippet: "" })
          setOpen(notes)
          const front = notes.find((note) => note.path === kept.active) ?? notes[notes.length - 1]!
          await openNote(front)
        }
      } catch (error) {
        console.error("WriteMind: could not bring the session back", error)
      }
      setReady(true)
    })()
  }, [root, setOpen, openNote, states])

  // The tab row changed, or another note came to the front.
  useEffect(() => {
    if (!ready) return
    if (timer.current) window.clearTimeout(timer.current)
    timer.current = window.setTimeout(write, SAVE_AFTER)
  }, [ready, open, current, write])

  // Closing the window mid-debounce still writes what there is.
  useEffect(() => {
    const flush = () => { if (ready) write() }
    window.addEventListener("beforeunload", flush)
    return () => window.removeEventListener("beforeunload", flush)
  }, [ready, write])

  return { touch, ready }
}
