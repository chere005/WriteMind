# Plan: three canvas modes, groups, and no tables

Sean, 2026-09-20: "the pen button section should allow choosing between pen
mode, cursor mode, and pointer select mode which draws rectangles that can
select drawn (or captured) stuff for grouping, deleting, ungrouping... toggle
grouping with the button on the screen or ctrl+g, pen and pointer select mode
operate in the same space (along with placed squares and such.. the cursor
interacts with the notebook (which is markdown).. tables is weird right now...
just completely remove tables as a feature and we'll rebuild that from
scratch".

Three jobs. Do them in this order, one commit and one deploy each, because the
first two touch the drawing layer and the third touches the notebook. The
standing rules in `AGENTS.md` hold throughout: one xcodebuild at a time, tests
then quit then `sh tools/deploy.sh` then `open`, never `dtp`, and never read or
write `~/Documents/WriteMind`.

## 1. Three modes, one switch

Today the pane's behaviour is three booleans that fight each other:
`AppState.penActive`, `connectActive`, and `placing`, each clearing the others
in a `didSet`. The pen menu shows one switch, "Pen: On".

Replace the pen half with a real mode, persisted like the other defaults:

```swift
enum CanvasMode: String { case cursor, pen, select }
```

- **Cursor** — what "pen off" is now. The notebook takes the clicks: the seams,
  the cells, the brackets, the text. Objects on the layer can still be clicked
  and dragged directly, as they can today.
- **Pen** — draws. Exactly today's `penActive`.
- **Select** — a drag anywhere on the pane pulls a rectangle, and everything it
  touches is selected. No drawing, and no click reaches the text. This is the
  marquee that ⌘-drag already does (`DrawingCanvas.Interaction.marquee`), made
  a mode of its own rather than a modifier. ⌘-drag keeps working in cursor mode.

`penActive` becomes `mode == .pen` and stops being stored. `connectActive` and
`placing` are NOT folded in — they are tools that take the pane for one gesture
and hand it back, and Sean asked about the pen section, not about them. They
still turn the mode to `.cursor` the way they clear `penActive` today.

"Pen and pointer select mode operate in the same space (along with placed
squares and such)": the drawing layer is one space and all three of pen, select
and the placement tools work in it. The cursor is the only one that talks to
the markdown. That is already true of the layer; it is the MODE that has to say
so, and `AppState.canvasOwnsPane` (or whatever gates hit-testing today) reads
the mode rather than the booleans.

The pen menu's "On" switch becomes a three-way picker — a segmented control of
Cursor / Pen / Select, the app's own words. The cursor over the pane follows the
mode: the pencil for pen, the crosshair for select, and in cursor mode whatever
the notebook and the seams already decide (do not regress that — it is four
rounds of work).

## 2. Groups

"select drawn (or captured) stuff for grouping, deleting, ungrouping... toggle
grouping with the button on the screen or ctrl+g".

Model: one optional field on the objects that can carry it, the same shape the
old `anchor` had — `var group: UUID?` on `Stroke`, `ImageItem` and `ShapeItem`,
in `CodingKeys`, in the memberwise init, and read with `decodeIfPresent` so a
sidecar written before groups existed still opens. `ConnectorItem` does not get
one: a connector is held by the nodes at its ends, which have their own.

Behaviour, all of it pure and testable in a new `CanvasGroups`:

- Clicking any member selects the whole group. Marquee-touching any member
  takes the whole group.
- **⌃G is a toggle.** A selection of two or more objects that are not already
  one whole group becomes a new group. A selection that IS exactly one whole
  group is ungrouped. Nothing else happens — one object alone does nothing, and
  a selection spanning two groups makes one group of everything in both.
- The on-screen button sits with the handles already drawn round a selection
  (the trash / rotate / move cluster) and does the same thing, with its icon
  and its tooltip saying which of the two it will do.
- Delete takes every member. Move, scale and rotate already work over the whole
  selection, so grouping needs nothing there.
- Ungrouping leaves the objects exactly where they are.

`CanvasGroups` answers: the selection grown to whole groups; whether ⌃G would
group or ungroup; the items after grouping; the items after ungrouping. The
canvas calls it and holds no rules of its own.

## 3. Tables, removed

"tables is weird right now... just completely remove tables as a feature and
we'll rebuild that from scratch."

Take it out whole — the rebuild starts from a clean page, and git history has
the old one when it is wanted. What goes:

- `WriteMind/Editor/MarkdownTable.swift` and `WriteMind/Editor/TableEditor.swift`.
- `WriteMind/Camera/DrawnTable.swift` — reading a hand-drawn table off a
  photograph exists only to write a markdown table, so it goes with the feature
  and comes back with it. Unhook it from `NotebookCapture` / `TextRecognition`
  cleanly; a captured page is still read as prose and marks.
- `MarkdownBlock.table`, the parser's table branch and its look-ahead for the
  `---|---` rule. Pipe lines become ordinary paragraphs again.
- The rendered page's table row and its `TableEditor` case.
- The toolbar's table button, its chevron menu and ⌃⌘T, the Insert menu entry,
  `MarkdownFormatting.insertTable` and friends, and the `tableGrid` default.
- Tests: `TableEditingTests` and `DrawnTableTests` go; `TableAndListTests` keeps
  its list half and loses its table half; anything else that builds a table as
  a fixture is rewritten to use a cell type that still exists.

Leave a single line in `docs/TODO.md` — **tables, from scratch** — because that
is an unbuilt feature, which is what that list is for.

Check afterwards that nothing else quietly depended on tables: the PDF export's
renderer, the cell-type menu (it never had a table entry), `CellSeams`, the
outline, and the folding.
