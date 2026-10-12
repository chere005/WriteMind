// A LIST IS INSERTED WITH THE CARET WHERE ITS WORDS GO, AND A `*` AT THE BAR OPENS A BULLET LIST (Sean, 2026-10-11: "the input
// cursor should go to where it is typing when inserting a checklist or bullets.. typing a * while the input cursor is horizontal
// will start a markdown text cell with bullet points with the input cursor ready to start typing"). The library of editor/10..12:
// one script per pane and pen state. Real keys, the real mouse on the bar, the menus and the +.
//
// For every way a list is made — the Style menu's Dots / Dashes / Numbered / To-do, the List button and its menu, the seam's +,
// Cmd/Ctrl+Shift+L, Return on an item — and every place — an empty note, a bar, the line a newline grew under a text cell and
// under a list, a line of words — the note holds a REAL list item (the Style button names the list), and the caret is DRAWN where
// the first typed character then lands (the item's text column: past the bullet or the box and its gap, not on it) at that
// character's full height; the typed character is the item's words (never `\- x`, never a text cell). On the line a newline grew
// under a text cell the list is a cell of its own under it, as the bar would make it; under a numbered list Numbered counts on.
// An older note's lone `-`, `1.` and `*` stay text (2026-10-11).
//
// A `*` typed at the bar (the horizontal cursor) at the first seam, a middle one and the tail is the empty dots item `- ` (the
// Style button says Dots; Sean, 2026-10-12: "dots"), the caret where its words go; `* ` (star, space) is the same single `- `; one Undo takes it back to
// the armed bar. The 3.8.0/3.9.0 Return rules hold in that list: Return adds an item, Return on the empty last item takes its
// marker and keeps the line, the next Return arms the bar; Return or Backspace on the `*` before a word is typed puts the bar back,
// and Return on a lone empty item that touches the cell below keeps the cells either side apart.
//
// On the rendered page with the pen down the pen's layer owns the pointer, so a bar is armed with the arrow keys (as it can be),
// and the + it shows is pressed with the mouse (Canvas.tsx `plusAt`).
import {
  ok, test, finish, js, sleep, freshNote, setDoc, setSel, doc, sel, key, click, focus, armed, VIEW, setRendered, setPen, clickEl,
  typeText, shot, pickFromMenu, brackets,
} from "../../lib/harness.mjs"

const D0 = "Alpha\n\nBeta\n\nGamma"
// [where the caret goes first, the arrow that arms the bar from there, the note with a `*` typed there, the caret in it]
const SEAMS = {
  first: [0, "ArrowUp", "- \n\n" + D0, 2],
  middle: [5, "ArrowDown", "Alpha\n\n- \n\nBeta\n\nGamma", 9],
  tail: [D0.length, "ArrowDown", D0 + "\n\n- ", D0.length + 4],
}
const MARKERS = { dots: "- ", dashes: "* ", numbered: "1. ", todo: "- [ ] " }
const LABELS = { dots: "Dots", dashes: "Dashes", numbered: "Numbered", todo: "To-do" }

const styleWord = () => js(`document.querySelector('[data-bar=style] .bar-label-text')?.textContent ?? null`)
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b)

/** The drawn caret (the primary one) when it is shown: its left edge, top and height, in client px. */
const caretBox = async () => JSON.parse(await js(`(()=>{const c=document.querySelector('.cm-cursor-primary');if(!c)return 'null';const s=getComputedStyle(c);if(s.display==='none'||s.visibility==='hidden')return 'null';const r=c.getBoundingClientRect();return JSON.stringify({x:r.left+r.width/2,top:r.top,h:r.height})})()`))
/** Where the character at `pos` is drawn: its left edge, top and height. */
const charBox = async (pos) => JSON.parse(await js(`(()=>{const r=${VIEW}.coordsAtPos(${pos},1);return r?JSON.stringify({x:r.left,top:r.top,h:r.bottom-r.top}):'null'})()`))
/**
 * The right edge of the bullet's glyph or of the box drawn on the row the caret is on (null: no widget there, a number or the
 * source). The glyph's own ink, not its element: the markdown side's bullet carries its gap as padding.
 */
const markerRight = async (caret) => JSON.parse(await js(`(()=>{const mid=${caret.top + caret.h / 2};
  const glyph=(e)=>{if(!e.classList.contains('wm-bullet')||!e.firstChild)return e.getBoundingClientRect();const r=document.createRange();r.selectNodeContents(e);return r.getBoundingClientRect()};
  const m=[...document.querySelectorAll('.wm-bullet,.wm-todo')].map(glyph).find(r=>r.top<=mid&&r.bottom>=mid);return m?String(m.right):'null'})()`))

const problems = []
const want = (what, cond, detail = "") => { if (!cond) problems.push(what + (detail === "" ? "" : ` (${typeof detail === "string" ? detail : JSON.stringify(detail)})`)) }
const say = (name) => { ok(name, problems.length === 0, problems.join("; ")); problems.length = 0 }

const start = async (text, caret) => {
  if (await js(`!!document.querySelector('.float-menu, #seam-kinds')`)) { await key("Escape"); await sleep(150) }
  await setDoc(text, caret); await setSel(0); await setSel(caret); await focus(); await sleep(250)
  if (await armed()) { await key("Escape"); await sleep(120); await setSel(caret); await sleep(120) }
}
/** The bar up at a seam of D0, by the arrows (as on every page and pen state). Returns the selection it left. */
const armAt = async (seam) => {
  const [at, arrow] = SEAMS[seam]
  await start(D0, at)
  await key(arrow); await sleep(250)
  want(`the bar is up at the ${seam} seam`, await armed())
  return sel()
}
const style = async (kind) => { await clickEl("[data-bar=style]"); await sleep(250); await clickEl(`.float-menu [data-bar="kind-list-${kind}"]`); await sleep(350) }
const plus = async (kind) => {
  const m = await js(`(()=>{const e=document.querySelector('.wm-plus');if(!e)return 'null';const r=e.getBoundingClientRect();return JSON.stringify({x:r.x+r.width/2,y:r.y+r.height/2})})()`).then(JSON.parse)
  want("the + is drawn on the bar", m !== null)
  if (!m) return
  await click(m.x, m.y); await sleep(250)
  await clickEl(`#seam-kinds [data-bar="kind-list-${kind}"]`).catch((error) => want("the + menu's row can be pressed", false, String(error.message)))
  await sleep(350)
}

/**
 * The item the caret is in: the note is `expected` (the caret at `caret`), the Style button says `label`, the caret is drawn
 * where the next character lands and at its height (and past the bullet or box, when one is drawn); then an `x` typed lands
 * there, as the item's words.
 */
async function itemReady(expected, caret, label) {
  await sleep(200)
  const d = await doc()
  want("the note is the list item", d === expected, d)
  want("the caret is where its words go", same(await sel(), [caret, caret]), await sel())
  want(`the Style button says ${label}`, (await styleWord()) === label, await styleWord())
  want("the bar is not up", !(await armed()))
  const before = await caretBox()
  want("the caret is drawn", before !== null)
  const right = before ? await markerRight(before) : null
  if (before && right !== null) want("the caret stands past the marker and its gap, not on it", before.x >= right + 2, { caret: before.x, marker: right })
  await typeText("x"); await sleep(200)
  const typed = expected.slice(0, caret) + "x" + expected.slice(caret)
  want("the x typed is the item's words (not escaped, not a text cell)", (await doc()) === typed, await doc())
  want("...and the cell is still the list", (await styleWord()) === label, await styleWord())
  const x = await charBox(caret)
  const after = await caretBox()
  if (before && x) want("the caret was drawn where the x landed", Math.abs(before.x - x.x) <= 2, { caret: before.x, x: x.x })
  if (before && after) want("...at a typed character's full height", Math.abs(before.h - after.h) <= 1.5 && Math.abs(before.top - after.top) <= 1.5, { before, after })
}

export async function runListItems({ rendered, pen }) {
  await freshNote()
  await setRendered(rendered)
  await setPen(pen)
  const where = `${rendered ? "rendered page" : "markdown side"}, pen ${pen ? "down" : "up"}`
  const tag = `${rendered ? "rendered" : "markdown"}${pen ? "-pen" : ""}`

  // ---- an empty note: the Style menu's four lists
  for (const kind of ["dots", "dashes", "numbered", "todo"]) {
    const name = `${where}: Style > ${LABELS[kind]} on an empty note`
    await test(name, async () => {
      await start("", 0)
      await style(kind)
      await itemReady(MARKERS[kind], MARKERS[kind].length, LABELS[kind])
      if (kind === "todo") await shot(`${tag}-todo-empty-note`)
      return say(name)
    })
  }

  // ---- at a bar: the +, the Style menu, the key
  for (const [how, kind] of [["+", "dots"], ["+", "todo"], ["Style", "numbered"], ["Style", "dashes"], ["key", "dashes"]]) {
    const name = `${where}: ${how === "key" ? "Cmd/Ctrl+Shift+L (the last list picked, Dashes)" : `${how} > ${LABELS[kind]}`} at a bar`
    await test(name, async () => {
      await armAt("middle")
      if (how === "+") await plus(kind)
      else if (how === "Style") await style(kind)
      else { await key("l", { ctrl: true, shift: true }); await sleep(300) }
      const marker = MARKERS[kind]
      await itemReady(`Alpha\n\n${marker}\n\nBeta\n\nGamma`, 7 + marker.length, LABELS[kind])
      if (how === "+" && kind === "todo") await shot(`${tag}-todo-at-bar`)
      return say(name)
    })
  }

  // ---- the line a newline grew under a text cell: the list is a cell of its own UNDER it, as the bar would open it (2026-10-11:
  // it was a second cell touching the first, drawn apart on the rendered page and hugging on the markdown side), the caret in its
  // item; one Undo gives the grown line back
  for (const [how, kind] of [["Style", "dots"], ["List menu", "todo"], ["List button", "todo"]]) {
    const name = `${where}: ${how} > ${LABELS[kind]} on the line a newline grew under a text cell opens it as the bar would`
    await test(name, async () => {
      await start("Alpha\n\nBeta", 5)
      await key("Enter"); await sleep(250)
      want("the first Return grows the cell", (await doc()) === "Alpha\n\n\nBeta" && same(await sel(), [6, 6]), [await doc(), await sel()])
      if (how === "Style") await style(kind)
      else if (how === "List menu") await pickFromMenu("[data-bar=list]", `list-${kind}`)
      else await clickEl("[data-bar=list]")
      await sleep(300)
      const marker = MARKERS[kind]
      want("three cells: the list is one of its own, apart from Alpha", (await brackets()).length === 3, (await brackets()).length)
      if (how === "Style") await shot(`${tag}-dots-grown-line`)
      await itemReady(`Alpha\n\n${marker}\n\nBeta`, 7 + marker.length, LABELS[kind])
      await key("z", { ctrl: true }); await sleep(200)
      await key("z", { ctrl: true }); await sleep(250)
      want("Undo, Undo: the x, then the list; the grown line is back", (await doc()) === "Alpha\n\n\nBeta" && same(await sel(), [6, 6]), [await doc(), await sel()])
      return say(name)
    })
  }

  // ---- the line a newline grew under a numbered list: Numbered counts on (it wrote `1. ` under `2. b`)
  {
    const name = `${where}: Style > Numbered on the line a newline grew under a numbered list writes the next number`
    await test(name, async () => {
      await start("1. a\n2. b\n\nBeta", 9)
      await key("Enter"); await sleep(250)
      await key("Enter"); await sleep(250)
      want("Return, Return: the grown line under the list", (await doc()) === "1. a\n2. b\n\n\nBeta", await doc())
      await style("numbered")
      await itemReady("1. a\n2. b\n3. \n\nBeta", 13, "Numbered")
      want("one cell: the list", (await brackets()).length === 2, (await brackets()).length)
      return say(name)
    })
  }

  // ---- OLD NOTES KEEP THEIR SHAPE: a lone `-` or `1.` in a text cell, a cell that is a `*`, are words as they always were
  {
    const name = `${where}: a lone -, 1. and * in an older note's text cells stay text, three cells`
    await test(name, async () => {
      await start("Alpha\n-\nBeta\n\nShopping:\n1.\n\n*", 2)
      want("three cells, as before 2026-10-11", (await brackets()).length === 3, (await brackets()).length)
      want("the Style button says Text", (await styleWord()) === "Text", await styleWord())
      if (rendered) {
        const lists = Number(await js(`document.querySelectorAll('.wm-pv-list').length`))
        want("the rendered page draws no list", lists === 0, lists)
      }
      return say(name)
    })
  }

  // ---- the line a newline grew under a list of the same kind: the next item of that list, the same cell
  {
    const name = `${where}: Style > Dots on the line a newline grew under a dots list is that list's next item`
    await test(name, async () => {
      await start("- one\n\nBeta", 5)
      await key("Enter"); await sleep(250)
      // (Return on an item carries the list on: `- `. The Return after it takes the marker and leaves the grown line.)
      await key("Enter"); await sleep(250)
      want("Return, Return: the grown line under the list", (await doc()) === "- one\n\n\nBeta", await doc())
      await style("dots")
      await itemReady("- one\n- \n\nBeta", 8, "Dots")
      want("one cell: the list", (await brackets()).length === 2, (await brackets()).length)
      return say(name)
    })
  }

  // ---- a line of words made a list: the caret on the same words, past the box
  {
    const name = `${where}: Style > To-do on a line of words`
    await test(name, async () => {
      await start("Alpha\n\nBeta", 0)
      await style("todo")
      await sleep(200)
      want("the line is the to-do item", (await doc()) === "- [ ] Alpha\n\nBeta", await doc())
      want("the caret is at its words' start", same(await sel(), [6, 6]), await sel())
      const caret = await caretBox()
      const a = await charBox(6)
      want("the caret is drawn at the A", caret && a && Math.abs(caret.x - a.x) <= 2 && Math.abs(caret.h - a.h) <= 3, { caret, a })
      want("the Style button says To-do", (await styleWord()) === "To-do", await styleWord())
      return say(name)
    })
  }

  // ---- Return on an item: the new one's caret
  for (const [text, kind] of [["- a", "dots"], ["- [ ] a", "todo"]]) {
    const name = `${where}: Return on "${text}" puts the caret where the new item's words go`
    await test(name, async () => {
      await start(`${text}\n\nBeta`, text.length)
      await key("Enter"); await sleep(250)
      const marker = MARKERS[kind]
      await itemReady(`${text}\n${marker}\n\nBeta`, text.length + 1 + marker.length, LABELS[kind])
      if (kind === "dots") await shot(`${tag}-return-on-item`)
      return say(name)
    })
  }

  // ---- the rendered page draws an empty item the caret has left as its marker, not as the characters `-`, `*`, `1.`
  if (rendered) {
    const name = `${where}: an empty item the caret is not in is drawn as its bullet, dash and number`
    await test(name, async () => {
      await start("Alpha\n\n- \n\n* \n\n1. \n\nBeta", 2)
      const drawn = JSON.parse(await js(`JSON.stringify([...document.querySelectorAll('.wm-pv-list .wm-pv-li')].map(li=>[li.querySelector('.wm-pv-mark')?.textContent ?? null, li.querySelector('.wm-pv-li-text')?.textContent ?? null]))`))
      want("three drawn lists, each one empty item with its marker", same(drawn, [["•", ""], ["–", ""], ["1.", ""]]), drawn)
      return say(name)
    })
  }

  // ---- a `*` at the bar: the bullet list, at each seam; one Undo back to the bar
  for (const seam of ["first", "middle", "tail"]) {
    const name = `${where}: * typed at the ${seam} seam's bar opens a dots item, one Undo puts the bar back`
    await test(name, async () => {
      const barSel = await armAt(seam)
      const [, , expected, caret] = SEAMS[seam]
      await typeText("*"); await sleep(250)
      await itemReady(expected, caret, "Dots")
      if (seam === "middle") await shot(`${tag}-star-at-bar`)
      await key("z", { ctrl: true }); await sleep(200)
      want("the first Undo takes the x", (await doc()) === expected, await doc())
      await key("z", { ctrl: true }); await sleep(250)
      want("the next Undo takes the item away", (await doc()) === D0, await doc())
      want("...and the bar is up where it was", (await armed()) && same(await sel(), barSel), { armed: await armed(), sel: await sel(), was: barSel })
      return say(name)
    })
  }

  {
    const name = `${where}: * then a space at the bar is one "- ", and the words are the item's`
    await test(name, async () => {
      await armAt("middle")
      await typeText("* "); await sleep(200)
      want("the note holds one `- `", (await doc()) === "Alpha\n\n- \n\nBeta\n\nGamma", await doc())
      await typeText("milk"); await sleep(200)
      want("the words are the item's", (await doc()) === "Alpha\n\n- milk\n\nBeta\n\nGamma", await doc())
      want("the Style button says Dots", (await styleWord()) === "Dots", await styleWord())
      return say(name)
    })
  }

  // ---- the Return rules in the list a `*` opened
  {
    const name = `${where}: in the list a * opened, Return adds an item, Return on the empty last one keeps its line, Return again is the bar`
    await test(name, async () => {
      await armAt("middle")
      await typeText("*a"); await sleep(150)
      await key("Enter"); await sleep(250)
      want("Return adds an item", (await doc()) === "Alpha\n\n- a\n- \n\nBeta\n\nGamma", await doc())
      await typeText("b"); await sleep(150)
      await key("Enter"); await sleep(250)
      await key("Enter"); await sleep(300)
      want("Return on the empty last item takes its marker and keeps the line", (await doc()) === "Alpha\n\n- a\n- b\n\n\nBeta\n\nGamma" && same(await sel(), [15, 15]), [await doc(), await sel()])
      want("...the list's line: no bar, the Style button says Dots", !(await armed()) && (await styleWord()) === "Dots", { armed: await armed(), label: await styleWord() })
      await key("Enter"); await sleep(300)
      want("the Return after it arms the bar under the list", (await armed()) && (await doc()) === "Alpha\n\n- a\n- b\n\nBeta\n\nGamma", [await armed(), await doc()])
      await typeText("z"); await sleep(200)
      want("a character there opens the next cell", (await doc()) === "Alpha\n\n- a\n- b\n\nz\n\nBeta\n\nGamma", await doc())
      return say(name)
    })
  }

  {
    const name = `${where}: Return on the * before a word is typed puts the bar back where it was`
    await test(name, async () => {
      const barSel = await armAt("middle")
      await typeText("*"); await sleep(250)
      await key("Enter"); await sleep(300)
      want("the note is as it was", (await doc()) === D0, await doc())
      want("the bar is up where it was", (await armed()) && same(await sel(), barSel), { armed: await armed(), sel: await sel(), was: barSel })
      return say(name)
    })
  }

  // ---- Backspace on the * before a word is typed: the bar again (it took the marker alone and left an empty cell, no bar)
  for (const seam of ["middle", "tail"]) {
    const name = `${where}: Backspace on the * typed at the ${seam} seam's bar puts the bar back where it was`
    await test(name, async () => {
      const barSel = await armAt(seam)
      await typeText("*"); await sleep(250)
      await key("Backspace"); await sleep(300)
      want("the note is as it was", (await doc()) === D0, await doc())
      want("the bar is up where it was", (await armed()) && same(await sel(), barSel), { armed: await armed(), sel: await sel(), was: barSel })
      want("three cells", (await brackets()).length === 3, (await brackets()).length)
      return say(name)
    })
  }

  // ---- Return on a lone empty item that TOUCHES the cell below: it goes, the cells above and below stay two (it made them one,
  // `Alpha \nZed`). The route Sean's keys take: `- Y`, Return, Return, `Zed`, back after Y, Backspace, Return.
  {
    const name = `${where}: Return on a lone empty item touching the cell below takes it away and keeps the cells apart`
    await test(name, async () => {
      await start("Alpha\n\n- Y", 10)
      await key("Enter"); await sleep(250)
      await key("Enter"); await sleep(250)
      await typeText("Zed"); await sleep(250)
      want("the route: Zed typed on the line under the list", (await doc()) === "Alpha\n\n- Y\nZed", await doc())
      await setSel(10); await focus(); await sleep(250)
      await key("Backspace"); await sleep(250)
      want("Backspace takes the Y", (await doc()) === "Alpha\n\n- \nZed", await doc())
      await key("Enter"); await sleep(300)
      want("Return takes the item away, the two cells apart", (await doc()) === "Alpha\n\nZed", await doc())
      want("two cells", (await brackets()).length === 2, (await brackets()).length)
      want("the bar is up over Zed", await armed(), await armed())
      for (const marker of ["- [ ] ", "1. ", "> "]) {
        await start(`Alpha\n\n${marker}\nZed`, 7 + marker.length)
        await key("Enter"); await sleep(300)
        want(`"${marker}": the item goes, the cells apart`, (await doc()) === "Alpha\n\nZed", await doc())
        want(`"${marker}": the bar is up`, await armed(), await armed())
      }
      return say(name)
    })
  }

  await setPen(false)
  finish()
}
