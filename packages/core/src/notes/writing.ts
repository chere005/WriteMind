/**
 * Whether it is safe to write the open note back to its file. Ported from
 * `WriteMind/Notes/NoteWriting.swift`, and it is here for the same reason it
 * was written there: a note lost two cells on 2026-09-20 because two copies
 * of the app had the same file open and the newer of the two writers was
 * whichever happened to save last.
 *
 * The rule is the one every editor has to have: the app owns the file only
 * as long as it is the last thing that wrote to it. If the bytes on disk are
 * not the bytes it last read or last wrote, somebody else has been here —
 * another window, another editor, a script — and the buffer in memory is no
 * longer an edit OF that file. It is not written.
 *
 * Refusing loses nothing: the text stays in the buffer, the session caches
 * it, and the folder watcher brings the newer file in. Writing loses the
 * other writer's work, silently, which is what happened.
 */
export function mayWrite(onDisk: string | null, known: string | null): boolean {
  // A file that is not there yet, and we never saw one: a new note saving
  // itself for the first time.
  if (onDisk === null && known === null) return true
  // It was there and now it is not — a trash, or a move. Writing would put
  // it back, and the sidebar's gesture is what decides that, not an
  // autosave.
  if (onDisk === null) return false
  // We have never read it but there is something there: whatever it is, it
  // is not ours to overwrite.
  if (known === null) return false
  return onDisk === known
}
