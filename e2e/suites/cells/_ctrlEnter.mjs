// CTRL+ENTER, THE NEWLINE THAT NEVER LEAVES THE CELL (Sean, 2026-10-11: "ctrl + enter adds a newline without leaving the current
// cell.."; "this should not be two separate cells"). Wherever the caret is in a cell, Ctrl+Enter (⌘↩ on a Mac, and the real ⌃↩
// there too) puts a line break there and the caret stays in the SAME cell, on the new line: no bar, no new item, no second
// cell — again and again, empty lines too (an empty line inside a cell is written `<br>`, drawn as nothing: core
// markdown/emptyLine.ts). In a list it is the same item's next line, in a quote the quote's, in a fence a plain newline; a
// heading does nothing. Typing on an empty line makes it words, Backspace takes it away as one line, one Undo takes one
// Ctrl+Enter back, and the lines survive a save and a reload. The real keys and the real mouse, on the markdown side and on the
// rendered page. The rules: core cells/lineInCell.ts, editor emptyLines.ts (unit tests: core and editor lineInCell.test.ts).
import path from "node:path"
import { ok, test, js, sleep, until, freshNote, setDoc, doc, sel, key, click, clickEl, focus, setSel, setRendered, armed, typeText, shot, reloadApp, openNote, waitFor, menuClick } from "../../lib/harness.mjs"
import { readWm } from "../../lib/wm.mjs"

export async function runCtrlEnter({ rendered }) {
  const file = await freshNote()
  const name = path.basename(file).replace(/\.wm$/, "")
  const side = rendered ? "rendered page" : "markdown side"
  await setRendered(rendered)

  const cellBrackets = async () => JSON.parse(await js(`JSON.stringify([...document.querySelectorAll('.wm-bracket:not(.wm-bracket-group)')].map(e=>{const r=e.getBoundingClientRect();return {lit:e.classList.contains('wm-bracket-lit'),top:r.top,bottom:r.bottom,h:r.height}}))`))
  // (The caret goes to 0 and back: a bar left up by the test before would otherwise "stand" in the new note.)
  const start = async (text, caret) => { await setDoc(text, caret); await setSel(0); await setSel(caret); await focus(); await sleep(300) }
  // Ctrl+Enter as the app spells it (⌘↩ on a Mac: e2e/lib/macKeys.mjs reads the command table), and the real Control key.
  const ctrlEnter = async () => { await key("Enter", { ctrl: true }); await sleep(250) }
  const realCtrlEnter = async () => { await key("Enter", { ctrl: true, raw: true }); await sleep(250) }
  /** The lines of the editor as drawn: their text on screen and their boxes. */
  const drawnLines = async () => JSON.parse(await js(`JSON.stringify([...document.querySelectorAll('.cm-content .cm-line')].map(l=>{const r=l.getBoundingClientRect();return {text:l.textContent,top:r.top,bottom:r.bottom}}))`))
  /** Where the caret is drawn (the primary cursor's box), and where the editor says the caret is. */
  const caretBox = async () => JSON.parse(await js(`(()=>{const v=document.querySelector('.cm-content').cmTile.view;const c=v.coordsAtPos(v.state.selection.main.head);const d=document.querySelector('.cm-cursor-primary')?.getBoundingClientRect();return JSON.stringify({top:c?.top??null,bottom:c?.bottom??null,drawn:d?{top:d.top,bottom:d.bottom}:null})})()`))
  const atLine = async (n) => JSON.parse(await js(`(()=>{const v=document.querySelector('.cm-content').cmTile.view;const l=v.state.doc.line(${n});const c=v.coordsAtPos(l.from);return JSON.stringify(c?{top:c.top,bottom:c.bottom}:null)})()`))

  await test(`${side}: Ctrl+Enter at the end of a text cell adds lines to the SAME cell, empty ones too, and never arms the bar`, async () => {
    await start("hello\n\nworld", 5)
    const before = await cellBrackets()
    ok("two cells, the first lit, to begin with", before.length === 2 && before[0].lit && !before[1].lit, JSON.stringify(before))

    await ctrlEnter()
    ok("Ctrl+Enter: an empty line kept in the cell (`<br>`), the caret on it", (await doc()) === "hello\n<br>\n\nworld" && (await sel())[0] === 10, JSON.stringify([await doc(), await sel()]))
    ok("no bar is up", !(await armed()), String(await armed()))
    const one = await cellBrackets()
    ok("still two cells: the first lit and a line taller, the second not lit", one.length === 2 && one[0].lit && !one[1].lit && one[0].h > before[0].h + 12, JSON.stringify({ before, one }))
    const lines = await drawnLines()
    ok("the new line is drawn EMPTY (nothing of `<br>` shows) and is a line of its own under hello", lines[0]?.text === "hello" && lines[1]?.text === "" && lines[1].top >= lines[0].bottom - 1, JSON.stringify(lines.slice(0, 3)))
    const caret = await caretBox()
    const second = await atLine(2)
    ok("the caret is drawn on the new line", !!caret.drawn && !!second && Math.abs(caret.drawn.top - second.top) < 6, JSON.stringify({ caret, second }))

    // Again, with the real Control key (on a Mac ⌘↩ above, ⌃↩ here; on a PC both are Ctrl+Enter).
    await realCtrlEnter()
    await ctrlEnter()
    ok("again and again: three empty lines, every one the cell's (Return, Return would have armed the bar)", (await doc()) === "hello\n<br>\n<br>\n<br>\n\nworld" && (await sel())[0] === 20 && !(await armed()), JSON.stringify([await doc(), await sel(), await armed()]))
    const three = await cellBrackets()
    ok("still two cells, the first lit, three lines taller", three.length === 2 && three[0].lit && three[0].h > before[0].h + 50, JSON.stringify({ before, three }))
    if (!rendered) await shot("markdown-three-empty-lines")

    await typeText("more"); await sleep(300)
    ok("typing on the empty line makes it a line of words (the `<br>` goes), in the same cell", (await doc()) === "hello\n<br>\n<br>\nmore\n\nworld" && (await cellBrackets()).length === 2, JSON.stringify([await doc(), await cellBrackets()]))
    // The contrast: Return, Return ends the cell at the bar (and the cell keeps its empty lines).
    await key("Enter"); await sleep(250)
    await key("Enter"); await sleep(350)
    ok("Return, Return after it is still the bar's, the cell's empty lines kept", (await doc()) === "hello\n<br>\n<br>\nmore\n\nworld" && (await armed()), JSON.stringify([await doc(), await armed()]))
    ok("two cells still: the empty lines are inside the first", (await cellBrackets()).length === 2)
  })

  await test(`${side}: Ctrl+Enter in the middle of a line breaks it in the same cell; at a cell's start an empty line goes above the words`, async () => {
    await start("hello world\n\nnext", 6)
    await ctrlEnter()
    ok("the words after the caret go down a line, the caret with them, one cell", (await doc()) === "hello \nworld\n\nnext" && (await sel())[0] === 7 && (await cellBrackets()).length === 2, JSON.stringify([await doc(), await sel(), await cellBrackets()]))
    await start("first\n\nsecond", 7)
    await ctrlEnter()
    ok("at the start of the second cell: an empty line above its words, in that cell", (await doc()) === "first\n\n<br>\nsecond" && (await sel())[0] === 12 && (await cellBrackets()).length === 2, JSON.stringify([await doc(), await sel(), await cellBrackets()]))
  })

  await test(`${side}: Backspace takes an empty line away as one line, and ONE Undo takes ONE Ctrl+Enter back`, async () => {
    await start("hello", 5)
    await ctrlEnter(); await ctrlEnter(); await ctrlEnter()
    ok("three empty lines", (await doc()) === "hello\n<br>\n<br>\n<br>", JSON.stringify(await doc()))
    await key("Backspace"); await sleep(300)
    ok("Backspace: the last one goes, the caret at the end of the one above", (await doc()) === "hello\n<br>\n<br>" && (await sel())[0] === 15 && (await cellBrackets()).length === 1, JSON.stringify([await doc(), await sel()]))
    await key("z", { ctrl: true }); await sleep(300)
    ok("Undo gives it back", (await doc()) === "hello\n<br>\n<br>\n<br>", JSON.stringify(await doc()))
    await key("z", { ctrl: true }); await sleep(300)
    ok("one Undo: one Ctrl+Enter back", (await doc()) === "hello\n<br>\n<br>", JSON.stringify(await doc()))
    await key("z", { ctrl: true }); await sleep(300)
    ok("and the next", (await doc()) === "hello\n<br>", JSON.stringify(await doc()))
    await key("z", { ctrl: true }); await sleep(300)
    ok("and the first: the note as it was", (await doc()) === "hello" && (await sel())[0] === 5, JSON.stringify([await doc(), await sel()]))
    // Left from an empty line goes on to the line above (the caret never stands in front of the hidden `<br>`).
    await ctrlEnter()
    await key("ArrowLeft"); await sleep(250)
    ok("Left from the empty line: the end of hello", (await sel())[0] === 5, JSON.stringify(await sel()))
    await key("ArrowRight"); await sleep(250)
    ok("Right again: back on the empty line (after its hidden `<br>`)", (await sel())[0] === 10, JSON.stringify(await sel()))
  })

  await test(`${side}: in a list item Ctrl+Enter is the same item's next line — no new item, no marker taken off`, async () => {
    await start("- one\n- two", 5)
    await ctrlEnter()
    ok("an empty line under the item's words, no marker on it", (await doc()) === "- one\n  <br>\n- two" && (await sel())[0] === 12, JSON.stringify([await doc(), await sel()]))
    ok("one cell, lit, no bar", (await cellBrackets()).length === 1 && (await cellBrackets())[0].lit && !(await armed()))
    await typeText("more"); await sleep(300)
    ok("typed on: the item's second line", (await doc()) === "- one\n  more\n- two", JSON.stringify(await doc()))
    if (!rendered) ok("two bullets are drawn, not three", (await js(`document.querySelectorAll('.cm-content .wm-bullet').length`)) === 2, String(await js(`document.querySelectorAll('.cm-content .wm-bullet').length`)))
    // Backspace on an item's empty line takes the line away whole.
    await start("- one\n- two", 5)
    await ctrlEnter()
    await key("Backspace"); await sleep(300)
    ok("Backspace on the item's empty line: the list as it was, the caret at the end of one", (await doc()) === "- one\n- two" && (await sel())[0] === 5, JSON.stringify([await doc(), await sel()]))
    // On an empty item, where Return would take the marker off: Ctrl+Enter keeps it and adds the item's next line.
    await start("- one\n- ", 8)
    await ctrlEnter()
    ok("an empty item keeps its marker: its first line is kept empty, the caret on its next line", (await doc()) === "- one\n- <br>\n  <br>" && (await cellBrackets()).length === 1 && !(await armed()), JSON.stringify([await doc(), await cellBrackets()]))
    await start("- [ ] milk", 10)
    await ctrlEnter()
    await typeText("and eggs"); await sleep(300)
    ok("a to-do: the words on the item's next line, under its words", (await doc()) === "- [ ] milk\n      and eggs" && (await cellBrackets()).length === 1, JSON.stringify(await doc()))
  })

  await test(`${side}: in a quote a new line of the quote; in a code block a plain newline inside the fence; in a heading nothing`, async () => {
    await start("> a", 3)
    await ctrlEnter()
    await typeText("b"); await sleep(250)
    // (The new quote line starts with `<br>`, hidden: a quote's lines join with a space when it is drawn — the review of
    // agent/ctrlenter, P1. It used to be `> b`.)
    ok("a quote: `> <br>b` under `> a`, one cell", (await doc()) === "> a\n> <br>b" && (await cellBrackets()).length === 1, JSON.stringify(await doc()))
    await start("```\nx\n```", 5)
    await ctrlEnter()
    ok("a code block: an empty line in the code, the caret on it", (await doc()) === "```\nx\n\n```" && (await sel())[0] === 6 && (await cellBrackets()).length === 1, JSON.stringify([await doc(), await sel()]))
    await start("# Title\n\nbody", 7)
    await ctrlEnter()
    ok("a heading (one line by nature): nothing happens, no bar, no new cell", (await doc()) === "# Title\n\nbody" && (await sel())[0] === 7 && !(await armed()), JSON.stringify([await doc(), await sel(), await armed()]))
  })

  await test(`${side}: a cell with empty lines moves whole (Format ▸ Move Cell Down); Format ▸ New Line in Cell is the key`, async () => {
    await start("hello\n<br>\nworld\n\nnext", 2)
    await menuClick("moveCellDown"); await sleep(400)
    ok("the cell went below next with its empty line", (await doc()) === "next\n\nhello\n<br>\nworld", JSON.stringify(await doc()))
    await start("hello", 5)
    await menuClick("newlineInCell"); await sleep(400)
    ok("the menu item writes what the key does", (await doc()) === "hello\n<br>" && (await sel())[0] === 10 && !(await armed()), JSON.stringify([await doc(), await sel()]))
  })

  // THE REVIEW OF agent/ctrlenter (2026-10-11), P1: in a markdown cell and a quote a single newline is a space when the cell is
  // drawn, so the line Ctrl+Enter made was gone the moment the caret left the cell. Read off the page as it is DRAWN.
  await test(`${side}: in a markdown cell and a quote the line Ctrl+Enter makes is still a line once the caret leaves the cell`, async () => {
    const text = "<!-- markdown -->\n**first** markdown line\n\n> first quote line\n\nlast"
    await start(text, text.indexOf("\n\n>"))
    await ctrlEnter()
    await typeText("second markdown line"); await sleep(200)
    const quoteEnd = (await doc()).indexOf("\n\nlast")
    await setSel(quoteEnd); await sleep(250)
    await ctrlEnter()
    await typeText("second quote line"); await sleep(200)
    const want = "<!-- markdown -->\n**first** markdown line\n<br>second markdown line\n\n> first quote line\n> <br>second quote line\n\nlast"
    ok("the note: each new line starts with `<br>`, three cells", (await doc()) === want && (await cellBrackets()).length === 3, JSON.stringify([await doc(), (await cellBrackets()).length]))
    // Out of both cells: the caret at the end of "last".
    await setSel(want.length); await sleep(450)
    if (rendered) {
      const drawn = JSON.parse(await js(`JSON.stringify([...document.querySelectorAll('.wm-pv-p, .wm-pv-quote')].map(e=>e.innerText.replace(/\u200b/g,'')))`))
      ok("drawn: the markdown cell is two lines", drawn.includes("first markdown line\nsecond markdown line"), JSON.stringify(drawn))
      ok("drawn: the quote is two lines", drawn.includes("first quote line\nsecond quote line"), JSON.stringify(drawn))
      await shot("rendered-markdown-quote-lines")
    } else {
      const lines = (await drawnLines()).map((line) => line.text)
      ok("the markdown side draws nothing of either `<br>`: the words alone on their lines", lines.includes("second markdown line") && lines.some((line) => /second quote line$/.test(line) && !line.includes("<br>")) && !lines.some((line) => line.includes("<br>")), JSON.stringify(lines))
    }
    // Backspace at the start of the line's words joins it to the line above, as at the start of any line.
    await setSel(want.indexOf("second markdown")); await sleep(300)
    await key("Backspace"); await sleep(300)
    ok("Backspace at the start of its words: one line again", (await doc()) === want.replace("\n<br>second markdown", "second markdown"), JSON.stringify(await doc()))
    await key("z", { ctrl: true }); await sleep(300)
    ok("one Undo gives the line back", (await doc()) === want, JSON.stringify(await doc()))
  })

  // P1: Return after Ctrl+Enter in a list carries the list on (3.9.0: "Return on a list item adds another item"); it used to
  // write a line of white space that ended the list and armed the bar, or add no new item at all.
  await test(`${side}: Return after Ctrl+Enter in a list adds the next item — in the middle and at the end of the list`, async () => {
    await start("- one\n- two\n- three", 5)
    await ctrlEnter()
    await key("Enter"); await sleep(300)
    ok("a middle item's empty line, then Return: the next item after it, one cell, no bar", (await doc()) === "- one\n  <br>\n- \n- two\n- three" && !(await armed()) && (await cellBrackets()).length === 1, JSON.stringify([await doc(), await armed(), (await cellBrackets()).length]))
    await typeText("x"); await sleep(250)
    ok("typed on: an item of the one list", (await doc()) === "- one\n  <br>\n- x\n- two\n- three" && (await cellBrackets()).length === 1, JSON.stringify([await doc(), (await cellBrackets()).length]))

    await start("1. one\n2. two", 6)
    await ctrlEnter()
    await typeText("more"); await sleep(250)
    await key("Enter"); await sleep(300)
    ok("a numbered item's line of words, then Return: the next number after it, no bar", (await doc()) === "1. one\n   more\n2. \n2. two" && !(await armed()) && (await cellBrackets()).length === 1, JSON.stringify([await doc(), await armed()]))

    await start("- one", 5)
    await ctrlEnter()
    await typeText("detail"); await sleep(250)
    await key("Enter"); await sleep(300)
    await typeText("two"); await sleep(250)
    ok("the last item: Return after its next line is a new bullet, `two` an item of its own", (await doc()) === "- one\n  detail\n- two" && (await cellBrackets()).length === 1, JSON.stringify(await doc()))
    if (!rendered) ok("two bullets are drawn", (await js(`document.querySelectorAll('.cm-content .wm-bullet').length`)) === 2, String(await js(`document.querySelectorAll('.cm-content .wm-bullet').length`)))

    // Return at the end of an item's own line, its next line under it: the new item after the item's lines (the review's P3 f).
    await start("- one\n  more\n- two", 5)
    await key("Enter"); await sleep(300)
    ok("Return at the end of `one`, `more` under it: the new item comes after `more`", (await doc()) === "- one\n  more\n- \n- two" && (await sel())[0] === 15, JSON.stringify([await doc(), await sel()]))
  })

  // P2: Backspace at the start of an item's next line's words joins it to the line above (it outdented it, and the list split).
  await test(`${side}: Backspace at the start of an item's next line joins it to the line above; the List key keeps it the item's`, async () => {
    await start("- one\n  more\n- two", 8)
    await key("Backspace"); await sleep(300)
    ok("bullets: one Backspace, `onemore`, one list", (await doc()) === "- onemore\n- two" && (await sel())[0] === 5 && (await cellBrackets()).length === 1, JSON.stringify([await doc(), await sel(), (await cellBrackets()).length]))
    await start("- one\n  more\n- two", 5)
    await key("Delete"); await sleep(300)
    ok("Delete at the end of `one`: the same join from above, no indentation left between the words", (await doc()) === "- onemore\n- two" && (await sel())[0] === 5, JSON.stringify([await doc(), await sel()]))
    await start("- [ ] milk", 10)
    await ctrlEnter()
    await typeText("eggs"); await sleep(250)
    await setSel(17); await sleep(250)
    await key("Backspace"); await sleep(300)
    const after = await sel()
    ok("a to-do: `milkeggs`, the caret between them, nothing selected", (await doc()) === "- [ ] milkeggs" && after[0] === 10 && after[1] === 10, JSON.stringify([await doc(), after]))
    if (rendered) {
      // The rendered page's to-dos are edited a box at a time (Mac 0fdd031): Backspace at the start of a to-do's words, and
      // Delete at the end of the one above, join the words to where the to-do above ENDS — on its next line, Ctrl+Enter's.
      const todos = "- [ ] a\n      more\n- [ ] b"
      await start(todos, todos.length - 1)
      await key("Backspace"); await sleep(300)
      ok("rendered to-dos: Backspace at the start of `b` joins it to the end of `more`, no box pulled in", (await doc()) === "- [ ] a\n      moreb" && (await sel())[0] === todos.indexOf("more") + 4, JSON.stringify([await doc(), await sel()]))
      await start(todos, todos.indexOf("more") + 4)
      await key("Delete"); await sleep(300)
      ok("rendered to-dos: Delete at the end of `more` the same", (await doc()) === "- [ ] a\n      moreb", JSON.stringify(await doc()))
    }
    // The List key (Dots) over the list: the item's next line is not made an item of its own; all dots already, it unlists.
    // (The key writes the style last chosen, which the app remembers — another script may have left it Numbered: choose Dots.)
    await start("x", 1)
    await clickEl('[data-bar=style]'); await sleep(250); await clickEl('.float-menu [data-bar="kind-list-dots"]'); await sleep(350)
    await start("- one\n  more\n- two", 2)
    await setSel(2, 18); await sleep(200)
    await key("l", { ctrl: true, shift: true }); await sleep(350)
    ok("the List key over it: the markers off, `more` a line of the paragraph, never `  - more`", (await doc()) === "one\nmore\ntwo", JSON.stringify(await doc()))
  })

  // P3: Shift+Left off an empty line, and Split Cell on one.
  await test(`${side}: Shift+Left from an empty line takes the line break; Split Cell on one parts the cells there`, async () => {
    await start("hello\n<br>\nworld", 10)
    await key("ArrowLeft", { shift: true }); await sleep(250)
    ok("Shift+Left: the selection runs to the end of hello at the first press", JSON.stringify(await sel()) === "[10,5]", JSON.stringify(await sel()))
    // Up and Down go by where the caret is drawn, and the hidden `<br>` has no width: two presses cross the empty line.
    await start("hello\n<br>\nworld", 0)
    await key("ArrowDown", { shift: true }); await sleep(200)
    await key("ArrowDown", { shift: true }); await sleep(250)
    ok("Shift+Down twice from the start of hello: to the start of world", JSON.stringify(await sel()) === "[0,11]", JSON.stringify(await sel()))
    await key("ArrowUp", { shift: true }); await sleep(200)
    await key("ArrowUp", { shift: true }); await sleep(250)
    ok("and Shift+Up twice: back to nothing selected at the start of hello", JSON.stringify(await sel()) === "[0,0]", JSON.stringify(await sel()))
    await start("hello\n<br>\nworld", 10)
    await menuClick("splitCell"); await sleep(400)
    ok("Split Cell on the empty line: two cells, hello and world, no `<br>` left at either's edge", (await doc()) === "hello\n\nworld" && (await cellBrackets()).length === 2, JSON.stringify([await doc(), (await cellBrackets()).length]))
  })

  if (rendered) {
    await test("rendered page: a cell with empty lines, drawn, shows them as empty lines; a click on one opens it there", async () => {
      await start("hello\n<br>\n<br>\nend\n\nnext", 2)
      // Into the cell below, so the first is drawn.
      await setSel(25); await sleep(400)
      const block = JSON.parse(await js(`(()=>{const b=[...document.querySelectorAll('.wm-pv-text')].find(e=>e.textContent.includes('hello'));if(!b)return 'null';const r=b.getBoundingClientRect();return JSON.stringify({text:b.innerText,empty:b.querySelectorAll('.wm-pv-empty').length,h:r.height,top:r.top})})()`))
      ok("the drawn cell has its two empty lines between hello and end, nothing of `<br>` written", !!block && block.empty === 2 && !block.text.includes("<br>") && block.text.replace(/\u200b/g, "") === "hello\n\n\nend", JSON.stringify(block))
      ok("and it is four lines tall", !!block && block.h > 4 * 18, JSON.stringify(block))
      await shot("rendered-drawn-empty-lines")
      const empty = JSON.parse(await js(`(()=>{const e=[...document.querySelectorAll('.wm-pv-empty')][1];const r=e?.getBoundingClientRect();return JSON.stringify(r?{x:r.x+4,y:r.y+r.height/2}:null)})()`))
      if (empty) {
        await click(empty.x + 20, empty.y); await sleep(400)
        ok("a click on the second empty line opens the cell with the caret on that line (after its hidden `<br>`)", (await sel())[0] === 15, JSON.stringify(await sel()))
      } else ok("an empty line to click", false)
    })
  }

  await test(`${side}: the empty lines are written to the .wm and read back as the cell's after a reload`, async () => {
    await start("", 0)
    await typeText("alpha"); await sleep(200)
    await ctrlEnter(); await ctrlEnter()
    await typeText("omega"); await sleep(200)
    ok("typed: alpha, an empty line, omega, one cell", (await doc()) === "alpha\n<br>\nomega" && (await cellBrackets()).length === 1, JSON.stringify(await doc()))
    const written = await until(() => readWm(file).text === "alpha\n<br>\nomega", 6000, 200)
    ok("the note's file holds the empty line as `<br>`", written, JSON.stringify(readWm(file).text))
    await reloadApp()
    await openNote(name)
    await waitFor(`!!document.querySelector('.cm-content')`)
    await setRendered(rendered)
    await sleep(500)
    ok("after a reload the note is the same words", (await doc()) === "alpha\n<br>\nomega", JSON.stringify(await doc()))
    ok("and one cell", (await cellBrackets()).length === 1, JSON.stringify(await cellBrackets()))
    const lines = rendered ? null : await drawnLines()
    if (lines) ok("drawn with the empty line empty", lines[1]?.text === "", JSON.stringify(lines))
  })
}
