# WriteMind (Windows port) status, 2026-10-05, version 1.0.0 (working tree, not committed)

Plain words. "Proven" = checked by an automated test or script against the real built app (offscreen, with synthetic
mouse / key / pen events). "Fake data" = checked only with made-up input, so it still needs your hands.

**Nothing of this round is committed, tagged or pushed.** v0.4.0 is already the tag on the last commit (1321583) and
is on GitHub. This round needs a NEW version number (0.4.1 or 0.5.0, your call) once you have tried it.

## State of the gates (gate agent, 2026-10-05, after its fixes)

2026-10-06 maths-cell round (Ctrl+9 Maths Cell, Ctrl+0 Drawing Cell): `npm test` 138 files, 2418 pass, 1 skipped; typecheck clean; locked build clean; e2e cells, editor, maths, drawing, chrome 40 scripts, 884 / 884 pass; the gate fixed Ctrl+9 unescaping a text cell's ``` line into the fence and dropping Link Here anchors.

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

**v1.0.0 gate (separate cells, text cells, update dialog + licence page, fence arrows, box buttons, Mac Dock).**
`npm test` (one full run): 127 files, 2253 pass, 1 skipped, 0 failed. Typecheck clean, locked build clean, x64
installer `dist-electron\WriteMind-Setup-1.0.0.exe` (113,919,183 bytes) built. Smoke on one isolated instance
(gate-r9, port 9625; scripts in `C:\CLAUDIO\agents\e2e\gate-r9\`): the lanes' text-cells 36 / 36, separate-cells
36 / 36, 05-rendered-fence-arrows 34 / 34, box-buttons 45 / 45, plus the gate's own `gate-extra.mjs` 12 / 12 and
`whole-sheet.mjs`; screenshots `C:\CLAUDIO\agents\shots\gate-r9\*.png` looked at. The installer UI was run to its
licence page (BSD 3-Clause, "Copyright (c) 2026, Shahean Cheren", Next greyed until "I accept"), screenshotted and
cancelled: nothing installed. Gate fixes: a paste at an armed bar is written as it is (cells copied whole kept
their headings, bold and marker; it had escaped everything); a markdown cell's hidden marker leaves when `# ` / `- ` /
`> ` / a fence typed at its words' start makes them another block, and Return there moves it down with them; Ctrl+7
keeps Link Here's anchors and an inline picture's markdown; Link Here into a text cell leaves it a text cell (anchors
are hidden, not formatting); the escape rule is linear on long pasted lines (it took 1.7 s on 16,000 characters,
now ~20 ms); display maths / Ctrl+8 into a paragraph keep each half its kind; whole cells copied give other apps the
words; /link lands its selection on the link; a whole-sheet box puts its button row under the sheet, off the box;
PageUp / PageDown and Escape / Backspace / Delete at a bar no longer stand the caret on a fence; the launch update
dialog never takes Enter as Update now; a failed re-check after a failed download still shows why.

**Mac release gate (two ad-hoc dmgs on the v1.0.0 release; Mac download-mode updates).** `npm test` (one full
run): 129 files, 2300 pass, 1 skipped, 0 failed. Typecheck clean, locked build clean, x64 installer
`dist-electron\WriteMind-Setup-1.0.0.exe` (108.6 MB) + `.blockmap` + `latest.yml` built. `release.yml` and `ci.yml`
parsed as YAML and the job graph walked: prepare (draft) → windows + mac → publish (all five files, then
`--draft=false --latest`); every `needs.prepare.outputs.version` resolves. electron-builder 26.15.3's own code read:
`mac.identity "-"` takes its ad-hoc branch, `notarize: false` skips notarization, the dmg itself is left unsigned.
Gate fixes: the version test no longer pins "1.0.0" (it would have failed the next release's windows job); the
"Two drafts" error message lost its tag (`${env:TAG}`); a Mac update look that fails now writes why to `update.log`;
`main.ts`'s updater comment. **Nothing ran on a Mac**: the first proof is CI's `mac-package` job (push to main or a
manual run), whose `bash tools/verify-mac.sh` checks signature, chips, helper slices, Info.plist and both dmgs.

**Final v1.0.0 gate (2026-10-05):** typecheck clean; `npm test` 129 files, 2302 pass, 1 skipped, 0 failed; locked build clean; full `npm run e2e -- --snapshot` (WM_E2E_ARGS=--disable-gpu, as CI) 10 suites, 47 scripts, 948 / 948 checks, 0 flaky, 0 leftover processes.
Gate fixes (reload from disk): `openNote` names the new note in `openRef` before its words go on the page (two notes with the same words); a CRLF note now takes an outside drawing change and its unchanged words are not put back (`diskReload.test.ts`, 7 tests).

**After-v1.0.0 gate (2026-10-05; no maths in text cells, no Erase on the sheet's bar, unit tests green on macOS; not committed):** typecheck clean; `npm test` 130 files, 2318 pass, 1 skipped, 0 failed; locked build clean; `e2e --suite tablet,maths --snapshot` (WM_E2E_ARGS=--disable-gpu) 13 scripts, 291 / 291. Smoke (port 9651, `after-v1`): "see \`wl:a+b\` here" typed in a text cell shows as typed in the source and on the rendered page (Ctrl+T), the same words in a markdown cell typeset; the sheet's bar has no Erase; screenshots `C:\CLAUDIO\agents\shots\after-v1-*.png` looked at. Gate fixes: `macRelease.test.ts` still required the mac unit-test step's `continue-on-error` (it would have turned CI red on both systems); Link Here's title from a text cell keeps its backticks (`linking.ts`); the sheet's "Erasing" hint says Ctrl+Alt+2 works with the pen over the sheet, and Select puts it down too; KEYS / BUILDING / PARITY brought in line. For Sean: whether Ctrl+7 should keep inline maths' `wl:` source (docs/TODO.md). The mac job's tests are only proven on the next push to main.

**Round 2 after v1.0.0 gate (2026-10-06; drawing polish, housekeeping, text-cell leftovers, box-row pen; not committed):** typecheck clean; `npm test` 136 files, 2392 pass, 1 skipped, 0 failed; locked build clean; full `npm run e2e -- --snapshot` (WM_E2E_ARGS=--disable-gpu) 11 suites, 54 scripts, 1090 / 1090, 0 flaky. Smoke (port 9795, `round2`; `C:\CLAUDIO\agents\e2e\gate-round2\`): 31 / 31 after correcting the gate script's own expectation of the escape rule; hover outline + faint handles, a rectangle in a drawing cell, a picture cell undocked and back with one Ctrl+Z, a deleted note's drawing found in the Windows Recycle Bin, Clean Up listing an orphan and a stray picture (not a used one) and Cancel moving nothing, Ctrl+D on `**x** and **y**` in a text cell, a pen stroke started on the box row drawn on the sheet; screenshots `C:\CLAUDIO\agents\shots\round2\*.png` looked at. Gate fixes: an arrow's hand-moved segments are converted into and out of a cell (they jumped on undock; `inkCell.test.ts`); Clean Up treats the notes root's `.drawings` as shared with every project (a drawing there only when provably this project's, pre-0.3 pictures there never); Delete keeps a Mac `<stem>.json` when the owner cannot be read whole; symlinked notes count; the object clipboard's pictures are held; a partial move says what moved; an emptied markdown cell left while a Redo waits stays (the Redo is kept); Ctrl+M in an emptied cell does nothing; Split on an older note's markdown cell marks both halves; a docked picture's menu keeps a wider selection, has Paste / Select All, opens under the pen, and greys Undock for a captioned picture; a side-button press in the air over the box row reaches it at once again (double-tap timing).

**Ctrl+7 keeps inline maths gate (2026-10-06; not committed):** typecheck clean; `npm test` 136 files, 2396 pass, 1 skipped, 1 failed (the gate's own new test expected bold kept; fixed, `textCells.test.ts` + `sourceStyle.test.ts` 52 / 52); locked build clean; `e2e --suite cells,editor,maths --snapshot` (WM_E2E_ARGS=--disable-gpu) 25 scripts, 562 / 562. Gate fix: an empty `` `wl:` `` (or `wl:` and blanks) is code, as `mathExpressionInCode` reads it: the empty maths run made `inlineSegments` loop for ever (the rendered page froze as it was typed in a markdown cell, Ctrl+7 on it too). Left: a literal backslash right before inline maths in a markdown cell comes back from Ctrl+7 then Ctrl+Shift+7 as an escaped backtick (no maths): Ctrl+Shift+7 reads the words as markdown, by design.

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

* **Try 1.0.0, then say "commit, tag and push"**: the version is 1.0.0 in both `package.json` files and the lock
  file; nothing is committed. Text cells, settled by your "when converting a cell to markdown, it just processes
  markdown": Ctrl+Shift+7 and the automatic switch (Ctrl+B, B I U S, the T menu, /link, inline maths) read the
  cell's words as markdown (a typed `**x**` turns bold, a `# ` line a heading, single line breaks join); one Ctrl+Z
  gives the text cell back. v1.0.0 gate (2026-10-05): typecheck clean, `npm test` 2261 passed / 1 skipped, locked
  build clean, text-cells e2e 44/44 with real keys; fixed /link's landing selection, a selection only touching a
  text cell, the T menu's Remove, a marker line inside a fence. **No GitHub Release exists yet** (tags v0.2.0–v0.5.0
  have none): push to main first and let CI's `mac-package` job go green (the dmgs are its artifact: try one on
  your Mac, Privacy & Security ▸ Open Anyway, docs/INSTALL-MAC.md); then tag `v1.0.0`, which makes a draft, adds
  the installer + latest.yml (windows job) and both dmgs (mac job), and publishes only when all five are there
  (check: `gh release view v1.0.0 --json assets,isDraft`). A failed job leaves a draft: re-run that job.
* **Wacom pen button:** Wacom Tablet Properties ▸ Pen, first button = Middle Click (docs/INSTALL-WINDOWS.md step 7).
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
