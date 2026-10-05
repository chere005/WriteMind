# WriteMind (Windows port) status, 2026-10-05, build 0.4.0 plus the working-tree round (docking, ink cells, pen buttons)

Plain words. "Proven" = checked by an automated test or script against the real built app (offscreen, with synthetic
mouse / key / pen events). "Fake data" = checked only with made-up input, so it still needs your hands.

**Nothing of this round is committed, tagged or pushed.** v0.4.0 is already the tag on the last commit (1321583) and
is on GitHub. This round needs a NEW version number (0.4.1 or 0.5.0, your call) once you have tried it.

## State of the gates (gate agent, 2026-10-05, after its fixes)

`npm test` (one full run): 105 files, 1953 pass, 1 skipped, 1 failed. The one failure was a test that wrote two
contents of the same length and so depended on the file clock ticking (`notes.test.ts` "trusts nothing without a
watcher"); the test was fixed and that file passes (35 / 35). `npm run typecheck` clean (one run). The locked build
is clean (one run). Smoke in one isolated instance (`C:\CLAUDIO\agents\e2e\gate\smoke.mjs`, port 9495): 36 / 36 pass
on a fresh note, screenshots `C:\CLAUDIO\agents\shots\gate-*.png` and the exported PDF looked at. (The first two
smoke runs failed on the script's own mistakes: points below the window, a mouse helper that sent the right click as
a chord, ink left over from an earlier run.) Each lane also ran its own vitest files and e2e scripts (core 64 new
tests; editor picture-cells 46 + ink-cell-app 10; dock s1-s4 68; pen/03 54, tablet/02 17, pen/01 7, pen/04 9). Not
run by the gate: the full `npm run e2e`.

**Sheet-tabs gate (later the same day).** `npm test` (one full run): 107 files, 1971 pass, 1 skipped, 4 failed; the 4
were `penEvents.test.ts` / `sheetBoxPaper.test.ts` still expecting the side-button defaults before the swap in
`penButtons.ts` (first button = erase / Undo, second = select / Redo); updated, both files pass (39 / 39). Typecheck
clean, locked build clean. Smoke (`C:\CLAUDIO\agents\e2e\gate\tabs-smoke.mjs`, port 9505): 18 / 18 across a quit and
a restart, screenshots `C:\CLAUDIO\agents\shots\gate-tabs-*.png` looked at. Gate fixes in `main/sheets.ts`: a page
reloaded within the save's quiet moment read the older file (its last stroke was then lost); a `sheets.json` that
cannot be read is now copied aside (`sheets.unreadable-<time>.json`) before the first write replaces it
(`test/sheetsFile.test.ts`, 5 tests).

**Round 6 gate (sheet tools, cell to sheet, tables, welcome note, cells UI, hold image).** `npm test` (one full
run): 115 files, 2067 pass, 1 skipped, 0 failed. Typecheck clean, locked build clean. Smoke on one isolated instance
(`C:\CLAUDIO\agents\e2e\gate-r6\smoke.mjs` + `hold.mjs`, port 9560, fresh notes folder, fake "moving" camera):
32 / 32 after fixes (quick reference opens first; the keys table drawn as a table; seam cursor = vertical-text and a
click arms the bar; Code Block from the menu leaves the caret in the new cell; Ctrl+0 pen draws only in its cell;
right-click > Open in Tablet Sheet, a pen stroke lands in the cell; sheet Erase survives a click in the notebook; Hold
image freezes and a Raw capture is the held frame). Screenshots `C:\CLAUDIO\agents\shots\gate-r6-*.png` looked at.
Gate fixes: a bound sheet holding writing that waits for its note now asks before closing (it used to drop it); while
its note is away the bound sheet's Undo / Redo / Undo button act on that waiting writing and never reach the note in
front; a stroke started in the shaded margin of a bound sheet makes nothing, and one that leaves the cell is cut at
its edge (no flat line along the border), erase uses the real point; a press-and-drag from a seam picks whole cells
again (the Mac's rule; it had become dead); Ctrl+P ends a drawing cell's scoped pen even when it was made with the
pen down; Tab in a table yields to a bar armed by hand in the markdown pane; a bound cell scrolled out of view keeps
its stroke scale. (The first smoke run found a bug in the gate's own first fix: refreshing the tabs from inside the
binding's sync re-entered it and threw the waiting writing away; fixed before the final run.)

**Round 7 gate (the sheet follows the note; quick reference rendered).** `npm test` (one full run): 117 files,
2096 pass, 1 skipped, 1 failed: `pdfPicture.test.ts` wrote two PDFs of the same size inside one tick of the file
clock (its cache key is mtime + size); the test now writes a different size and passes (14 / 14). Typecheck clean,
locked build clean. Smoke on one isolated instance (gate-sync, port 9575, fresh install with the quick reference):
quick reference on the rendered page, a new note and the way back in markdown (4 / 4); the lane's `sync.mjs` all pass
(a drawing tab brings its note, other notes send the sheet back to Sheet 1, ink intact, no loop); a gate check of
closing a tab (4 / 4). Screenshots `C:\CLAUDIO\agents\shots\gate-sync-*.png`, `sync-click-bound.png` looked at.
Gate fixes (`cellSheets.ts`, `tabletSheets.ts`, 2 tests in `sheetFollow.test.ts`): closing the open tab could leave
its neighbour, a drawing tab of a note not in front, open (now the last plain tab, else a new Sheet 1); a picked
drawing tab whose note was brought and then left for another note stayed "waiting", so that note opened later by hand
switched the sheet to it, and Next / Previous Sheet stepped from it (the pick now ends).

## This round (2026-10-05), in plain words

* **The sheet follows the note** (Sean: "automatically switch to the right note tab..."). Picking a "<note>
  Drawing" tab (a click, Ctrl+Alt+PageDown / PageUp) brings its note to the front (its tab, else opened as from the
  sidebar) and scrolls the cell into view; any other note coming to the front sends the sheet back to the last plain
  tab (else the first, else a new "Sheet 1"), remembered in `sheets.json`. A new install's quick reference opens on
  the rendered page, its first open only. Needs your pen: the ExpressKeys / pen buttons for Next / Previous Sheet.


* **Sheet tabs on the tablet** (Sean: "add tabs to the drawing section"). One slim row of tabs above the sheet: each
  tab is its own sheet (ink, paper, dashed box, Undo); Writing / Page, Clear, Erase, Undo and Paper act on the open
  one. "+" adds a sheet, double-click renames, the x closes (a sheet with writing asks "Close?" first; the last sheet
  has no x). Pen ▸ Next / Previous Sheet = Ctrl+Alt+PageDown / PageUp (for an ExpressKey). Kept across restarts in
  the app's `sheets.json`. In camera mode the row is a stub: one "Camera" tab and a greyed "+" (scanned pages, later).

* **Docking.** Pick floating ink or a picture on the page and a dock button (⤵) appears beside it. Click it: a
  picture becomes a picture cell (its own line in the note, as wide as the column at most); ink (or ink and pictures)
  becomes an ink cell. It goes at the bar you armed, else after the paragraph the caret is in. Drag the button
  instead: a bar follows the pointer and the cell goes where you let go; let go over an ink cell and the objects go
  INTO it. Text never sits under a docked picture: the caret and typing go above or below it. One Ctrl+Z undoes a
  dock completely (the objects float again and the line goes).
* **Ink cells** (Sean's "editable ink cells"). A cell of the note you draw in with the pen. Insert ▸ Drawing Cell,
  Ctrl+0, or the + menu at a bar makes an empty one, 200 px tall. Inside it the pen draws, erases and selects as on the
  page; what you move stays inside the cell; text typed above moves the cell and its ink down; drag its bottom edge to
  make it taller or shorter (one Ctrl+Z). The note's markdown gets a line `![ink](.drawings/media/ink-<id>.svg)`; the
  strokes live in the drawing file, and an SVG picture of the cell is written next to the note's pictures so other
  markdown viewers show it. The PDF prints both kinds of cell.
* **Pen side buttons** (Sean's spec). First button (set to Middle Click in Wacom Tablet Properties): hold it while
  the pen touches = erase strokes; double tap it in the air = Undo. Second button (Right Click): hold = select (a
  marquee; a drag inside the selection moves it); double tap = Redo.
  A single tap does nothing. Same on the page, inside ink cells and on the tablet sheet. The Pen popover now has a
  Hold and a Double-tap column per button; older saved choices are carried over.
* **Gate fixes**: docking a picture used to delete every arrow attached to it (now the arrow stays and lets go of
  that end); floating ink lying over an ink cell could not be clicked or erased (the press went to the cell); with the
  Wacom driver set to send a right / middle click for a button, the pen's own hover movements ended the press early
  and many real double taps were missed; one button arriving as a pen event switched the other button's driver click
  off for good; a double tap over the page could undo the tablet sheet instead (it kept the focus); with the Select
  tool, pressing a small object inside a selected big one moved the big one; a docked Mac traced capture (.pdf) printed
  as a "missing" line; ink copied inside a cell vanished when pasted into another note.

## Needs Sean's hands (this round)

* **Decide the version and say "commit, tag and push" again** after trying it: v0.4.0 exists (1321583), so this round
  cannot be v0.4.0 without moving a published tag. Both `package.json` files still say 0.4.0.
* **The Intuos (CTL-472), on the page and inside an ink cell:** hold the lower button and draw over strokes (they
  erase), double tap it in the air (Undo), hold the upper button and drag (a marquee selects; drag inside it moves),
  double tap it (Redo), single taps do nothing, no right-click menu appears. If a double tap does nothing on the page,
  set the Wacom side switches to Right Click / Middle Click with "click on hover"; the app reads those too.
* **The tablet sheet:** the same buttons there, and check that lower and upper are not swapped (Wintab reports them).
* **Sheet tabs:** write on two tabs with the real pen, switch with the mouse and with an ExpressKey set to
  Ctrl+Alt+PageDown / PageUp, quit and reopen. Look: in a tall, narrow video pane the sheet is centred, so the tabs
  sit well above it (a gap); say if the sheet should hug the tabs instead.
* **Docking by hand:** the ⤵ button's click and drag feel, the bar while dragging, dropping into an ink cell.
* **Ink cells by hand:** drawing in one, resizing it with the pen (its bottom 8 px is the resize strip: a stroke
  started right at the bottom edge resizes instead; see `docs/TODO.md`), a photo docked as a picture cell.
* Not looked at by anyone: the light theme for these widgets, and a 150% display scale.

## Earlier round (0.4.0, 2026-10-05), in short

Evaluation cells (Shift+Enter runs ```` ```eval python ```` etc.; Ctrl+9; Wolfram Engine 15.0 is installed here but
**not activated**: run `"C:\Program Files\Wolfram Research\Wolfram Engine\15.0\wolframscript.exe" -activate` once
yourself); the rendered page behaves more like the Mac; cell brackets; smoother scrolling; camera Aspect Ratio; File >
Export... (Ctrl+E) and Help > Keyboard Shortcuts (F1). Still open from it: the wider eval-cell margin decision
(`docs/TODO.md`, Evaluation cells (5)).

## What works (proven)

* The notebook: markdown cells, brackets, seams, the + menu, lists and to-dos, headings, code with highlighting,
  folding, links, tabs, projects, hot exit, session restore, Find / Replace, Export to PDF, and the rendered-page
  editing mode.
* The drawing layer: pen ink with pressure, shapes, text boxes, pictures (paste, drop, crop), connectors with routing,
  grouping, ONE undo timeline across words and drawing, a 1.5x display.
* Docking pictures and ink into the note as cells, ink cells you draw in, the pen's hold / double-tap buttons
  (synthetic pen events only: see "Needs Sean's hands").
* Maths: palette, inline and block typesetting, 2D editing.
* The camera pane: the page found and squared up by itself, writing lifted off the paper as outlines, flow charts
  read into nodes and arrows, reading words with Windows' OCR (English).
* The tablet as a source: the sheet, Send Writing / Page / Chart, box, erase, pen buttons and ExpressKeys, orientation.
* No full screen anywhere, by design. No Pad mode.

## Verified only with fake data (needs Sean's pen)

* The native pen feed (Wintab data + the window pen). The Wintab context opens and closes cleanly on this machine's driver, but NO packet from a real pen has been through the new manager; the sheet and the fallback are proven on injected samples and synthetic pen events.
* That the ink lands the right way up and not mirrored (the frame is a guess from the extents: Orientation fixes a half turn, Reset calibration undoes a chosen frame).
* The feel: latency and smoothing.
* Windows Ink pen signature on the real pen, and the pointer-range message from the real Wacom.
* The setup check is gone. Open the Tablet source with the pen over the sheet; if the pen lands wrongly, Pen popover > Reset calibration / Tablet orientation; the diagnostic is `pen.log` in the app's userData folder.

## Known gaps

* The bottom ~2.5 % of the tablet reaches the taskbar (Explorer sits above any window).
* A real camera has not been tried (focus, exposure, hot-plug, privacy switch). Japanese OCR never ran on a real engine
  (this machine lacks it); raised digits do not become powers on Windows; the Mac's own reader is English only.
* The flow-chart reader can fail on thick or soft pen lines photographed at an angle in poor light (comes in as ink).
* Chart reading is not run from the Aa handle on an existing picture, only on captures.
* Drawing: no hover outline, no snapping or alignment guides, no sweep of orphaned files in `.drawings/media`.
* Docking: no undocking; no shapes, arrows, text boxes, crop or read-into-words inside ink cells; an ink cell does
  not grow as you write past its bottom; the LOW items in `docs/TODO.md` ("Gate (2026-10-05, docking ...").
* Editor: no sidebar date under titles or selected section; a link is followed with Alt-click; no tab reordering
  (the Mac has none either); Alt-D instead of the Mac's Cmd-D.
* Pen trace: the "pen trail" preview on the check's sweep step is not built (Turn / Mirror instead); a side-button
  double-click exit, and following the sheet to a monitor of another shape, are not built.
* Packaging: Windows installer, Linux build and signed Mac build are configured but not exercised this round.
* FEATURES.md still describes a chevron beside the capture button and a Revert button that neither app has.
* Low-priority items from the drawing and chrome verifier rounds were not done; a window killed hard still loses the
  last 500 ms of typing.
* Still open from `docs/PARITY.md` "Next steps": a unit test for the inline regexes and seam Enter / Escape.
  (The held-cell selection colour is done: PARITY "Cell furniture".)

## Editor performance (perf lane, 2026-10-05)

Measured on this PC (i7-14700F, 59 Hz display) in an isolated instance, on a 3509-line note with 301 sections,
lists, to-dos, code, maths, pictures and 500 pen strokes. Numbers are median / p95; "two frames" is 33-35 ms here.

* **Wheel scrolling was the real problem, and is fixed.** 240 wheel steps: frames that missed the display went from
  198 of 736 (27%) to 65 (9%) with no ink, and from 197 to 67 with 500 strokes spread over the note. A bare
  CodeMirror with the same text misses 71-86, so the editor is now at CodeMirror's own floor. Cause: the drawing
  layer was cleared and painted again on every scroll step, blank or not, and any per-frame change to it cost a
  frame. Now a blank layer is left alone, and the ink canvas lives inside the editor's scroller (three panes tall)
  so it scrolls with the words; it is painted again about once a pane. The ink no longer trails the words by a frame.
* **Typing, Enter / Backspace at a section boundary, opening the note, switching tabs and toggling the rendered page
  were already at the display's floor and still are.** Key to painted: 35.2 / 36.0 ms (before 35.2 / 36.2); with 500
  strokes 35.2 / 36.1 (35.4 / 36.2); rendered page 35.2 / 36.3 (35.3 / 36.3). Enter at a heading 35.7 / 48.7
  (34.1-39.0 / 43.7-48.9 across three baseline runs); Backspace 34.7 / 36.5 (35.2 / 36.3). Open 72.6 / 74.5
  (59-70 / 72-74); tab switch 65.5 / 69.9 (50-66 / 69-71); rendered page toggle 48.8 / 56.3 (35-41 / 50-58). Main
  thread per keystroke about 8.6 ms (before 9.4-9.9), of which about 3 ms is script; a bare CodeMirror is 5-6 ms.
* Smaller fixes: a keystroke no longer rebuilds every bracket below the caret (it wrote 8 removals, 8 insertions and
  32 attributes; now nothing), and the ```wl blocks are carried through an edit instead of made again (0.16 to 0.07
  ms of script per keystroke).
* Left: on the rendered page CodeMirror compares a block-decoration set end to end on every keystroke (0.58 ms per
  keystroke on this note, growing with its length), and the In/Out marks force a layout per keystroke in a note that
  has evaluation cells (since the gate, notes without them skip it); both are in `docs/TODO.md`. Evidence: `e2e/suites/perf/02-long-note.mjs`, `docs/PARITY.md` "Editor
  performance".

## Tests that are known stale

`e2e/suites/tablet/01-sheet-as-camera.mjs` crashes at line 55 (no `.camera-bar [data-tablet=box]`; older than this
round). `e2e/suites/pen/03-buttons-and-expresskeys.mjs` and `tablet/02-buttons-on-the-sheet.mjs` still expect the
side-button defaults from before the swap (lower = erase / Undo); not re-run by the sheet-tabs gate. The tablet sheets
are now kept on disk, so a reload no longer empties them: a script that needs an empty sheet clears it. The agents' `C:\CLAUDIO\agents\e2e\wacom\buttons-*.mjs` and `penfeed.mjs` expect the old one-action-per-button
model. The dock and gate scripts in `C:\CLAUDIO\agents\e2e\{dock,gate}\` are still to move into `e2e/suites/`.

In 0.4.0: `penfeed.mjs` (agents folder) checked the wrong field for the trace, and `editor/05-sidebar-drag.mjs`
counted rows inside an open section as root rows; both fixed then. `e2e/known-issues.json` is now empty (the three
tablet flow-chart checks pass again). Older scripts in `C:\CLAUDIO\e2e\` are superseded by `e2e/suites/`.
