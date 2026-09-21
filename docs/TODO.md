# What is left

The port's list. A to-do here is something UNBUILT or a bug UNFIXED —
never "not yet checked on screen".

## Ported and running

The notebook: the parser, the cells and their brackets, the seams and the
bar, the + and its kinds, the heading ladder, the four list styles with
tickable to-dos, quote, fenced code, bold/italic/underline/strike, indent
and outdent, split and merge, move section, the note tree, the tab row, the
autosave with its write guard, the folder watcher, Export ▸ PDF, and the
capability table. 157 transcribed tests.

## Not ported yet, in the order they are worth doing

- **The drawing layer, the rest of it.** The pen, the marquee, moving,
  scaling, turning, grouping, deleting, the marks and the flow-chart
  shapes, the arrows and the sidecar all work. Still missing: PICTURES
  (paste and drop, the crop box, and the `<img>` layer the canvas leaves
  a hole for), the connector ROUTING (`ConnectorRouting`, so a line
  attached to two nodes turns right angles), a node's label, and undo
  through the app's own menu rather than ⌥⌘Z on the layer.
- **The camera, the rest of it.** The viewfinder, the box, Writing and
  Page, the ink lifted off the paper and the capture landing where it was
  on the page all work, and so does reading the words out of a picture on
  macOS. Still missing: WARPING the frame through the page quad (the
  helper finds it; nothing undoes the perspective yet, so the box is
  dragged by hand on both platforms), and the flow-chart reader —
  `ShapeInk` + `FlowGrouping` + `FlowChartReading`, 2k pure lines that
  turn a sketch of boxes and arrows into real nodes and connectors, which
  needs no Apple ML and is the best thing the camera does.
- **The rendered page.** The markdown/preview toggle: the second editor,
  block by block, with the same seams and brackets.
- **Folding.** `NotebookOutline.hiddenRanges` is ported; wiring it to
  CodeMirror's fold service and the double-click on a section bracket is
  not.
- **Maths.** `WLExpression`, `MathTypesetter`, `MathTemplates` and the
  two-dimensional view.
- **`/link`**, `<span style>` (font, size, colour), ⌘D's run, and the code
  highlighter.
- **Dragging a row** to reorder or to move a note between sections (the
  order file is written already; the gesture is not).
- **The session**: which notes are open, and where the caret was.
- **Packaging**: electron-builder for a signed `.app` and an `.exe`, and a
  `dtp` lane of its own.
