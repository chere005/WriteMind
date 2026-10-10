/**
 * THE FILE OPERATIONS, JOURNALLED (docs/PLAN-undo.md): each one is the function the app always called (notes.ts,
 * housekeeping.ts, convert.ts), run inside the journal's queue, with what it needs for Undo taken first (a backup of what it
 * is about to destroy) and written down after (what moved, what was made, how the row order changed). Nothing here changes
 * what an operation does: an operation that fails is not a step, its backups go, and the error is the caller's as before.
 *
 * Every surface reaches these through the same IPC (`note:*`, `section:*`, `housekeeping:trash`): the sidebar's rows and edit
 * mode, a drag, the tab menu's Rename / Duplicate / Move to / Move to Trash. One place, so no surface can forget to be undoable.
 */

import { promises as fs } from "node:fs"
import path from "node:path"
import type { NoteOrder } from "@writemind/core"
import {
  createNote, createSection, duplicateNote, moveSection, ownerOf, placeNote, readOrder, renameNote, renameSection, reorder,
} from "./notes"
import { entryPath, splitEntryPath, trashUnused, type Trash } from "./housekeeping"
import type { OrderChange, Part, UndoJournal } from "./undoJournal"
import type { Held, TrashResult } from "../shared/housekeeping"

/** The order files of the project folders that own these folders, as they are now (by owner). */
async function orders(root: string, folders: string[]): Promise<Map<string, NoteOrder>> {
  const out = new Map<string, NoteOrder>()
  for (const folder of folders) {
    const owner = ownerOf(folder, root)
    if (!out.has(owner)) out.set(owner, await readOrder(owner, root))
  }
  return out
}

/** What changed between two readings of the same order files: only the folders (keys) whose lists differ. */
function changes(root: string, before: Map<string, NoteOrder>, after: Map<string, NoteOrder>): Part[] {
  const parts: Part[] = []
  for (const [owner, was] of before) {
    const now = after.get(owner)
    if (!now) continue
    const keys = new Set([...Object.keys(was.folders), ...Object.keys(now.folders)])
    const list: OrderChange["keys"] = []
    for (const key of keys) {
      const a = was.folders[key] ?? null
      const b = now.folders[key] ?? null
      if (JSON.stringify(a) !== JSON.stringify(b)) list.push({ key, before: a, after: b })
    }
    if (list.length > 0) parts.push({ t: "order", change: { owner, root, keys: list } })
  }
  return parts
}

export function createUndoOps(journal: UndoJournal, notesRoot: () => string) {
  /** Run `work` as one step of `kind`: a failure leaves no step and no backup; a step with no parts is not a step. */
  const step = <T>(kind: Parameters<UndoJournal["begin"]>[0], work: (draft: ReturnType<UndoJournal["begin"]>) => Promise<{ result: T; parts: Part[] }>): Promise<T> =>
    journal.exclusive(async () => {
      const draft = journal.begin(kind)
      try {
        const { result, parts } = await work(draft)
        if (parts.length > 0) await journal.record(draft, parts)
        else await draft.abort()
        return result
      } catch (error) {
        await draft.abort()
        throw error
      }
    })

  return {
    /** A new, empty note in `folder`. */
    createNote: (folder: string): Promise<string> => step("newNote", async () => {
      const file = await createNote(folder)
      return { result: file, parts: [{ t: "make", path: file, dir: false, copy: null }] }
    }),

    /** The note again beside itself. */
    duplicateNote: (file: string): Promise<string> => step("duplicateNote", async () => {
      const root = notesRoot()
      const before = await orders(root, [path.dirname(file)])
      const copy = await duplicateNote(root, file)
      return { result: copy, parts: [{ t: "make", path: copy, dir: false, copy: null }, ...changes(root, before, await orders(root, [path.dirname(file)]))] }
    }),

    /** Rename… on a note. */
    renameNote: (file: string, title: string): Promise<string> => step("renameNote", async () => {
      const root = notesRoot()
      const folder = path.dirname(file)
      const before = await orders(root, [folder])
      const next = await renameNote(root, file, title)
      if (next === file) return { result: next, parts: [] }
      return { result: next, parts: [{ t: "move", from: file, to: next, dir: false }, ...changes(root, before, await orders(root, [folder]))] }
    }),

    /** A row dropped on a row, or Move to: the file moves (if the folder is another) and takes its place in the order. */
    placeNote: (file: string, folder: string, before: string | null): Promise<string> => {
      const moves = path.resolve(path.dirname(file)) !== path.resolve(folder)
      return step(moves ? "moveNote" : "reorder", async () => {
        const root = notesRoot()
        const was = await orders(root, [path.dirname(file), folder])
        const landed = await placeNote(root, file, folder, before)
        const parts: Part[] = []
        if (landed !== file) parts.push({ t: "move", from: file, to: landed, dir: false })
        parts.push(...changes(root, was, await orders(root, [path.dirname(file), folder])))
        return { result: landed, parts }
      })
    },

    /** A new row order for a folder. */
    reorder: (folder: string, names: string[]): Promise<void> => step("reorder", async () => {
      const root = notesRoot()
      const before = await orders(root, [folder])
      await reorder(root, folder, names)
      return { result: undefined, parts: changes(root, before, await orders(root, [folder])) }
    }),

    /** A new section (an empty folder). */
    createSection: (parent: string): Promise<string> => step("newSection", async () => {
      const folder = await createSection(parent)
      return { result: folder, parts: [{ t: "make", path: folder, dir: true, copy: null }] }
    }),

    /** A section moved into another. Null: refused, nothing changed. */
    moveSection: (folder: string, target: string): Promise<string | null> => step("moveSection", async () => {
      const root = notesRoot()
      const was = await orders(root, [path.dirname(folder), target])
      const landed = await moveSection(root, folder, target)
      if (landed === null) return { result: null, parts: [] }
      return {
        result: landed,
        parts: [{ t: "move", from: folder, to: landed, dir: true }, ...changes(root, was, await orders(root, [path.dirname(folder), target]))],
      }
    }),

    /** Rename… on a section. Null: the name cannot be used. */
    renameSection: (folder: string, name: string): Promise<string | null> => step("renameSection", async () => {
      const root = notesRoot()
      const parent = path.dirname(folder)
      const was = await orders(root, [parent])
      const next = await renameSection(root, folder, name)
      if (next === null || next === folder) return { result: next, parts: [] }
      return { result: next, parts: [{ t: "move", from: folder, to: next, dir: true }, ...changes(root, was, await orders(root, [parent]))] }
    }),

    /** A note to the bin: a copy is kept first, and if that cannot be made the note does not go. */
    trashNote: (file: string, bin: Trash): Promise<void> => step("trashNote", async (draft) => {
      const kept = await draft.backup(file)
      await bin(file)
      return { result: undefined, parts: [{ t: "bin", path: file, dir: false, link: kept.link, copy: kept.copy }] }
    }),

    /** A section to the bin, and with it everything in it: the whole folder is kept first. */
    trashSection: (folder: string, bin: Trash): Promise<void> => step("trashSection", async (draft) => {
      const kept = await draft.backup(folder)
      await bin(folder)
      return { result: undefined, parts: [{ t: "bin", path: folder, dir: true, link: kept.link, copy: kept.copy }] }
    }),

    /** File ▸ Clean Up Unused Files…: the pictures that went are kept, each with its note. */
    trashUnused: (folders: string[], paths: string[], held: Held, bin: Trash, options: Parameters<typeof trashUnused>[5] = {}):
    Promise<TrashResult> => step("cleanUp", async (draft) => {
      const kept = new Map<string, string>()
      const result = await trashUnused(notesRoot(), folders, paths, held, bin, options, async (note, entry, bytes) => {
        kept.set(entryPath(note, entry), await draft.keep(path.basename(entry), bytes))
      })
      const parts: Part[] = []
      for (const id of result.moved) {
        const split = splitEntryPath(id)
        const copy = kept.get(id)
        if (split && copy) parts.push({ t: "entry", note: split.note, name: split.entry, copy })
      }
      return { result, parts }
    }),

    /** A markdown file imported as a new note beside it: a step only when `make` created a file that was not there. */
    importNote: (folder: string, make: () => Promise<string>): Promise<string> => step("importNote", async () => {
      const before = new Set(await fs.readdir(folder).catch(() => [] as string[]))
      const file = await make()
      const made = path.resolve(path.dirname(file)) === path.resolve(folder) && !before.has(path.basename(file))
      return { result: file, parts: made ? [{ t: "make", path: file, dir: false, copy: null }] : [] }
    }),
  }
}

export type UndoOps = ReturnType<typeof createUndoOps>
