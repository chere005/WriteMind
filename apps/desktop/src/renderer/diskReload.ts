/**
 * A NOTE EDITED IN ANOTHER APP shows up here: the folder watcher says something moved, and the open note's words and
 * drawing are read again — unless there is an edit in hand that has not reached disk yet; that one is ours, and the
 * save will answer for it (App.tsx's `onNotesChanged`).
 *
 * Both reads are awaits, and the person goes on typing and drawing while they run. So whether the same note is still
 * open and still clean (and, for the words, still showing the words the read started from) is asked AGAIN after each
 * read, before the copy on disk goes on the page (CI on 1b9010a: words typed, or a stroke drawn, during the read were
 * replaced by the file; a note opened meanwhile would have been given the old note's words or drawing).
 *
 * THE READS ONLY LOOK. The main process knows a note by the bytes it last read or wrote and writes only over those (the
 * guard), and a read that adopted the file's new bytes as "the last read" made the next autosave — an edit of the OLD
 * words the person kept typing over while this ran — overwrite the other program's change. So `readNote` and
 * `readDrawing` look without taking the file as ours, and `adopt` takes it, only once what was read is on the page. A
 * reload that stops (an edit in hand, another note opened) adopts nothing: the save that follows is refused as "the file
 * changed", which keeps the person's text in Recovered and brings the newer file in.
 */

export interface DiskReloadHost<Sidecar> {
  /** The note open now (another one can be opened while a read runs). */
  open(): string | null
  /** The words on the page now. */
  text(): string
  /** Whether the words, or the drawing, hold an edit that has not reached disk. */
  wordsDirty(): boolean
  drawingDirty(): boolean
  /** The note's file and its drawing's sidecar, null when they cannot be read. */
  readNote(file: string): Promise<string | null>
  readDrawing(file: string): Promise<Sidecar | null>
  /** Put the file's words, or its sidecar, on the page. */
  setDocument(text: string): void
  setDrawing(sidecar: Sidecar | null): void
  /** What was read is on the page: the file's state is the app's own now (a no-op where there is no guard to tell). */
  adopt?(file: string): Promise<void>
}

/** CodeMirror keeps a note's lines with "\n" whatever the file had: a CRLF file is the same words as the page. */
const lines = (text: string): string => text.replace(/\r\n?/g, "\n")

export async function reloadFromDisk<Sidecar>(host: DiskReloadHost<Sidecar>): Promise<void> {
  const file = host.open()
  if (!file || host.wordsDirty()) return
  const before = host.text()
  const fresh = await host.readNote(file)
  // (In this order: the words are only made into a string when there is no edit in hand.)
  if (host.open() !== file || host.wordsDirty() || lines(host.text()) !== lines(before)) return
  // (A file that could not be read — half written, gone — is not a drawing to look at either.)
  if (fresh === null) return
  if (lines(fresh) !== lines(before)) host.setDocument(fresh)
  // The sidecar too: the drawing is the note's other half, and an edit to it from outside — another window, a sync —
  // has to show up the same way the words do. Asked again after the read: the same note still open (openNote names
  // the new one before its words go on the page) and no stroke in hand. Typing does not change the drawing, so the
  // words are not asked here (a CRLF note's words come back from the editor with "\n" and would drop the new sidecar).
  if (host.drawingDirty()) return
  const sidecar = await host.readDrawing(file)
  if (host.open() !== file || host.drawingDirty()) return
  host.setDrawing(sidecar)
  await host.adopt?.(file)
}
