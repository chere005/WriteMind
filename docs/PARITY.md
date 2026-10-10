# Parity checklist (Windows pass, 2026-10-03)

Status: works / fixed / missing / untested. The evidence scripts of this pass
(`t02.mjs` ...) now live in the repo as the end-to-end harness, `e2e/` (run with
`npm run e2e`; `docs/TESTING.md`): `t01`/`t02`/`p3` = `editor/01-typing-and-keys`,
`t03` = `cells/02-selection-and-drag`, `t04`-`t06` = `cells/03-seams`,
`t07` = `editor/08-pointer-and-todo`, `t13` = the same, `t14` = `editor/07-context-menu`,
`t15` = `pen/05-touch-and-palm`, `t10`/`t11` = `drawing/03-ink-select-transform`,
`t12` = `drawing/01-connectors`, `t16` = `drawing/05-hidpi`, `t17`/`t18` =
`drawing/04-textbox-and-marks`, `t19` = `editor/03-fold`; `wm/{fold,links,drag,
session,features}` = `editor/03..06`, `02`; `buttons/b1` = `pen/03-buttons-and-expresskeys`;
`chrome/*` = `chrome/01..04`; `maths.mjs` = `maths/01`; `camera-*` = `camera/01..02`;
`tablet/flow` = `tablet/01-sheet-as-camera`. The Pad and its scripts are gone.

## Done in this pass

| Feature | Status | Evidence |
|---|---|---|
| Typing, list continuation, Ctrl-B/I/U/Shift-X, Ctrl-1..8, Tab/Shift-Tab, Ctrl-D/M, undo/redo, Alt-D, code auto-pair | works | t02.mjs |
| Caret visible on dark theme (was black on dark), selection colour (was pale on dark), active-line band removed | fixed | theme.ts, t03 |
| Cell brackets: click, shift, ctrl, drag-down picks a run live, drag of a HELD bracket moves the run, edge auto-scroll, wider hit area, hover colour | fixed (drag was missing) | t03.mjs |
| Seams: hover, click, type opens cell, Enter opens empty cell, Escape disarms, caret hidden while armed (class was wiped by CodeMirror on focus), + menu keeps caret on the bar (superseded 2026-10-05: the + makes the cell at once, see "The pointer over cells"), menu Esc and clamps inside window, paste at a bar | fixed | t04/t05/t06.mjs |
| Arrows walk cell, bar, cell on the MARKDOWN side too (Sean, 2026-10-05): Down on a cell's last row on screen arms the bar beneath it (between cells that touch, after the last cell), Up on its first row the bar above; from a bar Up/Down/Left/Right go into the cell beside it; a picture / ink cell is stepped over bar to bar; a closed section is one cell; Escape gives the caret back where the arrow found it. **Port differs from the Mac on purpose**: the Mac's source pane arms only by the caret landing on a blank line (`CellSeams.arm`) and an arrow at a bar just puts it out (`MarkdownTextView.doCommand`); the rendered-page walk (`BlockEditor` moveDown/moveUp) is what Sean asked for here. Also fixed: past a closed section the seams skipped a heading on the very next line (`shownBeyond`) | built | `packages/editor/test/barWalk.test.ts`, `e2e/suites/cells/04-arrows-to-bar.mjs` (62 checks, real keys) |
| Rendered-page arrows skip code fences (Sean, 2026-10-05: "in rendered mode pressing up or down shouldn't select the backticks of a code cell"): Up/Down into a fenced cell (code, eval In, its `out`, `wl` maths, any fence) land on its first / last CONTENT line, inside it walk the content and leave from the first / last content line to the bar; an empty cell gets an empty content line; a click on a fence strip lands on the content beside it, except on the fence the caret already stands on (open: its language is clicked into, double-click selects it; 2026-10-06). Shift+arrows, drags, Left/Right (the language) and the markdown side unchanged. Like the Mac's block editor, which shows only the code | built | `packages/editor/test/previewFences.test.ts` (19), `e2e/suites/cells/05-rendered-fence-arrows.mjs` (real keys and clicks) |
| Separate cells (Sean, 2026-10-05: "this math cell should be placed as its own cell, not connected to the cell before it"). WRITING: every command that makes a cell writes a blank line above and below it, never doubling one (`cellSpacing`, core `cells/apart.ts`): maths palette Insert, Code Block on an empty line / round a selection, an evaluation cell at the note's end, the answer a run writes, a pasted / duplicated cell (the bar, + menu, Return and dock already did); at the note's end the palette leaves the bar under the maths; deleting a cell that touched its neighbours leaves them a blank line apart. READING: a fence (code, eval, out, `wl`), table, picture, heading or rule touching the block above or below (`standsAlone`) is its own cell: both pages draw a blank line's air in front of it (a block widget, `editor/apart.ts`; brackets and seams measured below it), so it has its own bracket, a full seam where the bar can be put, its own box, and it never joins a touching run (opens alone). Words + a list touching stay one run. An In/Out pair stays one pair bracket, touching or not. **Differs from the Mac**: the Mac's `insertMath` / `codeBlock` write one line break (glued), and its source pane draws touching blocks with no gap and brackets end to end; its rendered page already stacked every block apart. Parser unchanged (it already ended a block at a fence / table / heading line). ALSO (Sean: "it shouldn't unrender the math until i'm actually in that cell"): while a bar is the cursor no cell holds the caret: typeset maths (block and inline), list markers (decorations.ts), the rendered page's blocks stay drawn; the caret parked at a bar by hand is not moved into list furniture | built | `packages/core/test/apart.test.ts` (12), `packages/editor/test/apartCells.test.ts` (6); `C:\CLAUDIO\agents\e2e\sep\separate-cells.mjs` (36 real-key/mouse checks, both pages: brackets, seam click, typing at it, cell/bar/cell walk with the maths DOM kept, palette and Ctrl+8 under an answer); 03-seams, 04-arrows, 01-brackets still pass |
| Italic with `*`, Mac inline regexes ported; snake_case_name no longer italic | fixed | p3.mjs |
| Folding, caret steps over folds | works | t19.mjs, old/fold.mjs |
| Todo tick by click, rendered toggle | works | t07.mjs |
| Right-click menu Cut/Copy/Paste/Select All (via main `edit:native`) | fixed (was none) | t14.mjs |
| Pen strokes, undo/redo, marquee, move/scale/turn, delete, group | works | t10/t11.mjs |
| Palm rejection while the pen is near, finger scroll in pen mode, pen touch-action | fixed (new) | t15.mjs |
| Handles of a thin selection no longer stack | fixed | Canvas.tsx |
| Flow shapes, label, routed arrows follow | works | t12.mjs |
| Rounded rectangle is drawn square | FIXED 2026-10-03 (d1-shapes): painted with `roundRect`, radius 0.2 of the short side; outline, hit test and arrow landing use the same rounded polyline | `shapes.test.ts`, `agents/e2e/d1/a1.mjs` |
| Marks (tick, cross, star, query), picture paste | works | t18.mjs |
| Text boxes (card, wrap, live growth, readable ink, re-edit by double-click); `text` added to NODE_KINDS so Shapes menu offers it | fixed (was missing); core `textBox.ts` + 10 transcribed tests | t17.mjs |
| HiDPI 1.5x: canvas crisp, handles aligned | works | t16.mjs |

## Next steps, in order

1. ~~Rounded-rectangle outline~~ done (d1-shapes).
2. ~~Run `cells.mjs` and `pen.mjs`~~ done 2026-10-03 (h1-e2e-harness): both are in the repo as `e2e/suites/cells` and `e2e/suites/pen`, isolated from the real notes, and pass against the current build (`npm run e2e`).
3. ~~Untested: links, tabs, session restore~~ done (e2-editor-polish, last section but one). Still untested: Export PDF, camera/capture/OCR, maths palette, crop, window resize (strokes stretch with the pane, same as Mac), rendered mode shows fence lines.
4. Add a unit test for the inline regexes (they live in the editor package; no DOM needed) and for seam Enter/Escape.
5. ~~Selection box colour for held cells only highlights text width~~ done (cells lane, 2026-10-05): held cells are one box each, margin to margin, as tall as their brackets; see "Cell furniture" below.

## For chrome agent

- ~~Tab title lags~~ fixed (p1-projects-pdf): the tabs take the titles the tree has after every save (`App.tsx` `keepOnly`).
- ~~Marks menu lists only 4 marks~~ fixed (d1-shapes), see the drawing section below. (The Swift `ShapeItem.Kind` has exactly four marks; the "boxes, circles..." of FEATURES.md are the Mac's `MarkMenu` list, which borrows three node kinds and adds the three line buttons.)
- ~~"Hold these together" never says Ungroup~~ fixed (d1-shapes).
- FEATURES.md says indent is two spaces; the code and Swift tests use four.
- A half-applied TopBar change once crashed the renderer (`collapsed.includes` of undefined) when App.tsx did not yet pass the prop.

## Projects, export and the window (p1-projects-pdf, 2026-10-03)

Evidence is `C:\CLAUDIO\agents\e2e\p1\` (port 9412; `t-projects`, `t-export`, `t-export2`, `t-window`, `t-theme`, `t-tabs`,
`t-layout`, `t-firstrun`, `t-focus`, `t-rows`; `run-all.mjs` runs the lot; every one prints PASS/FAIL and a last line ALL PASS). Unit tests: `packages/core/test/pagePlan.test.ts`,
`export.test.ts` (PagePlan + NotePDF tests of the Swift), `apps/desktop/test/project.test.ts`, `layout.test.ts`.

### Projects

| Mac | Here | Status |
|---|---|---|
| Project file: JSON `{excluded, folders, version}`, sorted keys, `"key" : value`, an empty array as a blank line, paths unescaped | `project.ts` `stringifyProject` writes Foundation's exact shape; it reads any JSON, an older file without `excluded` too | works (`project.test.ts`, `t-projects`) |
| A `.writemind-project` from the other kind of machine | a POSIX path on Windows (or a drive path on a Mac) is kept EXACTLY as written, shows as a folder that is not there, and saving does not mangle it | works; the sidebar says "Can't open the notes folder" and offers Add Folder / New Project |
| Open a project with no folders | opens, shows the default folder (`setFolders` fallback) | works |
| Open a file that is not a project | says so in a dialog, nothing changes (the Mac only logs) | works |
| Project menu: name (+ "— edited"), Add Folder, Remove Folder (disabled with one), Save, Save As, Open, New | all there; "edited" also shows for an untitled project that changed (`hasUnsavedProjectChanges`) | works |
| Remove Folder from Project on a section row | right-click menu (`FloatingMenu`): a project folder runs `removeFolder` (greyed with one folder), a nested folder runs `excludeFolder` (kept in `excluded`, left on disk); offered only for a folder that exists AT THE CLICK | works |
| Footer: "N notes · M folders" and the Folder menu (Add Folder, Remove Folder ▸ the other real folders, Hidden Folders ▸ Show X, Reveal) | `SidebarProject.tsx` | works. Not carried: Choose Folder… / Use ~/Documents/WriteMind (a macOS permission workaround) |
| Empty list ("No notes yet" + New Note / New Section); right-click on the blank list | same | works |
| Opening / creating a project closes tabs from folders no longer in it; removing a folder does too | `App.tsx` `keepOnly` after every tree read; the one in front is written first, then the first tab left (else the project's first note) comes forward | works |
| Session per project (`ProjectSession`: a file keyed by the project path, `default` for none) | `Sessions/<stem>-<hash>.json` in userData; the PAGE names the key on every read and write, so the last write of a project that was just left lands in ITS file | works. The Mac reads a project's session only at launch; here Open Project also brings that project's tabs back (a deliberate step past it) |
| Last project restore | `project.json` (file, folders, excluded); an unsaved project comes back by its folders | works |
| The first note opens on launch when there is no session (`selection = notes.first`) | same | works |
| Adding the same folder twice | one folder (paths tidied; case-blind on Windows) | works. A folder inside another may be added (both then show, as on the Mac) |
| Unsaved buffers in the session | carried since e2-editor-polish (hot exit): see "The editor, polished" | works |

### Export (File ▸ Export ▸ PDF…)

| Mac | Here | Status |
|---|---|---|
| `PagePlan` (US Letter 612x792, margin 54, a break between cells, a taller-than-a-sheet object alone and shrunk, overlapping pieces welded) | `packages/core/src/export/pagePlan.ts`, the Swift tests transcribed | works |
| The note rendered as the preview draws it (28/22/18/16/15 ladder, author line italic and bigger, lists, to-dos, quote, code in the Mac's LIGHT code colours, maths, rule, blank cells), always light on white | `blocks.ts` / `inline.ts`; maths is the notebook's MathML (`mathmlString`), an equation wider than the column is zoomed to fit | works; looked at as PNG (`agents/shots/p1-pdf-page-*.png`) |
| Colours checked against the paper (a yellow span or pen is darkened) | `readableInk` against #FFFFFF | works |
| The drawing as vectors over the text, one object at a time: strokes (pressure strokes as segments), shapes, routed connectors with heads and dashes, pictures, text boxes (an empty one prints nothing) | `drawing.ts` (SVG + real text); a hidden picture is not printed | works |
| The column is laid out at the editor pane's width and SCALED onto the paper (not re-flowed) | same; each sheet is laid out at its own top and then scaled (the print engine cuts pages where the LAYOUT is — a transform alone made words print twice) | works |
| Save panel: the note's own name, in Documents, "Where the PDF of “title” goes", a failed write is an alert | same (`exportPdf.ts`); the dialog goes through `askSave` so `e2ePick` answers it. Since 2026-10-05 it is File ▸ Export… (Ctrl+E), one panel for PDF or Project: see "Export and keys" at the end | works |
| No header, footer or page number | none | same |
| Export of a selection / a section | the Mac has none | n/a |
| Before: `printToPDF` of the app's own window (toolbar and all) | gone | fixed |

Differences: the face is Segoe UI (the Mac's San Francisco); a link prints blue and underlined; `<mark>` (written by /link) prints
highlighted and `<a id>` anchors are dropped where the Mac prints them as literal text. A code block taller than a sheet is zoomed
(its words may wrap a hair differently).

### Wolfram notebook and Copy into Mathematica (port-only, Sean 2026-10-06)

The Mac has neither. "add export to wolfram notebook.. make drawing cells a Graphics[]", then, after the first build:
"actually, use wolfram's import of SVG as "Image" instead of "Graphics"!!!! and paste those as images rather than as graphics!!!"
and "you should be able through clipboard wizardry serve something i can paste to a notebook as the image itself rather
than the link". A drawing cell is an IMAGE: its SVG (from the sidecar, never the snapshot file) imported by the Wolfram
Engine, `ImportString[svg, {"SVG", "Image"}]`; the engine is WriteMind's own wolframscript lookup (Language Setup's choice
first; a full Mathematica's `/Applications/Wolfram.app`, `Mathematica.app`, `Program Files\Wolfram Research\Wolfram\<v>`
and `Mathematica\<v>` too), ONE kernel run per export or copy.

| Feature | Here | Status |
|---|---|---|
| File ▸ Export… (Ctrl+E) has a third type, Wolfram Notebook (`.nb`): headings, text, lists, to-dos, quotes, tables, rules in Mathematica's own styles; maths and `wolfram` code Input cells (maths typeset by the kernel, held, never evaluated); Python ExternalLanguage; answers Output cells; every drawing cell, floating-layer band and picture an embedded Image (an Output cell that re-running the Input above it keeps) | `packages/core/src/export/wolfram/` (text, maths, svg, plan, notebook, kernel, clipboard), `apps/desktop/src/main/wolfram/`, `eval/runner.ts` `wolframJob` | works; checked with the real engine and the front end's own render (`apps/desktop/scripts/check-wolfram.ts`), `e2e/suites/export/01` |
| No engine, or one that does not answer: the export still writes the file; each image is a CLOSED initialization Input cell `Image[ImportString[svg, {"SVG","Image"}]]` (a picture carries its bytes), and a dialog says the drawings appear when the cells are evaluated (Evaluation ▸ Evaluate Initialization Cells; checked: only those cells run) | `exportNotice` | works |
| Copy or Cut of held cells with a drawing cell: Mac: the front end's own pasteboard type (`dyn.ah62d4rv4gk8y8xnfk6`, 'OMEG') holds the cells (the drawing as the open Input cell at once, as the image when the kernel answers), beside the PNG for Pages / Word; Windows / Linux: the plain text becomes the front end's linear syntax for the image (only when every held cell is a drawing) beside the standard `image/png`. WriteMind's own cells stay on the clipboard and win inside WriteMind (`takesPastedPicture`: no floating picture on a paste back) | `main/wolfram/clipboard.ts`; `capabilities.wolframClipboard` | works to the clipboard (checked in the real app, `e2e/suites/export/02`); the paste into a real notebook is for the full install (docs/TODO.md) |
| Copy Cell (the tablet box's button, above): one drawing that is in no note, copied as the transparent image for Mathematica (the same types as a copy of held cells, but never a PNG) and as an SVG file for every other app; written at once, engine or none | `main/wolfram/clipboard.ts` (`cell`), `copiedFile.ts`, `svgClipboardFor` | works on a Mac (`e2e/suites/tablet/04`); the Windows / Linux file list and SVG format are written by the same API, not read back there |
| A machine with no engine: a copy of held cells changes nothing (AGENTS: show nothing); an export still works (above) | `wolframClipboardFor`, `exportNotice` | works |

### The window

| Mac | Here | Status |
|---|---|---|
| Launch: notes and video side by side, EVERY launch (`showEditor = showCamera = true`) | the video shows on launch (it was off) and is not remembered | works |
| `HSplitView` 720:420 ideal, min 460 / 280 | `PaneDivider.tsx` + `shared/layout.ts`: drag, double-click resets, arrow keys when it has focus; the position is a FRACTION, remembered (`writemind.videoFraction`); the mouse never takes the keyboard from the notes | works at 100/125/150/200 % and 900x560…2560x1300 (`t-window`) |
| Sidebar 250 wide | 250 | works (was 232) |
| Window 1280x800, min 900x560 | same (was 1440x900, min 720x480); size, place and maximised are remembered (`window.json`); a window on a monitor that is gone comes back on the primary | works; maximised checked in unit tests only |
| Hide Video / Hide Notes Pane / Hide Notes Sidebar (Ctrl+Shift+Y / no key / Ctrl+K), never both panes | menu and keys, the labels flip | works |
| One window per profile | `requestSingleInstanceLock` (a second launch brings the first forward) | added (not on the Mac, which allows many windows) |
| Appearance follows the system | `prefers-color-scheme`; the window's first paint matches; `t-theme.mjs` audits every text and icon in both for WCAG contrast (4.5 / 3) over the note, rendered, edit mode, menus, popovers and context menus. Corrections: `--wm-faint`, a second accent for fills (white on the dark accent was 2.5:1), the tab close, the popover's buttons | works (0 findings) |
| Focus returns to the notes after a menu command, a bar or sidebar click, a tab, a context-menu item, a select | `focusReturn.ts` (leaves text fields and open menus alone); the font-and-colour and pen popovers close on Escape and click-away | works |
| Tabs: +, the list, Close Other Tabs, wheel, middle click, context menu (Close / Close Others / Reveal), the title follows the heading | `TabBar.tsx` | works |
| Empty pane: icon, "No note open", "New Note  Ctrl+N" | same | works |
| The sidebar's right-click on a NOTE: New Note Here, New Section Here, Rename…, Duplicate, Reveal, Move to ▸ (the folders, then every section), Move to Trash… | `noteMenu` (`SidebarProject.tsx`), `Prompt.tsx` for Rename (name selected, "The file keeps its extension") and the question before the bin ("It goes to the Recycle Bin, where you can put it back") | works (`t-rows`); the bin's name is the platform's |
| … on a SECTION: Rename… (the folder is renamed on disk; its notes keep their drawings, the open tabs follow, it keeps its place in the order; a taken name becomes "name 2"), Remove Folder from Project, Move to Trash… | `renameSection` in `main/notes.ts` | works (`t-rows`) |

Not done / not verifiable here: the note row's date under the title (the Mac shows "Oct 3 · snippet"); a section row that is SELECTED
(decides where the next note goes — here the open note's folder does); a real change of display scale while running (checked by
device-metrics emulation, not by dragging the window between monitors); the real title bar's dark mode. (The red `getBoundingClientRect` bar on closing the last tab is fixed: `measure()` guards its host; `agents/e2e/fix-projects/closeflush.mjs`.)

## The tablet as a source for the video pane (port-only)

The Mac has a document camera; a Windows tablet has a pen. **Input Devices ▸
Tablet** (also the video chevron in the sidebar; remembered, `camera:tablet`)
swaps the camera feed for a sheet of paper (dot grid by default) written on with the pen.

| Camera feature | On the tablet |
|---|---|
| Writing button | the pen's own **stroke items** (with pressures), placed where the box was at the learned page scale. Not re-traced: nothing is lost to a threshold. |
| Page button | the sheet rendered as a picture (the "Aa" reader works on it where an OCR exists, and is simply absent otherwise) |
| Dashed box | the **mouse** drags it (the pen writes, the mouse never inks); drag inside moves it, corner handles resize it, Esc or a click outside clears it, a double click boxes the whole sheet (the Mac's `boxAction`); the pen's side button (Select) boxes too; strokes crossing the edge are cut |
| Buttons under the box (Sean, 2026-10-05; WINDOWS-ONLY, the camera's box has its own Image / Writing / Text) | one slim row under the box (flips above it at the sheet's bottom, kept on the sheet, short labels only when the full row is wider than the sheet; mouse targets, and a pen tap clicks them: `BoxActions.tsx`, `boxRow.ts`; a press BEGUN on the row that moves 6 px (`CLICK_SLOP_PX`) is the sheet's from its first point, a stroke for the pen (the native feed holds such a contact back, `data-pen-handover`, penFeed.ts; the window pen and the mouse are handed over by the row itself), a box for the mouse; 2026-10-06). **Erase**: what is in the box rubbed off the open sheet by the Writing capture's rule (strokes crossing the edge are cut, as Writing cuts them, NOT removed whole), one sheet Undo, the box stays. **Bring in Writing** = the header's Writing with this box. **Bring in as Drawing Cell**: the boxed writing as a NEW drawing cell at the armed bar, else after the caret's cell (`dock.ts dockNewInk`, `App.tsx dockSheetCell`): same size as Writing lands it, THE BOX IS THE CELL (2026-10-06; the Mac has no drawing cells, so this follows its Writing rule, a capture lands where it sat in the box): the ink where it sat in the box, the cell as tall as the box (scaled down whole only when the box is wider than the column; `boxRow.ts cellOfBox` / `landedFrame`), snapshot written, ONE note Undo; off the sheet as Writing does (nothing leaves the sheet if the note refuses). Both Bring in buttons off on a drawing cell's own tab and with no note open. **Copy Cell** (2026-10-06, Sean: "add Copy cell as a button to a selection in the video/tablet viewer"; PORT-ONLY, the Mac has no drawing cells): the same capture as Bring in as Drawing Cell (the box is the cell) put on the SYSTEM CLIPBOARD instead of docked, the note, the sheet and the box untouched; needs no note, an empty box says "nothing written in that box" and copies nothing (`App.tsx copySheetCell`, `copiedCell.ts`, `dock.ts inkCellForNewInk`). A paste in WriteMind is a NEW drawing cell at the armed bar, else after the caret's cell, as Bring in lands it (`dockNewInk`, ONE Undo; the editor's own paste `pasteDrawing`, or the window's when the focus is off the editor), never also a picture. In Mathematica the transparent image (a Mac: the front end's OMEG type; elsewhere the linear syntax); in every other app the SVG FILE (`Drawing.svg` in a temp folder the next copy and the next start sweep: a file reference -- a Mac: `public.file-url` in the ONE pasteboard item with `public.svg-image` and the words; elsewhere `text/uri-list` -- so Finder, Mail, Pages, Figma paste the file), never a PNG. With no engine the file, the markup and WriteMind's own paste are still there. Chromium on a Mac shows a paste that carries a file as only that file, so WriteMind knows its own file by its name and size (`copiedCellOf`). Ctrl+Z right after a Bring in is the note's even with the mouse still over the sheet (until it moves) | built | `apps/desktop/test/boxActions.test.ts` (10), `boxRowHandover.test.ts` (13), `copyCell.test.ts` (6), `copiedCell.test.ts` (9), `copiedFile.test.ts` (3); `e2e/suites/tablet/04-copy-cell.mjs` (25: real mouse and pen tap, the Mac pasteboard read back through AppKit); `C:\CLAUDIO\agents\e2e\box-buttons\box-buttons.mjs` (45 checks: inject-tablet pen, real mouse / keys); `e2e/suites/tablet/03-box-row-handover.mjs` (21: feed pen, window pen, real mouse) |
| Flow-chart reader | reads a black-on-white raster of the same ink; nodes/arrows land under the capture (same `flowChartItems` / `placeFlowItems`) |
| Learned page shape / placement | the same `resolveShape` / `placement` (the sheet is the frame; no page-finding) |
| One Ctrl+Z | takes back strokes + chart together (same `editDrawing`) |
| Straighten | hidden (nothing to square up) |
| Auto-send after idle | **not built** |

Sheet header (quiet): **Paper ▾**, Orientation, Select (the sheet's own Select; no Erase button since 2026-10-05, Sean: "remove the erase button from the wacom menu bar": the pen's first button held rubs out, the box row has Erase, the pen's Erase Tool toggle still works on the sheet; "The sheet's own Erase and Select" below), Undo (Ctrl+Z while the pen is over the pane), Clear, **Bring in: Writing | Page**, and the pen's one status word. Writing takes the brought-in region off the sheet (one Undo brings it back); Page leaves the sheet. **Paper** (`tabletPaper.ts`, remembered in localStorage): Blank, Dot grid, Lines, Grid, Isometric dots, Cornell notes; Small / Medium / Large; White / Cream / Dark (on Dark the default blue and the black preset are lifted, any chosen colour is shown as chosen). The paper is a background canvas under the ink, never ink data: Page includes it, Writing and the flow-chart reader never see it. **The Mac has no paper chooser** (its dotted notebook is the physical paper the camera recognises, `NotebookCapture.swift`), so this list is a sensible standard set pending the Mac's real list. Evidence: `test/sheetBoxPaper.test.ts`, `agents/e2e/wr-sheet/sheet.mjs`. The sheet is kept
when the pane is put away. Known approximation (shared with the camera): a
chart is fitted into the band under the capture, so it can come out a little
smaller than the strokes it was read from.

**Sheets as tabs** (sheet-tabs lane, 2026-10-05; WINDOWS-ONLY: the Mac has no tablet sheet). One slim row of tabs under the
sheet's header (`SheetStrip.tsx`; the header's last row, so `--camera-top` counts it and it never covers the sheet). Each tab
is its own sheet (`tabletSheets.ts`: its own ink, paper, dashed box and stroke undo); Writing / Page, Clear, Erase, Undo and
Paper act on the open one; "+" adds "Sheet N" on the open sheet's paper; double-click renames (Enter keeps, Esc leaves it); the x
closes one, a sheet with ink only on a second click ("Close?"), and the last sheet has no x (Clear wipes it); many tabs shrink,
the open one keeps its width, the row scrolls and "+" stays. The pen cannot reach the row (the whole tablet is the sheet): the
mouse clicks it, and **Pen ▸ Next / Previous Sheet** (Ctrl+Alt+PageDown / PageUp, round the end) are for the other hand.
Switching never moves or resizes the sheet, so the pen's mapping stays. The sheets, their ink and paper and the open tab are
**kept across restarts** in userData `sheets.json` (`main/sheets.ts`: debounced, temp file + rename, written at quit; read
tolerantly by `sheetSet.ts`). Camera mode shows the same row with the live "Camera" tab first and one tab per scanned page ("Scanned pages as
tabs" below). Evidence: `test/sheetSet.test.ts` (add / close / rename / select / next / prev, the file round trip and bad files);
`C:\CLAUDIO\agents\e2e\sheet-tabs\tabs.mjs` (`first`, then restart the instance, then `restart`: 48 checks, among them two sheets
with different ink and paper, Bring in Writing takes the open one, an injected pen-feed stroke lands on the open one, the keys,
rename, close asks, 14 tabs, the strip above the sheet, everything back after a restart; its "camera stub" check now finds the Camera tab and a "+"). Needs Sean's pen: none
of it was written with the real tablet.

**Pen.** Settings ▸ Pen: *Pen side button* = Selects (like ⌘, default) or
Erases (for a pen with no eraser end), honoured on the notes page and the
sheet (`penButtons.ts`). A ⌫ **Erase tool** toggle in the toolbar's pen group
rubs out whole strokes with no hardware button; it is lit and shown on the Pen
chip. While a pen is near, the OS arrow is hidden and an in-app cursor (ring in
the pen colour / arrow-dot over chrome / cross when erasing) follows it; mouse-only
hover events and the press-and-hold context menu are not delivered for the pen;
strokes keep going past the window edge (pointer capture). If the arrow still
shows: Wacom Properties ▸ Mapping ▸ turn off Mouse mode. Not detected
automatically.

## Pen demolition (wr-demolish, 2026-10-04): what the app does now, and what the sections below no longer describe

Sean's verdict on the Grab / overlay / capture-wizard build: a regression. Everything below about the **overlay, sink, Grab, the setup check, the HUD / chip text, the sheet strip and reach hint, Show area, the guard / lease / clip / sweep / panic / containment, Raw Input, WebHID and the trace UI is HISTORY: that code is deleted.** What is left, and verified:

| Piece | Status | Evidence |
|---|---|---|
| The app creates NO window except the main one (no overlay, sink, helper page, hook, ClipCursor) | verified | offscreen instance: `EnumWindows` over the process tree = one visible window (WriteMind), the rest Chromium's hidden internals; CDP targets = 1 page; `GetClipCursor` = the whole screen (`agents/e2e/wr-demolish/windows.ps1`) |
| Wintab DATA backend (reads the tablet, moves nothing) while the Tablet sheet is open and the window is in front; the context is closed otherwise | verified on this machine's real Wacom driver (context opened, closed on capture off, `pen.log` written); real PACKETS not re-verified this round | `WRITEMIND_PEN_NATIVE=1`, `agents/e2e/wr-demolish/native.mjs`; Wintab decoder: `test/pen/wintab*.test.ts` (real CTL-472 trace fixture) |
| **No Wintab (other brands, driver missing): the window's own pen events drive the sheet exactly as before** (wr-wacom-core: the `dom` backend and its `pen:dom` round trip are DELETED; the gate swallows the pen's DOM events ONLY while the native feed is live, never cuts a DOM contact already down, and gives the pen back the moment the feed stops); the sheet says nothing | verified (fake feed) | `test/penGate.test.ts`; `agents/e2e/wacom/core.mjs` ("DOM pen events ignored while the feed is live, honoured when it stops") |
| One quiet status string (`FeedStatus.text`: "Pen: tablet, mapped to sheet" / "Pen: tablet" / "Pen: window pointer" / "Pen: none"; one `status` line per change in `pen.log`), hook `renderer/penWord.ts` (empty unless a tablet is known) | shown quietly in the sheet header (`data-tablet=pen-word`) | `test/penManager.test.ts` |
| Pen popover = pen always draws, pressure, button actions, orientation | built | `e2e/suites/pen`, `tablet` pass |
| `pen.log` (transitions, errors, first 50 raw packets per session) and a small `pen-state.json` (capture on/off, the frame chosen per device) | built | `main/pen/log.ts`, `state.ts` |
| **Orientation: set by the Orientation menu alone, nothing calibrated** (2026-10-05). The device frame follows from Wintab's extents (`frame.ts` `defaultFrame`): the CTL-472 reports PORTRAIT (9499 x 15199), so it is turned a quarter, y read up as Wintab says ({turn 1, flipY}). Checked on the real tablet in Portrait (flipped): 1 2 / 3 4 written in its corners land in the sheet's corners (a frame without the y flip had mirrored them top-to-bottom, which no orientation can undo; the morning's two-touch calibration had chosen that mirrored frame because the tablet lay in portrait). The pen inks from the first touch; the sheet is landscape, the tablet's own shape (1.6); Landscape / Landscape (flipped) / Portrait / Portrait (flipped) turn it. The two-touch calibration and Reset calibration are gone | unit-tested with Sean's 1 2 / 3 4 corners (`wintab.test.ts`); **needs Sean's pen to confirm in Landscape too** | `test/pen/frame.test.ts`, `test/pen/wintab.test.ts`, `test/penManager.test.ts` |
| Pressure by the context's real axis (WTInfo `DVC_NPRESSURE`, 32767 here; the real trace peaks at 20521 = 0.63), contact with a small hysteresis (tip button, or 1% down / 0.4% up), samples batched at 8 ms | built | `test/pen/wintab.test.ts` |
| **System mapping** (`main/pen/mapping.ts`): a second Wintab context (CXO_SYSTEM, lcSysOrg/Ext = the sheet in PHYSICAL pixels via `screen.dipToScreenRect`) opened only while the pen is in range over a visible, unturned sheet with the window in front, VERIFIED within ~2 s of motion (the polled system cursor must stay inside the sheet and track the pen), then watched; any doubt / pen out of range / blur / sheet closed / quit / error => WTClose at once, "refused" remembered per device (Retry in the Pen popover forgets it); no-op without koffi / wintab32 | **unit-tested with a FAKE native layer and a FAKE cursor only (26 tests); never run against a moving pen. Whether Wacom's driver honours it on the CTL-472 is UNKNOWN** | `test/pen/mapping.test.ts`, `test/penManager.test.ts` |
| Mouse drags a dashed box on the sheet (selects a section to bring in), pen never a mouse | built (wr-sheet-ux) | `test/sheetBoxPaper.test.ts`, `agents/e2e/wr-sheet/sheet.mjs` |

Files now: `main/pen/{backendCore,batcher,fake,frame,ipc,log,manager,mapping,state,subsystem,types,win32,winmsg,wintab,wintabBackend,wintabNative}.ts`; renderer `penFeed, usePenFeed, penGate, penGateBoot, penCursor, penButtons, penActions, penLive, penSettings, penWord, PenMenu, OrientationSelect, orientation, TabletSurface, tabletPage, tabletCapture, tabletFocus`; shared `pen, penEvents, orientation`. `WintabSystemBackend` is the system context's carrier, started only by `mapping.ts` (no guard process: contexts are closed by `closeAllWintab` on before-quit / will-quit / window closed / exit / uncaughtException / render-process-gone and recovered from the journal after a hard kill).

### Pen position source: WebHID spike (wspike-webhid, 2026-10-03; nothing in the app changed)

| Piece | Status |
|---|---|
| Tablet-native pen data without a native module (`navigator.hid` in a hidden window), details in `docs/spikes/wacom-webhid.md` | **spike: transport verified on the Wacom, pen strokes not.** With three session hooks (VID 0x056A) `getDevices`/`requestDevice` list the tablet as ONE `HIDDevice` ("CTL-472"; collections Pointer, vendor `0xff00:0xa` with report 220, Digitizer `0xd:0x1` with the standard pen report 213), `open()` **succeeds with the Wacom service/driver running**, and the listener receives real reports (the device's 5 s vendor heartbeat) in a visible, `show:false`, offscreen and offscreen + default-throttled window; **re-run 2026-10-04**: the same on a private session partition (`pen-hid`, hidden window, the three hooks on that session only, as the app helper would host it): list, `requestDevice`, `open()` ok, heartbeats delivered. NOT verified (needs a moving pen): that report 213 streams position/pressure/buttons in Pen mode + Ink. |
| Decoder + `PenSample` normaliser + `WebHidPenSource` + trace recorder/analyser | drafted and tested (46 vitest, outside the repo, `C:\CLAUDIO\spikes\webhid-spike\`; includes the REAL CTL-472 descriptor as a fixture and synthetic reports built from it; primary-report selection so the vendor heartbeat never becomes a sample) |
| Settle it | `powershell -NoProfile -ExecutionPolicy Bypass -File C:\CLAUDIO\spikes\webhid-spike\tools\live.ps1 -Seconds 25` while someone hovers, draws and presses both side buttons: says whether 213 streams, its rate and ranges |

### Pen position source: WebHID backend, in the repo (wimpl-b-webhid, 2026-10-04; design `spikes/DESIGN-pen-capture.md` 4.4)

| Piece | Status |
|---|---|
| `main/pen/webhid/{protocol,primary,hidSource,hostPage,permissions,electronHost,webhidBackend}.ts`, `preload/penHid.ts`, `helpers/pen-hid.html` | **built, unit-tested and exercised in real Electron; wired into nothing yet** (D's `registry.ts` / `main.ts` create it with `createWebHidBackend({session: session.fromPartition("pen-hid"), preload: out/preload/pen-hid.cjs, page: out/helpers/pen-hid.html, log})`). The spike's source moved onto the repo's one decoder; one primary report per device (213 on the Wacom; the vendor report 220 is traced, not decoded, except as a last resort when the primary stays silent while it streams more than 3 reports in 2 s); physical extents for the aspect (15200 x 9500); hot-plug; a refused `open()` is a stated reason, not a crash; a hidden window that outlives the notes window closes itself; stop() destroys the window and puts the session back. |
| Evidence: `npx vitest run apps/desktop/test/pen/webhid` | 96 tests (`webhidPrimary`, `webhidSource`, `webhidBackend`, `webhidHost`) on the REAL CTL-472 collection metadata (`test/fixtures/pen/wacom-ctl472-real.json`) with synthetic reports, the page logic wired to the backend over a fake `navigator.hid` and a manual clock |
| Evidence: `powershell -NoProfile -File C:\CLAUDIO\agents\e2e\webhid\run.ps1 [-Repo]` | real Electron, real window / session / preload bridge / IPC, a PRETEND device planted in the page: 19 PASS lines (41 samples through the bridge, pressure / tilt / barrel decoded, exactly one leave sample, raw hex in the trace, counters over the status channel, window destroyed by stop(), orphan watchdog). `-Repo` runs it against `apps\desktop\out` (the locked build produces `pen-hid.cjs`, `pen-hid.js`, `pen-hid.html`) |
| Evidence: `... run.ps1 -Live` (2026-10-04) | the SAME shipped code on the REAL tablet through real `navigator.hid`, read-only (list, open, close, no output report): `getDevices` lists the CTL-472, `pen-hid` permission hooks allowed VID 056A and denied the other vendors' devices (2dc8, 0b05, 0951), `open()` ok with the driver running, layout compiled from the live descriptor (primary `d:1 #213`, fields at the expected bit offsets), the 5 s vendor heartbeat arrived and was NOT turned into a sample. **Still NOT verified: any real stroke** (nobody moved the pen). |

### Pen position source: Raw Input + HID spike (wspike-rawinput, 2026-10-03; nothing in the app changed)

| Piece | Status |
|---|---|
| Tablet-native pen data via `RegisterRawInputDevices(RIDEV_INPUTSINK)` + `WM_INPUT` + hid.dll, details in `docs/spikes/wacom-rawinput.md` | **spike only; real Wacom caps READ (tablet came back 21:25) but pen streaming UNVERIFIED (no moving pen).** Real: Col03 pen (report 209) / Col04 digitizer (report 213) / Col02 vendor / Col01 pointer are listed; pen X/Y are **tablet-normalised 0..32767** over a 15200 x 9500 area (not screen pixels), pressure 0..2047, tilt +-9000 (0.01 deg), tip/barrel/secondary barrel/invert/eraser/in-range bits; `RegisterRawInputDevices(INPUTSINK)` ok; the vendor collection delivered real `WM_INPUT` (idle heartbeat) with the app unfocused. Verified on the real OS: caps + bit-layout probe from Windows' own HID parser (cross-checked against `HidP_Get/SetUsageValue` on 13 devices), `WM_INPUT` delivery to a hidden window with the app unfocused by BOTH `hookWindowMessage` and a koffi message-only window inside Electron 44, a real RAWHID pen stream (Windows' synthesized `Microsoft HID RID\000D_0002\n` pen, fed by an injected hover pen) decoded to `PenSample`, hard-kill cleanup. |
| What Windows' own pen raw device gives | pen-vs-mouse, in-range, pressure, tilt, switches, hover independent of focus, but X/Y are **screen pixels**, not tablet counts (`backend: "rawinput-synth"`). |
| `RIDEV_NOLEGACY` to stop the pen moving the cursor | **does not work**: rejected for the pen usage (error 87); accepted for the mouse usage but the cursor still follows mouse and pen. Raw Input only observes. |
| Pen-vs-mouse by device node (`onMouseSource`: `RAWMOUSE` device name has `VID_056A`) | built, verified with injected input only; would replace the `WH_MOUSE_LL` signature test (which does classify Windows' synthetic pen as `pen`, so Sean's real pen probably arrives as plain mouse input from the Wacom pointer collection) |
| Decoder + layout probe + `PenSample` mapper + 8 ms batcher + trace recorder/analyser | drafted and tested (37 vitest, outside the repo, `C:\CLAUDIO\spikes\rawinput-spike\`; 11 of them on the REAL Wacom layout from `test/fixtures/wacom-ctl472.json`, the Windows-pen tests use Windows' real caps). Col03/Col04 are one pen exposed twice: `PrimaryPicker` keeps one; the vendor Col02 (raw counts 15200 x 9500, idle heartbeat) is traced but not decoded by default |
| To settle streaming | someone moves the pen: `powershell -NoProfile -ExecutionPolicy Bypass -File C:\CLAUDIO\spikes\rawinput-spike\tools\live.ps1 -Seconds 25` (nothing hooked or grabbed). Do Col03/Col04 report while Ink is on? |

### No full screen, no Pad mode (decision 2026-10-03)

Sean never asked for a full-screen mode and it kept putting the display in full screen by itself (some of
that was test agents), so **Pad mode was removed completely** and nothing in the app can enter full screen:

| Piece | Status |
|---|---|
| `main/pad.ts`, `PadMode.tsx`, `padGeometry.ts` (the geometry the sheet and Grab still need moved into `tabletPage.ts`), the pad strip + CSS, the **Pad** button, Input Devices ▸ Tablet Pad (Full Screen), Ctrl+Alt+T (`tabletPad` in `shared/commands.ts`), the pad IPC (`pad:enter/exit/state`, `e2e:leaveFullScreen`), `pad.test.ts` | deleted |
| View ▸ Toggle Full Screen (Electron role) | removed from the menu (`menu.test.ts` asserts no full-screen role/label/id in any menu, dev or not) |
| the main window | `fullscreenable: false` (no F11 / Win+Shift+Enter / title-bar button / Window API); belt and braces: an `enter-full-screen` handler puts it back; the page's Fullscreen API is refused by the permission handler |
| persisted flags | none ever existed for the pad (`writemind.pen`/orientation/grab keys do not mention it); the ExpressKey suggestion that said "Pad" now says "Send writing" |
| guard | `sheetGeometry.test.ts` scans every `apps/desktop/src` file and fails on `setFullScreen(true`, kiosk, simple full screen, `togglefullscreen`, `requestFullscreen`, `PadMode`, `tabletPad`, `pad:enter` |

What the pad was for is done by the **sheet pane** (the tablet sheet in the video pane), **Grab** (the whole
tablet is the sheet with the notes still visible) and the driver's own **Tablet area** (below).

**Grab overlay vs Windows' idea of "full screen"** (decision 2026-10-03). A transparent top-most window that
EXACTLY covers a monitor can be treated as a full-screen app (taskbar hidden or flickering, notifications and
game bar suppressed). The overlay is therefore configured so that it cannot be one: (1) bounds are the whole display
minus a 2 DIP strip at the bottom (`shared/grab.ts overlayBounds`): never the monitor's exact rectangle (see the known limit about the taskbar band below);
the page maps the pen with the DISPLAY rectangle main reports, so the missing strip moves nothing; (2) `type: "toolbar"`
(WS_EX_TOOLWINDOW), `skipTaskbar`, `focusable: false` (WS_EX_NOACTIVATE: it never becomes the foreground
window, which is what the shell's full-screen / notification-state checks look at), `fullscreenable: false`;
(3) always-on-top level `floating` (was `screen-saver`; on Windows both are plain HWND_TOPMOST, on a Mac
`screen-saver` sits above the menu bar and Dock, which looks like full screen); (4) shown inactive, hidden
whenever the notes window is not in front. Verified by `agents/e2e/wacom/grab-fullscreen.mjs` (reads the real
Win32 styles and `SHQueryUserNotificationState` while the overlay is up).

**Known limit (measured 2026-10-03, display 1920x1200 with a 30 px taskbar, `WindowFromPoint`):** the taskbar band
is Explorer's and sits above every other top-most window, so the overlay can cover it on paper but never receives
the pen there: a pen in the bottom 30 px (2.5 %) of the DISPLAY, i.e. the bottom 2.5 % of the tablet, clicks the
taskbar instead of drawing (a stroke already begun keeps going, pointer capture). Nothing the app can do changes
that on Windows. Ways round it: auto-hide the taskbar, or give the driver a Tablet area ("Portion of screen")
that stops above it. The e2e corner strokes therefore start just above the work area's bottom edge.

**Tablet area** (for people who keep the notes visible): **Area** on the sheet pane
and *Tablet area* inside the Pen popover give the sheet's rectangle in PHYSICAL
pixels of its display (window content origin and display scale from the main
process, `getContentBounds` / `getDisplayMatching`, so it is right at 150% and on a
second monitor), say that the driver controls the mapping, and give the recipe
(Wacom Tablet Properties ▸ Mapping ▸ Screen Area ▸ Portion of screen ▸ Click to
define ▸ click the two corners). **Show area** flashes a red frame with "1" and
"2" corner tags on the sheet. Measure again after moving or resizing the window.

Not built: auto-send, a side-button double-click exit, following the sheet when the
window moves to a monitor of another shape (the sheet keeps the shape it was
created with; `localStorage writemind.sheetAspect` forces one, which the older tablet
e2e uses to get a tall sheet in the pane).

E2E (Wacom lane, run on an offscreen instance: `WM_PORT=9410 node C:\CLAUDIO\agents\e2e\wacom\run-all.mjs`; one script:
`node tablet-flow.mjs`): `tablet-flow.mjs` (write, box, chart, page, undo, erase), `tablet-cursor.mjs`, `tablet-pen.mjs`,
`no-fullscreen.mjs`, `grab-fullscreen.mjs` (see "No full screen"). The older `C:\CLAUDIO\e2e\tablet\`, `pad\`, `grab\`,
`buttons\` folders are superseded (port 9999/9998/9996/9997, hard-coded profiles); `camera-flow-t.mjs`, `camera-warp-t.mjs`,
`cells-t.mjs` there belong to the camera / editor lanes and were not ported.

### Tablet orientation and Grab (port-only, 2026-10-03)

**Tablet orientation** (the Mac's `cameraRotation`, turned into Wacom's wording): a dropdown in the sheet
pane header and the Pen popover, remembered (`localStorage writemind.orientation`): *Match
screen* (default = Landscape 0° on a landscape display), *Landscape (0°)*, *Portrait (90° clockwise)*,
*Landscape flipped (180°)*, *Portrait flipped (270°)*. It says how the tablet is physically turned. The sheet
takes the screen's shape turned by it (landscape on this machine's 1920x1200 display by default; the old
default was the same shape but nothing said so and nothing could change it). In **Grab** the
pen's place on the display is turned back into its place on the sheet (`shared/orientation.ts`), so a tablet
turned on its side still writes upright; the pen ring is drawn on the sheet (the OS arrow is hidden). In the
**pane** the pen is simply a pointer over the sheet (nothing is mapped), so there the orientation only gives
the sheet its shape. Strokes are fractions of the sheet: changing the orientation never moves or destroys
ink, it only changes the page shape the next capture is made on; **Rotate ink** turns the ink a quarter turn
clockwise when that is wanted. Captures need no turning because the sheet is the tablet as the person sees it.
The camera keeps its own rotate buttons (not changed).

**Grab** (`main/grab.ts`, `GrabOverlay.tsx`, `useGrabHost.ts`, `shared/grab.ts`): with the Tablet source
showing and the window in front, the whole tablet is the sheet rectangle, with no full screen. The driver maps
tablet to screen and an app cannot change that, so a transparent, frameless, always-on-top, non-activating
(never takes the keyboard) window covers the display, receives the pen wherever it is, maps it
(`(x - display.x) / display.width` in physical pixels, first and last pixel = the tablet's edges, 100% and 150%)
through the orientation onto the sheet rectangle, draws live ink and a ring there, and ships every change
(`SheetOp`: mark/add/replace/removeAt/undo/redo, plus a full state with history at start) to the notes window,
which owns the one sheet: Send Writing / Page / Box / Undo / Clear / Erase, pen-button taps and ExpressKeys all
work as in the pane. Notes stay visible and the sheet pane is where the ink appears.

*What Windows allows (measured on Windows 10 19045 with synthetic pen via InjectSyntheticPointerInput and
synthetic mouse, `C:\CLAUDIO\e2e\grab\spike`):*
- A transparent overlay with alpha >= 1/255 is hit-testable; the pen reaches it as `pointerType: pen` with
  correct position and pressure, over our window or the bare desktop. A mouse click reaches it as `mouse`.
- It cannot be hit-testable for the pen alone. `setIgnoreMouseEvents(true, {forward:true})` makes it
  click-through: mouse clicks go to the window underneath (measured: pointerdown + click arrive in the notes
  window) and the overlay still gets mouse MOVES (typed `mouse`, from a global low-level hook), but a pen then
  goes to whatever is underneath (hover events over our window come late, contact arrives), and over another
  app the overlay hears nothing. Without `forward` it hears nothing at all.
- So there are two modes (`shared/grab.ts`): **pen** (hit-testable) and **mouse** (click-through).
- **Who is it? A global hook** (`main/penHook.ts`, koffi prebuilt N-API, WH_MOUSE_LL on the main thread, always
  calls the next hook): Windows tags mouse input promoted from a pen with 0xFF515700 in dwExtraInfo (+0x80 for
  touch). Pen-signed event anywhere on the screen = PEN mode at once; unsigned = MOUSE mode at once, switched
  inside the hook so the very first click goes through (measured: a plain click with no prior move reached the
  window under the cursor). A pen's echo (250 ms) and a stroke under way hold the mode. Needed because the
  window cannot hear the pen elsewhere on the desktop (the first Grab build relied on that and only worked
  full screen). Fallbacks when the hook cannot load (HUD says "no hook"): a pen seen over the notes window, the
  cursor moving with no mouse move behind it, the first real mouse event on the overlay, and the 20 s
  watchdog (to mouse mode, never under a stroke). "Pen only while grabbed" pins pen mode.
- **HUD**: the pane header chip reads Grab: pen / Grab: mouse / Grab: off (+ "no hook"); the Pen popover shows
  the last classified input, hook installed yes/no with the error, counts of pen/mouse/touch events,
  overlay bounds and display, and **Copy grab diagnostics**. The last 200 transitions are in
  `grab.log` in the app's userData folder.
- **Verified here without a Wacom** (`grab3.mjs`): SendInput-style `mouse_event` with dwExtraInfo 0xFF515700
  stands in for pen-promoted input and 0 for a real mouse, window 900x700 NOT full screen: signed moves over
  the bare desktop -> PEN; a synthetic pen stroke there lands in the sheet at the proportional place with
  pressure; a plain click -> MOUSE and reaches the window; moves during a stroke do not flip it.
- **NOT verifiable without hardware:** that a real Wacom pen (Windows Ink) really produces LL-hook mouse
  events carrying the signature while the cursor is over a window that handles pointer messages. The
  synthetic pen pointer (InjectSyntheticPointerInput) produces neither cursor motion nor hook events, so it
  cannot test this. If the HUD on the user's machine shows pen counts staying 0 while the pen moves (and
  mouse counts rising), the driver sends unsigned mouse input (Windows Ink off / Mouse mode) and nothing
  can tell it from a mouse: turn Windows Ink on and Mouse mode off in Wacom Tablet Properties.
- ClipCursor / Wintab: not used. Confining the cursor would not change the driver's mapping, and Wintab
  without CXO_SYSTEM would need a native module for no gain over the overlay.
  **Measured 2026-10-03 (spike `docs/spikes/wacom-containment.md`, synthetic pen, real pen unverified):**
  `ClipCursor` clamps every mouse-class move (SendInput, mouse_event, SetCursorPos, relative) but NOT a pen
  pointer (WM_POINTER arrives at the unclamped place, the cursor follows the hover unclamped), so it is no fix
  for stray taps in Pen mode + Ink. A swallowing `WH_MOUSE_LL` is no fix either (the window still gets the pen as
  WM_POINTER; a pointer-handling window gets no mouse event from the pen at all, which is why the hook never saw
  Sean's pen). `RegisterPointerInputTarget(PT_PEN)` is denied without UIAccess (error 5).
  `RegisterPointerDeviceNotifications` works unelevated and gives a focus-independent pen in/out-of-range signal.
  A clip outlives its process (kill -9 and normal exit both leave it): a draft opt-in for Mouse-mode tablets with a
  detached guard process (stdin EOF ~14 ms, lease 800 ms, startup sweep) is in `C:\CLAUDIO\spikes\contain-spike\`
  (`clip.ts`, 38 vitest tests, `guard-proof.mjs`); NOT wired into the app. 20 s check for the real pen:
  `C:\CLAUDIO\spikes\wspike-contain\probe.cmd`.
  **Wintab, measured 2026-10-03 (spike `docs/spikes/wacom-wintab.md`, no pen movement, so no packet was ever seen;
  tablet was in Code 10 at first, healthy again at the 21:23 re-check with the same extents):** the earlier "Wintab needs a native module" is wrong - koffi loads `wintab32.dll` in Electron
  main; DATA and SYSTEM contexts (with a screen sub-rectangle in `lcSysOrg/Ext`, which the driver stores as given)
  open and close without disturbing the mouse; a hidden BrowserWindow can own the context and receive `WT_*`
  messages through `hookWindowMessage`. A tablet-native pen source independent of focus and of the screen mapping
  is therefore buildable (draft decoder, normaliser to `PenSample`, service and trace recorder in
  `C:\CLAUDIO\spikes\wintab-spike\`, 54 tests); whether packets flow with another window in front and whether a
  SYSTEM context re-maps the cursor needs the real pen: `capture.cmd --seconds 60 --fg` and `capture.cmd --system
  --rect x,y,w,h` in that folder. A killed process leaves its Wintab context open in the driver (limit 32): the
  draft journals its handle and closes only a dead-pid-named one at next start. NOT wired into the app yet.

Nothing is trapped: the overlay is hidden unless the notes window is in front, focusable:false, and is destroyed
on Release, Esc, Ctrl+Alt+G (global while grabbed), the notes window closing / reloading / its renderer dying,
the overlay's own page dying (`Page.crash` tested) or going silent (heartbeat 6 s, tested), and quit.
It follows the window to another display and covers that display except a 2 DIP strip at the bottom (never the
exact monitor: see "No full screen" above; a second `setBounds` because Windows trimmed the first during testing). The sheet rectangle is the pane's sheet, so a small pane means
small writing on the screen (the tablet is still all of it); make the pane large, or give the driver the Tablet area.

For no app at all the Wacom driver can do the same: Wacom Tablet Properties ▸ Mapping ▸ Screen Area ▸
Portion of screen (Tablet area helper above). Set nothing else: Pen mode (not Mouse mode), Windows Ink on,
Orientation in the driver left alone (WriteMind's own dropdown does the turning).

E2E: `C:\CLAUDIO\agents\e2e\wacom\` (`grab-overlay.mjs` corners/strokes/sidecar, `grab-hook.mjs` hook-based modes with a small
window, `grab-modes.mjs` modes, exits, four orientations; `inject.ps1` is the synthetic pen/mouse injector and MOVES THE REAL
CURSOR, so `run-all.mjs` runs these three only with `--real-input`). `lib.mjs` exports `noAutoGrab()` for the page-level tablet
scripts (Grab would otherwise keep their synthetic pen away from the pane) and `target()` for the overlay page (`grab=1`).

## Pen buttons and ExpressKeys (Windows pass, 2026-10-03)

The Mac's mouse + modifier idioms, on a Wacom pen and tablet. See
`docs/KEYS.md` (Pen buttons and ExpressKeys) for the table.

| Mac | Pen | Status |
|---|---|---|
| ⌘-drag marquee | upper side button held while the pen touches (default), or the ⬚ Select tool, or Ctrl | works (e2e `pen/03`) |
| ⇧ extends the selection | assignable "Add to selection" hold; Shift | works |
| drag moves, handles scale/turn | upper button held inside the selection drags it; Select tool then drag on the object; pen-sized handles | works (e2e `pen/03`) |
| ⌫ deletes the held items | handle ✕, "Delete selection" double tap / ExpressKey Ctrl+Alt+9 | works |
| Esc clears | "Clear selection" double tap / ExpressKey Ctrl+Alt+0 | works |
| scroll the page | assignable "Pan the page" hold, Tip + Alt, a finger | works |
| right click | "Right-click" double tap | works |
| ⌘Z / ⇧⌘Z | lower / upper side button DOUBLE TAP (default), ExpressKeys | works (e2e `pen/03`, `tablet/02`) |
| eraser | lower side button held while the pen touches (default), eraser end, ⌫ tool | works (e2e `pen/03`, `tablet/02`) |
| colour, width | Next/Previous colour, Wider/Thinner (double taps and keys) | works |

**Two jobs per side button (Sean, 2026-10-05):** lower = hold Erase strokes /
double-tap Undo, upper = hold Select (inside the selection: move it) /
double-tap Redo; a hold works only while the pen touches, a single tap or a
press held in the air does nothing, no context menu over the page or the
sheet while a button is in use; the same on the page, in ink cells (Canvas's
one engine) and on the tablet sheet (DOM pen and the Wintab feed's
synthesised events). Pure model + state machine `penButtons.ts`
(`tapStep` with injected time, `migrateButtons`, `buttonRows`), runtime
`penActions.ts`, popover `PenMenu.tsx` (`data-pen=btn-<slot>` = hold,
`dbl-<slot>` = double tap). Evidence: `apps/desktop/test/penButtons.test.ts`,
`penEvents.test.ts`, `penFeed.test.ts`; e2e `e2e/suites/pen/03-buttons-and-expresskeys.mjs`
(54 checks: page, Windows-Ink-style barrel at contact, driver right-click
echo, no menu, migration) and `e2e/suites/tablet/02-buttons-on-the-sheet.mjs`
(17 checks: DOM pen and the inject feed).

Not verified on hardware: everything was driven with synthetic pen
`PointerEvent`s, CDP pen / mouse input and the inject backend, not a real
Wacom. How Windows Ink delivers a side button pressed in the AIR to Chromium
is unknown here (a pen event with the bit, nothing at all, or the driver's
mouse click — all three are handled); with Wintab on the sheet it is a
button bit in the packet. A driver that sends both side buttons as the lower
one cannot give them different jobs.

## Maths in two dimensions (Windows pass, 2026-10-03)

Evidence: `C:\CLAUDIO\agents\e2e\maths\math2d.mjs` (offscreen test instance,
real CDP mouse input; 32 PASS), `gallery.mjs` (every Calculus / Algebra
template, as inline and as a block, screenshots LOOKED at), unit tests
`packages/core/test/{math,mathml}.test.ts`.

| Feature | Status | Notes |
|---|---|---|
| `MathView` stacked fraction, radical with roof, ∑ ∏ with limits above and below, ∫ with bounds on the sign, ∬ ∭ ∮, limit with its approach under, matrix between growing brackets, binomial, ∂ / d fractions, ∇ operators | works | MathML via `mathml.ts` (`mfrac msqrt munderover msubsup mtable`); a stacked fraction under a power is bracketed (the Swift left it bare) |
| Inline maths in a line / block maths centred | works (inline CHANGED by Mathslane-fix2, below) | block is MathML display style; inline was MathML too, and is now the Mac's linear run |
| Line height not disturbed by tall inline maths; sits on the text baseline | REPLACED (Mathslane-fix2) | the negative-margin inline-block did not keep the lines apart, it made stacked inline maths OVERLAP its neighbours by up to 12px and take their clicks; inline maths is now a linear run of text, which cannot be taller than its line (below) |
| Click on typeset maths puts the source back; typeset returns when the caret leaves | works | left half of an inline span → start of its source, right half → end; a block → end of its first source line |
| Selection over typeset runs | works | a selection that covers a span keeps it typeset, one that ends inside shows its source; real mouse drag checked |
| Copy of typeset maths copies the source | works | CodeMirror copies the document slice (checked with a copy event) |
| Palette preview uses the same renderer | works | `mathElement(…, { display: "block" })`; the palette itself was rebuilt as the Mac's one-pane menu (below) |
| Palette popover reaches across the pane divider (video pane open) | fixed | `.top-bar` z-index 5 → 9 (it was under the divider's 8, so "Insert" was unclickable) |
| WL parser: `-x^2` is -(x^2) | fixed (differs from the Swift, which gave (-x)^2 and typeset the Gaussian wrong) | `expression.ts` |
| Floor / Ceiling / Norm in the linear form; CubeRoot / Surd | fixed / added | the Swift printed `⌊⌋ x` |
| Every WLExpression / template test of `MathTests.swift` | transcribed, passing | `math.test.ts`; the 130 palette templates match the Swift ids exactly |
| Dark and light | works | `currentColor`; checked by emulating both schemes |

## The maths palette and the maths tour (m2-math-tour, 2026-10-03)

Source of truth: `WriteMind/Views/MathMenu.swift` (the popover), `Math/MathTemplates.swift`, `Editor/MarkdownFormatting.swift`
`insertMath`, `Editor/MarkdownBlocks.swift` (what a fence is). Evidence: e2e in `C:\CLAUDIO\agents\e2e\m2\` (test port 9417; `palette.mjs`
52 checks, `tour.mjs` 32, `perf.mjs` 5, `rendered.mjs` 4, `print.mjs` 3, plus `..\maths\math2d.mjs` 32 re-run against the new palette; shots
`agents\shots\m2-*.png` were LOOKED at, dark and light), unit tests `packages/core/test/{mathTemplatesParity,mathml}.test.ts`.

| Feature | Status | Notes |
|---|---|---|
| Palette = the Mac's `MathMenu`: ONE scrolled pane of all six groups with a pinned header each (no tabs), the first shape (Definite integral) picked on opening, a field per slot (suggestion as placeholder and value), the editable Wolfram Language line, a 22pt typeset preview, **On its own line** (ticked), Insert | rebuilt (was tabs + two buttons) | `MathPalette.tsx`; the popover starts afresh each opening, as the Mac's does |
| "The fields drive the WL until the WL is edited, then what is in it is inserted"; a later slot edit drives it again | same | |
| Palette data = the Swift's, field for field: 130 templates, group / name / glyph / form / slot labels and suggestions / order | guarded | `mathTemplatesParity.test.ts` reads the reference `MathTemplates.swift` and compares; fails if a `git pull macos` moves it |
| Toolbar button reads ƒ(x), tooltip "Integrals, sums, derivatives — written as Wolfram Language" | fixed (was ∑) | the Mac's SF Symbol is `function` |
| **Keyboard only**: Ctrl+Shift+M / Insert ▸ Maths… opens (also with the Maths section put away) on the picked shape; arrows / PageUp / PageDown / Home / End pick; Tab walks slots, WL, tick, Insert and wraps; Enter inserts as ticked, Ctrl+Enter the other way; Esc closes and returns the keyboard to the note; Enter during IME composition is the IME's | built (port-only keys; the Mac popover is mouse-first) | `docs/KEYS.md`; `palette.mjs` drives every key with real CDP key events |
| Insert replaces the selection; a block mid-line breaks the line either side; one Ctrl+Z takes an insert back (inline and block), Ctrl+Y returns it | works | `insertMath` (same as `MarkdownFormatting.insertMath`) |
| Unparseable input: the preview shows it as typed (mono, secondary — the Mac's `MathView` fallback) with a small "Not an expression yet: it stays as typed" line; Insert still puts it in | works | in the note a half-typed `wl:` span / fence stays text and typesets as soon as it parses and the caret has left |
| A `wl` fence is any line that STARTS with three backticks after its indentation (the Mac's rule), so a ```wl block inside a list item is typeset; the language is the rest of the line; any line starting with three backticks closes it. `~~~` is not a fence (the Mac has none) | fixed (only column 0 was typeset) | `math.ts` |
| Maths in headings, bullets, nested bullets, numbered, to-dos, quotes, folded sections (gone when folded, back on unfold), on the rendered page; line height unchanged by it | works | `tour.mjs`, `rendered.mjs` |
| Japanese text around inline and block maths: same line height as a plain Japanese line; click targets right; typing CJK beside the source | works | `tour.mjs`; **a real IME was not driven** (CDP `insertText` only; keyCode 229 Enter checked) |
| Copy and paste of maths between notes: the source arrives intact and typesets | works | the clipboard is the markdown (no MathML flavour) |
| 200+ equations in a note: set 50-60 ms, a selection move 1-3 ms (1500 equations: 3 ms), typing and scrolling at frame rate, 42 widgets in the DOM at once | works | `perf.mjs` (`N=500` for 1500) |
| Pathological sources (3000 nested brackets, a 20000-term sum) stay text instead of throwing out of the editor's decorations (a 20000-term sum froze the page for 27 s before the 2000-character cap) | fixed | `mathmlFor`: try/catch, 2000-character cap, depth 400 |
| Handwritten algebra now typesets: a lone `=`, `x²` / `x⁻¹` / `x¹⁰` (raised characters), `≤ ≥ ≠ × · ÷ −` typed or read are understood by the WL reader (the OCR path emits exactly `y = 2x + 1`, which the Mac shows as source) | built, differs from the Swift | `expression.ts`; unit-tested |
| Evaluation (Wolfram) | the Mac has evaluation cells since 0bf52b5 (after the port's snapshot); ported, see "Evaluation cells" at the end | `eval wl` is an evaluation cell; `wl` alone is still maths |
| Export ▸ PDF with maths | prints the window (Chromium draws the MathML as vector text); an equation wider than the page is a scroll box on screen and is CUT OFF in print | see TODO ▸ Export PDF and maths; `print.mjs` measures it under print media (`Page.printToPDF` is not in Electron's CDP and the Export handler opens a native save dialog even under `WRITEMIND_E2E`) |
| Inline maths: the caret just after it (right after an insert) shows the source until it moves on or you type a space | as designed by the first pass (edges count as inside, so arrows can enter) | |
| The sidebar row's second line and a tab title show a `wl:` span's raw source | not changed | editor lane's titles |

**Re-run on the final tree (m2-math-tour, resumed after a usage limit, 2026-10-03, test port 9420):** `m2/palette.mjs` 52/52, `m2/tour.mjs` 32/32 (the first run after a fresh start failed one click check, then 3 of 3 clean runs: a click raced the first layout of a just-opened note), `perf.mjs` 5, `rendered.mjs` 4, `print.mjs` 3, repo `e2e/suites/maths/01-07` all pass (19/21/38/9/16/21/19), `maths/math2d.mjs` 31/31 after its two inline-2D checks (MathML inside a line, an inline `msqrt` baseline) were rewritten for the linear inline run of Mathslane-fix2. The palette was looked at again (dark): groups, slot fields, WL line, typeset preview, On its own line, Insert. Nothing in the maths lane needed a code change on this pass.

## Maths, after the independent check (Mathslane-fix1, 2026-10-03)

A verifier (Mathslane-v1) drove the maths lane's build and found four problems. Evidence: repo e2e suite
`e2e/suites/maths/` (`02-wide-equations.mjs` 20 checks, `03-palette-keeps-the-keyboard.mjs` 38, `04-products-keep-their-sign.mjs` 9;
run by hand with `WM_PORT=<port> node e2e/suites/maths/0N-….mjs` against an `-E2E` test instance), unit tests
`packages/core/test/mathml.test.ts` (a new block on products), shots in `e2e/.results/manual/`.

| What | Status | Notes |
|---|---|---|
| An equation wider than the pane bent the WHOLE note: `.cm-content` is a flex item of the scroller and may not shrink below its min-content width, which for unbreakable maths is all of it, so every paragraph wrapped at the equation's width and the editor scrolled sideways (a 14-term block made the content 795px in a 640px pane; a 30-term inline one 2053px) | fixed (root cause) | `.cm-content { min-width: 0 }`, installed by `mathRendering` (`math.ts`); the `max-width:100%` / `overflow-x:auto` on the block then do what they always said. The same checks fail (24 of them) with the rule undone, in the page |
| An inline equation wider than its line | fixed, then REPLACED by Mathslane-fix2 (an inline equation is text and wraps; no scroll box) | a ViewPlugin measures each typeset inline equation against the line it is in (read phase) and puts `wm-math-wide` on the ones that do not fit: a scroll box of its own, `max-width: 100%`, thin scrollbar. Only those leave the text's baseline (a scroll box takes its baseline from its bottom edge, so it sits at the text's middle and does not overlap its neighbours); the class follows the pane's width both ways (checked 2200 → 900 px windows) and the caret inside the source and out again. The Mac wraps inline maths as text; MathML cannot break, so a scroll box is the nearest thing |
| `3 × 4 = 12` was drawn `3 4 = 12` (× and · were read as `*`, which is invisible times) | fixed | the parser keeps the sign as written (`written` on the product, port-only), the MathML draws it: `3 × 4`, `a · b`. A number that follows any factor now has a visible dot even when no sign was written: `2*3` is `2·3`, `x*2` is `x·2` (the Mac draws `2 3`, which reads as 23; changed on purpose, `2x`, `2(x + 1)`, `a b` stay side by side). The old test that asserted `3 × 4` equals `3 * 4` was the defect and was changed |
| The palette could not be driven from the keyboard in the verifier's tree: the page's focus-return (`focusReturn.ts`, after a menu command or a click on the bar) crossed the palette's own focus a millisecond after it | already fixed in the tree by the time of this pass (`.math-pop` in `POPUPS`); re-verified with the verifier's scripts and made a regression test | `03-palette-keeps-the-keyboard.mjs` opens it three ways (Ctrl+Shift+M, a mouse click on ƒ(x), Insert ▸ Maths…) and watches the focus for 1.5 s; with a steal simulated in the page it fails 24 checks |
| A click on a bare part of the palette (its heading) handed the keyboard to the note and Esc then closed nothing | fixed (found while re-verifying) | the popover is `tabIndex={-1}` (so the click stays inside it) and hands the keyboard to the picked shape; `MathPalette.tsx` |

## Maths, after the second independent check (Mathslane-fix2, 2026-10-03)

A second verifier (Mathslane-v2-0) found four problems (one high, three medium). Evidence: repo e2e suite
`e2e/suites/maths/` (`05-inline-maths-is-text.mjs` 16 checks, `06-text-after-a-block-stays-visible.mjs` 21,
`07-brackets-and-powers.mjs` 19; `01`-`04` re-run and updated: 19 / 21 / 38 / 9), unit tests
`packages/core/test/mathFix2.test.ts` (30) and `export.test.ts`; run by hand with `WM_PORT=<port> node e2e/suites/maths/0N-….mjs`
against an `-E2E` test instance (port 9438). The verifier's own repro scripts (`agents/e2e/verify/Mathslane-v2-0/{hidden,swallow}.mjs`) pass.

| What | Status | Notes |
|---|---|---|
| **HIGH.** A typeset ```wl block swallowed any text on its closing-fence line: the widget replaces that whole line, so words typed or joined after the backticks were hidden once the caret left (still in the file). Two ordinary flows: Palette Insert "On its own line" with the caret on a blank line between paragraphs (the caret landed at the END of the closing fence), and Backspace at the start of the line right under a block (it joined onto the fence) | fixed (root cause, both halves) | `insertMath` (`templates.ts`) puts the caret on the line AFTER the block when the text already had a line break there (PORT-ONLY: the Mac leaves it at the end of the inserted text, where its always-visible source pane hides nothing; the inserted TEXT is the Mac's, unchanged), so the block is typeset at once and typing starts on a fresh line. And `blockDecorations` (`math.ts`) does not typeset a block whose closing fence has anything but spaces after the backticks: it stays source, so every word is on the page. Typing a newline back after the fence typesets it again. Not changed: the rendered page's handling of a closing fence with trailing text (editor lane's `preview`) |
| **MEDIUM.** Tall inline maths (stacked fractions, derivatives, limits, matrices, binomials) was drawn at full height in a 21.8px line and overlapped the lines above and below by up to 11-12px (the denominator of ∂f/∂x through the next bullet; a 2x2 matrix over the next bullet), and the lower half of its box took the clicks meant for the next line (the caret went into the wrong equation's source) | fixed (root cause: no tall boxes inline) | inline maths is the Mac's LINEAR run (`inlineSpans` in `typesetter.ts`, the Swift `MathTypesetter`): `∫₀¹ x² dx`, `(a + b)/2`, `∂f/∂x`, exponents and limits raised and lowered, in the page's own face. It cannot be taller than its line, wraps with the words round it (the scroll box for a wide inline equation, `wm-math-wide`, is gone), and a press anywhere on it opens its own source, the nearer end (the nearer half of the width of all its wrapped pieces). Block maths on its own line stays MathML. The PDF export sets inline maths the same way (`mathHtml`, `INLINE_MATH_CSS` shared). The 2-D inline form of the first port is gone: a deliberate return to the Mac |
| **MEDIUM.** A power whose base is a call that is drawn as a script, infix or stacked row was not bracketed: `Exp[x]^2` drew e with x and 2 beside it (reads e^(x²)), `Dot[a,b]^2` drew `a·b²`, `Log[2,x]^2` `log₂x²` (Sum, Integrate, Limit, D, Factorial likewise) | fixed | `powerBase` (`mathml.ts`) brackets the base unless, as DRAWN, it stands alone: one token, a root, a subscripted name, something already in brackets, or a name applied to bracketed arguments (`sin(x)²`); the linear typesetter has the same rule (`standsAlone`), which also fixes `(x^2)^3` there (it drew `x²³`). `Factorial[x^2]` is `(x²)!`. The linear form now draws Dot and Cross as products (the Swift drew `Dot(a, b)`) |
| **MEDIUM.** Function application written with round brackets was read as a product and the brackets dropped: `f(2) = 4` showed as `f·2 = 4` (the dot is the rule that a number after any factor needs a sign), `y(0)` as `y·0`, `f(x)` as `f x`, `sin(x)` as `sin x` | fixed | brackets WRITTEN right after another factor are kept: the parser makes them a `group` node (PORT-ONLY, `expression.ts`; elsewhere brackets still only group and are dropped), drawn as the brackets they were and, after a name, exactly as `f[2]` is (function application, no gap, no dot). `f(x)^2` keeps its brackets and its exponent. The product is still a product to WL: it prints back as `f*(2)`. `f(x, y)` (several arguments in round brackets) is still not an expression and stays text |

## Maths, after the third independent check (Mathslane-fix1, 2026-10-04)

Independent verifiers (Mathslane-v1-1b and a second) found six problems (two high, four medium; two of the medium are the same
defect seen twice). Evidence: repo e2e suite `e2e/suites/maths/` (new: `08-rendered-page-and-first-keystroke-keep-the-plugins.mjs`
37 checks, `09-mouse-on-typeset-maths.mjs` 33, `10-nested-scripts-and-deep-nesting.mjs` 12; `01`-`07` re-run and unchanged: 19 / 21 / 38 / 9 / 16 / 21 / 19),
unit tests `packages/core/test/mathFix1.test.ts` (12) and `packages/editor/test/mathInline.test.ts` (9); run by hand with
`WM_PORT=<port> node e2e/suites/maths/NN-….mjs` against an `-E2E` test instance (port 9435). Screenshots LOOKED at:
`e2e/.results/manual/…__maths-{nested-scripts,drag-from-equation,right-click,shift-click-selection}.png`.

| What | Status | Notes |
|---|---|---|
| **HIGH.** Ctrl+Shift+P (the rendered page) killed the inline-maths plugin: the preview replaces whole paragraphs, so `view.visibleRanges` is split round them, a one-line paragraph that is not the first block is the end of one range and the start of the next, its `wl:` spans went into the sorted `RangeSetBuilder` twice and CodeMirror threw ("Ranges must be added sorted"). With two or more equations on that line every inline equation of the note stayed raw text after coming back, until the note was reopened | fixed (root cause) | `linesOfRanges` (`math.ts`) walks each line once. The old loop reproduces the throw in a unit test with a split range; `08` toggles the page for nine shapes of note (heading, quote, list, soft wrap, block after) and checks no "plugin crashed", the widgets back, and a NEW equation typesetting at once |
| **HIGH** (editor lane, found while testing; surgical edit). The first edit that grows the note while its end is in view (the first character of a new note, a keystroke at the end of a short one, `setDoc`) crashed the markdown decoration plugin: `Decorator.patch` mapped `view.visibleRanges`, already in the NEW document, through the change again (`Position N is out of range for changeset of length M`), CodeMirror dropped the plugin, headings / bullets / bold stayed raw markdown until the note was reopened. It also put "plugin crashed" into every maths e2e run | fixed (root cause) | `windowHoldsPage` (`decorations.ts`): only the decorated window (old positions) goes through the change; the visible ranges are used as they are. Unit test for the first character of an empty note, the end of a short note, `setDoc`; `08` types the first character with real input and checks the heading, the bullet and the equations are decorated |
| **MEDIUM** (reported twice). The linear typesetter took time exponential in nesting depth: `standsAlone` drew the arguments of a call to find out whether it is drawn specially and `powerBase` drew them again, so each level doubled the work. 22 nested `Exp[…]^2` took 4 s, 30 would take minutes; in the app a 21-deep `wl:Factorial[…]` took 0.9 s to insert and 0.4 s on EVERY caret move, and the 2000-character and depth-400 caps did not catch it | fixed (root cause) | whether a call is special and how it is drawn are now ONE lookup by name and number of arguments, `specialForm` (`typesetter.ts`), which draws nothing; `standsAlone` asks it. Seventeen forms 40 deep take under 3 ms each (100 deep under 5), unit-tested under 100 ms; in the app five spans 30-40 deep insert in 8 ms and a caret move costs 0-1 ms (`10`). A 20000-case fuzz found the same characters before and after. The MathML path was always linear |
| **MEDIUM.** Inline maths flattened nested scripts: `mathScript` set every run of the piece to one size and one offset (the Swift `script()` does the same), so `wl:Exp[-x^2]` drew e^(−x2), `x^y^z` x^(yz), `Subscript[x, n^2]` x_(n2), and the palette's own Gaussian read as ∫ e^(−x2) dx, while the block (MathML) form was right | fixed (PORT-ONLY, deliberately not the Swift) | scripts compose: each run is scaled by 0.7 about its own baseline and keeps its own raise (`baseline·0.7 + shift`), never below half the text's size (TeX's scriptscript, so a tower of powers stays legible and bounded); a variable in a script keeps its italic, as in the MathML. The characters are unchanged. Looked at: e^(−x²), x^(y^z), e^(x²), x_(n²) at three levels each |
| **MEDIUM.** The press handlers on typeset maths ran for every button and ignored the modifiers: Shift+click lost the anchor, a right-click swapped the equation for its source before the menu opened, a drag that began on an equation gave a caret | fixed | `pressOnMaths` (`math.ts`), inline and block: left = caret in the source as before, and a drag from there selects from the near edge (a drag across an equation selects it, typeset); Shift extends to the near edge and a drag goes on extending; the right button selects the equation (the page's own "move the caret to the click" would otherwise land on its edge, which also shows the source) and the menu opens with Cut / Copy live; Ctrl/Cmd is left to the drawing layer. Not what the verifier suggested for Shift: the head goes to the equation's EDGE, not inside its source, so the equation stays typeset and selected. `inlineSpans` is also memoised per source (the decorations ask on every caret move) |

## The drawing layer, audited against the Swift (d1-shapes, 2026-10-03)

Source of truth: `WriteMind/Drawing/*.swift`, `Views/ShapeMenu.swift`, the Drawing / Shape / Mark XCTests.
Evidence: `packages/core/test/shapes.test.ts` (24 tests: the ShapeTests hit tests, head tip and mark artwork
transcribed; the palettes; the rounded rectangle; the port's own restyle / nudge / order / copy rules) and the e2e
scripts in `C:\CLAUDIO\agents\e2e\d1\` (`a1` shapes + palettes + group, `a2` connectors, `a3` edits + paste + picture,
`a4` pen, `a5` handles / DPI / text box; test port 9413; mouse AND synthetic pen; `reg\` has the older tour scripts
t10 t11 t12 t17 t18 re-run against this build, all passing).

| Feature | Status |
|---|---|
| Rounded rectangle painted round; its outline, hit test and arrow landing are round too (the Swift hits it as a square) | fixed |
| Oval painted as a true ellipse (was a 32-gon) | fixed |
| Shapes painted in the item's own frame: outline width scales with the item, label scales with it and wraps (up to six lines) | fixed |
| Connectors painted from `connectorPaths` (the Mac's `InkPaths`): line pulled back so the arrow tip is the point, butt caps, round only for dotted | fixed (a round cap used to poke past the tip) |
| Mouse strokes smoothed through the midpoints of their samples (`strokeCurve`); pressure strokes stay segment by segment | fixed |
| Marks palette = the Mac's: tick, cross, query, star, box, circle, triangle + Arrow, Both Ways, Line (`MARK_MENU_KINDS`) | fixed (listed 4) |
| Shapes palette: the six nodes (+ Text Box, port extra) and **Arrow tool** (the Mac's "Draw arrows between nodes": stays armed, each end that lands on a node is attached) | built |
| Alt-drag from a node draws an attached arrow without the tool | built (a lone Alt release may flash the Windows menu bar; not hardware-checked) |
| Style bar for an arrow (head at either end, solid / dashed / dotted); opens when an arrow is drawn, and from the ◐ handle | built |
| Colour, width, fill of the picked objects (strokes, shapes, text boxes, arrows) | built (port extra: the Mac has only the arrow bar) |
| Group handle reads Group / Ungroup; Ctrl+G widens the selection to the whole group | fixed |
| Move handle (✥); Shift turns in 15 degree steps | built (the Mac has both) |
| A pasted / dropped / inserted picture, and a capture's picture, arrive picked (`DrawingHistory.select`) | built |
| Handles never leave the pane (the Mac clamps them 14pt in); tiny marks and thin strokes spread their handles apart | fixed |
| Canvas follows a change of display scale without a resize (it polls `devicePixelRatio`; a media-query listener stops firing once re-armed) | fixed, checked at 1.5x and 2x by emulation only |
| Arrow-key nudge (1pt, Shift 10pt, one undo per burst); Ctrl+C / Ctrl+X / Ctrl+V of objects, also between notes (a token line on the text clipboard; pictures are one shared media folder); Front / Back / up / down / Copy in the bar | built, port extras (the Mac has none) |
| Snapping, alignment guides, lock, a text box's font size | the Mac has none; not built |
| Handles on hover, before a click | not built (the Mac has it, for the mouse; a pen does not hover here) |
| A selection that includes an arrow can never say Ungroup (an arrow takes no group) | same as the Swift (`testAConnectorTakesNoGroupOfItsOwn`) |

## Reading a picture's words on Windows (c1-ocr, 2026-10-03)

Source of truth: `docs/FEATURES.md` "The words in a picture", `WriteMind/Camera/{TextRecognition,HandwritingMarks,FlowChartReading}.swift`,
`WriteMindTests/{HandwritingMarks,TextRecognition}Tests.swift`. How it is built and what it cannot do: `docs/OCR-WINDOWS.md`.
Evidence: `packages/core/test/handwritingMarks.test.ts` (35, the Swift HandwritingMarksTests transcribed),
`packages/core/test/textRecognition.test.ts` (41: the TextRecognitionTests that need no Vision, with the reader's answer written out by
hand and the ink drawn in code; JSON parsing, word grouping, Japanese joining), `flow.test.ts` (labelled chart, `mayHoldChart`),
`apps/desktop/test/ocr.test.ts` (the helper's contract with a stand-in PowerShell, the queue / cache / cancel, and the REAL engine
reading a fixture), and the e2e scripts in `C:\CLAUDIO\agents\e2e\ocr\` (`aa.mjs`, `camera-chart.mjs` with `makechart.mjs`,
`tablet-chart.mjs`; test port 9414). A shell for the next run: `restart.ps1 [-Video]`.

| Feature | Status |
|---|---|
| A reader on Windows: `Windows.Media.Ocr` through `helpers/wm-ocr.ps1`, no install for the profile's languages; capability = a probe that works (`readerFor`); order Vision, Windows, tesseract | built; `capabilities.ocrEngine` / `japaneseOCR` say which and whether Japanese |
| Aa handle on a picture, Windows: lines in reading order, a dot grid painted out first, put in the note as a cell UNDER the picture, the picture stays (the Swift `readText`; was: at the caret, picture hidden), a "Reading..." / "Read N lines" / "No text could be read in that picture." line in the footer, the result dropped (reader aborted) if another note is opened meanwhile, the prepared upright canvas always sent (EXIF-turned photos and transparent PNGs read) | built, e2e (Arial / Times / Courier / Segoe Print, 4 lines in ~0.1-0.5 s) |
| ...a word with a line through it as `~~struck~~`, a ringed word as `**bold**`, a drawn arrow as `→` (inline between two readings, or on a line of its own), a box at the head of a line as `- [ ]` / `- [x]`, a line of algebra as `` `wl:...` `` | built (ported `HandwritingMarks` + `TextRecognition.compose`), e2e on drawn pictures |
| Japanese: Japanese first when installed and kept only if it found any, per-character words put back together, no spaces between kana/kanji | built, **UNVERIFIED on a real engine** (this Windows has no Japanese OCR; `ocr.test.ts` draws a Japanese picture and reads it on a machine that has it) |
| Raised digits become powers (`x2` to `x^2`) | not on Windows: the engine gives no per-character boxes (`superscripted` is ported and tested for readers that do) |
| Flow-chart labels: a camera or tablet capture that holds a chart (`mayHoldChart`) is read for its words; the words label the nodes ("Read a flow chart: 3 nodes, 3 labelled."); drawn outlines are rubbed out of the picture the reader sees (thick box lines defeat it) | built, e2e on the camera (fake device playing a labelled chart) and on the tablet sheet |
| ...ink written INSIDE a node no longer stops it being named a rectangle (`componentOf` leaves out the label's words) | fixed; the Swift has the same hole (a behaviour change from the Swift, tested in `flow.test.ts`) |
| Reading never blocks the page: PowerShell in the main process, a queue of two, a cache by picture bytes, `ocr:cancel` kills the engine when nobody else wants the picture; a second click on Aa while reading does nothing; leaving the app cancels | built, unit + e2e |
| Reading order by BAND (`sameBand`), and neighbours a line-height and a half apart are one line (the engine splits "pay    rent today" into three lines; the Mac's middle-to-middle sort would too) | built (a port improvement; Vision's lines never needed it) |
| Finding the page by itself | built since (see "The camera, beyond OCR (c2-camera-parity)": `capture/findPage.ts`) |
| Real pen handwriting through this engine | **weaker than Vision** (a printed-text engine); not measurable here without Sean's hand |

## The rendered page: Write in the preview (e1-preview, 2026-10-03)

The Mac's `MarkdownPreview` / `BlockEditor` / `PreviewEditing` (docs/FEATURES.md "Write in the preview"),
ported. **One difference in kind, on purpose:** the Mac's rendered page is a second view (SwiftUI blocks, one
`NSTextView` per open block, the note written back block by block). Here it is the SAME CodeMirror view, document,
selection and undo with every block that is not open *drawn by a widget standing over its characters*
(`packages/editor/src/preview/`). The Mac's rule — "only the block you are in is ever rewritten, the document is
never round-tripped from rich text" — is therefore true by construction (there is no second copy to convert),
and the brackets, seams, + menu, folds, held-cell commands and undo are the markdown side's own rather than
reimplemented. The toggle is `setPreview` (Notebook.tsx: one call); the markdown side is untouched.

Pure rules: `packages/core/src/cells/preview.ts` (layout/`topRow`/`previewSeams`, `seamKey`, `cellKey`, `opened`,
`arming`, `stillHeld`, `keepsNewlines`, which blocks are open: `cellStates`/`touchingRuns`, `returnInBlock`,
`backspaceInEmptyBlock`) and `markdown/sourceStyle.ts` (`MarkdownSourceStyle.runs` + the inline model the page
draws from). Tests (`preview.test.ts` 83, `sourceStyle.test.ts` 16) are transcribed from `PreviewEditingTests`,
`PreviewSeamTests`, `PreviewLayoutTests`, `ArmedBarTests` (the choice test), `CellSelectionTests` (held-cell keys),
`CellCommandTests` (`stillHeld`) and `MarkdownSourceStyleTests`. Not transcribed, because they test AppKit rather
than a rule: the `NSCursor` hand-back tests, `CodeCellHeightTests` (font metrics), `CellBracketTests` hit-testing of
the SwiftUI bracket column (the port's gutter has its own, already tested).

| Feature | Status | Evidence (`C:\CLAUDIO\agents\e2e\preview\`, port 9411; `run-all.mjs` runs them all) |
|---|---|---|
| Blocks drawn: headings (the 6-rung ladder, Author italic), real bullets / dashes / numbers, nested items, to-do boxes, quotes, coloured code, rules, `<u>` / `<span style>` / strike / code, links, maths (inline `wl:` and `wl` fences, the maths lane's MathML), pictures (`![alt](x.png)` from `.drawings/media`, alt words when missing) | works | `gallery.mjs`, `misc.mjs`, `ticks.mjs`, screenshots `shots\pv-*.png` (dark and light) |
| Click a block: opens in place as styled markdown, caret where the word was clicked (every drawn run knows its source offset); a press in the margin beside a block counts | works | `open.mjs` |
| Return starts the next block; in a list / to-do / numbered / quote it carries on, an empty item ends the list; code takes a plain newline; one undo step | works | `edit.mjs` |
| Backspace in an empty block removes it (and the blank lines); at the end of the note too | works | `edit.mjs` |
| Up / Down walk block, bar, block (and arm the bar above / under the note); Shift+Up/Down extend a block at a time; Page Up/Down | works (the editor's own vertical motion skips drawn blocks, so these are the page's own) | `bars.mjs`, `nav.mjs` |
| The line between two blocks arms; a character / Return opens a block there; the + chooses the kind; Escape / Backspace take the bar back writing nothing | works | `bars.mjs` |
| Whole bar works on the open block: bold, italic, underline, strike, T (span style), the heading ladder, list, quote, code block, indent / outdent, maths palette, split / merge cell | works | `format.mjs`, `maths.mjs` |
| A format command at a bar (the Mac's `atArmedBar`): the ones that make a kind of block (Ctrl+1…7, List, Quote, Code Block) name it for the next character; the rest (bold, indent, maths…) do nothing. Rendered page only — the markdown side is as it was | works | `bars.mjs` |
| To-do box is a control: one character written, nothing opens | works | `ticks.mjs` |
| Cell brackets, drag-down, shift / ctrl-click, move held, duplicate, delete, cut / copy / paste (cells MIME), typing over one or several held cells, Return over held does nothing, Escape lets go | works | `held.mjs`, `nav.mjs` |
| Folding (double-click a section bracket, the ⋯ marker) | works | `misc.mjs` |
| Toggle back and forth: same words, same caret, the cell at the top of the window is put back at the top | works (4 round trips on an 80-cell note) | `toggle.mjs` |
| Only the open block is rewritten | 60 random edits: never more than two blocks touched, every untouched block byte for byte | `only.mjs` |
| 600-cell note: keystroke on the rendered page ~6 ms median (markdown side ~2 ms); caret between blocks ~4 ms | works | `perf.mjs` |
| 250 / 400-gesture random runs (clicks, brackets, gaps, keys, typing, toggles, folds, undo) | no uncaught error | `fuzz.mjs [steps] [seed]` |

Changes outside the lane's new files, all small: `parser.ts` (a block now ends where its own last line ends — a
list continued by Return used to overlap the new item beside it, so the page opened both; the Swift parser has the
same latent overlap; all 90 parser tests unchanged), `brackets.ts` (the caret's bracket is lit at the very end of
its cell, the Mac's `block(containing:)`; picks send `setHolding`), `keys.ts` (cell commands that leave cells
selected send `setHolding`; `nameKind` wraps the four commands that make a kind of block), `extras.ts` (`linkClicks` provides `followLink` and follows on Alt-click only — a plain
click on a drawn link goes, a plain click on a link's words in an open block puts the caret in them),
`seams.ts` (the seam layer was left as tall as the longest note it had drawn, which held the scroll area open
under a shorter one — reset when it has nothing to draw), `notebook.ts` (`atBar`, `applyEdit` declines at a bar
on the rendered page).

Differences from the Mac, so nobody "fixes" them: Escape does not close an open block (there is always a caret on
this page; it takes a bar back and lets go of held cells); Backspace at the start of a non-empty block joins it to
the block above (the editor's own; the Mac does nothing); Ctrl+A selects the note and lights every block (the Mac
selects the open block's text); an open code block shows its fence lines faint (the Mac shows only the code);
cells that touch (a list and the new empty item Return just made) open together; the new empty block shows a grey
hint (Ctrl+1 / Ctrl+Shift+L are this port's keys); heading sizes are the markdown side's ladder so nothing changes
size as a block opens.

Not verified: a real mouse (all clicks are CDP `Input.dispatchMouseEvent`), IME composition inside an open block,
and drag-selecting across drawn blocks by hand (a press on a drawn block opens it, so a drag begins in the open
block).

## One Undo, and the drawing layer toured end to end (d2-undo-tour, 2026-10-03)

**What the Mac does.** Cmd-Z is routed by MODE (`AppState.drawingOwnsUndo`: the drawing's while the pen is up, something
on the layer is picked, a shape is armed or the arrow tool is on; else the text's through the responder chain) and
`store.undoDrawing` / `redoDrawing` are the drawing's own pair (Edit ▸ Undo Drawing, Cmd-Opt-Z). It has no combined
history. The port did something else (take back whichever side was edited last, keep going down that side until empty),
which undid the wrong thing for interleaved edits. **Now: one timeline per note.**

| Feature | Status | Evidence |
|---|---|---|
| Ctrl+Z / Ctrl+Y / Ctrl+Shift+Z and Edit ▸ Undo / Redo take back EXACTLY the most recent edit, words or drawing; Redo brings back the one undone last | built | `apps/desktop/test/undoTimeline.test.ts` (162 tests: 150 seeded random interleavings of 300 operations, 5 of 3000, against an oracle that checks the pair (words, drawing) after every step), `agents/e2e/d2/u1.mjs` (real keys, real mouse) |
| How: every edit takes a stamp from the note's `EditClock` (`editTimeline.ts`). CodeMirror's history stays the engine for words; a state field mirrors its undo/redo stacks with stamps (it reads the change in `undoDepth` to tell a new group from a joined one from an undo); `DrawingHistory` entries carry stamps. Undo = highest stamp of the two tops, Redo = lowest of the two undone tops | built | as above |
| Typing that follows a drawing edit starts a group of its own (`isolateHistory("before")` added by a transaction extender), so a group never spans a drawing edit | built | test "typing is grouped as CodeMirror groups it, but a drawing edit ends the group" |
| A new edit on either side ends every Redo on both sides (a redo is valid only if it was undone after the newest new edit) | built | tests "a new edit on either side ends every redo" |
| Words + drawing as ONE edit when the app does both: a picture read with Aa (words into the note, picture put away) is one Ctrl+Z (`clock.together()`) | built | test, `agents/e2e/d2/u3.mjs` with the real Windows OCR engine |
| A captured page / camera or tablet capture (picture + strokes + chart) is ONE edit; a text box's typing session is one; a burst of nudges / colour changes is one (and a word edit ends the burst) | works | `editDrawing`, `Canvas.burst`; `t6.mjs` |
| Per note: each open note keeps its own clock, its own drawing history and (behind its tab) its own editor state, so switching tabs no longer wipes Ctrl+Z, and an edit in one note never touches another's undo / redo. A closed note forgets; a renamed one keeps its drawing history | built | tests "each note has its own timeline", `u2.mjs` |
| Edit ▸ Undo Drawing / Redo Drawing keep working as the drawing's own pair (and the drawing edit they undo keeps its place in the timeline) | works | tests, `u4.mjs` (real menu items) |
| An Undo / Redo of something out of sight scrolls it into view | built | `u5.mjs` |
| An undone group that had no net effect (a letter typed and taken back) is stepped over, not counted as a dead Ctrl+Z | built | random tests |
| Ctrl+Z / Ctrl+Y outside a text field are always swallowed (nothing to undo = nothing happens, never the browser's contenteditable undo) | built | `useUndo.ts` |
| Not unified: the tablet SHEET's own strokes (Ctrl+Z while the pen is over the pane still asks `tabletUndo` first), and a text field's own native undo (a label, a text box being typed in) | by design | |

**Data-loss fixes found on the way.** (1) A drawing edit made in the last half second before a tab switch was lost (the
effect that holds the save timer let go of it): `openNote` now writes the drawing first. (2) Closing the window inside the
500 ms debounce lost the last edit of the words AND the drawing: a `beforeunload` handler hands both writes to the main
process (`u6.mjs`).

### The tour (every drawing bullet of FEATURES.md, mouse and synthetic pen)

Scripts in `C:\CLAUDIO\agents\e2e\d2\` (port 9418; a1-a5 are d1's, rerun on a fresh note): pen strokes (mouse in pen mode;
pen with pressure), erase sweeps, marquee, shift-extend, move / scale / turn, nudge, colour, group / ungroup, delete,
duplicate, flow shapes, labels, Alt-drag and tool arrows, a text box, marks, pictures (paste, drop, Insert ▸ Image through
the E2E-pickable dialog, crop, Aa), scrolling, window and pane resizing, reload from the sidecar, 2000 strokes / 50k points.
`t6.mjs` checks, by the canvas pixels, that ONE Ctrl+Z puts the picture back exactly and Ctrl+Shift+Z redoes it exactly for
each of ~20 operations; `t4`/`t4b` that a reload gives a pixel-identical page.

Found and FIXED at the root:

| Finding | Fix |
|---|---|
| **Quadratic geometry.** `applyMatrix` recomputed the item's centre (a pass over all its points) for every point it moved, so outlining, hit testing or painting a stroke cost n² (a 500-point stroke: a quarter of a million allocations per paint; erasing across 2000 strokes ran at 53 ms a move, dragging them all at 55 ms a frame) | `matrixOf(item, size)` works the centre out once (`geometry.ts`, used by `outline`, `frameCorners`, `hitTest`, `paint`, the PDF export). Erase 53 → 16.7 ms (vsync), drag-all 55 → 23 ms, 100 strokes x 500 points all smooth. `unionRect` no longer spreads (a 300k-point stroke overflowed `Math.min(...)`). `geometryScale.test.ts` |
| **The mouse wheel did nothing with the pen down** (the layer takes every pointer event and the page is not inside it) | the layer hands wheel / touchpad scroll to the page's scroller |
| **No rubber band for an arrow being drawn** (the Mac draws a dashed line) | dashed preview in the pen colour |
| Marquee / ghost shape repainted every object on the page on every move | they are painted on the overlay layer now: marquee over 2000 dense strokes 45 → 16.7 ms a frame |
| **Pen strokes with pressure were polylines** (facets at fast writing) | drawn as the mouse stroke is (a curve through the midpoints, `strokePressure`), with the width following the pressure piece by piece, live and committed alike |
| The Insert ▸ Image dialog could not be driven by the E2E harness | `media:choose` goes through `askOpen` like the other dialogs |
| A picture DROPPED on the page went under the caret like a paste, wherever it was let go | it is centred where it was let go (kept inside the pane); a drop that carries no place on the page still goes under the caret |
| Edit ▸ Undo in the menu, with a label or a text box being typed in, undid the document | the menu's Undo / Redo go to the field's own undo while a field has the focus (the keys already did) |

Final rerun (fresh instance, 2026-10-03 evening): u1-u6, t1-t9, a1-a5 and perf.mjs all PASS (2000 strokes / 50k points: scroll,
pen move, undo / redo and drag-all at the 16.7 ms vsync, 116 ms to load). Known flake, not a defect found: `t6.mjs`'s first
operation (the mouse pen stroke) failed its pixel comparison on 2 of ~8 runs while other agents loaded the machine (the redone
stroke differed from the one grabbed 350 ms after drawing it by ~235 anti-aliased pixels) and passed 20 of 20 in isolated loops
that also waited 1.5 s and found zero drift; read it as a timing artefact of a busy machine until it fails on a quiet one.

Decisions kept (Mac parity, not bugs): objects are stored as fractions of the pane (x of its width, y of its height,
counted from the top of the note), so a window or divider resize stretches ink with the pane, as on the Mac ("so a drawing
keeps its place when the window is resized"); they scroll with the words, and text inserted above does not move them (the
layer floats).
Still unbuilt: outline / handles on hover (Mac, mouse), snapping, a sweep of orphaned files in `.drawings/media` (every paste
and crop adds one; nothing removes them — only sidecars of the notes root are known to the app, and projects can add roots,
so a naive sweep could delete a picture another project still uses).

## The camera, beyond OCR (c2-camera-parity, 2026-10-03)

Source of truth: `docs/FEATURES.md` ("A notebook page, off the camera", "A section of the page", "Any camera the Mac can see"),
`WriteMind/Camera/{NotebookCapture,InkVector,CameraZoom,CameraController}.swift`, `WriteMind/Views/{CameraPane,VideoMenu}.swift`,
`WriteMindTests/{NotebookCapture,InkVector,CameraZoom,CameraZoomBox}Tests.swift`.
Evidence: `packages/core/test/{findPage,inkVector,cameraZoom,capture}.test.ts`, `apps/desktop/test/camera.test.ts`, and the e2e scripts in
`C:\CLAUDIO\agents\e2e\camera\` (port 9419; `node runall.mjs` restarts the instance on each video and runs all of them: page-find 21,
devices 42, chrome 22, section 24, text 11, export 7, pale 2, nocam 5 checks, all PASS on 2026-10-03; build first with `restart.ps1` or
`build-locked.ps1`). The videos are made by `makevideos.mjs` (COLOUR .y4m, 1280x720: a crooked dotted page with handwriting on a wood desk
with a mug and a pen, the same with a sketched flow chart, a page of printed type, a page nearly filling the frame, a pale page on a pale
desk) and `truth.json` holds where the page's corners really are; `restart.ps1 -Video <name>` starts the instance with Chromium's fake
capture device playing one; `y4mpng.mjs` turns a frame into a PNG to look at.

| Feature | Status | Evidence |
|---|---|---|
| **Finding the page by itself** (`capture/findPage.ts`, plain arrays, every platform; the Mac keeps Vision): the frame shrunk (the dot grid melts into the paper's tone), 16 thresholds plus Otsu, opening, hole fill, the largest page-shaped blob, its convex hull cut to the four enclosing edges, scored by fill and edge contrast; a Hough line vote with edge support when the desk is as pale as the paper; either answer refined along the real edge at 480 px with a robust line fit | built; 20-60 ms for 1280x720 | `findPage.test.ts` (14, scenes in `scene.ts`: tilted, rolled to landscape, shadow gradient with a pen across the edge, clutter, off the frame, pale on pale by a thin shadow line, nothing, noise, the page IS the frame, 40 random views all within 1.5% of the diagonal, 1-2 px on a large clean view, and a vignette / glare / bright sheet beside the page / heavy noise / out-of-focus lens); e2e: corners within 0.3% of the diagonal on `page-desk` (`page-find.mjs`), a pale desk 0.8% (`pale.mjs`) |
| ...feeds **Straighten**: turning it on puts the four corners ON the page (drag any of them; **Find page** looks again; turning the picture looks again) | built | `page-find.mjs` |
| ...and every capture finds and squares the page by itself with Straighten off (the Mac's `pageQuad`); a page that fills the frame (over 96%) counts as not found | built | `page-find.mjs`, `section.mjs` (a chart on a crooked page is squared up, then read as 3 nodes and 2 arrows) |
| **No page found**: the Mac refuses a whole-page capture (`.page` with no quad and no box returns nil); here it takes the whole picture and the line under the viewfinder says "No page found, so it took the whole picture." (a document camera looking straight down at a page that fills the frame would otherwise never work) | **different on purpose** | |
| Page shape: learned from the first page that was FOUND (never from the frame), kept across launches (`notebookPageShape`), within 12% resampled to exactly it, further off re-learns; short side 1200; the page's edge trimmed (`EDGE_INSET`) | built | `capture.test.ts`, `page-find.mjs` (1.42 remembered: 1200x1704 exactly; 1.1 remembered: measured afresh, 1.414) |
| The writing is lifted off the WHOLE normalised page and the box only picks which of it comes in (a stroke across a small box is not "the page edge"); `inkBox(within:)` ported | built (it was lifted off the box alone) | `capture.test.ts` (`testOnlyTheWritingInsideAWindowCounts`) |
| ...a box over a drawing that is joined up across the page takes the part of it inside the box; a missed printed dot far from the writing no longer stretches the picture to the page's size (`writingBox`, beyond the Swift) | built | `capture.test.ts` (5) |
| **Just the writing, traced into outlines** (`InkVector`): boundary loops of the ink mask, Douglas-Peucker at 0.75 px, filled even-odd; brought in as an **SVG** (the Mac writes a PDF) in the pen's colour, the size of the writing; stays vector in Export > PDF; crops to a PNG; Aa reads it as the picture it draws (flattened on white) | built | `inkVector.test.ts` (8, the Swift tests); `export.mjs` (the PDF has 3225 path segments and no image object), `text.mjs` (Aa on the SVG) |
| **The whole page** as a JPEG of the squared, trimmed page; **the raw picture** (the frame, or the box's part of it, nothing squared, shape not learned) | built: three buttons Writing / Page / Raw, and Image / Writing / Text under a box | `page-find.mjs`, `section.mjs` |
| FEATURES.md's *chevron* that picks the mode | not built as a chevron: the Mac's code no longer has it either (the modes are reached through the three choices under a box); the port shows all three as buttons | |
| The dashed box: a drag is the box (everything outside dimmed, edge dashed), **one click clears it, a double click takes the whole picture** (the picture, not the letterbox bars; zoom allowed for), Image / Writing / **Text** (reads the box into the note as words, only when a reader exists) under it | built | `cameraZoom.test.ts` (`SectionBoxGestureTests`), `section.mjs`, `text.mjs` |
| **Resize by Square** (`CameraZoom`): drag a box, the pane shows that much; zooming twice composes; boxes drawn on the zoomed picture land on the right part of the real one; Original Size; remembered | built (Zoom / Original size in the pane corner, and Turn Left / Turn Right / Original Size / Resize by Square in the video menu) | `cameraZoom.test.ts` (21: `CameraZoomTests` + `CameraZoomBoxTests`), `section.mjs` |
| Quarter-turn buttons in the pane's corner (and the video menu), remembered (`cameraRotation`), the turned picture fits the pane, **captures and the page finder see the picture as it is shown** | built | `cameraZoom.test.ts` (`quarterTurned`), `devices.mjs`, `section.mjs` (a raw capture of a turned picture is 720x1280) |
| **Input Devices**: every camera, a check on the one in use (the pane reports the device it really opened), the Tablet beside them, Turn Camera Off, Refresh Device List; the sidebar's video chevron lists the same | built | `devices.mjs` (the menu is read through `e2eMenu`) |
| The source is **remembered across launches** (a camera's id, the tablet, or off); nothing remembered opens the system's default camera (the Mac waits to be told; Windows has no permission prompt to avoid) | built | `devices.mjs` (relaunch: off stays off with nothing opened; the picked camera comes back and is ticked) |
| **Turn Camera Off** stops every track and the pane stays up with "No camera selected" and the list to pick from (it used to hide the pane) | built | `devices.mjs` |
| **Hot-plug**: a track that ends (camera pulled out) or a device that disappears from the list turns the camera off ("The camera was unplugged"); a camera that appears when the pane was waiting starts it | built; **simulated** (`__wmCamera.simulateUnplug()` and a `devicechange` event on the fake device): no real USB camera was unplugged | `devices.mjs` |
| **Errors said clearly**, as the Mac's four stand-ins: "Camera access is off" (Windows privacy switch named: Settings > Privacy > Camera), "The camera is busy", "No camera found", "That camera is no longer available", "Camera unavailable" plus the engine's words, with the camera list and Refresh on the placeholder | built; each error **injected** by overriding `getUserMedia` (the real Windows privacy switch was not touched) | `devices.mjs`, `camera.test.ts` |
| Video switch on the sidebar bar with the video menu on its chevron (the Mac's header); notes-pane switch: "Back to Side by Side" in the video corner when the notes are away, and "Video Only (Hide Notes Pane)" in the video menu. It is the WINDOW's layout; the display is never put in full screen | built | `chrome.mjs` |
| **No stream left running**: every track stopped and `srcObject` cleared when the pane is put away, the source changes (5 camera/tablet round trips: one stream, never two), the camera is turned off or unplugged. Whole-instance CPU with the 1280x720 fake camera shown: about 28% of one core; pane put away, or on the tablet: 0.3% | verified | `devices.mjs`, `cpu.mjs` (with `cpu.ps1`) |
| The camera is asked for 1920x1080 at 30 fps as an *ideal* (the Mac's `.high`; a bare `video: true` is often 640x480, too coarse for handwriting) | built; **not verified on a real camera** | |
| Flow charts on a camera page: read at 1200 px (was 800) from a halving down-scale (a pen line broke into dashes at 800 and one box of three was refused), and the ink-only reading wins when the words made it worse | fixed | `section.mjs` |
| `capabilities.findsThePage` is true everywhere (it was false everywhere) | CHANGED, with its test | `capabilities.test.ts` |

**Not verified / needs Sean's hands**: a real webcam or document camera (focus, exposure, lens distortion, motion blur, a hand on the
page, glossy glare, a page with a coloured cover or a spiral): the finder was built and measured on synthetic projected scenes and the
fake device only. A real camera unplugged and plugged back in; the real Windows camera privacy switch; the 1080p ideal constraint on his
camera; whether the finder picks the notebook and not something else bright in his room (the corners can always be dragged with
Straighten, or take Raw).

## The editor, polished (e2-editor-polish, 2026-10-03)

Source of truth: `docs/FEATURES.md`, `WriteMind/Views/TabBar.swift`, `WriteMind/Notes/{NoteStore,Project,MarkdownLinking}.swift`,
`WriteMind/Editor/{MarkerDeletion,CodeTyping,MarkdownTextView}.swift`. Evidence: unit tests `packages/core/test/{find,sessionBuffers,markerDeletion,
codeTyping,linking,linkTarget,notes,sourceStyle}.test.ts`, `apps/desktop/test/{findKeys,menu,notes,chromeFixes}.test.ts`, and the e2e scripts in
`C:\CLAUDIO\agents\e2e\e2\` (port 9417, instance e2-editor-polish; `node run-all.mjs` runs all nine: markers 23, list 22, tabs 34, links 47, hotexit 17,
code 24, edit 27, markerdel 13, find 32 checks, all PASS on 2026-10-03; build first with `build-locked.ps1`). The repo suites `cells` (61 checks) and
`editor` 01-04, 06-08 still pass against the same build.

| Item | Mac | Here | Status |
|---|---|---|---|
| **Markers vs Preview** | two switches: `showMarkers` (View > Hide/Show Markdown Markers, Option-Cmd-M) and `mode` (Markdown Preview/Editor, Shift-Cmd-P) | `rendered.ts`: `markersField` and `renderedField`; hiding the markers reads the markdown as the finished page (the caret's line keeps its marks so they can be typed), the file is untouched; the preview toggle leaves the markers alone; both labels flip independently; no key since e8b3266 (menu only); remembered across a reload | works (`t-markers`) |
| ...deleting over hidden markers | `MarkerDeletion`: a delete, a typed character or a paste over a selection takes whole markers and both halves of a pair | `core/markdown/markerDeletion.ts` + `editor/markerDeletion.ts`, only while the marks are put away (hidden, or the rendered page); shown, half a `**` is a fair thing to delete | works (`markerDeletion.test.ts`, `t-markerdel`) |
| **Format > List and its key** | the chevron's style | the menu item, the toolbar button and Ctrl+Shift+L all write the chevron's style (dots, dashes, numbers, to-dos); the key was hard-coded to dots; pressing it again takes the list off; a list of another style is converted; the choice is remembered | fixed (`t-list`) |
| **Tab title lag** | the tab follows the heading as it is typed | the tab says the new heading ~250 ms after the keystroke, before the autosave; with no heading it falls back to the file name; a stale tree read does not put the old title back | fixed (`t-tabs`) |
| **Tabs** (`TabBar.swift`, `NoteStore.closeTab / closeOtherTabs / reload`) | middle click closes, wheel walks the row, the list at the right end names every open note, Close Other Tabs; NO drag to reorder (the Mac has none) | the same; the tab that takes a closed tab's place is the NEXT one (the last falls to the one before); the overflow list scrolls the chosen tab into view and ticks the front one; a note deleted or trashed outside the app loses its tab (the one in front too: another note comes forward, no error bar); Rename keeps ONE tab with the new name and later typing lands in the renamed file; an external rename drops the tab and the app stays up | works (`t-tabs`) |
| **Links** | `/link`, banner, Link Here, anchors in the target, Alt-click / click to follow | the Mac's two banner lines, Link Here off in the source note and on elsewhere, the banner survives opening notes in other sections, Cancel / Escape / `docs/link` (not a trigger); a heading target writes nothing, a highlighted run becomes `<mark id="wm-...">`, a plain block gets `<a id="wm-..."></a>`; the new link is selected; the source comes back to the front; a plain click follows on the rendered page, Alt-click on the markdown and inside an open block; landing selects the marked run; a closed section holding the target is opened (a link to its HEADING leaves it closed); after the SOURCE is renamed links work, after the TARGET is moved they still resolve, a link to a note that was renamed goes nowhere (as on the Mac) | works (`t-links`, 47 checks) |
| **Hot exit** (`ProjectSession.unsavedBuffers`) | text typed and not yet autosaved is kept in the session and comes back | the session file carries each dirty note's text and the file it was based on, updated as you type; `taskkill /F /T` mid-edit and relaunch: the same tabs, the same front tab, the text, the caret; the file is written; once saved the session stops carrying it; a file changed by another writer meanwhile is left alone and the text is kept as `name (unsaved copy).md`; a note created and typed into at once comes back | works (`t-hotexit`, `sessionBuffers.test.ts`) |
| **Code cells** (`CodeTyping`) | pairs, step over the closer, wrap a selection, Backspace between a pair, Tab / Shift-Tab by four spaces on every selected line, none of it in prose | `core/markdown/codeTyping.ts` + `editor/codeTyping.ts` (on the rendered page Tab is a real tab) | works (`codeTyping.test.ts`, `t-code`) |
| **Indentation, expand selection, move a section, heading ladder, every occurrence, undo of a format key** | per FEATURES.md | real keys on the real app: Ctrl+] / Ctrl+[ (a quote gains a level, a paragraph four spaces), Backspace in indentation takes a level, Tab on a selection; Ctrl+. word, cell, section, note; Ctrl+Up/Down moves heading and body; Ctrl+1..7; the Author line italic and bigger; Alt+Shift+D edits all together; Ctrl+B then Ctrl+Z | works (`t-edit`) |
| **Spell check conventions** (`MarkdownTextView.makeNSView`) | continuous spell check ON; auto-correct, smart quotes, smart dashes, text replacement OFF | `conventions.ts`: spellcheck on, `autocorrect`/`autocapitalize` off, a fenced line and a code span are not checked; straight quotes and `--` stay as typed | works (`t-edit`) |
| **Pasting** (the Mac's view is plain text, `isRichText = false`) | the plain words, never markup; lines into a list are just lines; a URL is the URL | `paste.ts`: a clipboard with both gives `text/plain`; one that only has `text/html` arrives as words (a line to a block, a dash to an item); pictures are the drawing layer's | works (`t-edit`) |
| **A file let go on the window** | nothing opens | `dropGuard.ts`: a dragged file nothing takes is refused over the tab row, sidebar, footer and editor (Chromium would otherwise replace the app with the file); a picture on the page is still taken by the layer | works (`t-edit`) |
| **Find in the note** (`usesFindBar = true`) | Cmd-F bar, Cmd-G / Shift-Cmd-G, Cmd-E, Option-Cmd-F replace | `FindBar.tsx`, `editor/find.ts`, `core/text/find.ts`: Edit > Find submenu; Ctrl+F, Ctrl+H (with Replace), F3 / Shift+F3, Ctrl+E; every match lit, the current one more, "2 of 4" / "Not found", wrap-around, Match case, Whole words, Replace, Replace All (one Ctrl+Z takes it back), Esc closes and gives the note back its keyboard; on the rendered page going to a match selects it (opens its block) | built (`find.test.ts`, `findKeys.test.ts`, `t-find`) |

Not verified / open: `e2e/suites/editor/05-sidebar-drag.mjs` (repo suite) FAILS against the current build for a reason outside this lane: sections now
start open (`Sidebar.tsx`, the Mac's `expanded` on appear), so the script's `order()` also lists notes inside an open section and "it left the root
list" and the checks after it read the wrong rows (the files do move; the script has to count only root rows). Hot exit was checked by `taskkill /F /T`
of the instance, not by a power cut or a Windows shutdown. Spell check was checked as the attributes Chromium needs (`spellcheck` on the content, off on
code), not as red wavy lines on a screenshot (an offscreen Chromium has no dictionary to show). A real IME, a real clipboard (the checks dispatch a
`ClipboardEvent` with a DataTransfer) and a file dragged from Explorer were not tried.

## Drawing lane, round 2 (fix-drawing, 2026-10-04)

| Item | Status | Evidence |
|---|---|---|
| Verifier issues from the Drawing lane list (Backspace/Delete also eating a letter, stale pick/crop swallowing keys, palette lines attached, Enter confirms a crop, label Escape flag, total `readDrawing` + unknown shape kinds, pointer ownership, burst after Undo, eraser between samples) | already fixed by the earlier lane fixer, re-checked in the code | `layerKeys.test.ts`, `drawingFix1.test.ts`, `drawingBurst.test.ts`, `e2e/suites/drawing/06-keys.mjs` (55 pass) |
| Ctrl+C / Ctrl+X with WORDS selected in the note are the words' (the pick is let go); a caret only still copies/cuts the objects | fixed (new) | `layerKeys.test.ts`, `07-mode-and-copy.mjs` |
| Pen / cursor mode change, or arming a tool, puts away the pick, crop box, style bar and label (Mac) | fixed (new) | `07-mode-and-copy.mjs` |
| An edit that changes nothing (delete of ids already gone) records no undo step | fixed (new) | `07-mode-and-copy.mjs` |

## Projects and chrome, round 2 (fix-projects, 2026-10-04)

The verifier lists for this lane (Projectsandchromelane) were already closed in earlier passes; this pass re-checked each HIGH/MEDIUM against the code and re-proved the data-loss ones on a rebuilt app.

| Issue | Status | Evidence |
|---|---|---|
| Typing then closing the ONLY tab at once is on disk (`closeWhere` → `flushNow`) | fixed | `agents/e2e/fix-projects/closeflush.mjs` A |
| Typing then closing the WINDOW (WM_CLOSE) at once is on disk (main asks the page to flush and waits for `app:flushed`, 2 s cap) | fixed; PARITY line about beforeunload alone is superseded | `closeflush.mjs` B |
| No red error bar after the last tab closes | fixed | `closeflush.mjs` C |
| Atomic note/sidecar/order writes, bounded file opens, readable rename names, section-trash only on nested folders, sections open by default, UI state remembered, project-folder watcher (deleted/unplugged folder), session writes queued, PDF cell pitch, Mac .pdf pictures, nested project folders | already fixed (earlier fixer) | `atomic/fileNames/watcher/projectSave/sidebarNested/chromeFixes/pdfPicture.test.ts` |
| Flaky unit test "a duplicate gets a copy … sits right after the original" (relied on two files written in the same clock tick) | fixed: mtimes set explicitly | `notes.test.ts` |

## Pen capture backends, finishing pass (wfin-core, 2026-10-04)

| Item | Status | Evidence |
|---|---|---|
| Native backends (Wintab data context, Raw Input, WebHID) start with the REAL drivers on this machine under `WRITEMIND_E2E=1 WRITEMIND_PEN_NATIVE=1` | verified to **armed** (real descriptors of the CTL-472 read, Wintab context opened with the real `wintab32.dll`, vendor heartbeat seen). **No pen moved: no packet decoded from real hardware.** | `agents/e2e/wacom/wfin-core-start.mjs` (PASS: all armed, nothing contained, clip free, everything idle after close) |
| Round-2 pen fixes: the setup check runs while capture is off / after Esc; trace switch really stops smp/dom/cur and a session record is written; an unplugged tablet reads "Pen: no tablet"; Pen menu's Tablet setup check brings the Tablet source up; panic chip says how to resume; closing the notes window destroys the opt-in sink; verdict advice names only controls that exist | unit-tested (penManager, trace, env, overlay, check tests); renderer wiring not e2e-run | `penManager.test.ts`, `trace.test.ts` |
| Default never covers the display or touches the cursor: one visible window (offscreen), no clip, sink overlay only with `WRITEMIND_PEN_SINK=1` | verified | window enumeration of the instance's processes; second-process `Cursor.Clip` = whole screen |
| Release on every path (clip, guard, lease, sweep, kill -9 of app and of guard) | verified with real processes: 75 PASS, final `GetClipCursor` free from koffi and from an independent PowerShell | `node apps/desktop/scripts/pen-guard-proof.mjs` |
| Wintab context after kill -9 of the app is closed by `recoverStaleContexts` at the next Wintab start (name carries the dead pid) | verified on the real driver (`recovered-contexts closed:1`) | trace of the test instance |
| Pointer-range witness + `listPointerDevices` (were stubs) | implemented; the list reproduces the design's measured values (CTL-472 INTEGRATED_PEN/EXTERNAL_PEN 15201 x 9501 himetric -> whole display; synthetic `Microsoft HID RID` flagged). The witness registers and unregisters cleanly; **an in-range message from the real pen is unverified** | `test/pen/pointerRange.test.ts` |
| Manager: a backend that is already live now asks to take over on every sample (a thin hover window never blocked the upgrade); Raw Input `stop()` hands over what it had batched | fixed (unit tests that were red) | `penManager.test.ts`, `pen/rawinputBackend.test.ts` |

## Camera and capture, second round (fix-camera, 2026-10-04)

| Feature | Status | Evidence |
|---|---|---|
| A flow chart drawn right across the tablet sheet (one mark over 85% of the width) is read (the camera's "mark across the page = page edge" rule is off for the sheet: `inkMask({keepEdges})`) | fixed (the three tablet-flow checks) | `captureFix.test.ts`, `agents/e2e/wacom/tablet-flow.mjs` |
| A camera/tablet capture lands under the caret's line, else where it sat on the pane carried down by the scroll (`capturePlacedCentre`); its strokes / chart move with it | fixed | `capture.test.ts`, `verify/Cameralane-v1-0/scrollcapture.mjs` |
| Notes pane put away (0 x 0): `placement()` no longer saves NaN | fixed | `captureFix.test.ts`, `videoonly2.mjs` |
| Hand-dragged Straighten corners are checked (`isPlausiblePage`: convex, 45-135 degrees, no sliver, not crossed); page ratio capped at 4; a capture that throws shows a message | fixed | `captureFix.test.ts`, `sliver.mjs` |
| A capture whose reading finishes after another note was opened is not added to that note | fixed | `cameralane-v1-1/capswitch3.mjs`, `aa-race-nobusy.mjs` |
| A reader that never answers: chart labels / the Text button give up after 8 s and go without | fixed | `ocrDeadline.test.ts` (not run against a hung PowerShell) |
| Picking the same camera again (menu or placeholder) or Refresh retries a busy / refused camera; a track that ends while play() is pending says "unplugged" | fixed | `cam-r1/life2.mjs`, `life3.mjs`, `wedge2.mjs` |
| The notes list no longer waits for the OCR probe at launch | fixed | not run against a slow helper (`startupgate.mjs`) |
| Spurious ~~strike~~ / **bold** on plain prose, and arrows invented on tilted pictures | already fixed by the OCR lane (geometry padded, `TextAngle` undone: `deskew.ts`) | `spurious.mjs` 0 of 81, `tilt.mjs` |

## Pen capture, the sheet's side (wfin-ui, 2026-10-04)

| Item | Status | Evidence |
|---|---|---|
| The Tablet sheet consumes the native feed: tablet sample -> orientation -> sheet point -> real `pointerType:"pen"` events (pressure, side-button bits, tilt), the sheet's own handlers draw / erase / box; the real pen's DOM events are swallowed by the gate while capture is on | works with the fake backend; **no real pen moved** | `agents/e2e/wacom/penfeed.mjs` (corners of the tablet land on the sheet's corners in all four orientations; pressure ramp; lower = tap action, upper = select hold; gate; Send Writing; undo), `test/penFeed.test.ts` |
| Pen-operated strip INSIDE the sheet (Send Writing, Box, Erase, Undo, Clear, colours, width, orientation, Rotate ink, Release): drops down at the top edge or for 2.5 s at the start, goes up when the pen is below it; the pen clicks it through the synthesiser's click rule | works (the hidden strip is `visibility:hidden`, so it never takes a pen event) | `penfeed.mjs` section 4 (tap on Send Writing lands the stroke with pressures in the note sidecar) |
| Reach hint (hatched part of the sheet that lies outside this window: a tap there reaches another program) | mounted from the `dom` backend's cover/work facts; drawn only while capturing | `sheetReach.test.ts` (geometry only) |
| Tablet setup check card (Start, per-step countdown and live table, Skip, Cancel, verdict page, advice, Copy diagnostics, Reveal trace, Turn / Mirror the direction, Test driver mapping) | works against the fake backend | `penfeed.mjs` section 9 |
| The chip tells the truth, and why: tooltip lists Windows' view of the tablet (problem code / not listed) and every tablet backend's state ("Wintab: waiting, no samples yet", "Raw HID: failed - ...") | works | `penFeed.test.ts` (hudLines) |
| `pen-trace.jsonl` is written (open, live, samples, check events) | works; **no typed `session` / `raw` / `dom` records are written, everything is an `ev` line** (manager side) | `penfeed.mjs` section 10 |
| No overlay window, no full screen, mouse usable during capture | verified | `penfeed.mjs` section 6, `grab-fullscreen.mjs` (rewritten for capture) |

## Final gates (final-gates, 2026-10-04)

| Item | Status | Evidence |
|---|---|---|
| npm test, typecheck, locked build | green (100 files / 2246 tests) | local run |
| e2e cells, drawing, maths, pen, tablet, camera, editor | all pass; the tablet flow-chart checks pass, so `e2e/known-issues.json` is empty | `npm run e2e -- --suite ...` |
| editor/05-sidebar-drag | script fixed (root-list filter, section toggle); the app was right | `e2e/suites/editor/05-sidebar-drag.mjs` |
| Wacom fake-feed scripts (pen feed, flow, cursor, buttons, no full screen) | pass; `penfeed.mjs` trace check fixed (typed `k` records) | `agents/e2e/wacom/run-all.mjs --quick` |
| Real pen | still unverified (the setup check is gone: watch the status word and `pen.log` in the app's userData folder) | none |

**Pen fixes (wr-fix, 2026-10-04).** The system mapping cannot starve the data feed any more: packets reaching the system context while the data context is silent for 150 ms close it at once and remember "refused" (`mapping.ts` `systemPacket` / `dataSeen`; `test/pen/mapping.test.ts`). A half-done calibration survives a blur (the corner taps are real OS clicks) and a one-packet tap counts as a touch (`test/pen/calibration.test.ts`, `test/penManager.test.ts`, `agents/e2e/wr-fix/tap1.mjs`). Esc on the sheet only clears the box, it never releases capture (`wr-fix/esc.mjs`). The sheet host starts below the header (`--camera-top`), so no pen point of the tablet can hit a header button (`wr-fix/hit.mjs`); the red "nothing written yet" line sits above the note line and clears itself. pen.log: layout / context dump once per session, one short map-open / map-closed per judged visit, 200 lines reserved for errors (`test/pen/log.test.ts`). No guard process exists: comments, the `contextState` fact and the log no longer claim one.


## Camera and capture, third round: the Mac's camera commits after fe3ca0b (camera lane, 2026-10-05)

| Feature (Mac commit) | Status | Evidence |
|---|---|---|
| Input Devices ▸ Aspect Ratio (c98c067): Free, 1:1, 4:3, 3:4, 3:2, 2:3, 16:9, 9:16, ticked, remembered (`writemind.cameraAspect`, the Mac's raw values). The viewfinder is the largest rectangle of that shape in the pane, centred, black round it; the picture, the box, the corners and the zoom are laid out in it and measured against it. Not offered on the tablet sheet (it has the tablet's shape) | done. As on the Mac (`resizeAspect`) the picture is fitted whole inside the shape, so a shape mostly shows once zoomed. The sidebar's video popover does not list the shapes yet (Sidebar.tsx is the editor lane's) | `packages/core/test/cameraAspect.test.ts` (CameraAspectTests.swift), `apps/desktop/test/menu.test.ts`, `agents/e2e/camera-p3/camera-p3.mjs` section 1, shot `agents/shots/camera-p3-aspect-3x4.png` |
| Double-click the picture and the WINDOW is the picture (0edfc08): sidebar and notes out of sight (kept mounted), a faint ✕ over the top-left corner and a second double-click to come back; Hide Video (and the pane's own ✕) leaves it; filling it brings the video back; not remembered. One click with no box now takes the whole picture (the old double-click) | done. NOT the display: the e2e checks the window's bounds and `isFullScreen()` are unchanged. Port difference: the whole-picture box the first click of the double leaves is dropped (it is measured against the old pane size); the Mac keeps it | `cameraZoom.test.ts` (SectionBoxGestureTests), `camera-p3.mjs` sections 2-3, shot `camera-p3-full-window.png` |
| A capture lands the size the viewfinder showed it (32ad5e1): `PAGE_FRACTION` 0.42 to 0.9, the camera's and the tablet sheet's captures alike | done | `captureStroke.test.ts`, `capture.test.ts`, `camera-p3.mjs` section 4 (a whole-frame Page capture is 0.90 of the pane) |
| Traced writing is thinned to a third of its own measured stroke, floor 2 px, and cleaned again so stray grid dots go (159e0f6, 6685cb1): `inkStrokeWidth`, `thinnedInk`, `thinnedWriting` in `capture/ink.ts`, used by the camera's Writing trace (`cameraTake.ts`) | done. The tablet's Writing brings the pen's own strokes, so there is nothing to thin there | `captureStroke.test.ts` (the Swift tests, and the order clean / thin / clean), `camera-p3.mjs` (a 6 px pen on a dotted page traces at 2.5 px, no dot comes through), shot `camera-p3-captures.png` |
| Aa on a Page picture of the sheet's dot-grid paper (the Mac's `withoutDotGrid`) | a DIFFERENT code path from the thinning: Aa runs `prepareForReading` (`readingPageOf` + `paintOutDots`, which is the port's withoutDotGrid). Checked: the whole sheet's dots are found and painted out; a box under about half the sheet's height is not (its dots are over the lattice's size limit at that picture size). Left in docs/TODO.md | `apps/desktop/test/sheetPaperReading.test.ts` |
| The Pen popover closes on Esc and on a click outside; the Paper menu already did (checked, unchanged) | done | `camera-p3.mjs` section 5 |

Not verified: a real camera (Chromium's fake device only), the shapes on a real wide camera with zoom, Aa on a real Page picture.
Re-checked 10:56, 2026-10-05 against the 10:56 build in a second instance (camera-p4, port 9440): the lane's 7 vitest files 95/95, typecheck clean, `camera-p3.mjs` 37/37 PASS (the traced 6 px pen measured 2.52 px, no dot blobs), shots looked at.

## Export and keys: Mac e8b3266 "One list of every key, and an Export that asks what it is" (export + keys lane, 2026-10-05)

| Feature | Status | Evidence |
|---|---|---|
| File ▸ Export… (Ctrl+E), ONE command and one save panel; the panel's "Save as type" list is the Mac's Format popup (PDF, Project), the format read back from the answer's extension; a bare name gets the first offered format's extension; with no note open only Project is offered; disabled with no note and no folder | done (`packages/core/src/export/formats.ts`, `apps/desktop/src/main/exportFile.ts`, IPC `export:file`; the PDF is the existing `exportPdf.ts`). Port difference: Windows swaps only the extension when another type is picked, so a project exported with a note open is offered under the note's name (the Mac renames it to the project's) | `packages/core/test/exportFormat.test.ts` (ExportFormatTests.swift), `apps/desktop/test/exportFile.test.ts` (the last Swift test, and the flow with a fake panel), `agents/e2e/export/export-keys.mjs` (PDF by the menu, project by Ctrl+E, bare name → .pdf) |
| An exported project is the folders and the excluded ones, no note, and the open project keeps its own file | done (`writeProjectFile` = `stringifyProject`) | same; the e2e reads the written file back |
| ONE LIST OF EVERY KEY: `shared/commands.ts` is the table; Help ▸ Keyboard Shortcuts (F1; the Mac's help key is ⌘?) shows it by menu (`shared/keyList.ts`, `renderer/KeyList.tsx`); `docs/KEYS.md` "Every key" is it row for row | done | `apps/desktop/test/keyList.test.ts` (ShortcutTests.swift: no two commands want one chord on win32 or darwin, the keys Sean asked for, the ladder, Save vs Save Project, KEYS.md is exactly the list, no editor keymap chord outside the table and every editor-owned key heard; plus the list = the menu bar's groups); e2e: F1 opens 66 rows in the bar's order, Esc and F1 close it, shot `agents/shots/export-keys-list.png` |
| The Mac's new keys: Save Ctrl+S (writes now), Export Ctrl+E, Markdown ⇄ rendered Ctrl+T, Sidebar Ctrl+K, Video Ctrl+Shift+Y (⌘Y; Ctrl+Y stays Redo on a PC), View ▸ Draw / Stop Drawing Ctrl+P (the same writer as Pen ▸ Pen Down), Collapse Subsections Ctrl+; — Save Project stays Ctrl+Shift+S | done; MOVED, not added (the old chords are free) | `keyList.test.ts`, `menu.test.ts`, `findKeys.test.ts`; the e2e presses every one with real CDP key events (Ctrl+S: on disk within 120 ms) |
| Gone on Sean's word: the Notes Pane and Markdown Markers keys, Delete Cell's ⌃⌫, the caret's own Fold / Unfold Section (and their menu items); Use Selection for Find gave Ctrl+E to Export | done | `keyList.test.ts` "gone, on his word" |
| ⌘; Collapse Subsections: folds what is UNDER the held cells (or the caret's cell), never the cell's own section; one key both ways | done (`packages/core/src/cells/subsections.ts`, a case in `editorCommands.ts`) | `packages/core/test/subsections.test.ts` (the NotebookOutlineTests.swift additions); e2e: Ctrl+; hides First / Deeper / Second and keeps Top, again opens them, shot `agents/shots/export-keys-collapsed.png` |
| Ctrl+Shift+Y was swallowed as Redo by `useUndo` (it took any Ctrl+…+Y) | fixed: only Ctrl+Y without Shift is Redo | `agents/e2e/export/redo-and-foldall.mjs` (Ctrl+Y and Ctrl+Shift+Z still redo) |

Re-checked 10:56 the same day, after the other lanes' edits had landed in the shared files: the six vitest files (56 tests), typecheck, a locked build, and both `agents/e2e/export/*.mjs` on instance export-a (port 9445) ALL PASS; the list now has 67 rows (the evaluation lane's Ctrl+9 joined Format, and KEYS.md with it).

The repo e2e suites that pressed the old chords were updated (`e2e/suites/chrome/01`, `02`, `03`, `e2e/suites/editor/03-fold`) and not run here (the gate runs them). Not verified: the real Windows save dialog (the e2e answers it ahead of time through `askSave`), so the type list's look and its extension swapping are Electron's behaviour, not seen.

## Cell furniture: brackets, seams, held cells (cells lane, 2026-10-05)

Mac f6d2714, 17f0f82 (the source-pane parts), 2ea0dcb, and the held-cell item of "Next steps". Sean had called the
cells "very bad, things don't line up"; a note with sections four deep, lists, to-dos, code and maths was measured
and photographed at 100% and at 1.5x (Emulation deviceScaleFactor), before (`agents/shots/cells/before-*`) and after.

| Feature | Status | Evidence |
|---|---|---|
| A hover in the gutter promises what a click would take (f6d2714): the bracket under the pointer lights (accent, +0.6 weight) and the cells a click there would take are washed at accent 12% over the words, margin to margin, each box exactly its bracket's height; a section's wash includes its heading. Hover and press ask the same two functions (`bracketAt`, `takes` in `packages/editor/src/brackets.ts`), so they cannot disagree. One gutter serves both modes here, so the rendered page has it too | done | `packages/editor/test/cellBrackets.test.ts` (CellBracketKindTests.swift: testAHoverPromisesTheCellsAClickWouldTake, testNestingDeeperThanTheColumnSharesTheLastLine, plus the hit-test); `agents/e2e/cells/furniture.mjs` sections 4-5 and 6b (hover "## Lists": 7 washed boxes = the 7 cells the click then holds, both modes, both scales); shots `furniture-hover-section-dpr1{,.5}.png`, `furniture-hover-section-rendered.png` |
| One owner for the bracket column (17f0f82, source pane): the gutter alone answers there, the hand over a bracket and the arrow beside one, from the same reader as the click (was: CSS `:hover` on a 5 px box while the click reached 7 px either side of the line); the seam layer no longer lights a bar, sets row-resize or arms a bar while the pointer is in the column. A to-do's box already took the hand | done. The Mac's hit reach (4 px) replaces the port's 7 | `furniture.mjs` section 3 and 4 (cursor default / pointer, no faint bar at a seam's height in the column) |
| Brackets on their cells: border-box, so a lit or hovered bracket no longer grows 2-4 px past its cell's last line; depth clamped to the column (`DEEPEST`, the Mac's), so a cell under four headings is drawn inside the gutter instead of over the words; the Mac's weights (cell 1.1, section 1.5, lit +1.2) and its tertiary-label colour (text at 26%), which reads in dark mode | done | `furniture.mjs` section 1: every cell bracket's ticks within 0.6 px of its first / last line box, every bracket inside the gutter, at 1x and 1.5x; seams (section 2): each bar within 1.5 px of its gap's middle |
| Held cells drawn as cells (the "Next steps" item): line decorations from the cell's first line to its last, the selection colour, margin to margin (CodeMirror drew the first lines out to the window's edge and under the brackets and the last only as wide as its words), with the range carets and the selection layer put away while cells are held (on the rendered page too, where a caret stood at the end of every lit block) | done | `furniture.mjs` section 5 (7 boxes, each starting where its washed box did, left/right at the margins, layers hidden); shots `furniture-held-section-dpr1{,.5}.png`, `furniture-held-section-rendered.png`, `light-held-hover.png` |
| A selection inside a code block was invisible (the code lines' opaque background covered CodeMirror's selection layer); every selection now stops at the page's margins instead of running under the brackets | fixed: the code background is the text colour at 5.5% (the token's shade, see-through); the selection layer is clipped to the margins | `furniture.mjs` section 6, shot `furniture-code-selection-dpr1.png` |
| The add row's two icons are one height (2ea0dcb): one constant for both, and the folder drawn top to bottom like the page beside it (it stopped half a pixel short at each end) | done | `furniture.mjs` section 7 (the shapes' drawn heights equal) |

Also run, unchanged and passing against this build: `e2e/suites/cells/01-brackets-and-clipboard`, `02-selection-and-drag`,
`03-seams` (61 checks). Not verified: a real mouse over the gutter (CDP mouse events only); the light theme was looked at once
(`light-held-hover.png`), not measured.


## Evaluation cells: cells that run (eval lane, 2026-10-05)

Mac 0bf52b5, 765195a, 4fad93e, 799b13b, fe14417, 29149b9, df166db, 859aa6c, and two of Sean's asks from the Mac's open
TODO a608cc3. Model: `packages/core/src/eval/` (evaluator, output, cells, run); runner: `apps/desktop/src/main/eval/`
(`runner.ts` is the ONLY eval file that starts a process); editor: `packages/editor/src/eval/index.ts`; app:
`renderer/evalHost.ts`, `shared/eval.ts`. Unit: `packages/core/test/evaluationCells.test.ts` (46: EvaluationCellTests.swift
and the CellTypeTests evaluation cases), `apps/desktop/test/evalRunner.test.ts` (20: the runner with its process layer
faked, and the source scans), `packages/editor/test/evalCells.test.ts` (4). E2E: `C:\CLAUDIO\agents\e2e\eval\run.mjs`
(28 checks, port 9420); shots `C:\CLAUDIO\agents\shots\eval\`.

| Feature | Status | Evidence |
|---|---|---|
| An evaluation cell is its own fence (`eval python`, `eval wl`, `eval c`, `eval c++`, `eval rust`); a plain code cell never runs; `wl` alone stays maths; the body is coloured for its language (the markdown side, the rendered page and the PDF all ask `colouring`) | done | core test; e2e 6 (Shift+Enter in a `python` cell is a newline); shot `1z-marks.png` |
| Shift+Enter runs THAT cell, in both modes; not a menu key. The answer is an `out` cell under it, replaced on a re-run (found by position, vetoed by the tag, blank cells in the gap stepped over); `[no output]`, `[stderr]`, `[exit n]`, `[timed out]`, `[output cut at 64 KB]`; a fence-closing line escaped; CR LF taken off; Ctrl+Z takes the answer out | done; **Python run for real** (the py launcher, 3.14 here) | e2e 1, 2, 7 (`print(2 + 2)` gives `4`, UTF-8 intact; a re-run replaces; the rendered page runs too) |
| The bar is left under the answer (caret on the blank line, armed; at the end of the note armed by hand), scrolled to only when off the page | done; the scroll is CodeMirror's "nearest", not the Mac's animated landing low | e2e 1 |
| The runner: main process, `child_process.spawn` with no shell and an argument array, stdin the null device, a replaced environment (Windows' folders, TEMP, home and app-data, the PATH, a VS prompt's INCLUDE/LIB; nothing of WriteMind's own), 20 s timeout, 64 KB cap, a tree kill (`taskkill /T /F`) on timeout, cap, cancel, note close, window close and quit, the scratch folder removed every time; a test host (vitest) never reaches the real spawn | done | runner test (timeout, cap, cancel, cancelAll, could-not-start, test host); e2e 8 (the spinner stops a `time.sleep(25)`) and 9 (opening another note killed the Python child: `tasklist` back to its count); no stray `WriteMind-eval-*` folder or python process afterwards |
| Tools found on the PATH by name (`py`/`python3`/`python`, `wolframscript`, `gcc`/`clang`/`cl`, `g++`/`clang++`/`cl`, `rustc`), plus rustup's `~\.cargo\bin`, WolframScript under Program Files and the Wolfram Engine's own copy (`Wolfram Research\Wolfram Engine\<version>\wolframscript.exe`, newest version first; eval-marks lane); the Store's `python.exe` placeholder last; only `.exe`/`.com` (never a `.cmd` shim) | done (port-only: the Mac lists absolute paths) | runner test "finding the tools" (+ the engine-folder case); e2e `eval-marks\run.mjs` found Engine 15.0's `wolframscript.exe` on this machine |
| C, C++ and Rust compile then run (the standard named: `-std=c17`, `-std=c++20`, rustc `-O`; `cl` gets `/std:c17 /Fe:`); a failed build is the answer; warnings kept. Wolfram through `-code`, a trailing `Null` dropped, "not activated" and "kernel not found" told apart by stderr | built; C, C++, Rust **not run on this machine** (no gcc, clang, cl or rustc here). Wolfram: the Engine (15.0) is installed but **not activated**; a real `1 + 1` cell reached it and came back with the "not activated" stderr and the runner's activation note, as designed | runner test with the process layer faked (argument arrays, build-then-run, the notes); e2e `eval-marks\run.mjs` (shot `wolfram-run.png`) |
| Refusals said plainly beside the cell (a notice under it; gone on the next edit, a click, or after 9 s), never as an `out` cell: a missing tool (what was looked for, and where), an unknown environment (the list generated), an unclosed fence | done | e2e 3, 6; shot `2z-badge.png` |
| The mark in the page's LEFT MARGIN: the environment as a button (`WL ▾`, `PY ▾` …) until the cell has run, then `In[n]` over the code and `Out[n]` over the answer (n is the pair's place in the note); there while the cell is typed in, in both modes; a spinner while it runs (a click stops it); a missing tool's badge amber and dashed, its menu row "not installed" | done; **differs from the Mac on purpose**: the Mac's mark is a 44 pt column in FRONT of the cell; here it overlays the margin, so an evaluation cell starts at the same x as every other cell (Sean's a608cc3 ask "align further to the left but keep the cell start the same"). The language under `In[n]` and the wider margin: see "In/Out marks" below | e2e 1, 4, 7; shots `1z-marks.png`, `5z-marks.png`, `3-menu.png`, `6-running.png` |
| The mark's menu picks the environment (rewrites the fence only); a NEW evaluation cell is Wolfram until one is picked, then the last one picked (Sean's a608cc3 asks, not built on the Mac) | done | e2e 3, 4 (`localStorage` `writemind.evaluator`) |
| LANGUAGE ICONS (Sean's a608cc3 ask "use icons for WL, CPP, Python", 2026-10-07): the mark of a cell that has not run, the language under `In[n]` and the Runs As rows draw the language's ICON instead of `WL` / `PY` / `C` / `C++` / `RS` (a spiky star, two snakes, a hexagon with a C, the same with `++`, a cog): our own simple drawings on a 16 x 16 grid (`core/eval/icons.ts`, no files, no network), filled or stroked in `currentColor` so grey / accent-on-hover / amber-for-missing and the dark theme all follow; 14 px, the soft text colour rather than the faint one (a drawing needs more contrast than a letter). The letters stay as the control's `aria-label` (`Python (PY)`), `data-eval-letters` and the tooltip; a fence the app cannot run keeps its `—` as text. Clicking, the menu, the spinner and the amber state are unchanged. **Differs from the Mac**: its mark is still letters | done | `languageIcons.test.ts` (5); e2e `cells/08-language-icons.mjs` (46: icons, no letters drawn, names, 12 px+, currentColor, light and dark, amber, menu, rewrite, In[n]); shots `08-language-icons__light/dark/menu/ran.png` |
| C, C++ and Rust RUN FOR REAL on a Mac (2026-10-07: clang as `gcc` / `g++`, Apple clang 21, rustc 1.97 from `~/.cargo/bin`, under the Finder's bare PATH too): a value printed, a warning beside a clean run, a compile error, an exit status, a crash, a panic, stdin at EOF, output past the cap, a loop that never ends (20 s timeout, killed), a cancel. FIXED: (1) a program killed by a signal (`abort()`, a segfault, an uncaught C++ exception) came back with NO status and read `[no output]` — it now says `[stopped by SIGSEGV (segmentation fault)]` (`EvalResult.signal`); a Windows crash status says what it is (`[exit 3221225477: access violation]`, a table of six NTSTATUS values; written, not seen on Windows); (2) a compiler's diagnostics, a panic and a Python traceback named the file by its scratch-folder path (`/var/folders/…/WriteMind-eval-x/cell.c:2:11`) and now say `cell.c:2:11` | done on the Mac; **Windows unproven** | `evaluationCells.test.ts` (+1), `evalRunner.test.ts` (+2); `apps/desktop/scripts/check-compiled.ts` (by hand, real compilers); e2e `cells/09-compiled-cells.mjs` (18 real Shift+Enter runs) |
| Ctrl+9 (Format ▸ Evaluation Cell, the Mac's ⌘9): at a bar the cell is made THERE with the caret in it (29149b9); in a fenced cell it converts that cell, keeping the code; anywhere else a new cell after it, caret inside; not on the + menu | done | e2e 3, 5; core test (CellTypeTests); `menu.test.ts`, `keyList.test.ts` |
| The In/Out pair is one bracket in the gutter at the pair's depth, 3 px proud at each end, its two cells one step in; not a cell to any gesture (`isCell`) | done (a small edit to the cells lane's `brackets.ts`) | `evalCells.test.ts`; e2e 1; shot `1z-gutter.png` |
| Language icons instead of letters (a608cc3) | not built (letters, as on the Mac) | docs/TODO.md |
| The Mac's per-tool path override (`evalTool.<name>` in its defaults) | **built as a port-first screen**, File ▸ Language Setup… on all three platforms (2026-10-06; see "Language Setup" below). **Differs from the Mac on purpose**: a chosen program is the ONLY one its language uses, and one that has gone is refused with a sentence naming its path and Language Setup — the Mac's `Evaluator.tool()` falls through to its candidates | "Language Setup" below |

Not verified: a real keyboard (CDP key events only); C, C++ and Rust running for real (only the faked process layer),
and a Wolfram cell giving an answer (the Engine is not activated); the quit path with a run in flight (`cancelAll` is
unit-tested, and `before-quit`, `will-quit` and `window-all-closed` call it).

### In/Out marks: the language beside In[n], one clean column (eval-marks lane, 2026-10-05)

Sean, 2026-10-05: "show language "WL" or "PY" next to In[] and keep the In/Out indentation clean". No Mac commit (the
Mac still shows `In[n]` alone in a 44 pt column in front of the cell). Code: `packages/editor/src/eval/index.ts`
(`EVAL_MARGIN`, the marks), `markLanguage` in `packages/core/src/eval/cells.ts`. Unit: `evaluationCells.test.ts` (+1),
`evalCells.test.ts` (+1), `evalRunner.test.ts` (+1). E2E: `C:\CLAUDIO\agents\e2e\eval-marks\run.mjs` (139 checks,
port 9421; the eval lane's `eval\run.mjs` re-run there, 27/27); shots `C:\CLAUDIO\agents\shots\eval-marks\`.

| Feature | Status | Evidence |
|---|---|---|
| After a run the code's mark is `In[n]` with the cell's language UNDER it (`WL`, `PY`, `C`, `C++`, `RS`, the Mac's `Evaluator.badge`); `Out[n]` names none; a cell that has not run shows its language as the button (`PY ▾`), and the language under `In[n]` opens the same menu | done. Under rather than after: `In[3] PY` beside `Out[3]` puts the two brackets three characters apart and would need a margin for `In[100] C++` (~55 px); stacked, one column holds every mark with the brackets in line | e2e "the language under In[n]", "Out[n] names no language", "clicking PY under In[101] opens the menu"; shots `1x-source-9-10.png`, `run-101-menu.png` |
| Every mark is 9 px (none shrunk), right-aligned on ONE column, on the baseline of its cell's first line; In and Out text start at one x, the paragraphs at the same x (source) or at the boxes' edge (rendered: code in a box is inset by the box's padding, as in every code cell); checked for n = 1, 2, 9, 10, 99, 100, 101 and an unrun cell, both modes, at 1x and 1.5x device scale | done | e2e (baselines measured off the text within 0.75 px, right edges within 0.5 px); shots `1x-*.png`, `15x-*.png` at 2x |
| A note that holds an evaluation cell has a 48 px left margin (30 elsewhere) so `Out[100]` fits at full size; the text, the selection's clip and the hover wash all follow; a note with none keeps 30 px, so the words under existing ink in ordinary notes do not move | done; the text of a note moves 18 px right when its FIRST evaluation cell appears (ink placed earlier stays put) | `evalCells.test.ts` (the class only with an eval cell); e2e "a note with no evaluation cell … where they always did" |
| The spinner sits on the second row, so `In[n]` never moves while a cell runs | done | shot `running.png`; eval e2e 8 |
| Gate fixes (2026-10-05): (1) a note put away while a cell ran comes back with nothing "running" (the stashed state kept `running`, so the spinner turned for ever and Shift+Enter did nothing): the plugin clears a stale run when a view is built; (2) an older pair (```` ```python ```` over ```` ```out ````, no `eval` fence) keeps the 30 px margin and its `Out[n]` is sized to it (`markColumn`) instead of drawn over the words; (3) the marks measure nothing in a note with no evaluation cell or answer; (4) a child that exits while a grandchild holds its pipes settles the run after 750 ms and is never killed by its stale PID; (5) the "not activated" sentence names the wolframscript that was found, quoted (the Engine's installer leaves it off the PATH) | done; the margin that moves a note's words when its first eval cell appears is **Sean's decision** (`docs/TODO.md`, Evaluation cells (5)) | `evalCells.test.ts` (+1, the column), `evalRunner.test.ts` (+1 orphan, activation path), `evaluationCells.test.ts` (activation path); e2e `C:\CLAUDIO\agents\e2e\gate\smoke.mjs` ("coming back, no spinner…", "Shift+Enter runs that cell again", "its Out[1] ends before the words begin"); shots `C:\CLAUDIO\agents\shots\gate\` |

### Language Setup: the per-tool override, as a screen (2026-10-06)

Sean, 2026-10-06: "on all platforms there should also be a language setup options screen from the menu bar which makes
it easy to set up or point to a WL / python environment for WriteMind to use", and a Wolfram Language / Python setup on
Windows. The Mac's equivalent is `defaults write com.seancheren.WriteMind evalTool.<name> <path>`, read in
`Evaluator.tool()` (`WriteMind/Eval/Evaluator.swift`), with no screen; this one is port-first. Code: `shared/languages.ts`
(the settings file, the picker, the setup sentences), `main/eval/languages.ts` (the store and the IPC),
`main/eval/tools.ts` (`toolEntry`, `resolveChoice`, `choiceProblem`, `foundTools`, `wolframLicence`),
`main/eval/runner.ts` (`identify`, the chosen tool's folder on the PATH), `main/toolSetup.ts` (Windows),
`packages/core/src/eval/probe.ts`, `renderer/LanguageSetupDialog.tsx` + `languageSetupView.ts`. Unit:
`evalProbe.test.ts`, `toolsChosen.test.ts`, `languages.test.ts`, `languagesIpc.test.ts`, `toolSetup.test.ts`,
`languageSetupView.test.ts`, and additions to `evaluationCells`, `capabilities`, `evalRunner`, `helpers`, `menu`,
`notesFolderMove`, `evalCells`. E2E: `e2e/suites/languages/01-language-setup.mjs` (written; not yet run).

| Feature | Status | Evidence |
|---|---|---|
| File ▸ Language Setup… on Windows, Mac and Linux, after Clean Up Unused Files…, no key, never greyed; also Runs As ▸ Language Setup… on a cell's mark, opening at that cell's language | built | `menu.test.ts`; e2e |
| A program chosen there is the ONLY one its language uses (userData/`languages.json`, version 1); one that has gone, or is not a program, is refused before anything starts with "Python is set to “…” in Language Setup, which is not there any more…"; the mark's tooltip, the Runs As row ("not there") and the refusal are one builder (`missingToolRefusal`) | built; **differs from the Mac** (`evalTool.<name>` falls through) | `toolsChosen.test.ts` (BREAK-IT: no fallback), `evalRunner.test.ts`, `evaluationCells.test.ts` |
| A choice applies at the next run with no restart (the places are read per run; the store re-reads the file when its time or size moves, so a hand edit or the notes-folder move applies too); open notes' marks follow the push at once | built | `languagesIpc.test.ts`, `notesFolderMove.test.ts`, `evalCells.test.ts` (`followTools`) |
| `languages.json` held by another program or unreadable: the choices last read stay the choices and no choice is written until it reads again; if nothing was ever read, every language refuses ("WriteMind could not read Language Setup's choices…", Runs As "not known") rather than run what it finds by itself | built | `languagesIpc.test.ts` (BREAK-IT, the written content asserted), `toolsChosen.test.ts`, `evaluationCells.test.ts`, `languageSetupView.test.ts` |
| Choose… (a file, a venv folder, the Wolfram Engine's `.app`; a link kept as the link on a Mac), checked by name and shape, then asked its version (`wolframscript -version`, `--version`, Python's version and path) before it is saved; Python 2, the Store placeholder (9009) and Apple's stand-in (needs the Command Line Tools) refused by name | built | `toolsChosen.test.ts`, `evalProbe.test.ts`, `languagesIpc.test.ts`, `languages.test.ts` (picker) |
| Also on this computer: the other copies found by themselves, one click to Use (a link and its file once — but a venv, whose `bin/python3` links to its base interpreter, is told apart by its `pyvenv.cfg` (`toolIdentity`), so the base stays listed; the Store alias never offered) | built | `toolsChosen.test.ts` (`foundTools`, BREAK-IT), `languagesIpc.test.ts` (BREAK-IT) |
| A Python found by itself that is only a stand-in, told from the file system without running it (`pythonStandIn`): the Store's WindowsApps shortcut, a `py.exe` with no `Python3NN` folder or other python.exe, Apple's `/usr/bin/python3` with neither the Command Line Tools' nor an Xcode's python3: said in amber with Install Python… / Get Python… (and `xcode-select --install`); Apple's real one offers Get Python… too; an install that leaves only a stand-in is not "Python installed." | built | `toolsChosen.test.ts`, `languagesIpc.test.ts` (BREAK-IT), `languageSetupView.test.ts` (BREAK-IT) |
| Test runs a fixed program (`TEST_SOURCE`) through the runner, never a note's text; nothing is started when the screen opens | built | `evalProbe.test.ts`; `evalRunner.test.ts` source scans (`runner.run(` only in ipc.ts and languages.ts; the page's calls only from `onClick`) |
| A chosen tool's folder goes first on the child's PATH (a venv's `bin`, MinGW's DLLs); a tool found by itself leaves the PATH as it was | built | `evalRunner.test.ts` (BREAK-IT) |
| Wolfram not activated (no `mathpass` where activation leaves one): Activate… on Windows, the command to type elsewhere (bare on a Mac/Linux path: `& "…"` is a zsh parse error, fixed in `wolframCommand`) | built | `toolsChosen.test.ts` (`wolframLicence`), `languageSetupView.test.ts`, `evaluationCells.test.ts` |
| Windows: Install Python…, Install Wolfram Engine… and Activate… run the installer's own `installer-tools.ps1` (`-FromApp`, copied beside the app by build.mjs) in a console of its own — opened by a hidden PowerShell's `Start-Process`, not by a `detached` spawn (which gives a console program no console); offered only with the script and winget; Get Python… / Get Wolfram Engine… (the download page) everywhere else. What a setup window said shows in the dialog that started it, beside the offer to try again (the licence notice kept), and a sentence about something not there yet goes once it is | built; the ps1 changes and the window itself **not yet run on Windows** (no PowerShell on the Mac that built them) | `toolSetup.test.ts` (the command line read back), `helpers.test.ts`, `capabilities.test.ts`, `languages.test.ts` (`setupSentence`), `languagesIpc.test.ts`, `languageSetupView.test.ts` |
| The keyboard stays in the dialog: a press that takes away its own button (Find Automatically, Use, Install…, Choose… while it checks) gives the focus back to that row's Choose… (Stop while busy) or Done, so Escape still closes it | built | `languageSetupView.test.ts` (`keyboardHome`, a scan of the dialog); e2e (no hand-placed focus before the last Escape) |
| The Mac's DMG Wolfram Engine (`/Applications/Wolfram Engine.app/…/Wolfram Player.app/Contents/MacOS/wolframscript`) found by itself | built (measured: Homebrew's link points at it) | `toolsChosen.test.ts` |

Not verified: the screen on screen (not launched in the lane that built it); the e2e suite; a cold Wolfram Test on
Windows against the 20 s limit; the Linux licence path; a conda environment's `Library\bin` on the PATH (not added).

## The rendered page edits what is written (preview lane, 2026-10-05)

Mac 0fdd031 "The rendered page edits what is written, not the markdown round it", 0cde812 "keeps the source pane's
rhythm", e66379c "A code cell is a box round its code", b98a7a5 "moves for a finished cell only when it has to" — inside
the port's one-view design (the open block is still the note's own characters; furniture is decorations plus a
transaction filter, not a second editor). Unit: `packages/core/test/cellFurniture.test.ts` (16: CellFurnitureTests +
the furniture half of MarkerHidingTests), `listEditing.test.ts` (16: ListEditingTests), `preview.test.ts` (PreviewLayoutTests /
PreviewSeamTests changes: blockGap, onScreen, code padding), `packages/editor/test/previewFurniture.test.ts` (10: the
filter, paste, put-away). E2E: `C:\CLAUDIO\agents\e2e\preview2\furniture.mjs` (42 checks, port 9425); shots
`C:\CLAUDIO\agents\shots\pv2-*.png`.

| Feature | Status | Evidence |
|---|---|---|
| Furniture: on the rendered page a heading's hashes are hidden even on the caret's line, a bullet stays a bullet (`* ` a dash, as the Mac's BulletGlyphs), a to-do's box stays a box; the caret is pushed out of the front of any of them (click on the left edge, Home, arrows) and Left from the first word steps over; Backspace behind one takes the whole piece (after an outdent) | done | `cellFurniture.test.ts`, `previewFurniture.test.ts`; e2e "Home lands…", "Backspace behind the hashes…", "…a number takes the whole number"; shot `pv2-heading-open.png` |
| A checklist edited one item at a time with its boxes intact: the open list is set out like the drawn one (words within 2 px, same rows, nothing below moves); Backspace at a to-do's first word joins it to the one above, in an empty to-do removes it; Return makes the next to-do unticked; a tick in the open list keeps the caret; a paste into a to-do is one line | done. Differences: one view, so every item of the open list is typeable (the caret is in one); Return in an empty to-do ends the list; Delete at the end joins the next | `listEditing.test.ts`; e2e checklist section; shot `pv2-checklist-open.png` |
| Escape in an open block closes it (drawn again, caret put away); the next arrow/Home/End only brings it back | done | `previewFurniture.test.ts`; e2e; shot `pv2-away.png` |
| A kind command at a bar makes that cell there now (Ctrl+1…7, lists, quote, code) | done; a command with NO kind (bold) still does nothing at a bar | e2e "Ctrl+1 at the bar…"; `e2e/preview/bars.mjs` updated (Quote button) |
| The I-beam over a drawn block's words | already so (`cursor: text`) | — |
| The page's rhythm: the gap between cells is a blank line of the markdown side (21.75 px, was 8); a touching cell carries the same gap; a rule is 9 px; heading ladder = the Mac's RENDERED one (28/22/18/16/15/17) on drawn AND open headings | done | `preview.test.ts`; e2e first section; `e2e/preview/toggle.mjs` (switching modes keeps the top cell: needed a sub-pixel tolerance in `topCell`) |
| A drawn code block pads by half its text (7 px, 12 px sides); an open one is the same box (fences shut to the padding, opened on the caret's line for the language; since 2026-10-05 Up/Down never stand on them, Left/Right reach the opening one: see "Rendered-page arrows skip code fences") | done | `preview.test.ts`; e2e "an open code block moves nothing below it"; shots `pv2-code-open.png`, `pv2-fence-here.png` |
| `PreviewLayout.onScreen` (b98a7a5) | ported as `previewOnScreen` + tests; the carried 0.22 s landing is not built (the eval lane's bar uses CodeMirror's nearest scroll) | `preview.test.ts` |

Also run against this build, one at a time: `e2e/preview/{open,edit,bars,ticks,format,toggle,held,nav,maths,only,perf,fuzz}.mjs`
all pass; `misc.mjs` fails its two checks that need `Other.md` and `pic.png` in the notes folder (not in a fresh instance).
Not verified: a real mouse/keyboard (CDP events only); the light theme; the PDF export's gap (still 8 px, export lane).

## Editor performance (perf lane, 2026-10-05)

Sean: "this version runs like shit". Port-only (the Mac has no equivalent pass). Measured, not guessed, in one isolated
instance on this PC (i7-14700F, 59 Hz) with a 3509-line note: 301 sections two deep, lists, to-dos, python and ```wl
blocks, inline maths, pictures, and 500 pen strokes. CDP real input (`Input.dispatchKeyEvent` then two frames;
`mouseWheel` steps), CDP Profiler and Tracing for the hot functions. Median / p95; two frames here are 33-35 ms.

| Feature | Status | Evidence |
|---|---|---|
| Wheel scrolling a long note: the drawing layer was cleared and painted again on every scroll step, blank or not; with ink on the page ANY per-frame change to it (a repaint, a blit, even a CSS transform) cost a missed frame. A blank layer is now left alone, and the committed-ink canvas lives INSIDE the editor's scroller, three panes tall, so the browser scrolls it with the words and it is painted again about once a pane (`Canvas.tsx`, `band`). The ink no longer trails the words by a frame | fixed. 240 wheel steps, frames that missed the display: no ink 198 of 736 (27%) -> 65 (9%); 500 strokes over the note 197 -> 67. A bare CodeMirror with the same text: 71-86 | `e2e/suites/perf/02-long-note.mjs` (blank layer never cleared while scrolling; with ink, painted again 14 times in 120 steps, not 120; ink still under its strokes' points after scrolling; dropped share < 20%); `drawing/02-pictures`, `03-ink-select-transform`, `05-hidpi` pass (their pixel probes now read `.wm-ink`); a pen stroke drawn under a heading on a scrolled note stays under it after a further scroll (looked at) |
| Typing in the long note (markdown page, rendered page, with 500 strokes) | at the display's floor, before and after: key to painted 35.2 / 36.0 ms (35.2 / 36.2), rendered 35.2 / 36.3 (35.3 / 36.3), 500 strokes 35.2 / 36.1 (35.4 / 36.2). Main thread per keystroke ~8.6 ms (9.4-9.9), ~3 ms of it script; a bare CodeMirror 5-6 ms | `02-long-note.mjs`; scratch bench (bench.mjs) |
| Enter / Backspace at a section boundary | at the floor: Enter 35.7 / 48.7 (34.1-39.0 / 43.7-48.9 over three baseline runs), Backspace 34.7 / 36.5 (35.2 / 36.3) | `02-long-note.mjs` |
| Opening the note, switching tabs, toggling the rendered page (click to painted) | unchanged: open 72.6 / 74.5 (59-70 / 72-74), tab 65.5 / 69.9 (50-66 / 69-71), toggle 48.8 / 56.3 (35-41 / 50-58) | scratch bench |
| A keystroke rebuilt every bracket below the caret (a cell's key is its start, so every key below moved): 8 removals, 8 insertions, 32 attribute writes per keystroke. The gutter's elements are reused by position; an edit that moves no bracket on the screen writes nothing | fixed | `02-long-note.mjs` (0 mutations in the bracket column over 10 keys); `cells/01`, `cells/02`, the cells lane's `furniture.mjs` (41) pass |
| Every keystroke made a new widget for every ```wl block of the note and CodeMirror compared the two sets end to end: the blocks are now carried through an edit (`carriedBlocks` in `math.ts`) unless a block's maths, its fence or its source/typeset state changed | fixed: 0.16 -> 0.07 ms of script per keystroke | `packages/editor/test/mathBlocks.test.ts` (carried, positions right, rebuilt when the maths changes or a fence breaks) |
| Rendered page: CodeMirror's `heightRelevantDecoChanges` compares a block-decoration set end to end on every keystroke (0.58 ms per keystroke here, growing with the note); the In/Out marks (`eval/marks`) read `getBoundingClientRect` in the measure's write phase, a forced layout per keystroke (~0.17 ms) | open: other lanes' files | `docs/TODO.md` |

Not verified: a real wheel / trackpad (CDP wheel events), a 150% display, a slower machine, the camera pane with a live
camera (no camera in the instance; the tablet sheet idles at ~2 ms of main thread a second).

## Docking and ink cells: the model (core lane, 2026-10-05)

Sean, 2026-09-22 (dock floating pictures into the note) and 2026-10-05 (editable ink cells). Spec: the Mac's
`C:GITWriteMinddocsPLAN-docking.md` (planned, not built on the Mac) and `docs/PLAN-docking-ink-cells.md`. This
section is `packages/core` only; the widgets (editor lane) and the gestures, IPC and PDF wiring (dock lane) have their own.

| Feature | Status | Evidence |
|---|---|---|
| The Mac's planned `MarkdownImages`: the docked line `![](<../>*.drawings/media/<file>)`, a line that is nothing but one image, the note's own media file of a path (basename; `../` for notes in section folders), every own media file a note names | done (`markdown/images.ts`) | `markdownImages.test.ts` |
| An ink cell's line `![ink](<../>*.drawings/media/ink-<uuid>.svg)`, known by its file name only | done | `markdownImages.test.ts` |
| The `picture` block: a line that is one image is its own cell (splits from a paragraph line above or below, Mac rule; an image in a list item, a quote, words or a fence stays where it is); the incremental parse agrees with the whole one | done | `parserPictures.test.ts` (1600 random edits) |
| Cell kinds `{ kind: "ink" }` (+ menu's last group, "Drawing Cell"; the app makes it) and `{ kind: "picture", line }` (the dock at an armed bar goes through `openCell`) | done | `parserPictures.test.ts` |
| A picture / ink cell never opens, never joins a run of touching cells, can be held, and Return beside it opens a cell above or below instead of splitting it (`staysClosed`, new optional `apart` argument of `touchingRuns` / `cellStates` / `cellStatesSparse`) | done in core; the editor passes `apart` | `parserPictures.test.ts` (dense = sparse on random notes) |
| The ink cell as ONE drawing item `{ kind: "cell", cell: { id, aspect, items } }`: written and read by the same per-item reader (a damaged item inside is dropped and counted), hidden on the page, kept by every core edit, an arm in every `switch (item.kind)` | done | `drawingCells.test.ts` |
| The cell model: items in fractions of the cell's width on both axes; page → cell a pure translation; a new cell from page ink (place kept, fitted, scaled down when too wide, `INK_PAD`, at least `INK_MIN_HEIGHT`); docking into a cell (centred on the release, clamped, the cell grows); `dockable` (one picture → picture cell; ink and pictures → ink cell; nodes or arrows → none); `minAspect` | done (`drawing/inkCell.ts`) | `inkCell.test.ts` (bounds and outlines to 0.01 px on a 1000 × 400 pane, rotated and scaled items) |
| Media lifetime: no sweep exists; the rule for one is `mediaInUse` (markdown AND sidecars of every note) | rule written, nothing deletes | `inkCell.test.ts` |
| The snapshot `ink-<id>.svg` (the paper's own vector writer, cell size, transparent, the cell's JSON in `<metadata id="writemind-ink">`) and its reader | done (`export/inkSnapshot.ts`); writing it to disk is the dock lane's IPC | `exportPictures.test.ts`; the file rendered standalone in Chromium and looked at |
| PDF: a picture cell is `<img>` at the column's width capped at its own, a missing one a 21.75 px line with its alt words; an ink cell is inlined from the sidecar at the column's width (`blockMediaFor`, `BlockMedia`) | done in core; main's `renderNotePdf` passes `media` (dock lane) | `exportPictures.test.ts`; a three-cell note's measuring and printed pages rendered in Chromium and looked at: the ink cell measured 183.03 px = 832 × 0.22 |

Port only (the Mac has no ink cells). The Mac drops a `cell` item it does not know (and marks the sidecar damaged), and
does not read `../` media paths yet. Floating ink does not move when a cell is docked or inserted above it (the existing
rule: floating objects never follow the text). Not verified here: anything on screen in the app (core has no UI).

## Picture and ink cells on the page (editor lane, 2026-10-05)

The widgets of `docs/PLAN-docking-ink-cells.md` (c) and the editor's half of docking (d), in `packages/editor`
(`pictureCells.ts`, `pictureDom.ts`, `inkCellRegistry.ts`, `dock.ts`; `Notebook.tsx` wiring).

| Feature | Status | Evidence |
|---|---|---|
| A picture line is ONE atomic block widget in both panes (the rendered page leaves it to `pictureCells`): the column's width capped at the picture's own (`display:block`), its height kept from the last load so nothing jumps; a missing file is a 21.75 px line with its alt words | done | `pictureCells.test.ts`; e2e `dock/picture-cells.mjs` (640 px photo = column width, 120 × 80 thumbnail kept, missing line 21.75 px) |
| The caret only above and below: a line-tall caret at the picture's top left / bottom right; words typed or pasted at either edge go on a line of their own (`text\n\n` before, `\n\n text` after, typed at the EDITOR's caret: the browser's own caret cannot stand there); Backspace / Delete that would join or take the line holds the cell, the next one deletes it | done | `pictureCells.test.ts`; e2e (typing, Ctrl+Z, held delete) |
| A live ink cell: column × `aspect`, faint card, a `<canvas>` the app's painter draws, an 8 px bottom strip that resizes it (one `resized` at the release, never under `minAspect`); no cell in the drawing, or a second line of the same id: read-only snapshot | done; painting is the dock lane's | `pictureCells.test.ts`; e2e (box = text column to 1 px in both panes; a 60 px drag makes it 60 px taller and the words under it move 60 px) |
| A click on a picture cell (or beside it, on the rendered page) holds it; seams, brackets and the + menu treat it as a cell; + ▸ Drawing Cell calls the app's `onInsertInkCell` | done | e2e (click holds, lit) |
| Rendered page: Up / Down walk bar → bar OVER a picture cell, a picture never opens or joins a run (`staysClosed` passed to `cellStatesSparse` and `touchingRuns`) | done | e2e (six Downs and an Up, armed offsets checked) |
| `inkCellPlaces` (where every ink widget is, live or not, measured now; mounts, unmounts and geometry heard), `cursorSeam`, `dropTargetAt` (an ink cell, a seam, or the seam after the cell under the pointer), `showDropBar` / `showDropTarget`, `insertCellLine` (own cell, bar armed under it, ONE history event), `columnBox` | done | `dockSeams.test.ts`; e2e (drop targets, drop bar and lit cell looked at, insert + one Ctrl+Z) |

Not verified: the ink drawn inside a cell and the dock gestures (dock lane), a real pen on the resize strip, any cell
with the app's painter (App.tsx was not wired to `inkPainter` when this ran: the e2e made the cell live through the
aspects map).

## Docking, and drawing in ink cells (dock lane, 2026-10-05)

Sean 2026-09-22 (a dock button: click = at the cursor, drag = where it is let go, between cells or into a cell) and
2026-10-05 (editable ink cells; the pen side buttons work the same in them). `docs/PLAN-docking-ink-cells.md` (b), (d)-(g);
`Canvas.tsx` (surfaces), `renderer/dock.ts`, `renderer/inkCells.ts`, App / useUndo wiring, main IPC and PDF.

| Feature | Status | Evidence |
|---|---|---|
| One engine on two surfaces: the pen draws, erases (Erase tool and the lower-button hold), picks (click, Ctrl or upper-button marquee), moves (kept inside the cell), scales, turns, nudges, restyles, groups, deletes, copies and pastes IN a live ink cell as on the page; the ink is painted into the cell's own canvas (it moves with the words in the same frame); a gesture keeps the surface it began on (a page erase never touches cell ink) | done | e2e `C:\CLAUDIO\agents\e2e\dock\s1.mjs` (19 checks), `s4.mjs` (7) |
| Insert ▸ Drawing Cell, Ctrl+0 and the + menu's Drawing Cell: an empty 200 px cell at the armed bar, else after the caret's cell; its snapshot written at once; ONE Undo | done | `apps/desktop/test/dockUndo.test.ts`; e2e `s1`, `s3.mjs` (20) |
| The dock handle (⤵) on a page pick of strokes and / or pictures: click → one picture is a picture cell, anything else ONE ink cell, after the caret's cell (or at the armed bar); drag → a ghost and the drop bar under the pointer, released on a seam = a cell there, over an ink cell (lit) = INTO it; Escape or outside the note = nothing. One Undo puts the objects back AND takes the line out; Redo docks again | done | `dockUndo.test.ts` (real CodeMirror history + DrawingHistory through `stepAcross`); e2e `s2.mjs` (22), screenshots looked at |
| Resizing a cell by its strip is one Undo, with the pen down too (the layer hands the press to the strip); the pen's double taps (lower = Undo, upper = Redo) take back cell ink | done | e2e `s3` |
| The snapshot `ink-<id>.svg`: written when a cell is made, rewritten after each sidecar save that changed the cell (strokes, Undo, resize), written on opening a note when missing | done | e2e `s1` (the file before and after a stroke) |
| PDF: ink cells inlined from the sidecar, picture cells loaded from their files, a missing one its one-line alt placeholder | done (`exportPdf.ts` passes `blockMediaFor`) | e2e `s3` (print page checked, the PDF looked at) |
| A note moved to another project folder takes its docked pictures and ink snapshots along | done, unit-tested only (`pictureFiles` walks cells; `moveSidecar` adds `mediaFiles(markdown)`) | `dockUndo.test.ts` |
| The page itself unchanged | existing e2e green | `npm run e2e -- --suite drawing/03-ink-select-transform`, `pen/01-ink-and-eraser`, `drawing/07-mode-and-copy` |

Port only (the Mac has no ink cells and no docking yet). Placing tools (shapes, arrows, text boxes), crop, labels and
read-into-words stay on the page. Floating ink does not move when a cell is docked or inserted above it (existing rule).
Not verified: a real Wacom pen (all pen input was synthetic PointerEvents with `buttons` bits and pressure), the feel
of the dock drag, how a docked photo sits for Sean.


## Gate fixes for docking, ink cells and the pen buttons (gate, 2026-10-05)

| Feature | Status | Evidence |
|---|---|---|
| An arrow attached to a docked picture (or ink) stays: the end on it lets go, where the routing last put it | done | `inkCell.test.ts` "keeps an arrow attached to a docked picture" |
| Floating ink lying over an ink cell is the page's: a click / Select hold picks it, the eraser over a cell also rubs out floating strokes on top | done | gate smoke E1-E3 (`C:\CLAUDIO\agents\e2e\gate\smoke.mjs`) |
| The driver's mouse right / middle click for a side button (the echo) holds the press across the pen's hover samples; switched off per button, only by a real pen pointerdown in the air | done | `penButtons.test.ts` "THE ECHO"; gate smoke D7 |
| A pen double tap over the page undoes the page, not the tablet sheet that kept the focus | done | `tabletFocus.ts` `byPen`; by reading |
| Select tool / Select hold: a press on an unpicked object inside the selection's box picks it (no move of the old pick), and never with Shift | done | by reading; gate smoke D4 |
| A docked .pdf picture (Mac traced capture) prints as its SVG | done | `main.ts` printedPictures; not run with a .pdf picture |
| Ink copied in a cell that is no longer on the screen pastes onto the page (`toPage`) | done | `inkCell.test.ts` "comes back to the page with toPage" |

Gate smoke on one isolated instance, 36 / 36 PASS: paste + dock a picture (text above and below, never under; Ctrl+Z
floats it again; typing at its edge goes on its own line), floating ink docked as an ink cell, more ink drawn in it,
a line typed above moves it with its ink, the strip resizes it, Insert > Drawing Cell, the side buttons (hold lower
erases, double-tap lower undoes, hold upper selects, double-tap upper redoes, single taps do nothing, the driver's
echo), and a PDF with both kinds of cell (looked at).

## The sheet's own Erase and Select (sheet-tools lane, 2026-10-05; WINDOWS-ONLY: the Mac has no tablet sheet)

Sean: "clicking in the notebook exits erase mode from the drawing side". Reproduced first (old build, isolated instance): the
sheet's Erase lit the toolbar's ⌫ and the Pen chip, made the note's drawing layer erase (a mouse click on the words placed no
caret), and was turned off by the toolbar ✎ button, Ctrl+P and a placement tool (all `putToolsDown`); a pen tap on the sheet then
a click in the notebook did not turn it off.

| Feature | Status | Evidence |
|---|---|---|
| The sheet has its OWN Erase and Select (`penSettings` `sheetTools`: one pair for every sheet tab, not remembered); `eraser` / `selectTool` are the notebook's alone (toolbar ⌫ / ⬚, `putToolsDown`) | done | `test/sheetTools.test.ts`; e2e below |
| Sheet header: a Select toggle (Select: the pen pulls the dashed box too); the hint line says which tool is on | done | e2e below (looked at) |
| No Erase button on the sheet's header (Sean, 2026-10-05: "remove the erase button from the wacom menu bar"): erasing there is the pen's first button held, the box row's Erase, or the pen's Erase Tool toggle (Ctrl+Alt+2, the menu, a double tap set to it), which still sets the sheet's eraser; the hint line names the button that rubs out ("hold its first button to rub out", from the pen's button map) and, with the eraser on, how to put it down | done | `e2e/suites/tablet/01-sheet-as-camera.mjs` section 6 (34 / 34 PASS); the bar looked at on an isolated instance, narrow and wide |
| The pen's toggleErase / toggleSelect (double tap, ExpressKey Ctrl+Alt+2 / 3, Pen menu) act on the surface the pen is over or was last over (`tabletFocus` `penOnSheet`, pen events only, the native feed's too); the Pen menu's checks show that surface's tools; the pen cursor shows the sheet's tool over the sheet | done | e2e below (DOM pen and the inject feed) |

Evidence: `C:\CLAUDIO\agents\e2e\sheet-tools\sheet-tools.mjs` (28 / 28 PASS on one isolated instance before the header's
Erase button went: (a)-(e) above keep the sheet's Erase, the toolbar stays dark, a click on the words places the caret, each
surface's Erase rubs out only its own ink, double taps and Ctrl+Alt+2 / 3 by the pen's place, through the inject feed too).
**STALE since 2026-10-05:** it clicks the removed `[data-tablet=erase]` button and dies at its first step; the repo suite
`e2e/suites/tablet/01-sheet-as-camera.mjs` section 6 covers Ctrl+Alt+2 on the sheet and the side-button hold, but not (a)-(e)
(port them into `e2e/suites/tablet/`, docs/TODO.md). Needs Sean's pen: no real tablet moved.

## Tables, from scratch: part one (tables lane, 2026-10-05; PORT-FIRST: the Mac took tables out on 2026-09-20 to rebuild them)

Sean wanted his keys list "as a table". The Mac has no tables now (`C:\GIT\WriteMindSwift` 6109a18 took the old ones out
whole), so this is the first part of the rebuild, written in the port first; the rest is in `docs/TODO.md`.

| Feature | Status | Evidence |
|---|---|---|
| A GitHub pipe table (header, `\|---\|:--:\|---:\|` row with alignment, body rows, inline markdown in cells, `\|` escaped, end pipes optional) is ONE cell (`Block` `table`: header, align, rows as wide as the header); a short row is padded, a long one cut | done | `core/test/tables.test.ts` |
| Not a table: a lone line of pipes, a delimiter row of another width, a line of pipes indented two columns or more (a list item's words), pipes in a quote or a fence; a table ends at a blank line, a list item, a quote, a heading or a line with no pipe. A table straight under a paragraph line takes that line as its header (GitHub's rule) | done | `tables.test.ts`; `formatting.test.ts` (the old "pipes are prose" case turned round) |
| `positionedUpdate` agrees with the whole parse (it restarts at the paragraph above a table that took its header from it) | done | `tables.test.ts` (4800 random table edits), `parserIncremental.test.ts` |
| The rendered page draws a real `<table>`: ruled cells, the header bold on a tint, left / centre / right from the delimiter row; a click on a cell's word opens the table's markdown with the caret on that word | done | `editor/src/preview/render.ts`; `previewPatch.test.ts` (tables chain); e2e below (looked at) |
| The markdown pane (and an open table on the page) sets the lines as a framed monospaced grid: header bold, pipes and the rule dimmed, the file never re-padded | done | `editor/src/tables.ts`; e2e below (looked at) |
| PDF / HTML export prints a real table, the page's metrics, light colours | done | `export/blocks.ts` `tableHtml`; `tables.test.ts`; e2e below (the printed page looked at) |
| Tab / Shift+Tab cell to cell; Tab past the last cell and Return add a row; Return on an empty last row ends the table (KEYS.md "Tables") | done | `tableTab` / `tableReturn` in `tables.test.ts`; e2e below |
| Editing inside the drawn grid, a table button / key, row and column commands | not built | `docs/TODO.md` "Tables, from scratch" |

Evidence: `C:\CLAUDIO\agents\e2e\tables\tables.mjs` (31 / 31 PASS on one isolated instance, real CDP keys and
clicks: the grid in the markdown, Tab / Shift+Tab / Return, the drawn table, a click into a cell, Tab and Return on
the rendered page, undo, File > Export as PDF and its printed page).

## Hold image (hold-image lane, 2026-10-05; PORT-ONLY: Sean's ask, the Mac has no such button)

| Feature | Status | Evidence |
|---|---|---|
| **Hold image** in the camera pane's header (after Zoom): one press copies the frame on screen into the pane's own canvas and shows it in the video's place (`useHeldFrame`, `useCameraStream.ts`); the stream plays on underneath, so letting go is live at once. Pressed look (accent, sunk in) and a quiet "Held" before the camera's name under the picture | done | `e2e/suites/camera/03-hold-image.mjs` (29 checks; `// @e2e video=moving`, the new `moving.y4m` feed in `e2e/lib/fixtures.mjs`: a block steps along the bottom one place a frame), shots `agents/shots/manual__03-hold-image__*.png` |
| The box, Straighten's corners, Find page, Image / Writing / Text / Page / Raw all take the HELD frame: `snapshot()` reads `picture()` (the still while held), drawn upright by the one transform shared with the live video (`uprightTransform`, `cameraTake.ts`); a quarter turn or the zoom while held turns / zooms the still; the hold stays through captures | done | `apps/desktop/test/cameraHold.test.ts` (the transform against CSS `rotate()`), the e2e: two Raw captures 0.6 s apart are the held frame while the live feed moved on; Writing from a box on the held frame; a turned Raw is 480 x 640 |
| Lets go: the button again; Esc with the pane focused (a click on the picture focuses the pane, `tabIndex=-1` in camera mode only; a box goes first); another camera, Turn Camera Off, the Tablet, any stream that stops (`live` false) | done | the e2e (each case) |

Not verified: a real camera (Chromium's fake device only); Sean's own feel for where the button sits.

## Scanned pages as tabs (scanner-tabs lane, 2026-10-07; PORT-ONLY: Sean, "work on scanner tabs"; the Mac has no tablet sheet and no tab row)

| Feature | Status | Evidence |
|---|---|---|
| The camera's tab row (`SheetStrip.tsx` `CameraTabs`): the live **Camera** tab first (always there, never closed), then one tab per kept page, named "Page N" (one past the highest; double-click renames). **+** keeps what the camera shows (the HELD picture with Hold image, else the live frame) as a new page and opens it; from a page's tab it keeps the live camera picture too. Disabled, with its reason in the tooltip, when there is no camera picture, while busy, or at 40 pages | done | `test/scanSet.test.ts` (the rules: add / close / rename / open, the camera as `current: null`), `e2e/suites/camera/04-scanned-pages-as-tabs.mjs` |
| What a page keeps (`scanSet.ts` `ScanPage`): the picture as the camera gave it (a JPEG), its own quarter turn, the box, Straighten on / off and the four corners (looked for when it was kept, so Straighten starts on the page), the **learned page shape** (the measured shape snapped to the notebook's, `resolveShape`, so a stack of one notebook comes in one size; only a found page teaches the notebook's shape) and **what was read off it** (Text's lines with the key of the box, corners and turn they were read through: the same box again brings the words in again without reading) | done | `test/scanSet.test.ts` (round trip, `readKey`, `boxOnPane`), the e2e (box carried from the camera, per-page turn / corners, restart) |
| A page stands in the video's place (`canvas.page-still`, beside the held `still`): the box, Straighten, Find page, Zoom, the turn, the box's Image / Writing / Text and the header's Writing / Page / Raw all work on IT, not on the live picture, exactly as on a held frame; the box and the corners and the turn are the page's own and kept with it (the Camera tab keeps its own: its box is spent by "+", as after a capture). A capture leaves the page in its tab, to bring in again; its box goes, as on the camera. **Hold image is the camera's**: disabled on a page. The note line under the picture names the page; a page whose picture file is gone says so (close the tab) | done | the e2e (Raw on Page 2 is Page 2's frame while the live feed moved on; Writing / Image from Page 1's box; a held frame kept; the turn does not touch the camera's) |
| **x** on a page closes it, and ALWAYS asks first ("Close?", a second click; anything else or three seconds takes it back): the picture goes with it. The open page closing opens its right-hand neighbour, else the left, else the camera | done | the e2e, `test/scanSet.test.ts` |
| Kept across restarts, as the tablet's sheets are, in userData: `scans.json` (the list; `main/scans.ts` reuses `sheetsFile`, the writer `sheets.json` has: held, written whole after a quiet moment, at quit, an unreadable file copied aside as `scans.unreadable-<time>.json`) and `scans/<id>.jpg` (each picture, written whole BEFORE its page joins the list; a picture no page names is swept at launch once a minute old). The id is `[\w-]{1,64}` or refused. **Not kept: which tab was open** (a launch starts on the camera). The pictures are in userData like `sheets.json`, not in the notes folder: a page is not a note's content until it is brought in | done | `test/scansFile.test.ts`, `test/scanTabs.test.ts` (the store against a stand-in for `wm.scans`: put before add, nothing written before the list is read, sweep), the e2e (restart: pages, names, turn, box, corners, shape; the pictures decode from their files; Writing works after) |

Not verified: a real camera and a real stack of pages (the fake device plays one feed); Sean's own feel for "+" opening the new page rather than staying on the camera (it follows the tablet's "+"; say if a scan-a-stack flow should stay live); the Zoom on a page past "the button is on offer". Not built: Text read at "+" time (a page is read when Text is pressed, and kept), moving a page between tabs, a thumbnail.

## The Quick Reference (welcome lane, 2026-10-05; PORT-ONLY: Sean's ask, the Mac has no first-run note)

| Feature | Status | Evidence |
|---|---|---|
| A new install (the notes folder and the project's folders hold no note, and `.writemind/welcomed` is not in the notes root) gets `WriteMind Quick Reference.wm` (a Note, written through the `.wm` store; it was named `.md` by mistake in the merge, which no sidebar lists) before the page reads the tree (`main/welcome.ts`, called in `main.ts` before `createWindow`); being the only note, the session's no-session rule opens it as the one tab, in front | done | `apps/desktop/test/welcome.test.ts` (temp folders); e2e below |
| Never again: the marker stays when the note is deleted; a folder that already has notes (top level or in a section, `.md` / `.markdown` / `.txt`) is marked and gets nothing; a file of that name is never overwritten (`wx`) | done | the test; e2e below |
| Its text (`shared/welcome.ts`): Sean's approved feature list kept to what is built (tables, docking, drawing cells, runnable cells, sheet tabs, the pen buttons: First button (Middle Click) hold erase / double-tap undo, Second button (Right Click) hold select / double-tap redo), then the keys as ONE pipe table (What, Windows, Mac), GENERATED from `commands.ts` (`acceleratorFor`, the menus' source; Mac chords as ⌃⌥⇧⌘ glyphs), columns padded so the markdown grid lines up | done | the test (every id exists, no empty Windows chord, Shift+Enter found in the editor keymap, the note parses to one table of 25 rows, Sean's rows pinned on both platforms) |
| Test instances (offscreen or `WRITEMIND_E2E`) are left alone unless `WRITEMIND_WELCOME=1`; `WRITEMIND_WELCOME=0` turns it off anywhere | done | the test; e2e case 4 |
| Its FIRST open is on the rendered page (Sean, 2026-10-05: "open on rendered page"): main says once which note it wrote at this launch (`welcome:take`), `renderer/welcomeView.ts` shows that note rendered before the paint; another note in front brings the markdown pane back (unless Ctrl+T was used meanwhile); a later launch, an existing install and every other note are untouched | SUPERSEDED 2026-10-07 by the rows below (every open is rendered; `welcome:take` is gone) | was `test/welcomeView.test.ts` (6); `C:\CLAUDIO\agents\e2e\sheet-note-sync\welcome-rendered.mjs` (7 / 7: rendered on a new install, a new note in markdown, back to it in markdown, a second launch in markdown); shot `sync-welcome-rendered.png` looked at |
| 2026-10-07 (Sean: "make sure the features md file that ships is rendered by default and correct"): the feature list rewritten to the app at 2.16.0 (cells, text / markdown, maths, tables, rendered page, drawing and docking, runnable cells, Language Setup, the video pane and scanned-page tabs, the Wacom tablet sheets with Bring in / Copy Cell, Wolfram notebook export and Mathematica paste, the pen buttons on Windows and Mac, `.wm` / `note.mdwm` / the project file, updates, About) and an intro line; `test/welcome.test.ts` holds each line to the source it names (keys to commands, menu items to `menu.ts`, buttons to their panes, languages to the evaluators, names to the format) | done | `welcome.test.ts` ("the feature list is true to the source"; mutated to fail once) |
| It opens on the RENDERED page EVERY time it is in front, not only at the first launch (`welcomeView.ts` `quickStep`): the mode the other notes are in is remembered when it comes to the front and put back when another note (or none) does; Ctrl+T by hand on it lasts until it leaves; `welcome:take` is gone | done | `test/welcomeView.test.ts` (12); e2e `chrome/06` |
| Help ▸ Quick Reference (command `quickReference`, no key, first in Help): `main/welcome.ts` `ensureQuickReference` creates the file when missing and REWRITES it with the current text when it differs (an upgraded install gets the new text; the person's edits to it are overwritten, and the intro says so) through `wmStore` (`createFile` / `writeText`, one serialised writer, the digest guard); opens it in a tab (a second choice refreshes the open tab, never a second tab) and shows it rendered. An existing install (marker present) is NEVER given the file at launch | done | `welcome.test.ts` (created / current / updated / refused), `menu.test.ts`, `keyList.test.ts`; e2e `chrome/06` (first launch rendered, closed and reopened rendered again, another note keeps its mode, an outdated copy rewritten in the open tab and on disk, an existing install gets it from the menu only) |

Evidence: `C:\CLAUDIO\agents\e2e\welcome\welcome.mjs` (20 / 20 PASS; it starts its own instances welcome-a/b/c, ports 9545-9547): a fresh folder gets the note and the marker, it is the one tab and in front, the markdown pane draws the 27-line grid with its pipes lined up, Ctrl+T (a real key press) draws a real table of 25 rows; after deleting it a second launch writes nothing; a folder with `Old.md` gets nothing and opens on Old; a test instance that did not ask stays empty. Shots looked at: `agents/shots/welcome-*.png`. Not verified: a real installer (none is built yet), a Mac.

## The notes folder's rename, WriteMindCross -> WriteMind (notes-folder lane, 2026-10-06; PORT-ONLY: Sean's ask)

| Feature | Status | Evidence |
|---|---|---|
| Default notes folder `<Documents>/WriteMind`; `WRITEMIND_NOTES` wins and turns everything below off (`main/notesFolderMove.ts`, settled in `main.ts` before the project, the watcher and the quick reference) | done | `apps/desktop/test/notesFolderMove.test.ts` (14, scratch folders) |
| First launch: old there and new not there at all -> ONE `fs.rename` (never copy-then-delete); refused (EPERM / EBUSY / EXDEV, Explorer, OneDrive, antivirus) -> the old folder this launch, logged in `userData/notes-folder.log`, tried again next launch; both there -> the old folder and a one-time notice bar ("Your notes stay in Documents\WriteMindCross…", `renderer/FolderNotice.tsx`, shown flag in `userData/notes-folder.json`); neither -> the new one; a second launch does nothing | done | the test (a real Windows lock: a process working in the folder); e2e below |
| After a move every remembered path under the old folder is rewritten (prefix only, separator-aware, case-insensitive on Windows, every other byte kept): `userData/*.json` (project.json, sheets.json's ink-cell bindings, …), every session (open notes, front note, unsaved-text keys), the session FILES named from a moved project file's path or the old folder's, `.writemind-project` files (the remembered one, those at the top of Documents, those inside the moved folder); drawings kept under the oldest absolute-path hash are renamed to the new path's hash. Today's drawings (relative-path hash), pictures and ink cells (named by content / id) move as they are. The renderer's localStorage holds no paths. A move cut short between rename and rewrite is finished next launch | done | the test (drawings, ink cells, pictures read back after a move) |
| Test instances (offscreen / `WRITEMIND_E2E`) never move anything unless given a Documents folder of their own (`WRITEMIND_DOCUMENTS`, tests only) | done | the test |

Evidence: `C:\CLAUDIO\agents\e2e\notes-folder\` (setup.mjs, start.ps1 with a scratch `WRITEMIND_DOCUMENTS` and no `WRITEMIND_NOTES`, check.mjs 10 / 10 PASS: moved, root is the new folder, the remembered note opens with its stroke and picture, project.json / session rewritten, logged; check-both.mjs: both folders -> old kept, notice once, not on the next launch). Shots looked at: `agents/shots/notes-folder-moved.png`, `notes-folder-both.png`. Not verified: Sean's real folder (his first launch of a build with this), a Mac, OneDrive.

## The pointer over cells, and a new cell ready to type in (cells-ui lane, 2026-10-05; Sean's ask)

Sean, 2026-10-05: *"a horizontal text selector cursor between cells when clicking would put a horizontal input cursor
between cells … selecting a cell type or pressing an input in the menu bar like code block etc should create a new cell
with the cursor ready to start typing (… except drawing cells, where it becomes a pen that can only draw in that cell)"*.

| Feature | Status | Evidence |
|---|---|---|
| ONE hit-test for the pointer and the click (`pointerPlace`, seams.ts; Mac 17f0f82): `vertical-text` (the Mac's `iBeamCursorForVerticalLayout`) over exactly the seams, `pointer` over the + (only where it is drawn: the armed bar, else the hovered seam), `text` over words and margins, the gutter's own hand / arrow; said as one attribute on the scroller that beats a drawn block's own I-beam; asked again on scroll and after an edit under a still pointer. Was: `row-resize` on the scroller, lost to `.wm-pv`'s I-beam over a seam that runs over a block's edge | done, both pages | `cells-ui/pointer.mjs`: 528 points per page, cursor = hit-test at all; 376 / 392 of them clicked, each click did what the cursor said; 1 px sweeps change cursor exactly as often as the place changes (no flicker); `e2e/suites/cells/03-seams.mjs` (29) and `cells/furniture.mjs` (41) still pass |
| A click in a seam ARMS THAT BAR, always (`armAt`): the caret on the blank line where there is one, else (two cells that touch, the ends) armed by hand; a hand-armed bar survives a transaction that only names its own selection (a focus, a page switch). Was: left to CodeMirror's click, which put the caret IN a cell between touching cells, and on the rendered page opened the block under a widened seam | done | `cellsUi.test.ts`; `pointer.mjs` (touching cells) |
| The + menu's kind MAKES the cell at once, caret in it, keyboard in the editor (PORT-FIRST: the Mac's + only names the kind for the next character) | done, every kind, both pages | `cells-ui/newcells.mjs` (13 kinds × 2 pages) |
| Commands that name a kind (Ctrl+1…7, List, Quote, Code Block, a language's Code Block) at an armed bar make the cell there on the MARKDOWN side too (the Mac's `atArmedBar` asks the source pane first); Ctrl+8 with nothing selected in a cell of words makes a new code cell AFTER it (Ctrl+9's rule); Insert ▸ Maths… at a bar puts the maths in a new cell there (was: nothing on the rendered page, glued to the neighbours on the markdown side) | done | `cellsUi.test.ts` (17); `newcells.mjs`: menu bar items clicked through Electron's own menu, toolbar buttons with real clicks, Ctrl+8 / Ctrl+9, Maths, both pages (50 / 50) |
| A drawing cell (Ctrl+0, Insert ▸ Drawing Cell, + ▸ Drawing Cell) scopes the pointer to a pen for THAT cell (`inkScope.ts`, Canvas `scopedPress`): with the pen up a press in it draws (box ringed, crosshair), the page keeps its pointer, a press outside ends it and is the click it would have been (never a stroke, even from a pen that always draws), Escape ends it, Ctrl+P ends it; pen mode unchanged | done (mouse and SYNTHETIC pen events) | `inkScope.test.ts`; `cells-ui/pen.mjs` (21 / 21) |

Not verified: a real mouse and the real Intuos pen (the cursor's feel, the scoped pen with the tablet). Scripts:
`C:\CLAUDIO\agents\e2e\cells-ui\{pointer,newcells,pen}.mjs` (`WM_PORT=<port>`, an instance started with `-E2E`).

## A drawing cell opened as a tablet sheet (cell-to-sheet lane, 2026-10-05; PORT-ONLY: the Mac has neither)

Sean: "you can also right click and open the drawing cell as a new tab in the wacom/video editor to write in".
`renderer/cellSheet.ts` (pure: frame, coordinates, the sync), `cellPage.ts`, `cellSheets.ts` (the binding), `CellMenu.tsx`.

| Feature | Status | Evidence |
|---|---|---|
| Right-click a live drawing cell (markdown or rendered page, pen up or down) ▸ Open in Tablet Sheet / Delete Drawing Cell; anywhere else the notebook's own menu | done | e2e below; ad-hoc check with the pen down (the layer on top) |
| Open in Tablet Sheet: the video pane comes back on the Tablet and a sheet tab "<note> Drawing" BOUND to the cell opens (the same tab the next time; marked in the strip, closes without asking) | done | e2e below; `cellSheet.test.ts` |
| The sheet keeps the tablet's shape (the pen's mapping never changes); the cell is the largest frame of ITS shape in the middle, the rest shaded; a stroke stops at the frame's edge | done | `cellSheet.test.ts`; e2e (a stroke run off the top ends on the frame), screenshots looked at |
| Writing / erasing / Clear on the sheet edits the cell: one undo step of the note's timeline per stroke (at pen-up) or erase gesture, through the app's `changeDrawing` (sidecar saved, `ink-<id>.svg` rewritten, the cell repainted); strokes not touched keep their own items (moved / scaled ones included); pictures in the cell untouched | done | `cellSheet.test.ts` (round trip to 1e-9, links, one step per erase); e2e (inject-feed stroke on disk, canvas repainted, snapshot grew) |
| No undo of its own: Ctrl+Z over the sheet, its Undo button and the pen's double tap are the note's Undo; the cell's own changes (a stroke in the note, Undo, Redo, a resize, the tablet turned) come back to the sheet | done | e2e (Ctrl+Z / Ctrl+Y in the note, the header's Undo) |
| Bring in Writing / Page are off on a bound sheet; the paper is drawn, never written into the cell | done | e2e |
| The binding (note file + cell id, the cell's shape, writing waiting) is kept in sheets.json and survives a restart; a moved / renamed note is followed | done | e2e restart phase; `cellSheet.test.ts` |
| Its note not in front: the sheet shows the cell as last seen, what is written waits (`pending`, on disk too) and lands as one step when the note is. Since sheet-note-sync (below) a bound tab is open only with its note in front, so this is left for a sheets file from before and no note open at all | done | `cellSheet.test.ts` (fake app); not in e2e |
| The cell gone from its note (still gone 1.2 s later), or the note's file gone: the tab says so quietly and is a plain sheet with its ink | done | `cellSheet.test.ts` (fake app; an Undo then Redo within the moment is not "gone"); not in e2e |

Evidence: `C:\CLAUDIO\agents\e2e\cell-to-sheet\cell-sheet.mjs` (`first` 25 / 25, then a restart, `restart` 9 / 9 PASS on one
isolated instance), `apps/desktop/test/cellSheet.test.ts` (22). Needs Sean's pen: writing in the frame with the real Intuos.

## The sheet and the note follow each other (sheet-note-sync lane, 2026-10-05; PORT-ONLY: the Mac has neither)

Sean: "automatically switch to the right note tab when selecting a drawing tab that matches it.. when the drawing is open,
switching to another note tab goes back to the previous non-page specific drawing tab". Rules: `renderer/sheetFollow.ts`
(pure); wiring: `cellSheets.ts` (the picker, the note in front), `tabletSheets.ts` (`selectSheet` / `stepSheet` go
through the picker, `showSheet` does not; the last plain tab), App.tsx (the host's `bring` / `reveal`; the note in front
reported in a layout effect, so the note and the sheet change in one frame).

| Feature | Status | Evidence |
|---|---|---|
| A bound tab ("<note> Drawing") picked by hand (a click, Pen ▸ Next / Previous Sheet = Ctrl+Alt+PageDown / PageUp) brings its note to the front (its tab, else opened as from the sidebar); the tab opens when the note is there (never a frame with a drawing tab of a note away) and the cell is scrolled to the middle unless already whole in view. Its note already in front: it just opens. Note gone: no switch, the tab lets go of its cell (it says so) and opens as a plain sheet | done | `test/sheetFollow.test.ts` (21: rules + live against a fake app); e2e below |
| A bound tab open and ANY other note to the front (note tab, sidebar, link, new note, closing the bound note's tab, no note left): the sheet goes back to the last plain tab that was open, else the first plain tab, else a new "Sheet 1"; the bound note itself to the front changes nothing; no loop (a pick only brings a note, a note only opens a plain tab or the tab that asked for it) | done | same |
| The last plain tab is kept in sheets.json (`plain`) and survives a restart; after a restart a bound tab of a note not in front gives way once a note is in front | done | `sheetFollow.test.ts` (file round trip); e2e (`plain` on disk); the restart itself not in e2e |

Evidence: `C:\CLAUDIO\agents\e2e\sheet-note-sync\sync.mjs` (49 / 49 PASS, one isolated instance, every frame recorded:
a click and both keys bring the right note, one change per action, Sheet 1's ink intact throughout); shots
`sync-click-bound.png`, `sync-back-to-plain.png` looked at. Not verified: Sean's pen (the keys were CDP key events).


## Updates from GitHub Releases (updater lane, 2026-10-05; PORT-ONLY: the Mac app has no updater)

| Behaviour | Status | Evidence |
|---|---|---|
| Only an INSTALLED Windows copy looks (uninstaller beside the exe + `resources/app-update.yml`); not dev, `WRITEMIND_E2E`, portable, `win-unpacked`, the repo's Electron (try-build), macOS or Linux | done | `test/updater.test.ts`; e2e: a packaged unpacked copy reported "off", asked the feed nothing, wrote no log |
| ~~45 s / 4-hourly background check, footer "Update x ready — Restart"~~ | REPLACED (release-ui lane, 2026-10-05, Sean: "Updates available. Update now?" popup, check on startup, a checkbox, a menu button) | see the next rows |
| "Check on startup" (default on, `userData/update.json`, not localStorage): ONE look ~3 s after launch; off = only Help ▸ Check for Updates… looks (no timer) | done | `updater.test.ts` (settings); e2e `release-ui/03` (box off, relaunch: feed heard 0 requests in 8 s, update.log "not checking at launch", no dialog) |
| A newer release: the page's own `.modal` "Updates available" — "WriteMind 0.5.1 is available (you have 0.5.0). Update now?", [Later] [Update now] (default), "Check on startup" box; nothing downloaded before Update now; keyboard on the sheet (Enter = Update now, Escape = Later), keys in its first 0.7 s ignored | done | `updater.test.ts`; e2e `release-ui/01` (shot `01-updates-available.png` looked at) |
| Later: closes; that version not asked about again this launch (main keeps it; a page reload does not bring it back); the menu's look still offers it | done | e2e `release-ui/02`, `06` |
| Update now: quiet "Downloading… n%" line, Later → Cancel, Update now greyed, click-outside ignored; then the notes are written (close handshake) and the installer runs silently; Cancel stops the download; a failed download shows one red line and Update now retries (looks again, then downloads) | done | e2e `release-ui/04` (404 on the installer: red line; retry: typed text in the .md, install 0.5.1 six seconds after the quit), `06` (slow feed: 0% → 10%, Cancel, status back to available; shot `06-downloading.png` looked at) |
| Help ▸ Check for Updates… (the menu button) looks now and answers in the same sheet: the dialog, "You're up to date (0.5.1).", "Couldn't check for updates: <short reason>.", or in a copy that does not update "Updates come with the installed app." + why; Help ▸ Check for Updates on Startup (checkbox, greyed in such a copy) mirrors the setting | done | `updater.test.ts`, `menu.test.ts`; e2e `release-ui/03` (native item clicked through the main-process inspector; the boxes follow each other), `05` (up to date: Enter closes; feed down: "the update server did not answer", Escape closes; shots looked at), `07` (a wm-start dev-run copy: box greyed, "Updates come with the installed app." + why; shot looked at) |
| Launch-look errors (offline, rate limit) to `userData/update.log` only | done | e2e `release-ui/03`/`05` logs |
| Release workflow `.github/workflows/release.yml` (tag v* = version check, typecheck, test, build, draft release with installer + blockmap + latest.yml, then published) | written, NOT RUN | YAML parsed; the version-check and notes steps dry-run locally; actionlint not available |

Evidence scripts: `C:\CLAUDIO\agents\e2e\updater\0{1,2,3}-*.mjs` with `C:\CLAUDIO\agents\instances\upd-test\{package,install,launch,after-restart,unpacked,uninstall}.ps1` (two test-identity builds "WriteMind UpdTest" 0.5.0 / 0.5.1, installed silently into the scratch folder, uninstalled after: shortcuts, uninstall entry and cache gone, Sean's own WriteMind shortcuts untouched). Not verified: the GitHub provider against a real release, the differential download, the relaunch after Restart (off under the test feed). Run twice: once without `packaging/installer.nsh` (it did not compile yet), once WITH the assisted installer and its `installer.nsh` (silent update, no tools page, no tools-setup.log): all PASS both times.

The dialog (release-ui lane): `C:\CLAUDIO\agents\e2e\release-ui\0{1..6}-*.mjs` + `C:\CLAUDIO\agents\instances\relui-upd\*.ps1` (test identity "WriteMind RelUI" 0.5.0 / 0.5.1, feed on 127.0.0.1:9621, real CDP mouse / keys, the native Help items read and clicked through the main process's inspector; installed, updated, uninstalled: entry, shortcuts and cache gone, Sean's shortcuts untouched). Not verified: the relaunch into the new version (off under the test feed), the GitHub provider.

| Installer licence and name (release-ui lane, 2026-10-05) | Status | Evidence |
|---|---|---|
| The installer shows the licence first: the repo's `LICENSE` (BSD 3-Clause, "Copyright (c) 2026, Shahean Cheren"), "I accept the terms of the License Agreement" box, Next greyed until ticked; the installer / app / uninstaller file properties say Company "Shahean Cheren", Copyright "Copyright © 2026 Shahean Cheren"; Settings ▸ Apps Publisher "Shahean Cheren" | done | `relui-upd\license-page.ps1` (the installer UI run, read and CANCELLED on that page; shot `shots\relui\license-page.png` looked at), `relui-upd\install.ps1` (registry Publisher, VersionInfo) |

## Text cells and markdown cells (text-cells lane, 2026-10-05; PORT-FIRST: Sean's ask, docs/PLAN-text-cells.md)

| Feature | Status | Evidence |
|---|---|---|
| A paragraph with no marker is a TEXT cell: its lines as typed, nothing formatted, on both pages and on paper (`.para` pre-wrap); Sean's "foo / bar / baz / bez / foo" is five lines on the rendered page and in the PDF | done | `core/test/textCells.test.ts`; e2e (pdftotext + the printed page looked at, `shots/text-pdf-page.png`, `text-pv-sean.png`) |
| The escape rule (`markdown/plainText.ts`): what typing / Return / paste / delete put in a text cell is written again in the same transaction (one Undo), a backslash only where markup would form; WriteMind hides it, the caret steps over it with its character, Copy leaves it out | done | `core/test/textCells.test.ts` (4000 random lines: reads back, never looks like markdown, one paragraph line); `editor/test/textCells.test.ts`; e2e |
| A MARKDOWN cell is `<!-- markdown -->` over the paragraph, inside its range (delete / move / copy / paste take it), hidden on both pages, never a caret stop; Backspace / Delete next to it act as if it were not there; older notes (unescaped `**`, `_`, `~~`, `` ` ``, links, `<u>`, `<span>`, `<mark>`) read as markdown and get their marker on the next edit | done | the tests; e2e |
| Ctrl+7 Text (marker and formatting off, words and line breaks kept), Ctrl+Shift+7 Markdown (marker on; the escapes' backslashes go and the words are read as markdown, Sean 2026-10-05; selection kept on the same characters), the automatic switch (Ctrl+B / I / U, Ctrl+Shift+X, B I U S, the T menu, `/link`, inline maths; the same conversion first) as ONE Undo; the + menu's Text / Markdown | done | the tests; e2e (real keys, Ctrl+Shift+7 as `&` with code `Digit7`) |
| Keys: Ctrl+Shift+8 Evaluation Cell (was Ctrl+9), Ctrl+9 Drawing Cell (was Ctrl+0), Ctrl+0 free; digits matched by `code`; F1 and the Quick Reference group Ctrl and Ctrl+Shift numbers first. SUPERSEDED 2026-10-06: Ctrl+9 Maths Cell, Ctrl+0 Drawing Cell (section "Maths cell" below) | done | `keyList` / `keyGroups` / `welcome` / `menu` tests; e2e (F1 shot `text-f1.png`) |
| Gate fixes (v1.0.0 gate, 2026-10-05): a paste at an armed bar is written as it is (only typing is literal); the marker leaves when its words become a heading / list / quote / fence, and moves down with them on Return; Ctrl+7 keeps Link Here anchors and inline pictures; Link Here anchors do not make a paragraph markdown (hidden in a text cell); the escape rule is linear on long lines; display maths / Ctrl+8 into a paragraph keep each half its kind (keepingHalves); whole cells copied give other apps the words (plainCells) | done | packages/core/test/textCells.test.ts, packages/editor/test/textCells.test.ts; `C:\CLAUDIO\agents\e2e\gate-r9\gate-extra.mjs` (12 / 12) |
| No maths typeset in a text cell, anywhere (Sean, 2026-10-05: "math shouldn't be typeset in non-markdown mode"): `wl:` and its backticks as typed in the source pane (also typed / pasted there: escaped as it goes in), on the rendered page, on paper (PDF / HTML), in Copy and in the sidebar's snippet (it took a text cell's backticks, `#`, `*` off as markup: now a text cell's line is shown as typed, `notes/note.ts`); a ```` ```wl ```` fence typed in a text cell is words. Maths cells, markdown cells (marker or older-notes rule: unescaped `wl:` maths, no marker, still typesets), headings, lists and quotes typeset as before; the palette's inline insert / Ctrl+Enter into a text cell makes it markdown first (kept) | done | `core/test/textCellMaths.test.ts`; `editor/test/mathInline.test.ts` ("a text cell's words are not maths"); `e2e/suites/maths/11-text-cells-show-maths-as-typed.mjs` (14 / 14, real typing, both pages and the sidebar row looked at) |
| Leftovers (2026-10-06): Split Cell / Merge Cells (Ctrl+D / Ctrl+M) keep each cell its kind (a text cell's halves escaped again, a markdown cell's second half its own marker; a merge is Backspace's rule, the upper cell's kind wins: markdown under a text cell is written literal); Find / Replace writes into a text cell by the escape rule, into a markdown cell raw; a markdown cell emptied of its words keeps the caret (no bar comes up, typing goes back in) and goes, marker and blank lines, when the caret leaves it, ONE Undo with the edit that emptied it | done | `core/test/textCellsSplitMerge.test.ts` (9), `editor/test/textCellsLeftovers.test.ts` (8), `e2e/suites/cells/06-text-cell-leftovers.mjs` (25, real keys and clicks) |

Evidence: `C:\CLAUDIO\agents\e2e\text\text-cells.mjs` (36 / 36 PASS) and `sidebar-snippet.mjs` (1 / 1), instance text-a (9615); `e2e/suites/cells/03-seams.mjs` (29), `04-arrows-to-bar.mjs` (62) and `agents\e2e\sep\separate-cells.mjs` (36) still pass. Not verified: the Mac (it does not know the rule), Sean's own notes.

## Housekeeping (housekeeping lane, 2026-10-06; port-only: the Mac DELETES a note's sidecar and its pictures for good)

| Feature | Status | Evidence |
|---|---|---|
| Delete takes the drawing: the sidebar's Move to Recycle Bin (a note) puts the note in the bin, then its sidecar (all three names it can be read from: `notes.ts` `sidecarsOf`) the same way, never a permanent delete; a section does the same for every note in it; a sidecar another note still answers to (the Mac's `<stem>.json` of two notes of one name) stays; a note that will not go keeps its drawing | done | `apps/desktop/test/housekeeping.test.ts`; `e2e/suites/housekeeping/01-clean-up.mjs` (real right-click, menu item, dialog) |
| File ▸ Clean Up Unused Files… (after Export…; also the sidebar's Folder menu and a project folder row's menu): looks at EVERY note and drawing of the open project (`main/housekeeping.ts`), offers drawings no note answers to and `.drawings/media` files no note's markdown and no remaining drawing names (`mediaInUse` + every file-like name in the texts), matched by name across the project's folders; the app's own dialog "N unused files (size) will go to the Recycle Bin" (Trash on a Mac), the list scrolling, [Cancel] (focused) / [Move to Recycle Bin]; each file looked at again before it goes, drawings first, then their pictures | done | vitest (orphans found, referenced kept, recent kept, cross-folder kept, excluded folders' notes kept, name collisions kept, a missing folder offers nothing, only what was said yes to and is still unused goes); e2e (18 / 18; shots `dialog`, `moved`, `nothing` looked at) |
| Never offered: a file changed in the last 10 minutes; anything the window's unsaved state names (`renderer/cleanUp.ts`: open notes, the words in hand, every editor's undo history, every drawing's Undo / Redo); a drawing while a note of its name is left in the project; anything when a folder or file could not be read | done | vitest ("what the window holds"); e2e (a picture only in Undo stays) |

Not verified: Sean's own notes folder; the Mac (the Trash path is the same `shell.trashItem`).

## Drawing polish (drawing-polish lane, 2026-10-06; docs/TODO.md "Drawing polish")

| Feature | Status | Evidence |
|---|---|---|
| Hover before a click (the Mac's `hovered`, DrawingCanvas.swift): with the pen up (or the Select tool), the object under the pointer, on the page or in a drawing cell, gets a faint dashed outline and faint handles (45 % until the pointer is on one), and the pointer is an open hand; a picture gets the outline only (Sean's Mac rule, 2026-09-18). Nothing on hover edits or picks; the handles linger 250 ms so one can be reached, and a press on one picks the object first (the Mac's `handleDrag`). Not under the pen, the eraser, Ctrl, a tablet pen that always draws, or a cell the pen is scoped to | done | `apps/desktop/test/drawingHover.test.ts`; `e2e/suites/drawing/08-hover-feedback.mjs` (19 / 19, real mouse; shots looked at) |
| Shapes, arrows and text boxes INSIDE a drawing cell: the top bar's tools (and the cell's right-click Text Box / Shape ▸ / Arrow ▸, which arm them) put them in the cell they are used in, in its frame, kept inside it; the arrow tool attaches to the cell's nodes; a node's label and a text box are typed in place (the box grows the cell past its bottom); they are its sidecar items like its strokes: drawn by the cell's canvas on both pages, written into its `ink-<id>.svg` (what the export and other viewers show), moved with the cell, one Undo each. Docking takes shapes, arrows and text boxes too now (BEHAVIOUR CHANGE: a selection with one was not dockable) | done | `packages/core/test/inkCell.test.ts`, `apps/desktop/test/dockUndo.test.ts`; `e2e/suites/drawing/09-shapes-in-drawing-cells.mjs` (20 / 20) |
| Undock (PORT-ONLY: the Mac's PLAN-docking.md leaves it out): right-click a drawing cell or a docked picture (the note's own media) ▸ Undock. The line leaves the note (core `deleteCell` spacing, editor `removeCellLine`), the objects float over the note where the cell showed them (same pixels; a picture at its shown size), picked; ONE Undo puts line and cell back, Redo takes them out again; the picture file and the cell's snapshot stay | done | `packages/editor/test/undock.test.ts`, `dockUndo.test.ts`, `inkCell.test.ts`; `e2e/suites/drawing/10-undock.mjs` (22 / 22) |

Not verified: Sean's Intuos pen on any of it (the e2e uses the real mouse); the Mac (it has neither drawing cells nor undocking).

## Maths cell (maths-cell lane, 2026-10-06; PORT-ONLY: Sean's ask, the Mac has no maths cell kind)

Sean, 2026-10-06: "ctrl + 7 should be PURELY plaintext.. so clearly we need a math cell type.. that should be ctrl + 9
and make ctrl + 10 drawing cells". **This differs from the Mac on purpose: the Mac's ⌘9 is its evaluation cell**
(Ctrl+Shift+8 here since 2026-10-05); ⌘9 / Ctrl+9 here is the maths cell, ⌘0 / Ctrl+0 the drawing cell.

| Feature | Status | Evidence |
|---|---|---|
| A maths cell kind (`{ kind: "maths" }`, core `cells/mathsCells.ts`): the ```` ```wl ```` display-maths fence, typeset when the caret is not in it; Insert ▸ Maths Cell (Ctrl+9, beside Code Block) and the + menu's Maths Cell beside Code Block | done | `packages/core/test/mathsCells.test.ts` (11); `menu.test.ts`; e2e `cells/07-maths-cell.mjs`, `cells/03-seams.mjs` |
| Ctrl+9 at a bar, on an empty line, in an emptied markdown cell: an empty maths cell there, a cell of its own, the caret inside; Wolfram Language typed into it typesets when the caret leaves (both pages) | done | core + `packages/editor/test/mathsCells.test.ts` (7); e2e (real keys: Down arms the bar, Ctrl+9, `Integrate[x^2, {x, 0, 1}]` typed, Down: typeset; shot looked at) |
| Ctrl+9 in a text / markdown cell with words: THAT cell becomes a maths cell, its words the raw source (a text cell's escape backslashes out, a markdown cell's marker line gone); a selection of some words is fenced as Ctrl+8 fences it (halves keep their kind); in a code block the fence becomes `wl`; in an evaluation cell or its `out` answer a NEW maths cell after the pair (the runnable cell is left alone); in a maths cell nothing; in a heading / list / quote a new one after it (Ctrl+8's rule). Each is ONE undo step | done | core, editor tests; e2e (text cell's words → maths → typeset → one Ctrl+Z gives the text cell back) |
| Ctrl+7 on a maths cell: a text cell of the source, plain words by the escape rule, never typeset (Ctrl+7 stays PURE plain text). Ctrl+8 on a maths cell: a ```` ```wolfram ```` code block of the same source (`wl` is the maths fence itself, so a ```` ```wl ```` code block would still be maths) | done | core, editor tests; e2e (both, Ctrl+Z each) |
| Keys: Ctrl+9 Maths Cell (editor keymap `Mod-9`), Ctrl+0 Drawing Cell again (page; it was Ctrl+9 on 2026-10-05). No zoom role uses Ctrl+0 (the menu has none). F1's "Cell Types" group 1 … 9 then 0; the Quick Reference's cell-type rows and a "Maths cells" feature line; KEYS.md, PLAN-text-cells.md | done | `keyList` / `keyGroups` / `welcome` / `menu` tests; e2e (Ctrl+0 makes a drawing cell, one Ctrl+Z; Insert menu accelerators read from the running app); `drawing/08`, `09`, `10` moved to Ctrl+0 and pass (61 / 61) |

Not verified: Sean's own hands and notes; the Mac build (⌘9 / ⌘0 only by the shared command table and the unit tests).

## The cells audit (cells lane, 2026-10-10; docs/PLAN-bars-2026-10.md P7; Sean: "be diligent to make sure the cell behavior, moving the input cursor, search, and undo are all implemented properly")

Verification-first: each of (a)-(g) has an e2e script under `e2e/suites/cells/` that was written against the code as it was and run, with the bugs it found fixed at their cause. Mac note: the suites were written on Windows; on a Mac the harness (`e2e/lib/macKeys.mjs`) sends a chord written the Windows way as that command's own Mac chord, read from `shared/commands.ts`, and a letter with Shift down as the capital a keyboard reports.

| What | State | Proof |
|---|---|---|
| (a) A list (Dots / Dashes / Numbered) made by the + menu, the Style menu or Ctrl+Shift+L at a bar took its first typed word literally (`\- word`): the empty `- ` is a paragraph to the parser, a text cell, and typing in a text cell is literal. The command now names the item it opened (`itemOpened`) and the next typed character is the list's | fixed | `itemOpened.test.ts`; `cells/10` (every kind from the +, then compared with its key) |
| (a) Making or restyling a cell is ONE undo step of its own; the words typed within half a second (CodeMirror's join) are the next step. Cell then language tag: one step. Maths palette (block / inline, at a bar / in a cell / at the end) and Text box: one step | fixed / checked | `cells/10`, `cells/11` |
| (b) The + is a round filled marker in the margin on the bar's line, a 24 px target not clipped to the seam, a hand over all of it; its menu is the shared kind menu in a `FloatingMenu`; a press arms the bar; the menu used to open a scroll's worth away on a scrolled page (the content's rect already moves with the scroll) | done | `plusMarker.test.ts`; `cells/10` (220 checks, both panes); screenshot against FinalMain.png |
| (c) The menu's Move Cell / Duplicate Cell selected the whole cell instead of keeping the caret; held cells on the rendered page were let go by a layout change (the video / sidebar buttons) and the next key then extended a selection | fixed | `holdGuard.test.ts`; `cells/12` (114 checks) |
| (d) A menu opened from a button gave the keyboard back to the BUTTON (a web page's buttons take the focus, the Mac's never do): after Escape the caret was nowhere. It goes to the notes or to a field that had it | fixed | `cells/13` (100 checks: every bar button, the tab row, the pane toggles, the popovers, the right-click menu, the menu bar's commands) |
| (e) Find read the source: the hidden marker line was a match, a text cell's escaped `*` was never found, a link's address counted on the rendered page, nothing marked a match in a drawn block, ⌘G with the bar away reopened the bar and selected nothing, the switches were forgotten on close, every Enter centred the match, and every caret move rebuilt the matches. No regular expression (it never had one). Replace / Replace All: literal in a text cell, one undo step each | fixed | `findVisible.test.ts`, `find.test.ts`; `cells/14` (62 checks) |
| (f) Move Section: the last section of a note (its range runs to the end, without the newline the others carry) landed glued to the text above it and the one moved to the end took a stray newline. The Swift original has the same rule | fixed here | `moveSection.test.ts` (15); `cells/12` |
| (g) The table engine (Tab, Shift+Tab, Return, an empty last row, the delimiter row stepped over, a click on a drawn table's cell) | checked, no bug | `cells/15` (42 checks) |

Known and not fixed: on a Mac with overlay scroll bars the scroll bar is drawn over the right 15 px of the page once it has scrolled and takes the press before the bracket column under it (found by `cells/01` "after scrolling a bracket click picks the cell beside it" and `cells/04` closing a section by its bracket). The e2e instance hides scroll bars on a Mac (`lib/instance.mjs`) so the suites test the app; whether the bracket column should move in from the edge on a Mac with a trackpad is a design question for Sean, not a bug I could settle. Other suites that fail on a Mac the same way on the foundation commit and are not this package's: `chrome/02` (the pen's stroke, 4 checks), `chrome/03` (the Mac menu's extra first menu), `maths/02`, `maths/08` (timeout), `maths/09` (Ctrl+click is a right-click there) and the `drawing` suite, whose scripts wait for a `.wm-canvas` that exists only on the rendered page.
