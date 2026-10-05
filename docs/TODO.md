# What is left

The port's list. A to-do here is something UNBUILT or a bug UNFIXED —
never "not yet checked on screen".

## Ported and running

The notebook: the parser, the cells and their brackets, the seams and the
bar, the + and its kinds, the heading ladder, the four list styles with
tickable to-dos, quote, fenced code, bold/italic/underline/strike, indent
and outdent, split and merge, move section, the note tree, the tab row, the
autosave with its write guard, the folder watcher, File ▸ Export… (PDF or Project, one panel), Help ▸ Keyboard Shortcuts, and the
capability table. Also: folding (double-click a section bracket, or the ⋯
marker; remembered per note), the session (open notes, the one in front,
caret and closed sections, restored on launch from the app's user-data
folder), dragging a row (reorder, move into a section, a section into a
section; the open tab follows the file), `/link` and following a link,
`<span style>` font/size/colour (the T button), the code highlighter for
C, C++, Python, TypeScript, Rust, Java, Bash, Zsh and Wolfram (a
transcribed scanner, no CodeMirror language packages), Alt-D, the
rendered-page toggle, and evaluation cells (```` ```eval python ```` and friends: Shift+Enter runs one in the main
process and writes the answer under it, Ctrl+9 makes one, `In[n]` / `Out[n]` in the margin). The editor-level e2e scripts are in the repo now:
`e2e/suites/editor` and `e2e/suites/cells` (`npm run e2e -- --suite editor`;
`docs/TESTING.md`).

## Not ported yet, in the order they are worth doing

- **Evaluation cells, what is left** (eval lane, 2026-10-05; the rest is built: `docs/PARITY.md` ▸ "Evaluation
  cells"). (1) **C, C++ and Rust have never run on Windows**: none of `gcc`/`clang`/`cl` or `rustc` is on this
  machine; they are unit-tested with the process layer faked. Install one and run
  `C:\CLAUDIO\agents\e2e\eval\run.mjs`-style checks before trusting it. `cl` additionally needs a Visual Studio
  developer prompt's `INCLUDE`/`LIB` (passed through only when the app was started from one). **Wolfram**: the Engine
  15.0 is installed now and found (`Wolfram Engine\15.0\wolframscript.exe`), and a real cell reaches it, but it is NOT
  ACTIVATED and not on the PATH — Sean runs
  `"C:\Program Files\Wolfram Research\Wolfram Engine\15.0\wolframscript.exe" -activate` with his own Wolfram ID; then
  `C:\CLAUDIO\agents\e2e\eval-marks\run.mjs` proves `1 + 1` gives `2` (it checks this whenever the tool is found).
  (2) **Language icons instead of letters** (Sean's a608cc3 ask "use icons for WL, CPP, Python"): not built — the mark
  still says `WL` / `PY` / `C` / `C++` / `RS` (now under `In[n]` too, Sean 2026-10-05); icons need drawn art,
  monochrome so they follow the theme, and must fit the 43 px mark column.
  (3) **The Mac's per-tool override** (`evalTool.<name>` in its defaults: a moved tool or a different Python without a
  build): not ported; tools come from the PATH, `~\.cargo\bin` and Program Files only. (4) After a run the bar is
  scrolled to by CodeMirror's "nearest", not the Mac's short animation landing it low on the page (799b13b / "make the
  cursor behavior after evaluating a cell elegant").
  (5) **SEAN DECIDES: the wider margin moves a note's words, not its ink** (gate review, 2026-10-05). A note with an
  `eval` cell has a 48 px left margin (`EVAL_MARGIN`, so `In[n]`/`Out[n]` are one size); every other note keeps 30 px.
  So when a note gets its FIRST evaluation cell (Ctrl+9, the menu, typing ```` ```eval ````), or loses its last one,
  all its words move 18 px sideways while pen ink stays where it was drawn (ink is placed on the page, not on the
  words). The Mac does not move other text: its 44 pt column sits in front of the eval cell only. Choices: keep it
  (only notes that gain an eval cell are affected; no note had one before this round); one wide margin for every note
  (moves all existing notes once); or the 30 px margin with the marks shrunk to fit (what Sean asked to get rid of).
  Older pairs (```` ```python ```` over ```` ```out ````, no `eval` fence) keep 30 px and their `Out[n]` is sized to it.
  (6) A cell's process that exits while a grandchild still holds its pipes now lets the run settle after 750 ms
  (`PIPE_GRACE_MS`, runner.ts) and is never killed by its stale PID; the grandchild itself is NOT killed (it has left
  the tree `taskkill /T` walks). A Windows Job Object with kill-on-close would catch it; it needs native code.
- **The drawing layer, the rest of it.** Everything on the Mac's list now
  works: pictures (paste, drop and Insert ▸ Image land them; the ✂ handle on
  a picked picture opens the crop box — four corners, ✓ keeps the part as a
  new file via `cropped`/`cropRect`), a node's label (double-click it),
  connector routing (`reconnect` after every change, including a change
  that arrives from outside the canvas such as a capture or a window resize;
  the line drawn from `route(connector)` with right angles; a circle on
  every segment of a picked routed line, dragged into `overrides`; an arrow
  dropped with an end on a node is attached to it — `attachableAt`), and
  undo through the app: ONE timeline of edits per note (`editTimeline.ts`,
  `noteHistory.ts`, `useUndo.ts`; 2026-10-03, d2-undo-tour). Every edit of the
  words (CodeMirror's history stays the engine) and of the drawing
  (`DrawingHistory`, shared by the canvas, a paste and a capture) is stamped
  on the note's clock, and Ctrl+Z / Ctrl+Shift+Z / Ctrl+Y (and Edit ▸ Undo /
  Redo in the app's own menu) take back exactly the most recent edit,
  whichever it was; Edit ▸ Undo Drawing / Redo Drawing stay the drawing's own
  pair; each open note keeps its own timeline. E2E:
  `e2e/suites/drawing` (connectors, pictures, ink, text boxes, marks) and
  `e2e/suites/pen`, plus `C:\CLAUDIO\agents\e2e\d2\` (`u1`-`u6`, `t1`-`t9`,
  `perf*`, to be moved into the suite).
  **Audited again 2026-10-03 (d1-shapes):** rounded rectangle and oval are
  drawn as curves, the Marks palette is the Mac's, an Arrow tool and
  Alt-drag attach arrows, a style bar sets an arrow's heads and line and any
  pick's colour / width / fill, the group handle says Ungroup, a pasted
  picture arrives picked, handles stay on the pane. Port extras: arrow-key
  nudge, copy / cut / paste of objects (also between notes), order
  commands. Still unbuilt: handles / an outline on hover (the Mac shows
  them before a click), snapping / alignment guides and lock (the Mac has
  none), a text box's font size (not in the Mac's model either), a sweep of
  the orphaned files in `.drawings/media` (every paste and crop adds one and
  nothing removes them; projects can add note roots, so the sweep has to
  know every root before it may delete). Pressure strokes are smoothed now.
  **Toured and fixed 2026-10-03 (d2-undo-tour):** the geometry was quadratic
  in a stroke's length (erase, drag and repaint on a page of hand writing),
  the mouse wheel did nothing with the pen down, an arrow being drawn had no
  rubber band, and a drawing edit made just before a tab switch or a window
  close was lost. 2000 strokes / 50k points are smooth. Detail:
  `docs/PARITY.md`, last section; e2e `C:\CLAUDIO\agents\e2e\d1\` and `d2\`.
- **The camera, the rest of it.** The viewfinder, the box, Writing and Page,
  the ink lifted off the paper, the capture landing where it was on the
  page, reading the words out of a picture on macOS, WARPING (the
  "Straighten" button: drag the four corners onto the page's, and
  `warpToPage` undoes the perspective in plain arrays — the box is carried
  through the same homography with `pageBox`, and the page's true shape comes
  from `pageAspect`, the pinhole estimate, not from edge lengths) and the
  FLOW-CHART READER (`capturePipeline.ts`: a Writing or Page capture runs
  `flowChartItems` on its ink at 800px; a chart lands as nodes and arrows in
  a band under the picture, the arrows routed on arrival, and one Undo takes
  the picture and the chart back together) all work. E2E with Chromium's fake
  capture device playing a .y4m: `e2e/lib/fixtures.mjs` (the feeds),
  `e2e/suites/camera`. READING THE WORDS is done on Windows too (Windows' own
  OCR engine, `docs/OCR-WINDOWS.md`): the Aa handle with the Mac's
  struck / ringed / arrow / task / maths rules, and a chart's nodes arrive
  labelled with the words inside them from a camera or tablet capture
  (`chartFromLabelled`). **FINDING the page by itself: DONE** (c2-camera-parity,
  2026-10-03): `capture/findPage.ts` finds and refines the page's four corners
  in plain arrays on every platform (threshold + hull, a line vote for a pale
  desk), Straighten starts its corners on the page, every capture squares the
  page up by itself; the writing comes in as traced OUTLINES (an SVG,
  `capture/inkVector.ts`); Raw; the dashed box with Image / Writing / Text and
  click-clears (with no box, click-takes-all) / double-click fills the WINDOW with the picture (Mac 0edfc08, camera lane 2026-10-05); Resize by Square (`cameraZoom.ts`);
  the camera menu with a tick, Turn Camera Off (the pane stays, with a list),
  the source remembered across launches, hot-plug, the Mac's four stand-ins
  for no picture with Windows' words, the quarter-turn buttons remembered,
  no stream left running. Detail and evidence: `docs/PARITY.md`, "The camera,
  beyond OCR"; e2e `C:\CLAUDIO\agents\e2e\camera\` (`runall.mjs`). Still
  missing: (1) **a real camera**: the finder and the pane were built against
  synthetic projected scenes and Chromium's fake device only — focus,
  exposure, lens distortion, a hand on the page, a coloured cover, hot-plug of
  a real USB camera and Windows' privacy switch are untried; (2) Japanese OCR on
  Windows is built but never run on a real engine (it needs the Windows
  Japanese OCR capability, which the development machine lacks), and raised
  digits do not become powers there (no per-character boxes); (3) the chart
  reading is not yet run from the Aa handle on a picture (the Swift
  `flowChart(from:under:)`) — only on captures; (4) the Mac's own reader
  (`wm-vision text`) still reads English only, with no word boxes, so on a
  Mac the marks are read off estimated word boxes; (5) the flow-chart
  classifier is borderline on thick or soft pen lines (a box of three was
  refused at one down-scale and read at another; reading now runs at 1200 px) —
  a chart photographed at an angle in poor light may still come in as ink only;
  (6) FEATURES.md still describes a chevron beside the capture button that the
  Mac's code no longer has (the three modes are the box's choices; the port also
  has Writing / Page / Raw buttons).
- **The rendered page: DONE** (e1-preview, 2026-10-03; "Write in the preview").
  The toggle (◧ on the bar, Ctrl+T) draws every block — headings as
  headings, real bullets, to-do boxes that tick, quotes, coloured code, maths,
  pictures, links that go — and opens the one you click as its own styled
  markdown; Return starts the next block (carrying a list on), Backspace in an
  empty block removes it, the arrows walk block, bar, block, the bar between
  two blocks adds one, the whole bar works on the open block, and the
  brackets, seams, + menu, folds and held-cell commands are the markdown
  side's own. The pure rules are in `packages/core/src/cells/preview.ts` and
  `markdown/sourceStyle.ts` (tests `preview.test.ts`, `sourceStyle.test.ts`,
  transcribed from `PreviewEditingTests`, `PreviewSeamTests`,
  `PreviewLayoutTests`, `ArmedBarTests`, `CellSelectionTests`,
  `CellCommandTests`); the page is `packages/editor/src/preview/`. E2E:
  `C:\CLAUDIO\agents\e2e\preview\run-all.mjs` (port 9411). How it differs from
  the Mac (deliberately): ONE CodeMirror view, one document, one undo — the
  drawn blocks are widgets standing over the characters they came from, not a
  second view with its own text, so there is nothing to convert and nothing
  to keep in step. Still open: dragging a selection from inside a drawn
  block (a press opens it, so the drag starts in the open block).
  **Mac 0fdd031 / 0cde812 / e66379c / b98a7a5 (preview lane, 2026-10-05): DONE** — the open block edits what is
  WRITTEN: a heading's hashes, a bullet, a number and a to-do's box are furniture (drawn as the closed block draws
  them even on the caret's line, the caret kept out of them, Backspace behind one takes all of it); a checklist is
  edited with its boxes intact and nothing moves when it opens (Backspace joins / removes items, a tick keeps the
  caret); Escape closes the open block; a kind command at a bar makes that cell there; headings are the Mac's
  rendered ladder (28/22/18/16/15/17) open and drawn; the gap between cells is a blank line of the markdown side
  (21.75px), a code block pads by half its text and opens without moving anything. Rules:
  `cellFurniture`/`outsideFurniture`/`furnitureBehind` (sourceStyle.ts) and `remindersIn`/`splitReminder`/
  `removeEmptyReminder`/`joinPreviousReminder`/`previewOnScreen`/`PREVIEW_BLOCK_GAP` (cells/preview.ts); tests
  `cellFurniture.test.ts`, `listEditing.test.ts`, `preview.test.ts`, `previewFurniture.test.ts`; E2E
  `C:CLAUDIOagentse2epreview2urniture.mjs` (port 9425). LEFT: (1) a command with NO kind at a bar (Bold,
  maths) still does nothing there — the Mac opens a plain cell and runs it in it (keys.ts `run`/`applyEdit`, a list
  of cell commands that must still do nothing: delete, duplicate, move, split, merge, expand); (2) the PDF export
  still stacks cells 8px apart (`export/blocks.ts` `PAGE.gap`; the Mac's NoteExport uses blockGap since 0cde812 —
  export lane, its tests pin coordinates); (3) b98a7a5: the evaluation lane's bar under an answer already moves the page only when it is
  off it (CodeMirror's "nearest"); the Mac's CARRIED landing (a 0.22 s ease to 0.8 down the window,
  `PREVIEW_LANDING`, with `previewOnScreen` asked first) is not built; (4) Return in an EMPTY to-do ends the list here (the Mac's one-item editor makes another
  empty one) — kept on purpose; (5) Delete at the end of a to-do joins the next one on (the Mac's one-line editor
  does nothing there) — a port addition; (6) a done to-do is struck through while its list is open, the one being
  typed in too (the Mac's open item is plain).
- **Maths: DONE** (maths lane, 2026-10-03; palette and tour by m2-math-tour). The
  ƒ(x) button / Insert ▸ Maths… (Ctrl+Shift+M) opens `MathPalette.tsx`, the
  Mac's `MathMenu`: one scrolled pane of all six groups, a field per slot, the
  editable Wolfram Language line, a typeset preview, "On its own line", Insert
  — and it is fully usable by keyboard (arrows pick, Tab walks, Enter inserts,
  Ctrl+Enter the other way, Esc gives the note back; `docs/KEYS.md`). The
  notebook extension (`packages/editor/src/math.ts`) typesets a `wl:` code
  span and a `wl` fence (the Mac's rule: any line starting with three
  backticks after its indentation, so one inside a list item too) as MathML,
  drawn by Chromium's own MathML Core; the tree is a pure builder in
  `packages/core/src/math/mathml.ts`. Tests: `mathml.test.ts` (53),
  `math.test.ts` (every Swift maths test + a round trip over all 130
  templates), `mathTemplatesParity.test.ts` (the palette's data against the
  reference Swift, field for field). E2E: `C:\CLAUDIO\agents\e2e\m2\`
  (`palette`, `tour`, `perf`, `rendered`, `print`; port 9417) and
  `..\maths\math2d.mjs`. What is different from the Mac: the WL reader also takes a lone
  `=`, raised digits and ≤ ≥ ≠ × ÷ − (the OCR path hands over exactly that); the
  Swift SwiftUI view is not pixel-matched. Not done: editing the typeset form
  in place (the Mac does not either — a click opens the source); `x^(1/n)` is
  not an nth-root sign (the palette's "nth root" writes that form on purpose,
  as on the Mac). Running Wolfram is an evaluation cell (```` ```eval wl ````, see
  "Evaluation cells" below); the maths fence `wl` is never run.
  After the independent check (Mathslane-fix1, 2026-10-03; `docs/PARITY.md` ▸
  "Maths, after the independent check"): an equation wider than the pane no
  longer bends the whole note (`.cm-content { min-width: 0 }`; a block scrolls
  in its own box); `3 × 4` and `a · b` keep their
  sign on the page and a number after a factor always has a visible dot
  (`2*3` is `2·3`, the Mac draws `2 3`); the palette keeps the keyboard however
  it was opened, and after a click on its heading. E2E in the repo:
  `e2e/suites/maths/0{2,3,4}-*.mjs`. Open: a very wide BLOCK equation inside a
  quote or list item scrolls in its line, not in the item.
  After the second independent check (Mathslane-fix2, 2026-10-03; `docs/PARITY.md`
  ▸ "Maths, after the second independent check"): inline maths is the Mac's
  LINEAR run again (the 2-D inline-block overlapped neighbouring lines and
  stole their clicks), so an inline equation wraps like words and the scroll
  box for a wide one is gone; a typeset block no longer swallows text on its
  closing-fence line (Insert puts the caret on the line after the block; a
  block with text after its closing backticks stays source); a power of
  `Exp`, `Dot`, `Log[b, x]`, a sum… is bracketed; `f(2)`, `y(0)`, `f(x)` keep
  their brackets and take no dot. E2E `e2e/suites/maths/0{5,6,7}-*.mjs`, unit
  `mathFix2.test.ts`. Not done: `f(x, y)` in round brackets is not an
  expression (stays text).
  After the third independent check (Mathslane-fix1, 2026-10-04; `docs/PARITY.md` ▸ "Maths, after the third independent check"):
  the rendered page (Ctrl+Shift+P) no longer kills the inline-maths plugin, and the first keystroke in a short note no
  longer kills the markdown decorations; the linear typesetter is linear in nesting depth (it was exponential); nested
  scripts keep their levels (`e^(−x²)`, `x^(y^z)`); Shift+click, right-click and a drag on typeset maths behave as
  they do on words. E2E `e2e/suites/maths/{08,09,10}-*.mjs`, unit `mathFix1.test.ts`, `mathInline.test.ts`. Not done: a
  drag that starts on an equation autoscrolls only as far as CodeMirror's "scroll the head into view" goes; Ctrl/Cmd-click
  on an equation does nothing (the drawing layer's marquee, as on words).
  Resumed pass (m2-math-tour): everything above re-verified on the final tree, see `PARITY.md` ▸ "Re-run on the final tree". Left for Sean's hands: a real IME composing Japanese beside a maths span (CDP `insertText` only was driven).
- **Export PDF and maths** — DONE (p1-projects-pdf): the export is its own print
  HTML (`packages/core/src/export/*`, `main/exportPdf.ts`), maths is the
  notebook's MathML (`mathmlString`), a too-wide equation is zoomed to fit,
  and the dialog goes through `askSave`. What the maths lane asked for, for
  the record:
  (1) build each `wl:` span and `wl` fence with `mathElement(source, {display})`
  from `@writemind/editor` and include `MATH_CSS` (`installMathStyles`) — no
  script is needed at print time, MathML is plain markup; (2) an equation
  wider than the page is a scroll box on screen (`.wm-math-block { overflow-x:
  auto }`) and is CUT OFF in print — in print give it `overflow: visible` and
  scale a block whose `scrollWidth` exceeds the page (`zoom`), measured in
  `e2e/m2/print.mjs` (a 750 px equation in a 717 px column); (3) a source that
  does not parse stays the user's text in mono, as in the notebook; (4)
  `currentColor` is used throughout, so a white print page gets dark maths.
  (The e2e answers the dialog with `e2ePick` now.)
- **Handwriting to maths, for the OCR lane**: `wolfram()` (`handwritingMarks.ts`)
  turns `√x` into `Sqrtx` (no brackets), as the Swift does; typeset it is a
  symbol named Sqrtx. `Sqrt[x]` needs the radicand found (a bracketed run, or
  the next token).
- **Wacom, needs Sean's hands (wr-wacom-core, 2026-10-04):** (1) on the real CTL-472 touch the top-left then the bottom-right corner once (the line on the sheet) and check that the corners of the tablet land on the corners of the sheet, pressure varies and the side button boxes; (2) the system mapping (pen confined to the sheet) was only tested with fakes: watch `pen.log` for `map-honoured` / `map-refused`; if refused, nothing is lost (the pen simply is not confined; Retry is in the Pen popover). Not built: a mapping for a turned (Portrait) sheet, per-monitor DPI changes while the pen is down.
- **The Wacom tablet, what is left** (Wacom lane, 2026-10-03; the Grab / overlay parts are history, see PARITY "Sean's verdict"). DONE: Pad mode was
  REMOVED on purpose (Sean never asked for full screen; nothing in the app
  can enter it, `PARITY.md` "No full screen"); the sheet pane, the
  orientation dropdown, pen buttons / ExpressKeys, the Area helper and Grab
  stay, and the Grab overlay is configured so Windows cannot mistake it for
  a full-screen app. NEEDS SEAN'S HANDS (no Wacom was available): that the
  real pen's Windows Ink events carry the signature the hook looks for (the
  HUD's pen/mouse counts), that the overlay never disturbs the taskbar on his
  display with the taskbar auto-hidden and not. KNOWN LIMIT: the bottom 2.5 %
  of the tablet (the taskbar's 30 px band) clicks the taskbar, because
  Explorer's taskbar is above any top-most window (`PARITY.md` "Known limit"). NOT BUILT: a side-button
  double-click exit, a Wintab / raw-input backend for Grab (Grab is the
  fallback then), following the sheet to a monitor of another shape. The e2e
  scripts are in `C:\CLAUDIO\agents\e2e\wacom\` (`run-all.mjs`);
  `tablet-flow.mjs` fails its three flow-chart-reading checks (the capture
  lane's chart reader is being rewritten; its unit tests pass).
  **TABLET WAS DOWN (2026-10-03, found by wspike-webhid; Code 10, `STATUS_IO_TIMEOUT`,
  router driver `WacHidRouterPro` 4.0.0.4), BACK by 21:25 (PnP OK, HID children
  present).** Earlier spikes ran on the dead tablet, re-check their "unverified" lines.
  WebHID pen backend (wspike-webhid): on the real tablet `open()` works with the driver
  running and real reports reach the listener (5 s vendor heartbeat, also with the window
  hidden/throttled); the CTL-472 is ONE HIDDevice with the standard pen report 213 and a
  vendor report 220. Decoder + source drafted and tested outside the repo (46 vitest, real
  descriptor fixture). UNVERIFIED: that report 213 streams strokes. Needs someone moving a
  pen for 25 s: `C:\CLAUDIO\spikes\webhid-spike\tools\live.ps1 -Seconds 25`
  (`docs/spikes/wacom-webhid.md`). Re-checked 2026-10-04 (tablet still OK): same result on a
  private `pen-hid` session partition with a `show:false` window, so the planned hidden
  helper window is viable as designed; still no stroke seen.
  **WebHID backend now in the repo (wimpl-b-webhid, 2026-10-04):** `main/pen/webhid/*`,
  `preload/penHid.ts`, `helpers/pen-hid.html` (PARITY "WebHID backend, in the repo").
  TO DO by the manager/registry lane: build it with `createWebHidBackend({session:
  session.fromPartition("pen-hid"), preload: <out>/preload/pen-hid.cjs, page:
  <out>/helpers/pen-hid.html, log})` and make `manager.dispose()` / `close()` run before the
  last notes window goes (the hidden helper window counts as a window; its watchdog closes it
  within 2 s if that is forgotten). NEEDS SEAN'S HANDS: one stroke with the check running (or
  `run.ps1 -Live` plus a moving pen) to see whether report 213 streams in Pen mode + Ink; if it
  does not, `settings.backends.webhid=false` costs nothing (Wintab / Raw Input / `dom` carry
  the pen). Not built in this lane: a WebHID-specific trace analyser (the generic
  `tools/pen-analyse.mjs` of the check lane reads `lay` + `raw` records).
  Raw Input + HID backend (wspike-rawinput): the whole delivery path is built and
  proven with real `WM_INPUT` (koffi message-only window recommended over
  `hookWindowMessage`; both work in Electron 44), decoder driven by Windows' own HID
  parser, 8 ms batcher, trace recorder; `RIDEV_NOLEGACY` cannot stop the pen (error 87
  for the pen usage; no effect on the cursor for the mouse usage). Real Wacom caps now
  read: pen collection Col03 (report 209, 38 bytes) and a duplicate Col04 (report 213),
  X/Y **tablet-normalised 0..32767** over 15200 x 9500, pressure 0..2047, tilt +-90 deg,
  two barrel bits; vendor Col02 gives raw counts. Still UNVERIFIED (needs a moving pen):
  that Col03/Col04 stream `WM_INPUT` in Pen mode + Ink. One command with someone
  moving the pen: `C:\CLAUDIO\spikes\rawinput-spike\tools\live.ps1` (`docs/spikes/wacom-rawinput.md`,
  which also holds the integration plan for `apps/desktop/src/main/pen/`). Also
  worth doing then: pen-vs-mouse by RAWMOUSE device node (`VID_056A`) instead of the
  `0xFF515700` signature, which Windows' synthetic pen carries but Sean's real pen
  probably does not.
  The main window's `webPreferences` has no `backgroundThrottling:false`; any
  pen source living in a page needs it (timers drop to 1 Hz when occluded).
  **Containment spike (wspike-contain, `docs/spikes/wacom-containment.md`):**
  `ClipCursor` and a swallowing mouse hook do NOT stop a Windows-Ink pen
  (synthetic pen, measured), so neither is built into the app;
  `RegisterPointerInputTarget` needs UIAccess (denied). Unbuilt, in this
  order: (1) a visible dead band for the taskbar's 30 px on the Grab sheet
  (map the tablet over the work area); (2) `RegisterPointerDeviceNotifications`
  as the "pen in range" signal in Grab (works unelevated; replaces the
  signature hook, which a pointer-handling Chromium window never feeds);
  (3) an opt-in "confine the mouse while the pen is in range" for Mouse-mode
  tablets from the drafted `C:\CLAUDIO\spikes\contain-spike\clip.ts` +
  detached `guard.mjs` (a clip outlives its process; libuv kills non-detached
  children with the parent), plus `sweepStaleClip` at launch. Re-check 2026-10-04: the tablet is healthy and
  `GetPointerDevices` now lists it (CTL-472, device rect 15201x9501 himetric, mapped to the whole screen), so
  `ptHimetricLocationRaw / (15201, 9501)` is a candidate tablet-native source from any pointer-aware window.
  NEEDS SEAN (tablet
  back): run `C:\CLAUDIO\spikes\wspike-contain\probe.cmd` (20 s) to see whether the real
  pen is clamped and whether the hook ever sees it.
  **Wintab spike (wspike-wintab, `docs/spikes/wacom-wintab.md`):** reachable from Electron main via koffi; data and
  system contexts open/close cleanly; hidden-window message hook works; drafts in
  `C:\CLAUDIO\spikes\wintab-spike\` (`wintab.ts` decoder + normaliser to `PenSample`, `wintabNative.ts`,
  `wintabPen.ts` service, `trace.ts`/`capture.cmd` recorder; 54 tests, tsc clean) - the build lane moves them to
  `apps\desktop\src\main\pen\`. Tablet is healthy again (re-checked 21:23: NDEVICES 1, same portrait extents, contexts
  open/close clean, 15 s capture 0 packets as nobody held the pen). UNVERIFIED (needs the pen moved for ~2 min): packet flow, focus
  independence, whether a system context's sub-rectangle re-maps the cursor, the portrait-frame turn (inferred at
  runtime from the OS cursor), proximity bit polarity, which side button is "lower". Things to know when wiring:
  Electron-main timers tick ~15 ms unless `timeBeginPeriod(1)` (the session does it); a hard-killed process (like
  `wm-stop.ps1`) leaks its Wintab context until the next start's `recoverStaleContexts`; NEVER `WTClose` a handle
  you did not open (the spike closed one of the driver's own by guessing; if pen buttons act oddly after the
  re-plug, restart the Wacom service).
- **Cell furniture, what is left** (cells lane, 2026-10-05; PARITY "Cell furniture"). Done: the gutter's hover
  promise, one reader for hover / cursor / click, held cells as boxes, brackets on their cells at 1x and 1.5x, the
  add row's icons. Left: a closed section's bracket is dashed and filled where the Mac draws a small solid triangle
  on it; an In/Out pair's bracket standing proud of the two cells (the Mac's `overhang`, 3 pt) belongs with the
  evaluation cells' bracket when that lane adds one (`takes` already answers "the two in it"); the seam bar runs
  8 px wider than the held / washed boxes on each side (the Mac's bar is drawn from its own inset; not compared on
  screen).
- **The editor, what is left** (e2-editor-polish, 2026-10-03; `PARITY.md` "The editor, polished"). Done: Markers and Preview as two
  switches (Ctrl+Alt+M), the List key and menu on the chevron's style, the tab title following the heading, tabs (middle click, wheel,
  overflow list, Close Others, deleted / renamed / trashed notes), the whole /link flow incl. renames, hot exit (unsaved text in the session),
  code-cell typing, marker-aware deletion, spell-check conventions, paste as plain text, the dropped-file guard, Find / Replace. Open:
  `e2e/suites/editor/05-sidebar-drag.mjs` counts notes inside the now-open sections as root rows (fix the script, not the app); the
  scripts in `C:\CLAUDIO\agents\e2e\e2\` are still to move into `e2e/suites/editor`; no drag to reorder tabs (the Mac has none).
- **Small things not carried over**: ⌘D is Alt-D here (Ctrl-D is Split,
  as on the Mac where ⌘D and ⌃D differ) with Alt-Shift-D for every
  occurrence; a link in the markdown is followed by Alt-click, because
  Ctrl/⌘-click on the page belongs to the drawing layer's marquee;
  the sidebar's date under a note's title and a SELECTED section (which
  decides where the next note goes) are not ported; "Remove Folder from
  Project", projects, the row menus and Rename… ARE (`PARITY.md` "Projects,
  export and the window").
- **Packaging, the rest of it**: the three targets are configured and the
  macOS bundle has been packed and run from `dist-electron/`. Still to do:
  run the Linux build ON Linux (an Arch box or a container — a
  `.pkg.tar.zst` cannot be cross-built from a Mac), the Windows build on
  Windows, a signed Mac build (Sean's keychain holds TWO identities with
  the same name, and `codesign` refuses an ambiguous one), and a `dtp`
  lane of its own.
- **End-to-end harness (h1-e2e-harness, 2026-10-03).** `e2e/` is in the repo:
  `npm run e2e` (`--suite`, `--snapshot`, `--file`, `--desktop`; `docs/TESTING.md`)
  starts an isolated offscreen instance per suite (temp profile and notes,
  occlusion flags, `WRITEMIND_E2E`), runs the suite scripts and writes
  `e2e/.results/<run>/report.{txt,json,md}` with screenshots; CI
  (`.github/workflows/ci.yml`) gates on typecheck / test / build and runs the
  suites in an optional second job. Migrated: everything from
  `C:\CLAUDIO\e2e` that still means something (cells, pen, toolbar,
  connectors, pictures, maths, camera, tablet, buttons, wm, tour, chrome,
  grab, perf); the Pad scripts are deleted with the Pad. Still to do: (1) a
  second pass that moves the scripts the other lanes wrote under
  `C:\CLAUDIO\agents\e2e\` into `e2e/suites/` (steps in `docs/TESTING.md`);
  (2) `e2e/known-issues.json` is how an in-flight bug is carried without
  turning the run red (empty when this was written); (3) the desktop `grab`
  suite has only been ported, not re-run on the real desktop by hand; (4) not
  yet covered anywhere: tabs (middle click, wheel, overflow list), window
  resize with ink, the OCR "Aa" handle.

- Drawing lane round 2: all HIGH/MEDIUM verifier issues closed (most were already fixed); new `e2e/suites/drawing/07-mode-and-copy.mjs`. Not done: LOW items; no real-pen check of the mode-change clearing.

- Projects and chrome round 2: every HIGH/MEDIUM verifier issue was already fixed in code; close-last-tab and window-close flush re-proved by `agents/e2e/fix-projects/closeflush.mjs` (move into `e2e/suites/` later). Not done: LOW items; a window closed by a hard kill / power loss still loses the last 500 ms (the OS-level limit).

- **Pen demolition (wr-demolish, 2026-10-04): the overlay / sink / Grab / setup check / HUD / sheet strip / reach / guard / clip / Raw Input / WebHID / trace UI are deleted** (see PARITY "Pen demolition"; the older pen entries below and in PARITY are history). To do: (1) [done, wr-sheet-ux] `usePenWord()` is in the sheet header; (2) [done, wr-sheet-ux] the mouse drags the dashed box, the pen inks; Paper menu (6 papers x 3 spacings x 3 colours); Page includes the paper. Needs Sean: the real feel with the pen, and the Mac's real paper list if it ever has one; Aa on a Page picture of the dot-grid paper: the WHOLE sheet's dots are found and painted out before reading (`prepareForReading` = the Mac's `withoutDotGrid`), but a box under about half the sheet's height is not: its dots are 7 px across at the page's scale, over the lattice's size limit (the Mac's max(6, short side / 80)), so they go to the reader as they are (pinned in `apps/desktop/test/sheetPaperReading.test.ts`; a fix could draw the Page picture's dots at a size the limit allows, or tell the reader where the sheet's dots are; camera lane 2026-10-05); (3) calibrate the Wintab frame on the real tablet (Sean's hand; Reset calibration is in the Pen popover); (4) a much smaller, guarded system-context mapping only if a pen outside the sheet's reach proves a real problem; (5) `e2e/lib` still mentions `grab=1` / `noGrab` (harmless no-ops).
- Pen capture backends (wfin-core): unit tests green, real-driver start and every release path proven; what still needs Sean's pen: real packets through Wintab / Raw Input / WebHID, the frame fit, the pointer-range message from the real Wacom, the feel. Note: killing the app within 30 s of a native backend starting switches that backend off (crash breadcrumb, design 5.8): turn it back on in the Pen menu. Under E2E native stays off unless `WRITEMIND_PEN_NATIVE=1`. Not done: a utilityProcess for the native backends (design "later").

- Camera and capture round 2 (fix-camera): the three tablet flow-chart checks fixed (the chart's connected mark was thrown away as a "page edge"); captures land under the caret / in view; Aa puts the words under the picture and leaves the picture (the Swift; FEATURES.md still says "put away" with a Revert button, which neither app has); footer notices for reads; results never land in another note; hand-dragged corners validated; reader deadline 8 s for captures. Not verified: a hung real PowerShell, a slow-starting helper at launch. Open: Aa on a picture does not yet read a chart (Swift `flowChart(from:under:)`); no busy mark on the Aa handle itself (Canvas.tsx is the Drawing lane's; the footer says "Reading...").

- Pen capture, sheet side (wfin-ui): the sheet, strip, chip, setup check card and trace are done and proven on the fake backend (`agents/e2e/wacom/penfeed.mjs`, in `run-all.mjs`). Needs Sean's pen: that real packets move the ink the right way (the Turn / Mirror buttons on the check's verdict page fix a wrong guess), the feel, the strip's size on his pane. Not done: the check's "pen trail" preview on the sweep step (the verdict page has Turn / Mirror instead); the optional "away" step is not offered; the containment tests offer only the driver mapping (the overlay test is not offered because the sink is opt-in). Manager findings (main/pen, not mine): the combined `pen:e2e-config {backends, capture}` call restarts the fake backend while its first start() is in flight, so it ends stopped (E2E only; two calls work); the trace has no typed `session` record.

- Final gates (2026-10-04): all green. For Sean: (the setup check and its doc are deleted; the pen's only diagnostic is `pen.log` in the app's userData folder.) Plain status and gaps: `docs/STATUS.md`. Not done: the editor performance pass (done 2026-10-05, perf lane: see the entry below); the wacom scripts under `C:\CLAUDIO\agents\e2e\wacom\` are not yet in `e2e/suites/`; `e2e/.scratch` and `perf` suite not re-run.

- Editor performance (perf lane, 2026-10-05): wheel scrolling was the hotspot (27% of frames missed, now 9%: the ink canvas lives in the scroller and a blank layer is left alone); typing, Enter/Backspace at a heading, open, tab switch and the rendered-page toggle were already at the display floor (STATUS.md, PARITY "Editor performance", `e2e/suites/perf/02-long-note.mjs`). Open, in other lanes' files: (1) rendered page: CodeMirror's `heightRelevantDecoChanges` walks a block-decoration set end to end on every keystroke (0.58 ms per key on a 3500-line note, growing with length): most likely the rendered page's own block widgets (`preview/field.ts`) stop sharing their chunks with the last set through a patch (not confirmed); (2) `eval/marks` reads `contentDOM.getBoundingClientRect()` in the measure's WRITE phase, a forced layout per keystroke (~0.17 ms): since the gate (2026-10-05) a note with no evaluation cell or answer measures nothing at all; in a note that has them the reads should still move into `read`; (3) `brackets.ts` `drawWash` maps every cell (`takes` over `cellRanges()`) on each gutter draw while a bracket stays hovered (small). Needs Sean: a real wheel / trackpad on his notes with ink, and the feel of ink scrolling with the words.

- Pen fixes (wr-fix): all high/medium review issues closed (see PARITY "Pen fixes"). Needs Sean's hands: (1) whether the Wacom driver really silences the data context when the system context opens (the watchdog is only proven on a fake); (2) calibration taps outside a non-maximised window still click whatever is under them (the first touch now survives the blur, but maximise the window to calibrate); (3) residual risk: a hard kill (End task) while the mapping is live leaves a CXO_SYSTEM context until WriteMind is started again (journal recovery) or the Wacom service is restarted.

- Camera round 3 (camera lane, 2026-10-05; PARITY "Camera and capture, third round"): Input Devices ▸ Aspect Ratio, double-click for the window-filling picture (never the display), captures at 0.9 of the pane, the traced pen thinned to a third and cleaned again, Esc / click-away for the Pen popover: done. Left: the shapes in the sidebar's video popover (Sidebar.tsx, editor lane); a real camera (only Chromium's fake device was used); the Aa dot gap on small boxes of the sheet (above).

- Export + keys (2026-10-05; PARITY "Export and keys"): Mac e8b3266 is in (one Export… panel, every key in one list, the Mac's new keys). Left: move `C:\CLAUDIO\agents\e2e\export\*.mjs` into `e2e/suites/` (Export is covered only by those scripts so far); the older `C:\CLAUDIO\agents\e2e\p1\t-export*.mjs` click the menu id `exportPDF`, which is now `export`; Use Selection for Find has no key (Ctrl+E is Export); keys the Mac added AFTER e8b3266 belong to the lanes that port those features and go into `shared/commands.ts` + `shared/keyList.ts` + `docs/KEYS.md` together (`keyList.test.ts` fails until all three agree; ⌘9 → Ctrl+9 Evaluation Cell is in all three, re-checked 10:56). Sean's hands: the real Windows save dialog's "Save as type" list (PDF / Project) has only been answered ahead of time by the e2e, never seen.
