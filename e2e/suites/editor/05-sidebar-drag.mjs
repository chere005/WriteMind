// Dragging a row in the sidebar: reorder within a folder, move into a section, a section into a section,
// onto the blank list (the root), and a section never into itself. (Was wm/drag.mjs.)
import fs from "node:fs"
import path from "node:path"
import { ok, finish, js, sleep, notesDir, resetNotes, writeNoteFile, reloadApp, openNote, doc, VIEW } from "../../lib/harness.mjs"

await resetNotes({ reload: false })
const notes = await notesDir()
fs.mkdirSync(path.join(notes, "Sec"), { recursive: true }); fs.mkdirSync(path.join(notes, "Sec2"), { recursive: true })
await writeNoteFile("Sec/In.md", "inside\n")
const now = Date.now() / 1000
for (const [i, f] of ["A1", "A2", "A3"].entries()) {
  const file = await writeNoteFile(`${f}.md`, `note ${f}\n`)
  fs.utimesSync(file, now - 100 + i * 10, now - 100 + i * 10)
}
await reloadApp()

const order = () => js(`[...document.querySelectorAll('.note-row')].map(r=>r.dataset.path.split(/[\\\\/]/).pop()).filter(n=>/^A\\d/.test(n))`)
const drag = (from, to) => js(`(async()=>{
  const q=(p)=>[...document.querySelectorAll('[data-path]')].find(e=>e.dataset.path.replace(/\\\\/g,'/').endsWith(p))
  const src=q(${JSON.stringify(from)}), tgt=q(${JSON.stringify(to)})
  if(!src||!tgt) return 'missing '+(!src?'src ':'')+(!tgt?'tgt':'')
  const dt=new DataTransfer()
  const ev=(el,type)=>el.dispatchEvent(new DragEvent(type,{bubbles:true,cancelable:true,dataTransfer:dt}))
  ev(src,'dragstart'); await new Promise(r=>setTimeout(r,30)); ev(tgt,'dragenter'); ev(tgt,'dragover')
  await new Promise(r=>setTimeout(r,30))
  const showed={above:tgt.classList.contains('drop-above'),into:tgt.classList.contains('drop-into')}
  ev(tgt,'drop'); ev(src,'dragend')
  return JSON.stringify(showed)})()`)
const exists = (rel) => fs.existsSync(path.join(notes, rel))

let o = await order()
ok("the default order is newest first", o.join() === "A3.md,A2.md,A1.md", o.join())

// 1. reorder: A1 dropped on A3 takes A3's place
const showed = await drag("/A1.md", "/A3.md")
await sleep(900)
o = await order()
ok("the dragged row takes the target's place", o.join() === "A1.md,A3.md,A2.md", o.join())
ok("the drop line showed over the target", JSON.parse(showed).above, showed)
const orderFile = JSON.parse(fs.readFileSync(path.join(notes, ".writemind", "order.json"), "utf8"))
ok("the order file remembers it", orderFile.folders[""]?.filter((n) => /^A[0-9]/.test(n)).join() === "A1.md,A3.md,A2.md", JSON.stringify(orderFile))
await reloadApp()
o = await order()
ok("the order survives a reload", o.join() === "A1.md,A3.md,A2.md", o.join())

// 2. open A2, then drop it onto the Sec section: the file moves and the tab follows
await openNote("A2")
ok("A2 is open", (await doc()).includes("note A2"))
await drag("/A2.md", "/Sec")
await sleep(1200)
ok("the file moved into the section", exists("Sec/A2.md") && !exists("A2.md"))
const footer = await js(`document.querySelector('.footer span')?.textContent`)
ok("the open note followed it", footer === "A2.md" && (await doc()).includes("note A2"), footer)
ok("and its tab is still the one in front", (await js(`document.querySelector('.tab.open')?.textContent`)).startsWith("A2"))
o = await order()
ok("it left the root list", !o.includes("A2.md"), o.join())
await js(`${VIEW}.dispatch({changes:{from:0,insert:"moved "}})`)
await sleep(1000)
ok("a save after the move lands in the new folder", fs.readFileSync(path.join(notes, "Sec/A2.md"), "utf8").startsWith("moved note A2"))
ok("and nothing is left behind", !exists("A2.md"))

// 3. a row dropped on a note in another section lands beside it
await js(`[...document.querySelectorAll('.section-row')].find(r=>r.dataset.path.endsWith('Sec')).click()`); await sleep(300)
await drag("/A3.md", "/Sec/In.md")
await sleep(1000)
ok("a note dropped on a row in a section moves there", exists("Sec/A3.md") && !exists("A3.md"))
const sec = JSON.parse(fs.readFileSync(path.join(notes, ".writemind", "order.json"), "utf8")).folders["Sec"]
ok("and sits before the row it was dropped on", sec && sec.indexOf("A3.md") < sec.indexOf("In.md"), JSON.stringify(sec))

// 4. a section into a section; never into itself
await drag("/Sec2", "/Sec")
await sleep(1000)
ok("a section dropped on a section moves", exists("Sec/Sec2") && !exists("Sec2"))
await drag("/Sec", "/Sec/Sec2")
await sleep(600)
ok("a section cannot be dropped inside itself", exists("Sec/A3.md") && !exists("Sec/Sec2/Sec"))

// 5. dropping on blank space moves a note to the root
await js(`(async()=>{
  const src=[...document.querySelectorAll('[data-path]')].find(e=>e.dataset.path.replace(/\\\\/g,'/').endsWith('/Sec/A3.md'))
  const rows=document.querySelector('.rows'); const dt=new DataTransfer()
  const ev=(el,type)=>el.dispatchEvent(new DragEvent(type,{bubbles:true,cancelable:true,dataTransfer:dt}))
  ev(src,'dragstart'); ev(rows,'dragover'); ev(rows,'drop'); ev(src,'dragend')})()`)
await sleep(1000)
ok("dropped on the blank list it goes to the root", exists("A3.md") && !exists("Sec/A3.md"))
finish()
