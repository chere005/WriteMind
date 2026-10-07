/**
 * What this process wrote a moment ago, so the folder watcher can ignore its own echo — and which files the tree reader
 * has to look at again (the watcher said something moved, or we wrote it). Shared by notes.ts and wmStore.ts.
 */

import path from "node:path"

export const fold = (value: string): string => (process.platform === "win32" ? value.toLowerCase() : value)
export const keyOf = (file: string): string => fold(path.resolve(file))

/** Files the watcher has said something about, or that were written here: the next look at them is a real one. */
export const dirtyFiles = new Set<string>()

const wrote = new Map<string, number>()

/** This process is about to write (or has written) `file`. */
export const remember = (file: string): void => {
  const now = Date.now()
  wrote.set(path.resolve(file), now)
  dirtyFiles.add(keyOf(file))
  // (Only the last few seconds matter; a long session must not keep every file it ever wrote.)
  if (wrote.size > 64) for (const [key, at] of wrote) if (now - at > 5000) wrote.delete(key)
}

export function wroteRecently(file: string, ms = 800): boolean {
  const now = Date.now()
  const target = path.resolve(file)
  const at = wrote.get(target)
  if (at !== undefined && now - at < ms) return true
  // A write inside a folder is also an event for the FOLDER (Windows reports the directory whose entry changed),
  // and that echo used to read the whole tree, the note and its drawing again after every save of a note in a section.
  const inside = target + path.sep
  for (const [key, when] of wrote) if (now - when < ms && key.startsWith(inside)) return true
  return false
}
