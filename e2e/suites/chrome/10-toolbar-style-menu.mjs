// THE STYLE BUTTON AND ITS MENU (docs/PLAN-bars-2026-10.md P1; Sean, 2026-10-10: "cells are inserted by picking something
// in the dropdown for style, pressing the keystroke"). The button names the caret's cell; its menu is the list the seam's +
// opens, each entry with its key. Picking runs the command exactly as its key does: the caret ends where the key leaves it,
// ONE Ctrl/Cmd+Z takes it back, and the keyboard is the notes' again. Real mouse on the bar, real keys.
import { closeAllTabs, waitFor, ok, finish, freshNote, setDoc, setSel, doc, sel, js, sleep, clickEl, key, shot, MOD, armed } from "../../lib/harness.mjs"

await freshNote()
const START = "alpha\n\nbeta words here\n\ngamma"
const WORDS = START.indexOf("words") + 2
const label = () => js(`document.querySelector('[data-bar=style] .bar-label-text')?.textContent ?? null`)
const focusIsNotes = () => js(`document.activeElement?.classList.contains('cm-content') ?? false`)
const startAt = async (text, caret) => { await setDoc(text, caret); await js(`document.querySelector('.cm-content').focus()`); await sleep(200) }
const openMenu = async () => { await clickEl('[data-bar=style]'); await sleep(250) }
const pick = async (row) => { await clickEl(`.float-menu [data-bar="kind-${row}"]`); await sleep(350) }

// ---- the button names the caret's cell, and follows the caret
const DOC = "# A title\n\nplain words\n\n- one\n- two\n\n> a quote\n\n```python\nprint(1)\n```\n\n```wl\nx^2\n```\n\n<!-- markdown -->\nsome **markdown**"
await startAt(DOC, 3)
const at = (needle, plus = 1) => DOC.indexOf(needle) + plus
const names = [["# A title", "Title", 3], ["plain words", "Text", 3], ["- one", "Dots", 3], ["> a quote", "Quote", 3], ["print(1)", "Code", 3], ["x^2", "Maths", 1], ["some **markdown**", "Markdown", 3]]
for (const [needle, want, plus] of names) {
  await setSel(at(needle, plus)); await sleep(150)
  ok(`with the caret in "${needle}" the button says ${want}`, (await label()) === want, String(await label()))
}
ok("the Style button is 110px wide and bordered", await js(`(()=>{const b=document.querySelector('[data-bar=style]');return Math.round(b.getBoundingClientRect().width)===110 && getComputedStyle(b).borderTopWidth==='1px'})()`))
await setSel(0)
await sleep(100)

// ---- the menu: the one list of kinds, each with its key, the caret's own ticked
await setSel(at("plain words", 3)); await sleep(100)
await openMenu()
const rows = await js(`JSON.stringify([...document.querySelectorAll('.float-menu button')].map(b => [b.dataset.bar, b.querySelector('.float-label')?.textContent, b.querySelector('.hint')?.textContent ?? '', b.getAttribute('aria-checked')]))`).then(JSON.parse)
const labelsOf = rows.map((r) => r[1])
ok("the menu lists Text, the six levels, the lists and the quote, the cells", JSON.stringify(labelsOf) === JSON.stringify(["Text", "Title", "Chapter", "Author", "Section", "Subsection", "Subsubsection", "Dots", "Dashes", "Numbered", "To-do", "Quote", "Markdown", "Code", "Runnable code", "Maths", "Drawing"]), JSON.stringify(labelsOf))
ok("the caret's kind (Text) is the ticked one, and only it", rows.filter((r) => r[3] === "true").map((r) => r[1]).join() === "Text", JSON.stringify(rows.filter((r) => r[3] === "true")))
const mac = await js(`navigator.userAgent.includes('Mac')`)
const hint = (name) => rows.find((r) => r[1] === name)?.[2]
ok("each entry carries its key as the menu bar shows it", hint("Title") === (mac ? "⌘1" : "Ctrl+1") && hint("Code") === (mac ? "⌘8" : "Ctrl+8") && hint("Maths") === (mac ? "⌘9" : "Ctrl+9") && hint("Drawing") === (mac ? "⌘0" : "Ctrl+0") && hint("Quote") === (mac ? "⌃⌘Q" : "Ctrl+Q"), JSON.stringify(rows.map((r) => [r[1], r[2]])))
const tip = await js(`document.querySelector('[data-bar=style]').title`)
ok("the button's tooltip names the keys of THIS machine (no hand-typed Ctrl on a Mac)", mac ? !/Ctrl/.test(tip) && /Cmd\+1–7/.test(tip) : /Ctrl\+1–7/.test(tip), tip)
await shot("menu")
await js(`document.dispatchEvent(new Event('x'))`)
await key("Escape"); await sleep(250)
ok("Escape closes it", !(await js(`!!document.querySelector('.float-menu')`)))
ok("and the keyboard is back in the notes", await focusIsNotes())
await openMenu()
await clickEl('.cm-content', {}).catch(() => {})
await sleep(250)
ok("a click anywhere else closes it too", !(await js(`!!document.querySelector('.float-menu')`)))

// ---- each kind: what the key leaves, where the caret lands, one undo
const CASES = [
  ["heading-1", "Title", "alpha\n\n# beta words here\n\ngamma", "inplace"],
  ["heading-2", "Chapter", "alpha\n\n## beta words here\n\ngamma", "inplace"],
  ["heading-6", "Author", "alpha\n\n###### beta words here\n\ngamma", "inplace"],
  ["heading-3", "Section", "alpha\n\n### beta words here\n\ngamma", "inplace"],
  ["heading-4", "Subsection", "alpha\n\n#### beta words here\n\ngamma", "inplace"],
  ["heading-5", "Subsubsection", "alpha\n\n##### beta words here\n\ngamma", "inplace"],
  ["list-dots", "Dots", "alpha\n\n- beta words here\n\ngamma", "inplace"],
  ["list-dashes", "Dashes", "alpha\n\n* beta words here\n\ngamma", "inplace"],
  ["list-numbered", "Numbered", "alpha\n\n1. beta words here\n\ngamma", "inplace"],
  ["list-todo", "To-do", "alpha\n\n- [ ] beta words here\n\ngamma", "inplace"],
  ["quote", "Quote", "alpha\n\n> beta words here\n\ngamma", "inplace"],
  ["markdown", "Markdown", "alpha\n\n<!-- markdown -->\nbeta words here\n\ngamma", "inplace"],
  ["maths", "Maths", "alpha\n\n```wl\nbeta words here\n```\n\ngamma", "inside"],
  ["code", "Code", "alpha\n\nbeta words here\n\n```\n\n```\n\ngamma", "newcell"],
  ["evaluation", "Runnable code", "alpha\n\nbeta words here\n\n```eval wl\n\n```\n\ngamma", "newcell"],
]
for (const [row, name, want, where] of CASES) {
  await startAt(START, WORDS)
  const before = await sel()
  await openMenu()
  await pick(row)
  const d = await doc()
  const [head] = (await sel()).slice(1)
  ok(`Style > ${name}: the note is what its key makes`, d === want, JSON.stringify(d))
  if (where === "inplace") ok(`${name}: the caret stays on the same words (the key's rule)`, d.slice(head - 7, head + 8) === "beta wo" + "rds here" && d.slice(head - 5, head) === "beta " || d.slice(0, head).endsWith("beta wo"), `${head} ${JSON.stringify(d.slice(head - 8, head + 8))}`)
  if (where === "inside") ok(`${name}: the caret is inside the maths cell`, head > d.indexOf("```wl") && head < d.lastIndexOf("```"), String(head))
  if (where === "newcell") ok(`${name}: the caret is inside the new empty cell`, head > d.indexOf("```", 20) && head <= d.lastIndexOf("```"), String(head))
  ok(`${name}: the button then says ${name}`, (await label()) === name, String(await label()))
  ok(`${name}: the keyboard is the notes' again`, await focusIsNotes())
  await key("z", { modifiers: MOD }); await sleep(250)
  ok(`${name}: ONE undo takes it back whole`, (await doc()) === START, JSON.stringify(await doc()))
  ok(`${name}: and the caret is where it was`, JSON.stringify(await sel()) === JSON.stringify(before), JSON.stringify([before, await sel()]))
}

// ---- Drawing: the cell and its drawing, one undo
await startAt(START, WORDS)
await openMenu(); await pick("ink")
const inked = await doc()
ok("Style > Drawing makes a drawing cell after the caret's cell (the line names its snapshot)", /^alpha\n\nbeta words here\n\n!\[ink\]\(snapshots\/ink-[0-9a-f-]{36}\.svg\)\n\ngamma$/.test(inked), JSON.stringify(inked))
await key("z", { modifiers: MOD }); await sleep(300)
ok("one undo takes the drawing cell back", (await doc()) === START, JSON.stringify(await doc()))

// ---- a list kind is the list button's style from now on, and the button's icon says so
await startAt(START, WORDS)
await openMenu(); await pick("list-numbered")
await startAt("one\n\ntwo", 1)
await clickEl('[data-bar=list]'); await sleep(300)
ok("after Style > Numbered the List button writes a numbered list", (await doc()).startsWith("1. one"), JSON.stringify(await doc()))

// ---- at an armed bar the Style menu names the kind the bar will open (the caret hides, the bar is the cursor)
await startAt("alpha\n\nbeta", 5)
await key("ArrowDown"); await sleep(250)
ok("Down from the end of a cell arms the bar under it", await armed())
ok("and the Style button says what the bar will open: Text", (await label()) === "Text", String(await label()))
await openMenu(); await pick("quote")
const atBar = await doc()
ok("Style > Quote at the bar opens a quote cell there, the bar gone", /^alpha\n\n> \n\nbeta$/.test(atBar) && !(await armed()), JSON.stringify(atBar))
ok("the caret is in the new quote cell (after its marker) and the button says Quote", (await sel())[1] === "alpha\n\n> ".length && (await label()) === "Quote", JSON.stringify([await sel(), await label()]))
await key("z", { modifiers: MOD }); await sleep(250)
ok("one undo takes the cell back", (await doc()) === "alpha\n\nbeta", JSON.stringify(await doc()))

// ---- with no note open the button greys
await closeAllTabs()
await waitFor(`!!document.querySelector('[data-bar=style]')?.disabled`, 6000).catch(() => {})
ok("with no note open the Style button stays and greys", await js(`!!document.querySelector('[data-bar=style]')?.disabled`))
finish()
