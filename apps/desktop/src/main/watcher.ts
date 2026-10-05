/**
 * Watching the project's folders — and noticing when one of them stops being there, or comes back.
 *
 * A recursive watcher on Windows is a handle on a DIRECTORY, and it does not know the directory has gone:
 * when a watched folder is deleted for good (rmdir, Shift+Delete, `git clean`, a sync client, a stick pulled
 * out, a share that went away) it never errors. It says `rename` about the dead folder's own path, spelled
 * `\\?\C:\…`, about 90,000 times a second for ever — the main process pinned a core, `notes:changed` reached
 * the page every ~190 ms and the sidebar's tree was read again five times a second until a restart (measured:
 * 3.2 to 4.7 CPU-seconds per 3 s). Moving the folder to the Recycle Bin or renaming it does not do that, but
 * leaves the watcher on a folder that is no longer at the path the project means.
 *
 * So a watcher here is never trusted to say that a folder is gone:
 *  - an event that is the dead folder's own absolute path is the whole signature of the flood: the watcher is
 *    closed on the first one, before anything else is done with it;
 *  - a burst that is a lot of events looks at the folder at once, whatever the names are;
 *  - every couple of seconds each folder is looked at (one cheap `stat`, never waited on for long: a share
 *    that does not answer is "unknown", not "gone");
 *  - and the SAME look is what notices that a folder which was not there at launch (a stick not plugged in
 *    yet, a share that is offline) has arrived: it is watched from then on and the page is told.
 *
 * It tells the page only when a folder's presence CHANGES (`presence`), so the sidebar's "can't open the
 * folder" panel and the footer's counts follow the disk. No Electron in this file: the ports (the watch and
 * the look) are injected, which is what lets the tests drive a folder that comes and goes.
 */

import { promises as fs, watch as fsWatch } from "node:fs"
import path from "node:path"
import { codeOf, within } from "./atomic"

export interface WatchHandle { close(): void }

/** What the module needs from the file system. */
export interface WatchPorts {
  /** Watch `root` and everything under it; throws when it cannot (the folder is not there). `name` is relative to `root`. */
  watch(root: string, onEvent: (name: string | null) => void, onError: () => void): WatchHandle
  /** Whether `root` is a folder right now; "unknown" when the drive did not answer. */
  look(root: string): Promise<"folder" | "gone" | "unknown">
}

export interface WatchHooks {
  /** Something under `root` was reported. */
  event(root: string, name: string | null): void
  /** Which folders have a live watcher — told on every change of that set (the tree reader lends its trust to those). */
  covered(folders: string[]): void
  /** A folder went away, or came back, after the watch began. */
  presence(root: string, here: boolean): void
}

export interface WatchOptions {
  /** How often every folder is looked at (ms). */
  every?: number
  /** How many events before the folder is looked at without waiting for the next look. */
  burst?: number
}

/** How long a look may take before the answer is "unknown": a share that is not reachable takes half a minute. */
const LOOK_WAIT = 4000
const GONE = new Set(["ENOENT", "ENOTDIR"])

export const nodePorts: WatchPorts = {
  watch(root, onEvent, onError) {
    const watcher = fsWatch(root, { recursive: true }, (_event, name) => onEvent(name === null ? null : name.toString()))
    watcher.on("error", onError)
    return watcher
  },
  async look(root) {
    const seen = await within(LOOK_WAIT, fs.stat(root).then(
      (stat) => (stat.isDirectory() ? "folder" : "gone") as "folder" | "gone",
      (error) => (GONE.has(codeOf(error)) ? "gone" : "unknown") as "gone" | "unknown",
    ))
    return seen ?? "unknown"
  },
}

/**
 * An event that is not a name inside the folder: the dead folder's own path, absolute and in the `\\?\` form.
 * A real name is always relative to the folder that is watched.
 */
export const isDeadName = (name: string): boolean => name.startsWith("\\\\?\\") || path.isAbsolute(name)

interface Entry {
  root: string
  handle: WatchHandle | null
  /** What the page was last told: here (true) or not (false). */
  told: boolean
  events: number
  looking: boolean
}

export interface FolderWatch {
  /** Watch these folders from now on (the ones before are let go). The ones that are not there are tried again. */
  set(folders: string[]): void
  /** Let everything go. */
  stop(): void
  /** The folders with a live watcher. */
  covered(): string[]
  /** Look at every folder now (the timer does this; a window that comes forward may as well). */
  look(): Promise<void>
}

export function followFolders(ports: WatchPorts, hooks: WatchHooks, options: WatchOptions = {}): FolderWatch {
  const every = options.every ?? 2000
  const burst = options.burst ?? 400
  let entries: Entry[] = []
  let timer: ReturnType<typeof setInterval> | null = null
  /** Bumped by `set` and `stop`: an answer that arrives for an earlier set of folders is dropped. */
  let generation = 0

  const covered = (): string[] => entries.filter((one) => one.handle !== null).map((one) => one.root)
  const publish = (): void => hooks.covered(covered())

  const release = (entry: Entry): void => {
    const handle = entry.handle
    entry.handle = null
    if (!handle) return
    try { handle.close() } catch { /* already closed */ }
  }

  /** The watcher is closed, now, and the page is told (once) that the folder is not there. */
  const lose = (entry: Entry): void => {
    if (!entry.handle) return
    release(entry)
    publish()
    if (entry.told) {
      entry.told = false
      hooks.presence(entry.root, false)
    }
  }

  const arm = (entry: Entry): boolean => {
    try {
      entry.handle = ports.watch(
        entry.root,
        (name) => heard(entry, name),
        () => lose(entry),
      )
    } catch {
      entry.handle = null
      return false
    }
    entry.events = 0
    return true
  }

  function heard(entry: Entry, name: string | null): void {
    // The flood of a folder that is gone is cut off at its first event, before the rest of the callback runs.
    if (!entry.handle) return
    if (name !== null && isDeadName(name)) { lose(entry); return }
    hooks.event(entry.root, name)
    if (++entry.events >= burst && !entry.looking) void check(entry)
  }

  async function check(entry: Entry): Promise<void> {
    if (entry.looking) return
    const mine = generation
    entry.looking = true
    entry.events = 0
    let seen: "folder" | "gone" | "unknown"
    try { seen = await ports.look(entry.root) } catch { seen = "unknown" }
    entry.looking = false
    if (mine !== generation) return
    if (entry.handle) {
      if (seen === "gone") lose(entry)
    } else if (seen === "folder" && arm(entry)) {
      publish()
      if (!entry.told) {
        entry.told = true
        hooks.presence(entry.root, true)
      }
    }
  }

  const look = async (): Promise<void> => {
    await Promise.all(entries.map((entry) => check(entry)))
  }

  const stop = (): void => {
    generation++
    for (const entry of entries) release(entry)
    entries = []
    if (timer) { clearInterval(timer); timer = null }
    publish()
  }

  return {
    set(folders) {
      generation++
      for (const entry of entries) release(entry)
      entries = folders.map((root) => ({ root, handle: null, told: false, events: 0, looking: false }))
      for (const entry of entries) entry.told = arm(entry)
      publish()
      if (timer) { clearInterval(timer); timer = null }
      if (entries.length > 0) {
        timer = setInterval(() => { void look() }, every)
        timer.unref?.()
      }
    },
    stop,
    covered,
    look,
  }
}
