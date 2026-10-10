// ONE MODAL for every dialog (docs/PLAN-bars-2026-10.md, P6): the key list, Rename, Move to Trash, Clean Up, About and Language
// setup (the Update dialog has its own script's worth of rules in test/): the page behind is inert while any is up, Tab is
// trapped inside (from the last button it goes to the first), Escape closes it and the keyboard goes back to the notes. Move to
// Trash starts on Cancel and Enter acts only on the button that has the keyboard. The key list is searchable, prints its keys in
// Apple's order on a Mac, and keeps a gutter for its scrollbar.
import fs from "node:fs"
import { ok, finish, js, sleep, waitFor, key, click, rightClick, centerOf, seedNotes, openNote, menuClick, shot, noteRows, writeNoteFile } from "../../lib/harness.mjs"
import { MAC, keyboardIn, rootInert, box } from "../../lib/overlays.mjs"

await seedNotes({ "One.md": "# One\n\nBody.\n", "Two.md": "# Two\n\nSecond.\n" }, { clean: true })
await openNote("One"); await sleep(400)

/** The dialog's tab stops that are on screen, the last one first in the list. */
const stops = () => js(`(()=>{const m=document.querySelector('.modal');return [...m.querySelectorAll('button:not(:disabled), a[href], input:not(:disabled), select:not(:disabled), textarea:not(:disabled), summary')].filter(e=>e.getClientRects().length>0).length})()`)

/** The checks every dialog owes: inert page, Tab trapped both ways, a Tab from the last stop stays inside, Escape closes and gives the notes the keyboard. */
async function owes(name, hook) {
  ok(`${name}: the page behind is inert`, await rootInert())
  ok(`${name}: the dialog has the keyboard`, (await keyboardIn()) === hook, await keyboardIn())
  let inside = true
  for (let i = 0; i < 14; i++) { await key("Tab", { wait: 30 }); if ((await keyboardIn()) !== hook) inside = false }
  ok(`${name}: fourteen Tabs never leave it`, inside, await keyboardIn())
  inside = true
  for (let i = 0; i < 5; i++) { await key("Tab", { shift: true, wait: 30 }); if ((await keyboardIn()) !== hook) inside = false }
  ok(`${name}: Shift+Tab never leaves it`, inside, await keyboardIn())
  // From the very last stop, Tab goes to the first (and from the first, Shift+Tab to the last).
  const n = await stops()
  await js(`(()=>{const m=document.querySelector('.modal');const s=[...m.querySelectorAll('button:not(:disabled), a[href], input:not(:disabled), select:not(:disabled), textarea:not(:disabled), summary')].filter(e=>e.getClientRects().length>0);s[s.length-1].focus()})()`)
  await key("Tab"); await sleep(50)
  ok(`${name}: a Tab from the last of its ${n} stops stays inside`, (await keyboardIn()) === hook, await keyboardIn())
  await key("Escape"); await sleep(350)
  ok(`${name}: Escape closes it`, !(await js(`!!document.querySelector('.modal-backdrop')`)))
  ok(`${name}: the page is live again`, !(await rootInert()))
  ok(`${name}: the keyboard is back in the notes`, (await keyboardIn()) === "editor", await keyboardIn())
}

// ---- the key list
await menuClick("keyList"); await waitFor(`!!document.querySelector('[data-modal="keys"]')`)
ok("Keyboard Shortcuts opens", true)
ok("the search field has the keyboard when it opens", await js(`document.activeElement?.dataset.keys === 'search'`))
const rows = () => js(`[...document.querySelectorAll('[data-modal="keys"] tr[data-command]')].map(r=>r.dataset.command)`)
const all = await rows()
ok("every key is listed, in groups", all.length > 60 && (await js(`document.querySelectorAll('[data-modal="keys"] .key-group').length`)) >= 6, String(all.length))
await shot("keys")
// search
await js(`(()=>{const i=document.querySelector('[data-keys="search"]');const set=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set;set.call(i,'undo');i.dispatchEvent(new Event('input',{bubbles:true}))})()`)
await sleep(250)
const found = await rows()
ok("typing 'undo' narrows the list to the undo commands", found.length >= 2 && found.length < 8 && found.includes("undo") && found.includes("undoDrawing") && !found.includes("save"), JSON.stringify(found))
await js(`(()=>{const i=document.querySelector('[data-keys="search"]');const set=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set;set.call(i,'qqqzz');i.dispatchEvent(new Event('input',{bubbles:true}))})()`)
await sleep(200)
ok("a stranger finds nothing, and says so in one line", (await rows()).length === 0 && /No key matches/.test(await js(`document.querySelector('[data-keys="none"]')?.textContent ?? ''`)))
await key("Escape"); await sleep(200)
ok("Escape clears the search first; the list stays up", (await rows()).length === all.length && await js(`!!document.querySelector('[data-modal="keys"]')`))
if (MAC) {
  const caps = await js(`[...document.querySelectorAll('[data-modal="keys"] tr[data-command="findReplace"] kbd')].map(k=>k.textContent).join('')`)
  ok("a Mac prints Find and Replace as ⌥⌘F (Apple's order)", caps === "⌥⌘F", caps)
  const redo = await js(`[...document.querySelectorAll('[data-modal="keys"] tr[data-command="redo"] kbd')].map(k=>k.textContent).join('')`)
  ok("and Redo as ⇧⌘Z", redo === "⇧⌘Z", redo)
} else {
  const caps = await js(`[...document.querySelectorAll('[data-modal="keys"] tr[data-command="redoDrawing"] kbd')].map(k=>k.textContent).join(' ')`)
  ok("a PC prints Ctrl Alt Shift Z, in that order", caps === "Ctrl Alt Shift Z", caps)
}
const gutter = await js(`getComputedStyle(document.querySelector('[data-modal="keys"] .key-groups')).scrollbarGutter`)
ok("the list keeps a gutter for its scrollbar (no keycap under it)", /stable/.test(gutter), gutter)
const clipped = await js(`(()=>{const g=document.querySelector('[data-modal="keys"] .key-groups');const gr=g.getBoundingClientRect();return [...g.querySelectorAll('kbd')].filter(k=>k.getBoundingClientRect().right>gr.right-(g.offsetWidth-g.clientWidth)+0.5).length})()`)
ok("no keycap is clipped by the scroll area's edge", clipped === 0, String(clipped))
await owes("Keyboard Shortcuts", "keys")

// ---- a click on the backdrop closes it
await menuClick("keyList"); await waitFor(`!!document.querySelector('[data-modal="keys"]')`)
await click(8, 8); await sleep(300)
ok("a click outside closes the key list", !(await js(`!!document.querySelector('.modal-backdrop')`)))
// F1 again, from the search field
await menuClick("keyList"); await waitFor(`!!document.querySelector('[data-modal="keys"]')`)
await key("F1"); await sleep(300)
ok("F1 puts the key list away again, from its own search field", !(await js(`!!document.querySelector('.modal-backdrop')`)))

// ---- About, Clean Up, Language Setup
await menuClick("about"); await waitFor(`!!document.querySelector('[data-modal="about"] [data-about="libraries"]')`, 10000)
await owes("About", "about")
await menuClick("cleanUp"); await waitFor(`!!document.querySelector('[data-modal="cleanup"]')`)
await sleep(600)
await owes("Clean Up", "cleanup")
await menuClick("languageSetup"); await waitFor(`!!document.querySelector('[data-modal="languages"] [data-language-row]')`, 10000)
await owes("Language Setup", "languages")

// ---- Rename and Move to Trash, from a row's right-click menu
const rowAt = async (name) => JSON.parse(await js(`(()=>{const r=[...document.querySelectorAll('.note-row')].find(x=>x.dataset.path?.replace(/\\\\/g,'/').endsWith('/${name}.wm'));if(!r)return 'null';const b=r.getBoundingClientRect();return JSON.stringify({x:b.x+b.width/2,y:b.y+b.height/2})})()`))
const itemAt = async (re) => JSON.parse(await js(`(()=>{const b=[...document.querySelectorAll('.float-menu button')].find(x=>${re}.test(x.textContent));if(!b)return 'null';const r=b.getBoundingClientRect();return JSON.stringify({x:r.x+r.width/2,y:r.y+r.height/2})})()`))
let at = await rowAt("Two")
await rightClick(at.x, at.y); await sleep(300)
let item = await itemAt("/^Rename/")
await click(item.x, item.y); await waitFor(`!!document.querySelector('[data-modal="prompt"]')`)
ok("Rename: the name field has the keyboard", await js(`document.activeElement?.getAttribute('aria-label') === 'Name'`))
await owes("Rename", "prompt")

at = await rowAt("Two")
await rightClick(at.x, at.y); await sleep(300)
item = await itemAt("/^Move to (Recycle Bin|Trash)/")
await click(item.x, item.y); await waitFor(`!!document.querySelector('[data-modal="prompt"]')`)
ok("Move to Trash starts on CANCEL, not on the destructive button", await js(`document.activeElement?.dataset.modal === 'cancel'`))
ok("and the destructive button is the one red (#c0392b)", await js(`getComputedStyle(document.querySelector('[data-modal="prompt"] [data-modal="ok"]')).backgroundColor`) === "rgb(192, 57, 43)")
await shot("trash")
await key("Enter"); await sleep(400)
ok("Enter on Cancel cancels: the dialog goes and the note is still there", !(await js(`!!document.querySelector('.modal-backdrop')`)) && (await noteRows()).some((p) => /Two\.wm$/.test(p)))
await owesTrash()
async function owesTrash() {
  at = await rowAt("Two")
  await rightClick(at.x, at.y); await sleep(300)
  item = await itemAt("/^Move to (Recycle Bin|Trash)/")
  await click(item.x, item.y); await waitFor(`!!document.querySelector('[data-modal="prompt"]')`)
  // Enter acts only on the focused button: with the keyboard on the dialog's own body (clicked on its text) it does nothing.
  await js(`document.querySelector('[data-modal="prompt"] .modal').focus()`)
  await key("Enter"); await sleep(300)
  ok("Enter with the keyboard on no button does nothing (the dialog stays, the note stays)", await js(`!!document.querySelector('[data-modal="prompt"]')`) && (await noteRows()).some((p) => /Two\.wm$/.test(p)))
  await key("Tab"); await key("Tab"); await sleep(80)
  ok("Tab walks Cancel, Move to Trash", await js(`document.activeElement?.dataset.modal === 'ok'`), await keyboardIn())
  await key("Enter"); await sleep(1200)
  ok("Enter on the focused Move to Trash trashes it", !(await noteRows()).some((p) => /Two\.wm$/.test(p)), JSON.stringify(await noteRows()))
}

// ---- the same two dialogs from a TAB's right-click menu (the tabs branch asks with the page's Prompt, as the sidebar does)
const tabItem = async (re) => JSON.parse(await js(`(()=>{const b=[...document.querySelectorAll('#tab-menu > .float-row > button')].find(x=>${re}.test(x.textContent.trim()));if(!b)return 'null';const r=b.getBoundingClientRect();return JSON.stringify({x:r.x+r.width/2,y:r.y+r.height/2})})()`))
const openTabMenu = async () => {
  const at = JSON.parse(await js(`(()=>{const r=document.querySelector('.tab').getBoundingClientRect();return JSON.stringify({x:r.x+20,y:r.y+r.height/2})})()`))
  await rightClick(at.x, at.y); await sleep(300)
}
await openTabMenu()
item = await tabItem("/^Rename/")
await click(item.x, item.y); await waitFor(`!!document.querySelector('[data-modal="prompt"]')`)
ok("Tab menu, Rename: the name field has the keyboard", await js(`document.activeElement?.getAttribute('aria-label') === 'Name'`), await keyboardIn())
await owes("Tab menu Rename", "prompt")
await openTabMenu()
item = await tabItem("/^Move to (Recycle Bin|Trash)/")
await click(item.x, item.y); await waitFor(`!!document.querySelector('[data-modal="prompt"]')`)
ok("Tab menu, Move to Trash: starts on CANCEL", await js(`document.activeElement?.dataset.modal === 'cancel'`), await keyboardIn())
await owes("Tab menu Move to Trash", "prompt")
ok("Escape on it left the note and its tab", (await noteRows()).some((p) => /One\.wm$/.test(p)) && (await js(`!!document.querySelector('.tab')`)))
finish()
