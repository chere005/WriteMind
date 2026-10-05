/**
 * File ▸ Export… as PDF — the note as it is read, on paper (the Mac's
 * `ExportMenu` and `NoteExport`). The page plan and the look of the cells are
 * `@writemind/core`'s `export/*`; this is the part that needs Chromium: a
 * window nobody sees measures the cells, the sheets are planned from those
 * heights, and the same window prints them. US Letter, three quarters of an
 * inch of margin, text that stays text and a drawing that stays vectors.
 *
 * The window is not the app's own and shows nothing: no page of the notebook,
 * no toolbar, no sidebar ever reaches the paper (the first version printed the
 * whole window, which is what a PDF of "the page" is not).
 */

import { app, BrowserWindow, dialog } from "electron"
import { existsSync, promises as fs } from "node:fs"
import path from "node:path"
import { pathToFileURL } from "node:url"
import {
  blockMediaFor, exportPane, measureHtml, noteBlocks, printHtml, readDrawing, suggestedName, type Drawing, type Measured,
} from "@writemind/core"

export interface ExportRequest {
  /** The note's file (its name is the PDF's), and its title for the dialog. */
  noteFile: string
  title: string
  /** The text as it is in the editor, not as it is on disk. */
  markdown: string
  /** The sidecar's JSON. */
  drawing: string | null
  /** The editor pane the drawing's objects were placed against. */
  pane: { width: number; height: number }
}

export interface ExportDeps {
  window: BrowserWindow | null
  /** The save dialog (the test run answers it ahead of time). */
  askSave(parent: BrowserWindow, options: Electron.SaveDialogOptions): Promise<{ canceled: boolean; filePath?: string }>
  /** A picture on the drawing layer → the file it is. */
  mediaFile(name: string): string
  /** A picture the printer cannot load from its file (a Mac capture that is a PDF) → a URL it can; null for the rest. */
  pictureUrl?(name: string): string | null
}

/** The PDF's bytes. Public so the end-to-end scripts can render without the dialog. */
export async function renderNotePdf(request: Omit<ExportRequest, "title" | "noteFile">,
  mediaFile: (name: string) => string, pictureUrl: (name: string) => string | null = () => null):
  Promise<{ pdf: Buffer; pages: number }> {
  const drawing: Drawing = readDrawing(request.drawing)
  const size = exportPane(request.pane)
  const folder = await fs.mkdtemp(path.join(app.getPath("temp"), "wm-export-"))
  const win = new BrowserWindow({
    show: false, width: Math.ceil(size.width) + 40, height: 900,
    webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false, javascript: true },
  })
  try {
    // Picture cells load from their files (a missing one is a one-line placeholder, as on screen); ink cells are
    // inlined from the sidecar at the column's width, never from their snapshot (docs\PLAN-docking-ink-cells.md (g)).
    const pictureAt = (name: string): string | null => {
      const file = mediaFile(name)
      return existsSync(file) ? pictureUrl(name) ?? pathToFileURL(file).href : null
    }
    const media = blockMediaFor(drawing, size, pictureAt)
    // 1. The cells, laid out in the pane's column and measured.
    const blocks = noteBlocks(request.markdown, undefined, media)
    const measure = path.join(folder, "measure.html")
    await fs.writeFile(measure, measureHtml(blocks, size), "utf8")
    await win.loadFile(measure)
    const heights = await win.webContents.executeJavaScript("window.__measure()") as Measured[]

    // 2. The sheets, planned from those heights, written out and printed.
    const printed = printHtml({
      markdown: request.markdown, drawing, pane: size,
      mediaUrl: (name) => pictureUrl(name) ?? pathToFileURL(mediaFile(name)).href,
      media,
    }, heights)
    const print = path.join(folder, "print.html")
    await fs.writeFile(print, printed.html, "utf8")
    await win.loadFile(print)
    // A picture on the page has to have arrived before the page is printed.
    await win.webContents.executeJavaScript(`Promise.all([
      document.fonts ? document.fonts.ready : null,
      ...[...document.querySelectorAll('image')].map((node) => new Promise((resolve) => {
        const image = new Image()
        image.onload = image.onerror = resolve
        image.src = node.getAttribute('href') || ''
      })),
    ]).then(() => new Promise((resolve) => setTimeout(resolve, 120)))`)
    const pdf = await win.webContents.printToPDF({
      pageSize: { width: 8.5, height: 11 },
      margins: { top: 0, bottom: 0, left: 0, right: 0 },
      printBackground: true,
      preferCSSPageSize: true,
    })
    return { pdf, pages: printed.pages }
  } finally {
    if (!win.isDestroyed()) win.destroy()
    // The end-to-end scripts look at what was printed; nobody else needs it.
    if (!process.env.WRITEMIND_E2E) void fs.rm(folder, { recursive: true, force: true })
  }
}

/** The note's PDF, written to `file`: what File ▸ Export… does once the panel has said PDF (exportFile.ts). Throws on failure. */
export async function writeNotePdf(file: string, request: Omit<ExportRequest, "title" | "noteFile">,
  mediaFile: (name: string) => string, pictureUrl: (name: string) => string | null = () => null): Promise<void> {
  const { pdf } = await renderNotePdf(request, mediaFile, pictureUrl)
  await fs.writeFile(file, pdf)
}

/**
 * PDF only, the panel asking nothing (the `export:pdf` channel, kept for the end-to-end scripts that render a
 * note without the menu). Ask where it goes, then write it. The default is the note's own name in Documents.
 */
export async function exportNotePdf(request: ExportRequest, deps: ExportDeps): Promise<string | null> {
  const parent = deps.window
  if (!parent) return null
  const where = await deps.askSave(parent, {
    title: `Where the PDF of “${request.title}” goes`,
    defaultPath: path.join(app.getPath("documents"), suggestedName(request.noteFile)),
    filters: [{ name: "PDF", extensions: ["pdf"] }],
    properties: ["createDirectory", "showOverwriteConfirmation"],
  })
  if (where.canceled || !where.filePath) return null
  const file = where.filePath
  try {
    const { pdf } = await renderNotePdf(request, deps.mediaFile, deps.pictureUrl)
    await fs.writeFile(file, pdf)
    return file
  } catch (error) {
    // A file that silently did not appear is the worst of the three outcomes.
    await dialog.showMessageBox(parent, {
      type: "warning", message: `Could not write “${path.basename(file)}”`,
      detail: (error as Error).message || "WriteMind could not make a PDF of this note.",
    })
    return null
  }
}
