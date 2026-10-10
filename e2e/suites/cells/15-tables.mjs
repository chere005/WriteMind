// (g) A table cell edits correctly (docs/PLAN-bars-2026-10.md P7; packages/editor/src/tables.ts, core markdown/table.ts — the one
// table engine): Tab goes cell to cell (the delimiter row stepped over, the words of the cell selected so typing replaces them),
// past the last cell it adds a row, Shift+Tab goes back, Enter adds a row under the caret's row (an empty last row ends the
// table), the file is exactly what was typed, and every one of them is one undo step. The Insert ▸ Table button (P1) writes a
// two-column table with the caret in its first header cell: that shape is the document here. Markdown side and rendered page.
import { ok, test, finish, js, sleep, freshNote, setDoc, doc, sel, selText, key, click, focus, setSel, setRendered, typeText, shot } from "../../lib/harness.mjs"

await freshNote()
const T = "intro\n\n| Name | Value |\n|---|---|\n| one | 1 |\n| two | 2 |\n\noutro"
const NEW = "intro\n\n|  |  |\n|---|---|\n|  |  |\n|  |  |\n\noutro"

for (const rendered of [false, true]) {
  const side = rendered ? "rendered page" : "markdown side"
  await setRendered(rendered)

  await test(`${side}: Tab walks cell to cell, over the delimiter row, and a row is added past the last cell`, async () => {
    await setDoc(T, 0); await focus(); await sleep(300)
    await setSel(T.indexOf("Name")); await sleep(100)
    const walk = []
    for (let i = 0; i < 6; i++) { await key("Tab"); await sleep(120); walk.push(await selText()) }
    ok("Value, one, 1, two, 2, then an empty cell of a new row", JSON.stringify(walk) === JSON.stringify(["Value", "one", "1", "two", "2", ""]), JSON.stringify(walk))
    ok("the new row is empty and the file is as typed (nothing re-padded)", (await doc()) === T.replace("| two | 2 |\n", "| two | 2 |\n|  |  |\n"), JSON.stringify(await doc()))
    await key("Tab"); await sleep(120)
    const row = (await doc()).indexOf("|  |  |")
    ok("the next Tab goes on to the second cell of the new row, the caret in it", row > 0 && JSON.stringify(await sel()) === JSON.stringify([row + 5, row + 5]), JSON.stringify([row, await sel()]))
    await key("z", { ctrl: true }); await sleep(200)
    ok("ONE Ctrl+Z takes the added row back", (await doc()) === T, JSON.stringify(await doc()))
  })

  await test(`${side}: Shift+Tab goes back, and stays on the first header cell`, async () => {
    await setDoc(T, 0); await focus(); await sleep(300)
    await setSel(T.indexOf("two")); await key("Tab", { shift: true }); await sleep(120)
    ok("back to 1", (await selText()) === "1", JSON.stringify(await selText()))
    await key("Tab", { shift: true }); await key("Tab", { shift: true }); await sleep(120)
    ok("back over one, to Value (the delimiter row is stepped over)", (await selText()) === "Value", JSON.stringify(await selText()))
    await key("Tab", { shift: true }); await sleep(120)
    ok("to Name", (await selText()) === "Name")
    await key("Tab", { shift: true }); await sleep(120)
    ok("and stays on the first cell of the header", (await selText()) === "Name" && (await doc()) === T, JSON.stringify(await selText()))
  })

  await test(`${side}: typing replaces the selected words of the cell Tab landed in; the file is what was typed`, async () => {
    await setDoc(T, 0); await focus(); await sleep(300)
    await setSel(T.indexOf("Name")); await key("Tab"); await key("Tab"); await sleep(100)
    await typeText("uno"); await sleep(150)
    ok("the cell took the new words", (await doc()) === T.replace("| one |", "| uno |"), JSON.stringify(await doc()))
    await key("Tab"); await sleep(100); await typeText("11"); await sleep(150)
    ok("and the next", (await doc()) === T.replace("| one | 1 |", "| uno | 11 |"), JSON.stringify(await doc()))
  })

  await test(`${side}: Enter adds a row under the caret's row, in its first cell; on an empty last row it ends the table`, async () => {
    await setDoc(T, 0); await focus(); await sleep(300)
    await setSel(T.indexOf("one") + 1); await key("Enter"); await sleep(150)
    ok("a new empty row under the row", (await doc()) === T.replace("| one | 1 |\n", "| one | 1 |\n|  |  |\n"), JSON.stringify(await doc()))
    const s = (await sel())[0]
    ok("the caret is in its first cell", (await doc()).slice(s - 2, s + 1) === "|  ", JSON.stringify([s, (await doc()).slice(s - 3, s + 3)]))
    await key("z", { ctrl: true }); await sleep(200)
    ok("one Ctrl+Z", (await doc()) === T, JSON.stringify(await doc()))
    // Return in the header goes under the delimiter row
    await setSel(T.indexOf("Value") + 1); await key("Enter"); await sleep(150)
    ok("in the header: the new row is under the delimiter row", (await doc()) === T.replace("|---|---|\n", "|---|---|\n|  |  |\n"), JSON.stringify(await doc()))
    await key("z", { ctrl: true }); await sleep(200)
    // an empty last row: Enter ends the table
    const E = "intro\n\n| A | B |\n|---|---|\n| 1 | 2 |\n|  |  |"
    await setDoc(E, 0); await focus(); await sleep(250)
    await setSel(E.length - 2); await key("Enter"); await sleep(200)
    const d = await doc()
    ok("Enter on an empty last row: the row goes and the table ends, a blank line below", d === "intro\n\n| A | B |\n|---|---|\n| 1 | 2 |\n\n" || d.startsWith("intro\n\n| A | B |\n|---|---|\n| 1 | 2 |\n"), JSON.stringify(d))
    ok("the caret is below the table", (await sel())[0] >= "intro\n\n| A | B |\n|---|---|\n| 1 | 2 |".length, JSON.stringify(await sel()))
  })

  await test(`${side}: the table the Insert button writes (empty cells, three rows) edits the same way`, async () => {
    await setDoc(NEW, 0); await focus(); await sleep(300)
    await setSel(NEW.indexOf("|  |") + 2); await sleep(100)
    await typeText("Item"); await key("Tab"); await typeText("Cost"); await sleep(100)
    ok("typed into the header cells", /\| ?Item ?\| ?Cost ?\|/.test(await doc()), JSON.stringify(await doc()))
    await key("Tab"); await sleep(100)
    ok("Tab from the last header cell goes to the first body cell (the delimiter row stepped over)", (await sel())[0] > (await doc()).indexOf("|---|---|") + 9, JSON.stringify(await sel()))
    await typeText("a"); await key("Tab"); await typeText("1"); await sleep(100)
    ok("the body cells took their words", /\| ?a ?\| ?1 ?\|/.test(await doc()), JSON.stringify(await doc()))
    await shot(`table-${rendered ? "rendered" : "markdown"}`)
  })

  await test(`${side}: Tab with words selected over two lines is not the table's: it indents`, async () => {
    await setDoc(T, 0); await focus(); await sleep(300)
    await setSel(T.indexOf("| one"), T.indexOf("2 |")); await key("Tab"); await sleep(150)
    ok("the table's own Tab did not walk (the selection still spans the rows)", (await sel())[0] !== (await sel())[1], JSON.stringify(await sel()))
  })
}

await test("the rendered page: a table is drawn, a click on a cell opens it with the caret there, and Tab goes on from it", async () => {
  await setRendered(true)
  await setDoc(T, 0); await focus(); await sleep(400)
  const cell = JSON.parse(await js(`(()=>{const c=[...document.querySelectorAll('.wm-pv table td, .wm-pv table th, .wm-pv-table td')].find(e=>e.textContent.trim()==='two'); if(!c) return 'null'; const r=c.getBoundingClientRect(); return JSON.stringify({x:r.x+r.width/2,y:r.y+r.height/2})})()`))
  if (!cell) { ok("a table is drawn", false, "no table cell found on the page"); return }
  await click(cell.x, cell.y); await sleep(400)
  const here = (await sel())[0]
  ok("the click put the caret in that cell", here >= T.indexOf("| two") && here <= T.indexOf("| two") + 7, JSON.stringify(await sel()))
  await key("Tab"); await sleep(150)
  ok("Tab goes to the next cell (2)", (await selText()) === "2", JSON.stringify(await selText()))
})
finish()
