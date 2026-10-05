/**
 * What a person may call a note or a section, made into a name the disk takes.
 *
 * The Mac only has to keep `/` and `:` out of a name. Windows refuses
 * `< > : " / \ | ? *`, the control characters, a trailing dot or space, and
 * a handful of device names (`CON`, `NUL`, `COM1` …) with any extension —
 * and "What now?" used to reach the disk as it was typed and come back as
 * `ENOENT: no such file or directory, rename …`. So the name is made fit here,
 * before it is used, and what was done to it is no surprise: the characters
 * the platform will not store go (or become a dash where they were a
 * separator), and the rest is what was typed.
 */

/** Device names Windows keeps for itself, with or without an extension. */
const RESERVED = /^(con|prn|aux|nul|com[0-9]|lpt[0-9])$/i

/** The most a note's or section's own name keeps, before the extension. */
export const MAX_STEM = 100

export interface NameOptions {
  platform?: NodeJS.Platform | string
  /** The folder it will sit in: a long folder leaves less room for the name (Windows' 260). */
  folder?: string
  /** The extension that will be added, with its dot. */
  extension?: string
}

/**
 * A name fit to be a file or folder name here, or "" when nothing of it is
 * left (the caller says what that means: "Untitled", or a name that cannot be
 * used).
 */
export function safeName(typed: string, options: NameOptions = {}): string {
  const platform = options.platform ?? process.platform
  let name = typed
  // These are separators wherever the name goes, and were a dash before this file existed.
  name = name.replace(/[/\\:]/g, "-")
  // Control characters are never part of a name.
  name = name.replace(/[\u0000-\u001f\u007f]/g, "")
  if (platform === "win32") {
    name = name
      .replace(/\|/g, "-")
      .replace(/"/g, "'")
      .replace(/[<>?*]/g, "")
  }
  // A leading dot would hide it from the sidebar (the tree skips dot files); spaces at the ends are never meant.
  name = name.replace(/^[\s.]+/, "")
  // Windows quietly removes trailing dots and spaces, so the name it returns is not the name that was asked for.
  name = name.replace(/[\s.]+$/, "")
  const room = platform === "win32" && options.folder !== undefined
    ? Math.max(12, 248 - options.folder.length - (options.extension?.length ?? 0) - 1)
    : MAX_STEM
  const limit = Math.min(MAX_STEM, room)
  if (name.length > limit) {
    // Not in the middle of a surrogate pair.
    let cut = limit
    const code = name.charCodeAt(cut - 1)
    if (code >= 0xd800 && code <= 0xdbff) cut -= 1
    name = name.slice(0, cut).replace(/[\s.]+$/, "")
  }
  if (platform === "win32" && RESERVED.test(name)) name = `${name}-`
  return name
}

/** A message for a rename the disk still refused (the name is fit; the file may be in use). */
export function renameProblem(code: string): string {
  switch (code) {
    case "EPERM":
    case "EACCES":
    case "EBUSY": return "it is open in another program, or read-only"
    case "ENAMETOOLONG": return "the name is too long"
    case "ENOENT": return "it is no longer there"
    case "ENOSPC": return "the disk is full"
    default: return "the system would not do it"
  }
}
