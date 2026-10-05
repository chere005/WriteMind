/**
 * A whole-note rewrite, as the ONE change it really is.
 *
 * The pure rules hand back a new note; the editor wants the smallest change
 * that makes the old one into it, so undo sees one step and the rest of the
 * file — every character outside the change — is never touched.
 */

export interface TextChange { from: number; to: number; insert: string }

export function minimalChange(old: string, next: string): TextChange {
  const most = Math.min(old.length, next.length)
  let from = 0
  while (from < most && old.charCodeAt(from) === next.charCodeAt(from)) from++
  let tail = 0
  while (tail < most - from
    && old.charCodeAt(old.length - 1 - tail) === next.charCodeAt(next.length - 1 - tail)) tail++
  return { from, to: old.length - tail, insert: next.slice(from, next.length - tail) }
}
