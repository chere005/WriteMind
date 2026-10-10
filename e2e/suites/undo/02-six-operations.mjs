// Six file operations: only the last THREE can be undone, and the backups of the oldest are gone. (Sean, 2026-10-10: "up to 3
// steps, even if it involves file changes, which may mean keeping file backups until undo goes out of scope".)
import fs from "node:fs"
import { ok, finish, js, sleep, notesDir, resetNotes, writeNoteFile, reloadApp, shot } from "../../lib/harness.mjs"
import { backupFolders, journalState, listing, trashNoteViaEditMode, undoKey, openRow, sidebarRows, textOnDisk } from "../../lib/undoSteps.mjs"

await resetNotes({ reload: false })
for (const n of [1, 2, 3, 4, 5, 6]) await writeNoteFile(`N${n}.wm`, `note ${n}\n`)
await reloadApp()
if (await js(`!!document.querySelector('.camera')`)) { await js(`document.querySelector('[data-bar=video]')?.click()`); await sleep(400) }

// six trashes, each through edit mode's two clicks (a backup is made for each before it goes)
for (const n of [1, 2, 3, 4, 5, 6]) await trashNoteViaEditMode(`N${n}.wm`)
ok("all six notes are in the trash", (await listing()).filter((one) => /^N\d\.wm$/.test(one)).length === 0, (await listing()).join())

const state = await journalState()
ok("the journal holds three steps", state.undoCount === 3, JSON.stringify(state))
const dirs = await backupFolders()
ok("and three backups: the oldest three were deleted when they fell out of scope", dirs !== null && dirs.length === 3, JSON.stringify(dirs))
ok("Edit > Undo names the newest", (await js(`window.wm.e2eMenu().then(m => m.find(t => t.label === 'Edit').submenu.find(i => i.id === 'undo').label)`)) === "Undo Move to Trash")

for (const n of [6, 5, 4]) {
  await undoKey()
  ok(`undo of N${n}: back with its words`, (await listing()).includes(`N${n}.wm`) && (await textOnDisk(`N${n}.wm`)) === `note ${n}\n`, (await listing()).join())
  ok(`undo of N${n}: and in the sidebar`, (await sidebarRows()).includes(`N${n}.wm`), (await sidebarRows()).join())
}
await undoKey()
ok("a fourth press brings nothing back: N3 stays in the trash", !(await listing()).some((one) => /^N[123]\.wm$/.test(one)), (await listing()).join())
ok("the journal has nothing left to undo", (await journalState()).undoCount === 0)
await shot("after-three-undos")

// a redo and then a NEW step: the redo path is gone, and so is its backup
await js(`window.dispatchEvent(new KeyboardEvent('keydown', { key: 'z', ctrlKey: true, shiftKey: true, bubbles: true, cancelable: true }))`)
await sleep(1000)
ok("redo takes N4 to the trash again", !(await listing()).includes("N4.wm"), (await listing()).join())
const root = await notesDir()
await js(`window.wm.createNote(${JSON.stringify(root)})`)
await sleep(600)
const after = await journalState()
ok("a new step ends the redo path", after.redoCount === 0 && after.undoCount === 2 && after.undo?.label === "New Note", JSON.stringify(after))
const left = await backupFolders()
ok("and the backups of the two steps that could no longer be redone are gone (only the trash of N4 keeps its copy)", left !== null && left.length === 1, JSON.stringify(left))
finish()
