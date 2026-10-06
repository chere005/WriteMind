// The arrows walk cell, bar, cell on the MARKDOWN side (Sean, 2026-10-05: "pressing down arrow at the bottom of a
// cell should move the cursor beneath the cell horizontally"), with real key presses: a paragraph, a wrapped one, a
// heading with a paragraph touching it, a list, a code block with an empty line, a table, an ink cell, an In/Out
// pair and a closed section, walked Down from the top to the end and Up back; Enter / typing / Escape / Left /
// Right / Shift+Down at a bar an arrow armed. The rules are packages/editor/src/barWalk.ts (barWalk.test.ts).
import {
  ok, finish, js, sleep, freshNote, setDoc, doc, sel, key, typeText, focus, armed, setSel, setRendered, brackets,
  dblclick, lineBoxes, shot, writeNoteFile, VIEW, CTRL,
} from "../../lib/harness.mjs"

await freshNote()
await setRendered(false)

const INK = "0f0e0d0c-0b0a-4908-8706-050403020100"
await writeNoteFile(`.drawings/media/ink-${INK}.svg`,
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 120" width="400" height="120"><path d="M20 90 C80 10 140 110 200 40 S320 20 380 80" stroke="#4a9eff" stroke-width="6" fill="none" stroke-linecap="round"/></svg>`)

const LONG = "A long paragraph " + "that wraps round the column and keeps going ".repeat(9) + "to its end."
const D = [
  "Para one", "",
  LONG, "",
  "# Heading", "Right under the heading", "",
  "- item a", "- item b", "",
  "```js", "let x = 1", "", "let y = 2", "```", "",
  "| a | b |", "|---|---|", "| 1 | 2 |", "",
  `![ink](.drawings/media/ink-${INK}.svg)`, "",
  "```python", "1+1", "```", "",
  "```out", "2", "```", "",
  "# Closed", "", "hidden one", "", "hidden two", "",
  "# After", "",
  "Last para",
].join("\n")
const at = (s, from = 0) => { const i = D.indexOf(s, from); if (i < 0) throw new Error("no " + s); return i }
const O = {
  long: at(LONG), heading: at("# Heading"), under: at("Right under"), list: at("- item a"), code: at("```js"),
  emptyInCode: at("let x = 1\n") + 10, closeJs: at("```\n\n| a"), table: at("| a |"), lastRow: at("| 1 |"),
  ink: at("![ink]"), py: at("```python"), closePy: at("```\n\n```out"), out: at("```out"), closeOut: at("```\n\n# Closed"),
  closed: at("# Closed"), after: at("# After"), last: at("Last para"),
}

await setDoc(D, 0); await focus(); await sleep(400)

// Close "# Closed" with a double-click on its section bracket (scrolled into view first).
{
  // (Measured again on each try: the ink cell's picture loading moves everything under it.)
  for (let i = 0; i < 4 && (await js(`document.querySelectorAll('.wm-folded').length`)) === 0; i++) {
    await js(`(()=>{const v=${VIEW};v.scrollDOM.scrollTop=v.lineBlockAt(${O.closed}).top-120})()`); await sleep(600)
    const lines = await lineBoxes()
    const top = lines.find((l) => l[2] === "# Closed")[0]
    const group = (await brackets(".wm-bracket-group")).sort((a, b) => Math.abs(a.top - top) - Math.abs(b.top - top))[0]
    await dblclick(group.right, Math.min(group.y, group.top + 12)); await sleep(400)
  }
  ok("the section is closed for the walk", (await js(`document.querySelectorAll('.wm-folded').length`)) === 1)
}

const state = async () => JSON.parse(await js(`(()=>{const v=${VIEW};const s=v.state.selection.main;
  const a=v.__wmSeams?v.__wmSeams.armed():null;const l=v.state.doc.lineAt(s.head);
  return JSON.stringify({head:s.head,anchor:s.anchor,assoc:s.assoc,armed:a,cls:document.querySelector('.cm-editor').classList.contains('wm-armed'),
    line:l.text.slice(0,24),bars:document.querySelectorAll('.wm-bar:not(.wm-bar-faint):not(.wm-bar-drop)').length,
    caret:getComputedStyle(document.querySelector('.cm-cursor-primary')||document.body).visibility})})()`))
/** The row on screen of a position, as its top in client px. */
const rowTop = (pos, side = 1) => js(`(()=>{const c=${VIEW}.coordsAtPos(${pos},${side});return c?Math.round(c.top):null})()`)
const step = async (k, o) => { await key(k, o); await sleep(60); return state() }

// ---- Down from the top to the end
await setSel(5); await focus(); await sleep(100)
const downArmed = []
let s = await step("ArrowDown")
ok("Down on the last line of a cell arms the bar beneath it", s.armed === O.long && s.cls && s.head === O.long - 1, s)
ok("...the bar is drawn and the text caret is hidden", s.bars === 1 && s.caret === "hidden", s)
await shot("bar-under-para")
downArmed.push(s.armed)
s = await step("ArrowDown")
ok("Down from the bar goes into the cell below, at the column the caret was walking down", s.armed === null && !s.cls && s.head > O.long && s.head < O.long + 12, s)
ok("...on its first row", (await rowTop(s.head, s.assoc || -1)) === (await rowTop(O.long)), s)
// The wrapped paragraph: its rows, then the bar under it only from the last one.
const lastRow = await rowTop(O.heading - 2, -1)
let rows = 1
for (let i = 0; i < 20; i++) {
  const before = s
  s = await step("ArrowDown")
  if (s.armed !== null) {
    ok("the wrapped paragraph's bar comes only from its last row on screen", (await rowTop(before.head, before.assoc || -1)) === lastRow && rows >= 3, { rows, before })
    break
  }
  rows++
  ok(`row ${rows} of the wrapped paragraph is walked by the editor's own arrow`, s.head > before.head && s.head <= O.heading - 2, s)
}
ok("Down off the wrapped paragraph arms the seam above the heading", s.armed === O.heading && s.head === O.heading - 1, s)
downArmed.push(s.armed)
s = await step("ArrowDown")
ok("into the heading", s.armed === null && s.line.startsWith("# Heading"), s)
s = await step("ArrowDown")
ok("Down from a heading arms the seam to the paragraph touching it (no blank line: armed by hand)", s.armed === O.under && s.head === O.under && s.cls, s)
await shot("bar-under-heading")
downArmed.push(s.armed)
s = await step("ArrowDown")
ok("...and Down again is the start of that paragraph", s.armed === null && s.head === O.under && !s.cls, s)
s = await step("ArrowDown")
ok("the bar under it", s.armed === O.list, s); downArmed.push(s.armed)
s = await step("ArrowDown"); ok("the list's first item", s.armed === null && s.line === "- item a", s)
s = await step("ArrowDown"); ok("the list's last item is still the list (one cell)", s.armed === null && s.line === "- item b", s)
s = await step("ArrowDown"); ok("the bar under the list", s.armed === O.code, s); downArmed.push(s.armed)
s = await step("ArrowDown"); ok("the code block's opening fence", s.armed === null && s.line === "```js", s)
s = await step("ArrowDown"); ok("code", s.armed === null && s.line === "let x = 1", s)
s = await step("ArrowDown"); ok("the empty line INSIDE the code block is no seam", s.armed === null && s.head === O.emptyInCode && !s.cls, s)
s = await step("ArrowDown"); ok("code again", s.armed === null && s.line === "let y = 2", s)
s = await step("ArrowDown"); ok("the closing fence", s.armed === null && s.head >= O.closeJs && s.head <= O.closeJs + 3, s)
s = await step("ArrowDown"); ok("only the closing fence is the code block's bottom: the bar under it", s.armed === O.table, s); downArmed.push(s.armed)
s = await step("ArrowDown"); ok("the table's header row", s.armed === null && s.line.startsWith("| a"), s)
s = await step("ArrowDown"); s = await step("ArrowDown")
ok("the table's last row", s.armed === null && s.line.startsWith("| 1"), s)
s = await step("ArrowDown"); ok("the bar under the table, above the ink cell", s.armed === O.ink && s.head === O.ink - 1, s); downArmed.push(s.armed)
s = await step("ArrowDown")
ok("Down onto the ink cell steps over it to the bar beneath it (no caret in it)", s.armed === O.py && s.head === O.py - 1 && s.cls, s)
await shot("bar-under-ink")
downArmed.push(s.armed)
s = await step("ArrowDown"); ok("the evaluation cell", s.armed === null && s.line === "```python", s)
s = await step("ArrowDown"); s = await step("ArrowDown")
ok("its closing fence", s.armed === null && s.head >= O.closePy && s.head <= O.closePy + 3, s)
s = await step("ArrowDown"); ok("the seam between In and Out arms, as a click there does", s.armed === O.out, s); downArmed.push(s.armed)
s = await step("ArrowDown"); s = await step("ArrowDown"); s = await step("ArrowDown")
ok("the answer's closing fence", s.armed === null && s.head >= O.closeOut && s.head <= O.closeOut + 3, s)
s = await step("ArrowDown"); ok("the bar above the closed section", s.armed === O.closed, s); downArmed.push(s.armed)
s = await step("ArrowDown"); ok("the closed heading", s.armed === null && s.line === "# Closed", s)
s = await step("ArrowDown")
ok("Down from a closed section steps over all it hides, to the bar under it", s.armed === O.after && s.cls && s.bars === 1, s)
await shot("bar-under-closed")
downArmed.push(s.armed)
s = await step("ArrowDown"); ok("the next heading", s.armed === null && s.line === "# After", s)
s = await step("ArrowDown"); ok("the bar above the last cell", s.armed === O.last, s); downArmed.push(s.armed)
s = await step("ArrowDown"); ok("the last cell", s.armed === null && s.line === "Last para", s)
s = await step("ArrowDown")
ok("Down at the end of the note arms the bar after the last cell", s.armed === D.length && s.head === D.length && s.cls && s.bars === 1, s)
await shot("bar-after-last")
downArmed.push(s.armed)
s = await step("ArrowDown")
ok("...and Down there stays", s.armed === D.length && s.head === D.length, s)
ok("the walk wrote nothing", (await doc()) === D)

// ---- Up back to the top: the same bars, the other way, and the one above the first cell
const upArmed = []
for (let i = 0; i < 60; i++) {
  s = await step("ArrowUp")
  if (s.armed !== null && upArmed[upArmed.length - 1] !== s.armed) upArmed.push(s.armed)
  if (s.armed === 0) break
}
ok("Up walks back through the same bars, and arms the one above the first cell", JSON.stringify(upArmed) === JSON.stringify([...downArmed].reverse().slice(1).concat([0])), { upArmed, downArmed })
s = await step("ArrowUp")
ok("Up at the top stays on the bar", s.armed === 0 && s.head === 0, s)
s = await step("ArrowDown")
ok("Down from the top bar is the first cell", s.armed === null && s.head === 0 && !s.cls, s)
ok("the walk back wrote nothing", (await doc()) === D)

// ---- Up from the bar into the cell above lands on its LAST row (the wrapped paragraph)
await setSel(O.heading); await focus()
s = await step("ArrowUp"); ok("Up from a heading arms the bar above it", s.armed === O.heading && s.head === O.heading - 1, s)
s = await step("ArrowUp")
ok("Up from that bar goes into the wrapped paragraph's last row", s.armed === null && (await rowTop(s.head, s.assoc || -1)) === (await rowTop(O.heading - 2, -1)), s)

// ---- A cell written at the bar under the closed section is that section's: it opens, so nothing goes out of sight
await setSel(O.closed + 3); await focus()
s = await step("ArrowDown")
ok("(armed under the closed section)", s.armed === O.after, s)
await typeText("Y"); await sleep(250)
s = await state()
ok("typing at the bar under a closed section writes the cell and opens the section",
  (await doc()).includes("hidden two\n\nY\n\n# After") && (await js(`document.querySelectorAll('.wm-folded').length`)) === 0
  && s.line === "Y" && s.caret === "visible", { s, folds: await js(`document.querySelectorAll('.wm-folded').length`) })
await key("z", { modifiers: CTRL }); await sleep(150)
ok("(Ctrl+Z takes the cell back)", (await doc()) === D)

// ---- Escape: the bar goes out and the caret is back where the arrow found it
await setSel(3); await focus()
s = await step("ArrowDown"); ok("(armed again under the first paragraph)", s.armed === O.long, s)
s = await step("Escape")
ok("Escape puts the bar out and gives the caret back where it was", s.armed === null && !s.cls && s.head === 3 && (await doc()) === D, s)
await setSel(O.heading + 4); await focus()
s = await step("ArrowDown"); s = await step("Escape")
ok("...the same for a bar armed by hand between two cells that touch", s.armed === null && s.head === O.heading + 4, s)

// ---- Left / Right at a bar
await setSel(O.heading + 4); await focus()
s = await step("ArrowDown"); s = await step("ArrowRight")
ok("Right at a bar between cells that touch is the start of the cell below", s.armed === null && s.head === O.under, s)
await setSel(O.heading + 4); await focus()
s = await step("ArrowDown"); s = await step("ArrowLeft")
ok("Left there is the end of the cell above", s.armed === null && s.head === O.under - 1, s)
await setSel(3); await focus()
s = await step("ArrowDown"); s = await step("ArrowLeft")
ok("Left at a bar on a blank line is the end of the cell above", s.armed === null && s.head === 8, s)

// ---- Shift+Down selects, Ctrl+Down is not the bar's
await setSel(0); await focus()
s = await step("ArrowDown", { shift: true })
ok("Shift+Down selects (no bar)", s.armed === null && s.anchor === 0 && s.head > 0, s)

// ---- Enter and typing at a bar an arrow armed open a cell there
await setSel(3); await focus()
await step("ArrowDown"); await key("Enter"); await sleep(150)
s = await state()
ok("Enter at the bar opens an empty cell there", (await doc()) === D.replace("Para one\n\n", "Para one\n\n\n\n") && s.head === O.long && s.armed === null, { s, d: (await doc()).slice(0, 30) })
await key("z", { modifiers: CTRL }); await sleep(150)
ok("(Ctrl+Z takes it back)", (await doc()) === D)
await setSel(O.heading + 4); await focus()
await step("ArrowDown"); await typeText("X"); await sleep(150)
ok("typing at the bar between cells that touch makes a cell between them", (await doc()).includes("# Heading\n\nX\n\nRight under the heading"), (await doc()).slice(O.heading, O.heading + 40))
await key("z", { modifiers: CTRL }); await sleep(150)
await setSel(O.last + 3); await focus()
await step("ArrowDown"); await typeText("Z"); await sleep(150)
ok("typing at the bar after the last cell makes a new last cell", (await doc()) === D + "\n\nZ", JSON.stringify((await doc()).slice(-16)))
await key("z", { modifiers: CTRL }); await sleep(150)
ok("(and back)", (await doc()) === D)

// ---- The rendered page keeps its own walk
await setRendered(true)
await setDoc("One\n\nTwo", 1); await focus(); await sleep(300)
s = await step("ArrowDown")
ok("on the rendered page Down off a cell still lands on the bar", s.armed === 5 && s.head === 4 && s.cls, s)
s = await step("ArrowDown")
ok("...and Down again is the next block", s.armed === null && s.head >= 5, s)
await setRendered(false)
finish()
