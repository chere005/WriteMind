// THE SEAM'S + MENU, EVERY KIND, EVERY SEAM (docs/PLAN-bars-2026-10.md P1 and P6; Sean, 2026-10-10: "clicking on a cell type
// from the + button should insert the cell and put the input cursor where it belongs"). The library of 16..19: one script per
// pane and pen state, so each stays inside the runner's time for a script.
//
// cells/10 drives the menu with a script's .click() and compares the note with what the KEY makes; it passed while a real press on
// a row did nothing at all (the editor's own mouse-down put the menu away before the click arrived). This is the person: a REAL
// mouse press on the +, a REAL mouse press on the row, then the keyboard. For each kind the menu offers, at the first seam, the
// middle one and the tail:
//   * the new empty cell of that kind is at that seam (the note is exactly what the kind writes), the menu is shut,
//   * the input cursor is INSIDE it at its first editable position, as one caret, drawn, and the bar is gone (the caret is the cursor),
//   * the keyboard is the notes': the next key typed lands in the new cell, and the Style button names the cell,
//   * ONE Undo takes the cell away and puts the caret back at the bar, and Redo brings the cell back with the caret in it.
// The Drawing cell is the app's (its line names a cell in the drawing): the cell is at the seam, the bar is under it (a dock's rule,
// the next key opens a text cell after it), the pen is scoped to it on the rendered page, and one Undo takes the line and the
// drawing item out together. The Table is not in the menu (its own button makes it) but it is a cell made at a bar all the same,
// so the button is held to the same rules at the bar the + put up.
//
// With the pen down on the RENDERED page the pen's layer owns the pointer (a press draws, nothing hovers a seam), so the bar is armed
// by the keys, as it can be, and the + it shows is pressed with the mouse: the layer hands that press on (Canvas.tsx `plusAt`).
import {
  ok, test, finish, js, sleep, freshNote, setDoc, setSel, doc, sel, key, click, hover, focus, armed, VIEW, setRendered, setPen,
  clickEl, typeText, saved, shot, pickCodeLanguage,
} from "../../lib/harness.mjs"

const D0 = "Alpha\n\nBeta\n\nGamma"
const SEAMS = {
  first: { before: "", after: "\n\nAlpha\n\nBeta\n\nGamma", arm: [0, "ArrowUp"] },
  middle: { before: "Alpha\n\n", after: "\n\nBeta\n\nGamma", arm: [5, "ArrowDown"] },
  tail: { before: D0 + "\n\n", after: "", arm: [D0.length, "ArrowDown"] },
}
// [the row's data-bar, the Style button's word, the cell it writes (empty), where the caret goes inside it]
const KINDS = [
  ["kind-text", "Text", "", 0],
  ["kind-heading-1", "Title", "# ", 2],
  ["kind-heading-2", "Chapter", "## ", 3],
  ["kind-heading-6", "Author", "###### ", 7],
  ["kind-heading-3", "Section", "### ", 4],
  ["kind-heading-4", "Subsection", "#### ", 5],
  ["kind-heading-5", "Subsubsection", "##### ", 6],
  ["kind-list-dots", "Dots", "- ", 2],
  ["kind-list-dashes", "Dashes", "* ", 2],
  ["kind-list-numbered", "Numbered", "1. ", 3],
  ["kind-list-todo", "To-do", "- [ ] ", 6],
  ["kind-quote", "Quote", "> ", 2],
  ["kind-markdown", "Markdown", "<!-- markdown -->\n", 18],
  ["kind-code", "Code", "```\n\n```", 4],
  ["kind-evaluation", "Runnable code", "```eval wl\n\n```", 11],
  ["kind-maths", "Maths", "```wl\n\n```", 6],
]
const TABLE = "|  |  |\n| --- | --- |\n|  |  |\n|  |  |"
const INK_LINE = /!\[ink\]\(snapshots\/ink-[0-9a-f-]{36}\.svg\)/

const inNotes = () => js(`!!document.activeElement?.closest('.cm-content')`)
const menuUp = () => js(`!!document.querySelector('#seam-kinds')`)
const marker = async () => JSON.parse(await js(`(()=>{const e=document.querySelector('.wm-plus'); if(!e) return 'null'; const r=e.getBoundingClientRect(); return JSON.stringify({cx:r.x+r.width/2,cy:r.y+r.height/2})})()`))
const bars = () => js(`document.querySelectorAll('.wm-bar').length`)
const caretShown = () => js(`(()=>{const c=document.querySelector('.cm-cursor'); return !!c && getComputedStyle(c).display !== 'none' && getComputedStyle(c).visibility !== 'hidden'})()`)
const styleWord = () => js(`document.querySelector('[data-bar=style] .bar-label-text')?.textContent ?? null`)
const escape = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")

/**
 * The client y of the seam: above the first cell, the blank line between the first two, well below the last one. (From the
 * editor's own line boxes, not the .cm-line elements: on the rendered page the closed blocks are widgets with no line of their own.)
 */
const seamY = (name) => js(`(()=>{const v=${VIEW};const top=v.documentTop;const at=(pos)=>v.lineBlockAt(pos);
  return ${JSON.stringify(name)}==='first' ? top+at(0).top-6 : ${JSON.stringify(name)}==='middle' ? top+(at(6).top+at(6).bottom)/2 : top+at(v.state.doc.length).bottom+30})()`)

/** Fresh note text, nothing armed, the editor focused, the menu shut. */
async function reset() {
  if (await menuUp()) { await key("Escape"); await sleep(100) }
  await setDoc(D0, 8)
  await focus()
  await sleep(150)
  if (await armed()) { await key("Escape"); await sleep(100) }
}

/**
 * Put the bar up at a seam and press its +, as a person does: the mouse hovers the seam (the + appears) and presses it; where the pen's
 * layer owns the pointer (`byKeys`) the bar is walked to with the arrow keys and the + it shows is pressed. Returns false when no +
 * could be pressed.
 */
async function pressPlus(name, byKeys) {
  if (byKeys) {
    const [at, arrow] = SEAMS[name].arm
    await setSel(at); await sleep(100)
    await key(arrow); await sleep(250)
    if (!(await armed())) return false
  } else {
    await hover(700, await seamY(name)); await sleep(180)
  }
  const m = await marker()
  if (!m) return false
  await click(m.cx, m.cy); await sleep(200)
  return true
}

/** Aspects that failed in a case, said once at its end. */
const problems = []
const say = (name) => { ok(name, problems.length === 0, problems.join("; ")); problems.length = 0 }
const want = (what, cond, detail = "") => { if (!cond) problems.push(what + (detail === "" ? "" : ` (${typeof detail === "string" ? detail : JSON.stringify(detail)})`)) }
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b)

/**
 * One kind picked from the + menu at one seam with the real mouse, then the keyboard (see the header). `looks`: a name to
 * photograph the open menu and the new cell under, for a person to look at.
 */
async function kindCase({ name, seamName, byKeys, row, label, cell, inside, looks }) {
  const seam = SEAMS[seamName]
  const base = seam.before.length
  problems.length = 0
  await reset()
  const pressed = await pressPlus(seamName, byKeys)
  want("the + is drawn and pressable", pressed)
  if (!pressed) return say(name)
  want("the menu is up", await menuUp())
  want("the bar is up where the + was pressed", await armed())
  if (looks) await shot(`${looks}-menu`)
  const barSel = await sel()
  await clickEl(`#seam-kinds [data-bar="${row}"]`).catch((error) => want("the row can be pressed", false, String(error.message)))
  await sleep(300)
  const expected = seam.before + cell + seam.after
  const caret = base + inside
  want("the menu is closed", !(await menuUp()))
  want("the note is the new empty cell at the seam", (await doc()) === expected, await doc())
  const s = await sel()
  want("the caret is one point, inside the new cell at its first editable position", s[0] === s[1] && s[0] === caret, { sel: s, caret })
  want("the bar is gone", !(await armed()) && (await bars()) === 0, { armed: await armed(), bars: await bars() })
  want("the caret is drawn (the caret is the cursor now)", await caretShown())
  want("the keyboard is the notes'", await inNotes())
  want("the Style button names the new cell", (await styleWord()) === label, await styleWord())
  if (looks) await shot(`${looks}-picked`)
  // The next key typed lands in it.
  await typeText("x"); await sleep(100)
  const typed = expected.slice(0, caret) + "x" + expected.slice(caret)
  want("a typed x lands in the new cell", (await doc()) === typed, await doc())
  // Undo: the word, then the cell and the caret together. Redo: the cell back, the caret in it.
  await key("z", { ctrl: true }); await sleep(150)
  want("the first Undo takes the typed word", (await doc()) === expected, await doc())
  await key("z", { ctrl: true }); await sleep(150)
  want("the next Undo takes the whole cell away", (await doc()) === D0, await doc())
  want("...and the caret is back at the bar", same(await sel(), barSel), { sel: await sel(), was: barSel })
  await key("z", { ctrl: true, shift: true }); await sleep(150)
  want("Redo brings the cell back", (await doc()) === expected, await doc())
  want("...with the caret inside it", same(await sel(), s), { sel: await sel(), was: s })
  return say(name)
}

/** Every kind of the + menu at the three seams, for one pane and one state of the pen. */
export async function runKinds({ rendered, pen }) {
  const file = await freshNote()
  await setRendered(rendered)
  await setPen(pen)
  const byKeys = rendered && pen
  const where = `${rendered ? "rendered" : "markdown"}, pen ${pen ? "down" : "up"}`
  const only = process.env.PLUS_ONLY ? new RegExp(process.env.PLUS_ONLY) : null

  for (const seamName of ["middle", "first", "tail"]) {
    const seam = SEAMS[seamName]
    const base = seam.before.length

    // ---- the text kinds, the lists, the quote, the fences
    for (const [row, label, cell, inside] of KINDS) {
      const name = `${where}, ${seamName} seam, + > ${label}`
      if (only && !only.test(name)) continue
      await test(name, () => kindCase({ name, seamName, byKeys, row, label, cell, inside, looks: label === "Title" && seamName === "middle" ? `${rendered ? "rendered" : "markdown"}-pen-${pen ? "down" : "up"}` : null }))
    }

    // ---- Drawing: the cell is the app's
    const inkName = `${where}, ${seamName} seam, + > Drawing`
    if (!only || only.test(inkName)) {
      await test(inkName, async () => {
        problems.length = 0
        await reset()
        const pressed = await pressPlus(seamName, byKeys)
        want("the + is drawn and pressable", pressed)
        if (!pressed) return say(inkName)
        const barSel = await sel()
        await clickEl(`#seam-kinds [data-bar="kind-ink"]`).catch((error) => want("the row can be pressed", false, String(error.message)))
        await sleep(500)
        const d = await doc()
        const found = new RegExp("^" + escape(seam.before) + INK_LINE.source + escape(seam.after) + "$").test(d)
        want("the drawing cell's line is at the seam", found, d)
        want("the menu is closed", !(await menuUp()))
        const line = INK_LINE.exec(d)
        const to = line ? line.index + line[0].length : -1
        const s = await sel()
        // (A dock's rule: the caret on the blank line under the cell, or at the end of the note, and the bar there.)
        want("the input cursor is under the cell, on its bar", found && s[0] === s[1] && s[0] === (to < d.length ? to + 1 : to) && (await armed()), { sel: s, to, armed: await armed() })
        want("the keyboard is the notes'", await inNotes())
        if (rendered) want("the pen is scoped to the new cell", await js(`document.querySelectorAll('.wm-inkcell-pen').length === 1`))
        const item = line ? /ink-([0-9a-f-]{36})/.exec(line[0])?.[1] : null
        const stored = (draw) => draw.items.some((i) => i.kind === "cell" && i.id === item)
        want("the cell is in the drawing", stored(await saved(file, stored)))
        await key("z", { ctrl: true }); await sleep(300)
        want("ONE Undo takes the line out", (await doc()) === D0, await doc())
        want("...and the caret is back at the bar", same(await sel(), barSel), { sel: await sel(), was: barSel })
        want("...and the drawing item with it", !stored(await saved(file, (draw) => !stored(draw))))
        await key("z", { ctrl: true, shift: true }); await sleep(300)
        want("Redo brings the cell back, the line and the drawing item", (await doc()) === d && stored(await saved(file, stored)), await doc())
        // The next key typed opens a text cell after the drawing (the bar is the cursor).
        await typeText("x"); await sleep(200)
        want("a typed x opens a text cell after it", (await doc()) === seam.before + line?.[0] + "\n\nx" + seam.after, await doc())
        return say(inkName)
      })
    }

    // ---- Table: not in the menu; its own button makes it at the bar the + put up
    const tableName = `${where}, ${seamName} seam, + up, then the Table button`
    if (!only || only.test(tableName)) {
      await test(tableName, async () => {
        problems.length = 0
        await reset()
        const pressed = await pressPlus(seamName, byKeys)
        want("the + is drawn and pressable", pressed)
        if (!pressed) return say(tableName)
        await key("Escape"); await sleep(200)
        want("Escape shuts the menu and leaves the bar up", !(await menuUp()) && (await armed()))
        const barSel = await sel()
        await clickEl("[data-bar=table]"); await sleep(400)
        const expected = seam.before + TABLE + seam.after
        const caret = base + 2
        want("the note is the new empty table at the seam", (await doc()) === expected, await doc())
        const s = await sel()
        want("the caret is in its first header cell", s[0] === s[1] && s[0] === caret, { sel: s, caret })
        want("the bar is gone", !(await armed()) && (await bars()) === 0)
        want("the keyboard is the notes'", await inNotes())
        want("the Style button names the cell", (await styleWord()) === "Table", await styleWord())
        await typeText("x"); await sleep(150)
        want("a typed x lands in the first header cell", (await doc()) === expected.slice(0, caret) + "x" + expected.slice(caret), await doc())
        await key("z", { ctrl: true }); await sleep(200)
        await key("z", { ctrl: true }); await sleep(250)
        want("Undo takes the table away and the caret back to the bar", (await doc()) === D0 && same(await sel(), barSel), { doc: await doc(), sel: await sel(), was: barSel })
        return say(tableName)
      })
    }
  }
  // ---- Code writes the language last picked (docs/KEYS.md): the fence is tagged in the same step, and the word typed in it is the next one
  const langName = `${where}, middle seam, + > Code after Python was picked`
  if (!only || only.test(langName)) {
    await test(langName, async () => {
      await setDoc("lang", 2); await focus(); await sleep(200)
      await pickCodeLanguage("python")
      try {
        await kindCase({ name: langName, seamName: "middle", byKeys, row: "kind-code", label: "Code", cell: "```python\n\n```", inside: 10, looks: null })
      } finally {
        await pickCodeLanguage("plain")
      }
    })
  }
  await setPen(false)
  finish()
}
