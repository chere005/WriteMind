// The requirement, end to end (Sean, 2026-10-10: "make sure undo is always able to undo up to 3 steps, even if it involves
// file changes"): type in a note, rename it, move it into a section, trash ANOTHER note, type again -- then Ctrl+Z five times,
// checking the text, the names, the folder and the sidebar after EACH press, and Ctrl+Shift+Z five times back. Real keys, the
// sidebar's own right-click menu, a drag, and edit mode's two-click trash.
import fs from "node:fs"
import path from "node:path"
import { ok, finish, js, sleep, notesDir, resetNotes, writeNoteFile, reloadApp, doc, shot, setWindowSize } from "../../lib/harness.mjs"
import {
  answerPrompt, dragRow, footerName, frontTab, historyMenu, listing, openRow, redoKey, renameNote, sidebarRows, textOnDisk,
  trashNoteViaEditMode, typeAtEnd, undoKey,
} from "../../lib/undoSteps.mjs"

await resetNotes({ reload: false })
await writeNoteFile("Alpha.wm", "alpha\n")
await writeNoteFile("Other.wm", "other\n")
await writeNoteFile("Sec/In.wm", "inside\n")
await reloadApp()
if (await js(`!!document.querySelector('.camera')`)) { await js(`document.querySelector('[data-bar=video]')?.click()`); await sleep(400) }

// --- the five things
await openRow("Alpha.wm")
await typeAtEnd("one")
ok("1. typed 'one' in Alpha", (await doc()) === "alpha\none", JSON.stringify(await doc()))
await renameNote("Alpha.wm", "Beta")
ok("2. renamed to Beta", (await listing()).includes("Beta.wm") && !(await listing()).includes("Alpha.wm"), (await listing()).join())
ok("   the open note followed it and kept its words", (await footerName()) === "Beta.wm" && (await doc()) === "alpha\none", `${await footerName()} ${JSON.stringify(await doc())}`)
await dragRow("Beta.wm", "Sec")
ok("3. moved into Sec", (await listing()).includes("Sec/Beta.wm") && !(await listing()).includes("Beta.wm"), (await listing()).join())
ok("   the open note followed it", (await footerName()) === "Beta.wm" && (await doc()) === "alpha\none")
await trashNoteViaEditMode("Other.wm")
ok("4. trashed Other", !(await listing()).includes("Other.wm"), (await listing()).join())
ok("   Beta is still the open note", (await footerName()) === "Beta.wm")
await typeAtEnd(" two")
ok("5. typed ' two' in Beta", (await doc()) === "alpha\none two", JSON.stringify(await doc()))
await shot("before-undo")

const menu = await historyMenu()
ok("Edit > Undo names the step: Undo Typing", menu.undo?.label === "Undo Typing" && menu.undo.enabled, JSON.stringify(menu.undo))
ok("Edit > Redo is greyed with nothing to redo", menu.redo?.enabled === false && menu.redo.label === "Redo", JSON.stringify(menu.redo))

// --- five presses of Ctrl+Z
await undoKey()
ok("press 1: the second typing is gone, everything else stays", (await doc()) === "alpha\none"
  && (await listing()).includes("Sec/Beta.wm") && !(await listing()).includes("Other.wm"), `${JSON.stringify(await doc())} ${(await listing()).join()}`)
ok("press 1: Edit > Undo now says Undo Move to Trash", (await historyMenu()).undo?.label === "Undo Move to Trash", JSON.stringify((await historyMenu()).undo))
ok("press 1: Edit > Redo says Redo Typing", (await historyMenu()).redo?.label === "Redo Typing", JSON.stringify((await historyMenu()).redo))

await undoKey()
ok("press 2: Other is back (file and sidebar), with its words", (await listing()).includes("Other.wm") && (await textOnDisk("Other.wm")) === "other\n"
  && (await sidebarRows()).includes("Other.wm"), `${(await listing()).join()} | ${(await sidebarRows()).join()}`)
ok("press 2: nothing else moved", (await listing()).includes("Sec/Beta.wm") && (await doc()) === "alpha\none")
await shot("after-press-2")

await undoKey()
ok("press 3: Beta is back at the root, not in Sec", (await listing()).includes("Beta.wm") && !(await listing()).includes("Sec/Beta.wm"), (await listing()).join())
ok("press 3: the sidebar shows it there", (await sidebarRows()).includes("Beta.wm") && !(await sidebarRows()).includes("Sec/Beta.wm"), (await sidebarRows()).join())
ok("press 3: the open note followed it, words intact", (await footerName()) === "Beta.wm" && (await doc()) === "alpha\none")

await undoKey()
ok("press 4: the name Alpha is back", (await listing()).includes("Alpha.wm") && !(await listing()).includes("Beta.wm"), (await listing()).join())
ok("press 4: the open note followed it", (await footerName()) === "Alpha.wm" && (await doc()) === "alpha\none", `${await footerName()} ${JSON.stringify(await doc())}`)

await undoKey()
ok("press 5: the first typing is gone (the history survived the rename AND the move)", (await doc()) === "alpha\n", JSON.stringify(await doc()))
await sleep(800)
ok("press 5: and Alpha on disk has the old words", (await textOnDisk("Alpha.wm")) === "alpha\n", JSON.stringify(await textOnDisk("Alpha.wm")))
ok("press 5: Edit > Undo is greyed now", (await historyMenu()).undo?.enabled === false, JSON.stringify((await historyMenu()).undo))
await undoKey()
ok("a sixth press changes nothing", (await doc()) === "alpha\n" && (await listing()).includes("Alpha.wm") && (await listing()).includes("Other.wm"))
await shot("after-press-5")

// --- five presses of Ctrl+Shift+Z
await redoKey()
ok("redo 1: 'one' is back", (await doc()) === "alpha\none", JSON.stringify(await doc()))
await redoKey()
ok("redo 2: Beta again", (await listing()).includes("Beta.wm") && !(await listing()).includes("Alpha.wm"), (await listing()).join())
ok("redo 2: the open note followed it", (await footerName()) === "Beta.wm" && (await doc()) === "alpha\none")
await redoKey()
ok("redo 3: in Sec again", (await listing()).includes("Sec/Beta.wm") && !(await listing()).includes("Beta.wm"), (await listing()).join())
await redoKey()
ok("redo 4: Other is in the trash again", !(await listing()).includes("Other.wm"), (await listing()).join())
ok("redo 4: the sidebar agrees", !(await sidebarRows()).includes("Other.wm"), (await sidebarRows()).join())
await redoKey()
ok("redo 5: ' two' is back", (await doc()) === "alpha\none two", JSON.stringify(await doc()))
await sleep(800)
ok("redo 5: and Sec/Beta.wm on disk has it", (await textOnDisk("Sec/Beta.wm")) === "alpha\none two", JSON.stringify(await textOnDisk("Sec/Beta.wm")))
ok("redo is greyed at the end", (await historyMenu()).redo?.enabled === false)
await shot("after-redo-5")
finish()
