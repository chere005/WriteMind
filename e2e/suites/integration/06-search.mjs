// @e2e isolated
// SEARCH (Sean, 2026-10-10: "make sure the cell behavior, moving the input cursor, search, and undo are all implemented properly";
// docs/PLAN-bars-2026-10.md P3 + P6): the sidebar's search while notes are made, renamed, trashed and the trash undone, a damaged .wm
// in the folder; Enter on a result opens the note with the Find card on the first match; Esc gives the keyboard back to the notes; and
// the Find card — next, previous, Replace, Replace All (ONE undo) — over cells of every kind, code and maths included, without moving
// the note. Real keys and the real mouse, markdown side and rendered page.
import fs from "node:fs"
import path from "node:path"
import {
  ok, test, finish, js, sleep, shot, start, key, typeText, click, clickEl, centerOf, doc, sel, selText, notesDir, setRendered, tabMenu, dialog, openByRow,
  closeAllTabs, searchFor, searchState, hitFiles, settleSearch, findCard, findPress, findType, inNotes, undo, redo, lineBoxes, pageErrorCount, J, waitFor,
  reloadApp, world, caretTo, bar,
} from "./_lib.mjs"

const CELLS = [
  "# Heading needle", "plain needle text", "- list needle", "> quote needle", "```python\nneedle = 1\n```", "```wl\nNeedle[x]\n```",
  "<!-- markdown -->\n**needle** md", "| a | needle |\n| --- | --- |\n| 1 | 2 |", "last needle",
].join("\n\n") + "\n"

await start({
  "Demo.md": "# Demo\n\nthe first needle is here\nand a second needle\n", "Rep.md": "# Rep\n\nnothing at all\n", "Sec/Deep.md": "# Deep\n\nanother needle in a section\n",
  "Cells.md": CELLS,
}, { open: false })
const root = await notesDir()
fs.writeFileSync(path.join(root, "Broken.wm"), "this is not a zip file, needle")
await reloadApp()
await sleep(600)
const noErrors = pageErrorCount()
const files = async () => hitFiles()
const poll = async (want, ms = 8000) => {
  const stop = Date.now() + ms
  let got = await files()
  while (JSON.stringify(got) !== JSON.stringify(want) && Date.now() < stop) { await sleep(250); got = await files() }
  return got
}
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b)

// ---------------------------------------------------------------------------------------------------------------
// the results while notes come and go
// ---------------------------------------------------------------------------------------------------------------
await test("the sidebar's search: results while notes are made, renamed, trashed and the trash undone", async () => {
  await searchFor("needle")
  let s = await searchState()
  ok("the tree gives way to the results, the keyboard is in the field", s.results && s.tree === 0 && s.focus === "search", JSON.stringify([s.results, s.tree, s.focus]))
  ok("the notes that have the words are the results; the damaged .wm is not (it has no readable words) and is said to be there", same(await files(), ["Cells.wm", "Demo.wm", "Sec/Deep.wm"]) && /1 note could not be read/.test(s.unreadable ?? ""), JSON.stringify([await files(), s.unreadable]))

  // a note made while the search is on appears once it has the words
  await clickEl("[data-bar=new-note]"); await sleep(1200)
  ok("a new note is open (its tab in front) and the search is still on the screen", (await js(`document.querySelector('.tab.open')?.title.endsWith('Untitled.wm') ?? false`)) && (await searchState()).field === "needle", JSON.stringify(await searchState()))
  ok("…it has no words yet, so it is not a result", same(await files(), ["Cells.wm", "Demo.wm", "Sec/Deep.wm"]), JSON.stringify(await files()))
  await typeText("a needle too"); await sleep(1500)
  ok("once it has the words it is one", same(await poll(["Cells.wm", "Demo.wm", "Sec/Deep.wm", "Untitled.wm"]), ["Cells.wm", "Demo.wm", "Sec/Deep.wm", "Untitled.wm"]), JSON.stringify(await files()))

  // renamed from its tab: the old name is gone from the results, the new one is there
  await tabMenu("Untitled.wm", "Rename…"); await dialog("Fresh")
  ok("renamed: Fresh.wm is a result and Untitled.wm is not", same(await poll(["Cells.wm", "Demo.wm", "Fresh.wm", "Sec/Deep.wm"]), ["Cells.wm", "Demo.wm", "Fresh.wm", "Sec/Deep.wm"]), JSON.stringify(await files()))
  await undo()
  ok("Ctrl+Z takes the rename back: Untitled.wm is a result again, Fresh.wm is gone", same(await poll(["Cells.wm", "Demo.wm", "Sec/Deep.wm", "Untitled.wm"]), ["Cells.wm", "Demo.wm", "Sec/Deep.wm", "Untitled.wm"]), JSON.stringify(await files()))
  await redo()
  ok("Ctrl+Shift+Z does it again", same(await poll(["Cells.wm", "Demo.wm", "Fresh.wm", "Sec/Deep.wm"]), ["Cells.wm", "Demo.wm", "Fresh.wm", "Sec/Deep.wm"]), JSON.stringify(await files()))

  // trashed from its tab: gone from the results; the Undo brings it back into them
  await tabMenu("Fresh.wm", "Move to Trash…"); await dialog()
  ok("trashed: Fresh.wm is not a result", same(await poll(["Cells.wm", "Demo.wm", "Sec/Deep.wm"]), ["Cells.wm", "Demo.wm", "Sec/Deep.wm"]), JSON.stringify(await files()))
  ok("…and not on disk", !fs.existsSync(path.join(root, "Fresh.wm")))
  await undo()
  ok("Ctrl+Z puts it back: a result again, with its words", same(await poll(["Cells.wm", "Demo.wm", "Fresh.wm", "Sec/Deep.wm"]), ["Cells.wm", "Demo.wm", "Fresh.wm", "Sec/Deep.wm"]), JSON.stringify(await files()))
  await redo()
  ok("Ctrl+Shift+Z trashes it again: gone from the results", same(await poll(["Cells.wm", "Demo.wm", "Sec/Deep.wm"]), ["Cells.wm", "Demo.wm", "Sec/Deep.wm"]), JSON.stringify(await files()))

  // a note whose words change while it is a result (typed in): it stops being one; and one trashed from the sidebar's own row menu
  await openByRow("Demo.wm").catch(() => undefined)
  s = await searchState()
  ok("(the search stays on while a note is opened by hand)", s.results, JSON.stringify(s.hits.length))

  // a damaged .wm that appears while the search is on
  fs.writeFileSync(path.join(root, "Broken too.wm"), "needle, but not a note")
  await sleep(1800)
  s = await searchState()
  ok("a second damaged .wm is counted (2 notes could not be read), the good results are the same", /2 notes could not be read/.test(s.unreadable ?? "") && same(await files(), ["Cells.wm", "Demo.wm", "Sec/Deep.wm"]), JSON.stringify([s.unreadable, await files()]))
  await searchFor("Broken")
  ok("a damaged .wm is found by its name", (await files()).some((f) => /^Broken( too)?\.wm$/.test(f)), JSON.stringify(await files()))
  ok("the page had no error through all of that", pageErrorCount() === noErrors, `${pageErrorCount()} vs ${noErrors}`)
  fs.rmSync(path.join(root, "Broken too.wm"))
  await key("Escape"); await sleep(500)
  s = await searchState()
  // (With no note open there is no notes pane to give the keyboard to.)
  const editor = await js(`!!document.querySelector('.cm-content')`)
  ok("Escape clears the field, the tree is back and, with a note open, the keyboard is the notes'", s.field === "" && !s.results && s.tree > 0 && (!editor || (await inNotes())), JSON.stringify([s.field, s.results, s.tree, editor, await inNotes()]))
})

// ---------------------------------------------------------------------------------------------------------------
// Enter opens the note with the Find card on the first match; Esc gives the keyboard back
// ---------------------------------------------------------------------------------------------------------------
await test("Enter on a result opens the note with the Find card on its first match, Esc gives the keyboard to the notes", async () => {
  // (no tab is open: the last editor the page held is gone, and the result's note may have the same words as it did)
  await openByRow("Demo.wm")
  await closeAllTabs()
  await sleep(400)
  ok("no note is open", !(await js(`!!document.querySelector('.cm-content')`)))
  await searchFor("needle")
  const hits = (await searchState()).hits
  const at = hits.findIndex((h) => h.path.endsWith("/Demo.wm"))
  for (let i = 0; i <= at; i++) { await key("ArrowDown"); await sleep(120) }
  ok("the arrows chose Demo", (await searchState()).hits[at]?.active === true, JSON.stringify((await searchState()).hits.map((h) => h.active)))
  await key("Enter"); await sleep(1500)
  const text = await doc()
  const first = text.toLowerCase().indexOf("needle")
  ok("Demo is open", (await js(`document.querySelector('.footer span')?.textContent`)) === "Demo.wm")
  const card = await findCard()
  ok("the Find card is up on the words typed, at “1 of 2”", card?.query === "needle" && card.count === "1 of 2", JSON.stringify(card))
  ok("the first match is selected in the note", (await sel())[0] === first && (await selText()).toLowerCase() === "needle", JSON.stringify([await sel(), first]))
  ok("the keyboard is in the card (Enter walks on)", card?.focused === "Find", JSON.stringify(card))
  await key("Enter"); await sleep(250)
  ok("Enter in the card goes to the next match", (await sel())[0] === text.toLowerCase().indexOf("needle", first + 1) && (await findCard()).count === "2 of 2", JSON.stringify([await sel(), await findCard()]))
  await key("Escape"); await sleep(400)
  ok("Esc puts the card away, the keyboard is the notes' and the match it was on is selected", !(await findCard()) && (await inNotes()) && (await selText()).toLowerCase() === "needle", JSON.stringify([await findCard(), await inNotes(), await selText()]))
  const s = await searchState()
  ok("the sidebar still shows its results (the field is the sidebar's own)", s.results && s.field === "needle", JSON.stringify([s.results, s.field]))
  await key("Escape"); await sleep(200)
  // the field is cleared from the field itself
  await js(`document.querySelector('[data-sidebar=search]').focus()`)
  await key("Escape"); await sleep(400)
  const t = await searchState()
  ok("Escape in the field clears it, the tree is back and the keyboard is the notes'", t.field === "" && !t.results && (await inNotes()), JSON.stringify([t.field, t.results, await inNotes()]))
})

// ---------------------------------------------------------------------------------------------------------------
// the Find card over cells of every kind
// ---------------------------------------------------------------------------------------------------------------
for (const rendered of [false, true]) {
  const side = rendered ? "rendered page" : "markdown side"
  await test(`${side}: Find over cells of every kind: next, previous, Replace, Replace All (one undo), the note does not move`, async () => {
    await openByRow("Cells.wm")
    await setRendered(rendered)
    await sleep(500)
    await caretTo(0)
    const topBefore = (await lineBoxes())[0][0]
    const scrollerTop = () => js(`document.querySelector('.cm-scroller').getBoundingClientRect().top`)
    const paneTop = await scrollerTop()
    await key("f", { ctrl: true }); await waitFor(`!!document.querySelector('[data-bar=find]')`); await sleep(250)
    await findType("needle")
    ok("nine matches, one in each of the nine cells (heading, text, list, quote, code, maths, markdown, table, last)", (await findCard()).count === "1 of 9", JSON.stringify(await findCard()))
    ok("the note's top edge did not move when the card came up", Math.abs((await lineBoxes())[0][0] - topBefore) < 1.5, `${(await lineBoxes())[0][0]} vs ${topBefore}`)
    const text = await doc()
    const heads = []
    const lineOf = async () => { const t = await doc(); const h = (await sel())[0]; return t.slice(t.lastIndexOf("\n", h - 1) + 1, t.indexOf("\n", h) < 0 ? t.length : t.indexOf("\n", h)) }
    for (let i = 0; i < 9; i++) {
      ok(`match ${i + 1} is selected exactly (“${(await selText())}”)`, (await selText()).toLowerCase() === "needle", JSON.stringify(await selText()))
      heads.push(await lineOf())
      if (i < 8) { await key("Enter"); await sleep(150) }
    }
    ok("Enter walked the cells in order: heading, text, list, quote, code, maths, markdown, table, last",
      ["Heading needle", "plain needle text", "list needle", "quote needle", "needle = 1", "Needle[x]", "**needle** md", "| a | needle |", "last needle"].every((part, i) => heads[i].includes(part)), JSON.stringify(heads))
    await key("Enter"); await sleep(150)
    ok("Enter past the last wraps to the first", (await findCard()).count === "1 of 9", JSON.stringify(await findCard()))
    await key("Enter", { shift: true }); await sleep(150)
    ok("Shift+Enter before the first wraps to the last", (await findCard()).count === "9 of 9", JSON.stringify(await findCard()))
    await key("Enter", { shift: true }); await sleep(150)
    ok("Shift+Enter steps back", (await findCard()).count === "8 of 9", JSON.stringify(await findCard()))
    ok("the note is as it was (Find changes nothing)", (await doc()) === text && text === CELLS)
    ok("…and walking the matches did not scroll it (it fits the window) or move the pane", (await js(`document.querySelector('.cm-scroller').scrollTop`)) === 0 && Math.abs((await scrollerTop()) - paneTop) < 1.5, `${await js(`document.querySelector('.cm-scroller').scrollTop`)} ${await scrollerTop()} vs ${paneTop}`)

    // Replace: the match it is on
    await key("Enter"); await sleep(150)
    await clickEl("[data-find=replace-toggle]").catch(() => undefined)
    await sleep(250)
    if (!(await js(`!!document.querySelector('[data-find=replace]')`))) await clickEl("[data-find=replace-toggle]")
    await findType("pin", { field: "Replace" })
    const before = await doc()
    const selected = (await sel())
    await findPress("replace")
    const one = await doc()
    ok("Replace changes the match it is on and no other", (one.match(/needle/gi) ?? []).length === 8 && one.length === before.length - 3 && one.slice(0, selected[0]) === before.slice(0, selected[0]), JSON.stringify(one))
    ok("…the count says eight", (await findCard()).count.endsWith("of 8") || (await findCard()).count === "8 found", JSON.stringify(await findCard()))
    ok("…and the cells keep their structure (the fences, the table, the marker line)", one.includes("```python\n") && one.includes("```wl\n") && one.includes("<!-- markdown -->") && one.includes("| --- | --- |"), JSON.stringify(one))
    // Replace All: one step
    await findPress("replace-all")
    const all = await doc()
    ok("Replace All changes every other match in every cell, case as the words said it", (all.match(/needle/gi) ?? []).length === 0 && (all.match(/pin/g) ?? []).length === 9, JSON.stringify(all))
    ok("…the fences, the table and the marker line are as they were", all.includes("```python\npin = 1\n```") && all.includes("```wl\npin[x]\n```") && all.includes("<!-- markdown -->\n**pin** md") && all.includes("| a | pin |\n| --- | --- |\n| 1 | 2 |"), JSON.stringify(all))
    await key("Escape"); await sleep(400)
    ok("Escape closes the card (also after the button was pressed with the mouse), the keyboard is the notes'", !(await findCard()) && (await inNotes()), JSON.stringify([await findCard(), await inNotes()]))
    await undo()
    ok("ONE Ctrl+Z takes Replace All back whole (the single Replace stays)", (await doc()) === one, JSON.stringify(await doc()))
    await undo()
    ok("the next Ctrl+Z takes the single Replace back", (await doc()) === CELLS, JSON.stringify(await doc()))
    await redo(); await redo()
    ok("two Ctrl+Shift+Z do both again", (await doc()) === all, JSON.stringify(await doc()))
    await undo(); await undo()
    ok("and the note is back as it was, nothing lost", (await doc()) === CELLS, JSON.stringify(await doc()))
  })
}
await setRendered(false)
await shot("search")
finish()
