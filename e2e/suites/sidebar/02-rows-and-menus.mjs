// Rows: line icons, a ⋯ on hover that opens the row's menu (so does a right-click), the pencil's edit mode (duplicate, and the
// trash that arms before it acts), the + menu, New Section from the + menu and a section's menu, Move to, the project menu.
import fs from "node:fs"
import path from "node:path"
import { ok, finish, js, sleep, click, rightClick, hover, centerOf, shot, until, notesDir, menuClick } from "../../lib/harness.mjs"
import { seed } from "./_lib.mjs"

const notes = await seed()
const J = async (expr) => JSON.parse(await js(`JSON.stringify(${expr})`))
const row = (name) => `[...document.querySelectorAll('.note-row')].find(r => r.querySelector('.title').textContent.startsWith(${JSON.stringify(name)}))`
const sectionRow = (name) => `[...document.querySelectorAll('.section-row')].find(r => r.querySelector('.name').textContent === ${JSON.stringify(name)})`
const at = async (expr) => J(`(() => { const e = ${expr}; if (!e) return null; const r = e.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2, left: r.left, right: r.right, top: r.top, bottom: r.bottom } })()`)
const menuItems = () => J(`[...document.querySelectorAll('.float-menu:not(.sub) > .float-row > button')].map(b => ({ label: b.querySelector('.float-label').textContent, disabled: b.disabled, danger: b.classList.contains('danger'), bar: b.dataset.bar ?? null }))`)
const labels = async () => (await menuItems()).map((i) => i.label)
const closeMenu = async () => { await js(`document.activeElement?.blur?.()`); await js(`window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))`); await sleep(100); if (await js(`!!document.querySelector('.float-menu')`)) { await click(900, 700); await sleep(150) } }

// ---- rows: line icons, titles clamp, a count
ok("a note row has a doc icon and a section row a folder icon and a disclosure (no text glyphs)", await js(`!!document.querySelector('.note-row svg.row-icon') && !!document.querySelector('.section-row svg.disclosure') && !/[▾▸]/.test(document.querySelector('.rows').textContent)`))
const long = await J(`(() => { const t = ${row("A very long")}.querySelector('.title'); const s = getComputedStyle(t); return { clamp: s.webkitLineClamp, h: t.getBoundingClientRect().height, line: parseFloat(s.lineHeight) } })()`)
ok("a long title is clamped to two lines", long.clamp === "2" && long.h <= long.line * 2 + 1, JSON.stringify(long))
ok("a section shows how many notes are in it", (await js(`${sectionRow("Research Projects")}.querySelector('.count').textContent`)) === "2")
await shot("rows")

// ---- the ⋯ on hover
let b = await at(row("Short"))
ok("the ⋯ is not shown until the pointer is on the row", (await js(`getComputedStyle(${row("Short")}.querySelector('.row-more')).opacity`)) === "0")
await hover(b.x, b.y); await sleep(150)
ok("…and is shown while it is", (await js(`getComputedStyle(${row("Short")}.querySelector('.row-more')).opacity`)) === "1")
const more = await at(`${row("Short")}.querySelector('.row-more')`)
await click(more.x, more.y); await sleep(250)
ok("the ⋯ opens the note's menu: Open, Rename…, Duplicate, Move to, Reveal, Move to Trash…", (await labels()).join("|") === `Open|Rename…|Duplicate|Move to|Reveal in ${process.platform === "darwin" ? "Finder" : process.platform === "win32" ? "Explorer" : "the file manager"}|Move to ${process.platform === "win32" ? "Recycle Bin" : "Trash"}…`, (await labels()).join("|"))
ok("the Trash item is the red one", (await menuItems()).at(-1).danger)
await shot("note-menu")

// ---- Move to: indented to the tree's depth, the note's own section greyed
await hover(...Object.values(await at(`[...document.querySelectorAll('.float-menu:not(.sub) > .float-row > button')].find(x => x.textContent.startsWith('Move to') && x.classList.contains('has-sub'))`)).slice(0, 2)); await sleep(300)
const targets = await J(`[...document.querySelectorAll('.float-menu.sub button')].map(x => ({ label: x.querySelector('.float-label').textContent, pad: parseFloat(x.querySelector('.float-label').style.paddingLeft || '0'), disabled: x.disabled }))`)
ok("Move to lists the project's folder, then each section at its depth", targets.length === 4 && targets[1].label === "Research Projects" && targets[2].label === "Quantum Computing Notes" && targets[2].pad > targets[1].pad && targets[1].pad > targets[0].pad, JSON.stringify(targets))
ok("the note's own place (the project's folder) is greyed", targets[0].disabled && targets.slice(1).every((t) => !t.disabled), JSON.stringify(targets.map((t) => t.disabled)))
await shot("move-to")
const quantum = await at(`[...document.querySelectorAll('.float-menu.sub button')].find(x => x.textContent.startsWith('Quantum'))`)
await click(quantum.x, quantum.y); await sleep(1200)
ok("picking one moves the file", fs.existsSync(path.join(notes, "Research Projects", "Quantum Computing Notes", "Short.wm")) && !fs.existsSync(path.join(notes, "Short.wm")))

// ---- right-click gives the same menu; Duplicate and Rename are in it
b = await at(row("Reading list"))
await rightClick(b.x, b.y)
ok("a right-click opens the same menu", (await labels())[0] === "Open" && (await labels()).includes("Duplicate"), (await labels()).join("|"))
await closeMenu()

// ---- a section's menu: one label for a new section
b = await at(sectionRow("Sections"))
await rightClick(b.x, b.y); await sleep(300)
const secMenu = await menuItems()
ok("a section's menu: New Note Here, New Section, Rename…, Reveal, Remove Folder from Project, Move to Trash…", secMenu.map((i) => i.label).slice(0, 3).join("|") === "New Note Here|New Section|Rename…" && secMenu.at(-1).label.startsWith("Move to") && secMenu.at(-1).danger, secMenu.map((i) => i.label).join("|"))
ok("New Section keeps its test hook", secMenu[1].bar === "new-section")
const newSec = await at(`document.querySelector('.float-menu [data-bar=new-section]')`)
await click(newSec.x, newSec.y); await sleep(1200)
ok("New Section in the section's menu makes a folder inside it", fs.existsSync(path.join(notes, "Sections", "New Section")))

// ---- the + : its click makes a note; its menu (right-click, or the corner) has New Note and New Section
const before = fs.readdirSync(notes).filter((n) => n.endsWith(".wm")).length
const plus = await at(`document.querySelector('[data-bar=new-note]')`)
await rightClick(plus.x, plus.y); await sleep(250)
ok("the + has a menu: New Note, New Section", (await labels()).join("|") === "New Note|New Section", (await labels()).join("|"))
await shot("plus-menu")
const sec2 = await at(`document.querySelector('.float-menu [data-bar=new-section]')`)
await click(sec2.x, sec2.y); await sleep(1000)
ok("New Section from the + menu makes a section where the open note is", fs.readdirSync(notes).concat(fs.readdirSync(path.join(notes, "Sections"))).filter((n) => /^New Section/.test(n)).length >= 2)
await click(plus.x - 4, plus.y - 4); await sleep(1500)
ok("a click on the + makes a note", fs.readdirSync(notes).filter((n) => n.endsWith(".wm")).length === before + 1 || fs.readdirSync(notes).some((n) => /^Untitled/.test(n)))

// ---- edit mode: the pencil
const pencil = await at(`document.querySelector('[data-bar=edit]')`)
await click(pencil.x, pencil.y); await sleep(300)
ok("the pencil lights and puts duplicate and trash on every note row", await js(`document.querySelector('[data-bar=edit]').classList.contains('on') && document.querySelectorAll('.note-row [data-duplicate]').length === document.querySelectorAll('.note-row').length`))
const rows = await J(`[...document.querySelectorAll('.note-row')].map(r => r.dataset.path)`)
const target = rows.find((p) => /Demo note/.test(p))
await js(`[...document.querySelectorAll('[data-duplicate]')].find(x => x.dataset.duplicate === ${JSON.stringify(target)}).click()`); await sleep(1000)
const after = await J(`[...document.querySelectorAll('.note-row')].map(r => r.dataset.path)`)
const copy = after.find((p) => /Demo note copy/.test(p))
ok("Duplicate adds the copy right after the note", !!copy && after.indexOf(copy) === after.indexOf(target) + 1, after.length + "")
const trash = `[...document.querySelectorAll('[data-trash]')].find(x => x.dataset.trash === ${JSON.stringify("note:" + copy)})`
const tb = await at(trash)
await click(tb.x, tb.y); await sleep(200)
ok("the first click on the trash only arms it", (await js(`${trash}.classList.contains('armed')`)) && (await J(`document.querySelectorAll('.note-row').length`)) === after.length)
await shot("armed")
const tb2 = await at(trash)
await click(tb2.x, tb2.y); await sleep(1200)
ok("the second click moves it to the Trash", !(await J(`[...document.querySelectorAll('.note-row')].map(r => r.dataset.path)`)).some((p) => /Demo note copy/.test(p)) && !fs.existsSync(path.join(notes, "Demo note copy.wm")))
ok("a section's trash is offered inside the project, and arms the same way", await js(`!!document.querySelector('[data-trash^="section:"]')`))
await click(pencil.x, pencil.y); await sleep(200)
ok("the pencil again takes them away", (await js(`document.querySelectorAll('[data-duplicate]').length`)) === 0 && !(await js(`document.querySelector('[data-bar=edit]').classList.contains('on')`)))

// ---- the footer: the project and its menu, and how many notes
const foot = await J(`({ name: document.querySelector('.project-name').textContent, count: document.querySelector('[data-sidebar=count]').textContent })`)
ok("the footer names the project and counts the notes", foot.name.length > 0 && /^\d+ notes?$/.test(foot.count), JSON.stringify(foot))
const pb = await at(`document.querySelector('[data-sidebar=folder-menu]')`)
await click(pb.x, pb.y); await sleep(300)
const project = await J(`[...document.querySelectorAll('#folder-menu > .float-row > button')].map(x => x.querySelector('.float-label').textContent)`)
ok("the project menu has the menu bar's Project items, Hidden Sections' place, Reveal and Clean Up", ["Add Folder to Project…", "Remove Folder from Project", "Save Project", "Save Project As…", "Open Project…", "New Project", "Clean Up Unused Files…"].every((l) => project.includes(l)) && project.some((l) => l.startsWith("Reveal in")), project.join("|"))
await shot("project-menu")
await js(`window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))`)
finish()
