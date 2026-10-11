/**
 * INK GRAPHICS: the pictures that are a camera capture's traced writing (core `inkGraphicFill`), which the inspector
 * can recolour like a stroke (Sean, 2026-10-10: "add a color picker for imported stroke graphics objects").
 *
 * Whether a picture is one is a question about the FILE, so it is asked of the file: an SVG picture's words are read
 * once (the shell hands them over: the page cannot fetch its own `wm://` pictures as text) and the answer is kept by
 * the file's name, which is its contents' hash, so it can never go stale. A photo or a PNG is never read at all.
 *
 * A recolour is a NEW picture, not an edit of the old one: the traced file with its fill changed is saved the way every
 * picture is (`saveMedia`: a file named by what is in it), and the caller points the item at it. The old file stays in
 * the note, so Undo has it to go back to, until File ▸ Clean Up Unused Files finds nothing naming it.
 */

import { inkGraphicFill, recolouredInkSvg } from "@writemind/core"

/** What the shell does for this module (the page's `window.wm`; a stand-in in the tests). */
export interface InkDeps {
  readText(file: string, note: string | null): Promise<string | null>
  save(bytes: Uint8Array, extension: string, note: string | null): Promise<{ file: string }>
}

const shell = (): InkDeps => ({
  readText: (file, note) => window.wm.readMediaText(file, note),
  save: (bytes, extension, note) => window.wm.saveMedia(bytes, extension, note),
})

const isSvg = (file: string): boolean => /\.svg$/i.test(file)

/** A picture file's answer: its fill when it is an ink graphic, null when it is not. */
export class InkGraphics {
  /** file → its fill, or null for a picture that is not an ink graphic. Only an answer that cannot change is kept. */
  private readonly known = new Map<string, string | null>()
  private readonly asking = new Map<string, Promise<string | null>>()

  constructor(private readonly deps: () => InkDeps = shell) {}

  /** What is known of a file now: its fill, null for "not an ink graphic", undefined when it has not been read. */
  fill(file: string): string | null | undefined {
    if (!isSvg(file)) return null
    return this.known.get(file)
  }

  /** Read a picture (once) and say whether it is an ink graphic: its fill, else null. A picture the shell cannot find is not remembered. */
  read(file: string, note: string | null): Promise<string | null> {
    const known = this.fill(file)
    if (known !== undefined) return Promise.resolve(known)
    let job = this.asking.get(file)
    if (!job) {
      job = (async () => {
        let text: string | null = null
        try { text = await this.deps().readText(file, note) } catch { text = null }
        // (Not there yet, or not readable: nothing is said, and the next ask tries again.)
        if (text === null) return null
        const fill = inkGraphicFill(text)
        this.known.set(file, fill)
        return fill
      })().finally(() => { this.asking.delete(file) })
      this.asking.set(file, job)
    }
    return job
  }

  /**
   * The ink graphic `file` in another colour, saved as a picture of the note: its name, or null when `file` is not an ink
   * graphic (or the colour is not `#rrggbb`), in which case nothing was saved. The new file is known to be one already.
   */
  async recolour(file: string, colour: string, note: string | null): Promise<string | null> {
    if (!isSvg(file)) return null
    const text = await this.deps().readText(file, note)
    if (text === null) return null
    this.known.set(file, inkGraphicFill(text))
    const svg = recolouredInkSvg(text, colour)
    if (svg === null) return null
    const saved = await this.deps().save(new TextEncoder().encode(svg), ".svg", note)
    this.known.set(saved.file, colour)
    return saved.file
  }
}

/** The page's own: one for the window. */
export const inkGraphics = new InkGraphics()
