// @e2e isolated
// CELLS AND THE INPUT CURSOR, from the merged bars (Sean, 2026-10-10: "make sure the cell behavior, moving the input cursor, search, and
// undo are all implemented properly"; docs/PLAN-bars-2026-10.md P7). On the markdown side and on the rendered page, real keys and the
// real mouse:
//   (a) a cell made by the Style menu, by the seam's +, by the toolbar's Table: the caret is IN the new cell at its first editable
//       place, what is typed next lands there, ONE Ctrl+Z takes the cell (what was typed is its own step), a Redo puts the caret back
//       in the cell, and an Undo after that gives back the caret the gesture found;
//   (b) the arrows walk cell, bar, cell, down and back up, across a code cell, maths, a list, a quote, a table, to the bars at both
//       ends of the note — a note that ends with its newline as the app saves it; a held cell (a bracket click) survives the bars'
//       clicks and the arrows let it go without touching the words;
//   (c) Move Section Up / Down by the toolbar's buttons and by their keys: the caret stays on its words in the moved section, a
//       selection stays selected, ONE undo each, and the Redo and the Undo after it keep the caret in the section too;
//   (d) the table the toolbar inserts: Tab and Enter inside it, one step each.
import {
  ok, test, finish, js, sleep, shot, start, doc, sel, selText, key, click, typeText, setRendered, styleMenu, seamPick, bar, caretTo, armed, brackets,
  clickEl, undo, redo, inNotes, caretAfter, lineBoxes,
} from "./_lib.mjs"

const D = "alpha\n\nbeta words\n\ngamma\n"
await start({ "Alpha.md": D })
const view = `document.querySelector('.cm-content').cmTile.view`
const load = async (text, caret) => {
  await js(`(() => { const v = ${view}; v.dispatch({ changes: { from: 0, to: v.state.doc.length, insert: ${JSON.stringify(text)} }, selection: { anchor: ${caret} } }); v.focus() })()`)
  await sleep(450)
}
const around = async (n = 8) => { const d = await doc(); const h = (await sel())[1]; return [d.slice(Math.max(0, h - n), h), d.slice(h, h + n)] }
const settle = () => sleep(900)
// (A way to run one test while a script is being written: ONLY=“Table” node …)
const t = (name, fn) => (process.env.ONLY && !name.includes(process.env.ONLY) ? undefined : test(name, fn))

for (const rendered of [false, true]) {
  const side = rendered ? "rendered page" : "markdown side"
  await setRendered(rendered)

  // ---------------------------------------------------------------------------------------------------------------
  // (a) every way a cell is made
  // ---------------------------------------------------------------------------------------------------------------
  const FROM = D.indexOf("beta") + 6               // beta w|ords
  const STYLES = [
    // [row, label, what the caret is next to afterwards]
    ["heading-1", "Title", "inplace"], ["heading-3", "Section", "inplace"], ["list-dots", "Dots", "inplace"], ["list-numbered", "Numbered", "inplace"],
    ["list-todo", "To-do", "inplace"], ["quote", "Quote", "inplace"], ["markdown", "Markdown", "inplace"],
    ["maths", "Maths", "inplace"], ["code", "Code", "after"], ["evaluation", "Runnable code", "after"],
  ]
  for (const [row, label, where] of STYLES) {
    await t(`${side}: Style > ${label}`, async () => {
      await load(D, FROM)
      await styleMenu(row)
      const d = await doc()
      const caret = await around()
      if (where === "inplace") ok(`${label}: the caret stays on the same characters (beta w|ords)`, caret[0].endsWith("beta w") && caret[1].startsWith("ords"), JSON.stringify(caret))
      else ok(`${label}: the caret is inside the new empty cell, on its first line`, caret[0].endsWith("```\n") || caret[0].endsWith("wl\n"), JSON.stringify(caret))
      ok(`${label}: the keyboard is in the notes`, await inNotes())
      // what is typed next lands at the caret and is its own step
      const length = d.length
      await typeText("Q"); await settle()
      const typed = await doc()
      ok(`${label}: a typed key goes in at the caret`, typed.length === length + 1 && typed.includes("Q"), JSON.stringify(typed))
      await undo()
      ok(`${label}: Ctrl+Z takes the typed key and nothing else (the cell stays)`, (await doc()) === d, JSON.stringify(await doc()))
      await undo()
      ok(`${label}: the next Ctrl+Z takes the whole cell back`, (await doc()) === D, JSON.stringify(await doc()))
      ok(`${label}: …and the caret is where it was`, (await sel())[1] === FROM, JSON.stringify(await sel()))
      await redo()
      ok(`${label}: Ctrl+Shift+Z brings the cell back`, (await doc()) === d, JSON.stringify(await doc()))
      const after = await around()
      ok(`${label}: …with the caret where the pick left it`, JSON.stringify(after) === JSON.stringify(caret), JSON.stringify({ after, caret }))
      await undo()
      ok(`${label}: and Ctrl+Z after that gives the caret of the beginning again`, (await doc()) === D && (await sel())[1] === FROM, JSON.stringify(await sel()))
    })
  }

  // the seam's +: the kinds, at the bar between “alpha” and “beta words”
  const SEAMS = [
    ["Text", (b, a) => b.endsWith("alpha\n\n") && a.startsWith("\n\nbeta")],
    ["Title", (b) => b.endsWith("# ")], ["Section", (b) => b.endsWith("### ")], ["Dots", (b) => b.endsWith("- ")], ["Numbered", (b) => b.endsWith("1. ")],
    ["To-do", (b) => b.endsWith("- [ ] ")], ["Quote", (b) => b.endsWith("> ")], ["Markdown", (b) => b.endsWith("<!-- markdown -->\n")],
    ["Code", (b, a) => b.endsWith("```\n") && a.startsWith("\n```")], ["Runnable code", (b, a) => b.endsWith("```eval wl\n") && a.startsWith("\n```")],
    ["Maths", (b, a) => b.endsWith("```wl\n") && a.startsWith("\n```")],
  ]
  for (const [label, here] of SEAMS) {
    await t(`${side}: the seam's + > ${label}`, async () => {
      await load(D, FROM)
      let barAt = null
      const picked = await seamPick(label, "beta words", { onMenu: async () => { barAt = (await sel())[1] } })
      ok(`${label}: the + was there and its menu opened`, picked)
      if (!picked) return
      const d = await doc()
      const [b, a] = await around(24)
      ok(`${label}: the caret is inside the new cell, at its first editable place`, here(b, a), JSON.stringify([b, a]))
      ok(`${label}: the bar is put away (the caret is in the cell)`, !(await armed()))
      ok(`${label}: the keyboard is in the notes`, await inNotes())
      await typeText("Q"); await settle()
      ok(`${label}: a typed key lands in the new cell`, (await doc()).length === d.length + 1, JSON.stringify(await doc()))
      await undo()
      ok(`${label}: Ctrl+Z takes the typed key, the cell stays`, (await doc()) === d, JSON.stringify(await doc()))
      await undo()
      ok(`${label}: the next Ctrl+Z takes the whole cell`, (await doc()) === D, JSON.stringify(await doc()))
      ok(`${label}: …the caret back where the + found it`, (await sel())[1] === barAt, JSON.stringify([await sel(), barAt]))
      await redo()
      ok(`${label}: Redo brings the cell back, the caret in it`, (await doc()) === d && here(...(await around(24))), JSON.stringify(await around(24)))
    })
  }

  await t(`${side}: the seam's + > Drawing and Style > Drawing make an ink cell, one step each`, async () => {
    for (const via of ["seam", "style"]) {
      await load(D, FROM)
      if (via === "seam") await seamPick("Drawing", "beta words"); else await styleMenu("ink")
      const d = await doc()
      ok(`${via}: an ink cell's line is in the note`, /!\[ink\]\(snapshots\/ink-[0-9a-f-]{36}\.svg\)/.test(d), JSON.stringify(d))
      ok(`${via}: the keyboard is in the notes`, await inNotes())
      await undo()
      ok(`${via}: ONE Ctrl+Z takes the cell`, (await doc()) === D, JSON.stringify(await doc()))
    }
  })

  // the toolbar's Table
  await t(`${side}: the toolbar's Table: the caret in the first header cell, one step, Redo keeps the caret`, async () => {
    await load(D, FROM)
    await bar("table")
    const d = await doc()
    const caret = await around(20)
    ok("Table: a two-column, three-row table follows the caret's cell", d === "alpha\n\nbeta words\n\n|  |  |\n| --- | --- |\n|  |  |\n|  |  |\n\ngamma\n", JSON.stringify(d))
    ok("Table: the caret is in the first header cell", caret[0].endsWith("beta words\n\n| ") && caret[1].startsWith(" |"), JSON.stringify(caret))
    await undo()
    ok("Table: ONE Ctrl+Z takes it back, the caret where it was", (await doc()) === D && (await sel())[1] === FROM, JSON.stringify([await doc(), await sel()]))
    await redo()
    ok("Table: Redo puts it back with the caret in the first header cell", (await doc()) === d && JSON.stringify(await around(20)) === JSON.stringify(caret), JSON.stringify(await around(20)))
    // (d) Tab and Enter inside it
    await typeText("Item"); await key("Tab"); await typeText("Cost"); await key("Tab"); await typeText("a"); await key("Tab"); await typeText("1"); await sleep(300)
    ok("Tab walks the cells (the delimiter row stepped over) and typing fills them", /\| ?Item ?\| ?Cost ?\|\n\| --- \| --- \|\n\| ?a ?\| ?1 ?\|/.test(await doc()), JSON.stringify(await doc()))
    await key("Tab"); await key("Tab"); await sleep(150)
    ok("Tab from the last cell of a row goes to the next row's first cell", JSON.stringify(await around(4)).includes("|"), JSON.stringify(await around(4)))
    const before = await doc()
    await key("Enter"); await sleep(250)
    ok("Enter adds a row under the caret's row, the caret in it", (await doc()).split("\n").length > before.split("\n").length, JSON.stringify(await doc()))
    await undo()
    ok("and ONE Ctrl+Z takes that row back", (await doc()) === before, JSON.stringify(await doc()))
  })

  // ---------------------------------------------------------------------------------------------------------------
  // (b) the arrows
  // ---------------------------------------------------------------------------------------------------------------
  const W = "# Title\n\nplain text\n\n- one\n- two\n\n> quote\n\n```python\nprint(1)\n```\n\n```wl\nx^2\n```\n\n| a | b |\n| --- | --- |\n| 1 | 2 |\n\nlast words\n"
  await t(`${side}: ArrowDown walks cell, bar, cell to the bar under the note, ArrowUp walks back to the bar above it`, async () => {
    await load(W, 0)
    const seen = []
    const bars = []
    let last = -1
    for (let i = 0; i < 60; i++) {
      const [, head] = await sel()
      const isBar = await armed()
      const text = await doc()
      const line = text.slice(text.lastIndexOf("\n", head - 1) + 1, text.indexOf("\n", head) < 0 ? text.length : text.indexOf("\n", head))
      if (isBar) { if (!bars.includes(head)) bars.push(head) } else if (line !== "" && !seen.includes(line)) seen.push(line)
      ok(`down ${i}: the caret never goes backwards`, head >= last, `${head} < ${last}`)
      if (isBar && head === W.length) break
      last = head
      await key("ArrowDown"); await sleep(110)
    }
    ok("a bar was stood on between every two cells and under the last: eight bars", bars.length === 8, JSON.stringify(bars))
    ok("the last bar is under the note (also because the note ends with its newline)", bars.at(-1) === W.length && (await armed()), JSON.stringify([bars, await sel()]))
    for (const needle of ["# Title", "plain text", "- one", "> quote", "print(1)", "x^2", "| a | b |", "| 1 | 2 |", "last words"]) {
      ok(`down: the walk stood in “${needle}”`, seen.includes(needle), JSON.stringify(seen))
    }
    ok("down: it never stood on a fence line of a fenced cell (rendered page only: the markdown side shows them)", rendered ? !seen.some((s) => /^```/.test(s)) : true, JSON.stringify(seen))
    // and back up
    const up = []
    last = Infinity
    for (let i = 0; i < 60; i++) {
      const [, head] = await sel()
      if ((await armed()) && !up.includes(head)) up.push(head)
      ok(`up ${i}: the caret never goes forwards`, head <= last, `${head} > ${last}`)
      if ((await armed()) && head === 0) break
      last = head
      await key("ArrowUp"); await sleep(110)
    }
    ok("up: the same eight bars again and one more, above the first cell", up.length === 9 && up.at(-1) === 0 && up[0] === W.length, JSON.stringify(up))
    await key("ArrowUp"); await sleep(150)
    ok("up again at the top bar: it stays (the key is taken, nothing moves)", (await armed()) && (await sel())[1] === 0, JSON.stringify(await sel()))
    ok("the note was not touched by the walk", (await doc()) === W)
  })

  await t(`${side}: a held cell (a bracket click) survives the bars' clicks and the arrows let it go without touching the words`, async () => {
    await load("one words\n\ntwo words\n\nthree words\n", 0)
    const bs = await brackets()
    await click(bs[1].x, bs[1].y); await sleep(400)
    ok("the bracket holds exactly the cell", (await selText()) === "two words", JSON.stringify(await selText()))
    for (const target of ["[data-bar=sidebar]", "[data-bar=sidebar]", "[data-bar=tab-list]"]) {
      await clickEl(target); await sleep(350)
      if (target.includes("tab-list")) { await key("Escape"); await sleep(250) }
      ok(`still held after a click on ${target}`, (await selText()) === "two words", JSON.stringify(await selText()))
    }
    await key("ArrowDown"); await sleep(250)
    ok("ArrowDown lets it go: a caret, the words as they were", (await sel())[0] === (await sel())[1] && (await doc()) === "one words\n\ntwo words\n\nthree words\n", JSON.stringify(await sel()))
  })

  // ---------------------------------------------------------------------------------------------------------------
  // (c) Move Section Up / Down
  // ---------------------------------------------------------------------------------------------------------------
  const S = "# Alpha section\n\nalpha words here\n\n# Beta section\n\nbeta words here\nsecond line\n\n- b1\n- b2\n\n# Gamma section\n\ngamma words\n"
  const headings = (d) => d.split("\n").filter((l) => l.startsWith("# ")).map((l) => l.slice(2, 7))
  for (const via of ["button", "key"]) {
    for (const up of [true, false]) {
      await t(`${side}: Move Section ${up ? "Up" : "Down"} by its ${via}: the caret stays on its words, one undo, and the Redo and the Undo after it too`, async () => {
        const at = S.indexOf("second line") + 3
        await load(S, at)
        if (via === "button") await bar(up ? "secup" : "secdown"); else await key(up ? "ArrowUp" : "ArrowDown", { ctrl: true })
        await sleep(300)
        const moved = await doc()
        ok("the section went the right way", JSON.stringify(headings(moved)) === JSON.stringify(up ? ["Beta ", "Alpha", "Gamma"] : ["Alpha", "Gamma", "Beta "]), JSON.stringify(headings(moved)))
        const where = await around(6)
        ok("the caret is on the same words (sec|ond line)", where[0].endsWith("sec") && where[1].startsWith("ond li"), JSON.stringify(where))
        ok("the keyboard is in the notes", await inNotes())
        await undo()
        ok("ONE Ctrl+Z puts the note back and the caret where it was", (await doc()) === S && (await sel())[1] === at, JSON.stringify([await sel(), at]))
        await redo()
        ok("Ctrl+Shift+Z moves it again, the caret on its words", (await doc()) === moved && JSON.stringify(await around(6)) === JSON.stringify(where), JSON.stringify(await around(6)))
        await undo()
        ok("and the Undo after the Redo gives the first caret back (not the end of the note)", (await doc()) === S && (await sel())[1] === at, JSON.stringify(await sel()))
      })
    }
  }
  await t(`${side}: a selection inside the moved section stays selected on the same words`, async () => {
    const from = S.indexOf("beta words")
    await load(S, from)
    await caretTo(from, from + 10)
    await bar("secdown"); await sleep(300)
    ok("the words are still selected", (await selText()) === "beta words", JSON.stringify(await selText()))
    await undo()
    ok("and one Ctrl+Z puts the selection back too", (await doc()) === S && (await selText()) === "beta words", JSON.stringify([await selText()]))
  })
  await t(`${side}: the end sections: the last one cannot go down, the first cannot go up, and neither is an undo step`, async () => {
    await load(S, S.indexOf("gamma words") + 2)
    await bar("secdown"); await sleep(250)
    ok("the last section going down does nothing", (await doc()) === S)
    await load(S, 3)
    await bar("secup"); await sleep(250)
    ok("the first going up does nothing", (await doc()) === S)
    await typeText("Q"); await settle()
    await bar("secup"); await sleep(250)
    await undo()
    ok("a move that did nothing is no step: Ctrl+Z takes the typed key", (await doc()) === S, JSON.stringify(await doc()))
  })
}
await setRendered(false)
await shot("cells-and-caret")
finish()
