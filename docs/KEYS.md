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
| `page` | `useChrome` in the page | File, View, Insert, Undo/Redo Drawing, Expand Selection, Input Devices |
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
| Undo / Redo | ⌘Z / ⇧⌘Z | Ctrl+Z / Ctrl+Y (Ctrl+Shift+Z too): ONE timeline per note, the words and the drawing together — Undo takes back exactly the most recent edit, whichever it was; Redo brings back the one undone last. Both keys are always swallowed outside a text field (the browser's own undo of the page must never run behind CodeMirror) |
| Undo / Redo Drawing | ⌥⌘Z / ⇧⌥⌘Z | Ctrl+Alt+Z / Ctrl+Alt+Shift+Z: the drawing's own pair, whatever was edited last |
| Expand Selection | ⌘. | Ctrl+. |
| Select Next Occurrence | ⌘D | Alt+D |
| Select All Occurrences | ⌃⌘G | Alt+Shift+D |
| Hide/Show Notes Sidebar | ⌃⌘S | Ctrl+Alt+S |
| Markdown Preview / Editor | ⇧⌘P | Ctrl+Shift+P |
| Hide/Show Video | ⌃⌘C | Ctrl+Alt+C |
| Hide/Show Notes Pane | ⌃⌘E | Ctrl+Alt+E |
| Hide / Show Markdown Markers (View) | ⌥⌘M | Ctrl+Alt+M: the Mac's chord, kept. Independent of the preview |
| Find… / Find and Replace… | ⌘F / ⌥⌘F | Ctrl+F / Ctrl+H (the Mac's chord is also bound) |
| Find Next / Previous | ⌘G / ⇧⌘G | F3 / Shift+F3 (Ctrl+G is Group on the drawing layer); Enter / Shift+Enter in the bar |
| Use Selection for Find | ⌘E | Ctrl+E |
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
| Maths… (port-only key; the Mac opens it from the bar) | — | Ctrl+Shift+M |
| Refresh Device List | ⌥⌘R | Ctrl+Alt+R |

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
- **Markdown Markers** (Ctrl+Alt+M) and **Markdown Preview** (Ctrl+Shift+P) are two independent switches, as on the Mac
  (`showMarkers` and `mode`): the markers are about the markdown side (hidden, the `**`, the `#`, a link's URL are put
  away on every line but the caret's and the file is untouched; the choice is remembered); the preview draws every block but
  the one being written in. Both labels flip (Hide / Show Markdown Markers; Show Markdown Preview / Editor).
- **Format ▸ List and Ctrl+Shift+L** both write the style the list button's chevron picked (dots `- `, dashes `* `,
  numbers `1. `, to-dos `- [ ] `), and the choice is remembered.

## The rendered page (Write in the preview)

Ctrl+Shift+P (or the sidebar's document button). Everything in the table above works on the block that is
open; these are the keys that only mean something here (`packages/editor/src/preview/keys.ts`), and every
one of them declines on the markdown side:

| Key | Does |
|---|---|
| click a drawn block | opens it in place, the caret where the word was clicked; a click on a to-do's box ticks it (one character written, nothing opens); a click on a drawn link goes to it |
| Return | starts the next block (what is behind the caret stays, what is in front becomes the next block); in a list, a to-do list, a numbered list or a quote it carries the list on, and on an empty item it ends the list; in code it is a newline. Over held cells it does nothing |
| Backspace | in a block with nothing in it, takes the block away (and the blank lines holding it apart) and lands at the end of the block before; at a bar it takes the bar back and writes nothing |
| Up / Down | inside a block, its lines; off its top or bottom, onto the bar beside it (the caret hides, the bar is the cursor); again, into the next block at its start (up: the block above, at its end). Off the first/last block they arm the bar above/under the note |
| Shift+Up / Shift+Down | off the edge of a block, extend the selection a whole block at a time |
| Page Up / Page Down (+ Shift) | the window moves a page and the caret goes to the block at the same height |
| Escape | at a bar, takes it back (the caret returns to the block above); over held cells, lets go of them |
| a character at a bar | opens a block there with that character in it; Return opens an empty one; the + on the bar chooses the kind first |
| a character over held cells | replaces them |
| Alt-click on the words of a link | follows it from inside an open block (a plain click puts the caret in it) |

## The maths palette (Insert ▸ Maths…, the ƒ(x) button)

Ctrl+Shift+M opens it (again, from inside it, puts it away) with the picked shape focused, even with the Maths
section of the bar put away. Inside: **arrows** pick a shape (Left/Right one, Up/Down a row, PageUp/PageDown a
group, Home/End the ends) and the form follows; **Tab / Shift+Tab** walk Slots, Wolfram Language line, the
"On its own line" tick, Insert, and wrap; **Enter** inserts (as the tick says; not while an input method is
composing), **Ctrl+Enter** inserts the other way, **Space** on the tick toggles it, **Esc** closes and gives the
keyboard back to the note. This holds however the palette was opened (the key, a click on ƒ(x), the Insert menu)
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
  (`tabletFocus.ts`, asked first by `useUndo`.)
- **Pen side button**: selects like ⌘ (default) or erases — Pen chip ▸ *Pen
  side button*. On the sheet, a selecting side button (or Ctrl) drags the
  dashed box. The pen's eraser end always erases.
- **⌫ Erase** (toolbar pen group, and on the sheet): touch a stroke to rub it
  out; picking the ✎ pen or a shape tool turns it off.

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
| A sidebar or tab menu, the Folder menu | Up / Down, Enter, Escape, Right / Left | move, choose, close, open / close a submenu; the caret returns to the notes |
| The font-and-colour and pen popovers | Escape, or a click anywhere else | close |
| Ctrl+Alt+S / Ctrl+Alt+C / Ctrl+Alt+E | | Hide or Show the sidebar / the video / the notes pane (never both panes) |
| A tab | middle click | closes it |
| The tab row | wheel | walks along the tabs |

## The camera pane (c2-camera-parity)

| Where | Key | Does |
|---|---|---|
| The viewfinder | drag | a dashed box over the part to bring in (with a pen too) |
| same | click, double-click | one click puts the box away; two draw a box round the whole picture |
| same | Esc | puts the box away, and lets go of Resize by Square when it is armed |
| Input Devices | Ctrl+Alt+R | Refresh Device List (the other camera commands are menu items) |
