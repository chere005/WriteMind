# PLAN: the bars, the sidebar, the video header, the drawing handles — and the undo that goes with them (2026-10-10)

Sean's UI audit of 2.16.0, turned into wireframes and then into this. **The wireframes are the spec**:
`docs/ui-2026-10/FinalMain.png` (the window), `FinalToolbar.png` (the menus and the bar's states),
`FinalTablet.png` (the tablet sheet and a picked object), `FinalStates.png` (rendered page, the video
menu, find and link, no source, the sidebar, dialogs). Look at them at full size before you write a line.
The Electron app at 3.0.0 is the code (`apps/desktop/src/renderer`, `packages/core`, `packages/editor`); the
Swift tree is a reference copy and is not edited.

## What Sean decided (his words, 2026-10-10 — settled, do not re-argue)

1. **The pen is ONE on/off button and a dropdown.** "i only need a pen enabled and disabled button.. and a dropdown
   to choose between pen or eraser (which switches the mode of the single button).. [colour and width] should be
   under this dropdown." No Select button, no colour well, no swatch strip, no width select, no ink dot on the bar.
2. **Inserts are separate buttons, and shapes are one of them.** "don't collapse the inserts into one button..
   it should have text box, picture, table, maths.. cells are inserted by picking something in the dropdown for
   style, pressing the keystroke." And "why wouldn't shapes go with the other inserts?" — Shapes sits with them.
3. **Rendered and video buttons are always to the right of the sidebar button** — in the tab bar, whether the
   sidebar is open or shut ("keep the rendered and video buttons to the right of the sidebar always").
4. **The sidebar's edit button is today's pencil.** "yes sidebar pencil for edit". **Move section up / down are
   on the bar**, "to the right of the insert buttons" (they have keys: Ctrl+Up / Ctrl+Down, ⌃⌘↑ / ⌃⌘↓ on a Mac).
5. **The sidebar is liked** (search, + New note, clamped titles, an add-row per section, a project button at the
   foot) **with line icons and a better section flow**; "keep the overall sidebar ux".
6. **Be diligent about cell behaviour, moving the input cursor, search and undo.** And: "make sure undo is always
   able to undo up to 3 steps, even if it involves file changes, which may mean keeping file backups until undo
   goes out of scope."
7. Standing: platform idiom is macOS first (Apple Notes / Freeform / Pages are the reference); line icons, no
   text-glyph icons; no bordered boxes; a corner triangle marks a button that opens a menu.

## What is already in this branch (the foundation — use it, do not duplicate it)

- `renderer/icons.tsx` — `<Icon name="pen" />`: the one 16px line-icon set (45 icons). Add an icon here if you
  need one, drawn the same way (16px grid, 1.5px stroke, round caps); never a text character as an icon.
- `renderer/bars.css` — the bar tokens and classes: `.bar-row` (36px), `.bar-btn` (28px, `.on` lit, `.tint` softly
  lit, `.menu` corner triangle, `.label`, `.bordered`), `.bar-split` (the pen's button + caret), `.bar-seg`,
  `.bar-air` (12px), `.bar-rule`, and the menu look (`.float-*`). Loaded after chrome.css.
- `renderer/MenuButton.tsx` — a bar button that opens a menu: whole-button menu, or a split button (`onMain`) whose
  menu opens from the corner triangle, a right-click, a half-second hold, or ArrowDown.
- `renderer/FloatingMenu.tsx` — now takes `icon`, `checked`, `labelStyle`, `toggle`, `keepOpen`, `danger`,
  `dataBar`, `{ header }` captions and `{ custom }` rows (their buttons join the arrow keys).
- `renderer/kindMenu.ts` — the ONE list of cell kinds (Text, the six levels, Dots / Dashes / Numbered / To-do /
  Quote, Markdown / Code / Runnable code / Maths / Drawing) as `MenuItem[]`, keys from `shared/commands.ts`. The
  toolbar's Style menu and the seam's + both use it; picking calls `onPick({ command, listStyle })` and the caller
  runs that command (`runEditorCommand`, or the page command for the drawing cell).
- Existing hooks still work: the keyboard goes back to the notes after a bar action (`focusReturn.ts`; `.bar-row`
  is in its CHROME list).

## Rules for everyone

- Your own worktree and branch (`~/GIT/.wm-wt/<name>`, `agent/ui-<name>`, from `ui-2026-10`). Never touch
  `~/GIT/WriteMind`'s checkout. No bare `git stash`. Stage explicit paths (never `git add -A`); commit your work
  on your branch in small commits whose messages say why. Do not merge, rebase onto other branches, or push.
- `node_modules`: `cp -cR /Users/s/GIT/.wm-wt/ui/node_modules ./node_modules` (an APFS clone, seconds).
- Before you are done: `npm run typecheck`, `npm test` (the whole suite), `npm run build`, and the e2e suites that
  cover what you touched (`npm run e2e -- --suite <name> --snapshot`; `docs/TESTING.md`). **Look at the screenshots**
  (`e2e/.results/latest*/shots/`) against the wireframes. A suite that your change breaks by design is updated in
  the same branch; a test that had to change to pass is a behaviour change and you say so.
- Test hooks: keep the `data-bar` / `data-pen` / `data-math` / `data-section` hooks the e2e suites use
  (`sidebar`, `style`, `list`, `code`, `erase`, `markdown`, `video`, `video-options`, `edit`, `new-section`, `tabs`,
  `new-tab`, `tab-list`, `find`; `data-math` button / pop / unparsed; `data-pen` chip / buttons / map-sheet /
  retry-mapping; `data-section` writing / text / image). Where a control moves, the hook moves with it; where a
  control goes (the Select button), the suite drives the command (its key) instead.
- Code comments state intent and quote Sean's words with the date where they decide something. Where this plan
  overrules an old "(Sean, date)" comment, change the comment too (the old decision is named in the commit).
- The docs move with the code: `docs/KEYS.md`, `docs/FEATURES.md`, `docs/PARITY.md` where they describe what you
  changed, and the generated key list's tests (`keyList.test.ts`, `menu.test.ts`) when a command is added.
- Shared files (App.tsx, app.css, chrome.css, commands.ts, menu.ts, preload, wm.d.ts) are edited by several
  branches: change only what your package needs, no reformatting, no moved blocks, so the merge is mechanical.
- A capability is a file being there and is asked once (`capabilitiesFor`): the side that cannot do a thing shows
  nothing. No second `process.platform` check.
- Your final answer is the structured report asked for in your prompt: what is done per acceptance line, what is
  not and why, the test results (counts), and any risk another branch must know.

## The packages

### P1 `toolbar` — the bar over the note (TopBar.tsx, penSettings.ts, the editor package where it must)
One 36px row (`.bar-row.page`), never wrapping, left to right (see `FinalMain.png`, `FinalToolbar.png`):
1. **Style** — a 110px bordered text button with a chevron showing the caret's cell (`kindLabel`): Text, Title…
   Subsubsection, Dots / Dashes / Numbered / To-do, Quote, Markdown, Code, Runnable code, Maths, Drawing. Its menu
   is `kindMenuItems(...)` with the caret's kind checked, keys in the hints. It needs the caret's kind: an editor
   observer (`cellKindAt(state)` in packages/editor, updated on selection and doc changes, cheap) that the page
   subscribes to. Picking runs the command exactly as its key does; the caret ends where the key leaves it.
2. **Inline**: B I U S as styled letters (Georgia), **Aa** = the font / size / colour popover (`TextStyleMenu`, its
   checkboxes removed or kept per your judgement; it must close on Escape and click-away — `usePopover` in P6, or
   its own until then).
3. **Blocks**: List (the icon shows the marker in use; its menu: Dots, Dashes, Numbered, To-do, then Increase /
   Decrease Indentation), Quote, Code (menu: the ten languages, the current ticked). The list and code buttons
   write the style / language last picked, as today.
4. **Inserts**, separate buttons: Text box, Picture (⇧⌘I), Table, Maths (the palette, ⇧⌘M), Shapes (a menu: flow
   chart nodes, Lines incl. the armed Arrow tool ticked, Marks). **Table is new**: a command `insertTable` that
   inserts a markdown table cell (two columns, three rows, caret in the first header cell), one undo step; it gets
   a Insert-menu item and a place in `commands.ts` (no key unless one is free in KEYS.md).
5. **Move section up / down** (icons `secup` / `secdown`), right of the inserts.
6. Spacer, then the **pen split button** (`.bar-split`): the main button toggles the pen (accent fill while down,
   or the eraser, below); the caret (or hold / right-click) opens the menu: **Pen** / **Eraser** (checked, with
   ⌥⌘1 / ⌥⌘2) — choosing one sets what the single button does — then **Colour** (the six presets + a custom
   colour; the current ringed) and **Width** (1 2 3 5 8 12 drawn to scale; the current marked), **Pen always draws
   (tablet)** as a switch (⌥⌘8), and **Tablet buttons and orientation…** (opens today's PenMenu content; its
   `data-pen` hooks stay). State: `penSettings` gains the button's tool (`"pen" | "eraser"`, persisted like the
   rest); eraser on = `setEraser(true)` and the button lit; the pen button lit = `mode === "pen"`. ⌥⌘1 / ⌥⌘2 /
   ⌥⌘3 / ⌥⌘4–7 keep working and keep the menu and the button in step (⌥⌘2 sets the tool to eraser and toggles it;
   ⌥⌘1 sets it to pen and toggles it; ⌥⌘3 Select tool stays a command with no button — the page shows a mode chip
   while it is on, P6). The Select / colour / width controls leave the bar; their hooks (`data-bar="select"`,
   `erase`) move: `erase` on the Eraser menu item, the suites drive Select by its key.
7. A **⋯ button that appears only when something has folded** for width: the fold ladder (≥700 everything; below
   ~630 the inserts and section moves go into ⋯; below ~560 the Style button becomes a glyph; below ~460 list /
   quote / code too) — a ResizeObserver on the bar with the widths measured, never wrapping, never clipping;
   what folds is runnable from ⋯ (with icons and keys) under the caption "Moved here for width". It also holds
   **Customize toolbar…** (the put-away checklist, which stays: right-click on the bar opens it too). The six
   old sections become the four the bar now has (Text, Blocks, Insert, Pen); migrate the remembered `collapsed`
   ids; grips go (a put-away section is shown only in the checklist).
8. With no note open the bar stays and greys (Mac parity), except the sidebar button, + and ⋯.
Acceptance: every button runs the same command as its key and its tooltip names the key (`shown`, no literal
"Ctrl" — the hand-typed `Ctrl+1–7` / `Ctrl+V` / `(Ctrl+Alt+3)` strings are wrong on a Mac); each popover closes
on Escape / click-away and gives the keyboard back to the notes; the bar is exactly 36px at every width from
460px up; unit tests for the fold ladder (a pure function of the width), the pen-tool state and `insertTable`;
e2e for the Style menu (each kind, caret position afterwards, one Ctrl+Z reverts it), the pen split button
(on/off, switching to eraser and back, colour and width changes), the fold ladder at 460 / 560 / 640 / 760.

### P2 `tabs` — the tab row (TabBar.tsx, App.tsx wiring)
`FinalMain.png`, `FinalToolbar.png` (the bottom-left strip). A 36px strip: **[sidebar button] [rendered button]
[video button + its menu]** — always, sidebar open or shut (the old placement on the sidebar's bar is removed by
P3; the video menu's contents come from `Sidebar.tsx`'s `video-pop`: Show video ⌘Y, the cameras (current ticked),
Tablet sheet, Turn left / Turn right (the menu stays up for these: `keepOpen`), Refresh devices ⌥⌘R) — then the
tabs, **+** (new note), and at the right a **list button with the open-notes count** (the way back to a
scrolled-off tab; no ‹ › arrows; the wheel still walks the strip). The active tab is page-coloured and joins the
toolbar below it (no underline), × on the active tab and on hover, max width 190; middle-click closes; the tab's
right-click menu gains Rename…, Duplicate, Move to ▸, Move to Trash… beside Close / Close Others / Reveal. The
rendered button is lit while rendered (⌘T, `data-bar="markdown"`); the video button is lit while the video shows
(`data-bar="video"`, menu `data-bar="video-options"`). The "Video Only (Hide Notes Pane)" / "Back to Side by
Side" item is kept in the video menu. Tab-list rows show a real check column for the current note (not spaces).
Acceptance: unit and e2e for the strip at 460px and wide (overflowing tabs, the count, the list), the rendered
and video buttons in both sidebar states, the tab menu's four new items working (they call the same code the
sidebar's do).

### P3 `sidebar` — the notes list (Sidebar.tsx, SidebarProject.tsx, sidebarTree.ts, main-process search)
`FinalMain.png` and the sidebar panel of `FinalStates.png`. The bar (36px, starts after the macOS traffic
lights): **a search field** (⌘⇧F — a new command `searchNotes` in `commands.ts` and the Edit menu), **+**
(New note; its corner triangle / hold / right-click: New note, New section), and the **pencil** (today's edit
mode, `data-bar="edit"`; the markdown and video buttons leave this bar). Rows: line icons (doc, folder, a
disclosure chevron icon instead of the text glyphs ▾ ▸), titles clamped to two lines, a **⋯ on hover** that
opens the row's right-click menu, the section header with its count. **An add-row ("+ New note") at the top of
every section** stays (Sean, 2026-09-21: "a small entry that looks like a note, where the note will land") — as
one quiet row (no dashed pair), and it is a **drop target** (dropping a row on it moves the note into that
section). The "New section" action lives in the + menu and the section's menu, one label ("New Section" on a
root and in a section) — keep `data-bar="new-section"` on that menu item. Move to ▸ is indented to the tree's
depth and greys the note's own section. The footer: the project's name with a menu mark (the project menu:
everything the menu bar's Project menu has plus Hidden sections, Reveal, Clean Up — one place) and the note
count. **Search is new and must be right**: typing filters in place — results replace the tree while the query is
non-empty, each result showing the note's title, the section it is in and a one-line snippet with the match
marked; matches title first, then body text, case-insensitive, diacritic-insensitive, whole project (every
folder), debounced, cancellable, never blocking the UI (the main process reads notes through the existing store;
cache extracted text keyed by file mtime+size; `.wm` notes are zips — read the note text through `wmStore`,
not by unzipping in the renderer). Arrow keys move through results, Enter opens the note and puts the Find bar
(P6) on the query at the first match, Escape clears and returns the keyboard to the notes; ⌘⇧F with the sidebar
hidden opens it first. Empty states: no matches says so in one line.
Acceptance: unit tests for the search (title / body / diacritics / many notes / a note being written / a
corrupt `.wm`), the tree helpers, the drop target; e2e for search → open → find, edit mode (trash arming still
works), the new-section path, add-row drop.

### P4 `video` — the camera / tablet pane (CameraPane.tsx, SheetStrip.tsx, BoxActions.tsx, BringInMenu.tsx, PaperMenu.tsx, camera.css, tablet.css)
`FinalMain.png` (right), `FinalTablet.png` (right), `FinalStates.png` (no source). A 36px opaque header
(`.bar-row`, dark in both themes as the pane is today; the letterbox stays black). Camera: **turn left, turn
right** (two buttons, per page, as today), **Zoom** (lit, with its % read out, while a box is set), **Hold**,
**Straighten**; spacer; **Writing | Image | Raw** as one segmented control ("Page" is renamed **Image** — the same
word as the box's; the mode the next click does is lifted); **✕**. Below it the strip (Live · device name | Page
tabs | +). The camera's source is NOT chosen here (the video menu in the tab row and Input Devices do that). Tablet:
**Paper** menu, **orientation** menu (the select in today's header becomes an icon menu), **Undo**; spacer;
**Bring in** (the one primary, filled; its menu Writing / As drawing cell …); **✕**. The sheet is letterboxed in
what is left under a fixed header (its top never jumps). A sheet bound to a drawing cell is named
"<note> Drawing" with the ▣ mark (it already is — keep it). The box: dashed accent edge, four corner handles
(the tablet's own), and the action row — camera: **Writing | Image | Text | ✕**; tablet: **Bring in writing | As
drawing cell | Copy | Erase** (primary first, Erase last, red). The pane's footer is ONE short status line
("Page found · drag a box for a part", "✎ Pen writing · hold button 1 to erase") and a right-hand fact (size /
"mouse: box a part"); the standing hint, the result of the last action and errors stop being one concatenated
grey sentence: the result of an action is a **toast** under the header's right edge ("✓ Writing added to Demo
note", an error in the same place, cleared by a timer), never a raw device path. Hold draws a frame and an
"⏸ Held · Esc" badge on the picture; the zoom hint sits below the measured header (`--camera-top`); Straighten
is disabled with no picture; the no-source placeholder is "What should this pane show?" with two cards.
Acceptance: the e2e `camera` and `tablet` suites updated and green (they drive the hooks `data-section`,
`data-camera-turn`, `data-capture`…); a capture still lands as the Mac decides (Sean, 2026-09-22: a page lands the
size the viewfinder shows it) but one gap BELOW the caret's line, never over the heading — verify and fix if it
lands on the heading; screenshots against the wireframe at 438px and at the 280px minimum.

### P5 `drawing` — the layer's controls (Canvas.tsx, StyleBar.tsx, app.css handle rules)
`FinalTablet.png` (left). A picked object has: **eight resize handles** and a **rotate handle** (the standard
set), and **one inspector bar** above it — name, colour, width, fill, label (Aa), order, dock-into-note,
duplicate, delete — replacing the six glyph discs (↻ ✥ ✕ ⤵ ◐ ⤡) and the separate StyleBar; handles sit ON the
box edge, never centred on the words (the discs used to land on the text); the inspector never covers the
object (it flips below when there is no room above). **Delete fires on click (pointer-up inside the button),
reads red, and is hidden while a crop or a label is being edited**; Escape closes the inspector's popovers. The
arrow tool no longer auto-opens the full inspector over the node just connected: after drawing a connector the
inspector shows its heads row only, anchored at the arrow's end. Pictures keep their crop and Aa (read the
picture) actions in the inspector; a multi-selection's inspector has Group / Ungroup, order, duplicate, delete;
connectors drop Turn / Resize. One width ladder and one swatch set shared with the pen menu (P1) — export them
from core / a shared module rather than copying. Small objects (< ~48px) get a single pill, not a ring.
Acceptance: all the existing drawing e2e suites (`drawing`, `tablet`, `pen`, `cells`' ink checks) green; new
unit tests for the inspector's placement function (above / below / clamped to the pane) and the handle hit
tests; screenshots of rectangle, arrow, picture, multi-select, crop against the wireframe.

### P6 `overlays` — find, link, divider, footer, dialogs, popovers (FindBar.tsx, LinkBanner.tsx, PaneDivider.tsx, App.tsx footer, KeyList.tsx, Prompt.tsx, CleanUpDialog.tsx, AboutDialog.tsx, UpdateDialog.tsx, LanguageSetupDialog.tsx, Notebook.tsx menus, focusReturn.ts)
`FinalStates.png`, `FinalMain.png` (the footer, the divider, the mode chip).
- **Find / Replace and the link picker float over the note** (cards at the top right / over the page) — the note's
  top edge never moves. Find: ⌘F / ⌘H, Enter next, Shift+Enter previous, Esc closes and returns the caret to
  the editor with the current match selected, "1 of 3", case and whole-word toggles, Replace / All (one Ctrl+Z
  undoes a Replace All).
- **The pane divider** is a visible 6px column with a grip, a wider hit area, and the accent while dragging.
- **The notes footer** in three groups: file name · a mode chip (Pen · 3 px / Eraser / Select tool / Placing:
  Rectangle — also a live region a screen reader hears) · the counts and the save time. While the pen / eraser /
  select tool / an armed shape is on, a floating chip on the page says it ("Pen · 3 px · Esc to stop").
- **One Modal component** for the key list, Rename, Move to Trash, Clean Up, About, Update and Language setup: a
  backdrop that makes the page behind it inert, Tab trapped inside, Escape handled on the window in the capture
  phase, focus returned on close. **Move to Trash defaults to Cancel and Enter acts only on the focused button**;
  one destructive red (#c0392b) everywhere. **The key list** is searchable ("Search keys…"), keeps a scrollbar
  gutter so no keycap is clipped, and prints modifiers in Apple's order (⌃⌥⇧⌘).
- **One popover hook** (`usePopover`: capture-phase click-away, Escape with stopPropagation, window blur / resize,
  viewport clamping, focus moved in and returned) used by every popover that is not already a `FloatingMenu`
  (the font popover, the maths palette, the Paper / Bring in menus if P4 keeps them as popovers, the toolbar's
  Customize checklist); Notebook's context menu and the seam's kind menu become `FloatingMenu`s (keyboard,
  clamping); `FloatingMenu` stops painting the first row as chosen on open (focus the menu, move to a row on the
  first arrow).
- **AltGr**: Ctrl+Alt pen chords stand down when AltGr is held, so `{ [ ] } @ \ |` type on European layouts
  (`CmdOrCtrl+Alt+digit` matched on `KeyboardEvent.code` only when the layout is not producing a character).
- Copy: no hand-typed "Ctrl" (every chord through `shown()`); the Quick Reference's feature bullets are built from
  the same table as its keys (one column for this machine's keys); the "Recovered\file" message says "the
  Recovered folder"; the camera-off placeholder points at the device list under it.
Acceptance: unit tests for modal trapping logic, the key list search / order, the footer's mode text; e2e for
find (all of the above), a Tab from every dialog's last button staying inside, Esc closing every popover.

### P7 `cells` — cell behaviour and the input cursor (packages/editor, packages/core, Notebook.tsx, editorCommands.ts, seams)
The risk areas Sean named. **Audit and fix, with tests**: (a) every way a cell is made — the Style menu, the
seam's **+**, the key, the list / quote / code buttons, Text box / Table / Maths inserts — leaves the caret in the
right place (inside the new cell, at its first editable position; a drawing cell takes the pen's focus; a maths
cell shows source until the caret leaves) and is ONE undo step; (b) the seam: the **+** is a small round marker
in the gutter beside the line between two cells (drawn in the gap, never over a cell's text — the wireframe),
a 24px hit target, its menu is `kindMenuItems` via `FloatingMenu` (arrow keys, Esc), the armed bar stays "the
caret hides, the bar is the cursor" (docs/KEYS.md, Sean 2026-10-05) and typing / Enter / Esc / arrows behave as
the docs say; (c) arrow keys, Home / End, Ctrl+Up / Down (section moves) and cell moves keep the caret on the
same text and scroll it into view; held-cell (bracket) selections survive a toolbar click; (d) after any bar or
menu action the keyboard returns to the notes with the caret where it was (`focusReturn.ts`), including after the
new menus and popovers; (e) **Find is exact**: matches across cells, inside code and maths source, in the rendered
page; next / previous wrap; the match is selected and scrolled into view; Replace / Replace All keep cell
structure and are one undo step; regex off by default; the search term and options are remembered for the
session; closing returns the caret to the match; (f) **Move section up / down** keep the caret and the selection
inside the moved section and are one undo step each; (g) `insertTable`'s table cell edits correctly (Tab moves
cell to cell, Enter adds a row at the last cell — read `packages/editor/src/tables.ts`; do not invent a second
table engine). Write the missing unit tests in `packages/editor/test` / `packages/core/test` and e2e scripts in
`e2e/suites/cells` and `editor` for each of (a)–(g) — real keys and real mouse through the harness. Fix every bug
you find at its cause; anything you cannot fix is reported with a failing test marked in `known-issues.json`.
(P1 owns the Style button and its menu; P6 owns the Find card's look. You own what they DO.)

### P8 `undo` — three steps back, whatever they were (renderer `useUndo.ts`, `noteHistory.ts`, `editTimeline.ts`; main `notes.ts`, `housekeeping.ts`, `main.ts` IPC; a new main-process undo journal)
**Requirement (Sean): Undo is always able to undo up to 3 steps, even when a step changed files; backups are kept
until the step is out of scope (more than three steps back, or the app has quit).** Today Undo is per note: the
words (CodeMirror's history) and the drawing share one timeline (`editTimeline.ts`); the file operations have no
undo at all (rename, move, duplicate, new note, trash, section create / rename / move / trash, Clean Up) and the
history of a note is dropped in places (`renameNote` in `noteHistory.ts` drops the editor state when a note is
renamed or moved; a note that is closed is forgotten; a disk reload drops it). Design, build and test:
1. **A journal of steps** — an ordered list of the user's last steps, whatever kind: an edit in a note (the
   existing timeline) or a file operation. **Ctrl/⌘+Z undoes the most recent step of either kind**, Redo
   the mirror, and a new step ends the redo path. The file operations are journalled in the main process (they
   own the files); the renderer's timeline gives the journal the wall-clock of its newest edit so the two
   are ordered by time. Keep AT LEAST the last three file operations undoable (more is fine); the note's text
   history keeps its depth (≥ 200 entries) and must survive: tab switches, saves, autosaves, renames and moves,
   a disk reload that did not change the text, a theme change, the divider, the video toggling.
2. **File operations that must be undoable:** new note, duplicate, rename, move (a drag in edit mode, Move to),
   trash, new section, section rename, section move, section trash, Clean Up's trash, import / adopt, and
   the same through the tab menu (P2) and the sidebar (P3) — whichever surface started them. Add folder /
   remove folder in the project are project settings: report whether you made them undoable, with your reason.
3. **Backups until out of scope:** anything an operation destroys or overwrites is first backed up under the
   app's user-data folder (`undo/<step id>/…`; copy, and a clone where the volume has one) — a trashed note or
   section (the whole folder, drawings and media included), an overwritten or deleted file, a duplicate or new
   note's content at the moment it is undone. The backup is deleted when its step falls more than three steps
   back, when the step is superseded by a new step after an undo, and at quit; a crash leaves them, and the next
   launch removes stale ones (they are copies of what is in the OS Trash). Undo of a trash restores from the
   backup (the item in the OS Trash stays; say so in the docs); if the name is now taken it is restored beside
   it with a number and the person is told. The notes folder is the person's data: nothing is deleted that was
   not made by the journal; every journal write is guarded like the rest (`mayWrite`, the atomic writer); a
   failed undo leaves things as they were and says why.
4. **The menu:** Edit ▸ Undo / Redo name the step ("Undo Rename Note", "Undo Move to Trash", "Undo Typing") and
   grey when there is nothing; the pen's Undo button and the tablet sheet's own undo keep their scope (the sheet's
   strokes) and do not break the journal.
5. **Focus rule:** Ctrl+Z in a text field (rename prompt, find field, a label) is that field's own, as now.
6. **Tests, real ones:** unit tests of the journal over a fake file system (every operation, the backup lifecycle,
   the third-step boundary, the name-taken restore, a failing undo, quit / crash cleanup, redo, a new step
   killing redo); an e2e script that does five things in a row (type in a note, rename it, move it into a
   section, trash another note, type again) and presses Ctrl+Z five times — checking the text, the names, the
   folder and the sidebar after EACH press — then Ctrl+Shift+Z five times; one that does six file operations and
   checks the oldest backup is gone and only three undo; one for the interleaving of text edits and file
   operations across two notes; one for undo after a tab switch and a disk reload. Document the design and the
   limits in `docs/PLAN-undo.md` (what a step is, where backups live, when they go).

## Order of merge and who owns what

P8's journal wraps the main-process file operations; P2 / P3 only call them. P1 owns the pen state; P6's footer
chip reads it. P5's swatch / width module is used by P1 (until it lands, P1 keeps the presets in one place and
P5 imports from there). The merge order I will use: foundation → P8 → P3 → P2 → P4 → P1 → P5 → P6 → P7, the app
rebuilt and the whole suite run after each.
