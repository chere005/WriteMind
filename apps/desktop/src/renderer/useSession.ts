/**
 * The session, in the window: which notes are open, which one is in front,
 * where the caret was and which sections were closed — restored on launch
 * and kept as it changes. The rules (what a session is, which notes
 * survive, what closing a tab does to the front one) are
 * `@writemind/core`'s `session`; the file is the main process's, in the
 * app's user-data folder and never beside the notes.
 *
 * ONE SESSION PER PROJECT (`ProjectSession`): it is keyed by the project's
 * file (null for the untitled project), and the window names that key on
 * every read and write, so the last write of a project that has just been
 * left still lands in that project's file. Opening another project saves
 * this one's session, closes its tabs and brings the other's back.
 */

import { useCallback, useEffect, useRef, useState, type MutableRefObject } from "react"
import {
  bufferDecisions, makeNote, readSession, stem, surviving, writeSession, type Note, type Session,
} from "@writemind/core"
import type { ViewState } from "./Notebook"
import type { Section } from "./wm"

/** How long after the last change the session is written. */
const SAVE_AFTER = 250

/**
 * How often the text typed and not yet in its file may be put into the session (see `touchBuffer`). A fifth of a
 * second for an ordinary note; longer as the note grows, because every write is the whole text (a string made, a
 * JSON made, a copy to the main process, a file written): at 500 KB, five times a second of that was half the
 * cost of typing. The autosave writes the file itself a quarter of a second after the typing PAUSES, so what the
 * longer interval risks is a kill in the middle of a long run of typing that never paused.
 */
export const bufferInterval = (chars: number): number =>
  chars <= 20_000 ? 200 : Math.min(3000, 200 + Math.round(chars / 150))

const flatten = (section: Section): Note[] =>
  [...section.notes, ...section.sections.flatMap(flatten)]

interface Options {
  root: Section | null
  open: Note[]
  current: string | null
  /** The caret and folds per note, kept by the notebook as it changes. */
  states: MutableRefObject<Map<string, ViewState>>
  /**
   * The open project's file (its session's key); null is the untitled one,
   * and `undefined` means the main process has not said yet.
   */
  projectFile: string | null | undefined
  /**
   * The text of the note in front when it has not reached its file (null when it has), with the text of the
   * file it is an edit of: the session keeps it, so a kill mid-edit loses nothing (the Mac's hot exit).
   */
  buffer?(): { path: string; text: string; base: string } | null
  setOpen(notes: Note[]): void
  openNote(note: Note): Promise<void>
  /** Let go of every open note (the one in front is written first). */
  closeAll(): Promise<void>
}

/**
 * The Mac's hot exit (`restoreSession`): text that was typed and never written is put back into its file BEFORE
 * the tabs are restored, so the tab opens on it. Reading each file first (the shell remembers what it read) is
 * what lets the write guard accept the write. A file somebody else changed since is NOT overwritten: the text
 * is kept beside it as "name (unsaved copy).md".
 */
async function applyBuffers(buffers: Session["unsavedBuffers"]): Promise<Map<string, string>> {
  const applied = new Map<string, string>()
  const paths = Object.keys(buffers)
  if (paths.length === 0) return applied
  const disk = new Map<string, string | null>()
  for (const path of paths) disk.set(path, await window.wm.readNote(path).catch(() => null))
  for (const decision of bufferDecisions(buffers, (path) => disk.get(path) ?? null)) {
    try {
      if (decision.action === "apply") {
        const out = await window.wm.writeNote(decision.path, decision.text)
        if (out.written) applied.set(decision.path, decision.text)
        else console.error("WriteMind: could not put the unsaved text back into", decision.path)
      } else if (decision.action === "keep-copy") {
        const stemmed = decision.path.replace(/\.(wm|md|markdown|txt)$/i, "")
        const extension = decision.path.slice(stemmed.length)
        let copy = `${stemmed} (unsaved copy)${extension}`
        for (let n = 2; (await window.wm.existing([copy])).length > 0 && n < 50; n++) {
          copy = `${stemmed} (unsaved copy ${n})${extension}`
        }
        await window.wm.writeNote(copy, decision.text)
      }
    } catch (error) {
      console.error("WriteMind: could not bring back unsaved text", error)
    }
  }
  return applied
}

export function useSession({
  root, open, current, states, projectFile, buffer, setOpen, openNote, closeAll,
}: Options) {
  const [ready, setReady] = useState(false)
  const started = useRef(false)
  const timer = useRef<number | null>(null)
  const latest = useRef({ open, current, rootPath: "" })
  latest.current = { open, current, rootPath: latest.current.rootPath }
  const bufferRef = useRef(buffer)
  bufferRef.current = buffer
  // The project the tabs belong to. Taken from the prop once, at launch; after that
  // it is changed only by `switchTo` and `renamed`, so a render that happens in the
  // middle of a switch cannot send the new project's tabs to the old project's file.
  const key = useRef<string | null | undefined>(projectFile)

  /** Written under `key`, which is the project the tabs belong to. */
  const write = useCallback((into?: string | null): Promise<void> => {
    const { open: notes, current: front, rootPath } = latest.current
    const session: Session = {
      root: rootPath,
      open: notes.map((note) => {
        const state = states.current.get(note.path)
        return { path: note.path, caret: state?.caret ?? 0, collapsed: state?.collapsed ?? [] }
      }),
      active: front,
      unsavedBuffers: {},
    }
    const unsaved = bufferRef.current?.()
    bufferChars.current = unsaved ? unsaved.text.length : 0
    if (unsaved && notes.some((note) => note.path === unsaved.path)) {
      session.unsavedBuffers[unsaved.path] = { text: unsaved.text, base: unsaved.base }
    }
    // A session that could not be written is logged, not thrown: it is written again within a fraction of a second,
    // nothing the person typed depends on it (the note is saved on its own), and an unhandled rejection from a
    // debounce or a throttle would be a red bar over the window for a thing nobody can act on.
    return window.wm.writeSession(into === undefined ? key.current ?? null : into, writeSession(session))
      .catch((error) => { console.error("WriteMind: could not write the session", error) })
  }, [states])

  /**
   * Text was typed that is not in its file yet: the session carries it within a fifth of a second, so
   * a kill (or a crash, or a power cut) mid-edit comes back with it. It is a throttle, not a debounce: an
   * edit that is already waiting for the write rides on it, so continuous typing still gets written.
   */
  const bufferTimer = useRef<number | null>(null)
  const bufferChars = useRef(0)
  const touchBuffer = useCallback(() => {
    if (!ready || bufferTimer.current !== null) return
    bufferTimer.current = window.setTimeout(() => { bufferTimer.current = null; write() }, bufferInterval(bufferChars.current))
  }, [ready, write])

  /** A caret moved or a section closed: the session is written, shortly. */
  const touch = useCallback(() => {
    if (!ready) return
    if (timer.current) window.clearTimeout(timer.current)
    timer.current = window.setTimeout(() => write(), SAVE_AFTER)
  }, [ready, write])

  /**
   * Bring a project's session back over `tree`: its notes that the project
   * still holds, in the order they were, the one in front in front. A project
   * with no session (or none that survives) opens its first note, as the Mac
   * does (`selection = notes.first`).
   */
  const restore = useCallback(async (tree: Section, file: string | null) => {
    try {
      const session = readSession(await window.wm.readSession(file), tree.path)
      const known = new Map(flatten(tree).map((note) => [note.path, note]))
      const kept = surviving(session, (path) => known.has(path))
      const applied = await applyBuffers(kept.unsavedBuffers)
      if (kept.open.length > 0) {
        for (const note of kept.open) {
          states.current.set(note.path, { caret: note.caret, collapsed: note.collapsed })
        }
        // (a note whose unsaved text was just put back has the title of THAT text, not of the tree read before it)
        const notes = kept.open.map((note) => (applied.has(note.path)
          ? makeNote(note.path, Date.now(), applied.get(note.path)!) : known.get(note.path))
          ?? { path: note.path, modified: Date.now(), title: stem(note.path), snippet: "" })
        setOpen(notes)
        const front = notes.find((note) => note.path === kept.active) ?? notes[notes.length - 1]!
        await openNote(front)
      } else {
        const first = flatten(tree)[0]
        if (first) await openNote(first)
      }
    } catch (error) {
      console.error("WriteMind: could not bring the session back", error)
    }
  }, [openNote, setOpen, states])

  // Launch: once the tree and the project are known.
  useEffect(() => {
    if (!root || started.current || projectFile === undefined) return
    started.current = true
    key.current = projectFile
    latest.current.rootPath = (root.path ?? "")
    void (async () => {
      await restore(root, projectFile)
      setReady(true)
    })()
  }, [root, projectFile, restore])

  /**
   * ANOTHER PROJECT. The caller has already `flush`ed this one's session under
   * its own key while its tabs were still up; they are let go here, and the
   * other project's session is brought back over ITS tree (`tree`: read fresh).
   */
  const switchTo = useCallback(async (tree: Section, file: string | null) => {
    if (timer.current) window.clearTimeout(timer.current)
    await closeAll()
    states.current.clear()
    key.current = file
    latest.current.rootPath = tree.path ?? ""
    await restore(tree, file)
  }, [closeAll, restore, states, write])

  /** The project got a file (Save As on an untitled one): its session is written under the new name. */
  const renamed = useCallback((file: string | null) => {
    key.current = file
    write(file)
  }, [write])

  // The tab row changed, or another note came to the front.
  useEffect(() => {
    if (!ready) return
    if (timer.current) window.clearTimeout(timer.current)
    timer.current = window.setTimeout(() => write(), SAVE_AFTER)
  }, [ready, open, current, write])

  // Closing the window mid-debounce still writes what there is.
  useEffect(() => {
    const flush = () => { if (ready) write() }
    window.addEventListener("beforeunload", flush)
    return () => window.removeEventListener("beforeunload", flush)
  }, [ready, write])

  /** Write the session now, under the project it belongs to (the promise is for the quit handshake, which waits for it). */
  const flush = useCallback((): Promise<void> => {
    if (timer.current) window.clearTimeout(timer.current)
    return write()
  }, [write])

  return { touch, touchBuffer, ready, switchTo, renamed, flush }
}
