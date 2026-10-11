// @e2e isolated
// @e2e timeout=240
// MOVING A TAB WITHOUT A DRAG (Sean, 2026-10-10: "add rearranging tabs"): Move Tab Left / Right in a tab's right-click menu (greyed at the
// ends; it moves the tab clicked, not the one in front), and the commands moveTabLeft / moveTabRight on Ctrl+Shift+PageUp / PageDown
// (the tab in front goes one place over; at the ends nothing), which the Window menu carries, greyed at the ends. The tab in front stays
// in front, nothing is written to a note, Undo has nothing new, the open-notes list shows the order, the order survives a reload, and
// F1's key list names both keys.
import fs from "node:fs"
import path from "node:path"
import {
  js, ok, finish, sleep, shot, seedNotes, closeAllTabs, openNote, centerOf, rightClick, key, notesDir, menu, menuClick, reloadApp,
  waitFor, clickEl,
} from "../../lib/harness.mjs"
const J = async (expr) => JSON.parse(await js(`JSON.stringify(${expr})`))

const names = ["Alpha", "Bravo", "Charlie", "Delta"]
await seedNotes(Object.fromEntries(names.map((n, i) => [`${n}.md`, `# ${n}\n\nbody ${i}\n`])), { clean: true })
await js(`localStorage.clear()`)
await closeAllTabs()
for (const n of names) await openNote(n)

const order = () => J(`[...document.querySelectorAll('.tab-strip .tab')].map((t) => t.querySelector('.name').textContent)`)
const front = () => js(`document.querySelector('.tab-strip .tab.open .name')?.textContent ?? null`)
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b)
const root = await notesDir()
const mtimes = () => Object.fromEntries(fs.readdirSync(root).filter((f) => /\.(wm|md)$/.test(f)).map((f) => [f, fs.statSync(path.join(root, f)).mtimeMs]))
const undoLabel = async () => (await menu()).find((m) => m.label === "Edit")?.submenu.find((i) => /^Undo/.test(i.label))?.label
const windowItems = async () => {
  await sleep(300)   // (the page tells the shell, which rebuilds the menu)
  const win = (await menu()).find((m) => m.label === "Window")?.submenu ?? []
  return Object.fromEntries(win.filter((i) => /^Move Tab/.test(i.label ?? "")).map((i) => [i.label, i.enabled !== false]))
}
const PAGE = { ctrl: true, shift: true }
const left = async () => { await key("PageUp", PAGE); await sleep(300) }
const right = async () => { await key("PageDown", PAGE); await sleep(300) }
const menuRows = () => J(`[...document.querySelectorAll('#tab-menu > .float-row > button')].map((b) => ({ text: b.textContent.trim(), disabled: b.disabled }))`)
const rowClick = (text) => js(`[...document.querySelectorAll('#tab-menu > .float-row > button')].find((b) => b.textContent.trim().startsWith(${JSON.stringify(text)}))?.click()`)
async function openMenuOn(name) {
  const at = await J(`(() => { const b = [...document.querySelectorAll('.tab')].find((t) => t.querySelector('.name').textContent === ${JSON.stringify(name)}).getBoundingClientRect(); return { x: b.x + 20, y: b.y + b.height / 2 } })()`)
  await rightClick(at.x, at.y); await sleep(250)
}
const listed = async () => {
  await clickEl("[data-bar=tab-list]"); await sleep(250)
  const rows = await J(`[...document.querySelectorAll('.float-menu button')].map((b) => ({ text: b.textContent.trim().replace(/^\\u2713\\s*/, ''), checked: b.getAttribute('aria-checked') }))`)
  await key("Escape"); await sleep(200)
  return rows.filter((r) => r.checked !== null).map((r) => r.text)
}

ok("four notes open, the last in front", same(await order(), names) && (await front()) === "Delta")
const filesBefore = mtimes(), undoBefore = await undoLabel()

// ---- THE KEYS: the tab in front goes one place over
await js(`document.querySelector('.cm-content').focus()`)
await left()
ok("Ctrl+Shift+PageUp moves the tab in front one place left, and it stays in front", same(await order(), ["Alpha", "Bravo", "Delta", "Charlie"]) && (await front()) === "Delta", `${await order()} ${await front()}`)
ok("(the note on the page is still Delta's, and the keyboard is still in it)", await js(`document.querySelector('.cm-content').textContent.includes('body 3') && document.activeElement?.classList.contains('cm-content')`))
await left(); await left()
ok("twice more it is first", same(await order(), ["Delta", "Alpha", "Bravo", "Charlie"]) && (await front()) === "Delta", `${await order()}`)
await left()
ok("at the left end Ctrl+Shift+PageUp does nothing", same(await order(), ["Delta", "Alpha", "Bravo", "Charlie"]) && (await front()) === "Delta")
let items = await windowItems()
ok("Window ▸ Move Tab Left is greyed there and Move Tab Right is not", items["Move Tab Left"] === false && items["Move Tab Right"] === true, JSON.stringify(items))
await right()
ok("Ctrl+Shift+PageDown moves it one place right", same(await order(), ["Alpha", "Delta", "Bravo", "Charlie"]) && (await front()) === "Delta", `${await order()}`)
items = await windowItems()
ok("in the middle both Window items are on", items["Move Tab Left"] === true && items["Move Tab Right"] === true, JSON.stringify(items))
await right(); await right(); await right()
ok("it stops at the right end", same(await order(), ["Alpha", "Bravo", "Charlie", "Delta"]) && (await front()) === "Delta", `${await order()}`)
items = await windowItems()
ok("and Move Tab Right is greyed there", items["Move Tab Left"] === true && items["Move Tab Right"] === false, JSON.stringify(items))

// ---- THE WINDOW MENU's items do the same (the menu bar's own click, the way the harness presses it)
await menuClick("moveTabLeft"); await sleep(300)
ok("Window ▸ Move Tab Left moves the tab in front", same(await order(), ["Alpha", "Bravo", "Delta", "Charlie"]) && (await front()) === "Delta", `${await order()}`)
await menuClick("moveTabRight"); await sleep(300)
ok("Window ▸ Move Tab Right moves it back", same(await order(), names) && (await front()) === "Delta", `${await order()}`)
// with another tab in front the keys move THAT one
await openNote("Bravo")
await left()
ok("the keys move whichever tab is in front", same(await order(), ["Bravo", "Alpha", "Charlie", "Delta"]) && (await front()) === "Bravo", `${await order()} ${await front()}`)
items = await windowItems()
ok("(first now: Move Tab Left is greyed)", items["Move Tab Left"] === false && items["Move Tab Right"] === true, JSON.stringify(items))

// ---- THE RIGHT-CLICK MENU: this tab, not the one in front; greyed at the ends
await openMenuOn("Charlie")
let rows = await menuRows()
const l = rows.find((r) => r.text.startsWith("Move Tab Left")), r = rows.find((r) => r.text.startsWith("Move Tab Right"))
ok("Move Tab Left / Right are in the tab's menu, with their keys", !!l && !!r && /PageUp$/.test(l.text) && /PageDown$/.test(r.text), JSON.stringify(rows.map((x) => x.text)))
ok("Charlie is in the middle: both are on", l.disabled === false && r.disabled === false)
await shot("menu")
await rowClick("Move Tab Left"); await sleep(400)
ok("Move Tab Left moves the tab clicked, one place, and the tab in front stays in front", same(await order(), ["Bravo", "Charlie", "Alpha", "Delta"]) && (await front()) === "Bravo", `${await order()} ${await front()}`)
ok("the menu is gone and the keyboard is back in the note", await js(`!document.querySelector('#tab-menu') && document.activeElement?.classList.contains('cm-content')`))
await openMenuOn("Delta")
rows = await menuRows()
ok("on the last tab Move Tab Right is greyed, Move Tab Left is not", rows.find((x) => x.text.startsWith("Move Tab Right")).disabled === true && rows.find((x) => x.text.startsWith("Move Tab Left")).disabled === false)
await rowClick("Move Tab Right"); await sleep(300)
ok("(a greyed row does nothing)", same(await order(), ["Bravo", "Charlie", "Alpha", "Delta"]) || !(await js(`!!document.querySelector('#tab-menu')`)))
await key("Escape"); await sleep(200)
await openMenuOn("Bravo")
rows = await menuRows()
ok("on the first tab Move Tab Left is greyed, Move Tab Right is not", rows.find((x) => x.text.startsWith("Move Tab Left")).disabled === true && rows.find((x) => x.text.startsWith("Move Tab Right")).disabled === false)
await rowClick("Move Tab Right"); await sleep(400)
ok("Move Tab Right moves the first tab (the one in front) one place right", same(await order(), ["Charlie", "Bravo", "Alpha", "Delta"]) && (await front()) === "Bravo", `${await order()} ${await front()}`)

// ---- NOT AN EDIT: nothing written, nothing to undo, the list shows it, a reload keeps it
const now = mtimes()
ok("no note was written", same(now, filesBefore), JSON.stringify({ filesBefore, now }))
ok("Edit ▸ Undo has nothing new to take back", (await undoLabel()) === undoBefore, `${undoBefore} -> ${await undoLabel()}`)
await js(`document.querySelector('.cm-content').focus()`)
await key("z", { ctrl: true }); await sleep(300)
ok("Ctrl+Z does not undo an arrangement", same(await order(), ["Charlie", "Bravo", "Alpha", "Delta"]), `${await order()}`)
ok("the open-notes list shows the order", same(await listed(), ["Charlie", "Bravo", "Alpha", "Delta"]))
await sleep(900)
await reloadApp()
await waitFor(`document.querySelectorAll('.tab').length === 4`, 15000)
ok("after a reload the order and the tab in front are as they were", same(await order(), ["Charlie", "Bravo", "Alpha", "Delta"]) && (await front()) === "Bravo", `${await order()} ${await front()}`)

// ---- one tab, or none: nothing to move
for (let i = 0; i < 6 && (await order()).length > 1; i++) { await js(`[...document.querySelectorAll('.tab')].at(-1).querySelector('.close').click()`); await sleep(500) }
await left(); await right()
items = await windowItems()
ok("a lone tab has nowhere to go: the keys do nothing and both Window items are greyed", (await order()).length === 1 && items["Move Tab Left"] === false && items["Move Tab Right"] === false, JSON.stringify([await order(), items]))
await closeAllTabs(); await sleep(300)
await left()
items = await windowItems()
ok("with no tab open both are greyed, and the key does nothing", (await order()).length === 0 && items["Move Tab Left"] === false && items["Move Tab Right"] === false, JSON.stringify(items))

// ---- F1's key list names them
await menuClick("keyList"); await waitFor(`!!document.querySelector('[data-modal="keys"]')`)
const text = await js(`document.querySelector('[data-modal="keys"]').innerText`)
ok("the key list has Window ▸ Move Tab Left and Right with their keys", /window/i.test(text) && /move tab left/i.test(text) && /move tab right/i.test(text) && /pageup/i.test(text) && /pagedown/i.test(text), JSON.stringify(text.slice(-400)))
await shot("key-list")
await key("Escape"); await sleep(300)
ok("(Escape put it away)", !(await js(`!!document.querySelector('[data-modal="keys"]')`)))
finish()
