// A LIST IS ONE CELL, WHATEVER ITS ITEMS ARE MARKED WITH (Sean, 2026-10-11, on a screenshot of a dashes list with a to-do list
// straight under it and the bar with its + drawn between them: "this should not be two separate cells"). Dots, dashes, numbers and
// to-dos with no blank line between them are one list (core parser: a `mixed` block): one bracket, no seam between the kinds, one
// cell for Return, the bar, ticking, Split / Merge, a held cell's copy and move, Find, and a save and a reopen. Each item is still
// drawn as its own kind, Return carries ITS kind on, and the Style button names the item the caret is on. The 3.8.0 / 3.9.0 Return
// rules hold inside the mixed cell. Real keys and the real mouse, on the markdown side and on the rendered page.
import { readWm } from "../../lib/wm.mjs"
import {
  ok, test, js, sleep, until, freshNote, setDoc, doc, sel, key, click, hover, focus, setSel, setRendered, armed, typeText, shot, clickEl,
  brackets, closeAllTabs, openNote, selText, VIEW, CTRL, SHIFT,
} from "../../lib/harness.mjs"

/** Sean's note as the screenshot has it: four dashes, then two to-dos and an empty one, no blank line anywhere. */
const SEANS = "* hello\n* there\n* world\n* how\n- [ ] Are you\n- [ ] Doing today\n- [ ] "

export async function runMixedList({ rendered }) {
  const file = await freshNote()
  const name = file.split(/[\\/]/).pop().replace(/\.wm$/, "")
  const side = rendered ? "rendered page" : "markdown side"
  await setRendered(rendered)

  const cellBrackets = async () => JSON.parse(await js(`JSON.stringify([...document.querySelectorAll('.wm-bracket:not(.wm-bracket-group)')].map(e=>{const r=e.getBoundingClientRect();return {lit:e.classList.contains('wm-bracket-lit'),top:r.top,bottom:r.bottom,h:r.height}}))`))
  const label = () => js(`document.querySelector('[data-bar=style] .bar-label-text')?.textContent ?? null`)
  const start = async (text, caret) => { await setDoc(text, caret); await setSel(0); await setSel(caret); await focus(); await sleep(300) }
  const pickKind = async (row) => { await clickEl('[data-bar=style]'); await sleep(250); await clickEl(`.float-menu [data-bar="kind-${row}"]`); await sleep(350) }
  /** The rows of the note as the page shows them (client px), each with its text. */
  const rows = async () => JSON.parse(await js(`JSON.stringify([...document.querySelectorAll('.cm-line, .wm-pv-li, .wm-pv-quote')].map(l=>{const r=l.getBoundingClientRect();return {top:r.top,bottom:r.bottom,text:l.textContent}}))`))
  /** What the pointer is over at a point: "seam" or "plus" where a bar would be armed by a click, "" elsewhere. */
  const pointerAt = async (x, y) => { await hover(x, y); await sleep(60); return js(`${VIEW}.scrollDOM.dataset.wmPointer ?? ""`) }
  /** Whether a seam answers anywhere along the band between two rows (from the middle of the first to the middle of the second). */
  const seamBetween = async (a, b) => {
    const x = await js(`Math.round(${VIEW}.contentDOM.getBoundingClientRect().left + 120)`)
    const from = Math.round((a.top + a.bottom) / 2)
    const to = Math.round((b.top + b.bottom) / 2)
    const found = []
    for (let y = from; y <= to; y += 2) { const p = await pointerAt(x, y); if (p) found.push([y, p]) }
    await hover(5, 5)
    return found
  }

  await test(`${side}: the probe — Return, Return, Style ▸ To-do, words — is ONE cell, the Style button saying To-do`, async () => {
    await start("* hello\n* how", 13)
    await key("Enter"); await sleep(250)
    ok("Return on `* how` adds a dash item", (await doc()) === "* hello\n* how\n* ", JSON.stringify(await doc()))
    await key("Enter"); await sleep(300)
    ok("Return on the empty dash item takes its marker off and keeps the line", (await doc()) === "* hello\n* how\n" && !(await armed()), JSON.stringify([await doc(), await armed()]))
    await pickKind("list-todo")
    ok("Style ▸ To-do makes the line a to-do", (await doc()) === "* hello\n* how\n- [ ] ", JSON.stringify(await doc()))
    await typeText("Are you"); await sleep(350)
    ok("the words are the to-do's", (await doc()) === "* hello\n* how\n- [ ] Are you", JSON.stringify(await doc()))
    const one = await cellBrackets()
    ok("ONE bracket, lit, from the first dash to the to-do (it was two, with a seam between)", one.length === 1 && one[0].lit, JSON.stringify(one))
    ok("the Style button names the item the caret is on: To-do", (await label()) === "To-do", String(await label()))
    const lines = (await rows()).filter((row) => row.text.includes("how") || row.text.includes("Are you"))
    ok("both rows are there", lines.length === 2, JSON.stringify(lines))
    if (lines.length === 2) {
      const seams = await seamBetween(lines[0], lines[1])
      ok("no seam between the dash and the to-do: nothing there arms a bar", seams.length === 0, JSON.stringify(seams))
    }
    await setSel(3); await sleep(200)
    ok("on `* hello` the Style button says Dashes", (await label()) === "Dashes", String(await label()))
    await shot(`${rendered ? "rendered" : "markdown"}-probe-one-cell`)

    // --- saved, and read back: the file is the text, and the text reads as one cell
    await until(async () => { try { return readWm(file).text === "* hello\n* how\n- [ ] Are you" } catch { return false } }, 8000, 200)
    const saved = (() => { try { return readWm(file).text } catch (error) { return String(error) } })()
    ok("the note is saved as it was typed", saved === "* hello\n* how\n- [ ] Are you", JSON.stringify(saved))
    await closeAllTabs(); await sleep(300)
    await openNote(name); await sleep(600)
    await setRendered(rendered)
    await setSel(3); await focus(); await sleep(300)
    ok("reopened, it is the same note", (await doc()) === "* hello\n* how\n- [ ] Are you", JSON.stringify(await doc()))
    const again = await cellBrackets()
    ok("and still ONE cell", again.length === 1, JSON.stringify(again))
  })

  await test(`${side}: Sean's note is one cell, every item drawn as its own kind`, async () => {
    const text = `Top\n\n${SEANS}Doing well\n\nBottom`
    await start(text, text.length)
    ok("three cells: Top, the list, Bottom", (await cellBrackets()).length === 3, JSON.stringify(await cellBrackets()))
    if (rendered) {
      // The list is drawn (the caret is in Bottom): one block, its seven rows, four dashes and three boxes.
      const drawn = JSON.parse(await js(`JSON.stringify([...document.querySelectorAll('.wm-pv-list')].map(l=>[...l.querySelectorAll('.wm-pv-li')].map(li=>li.querySelector('.wm-pv-box')?'box':li.querySelector('.wm-pv-mark')?.textContent)))`))
      ok("ONE drawn list, seven rows: four dashes, three boxes", drawn.length === 1 && JSON.stringify(drawn[0]) === JSON.stringify(["–", "–", "–", "–", "box", "box", "box"]), JSON.stringify(drawn))
    } else {
      const marks = JSON.parse(await js(`JSON.stringify([...document.querySelectorAll('.cm-line')].map(l=>l.querySelector('.wm-todo')?'box':l.querySelector('.wm-bullet')?.textContent??null).filter(Boolean))`))
      ok("the markdown side draws four dashes and three boxes", JSON.stringify(marks) === JSON.stringify(["–", "–", "–", "–", "box", "box", "box"]), JSON.stringify(marks))
    }
    await shot(`${rendered ? "rendered" : "markdown"}-seans-note`)
    for (const [needle, want] of [["there", "Dashes"], ["Doing today", "To-do"]]) {
      await setSel(text.indexOf(needle) + 2); await sleep(200)
      ok(`with the caret in "${needle}" the Style button says ${want}`, (await label()) === want, String(await label()))
    }
  })

  await test(`${side}: the arrows walk the mixed list line by line: no bar between the dashes and the to-dos, the bar under the list`, async () => {
    const text = "* hello\n* how\n- [ ] Are you\n\nBelow"
    await start(text, 13)
    await key("ArrowDown"); await sleep(300)
    const [down] = await sel()
    ok("Down from `* how` goes onto the to-do's line, no bar up (it used to arm the seam between the two cells)", !(await armed()) && down > 14 && down <= 27, JSON.stringify([down, await armed()]))
    ok("the Style button follows: To-do", (await label()) === "To-do", String(await label()))
    await key("ArrowDown"); await sleep(300)
    ok("Down again: the bar under the whole list", await armed(), JSON.stringify([await sel(), await armed()]))
    await key("ArrowUp"); await sleep(300)
    await key("ArrowUp"); await sleep(300)
    const [up] = await sel()
    ok("Up, Up: back on the dash line, no bar between", !(await armed()) && up >= 8 && up <= 13, JSON.stringify([up, await armed()]))
  })

  await test(`${side}: Return carries each item's OWN kind on inside the mixed cell`, async () => {
    const text = "* hello\n- [ ] Are you\n1. one"
    await start(text, 7)
    await key("Enter"); await sleep(250)
    ok("on a dash: a dash", (await doc()) === "* hello\n* \n- [ ] Are you\n1. one", JSON.stringify(await doc()))
    await start(text, text.indexOf("\n1."))
    await key("Enter"); await sleep(250)
    ok("on a to-do: a to-do", (await doc()) === "* hello\n- [ ] Are you\n- [ ] \n1. one", JSON.stringify(await doc()))
    await start(text, text.length)
    await key("Enter"); await sleep(250)
    ok("on a number: the next number", (await doc()) === "* hello\n- [ ] Are you\n1. one\n2. ", JSON.stringify(await doc()))
    ok("and the cell is still one, lit", (await cellBrackets()).length === 1 && (await cellBrackets())[0].lit, JSON.stringify(await cellBrackets()))
  })

  await test(`${side}: the empty LAST item's Return keeps the line in the cell; the next arms the bar under the WHOLE cell`, async () => {
    const text = "* hello\n- [ ] Are you\n- [ ] "
    await start(text + "\n\nBelow", text.length)
    const before = await cellBrackets()
    await key("Enter"); await sleep(350)
    ok("the marker goes, the line stays", (await doc()) === "* hello\n- [ ] Are you\n\n\nBelow" && (await sel())[0] === 22, JSON.stringify([await doc(), await sel()]))
    ok("no bar is up", !(await armed()))
    const grown = await cellBrackets()
    ok("ONE lit bracket over the list, running down to the line", grown.length === 2 && grown[0].lit && !grown[1].lit, JSON.stringify(grown))
    ok("the Style button names the list's last item there: To-do", (await label()) === "To-do", String(await label()))
    await key("Enter"); await sleep(400)
    ok("the next Return takes the line away: the note as it was without the empty item", (await doc()) === "* hello\n- [ ] Are you\n\nBelow", JSON.stringify(await doc()))
    ok("and the bar is up", await armed())
    const bar = JSON.parse(await js(`(()=>{const b=document.querySelector('.wm-bar:not(.wm-bar-faint)');return JSON.stringify(b?b.getBoundingClientRect():null)})()`))
    const list = (await cellBrackets())[0]
    ok("under the whole list (below the to-do, not between the dash and the to-do)", !!bar && bar.top >= list.bottom - 2, JSON.stringify({ bar, list, before }))
    await typeText("x"); await sleep(300)
    ok("typing there opens the next cell", (await doc()) === "* hello\n- [ ] Are you\n\nx\n\nBelow", JSON.stringify(await doc()))
  })

  await test(`${side}: a box in the mixed list ticks, and the cell stays one`, async () => {
    const text = `${SEANS}Doing well\n\nBottom`
    await start(text, text.length)
    if (rendered) {
      const box = JSON.parse(await js(`(()=>{const b=document.querySelectorAll('.wm-pv-box')[1];if(!b)return 'null';const r=b.getBoundingClientRect();return JSON.stringify({x:r.x+r.width/2,y:r.y+r.height/2})})()`))
      ok("the second box is drawn", !!box)
      if (box) await click(box.x, box.y)
    } else {
      const box = JSON.parse(await js(`(()=>{const b=document.querySelectorAll('.wm-todo')[1];if(!b)return 'null';const r=b.getBoundingClientRect();return JSON.stringify({x:r.x+r.width/2,y:r.y+r.height/2})})()`))
      ok("the second box is drawn", !!box)
      if (box) await click(box.x, box.y)
    }
    await sleep(350)
    ok("the second to-do is ticked, one character", (await doc()) === text.replace("- [ ] Doing today", "- [x] Doing today"), JSON.stringify(await doc()))
    ok("two cells still: the list and Bottom", (await cellBrackets()).length === 2, JSON.stringify(await cellBrackets()))
  })

  await test(`${side}: Split (Ctrl+D) cuts the mixed list in two at the caret, Merge (Ctrl+M) makes the two kinds one cell again`, async () => {
    const text = "* a\n* b\n- [ ] c\n- [ ] d"
    await start(text, 7)
    await key("d", { ctrl: true }); await sleep(350)
    ok("split: two cells, the dashes and the to-dos", (await doc()) === "* a\n* b\n\n- [ ] c\n- [ ] d" && (await cellBrackets()).length === 2, JSON.stringify([await doc(), await cellBrackets()]))
    await setSel(1); await focus(); await sleep(200)
    await key("m", { ctrl: true }); await sleep(350)
    ok("merge: ONE cell again, the kinds kept", (await doc()) === text && (await cellBrackets()).length === 1, JSON.stringify([await doc(), await cellBrackets()]))
  })

  await test(`${side}: a held mixed list is copied whole and moved whole`, async () => {
    const list = "* a\n- [ ] b\n1. c"
    await start(`Top\n\n${list}\n\nBottom`, 1)
    const held = (await brackets())[1]
    ok("its bracket is there", !!held, JSON.stringify(await brackets()))
    if (!held) return
    await click(held.right, held.y); await sleep(200)
    ok("a click on the bracket holds the whole list", (await selText()) === list, JSON.stringify(await selText()))
    const copied = JSON.parse(await js(`(()=>{const dt=new DataTransfer();const e=new ClipboardEvent('copy',{clipboardData:dt,bubbles:true,cancelable:true});${VIEW}.contentDOM.dispatchEvent(e);return JSON.stringify({cells:dt.getData('application/x-writemind-cells'),prevented:e.defaultPrevented})})()`))
    ok("Copy takes the one cell, every kind of item in it", copied.cells === list && copied.prevented, JSON.stringify(copied))
    await key("ArrowDown", { modifiers: CTRL | SHIFT }); await sleep(350)
    ok("Ctrl+Shift+Down moves the whole list under Bottom", (await doc()) === `Top\n\nBottom\n\n${list}`, JSON.stringify(await doc()))
  })

  await test(`${side}: Find finds words in the mixed list`, async () => {
    const text = `Top\n\n${SEANS}\n\nBottom`
    await start(text, 0)
    await key("f", { ctrl: true }); await sleep(300)
    await typeText("Doing"); await sleep(400)
    ok("one match, selected", (await js(`document.querySelector('[data-find=count]')?.textContent`)) === "1 of 1" && (await selText()) === "Doing", JSON.stringify([await js(`document.querySelector('[data-find=count]')?.textContent`), await selText()]))
    await key("Escape"); await sleep(250)
  })

  await test(`${side}: a blank line between two lists still makes two cells, and a quote under a list is its own`, async () => {
    await start("* a\n\n- [ ] b\n\nend", 0)
    ok("two lists apart: two cells (and end)", (await cellBrackets()).length === 3, JSON.stringify(await cellBrackets()))
    await start("* a\n> q\n- [ ] b\n\nend", 0)
    ok("a list, a quote, a list, touching: three cells (and end)", (await cellBrackets()).length === 4, JSON.stringify(await cellBrackets()))
    // The control for the probe's "no seam" check: two cells that touch DO have a seam between them, and the sweep finds it.
    await start("* a\n> q\n\nend", "* a\n> q\n\nend".length)
    const pair = (await rows()).filter((row) => /^(–|•)?\s*a$/.test(row.text.trim()) || row.text.includes("q"))
    ok("the dash row and the quote row are there", pair.length === 2, JSON.stringify(await rows()))
    if (pair.length === 2) {
      const seams = await seamBetween(pair[0], pair[1])
      ok("between a list and a quote that touch, the sweep finds the seam (the check above can fail)", seams.length > 0, JSON.stringify(seams))
    }
  })
}
