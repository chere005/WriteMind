// The edges: undo after a tab switch and after a disk reload (one that changed nothing and one that changed the words), a
// trash whose name was taken meanwhile, an undo that FAILS (a folder that cannot be written: nothing changes, and a second
// try works), undoing the creation of the note that is open in a tab, and a restart (no backup survives it).
import fs from "node:fs"
import path from "node:path"
import { ok, finish, js, sleep, notesDir, resetNotes, writeNoteFile, reloadApp, restartApp, doc, shot, typeText } from "../../lib/harness.mjs"
import { backupFolders, dragRow, footerName, journalState, listing, openRow, tabCount, textOnDisk, trashNoteViaEditMode, typeAtEnd, undoKey, sidebarRows } from "../../lib/undoSteps.mjs"

await resetNotes({ reload: false })
await writeNoteFile("A.wm", "A\n")
await writeNoteFile("B.wm", "B\n")
await writeNoteFile("Sec/In.wm", "in\n")
await reloadApp()
if (await js(`!!document.querySelector('.camera')`)) { await js(`document.querySelector('[data-bar=video]')?.click()`); await sleep(400) }
const root = await notesDir()

// --- a tab switch keeps the undo
await openRow("A.wm")
await typeAtEnd("one")
await openRow("B.wm")
await openRow("A.wm")
await undoKey()
ok("undo after a tab switch takes the typing", (await doc()) === "A\n", JSON.stringify(await doc()))
await js(`window.dispatchEvent(new KeyboardEvent('keydown', { key: 'z', ctrlKey: true, shiftKey: true, bubbles: true, cancelable: true }))`)
await sleep(700)
ok("and redo brings it back", (await doc()) === "A\none", JSON.stringify(await doc()))

// --- a disk reload that changed nothing leaves the history alone
await sleep(900)
await writeNoteFile("A.wm", "A\none")   // another program writes the same words (a sync client touching the file)
await sleep(1800)
ok("the same words from outside change nothing", (await doc()) === "A\none")
await undoKey()
ok("undo after a reload that changed nothing still takes the typing", (await doc()) === "A\n", JSON.stringify(await doc()))
await sleep(900)
ok("and the file has it (the guard accepted the save)", (await textOnDisk("A.wm")) === "A\n", JSON.stringify(await textOnDisk("A.wm")))

// --- a reload that changed the words is a step of its own: Ctrl+Z brings the old words back
await writeNoteFile("A.wm", "A\nfrom another program")
await sleep(2000)
ok("the other program's words are on the page", (await doc()) === "A\nfrom another program", JSON.stringify(await doc()))
await undoKey()
ok("undo takes the reload back (the words that were there)", (await doc()) === "A\n", JSON.stringify(await doc()))

// --- a trash whose name was taken meanwhile
await trashNoteViaEditMode("B.wm")
await writeNoteFile("B.wm", "a different B\n")
await sleep(1200)
await js(`document.querySelector('.cm-content').focus()`)
await undoKey()
const names = await listing()
ok("undo of the trash puts the note back beside the new one, with a number", names.includes("B 2.wm") && names.includes("B.wm"), names.join())
ok("the new B was not touched, and the old words are in 'B 2'", (await textOnDisk("B.wm")) === "a different B\n" && (await textOnDisk("B 2.wm")) === "B\n")
const told = await js(`document.querySelector('[data-footer=read-notice]')?.textContent ?? ''`)
ok("the person is told", /B 2/.test(told), told)
await shot("name-taken")

// --- an undo that fails changes nothing, and works at the second try
await openRow("A.wm")
await dragRow("A.wm", "Sec")
ok("A moved into Sec", (await listing()).includes("Sec/A.wm"), (await listing()).join())
if (process.platform !== "win32") {
  fs.chmodSync(path.join(root, "Sec"), 0o555)            // the folder A would leave cannot be written to
  const before = (await listing()).join()
  await undoKey()
  ok("a failing undo changes nothing", (await listing()).join() === before, (await listing()).join())
  const problem = await js(`document.querySelector('[data-footer=problem]')?.textContent ?? ''`)
  ok("and says why", /Could not undo Move Note/.test(problem), problem)
  ok("the step is still there", (await journalState()).undo?.label === "Move Note", JSON.stringify((await journalState()).undo))
  fs.chmodSync(path.join(root, "Sec"), 0o755)
  await undoKey()
  ok("the second try works", (await listing()).includes("A.wm") && !(await listing()).includes("Sec/A.wm"), (await listing()).join())
  ok("and the message is gone", (await js(`document.querySelector('[data-footer=problem]')`)) === null)
} else {
  console.log("SKIP a failing undo  (permissions are not enforced on this platform)")
}

// --- undoing the creation of the note that is open
const made = await js(`window.wm.createNote(${JSON.stringify(root)})`)
await sleep(900)
await openRow(path.basename(made))
await typeAtEnd("fresh")
const tabs = await tabCount()
await undoKey()
ok("the typing goes first", (await doc()) === "")
await undoKey()
ok("then the note itself: its file goes and its tab closes", !fs.existsSync(made) && (await tabCount()) === tabs - 1, `${fs.existsSync(made)} ${tabs} -> ${await tabCount()}`)
ok("the sidebar no longer shows it", !(await sidebarRows()).includes(path.basename(made)))
await js(`window.dispatchEvent(new KeyboardEvent('keydown', { key: 'z', ctrlKey: true, shiftKey: true, bubbles: true, cancelable: true }))`)
await sleep(1200)
ok("redo brings the note back", fs.existsSync(made), made)

// --- Ctrl+Z in a text field is the field's own, and with a dialog up the notes do not move behind it
{
  const before = await journalState()
  const names = (await listing()).join()
  const rows = await js(`[...document.querySelectorAll('.note-row')].map(r => r.dataset.path)`)
  const row = JSON.parse(await js(`(() => { const r = document.querySelector('.note-row').getBoundingClientRect(); return JSON.stringify({ x: r.x + 60, y: r.y + r.height / 2 }) })()`))
  const { rightClick, key } = await import("../../lib/harness.mjs")
  const { menuPick } = await import("../../lib/undoSteps.mjs")
  await rightClick(row.x, row.y)
  await menuPick("Rename")
  await sleep(300)
  await typeText("Zed")
  await key("z", { ctrl: true })
  await sleep(500)
  ok("Ctrl+Z in the rename box takes no file step back", (await journalState()).undoCount === before.undoCount && (await listing()).join() === names, JSON.stringify(await journalState()))
  await js(`document.querySelector('[data-modal=ok]').focus()`)
  await key("z", { ctrl: true })
  await sleep(500)
  ok("nor does it with the dialog's button focused (a dialog is up)", (await journalState()).undoCount === before.undoCount && (await listing()).join() === names)
  await js(`document.querySelector('[data-modal=cancel]').click()`)
  await sleep(300)
}

// --- nothing survives a restart
await trashNoteViaEditMode("B 2.wm")
ok("a backup exists while its step does", ((await backupFolders()) ?? []).length >= 1, JSON.stringify(await backupFolders()))
await restartApp()
await sleep(1500)
const left = await backupFolders()
ok("after a restart no backup is left", left === null || left.length === 0, JSON.stringify(left))
ok("and the journal starts empty", (await journalState()).undoCount === 0)
finish()
