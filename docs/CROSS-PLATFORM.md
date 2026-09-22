# For the cross-platform app

A running log of what is built HERE, in the macOS app, that the cross-platform
port (`~/GIT/WriteMindCross`) has still to implement. Sean, 2026-09-21: "keep
a log of things we're working on for the cross platform app to eventually
implement."

**How to keep it.** One entry per change that a user would notice, added in
the same commit as the change, newest at the top. Say what the behaviour IS,
not how this app does it — the port shares no code with this one and an entry
that names a Swift type is an entry it cannot use. Name the rule and the
gesture; the reason belongs here too, because a port that does not know why
will re-argue it. An entry moves to **Done there** when the port has it, and
nothing is deleted: this file is the ledger of the two apps agreeing.

## Open

### Double-click the viewfinder to make the window the viewfinder
And double-click again, or press a faint × drawn over its top-left corner,
to come back. Two ways out, because a window that is nothing but a picture
has to say how to leave it, and one of them has to be visible. Do NOT
remember the state across a launch: coming up as nothing but a viewfinder
is a window whose documents have vanished, and an answer drawn on the
picture is not good enough for the first second of a launch. Filling the
window also has to turn the pane back on if it had been put away, or it is
a black rectangle with no way out. Watch what the double-click displaces:
here it took "box the whole picture", which moved onto the single click
that until then did nothing when there was no box. (Sean, 2026-09-21.)

### The README's key table is generated-checked, not hand-kept
List every shortcut in the README, and have a test read that table back and
hold it against the binding table: every chord bound must appear, and the
table must name no chord nothing binds. A shortcut that moves then fails the
build until the document says so too. Cheap, and the alternative is a page
that is wrong within a month. (Sean, 2026-09-21: "document the keystrokes in
the readme.")

### A checklist is edited one item at a time, boxes intact
Clicking a reminder opens THAT reminder's words — not the whole list as one
text field. The boxes stay live controls the whole time, including while the
line beside one is being typed in. Four things make it work:
- **Draw the editor OVER the label, do not swap it for one.** The rendered
  text keeps the row's height and baseline, so opening an item moves neither
  the box beside it nor anything below it. A swap grows the line by a few
  points and every later row, rule and floating object slides.
- **One cursor, not two flags.** A single `none | cell | item` value with the
  old "which cell is open" as a computed window onto it: every existing place
  that closed a cell now closes an open item too, with no change at all.
- **Key the open item by the RANGE OF ITS WORDS, not by an index.** An index
  goes stale the moment a line is added above it, and the view is rebuilt
  from the document on every keystroke.
- **One walk over the lines.** The tick and the editor must agree about which
  reminder is the third one; counting a line's indent in characters in one
  place and in UTF-16 units in another is how they stop agreeing.
Also: a tick must replace exactly one character with one, or ticking a box
moves the caret of the item being typed in; restore the caret after a tick
anyway, because pressing the box takes the keyboard. Return splits the item
and starts the next unticked; backspace in an empty item removes it; backspace
at the start of a full one joins it to the item above; a paste with newlines
in it is flattened, or the block re-parses under the caret. (Sean, 2026-09-21.)

### One list of every key, and a test that they differ
Bind every shortcut through a single enumerated table and walk all of its
cases in a test that fails on a duplicate. Here ⌃⌘S was on two commands at
once — "Hide Notes Sidebar" and "Save Project" — and a key equivalent claimed
twice goes to whichever menu comes first in the bar, so one of the two simply
could not be pressed and nothing said so. The rule that keeps the table
honest is that binding a key any other way is itself a test failure. The keys
themselves: ⌘S save, ⌘P draw, ⌘E export, ⌘T source/rendered, ⌘Y the second
pane. (Sean, 2026-09-21: "cmd s for save, cmd p for toggling draw mode, cmd e
for export, cmd r for toggling markdown, cmd t for toggling the video pane..
unless there's conflicts with those?")

### The rendered pane says "you can type here"
Hovering the words of a rendered block gives a text I-beam; hovering the space
between two cells gives the same I-beam ON ITS SIDE, with a faint line drawn;
clicking there makes the line solid — that is the cursor now — with the
"new cell" affordance at its left end. A rendered block is usually a label
with no cursor of its own, so without this the pointer over a whole editable
page is an arrow, which says the opposite of the truth. One reader for "where
is the pointer" covering BOTH the cells and the seams: the place the pointer
arrives at is often told before the place it left, so leaving a cell took back
the cursor the seam had just set. Set the cursor on every move rather than
pushing it, and hand it back on the way out, and set nothing at all while a
drawing tool owns the pane. (Sean, 2026-09-21.)

### Two keys held while a mark or an arrow is placed
- **⌘ keeps the tool.** Placing a mark hands the tool back and sends the
  pointer to the palette for the next one; holding ⌘ as it goes down leaves
  it armed, so a row of ticks is one trip. Read the modifier when the thing
  goes DOWN, not when it was picked, so the choice is made per mark. Escape
  is the way out. Hide the selection handles while a tool is armed — they are
  views over the canvas and the one round the mark just placed swallows the
  click that would have placed the next.
- **⇧ holds a line to an axis.** Only for what HAS a direction (lines and
  arrows; a mark is square already, and a node is dragged to whatever box it
  is wanted in). Keep the distance along the axis and throw the other
  component away, rather than keeping the length and rounding the angle: the
  end has to stay under the pointer along the direction that is left. The
  ghost shown during the drag must be the line that will really be put down.
- **Nothing put down leaves the tool armed** either way: a press that never
  moved is no line at all, and disarming there sends the pointer back to the
  palette for a gesture that produced nothing.
(Sean, 2026-09-21.)

### A command at the insertion bar makes the cell there
While the horizontal insertion bar between two cells is the cursor, pressing
anything on the toolbar or in the Format menu must CREATE a cell at the bar,
ready for that input — not quietly record a preference and wait for a
keystroke, and never act on whatever cell the caret happens to be parked
against (that is the cell BELOW the bar, or the document's first cell when
there is no text view at all). Three sorts of command, and they differ:
- one that names a KIND of cell (a heading, a list, a quote, a fenced block)
  opens the cell with that marker in it and the caret where the words go, and
  is then finished;
- one that writes something else (bold, a text style, maths) opens a PLAIN
  cell and runs in it;
- one that acts ON a cell (delete, duplicate, move, split, merge) still does
  nothing: an empty cell made to be deleted is churn in the document and a
  step on the undo stack for a gesture that did nothing.
A "+" affordance on the bar itself is the exception and may go on meaning
"the next thing typed here becomes this" — a menu choice is not a button
press. (Sean, 2026-09-21.)

### A list edits its words and nothing else
In the WYSIWYG pane, opening a bullet list or a list of reminders shows the
BULLETS AND THE BOXES, not `- ` and `[ ]`. Three different answers, and they
are not the same:
- the caret may not enter the head of the line — the indent, the marker, the
  box. Hidden characters the caret can still be put among are worse than
  visible ones. A click on the left edge, Home and ⌘← all land on the first
  character that can be seen, and past ALL of the furniture, not past the
  first piece of it;
- a bullet's `- ` is DRAWN (as a round bullet) and reserved; hiding it would
  leave a list with no marker, which is not a list;
- a reminder's `- [x] ` is one piece: the marker and the brackets are drawn
  as nothing and the `[` is drawn as a box, ticked or not — so the cell being
  edited reads exactly like the cell that was clicked.
Backspace does the ordinary thing first (a level of indent, then the bullet)
and only then takes a whole piece of furniture. Watch the font: a glyph a
font does not have is drawn as NOTHING, so check before substituting and
leave the characters showing if it is missing. (Sean, 2026-09-21: "only edit
the text in a reminders list or bullet list and have normal bullet editing
behavior.")

### A heading shows no hashes on the rendered page
In the WYSIWYG pane, clicking a heading to edit its words must NOT reveal its
`## `. The source pane is right to show the markers on the caret's own line —
there they ARE the text being typed — but the rendered page is not the source,
and the marker appearing shoves the words sideways as you click them. Call
such a marker FURNITURE: hidden whatever the caret does, and somewhere the
caret cannot go (a click on the left edge, Home and ⌘← all land on the first
character that can be seen). A backspace standing just behind furniture takes
the WHOLE piece, so the cell stops being a heading — otherwise the key eats
one space, the line silently stops being a heading, and nothing on screen says
so. The heading is changed with the ladder instead. (Sean, 2026-09-21: "when
in wysiwyg mode, don't show the markdown characters for header.")

### The session is not the only way into the user's notes
A run of the app that has been pointed at a scratch notes folder — a smoke
check, a test host — must have its SESSION redirected too. A session names its
folders and its open notes by absolute path and restores unsaved buffers by
writing them over whatever is on disk, so restoring one puts a "safe" run back
in the real notes folder. Two redirections, not one. (2026-09-21, after a
scratch run was watched opening the real notes.)

### The two icons on an add row are one height
Where a row offers "new note" and "new section" side by side, the two icons
are drawn to ONE height constant and measured, not eyeballed. A platform icon
whose art includes a badge is as tall as art-plus-badge, so the shape inside
it comes out short — here `folder.badge.plus` drew an 11.9 pt folder beside a
13 pt page. Use the plain folder and put the + inside it. (2026-09-21.)

## Done there

Nothing yet.
