/**
 * Pasting text. The Mac's text view is plain (`isRichText = false`): whatever is on the
 * pasteboard arrives as its plain text, so a page copied from a browser is words, not
 * HTML, and a list pasted into a note is just lines. CodeMirror already reads
 * `text/plain`; the one thing it does not do is turn a clipboard that holds ONLY
 * `text/html` (some apps copy that way) into words, so that is done here, and nothing
 * else is touched. A picture on the clipboard is the app's business (a file item, not
 * text), and an armed bar's paste is the seams'.
 */

import { Facet, Prec, type Extension } from "@codemirror/state"
import { EditorView } from "@codemirror/view"
import { CELLS_MIME } from "./keys"

/**
 * COPY CELL (the tablet box's button): a drawing that is in no note, as the JSON of its strokes and the box round them. A paste
 * carrying it lands as a NEW drawing cell at the caret or the armed bar (the app's `drawingPasted`), never as text or a picture.
 */
export const DRAWING_MIME = "application/x-writemind-drawing"

/**
 * Asked of every paste: is this WriteMind's own copied drawing cell (the app knows it by `DRAWING_MIME`, or, where the system
 * shows a paste carrying a file as only that file, by the file it wrote)? When it is, the app lands it and says true; false: an
 * ordinary paste. The first one given; none: never.
 */
export const drawingPasted = Facet.define<((data: DataTransfer) => boolean) | null, ((data: DataTransfer) => boolean) | null>({
  combine: (values) => values.find((value) => value !== null) ?? null,
})

/**
 * A paste with a copied drawing cell on the clipboard is that cell and nothing else: before the bar's paste (which would
 * write the SVG words the copy also carries) and the editor's own. The words and the file beside it are for other apps.
 */
export const pasteDrawing: Extension = Prec.highest(EditorView.domEventHandlers({ paste: (event, view) => takeDrawing(event, view) }))

/** (The handler alone: for the tests.) */
export function takeDrawing(event: ClipboardEvent, view: EditorView): boolean {
  const data = event.clipboardData
  const take = view.state.facet(drawingPasted)
  if (!data || !take || !take(data)) return false
  event.preventDefault()
  return true
}

/**
 * Whether a paste is the app's picture to place on the drawing layer: never when WriteMind's own cells are on the
 * clipboard — a drawing cell copied for Mathematica carries a PNG beside its cells, and pasting it back here is the
 * cells and nothing else (nor a copied drawing cell, `DRAWING_MIME`: its SVG file may come as a picture too). (Not
 * "unless something before it took the paste": the listener is on the window, after CodeMirror's own paste handler,
 * which prevents the default of EVERY paste that reaches the focused editor, an image-only one too, so
 * `defaultPrevented` says nothing about whether the notebook took it.)
 */
export const takesPastedPicture = (types: readonly string[]): boolean => !types.includes(CELLS_MIME) && !types.includes(DRAWING_MIME)

const BLOCKS = new Set([
  "ADDRESS", "ARTICLE", "ASIDE", "BLOCKQUOTE", "DIV", "DL", "DT", "DD", "FIELDSET", "FIGURE", "FOOTER", "FORM",
  "H1", "H2", "H3", "H4", "H5", "H6", "HEADER", "HR", "LI", "MAIN", "NAV", "OL", "P", "PRE", "SECTION", "TABLE", "TR", "UL",
])

/** The words of an HTML fragment, a line to a block (a list item gets its dash). */
export function htmlToPlain(html: string): string {
  const doc = new DOMParser().parseFromString(html, "text/html")
  let out = ""
  const newline = () => { if (out.length > 0 && !out.endsWith("\n")) out += "\n" }
  const walk = (node: Node): void => {
    if (node.nodeType === Node.TEXT_NODE) {
      out += (node.textContent ?? "").replace(/\s+/g, " ")
      return
    }
    if (node.nodeType !== Node.ELEMENT_NODE) return
    const element = node as Element
    if (["SCRIPT", "STYLE", "HEAD", "TEMPLATE"].includes(element.tagName)) return
    if (element.tagName === "BR") { out += "\n"; return }
    const block = BLOCKS.has(element.tagName)
    if (block) newline()
    if (element.tagName === "LI") out += "- "
    element.childNodes.forEach(walk)
    if (block) newline()
  }
  walk(doc.body)
  return out.replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").replace(/^\n+|\n+$/g, "")
}

export const pasteHtmlAsText: Extension = EditorView.domEventHandlers({
  paste(event, view) {
    const data = event.clipboardData
    if (!data) return false
    if (data.getData("text/plain").length > 0) return false
    const html = data.getData("text/html")
    if (html.length === 0) return false
    const words = htmlToPlain(html)
    if (words.length === 0) return false
    event.preventDefault()
    view.dispatch(view.state.replaceSelection(words), { scrollIntoView: true, userEvent: "input.paste" })
    return true
  },
})
