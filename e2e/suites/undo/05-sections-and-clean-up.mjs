// Sections and Clean Up: New Section, Rename Section, Move to Trash on a section (the whole folder comes back with its notes
// and its hidden files), and a Clean Up that took pictures out of a note: each taken back with Ctrl+Z, then brought back with
// Ctrl+Shift+Z. (docs/PLAN-undo.md)
import fs from "node:fs"
import path from "node:path"
import { ok, finish, js, sleep, notesDir, resetNotes, writeNoteFile, readNoteWm, reloadApp, shot } from "../../lib/harness.mjs"
import { answerPrompt, listing, menuPick, redoKey, sidebarRows, undoKey } from "../../lib/undoSteps.mjs"
import { click, rightClick } from "../../lib/harness.mjs"

await resetNotes({ reload: false })
await writeNoteFile("Keep.wm", "keep\n")
await writeNoteFile("Sec/One.wm", "one\n")
await writeNoteFile("Sec/Deep/Two.wm", "two\n")
const root = await notesDir()
fs.mkdirSync(path.join(root, "Sec", ".writemind"), { recursive: true })
fs.writeFileSync(path.join(root, "Sec", ".writemind", "order.json"), JSON.stringify({ folders: { "": ["One.wm"] } }))
await reloadApp()
if (await js(`!!document.querySelector('.camera')`)) { await js(`document.querySelector('[data-bar=video]')?.click()`); await sleep(400) }

const sectionAt = async (rel) => JSON.parse(await js(`(() => {
  const row = [...document.querySelectorAll('.section-row')].find(r => r.dataset.path.replace(/\\\\/g, '/').endsWith('/' + ${JSON.stringify(rel)}))
  const r = row.getBoundingClientRect()
  return JSON.stringify({ x: r.x + 60, y: r.y + r.height / 2 })
})()`))

// --- Rename Section
let at = await sectionAt("Sec")
await rightClick(at.x, at.y)
await menuPick("Rename")
await answerPrompt("Renamed")
ok("the section was renamed on disk, its notes with it", (await listing()).includes("Renamed/One.wm") && !(await listing()).includes("Sec/"), (await listing()).join())
await undoKey()
ok("undo: the old name is back with every note", (await listing()).includes("Sec/One.wm") && (await listing()).includes("Sec/Deep/Two.wm") && !(await listing()).includes("Renamed/"), (await listing()).join())
ok("undo: the sidebar agrees", (await sidebarRows()).includes("Sec") && !(await sidebarRows()).includes("Renamed"), (await sidebarRows()).join())
await redoKey()
ok("redo: renamed again", (await listing()).includes("Renamed/One.wm"))
await undoKey()

// --- Move to Trash on a section: everything in it, hidden files too, comes back
const before = (await listing()).join()
const hiddenBefore = fs.readFileSync(path.join(root, "Sec", ".writemind", "order.json"), "utf8")
at = await sectionAt("Sec")
await rightClick(at.x, at.y)
await menuPick("Move to")
await answerPrompt()
ok("the section went to the trash", !(await listing()).includes("Sec/"), (await listing()).join())
await undoKey()
ok("undo: the whole folder is back, notes and nested section", (await listing()).join() === before, (await listing()).join())
ok("undo: its hidden order file too, byte for byte", fs.readFileSync(path.join(root, "Sec", ".writemind", "order.json"), "utf8") === hiddenBefore)
ok("undo: its notes still read", (await readNoteWm("Sec/Deep/Two.wm")).text === "two\n")
await shot("section-back")
await redoKey()
ok("redo: in the trash again", !(await listing()).includes("Sec/"))
await undoKey()

// --- New Section (made through the API, which is what the + menu calls)
const made = await js(`window.wm.createSection(${JSON.stringify(root)})`)
await sleep(700)
ok("a new section exists", fs.existsSync(made), made)
await undoKey()
ok("undo removes the empty folder", !fs.existsSync(made))
await redoKey()
ok("redo makes it again", fs.existsSync(made))
await undoKey()

// --- Clean Up: the pictures taken out of a note come back
const png = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 9, 9, 9])
const file = await writeNoteFile("Pics.wm", "no pictures named here\n", { entries: { "media/ab12cd34ef56ab78.png": png } })
fs.utimesSync(file, Date.now() / 1000 - 3600, Date.now() / 1000 - 3600)
const result = await js(`window.wm.trashUnused([${JSON.stringify(file + "::media/ab12cd34ef56ab78.png")}], { openNotes: [], held: [] })`)
ok("Clean Up took the picture out of the note", result.moved.length === 1 && !(await readNoteWm("Pics.wm")).names.includes("media/ab12cd34ef56ab78.png"), JSON.stringify(result))
await undoKey()
const back = await readNoteWm("Pics.wm")
ok("undo puts the picture back into the note, byte for byte", back.entries["media/ab12cd34ef56ab78.png"]?.equals(png), JSON.stringify(back.names))
await redoKey()
ok("redo takes it out again", !(await readNoteWm("Pics.wm")).names.includes("media/ab12cd34ef56ab78.png"))
finish()
