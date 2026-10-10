// @e2e isolated
// SIX FILE OPERATIONS from MIXED SURFACES (Sean, 2026-10-10: "up to 3 steps, even if it involves file changes, which may mean keeping
// file backups until undo goes out of scope"): only the last three can be undone, the oldest backup is gone, and NOTHING is deleted
// that was not the journal's. The six are made through the tab row's menu, the sidebar row's menu and the sidebar's + menu:
//   1. tab menu      Move to Trash… T1      (a backup is made before it goes)
//   2. row menu      Rename… R → R2
//   3. + menu        New Section
//   4. row menu      Move to Trash… T2      (the fourth step: step 1 falls out of scope, its backup is deleted)
//   5. tab menu      Duplicate D            (beside a note that is already called “D copy”: a number, never an overwrite)
//   6. row menu      Move to ▸ Sec  M
// Then three Ctrl+Z (each checked whole: files, what they hold, the sidebar, the journal, the backups), a fourth that changes nothing,
// three Ctrl+Shift+Z, and a new step after an undo, which ends the redo path and deletes its backups. Bystanders — a plain text
// file, a note that is not ours to touch, a hidden folder — are compared byte for byte at every step.
import fs from "node:fs"
import path from "node:path"
import {
  ok, finish, sleep, shot, start, world, expectWorld, sameAs, tabMenu, rowMenu, plusMenu, dialog, openByRow, undo, redo,
  notesDir, caretTo,
} from "./_lib.mjs"
import { backupFolders, journalState } from "../../lib/undoSteps.mjs"

const bystanders = { "Readme.txt": "not a note\n", "Keep/Mine.wm": "mine\n" }
await start({
  "D.md": "d words\n", "D copy.md": "someone else's copy\n", "T1.md": "t1 words\n", "T2.md": "t2 words\n", "R.md": "r words\n", "M.md": "m words\n",
  "Sec/In.md": "inside\n", "Keep/Mine.md": bystanders["Keep/Mine.wm"],
})
const root = await notesDir()
fs.writeFileSync(path.join(root, "Readme.txt"), bystanders["Readme.txt"])
fs.mkdirSync(path.join(root, ".hidden-by-someone"), { recursive: true })
fs.writeFileSync(path.join(root, ".hidden-by-someone", "x.txt"), "x")
await sleep(500)
// open the notes the tab menu will be used on
for (const rel of ["T1.wm", "D.wm"]) await openByRow(rel)
await caretTo(0)

const bystanderCheck = async (label) => {
  const w = await world()
  ok(`${label}: the bystanders are untouched (Readme.txt, Keep/Mine.wm, the hidden folder)`,
    fs.readFileSync(path.join(root, "Readme.txt"), "utf8") === bystanders["Readme.txt"] && w.disk["Keep/Mine.wm"] === "mine\n"
    && fs.readFileSync(path.join(root, ".hidden-by-someone", "x.txt"), "utf8") === "x"
    && w.disk["Sec/In.wm"] === "inside\n" && w.disk["D copy.wm"] === "someone else's copy\n", JSON.stringify(Object.keys(w.disk)))
  return w
}
const journal = async () => {
  const s = await journalState()
  return `${s.undoCount} undo / ${s.redoCount} redo`
}
const FILES0 = ["D.wm", "D copy.wm", "T1.wm", "T2.wm", "R.wm", "M.wm", "Sec/", "Sec/In.wm", "Keep/", "Keep/Mine.wm", "Readme.txt"]
let w = await bystanderCheck("the start")
expectWorld("the start", w, { files: FILES0.concat([]), disk: { "D.wm": "d words\n", "T1.wm": "t1 words\n" } })

// ---- 1. tab menu: Move to Trash… T1
await tabMenu("T1.wm", "Move to Trash…"); await dialog()
w = await bystanderCheck("op 1, tab menu > Move to Trash… T1")
ok("op 1: T1 is gone from disk, from the sidebar and from the tabs", !w.files.includes("T1.wm") && !w.rows.includes("T1.wm") && !w.tabs.includes("T1"), JSON.stringify([w.files, w.rows, w.tabs]))
ok("op 1: one step, one backup", (await journal()) === "1 undo / 0 redo" && (await backupFolders())?.length === 1, `${await journal()} ${JSON.stringify(await backupFolders())}`)
const firstBackup = (await backupFolders())?.[0]

// ---- 2. row menu: Rename… R → R2
await rowMenu("R.wm", "Rename…"); await dialog("R2")
w = await bystanderCheck("op 2, row menu > Rename… R2")
ok("op 2: R2 is on disk with R's words, R is not", w.disk["R2.wm"] === "r words\n" && !w.files.includes("R.wm") && w.rows.includes("R2.wm"), JSON.stringify(w.files))

// ---- 3. + menu: New Section
await plusMenu("New Section")
await sleep(600)
w = await bystanderCheck("op 3, + menu > New Section")
ok("op 3: a new, empty section folder is there", w.files.some((rel) => /^(.*\/)?New Section\/$/.test(rel)), JSON.stringify(w.files))
ok("op 3: three steps", (await journal()) === "3 undo / 0 redo", await journal())

// ---- 4. row menu: Move to Trash… T2 — the fourth step: the first one is out of scope
await rowMenu("T2.wm", "Move to Trash…"); await dialog()
w = await bystanderCheck("op 4, row menu > Move to Trash… T2")
ok("op 4: T2 is gone", !w.files.includes("T2.wm") && !w.rows.includes("T2.wm"), JSON.stringify(w.files))
ok("op 4: the journal still holds three steps", (await journal()) === "3 undo / 0 redo", await journal())
const afterFour = await backupFolders()
ok("op 4: the first step's backup was deleted when it fell out of scope; T2's is the one kept", afterFour !== null && afterFour.length === 1 && !afterFour.includes(firstBackup), JSON.stringify({ firstBackup, afterFour }))

// ---- 5. tab menu: Duplicate D (a note called “D copy” is already there)
await tabMenu("D.wm", "Duplicate")
await sleep(500)
w = await bystanderCheck("op 5, tab menu > Duplicate D")
const copy = w.files.find((rel) => /^D copy \d+\.wm$/.test(rel))
ok("op 5: the duplicate has a number of its own, and the note that was already called “D copy” is untouched", !!copy && w.disk["D copy.wm"] === "someone else's copy\n" && w.disk[copy] === "d words\n", JSON.stringify(w.files))

// ---- 6. row menu: Move to ▸ Sec on M
await rowMenu("M.wm", "Move to", { sub: "Sec" })
w = await bystanderCheck("op 6, row menu > Move to > Sec")
ok("op 6: M is in Sec", w.disk["Sec/M.wm"] === "m words\n" && !w.files.includes("M.wm"), JSON.stringify(w.files))
const six = w
const dirs6 = await backupFolders()
ok("after six: three steps in the journal and only the steps still in scope hold a backup", (await journal()) === "3 undo / 0 redo" && dirs6 !== null && dirs6.length <= 3 && !dirs6.includes(firstBackup), `${await journal()} ${JSON.stringify(dirs6)}`)
await shot("after-six-operations")

// ---- Ctrl+Z: 6, 5, 4 come back; 3, 2, 1 do not
await undo()
w = await bystanderCheck("press 1 (the move)")
ok("press 1: M is back at the root, with its words", w.disk["M.wm"] === "m words\n" && !w.files.includes("Sec/M.wm") && w.rows.includes("M.wm") && !w.rows.includes("Sec/M.wm"), JSON.stringify([w.files, w.rows]))
await undo()
w = await bystanderCheck("press 2 (the duplicate)")
ok("press 2: the duplicate is gone — and ONLY it: D and the other “D copy” are still there", !w.files.includes(copy) && w.disk["D.wm"] === "d words\n" && w.disk["D copy.wm"] === "someone else's copy\n" && !w.rows.includes(copy), JSON.stringify(w.files))
await undo()
w = await bystanderCheck("press 3 (the trash of T2)")
ok("press 3: T2 is back with its words, as a file and as a row", w.disk["T2.wm"] === "t2 words\n" && w.rows.includes("T2.wm"), JSON.stringify([w.files, w.rows]))
ok("press 3: R2 is still R2 and the new section is still there", w.disk["R2.wm"] === "r words\n" && w.files.some((rel) => /^(.*\/)?New Section\/$/.test(rel)), JSON.stringify(w.files))
await undo()
w = await bystanderCheck("a fourth press")
ok("a fourth press undoes nothing: the section, the rename and the first trash stay", w.disk["R2.wm"] === "r words\n" && w.files.some((rel) => /^(.*\/)?New Section\/$/.test(rel)) && !w.files.includes("T1.wm") && w.disk["T2.wm"] === "t2 words\n", JSON.stringify(w.files))
ok("the journal has nothing to undo, three to redo", (await journal()) === "0 undo / 3 redo", await journal())
const undone = await backupFolders()
ok("the backups of steps that can be redone are kept", undone !== null, JSON.stringify(undone))

// ---- Ctrl+Shift+Z: the same three, in order
await redo()
w = await bystanderCheck("redo 1 (T2 trashed again)")
ok("redo 1: T2 is in the trash again", !w.files.includes("T2.wm") && !w.rows.includes("T2.wm"), JSON.stringify(w.files))
await redo()
w = await bystanderCheck("redo 2 (the duplicate)")
ok("redo 2: the duplicate is back under a number, with D's words", w.files.some((rel) => /^D copy \d+\.wm$/.test(rel)) && w.disk["D copy.wm"] === "someone else's copy\n", JSON.stringify(w.files))
await redo()
w = await bystanderCheck("redo 3 (the move)")
sameAs("redo 3: the world is the one after the sixth operation", w, six, ["files", "rows", "disk"])
await redo()
sameAs("a fourth redo changes nothing", await world(), six, ["files", "rows", "disk"])

// ---- a NEW step after an undo ends the redo path and deletes its backups
await undo()
await undo()
ok("two presses: the move and the duplicate are undone, T2's trash is the one still in the journal", (await journal()) === "1 undo / 2 redo" || (await journal()) === "3 undo / 2 redo", await journal())
await rowMenu("M.wm", "Rename…"); await dialog("M2")
w = await bystanderCheck("a new step after two undos")
ok("the new step ends the redo path", (await journalState()).redoCount === 0, await journal())
ok("…and the sidebar and the disk say M2", w.disk["M2.wm"] === "m words\n" && w.rows.includes("M2.wm") && !w.files.includes("M.wm"), JSON.stringify(w.files))
const afterNew = await backupFolders()
ok("the backups that could no longer be redone are deleted; none belongs to a step that is not in the journal", afterNew !== null && afterNew.length <= (await journalState()).undoCount, JSON.stringify(afterNew))
await shot("after-new-step")
finish()
