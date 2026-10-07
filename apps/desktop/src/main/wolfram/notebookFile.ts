/**
 * File ▸ Export… ▸ Wolfram Notebook: the note as a `.nb` file (Sean, 2026-10-06: "add export to wolfram notebook..
 * make drawing cells" Images — "use wolfram's import of SVG as "Image""). The cells are the core's
 * (`wolframPlan`, `notebookText`); this is the part that needs the machine: the pictures found, the drawings' own
 * pictures put inside them, ONE kernel run (kernel.ts), and the file written whole.
 *
 * Port-only: the Mac has no Wolfram export (docs/PARITY.md).
 *
 * THE EXPORT NEVER FAILS BECAUSE OF THE KERNEL. With no Wolfram Engine, one that is not activated, or one that does
 * not answer in two minutes, every image it did not make is the closed initialization cell that makes it, and what
 * is said about it is the export's notice (`exportNotice`), shown by exportFile.ts after the file is written.
 */

import path from "node:path"
import {
  columnWidth, exportNotice, fallbacks, notebookText, wolframPlan, type EngineState, type KernelJob,
} from "@writemind/core"
import type { ExportRequest } from "../exportPdf"
import type { KernelAnswers, KernelOptions } from "./kernel"
import { base64, inlineMedia, resolvePictures, stampsFor, unansweredPictures, type MediaDeps } from "./media"

/** How long an export waits for the engine: its drawings are worth waiting for, and two minutes is a long time. */
export const EXPORT_TIMEOUT_MS = 120_000

export interface NotebookFileDeps extends MediaDeps {
  runKernel(jobs: readonly KernelJob[], options: KernelOptions): Promise<KernelAnswers>
  /** The window's progress bar on (indeterminate) while the kernel runs, and off after, whatever happened. */
  progress(on: boolean): void
  /** WriteMind's version, named in the file. */
  version: string
  /** Written whole or not at all (`writeFileAtomic`). */
  write(file: string, text: string): Promise<void>
  /** A temporary file the export made, gone once it is written. */
  removeTemp(file: string): Promise<void>
}

let exportsMade = 0

/** The note as a notebook at `file`; resolves what to tell the person (null: nothing), throws when it cannot be written. */
export async function writeWolframNotebook(file: string, request: ExportRequest, deps: NotebookFileDeps):
  Promise<{ message: string; detail: string } | null> {
  const given = request.wolfram ?? { inks: {}, bands: [], column: columnWidth(request.pane) }
  const media = await inlineMedia(given, deps)
  const { pictures, stamps, temps } = await resolvePictures(request.markdown, media, deps, path.dirname(request.noteFile))
  try {
    const plan = wolframPlan(request.markdown, media, pictures, "file")
    let answers = new Map<string, string>()
    let state: EngineState = { kind: "answered" }
    if (plan.jobs.length > 0) {
      deps.progress(true)
      try {
        // Each export its own id: two exports never take each other's run back.
        const ran = await deps.runKernel(plan.jobs, {
          id: `wolfram:export:${++exportsMade}`, png: false, timeoutMs: EXPORT_TIMEOUT_MS, stamps: stampsFor(plan, stamps),
        })
        answers = ran.answers
        state = ran.state
      } finally {
        deps.progress(false)
      }
    }
    // A picture's bytes go into the file only for a picture the engine did not make.
    const pictureData = new Map<string, string>()
    for (const picture of unansweredPictures(plan, answers)) {
      const bytes = await deps.readFile(picture).catch(() => null)
      if (bytes) pictureData.set(picture, base64(bytes))
    }
    await deps.write(file, notebookText(plan, answers, pictureData, deps.version))
    return exportNotice(path.basename(file), state, fallbacks(plan, answers))
  } finally {
    for (const temp of temps) await deps.removeTemp(temp).catch(() => undefined)
  }
}
