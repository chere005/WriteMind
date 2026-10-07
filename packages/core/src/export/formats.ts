/**
 * File ▸ Export… (Ctrl+E): the note on paper, the note as a Wolfram notebook, or the project, and the save panel
 * asks which. The Mac's `ExportMenu.Format` and `ExportFormatChooser` (Sean, 2026-09-21: "export is either as pdf or
 * as project (which is just the directory structure).. output format is chosen in the save menu"); the Wolfram
 * notebook is the port's own (Sean, 2026-10-06: "add export to wolfram notebook"; docs/PARITY.md).
 *
 * ONE COMMAND, ONE PANEL, the format chosen in it. On the Mac that is a
 * "Format:" popup under the panel. On Windows the dialog's own "Save as type"
 * list is the popup: it names the formats in their own words ("PDF",
 * "Wolfram Notebook", "Project") and swaps the chosen one's extension into the
 * name. Electron does not say which entry was picked, so the format is read
 * back from the file it answers with (`exportTarget`); a name with no
 * extension at all gets the format the panel opened on, as the Mac's "a name
 * typed without one still gets the extension it chose".
 *
 * Nothing is offered that cannot be made: with no note open there is no page
 * to print and no note to write, and the list has the project alone
 * (`offeredFormats`).
 */

export type ExportFormat = "pdf" | "wolfram" | "project"

/** Every format, in the popup's order: the one somebody means when they press Ctrl+E first. */
export const EXPORT_FORMATS: readonly ExportFormat[] = ["pdf", "wolfram", "project"]

/** The project file's extension (the Mac's `Project.fileExtension`; main/project.ts's `PROJECT_EXTENSION`). */
export const PROJECT_FILE_EXTENSION = "writemind-project"

/** The word the popup shows. */
export function formatTitle(format: ExportFormat): string {
  switch (format) {
    case "pdf": return "PDF"
    case "wolfram": return "Wolfram Notebook"
    case "project": return "Project"
  }
}

/** The extension a file of this format is written with. */
export function formatExtension(format: ExportFormat): string {
  switch (format) {
    case "pdf": return "pdf"
    case "wolfram": return "nb"
    case "project": return PROJECT_FILE_EXTENSION
  }
}

/** The panel's line about what is being saved (the Mac's `Format.message`). */
export function formatMessage(format: ExportFormat): string {
  switch (format) {
    case "pdf": return "Where the PDF goes."
    case "wolfram": return "Where the Wolfram notebook goes."
    case "project": return "Where the project file goes — the folders, not the notes."
  }
}

/** What an export can make right now: the PDF and the notebook only when a note is open. */
export function offeredFormats(hasNote: boolean): ExportFormat[] {
  return hasNote ? [...EXPORT_FORMATS] : ["project"]
}

/**
 * The "Format:" popup, as a model: the formats it lists, the one chosen, and
 * a word to whoever is listening when the choice changes (the panel renames
 * the file to match). The Mac's `ExportFormatChooser`.
 */
export class ExportFormatChooser {
  private list: ExportFormat[] = [...EXPORT_FORMATS]
  private index = 0
  onChange: ((format: ExportFormat) => void) | null = null

  get formats(): readonly ExportFormat[] { return this.list }

  /** The chosen one; the first when nothing (or something no longer listed) is chosen. */
  get format(): ExportFormat {
    return this.index >= 0 && this.index < this.list.length ? this.list[this.index]! : (this.list[0] ?? "pdf")
  }

  /** Set before the panel is shown; the list is rebuilt around it. An empty list is not an answer: the old one stands. */
  setFormats(formats: readonly ExportFormat[]): void {
    if (formats.length === 0) return
    this.list = [...formats]
    this.index = 0
  }

  /** The popup moved to `format` (ignored when it is not one of those listed). */
  choose(format: ExportFormat): void {
    const at = this.list.indexOf(format)
    if (at < 0 || at === this.index) return
    this.index = at
    this.onChange?.(this.format)
  }
}

/** The save dialog's "Save as type" list for what is offered, in the popup's order. */
export function exportFilters(formats: readonly ExportFormat[]): { name: string; extensions: string[] }[] {
  return formats.map((format) => ({ name: formatTitle(format), extensions: [formatExtension(format)] }))
}

/** "C:\\a\\Note.pdf" → "pdf"; a name with no dot (or only a leading one) → "". */
function extensionOf(file: string): string {
  const name = file.split(/[\\/]/).pop() ?? file
  const dot = name.lastIndexOf(".")
  return dot > 0 ? name.slice(dot + 1).toLowerCase() : ""
}

/**
 * What the panel's answer is: the format its extension names (and the chooser
 * moves to it), or, for a name whose extension is none of the offered ones,
 * the chosen format with its extension added — the file always says what it is.
 */
export function exportTarget(file: string, chooser: ExportFormatChooser): { format: ExportFormat; file: string } {
  const typed = extensionOf(file)
  const named = chooser.formats.find((format) => formatExtension(format) === typed)
  if (named) {
    chooser.choose(named)
    return { format: named, file }
  }
  const format = chooser.format
  return { format, file: `${file}.${formatExtension(format)}` }
}
