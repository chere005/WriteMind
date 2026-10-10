# Keys, and where each one is heard

The menu bar, the toolbar tooltips and the key handler all read ONE table:
`apps/desktop/src/shared/commands.ts`. A key shown is a key that works.

**The Quick Reference** a new install opens on (`WriteMind Quick Reference.wm`, `shared/welcome.ts`; Help ▸ Quick
Reference, no key, writes or refreshes it and shows it rendered, overwriting any edit made to it) reads its
keys table from that same table: a short curated list of command ids (`WELCOME_KEYS`), Windows and Mac chords
from `acceleratorFor`, so it cannot drift. `apps/desktop/test/welcome.test.ts` fails when one of its ids is gone
or has no key on Windows. Run the cell (Shift+Enter) is the one row that is not a menu key: the test finds it in
the editor's keymap instead.

**The Mac's ⌘ is Ctrl.** The Mac's ⌃ chords keep what the editor already used
on Windows where Ctrl alone is free. Where the Mac's chord would collide with
something on Windows (the ⌃⌘ and ⌥⌘ pairs, which are one Ctrl+Alt on a PC), it
is Ctrl+Alt. On a Mac build the same table shows the Mac's own chord.

## Who hears the key (one press = one action)

A menu accelerator is **shown and never registered** (`registerAccelerator:
false`). A registered one is a second listener beside the page's own, and a
press would run twice. Each command names its owner instead:

| Owner | Hears it | Commands |
|---|---|---|
| `editor` | CodeMirror's keymap (`packages/editor/src/keys.ts`, `extras.ts`). The page stands down because the key arrives `defaultPrevented`. | the Format menu, Select Next / All Occurrences, Code Block |
| `history` | `useUndo` (the words and the drawing share one Undo) | Undo, Redo |
| `page` | `useChrome` in the page | File, View, Insert, Pen, Undo/Redo Drawing, Expand Selection, Find, Input Devices, Help |
| `main` | `useChrome`, which hands it to the main process (dialogs, the project file) | Project menu |

A **menu click** sends `menu:command` to the page (or runs in the main process
for `main` items), and runs the same function the key does:
`editorCommands.ts` for the formatting commands, the same core functions the
keymap calls.

Do not use `role: "windowMenu"` or `role: "viewMenu"`: their Minimize
(Ctrl+M), Close (Ctrl+W) and Developer Tools (Ctrl+Shift+I) are *registered*
accelerators and collide with Merge Cells, Close Tab and Insert Image. The test
`menu.test.ts` fails if a role other than a known-safe one appears.

## Every key (Help ▸ Keyboard Shortcuts, F1)

ONE LIST, the Mac's README table and `Shortcut` enum (Mac e8b3266, 2026-09-21: Sean asked for ⌘S, ⌘P, ⌘E,
⌘T, ⌘Y, ⌘K and ⌘; "unless there's conflicts with those?"; "document the keystrokes in the readme"). This
table is `shared/keyList.ts` row for row, and **`apps/desktop/test/keyList.test.ts` fails** when a key moves,
is added or is taken away until this table says so too; the same test holds the list to the menu bar, fails
on any chord two commands want, and fails when the editor's keymaps bind a menu chord outside
`shared/commands.ts`. Help ▸ Keyboard Shortcuts (F1) shows the same rows in the app, with the number keys (Ctrl / ⌘ (+ Shift) + 1 … 9, then 0: the cell kinds, each digit's Shift chord after it) taken out of their menus and shown first as one group, "Cell Types — Ctrl (+Shift) + a Number" (`shared/keyGroups.ts`, Sean 2026-10-05). Digits are matched by the PHYSICAL key (`KeyboardEvent.code` `Digit7`): Shift+7 types `&` on a US layout. Ctrl+9 is the Maths Cell and Ctrl+0 the Drawing Cell (Sean, 2026-10-06: "ctrl + 7 should be PURELY plaintext.. so clearly we need a math cell type.. that should be ctrl + 9 and make ctrl + 10 drawing cells"); no zoom item uses Ctrl+0 (the menu has no zoom roles). The Mac column is the
Mac app's own chord; "—" is a port-only key.

| Menu | Command | Windows / Linux | Mac |
|---|---|---|---|
| File | New Note | Ctrl+N | ⌘N |
| File | Close Tab | Ctrl+W | ⌘W |
| File | Open Notes Folder | Ctrl+Shift+O | ⇧⌘O |
| File | Save | Ctrl+S | ⌘S |
| File | Export… | Ctrl+E | ⌘E |
| Project | Add Folder to Project… | Ctrl+Shift+A | ⇧⌘A |
| Project | Save Project | Ctrl+Shift+S | ⇧⌘S |
| Edit | Undo | Ctrl+Z | ⌘Z |
| Edit | Redo | Ctrl+Y | ⇧⌘Z |
| Edit | Undo Drawing | Ctrl+Alt+Z | ⌥⌘Z |
| Edit | Redo Drawing | Ctrl+Alt+Shift+Z | ⌥⇧⌘Z |
| Edit | Expand Selection | Ctrl+. | ⌘. |
| Edit | Select Next Occurrence | Alt+D | ⌘D |
| Edit | Select All Occurrences | Alt+Shift+D | ⇧⌘D |
| Edit | Find… | Ctrl+F | ⌘F |
| Edit | Find and Replace… | Ctrl+H | ⌥⌘F |
| Edit | Find Next | F3 | ⌘G |
| Edit | Find Previous | Shift+F3 | ⇧⌘G |
| Edit | Jump to Selection | Ctrl+J | ⌘J |
| View | Show / Hide Notes Sidebar | Ctrl+K | ⌘K |
| View | Markdown Preview / Editor | Ctrl+T | ⌘T |
| View | Show / Hide Video | Ctrl+Shift+Y | ⌘Y |
| View | Draw / Stop Drawing | Ctrl+P | ⌘P |
| View | Collapse Subsections | Ctrl+; | ⌘; |
| View | Fold All Sections | Ctrl+Alt+Shift+Left | ⌥⇧⌘← |
| View | Unfold All Sections | Ctrl+Alt+Shift+Right | ⌥⇧⌘→ |
| Format | Title | Ctrl+1 | ⌘1 |
| Format | Chapter | Ctrl+2 | ⌘2 |
| Format | Author | Ctrl+3 | ⌘3 |
| Format | Section | Ctrl+4 | ⌘4 |
| Format | Subsection | Ctrl+5 | ⌘5 |
| Format | Subsubsection | Ctrl+6 | ⌘6 |
| Format | Text | Ctrl+7 | ⌘7 |
| Format | Markdown | Ctrl+Shift+7 | — |
| Format | Bold | Ctrl+B | ⌘B |
| Format | Italic | Ctrl+I | ⌘I |
| Format | Underline | Ctrl+U | ⌘U |
| Format | Strikethrough | Ctrl+Shift+X | ⇧⌘X |
| Format | List | Ctrl+Shift+L | ⇧⌘L |
| Format | Quote | Ctrl+Q | ⌃⌘Q |
| Format | Decrease Indentation | Ctrl+[ | ⌘[ |
| Format | Increase Indentation | Ctrl+] | ⌘] |
| Format | Split Cell | Ctrl+D | ⌃D |
| Format | Merge Cells | Ctrl+M | ⌃M |
| Format | Duplicate Cell | Ctrl+Shift+D | ⌃⇧D |
| Format | Evaluation Cell | Ctrl+Shift+8 | ⌘9 |
| Format | Move Cell Up | Ctrl+Shift+Up | ⌃⇧↑ |
| Format | Move Cell Down | Ctrl+Shift+Down | ⌃⇧↓ |
| Format | Move Section Up | Ctrl+Up | ⌃⌘↑ |
| Format | Move Section Down | Ctrl+Down | ⌃⌘↓ |
| Insert | Image… | Ctrl+Shift+I | ⇧⌘I |
| Insert | Maths… | Ctrl+Shift+M | — |
| Insert | Code Block | Ctrl+8 | ⌘8 |
| Insert | Maths Cell | Ctrl+9 | — |
| Insert | Drawing Cell | Ctrl+0 | — |
| Pen | Pen Down / Up | Ctrl+Alt+1 | — |
| Pen | Erase Tool | Ctrl+Alt+2 | — |
| Pen | Select Tool | Ctrl+Alt+3 | — |
| Pen | Pen Always Draws | Ctrl+Alt+8 | — |
| Pen | Next Colour | Ctrl+Alt+4 | — |
| Pen | Previous Colour | Ctrl+Alt+5 | — |
| Pen | Wider Line | Ctrl+Alt+6 | — |
| Pen | Thinner Line | Ctrl+Alt+7 | — |
| Pen | Delete Selection | Ctrl+Alt+9 | — |
| Pen | Clear Selection | Ctrl+Alt+0 | — |
| Pen | Send Writing | Ctrl+Alt+W | — |
| Pen | Send Page | Ctrl+Alt+Shift+W | — |
| Pen | Clear Sheet | Ctrl+Alt+X | — |
| Pen | Next Sheet | Ctrl+Alt+PageDown | — |
| Pen | Previous Sheet | Ctrl+Alt+PageUp | — |
| Input Devices | Refresh Device List | Ctrl+Alt+R | ⌥⌘R |
| Help | Keyboard Shortcuts | F1 | — |

Notes, so nobody "fixes" them:

- **⌘Y is Ctrl+Shift+Y**, not Ctrl+Y: Ctrl+Y is Redo on a PC (and the ExpressKey layouts suggest it). Redo is
  also Ctrl+Shift+Z, the Mac's own chord (useUndo hears both; only Ctrl+Y is listed).
- **Ctrl+E is Export…** (Sean's ⌘E). Edit ▸ Find ▸ Use Selection for Find, which had it, keeps no key.
- **Ctrl+T, Ctrl+K, Ctrl+Shift+Y, Ctrl+P MOVED** these commands (they were Ctrl+Shift+P, Ctrl+Alt+S,
  Ctrl+Alt+C, and none): the Mac moved them rather than adding a second key, "two keys for one action is two
  things to remember".
- **No key any more** (Sean, 2026-09-21): Hide/Show Notes Pane (was Ctrl+Alt+E), Hide/Show Markdown Markers
  (was Ctrl+Alt+M), Delete Cell (was Ctrl+Backspace: Backspace / Delete over held cells already takes them, and
  Ctrl+Backspace over held cells still does, as the same key, not a menu chord). The commands stay in the menus.
- **Fold / Unfold Section** (Ctrl+Alt+Left / Right, the caret's OWN section) are gone, as on the Mac.
  **Collapse Subsections (Ctrl+;)** folds what is UNDER the held cells (or the caret's cell) and never the cell
  itself; pressed again with all of it folded, it opens it. Fold / Unfold All keep their chords.
- **Draw / Stop Drawing (Ctrl+P)** and **Pen ▸ Pen Down (Ctrl+Alt+1)** are the same writer: Ctrl+P is the
  Mac's ⌘P, Ctrl+Alt+1 is the chord the tablet's ExpressKeys type (see below), kept so a set-up tablet keeps
  working.
- **Save (Ctrl+S)** writes what is pending now — the note and its drawing (the Mac's `flushPendingSave`); the
  note is otherwise saved half a second after the last keystroke. **Save Project** is Ctrl+Shift+S, ⇧⌘S on
  the Mac too since it stopped sharing ⌃⌘S with the sidebar.
- **Export… (Ctrl+E)** is one save panel: its "Save as type" list is PDF or Project (the Mac's Format popup);
  with no note open only Project is offered. A project export is the folders and nothing else, a copy: the
  open project keeps its own file (Project ▸ Save Project As… is the one that moves it).
- **Select Next / All Occurrences** are Alt+D / Alt+Shift+D: the Mac's ⌘D / ⇧⌘D would be Ctrl+D / Ctrl+Shift+D,
  which are Split Cell and Duplicate Cell here (the Mac's ⌃D, ⌃⇧D).
- **Delete / Duplicate / Move Cell keys act on the cells whose brackets are held**, and decline otherwise. The
  *menu* items act on the held cells, or on the cell the caret is in when none is held — the Mac's
  `selectedCells`.
- **Ctrl+Alt+letter is AltGr** on layouts that have one; Windows then sends Ctrl+Alt with a typed character. The
  chord still arrives as Ctrl+Alt, but if a layout makes a letter unusable, change it in `shared/commands.ts` and
  the menu, tooltips, handler, Help list and the test follow (and this table must be changed to match).
- **Ctrl+Alt+Arrows** are the screen-rotation hot keys of some Intel graphics drivers; where those are on, fold
  from the menu.
- **Markdown Markers** (View menu, no key) and **Markdown Preview** (Ctrl+T) are two independent switches, as on
  the Mac (`showMarkers` and `mode`): the markers are about the markdown side (hidden, the `**`, the `#`, a link's
  URL are put away on every line but the caret's and the file is untouched; the choice is remembered); the
  preview draws every block but the one being written in. Both labels flip (Hide / Show Markdown Markers; Show
  Markdown Preview / Editor).
- **Format ▸ List and Ctrl+Shift+L** both write the style the list button's chevron picked (dots `- `, dashes
  `* `, numbers `1. `, to-dos `- [ ] `), and the choice is remembered.

## Text cells and markdown cells (docs/PLAN-text-cells.md; Sean, 2026-10-05; port-first)

A body-text paragraph is a TEXT cell unless it is marked: plain words, line for line, nothing formatted. A MARKDOWN
cell is the hidden line `<!-- markdown -->` over a paragraph. Both panes and the paper agree.

| Key | Does |
|---|---|
| Ctrl+7 (Format ▸ Text) | a markdown cell becomes a text cell: the marker and the formatting go, the words and their line breaks stay (one Undo, its own step). Inline maths keeps its whole source as words (`` `wl:Pi r^2` ``, shown as typed, not typeset), so Ctrl+Shift+7 afterwards typesets it again. On a heading: body text, as before. At a bar: a new text cell there |
| Ctrl+Shift+7 (Format ▸ Markdown) | a text cell becomes a markdown cell and its words are read as markdown from then on: the marker goes on top and the escapes' backslashes go (a literal `**x**` is bold now, a line starting `# ` a heading, single line breaks join); the selection stays on the same characters, one Undo gives the text cell back. Ctrl+B / I / U, the B I U S buttons, the T menu, /link and inline maths (a `wl:` code span) in a text cell do the same first; a selection that only touches a text cell at an end leaves it alone. On a heading: a markdown paragraph of its words. At a bar: a new markdown cell there |
| Ctrl+B / I / U, Ctrl+Shift+X, the toolbar's B I U S, the T menu, `/link`, inline maths in a TEXT cell | make it a markdown cell first, then format: ONE Undo takes both back |
| typing `**`, `#`, `- `, `>`, `1.`, `` `wl:x^2` ``… in a text cell | stays literal: the file gets a backslash before what would mean something else, and only that; WriteMind hides it and the caret takes it with its character (maths typed there is its source, never typeset: the palette's inline insert makes the cell markdown first) |
| Shift+Enter in a text cell on the rendered page | a line break in the cell (Return still starts the next cell); on the markdown side Return is a line break as ever |
| Copy / Cut in a text cell | the words, without the hidden backslashes (held cells copy whole, as markdown) |
| Backspace at the start of a markdown cell's words, Delete at the end of the line above it | as if the marker were not there: the cell moves up, or its words join the line above (the marker goes with the line break) |

Older notes: a paragraph with no marker that holds unescaped markup WriteMind writes (`**…**`, `_…_`, `~~…~~`, `<u>`,
`<span style>`, `[…](…)`, `` `…` ``, `wl:` maths) is read as a markdown cell and gets its marker when it is next edited.

## The bar on the markdown side (Sean, 2026-10-05)

The arrows walk cell, bar, cell here as on the rendered page (`packages/editor/src/barWalk.ts`, wired in `seams.ts`).
A cell's edge is its row ON SCREEN: a wrapped paragraph's last row, a code block's closing fence, a table's last row.

| Key | Does |
|---|---|
| Down / Up on a cell's last / first row | arms the bar beneath / above it (the caret hides, the bar is the cursor): on the blank line between two cells, between two that touch (a heading and the line under it), after the last cell, above the first |
| Down / Up at a bar | the first row of the cell below / the last row of the cell above (the column kept from a blank line); at either end of the note the bar stays. A picture or ink cell is never entered: the bar steps over it to the far side |
| Left / Right at a bar | the end of the cell above / the start of the cell below (a picture or ink cell: the bar on its far side, as Up / Down) |
| Escape at a bar | puts it out; a bar an arrow armed gives the caret back where it was |
| Enter, a character, a paste at a bar | as after a click: a new cell there, a blank line above and below it |
| Shift / Ctrl / Alt + arrows, arrows over a selection | the editor's own (a picked drawing keeps its arrow nudge first) |

While a bar is the cursor no cell holds the caret (Sean, 2026-10-05), on either page: typeset maths, list markers and
drawn blocks stay as they are; a cell opens only when an arrow (or a click) goes into it. Two cells that touch with
no blank line, where one is a fence, a table, a picture, a heading or a rule, have a bar of the page's own height
between them (`apart.ts`): Down / Up stop there on both pages, cell, bar, cell.

## The rendered page (Write in the preview)

Ctrl+T (or the sidebar's document button). Everything in the table above works on the block that is
open; these are the keys that only mean something here (`packages/editor/src/preview/keys.ts`), and every
one of them declines on the markdown side:

| Key | Does |
|---|---|
| click a drawn block | opens it in place, the caret where the word was clicked; a click on a to-do's box ticks it (one character written, nothing opens); a click on a drawn link goes to it |
| Return | starts the next block (what is behind the caret stays, what is in front becomes the next block); in a list, a to-do list, a numbered list or a quote it carries the list on, and on an empty item it ends the list; in code it is a newline. Over held cells it does nothing |
| Backspace | in a block with nothing in it, takes the block away (and the blank lines holding it apart) and lands at the end of the block before; at a bar it takes the bar back and writes nothing. At the start of a to-do's words it joins them to the to-do above (caret at the seam), in an EMPTY to-do it takes that to-do away (caret at the end of the one above; the only to-do takes its block), and at the top of a to-do list with words it does nothing — the box is never deleted by the key (Mac 0fdd031). Just behind a heading's `## ` or a list's `1. ` / `- ` it takes the whole marker (a nested item loses a level first) |
| Delete | at the end of a to-do's words, joins the next to-do's words on (port addition: the editor's own Delete would pull the next box in as text); at a bar, as Backspace |
| Home / Left | the caret never stands in a heading's hashes, a bullet, a number or a to-do's box on this page: Home and a click on the left edge land on the first word; Left from the first word steps over the marker to the line above |
| Up / Down | inside a block, its lines; off its top or bottom, onto the bar beside it (the caret hides, the bar is the cursor); again, into the next block at its start (up: the block above, at its end). Off the first/last block they arm the bar above/under the note |
| Up / Down into or through a fenced cell (code, an evaluation cell, its `out` cell, `wl` maths, any fence) | never on a fence (backtick) line (Sean, 2026-10-05): in from above, the first CONTENT line (from below, the end of the last); inside, the content lines; Down from the last content line (Up from the first) leaves the cell to the bar beside it. An empty cell is given an empty line to stand on; a click on an open cell's fence strip lands on the content line beside it. Left / Right still reach the opening fence, where the language is typed; Shift+arrows and drags select across fences as before (`preview/fences.ts`) |
| Shift+Up / Shift+Down | off the edge of a block, extend the selection a whole block at a time |
| Page Up / Page Down (+ Shift) | the window moves a page and the caret goes to the block at the same height |
| Escape | at a bar, takes it back (the caret returns to the block above); over held cells, lets go of them; in an open block, closes it — the block is drawn again and the caret is put away (Mac `move(.out)`); the next arrow, Home or End only brings the caret back where it was, a character goes in where it was |
| a character at a bar | opens a block there with that character in it; Return opens an empty one; the + on the bar chooses the kind first |
| Ctrl+1…7, Ctrl+Shift+L, Ctrl+Q (quote), Ctrl+8 and the list / quote / code buttons at a bar | MAKES that kind of block at the bar now — on the markdown side too (2026-10-05) — its marker in and the caret where the words go (Mac 0fdd031); bold, indent and the other commands with no kind still do nothing at a bar. The + on a bar MAKES the chosen kind of cell at once, the caret in it (2026-10-05; the Mac only names the kind for the next character); Insert ▸ Maths… at a bar puts the maths in a new cell there |
| a character over held cells | replaces them |
| Alt-click on the words of a link | follows it from inside an open block (a plain click puts the caret in it) |

## Tables (both modes; port-first, part one of "Tables, from scratch")

In a pipe table (the markdown pane, or a table opened on the rendered page by a click on a cell). Heard by
`packages/editor/src/tables.ts` at the highest precedence, ahead of Tab's indent and the page's Return; the rules are
core `tableTab` / `tableReturn`. No table button or menu key yet (docs/TODO.md).

| Key | What it does |
|---|---|
| Tab | the next cell (along the row, then the first cell of the next; the delimiter row is stepped over), its words selected so typing replaces them (an empty cell: the caret in it). Past the last cell of the last row: a new empty row, caret in its first cell |
| Shift+Tab | the previous cell; stays on the first cell of the header |
| Return | a new empty row under the caret's row (under the delimiter row when the caret is in the header), caret in its first cell; never splits the table. On an EMPTY last row: the row goes and the table ends, the caret after a blank line below it (as an empty item ends a list). At the very start of the header: an ordinary Return (room above the table) |
| Tab / Return with a selection over two lines | not the table's: Tab indents, Return is the ordinary one |

## Evaluation cells (both modes; Mac 0bf52b5 … 859aa6c)

| Key | What it does |
|---|---|
| Shift+Enter in an evaluation cell (```` ```eval python ````, `eval wl`, `eval c`, `eval c++`, `eval rust`) | runs THAT cell: the answer goes under it as an ```` ```out ```` cell (replacing the last one), and the bar is left under the answer. Anywhere else Shift+Enter is what it always was. Not a menu key, on purpose (an accelerator would take Shift+Enter from every field) |
| Ctrl+8 (Insert ▸ Code Block) with nothing selected in a cell of words | a new, empty code cell AFTER that cell, the caret in it (2026-10-05; Ctrl+Shift+8's rule). At a bar: there. Round a selection: fences it. On an empty line: there |
| Ctrl+Shift+8 (Format ▸ Evaluation Cell; Ctrl+9 until 2026-10-05, the Mac's ⌘9) | at a bar: a new evaluation cell there, caret inside. In a fenced cell: that cell becomes one, keeping its code. Anywhere else: a new one after the caret's cell. The environment is Wolfram until one has been picked from a cell's mark, then the last one picked |
| a click on the mark left of an unrun cell (`WL ▾`, `PY ▾`, …), or on the language under a cell's `In[n]` | the environment menu ("not installed" beside a tool this machine has not got); picking one rewrites the fence |
| a click on the spinner under a running cell's mark | stops the run (the child and what it started are killed) |
| Ctrl+Z after a run | takes the answer out (it is its own undo step) |

## Drawing cells and docking (docs/PLAN-docking-ink-cells.md)

| Key | What it does |
|---|---|
| Ctrl+0 (Insert ▸ Drawing Cell; the + menu's Drawing Cell at a bar; Ctrl+9 on 2026-10-05, Ctrl+0 again since 2026-10-06) | an empty ink cell (200 px tall) at the armed bar, else after the caret's cell; one Ctrl+Z takes its line and its sidecar item out. The pen draws, erases and selects in it as on the page. AND THE POINTER BECOMES A PEN FOR THAT CELL (2026-10-05): with the pen up, a press in the new cell draws there (its box is ringed, the cursor a crosshair); a press anywhere else ends it and is just a click (the caret; never a stroke, not even from a pen that always draws); Escape ends it; Ctrl+P (the pen for the whole page) ends it too |
| the dock handle (⤵, right of a picked set of floating strokes and / or pictures on the page) | a click docks them at the cursor (the armed bar, else after the caret's cell): one picture → a picture cell, anything else → one ink cell. A drag shows the drop bar under the pointer and docks where it is let go; over an ink cell (it lights up) they go INTO it. Escape or letting go outside the note docks nothing. One Ctrl+Z (or the pen's lower-button double tap) puts them back on the page and takes the line out |
| arrows, Backspace / Delete, Ctrl+C / Ctrl+X / Ctrl+V, Ctrl+G with strokes picked IN an ink cell | nudge, delete, copy, cut, paste (back into the same cell), group, as on the page |
| a right-click on a drawing cell (either pane, pen up or down; the pen's Right-click action too) | its menu: **Open in Tablet Sheet** (the video pane shows the Tablet, on a sheet tab "<note> Drawing" BOUND to the cell: writing there writes into the cell, one Ctrl+Z in the note per stroke or erase) and **Delete Drawing Cell** (its line goes, as Delete on the held cell; Ctrl+Z brings it back). Since 2026-10-06 also **Text Box**, **Shape ▸** and **Arrow ▸** (arm the tool: the next click or drag in the cell puts one IN it) and **Undock** (the cell comes out of the note, its objects floating where it was, picked; one Ctrl+Z puts it back). A read-only ink line keeps the notebook's Cut / Copy / Paste menu |
| a right-click on a docked picture (a picture cell of the note's own media) | **Undock** (a floating picture again, where and as big as the note showed it; one Ctrl+Z docks it back), **Cut**, **Copy**, **Delete Picture Cell**. A picture from anywhere else keeps the notebook's menu |
| the pointer over an object, pen up (2026-10-06) | a faint outline and faint handles show what a click would take (a picture: the outline only); nothing is picked until the click, and a press on a faint handle picks it and does what the handle does |

## Maths cells (Insert ▸ Maths Cell, Ctrl+9; port-only)

Sean, 2026-10-06: "ctrl + 7 should be PURELY plaintext.. so clearly we need a math cell type.. that should be ctrl + 9".
A maths cell is a ```` ```wl ```` fence of Wolfram Language, typeset whenever the caret is not in it (the display maths
the palette writes). A text cell never typesets anything. Rules: `packages/core/src/cells/mathsCells.ts`.

| Key | What it does |
|---|---|
| Ctrl+9 at a bar, on an empty line, or in an emptied cell (the + menu's Maths Cell at a bar too) | a new empty maths cell there, a cell of its own (blank lines round it), the caret inside ready for Wolfram Language; it is typeset when the caret leaves |
| Ctrl+9 in a text or markdown cell with words | THAT cell becomes a maths cell, its words the source (a text cell's escape backslashes come out: maths source is raw; a markdown cell's marker line goes). With some of its words selected: those words are fenced, as Ctrl+8 fences them. One Ctrl+Z gives the cell back. Words holding a Link Here anchor are left as they are (a new maths cell goes after their cell: links from other notes keep landing); a line that would read as a fence (```) keeps its backslash |
| Ctrl+9 in a code block | its fence becomes ```` ```wl ````, the code kept |
| Ctrl+9 in an evaluation cell or its `out` answer | a new empty maths cell AFTER the pair (the runnable cell is left as it is) |
| Ctrl+9 in a maths cell; heading / list / quote | nothing; a new maths cell after it (Ctrl+8's rule) |
| Ctrl+7 in a maths cell | a text cell of its source: plain words (by the escape rule), never typeset |
| Ctrl+8 in a maths cell | a Wolfram Language code block of the same source (```` ```wolfram ````: `wl` IS the maths fence, so it would still be maths) |

## The maths palette (Insert ▸ Maths…, the ƒ(x) button)

Ctrl+Shift+M opens it (again, from inside it, puts it away) with the picked shape focused, even with the Maths
section of the bar put away. Inside: **arrows** pick a shape (Left/Right one, Up/Down a row, PageUp/PageDown a
group, Home/End the ends) and the form follows; **Tab / Shift+Tab** walk Slots, Wolfram Language line, the
"On its own line" tick, Insert, and wrap; **Enter** inserts (as the tick says; not while an input method is
composing), **Ctrl+Enter** inserts the other way, **Space** on the tick toggles it, **Esc** closes and gives the
keyboard back to the note. Maths on its own line goes in as a cell of its own (a blank line above and below it), the
caret on the bar under it; at the very end of the note that bar is armed, so the next character is a new cell. This holds however the palette was opened (the key, a click on ƒ(x), the Insert menu)
and after a click on a bare part of it (its heading hands the keyboard to the picked shape); only a click away
from the palette puts it away. The Mac popover has none of these (it is mouse-first); the pane itself is the Mac's.

**Typeset maths in the note (the mouse; `pressOnMaths` in `packages/editor/src/math.ts`):** a click puts the caret in the
equation's source (the nearer end); a drag that starts on an equation selects from its near edge, so a drag across it
selects it and it stays typeset; **Shift+click** extends the selection from where it was to the near edge of the
equation (a selection that covers all of it leaves it typeset); a **right-click** selects the equation as a whole
(unless a selection already covers it) and opens the page's menu with Cut and Copy live, so it never turns into its
source under the menu; Ctrl/Cmd-click is the drawing layer's, as on words.

## The tablet sheet and the pen

- **Ctrl+Z / Ctrl+Y (Ctrl+Shift+Z)** while the pen or mouse is over the
  tablet sheet (or it has focus) act on the *sheet's strokes*, not the note;
  with nothing to take back there, the key falls through to the note's undo.
  (`tabletFocus.ts`, asked first by `useUndo`.) On a sheet BOUND to a drawing
  cell (right-click the cell ▸ Open in Tablet Sheet) there is nothing of the
  sheet's own to take back: Ctrl+Z, the header's Undo and the pen's double tap
  are the note's Undo, and the sheet follows the cell.
- **Pen side buttons** (Pen chip ▸ *Buttons*, see below): on the sheet the
  first (upper, Middle Click) one held while the pen touches rubs out strokes,
  the second (lower, Right Click) one held drags the dashed box; a double tap
  in the air is Undo (first) / Redo (second) of the
  *sheet's* strokes (with nothing there, the note's). The eraser end always
  erases.
- **⌫ Erase** (toolbar pen group): touch a stroke on the note's page to rub
  it out; picking the ✎ pen, Ctrl+P or a shape tool turns it off.
- **Erase / Select on the sheet**: the SHEET's own pair (one for every sheet
  tab, not remembered). Select is a toggle in the sheet's header; Erase has no
  header button (Sean, 2026-10-05): hold the pen's first button to rub out,
  use the box row's Erase, or the Erase Tool toggle below. Nothing done in the
  notebook turns them off, and they never light the toolbar's ⌫ / ⬚. Select
  makes the pen pull the dashed box, as the mouse does.
- **The box's row** (under the dashed box; the pen's tap clicks it): **Erase** | **Bring in Writing** | **Bring in as Drawing Cell** |
  **Copy Cell** ("Copy" when the row is wider than the sheet). Copy Cell puts the boxed writing on the system clipboard as a drawing
  cell and leaves the note alone: Ctrl+V in a note lands it as a new drawing cell at the caret (or the armed bar), in Mathematica it
  pastes as the image, in every other app as an SVG file.
- **Erase Tool / Select Tool** by the pen (a double tap set to "Erase tool
  on/off" / "Select tool on/off", or the ExpressKey Ctrl+Alt+2 / Ctrl+Alt+3, or
  the Pen menu) toggle the tools of the surface the pen is over, or was last
  over: the sheet's on the sheet's side of the pane, the toolbar's elsewhere.

## No full screen (Sean's rule)

There is no full-screen mode of any kind. The old **Pad mode** (Ctrl+Alt+T, Input Devices ▸ Tablet Pad
(Full Screen), the **Pad** button, the pen's "Tablet pad" ExpressKey suggestion) was removed on 2026-10-03,
and so was View ▸ Toggle Full Screen. F11 / Win+Shift+Enter / a title-bar full-screen button do nothing: the
window is created with `fullscreenable: false`. Ctrl+Alt+T is unassigned. If your Wacom ExpressKey still
types it, nothing happens; remap it to Send Writing (Ctrl+Alt+W).

## The pen on the Tablet sheet (the whole tablet is the sheet, notes still visible)

- Automatic whenever the **Tablet** source is showing and WriteMind is the window in front: Wintab (the driver's own interface) feeds the
  sheet, or, if Wintab is not delivering, the window's own pen events. No overlay, no hook, no mouse clip; the mouse keeps working.
- **Esc** never lets go of the tablet: on the sheet it only clears the dashed box (or closes a menu). Putting another window in front,
  minimising, switching to a camera, hiding the pane or quitting lets go.
- **Tablet orientation** dropdown (sheet pane header, Pen popover): Match tablet / Landscape
  (0°) / Portrait (90° clockwise) / Landscape flipped (180°) / Portrait flipped (270°), remembered.

## Pen buttons and ExpressKeys (port-only)

The Mac has a mouse and modifier keys; a pen tablet has buttons on the pen
and keys on the tablet. Both are given the Mac's idioms.

**The pen's buttons** (Pen chip ▸ *Buttons*, two columns, remembered).
Chromium delivers a 2-button Wacom pen as: tip = button 0 / `buttons` bit 1;
lower side button = button 2 / bit 2 (right click); upper side button =
button 1 / bit 4 (middle click; some drivers send both as the lower one, and
then they cannot be told apart); eraser end = button 5 / bit 32. A button
pressed while hovering is a `pointerdown` (or, on Windows Ink, possibly only
the driver's right / middle mouse click at the pen, which is read as the
button); the pen then touching is a `pointermove` that gains the tip; held
at contact it is button 0 with the bit set, or (Windows Ink) the button
itself with pressure. All are read (`penButtons.ts`, tested).

Each side button has two jobs (Sean, 2026-10-05):

| Button | Hold (held while the pen touches) | Double-tap (twice in the air) |
|---|---|---|
| First button (upper, Middle Click) | Erase strokes (whole strokes it touches) | Undo |
| Second button (lower, Right Click) | Select: the marquee; a drag inside the selection moves it | Redo |
| Eraser end | Erase strokes | — |
| Tip + Alt | Nothing | — |

Undo / Redo are the note's ONE timeline (words and drawing, the same as
Ctrl+Z / Ctrl+Y); over the tablet sheet, its own strokes first. A double tap
is two press-and-release of the same button without the tip touching, the
second press within 400 ms of the first release, each press under 500 ms. A
single tap does nothing; a button held in the air does nothing; lifting the
pen ends the hold. No context menu opens over the page or the sheet while a
pen button is in use.

Hold choices: Erase strokes, Select, Add to selection (⇧), Pan the page,
Nothing (the pen then simply writes). Double-tap choices: Undo, Redo, Erase
tool on/off, Select tool on/off, Next colour, Wider pen, Thinner pen, Pen
always draws on/off, Delete selection, Clear selection, Right-click, Nothing.
A stored 0.4.0 setting is migrated: the old defaults (lower Select, upper
Pan) become the new ones; a deliberate hold choice stays the hold, a one-shot
choice becomes that button's double tap. The pen cursor shows the held
button's hold: dashed square (select, + for add), red cross (erase), hand
(pan); the Pen chip names it too.

Doing everything with the pen alone: the toolbar's **⬚ Select tool** (or
a button's "Select tool on/off" double tap / its ExpressKey) turns a plain tip into the cursor:
drag an object to move it, drag on nothing to pull a marquee; the handles
turn, scale, delete (✕) and group; **Delete selection** / **Clear selection**
are assignable to a button or ExpressKey (the Mac's ⌫ and Esc).

**ExpressKeys** cannot be read by the app: the Wacom driver turns each into
a keystroke. Every pen tool is a real command (Pen menu, `shared/commands.ts`,
owner `page`, heard in `useChrome` in the window bubble phase, so focus in
the editor, on the canvas or on a toolbar list all work; a held key's
auto-repeat is ignored: one press = one action). On a layout where Ctrl+Alt
is AltGr the chord still means its physical key.

| Command | Windows / Linux |
|---|---|
| Pen Down / Up | Ctrl+Alt+1 |
| Erase Tool | Ctrl+Alt+2 |
| Select Tool | Ctrl+Alt+3 |
| Next / Previous Colour | Ctrl+Alt+4 / Ctrl+Alt+5 |
| Wider / Thinner Line | Ctrl+Alt+6 / Ctrl+Alt+7 |
| Pen Always Draws | Ctrl+Alt+8 |
| Delete Selection | Ctrl+Alt+9 |
| Clear Selection | Ctrl+Alt+0 |
| Send Writing / Send Page | Ctrl+Alt+W / Ctrl+Alt+Shift+W |
| Clear Sheet | Ctrl+Alt+X |
| Next / Previous Sheet (the sheet's tabs; onto a drawing tab, its note comes to the front) | Ctrl+Alt+PageDown / Ctrl+Alt+PageUp |
| Undo / Redo | Ctrl+Z / Ctrl+Y |

Suggested layouts (also in the popover, with copy buttons): 4 keys — Undo,
Erase tool, Next colour, Send writing; 6 keys — Undo, Redo, Erase, Next colour,
Select, Send writing; 8 keys — Undo, Redo, Erase, Select, Next colour, Wider, Delete
selection, Send writing. An ExpressKey set to a *modifier* (Ctrl, Shift, Alt) works
too: Ctrl = the marquee, Shift = extend, Alt = the Tip + Alt slot.

## The drawing layer's own keys (heard by `Canvas.tsx`, not in the menu)

They act only while something on the layer is picked up (the same rule as
Backspace), in the capture phase, so the notebook's caret does not also move.
A press on the words lets go of the pick, which gives the keys back.

| Key | Does |
|---|---|
| Arrow keys / Shift+Arrow | nudge the picked objects 1 / 10 points (a burst is one undo) |
| Ctrl+C / Ctrl+X / Ctrl+V | copy / cut / paste the picked objects (a paste lands 16 points down and right; from another note it is brought into view) |
| Ctrl+G | group / ungroup (the Mac's ⌃G) |
| Backspace / Delete | delete the picked objects |
| Esc | closes the style bar (and puts an armed tool away), then lets go of the pick |
| Alt+drag from a node | draws an attached arrow (the Mac's ⌥-drag) |
| Shift while turning | 15 degree steps |
| Ctrl+drag | the marquee (the Mac's ⌘-drag) |

## The divider, the menus and the tabs (chrome)

| Where | Key | Does |
|---|---|---|
| Divider between the notes and the video (when it has the keyboard: Tab to it) | Left / Right | the video 24 px wider / narrower |
| same | Home, or double-click | back to the Mac default share (720 : 420) |
| A sidebar or tab menu, the video button's menu, the open-notes list, the Folder menu | Up / Down, Enter, Escape, Right / Left | move, choose, close, open / close a submenu; the caret returns to the notes |
| The font-and-colour popover, the Pen popover (the Pen chip), the sheet's Paper menu | Escape, or a click anywhere else | close |
| Ctrl+K / Ctrl+Shift+Y | | Hide or Show the sidebar / the video (the notes pane: View menu, no key; never both panes) |
| A tab | middle click | closes it |
| A tab | right-click | Close, Close Other Tabs, Rename…, Duplicate, Move to ▸, Reveal, Move to Trash… |
| The video button | click | shows or hides the video pane; its corner, a right-click, a half-second hold or Down opens the menu (sources, Turn left / right, Refresh devices, Video Only) |
| The rendered button | click | the same as the rendered-page key (lit while rendered) |
| The tab row | wheel | walks along the tabs |

## The camera pane (c2-camera-parity)

| Where | Key | Does |
|---|---|---|
| The viewfinder | drag | a dashed box over the part to bring in (with a pen too) |
| same | click | one click puts the box away; with no box, it draws a box round the whole picture (the gesture the double-click used to be) |
| same | double-click | the picture fills the WINDOW (sidebar and notes out of sight; never the display, never full screen); double-click again, or the faint ✕ over its top-left corner, to come back. Hiding the video leaves it too. Not remembered across a launch (Mac commit 0edfc08) |
| same | Esc | puts the box away, and lets go of Resize by Square when it is armed |
| same, the picture held (Hold image) | Esc | with the pane focused (its picture or one of its buttons was clicked last), back to the live picture; a box or an armed Resize by Square goes first, one per press. Esc in the notes leaves it held |
| The tab row | click / double-click | a tab opens a kept page (or the live Camera); double-click renames it (Enter keeps, Esc leaves it) |
| same | + | keeps what the camera shows (the held picture with Hold image) as a new page, and opens it |
| same | x | closes a page; the first press asks ("Close?"), the second closes it and its picture |
| Input Devices | Ctrl+Alt+R | Refresh Device List (the other camera commands are menu items) |
| Input Devices ▸ Aspect Ratio | menu, no key | the viewfinder's shape: Free, 1:1, 4:3, 3:4, 3:2, 2:3, 16:9, 9:16 (ticked; remembered) (Mac commit c98c067) |
