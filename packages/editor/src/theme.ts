/**
 * How the notebook looks. The sizes are the Mac's own — 15pt body, the
 * heading ladder as `MarkdownPreview.headingFont` sets it, and the author
 * line (level 6) ITALIC AND SLIGHTLY BIGGER than body rather than a smaller
 * sixth-rank heading, because that inversion is the point of it.
 */

import { EditorView } from "@codemirror/view"

/**
 * The page's side margins: where every line's box starts and ends. The selection, the held cells and the hover's
 * promise are all drawn between these two and nowhere else, so they line up with each other and with the words.
 */
export const PAGE_LEFT = 30
export const PAGE_RIGHT = 34

/** The brackets' colour at rest: the Mac's tertiary label colour, which reads in either theme. */
const BRACKET = "color-mix(in srgb, var(--wm-text) 26%, transparent)"

export const notebookTheme = EditorView.theme({
  "&": {
    fontSize: "15px",
    color: "var(--wm-text)",
    backgroundColor: "var(--wm-page)",
    height: "100%",
  },
  ".cm-scroller": {
    fontFamily: "-apple-system, 'Segoe UI', Cantarell, 'Noto Sans', Ubuntu, 'DejaVu Sans', system-ui, sans-serif",
    lineHeight: "1.45",
    overflow: "auto",
    position: "relative",
  },
  ".cm-content": {
    padding: `16px ${PAGE_RIGHT}px 240px ${PAGE_LEFT}px`,
    caretColor: "var(--wm-text)",
  },
  ".cm-line": { padding: "0 2px" },
  "&.cm-focused": { outline: "none" },
  ".cm-selectionBackground, ::selection": { backgroundColor: "var(--wm-selection)" },
  "&.cm-focused .cm-selectionBackground": { backgroundColor: "var(--wm-selection)" },
  // CodeMirror's own base theme assumes a light page (a pale selection and a
  // BLACK caret), and this one follows the system: so both are set from the
  // app's tokens, at the base theme's own specificity, or they lose to it.
  "&.cm-focused > .cm-scroller > .cm-selectionLayer .cm-selectionBackground, .cm-selectionLayer .cm-selectionBackground": {
    backgroundColor: "var(--wm-selection)",
  },
  // CodeMirror draws a selection's middle lines from the content's padding edge to the far side of it — out to the
  // window's left edge and under the brackets. Clipped to the lines' own boxes (the layer is as wide as the page and
  // the clip as tall as any note), it runs from the margin to the margin.
  ".cm-selectionLayer": {
    width: "100%",
    clipPath: `polygon(${PAGE_LEFT}px 0, calc(100% - ${PAGE_RIGHT}px) 0, calc(100% - ${PAGE_RIGHT}px) 100000000px, ${PAGE_LEFT}px 100000000px)`,
  },
  // Held cells are drawn as cells (`heldLines` in brackets.ts; the rendered page lights its blocks): the selection's
  // own rectangles stay out of it, and so do the carets CodeMirror puts at the end of every range (a selection on
  // the Mac has no insertion point).
  "&.wm-holding .cm-selectionLayer, &.wm-holding .cm-cursorLayer": { display: "none" },
  ".cm-line.wm-held": { backgroundColor: "var(--wm-selection)" },
  // One box, not a stack of strips: at 1.5x two lines meet on a fractional pixel and a hairline of page showed
  // between them. A shadow the line's own colour reaches over the join without moving anything.
  ".cm-line.wm-held:not(.wm-held-last)": { boxShadow: "0 1px 0 var(--wm-selection)" },
  ".cm-line.wm-held-first": { borderTopLeftRadius: "4px", borderTopRightRadius: "4px" },
  ".cm-line.wm-held-last": { borderBottomLeftRadius: "4px", borderBottomRightRadius: "4px" },
  ".cm-cursor, .cm-dropCursor": { borderLeft: "2px solid var(--wm-text)", marginLeft: "-1px" },
  ".cm-activeLine": { backgroundColor: "transparent" },

  ".wm-marker": { color: "var(--wm-faint)" },
  ".wm-bold": { fontWeight: "700" },
  ".wm-italic": { fontStyle: "italic" },
  ".wm-underline": { textDecoration: "underline" },
  // The run `/link` marked as linked to (<mark id=…>): a soft highlighter.
  ".wm-highlight": { backgroundColor: "rgba(255, 213, 0, 0.28)", borderRadius: "2px" },
  ".wm-strike": { textDecoration: "line-through" },
  ".wm-code": {
    fontFamily: "ui-monospace, SFMono-Regular, Menlo, Consolas, 'DejaVu Sans Mono', monospace",
    fontSize: "14.2px",
    color: "var(--wm-code)",
  },
  ".wm-bullet": { color: "var(--wm-accent)", paddingRight: "6px" },
  ".wm-todo": {
    display: "inline-block",
    width: "13px",
    height: "13px",
    lineHeight: "12px",
    textAlign: "center",
    fontSize: "10px",
    marginRight: "6px",
    borderRadius: "3px",
    border: "1px solid var(--wm-faint)",
    cursor: "pointer",
    verticalAlign: "-2px",
  },
  ".wm-todo-done": { backgroundColor: "var(--wm-accent)", borderColor: "var(--wm-accent)", color: "#fff" },

  ".wm-h1": { fontSize: "27px", fontWeight: "700", lineHeight: "1.2" },
  ".wm-h2": { fontSize: "22px", fontWeight: "700", lineHeight: "1.25" },
  ".wm-h3": { fontSize: "19px", fontWeight: "600" },
  ".wm-h4": { fontSize: "17px", fontWeight: "600" },
  ".wm-h5": { fontSize: "16px", fontWeight: "600" },
  // The author subheader: italic and a little BIGGER than body.
  ".wm-h6": { fontSize: "17px", fontStyle: "italic", color: "var(--wm-soft)" },
  ".wm-quote": {
    borderLeft: "3px solid var(--wm-rule)",
    paddingLeft: "10px",
    color: "var(--wm-soft)",
  },
  ".wm-code-line": {
    fontFamily: "ui-monospace, SFMono-Regular, Menlo, Consolas, 'DejaVu Sans Mono', monospace",
    fontSize: "14.2px",
    // See-through, so a selection (drawn under the lines) shows in code as it does everywhere else: an opaque
    // background hid it. The text colour at 5.5% is the code-background token's own shade in both themes.
    backgroundColor: "color-mix(in srgb, var(--wm-text) 5.5%, transparent)",
  },

  ".wm-seams, .wm-gutter": {
    position: "absolute",
    top: "0",
    pointerEvents: "none",
  },
  ".wm-seams": { left: "0", right: "0" },
  // The bar runs along the words, from one margin to the other; the + stands in the left margin beside its line.
  ".wm-bar": {
    position: "absolute",
    left: `${PAGE_LEFT}px`,
    right: `${PAGE_RIGHT}px`,
    height: "2px",
    backgroundColor: "var(--wm-accent)",
    opacity: "0.85",
  },
  ".wm-bar-faint": { opacity: "0.22" },
  // Where a dragged selection would be docked (`showDropBar`): heavier than the cursor's bar, with a halo.
  ".wm-bar-drop": {
    height: "4px",
    opacity: "1",
    borderRadius: "2px",
    boxShadow: "0 0 0 3px color-mix(in srgb, var(--wm-accent) 22%, transparent)",
  },
  // The + (plusMarker.ts): a filled round marker, white cross, in the left margin (the wireframe, FinalMain.png).
  ".wm-plus": {
    position: "absolute",
    boxSizing: "border-box",
    borderRadius: "50%",
    backgroundColor: "var(--wm-accent)",
    boxShadow: "0 1px 2px rgba(0, 0, 0, 0.25)",
  },
  ".wm-plus::before, .wm-plus::after": {
    content: '""',
    position: "absolute",
    left: "50%",
    top: "50%",
    backgroundColor: "#fff",
    borderRadius: "1px",
  },
  ".wm-plus::before": { width: "10px", height: "2px", margin: "-1px 0 0 -5px" },
  ".wm-plus::after": { width: "2px", height: "10px", margin: "-5px 0 0 -1px" },

  // The column is the gutter's alone: it sets the hand over a bracket and the arrow beside one (`bracketAt`), so
  // a bracket's own box — narrower than what a click reaches — says nothing about the pointer.
  ".wm-gutter": { right: "0", width: "22px", pointerEvents: "auto", cursor: "default" },
  // The Mac's weights: a cell 1.1, a section 1.5; under the pointer +0.6, lit +1.2. Border-box, so a heavier line
  // grows inward and the ticks stay on the first and last lines of the cell.
  ".wm-bracket": {
    position: "absolute",
    boxSizing: "border-box",
    borderTop: `1.1px solid ${BRACKET}`,
    borderRight: `1.1px solid ${BRACKET}`,
    borderBottom: `1.1px solid ${BRACKET}`,
  },
  ".wm-bracket-group": { borderWidth: "1.5px" },
  ".wm-bracket.wm-bracket-hover": { borderColor: "var(--wm-accent)", borderWidth: "1.7px" },
  ".wm-bracket-group.wm-bracket-hover": { borderWidth: "2.1px" },
  // The promise a hover makes: over the words (it is faint), under the bars (they are cursors).
  ".wm-wash": { position: "absolute", top: "0", left: "0", right: "0", pointerEvents: "none" },
  ".wm-wash-cell": {
    position: "absolute",
    left: `${PAGE_LEFT}px`,
    right: `${PAGE_RIGHT}px`,
    borderRadius: "4px",
    backgroundColor: "color-mix(in srgb, var(--wm-accent) 12%, transparent)",
  },
  ".wm-bracket-folded": { borderStyle: "dashed", backgroundColor: "var(--wm-rule)" },
  ".wm-folded": {
    color: "var(--wm-faint)",
    cursor: "pointer",
    marginLeft: "6px",
    padding: "0 4px",
    borderRadius: "3px",
    border: "1px solid var(--wm-rule)",
    fontSize: "12px",
  },
  ".wm-link": { color: "var(--wm-accent)", textDecoration: "underline" },
  ".wm-tok-keyword": { color: "var(--wm-tok-keyword, #c2185b)" },
  ".wm-tok-type": { color: "var(--wm-tok-type, #00838f)" },
  ".wm-tok-string": { color: "var(--wm-tok-string, #2e7d32)" },
  ".wm-tok-comment": { color: "var(--wm-tok-comment, #8a8a94)", fontStyle: "italic" },
  ".wm-tok-number": { color: "var(--wm-tok-number, #e65100)" },
  ".wm-tok-function": { color: "var(--wm-tok-function, #1565c0)" },
  ".wm-tok-symbol": { color: "var(--wm-tok-symbol, #6a4c93)" },
  ".wm-bracket.wm-bracket-lit": { borderColor: "var(--wm-accent)", borderWidth: "2.3px" },
  ".wm-bracket-group.wm-bracket-lit": { borderWidth: "2.7px" },
})
