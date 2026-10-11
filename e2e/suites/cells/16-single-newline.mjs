// A SINGLE NEWLINE GROWS THE CELL (Sean, 2026-10-10: "a single newline should expand the size of the cell to include the line the
// input cursor is on"; core growth.ts). Return at the end of a paragraph leaves the caret on a new, empty line straight under the
// words. That line is the cell's: its bracket runs down to it and is lit, the rendered page keeps the cell open with no ghost line
// under it, the Style button names it, and the bar does not read the line as a seam. A BLANK line (two newlines in a row, Shift+Return
// twice) still separates cells. CHANGED 2026-10-11 (Sean: "the rendered page's Return is the same single newline"): the single newline
// is Return on BOTH pages (the rendered page's Return used to start the next block; Shift+Return was its single newline and still is
// one), and every kind of cell grows, not a paragraph's alone (cells/20 and 21 press it for every kind). Real keys and the real mouse,
// both pages.
import { ok, test, finish, js, sleep, freshNote, setDoc, doc, sel, key, click, hover, focus, setSel, setRendered, armed, lineBoxes, lineTexts, typeText, shot, menuItem, menuClick } from "../../lib/harness.mjs"

await freshNote()
const VIEW = `document.querySelector('.cm-content').cmTile.view`
const cellBrackets = async () => JSON.parse(await js(`JSON.stringify([...document.querySelectorAll('.wm-bracket:not(.wm-bracket-group)')].map(e=>{const r=e.getBoundingClientRect();return {lit:e.classList.contains('wm-bracket-lit'),top:r.top,bottom:r.bottom,h:r.height}}))`))
const sectionBrackets = async () => JSON.parse(await js(`JSON.stringify([...document.querySelectorAll('.wm-bracket-group')].map(e=>{const r=e.getBoundingClientRect();return {lit:e.classList.contains('wm-bracket-lit'),top:r.top,bottom:r.bottom,h:r.height}}))`))
const caretBox = async () => JSON.parse(await js(`(()=>{const v=${VIEW};const c=v.coordsAtPos(v.state.selection.main.head);return JSON.stringify(c&&{top:c.top,bottom:c.bottom})})()`))
const label = () => js(`document.querySelector('[data-bar=style] .bar-label-text')?.textContent ?? null`)
const start = async (text, caret) => { await setDoc(text, caret); await focus(); await sleep(300) }
/** How many lines tall a bracket is, against the one line a cell of one line is (22 px on this page). */
const LINE = 22
const lines = (b) => Math.round(b.h / LINE)

for (const rendered of [false, true]) {
  const side = rendered ? "rendered page" : "markdown side"
  await setRendered(rendered)
  // One newline: Return, on both pages.
  const newline = () => key("Enter")

  await test(`${side}: one newline at the end of the only cell: the cell, its bracket and its light take the line the caret is on`, async () => {
    await start("hello", 5)
    const before = await cellBrackets()
    ok("one bracket, one line, lit, to begin with", before.length === 1 && before[0].lit && lines(before[0]) === 1, JSON.stringify(before))
    await newline(); await sleep(300)
    ok("the note has one newline more and the caret is on its new line", (await doc()) === "hello\n" && (await sel())[0] === 6, JSON.stringify([await doc(), await sel()]))
    const after = await cellBrackets()
    ok("still ONE cell: its bracket is lit", after.length === 1 && after[0].lit, JSON.stringify(after))
    ok("and two lines tall now: it runs down to the line the caret is on", lines(after[0]) === 2, JSON.stringify(after))
    const caret = await caretBox()
    ok("the caret is inside the bracket's span, not under it", !!caret && caret.top >= after[0].top - 1 && caret.bottom <= after[0].bottom + 1, JSON.stringify({ caret, after }))
    ok("no bar is up: the line is the cell's, not a seam", !(await armed()))
    ok("the Style button names the cell the caret is in", (await label()) === "Text", String(await label()))
    ok("no ghost 'write something' line under the cell", await js(`!document.querySelector('.wm-pv-placeholder')`))
    ok("the cell is open as its own lines (on the rendered page it is not drawn over)", (await lineTexts()).includes("hello"), JSON.stringify(await lineTexts()))
    await shot(`single-newline-${rendered ? "rendered" : "markdown"}`)
  })

  await test(`${side}: typing on the new line is the same cell; undo takes the newline back and the cell is one line again`, async () => {
    await start("hello", 5)
    await newline(); await sleep(250)
    await typeText("w"); await sleep(250)
    const typed = await cellBrackets()
    ok("typed on the line: one cell of two lines, lit", (await doc()) === "hello\nw" && typed.length === 1 && typed[0].lit && lines(typed[0]) === 2, JSON.stringify([await doc(), typed]))
    await start("hello", 5)
    await newline(); await sleep(250)
    await key("z", { ctrl: true }); await sleep(300)
    const back = await cellBrackets()
    ok("ONE Ctrl+Z takes the newline back, the caret where it was", (await doc()) === "hello" && (await sel())[0] === 5, JSON.stringify([await doc(), await sel()]))
    ok("the cell is one line again and lit", back.length === 1 && back[0].lit && lines(back[0]) === 1, JSON.stringify(back))
    await key("z", { ctrl: true, shift: true }); await sleep(300)
    const again = await cellBrackets()
    ok("Redo brings the line back, and the cell takes it", (await doc()) === "hello\n" && again.length === 1 && lines(again[0]) === 2 && again[0].lit, JSON.stringify([await doc(), again]))
  })

  await test(`${side}: with another cell below: the new line is the cell's, the blank line under it is the bar, the next cell is not lit`, async () => {
    await start("hello\n\nworld", 5)
    await newline(); await sleep(300)
    ok("the note is hello, the new line, a blank line, world; no bar is up", (await doc()) === "hello\n\n\nworld" && (await sel())[0] === 6 && !(await armed()), JSON.stringify([await doc(), await sel(), await armed()]))
    const two = await cellBrackets()
    ok("two cells: the first lit and two lines tall, the second unlit and one", two.length === 2 && two[0].lit && lines(two[0]) === 2 && !two[1].lit && lines(two[1]) === 1, JSON.stringify(two))
    const caret = await caretBox()
    ok("the caret is inside the first cell's bracket", !!caret && caret.top >= two[0].top - 1 && caret.bottom <= two[0].bottom + 1, JSON.stringify({ caret, two }))
    // Down from the cell's last line (the new one) arms the bar under the cell, on the blank line that is left.
    await key("ArrowDown"); await sleep(250)
    ok("Down from the new line arms the bar under the cell (the blank line that separates)", (await armed()) && (await sel())[0] === 7, JSON.stringify([await armed(), await sel()]))
    const bar = await cellBrackets()
    ok("with the bar up the cell is its words again and nothing is lit", bar.length === 2 && lines(bar[0]) === 1 && !bar[0].lit && !bar[1].lit, JSON.stringify(bar))
    await key("ArrowUp"); await sleep(250)
    ok("Up from the bar goes back into the cell, at the end of its words", !(await armed()) && (await sel())[0] === 5, JSON.stringify([await armed(), await sel()]))
    const home = await cellBrackets()
    ok("and the cell is one line again", home.length === 2 && home[0].lit && lines(home[0]) === 1, JSON.stringify(home))
  })

  // CHANGED 2026-10-11 (Sean: "the second newline should make the cursor horizontal with the +, not start the next cell"): the second
  // Return used to leave a blank line and the caret on the line after it (the next cell, empty); it is the bar now (cells/20, 21 press
  // it for every kind). A blank line is still two newlines in a row: Shift+Return twice.
  await test(`${side}: a blank line still separates: two single newlines make one, and what is typed after it is a cell of its own`, async () => {
    await start("hello", 5)
    await newline(); await sleep(200)
    await key("Enter", { shift: true }); await sleep(300)
    ok("two newlines in a row: a blank line between hello and the caret", (await doc()) === "hello\n\n" && (await sel())[0] === 7 && !(await armed()), JSON.stringify([await doc(), await sel(), await armed()]))
    const apart = await cellBrackets()
    ok("hello is one line again, not lit: the caret is not in it", apart.length === 1 && lines(apart[0]) === 1 && !apart[0].lit, JSON.stringify(apart))
    await typeText("x"); await sleep(250)
    const two = await cellBrackets()
    ok("what is typed is a cell of its own, lit", (await doc()) === "hello\n\nx" && two.length === 2 && !two[0].lit && two[1].lit, JSON.stringify([await doc(), two]))
  })

  await test(`${side}: the second Return arms the bar; what is typed there is a cell of its own, lit`, async () => {
    await start("hello", 5)
    await newline(); await sleep(200)
    await newline(); await sleep(300)
    ok("the grown line is gone, the bar is up", (await doc()) === "hello" && (await armed()), JSON.stringify([await doc(), await armed()]))
    await typeText("x"); await sleep(250)
    const two = await cellBrackets()
    ok("what is typed is a cell of its own, lit", (await doc()) === "hello\n\nx" && two.length === 2 && !two[0].lit && two[1].lit, JSON.stringify([await doc(), two]))
  })

  await test(`${side}: Backspace on the new line takes the newline back: the cell is one line again, the caret at the end of its words`, async () => {
    for (const text of ["hello", "hello\n\nworld"]) {
      await start(text, 5)
      await newline(); await sleep(250)
      await key("Backspace"); await sleep(300)
      const back = await cellBrackets()
      ok(`${JSON.stringify(text)}: the note and the caret are as they were`, (await doc()) === text && (await sel())[0] === 5, JSON.stringify([await doc(), await sel()]))
      ok("and the first cell is one line, lit", back[0].lit && lines(back[0]) === 1, JSON.stringify(back))
    }
  })

  await test(`${side}: the caret leaving the line gives the cell back its words`, async () => {
    await start("hello\n\nworld", 5)
    await newline(); await sleep(250)
    await setSel(9); await sleep(300)
    const moved = await cellBrackets()
    ok("the caret is in world: hello is one line, not lit, and world is lit", moved.length === 2 && lines(moved[0]) === 1 && !moved[0].lit && moved[1].lit, JSON.stringify(moved))
    await setSel(6); await sleep(300)
    const back = await cellBrackets()
    ok("and back on the line the first cell takes it again", back[0].lit && lines(back[0]) === 2 && !back[1].lit, JSON.stringify(back))
  })

  // (The rendered page draws a blank line between two cells as a gap. The caret walking between the new line and the words of the
  // SAME cell leaves that cell open all the while, so nothing else tells the page the line changed hands.)
  await test(`${side}: the caret walking between the words and the new line: the line is the cell's under it and a gap away from it`, async () => {
    if (!rendered) return
    const gaps = async () => JSON.parse(await js(`JSON.stringify([...document.querySelectorAll('.cm-line')].map(l=>[l.classList.contains('wm-gap'),l.textContent]))`))
    await start("hello\n\nworld", 5)
    await newline(); await sleep(250)
    const on = await gaps()
    ok("on the new line it is the cell's: no gap is drawn there", !!on[1] && on[1][0] === false, JSON.stringify(on))
    await setSel(2); await sleep(300)
    const off = await gaps()
    ok("with the caret in the words (the cell still open) the line is a gap again", !!off[1] && off[1][0] === true, JSON.stringify(off))
    await setSel(6); await sleep(300)
    const again = await gaps()
    ok("and back on the line it is the cell's", !!again[1] && again[1][0] === false, JSON.stringify(again))
  })

  // (The whole-cell commands of the Format menu act on the cell the caret is in: the new line is that cell's. A bar is the cursor and
  // no cell has the caret then, and the bar armed by hand under the last cell of a note that ends with its newline stands on that line.)
  await test(`${side}: Duplicate Cell from the new line copies that cell; at the armed bar under it the menu takes no cell`, async () => {
    const format = async (label) => { const item = await menuItem("Format", label); await menuClick(item.id); await sleep(350) }
    await start("hello\n", 6)
    ok("the caret is on the new line, no bar up", !(await armed()) && (await sel())[0] === 6, JSON.stringify([await armed(), await sel()]))
    await format(/Duplicate Cell/)
    ok("Duplicate Cell copies the cell the line belongs to", (await doc()) === "hello\n\nhello\n", JSON.stringify(await doc()))
    await start("hello\n", 0)
    await click(300, 400); await sleep(300)
    ok("a click in the page under the cell arms the bar there", await armed(), JSON.stringify([await armed(), await sel()]))
    await format(/Delete Cell/)
    ok("Delete Cell at the bar takes no cell", (await doc()) === "hello\n", JSON.stringify(await doc()))
    await format(/Duplicate Cell/)
    ok("nor does Duplicate Cell", (await doc()) === "hello\n", JSON.stringify(await doc()))
  })

  await test(`${side}: Merge Cells from the new line joins that cell to the one below it, not the note's last two`, async () => {
    await start("a\n\nb\n\nc", 4)
    await newline(); await sleep(250)
    ok("the new line is under b", (await doc()) === "a\n\nb\n\n\nc" && (await sel())[0] === 5, JSON.stringify([await doc(), await sel()]))
    await key("m", { ctrl: true }); await sleep(300)
    ok("Ctrl+M joins b and c (not the note's last two cells)", (await doc()) === "a\n\nb\nc", JSON.stringify(await doc()))
    await key("z", { ctrl: true }); await sleep(250)
    ok("ONE Ctrl+Z undoes the merge", (await doc()) === "a\n\nb\n\n\nc", JSON.stringify(await doc()))
  })

  await test(`${side}: in a section, the section's bracket reaches the line the cell has taken`, async () => {
    await start("# Title\n\nbody words\n\n# Next\n\nmore", 20)
    await setSel("# Title\n\nbody words".length); await sleep(150)
    await newline(); await sleep(300)
    const d = await doc()
    ok("the new line is under the body words", d === "# Title\n\nbody words\n\n\n# Next\n\nmore", JSON.stringify(d))
    const cells = await cellBrackets()
    const sections = await sectionBrackets()
    const body = cells.find((c) => c.lit)
    const title = sections[0]
    ok("the body cell is lit and two lines tall", !!body && lines(body) === 2, JSON.stringify(cells))
    ok("the Title section's bracket reaches down with it, never short of the cell inside", !!title && !!body && title.bottom >= body.bottom - 1, JSON.stringify({ sections, body }))
  })

  await test(`${side}: a markdown cell names itself on the Style button from its new line`, async () => {
    await start("<!-- markdown -->\nsome **words**", "<!-- markdown -->\nsome **words**".length)
    await newline(); await sleep(300)
    const b = await cellBrackets()
    ok("the markdown cell took the line and is lit", b.length === 1 && b[0].lit, JSON.stringify(b))
    ok("the Style button says Markdown", (await label()) === "Markdown", String(await label()))
  })

  // CHANGED 2026-10-11 (Sean: "a single newline grows all those contents"): the line under a heading, a list, a quote and a fence was
  // nobody's (unlit, the Style button had nothing to name); it is the cell's now, like a paragraph's.
  await test(`${side}: a heading, a list, a quote and code are grown too: the empty line under them is theirs`, async () => {
    for (const [text, name] of [["# Title", "heading"], ["- item", "list"], ["> quote", "quote"], ["```\ncode\n```", "code"]]) {
      await start(text, text.length)
      const before = await cellBrackets()
      await start(text + "\n", text.length + 1)
      const b = await cellBrackets()
      ok(`under a ${name} the caret is in the cell: it takes the line and is lit, taller`, b.length === 1 && b[0].lit && b[0].h > before[0].h + 8, JSON.stringify([text, before, b]))
    }
  })

  await test(`${side}: the + on the bar under the grown cell makes the kind picked, below it, the caret where its words go`, async () => {
    await start("hello", 5)
    await newline(); await sleep(300)
    const boxes = await lineBoxes()
    await hover(700, boxes[1][1] + 24); await sleep(250)
    const plus = JSON.parse(await js(`(()=>{const e=document.querySelector('.wm-plus'); if(!e) return 'null'; const r=e.getBoundingClientRect(); return JSON.stringify({cx:r.x+r.width/2,cy:r.y+r.height/2})})()`))
    ok("the + is on the bar under the new line, not over it", !!plus && plus.cy > boxes[1][1], JSON.stringify({ plus, boxes }))
    if (!plus) return
    await click(plus.cx, plus.cy); await sleep(300)
    await js(`[...document.querySelectorAll('#seam-kinds .float-label')].find(b=>b.textContent==='Dots').closest('button').click()`); await sleep(350)
    ok("a list is made under the cell, one blank line between, the caret after its marker", (await doc()) === "hello\n\n- " && (await sel())[0] === 9, JSON.stringify([await doc(), await sel()]))
    ok("the keyboard is in the notes: the next thing typed is the item", await js(`document.activeElement?.closest('.cm-content') !== null`))
    await typeText("x"); await sleep(250)
    ok("and goes into the new list", (await doc()) === "hello\n\n- x", JSON.stringify(await doc()))
  })

  await test(`${side}: the caret line is not a seam: hovering it draws no bar, the gap under it does`, async () => {
    if (rendered) return
    await start("hello\n\nworld", 5)
    await newline(); await sleep(300)
    const boxes = await lineBoxes()
    const middle = (i) => Math.round((boxes[i][0] + boxes[i][1]) / 2)
    await hover(700, middle(1)); await sleep(200)
    ok("over the new line (the cell's) no bar is drawn", await js(`!document.querySelector('.wm-bar')`) && (await js(`document.querySelector('.cm-scroller').dataset.wmPointer ?? ''`)) === "", await js(`document.querySelector('.cm-scroller').dataset.wmPointer ?? ''`))
    await hover(700, middle(2)); await sleep(200)
    ok("over the blank line under it (the seam) the faint bar is drawn", await js(`!!document.querySelector('.wm-bar')`))
  })
}
finish()
