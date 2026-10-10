# Plan: docking, picture cells and ink cells (the port)

Sean, 2026-09-22: *"add a button for floating elements to dock them to a cell wherever the input cursor is.. or
drag that button to get an interactive mouse cursor that puts the image wherever i release the mouse button..
either between cells or in an existing cell .. text can not overlap with an image, the input cursor and text can
only go above and below a docked image"*. 2026-10-05 he chose **editable ink cells**: *a cell in the note you draw
in with the pen; its strokes stay editable; text flows above and below; resizable; the markdown gets a marker
line, strokes live in the drawing sidecar. Floating ink and pictures can be docked INTO an ink cell or AS one.*

This builds on the Mac's plan (`C:\GIT\WriteMindSwift\docs\PLAN-docking.md`, not built on the Mac either) and keeps
every rule of it. Floating objects stay floating (`PLAN-cells-and-floating.md`): an ink cell is something you ask
for, never something floating ink turns into by itself. Undocking is not in this plan.

## Decisions in one place

1. A docked picture is the line `![](.drawings/media/<file>)` and becomes a **picture cell** (Mac rule, as is).
2. An ink cell is ALSO a picture line: `![ink](.drawings/media/ink-<id>.svg)`. Any markdown viewer and the Mac
   show the SVG snapshot; the port knows the `ink-<id>` name and draws the editable cell from the sidecar.
3. Its strokes live in the note's sidecar as ONE drawing item of a new kind, `{ kind: "cell", cell: InkCell }`,
   holding the cell's `aspect` (height ÷ width) and its own items in fractions of the cell's WIDTH on both axes.
4. The committed ink of a cell is painted INSIDE the cell's widget (a `<canvas>` in the editor's DOM) by
   Canvas.tsx's own painter; every gesture (draw, erase, pick, marquee, move, scale, rotate, delete, nudge,
   restyle, pen buttons) is Canvas.tsx's engine run on a **surface**: the page, or one ink cell found from the
   editor's rect registry. One engine, one history, one selection model.
5. Both panes draw picture and ink cells as atomic block widgets; the caret and text only go above and below.
6. Dock handle on a page selection of strokes / pictures: click = at the armed bar, else after the caret's cell;
   drag = drop bar under the pointer; release on a seam = new cell there, over an ink cell = into it.
7. One undo step = `EditClock.together(2)` + the words + the drawing + `EditClock.endTogether()` (new).
8. The snapshot `ink-<id>.svg` is rewritten after each sidecar save that changed that cell; nothing ever deletes
   media; the PDF inlines ink cells from the sidecar and loads picture cells from their files.
9. New key **Ctrl+0 = Insert ▸ Drawing Cell** (free; it sits after Ctrl+8 Code Block and Ctrl+9 Evaluation Cell).

## (a) The markdown

- **Picture cell**: `![](<prefix>.drawings/media/<file>)` on a line of its own. `<prefix>` is `../` once per folder
  between the note and its project folder (media lives in `<projectFolder>/.drawings/media`, notes may sit in
  section subfolders), so other viewers resolve it. WriteMind reads only the basename (`pictureSource`,
  `findMedia` already do), so a note moved to another depth still works here. (Mac: its reader must accept the
  `../` prefix; put that in its CROSS-PLATFORM notes.)
- **Ink cell**: `![ink](<prefix>.drawings/media/ink-<id>.svg)`, `<id>` the cell's `crypto.randomUUID()`.
  Recognised by the FILE NAME only (`/^ink-([0-9a-f-]{36})\.svg$/i` inside a `.drawings/media` path); the alt
  text is free to change.
- **A line that is nothing but one image** is a picture block (parser branch after heading, before quote; it
  flushes like a heading). Words round an image stay a paragraph with an inline picture (today's render); an
  image inside a list or quote stays there. `![](x)` directly under a paragraph line now splits from it (Mac rule).
- **Height**: not in the markdown. An ink cell's height is `aspect` in its sidecar item (shown height = column
  width × aspect, so a wider window scales the ink uniformly and a resize extends or crops rather than stretches);
  the SVG carries the same size as its `width`/`height`/`viewBox`. A picture cell is the column's width capped at
  the picture's own (CSS `max-width:100%` on its natural size), on screen and on paper.
- **An ink line with no item in this note's sidecar** (pasted from another note, a duplicated line, a lost
  sidecar) is drawn read-only from its SVG, exactly like a picture cell. Within a note the FIRST line of an id is
  live and any later copy is read-only.

## (b) The ink cell model and the one engine

```ts
// packages/core/src/drawing/model.ts
export interface InkCell { id: string; aspect: number; items: CanvasItem[] }   // items: never kind "cell"
export type CanvasItem = ... | { kind: "cell"; cell: InkCell }
```
Why an item and not a `cells` field beside `items`: ~15 places rebuild a drawing as `{ items }` (core `removing`,
`restyled`, `reconnect`; Canvas `change({ items: ... })`; App's captures) and a side field would be silently
dropped by each. An item survives all of them, and `isHidden(item)` returning **true for kind "cell"** keeps it
out of everything that already skips hidden pictures (painting, `indexAt`, `idsTouching`, `strokesSwept`,
`stillPicked`, `boundsOf`, `visibleItems`, `inkPieces`). Every exhaustive `switch (item.kind)` (itemId,
itemTransform, withTransform, itemGroup, withGroup, bounds/basePoints, hitTest, paint, writeDrawing,
restyledItem, copied/shifted, export) fails to compile until it has its "cell" arm: the compiler is the audit.
Sidecar: `{ "kind": "cell", "id", "aspect", "items": [...] }`, read back by the same per-item reader (refactor
`decodeDrawing`'s loop body into `itemOf(raw)`); a nested item that is damaged is dropped and counted as today.

**Coordinates.** A cell's items are normalised to the cell's shown width `W` on BOTH axes, so every core
function works on them unchanged when handed `size = cellFrame(W) = { width: W, height: W }` and points local to
the cell's top-left. Stroke widths stay in px, as on the page. Converting page → cell is a pure translation in
points at the moment of docking: page px `(x·pane.w, y·pane.h)` − cell origin, ÷ W; a transform's `dx, dy`
(pane fractions) become `dx·pane.w/W, dy·pane.h/W`; a picture's `width` becomes `width·pane.w/W`.

**Surfaces in Canvas.tsx (DOCK lane).**
```ts
interface Surface { cell: string | null; origin: Point /* page px */; size: Size; clip: Rect | null }
```
- `begin()` keeps its order (tap / ignore → `resolvePress` erase → pen-button slot → pan) and only THEN picks the
  surface: `inkCellPlaces.at(clientX, clientY, scroller)` with `live: true` → that cell, else the page. The
  gesture keeps the surface it began on (a stroke started in a cell and run out of it is clipped; an erase
  started on the page never touches cell ink).
- origin = `(box.left − host.left, box.top − host.top + scrollTop)`, size = `cellFrame(box.width)`, clip = box.
  `doc(event)` returns surface-local points and gesture code reads `surface.size` (NOT `latest.current.size`,
  which stays the pane's: the page's own painting uses it).
- The layer an edit works on: page → the drawing; cell → `{ items: cell.items }`. ONE funnel writes back:
  `commit(next)` = page: `reconnect(next, pane)`; cell: `withInkCell(whole, { ...cell, items:
  reconnect(next, cellFrame(W)).items })`. `change`, `burst`, `eraseAt`, `eraseAlong`, `publish` all go through
  it, so history records the WHOLE drawing as today and Undo needs nothing new.
- The pick is `{ surface: string | null, ids }`; a marquee or click picks only on its own surface. Selection box
  and handles = surface box + origin, re-placed when `inkCellPlaces.subscribe` fires (text above changed).
- Committed cell ink is painted by `paintInkCell(canvas, cell, size, onLoad)` (exported from Canvas.tsx, the
  same `paint()` per item, clipped to the canvas) into the widget's canvas: it moves in the same frame as the text
  (no band repaint, no frame of lag, nothing to do for CodeMirror's virtualisation). The live stroke and rubber
  bands stay on the overlay, translated by origin and clipped to the cell box.
- In a cell: draw, erase (tool and hold), pick, marquee (Ctrl and hold), move (clamped inside the cell), scale,
  rotate, delete, nudge, restyle, copy/paste within the surface. Placing tools (shapes, arrows, text boxes),
  crop, labels and read-into-words act on the page surface only this round.
- `App.tsx` effect on every drawing change: `syncInkCells(view, before, after)` dispatches `setInkAspects` when
  an aspect changed and calls `repaintInkCells(view, ids)` for cell items whose identity changed. The Canvas's
  DPR watcher also repaints them.

## (c) The block widget contract (EDITOR lane, `packages/editor`)

- **One extension, both panes**: `pictureCells` (a StateField of block `Decoration.replace` over each picture
  line, plus `EditorView.atomicRanges`). The rendered page's `entriesIn` skips picture blocks the way it skips
  maths fences; `renderBlock`/`estimatedHeight` get a "picture" arm that reuses the same DOM builder.
- **Picture widget** `.wm-cellpic`: `<img src=pictureSource(path)>`, `max-width:100%`, remeasure on load. Missing
  or unloadable file: a line-tall (21.75 px) placeholder showing alt or file name, so seams and brackets can hold
  it (Mac rule). Not resizable.
- **Ink widget** `.wm-cellpic.wm-inkcell[data-ink-cell=<id>]`: a `<canvas class="wm-inkcell-ink">` filling a box
  with CSS `aspect-ratio: 1 / aspect` (aspect from `inkAspectsField`; `estimatedHeight` = last column width ×
  aspect), a faint card background, and `.wm-cell-resize`, an 8 px strip on the bottom edge (`ns-resize`): live
  drag resizes the box and calls `painter.paint`, the release calls `painter.resized(id, aspect)` ONCE (one undo),
  never below `painter.minAspect(id)` (the ink's own bottom + pad, at least 48 px). The drawing area is the TEXT
  column: 2 px in from the content box each side (`PAGE.left` 32 / `PAGE.right` 36 in export), so screen and paper
  agree. `aspect(id) === null` or a repeated id → drawn as a picture widget (read-only, `live: false`).
- Paint calls: on mount, on `updateDOM` (keep the canvas; never rebuild on aspect change), on its own
  ResizeObserver, and on `repaintInkCells`. The painter comes from the facet `inkCellPainter` (Notebook passes
  one stable object).
- **Caret only above and below**: atomic ranges cover the line; a `transactionFilter` moves an insertion at the
  picture line's start to `text + "\n\n"` before it and one at its end to `"\n\n" + text` after it; Backspace /
  Delete that would join the line to its neighbour HOLDS the cell instead (its bracket lights; the next
  Backspace takes it through the existing held-cell delete). On the rendered page Up/Down step bar → bar over a
  picture cell; `cellStatesSparse` never reports a picture cell "open" and `touchingRuns` never joins it (CORE).
- **Seams, brackets, the + menu** need nothing: the parser makes the line a cell, `cellBoxes` measures the
  widget. The + menu gets a last group, `Drawing Cell` (`CellKind { kind: "ink" }`); Notebook's `choose` calls the
  app's `insertInkCell(seam.offset)` for it instead of arming a type (the bar's typing never makes an ink cell).
- A plain mouse click on a picture cell, or on an empty part of an ink cell with the pen up, holds the cell.
- **Registry** `inkCellPlaces`: widgets register on mount, unregister on destroy; `box()` reads
  `getBoundingClientRect()` of the drawing area NOW; listeners hear mount / unmount / geometry (from a ViewPlugin
  `update` with `geometryChanged || docChanged || viewportChanged`, fired in the measure write phase).

## (d) Docking

- **The handle** (since 2026-10-10 the dock control of the inspector over the pick, `[data-insp=dock]`, no longer a disc `.wm-handle.wm-dock` beside crop / read: docs/PARITY.md "The handles and the inspector") on a PAGE selection that holds strokes and/or pictures
  only (`dockable(...) !== null`; a selection with shapes, arrows or text boxes shows none this round). Title:
  "Dock into the note (click: at the cursor; drag: where you let go)".
- **What it becomes**: exactly one picture → a picture cell; anything else (ink, several pictures, ink and
  pictures) → ONE new ink cell (pictures inside it as `ImageItem`s). Released over a live ink cell → merged into
  that cell. A docked picture loses its floating rotation and scale (size rule in (a)).
- **Click** (pointer up within `DRAG_THRESHOLD`): offset = `cursorSeam(state)` = the armed bar if one is up, else
  the seam after the caret's cell (the next cell's start, or the note's length).
- **Drag**: the handle captures the pointer; a ghost of the selection's bounds follows it on the overlay;
  `dropTargetAt(view, x, y)` answers `{ kind: "ink", id }` over a live ink cell (the cell gets `.wm-drop`), else
  `{ kind: "seam", offset }` = the seam under the pointer, or over a text cell the seam AFTER that cell (Mac rule),
  drawn with `showDropBar.of(offset)`. Release docks there; release outside the editor or Escape cancels. The
  wheel still scrolls the page under the drag (the layer forwards it).
- **New ink cell from page items** (`inkCellFrom`): left edge = the ink's own x relative to the column (kept),
  shifted left if it overruns, scaled down uniformly (the scale handle's `transformed` math about the bounds'
  top-left) if wider than `W − 2·INK_PAD`; top at `INK_PAD`; aspect = `(bounds.height + 2·INK_PAD) / W`, at least
  `INK_MIN_HEIGHT / W`. The cell's position on the page is not needed: the conversion picks its own origin.
- **Into an existing cell** (`mergedInto`): the ink's bounds centre goes to the release point (cell-local px),
  clamped inside horizontally and below `INK_PAD` at the top; the cell's aspect grows if the bottom passes it.
- After a dock the page pick is cleared and the bar under the new cell is armed (it IS the cursor).

## (e) ONE undo step

```ts
const clock = history.clock                // DrawingHistory.clock === historyOf(note).clock
clock.together(2)                          // editTimeline.ts: the next two edits share one stamp
insertCellLine(view, line, offset)         // @writemind/editor: one view.dispatch, userEvent "input.dock",
                                           //   isolateHistory.of("full"); textTimeline stamps it
history.record(before); apply(after)       // drawingHistory.ts + App's changeDrawing: same stamp
clock.endTogether()                        // NEW: drops an unused share so it never glues the next edit
```
`stepOnce` takes both sides when their stamps are equal, so one Ctrl+Z (key, menu or pen double-tap) puts the
floating objects back AND takes the line out; Redo docks again. Words first, then drawing (Mac order). The words
go through `view.dispatch`, never `setDocument` / `version` (that would replace the state and lose the history).
Used by: dock as a cell (line + items out + cell item in, one drawing apply), insert an empty ink cell (line +
cell item). Docking into an existing cell and resizing are drawing-only: one `history.record` each.
Orphans: deleting an ink line leaves its cell item in the sidecar, so Undo brings the cell back with its ink.
Nothing prunes cell items this round.

## (f) Media lifetime and the snapshot

- **No sweep exists in the port** (checked: nothing in main deletes `.drawings/media`). Rule for whoever writes
  one: it must keep every file named by `mediaFiles(markdown)` of every note AND `drawingMediaFiles(drawing)` of
  every sidecar (pictures inside cells and each cell's `ink-<id>.svg`), or it deletes docked pictures and ink
  snapshots.
- **Moving a note** to another project folder (`moveSidecar` → `bringPictures`) must bring the note's markdown
  media and the cell media too: `main/macDrawing.ts pictureFiles` is replaced by core `drawingMediaFiles` and the
  moved note's `mediaFiles(markdown)` are added (DOCK lane, Phase 3).
- **The snapshot** `ink-<id>.svg` is the only media file ever rewritten in place (`media:save` names are 16-hex
  content hashes and can never start with `ink-`). Written by new IPC `wm.writeInkSnapshot(note, id, svg,
  onlyIfMissing)` → main `saveInkSnapshot` → `<owner>/.drawings/media/ink-<id>.svg` by `writeFileAtomic`, id
  checked against the UUID pattern, registered in `found`. Rewritten after each successful sidecar write for
  every cell item whose identity changed since the last write (so strokes, Undo, Redo and resize all reach it);
  on opening a note, each live cell is written `onlyIfMissing`. Size: the cell's shown width (registry), else 720.
  Content: `inkCellSvg(cell, width, { mediaUrl, metadata: true })`: the export's own vector writer, transparent
  background, plus `<metadata id="writemind-ink">` with the cell's JSON so a later round can adopt a cell pasted
  into another note. An empty cell gets an empty SVG of its size at once.

## (g) PDF export

`blockHtml(block, paper, media)` gets a "picture" arm. `media: BlockMedia` is built by `blockMediaFor(drawing,
pane, mediaUrl)`: an ink block whose cell is in the drawing is INLINED as `inkCellSvg(cell, columnWidth(pane))`
(always current, never the file); any other picture block is `<img class="pic" src=url>` with
`max-width:100%`; `url` returns null for a missing file → the same line-tall alt placeholder as the screen. The
measuring page already waits for its images (`loadFile` resolves after `load`), so measured heights are real.
Main's `renderNotePdf` passes `media` to both `noteBlocks` and `printHtml` (one-line edits) and `printedPictures`
checks `mediaFiles(markdown)` for existence. `inkPieces` skips cell items (hidden). `runGaps` needs nothing.

## (h) Contracts and ownership

Every lane codes against these exact names. CORE lands the types first (Phase 0).

**CORE lane** owns `packages/core` (+ its tests).
```ts
// src/markdown/images.ts (new; the Mac's planned MarkdownImages.swift)
export interface PictureLine { alt: string; path: string }
export function pictureLine(line: string): PictureLine | null          // only a line that is nothing but one image
export function mediaFile(path: string): string | null                 // basename for (../)*.drawings/media/<name>
export function inkCellId(file: string | null): string | null          // "ink-<uuid>.svg" → uuid
export const inkFileName = (id: string): string => `ink-${id}.svg`
export function pictureMarkdown(file: string, depth?: number, alt?: string): string
export function inkCellMarkdown(id: string, depth?: number): string    // ![ink](.drawings/media/ink-<id>.svg)
export function mediaFiles(markdown: string): string[]                 // cells and inline pictures, own media only
// src/markdown/parser.ts: Block | { kind: "picture"; alt: string; path: string; file: string | null; ink: string | null }
//   (positioned AND positionedUpdate)
// src/cells/types.ts: CellKind | { kind: "ink" } | { kind: "picture"; line: string }
//   kindName "Drawing Cell" / "Picture"; KIND_GROUPS gets [{ kind: "ink" }] last; opening(picture) writes the
//   line; opening(ink) returns null (the app makes ink cells)
// src/cells/preview.ts: picture cells never "open", never in a touching run, keepsNewlines false
// src/drawing/model.ts: InkCell, CanvasItem "cell", isHidden(cell) = true, decode/write, all switch arms
// src/drawing/inkCell.ts (new)
export const INK_PAD = 12, INK_MIN_HEIGHT = 48, INK_DEFAULT_HEIGHT = 200
export interface Column { left: number; width: number }                // page px
export const cellFrame = (width: number): Size => ({ width, height: width })
export function inkCells(drawing: Drawing): InkCell[]
export function inkCellOf(drawing: Drawing, id: string): InkCell | null
export function withInkCell(drawing: Drawing, cell: InkCell): Drawing  // replace by id, else append
export function newInkCell(width: number, id?: string): InkCell        // aspect = INK_DEFAULT_HEIGHT / width
export function minAspect(cell: InkCell, width: number): number
export function dockable(drawing: Drawing, ids: Set<string>): "picture" | "ink" | null
export function takenOut(drawing: Drawing, ids: Set<string>): { drawing: Drawing; items: CanvasItem[] }
export function toCell(items: CanvasItem[], pane: Size, origin: Point, width: number): CanvasItem[]
export function inkCellFrom(items: CanvasItem[], pane: Size, column: Column, id?: string): InkCell
export function mergedInto(cell: InkCell, items: CanvasItem[], pane: Size, width: number, at: Point): InkCell
export function drawingMediaFiles(drawing: Drawing): string[]
// src/export/inkSnapshot.ts (new)
export function inkCellSvg(cell: InkCell, width: number, options: { mediaUrl(file: string): string; metadata?: boolean }): string
export function readInkSnapshot(svg: string): InkCell | null           // written now, used by a later round
// src/export/blocks.ts + document.ts
export interface BlockMedia { url(file: string): string | null; ink(id: string): InkCell | null; column: number }
export function blockMediaFor(drawing: Drawing, pane: Size, url: (file: string) => string | null): BlockMedia
// blockHtml(block, paper?, media?), noteBlocks(markdown, paper?, media?), PrintInput.media?: BlockMedia
```

**CORE as built (2026-10-05): all of the above, plus these (other lanes code against them too).**
- `staysClosed(block)` (cells/preview.ts) and an optional last argument on the state functions:
  `touchingRuns(cells, apart?: (index) => boolean)`, `cellStates(cells, selection, holding, armed, apart?)`,
  `cellStatesSparse(cells, of, selection, holding, armed, apart?: (cell, index) => boolean)`. EDITOR passes
  `(cell) => staysClosed(cell.block)` in `preview/field.ts` `openCells` and `(i) => staysClosed(all[i].block)` to
  `touchingRuns` in `preview/keys.ts`; without it a picture cell opens like any other. `returnInBlock` on a picture
  cell opens a cell above it (caret at its start) or below it (anywhere else) and never splits the line.
- `INK_ID` / `isInkId(id)` (main's `saveInkSnapshot` id check), `inkBottom(cell, W)`, `changedInkCells(before, after)`
  (the cells whose object changed: for `syncInkCells` and `snapshotsAfterSave`), `mediaInUse(notes)` (the sweep rule
  as code), `itemSvg(item, size, options)` (export/drawing.ts: one object as SVG elements), `inkCellHeight`,
  `inkCellJson`, `INK_METADATA_ID`; `inkCellSvg` options also take `paper?`.
- `dockable` is null for a lone picture with no file. `inkCellFrom` keeps the left edge in `[0, W − INK_PAD − w]`
  (`INK_PAD` when it had to scale). A cell read with no (or a bad) aspect gets 200 / 720.
- Paper CSS (`BLOCK_CSS`): `.pic img { display:block; max-width:100%; height:auto }`, `.pic.missing` one line
  (21.75 px, alt or file name, secondary colour, italic). The screen's `.wm-cellpic img` should be `display:block` too,
  or an inline image's descender gap makes screen and paper disagree by a few px per picture cell.
- The snapshot names the pictures inside a cell by bare file name (`mediaUrl: (file) => file`: they sit beside it).
  An svg shown AS AN IMAGE loads no other file, so those pictures are missing when the snapshot is viewed as an
  image (other viewers, the read-only fallback); strokes always show. Inlining them is a later round.

**EDITOR lane** owns `packages/editor` (incl. `preview/`) (+ its tests).
```ts
// src/pictureCells.ts (new)
export interface InkCellPainter {
  aspect(id: string): number | null      // null: no item in this note → read-only picture
  minAspect(id: string): number
  paint(id: string, canvas: HTMLCanvasElement, size: { width: number; height: number }): void
  resized(id: string, aspect: number): void                 // once, at the release
}
export const inkCellPainter: Facet<InkCellPainter | null, InkCellPainter | null>
export const setInkAspects: StateEffectType<ReadonlyMap<string, number>>
export const inkAspectsField: StateField<ReadonlyMap<string, number>>
export const pictureCells: Extension      // widgets both panes, atomic, filter, keys, hold-on-click
export function repaintInkCells(view: EditorView, ids?: Iterable<string>): void
// src/inkCellRegistry.ts (new)
export interface InkCellPlace { id: string; view: EditorView; element: HTMLElement; live: boolean; box(): DOMRect }
export const inkCellPlaces: {
  at(clientX: number, clientY: number, within: Element): InkCellPlace | null
  byId(id: string, within: Element): InkCellPlace | null
  all(within: Element): InkCellPlace[]
  subscribe(listener: () => void): () => void
}
// src/dock.ts (new)
export type DropTarget = { kind: "seam"; offset: number } | { kind: "ink"; id: string }
export function cursorSeam(state: EditorState): number
export function dropTargetAt(view: EditorView, clientX: number, clientY: number): DropTarget | null
export const showDropBar: StateEffectType<number | null>   // SeamLayer draws it, distinct from the armed bar
export function insertCellLine(target: { state: EditorState; dispatch(spec: TransactionSpec): void },
  line: string, offset: number): { from: number; to: number }        // own cell, bar under it armed
export function columnBox(view: EditorView): { left: number; width: number }   // client px of the text column
```
Also: `preview/field.ts` (skip), `preview/keys.ts` (bar → bar), `preview/render.ts` (arm + estimate), themes,
`index.ts` exports.

**EDITOR as built (2026-10-05): all of the above, plus these (no name above changed).**
- `insertCellLine(target, line, offset, effects?)`: an optional 4th argument, effects that ride in the same
  transaction (e.g. `setInkAspects`, so a new ink line is live from its first frame). The renderer's wrapper of
  `dispatch` that appends them works too.
- `setInkAspects` carries the WHOLE map and replaces the last one. A widget is live when its id is in the map, else when
  `painter.aspect(id)` answers (first line of an id only). At the strip's release the editor dispatches the map with
  the new aspect itself (nothing snaps back) and then calls `painter.resized` once.
- `paint(id, canvas, size)`: `size` is the drawing area in CSS px; the widget sets only the canvas's CSS size, the
  PAINTER sizes its backing store for the device pixel ratio. Paints come from the box's own ResizeObserver (mount,
  aspect change, column width), `repaintInkCells`, and a change of the painter facet.
- Extra exports: `showDropTarget(view, target | null)` (the drop bar for a seam, `.wm-drop` on a live ink cell, both
  cleared by null), `dropBarField`, `seamAfterCellAt(view, y)`, `holdPictureCell(view, element)`,
  `pictureCellsField`, `pictureCellsOf`, `picturesWhole`, `inkCellsMoved()` (tell the registry's listeners),
  `PICTURE_LINE` (21.75), `pictureCellDom`, `lastColumnWidth`.
- `Notebook.tsx` props: `inkPainter?: InkCellPainter | null` (wrapped in one stable object, so the facet never
  changes) and `onInsertInkCell?(offset)` (the + menu's Drawing Cell at a bar). App passes both (DOCK lane).
- Typing beside a picture is typed at the EDITOR's caret (`EditorView.inputHandler`, high precedence; it declines
  while a bar is armed): the browser's own caret cannot stand at a block widget's edge and typed into the next line.
- Presses: the widget handles its own (`ignoreEvent` true): a left click holds the cell, a right click holds it unless
  a selection covers it, Ctrl / Cmd and the middle button are left alone (the drawing layer's marquee). The strip
  takes `pointerdown` (button 0) and captures the pointer: Canvas must let a press on `.wm-cell-resize` through.
- `InkCellPlace.box()` of a read-only ink line is its image (or placeholder); `at()` / `byId()` prefer live places.

**DOCK lane** owns `apps/desktop/src/renderer/{Canvas.tsx, drawingHistory.ts, editTimeline.ts, dock.ts (new),
inkCells.ts (new)}`, the wiring in `Notebook.tsx`, `App.tsx`, `useUndo.ts`, and surgical edits to
`shared/commands.ts`, `shared/keyList.ts`, `main/menu.ts`, `main/main.ts`, `preload/preload.ts`,
`renderer/wm.d.ts`, `main/notes.ts`, `main/macDrawing.ts`, `main/exportPdf.ts`, docs (KEYS, PARITY, TODO).
```ts
// renderer/dock.ts (new; testable with an EditorState and fakes)
export interface Words { cursorOffset(): number; write(line: string, offset: number): boolean }
export interface DockDeps { history: DrawingHistory; drawing(): Drawing; apply(next: Drawing): void; words: Words; depth: number }
export function oneStep(clock: EditClock, words: () => boolean, drawing: () => boolean): boolean
export function dockAsCell(deps: DockDeps, ids: Set<string>, pane: Size, column: Column, offset: number): boolean
export function dockInto(deps: DockDeps, ids: Set<string>, pane: Size, cellId: string, width: number, at: Point): boolean
export function insertInkCell(deps: DockDeps, offset: number, width: number): string
// renderer/inkCells.ts (new)
export function inkPainter(drawing: () => Drawing, onResized: (id: string, aspect: number) => void): InkCellPainter
export function syncInkCells(view: EditorView, before: Drawing | null, after: Drawing): void
export function snapshotsAfterSave(note: string, written: Drawing, widthOf: (id: string) => number | null): void
// Canvas.tsx: export function paintInkCell(canvas, cell, size, onLoad): void; new prop dock?: DockHost
export interface DockHost { words: Words; target(x: number, y: number): DropTarget | null; clear(): void;
  column(): Column /* client px (columnBox); Canvas makes it page px */; depth: number }
// editTimeline.ts: EditClock.endTogether(): void; changedBox skips hidden items (useUndo reveals a changed cell
//   with inkCellPlaces.byId(id)?.element.scrollIntoView({ block: "nearest" }))
// shared/commands.ts: c("insertInkCell", "Drawing Cell", "page", "CmdOrCtrl+0") after Code Block
// preload: writeInkSnapshot(note: string, id: string, svg: string, onlyIfMissing?: boolean): Promise<{ file: string }>
```

**DOCK as built (2026-10-05): all of the above, with these changes and additions.**
- `insertInkCell` returns `string | null` (null: the words would not take the line). New `dockedAsCell(...)` = `dockAsCell`
  returning the new cell's id ("" for a picture cell) or null; `depthOf(note, folders, root)` (the `../` count).
- `DockDeps.ahead?(next: Drawing | null)` and `DockHost.ahead?` (new): told the drawing a dock is about to apply right
  before its line is written, so the widget the line's own transaction draws already finds its cell (App's painter reads
  `pending ?? current`); the line carries `setInkAspects` too (`insertCellLine`'s `effects` argument).
- The drop target is shown with the editor's `showDropTarget(view, target)` (bar and lit cell in one), not `showDropBar`.
- `inkCells.ts` also has `snapshotsOnOpen` (each live cell `onlyIfMissing`), `snapshotNow` (a new empty cell, at once),
  `shownWidth(view, id)`, `aspectsOf(drawing)`, `dockHostFor(view, depth, ahead, drawing)`; `editTimeline.ts` has
  `changedCells(before, after)` (useUndo reveals a changed cell by its place, else by scrolling to its line).
- IPC channel `media:inkSnapshot` → main `notes.ts saveInkSnapshot(root, note, id, svg, onlyIfMissing)`; `macDrawing.ts
  pictureFiles` walks cell items (their `ink-<id>.svg` and the pictures inside); `moveSidecar` also brings the moved
  note's `mediaFiles(markdown)` (even with no sidecar); `main.ts printedPictures` finds `mediaFiles(markdown)` first.
- Canvas: the pick is `{ on: cell id | null, ids }`; `change` / `burst` take the surface explicitly (the compiler found
  every call); a move in a cell is kept inside it (`keptInside`); a plain press on an ink cell's `.wm-cell-resize` strip
  is handed to the strip when the layer covers the note (pen down, a tool armed), so the pen resizes a cell too. The
  dock handle is `⤵`, just right of the selection's box, half way down (clear of Delete and Resize on a flat stroke).
- The footer counts `visibleItems` (a cell item is not a floating object).

**PEN-BUTTONS lane** (same round) owns `penButtons.ts`, `penActions.ts`, `penSettings.ts`, `PenMenu`,
`TabletSurface`, `penFeed.ts`. What it can rely on: Canvas asks `resolvePress(event, penSettings())` FIRST and
routes `erase` / `select` holds before any surface choice, so a hold behaves the same on the page and in an ink
cell; double-tap Undo / Redo end in `runPenAction("undo" | "redo")` → useUndo's `stepAcross`, which already
covers cell ink and docking. If it must change how Canvas starts a gesture (e.g. a button pressed mid-stroke), it
edits ONLY Canvas's press block (from `const press = resolvePress(` to the `press.kind === "pan"` branch), after
re-reading the file; the DOCK lane keeps that block's shape and puts its surface code after it.

*Deviation, done by PEN-BUTTONS (2026-10-05) — the DOCK lane must keep these when it makes `begin()` and the
gesture effect surface-aware.* There is no "tap" press any more (`press.kind === "ignore"` is the only early
return: a side button pressed in the air). A hold now runs only while the pen TOUCHES, which needed four small
hooks OUTSIDE the press block, all calling pure helpers in `penButtons.ts`: (1) the `late` pointermove listener in
the pointerdown effect begins a gesture at `holdBegins(was, event)` (button pressed in the air, then the touch,
which Chromium sends as a pointermove), tracking `touching = inContact(event)`; (2) the gesture's window `move`
handler ends a pen gesture at `penLifted(event)` (the pen lifted with the button still held); (3)
`scrollWithFinger` ends a pen pan at `penLifted`; (4) after the armed branch, a `select` press with `press.move`
(the pen's Select hold and the Select tool, not Ctrl) inside `insideBox(point, boundsOf(held, selection, size))`
starts `moving` the selection — in a cell this must use the surface's local point, its pick and its box.

## (i) Order and tests

**Phase 0 (CORE, first):** `images.ts`, the parser's picture block, `InkCell` + item kind + decode/write,
`CellKind` additions, exports, with tests. EDITOR and DOCK start against the signatures above meanwhile.
**Phase 1 (parallel):** CORE `inkCell.ts`, preview states, `inkSnapshot.ts`, export arms. EDITOR `pictureCells`,
registry, `dock.ts`. DOCK: Canvas surfaces with NO change on the page (prove with the existing pen / canvas e2e),
painter + `syncInkCells`, snapshot IPC, Insert ▸ Drawing Cell + Ctrl+0 + the + menu item.
**Phase 2 (DOCK):** drawing inside ink cells, resize commit, the dock handle's click, one undo step.
**Phase 3 (DOCK):** the drag (drop bar, merge into a cell), PDF wiring, media following moved notes. Then the gate.

Tests owed (vitest: only your own files; e2e under `C:\CLAUDIO\agents\e2e\dock\`, PASS / FAIL lines):
- **CORE** `test/markdownImages.test.ts` (whole-line only, `../` paths, ink ids, mediaFiles incl. inline),
  `parserPictures.test.ts` (flushes a paragraph, list / quote images untouched, ranges exact, `positionedUpdate`
  equals `positioned` over random edits with picture lines), `drawingCells.test.ts` (cell item round-trips,
  damaged nested items dropped and counted, isHidden, EVERY core edit keeps cell items), `inkCell.test.ts`
  (page→cell keeps every item's bounds to 0.01 px after translating back; wide ink fits; merge grows aspect;
  dockable rules), `exportPictures.test.ts` (picture / ink / missing arms, inlined SVG at the column width,
  snapshot viewBox + metadata, drawingMediaFiles).
- **EDITOR** `test/pictureCells.test.ts` (state level: one block widget per picture line in both modes, atomic,
  edge typing lands on its own line, Backspace holds, no preview BlockWidget for it, never open),
  `test/dockSeams.test.ts` (`cursorSeam` armed vs caret, `insertCellLine` = own cell + bar armed + ONE history
  event). e2e: widget heights equal column × aspect in both panes, missing file is one line tall, resize.
- **DOCK** `apps/desktop/test/dockUndo.test.ts` (dock, insert: one Undo restores items AND removes the line;
  Redo; an unused share does not glue the next edit), `keyList.test.ts` + KEYS.md row (`Insert | Drawing Cell |
  Ctrl+0 | —`). e2e (synthetic pen with `buttons` bits): draw / erase-hold / select-hold / move / delete in a cell;
  typing above moves the cell's ink with it; dock click picture → picture cell → Ctrl+Z; ink → ink cell; drag to a
  seam; drag into a cell; snapshot written and rewritten; PDF contains the cell. Screenshots looked at.

## Traps

- **A footer or reveal that counts or measures every item** sees the cell item: footer counts `visibleItems`;
  `changedBox` skips hidden items or an Undo of a cell stroke scrolls to the top of the note.
- **`reconnect` per surface**, with that surface's size; never the pane size on cell items.
- **The column, not the content box**: the ink widget's drawing area must be the text column (32 / 36 px in) or
  the PDF and the screen disagree on every cell stroke.
- **Duplicate Cell, copy / paste of an ink line** make a second line with the same id: read-only by rule (a).
  Forking ids on duplicate (and `duplicateNote`) is a later round; until then both stay safe, neither is lost.
- **Floating ink does not move when a cell is docked or inserted** (existing rule): ink placed beside words
  below the new cell is now beside other words. Expected; say so in PARITY.
- **No `setDocument` for a dock** (it would drop CodeMirror's history and break the one Undo).
- **Tests that walk `ALL_KINDS`** through `openCell` now meet `{ kind: "ink" }`, which opens a plain cell by
  design: they skip it, they do not "fix" `opening`.

## Not in this round

Undocking; adopting a foreign ink cell from its SVG metadata; forking ink ids on duplicate; shapes, arrows and
text boxes in ink cells; a cell that grows while you write past its bottom; the Mac reading `../` paths.
Sean's hands: the Intuos pen drawing, erasing and selecting inside a cell (and the new button holds and
double-taps there), the feel of the dock drag, and how a docked photo sits in the column.
