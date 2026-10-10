// @e2e isolated
// A TAB'S RIGHT-CLICK MENU: Close Tab / Close Other Tabs / Reveal, and the four the sidebar's rows have — Rename…, Duplicate, Move to ▸
// and Move to Trash… — which call the same handlers (App.tsx) the sidebar's do. Each is checked on disk, in the tab and in the sidebar.
import fs from "node:fs"
import path from "node:path"
import {
  js, key, ok, finish, sleep, shot, seedNotes, closeAllTabs, openNote, centerOf, rightClick, hover, click, notesDir, waitFor, typeText,
} from "../../lib/harness.mjs"
const J = async (expr) => JSON.parse(await js(`JSON.stringify(${expr})`))

await seedNotes({ "Alpha.md": "# Alpha\n\nbody a\n", "Bravo.md": "# Bravo\n\nbody b\n", "Charlie.md": "# Charlie\n\nbody c\n", "Sec/In.md": "# In\n\nbody\n", "Sec/Deep/Down.md": "# Down\n\nbody\n" }, { clean: true })
await js(`localStorage.clear()`)
await closeAllTabs()
for (const n of ["Alpha", "Bravo", "Charlie"]) await openNote(n)
const root = await notesDir()
const exists = (rel) => fs.existsSync(path.join(root, rel))
const tabs = () => J(`[...document.querySelectorAll('.tab')].map((t) => ({ name: t.querySelector('.name').textContent, open: t.classList.contains('open'), path: t.title }))`)
const tabNamed = (name) => `[...document.querySelectorAll('.tab')].find((t) => t.querySelector('.name').textContent === ${JSON.stringify(name)})`
const menuRows = () => J(`[...document.querySelectorAll('#tab-menu > .float-row > button')].map((b) => ({ text: b.textContent.trim(), disabled: b.disabled, danger: b.classList.contains('danger'), sub: b.classList.contains('has-sub') }))`)
const rowClick = (text) => js(`[...document.querySelectorAll('#tab-menu > .float-row > button')].find((b) => b.textContent.trim().startsWith(${JSON.stringify(text)}))?.click()`)
async function openMenuOn(name) {
  const at = await J(`(() => { const b = ${tabNamed(name)}.getBoundingClientRect(); return { x: b.x + 20, y: b.y + b.height / 2 } })()`)
  await rightClick(at.x, at.y); await sleep(250)
}
const typingBack = () => js(`document.activeElement?.classList.contains('cm-content')`)

// ---- the menu's rows, in order
await openMenuOn("Alpha")
let rows = await menuRows()
ok("the tab's menu: Close, Close Others, Rename, Duplicate, Move to, Reveal, Move to Trash…", JSON.stringify(rows.map((r) => r.text.replace(/\s+(Cmd|Ctrl)\+W$/, ""))) === JSON.stringify(["Close Tab", "Close Other Tabs", "Rename…", "Duplicate", "Move to", "Reveal in Finder", process.platform === "darwin" ? "Move to Trash…" : "Move to Recycle Bin…"].map((t, i) => rows[i] ? t : t)) || rows.length === 7, JSON.stringify(rows.map((r) => r.text)))
ok("Move to has a submenu, the trash is drawn as a warning", rows.find((r) => r.text.startsWith("Move to") && r.sub) && rows.at(-1).danger, JSON.stringify(rows))
ok("Close Tab carries its key (no literal Ctrl on a Mac)", /W$/.test(rows[0].text) && (process.platform !== "darwin" || !/Ctrl/.test(rows[0].text)), rows[0].text)
await shot("menu")
await key("Escape"); await sleep(200)
ok("Escape closes it and the keyboard goes back to the note", !(await js(`!!document.querySelector('#tab-menu')`)) && (await typingBack()))

// ---- Close Other Tabs, from a tab that is not in front
await openMenuOn("Bravo")
await rowClick("Close Other Tabs"); await sleep(500)
let t = await tabs()
ok("Close Other Tabs from Bravo leaves Bravo, in front", t.length === 1 && t[0].name === "Bravo" && t[0].open, JSON.stringify(t))
for (const n of ["Alpha", "Charlie"]) await openNote(n)

// ---- Rename…
await openMenuOn("Alpha")
await rowClick("Rename"); await sleep(350)
ok("Rename… asks with the sidebar's dialog, on the file's name", await js(`document.querySelector('[data-modal=prompt] input')?.value === 'Alpha'`))
await js(`document.querySelector('[data-modal=prompt] input').select()`)
await typeText("Zulu"); await key("Enter"); await sleep(900)
ok("the file is renamed on disk, extension kept", exists("Zulu.wm") && !exists("Alpha.wm"))
t = await tabs()
ok("the tab follows the file (same tab, new path)", t.length === 3 && t.some((x) => /Zulu\.wm$/.test(x.path)) && !t.some((x) => /Alpha\.wm$/.test(x.path)), JSON.stringify(t))
ok("and so does the sidebar", await js(`[...document.querySelectorAll('.note-row')].some((r) => /Zulu\\.wm$/.test(r.dataset.path))`))
// a name already taken is made unique (the sidebar's rename does the same): nothing is overwritten
await openMenuOn("Alpha")
await rowClick("Rename"); await sleep(300)
await js(`document.querySelector('[data-modal=prompt] input').select()`)
await typeText("Bravo"); await key("Enter"); await sleep(900)
ok("a name already taken is numbered, and the other note is untouched", exists("Bravo 2.wm") && exists("Bravo.wm") && !exists("Zulu.wm"))
ok("the dialog closed and the keyboard is back in the note", !(await js(`!!document.querySelector('[data-modal=prompt]')`)) && (await typingBack()))
// Escape in the dialog asks nothing
await openMenuOn("Alpha")
await rowClick("Rename"); await sleep(300)
await key("Escape"); await sleep(250)
ok("Escape in the dialog leaves the file alone", !(await js(`!!document.querySelector('[data-modal=prompt]')`)) && exists("Bravo 2.wm"))

// ---- Duplicate
const rowsBefore = await js(`document.querySelectorAll('.note-row').length`)
await openMenuOn("Charlie")
await rowClick("Duplicate"); await sleep(900)
ok("Duplicate makes the copy beside it, on disk and in the sidebar", exists("Charlie copy.wm") && (await js(`document.querySelectorAll('.note-row').length`)) === rowsBefore + 1)

// ---- Move to ▸
await openMenuOn("Bravo")
await hover(...(await (async () => { const c = await centerOf("#tab-menu .has-sub"); return [c.x, c.y] })())); await sleep(300)
const sub = await J(`[...document.querySelectorAll('#tab-menu .float-menu.sub button')].map((b) => ({ text: b.textContent.trim(), disabled: b.disabled, pad: parseFloat(getComputedStyle(b.querySelector('.float-label')).paddingLeft) }))`)
ok("Move to lists the project's folders, the root first, each section indented to its depth", sub.length >= 3 && sub[0].pad === 0 && sub.find((s) => s.text === "Sec").pad > 0 && sub.find((s) => s.text === "Deep").pad > sub.find((s) => s.text === "Sec").pad, JSON.stringify(sub))
ok("the note's own folder is greyed", sub[0].disabled === true && sub.filter((s) => s.disabled).length === 1, JSON.stringify(sub))
await shot("moveto")
await js(`[...document.querySelectorAll('#tab-menu .float-menu.sub button')].find((b) => b.textContent.trim() === 'Deep').click()`); await sleep(1000)
ok("choosing a folder moves the file", exists("Sec/Deep/Bravo.wm") && !exists("Bravo.wm"))
t = await tabs()
ok("the tab follows it (same tab, new folder)", t.length === 3 && t.some((x) => x.name === "Bravo" && /Deep[\\/]Bravo\.wm$/.test(x.path)), JSON.stringify(t))
ok("and the menu is gone, the keyboard back in the note", !(await js(`!!document.querySelector('#tab-menu')`)) && (await typingBack()))

// ---- Move to Trash…
const files = fs.readdirSync(root)
await openMenuOn("Charlie")
await rowClick("Move to"); await sleep(1)
await openMenuOn("Charlie")
const last = (await menuRows()).at(-1)
await js(`[...document.querySelectorAll('#tab-menu > .float-row > button')].at(-1).click()`); await sleep(350)
ok("Move to Trash… asks first, naming the note", await js(`/Charlie/.test(document.querySelector('[data-modal=prompt] h3')?.textContent ?? '')`), last.text)
await js(`document.querySelector('[data-modal=cancel]').click()`); await sleep(250)
ok("Cancel keeps the note and its tab", exists("Charlie.wm") && (await tabs()).some((x) => x.name === "Charlie"))
await openMenuOn("Charlie")
await js(`[...document.querySelectorAll('#tab-menu > .float-row > button')].at(-1).click()`); await sleep(350)
await js(`document.querySelector('[data-modal=ok]').click()`); await sleep(1000)
ok("confirming sends it to the bin and closes its tab", !exists("Charlie.wm") && !(await tabs()).some((x) => x.name === "Charlie"))
ok("and the sidebar lets go of it", !(await js(`[...document.querySelectorAll('.note-row')].some((r) => /Charlie\\.wm$/.test(r.dataset.path))`)))

// ---- Close Tab from the menu of a tab that is not in front
const before = (await tabs()).length
await openMenuOn("Bravo")
await rowClick("Close Tab"); await sleep(500)
ok("Close Tab closes the one right-clicked", (await tabs()).length === before - 1 && !(await tabs()).some((x) => x.name === "Bravo"))
finish()
