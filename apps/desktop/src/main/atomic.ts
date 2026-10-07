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
 *
 * A `.wm` is written this way every time (docs/SPEC-WM.md 1.9), with the two fsyncs of a DURABLE write: the temporary
 * file's, before the rename, and the folder's, after it (`writeNow`, called by wmStore.ts inside its own queue).
 */

import { promises as fs, constants } from "node:fs"
import path from "node:path"

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))

export const codeOf = (error: unknown): string =>
  String((error as NodeJS.ErrnoException | undefined)?.code ?? "")

/** What a rename over a file in use answers with. Antivirus and sync clients hold a file for a moment. */
const BUSY = new Set(["EBUSY", "EPERM", "EACCES"])

/** The file the bytes are written to first: beside the real one, so the rename never crosses a disk. */
export const partialOf = (file: string): string => `${file}.tmp`

/** Writes to one file go one after the other: they share the `.tmp` name. */
const queues = new Map<string, Promise<unknown>>()
export function inTurn<T>(file: string, job: () => Promise<T>): Promise<T> {
  const key = process.platform === "win32" ? file.toLowerCase() : file
  const turn = (queues.get(key) ?? Promise.resolve()).then(job, job)
  const tail = turn.catch(() => undefined)
  queues.set(key, tail)
  void tail.then(() => { if (queues.get(key) === tail) queues.delete(key) })
  return turn
}

export interface TempFile {
  write(parts: readonly Uint8Array[]): Promise<void>
  sync(): Promise<void>
  close(): Promise<void>
}

/** The file system calls a write makes, so a test can record their order or make one fail (the defaults are `node:fs`). */
export interface WritePorts {
  access(file: string): Promise<void>
  /** The temporary file, created (or truncated) and open: write into it, flush it to the disk, close it. */
  create(file: string): Promise<TempFile>
  rename(from: string, to: string): Promise<void>
  /** Flush the folder's entry to the disk (a no-op where the system cannot). */
  syncFolder(folder: string): Promise<void>
  remove(file: string): Promise<void>
  sleep(ms: number): Promise<void>
}

export const diskPorts: WritePorts = {
  access: (file) => fs.access(file, constants.W_OK),
  async create(file) {
    const handle = await fs.open(file, "w")
    return {
      async write(parts) {
        for (const part of parts) {
          let done = 0
          while (done < part.length) {
            const { bytesWritten } = await handle.write(part, done, part.length - done)
            done += bytesWritten
          }
        }
      },
      sync: () => handle.sync(),
      close: () => handle.close(),
    }
  },
  rename: (from, to) => fs.rename(from, to),
  async syncFolder(folder) {
    // Windows cannot open a folder to flush it, and some file systems refuse: the rename is still whole.
    if (process.platform === "win32") return
    let handle: Awaited<ReturnType<typeof fs.open>> | null = null
    try {
      handle = await fs.open(folder, "r")
      await handle.sync()
    } catch (error) {
      if (!["EISDIR", "EPERM", "EINVAL", "ENOTSUP", "EBADF", "EACCES", "ENOSYS"].includes(codeOf(error))) throw error
    } finally {
      await handle?.close().catch(() => undefined)
    }
  },
  remove: (file) => fs.rm(file, { force: true }),
  sleep,
}

export interface WriteOptions {
  /** Flush the temporary file before the rename and the folder after it (a `.wm`: 1.9 steps 4 and 7). */
  durable?: boolean
  /**
   * Asked immediately before the rename (1.9 step 5): false means somebody else has the file now, and nothing is
   * written (the temporary file goes). It is also asked once before the first byte is written, so that a refusal costs
   * no work. Either question may throw.
   */
  guard?: () => Promise<boolean>
  ports?: WritePorts
}

/**
 * The bytes into `file`, whole or not at all, NOT queued: the caller is already one at a time (`inTurn`). Returns
 * false when the guard said no. The file's folder must exist. Retries the rename briefly when the file is held by
 * another program; any other failure — a read-only file, a full disk — is thrown as it is, and the `.tmp` is taken
 * away so nothing is left in the person's folder.
 */
export async function writeNow(file: string, data: string | Uint8Array | readonly Uint8Array[], options: WriteOptions = {}):
  Promise<boolean> {
  const ports = options.ports ?? diskPorts
  const partial = partialOf(file)
  const parts: readonly Uint8Array[] = typeof data === "string" ? [Buffer.from(data, "utf8")]
    : data instanceof Uint8Array ? [data] : data
  // A file that is read-only stays read-only: the rename below would replace it on some systems, and "the
  // file is read-only" is the answer the person is owed, at once, not after the retries.
  try {
    await ports.access(file)
  } catch (error) {
    if (codeOf(error) !== "ENOENT") throw error
  }
  if (options.guard && !(await options.guard())) return false
  try {
    const temp = await ports.create(partial)
    try {
      await temp.write(parts)
      if (options.durable) await temp.sync()
    } finally {
      await temp.close()
    }
    if (options.guard && !(await options.guard())) {
      await ports.remove(partial).catch(() => undefined)
      return false
    }
    let wait = 15
    for (let attempt = 0; ; attempt++) {
      try {
        await ports.rename(partial, file)
        break
      } catch (error) {
        if (attempt >= 5 || !BUSY.has(codeOf(error))) throw error
        await ports.sleep(wait)
        wait *= 2
      }
    }
    if (options.durable) await ports.syncFolder(path.dirname(file))
    return true
  } catch (error) {
    await ports.remove(partial).catch(() => undefined)
    throw error
  }
}

/**
 * A NEW file, durably and never over one that is there (docs/SPEC-WM.md 1.9: a new note is created without replacing a
 * file that appeared since its name was chosen): the bytes go to the `.tmp` beside it, are flushed, and the temporary
 * file is LINKED to the name (which fails with EEXIST when the name is taken) and then removed. A file system that has
 * no hard links (exFAT, some shares) gets an exclusive copy instead. Throws EEXIST when the name is taken.
 */
export async function createNow(file: string, data: string | Uint8Array | readonly Uint8Array[], ports: WritePorts = diskPorts):
  Promise<void> {
  const partial = partialOf(file)
  const parts: readonly Uint8Array[] = typeof data === "string" ? [Buffer.from(data, "utf8")]
    : data instanceof Uint8Array ? [data] : data
  try {
    const temp = await ports.create(partial)
    try {
      await temp.write(parts)
      await temp.sync()
    } finally {
      await temp.close()
    }
    try {
      await fs.link(partial, file)
    } catch (error) {
      if (codeOf(error) === "EEXIST") throw error
      // No hard links here: an exclusive copy is the same promise.
      await fs.copyFile(partial, file, constants.COPYFILE_EXCL)
    }
    await ports.syncFolder(path.dirname(file))
  } finally {
    await ports.remove(partial).catch(() => undefined)
  }
}

/** The bytes into `file`, whole or not at all, one write of a file at a time. */
export async function writeFileAtomic(file: string, data: string | Uint8Array): Promise<void> {
  await inTurn(file, () => writeNow(file, data))
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
