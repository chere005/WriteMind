/**
 * How the notebook looks. The sizes are the Mac's own — 15pt body, the
 * heading ladder as `MarkdownPreview.headingFont` sets it, and the author
 * line (level 6) ITALIC AND SLIGHTLY BIGGER than body rather than a smaller
 * sixth-rank heading, because that inversion is the point of it.
 */

import { EditorView } from "@codemirror/view"

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
    padding: "16px 34px 240px 30px",
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
    backgroundColor: "var(--wm-code-bg)",
  },

  ".wm-seams, .wm-gutter": {
    position: "absolute",
    top: "0",
    pointerEvents: "none",
  },
  ".wm-seams": { left: "0", right: "0" },
  ".wm-bar": {
    position: "absolute",
    left: "22px",
    right: "26px",
    height: "2px",
    backgroundColor: "var(--wm-accent)",
    opacity: "0.85",
  },
  ".wm-bar-faint": { opacity: "0.22" },
  ".wm-plus": {
    position: "absolute",
    borderRadius: "50%",
    border: "1px solid var(--wm-accent)",
    color: "var(--wm-accent)",
    fontSize: "9px",
    lineHeight: "8px",
    textAlign: "center",
    backgroundColor: "var(--wm-page)",
  },

  ".wm-gutter": { right: "0", width: "22px", pointerEvents: "auto" },
  ".wm-bracket": {
    position: "absolute",
    borderTop: "1.1px solid var(--wm-rule)",
    borderRight: "1.1px solid var(--wm-rule)",
    borderBottom: "1.1px solid var(--wm-rule)",
    cursor: "pointer",
  },
  ".wm-bracket:hover": { borderColor: "var(--wm-accent)" },
  ".wm-bracket-group": { borderWidth: "1.5px" },
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
  ".wm-bracket-lit": { borderColor: "var(--wm-accent)", borderWidth: "2px" },
})
