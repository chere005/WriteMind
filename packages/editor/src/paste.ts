/**
 * Pasting text. The Mac's text view is plain (`isRichText = false`): whatever is on the
 * pasteboard arrives as its plain text, so a page copied from a browser is words, not
 * HTML, and a list pasted into a note is just lines. CodeMirror already reads
 * `text/plain`; the one thing it does not do is turn a clipboard that holds ONLY
 * `text/html` (some apps copy that way) into words, so that is done here, and nothing
 * else is touched. A picture on the clipboard is the app's business (a file item, not
 * text), and an armed bar's paste is the seams'.
 */

import type { Extension } from "@codemirror/state"
import { EditorView } from "@codemirror/view"
import { CELLS_MIME } from "./keys"

/**
 * Whether a paste is the app's picture to place on the drawing layer: never when WriteMind's own cells are on the
 * clipboard — a drawing cell copied for Mathematica carries a PNG beside its cells, and pasting it back here is the
 * cells and nothing else. (Not "unless something before it took the paste": the listener is on the window, after
 * CodeMirror's own paste handler, which prevents the default of EVERY paste that reaches the focused editor, an
 * image-only one too, so `defaultPrevented` says nothing about whether the notebook took it.)
 */
export const takesPastedPicture = (types: readonly string[]): boolean => !types.includes(CELLS_MIME)

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
