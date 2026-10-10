// The right-click menu: Cut / Copy / Paste / Select All, greyed when they cannot apply. It goes through the
// shell's clipboard (main `edit:native`), which is the real system clipboard: this script saves the text on it
// first and puts it back at the end. (Was tour/t14.mjs.)
import { ok, finish, js, sleep, freshNote, setDoc, doc, sel, setSel, click, rightClick, focus, lineBoxes, shot, guardClipboard } from "../../lib/harness.mjs"

const restoreClipboard = guardClipboard()
await freshNote()
await setDoc("Alpha para\n\nBeta para\n\nGamma"); await focus(); await sleep(300)
const lb = await lineBoxes()
const menuItems = async () => JSON.parse(await js(`JSON.stringify([...document.querySelectorAll('#context-menu button')].map(b=>{const r=b.getBoundingClientRect();return {label:b.textContent,off:b.disabled,x:Math.round(r.x+10),y:Math.round(r.y+8)}}))`))
const item = (items, start) => items.find((i) => i.label.startsWith(start))

await rightClick(300, lb[0][0] + 10)
ok("a right-click opens the page's own menu", await js(`!!document.querySelector('#context-menu')`))
let items = await menuItems()
ok("with Cut, Copy, Paste and Select All", ["Cut", "Copy", "Paste", "Select All"].every((n) => item(items, n)), JSON.stringify(items.map((i) => i.label)))
ok("Cut and Copy are greyed with nothing selected", item(items, "Cut").off && item(items, "Copy").off)
await shot("menu")
await click(item(items, "Select All").x, item(items, "Select All").y); await sleep(200)
const all = await sel()
ok("Select All selects the whole note", all[0] === 0 && all[1] === (await doc()).length, JSON.stringify(all))
ok("and the menu goes away", !(await js(`!!document.querySelector('#context-menu')`)))

await rightClick(300, lb[0][0] + 10)
items = await menuItems()
ok("with a selection Cut and Copy are live", !item(items, "Cut").off && !item(items, "Copy").off)
await click(item(items, "Copy").x, item(items, "Copy").y); await sleep(300)

await setSel((await doc()).length); await focus()
await rightClick(300, 330)
items = await menuItems()
ok("a right-click in empty space keeps the caret (no selection to cut)", item(items, "Cut").off, JSON.stringify((await sel())))
const before = (await doc()).length
await click(item(items, "Paste").x, item(items, "Paste").y); await sleep(500)
const after = await doc()
ok("Paste puts back what Copy took", after.length > before + 28 && after.endsWith("Alpha para\n\nBeta para\n\nGamma"), JSON.stringify(after.slice(-40)))
restoreClipboard()
finish()
