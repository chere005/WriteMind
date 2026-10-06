WriteMind 2.0.0

WriteMind is now just WriteMind. The project lives at github.com/chere005/WriteMind (it was WriteMindCross; old links still work).

**Updating from 1.0.0**
- **Windows:** WriteMind 1.0.0 finds this update by itself.
- **Mac:** Help ▸ Check for Updates… opens this page. Download the dmg for your Mac and drag WriteMind into Applications.
- **Your notes folder:** the first time 2.0.0 starts, it moves `Documents\WriteMindCross` to `Documents\WriteMind`. Your drawings, pictures and projects go with it. If a `Documents\WriteMind` folder already exists, which is likely on a Mac, WriteMind keeps using `WriteMindCross` and tells you once.

**New cell keys** (⌘ on a Mac)
- Ctrl+9 makes a **maths cell**: type Wolfram Language, and it is typeset when you leave the cell. Ctrl+9 on words turns them into maths.
- Ctrl+0 makes a **drawing cell** (it was Ctrl+9 in 1.0.0).
- The others stay: Ctrl+7 makes a text cell, Ctrl+Shift+7 a markdown cell, Ctrl+8 a code block and Ctrl+Shift+8 runnable code.

**Text cells**
- **Pure plain text:** a text cell never typesets maths or formats anything. It shows exactly what you typed.
- **Ctrl+7 on a markdown cell:** inline maths keeps its `wl:` source, so Ctrl+Shift+7 typesets it again.
- **Split, Merge and Find / Replace:** they follow the text-cell rules. Pressing Return in a list continues the list.
- **An emptied markdown cell** no longer leaves a hidden empty cell behind.

**Drawing**
- **Hover:** hovering a drawing shows its outline and handles before you click.
- **Drawing cells:** they take shapes, arrows and text boxes, not just ink.
- **Undock:** right-click a docked picture or drawing cell ▸ Undock puts it back over the note. One Ctrl+Z docks it again.

**Wacom sheet**
- **Erasing:** the bar's Erase button is gone. Hold the pen's first button to erase strokes.
- **Box buttons:** a stroke that starts on the buttons under the box now draws.
- **Bring in as Drawing Cell** keeps your ink where it sat in the box.

**Files**
- **Deleting a note** also moves its drawing to the Recycle Bin (Trash on a Mac).
- **File ▸ Clean Up Unused Files…** finds drawings and pictures that no note uses, lists them and moves them to the Recycle Bin only if you say so. Nothing is ever deleted permanently.

**Fixes**
- Typing an empty `` `wl:` `` no longer freezes the rendered page.
- A code cell's language can be clicked on the rendered page again.
