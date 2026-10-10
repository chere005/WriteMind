// Text edits and file operations, interleaved, across two notes: one Ctrl+Z takes the newest step of either kind (the open
// note's own typing, or the window's journal), Ctrl+Shift+Z the one undone last, and a file step in the middle of typing is
// a boundary: typing before it and after it are two steps even when they were a breath apart.
import { ok, finish, js, sleep, resetNotes, writeNoteFile, reloadApp, doc, shot, typeText } from "../../lib/harness.mjs"
import { footerName, listing, openRow, redoKey, renameNote, typeAtEnd, undoKey, historyMenu } from "../../lib/undoSteps.mjs"

await resetNotes({ reload: false })
await writeNoteFile("A.wm", "A\n")
await writeNoteFile("B.wm", "B\n")
await reloadApp()
if (await js(`!!document.querySelector('.camera')`)) { await js(`document.querySelector('[data-bar=video]')?.click()`); await sleep(400) }

// a1 in A, b1 in B, then A (not in front) is renamed from the sidebar
await openRow("A.wm")
await typeAtEnd("a1")
await openRow("B.wm")
await typeAtEnd("b1")
await renameNote("A.wm", "A2")
ok("A was renamed while B is in front", (await listing()).includes("A2.wm") && (await footerName()) === "B.wm" && (await doc()) === "B\nb1")

await undoKey()
ok("1: the newest step is the rename (a file step, whichever note is in front): A is back", (await listing()).includes("A.wm") && !(await listing()).includes("A2.wm") && (await doc()) === "B\nb1", `${(await listing()).join()} ${JSON.stringify(await doc())}`)
await undoKey()
ok("2: then B's own typing", (await doc()) === "B\n", JSON.stringify(await doc()))
await undoKey()
ok("3: nothing more in B: A's typing is A's, it stays", (await doc()) === "B\n" && (await listing()).includes("A.wm"))
await openRow("A.wm")
ok("A's tab still has its typing", (await doc()) === "A\na1", JSON.stringify(await doc()))
await undoKey()
ok("4: in A's tab, Ctrl+Z takes A's typing", (await doc()) === "A\n", JSON.stringify(await doc()))

// redo, in the order they were undone: A's typing first
await redoKey()
ok("redo 1: A's typing", (await doc()) === "A\na1", JSON.stringify(await doc()))
await shot("a-redone")

// typing, a file step, typing again, within half a second: THREE steps, not two
await openRow("B.wm")
await js(`document.querySelector('.cm-content').cmTile.view.focus(); document.querySelector('.cm-content').cmTile.view.dispatch({ selection: { anchor: document.querySelector('.cm-content').cmTile.view.state.doc.length } })`)
await typeText("x")
await renameNote("A.wm", "A3")
await typeText("y")
await sleep(900)
ok("x and y typed with a rename between them", (await doc()) === "B\nxy" && (await listing()).includes("A3.wm"), JSON.stringify(await doc()))
await undoKey()
ok("5: Ctrl+Z takes only the y (typing before the rename is another step)", (await doc()) === "B\nx", JSON.stringify(await doc()))
await undoKey()
ok("6: then the rename", (await listing()).includes("A.wm") && !(await listing()).includes("A3.wm") && (await doc()) === "B\nx")
await undoKey()
ok("7: then the x", (await doc()) === "B\n", JSON.stringify(await doc()))

// a new edit after an undo ends the redo path of FILE steps too
await redoKey()
ok("redo 2: the x comes back first (it was undone last)", (await doc()) === "B\nx", JSON.stringify(await doc()))
ok("the rename is waiting to be redone", (await historyMenu()).redo?.label === "Redo Rename Note", JSON.stringify((await historyMenu()).redo))
await typeAtEnd("z")
ok("a new edit ends it: Redo is greyed", (await historyMenu()).redo?.enabled === false && (await listing()).includes("A.wm"), JSON.stringify((await historyMenu()).redo))
finish()
