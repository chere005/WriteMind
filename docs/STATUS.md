# WriteMind (Windows port) status, 2026-10-05, build 0.3.0-preview.2 plus the working-tree round

Plain words. "Proven" = checked by an automated test or script against the real built app (offscreen, with synthetic
mouse / key / pen events). "Fake data" = checked only with made-up input, so it still needs your hands.

## State of the gates (gate agent, 2026-10-05, after its fixes)

`npm test` (one full run): 97 files, 1834 tests pass, 1 skipped, 0 failed. (Fewer than the 100 / 2246 of
preview.1: preview.2 removed the overlay and Pad tests on purpose; this round added 14 files.) `npm run typecheck`
clean. The locked build is clean. Smoke in one isolated instance (`C:\CLAUDIO\agents\e2e\gate\smoke.mjs`, port 9460):
26 / 26 pass, screenshots in `C:\CLAUDIO\agents\shots\gate\` looked at. Each lane also ran its own e2e scripts (eval
28, eval-marks 139, preview 42 plus the older preview scripts, cells 41 + 61, perf 10 plus drawing 42, camera 37,
export + keys all pass). Not run by the gate: the full `npm run e2e` (the round's rule: one full test run only).

## This round (2026-10-05), in plain words

* **Evaluation cells.** A code cell fenced ```` ```eval python ```` (or `wl`, `c`, `c++`, `rust`) runs with
  Shift+Enter; the answer goes in an `out` cell under it, as its own Ctrl+Z step, with the caret left under the answer.
  Ctrl+9 makes one (Wolfram until you pick another from the cell's mark; the last pick is remembered). The left margin
  shows `In[n]` with the language under it, and `Out[n]`; a spinner while it runs (click it to stop). A run has a 20 s
  limit and a 64 KB output cap, and is killed, with everything it started, when you stop it, close the note or quit.
  Python ran for real here. **Wolfram Engine 15.0 is installed on this PC and the app finds it, but it is not
  activated** (see below). C, C++ and Rust are not installed, so they have never run.
* **The rendered page** behaves more like the Mac: heading marks, bullets and to-do boxes stay drawn while you edit a
  block; Backspace / Return in to-do lists keep the boxes; Escape closes a block; Ctrl+1..7 at a bar make that kind
  of cell there; spacing, heading sizes and code boxes follow the Mac.
* **Cell brackets**: hovering one washes the cells a click would take; held cells are drawn as one box each; brackets
  line up with their cells; a selection inside code shows.
* **Scrolling is smoother** (missed frames 27% to 9%), and pen ink now scrolls with the words instead of a frame behind.
* **Camera**: Aspect Ratio menu, double-click fills the window (never the display), bigger Page captures, thinner
  Writing trace. Pen popover closes on Esc / click outside.
* **Export and keys**: File > Export... (Ctrl+E) asks PDF or Project in one panel; Help > Keyboard Shortcuts (F1)
  lists every key.
* **Gate fixes**: switching notes while a cell ran left that cell "running" for ever when you came back (Shift+Enter
  did nothing) - fixed; an older ```` ```python ```` + ```` ```out ```` pair drew `Out[1]` over its words - fixed (it
  keeps the normal margin, the mark fits in front); a cell that exits while something it started keeps its output
  open no longer hangs the run; the In/Out marks no longer measure the page on every keystroke in notes without them;
  the "not activated" sentence now gives the full wolframscript path; the repo e2e `editor/08` used the old
  Ctrl+Shift+P (now Ctrl+T); stale key names in the docs.

## Needs Sean's hands (this round)

* **Wolfram: activate it once, yourself.** It is installed (Wolfram Engine 15.0, 11:01 today) but not activated and
  not on the PATH. In a terminal run
  `"C:\Program Files\Wolfram Research\Wolfram Engine\15.0\wolframscript.exe" -activate` and sign in with your Wolfram
  ID (it accepts Wolfram's licence; no agent may do that for you). Nothing to download or install. Then Ctrl+9,
  type `1 + 1`, Shift+Enter: `Out[1]` should say 2. Adding that folder to PATH is only needed for a terminal.
* **Decide: the wider margin.** A note with an evaluation cell gets a 48 px left margin (so `In[n]` / `Out[n]` are
  one size). When a note gets its FIRST eval cell, or loses its last, all its words move 18 px sideways and any pen
  ink drawn over them stays put. Keep it, use one wide margin for every note, or go back to small shrunk marks
  (`docs/TODO.md`, Evaluation cells (5)).
* Try with a real keyboard and mouse: Shift+Enter and Ctrl+9 in an eval cell, the mark's menu, the rendered page
  (to-dos, headings, Escape, Ctrl+1 at a bar), bracket hover and held cells, wheel scrolling a long note with ink.
* Judge the new spacing on the rendered page, and the deliberate differences (Return on an empty to-do ends the
  list; Delete at a to-do's end joins the next).
* The real Windows save dialog from File > Export... ("Save as type" lists PDF and Project).
* A real camera: Aspect Ratio shapes, double-click full-window, the thinner Writing trace.
* Not looked at by anyone: the light theme for this round's changes, and a real 150% display scale.

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

`penfeed.mjs` (agents folder) checked the wrong field for the trace; fixed this round. `editor/05-sidebar-drag.mjs`
counted rows inside an open section as root rows; fixed this round. `e2e/known-issues.json` is now empty (the three
tablet flow-chart checks pass again). Older scripts in `C:\CLAUDIO\e2e\` are superseded by `e2e/suites/`.
