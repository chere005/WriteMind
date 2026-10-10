# PLAN: three steps back, whatever they were (2026-10-10)

Sean, 2026-10-10: "make sure undo is always able to undo up to 3 steps, even if it involves file changes, which may
mean keeping file backups until undo goes out of scope." This is the design of that, written before the code
(P8 of `docs/PLAN-bars-2026-10.md`) from reading `main/notes.ts`, `main/housekeeping.ts`, `main/wmStore.ts`, the
`note:` / `section:` IPC in `main/main.ts`, and on the page `useUndo.ts`, `editTimeline.ts`, `noteHistory.ts`,
`diskReload.ts`, `hotExit.ts`, `useSession.ts`, `App.tsx` and the sidebar and tab call sites.

## What exists today, and what is missing

* **Words and drawing share one timeline per note** (`editTimeline.ts`): CodeMirror's history for the words, a
  snapshot stack (`DrawingHistory`) for the drawing, every edit stamped on the note's `EditClock`, so Ctrl+Z takes back
  exactly the newest edit of either. That part is right and stays.
* **File operations have no undo at all**: new note, duplicate, rename, move, trash, the section versions of those,
  Clean Up's trash, importing a markdown file. Every one is a single IPC call (`note:create`, `note:rename`,
  `note:place`, `note:trash`, `section:*`, `housekeeping:trash`) made from a handler in `App.tsx`, whichever surface
  (sidebar rows, edit mode, the tab menu, a drag) started it. So the main process is the one place that sees all of
  them, and that is where the journal goes.
* **The note's text history is dropped in places**: `renameNote` in `noteHistory.ts` throws the editor state away
  (so a rename or a move kills the Ctrl+Z of the words), a closed or trashed note is forgotten, and a rename leaves the
  new editor built from the last text that arrived from OUTSIDE the editor, not from the text in hand.

## What a step is

A **step** is one thing the person did, taken back by one Ctrl/⌘+Z. There are two kinds, and one rule picks between
them:

| | text step | file step |
|---|---|---|
| what | an edit of the open note's words or drawing, as CodeMirror groups typing and `DrawingHistory` groups bursts | one file operation: New Note, Duplicate, Rename, Move, Reorder, Move to Trash, New Section, Rename / Move / Trash Section, Clean Up, Import |
| kept by | the page, per note (`noteHistory.ts`) | the main process, one journal for the window (`main/undoJournal.ts`) |
| depth | at least 200 (CodeMirror `minDepth: 200`; the drawing keeps 200) | **the last three** (`UNDO_DEPTH = 3`) |
| backed up | nothing to back up: the editor holds the old words | what the operation destroys or overwrites, as a copy under the app's data folder |

**Ctrl/⌘+Z takes back the newest step of either kind. Ctrl+Shift+Z / Ctrl+Y (⇧⌘Z) brings back the one undone last. A new
step of either kind ends the redo path of both.**

The rule that picks "newest" is the wall clock (`performance.timeOrigin + performance.now()`, the same instant
source in both processes). A text step is as old as its newest keystroke (the stamp that CodeMirror's grouping refreshes),
a file step is as old as the moment its operation finished. The clocks are the same machine's; an IPC hop is longer than
the clock's resolution, so two steps never tie in practice, and on a tie the file step is the newer (the operation was
asked for after the typing it flushed). The renderer asks the main process for the top of the journal at the moment of
the key, so the answer is never a cached one.

Text steps are the **open note's**: typing in another tab is that tab's, and comes back with it. The journal is the
window's: it does not matter which note is in front when a rename of another note is taken back. Edit ▸ Undo names the
step ("Undo Rename Note", "Undo Move to Trash", "Undo Typing", "Undo Drawing") so the person is never surprised by which
one a press will take.

## The journal (main process)

`main/undoJournal.ts`. An ordered list of the file steps, an undo stack and a redo stack, one at a time (every record, undo
and redo goes through one queue, so two operations asked for in a breath are two steps in the order they were asked, and
an undo never runs in the middle of an operation).

A step is made of **parts**, applied in order and taken back in reverse order:

| part | applied | taken back | redone |
|---|---|---|---|
| `move` (a file or a folder renamed or moved) | `from` → `to` (notes under a folder follow: `movedNote`) | `to` → `from` | `from` → `to` |
| `make` (a file or an empty folder the operation created) | created | the file is copied to the backup (a clone where the volume has one) and then removed; a folder must be empty | the file is created again from the backup; the folder is made again |
| `bin` (sent to the Recycle Bin / Trash) | copied to the backup first, then binned | restored from the backup | binned again |
| `order` (a folder's row order, `.writemind/order.json`) | lists changed | the lists before | the lists after |
| `entry` (a picture Clean Up took out of a note) | removed from the note | put back into the note from the backup | removed again |

Each operation is a recipe of parts: **rename** = move + order; **move** (a drag, Move to) = move + order(s);
**duplicate** = make + order; **new note**, **import** = make; **new section** = make (folder); **trash** = bin;
**section rename / move** = move + order(s); **reorder** = order; **Clean Up** = entries.

Every operation first takes what it needs (`journal.begin()` gives a draft with a backup folder), does the work through the
same functions the app always used (`notes.ts`, `wmStore.ts`, `housekeeping.ts`), and only a work that SUCCEEDED becomes a
step; a work that failed deletes its draft and its backup and changes nothing in the journal.

### Where the backups live

`<userData>/undo/<launch>/<step id>/<n>-<name>`. `userData` is the app's own data folder (never the notes folder), a copy
is made with `COPYFILE_FICLONE` (a copy-on-write clone on APFS, Btrfs, XFS, ReFS; an ordinary copy elsewhere) and checked
against the original (size for a file, the list of names and sizes for a folder) before the original is touched. A
backup is made for: a trashed note (the file), a trashed section (the whole folder: its notes, their pictures and
drawings are inside the notes, and the folder's own hidden files), a note a New Note / Duplicate / Import step is taking
away (its content at the moment it is undone, so that Redo brings back what was there), and every picture Clean Up takes
out of a note. A symbolic link is backed up as a link.

If the backup cannot be made (the disk is full, the source cannot be read), **the operation does not happen** and the
person is told why: Undo is promised, so the destructive half is not done without it. Nothing is half done.

### When the backups go

A step's backups are deleted when:

1. the step falls more than three steps back (a fourth file step is recorded; the oldest goes);
2. the step is superseded: it was undone and a NEW step (a file step, or any edit of any note) came after it, which ends
   the redo path (the page tells the journal on the first edit after an undo: `undo:cutRedo`);
3. the app quits (`will-quit`, synchronously), or the window is closed (the journal belongs to a window), or another
   project is opened (the steps name folders of the one that was left);
4. the next launch finds `<userData>/undo` left by a crash and removes all of it before anything else (a backup is a copy of
   what is in the OS Trash or still on disk; a crash is the only way one outlives its run).

Nothing is ever deleted from the notes folder by the journal except what the journal made: the note a New Note / Duplicate /
Import created (and only while the app still owns that file: its bytes are the ones the app last read or wrote, the same
guard `mayWrite` gives every save), and the empty folder a New Section made. **The OS Trash keeps the trashed item** after
Undo restores a copy from the backup; that is deliberate (the Trash is the person's; the journal never reaches into it), so
an undone Move to Trash leaves the item in the Trash too, and Redo puts the file in the Trash again (a second item).

### Guards ("the notes folder is the person's data")

* A restore never overwrites: it creates the file with the exclusive writer (`createNow`: EEXIST when the name is taken). **If
  the name is taken it is put back beside it with a number** ("Idea 2") and the person is told in the footer: `“Idea” was
  put back as “Idea 2” because there is a note called “Idea” now.` The same for a rename or a move taken back onto a taken
  name; the step then redoes from where it actually landed.
* A removal (Undo of a New Note / Duplicate / Import) runs in the note's own write queue (`inTurn`) and only when the file on
  disk is the one the app knows (the digest check). A note another program has changed is not removed: the undo says so.
* The order files are written through `writeOrder` (the atomic writer); a step restores only the lists IT changed, and if a
  list has changed since (another program) it removes the names the step added and puts back the names it removed, rather
  than overwriting the list.
* **A failed undo changes nothing.** Each part that was done is taken back in reverse if a later part fails; the step stays
  where it was (retry is a second press), the footer says why ("Could not undo Rename Note: …"). One class of failure is not
  retried forever: the thing the step was about has gone (a note another program removed): the step is dropped, with its
  backups, and says so, so the older steps behind it are not blocked.
* A refused write (a note of a newer format, a file that changed) is never forced: a journal write goes through the same
  functions as the app's own.

## How text edits and file operations are ordered

* **Before an operation** the page writes what it is holding (`flushNow(false)`), exactly as it already did for rename and
  move; this pass adds Move to Trash (it used to throw the last half second of typing away, and now the backup holds it).
  So a text step is always older than the file step that follows it, and the file on disk has the typing in it.
* **Pressing Undo** the page decides which step is newest (above), flushes, then either takes back the text step in the
  editor (synchronously, as now) or asks the journal (`undo:run`). Keys pressed while an undo is in flight wait their turn.
* **A file step's effect on the page** comes back as a list: paths that moved (tabs, caret memory and the undo history of a
  moved note follow: `followMoved`), paths that are gone (their tabs close), paths that are back (a trashed note's tab
  reopens if it was open), a notice. The tree is read again.
* **Redo is valid only while nothing new has been done since the undo.** The page tells the journal at the first edit after
  an undo (`undo:cutRedo`), and a text redo is checked against the time of the newest recorded file step.
* **The text history survives what happens to its note.** A rename or a move keeps the editor's undo history (the state is
  carried to the new path and rebuilt with the new path's extensions); a disk reload that did not change the text leaves
  it alone (and one that did is a step of its own, "Undo Reload"); a closed or trashed note's history is kept with the last
  eight closed notes, so Undo of a trash brings back the note with its Ctrl+Z.

## Edit ▸ Undo / Redo

The menu items name the step the next press takes (`Undo Rename Note`, `Redo Move to Trash`, `Undo Typing`) and are
disabled, plain "Undo" / "Redo", when there is nothing. The page tells the shell the two labels with the rest of the menu
state (`MenuState.undoLabel` / `redoLabel`; `undefined` is "not said yet" and keeps the plain, enabled items). The pen's
Undo button, the tablet sheet's own Undo and Edit ▸ Undo Drawing keep their scope (the note's edits and the sheet's strokes),
and never take back a file step: a stylus button must not rename a note.

**Ctrl+Z inside a text field** (the rename prompt, the find field, a label, the sidebar search) is that field's own, as now;
and with a dialog up (`aria-modal`) the key is the dialog's, not the notes'.

## Limits, said plainly

* Three file steps back. A fourth deletes the first's backups. Typing keeps at least 200 steps.
* A backup is a copy: a trashed section of n bytes takes n bytes under `<userData>/undo` until its step goes (free on a
  volume that clones). A section too big for the disk is refused, not half done.
* Add Folder / Remove Folder / Hide Folder in the project are **not** in the journal: they are project settings, they change no
  file in the notes folder (nothing to back up), and each has its own reverse in the Project menu (Add Folder, Hidden
  Folders ▸ Show). Adding a folder may also convert the old `.md` notes in it, which is not reversible by design (the originals
  are kept).
* Opening a note from outside (a `.wm` in Finder) is not a step: it makes no file. Importing a `.md` is.
* The OS Trash is not emptied or read by Undo (see above).
* The tree of open tabs is not a step (closing a tab is not a file operation; the note's history is kept for the last eight).
