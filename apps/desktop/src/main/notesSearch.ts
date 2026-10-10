/**
 * THE SIDEBAR'S SEARCH, the main process's half (docs/PLAN-bars-2026-10.md, P3). What a match is and how a note's words
 * are folded and cut for a row is the core's (`notes/search.ts`); this is the part that reads the notes.
 *
 * - The words come through the note store (`wmStore.lookText`: the text entry of the `.wm` alone, in the note's own turn
 *   with the writer) and never by unzipping in the page. Nothing is taken as the app's own: a search is a look.
 * - What was read is kept per file, keyed by its mtime and size (`stat` is the only thing a repeat search asks the disk),
 *   so the second keystroke costs a stat per note and the first a read. The cache is bounded (`MAX_CHARS` of text, the
 *   oldest read dropped first) and a file that is not there any more is dropped when it is next asked for.
 * - It never blocks the main process: the notes are looked at in small batches with a turn given back to the event loop
 *   between them, and a search that has been cancelled (a newer one started, the field was cleared) stops at the next batch.
 * - A note that cannot be read (a damaged `.wm`, a file that is not a note) is still found by its title and file name, and
 *   is counted in `unreadable`; one that is moved or trashed while the search runs is skipped as if it had not been there.
 *
 * No Electron in here: the reader is a port, so the tests give it a fake one.
 */

import { promises as fs } from "node:fs"
import path from "node:path"
import { matchNote, noteText, prepareQuery, type Note, type NoteText } from "@writemind/core"
import { codeOf } from "./atomic"
import { keyOf } from "./echo"
import { lookText } from "./wmStore"
import type { FoundNote, SearchOutcome } from "../shared/search"

export type { FoundNote, SearchOutcome }

/** What the search asks of the disk. */
export interface SearchPorts {
  /** The file's mtime and size, or null when it is not there. */
  stat(file: string): Promise<{ mtimeMs: number; size: number } | null>
  /** The note's words; rejects when the file is no note. */
  text(file: string): Promise<string>
}

export const diskSearchPorts: SearchPorts = {
  stat: (file) => fs.stat(file).then((one) => ({ mtimeMs: one.mtimeMs, size: one.size }), () => null),
  text: lookText,
}

/** The tree the search walks (the sidebar's own: `Section` of notes.ts, without its type to keep this file free of it). */
export interface SearchSection {
  path: string
  name: string
  depth: number
  notes: Note[]
  sections: SearchSection[]
}

/** The most results sent to the page (the rest are "more"). */
export const MAX_HITS = 200
/** Notes looked at at once, and between two batches the event loop gets a turn. */
const BATCH = 24
/** The cache's size in characters (plain text and its folded copy are each that many). */
export const MAX_CHARS = 48_000_000

interface Read { mtimeMs: number; size: number; body: NoteText | null }

/** Better first: the tier, then the most recently changed, then the title. */
export function byRank(a: FoundNote, b: FoundNote): number {
  return a.tier - b.tier || b.modified - a.modified || a.title.localeCompare(b.title) || (a.path < b.path ? -1 : 1)
}

/** Where a note is, for the row: the sections between the project's folder and it (the folder itself when it is in it). */
export function whereOf(chain: readonly { name: string; depth: number }[], several: boolean): string {
  // (A project of one folder: its sections. Several: the folder's name leads, so two projects' "Notes" are told apart.)
  const names = chain.filter((one) => one.depth >= 0 && (several || one.depth > 0)).map((one) => one.name)
  if (names.length === 0) return chain[chain.length - 1]?.name ?? ""
  return names.join(" › ")
}

export class NotesSearch {
  private cache = new Map<string, Read>()
  private chars = 0
  private cancelled = new Set<number>()
  private live = new Set<number>()

  constructor(private ports: SearchPorts = diskSearchPorts, private maxChars = MAX_CHARS) {}

  /** Stop search `id` at its next batch (a search that has already ended is not affected). */
  cancel(id: number): void {
    if (this.live.has(id)) this.cancelled.add(id)
  }

  /** What is held, for the tests. */
  get held(): { notes: number; chars: number } { return { notes: this.cache.size, chars: this.chars } }

  private drop(key: string): void {
    const old = this.cache.get(key)
    if (!old) return
    this.chars -= old.body ? old.body.plain.length + old.body.folded.length : 0
    this.cache.delete(key)
  }

  private keep(key: string, read: Read): void {
    this.drop(key)
    this.cache.set(key, read)
    this.chars += read.body ? read.body.plain.length + read.body.folded.length : 0
    // The oldest read goes first (a Map keeps the order things were put in).
    for (const [old] of this.cache) {
      if (this.chars <= this.maxChars || old === key) break
      this.drop(old)
    }
  }

  /** The note's words, from the cache while the file has not moved; null when it cannot be read; undefined when it is not there. */
  private async wordsOf(file: string): Promise<{ body: NoteText | null } | undefined> {
    const key = keyOf(file)
    const stat = await this.ports.stat(file)
    if (stat === null) { this.drop(key); return undefined }
    const held = this.cache.get(key)
    if (held && held.mtimeMs === stat.mtimeMs && held.size === stat.size) return { body: held.body }
    let body: NoteText | null = null
    try { body = noteText(await this.ports.text(file)) } catch (error) {
      // Moved or trashed since the tree was read: not a note that cannot be read, a note that is not there.
      if (codeOf(error) === "ENOENT" || codeOf(error) === "ENOTDIR") { this.drop(key); return undefined }
      body = null
    }
    this.keep(key, { mtimeMs: stat.mtimeMs, size: stat.size, body })
    return { body }
  }

  /**
   * Search every note of `root` for `typed`. `id` names the search so `cancel` can stop it; a blank query finds nothing.
   * Resolves with `cancelled: true` (and whatever was found so far dropped) when it was stopped.
   */
  async run(id: number, root: SearchSection | null, typed: string): Promise<SearchOutcome> {
    const query = prepareQuery(typed)
    const outcome: SearchOutcome = { query: query?.words ?? "", hits: [], more: false, unreadable: 0, searched: 0, cancelled: false }
    if (!query || !root) return outcome
    this.live.add(id)
    // A project of several folders is a root with no path of its own (notes.ts `projectTree`).
    const several = root.path === ""
    try {
      // The notes in the order the sidebar lists them; one that is listed twice (a folder inside another project folder) once.
      const todo: { note: Note; where: string }[] = []
      const seen = new Set<string>()
      const walk = (section: SearchSection, chain: { name: string; depth: number }[]) => {
        const here = [...chain, { name: section.name, depth: section.depth }]
        for (const note of section.notes) {
          const key = keyOf(note.path)
          if (seen.has(key)) continue
          seen.add(key)
          todo.push({ note, where: whereOf(here, several) })
        }
        for (const child of section.sections) walk(child, here)
      }
      walk(root, [])
      const found: FoundNote[] = []
      for (let start = 0; start < todo.length; start += BATCH) {
        if (this.cancelled.has(id)) { outcome.cancelled = true; return outcome }
        const batch = todo.slice(start, start + BATCH)
        const words = await Promise.all(batch.map(({ note }) => this.wordsOf(note.path)))
        for (let i = 0; i < batch.length; i++) {
          const read = words[i]
          if (read === undefined) continue
          const { note, where } = batch[i]!
          outcome.searched++
          if (read.body === null) outcome.unreadable++
          const stem = path.basename(note.path).replace(/\.[^.]*$/, "")
          const hit = matchNote(query, { title: note.title, stem, snippet: note.snippet }, read.body)
          if (hit) found.push({ ...hit, path: note.path, title: note.title, where, modified: note.modified })
        }
        // A turn for everything else the main process does (the pen, the saves, the menu) between two batches.
        await new Promise<void>((resolve) => setImmediate(resolve))
      }
      if (this.cancelled.has(id)) { outcome.cancelled = true; return outcome }
      found.sort(byRank)
      outcome.more = found.length > MAX_HITS
      outcome.hits = found.slice(0, MAX_HITS)
      return outcome
    } finally {
      this.live.delete(id)
      this.cancelled.delete(id)
    }
  }
}
