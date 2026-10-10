/**
 * Text that could not be saved and is about to be let go of.
 *
 * A note that cannot be written (read-only, locked by a sync client or an antivirus, a
 * full disk) used to make every way out of it fail: clicking another note did nothing,
 * Open Project half-switched, closing the tab threw the typing away. Now the way out is
 * always open and the typing is kept: the text is written to `Recovered` in the app's own
 * data folder, and the window says where. It is a copy to come back to, not a second place
 * the note lives.
 *
 * The words are kept as a `.wm` of their own — a note WriteMind opens like any other (File ▸ Open, or a double click) —
 * and a drawing as the JSON it was (`.drawing.json`).
 */

import { promises as fs } from "node:fs"
import path from "node:path"
import { writeFileAtomic } from "./atomic"
import { createFile, newNoteFile } from "./wmStore"

const two = (n: number): string => String(n).padStart(2, "0")

/** `20261003-141502`, local time. */
export function stamp(date: Date): string {
  return `${date.getFullYear()}${two(date.getMonth() + 1)}${two(date.getDate())}`
    + `-${two(date.getHours())}${two(date.getMinutes())}${two(date.getSeconds())}`
}

/** The file the text went to. `kind` "drawing" keeps the drawing's JSON, as it is, beside where the words would go. */
export async function rescueUnsaved(userData: string, file: string, text: string,
  kind: "note" | "drawing" = "note", now: Date = new Date()): Promise<string> {
  const folder = path.join(userData, "Recovered")
  await fs.mkdir(folder, { recursive: true })
  const extension = kind === "drawing" ? ".drawing.json" : ".wm"
  const stem = path.basename(file, path.extname(file)).replace(/[<>:"/\\|?*\u0000-\u001f]/g, "-").slice(0, 60) || "note"
  let target = path.join(folder, `${stem} (${stamp(now)})${extension}`)
  for (let n = 2; n < 100; n++) {
    if (!(await fs.access(target).then(() => true, () => false))) break
    target = path.join(folder, `${stem} (${stamp(now)} ${n})${extension}`)
  }
  if (kind === "drawing") await writeFileAtomic(target, text)
  else await createFile(target, newNoteFile(text), now)
  return target
}
