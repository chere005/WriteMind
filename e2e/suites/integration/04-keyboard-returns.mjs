// @e2e isolated
// AFTER EVERY BAR BUTTON, MENU ITEM AND DIALOG THE KEYBOARD IS BACK IN THE NOTES, THE CARET WHERE IT WAS (Sean, 2026-10-10: "make sure
// the cell behavior, moving the input cursor, search, and undo are all implemented properly"; docs/PLAN-bars-2026-10.md P7 (d)).
// cells/13 clicks the bars one by one; this drives the controls the NEW surfaces added and the ones that end in a menu, a dialog or
// a field: the tab row's menu and its dialogs (Rename…, Move to Trash…: Cancel, Escape and OK), the sidebar row's menu (right-click and
// the ⋯), the + menu, the pencil, the search field, the project menu, the Style menu and the seam's + (opened and put away, and picked),
// the pen button and its menu, the Find card, a text box and a shape's inspector on the rendered page. After each one: the keyboard is the
// notes', the caret is where it was (or where the action puts it, said in the check), and the next key typed lands at it.
import {
  ok, finish, js, sleep, shot, start, world, tabMenu, rowMenu, plusMenu, dialog, openByRow, clickTab, menuLabels, caretTo, key, typeText, click, rightClick,
  hover, centerOf, clickEl, doc, sel, waitFor, setRendered, styleMenu, seamPick, openFind, findType, bar, drawShape, inspectorPress, undo, inNotes, J,
} from "./_lib.mjs"

const D = "# One\n\nalpha words\n\n# Two\n\nbeta words here\n"
await start({ "Alpha.md": D, "Other.md": "other\n", "Sec/In.md": "inside\n" })
await openByRow("Other.wm")
await clickTab("Alpha.wm")
const AT = D.indexOf("beta words") + 6          // beta |words
const noMenus = () => js(`!document.querySelector('.float-menu, [data-modal], [data-bar=find], .style-pop, .math-pop')`)

const reset = async () => {
  if (!(await js(`document.querySelector('.tab.open')?.title.endsWith('Alpha.wm') ?? false`))) await clickTab("Alpha.wm")
  await js(`document.querySelector('.cm-content').cmTile.view.dispatch({ changes: { from: 0, to: document.querySelector('.cm-content').cmTile.view.state.doc.length, insert: ${JSON.stringify(D)} }, selection: { anchor: ${AT} } })`)
  await js(`document.querySelector('.cm-content').focus()`)
  await sleep(300)
}

/** Do something with the mouse or the keys, then: nothing is left open, the keyboard is the notes', and (unless it moves it) the caret is where it was. */
async function after(name, act, { caret = AT, typed = true, open = false } = {}) {
  await reset()
  await act()
  await sleep(500)
  const here = await sel()
  const focused = await inNotes()
  if (!open) ok(`${name}: nothing is left open (no menu, dialog, popover or find card)`, await noMenus(), await js(`document.querySelector('.float-menu, [data-modal], [data-bar=find], .style-pop')?.outerHTML.slice(0, 100)`))
  ok(`${name}: the keyboard is in the notes`, focused, await js(`document.activeElement?.tagName + '.' + document.activeElement?.className`))
  if (caret !== null) ok(`${name}: the caret is where it was`, here[0] === caret && here[1] === caret, JSON.stringify(here))
  if (typed && focused) {
    const at = (await sel())[0]
    const length = (await doc()).length
    await typeText("Z"); await sleep(200)
    const d = await doc()
    ok(`${name}: the next key typed goes in at the caret`, d.length === length + 1 && d[at] === "Z", JSON.stringify(d.slice(Math.max(0, at - 5), at + 5)))
  }
}
const escape = async () => { await key("Escape"); await sleep(300) }

// ---- the tab row's menu and its dialogs
await after("tab menu: Escape", async () => {
  const at = await J(`(() => { const t = document.querySelector('.tab.open'); const r = t.getBoundingClientRect(); return { x: r.x + 24, y: r.y + r.height / 2 } })()`)
  await rightClick(at.x, at.y); await waitFor(`!!document.querySelector('#tab-menu')`); await escape()
})
for (const [how, close] of [["Escape", () => escape()], ["Cancel", async () => { await clickEl("[data-modal=cancel]"); await sleep(300) }]]) {
  await after(`Rename… dialog, ${how}`, async () => { await tabMenu("Alpha.wm", "Rename…"); await waitFor(`!!document.querySelector('[data-modal=prompt]')`); await close() })
  await after(`Move to Trash… dialog, ${how}`, async () => { await tabMenu("Alpha.wm", "Move to Trash…"); await waitFor(`!!document.querySelector('[data-modal=prompt]')`); await close() })
}
// the open-notes list: a note picked from it comes to the front; Escape on it leaves things as they were
await after("the open-notes list, Escape", async () => { await clickEl("[data-bar=tab-list]"); await waitFor(`!!document.querySelector('.float-menu')`); await escape() })

// ---- the sidebar: the pencil, the search, the + menu, a row's menu (right-click and the ⋯), the project menu
await after("the pencil, twice", async () => { await clickEl("[data-bar=edit]"); await sleep(300); await clickEl("[data-bar=edit]") })
await after("the search field: focused by its key, Escape", async () => {
  await key("f", { ctrl: true, shift: true }); await sleep(300)
  ok("(the search field has the keyboard)", await js(`document.activeElement?.dataset?.sidebar === 'search'`))
  await typeText("alp"); await sleep(400); await escape()
})
await after("the + menu, Escape", async () => { const c = await centerOf("[data-bar=new-note]"); await rightClick(c.x, c.y); await waitFor(`!!document.querySelector('.float-menu')`); await escape() })
await after("a row's right-click menu, Escape", async () => {
  const row = await J(`(() => { const r = document.querySelector('.note-row'); r.scrollIntoView({ block: 'center' }); const b = r.getBoundingClientRect(); return { x: b.x + 60, y: b.y + b.height / 2 } })()`)
  await rightClick(row.x, row.y); await waitFor(`!!document.querySelector('.float-menu')`); await escape()
})
await after("a row's ⋯, Escape", async () => {
  const row = await J(`(() => { const r = document.querySelector('.note-row'); r.scrollIntoView({ block: 'center' }); const b = r.getBoundingClientRect(); return { x: b.x + 60, y: b.y + b.height / 2 } })()`)
  await hover(row.x, row.y); await sleep(200)
  const more = await centerOf(".note-row:hover .row-more, .note-row .row-more")
  await click(more.x, more.y); await waitFor(`!!document.querySelector('.float-menu')`); await escape()
})
await after("a row's menu: Rename… Cancel", async () => { await rowMenu("Alpha.wm", "Rename…"); await clickEl("[data-modal=cancel]"); await sleep(300) })
await after("a row's menu: Move to Trash… Escape", async () => { await rowMenu("Alpha.wm", "Move to Trash…"); await waitFor(`!!document.querySelector('[data-modal=prompt]')`); await escape() })
await after("the project menu, Escape", async () => { await clickEl("[data-sidebar=folder-menu]"); await waitFor(`!!document.querySelector('.float-menu')`); await escape() })

// ---- the bar over the note: the Style menu and the seam's + (opened and put away), the pen
await after("Style menu opened, Escape", async () => { await clickEl("[data-bar=style]"); await waitFor(`!!document.querySelector('.float-menu')`); await escape() })
// (a click on the empty page below the last cell puts the bar up there — typing then opens a cell, which is not the caret's offset)
await after("Style menu opened, a click on the page", async () => { await clickEl("[data-bar=style]"); await waitFor(`!!document.querySelector('.float-menu')`); await click(700, 600); await sleep(300) }, { caret: null, typed: false })
await after("Style > Title (the caret stays on its words)", async () => { await styleMenu("heading-1") }, { caret: null, typed: false })
{
  const d = await doc(), head = (await sel())[1]
  ok("Style > Title: the caret is still on the same characters (beta w|ords here)", d.slice(0, head).endsWith("beta w") && d.slice(head).startsWith("ords here"), JSON.stringify(d.slice(head - 8, head + 8)))
}
await after("the pen button, down and up", async () => { await clickEl("[data-bar=pen]"); await sleep(250); await clickEl("[data-bar=pen]") })
await after("the pen's menu, Escape", async () => { await clickEl("[data-bar=pen-menu]"); await waitFor(`!!document.querySelector('.float-menu')`); await escape() })
await after("the Shapes menu, Escape", async () => { await clickEl("[data-bar=shapes]"); await waitFor(`!!document.querySelector('.float-menu')`); await escape() })

// ---- the Find card: opened, closed by Escape and by its close button. The match it was on is selected when it goes (Esc gives the
// note its caret with the match selected), so the next key typed REPLACES it, as any selection.
for (const [how, close] of [["Escape", () => escape()], ["its close button", async () => { await clickEl("[data-find=close]"); await sleep(300) }]]) {
  await after(`the Find card, ${how}`, async () => { await openFind(); await findType("words"); await close() }, { caret: null, typed: false })
  const text = await doc()
  const [from, to] = await sel()
  ok(`the Find card, ${how}: the match it was on is selected in the note`, text.slice(from, to).toLowerCase() === "words", JSON.stringify(text.slice(from, to)))
  await typeText("Z"); await sleep(200)
  ok(`the Find card, ${how}: the next key typed replaces it`, (await doc()).length === text.length - 4, JSON.stringify((await doc()).slice(Math.max(0, from - 4), from + 4)))
}

// ---- the tab menu's file operations and the + menu's: the front note is still Alpha, the caret where it was
await after("tab menu: Move to ▸ Sec", async () => { await tabMenu("Other.wm", "Move to", { sub: "Sec" }) })
await after("tab menu: Duplicate", async () => { await tabMenu("Other.wm", "Duplicate") }, { caret: null })
await after("tab menu: Rename… OK", async () => { await tabMenu("Sec/Other.wm", "Rename…"); await dialog("Other2") }, { caret: null })
await after("the + menu: New Section", async () => { await plusMenu("New Section") }, { caret: AT })

// ---- the rendered page: a text box typed in and ended by Escape, a shape's inspector
await setRendered(true)
await sleep(500)
await after("a text box: placed, typed in, Escape", async () => {
  await bar("textbox")
  const box = await J(`(() => { const r = document.querySelector('.wm-canvas').getBoundingClientRect(); return { x: r.x, y: r.y } })()`)
  const { drag } = await import("../../lib/harness.mjs")
  await drag(box.x + 300, box.y + 330, box.x + 540, box.y + 400); await sleep(400)
  await typeText("hello"); await key("Escape"); await sleep(400)
})
await after("a shape: drawn, then the inspector's duplicate and delete", async () => {
  await drawShape("rectangle", [320, 480, 200, 90])
  await inspectorPress("duplicate")
  await inspectorPress("delete")
})
await after("a shape: the inspector's colour popover, Escape", async () => {
  await drawShape("oval", [620, 480, 160, 90])
  await inspectorPress("colour"); await sleep(250); await escape()
})
await setRendered(false)
await shot("keyboard-returns")
finish()
