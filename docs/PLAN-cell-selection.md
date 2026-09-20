# Plan: selecting several cells, and a clean split

Sean, 2026-09-20: "fix selecting multiple cells by clicking and dragging,
shift clicking, or cmd clicking.. also when dividing a cell, the cursor
should go inbetween the new cells, and there shouldn't be a spuriously
added newline".

Three things, on top of [PLAN-cells-and-floating.md](PLAN-cells-and-floating.md)
— do them AFTER that one has landed, because it rewrites the same two panes.
The standing rules in `AGENTS.md` all still hold: one xcodebuild at a time,
`sh tools/test.sh` then quit, `sh tools/deploy.sh`, `open`, one commit per
change, never `dtp`.

## 1. The spurious newline is real, and it is `isBlank`

`NotebookCells.isBlank` counts a space (32) and a tab (9) and NOT a newline
(10). So a split at a LINE boundary inside a cell leaves the newline that is
already there and puts `"\n\n"` on top of it:

- `"One\ntwo"`, caret 4 → `"One\n\n\ntwo"`. Two cells, and an empty line
  between them that nobody typed.
- `"- a\n- b"`, caret 4 → `"- a\n\n\n- b"`. The same.

It only looks right in the tests because every one of them splits inside a
single-line paragraph (`"One two three"`), where the caret sits on a space.

Fix: the break absorbs newlines as well as spaces and tabs — walk `start`
back and `end` forward over `\n` too, never past the cell's own bounds, and
keep the existing guard that neither head nor tail may come out empty. Then
`"One\ntwo"` at 4 gives `"One\n\ntwo"`, and the caret-on-a-space cases are
unchanged.

Tests to add beside the ones there: a two-line paragraph split at the line
boundary; a two-item list split between the items; a split at the boundary
of a cell that already has trailing spaces before the newline; and the
invariant, over each case — after a split, `MarkdownParser.positioned` has
exactly one more cell than before and NO `.blank` cell has appeared.

## 2. The cursor goes between the new cells

`split` puts the caret at the top of the second cell (`start + 2`). Sean
wants the line that now lives between them: after ⌃D the seam between the
two new cells is ARMED — the horizontal bar, no text caret — exactly as if
he had clicked there. Typing then opens a third cell between them, which is
what "the cursor is between the cells" has to mean.

DONE in 79d2fa2, and NOT this way — the plan was wrong here and the note
is left standing so the next reader does not follow it. The markdown pane
needs no second mechanism at all: b1cf76b made arming follow the caret, so
`split` leaving the caret one character earlier (`start + 1`, on the
separator blank line the break writes) IS the bar between the halves, and
`textViewDidChangeSelection` arms it. `armSeamInDocument` was never added —
it would have been a second writer of the armed state. The RENDERED PAGE,
which has no caret to follow, got `splitCellInDocument`, the shape
`mergeCellsInDocument` already had. Merge (⌃M) keeps its caret where it is.

Test: after `splitCell()` on a two-cell note the note is the split text, the
text view's selection is empty at the seam offset, the seam is armed, and
the caret is not drawn. And: typing one character then gives three cells.

## 3. Selecting several cells from the gutter

Today a bracket takes a single click (select that cell) and a drag of 10pt
or more (move that cell up or down). `hitTest` refuses every point that is
not within 4pt of a bracket's own line, so a drag DOWN the gutter selects
nothing at all — which is the bug.

The gesture set, both panes, the same:

- **Click** a bracket: that cell alone, as now.
- **Drag** from a bracket that is NOT already selected: select every cell
  the drag passes over, live, updating as it moves. Anchored at the bracket
  the drag started on.
- **Drag** from a bracket that IS already selected: move the cell, as now.
  (⌃⇧↑ and ⌃⇧↓ still move it too.) This is the only way both gestures fit
  on one column, and it is Mathematica's own rule.
- **Shift-click** a bracket: extend from the selection's anchor cell to the
  clicked one, taking every cell between.
- **Cmd-click** a bracket: add that cell to the selection, or take it out if
  it is already in — a discontiguous selection.
- A click on the gutter where there is no bracket: nothing, and it does not
  reach the text (the gutter sits in the margin the text container already
  leaves, so there is nothing under it to click).

What a selection IS, per pane:

- **Markdown pane.** `tv.selectedRanges` — NSTextView does discontiguous
  selection natively, and `NotebookGutter.isPicked` already lights a bracket
  whose range is wholly inside the selection. Widen `isPicked` to take
  `[NSRange]` and light a bracket covered by any ONE of them (not by the
  union — two adjacent cells selected separately must light two brackets,
  not the section round them).
- **Rendered page.** Add `@State private var selectedCells: [NSRange]`,
  separate from `editingRange` (which stays the one cell open for typing).
  `CellBrackets.Bracket.selected` comes from it. Opening a cell for editing
  clears it; clicking a bracket clears `editingRange`.

And the whole-cell commands act on all of them: `CellCommands.delete`,
`duplicate` and `move` currently take one range. Apply them to each selected
cell **back to front**, so an earlier edit cannot invalidate a later range,
and make that a test (three cells selected, ⌃⌫ takes exactly those three and
closes the stack). Typing with several cells selected replaces them all —
that is NSTextView's own behaviour in the markdown pane, and on the rendered
page it means delete-then-open-one.

Tests: the pure range arithmetic is what to pin — a helper that answers
"the cells between these two brackets", one that toggles a cell in and out
of a list, one that extends from an anchor, and the back-to-front multi-cell
edit. The gestures themselves are checked on screen.

One thing this plan did not know, found on the screen and now in
`AGENTS.md`: `tv.selectedRanges` is not enough by itself. A delegate that
answers only the SINGULAR `willChangeSelectionFromCharacterRange` makes
AppKit collapse every multiple selection to one range, so the drag handed
five cells over and one bracket lit. The coordinator answers the plural
`…FromCharacterRanges:toCharacterRanges:` too.

## Proving it

On the running app, both modes: drag down the gutter and watch the brackets
light one after another; shift-click far below and see everything between
light; cmd-click one out of the middle and see a hole; ⌃⌫ with three
selected takes three; ⌃D in the middle of a two-line paragraph leaves no
blank line and shows the bar between the two halves; typing there makes a
third cell.
