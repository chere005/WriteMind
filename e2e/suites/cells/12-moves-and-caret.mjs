// (c) and (f) (docs/PLAN-bars-2026-10.md P7): moving the input cursor and moving things under it. Move Section Up / Down keep the
// caret and the selection on the same words and are one undo step each (and never glue the last section to the text above it);
// the cell commands on the menu keep a caret on the same characters of its cell; held cells (a bracket click) survive a click on a
// toolbar button and stay held through the key moves; the arrows keep their column from a bar into a cell. Real keys and the real
// mouse, markdown side and rendered page.
import { ok, test, finish, js, sleep, freshNote, setDoc, doc, sel, selText, ranges, key, click, focus, setSel, setRendered, menuClick, brackets, clickEl, lineBoxes, typeText } from "../../lib/harness.mjs"

await freshNote()
const VIEW = `document.querySelector('.cm-content').cmTile.view`
const around = (n = 6) => js(`(()=>{const v=${VIEW}; const m=v.state.selection.main; return v.state.sliceDoc(Math.max(0,m.from-${n}),m.from)+'|'+v.state.sliceDoc(m.to,m.to+${n})})()`)
const SECT = "# Alpha section\n\nalpha words here\n\n# Beta section\n\nbeta words here\nsecond line\n\n- b1\n- b2\n\n# Gamma section\n\ngamma words"
const heads = (d) => d.split("\n").filter((l) => l.startsWith("# ")).map((l) => l.slice(2, 7))

for (const rendered of [false, true]) {
  const side = rendered ? "rendered page" : "markdown side"
  await setRendered(rendered)

  for (const via of ["key", "menu"]) {
    await test(`${side}: Move Section Up / Down by ${via}: the caret stays on its words, one undo step puts everything back`, async () => {
      for (const up of [true, false]) {
        await setDoc(SECT, 0); await focus(); await sleep(250)
        const at = SECT.indexOf("beta words") + 5
        await setSel(at); await sleep(100)
        const run = async () => via === "key" ? key(up ? "ArrowUp" : "ArrowDown", { ctrl: true }) : menuClick(up ? "moveSectionUp" : "moveSectionDown")
        await run(); await sleep(300)
        const d = await doc()
        ok(`the section went ${up ? "up" : "down"}`, JSON.stringify(heads(d)) === JSON.stringify(up ? ["Beta ", "Alpha", "Gamma"] : ["Alpha", "Gamma", "Beta "]), JSON.stringify(heads(d)))
        const near = await around(5)
        ok("the caret is on the same words (beta |words)", near.startsWith("beta ") && near.split("|")[1].startsWith("words"), near)
        ok("no heading is glued to the text above it", !/[^\n]\n# /.test(d), JSON.stringify(d))
        ok("every block keeps its blank line: the same blocks, reordered", [...d.split("\n\n")].sort().join("|") === [...SECT.split("\n\n")].sort().join("|"), JSON.stringify(d))
        await key("z", { ctrl: true }); await sleep(250)
        ok("ONE Ctrl+Z puts the note back", (await doc()) === SECT, JSON.stringify(await doc()))
        ok("...with the caret where it was", (await sel())[0] === at, JSON.stringify(await sel()))
        await key("z", { ctrl: true, shift: true }); await sleep(250)
        ok("and Redo moves it again", (await doc()) === d)
      }
    })
  }

  await test(`${side}: a selection inside the moved section stays selected on the same words`, async () => {
    await setDoc(SECT, 0); await focus(); await sleep(250)
    const from = SECT.indexOf("beta words")
    await setSel(from, from + 10); await sleep(100)
    await key("ArrowDown", { ctrl: true }); await sleep(300)
    ok("the words are still selected", (await selText()) === "beta words", JSON.stringify(await selText()))
  })

  await test(`${side}: the last section moves up and the end of the note is not disturbed; the first up and the last down do nothing`, async () => {
    await setDoc(SECT, 0); await focus(); await sleep(250)
    await setSel(SECT.indexOf("gamma words") + 3); await key("ArrowUp", { ctrl: true }); await sleep(300)
    const d = await doc()
    ok("Gamma is above Beta, with its blank line", d.includes("# Gamma section\n\ngamma words\n\n# Beta section") && !d.endsWith("\n"), JSON.stringify(d))
    await key("ArrowDown", { ctrl: true }); await sleep(300)
    ok("moving it back down gives the note back exactly", (await doc()) === SECT, JSON.stringify(await doc()))
    await key("ArrowDown", { ctrl: true }); await sleep(300)
    ok("the last section going down does nothing", (await doc()) === SECT)
    await setSel(3); await key("ArrowUp", { ctrl: true }); await sleep(300)
    ok("the first going up does nothing", (await doc()) === SECT)
    // ...and made no undo step of its own: an edit, then a move that does nothing, then Ctrl+Z undoes the EDIT.
    await setDoc(SECT, 0); await focus(); await sleep(200); await setSel(3); await typeText("Q"); await sleep(700)
    await key("ArrowUp", { ctrl: true }); await sleep(250)
    await key("z", { ctrl: true }); await sleep(250)
    ok("a move that did nothing is no undo step: Ctrl+Z takes the typed letter back", (await doc()) === SECT, JSON.stringify(await doc()))
  })

  await test(`${side}: the moved caret is scrolled into view`, async () => {
    const filler = (n) => Array.from({ length: n }, (_, i) => "Filler " + i).join("\n\n")
    const text = `# First\n\n${filler(50)}\n\n# Second\n\nsecond words\n\n${filler(50)}`
    await setDoc(text, 0); await focus(); await sleep(400)
    await setSel(text.indexOf("second words") + 3); await sleep(300)
    await js(`${VIEW}.scrollDOM.scrollTop = 0`); await sleep(200)
    await key("ArrowUp", { ctrl: true }); await sleep(500)
    const box = JSON.parse(await js(`(()=>{const v=${VIEW}; const c=v.coordsAtPos(v.state.selection.main.head); const s=v.scrollDOM.getBoundingClientRect(); return JSON.stringify({top:c&&c.top,bottom:c&&c.bottom,sTop:s.top,sBottom:s.bottom})})()`))
    ok("the caret is on screen after the move", box.top !== null && box.top >= box.sTop && box.bottom <= box.sBottom, JSON.stringify(box))
  })

  const D = "One words here\n\nTwo words here\n\nThree words here\n\nFour"
  for (const cmd of ["moveCellUp", "moveCellDown", "duplicateCell"]) {
    await test(`${side}: ${cmd} on the menu keeps a caret on the same characters, one undo step`, async () => {
      await setDoc(D, 0); await focus(); await sleep(250)
      await setSel(D.indexOf("Two words") + 6); await sleep(100)
      await menuClick(cmd); await sleep(300)
      ok("a caret, not the whole cell selected", (await ranges())[0][0] === (await ranges())[0][1], JSON.stringify(await ranges()))
      ok("on the same characters (Two wo|rds)", (await around(5)) === "wo wo|rds h", await around(5))
      await key("z", { ctrl: true }); await sleep(200)
      ok("one Ctrl+Z", (await doc()) === D, JSON.stringify(await doc()))
    })
  }

  await test(`${side}: held cells survive a click on the toolbar and the pane buttons, and stay held through the key moves`, async () => {
    await setDoc(D, 0); await focus(); await sleep(250)
    const b = await brackets()
    await click(b[1].x, b[1].y); await sleep(500)
    ok("a bracket click holds the cell", (await selText()) === "Two words here", JSON.stringify(await selText()))
    for (const target of ["[data-bar=video]", "[data-bar=video]", "[data-bar=edit]", "[data-bar=edit]"]) {
      if (!(await js(`!!document.querySelector('${target}')`))) continue
      await clickEl(target); await sleep(500)
      ok(`still held after a click on ${target}`, (await selText()) === "Two words here", JSON.stringify(await selText()))
    }
    await key("ArrowDown", { ctrl: true, shift: true }); await sleep(250)
    ok("Ctrl+Shift+Down moves it and it is still held", (await doc()) === "One words here\n\nThree words here\n\nTwo words here\n\nFour" && (await selText()) === "Two words here", JSON.stringify([await doc(), await selText()]))
    await key("z", { ctrl: true }); await sleep(250)
    ok("one Ctrl+Z puts it back", (await doc()) === D, JSON.stringify(await doc()))
  })

  await test(`${side}: the arrows walk cell, bar, cell (the markdown side keeps the column; the page goes in at the start, KEYS.md)`, async () => {
    await setDoc("abcdefgh\n\nabcdefgh", 0); await focus(); await sleep(300)
    await setSel(5); await key("ArrowDown"); await sleep(150)
    ok("down off the cell's last line: the bar, the caret hidden", (await js(`document.querySelector('.cm-editor').classList.contains('wm-armed')`)))
    await key("ArrowDown"); await sleep(150)
    ok(rendered ? "down again: the next cell, at its start (the rendered page's rule)" : "down again: the next cell, at the same column",
      (await sel())[0] === (rendered ? 10 : 10 + 5), JSON.stringify(await sel()))
    await key("ArrowUp"); await sleep(150)
    ok("up: the bar again", (await js(`document.querySelector('.cm-editor').classList.contains('wm-armed')`)))
    await key("ArrowUp"); await sleep(150)
    ok(rendered ? "up again: the block above, at its end" : "up again: back in the first cell at the same column", (await sel())[0] === (rendered ? 8 : 5), JSON.stringify(await sel()))
    await setSel(3); await key("End"); await sleep(100)
    ok("End goes to the end of the line", (await sel())[0] === 8, JSON.stringify(await sel()))
    await key("Home"); await sleep(100)
    ok("Home goes to its start", (await sel())[0] === 0, JSON.stringify(await sel()))
  })
}
finish()
