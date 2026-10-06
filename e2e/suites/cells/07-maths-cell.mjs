// THE MATHS CELL (Sean, 2026-10-06: "ctrl + 7 should be PURELY plaintext.. so clearly we need a math cell type.. that
// should be ctrl + 9 and make ctrl + 10 drawing cells"), with real key presses, on the rendered page and the markdown side:
// (1) Ctrl+9 at a bar (armed by Down) writes an empty ```wl cell there, its own cell, the caret inside; Wolfram Language
//     typed into it stays source while the caret is in it and is typeset once the caret leaves (Down to the bar).
// (2) Ctrl+9 on a text cell's words makes THAT cell a maths cell, the escape backslashes out; it typesets when the caret
//     leaves; ONE Ctrl+Z gives the text cell back.
// (3) Ctrl+7 on a maths cell gives plain words (nothing typeset), Ctrl+8 a ```wolfram code block; Ctrl+Z each.
// (4) Ctrl+0 makes a drawing cell (back from Ctrl+9); Insert ▸ Maths Cell / Drawing Cell show Ctrl+9 / Ctrl+0.
// Pure halves: packages/core/test/mathsCells.test.ts, packages/editor/test/mathsCells.test.ts.
import {
  ok, finish, js, sleep, freshNote, setDoc, doc, sel, key, typeText, focus, armed, setRendered, shot, menu, menuClick, VIEW,
} from "../../lib/harness.mjs"

const ctrl = { ctrl: true }
/** Typeset ```wl blocks on screen (either page). */
const typeset = () => js(`document.querySelectorAll('.wm-math-block .wm-math').length`)
/** The note set to `text`, the caret at `at`, and a pause: the next edit is an Undo step of its own. */
const fresh = async (text, at) => { await setDoc(text, at); await focus(); await sleep(700) }
/** Down until the caret is out of the cell (the rendered page: one press, to the bar; the markdown side: the closing
 * fence line first, then out), at most three presses. */
const leave = async () => { for (let i = 0; i < 3 && (await typeset()) === 0; i++) { await key("ArrowDown"); await sleep(400) } }

await freshNote()

for (const rendered of [true, false]) {
  await setRendered(rendered)
  const side = rendered ? "rendered page" : "markdown side"

  // ---- (1) Ctrl+9 at the bar, type, leave
  const D = "First words.\n\nLast words."
  await fresh(D, "First words.".length)
  await key("ArrowDown"); await sleep(250)
  ok(`${side}: Down from the first cell arms the bar`, await armed())
  await key("9", ctrl); await sleep(300)
  let d = await doc()
  ok(`${side}: Ctrl+9 at the bar writes an empty maths cell there, a cell of its own`,
    d === "First words.\n\n```wl\n\n```\n\nLast words.", JSON.stringify(d))
  ok(`${side}: ...the caret on the line inside it`, (await sel())[1] === "First words.\n\n```wl\n".length, JSON.stringify(await sel()))
  await typeText("Integrate[x^2, {x, 0, 1}]")
  d = await doc()
  ok(`${side}: the Wolfram Language typed goes in as it is`, d === "First words.\n\n```wl\nIntegrate[x^2, {x, 0, 1}]\n```\n\nLast words.", JSON.stringify(d))
  ok(`${side}: while the caret is in it, it is source (nothing typeset)`, (await typeset()) === 0, String(await typeset()))
  await leave()
  ok(`${side}: the caret leaves (Down): the cell is typeset`, (await typeset()) === 1, String(await typeset()))
  ok(`${side}: ...and the source in the file is unchanged`, (await doc()) === d)
  await shot(`maths-cell-typeset-${rendered ? "rendered" : "markdown"}`)

  // ---- (2) Ctrl+9 on a text cell's words; Ctrl+Z
  await fresh("Intro.\n\nEnd.", "Intro.".length)
  await key("ArrowDown"); await sleep(250)
  await typeText("a*b*c + d^2"); await sleep(300)
  const text = await doc()
  ok(`${side}: typed into a new text cell, the words are written by the escape rule`, text.includes("\\*") && !text.includes("```"), JSON.stringify(text))
  await sleep(700)
  await key("9", ctrl); await sleep(300)
  d = await doc()
  ok(`${side}: Ctrl+9 on the text cell's words: that cell is a maths cell, its source raw (escapes out)`,
    d === "Intro.\n\n```wl\na*b*c + d^2\n```\n\nEnd.", JSON.stringify(d))
  ok(`${side}: ...the caret still in its source`, (await typeset()) === 0)
  await leave()
  ok(`${side}: the caret leaves: typeset`, (await typeset()) === 1, String(await typeset()))
  await key("z", ctrl); await sleep(300)
  ok(`${side}: ONE Ctrl+Z gives the text cell back`, (await doc()) === text, JSON.stringify(await doc()))
  ok(`${side}: ...and nothing in it is typeset (a text cell never typesets)`, (await typeset()) === 0)

  // ---- (3) Ctrl+7 and Ctrl+8 on a maths cell
  const MATHS = "Intro.\n\n```wl\nx^2 + 1\n```\n\nEnd."
  await fresh(MATHS, MATHS.indexOf("x^2") + 1)
  await key("7", ctrl); await sleep(300)
  d = await doc()
  ok(`${side}: Ctrl+7 on a maths cell: a text cell of its source (pure plain text)`, d === "Intro.\n\nx^2 + 1\n\nEnd.", JSON.stringify(d))
  await key("ArrowDown"); await key("ArrowDown"); await sleep(300)
  ok(`${side}: ...nothing typeset`, (await typeset()) === 0)
  await key("z", ctrl); await sleep(300)
  ok(`${side}: Ctrl+Z: the maths cell again`, (await doc()) === MATHS, JSON.stringify(await doc()))
  await fresh(MATHS, MATHS.indexOf("x^2") + 1)
  await key("8", ctrl); await sleep(300)
  d = await doc()
  ok(`${side}: Ctrl+8 on a maths cell: a Wolfram Language code block of the same source`, d === MATHS.replace("```wl", "```wolfram"), JSON.stringify(d))
  await key("z", ctrl); await sleep(300)
  ok(`${side}: Ctrl+Z: the maths cell again`, (await doc()) === MATHS, JSON.stringify(await doc()))
}

// ---- (4) Ctrl+0 makes a drawing cell; the menu shows the keys
await setRendered(true)
await fresh("# Cells\n\nA drawing cell below.", 20)
await key("0", ctrl); await sleep(700)
const cell = await js(`!!document.querySelector('.wm-inkcell canvas')`)
ok("Ctrl+0 makes a drawing cell", cell)
ok("...its line is in the note", /!\[[^\]]*\]\(\.drawings\/media\/ink-/.test(await doc()), JSON.stringify(await doc()))
await key("Escape"); await sleep(200)
await shot("maths-cell-ctrl0-drawing")
await key("z", ctrl); await sleep(400)
ok("one Ctrl+Z takes the drawing cell out", !(await js(`!!document.querySelector('.wm-inkcell canvas')`)), JSON.stringify(await doc()))

const insert = (await menu()).find((t) => t.label === "Insert")?.submenu ?? []
const accel = (label) => insert.find((i) => i.label === label)?.accelerator
ok("Insert ▸ Code Block / Maths Cell / Drawing Cell show Ctrl+8 / Ctrl+9 / Ctrl+0",
  accel("Code Block") === "CmdOrCtrl+8" && accel("Maths Cell") === "CmdOrCtrl+9" && accel("Drawing Cell") === "CmdOrCtrl+0",
  JSON.stringify(insert.map((i) => [i.label, i.accelerator])))
// The menu item runs the same command: an empty line gets an empty maths cell.
await setRendered(false)
await fresh("one\n\n\n\ntwo", 5)
await menuClick("mathsCell"); await sleep(400)
ok("Insert ▸ Maths Cell on an empty line: an empty maths cell there", (await doc()) === "one\n\n```wl\n\n```\n\ntwo", JSON.stringify(await doc()))

await finish()
