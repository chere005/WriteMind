// The add row ("+ New note", at the top of every section) is a drop target: a note dropped on it moves into that section, at
// the top, where a new note would land; a section dropped on it moves inside that section; no-ops change nothing.
import fs from "node:fs"
import path from "node:path"
import { ok, finish, js, sleep, shot, reloadApp } from "../../lib/harness.mjs"
import { seed } from "./_lib.mjs"

const notes = await seed()
fs.mkdirSync(path.join(notes, "Empty"), { recursive: true })
await reloadApp()
const exists = (rel) => fs.existsSync(path.join(notes, rel))
const orderOf = (folder) => JSON.parse(fs.readFileSync(path.join(notes, ".writemind", "order.json"), "utf8")).folders[folder] ?? []
const rowOf = (rel) => `[...document.querySelectorAll('[data-path]')].find(e => e.dataset.path.replace(/\\\\/g, '/').endsWith(${JSON.stringify("/" + rel)}))`
/** Drag `rel` onto the add row of `section` (null: the project folder's own), with the DataTransfer a real drag has. */
const dropOnAdd = (rel, section) => js(`(async () => {
  const src = ${rowOf(rel)}
  const tgt = ${section === null ? `document.querySelector('[data-add]')` : `[...document.querySelectorAll('[data-add]')].find(e => e.dataset.add.replace(/\\\\/g, '/').endsWith(${JSON.stringify("/" + section)}))`}
  if (!src || !tgt) return 'missing ' + (!src ? 'src ' : '') + (!tgt ? 'tgt' : '')
  const dt = new DataTransfer()
  const ev = (el, type) => el.dispatchEvent(new DragEvent(type, { bubbles: true, cancelable: true, dataTransfer: dt }))
  ev(src, 'dragstart'); await new Promise(r => setTimeout(r, 40)); ev(tgt, 'dragenter'); ev(tgt, 'dragover')
  await new Promise(r => setTimeout(r, 40))
  const lit = tgt.classList.contains('drop-over')
  ev(tgt, 'drop'); ev(src, 'dragend')
  return JSON.stringify({ lit })
})()`)

// 1. a note from the project folder dropped on a section's add row lands in it, first
let r = JSON.parse(await dropOnAdd("Short.wm", "Sections"))
ok("the add row lights while a row is over it", r.lit === true, JSON.stringify(r))
await sleep(1200)
ok("the note moved into the section", exists("Sections/Short.wm") && !exists("Short.wm"))
ok("and sits first there, where a new note would land", orderOf("Sections")[0] === "Short.wm", JSON.stringify(orderOf("Sections")))
await shot("dropped")

// 2. dropped on the add row of the section it is already first in: nothing happens
const stamp = fs.statSync(path.join(notes, "Sections", "Short.wm")).mtimeMs
await dropOnAdd("Sections/Short.wm", "Sections")
await sleep(600)
ok("a note already first in that section stays as it is", exists("Sections/Short.wm") && JSON.stringify(orderOf("Sections")[0]) === '"Short.wm"' && fs.statSync(path.join(notes, "Sections", "Short.wm")).mtimeMs === stamp)

// 3. a note that is second in its section, dropped on that section's add row, becomes first
await dropOnAdd("Sections/Second note.wm", "Sections")
await sleep(1000)
ok("a second note dropped on its own section's add row goes to the top", orderOf("Sections")[0] === "Second note.wm", JSON.stringify(orderOf("Sections")))

// 4. onto the add row of an empty section (nothing to go before)
await dropOnAdd("Gauge basics.wm", "Empty")
await sleep(1000)
ok("an empty section takes it", exists("Empty/Gauge basics.wm") && !exists("Gauge basics.wm"))

// 5. onto the project folder's own add row (the top of the list)
await dropOnAdd("Sections/Short.wm", null)
await sleep(1000)
ok("the project folder's add row takes a note out of a section", exists("Short.wm") && !exists("Sections/Short.wm") && orderOf("")[0] === "Short.wm", JSON.stringify(orderOf("")))

// 6. a section on another section's add row moves inside it; on its parent's add row or its own, nothing
await dropOnAdd("Empty", "Sections")
await sleep(1200)
ok("a section dropped on another section's add row moves inside it", exists("Sections/Empty/Gauge basics.wm") && !exists("Empty"))
await dropOnAdd("Sections/Empty", "Sections")
await sleep(500)
ok("…and dropped on its parent's add row it stays", exists("Sections/Empty/Gauge basics.wm"))
await dropOnAdd("Sections", "Sections/Empty")
await sleep(500)
ok("a section is never moved inside itself", exists("Sections/Second note.wm") && !exists("Sections/Empty/Sections"))
finish()
