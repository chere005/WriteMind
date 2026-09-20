# Plan: cells are the note, everything else floats

For whoever picks this up. Sean, 2026-09-20: "all drawing, captured or
drawn with the pen tool, are now free floating and don't belong to cells
whatsoever and so don't push other cells around… the cursor should be
horizontal any space between the two cells… when clicking in between, the
horizontal line appears and that is where the cursor is.. typing from here
would insert a new cell below that line… floating objects like images,
drawing, text fields, etc completely separate from the cells."

That reverses the 2026-09-19 model ("a drawing is a cell as tall as the
drawing", "positions stay the same in markdown and wysiwyg mode", the
"outermost invisible box"). Everything built for that model comes out.
This file says what the app must do instead, what to delete, what to
build, in what order, and how to prove it. Read `AGENTS.md` first for how
the repo works; the rules there (one xcodebuild at a time, deploy after
every small change with `sh tools/deploy.sh`, never `dtp` unless Sean says
"dtp", never touch `~/Documents/WriteMind`) all still hold.

## The model

**A cell is one block of the markdown** — one element of
`MarkdownParser.positioned(from:)`: a paragraph, a heading, a list, a
quote, a fenced block, a table, a run of blank lines (`.blank(lines:)`).
Nothing else is a cell. The page is a stack: cell, seam, cell, seam, …
with `MarkdownPreview.gapHeight` (8 pt) as the ONE seam, in both panes.
No block adds padding of its own. Brackets are drawn for cells and for
the sections that group them, and for nothing else.

**A seam is the whole space between two neighbouring cells**, full width
of the page (the bracket gutter excepted). With N cells there are N + 1
seams: one above the first cell (from the top of the page down to it),
one between each pair, and one below the last cell that runs to the
bottom of the page. Anywhere inside a seam the pointer is the horizontal
I-beam (`NSCursor.iBeamCursorForVerticalLayout`). A click inside a seam
ARMS it: a line is drawn across the page at the seam's middle and stays;
that line IS the cursor, so the text caret is not drawn while a seam is
armed. The first thing typed opens a new cell at the seam and goes into
it; the line goes. Escape, an arrow key, or a click anywhere else disarms
without writing anything — clicking about the page leaves no empty cells
behind. Return while armed opens an empty cell there.

**A floating object is anything on the drawing layer** — a pen stroke, a
capture from the camera (vector or picture), a pasted or added picture, a
shape, a text box, a connector. It lives in document coordinates (pane
fractions measured from the document's top, scrolling with the text — as
now), is drawn over the text, and has NO relationship to cells: it does
not reserve a band, does not push text or blocks, has no bracket, and
remembers no cell. Move a cell (⌃⇧↑/↓, bracket drag) and the objects stay
where they are. Switch modes and an object keeps its document y — it may
sit beside different words on the other side, because the two panes lay
the note out at different heights. That is the consequence of
"completely separate", and it is accepted. (If Sean later asks for "same
words beside it" back, it is a passive memo — nearest cell plus offset,
applied only on a mode switch, never pushing anything. Do not build it
unasked.)

**With the pen up, the seams are off**: the pencil owns the note pane
(Sean, 2026-09-20: "cursor only becomes a pen in the notes pane in
drawing mode!!!!!"). The same while the arrow tool or a placement is
armed (crosshair). Seams come back with the pen down.

## What is wrong now, concretely

1. Objects push cells. `EditorPane.keepClear` → `InkBands.bands` →
   text-container exclusion paths (`MarkdownTextView.exclusionRects`,
   `snappedToCells`, `Coordinator.applyExclusions`) and
   `PreviewLayout.padding(bands:)` pushes on the rendered page. Objects
   also carry `anchor` (a character offset) and are re-homed and
   re-stacked (`CanvasAnchors.stacked`, `FloatingHoming.home`,
   `NoteStore.reanchor`, `reanchorObjects`) on every text change, drag and
   mode switch — which is what makes a drawing "belong" to a cell and
   jump about.
2. The markdown pane's insertion bar (`CellInsertions`) answers only a
   3–6 pt band round the MIDDLE of each gap (`Gap.reach`, capped at 6).
   The rest of the seam still belongs to the text view, so the pointer
   flips between horizontal and I-beam across one gap, and a click a few
   points off the middle puts a normal caret on the blank line instead of
   arming the seam. The tail below the last cell is a 7 pt strip, not the
   whole tail.
3. When a seam IS armed, the caret is still drawn (at the next cell's
   first character) — two cursors.
4. `MarkdownTextView.openCell(at:)` puts the caret one character too far:
   for `"First cell\n\nSecond cell"` armed at 12 it makes
   `"First cell\n\n\n\nSecond cell"` with the caret at 13, so typing `x`
   gives `"First cell\n\n\nx\nSecond cell"` — `x` lazily continues into
   "Second cell" and is NOT its own cell. (`CellInsertionTests.
   testClickingAGapOpensAnEmptyCellThere` asserts the wrong caret.)
   `PreviewEditing.insertBlock(in:at:)` already gets this right (caret at
   12, `x` becomes its own paragraph); the markdown pane should use it.
5. On the rendered page a click in a gap inserts a block IMMEDIATELY
   (`insertBlock`), so clicking about leaves empty cells behind; there is
   no armed state and no line-as-cursor. The tail is an 80 pt tappable
   strip with no hover cursor.
6. Seams stay live with the pen up: `CellInsertions.mouseMoved` sets the
   horizontal cursor whatever the pen is doing.

## Step 1 — cut the objects loose

Mechanical, compile-driven, one commit. Nothing the user sees changes
except that text no longer moves for a drawing.

Delete outright:

- `WriteMind/Drawing/CanvasAnchors.swift`
- `WriteMind/Drawing/FloatingHoming.swift`
- `WriteMind/Drawing/InkBands.swift` (`InkBands` and `BandSettling`)
- `WriteMindTests/CanvasAnchorTests.swift`, `FloatingHomingTests.swift`,
  `InkBandTests.swift`, `ExclusionSnapTests.swift`

Remove from the model (`Drawing.swift`, `Shapes.swift`): the `anchor`
property on `Stroke`, `ImageItem`, `ShapeItem` (property, `CodingKeys`
case, init parameter, `decodeIfPresent`) and `CanvasItem.anchor`. Old
sidecars carry an `"anchor"` key; `Codable` ignores keys it is not asked
for, so they still read — keep ONE test that proves it (a sidecar JSON
with `"anchor": 12` on a stroke, a picture and a shape decodes and the
items are otherwise intact). Rewrite the doc comment on `Drawing.swift`
line ~26 ("The bands the pictures and text boxes take").

`NoteStore`: remove `cellBoundary`, `cellAnchor`, `cellTop`, `cellBoxes`,
`afterPlacing`, `reanchorObjects()`, `reanchor(_:)`, and every call to
them (`captureNotebook`, `place`, `addTextBox`). Replace `anchoredCenter`
with a plain rule — a new picture or capture lands one `gapHeight` under
the caret's line (`caretAnchor`, unchanged), flush with the text's left
edge, or at `visibleCenter` when there is no caret; no boundary snap, no
`breakLineAtCaret`. Shapes, text boxes and connectors still land at
`visibleCenter`. `insertBelow` (words read from a picture go in under it)
and `flowChart(from:under:)` stay.

`EditorPane`: remove `wantedBands`, `keepClear`, the `.onAppear`/
`.onChange` blocks that settle bands, the `.onChange(of: store.text)` and
`.onChange(of: appState.mode)` reanchor calls, the `store.cellBoundary/
cellAnchor/cellTop/cellBoxes/afterPlacing` wiring, the `keepClear:`
arguments to both panes, and `onMoved:`.

`EditorBridge`: remove `cellBoundary(near:)`, `cellAnchor(near:)`,
`cellTop(of:)`, `cellBoxes()`, the three `…InDocument` closures, and
`breakLineAtCaret()` (its only caller was `afterPlacing`).

`MarkdownTextView`: remove the `keepClear` property, `exclusionRects`,
`snappedToCells`, `cellBoxes(in:)`, `Coordinator.bands`,
`lastExclusions`, `applyExclusions()` and its call in `updateNSView`; the
text container's `exclusionPaths` is never set again. In
`refreshBrackets`, drop the `InkBands.cells` loop (and with it the
`range: NSNotFound` convention on `NotebookGutter.Bracket`).

`MarkdownPreview`: remove `keepClear`, `pushes`, the `.padding(.top,
pushes[item.id] ?? 0)`, every `bands:` argument, `cellAnchor(near:)`,
`cellTop(of:)`, `cellBoxesInDocument`, and the ink loop in
`cellBrackets`. `PreviewLayout`: remove `margin`, `padding(…)` and the
`bands:` parameter — `positions(rows:spacing:top:)` becomes the pure
stack `y = top; for row { out[id] = (y, y + h); y += h + spacing }`.
`CellBrackets` is untouched.

`DrawingCanvas`: remove `onMoved` and its two call sites (the drag-end
`onMoved?(Set(snapshot.keys))` and the placement's `onMoved?([item.id])`).
`onBeginChange` still records the undo step; nothing else changes.

`Export/NoteExport.swift`: it lays the paper column out round
`InkBands.bands` and hands the objects to `NotePDF` band by band
(`groups(of:in:bands:)`). Replace with: the column is the pure stack from
`PreviewLayout.positions`, and every visible object is a `NotePDF.Piece`
of its own at its own `bounds(in:)`. `NotePDF`'s page breaking is
untouched — it already keeps a piece whole and keeps overlapping pieces
on one sheet (`NotePDFTests`), which is all the bands were buying. Keep
`MarkdownPreview.topInset`/`sideInset` so paper and screen agree.

Tests to amend: `PreviewLayoutTests` — delete the four band cases
(`…StraddleAPictureGoesUnderIt`, `…TwoPicturesInARow…`,
`…PictureAboveEverything…`, `…PictureMovesTheCellsBelowIt…`), keep the
positions/topRow/gap ones. `NoteStoreDrawingTests` —
`testAPictureLandsUnderTheCaretsLine` now asserts "one gap under the
caret's line, flush left"; `testTheCaretLineAndTheLineBreakAfterIt`
loses the line-break half. `ShapeTests` — drop the `anchor:` arguments.
`NotePDFTests` — the piece and page-break cases stand; only
`testTheWholeNoteGoesOnThePaperAsTextWithItsDrawingOverIt` talks about a
band (its comment near line 178) and is reworded to the object's own
box. `MarkdownLinking` / `SpanAndSelectionTests`
`anchor` hits are link anchors and are NOT this.

Docs in the same commit: `docs/FEATURES.md` — rewrite "The same place,
whichever mode" (drop the object half) and "The note keeps clear of what
is on the layer" (now: the layer floats over the note and never moves
it); `AGENTS.md` — rewrite "A new picture goes under the caret" and
replace "The text runs round pictures through exclusion paths" with a
note that the source editor STAYS TextKit 1 because `MarkerHiding` and
`BulletGlyphs` are `NSLayoutManagerDelegate` glyph substitution, not
because of exclusion paths any more.

Prove it: `sh tools/test.sh` green; run the app; draw over a paragraph
in both modes — no hole opens, nothing moves; drag the drawing — text
still; switch modes — the drawing is at the same y. Deploy.

## Step 2 — one seam model, used by both panes

New file `WriteMind/Editor/CellSeams.swift`, pure, with tests beside it
(`WriteMindTests/CellSeamTests.swift`):

```swift
enum CellSeams {
    struct Seam: Equatable {
        var top: CGFloat        // document points
        var bottom: CGFloat
        /// The character offset a new cell is opened at: the next cell's
        /// range.location, or the note's length under the last cell.
        var offset: Int
        var middle: CGFloat { (top + bottom) / 2 }
        func contains(_ y: CGFloat) -> Bool { y >= top && y <= bottom }
    }
    /// `cells` are (top, bottom, offset) down the page, already sorted.
    /// The first seam runs from `pageTop` to the first cell, the last
    /// from the last cell to `pageBottom`. A seam thinner than
    /// `minimum` is widened about its middle to `minimum` — the strip
    /// has to be hittable, and the neighbours' edges give way.
    static func seams(cells: [(top: CGFloat, bottom: CGFloat, offset: Int)],
                      pageTop: CGFloat, pageBottom: CGFloat, noteLength: Int,
                      minimum: CGFloat = MarkdownPreview.gapHeight) -> [Seam]
    /// The seam a point is in — containment, not "nearest within reach".
    static func seam(at y: CGFloat, in seams: [Seam]) -> Seam?
}
```

An empty note is one seam, the whole page, at offset 0. Overlapping
cells (never, but be safe) resolve by clamping `top <= bottom`.

Tests: N cells → N + 1 seams; the first starts at `pageTop`, the last
ends at `pageBottom`; every point strictly between two cells is in
exactly one seam and no point inside a cell is in any; offsets are the
next cell's start and then the note's length; a thin seam is widened to
the minimum; an empty note is one seam.

## Step 3 — the markdown pane

- `MarkdownTextView.seams(in:)` replaces `gaps(in:)`: each cell's
  extent is the bounding rect of its block's glyph range plus
  `textContainerOrigin.y` (what `cellBoxes(in:)` measured); `pageTop` is
  0, `pageBottom` is `max(tv.bounds.height, usedRect.maxY)`. This is
  measured off the layout, so it already includes the structural 2 pt
  blank lines and the 8 pt `paragraphSpacing` a cell's last line carries
  — the whole of that is seam.
- `CellInsertions` takes `[CellSeams.Seam]` instead of `[Gap]`. `hitTest`
  returns `self` iff the point is inside a seam; `mouseMoved` sets the
  horizontal I-beam while inside and draws the hover line at
  `seam.middle`; `mouseDown` arms. Delete `Gap`, `minimumReach`, the
  reach cap, and `gap(at:in:)`.
- Armed = cursor. `onArm`: `tv.armedSeam = offset`, `tv.setSelectedRange
  ({offset, 0})`, first responder, and `tv.insertionPointColor = .clear`;
  `disarm` restores the colour (keep the original in a property, read it
  once at `makeNSView`). The line stays drawn while armed.
- Opening: `PasteAwareTextView.insertText(_:replacementRange:)` (already
  overridden) calls `PreviewEditing.insertBlock(in: string, at: offset)`,
  applies it through `shouldChangeText`/`insertText`/`didChangeText` at
  the whole-note range, sets the caret to the returned `caret`, disarms,
  then inserts what was typed. Delete `MarkdownTextView.openCell(at:)`.
  `paste(_:)` while armed does the same before pasting. Override
  `doCommand(by:)`: `insertNewline:` while armed opens the empty cell and
  disarms; every other selector (arrows, `cancelOperation:`, deletes)
  disarms first, then `super`. `mouseDown` already disarms.
- With the pen up: `MarkdownTextView` gets `seamsEnabled: Bool`
  (`!penActive && !connectActive && placing == nil`, from `EditorPane`);
  the coordinator sets `insertions.isHidden = !seamsEnabled` and disarms
  when it goes false.
- `CellInsertionTests` becomes `CellSeamTests` (the geometry cases) plus
  `CellOpeningTests`: for `"First cell\n\nSecond cell"` armed at 12,
  typing `x` yields `"First cell\n\nx\n\nSecond cell"` with the caret
  at 13 and `positioned` showing three paragraphs; at offset 0, typing
  `x` yields `"x\n\nFirst cell…"`; at the end of `"Only cell\n"`, typing
  `x` yields `"Only cell\n\nx"`; at the end of `"Only cell"`,
  `"Only cell\n\nx"`; between `"baz"` and a `.blank(lines: 8)` cell,
  typing `x` gives one more cell than before, a paragraph `x`, at the
  seam's index, and the blank cell survives. Then the invariant, as a
  test over several notes: after one character in an armed seam,
  `positioned` has exactly one more cell, it is a paragraph holding that
  character, and it is at the seam's index. And: Escape / a click / an
  arrow while armed changes nothing; the caret colour is clear while
  armed and back after.

## Step 4 — the rendered page

- Seams from `CellSeams.seams` over `PreviewLayout.positions` (cells) with
  `pageTop = 0` and `pageBottom` = the scroll content's height. The
  `gap(at:)` view is the seam's full height (the 8 pt strip between
  rows; the top inset above the first row; the whole tail under the
  last), full width, `contentShape(Rectangle())`, hover → horizontal
  I-beam and the hover line, click → arm. Replace the 80 pt tail strip.
- Armed state: `@State private var armedSeam: Int?`. The armed seam
  draws the line and holds focus: give the seam view `.focusable()` with
  a `@FocusState` and `.onKeyPress(phases: .down)`. Escape → disarm.
  Return → `insertBlock(at: offset)` (which opens the editor on the new
  empty cell) and disarm. A printable character → `insertBlock(at:)`,
  then `draftBinding.wrappedValue = characters` (that is the write into
  the note), `caretAtStart = false`, disarm. Anything else → `.ignored`.
  A click anywhere else, `beginEditing`, and a mode change disarm.
  Nothing is written until a key says so — clicking about leaves no
  empty cells.
- With the pen up: `seamsEnabled` in, the same as the markdown pane; the
  gap views take no hover and no tap while it is false.
- Tests: `PreviewEditing.insertBlock` cases above (they are the same
  strings); the seam layout over `positions` (first seam starts at 0,
  last reaches the content height); and a test that arming then
  disarming leaves `markdown` untouched.

## Step 5 — prove it on screen, then hand back

Use the computer-use tools on the running app (both modes, same note):

1. Draw with the pen across a paragraph; capture a page from the camera;
   paste a picture; add a text box. In BOTH modes: no hole opens, no cell
   moves, no bracket appears for any of them. Drag each about: text
   still. Switch modes: each is at the same y.
2. Pen down. Hover the space between two cells: horizontal I-beam
   everywhere in it, right up to both cells' edges; over a cell, the
   I-beam. Click: the line appears, the caret is not drawn. Type `x`: the
   line goes, `x` is its own cell between the two, the caret after it.
3. The same above the first cell and anywhere under the last.
4. Click a seam, click elsewhere: no new cell. Click a seam, Escape: none.
   Click a seam, Return: one empty cell, being edited.
5. A blank-line cell (a run of ≥3 blank lines) has a bracket; the seams
   either side of it work.
6. Pen up: no horizontal cursor anywhere, no arming; pencil only in the
   note pane (camera, toolbar, sidebar keep the arrow).
7. `sh tools/test.sh` green, `sh tools/deploy.sh`, then report — and
   only say "dtp" to Sean's own "dtp".

Screenshots of 1–3 go to Sean; do not hand him a checklist.

## Do not

- Reintroduce anchors, bands, exclusion paths or per-block pushes in any
  form. If something "needs" them, the model above is being misread.
- Add padding to a block. The seam is `gapHeight`, once, and the
  markdown pane's structural blank lines (`MarkdownSourceStyle.
  structuralSize`, 2 pt) are the only other height between cells.
- Tidy or rewrite blank lines. A run of blank lines is the note's
  content (a `.blank` cell), never spacing.
- Edit the text storage inside `textDidChange`/`didChangeText` — it
  re-enters and kills the process; defer to the next run-loop turn.
- Touch ⌘D (Sublime's multi-select). Cells split/merge on ⌃D/⌃M.
- Run two `xcodebuild`s at once (`build.db` locks; the failure reads as
  `** TEST FAILED **` naming no test).
