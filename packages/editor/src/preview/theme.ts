/**
 * How the rendered page looks. The sizes are the markdown side's own heading
 * ladder (`theme.ts`), so a block does not change size when it opens, and the
 * body is the same line height as a line of source for the same reason.
 */

import { EditorView } from "@codemirror/view"

const MONO = "ui-monospace, SFMono-Regular, Menlo, Consolas, 'DejaVu Sans Mono', monospace"

export const previewTheme = EditorView.theme({
  // A drawn block is for clicking: the I-beam says "this opens for writing", and the browser's own
  // selection (which would only smear across it) stays out.
  ".wm-pv": { padding: "0 2px", lineHeight: "1.45", overflowWrap: "break-word", cursor: "text", userSelect: "none" },
  // Cells with no blank line between them still have the page's gap.
  ".wm-pv-touching": { paddingTop: "8px" },
  ".wm-pv-held": {
    backgroundColor: "color-mix(in srgb, var(--wm-accent) 16%, transparent)",
    borderRadius: "4px",
  },

  ".wm-pv-p": { whiteSpace: "pre-wrap" },
  ".wm-pv-heading": { whiteSpace: "pre-wrap" },
  ".wm-pv-h1": { fontSize: "27px", fontWeight: "700", lineHeight: "1.2" },
  ".wm-pv-h2": { fontSize: "22px", fontWeight: "700", lineHeight: "1.25" },
  ".wm-pv-h3": { fontSize: "19px", fontWeight: "600" },
  ".wm-pv-h4": { fontSize: "17px", fontWeight: "600" },
  ".wm-pv-h5": { fontSize: "16px", fontWeight: "600" },
  ".wm-pv-h6": { fontSize: "17px", fontStyle: "italic", color: "var(--wm-soft)" },

  ".wm-pv-quote": {
    borderLeft: "3px solid color-mix(in srgb, var(--wm-accent) 60%, transparent)",
    marginLeft: "2px",
    paddingLeft: "12px",
  },
  ".wm-pv-quote-text": { fontStyle: "italic", color: "var(--wm-soft)", whiteSpace: "pre-wrap" },

  ".wm-pv-li": { display: "flex", alignItems: "baseline", gap: "8px", paddingLeft: "8px" },
  ".wm-pv-mark": { color: "var(--wm-accent)", minWidth: "14px", textAlign: "center", flex: "none" },
  ".wm-pv-box": {
    display: "inline-block",
    flex: "none",
    width: "13px",
    height: "13px",
    lineHeight: "12px",
    textAlign: "center",
    fontSize: "10px",
    borderRadius: "3px",
    border: "1px solid var(--wm-faint)",
    cursor: "pointer",
    alignSelf: "center",
    color: "#fff",
  },
  ".wm-pv-box-done": { backgroundColor: "var(--wm-accent)", borderColor: "var(--wm-accent)" },
  ".wm-pv-li-text": { flex: "1", minWidth: "0", whiteSpace: "pre-wrap" },
  // Done is struck through and faded, the way a finished line in a notebook is.
  ".wm-pv-done": { textDecoration: "line-through", color: "var(--wm-faint)" },

  ".wm-pv-code": {
    backgroundColor: "var(--wm-code-bg)",
    borderRadius: "6px",
    padding: "12px 14px",
    overflowX: "auto",
  },
  ".wm-pv-code pre": {
    margin: "0",
    fontFamily: MONO,
    fontSize: "14.2px",
    lineHeight: "1.45",
    whiteSpace: "pre",
    tabSize: "4",
  },
  ".wm-pv-code-inline": { fontFamily: MONO, fontSize: "14.2px", color: "var(--wm-code)" },
  ".wm-pv-mark-hl": { backgroundColor: "rgba(255, 213, 0, 0.28)", color: "inherit", borderRadius: "2px" },
  ".wm-pv-link": { color: "var(--wm-accent)", textDecoration: "underline", cursor: "pointer" },
  ".wm-pv-rule": { padding: "8px 2px" },
  ".wm-pv-rule hr": { border: "0", borderTop: "1px solid var(--wm-rule)", margin: "0" },
  ".wm-pv-mathblock": { textAlign: "center", padding: "6px 2px" },
  ".wm-pv-pic img": { maxWidth: "100%", verticalAlign: "middle", borderRadius: "3px" },
  ".wm-pv-pic-missing": { color: "var(--wm-faint)", fontStyle: "italic" },

  ".wm-pv-placeholder": {
    color: "var(--wm-faint)",
    display: "inline-block",
    verticalAlign: "top",
    userSelect: "none",
    pointerEvents: "none",
    whiteSpace: "nowrap",
  },
  // The ``` lines of a code block being typed in step back.
  ".cm-line.wm-fence": { color: "var(--wm-faint)", fontSize: "12px" },
  // Cells are held and none is open: the blocks are lit, and the selection's own rectangles stay out of it.
  "&.wm-pv-heldonly .cm-selectionLayer": { display: "none" },

  // The blank lines between two cells: structure, drawn as the page's one gap.
  ".cm-line.wm-gap": { height: "8px", minHeight: "0", lineHeight: "8px", padding: "0", overflow: "hidden" },
})
