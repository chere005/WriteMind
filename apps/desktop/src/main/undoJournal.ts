/**
 * THE UNDO JOURNAL (docs/PLAN-undo.md): the last three FILE steps, whatever they were, and the backups that make them
 * undoable. Sean, 2026-10-10: "make sure undo is always able to undo up to 3 steps, even if it involves file changes, which
 * may mean keeping file backups until undo goes out of scope."
 *
 * A step is a list of PARTS (a file moved, a file made, a thing sent to the bin, a folder's row order, a picture taken out of
 * a note), applied in order and taken back in reverse. The operations (main/undoOps.ts) do their work through the functions
 * the app always used and describe what they did here; this file takes it back and does it again, through the same
 * guards: a restore never overwrites (the exclusive writer; a taken name gets a number and the person is told), a removal
 * only of what the app owns (the digest check), every write of an order file through `writeOrder`.
 *
 * A FAILED UNDO CHANGES NOTHING: the parts already done are taken back in reverse, and the step stays where it was. A step
 * whose subject has gone (a note another program removed or changed) is DROPPED, with its backups, so that it does not
 * block the older steps behind it.
 *
 * Backups live under the app's own data folder (`<userData>/undo`), never beside the notes, and are deleted when their step
 * falls out of scope: more than three steps back, superseded by a new step after an undo, the window closed, the project
 * left, the app quit (synchronously), and at the next launch for anything a crash left. No Electron in this file: the bin
 * is passed in, like housekeeping's.
 */

import { constants, promises as fs, rmSync } from "node:fs"
import path from "node:path"
import { withEntry, type NoteOrder } from "@writemind/core"
import { codeOf } from "./atomic"
import { notesUnder, readOrder, uniquePath, writeOrder } from "./notes"
import { commit, movedNote, restoreBytes, takeOwned } from "./wmStore"
import {
  EMPTY_UNDO, STEP_LABELS, UNDO_DEPTH, noEffects, takenNotice, wallNow,
  type StepInfo, type StepKind, type UndoEffects, type UndoOutcome, type UndoState,
} from "../shared/undo"

/** Puts one file or folder in the Recycle Bin / Trash (housekeeping's type again, so this file imports nothing of it). */
export type Trash = (file: string) => Promise<void>

// MARK: - Errors

/**
 * Why a step cannot be taken back. `droppable`: the state the step was about has gone for good (a note another program
 * changed or removed), so trying again is no use and the step must not block the older ones; the other failures (a file in
 * use, a full disk) may pass and the step stays for a second try.
 */
export class StepError extends Error {
  constructor(message: string, readonly droppable: boolean) { super(message) }
}

const REASONS: Record<string, string> = {
  EPERM: "it is read-only or open in another program",
  EACCES: "it is read-only or open in another program",
  EBUSY: "it is open in another program",
  EROFS: "the disk is read-only",
  ENOSPC: "the disk is full",
  ENOENT: "it is no longer there",
  EEXIST: "something with that name is already there",
  ENOTEMPTY: "it is not empty",
}

/** A failure in a person's words. */
export function reasonOf(error: unknown): string {
  if (error instanceof StepError) return error.message
  const code = codeOf(error)
  if (code && REASONS[code]) return `${REASONS[code]} (${code})`
  return error instanceof Error ? error.message : String(error)
}

// MARK: - Parts

/** What happened to one folder's row order: only the keys (folders) whose lists differ. */
export interface OrderChange {
  /** The project folder whose `.writemind/order.json` it is, and the notes root `readOrder` falls back to. */
  owner: string
  root: string
  keys: { key: string; before: string[] | null; after: string[] | null }[]
}

export type Part =
  /** A file or folder renamed or moved. The notes under a folder follow it. */
  | { t: "move"; from: string; to: string; dir: boolean }
  /** A file or empty folder the operation created. `copy` is a file's content, kept when it is taken away. */
  | { t: "make"; path: string; dir: boolean; copy: string | null }
  /** A file or folder sent to the bin; `copy` is the backup made before it went. */
  | { t: "bin"; path: string; dir: boolean; link: boolean; copy: string }
  | { t: "order"; change: OrderChange }
  /** A picture or snapshot Clean Up took out of a note; `copy` is its bytes. */
  | { t: "entry"; note: string; name: string; copy: string }

interface Step {
  id: string
  kind: StepKind
  at: number
  undoneAt: number | null
  parts: Part[]
  /** The folder the step's backups are in (deleted with the step). */
  dir: string
}

const info = (step: Step): StepInfo =>
  ({ id: step.id, kind: step.kind, label: STEP_LABELS[step.kind], at: step.at, undoneAt: step.undoneAt })

// MARK: - Small file helpers

const exists = (target: string): Promise<boolean> => fs.lstat(target).then(() => true, () => false)

/** Two names for the same entry (a case-only rename on a case-insensitive disk): the check for "taken" must not see itself. */
async function sameEntry(a: string, b: string): Promise<boolean> {
  try {
    const [x, y] = await Promise.all([fs.lstat(a, { bigint: true }), fs.lstat(b, { bigint: true })])
    return x.ino !== 0n && x.ino === y.ino && x.dev === y.dev
  } catch { return false }
}

/** A sibling name nothing has: `Name 2.wm`, `Folder 2`. */
async function uniqueSibling(wanted: string, dir: boolean): Promise<string> {
  const extension = dir ? "" : path.extname(wanted)
  return uniquePath(path.dirname(wanted), path.basename(wanted, extension), extension)
}

const stem = (target: string, dir: boolean): string => path.basename(target, dir ? "" : path.extname(target))

/** What a folder holds, as one string: every path under it and its size. Two folders with the same string have the same files. */
async function listing(folder: string, base = folder): Promise<string> {
  const out: string[] = []
  const entries = await fs.readdir(folder, { withFileTypes: true })
  for (const entry of entries.sort((a, b) => (a.name < b.name ? -1 : 1))) {
    const full = path.join(folder, entry.name)
    const relative = path.relative(base, full).replace(/\\/g, "/")
    if (entry.isDirectory()) out.push(`${relative}/`, await listing(full, base))
    else if (entry.isSymbolicLink()) out.push(`${relative} -> ${await fs.readlink(full)}`)
    else out.push(`${relative} ${(await fs.stat(full)).size}`)
  }
  return out.filter((line) => line !== "").join("\n")
}

/** A symbolic link is kept as a file holding the text of its target. */
const LINK_SUFFIX = ".symlink"

/** The ways a copy is made: a clone where the volume has one (`FICLONE` falls back to an ordinary copy where it has not). */
const CLONE = { recursive: true, errorOnExist: true, force: false, mode: constants.COPYFILE_FICLONE, verbatimSymlinks: true } as const

/**
 * A COPY of `source` at `copy` (nothing there yet), checked against the original before the original is touched. A symbolic
 * link is kept as a link. A copy that fails is taken away again.
 */
export async function copyOut(source: string, copy: string): Promise<{ dir: boolean; link: boolean; copy: string }> {
  const stat = await fs.lstat(source)
  await fs.mkdir(path.dirname(copy), { recursive: true })
  try {
    if (stat.isSymbolicLink()) {
      const kept = copy + LINK_SUFFIX
      await fs.writeFile(kept, await fs.readlink(source), { flag: "wx" })
      return { dir: false, link: true, copy: kept }
    }
    if (stat.isDirectory()) {
      await fs.cp(source, copy, CLONE)
      if ((await listing(source)) !== (await listing(copy))) throw new Error(`the copy of “${path.basename(source)}” is not the same as the folder`)
      return { dir: true, link: false, copy }
    }
    await fs.copyFile(source, copy, constants.COPYFILE_FICLONE | constants.COPYFILE_EXCL)
    if ((await fs.stat(copy)).size !== stat.size) throw new Error(`the copy of “${path.basename(source)}” is not the same size as the file`)
    return { dir: false, link: false, copy }
  } catch (error) {
    await fs.rm(copy, { recursive: true, force: true }).catch(() => undefined)
    await fs.rm(copy + LINK_SUFFIX, { force: true }).catch(() => undefined)
    throw error
  }
}

/** A kept copy put at `target` (nothing there): the other half of `copyOut`. Takes what it made away if it fails. */
async function copyIn(part: { copy: string; dir: boolean; link: boolean }, target: string): Promise<void> {
  try {
    if (part.link) await fs.symlink(await fs.readFile(part.copy, "utf8"), target)
    else if (part.dir) await fs.cp(part.copy, target, CLONE)
    // A note goes back through the exclusive writer, and the app knows it again.
    else if (/\.wm$/i.test(target)) await restoreBytes(target, await fs.readFile(part.copy))
    else await fs.copyFile(part.copy, target, constants.COPYFILE_FICLONE | constants.COPYFILE_EXCL)
  } catch (error) {
    // Only ever what this call made: the exclusive create refuses an existing name, so an EEXIST is somebody else's.
    if (codeOf(error) !== "EEXIST") await fs.rm(target, { recursive: true, force: true }).catch(() => undefined)
    throw error
  }
}

const cleanName = (name: string): string => name.replace(/[\\/:*?"<>|]/g, "_")

// MARK: - The draft: backups made before the work is done

export class Draft {
  private count = 0
  /** `root` is the folder this draft's own folder is inside (a draft only ever removes its own folder). */
  constructor(readonly id: string, readonly kind: StepKind, readonly dir: string, private readonly root: string) {}

  /** A copy of `source` in this step's folder; the returned path is what a part keeps. */
  async backup(source: string): Promise<{ dir: boolean; link: boolean; copy: string }> {
    try {
      return await copyOut(source, path.join(this.dir, `${++this.count}-${cleanName(path.basename(source))}`))
    } catch (error) {
      throw new StepError(`a copy for Undo could not be made (${reasonOf(error)}), so nothing was changed`, false)
    }
  }

  /** Bytes kept as a file of the step. */
  async keep(name: string, bytes: Uint8Array): Promise<string> {
    const copy = path.join(this.dir, `${++this.count}-${cleanName(name)}`)
    await fs.mkdir(this.dir, { recursive: true })
    await fs.writeFile(copy, bytes, { flag: "wx" })
    return copy
  }

  /** The work failed: this step's backups go (the step was never recorded). */
  async abort(): Promise<void> {
    if (path.dirname(this.dir) === this.root) await fs.rm(this.dir, { recursive: true, force: true }).catch(() => undefined)
  }
}

// MARK: - Order lists

const same = (a: string[] | null, b: string[] | null): boolean =>
  (a === null || b === null) ? a === b : a.length === b.length && a.every((name, at) => name === b[at])

/**
 * The list that takes `now` the way `from` → `to` goes, when `now` is NOT `from` (it has moved on since: another program, or
 * a change the journal does not hold). The names `from` had that `to` lacks are taken out; the names `to` has that `from`
 * lacked are put in, at their place in `to` (or the end). Nothing else in the list is touched.
 */
export function invert(now: string[] | null, from: string[] | null, to: string[] | null): string[] | null {
  const before = new Set(from ?? [])
  const after = new Set(to ?? [])
  const out = (now ?? []).filter((name) => !(before.has(name) && !after.has(name)))
  const wanted = to ?? []
  for (const name of wanted) {
    if (before.has(name) || out.includes(name)) continue
    out.splice(Math.min(wanted.indexOf(name), out.length), 0, name)
  }
  return out
}

// MARK: - The journal

export interface JournalDeps {
  /** The folder backups live in: `<userData>/undo`. It must be called `undo`: all of it is emptied at launch and at quit. */
  backups: string
  bin: Trash
  /** Told whenever the stacks change. */
  changed?(state: UndoState): void
  depth?: number
}

type Done = { rollback: () => Promise<void>; settle: () => void }
const NOTHING: Done = { rollback: async () => undefined, settle: () => undefined }

export class UndoJournal {
  private undoSteps: Step[] = []
  private redoSteps: Step[] = []
  private counter = 0
  private newest = 0
  private tail: Promise<unknown> = Promise.resolve()
  private readonly depth: number
  /** This run's own folder under the backups folder. */
  private readonly run: string

  constructor(private readonly deps: JournalDeps) {
    if (path.basename(deps.backups) !== "undo") throw new Error("the undo journal keeps its backups in a folder called “undo”")
    this.depth = deps.depth ?? UNDO_DEPTH
    this.run = path.join(deps.backups, `${process.pid}-${Date.now().toString(36)}`)
  }

  // --- what the page may ask

  state(): UndoState {
    const top = this.undoSteps.at(-1)
    const next = this.redoSteps.at(-1)
    if (!top && !next && this.newest === 0) return EMPTY_UNDO
    return {
      undo: top ? info(top) : null, redo: next ? info(next) : null,
      undoCount: this.undoSteps.length, redoCount: this.redoSteps.length, newestAt: this.newest,
    }
  }

  private emit(): void { this.deps.changed?.(this.state()) }

  /** One at a time: an operation, an undo and a redo never overlap, and run in the order they were asked for. */
  exclusive<T>(job: () => Promise<T>): Promise<T> {
    const turn = this.tail.then(job, job)
    this.tail = turn.catch(() => undefined)
    return turn
  }

  // --- recording

  /** Starts a step: its id and its backup folder (made when something is kept in it). Call inside `exclusive`. */
  begin(kind: StepKind): Draft {
    const id = `s${++this.counter}`
    return new Draft(id, kind, path.join(this.run, id), this.run)
  }

  /** The work succeeded: it is a step now. A fourth step puts the first out of scope; a new step ends every redo. Call inside `exclusive`. */
  async record(draft: Draft, parts: Part[]): Promise<StepInfo> {
    const step: Step = { id: draft.id, kind: draft.kind, at: wallNow(), undoneAt: null, parts, dir: draft.dir }
    const gone = [...this.redoSteps]
    this.redoSteps = []
    this.undoSteps.push(step)
    this.newest = step.at
    while (this.undoSteps.length > this.depth) gone.push(this.undoSteps.shift()!)
    this.emit()
    await Promise.all(gone.map((one) => this.discard(one)))
    return info(step)
  }

  /** A new edit on the page ends the redo path: every undone step is let go with its backups. */
  cutRedo(): Promise<void> {
    return this.exclusive(async () => {
      if (this.redoSteps.length === 0) return
      const gone = this.redoSteps
      this.redoSteps = []
      this.emit()
      await Promise.all(gone.map((one) => this.discard(one)))
    })
  }

  // --- undo and redo

  undo(): Promise<UndoOutcome> { return this.exclusive(() => this.turn("undo")) }
  redo(): Promise<UndoOutcome> { return this.exclusive(() => this.turn("redo")) }

  private async turn(which: "undo" | "redo"): Promise<UndoOutcome> {
    const from = which === "undo" ? this.undoSteps : this.redoSteps
    const step = from.at(-1)
    if (!step) return { ok: null, which }
    const label = STEP_LABELS[step.kind]
    let effects: UndoEffects
    try {
      effects = await this.perform(step, which === "undo" ? "back" : "again")
    } catch (error) {
      const dropped = error instanceof StepError && error.droppable
      if (dropped) {
        from.pop()
        this.emit()
        await this.discard(step)
      }
      return { ok: false, which, label, why: reasonOf(error), dropped }
    }
    from.pop()
    if (which === "undo") { step.undoneAt = wallNow(); this.redoSteps.push(step) } else { step.undoneAt = null; this.undoSteps.push(step) }
    this.emit()
    return { ok: true, which, label, effects }
  }

  /** Every part of the step, in order (or reversed), each with the means to take it back if a later one fails. */
  private async perform(step: Step, direction: "back" | "again"): Promise<UndoEffects> {
    const parts = direction === "back" ? [...step.parts].reverse() : step.parts
    const effects = noEffects()
    const rollbacks: (() => Promise<void>)[] = []
    const settle: (() => void)[] = []
    try {
      for (const part of parts) {
        const done = await this.part(step, part, direction, effects)
        rollbacks.push(done.rollback)
        settle.push(done.settle)
      }
    } catch (error) {
      for (const rollback of rollbacks.reverse()) await rollback().catch(() => undefined)
      throw error
    }
    // The step's own record of where things are changes only when the whole step went through.
    for (const apply of settle) apply()
    return effects
  }

  // --- the parts

  private part(step: Step, part: Part, direction: "back" | "again", effects: UndoEffects): Promise<Done> {
    const back = direction === "back"
    switch (part.t) {
      case "move": return this.move(part, back, effects)
      case "order": return this.reorder(part.change, back)
      case "entry": return this.entry(part, back)
      case "make": return back ? this.unmake(step, part, effects) : this.remake(part, effects)
      case "bin": return back ? this.unbin(part, effects) : this.rebin(part, effects)
    }
  }

  /** A rename or move, one way or the other. */
  private async move(part: Extract<Part, { t: "move" }>, back: boolean, effects: UndoEffects): Promise<Done> {
    const source = back ? part.to : part.from
    const wanted = back ? part.from : part.to
    if (!(await exists(source))) {
      throw new StepError(`“${path.basename(source)}” is not where it was left, so it was not ${back ? "moved back" : "moved again"}`, true)
    }
    let target = wanted
    let notice: string | null = null
    if ((await exists(wanted)) && !(await sameEntry(source, wanted))) {
      target = await uniqueSibling(wanted, part.dir)
      notice = takenNotice(stem(wanted, part.dir), stem(target, part.dir))
    }
    // A parent that has gone (a section removed since) is not made again: the move cannot be done, and says so.
    if (!(await exists(path.dirname(target)))) throw new StepError(`the folder “${path.basename(path.dirname(target))}” is not there any more`, true)
    // The notes under a folder, by their place in it: they follow it.
    const inside = part.dir ? (await notesUnder(source)).map((note) => path.relative(source, note)) : [""]
    const follow = (from: string, to: string) => { for (const rel of inside) movedNote(path.join(from, rel), path.join(to, rel)) }
    await fs.rename(source, target)
    follow(source, target)
    effects.moved.push({ from: source, to: target })
    if (notice) effects.notices.push(notice)
    return {
      rollback: async () => { await fs.rename(target, source); follow(target, source) },
      settle: () => { if (back) part.from = target; else part.to = target },
    }
  }

  /** A folder's row order, taken to one side of what the step changed. */
  private async reorder(change: OrderChange, back: boolean): Promise<Done> {
    const read = await readOrder(change.owner, change.root)
    const next: NoteOrder = { folders: { ...read.folders } }
    for (const { key, before, after } of change.keys) {
      const [from, to] = back ? [after, before] : [before, after]
      const now = next.folders[key] ?? null
      const list = same(now, from) ? to : invert(now, from, to)
      if (list === null || list.length === 0) delete next.folders[key]
      else next.folders[key] = list
    }
    const changed = JSON.stringify(next) !== JSON.stringify(read)
    if (changed) await writeOrder(change.owner, next)
    return { rollback: async () => { if (changed) await writeOrder(change.owner, read) }, settle: () => undefined }
  }

  /** A picture put back into a note, or taken out of it again (Clean Up). */
  private async entry(part: Extract<Part, { t: "entry" }>, back: boolean): Promise<Done> {
    if (!(await exists(part.note))) throw new StepError(`the note “${path.basename(part.note)}” is not there any more`, true)
    const bytes = back ? new Uint8Array(await fs.readFile(part.copy)) : null
    let before: Uint8Array | null = null
    const out = await commit(part.note, (wm) => {
      before = wm.entries.find((one) => one.name === part.name)?.data ?? null
      return withEntry(wm, part.name, bytes)
    })
    if (!out.written && out.refused !== null) {
      throw new StepError(`the note “${path.basename(part.note)}” was changed by another program, so its picture was not ${back ? "put back" : "taken out again"}`, true)
    }
    return {
      rollback: async () => { await commit(part.note, (wm) => withEntry(wm, part.name, before)) },
      settle: () => undefined,
    }
  }

  /** Undo of a creation: what the operation made is kept, then taken away. */
  private async unmake(step: Step, part: Extract<Part, { t: "make" }>, effects: UndoEffects): Promise<Done> {
    if (part.dir) {
      if (!(await exists(part.path))) return NOTHING
      try { await fs.rmdir(part.path) } catch (error) {
        if (codeOf(error) === "ENOTEMPTY" || codeOf(error) === "EEXIST") {
          throw new StepError(`“${path.basename(part.path)}” has things in it now, so it was not removed`, true)
        }
        throw error
      }
      effects.removed.push(part.path)
      return { rollback: async () => { await fs.mkdir(part.path) }, settle: () => undefined }
    }
    // A file: kept first, then removed, in the note's own write queue and only while the app owns what is on disk.
    const draft = new Draft(step.id, step.kind, step.dir, this.run)
    let copy: string | null = null
    const result = await takeOwned(part.path, async (bytes) => { copy = await draft.keep(path.basename(part.path), bytes) })
    if (result === "gone") return NOTHING
    if (result === "changed") throw new StepError(`“${path.basename(part.path)}” was changed by another program, so it was not removed`, true)
    effects.removed.push(part.path)
    const kept = copy as string | null
    return {
      rollback: async () => { if (kept) await restoreBytes(part.path, await fs.readFile(kept)) },
      settle: () => { part.copy = kept },
    }
  }

  /** Redo of a creation: made again from what was kept. */
  private async remake(part: Extract<Part, { t: "make" }>, effects: UndoEffects): Promise<Done> {
    let target = part.path
    let notice: string | null = null
    if (!part.dir && part.copy === null) throw new StepError(`there is nothing kept of “${path.basename(part.path)}” to bring back`, true)
    if (await exists(target)) { target = await uniqueSibling(target, part.dir); notice = takenNotice(stem(part.path, part.dir), stem(target, part.dir)) }
    if (!(await exists(path.dirname(target)))) throw new StepError(`the folder “${path.basename(path.dirname(target))}” is not there any more`, true)
    if (part.dir) await fs.mkdir(target)
    else await restoreBytes(target, await fs.readFile(part.copy!))
    effects.restored.push({ path: target, was: part.path })
    if (notice) effects.notices.push(notice)
    return {
      rollback: async () => { if (part.dir) await fs.rmdir(target); else await takeOwned(target) },
      settle: () => { part.path = target },
    }
  }

  /** Undo of a move to the bin: put back from the backup (the item stays in the bin). */
  private async unbin(part: Extract<Part, { t: "bin" }>, effects: UndoEffects): Promise<Done> {
    let target = part.path
    let notice: string | null = null
    if (await exists(target)) { target = await uniqueSibling(target, part.dir); notice = takenNotice(stem(part.path, part.dir), stem(target, part.dir)) }
    if (!(await exists(path.dirname(target)))) throw new StepError(`the folder “${path.basename(path.dirname(target))}” is not there any more`, true)
    await copyIn(part, target)
    effects.restored.push({ path: target, was: part.path })
    if (notice) effects.notices.push(notice)
    return {
      // (only ever what this call made: the name was free a moment ago and the copy refuses an existing one)
      rollback: async () => { await fs.rm(target, { recursive: true, force: true }) },
      settle: () => { part.path = target },
    }
  }

  /** Redo of a move to the bin: to the bin again (a second item there). */
  private async rebin(part: Extract<Part, { t: "bin" }>, effects: UndoEffects): Promise<Done> {
    if (!(await exists(part.path))) throw new StepError(`“${path.basename(part.path)}” is not there any more`, true)
    await this.deps.bin(part.path)
    effects.removed.push(part.path)
    return { rollback: async () => { if (!(await exists(part.path))) await copyIn(part, part.path) }, settle: () => undefined }
  }

  // --- clearing

  /** A step's backups go. Only ever a folder this journal made inside its own run folder. */
  private async discard(step: Step): Promise<void> {
    if (path.dirname(step.dir) !== this.run) return
    await fs.rm(step.dir, { recursive: true, force: true }).catch(() => undefined)
  }

  /** Every step and every backup of this run goes (the window closed, another project opened). */
  clear(): Promise<void> {
    return this.exclusive(async () => {
      this.undoSteps = []
      this.redoSteps = []
      this.newest = 0
      this.emit()
      await fs.rm(this.run, { recursive: true, force: true }).catch(() => undefined)
    })
  }

  /** Launch: whatever an earlier run left under the backups folder is stale (a crash is the only way a backup outlives its run). */
  async sweepStale(): Promise<void> {
    await fs.rm(this.deps.backups, { recursive: true, force: true }).catch(() => undefined)
  }

  /** Quit: synchronously, because `will-quit` cannot wait. */
  disposeSync(): void {
    try { rmSync(this.deps.backups, { recursive: true, force: true }) } catch { /* the next launch sweeps */ }
  }
}
