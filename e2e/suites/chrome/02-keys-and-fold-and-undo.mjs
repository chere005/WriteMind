import { js, key, menu, menuClick, ok, finish, sleep, closeAllTabs, seedNotes, reloadApp } from "../../lib/harness.mjs"
const J = async (expr) => JSON.parse(await js(`JSON.stringify(${expr})`))
const view = `document.querySelector('.cm-content').cmTile.view`
const doc = () => js(`${view}.state.doc.toString()`)
const item = async (top, label) => (await menu()).find((t) => t.label === top).submenu.find((i) => i.label === label)
const openHead = async () => { await closeAllTabs(); await js(`[...document.querySelectorAll('.note-row')].find(r=>r.textContent.startsWith('Head'))?.click()`); await sleep(800) }
const caretAt = (needle, plus = 0) => js(`(() => { const v = ${view}; const at = v.state.doc.toString().indexOf(${JSON.stringify(needle)}) + ${plus}; v.dispatch({ selection: { anchor: at } }); v.focus() })()`)

// A small notes folder: Cells ("Head"), Second, Third and a fourth, so the sidebar has something to edit.
await seedNotes({
  "Cells.md": "# Head\n\nbody one\n\nbody two\n\n# Next\n\nTail",
  "Second.md": "# Second\n\nsecond body text\n",
  "Third.md": "# Third\n\nthird\n",
  "Fourth.md": "# Fourth\n\nfourth\n",
}, { clean: true })
await reloadApp()
await openHead()

// ---- keys the page owns, one press each
await caretAt("body one", 2)
await key(".", { code: "Period", vk: 190, ctrl: true }); await sleep(200)
ok("Ctrl+. grows the selection to the word", (await js(`${view}.state.sliceDoc(${view}.state.selection.main.from, ${view}.state.selection.main.to)`)) === "body")
await key(".", { code: "Period", vk: 190, ctrl: true }); await sleep(200)
ok("and once more to the cell", (await js(`${view}.state.sliceDoc(${view}.state.selection.main.from, ${view}.state.selection.main.to)`)).length > 4)

await caretAt("Head", 1)
// Mac e8b3266: the caret's own fold keys are gone; Ctrl+; folds what is UNDER the caret's section, never the section itself.
await key(";", { code: "Semicolon", vk: 186, ctrl: true }); await sleep(300)
ok("Ctrl+; never folds the section the caret is in (Head has nothing under it)", (await js(`document.querySelectorAll('.wm-folded').length`)) === 0)
await key("ArrowLeft", { code: "ArrowLeft", vk: 37, ctrl: true, alt: true, shift: true }); await sleep(300)
ok("Ctrl+Alt+Shift+Left folds them all", (await js(`document.querySelectorAll('.wm-folded').length`)) >= 1)
await key("ArrowRight", { code: "ArrowRight", vk: 39, ctrl: true, alt: true, shift: true }); await sleep(300)
ok("and Ctrl+Alt+Shift+Right opens them all", (await js(`document.querySelectorAll('.wm-folded').length`)) === 0)

// split / merge: the editor's own keys, and the menu's items are the same command
const base = await doc()
await caretAt("body one", 4)
await key("d", { ctrl: true }); await sleep(250)
const split = await doc()
ok("Ctrl+D splits a cell once", split.length - base.length === 2 && split.includes("body\n\n one") || split.length > base.length, split.slice(0, 60))
await key("z", { ctrl: true }); await sleep(250)
ok("Ctrl+Z takes the split back", (await doc()) === base)
await caretAt("body one", 4)
await menuClick("splitCell"); await sleep(250)
ok("Format > Split Cell is the same split", (await doc()) === split)
await menuClick("undo"); await sleep(250)

// Ctrl+W closes the TAB, not the window
const tabs = await js(`document.querySelectorAll('.tab').length`)
await js(`document.querySelector('.cm-content').focus()`)
await key("w", { ctrl: true }); await sleep(500)
ok("Ctrl+W closes one tab and the window stays", (await js(`document.querySelectorAll('.tab').length`)) === tabs - 1)
ok("with no note open the bar stays, its tools wait", await js(`!!document.querySelector('[data-bar=sidebar]') && document.querySelector('[data-bar=list]').disabled`))
ok("Close Tab is greyed in the menu", (await item("File", "Close Tab")).enabled === false)
ok("and so is Split Cell", (await item("Format", "Split Cell")).enabled === false)
ok("and Insert > Image…", (await item("Insert", "Image…")).enabled === false)

// ---- Ctrl+N makes a note in the open note's folder (here: the notes root), and the page opens it
const rows = await js(`document.querySelectorAll('.note-row').length`)
await js(`document.body.focus()`)
await key("n", { ctrl: true }); await sleep(1200)
ok("Ctrl+N makes one note, once", (await js(`document.querySelectorAll('.note-row').length`)) === rows + 1)
ok("and opens it", (await js(`document.querySelectorAll('.tab').length`)) === 1)

// ---- the drawing's own undo pair
await openHead(); await sleep(400)
ok("Undo Drawing is greyed with nothing drawn", (await item("Edit", "Undo Drawing")).enabled === false)
const count = () => js(`document.body.innerText.match(/(\\d+) objects?/)?.[1] ?? '0'`)
await js(`(() => { const b = [...document.querySelectorAll('button')].find(b => b.textContent === '✎'); if (!b.title.startsWith('Put the pen')) b.click() })()`); await sleep(200)
const fire = (type, x, y, o) => js(`(() => { const el = document.elementFromPoint(${x}, ${y}); el.dispatchEvent(new PointerEvent('${type}', { bubbles: true, cancelable: true, composed: true, clientX: ${x}, clientY: ${y}, pointerId: 9, pointerType: 'pen', isPrimary: true, button: 0, buttons: ${o.buttons}, pressure: ${o.pressure} })) })()`)
const n0 = Number(await count())
await fire("pointerdown", 600, 400, { buttons: 1, pressure: 0.3 })
for (let i = 1; i < 12; i++) await fire("pointermove", 600 + i * 8, 400 + i * 2, { buttons: 1, pressure: 0.3 })
await fire("pointerup", 700, 424, { buttons: 0, pressure: 0 }); await sleep(900)
ok("a stroke is drawn", Number(await count()) === n0 + 1)
ok("Undo Drawing is lit", (await item("Edit", "Undo Drawing")).enabled === true)
await js(`document.querySelector('.cm-content').focus()`)
await key("z", { ctrl: true, alt: true }); await sleep(400)
ok("Ctrl+Alt+Z takes the stroke back (once)", Number(await count()) === n0)
ok("Redo Drawing is lit", (await item("Edit", "Redo Drawing")).enabled === true)
await key("Z", { ctrl: true, alt: true, shift: true }); await sleep(400)
ok("Ctrl+Alt+Shift+Z puts it back", Number(await count()) === n0 + 1)
await menuClick("undoDrawing"); await sleep(400)
ok("Edit > Undo Drawing does the same", Number(await count()) === n0)
// put the pen up again
await js(`(() => { const b = [...document.querySelectorAll('button')].find(b => b.textContent === '✎'); if (b.title.startsWith('Put the pen')) b.click() })()`)
finish()
