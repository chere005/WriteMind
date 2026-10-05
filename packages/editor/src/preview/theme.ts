/**
 * How the rendered page looks. The headings are the Mac's RENDERED ladder
 * (`MarkdownPreview.BlockView.headingSize`: 28/22/18/16/15/17, h1 bold, h2–h5
 * semibold, h5 and h6 secondary) on the drawn blocks AND on the open one, so a
 * block does not change size when it opens; the body is the same line height
 * as a line of source for the same reason. The air between two cells is the
 * markdown side's rhythm, a blank line of it (Mac 0cde812), and a code block
 * is a box round its code (Mac e66379c).
 */

import { EditorView } from "@codemirror/view"
import { PREVIEW_BLOCK_GAP, PREVIEW_CODE_PADDING, PREVIEW_CODE_SIDE_PADDING } from "@writemind/core"

/** The Mac's rendered heading ladder, for a drawn heading and for the open one alike. */
const ladder = {
  1: { fontSize: "28px", fontWeight: "700", lineHeight: "1.2" },
  2: { fontSize: "22px", fontWeight: "600", lineHeight: "1.25" },
  3: { fontSize: "18px", fontWeight: "600" },
  4: { fontSize: "16px", fontWeight: "600" },
  5: { fontSize: "15px", fontWeight: "600", color: "var(--wm-soft)" },
  6: { fontSize: "17px", fontWeight: "400", fontStyle: "italic", color: "var(--wm-soft)" },
} as const
const headings: Record<string, Record<string, string>> = {}
for (const level of [1, 2, 3, 4, 5, 6] as const) {
  headings[`.wm-pv-h${level}`] = ladder[level]
  headings[`&.wm-rendered .cm-line.wm-h${level}`] = ladder[level]
}
// The open heading's hashes are a hidden widget, and the editor's caret buffers either side of it hang from the TOP OF
// THE TEXT — above a tight heading line, which grew two pixels and pushed the page down as the heading opened.
headings["&.wm-rendered .cm-line.wm-h1 .cm-widgetBuffer, &.wm-rendered .cm-line.wm-h2 .cm-widgetBuffer"] = { verticalAlign: "top" }

const MONO = "ui-monospace, SFMono-Regular, Menlo, Consolas, 'DejaVu Sans Mono', monospace"

export const previewTheme = EditorView.theme({
  // A drawn block is for clicking: the I-beam says "this opens for writing", and the browser's own
  // selection (which would only smear across it) stays out.
  ".wm-pv": { padding: "0 2px", lineHeight: "1.45", overflowWrap: "break-word", cursor: "text", userSelect: "none" },
  // Cells with no blank line between them still have the page's gap.
  ".wm-pv-touching": { paddingTop: `${PREVIEW_BLOCK_GAP}px` },
  ".wm-pv-held": {
    backgroundColor: "color-mix(in srgb, var(--wm-accent) 16%, transparent)",
    borderRadius: "4px",
  },

  ".wm-pv-p": { whiteSpace: "pre-wrap" },
  ".wm-pv-heading": { whiteSpace: "pre-wrap" },
  ...headings,

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
  // A list open for typing is set out like the drawn one — the marker in the same column (the row's 8px, a 14px
  // marker, the 8px gap), the words where they were — so opening it moves nothing.
  ".cm-line.wm-pv-open-li": { paddingLeft: "10px" },
  ".wm-pv-open-li .wm-bullet": {
    display: "inline-block", minWidth: "14px", textAlign: "center", paddingRight: "0", marginRight: "8px",
  },
  // (Its box sits where the drawn row centres it: half a line down, not on the baseline.)
  ".wm-pv-open-li .wm-todo": { marginRight: "8px", verticalAlign: "0.5px" },
  ".wm-pv-open-num": { display: "inline-block", minWidth: "14px", textAlign: "center", color: "var(--wm-accent)", marginRight: "4px" },
  ".cm-line.wm-pv-open-done": { textDecoration: "line-through", color: "var(--wm-faint)" },

  ".wm-pv-code": {
    backgroundColor: "var(--wm-code-bg)",
    borderRadius: "6px",
    padding: `${PREVIEW_CODE_PADDING}px ${PREVIEW_CODE_SIDE_PADDING}px`,
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
  // A table: a grid of thin rules, the header in bold on a faint tint; a table wider than the column scrolls inside
  // its own box (the paper sets the same box: export BLOCK_CSS `.table`).
  ".wm-pv-table": { overflowX: "auto" },
  ".wm-pv-table table": { borderCollapse: "collapse", maxWidth: "100%" },
  ".wm-pv-table th, .wm-pv-table td": {
    border: "1px solid var(--wm-rule)",
    padding: "4px 10px",
    verticalAlign: "top",
    textAlign: "left",
    whiteSpace: "pre-wrap",
    overflowWrap: "break-word",
    minWidth: "2em",
  },
  ".wm-pv-table th": {
    fontWeight: "600",
    backgroundColor: "color-mix(in srgb, var(--wm-text) 5.5%, transparent)",
  },
  // The rule's clickable body is its own height (9px, the Mac's), not padding leaking into the gaps either side.
  ".wm-pv-rule": { padding: "4px 2px" },
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
  // The ``` lines of a code block being typed in step back: shut to the drawn block's padding, so a code block that
  // opens moves nothing (Mac 0cde812), and opened on the line the caret is on, where the language is typed.
  ".cm-line.wm-fence": { color: "var(--wm-faint)", fontSize: "12px" },
  ".cm-line.wm-fence:not(.wm-fence-here)": {
    height: `${PREVIEW_CODE_PADDING}px`, lineHeight: `${PREVIEW_CODE_PADDING}px`, fontSize: "0", overflow: "hidden",
  },
  ".cm-line.wm-fence-open": { borderTopLeftRadius: "6px", borderTopRightRadius: "6px" },
  ".cm-line.wm-fence-close": { borderBottomLeftRadius: "6px", borderBottomRightRadius: "6px" },
  // And its code sits where the drawn block sets it, the box's side padding in.
  "&.wm-rendered .cm-line.wm-code-line": {
    paddingLeft: `${PREVIEW_CODE_SIDE_PADDING + 2}px`, paddingRight: `${PREVIEW_CODE_SIDE_PADDING + 2}px`,
  },
  // Cells are held and none is open: the blocks are lit, and the selection's own rectangles stay out of it.
  "&.wm-pv-heldonly .cm-selectionLayer": { display: "none" },

  // The blank lines between two cells: structure, drawn as the page's one gap — a blank line of the markdown side.
  ".cm-line.wm-gap": {
    height: `${PREVIEW_BLOCK_GAP}px`, minHeight: "0", lineHeight: `${PREVIEW_BLOCK_GAP}px`, padding: "0", overflow: "hidden",
  },
  // The caret put away (Escape in an open block): nothing blinks anywhere on the page.
  "&.wm-pv-away .cm-cursorLayer": { display: "none" },
})
