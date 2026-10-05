# WriteMind (Windows port) status, 2026-10-04, build 0.3.0-preview.1 plus the working-tree round

Plain words. "Proven" = checked by an automated test or script against the real built app (offscreen, with synthetic
mouse / key / pen events). "Fake data" = checked only with made-up input, so it still needs your hands.

## State of the gates

`npm test` 100 files / 2246 tests pass (1 file skipped: the pen guard proof, which needs real processes). `npm run
typecheck` clean. The locked build is clean. End-to-end suites run on this tree: cells, drawing, maths, pen, tablet,
camera and editor all pass (about 710 checks), plus the Wacom scripts in `C:\CLAUDIO\agents\e2e\wacom\` (pen feed, tablet
flow, buttons, no-full-screen: all pass). Not run this round: `perf` (flaky by nature), `chrome`, and the `grab` suite
(needs the real desktop and moves the real mouse).

## What works (proven)

* The notebook: markdown cells, brackets, seams, the + menu, lists and to-dos, headings, code with highlighting,
  folding, links, tabs, projects, hot exit, session restore, Find / Replace, Export to PDF, and the rendered-page
  editing mode.
* The drawing layer: pen ink with pressure, shapes, text boxes, pictures (paste, drop, crop), connectors with routing,
  grouping, ONE undo timeline across words and drawing, a 1.5x display.
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
* Editor: no sidebar date under titles or selected section; a link is followed with Alt-click; no tab reordering
  (the Mac has none either); Alt-D instead of the Mac's Cmd-D.
* Pen trace: the "pen trail" preview on the check's sweep step is not built (Turn / Mirror instead); a side-button
  double-click exit, and following the sheet to a monitor of another shape, are not built.
* Packaging: Windows installer, Linux build and signed Mac build are configured but not exercised this round.
* FEATURES.md still describes a chevron beside the capture button and a Revert button that neither app has.
* Low-priority items from the drawing and chrome verifier rounds were not done; a window killed hard still loses the
  last 500 ms of typing.
* Still open from `docs/PARITY.md` "Next steps": a unit test for the inline regexes and seam Enter / Escape;
  held-cell selection colour covers the text width only.

## The editor performance pass was skipped

A pass on typing, scrolling and the rendered page for very long notes was planned (it had an instance reserved) and
was NOT done. What exists: the `perf` suite (long-note typing / scroll / ink frame times, generous limits, marked
flaky), and measurements from earlier rounds (600-cell note: about 6 ms per keystroke on the rendered page; 2000
strokes / 50k points smooth; 1500 equations fine). Nobody has profiled a multi-thousand-line plain note.

## Tests that are known stale

`penfeed.mjs` (agents folder) checked the wrong field for the trace; fixed this round. `editor/05-sidebar-drag.mjs`
counted rows inside an open section as root rows; fixed this round. `e2e/known-issues.json` is now empty (the three
tablet flow-chart checks pass again). Older scripts in `C:\CLAUDIO\e2e\` are superseded by `e2e/suites/`.
