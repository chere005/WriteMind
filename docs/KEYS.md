# Keys, and where each one is heard

The menu bar, the toolbar tooltips and the key handler all read ONE table:
`apps/desktop/src/shared/commands.ts`. A key shown is a key that works.

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
| `page` | `useChrome` in the page | File, View, Insert, Undo/Redo Drawing, Expand Selection, Input Devices (incl. Tablet Pad) |
| `main` | `useChrome`, which hands it to the main process (dialogs, the project file) | Project menu |

A **menu click** sends `menu:command` to the page (or runs in the main process
for `main` items), and runs the same function the key does:
`editorCommands.ts` for the formatting commands, the same core functions the
keymap calls.

Do not use `role: "windowMenu"` or `role: "viewMenu"`: their Minimize
(Ctrl+M), Close (Ctrl+W) and Developer Tools (Ctrl+Shift+I) are *registered*
accelerators and collide with Merge Cells, Close Tab and Insert Image. The test
`menu.test.ts` fails if a role other than a known-safe one appears.

## The mapping

| Command | Mac | Windows / Linux |
|---|---|---|
| New Note | ⌘N | Ctrl+N |
| Close Tab | ⌘W | Ctrl+W |
| Open Notes Folder | ⇧⌘O | Ctrl+Shift+O |
| Add Folder to Project… | ⇧⌘A | Ctrl+Shift+A |
| Save Project | ⌃⌘S (also the sidebar's!) | Ctrl+Shift+S |
| Undo / Redo | ⌘Z / ⇧⌘Z | Ctrl+Z / Ctrl+Y (Ctrl+Shift+Z too) |
| Undo / Redo Drawing | ⌥⌘Z / ⇧⌥⌘Z | Ctrl+Alt+Z / Ctrl+Alt+Shift+Z |
| Expand Selection | ⌘. | Ctrl+. |
| Select Next Occurrence | ⌘D | Alt+D |
| Select All Occurrences | ⌃⌘G | Alt+Shift+D |
| Hide/Show Notes Sidebar | ⌃⌘S | Ctrl+Alt+S |
| Markdown Preview / Editor | ⇧⌘P | Ctrl+Shift+P |
| Hide/Show Video | ⌃⌘C | Ctrl+Alt+C |
| Hide/Show Notes Pane | ⌃⌘E | Ctrl+Alt+E |
| Markdown Markers | ⌥⌘M | Ctrl+Alt+M |
| Fold / Unfold Section | ⌥⌘← / ⌥⌘→ | Ctrl+Alt+Left / Right |
| Fold / Unfold All Sections | ⇧⌥⌘← / ⇧⌥⌘→ | Ctrl+Alt+Shift+Left / Right |
| Title … Body (heading ladder) | ⌘1 … ⌘7 | Ctrl+1 … Ctrl+7 |
| Bold / Italic / Underline | ⌘B / ⌘I / ⌘U | Ctrl+B / Ctrl+I / Ctrl+U |
| Strikethrough | ⇧⌘X | Ctrl+Shift+X |
| List | ⇧⌘L | Ctrl+Shift+L |
| Quote | ⌃⌘Q | Ctrl+Q |
| Decrease / Increase Indentation | ⌘[ / ⌘] | Ctrl+[ / Ctrl+] |
| Split / Merge Cell | ⌃D / ⌃M | Ctrl+D / Ctrl+M |
| Duplicate Cell | ⌃⇧D | Ctrl+Shift+D |
| Delete Cell | ⌃⌫ | Ctrl+Backspace |
| Move Cell Up / Down | ⌃⇧↑ / ⌃⇧↓ | Ctrl+Shift+Up / Down |
| Move Section Up / Down | ⌃⌘↑ / ⌃⌘↓ | Ctrl+Up / Ctrl+Down |
| Insert Image… | ⇧⌘I | Ctrl+Shift+I |
| Code Block | ⌘8 | Ctrl+8 |
| Refresh Device List | ⌥⌘R | Ctrl+Alt+R |
| Tablet Pad (Full Screen) — enter / exit | ⌃⌘T | Ctrl+Alt+T |

Notes, so nobody "fixes" them:

- **Save Project** is ⌃⌘S on the Mac, the very chord the sidebar has. Both
  cannot be Ctrl+Alt+S here; the sidebar keeps it (it is on the toolbar's first
  button) and the project takes the Save-As chord.
- **Delete / Duplicate / Move Cell keys act on the cells whose brackets are
  held**, and decline otherwise (Ctrl+Backspace is also "delete word"). The
  *menu* items act on the held cells, or on the cell the caret is in when none
  is held — the Mac's `selectedCells`.
- **Ctrl+Alt+letter is AltGr** on layouts that have one; Windows then sends
  Ctrl+Alt with a typed character. The chord still arrives as Ctrl+Alt, but if
  a layout makes a letter unusable, change it in `shared/commands.ts` and the
  menu, tooltips and handler follow.
- **Ctrl+Alt+Arrows** are the screen-rotation hot keys of some Intel graphics
  drivers; where those are on, fold from the menu.
- **Markdown Markers** and **Markdown Preview** are one switch here: the port
  has one dress for "no markers" (the rendered page), where the Mac has a
  second, block-by-block preview as well.

## The tablet sheet and the pen

- **Ctrl+Z / Ctrl+Y (Ctrl+Shift+Z)** while the pen or mouse is over the
  tablet sheet (or it has focus) act on the *sheet's strokes*, not the note;
  with nothing to take back there, the key falls through to the note's undo.
  (`tabletFocus.ts`, asked first by `useUndo`.)
- **Pen side button**: selects like ⌘ (default) or erases — Pen chip ▸ *Pen
  side button*. On the sheet, a selecting side button (or Ctrl) drags the
  dashed box. The pen's eraser end always erases.
- **⌫ Erase** (toolbar pen group, and on the sheet): touch a stroke to rub it
  out; picking the ✎ pen or a shape tool turns it off.

## Pad mode (the whole tablet is the sheet)

- **Ctrl+Alt+T** (also Input Devices ▸ Tablet Pad (Full Screen), and the **Pad** button on the
  sheet pane) enters; the same key, the menu item (now "Exit Tablet Pad"), the strip's
  **Exit Pad** or **Esc** leaves. Losing full screen any other way leaves too.
- **Ctrl+Z / Ctrl+Y** in the pad are always the sheet's (nothing falls through to the note).
- The strip comes down when the pen hovers at the top edge for about 0.4 s; it never shows
  while a stroke is being written.
- Ctrl+Alt+T is Ctrl+Alt+letter: AltGr on layouts that have one (see the note above).

## Pen buttons and ExpressKeys (port-only)

The Mac has a mouse and modifier keys; a pen tablet has buttons on the pen
and keys on the tablet. Both are given the Mac's idioms.

**The pen's buttons** (Pen chip ▸ *What the pen's buttons do*, remembered).
Chromium delivers a 2-button Wacom pen as: tip = button 0 / `buttons` bit 1;
lower side button = button 2 / bit 2 (right click); upper side button =
button 1 / bit 4 (middle click; some drivers send both as the lower one, and
then they cannot be told apart); eraser end = button 5 / bit 32. A button
pressed while hovering is a `pointerdown`; with the tip already down it is
only a `pointermove` that gained a bit; held at contact it is button 0 with
the bit set. All three are read (`penButtons.ts`, tested).

| Slot | Default | Mac equivalent |
|---|---|---|
| Lower side button | Select (hold) | ⌘-drag marquee |
| Upper side button | Pan (hold) | a finger turning the page |
| Eraser end | Erase (hold) | — |
| Tip + Alt | None | — |

Choices: *hold* actions work while the button is down during a gesture —
Select (⌘), Add to selection (⇧), Erase, Pan; *tap* actions fire once when
the button is pressed and let go WITHOUT the tip touching — Undo, Redo, Erase
tool on/off, Select tool on/off, Next colour, Wider, Thinner, Pen-always-draws
on/off, Delete selection, Clear selection, Right-click; None. A button with
no action does nothing (a tip pressed under it still writes). The pen cursor
shows the held action: dashed square (select, + for add), red cross (erase),
hand (pan); the Pen chip names it too. The popover's **Test buttons** lamps
show what the system reports (tip, lower, upper, eraser, a pressure bar).

Doing everything with the pen alone: the toolbar's **⬚ Select tool** (or
the Select tap action / its ExpressKey) turns a plain tip into the cursor:
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
| Tablet Pad | Ctrl+Alt+T (Pad mode's own) |
| Undo / Redo | Ctrl+Z / Ctrl+Y |

Suggested layouts (also in the popover, with copy buttons): 4 keys — Undo,
Erase tool, Next colour, Pad; 6 keys — Undo, Redo, Erase, Next colour,
Select, Pad; 8 keys — Undo, Redo, Erase, Select, Next colour, Wider, Delete
selection, Pad. An ExpressKey set to a *modifier* (Ctrl, Shift, Alt) works
too: Ctrl = the marquee, Shift = extend, Alt = the Tip + Alt slot.
