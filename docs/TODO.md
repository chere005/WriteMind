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
process and writes the answer under it, Ctrl+Shift+8 makes one (Ctrl+9 until 2026-10-05; Ctrl+9 is the maths cell since 2026-10-06), `In[n]` / `Out[n]` in the margin). The editor-level e2e scripts are in the repo now:
`e2e/suites/editor` and `e2e/suites/cells` (`npm run e2e -- --suite editor`;
`docs/TESTING.md`). A new install opens on `WriteMind Quick Reference.md` (once per notes folder,
`main/welcome.ts`; PARITY "The Quick Reference").

## Next, Sean's backlog (2026-10-05)

Sean, 2026-10-05: "keep note of those remaining potential todos". **v1.0.0** is the first real release (the
GitHub release workflow, the per-user installer with the Python / Wolfram page, auto-update), cut with the
batch in flight on that day. After it, roughly in this order:

- ~~**A maths cell type** (Sean, 2026-10-06: "ctrl + 7 should be PURELY plaintext.. so clearly we need a math cell
  type.. that should be ctrl + 9 and make ctrl + 10 drawing cells").~~ Done 2026-10-06 (core `cells/mathsCells.ts`,
  editor `mathsCell`; KEYS.md "Maths cells", PARITY "Maths cell"): Ctrl+9 = Maths Cell (Insert menu, the + menu beside
  Code Block), Ctrl+0 = Drawing Cell again; Ctrl+7 stays pure plain text. Left: (1) Sean's hands: the feel of Ctrl+9 on
  a cell of words (the caret stays in the source, so it shows as source until the caret leaves); (2) Ctrl+Shift+7 on
  a maths cell does nothing (Ctrl+7 then Ctrl+Shift+7 gets there); (3) a maths cell's Ctrl+7 drops blank lines of its
  source (a text cell holds none); (4) the Mac has no maths cell kind (its ⌘9 is the evaluation cell): FEATURES.md
  there says nothing of it. (5) Ctrl+9 on words holding a Link Here anchor leaves them and makes a new maths cell after
  (the anchor would be lost in maths source); a line that would read as a fence keeps its backslash in the source.
- ~~**Drawing polish.** Handles and an outline on hover before a click (the Mac shows them); shapes, arrows and
  text boxes inside drawing cells; undocking a docked picture or drawing cell.~~ Done 2026-10-06 (drawing-polish
  lane; PARITY "Drawing polish"): hover shows a faint outline and faint handles (a picture: the outline only);
  the tools work INSIDE a drawing cell (top bar, or the cell's right-click Text Box / Shape / Arrow), and shapes,
  arrows and text boxes dock into cells too; right-click ▸ Undock on a drawing cell or a docked picture, one Undo.
  Left: (1) Sean's hands: the feel of the hover (the 250 ms it lingers so a handle can be reached; the open hand over
  the note) and the cell tools with the Intuos pen; (2) a text box typed past a cell's bottom grows the cell, but a
  shape or an arrow dragged past it stops at the edge (no growing there); (3) crop and read-into-words (Aa) are still
  the page's only; (4) Undock has no handle of its own (the menu only, which the pen's right-click action opens too);
  (5) a read-only ink line (a second copy of a cell's line) cannot be undocked; (6) a docked picture with words in its
  brackets (`![caption](…)`) is not undocked (the menu greys Undock, "has a caption"): a floating picture has nowhere
  to keep the caption. Gate fixes (round 2): an arrow's hand-moved segments now move with it into and out of a cell
  (they jumped on undock); a docked picture's menu keeps a wider selection for Cut / Copy and has Paste / Select All
  again, and opens while the drawing layer covers the note (pen down).
- ~~**Housekeeping.** Deleting a note leaves its `.drawings/<note>-<hash>.json` behind (Sean deleted four notes and
  their sidecars stayed); orphaned files in `.drawings/media` are never swept (the sweep must read the notes'
  markdown, `drawing/inkCell.ts` `mediaInUse`).~~ Done 2026-10-06 (housekeeping lane; PARITY "Housekeeping",
  `main/housekeeping.ts`): Delete (a note, or a section) takes the drawing to the Recycle Bin / Trash after the note;
  File ▸ Clean Up Unused Files… (and the sidebar's Folder menu, and a project folder's row menu) lists what nothing
  uses and bins it after a yes. Left: (1) Sean's hands: run it on his own notes folder (his four old sidecars are
  offered only if no note of the same NAME is left in the project: a drawing whose note was renamed or moved in
  Explorer is never offered, by design); (2) a folder that is also in ANOTHER project is swept with this project's
  notes only (a note of the other project that names a picture by name from this folder's media would lose it to the
  bin; rare: a move between folders copies the pictures); (3) THE NOTES ROOT'S `.drawings` IS SHARED (gate, round 2):
  before 0.3 every note of every project kept its drawing and pictures there. A drawing there is offered only when its
  name is provably this project's (its hash is a `<stem>` note's path in a folder of this project); a picture there
  saved before 2026-10-06 02:00 UTC (`SHARED_STORE_UNTIL`) is never offered. So the oldest strays of the root may
  stay for good, and a drawing of a note in a section that was deleted outside the app is not offered either. Also
  fixed at the gate: Delete keeps a Mac `<stem>.json` when a folder under the owner cannot be read; Clean Up sees
  notes that are symbolic links; the object clipboard's pictures are held; a problem after some files went now says
  which went.
- **Tables, part two.** A table button and key, grid editing on the rendered page.
- **Scanner tabs for real.** The camera's tab strip is a stub: keep several scanned pages as tabs.
- **Reading pictures.** Aa reading a flow chart off a picture already in the note (Swift `flowChart(from:under:)`);
  Japanese OCR on a machine that has the engine.
- **Runnable cells.** Language icons instead of WL / PY; C, C++ and Rust once a compiler is installed.
- **The Swift Mac app: a REFERENCE only, not ported to** (Sean, 2026-10-06: "we are probably going to abandon the
  mac app and only work on this one and keep it as a reference"). This Electron app, with its own Mac build, is the
  one WriteMind. Nothing new goes into the Swift app (its text-cell and separate-cells rules stay missing there: it
  shows text cells joined and blocks glued); `C:\GIT\WriteMindSwift` stays the read-only spec for behaviour still to port.
- **Windows code signing: skipped for now** (Sean, 2026-10-06). When it comes back: Azure Artifact Signing
  (formerly Trusted Signing, individuals in the US / Canada, Basic $9.99 a month) via electron-builder's
  `win.azureSignOptions` in release.yml's windows job; publisher name "Shahean Cheren". Mac signing: Sean's own
  session on his Mac with his Apple Developer account, after the release of this batch.
- **The buttons under the sheet's box, what is left** (box-buttons lane, 2026-10-05; PARITY "Buttons under the box"):
  Erase CUTS strokes at the box's edge (the Writing capture's rule), it does not remove whole strokes the box
  touches: say if whole strokes are wanted (then Writing should follow, to stay one rule). Not tried with Sean's real
  pen. ~~A drawing cell from the sheet starts its ink at the cell's left pad~~ (2026-10-06: the box IS the cell, the ink
  where it sat in it; a whole-sheet box makes a sheet-shaped cell: say if a tight cell round the ink is wanted there).
  ~~A pen stroke that STARTS on the button row is lost~~ (2026-10-06: a contact begun on the row that moves 6 px is the
  sheet's from its first point, pen feed, window pen and mouse; a tap still clicks). Left: the row stays on top of the
  sheet while the pen writes under it, so the first few px of such a stroke are hidden by the row until the box goes.
  Gate (round 2): only a TIP contact on the row is held back; a side button pressed in the air over the row reaches it
  at once again (the double-tap's timing), and a tip that then touches the row and moves is handed to the sheet from
  the touch. A whole-sheet box (double-click) now puts the row in the pane's margin under the sheet (gate, 2026-10-05); only a
  pane with no margin at all puts it inside the box.
- **Fence arrows, what is left** (fence-arrows lane + gate, 2026-10-05): ~~a click on an opening fence that is already
  open for its language is sent to the content line~~ done 2026-10-06 (`fencePointer` leaves a click on the fence line
  the caret is already on: the language is clicked into and double-click-selected; `cells/06-text-cell-leftovers`).
  PageUp / PageDown now land off a fence (an EMPTY fenced cell is still
  landed on its fence: a page move writes nothing); Escape / Backspace / Delete at a bar skip an empty fenced cell for
  the next cell out. Whether Left/Right should skip fences too is Sean's call (it would remove the only way to edit the
  language on the rendered page).
- **Separate cells, what is left** (2026-10-05): moving a cell (`moveCell`) keeps a single line break between two
  cells that touched (they still read apart); words and a list that touch are one run and, on the rendered page,
  the lower one's bracket still reaches up over the gap its block draws.
- **Text cells, what is left** (text-cells lane, 2026-10-05; PARITY "Text cells and markdown cells"). Decisions to
  confirm with Sean: Return on the rendered page still starts the next cell in a text cell (Shift+Enter is the line
  break there; the markdown side's Return is a line break as ever); joining a markdown cell onto a text cell
  (Backspace) makes its markup literal (the upper cell's kind wins). SETTLED (Sean, 2026-10-05: "when converting a
  cell to markdown, it just processes markdown"): Ctrl+Shift+7 and every automatic switch take the escapes out (the
  words are read as markdown), and a multi-line text cell's lines join as markdown joins them.
  Left: Ctrl+8 round words of a text cell keeps their escapes' backslashes inside the code; text typed with an IME is
  escaped only at the next ordinary edit; there is no inline-code command to switch with; typing Link Here's exact
  anchor HTML (`<a id="…"></a>`, `<mark id="…">`) into a text cell makes a hidden anchor, not literal text. Find
  looks in the SOURCE: a text cell's escaped `\*\*` is not found by `**` (search the visible words, mapping matches
  back through `escapeOffsets`). Merging two text cells whose lines hold the two halves of an inline mark (`**a` over
  `b**`) can read as markdown by the older-notes rule (the escape rule is per line). A note closed or switched away
  from with the caret in an emptied markdown cell keeps that cell (hidden) until the caret goes in and out again.
  **Sean to confirm:** Return in an emptied markdown cell counts as leaving it (the cell goes, the bar stands where it
  was). Gate (round 2): an emptied cell left while a Redo waits (words or drawing) stays until the next edit, so the
  Redo is kept; Ctrl+M in an emptied cell does nothing (it joined the note's last two cells); Split Cell on an older
  note's markdown cell (no marker) gives both halves a marker. The leaving-with-Redo rule has no e2e of its own.
  Done 2026-10-06 (PARITY "Leftovers (2026-10-06)"; `cells/06-text-cell-leftovers`, 25 checks): ~~Split Cell / Merge
  Cells (Ctrl+D / Ctrl+M) do not re-escape a text cell's halves or carry a marker to the second half~~ (`splitCell`
  goes through `keepingHalves`; a merge is Backspace's rule, the upper cell's kind wins: a markdown cell under a text
  cell loses its marker and is written literal, a text cell under a markdown cell keeps its escapes, two markdown
  cells keep one marker); ~~Find / Replace into a text cell writes the replacement raw~~ (`input.replace` is literal
  typing, `textCells.ts`); ~~a markdown cell emptied of its words keeps its hidden marker~~ (its words line is no
  seam, `armIn`, so the caret stays and typing goes back in; when the caret leaves, `dropEmptyCell` takes the marker
  and its blank lines, joined in the history to the edit that emptied it: ONE Undo brings both back).
  Fixed at the gate (2026-10-05): a paste at a bar is written as it is (cells copied whole keep their kind and
  marker; only typing is literal); typing `# ` / `- ` / `> ` / a fence at the start of a markdown cell's words drops
  its marker, Return there moves it down with the words; Ctrl+7 keeps Link Here's anchors and an inline picture's
  markdown; Link Here into a text cell leaves it a text cell (anchors are hidden, not formatting); the escape rule is
  linear on long lines (a budget past which every markup character is escaped); whole cells copied give other apps
  the words (no escapes, no marker); /link in a text cell lands its selection on the link.
  Fixed at the v1.0.0 gate: /link lands its selection on the link with escapes or markers after it too (`writeRich`
  says where it went); a selection that only touches a text cell at an end no longer switches it; the T menu's Remove
  on a text cell switches nothing; a marker line inside a closed fence is code, shown without a backslash.
  Fixed at the after-v1.0.0 gate: Link Here's title from a text cell keeps its backticks (`wl:` maths as typed, no
  stray backslash; `linking.ts` `inTextCell`). **DONE (2026-10-06; DECIDED by Sean, 2026-10-06: "yes", keep the
  source):** Ctrl+7 (`makeTextCell`) on a markdown cell with inline maths keeps its whole `` `wl:…` `` source as the
  text cell's words (it used to keep only the bare expression, `` `wl:Pi r^2` `` became `Pi r^2`): `visibleWords`
  keeps a maths segment's whole code span as it keeps an inline picture's markdown (escapePlain escapes it), and
  Ctrl+Shift+7 afterwards typesets it again. Ctrl+7 and Ctrl+Shift+7 are each their own undo step (`applyEdit`'s
  `apart`). Pinned by `packages/core/test/textCells.test.ts`, `packages/editor/test/textCells.test.ts` and
  `C:\CLAUDIO\agents\e2e\text\text-cell-maths.mjs` (real keys); PLAN-text-cells / KEYS say so.
- **The sheet's tool isolation e2e** (after-v1.0.0 gate): `C:\CLAUDIO\agents\e2e\sheet-tools\sheet-tools.mjs` clicked the
  sheet header's Erase button, which is gone, and now dies at its first step. Port its checks (a)-(e) (a click on the
  words keeps the sheet's Erase and places the caret, the toolbar stays dark, each surface erases only its own ink)
  into `e2e/suites/tablet/`, turning the sheet's eraser on with Ctrl+Alt+2 after a pen hover on the sheet.
- **Other platforms and trust.** Linux builds; code-signing the Windows installer so SmartScreen stops warning.
- **The Mac release (packaging lane, 2026-10-05): built, NOT yet run on a Mac.** v1.0.0 ships two AD-HOC signed dmgs
  (`WriteMind-<v>-mac-arm64.dmg`, `-mac-x64.dmg`, macOS 13+, no hardened runtime, universal Vision helper) on the
  same release as the Windows installer (release.yml's mac job; ci.yml's mac-package job on main; checked by
  `tools/verify-mac.sh` on the runner; docs/INSTALL-MAC.md). Still to do: (1) an **Apple Developer ID** and
  **notarization** (hardened runtime on, with the camera entitlement; the APPLE_* secrets in the release job), so
  Gatekeeper opens it without Open Anyway and the camera / Documents answers survive an update; (2) **real Mac
  updates: DONE in 2.4.0** (a signed copy in a writable place takes MacUpdater: the zips and `latest-mac.yml` on the release,
  Update now downloads, Squirrel.Mac swaps the app and relaunches — run on this Mac 2026-10-06 from a local feed, 2.3.0 → 9.9.0;
  an ad-hoc or translocated copy still opens the release page; copies before 2.4.0 open the page once);
  (3) ~~**a Finder-launched app's PATH has no Homebrew**~~ done: `main/eval/tools.ts` looks in `/opt/homebrew/bin`
  and `/usr/local/bin` after the PATH on darwin (`MAC_TOOL_FOLDERS`), and since 2026-10-06 inside
  `/Applications/Wolfram Engine.app` too; anything else is pointed at with File ▸ Language Setup…;
  (4) ~~the unit suite on macOS~~ done 2026-10-05: the
  first macos-15 run (CI 37408602855, whose dmgs passed `verify-mac.sh`) had 7 of 2303 red, all tests that took
  Windows paths or names for granted; they now use this system's own (and `eval/runner.ts` joins its scratch paths by
  `deps.platform`, as `tools.ts` does), and the mac job's unit step blocks; (5) Sean's own look at a
  first open on his Mac (Open Anyway, the camera prompt, Help ▸ Check for Updates…).
- **"WriteMind", not "Electron", in the Mac Dock (2026-10-05): built, NOT yet seen on a Mac.** Dev bundle renamed
  and given the Mac app's icon (`scripts/mac-dev-identity.mjs`), name / About panel / dev dock tile at run time
  (`main/macIdentity.ts`), `mac.icon` for WriteMind.app (docs/BUILDING.md). To check on the Mac: `npm run dev`, then
  the Dock label, the icon, the menu bar's first title and About WriteMind.

## Wolfram notebook and copy into Mathematica: for the full install (Sean, 2026-10-06)

Built and checked against the real Engine (the kernel, and the front end's own hidden render); the front end's GUI paste
cannot be tried where the Engine app is all there is. **What to try on a machine with a full Mathematica** (docs/PARITY.md
"Wolfram notebook and Copy into Mathematica"):

1. With no Language Setup choice, Export and Copy should find wolframscript (`/Applications/Wolfram.app` or `Mathematica.app`;
   on Windows `Program Files\Wolfram Research\Wolfram\<version>`). If not, choose it in File ▸ Language Setup….
2. Copy a drawing cell. Paste into a notebook straight away and again after five seconds, between cells and inside an Input
   cell. Mac: first the open Input cell (Shift+Enter makes the image), then the image itself, no dialog. Windows: after five
   seconds, the image.
3. Copy a heading together with a drawing cell: it should paste as a Chapter / Section cell plus the image.
4. Open an exported `.nb` in light and dark; run an Input above a drawing (the drawing stays); open a no-engine export and run
   Evaluation ▸ Evaluate Initialization Cells (the drawings appear, code cells do not run).
5. **Windows needs a name.** The front end's own clipboard format on Windows is not known, so `wolframClipboardFor("win32").cell` is
   null and Windows uses the linear syntax in the plain text. On Windows, copy an image cell in Mathematica and run
   `Add-Type -A System.Windows.Forms; [Windows.Forms.Clipboard]::GetDataObject().GetFormats()`; the name goes in
   `packages/core/src/export/wolfram/clipboard.ts`. The same goes for Mathematica before 12 (untried).
6. Paste a copied drawing into Pages or Word (the picture at its on-screen size), and into a plain-text editor (the markdown line
   on a Mac, the linear syntax on Windows).

Re-run the engine's half by hand: `node node_modules/vite-node/vite-node.mjs apps/desktop/scripts/check-wolfram.ts [folder] [--render]`
(folder inside the temp folder; the PNGs it writes are what to look at). Ink colours that are too light for white (yellow, light
green, orange) are swapped for black in these images, as in the PDF (`readableInk`).

## Not ported yet, in the order they are worth doing

- **Tables, from scratch: part one DONE, the rest to build** (tables lane, 2026-10-05; port-first: the Mac took
  tables out whole on 2026-09-20 to rebuild them, `C:\GIT\WriteMindSwift` TODO "Tables, from scratch"; PARITY "Tables").
  DONE: a GitHub pipe table is ONE cell (`markdown/table.ts`, the parser and `positionedUpdate` agree on random
  edits), a real table on the rendered page and in the PDF / HTML export, a framed monospaced grid in the markdown
  (pipes and rule dimmed, never re-padded), Tab / Shift+Tab cell to cell, Tab past the last cell and Return add a
  row, Return on an empty last row ends the table. TO BUILD, in order: (1) editing IN the drawn table on the rendered
  page (a cell opens as its own little field, the grid does not change size as it opens; today a click opens the
  table's markdown, which is shorter than the drawn grid, so the cells below move up); (2) a table button on the
  toolbar and a key (the Mac had Ctrl+Cmd+T) with a rows x columns picker, and a "Table" kind on the + menu;
  (3) add / remove / move a row or a column (a context menu on a cell; the old Mac `MarkdownTable` had the
  arithmetic: `git -C C:\GIT\WriteMindSwift show 6109a18`); (4) tidy the columns (re-pad the markdown so the pipes line
  up) as an explicit command, never on its own; (5) a grid with no pipes at the ends drawn open (the Mac's old
  "grid or no grid" choice), if Sean still wants it; (6) paste a table from a spreadsheet / web page as a pipe table;
  (7) the camera / tablet reading a ruled table off a page into one (the Mac's old `DrawnTable`); (8) a table wider
  than the column: it scrolls on the page and is cut at the column's edge on paper — wrap or shrink instead?
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
  (3) ~~**The Mac's per-tool override**~~ done 2026-10-06 as **File ▸ Language Setup…** (port-first; PARITY
  "Language Setup"): a chosen program is the ONLY one its language uses (the Mac falls through; said in PARITY and in
  `main/eval/tools.ts`). Left there: (a) run the `installer-tools.ps1` changes under Windows PowerShell 5.1
  (`-FromApp -Python -DryRun -NoWait`, `-FromApp -Activate -WolframScript …`) — written on a Mac with no PowerShell —
  and, once, press Install Python… on Windows and see the window: `main/toolSetup.ts` no longer spawns the script
  `detached` (libuv's DETACHED_PROCESS gives a console program no console at all, so no window would have opened)
  but has a hidden PowerShell (`windowsHide`, not detached — how the OCR helper runs) open it with `Start-Process`
  and wait for that one process (`WaitForExit`); its quoting is unit-tested by reading the line back, the window
  itself is not; nor is what quitting the app mid-install leaves (the window should stay; its result INI is then
  never read or removed);
  (b) run `e2e/suites/languages`; (c) a cold Wolfram Test on Windows against the 20 s limit, and a Test while a
  cell is running (the engine's kernel-count limit); (d) the Linux licence path (`~/.WolframEngine/Licensing/mathpass`,
  Wolfram's documented place) on Arch; (e) a conda environment's `Library\bin` on the PATH (not added: only with a
  test); (f) not built, on purpose: a key (⌘, / Ctrl+, would be a COMMANDS row, the File group of KEY_MENUS and
  KEYS.md together), Type a Path… and Choose Kernel… (every picker takes a pasted path; `-configure` covers the
  kernel), a Mac Terminal setup, Linux package commands, polling, and Mathematica.app's wolframscript (not measured).
  (4) After a run the bar is
  scrolled to by CodeMirror's "nearest", not the Mac's short animation landing it low on the page (799b13b / "make the
  cursor behavior after evaluating a cell elegant").
  (5) **SEAN DECIDES: the wider margin moves a note's words, not its ink** (gate review, 2026-10-05). A note with an
  `eval` cell has a 48 px left margin (`EVAL_MARGIN`, so `In[n]`/`Out[n]` are one size); every other note keeps 30 px.
  So when a note gets its FIRST evaluation cell (Ctrl+Shift+8, the menu, typing ```` ```eval ````), or loses its last one,
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
  know every root before it may delete; and it must keep what core `mediaInUse` says,
  i.e. `mediaFiles(markdown)` of every note as well as `drawingMediaFiles` of every
  sidecar, or it deletes docked pictures and ink-cell snapshots). Pressure strokes are smoothed now.
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
  **Hold image** (Sean 2026-10-05, port-only: the picture held still, every capture from it; PARITY "Hold image";
  e2e `e2e/suites/camera/03-hold-image.mjs`; needs Sean: a real camera, and whether the header is the right place);
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
- **Scanned pages as tabs: a STUB** (sheet-tabs lane, 2026-10-05; Sean: "stub it in for future pending features in
  document scanner mode"). The video pane's tab row is real on the tablet (each tab a sheet, PARITY "Sheets as
  tabs") but in camera mode it shows one "Camera" tab and a disabled "+" (`SheetStrip.tsx` `CameraTabs`). What it is
  for: each page scanned under the document camera kept as its own tab (the picture, its box, its learned page shape,
  what was read off it), so a stack of pages can be scanned first and brought in later, or brought in again. Not built:
  the pages' store (it could share `main/sheets.ts` / `sheetSet.ts`, with pictures as files beside it), "+" taking a
  scan into a new tab, and what Writing / Page / Raw do on a stored page rather than the live picture.
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
- **Pen side buttons, needs Sean's hands (pen-buttons lane, 2026-10-05):** built and e2e-tested with synthetic events only (KEYS.md "Pen buttons"). On the CTL-472, on the note's page AND on the sheet: hold the LOWER button and touch/drag across ink (rubs it out), double-tap it in the air (Undo), the UPPER held + drag (marquee; drag inside it moves it), double-tap (Redo); a single tap must do nothing and no right-click menu may appear. Unknown until then: whether Windows Ink delivers a side button pressed in the AIR to the page at all (handled three ways: a pen event, nothing, or the driver's right / middle mouse click; if the page's double tap does nothing, set the Wacom side switches to Right Click / Middle Click with "hover click"). Lower vs upper might be swapped in Wintab's numbering (`main/pen/wintab.ts` BTN); swap there if so.
- **The Mac tablet (2.3.0, 2026-10-06): built, run on a Mac with NO tablet only.** `tools/pen/wm-pen.swift` seizes the Wacom's HID device (the Swift app's TabletCapture, as a helper) while the Tablet sheet is in front and "Map the whole tablet to the sheet" is on; `main/pen/macPenBackend.ts` fills the `wintab-data` slot. Unverified on a real pen: whether driver 6.4's dext lets the seize through, the report layout and extents from the descriptor (fallback 15200 x 9500), and the Input Monitoring prompt naming WriteMind. `pen.log` has `helper` lines with every open's IOReturn and the first unknown reports.
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
- **Pointer and new cells** (cells-ui lane, 2026-10-05; PARITY "The pointer over cells, and a new cell ready to type
  in"). Done: the vertical I-beam over exactly where a click arms a bar (one hit-test, both pages), every seam armed by
  its click (cells that touch too), the + and every cell-making command make the cell at once with the caret in it,
  Code Block after the caret's cell, Maths at a bar, a drawing cell's scoped pen. Left / Sean's hands: the feel of
  the cursor with a REAL mouse and the Intuos pen in Pen mode (CDP mouse events and synthetic pen events only); a
  drag that starts in a seam picks whole cells (the Mac's bar-drag; gate r6, proven by smoke on the markdown pane only); an empty
  Text cell made from the + stays behind if nothing is typed in it (the Mac waits for the first character).
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
  `.pkg.tar.zst` cannot be cross-built from a Mac), a SIGNED Windows build
  (the installer is built on Windows by `.github/workflows/release.yml`,
  unsigned, and updates itself: see "Updates" at the end), a signed Mac build (Sean's keychain holds TWO identities with
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

- Export + keys (2026-10-05; PARITY "Export and keys"): Mac e8b3266 is in (one Export… panel, every key in one list, the Mac's new keys). Left: move `C:\CLAUDIO\agents\e2e\export\*.mjs` into `e2e/suites/` (Export is covered only by those scripts so far); the older `C:\CLAUDIO\agents\e2e\p1\t-export*.mjs` click the menu id `exportPDF`, which is now `export`; Use Selection for Find has no key (Ctrl+E is Export); keys the Mac added AFTER e8b3266 belong to the lanes that port those features and go into `shared/commands.ts` + `shared/keyList.ts` + `docs/KEYS.md` together (`keyList.test.ts` fails until all three agree; ⌘9 → Ctrl+9 Evaluation Cell was in all three, re-checked 10:56; since docs/PLAN-text-cells.md it is Ctrl+Shift+8, Ctrl+9 the Drawing Cell and Ctrl+0 free; since 2026-10-06 Ctrl+9 the Maths Cell and Ctrl+0 the Drawing Cell). Sean's hands: the real Windows save dialog's "Save as type" list (PDF / Project) has only been answered ahead of time by the e2e, never seen.

- Docking and ink cells, CORE (2026-10-05; PARITY "Docking and ink cells: the model"; plan `docs/PLAN-docking-ink-cells.md`): the picture line, the `picture` block, the `cell` drawing item, the ink cell model, the SVG snapshot writer/reader, the media rule and the PDF arms are in `packages/core` with tests. Left for later rounds: a picture inside an ink cell does not show in the cell's snapshot when the snapshot is shown AS AN IMAGE (an svg loaded as an image loads no other file; strokes do show); adopting a cell pasted from another note (`readInkSnapshot` is written, nothing calls it); forking ink ids on Duplicate Cell / duplicateNote; undocking; the Mac reading `../` media paths and `cell` items (it drops an unknown item kind).

- Docking and ink cells, EDITOR (2026-10-05; PARITY "Picture and ink cells on the page"): the picture / ink widgets in both panes, the caret above and below, the resize strip, the registry and the dock helpers are in `packages/editor`; e2e `C:\CLAUDIO\agents\e2e\dock\picture-cells.mjs` (46 checks; to move into `e2e/suites/`). Left: the alt words of a picture cell cannot be edited in place (the whole line is one widget on both sides; hold + retype, or Undo); a picture's ROTATION or crop is not kept when docked (size rule only); the read-only snapshot of an ink cell is not resizable; Sean's hands: how a real pen feels on the 8 px resize strip (with the pen down Canvas hands a press on `.wm-cell-resize` to the strip: dock lane, e2e dock/s3.mjs), and the caret beside a photo with Up / Down on the markdown side (CodeMirror's own arrows; the rendered page walks bar → bar).

- Docking and ink cells, DOCK (2026-10-05; PARITY "Docking, and drawing in ink cells"): drawing / erasing / picking / moving in ink cells, the dock handle (click and drag, into a cell), Drawing Cell (Insert, Ctrl+0 (Ctrl+9 on 2026-10-05), + menu), one Undo for every dock, the snapshots, the PDF arms and moved notes' media are in. e2e `C:\CLAUDIO\agents\e2e\dock\s1.mjs` … `s4.mjs` (to move into `e2e/suites/`). Left: undocking; shapes / arrows / text boxes, crop and read-into-words inside cells; a cell that grows as you write past its bottom; orphan cell items stay in the sidecar after their line is deleted (Undo needs them; nothing prunes them). Sean's hands: the Intuos pen drawing, erasing (lower button held) and selecting (upper button held) inside a cell, double taps there, resizing a cell with the pen, the feel of the dock drag.
- A drawing cell opened as a tablet sheet (cell-to-sheet lane, 2026-10-05; PARITY "A drawing cell opened as a tablet sheet"): right-click ▸ Open in Tablet Sheet / Delete Drawing Cell, the bound tab, writing into the cell as one note undo step, restarts. e2e `C:\CLAUDIO\agents\e2e\cell-to-sheet\cell-sheet.mjs first|restart` (to move into `e2e/suites/`). Left: ~~writing on a tab whose note is not in front~~ (no longer a way of working: sheet-note-sync, 2026-10-05, opens a bound tab only with its note in front; `pending` is left for a sheets file from before); the "cell gone" path is proven with a fake app only; after a restart, writing done while the note was away replaces the cell's strokes with re-made copies (their ids, groups and transforms baked; nothing is lost); a very flat cell is a thin band of the tablet (the frame keeps the cell's shape, never stretched); the sheet's strokes are converted at the cell's shown width, so a stroke written after the window was resized is a little thinner or thicker than the sheet showed. Gate r6 (fixed): close asks while writing waits; Undo while away is the sheet's own; the margin takes no stroke; a cell scrolled away keeps its width (last shown, else the column). Still open (gate r6): the binding is dropped for good when the cell is missing for 1.2 s, so Undo past the cell's creation then a late Redo leaves the tab a plain sheet and a second Open in Tablet Sheet makes "<note> Drawing 2" (keep the ref dormant while the note is in front and rebind if the same id comes back); a stroke that leaves the cell and comes back in is two strokes, two note undo steps. Sean's hands: writing in the frame with the real Intuos, how the band feels on a flat cell.

- Gate (2026-10-05, docking / ink cells / pen buttons round; PARITY "Gate fixes for docking..."): fixed at the gate, see PARITY. Left, LOW: (1) the bottom 8 px of every live ink cell is an invisible resize zone with the pen down (a stroke started there resizes the cell): put the grip below the drawing area, or show it on pen hover and take only a press that began there; (2) inside a cell only a MOVE is kept inside it: a scale, a turn, or a stroke run past the cell's left, right or top edge leaves ink clipped out of sight that the strip cannot bring back (it changes the height only): clamp scale / turn like `keptInside`, and a committed stroke's points; (3) after a dock, a refused note save (the file changed on disk) still writes the sidecar, so the docked ink is on disk only as an orphan cell (plus the Recovered text): hold the sidecar while the note is stale, or show orphan cell items on open; (4) a routed arrow whose BOTH ends let go when their objects are docked becomes a straight line at the next `reconnect` (an unrouted line keeps no bends); (5) `pdfPicture.test` "reads it again only when changed" was seen flaky by the dock lane (passed in the gate's full run); (6) the gate smoke `C:\CLAUDIO\agents\e2e\gate\smoke.mjs` and the lanes' `C:\CLAUDIO\agents\e2e\dock\*.mjs` are to move into `e2e/suites/`; `e2e/suites/tablet/01-sheet-as-camera.mjs` crashes at line 55 (no `.camera-bar [data-tablet=box]`, older than this round); the old `C:\CLAUDIO\agents\e2e\wacom\buttons-*.mjs` expect the old button model.

- Quick Reference (welcome lane, 2026-10-05; PARITY "The Quick Reference"): a new install opens on `WriteMind Quick Reference.md`, once per notes folder. Left: (1) its FEATURE list is written by hand (`shared/welcome.ts` `WELCOME_FEATURES`; the keys table is generated): add a line there when a feature lands (it reaches new installs only; nobody's existing note changes); ~~(2) ask Sean: it opens in the markdown pane~~ (Sean, 2026-10-05: "open on rendered page": its first open on a new install is rendered, nothing else changes; `renderer/welcomeView.ts`); (3) move `C:\CLAUDIO\agents\e2e\welcome\welcome.mjs` into `e2e/suites/` (it starts its own instances: it needs `WRITEMIND_WELCOME=1`, because test instances are left alone without it).
- The sheet and the note follow each other (sheet-note-sync lane, 2026-10-05; PARITY "The sheet and the note follow each other"): a picked drawing tab brings its note, another note sends the sheet back to the last plain tab. e2e `C:\CLAUDIO\agents\e2e\sheet-note-sync\sync.mjs` and `welcome-rendered.mjs` (to move into `e2e/suites/`). Left: there is no Ctrl+Tab between note tabs to test (none exists); a restart with a drawing tab open is unit-tested only; the Quick Reference's feature list does not mention drawing tabs yet (`shared/welcome.ts`). Sean's hands: the pen's Next / Previous Sheet buttons onto a drawing tab.
- Updates from GitHub Releases (updater lane, 2026-10-05; `apps/desktop/src/main/updater.ts`, `src/shared/update.ts`, `renderer/UpdateDialog.tsx`, `.github/workflows/release.yml`, docs/BUILDING.md "Releases and updates"). DIALOG (release-ui lane, 2026-10-05, Sean's ask; replaces the footer line and the 4-hourly background download): "Check on startup" (default on, `userData/update.json`) = one look ~3 s after launch, else only Help ▸ Check for Updates… looks; a newer release brings up the page's own "Updates available — WriteMind x is available (you have y). Update now?" sheet with [Later] [Update now] and the "Check on startup" box; Update now downloads with a progress line (Cancel), flushes the notes (close handshake) and restarts into the silent installer; Later puts that version off until the next launch; the menu item answers "You're up to date (x)." / "Couldn't check for updates: …" / "Updates come with the installed app."; Help ▸ Check for Updates on Startup mirrors the box. Unit: `apps/desktop/test/updater.test.ts`. E2E (local test-identity builds 0.5.0 → 0.5.1 on 127.0.0.1, installed into a scratch folder and uninstalled): `C:\CLAUDIO\agents\e2e\release-ui\0{1..6}-*.mjs` + `C:\CLAUDIO\agents\instances\relui-upd\*.ps1` (the older footer-era `e2e\updater\0{1,2,3}` + `upd-test` are superseded; to move into `e2e/`). Left: (0) a check that comes while Sean is typing takes the keyboard (keys in its first 0.7 s are ignored; since the gate, Enter on the sheet the launch look brought up is never Update now — a click or Tab to the button is; the Help ▸ Check for Updates… sheet still takes Enter) — watch whether ~3 s after launch is early enough; Later/Escape are harmless; (1) the first real release (Sean: bump, tag, push) and the GitHub provider against a real release — only the generic provider was exercised; the differential (blockmap) download was not (the test feed had no old blockmap, it fell back to a full download); (2) signing (SmartScreen warns until then); (3) (gone: the dialog shows with or without an open note); (4) the relaunch after Update now (`--force-run`) was not exercised (the test feed turns it off so the relaunched copy cannot open on the default profile); (5) Linux does not look (Help has no item there); a Mac copy installs too since 2.4.0 ("The Mac release" above). Since 2.4.0 a failed launch look is tried again after 1 and 5 minutes, and a running copy looks every 4 hours (Sean: "on mac 2.1 i restarted and didn't see 2.2 notification").
- The Windows installer (installer lane, 2026-10-05; `apps/desktop/electron-builder.yml` `win` / `nsis`, `packaging/installer.nsh`, `packaging/installer-tools.ps1`, `tools/build-installer.ps1`, docs/INSTALL-WINDOWS.md): per-user assisted NSIS (`%LOCALAPPDATA%\Programs\WriteMind`, no administrator, no all-users page), Start menu + desktop shortcuts, icon from `packaging/icon.png`, unsigned; ONE extra page: Install Python / Install Wolfram Engine (licence link) / Activate the Wolfram Engine, run with winget after the files are in place, in a visible console, never failing the install; `/S` installs nothing extra; the uninstaller also removes the updater's folder and keeps the notes and the app data. `eval/tools.ts` now finds python.org's per-user and Program Files folders without the PATH (`apps/desktop/test/toolsInstallFolders.test.ts`). Checked: silent install / update / uninstall into a scratch folder; the installed app (`C:\CLAUDIO\agents\e2e\installer\installed-app.mjs`: welcome note, koffi from the asar, pen.log, a Python cell); the page driven and captured without installing, and once through Install with `/WM-DRYRUN` (`C:\CLAUDIO\agents\instances\inst-1\ui-page.ps1`). LICENCE PAGE (release-ui lane, 2026-10-05): `nsis.license: ../LICENSE` (BSD 3-Clause, "Copyright (c) 2026, Shahean Cheren") is the first page, with the "I accept the terms of the License Agreement" box (`installer.nsh` `MUI_LICENSEPAGE_CHECKBOX`); installer / exe / uninstaller properties and the Settings ▸ Apps Publisher say Shahean Cheren (`C:\CLAUDIO\agents\instances\relui-upd\license-page.ps1`, `install.ps1`). Left: (1) a real winget install of Python and of the Wolfram Engine, and the activation window, on a machine without them (Sean's has both): only dry runs here; (2) the end-of-install message box after a failed tools step in a non-silent install (the silent path was checked); (3) a cancelled installer leaves an empty install folder (electron-builder's `.onInit` makes it); (4) no arm64 Windows build. TOOLS-STEP FIXES (installer-tools lane, 2026-10-06; docs/INSTALL-WINDOWS.md "How it is checked now", `apps/desktop/test/installerTools.test.ts`): winget's output no longer becomes the helper's result (it was the whole of `wm-result.ini` and of the end message, and the console showed none of it: every check before was a dry run, which returned before that line); the py launcher installs per-user too (`InstallLauncherAllUsers=0`, through `--override`); winget's exit codes in words (its "restart to finish" is installed; the installer stopped or its prompt to allow it was declined, which is winget's 0x8A150006 and not its "cancelled": a burn bundle's declined prompt is 1223, not on winget's list; cancelled, the installer's own Cancel; App Installer too old, not for this PC, offline); detection with time limits (each probe 10 s with its stdin closed, the page's nsExec 60 s); the helper's lookup held to tools.ts's by one fixture (14.10 before 14.9, Python314 before Python314-32, every PATH copy); `%APPDATA%\Wolfram\Licensing\mathpass`; a dry run never fails; a tools step that wrote no result says it did not finish. Left besides (1) and (2): (5) the Windows half of that test was written on a Mac and has not run yet (CI's verify job runs it); (6) where Engine 15.0 puts `wolframscript.exe` and `mathpass`, seen at the first real install and activation; (7) before Python 3.16, which python.org's installer is not made for: move `Python.Python.3.14`, the helper's lookup and tools.ts's to `Python.PythonInstallManager` (runtimes in `%LOCALAPPDATA%\Python\pythoncore-<ver>-64`, to be confirmed) with a test for its folders; (8) a release check on the built installer: 7-Zip lists `$PLUGINSDIR\wm-tools.ps1` in it, and a silent `/WM-DRYRUN /WM-PYTHON /WM-WOLFRAM /WM-ACTIVATE` install on the runner logs the three commands (release.yml's windows job, or a ci.yml job on main like mac-package).
