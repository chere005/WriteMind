/**
 * Writes that cannot leave half a file behind, and the small guards the file
 * work in this folder leans on.
 *
 * `fs.writeFile` truncates the file and then fills it, so a crash, a power
 * cut, or a sync client reading in between sees an empty or cut-off note
 * (an 80 MB save polled from another process showed sizes 0, 524288,
 * 1048576 …). The Mac writes with `atomically: true`; this is the same
 * promise: the bytes go to a file beside the real one and are renamed over
 * it, and a reader sees the old file whole or the new file whole.
 */

import { promises as fs } from "node:fs"

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))

export const codeOf = (error: unknown): string =>
  String((error as NodeJS.ErrnoException | undefined)?.code ?? "")

/** What a rename over a file in use answers with. Antivirus and sync clients hold a file for a moment. */
const BUSY = new Set(["EBUSY", "EPERM", "EACCES"])

/** The file the bytes are written to first: beside the real one, so the rename never crosses a disk. */
export const partialOf = (file: string): string => `${file}.tmp`

/** Writes to one file go one after the other: they share the `.tmp` name. */
const queues = new Map<string, Promise<unknown>>()
function inTurn<T>(file: string, job: () => Promise<T>): Promise<T> {
  const key = process.platform === "win32" ? file.toLowerCase() : file
  const turn = (queues.get(key) ?? Promise.resolve()).then(job, job)
  const tail = turn.catch(() => undefined)
  queues.set(key, tail)
  void tail.then(() => { if (queues.get(key) === tail) queues.delete(key) })
  return turn
}

/**
 * The bytes into `file`, whole or not at all. The file's folder must exist.
 * Retries the rename briefly when the file is held by another program; any
 * other failure — a read-only file, a full disk — is thrown as it is, and
 * the `.tmp` is taken away so nothing is left in the person's folder.
 */
export function writeFileAtomic(file: string, data: string | Uint8Array): Promise<void> {
  return inTurn(file, async () => {
    const partial = partialOf(file)
    // A file that is read-only stays read-only: the rename below would replace it on some systems, and "the
    // file is read-only" is the answer the person is owed, at once, not after the retries.
    try {
      await fs.access(file, fs.constants.W_OK)
    } catch (error) {
      if (codeOf(error) !== "ENOENT") throw error
    }
    try {
      await fs.writeFile(partial, data)
      let wait = 15
      for (let attempt = 0; ; attempt++) {
        try {
          await fs.rename(partial, file)
          return
        } catch (error) {
          if (attempt >= 5 || !BUSY.has(codeOf(error))) throw error
          await sleep(wait)
          wait *= 2
        }
      }
    } catch (error) {
      await fs.rm(partial, { force: true }).catch(() => undefined)
      throw error
    }
  })
}

/**
 * At most `max` of these at once. A folder of twelve thousand notes asked for
 * twelve thousand file handles together, the system said EMFILE to the last
 * four thousand, and they were listed under their file names.
 */
export function limiter(max: number): <T>(task: () => Promise<T>) => Promise<T> {
  let active = 0
  const waiting: Array<() => void> = []
  return async <T>(task: () => Promise<T>): Promise<T> => {
    if (active >= max) await new Promise<void>((resolve) => waiting.push(resolve))
    else active += 1
    try {
      return await task()
    } finally {
      // The slot goes straight to whoever has waited longest, or is given back.
      const next = waiting.shift()
      if (next) next()
      else active -= 1
    }
  }
}

/** `work`, or `null` when it has not answered in `ms` (a share that is not there answers in half a minute). */
export function within<T>(ms: number, work: Promise<T>): Promise<T | null> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(null), ms)
    work.then(
      (value) => { clearTimeout(timer); resolve(value) },
      () => { clearTimeout(timer); resolve(null) },
    )
  })
}
