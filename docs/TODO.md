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

- **The drawing layer.** `Drawing`, `DrawingGeometry`, `CanvasPlacement`,
  `CanvasGroups`, `Shapes` and `ConnectorRouting` are all pure and port as
  the rest did; the layer itself is a `<canvas>` over the editor with
  pointer events, and the sidecar is already read and written by the main
  process (`drawing:read` / `drawing:write`). Until this lands there is
  nowhere for a capture to go, which is why the camera waits on it.
- **The camera.** Frames through `getUserMedia`, the box dragged by hand,
  and then the pure pipeline: `Homography`, `PageShape`, the local-mean
  threshold, connected components, and `ShapeInk` + `FlowGrouping` +
  `FlowChartReading` — 2k lines that turn a sketch of boxes and arrows into
  real nodes and connectors, and none of it needs Apple's ML. Page-finding
  and handwriting OCR are macOS-only (a small native Vision helper).
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
