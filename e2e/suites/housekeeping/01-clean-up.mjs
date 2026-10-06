// Housekeeping (main/housekeeping.ts, CleanUpDialog.tsx; docs/TODO.md "Housekeeping"), on this instance's own notes
// folder: the sidebar's Move to Recycle Bin takes the note's drawing with it, and File ▸ Clean Up Unused Files…
// (from the menu, and from the sidebar's Folder menu) lists what nothing uses, moves only that, and only after a yes.
// The files it bins are this test's scratch files (they land in the system Recycle Bin / Trash, as a person's would).
import fs from "node:fs"
import path from "node:path"
import { createHash } from "node:crypto"
import {
  ok, finish, js, sleep, notesDir, resetNotes, writeNoteFile, reloadApp, openNote, rightClick, click, centerOf, waitFor,
  menuClick, shot, key, VIEW, doc,
} from "../../lib/harness.mjs"

await resetNotes({ reload: false })
const notes = await notesDir()
const hourAgo = Date.now() / 1000 - 3600
const old = (file) => { fs.utimesSync(file, hourAgo, hourAgo); return file }
const put = (rel, text, fresh = false) => {
  const file = path.join(notes, rel)
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, text)
  return fresh ? file : old(file)
}
// notes.ts drawingPath: `.drawings/<stem>-<sha1 of the path from the project folder, 12>.json`.
const sidecar = (rel) => path.join(".drawings", `${path.basename(rel, ".md")}-${createHash("sha1").update(rel).digest("hex").slice(0, 12)}.json`)
const stroke = { kind: "stroke", id: "s1", colorHex: "#2f6fdf", width: 3, points: [{ x: 0.1, y: 0.1 }, { x: 0.3, y: 0.2 }], transform: { dx: 0, dy: 0, scale: 1, rotation: 0 }, group: null }

put("Kept.md", "# Kept\n\n![](.drawings/media/used.png)\n")
put("Gone.md", "# Gone\n\nThis note goes to the bin.\n")
put("Other.md", "# Other\n")
const goneDrawing = put(sidecar("Gone.md"), JSON.stringify({ items: [stroke] }))
const otherDrawing = put(sidecar("Other.md"), JSON.stringify({ items: [stroke] }))
// (Under its real name: a drawing in the notes root's .drawings is offered only when its name is provably this project's.)
const orphan = put(sidecar("Deleted long ago.md"), JSON.stringify({ items: [stroke] }))
const loose = put(path.join(".drawings", "media", "loose.png"), "not really a png")
const used = put(path.join(".drawings", "media", "used.png"), "not really a png")
const undoOnly = put(path.join(".drawings", "media", "undo-only.png"), "not really a png")
const fresh = put(path.join(".drawings", "media", "fresh.png"), "not really a png", true)
await reloadApp()
const exists = (file) => fs.existsSync(file)

// 1. Delete takes the drawing: the row's right-click menu, Move to Recycle Bin…, then the dialog's yes.
const row = await js(`(()=>{const r=[...document.querySelectorAll('.note-row')].find(x=>x.dataset.path?.replace(/\\\\/g,'/').endsWith('/Gone.md'));if(!r)return 'null';const b=r.getBoundingClientRect();return JSON.stringify({x:b.x+b.width/2,y:b.y+b.height/2})})()`)
ok("the note to delete is in the sidebar", row !== "null", row)
const at = JSON.parse(row)
await rightClick(at.x, at.y); await sleep(300)
const binItem = await js(`(()=>{const b=[...document.querySelectorAll('.float-menu button')].find(x=>/^Move to (Recycle Bin|Trash)/.test(x.textContent));if(!b)return 'null';const r=b.getBoundingClientRect();return JSON.stringify({x:r.x+r.width/2,y:r.y+r.height/2})})()`)
ok("its menu has Move to Recycle Bin…", binItem !== "null")
const bi = JSON.parse(binItem)
await click(bi.x, bi.y); await sleep(300)
const yes = await centerOf('[data-modal="prompt"] [data-modal="ok"]')
await click(yes.x, yes.y)
await waitFor(`!document.querySelector('[data-modal="prompt"]')`)
await sleep(800)
ok("the note went to the bin", !exists(path.join(notes, "Gone.md")))
ok("and its drawing went with it", !exists(path.join(notes, sidecar("Gone.md"))), goneDrawing)
ok("another note's drawing stayed", exists(otherDrawing))

// 2. A picture that is only in the open note's Undo (added, then taken out again, and the note saved without it).
await openNote("Kept"); await sleep(400)
await js(`(()=>{const v=${VIEW};const end=v.state.doc.length;v.dispatch({changes:{from:end,insert:"\\n![](.drawings/media/undo-only.png)\\n"}});})()`)
// (Apart by more than the history's 500 ms: two edits closer than that are one Undo step, and these two cancel out.)
await sleep(1200)
await js(`(()=>{const v=${VIEW};const t=v.state.doc.toString();const i=t.indexOf("\\n![](.drawings/media/undo-only.png)\\n");v.dispatch({changes:{from:i,to:i+"\\n![](.drawings/media/undo-only.png)\\n".length}})})()`)
await sleep(2500)
ok("the note on disk no longer names it", !fs.readFileSync(path.join(notes, "Kept.md"), "utf8").includes("undo-only.png") && !(await doc()).includes("undo-only.png"))

// 3. File ▸ Clean Up Unused Files…: the list, then Cancel moves nothing.
ok("File ▸ Clean Up Unused Files… is a menu item", await menuClick("cleanUp"))
await waitFor(`!!document.querySelector('[data-cleanup="list"]')`, 10000)
const listed = await js(`JSON.stringify([...document.querySelectorAll('[data-cleanup-file]')].map(e=>e.dataset.cleanupFile))`).then(JSON.parse)
const title = await js(`document.querySelector('[data-modal="cleanup"] h3')?.textContent`)
const base = (list) => list.map((file) => path.basename(file)).sort()
ok("it lists the orphan drawing and the loose picture, nothing else", JSON.stringify(base(listed)) === JSON.stringify([path.basename(orphan), "loose.png"]), JSON.stringify(base(listed)))
ok("the title says how many, how big and where they go", /^2 unused files \(\d+ bytes\) will go to the (Recycle Bin|Trash)$/.test(title ?? ""), title)
ok("Cancel has the focus", await js(`document.activeElement?.dataset.modal === "cancel"`))
await shot("dialog")
const cancel = await centerOf('[data-modal="cleanup"] [data-modal="cancel"]')
await click(cancel.x, cancel.y)
await waitFor(`!document.querySelector('[data-modal="cleanup"]')`)
ok("Cancel closes it and moves nothing", exists(orphan) && exists(loose) && exists(used) && exists(undoOnly) && exists(fresh))

// 4. From the sidebar's Folder menu, and this time the yes.
const folderButton = await centerOf('[data-sidebar="folder-menu"]')
await click(folderButton.x, folderButton.y); await sleep(300)
const cleanItem = await js(`(()=>{const b=[...document.querySelectorAll('#folder-menu button')].find(x=>x.textContent.startsWith('Clean Up Unused Files'));if(!b)return 'null';const r=b.getBoundingClientRect();return JSON.stringify({x:r.x+r.width/2,y:r.y+r.height/2})})()`)
ok("the sidebar's Folder menu has Clean Up Unused Files…", cleanItem !== "null")
const ci = JSON.parse(cleanItem)
await click(ci.x, ci.y)
await waitFor(`!!document.querySelector('[data-cleanup="list"]')`, 10000)
const move = await centerOf('[data-modal="cleanup"] [data-modal="ok"]')
await click(move.x, move.y)
await waitFor(`!!document.querySelector('[data-cleanup="done"]')`, 10000)
const doneTitle = await js(`document.querySelector('[data-modal="cleanup"] h3')?.textContent`)
ok("it says what it moved", /^2 files moved to the (Recycle Bin|Trash)$/.test(doneTitle ?? ""), doneTitle)
await shot("moved")
ok("the two unused files are gone from the folder", !exists(orphan) && !exists(loose))
ok("the used picture, the one in Undo and the fresh one stayed", exists(used) && exists(undoOnly) && exists(fresh))
ok("the notes and the other drawing are untouched", exists(path.join(notes, "Kept.md")) && exists(otherDrawing))
const okButton = await centerOf('[data-modal="cleanup"] [data-modal="ok"]')
await click(okButton.x, okButton.y)
await waitFor(`!document.querySelector('[data-modal="cleanup"]')`)

// 5. Again: nothing left to offer, and the fresh file is said to be left alone; Escape closes.
await menuClick("cleanUp")
await waitFor(`!!document.querySelector('[data-cleanup="none"]')`, 10000)
const none = await js(`document.querySelector('[data-cleanup="none"]')?.textContent`)
ok("a second look finds nothing, and says a recent file was left alone", /left alone/.test(none ?? ""), none)
await shot("nothing")
await key("Escape")
await sleep(300)
ok("Escape closes it", !(await js(`!!document.querySelector('[data-modal="cleanup"]')`)))
finish()
