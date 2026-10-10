// @e2e isolated
// TEXT STEPS AND FILE STEPS, INTERLEAVED, ACROSS TWO OPEN NOTES, from the new surfaces (docs/PLAN-undo.md: Ctrl+Z takes the newest step
// of EITHER kind — the open note's own text or drawing step, or the window's newest file step; Ctrl+Shift+Z the one undone last).
// Twelve steps, three of them file steps (the journal's depth), in this order:
//
//   t1  [Alpha]  Find / Replace All “words” → “text”              the Find card, real keys and the mouse   (one text step)
//   t2  [Alpha]  the toolbar's Table                                                                       (one text step)
//   t3  [Alpha]  the toolbar's Move Section Down                                                           (one text step)
//   f1  [file]   the TAB menu: Rename… Alpha → Beta                                                         (file step 1)
//   t4  [Other]  the seam's + → Quote                                                                       (one text step)
//   t5  [Other]  typing “q” into it                                                                         (one text step)
//   t6  [Other]  the toolbar's Text box, placed on the rendered page and typed into                         (a drawing step)
//   t7  [Other]  the Shapes menu: a rectangle                                                               (a drawing step)
//   t8  [Other]  the inspector's duplicate                                                                  (a drawing step)
//   t9  [Other]  the inspector's delete                                                                     (a drawing step)
//   f2  [file]   the sidebar ROW menu: Duplicate Spare                                                      (file step 2)
//   f3  [file]   the sidebar's + menu: New Section                                                          (file step 3)
//
// After EVERY step the picture is read whole (the tab in front, the words, the caret, whether the keyboard is in the notes, the files and
// what each holds, the drawing objects in each, the sidebar's rows) and compared with what the steps so far must have made. Then Ctrl+Z
// takes the newest step of the note in front or of the window, step by step: Other in front first (f3, f2, t9 … t4, then the window's
// f1), then Alpha in front (t3, t2, t1); then Ctrl+Shift+Z puts them back the way they went. After each press the picture is the model's.
import {
  ok, finish, js, sleep, shot, start, openByRow, world, expectWorld, clickTab, tabMenu, rowMenu, plusMenu, dialog, undo, redo, caretAfter, caretTo,
  openFind, findType, findPress, bar, seamPick, typeAndSettle, key, setRendered, drawShape, inspectorPress, canvasBox, drag, typeText,
} from "./_lib.mjs"

const A0 = "# One\n\nalpha words\n\n# Two\n\nbeta words\n"
const O0 = "other\n\nsecond cell\n"
await start({ "Alpha.md": A0, "Other.md": O0, "Spare.md": "spare\n", "Sec/In.md": "inside\n" })
await openByRow("Other.wm")
await clickTab("Alpha.wm")

// ---- the model: what the notes folder and the notes hold after the steps that are done
const model = { aText: A0, aFile: "Alpha.wm", oText: O0, oInk: 0, copy: false, section: false }
const expected = (m) => {
  const files = [m.aFile, "Other.wm", "Spare.wm", "Sec/", "Sec/In.wm", ...(m.copy ? ["Spare copy.wm"] : []), ...(m.section ? ["New Section/"] : [])]
  return {
    files, rows: files.map((f) => f.replace(/\/$/, "")),
    disk: { [m.aFile]: m.aText, "Other.wm": m.oText, "Spare.wm": "spare\n", "Sec/In.wm": "inside\n", ...(m.copy ? { "Spare copy.wm": "spare\n" } : {}) },
    ink: { [m.aFile]: 0, "Other.wm": m.oInk },
  }
}
const check = (label, got, extra = {}) => expectWorld(label, got, { ...expected(model), ...extra })

const A_T1 = "# One\n\nalpha text\n\n# Two\n\nbeta text\n"
const TABLE = "|  |  |\n| --- | --- |\n|  |  |\n|  |  |"
const A_T2 = `# One\n\nalpha text\n\n${TABLE}\n\n# Two\n\nbeta text\n`
const A_T3 = `# Two\n\nbeta text\n\n# One\n\nalpha text\n\n${TABLE}\n`
const O_T4 = "other\n\n> \n\nsecond cell\n"
const O_T5 = "other\n\n> q\n\nsecond cell\n"

/** Each step: what it does, how the model changes, the picture taken just before the gesture's last move (for the caret an Undo gives back). */
const steps = []
const record = async (name, note, kind, fn, change) => {
  const before = await world()
  let held = null
  await fn(async () => { held = await world() })
  const after = await world()
  change(model)
  steps.push({ name, note, kind, before, held: held ?? before, after, apply: change })
  return after
}

let w = await world()
check("the start", w, { text: A0, notes: true, footer: "Alpha.wm" })
await caretTo(0)

// ---- t1: Find / Replace All
await caretTo(0)
let got = await record("t1", "A", "text", async (beforeLast) => {
  await openFind(true)
  await findType("words")
  await findType("text", { field: "Replace" })
  await beforeLast()
  await findPress("replace-all")
  await key("Escape"); await sleep(400)
}, (m) => { m.aText = A_T1 })
await sleep(800)
got = await world()
check("t1, Find / Replace All", got, { front: got.front, text: A_T1, notes: true, footer: "Alpha.wm" })
ok("t1: the Find card is gone and the caret is back in the notes", !(await js(`!!document.querySelector('[data-bar=find]')`)) && got.notes, `${got.notes}`)

// ---- t2: the toolbar's Table (caret at the end of “alpha text”)
await caretAfter("alpha text")
await record("t2", "A", "text", async (beforeLast) => { await beforeLast(); await bar("table") }, (m) => { m.aText = A_T2 })
await sleep(800)
got = await world()
check("t2, toolbar > Table", got, { text: A_T2, notes: true, footer: "Alpha.wm" })
ok("t2: the caret is in the table's first header cell", got.text.slice(0, got.caret[1]).endsWith("alpha text\n\n| ") && got.caret[0] === got.caret[1], JSON.stringify(got.caret))

// ---- t3: the toolbar's Move Section Down (the caret is in section One)
await record("t3", "A", "text", async (beforeLast) => { await beforeLast(); await bar("secdown") }, (m) => { m.aText = A_T3 })
await sleep(800)
got = await world()
check("t3, toolbar > Move Section Down", got, { text: A_T3, notes: true, footer: "Alpha.wm" })
ok("t3: the caret went with its section (it is still in the table's first header cell)", got.text.slice(0, got.caret[1]).endsWith("alpha text\n\n| "), `${JSON.stringify(got.caret)} ${JSON.stringify(got.text.slice(got.caret[1] - 10, got.caret[1] + 5))}`)

// ---- f1: the tab menu, Rename… Alpha → Beta
await record("f1", "W", "file", async () => { await tabMenu("Alpha.wm", "Rename…"); await dialog("Beta") }, (m) => { m.aFile = "Beta.wm" })
got = await world()
check("f1, tab menu > Rename… Beta", got, { text: A_T3, caret: steps.at(-1).before.caret, notes: true, footer: "Beta.wm" })

// ---- Other in front: t4 the seam's Quote, t5 typing
await clickTab("Other.wm")
await caretTo(0)
await record("t4", "O", "text", async (beforeLast) => { await seamPick("Quote", 1, { onMenu: beforeLast }) }, (m) => { m.oText = O_T4 })
await sleep(800)
got = await world()
check("t4, seam + > Quote in Other", got, { text: O_T4, notes: true, footer: "Other.wm" })
await record("t5", "O", "text", async () => { await typeAndSettle("q") }, (m) => { m.oText = O_T5 })
got = await world()
check("t5, typing q", got, { text: O_T5, notes: true, footer: "Other.wm" })

// ---- the rendered page for the drawing steps: t6 a text box, t7 a rectangle, t8 the inspector's duplicate, t9 its delete
await setRendered(true)
await sleep(500)
await record("t6", "O", "ink", async () => {
  const box = await canvasBox()
  await bar("textbox")
  await drag(box.x + 300, box.y + 120, box.x + 540, box.y + 190); await sleep(400)
  await typeText("box"); await key("Escape"); await sleep(500)
}, (m) => { m.oInk = 1 })
await sleep(900)
got = await world()
check("t6, toolbar > Text box", got, { text: O_T5, footer: "Other.wm" })
ok("t6: the keyboard is back in the notes after the text box (Escape ended it)", got.notes, `${got.notes}`)
await record("t7", "O", "ink", async () => { await drawShape("rectangle") }, (m) => { m.oInk = 2 })
await sleep(900)
got = await world()
check("t7, Shapes > Rectangle", got, { text: O_T5, footer: "Other.wm" })
await record("t8", "O", "ink", async () => { await inspectorPress("duplicate") }, (m) => { m.oInk = 3 })
await sleep(900)
got = await world()
check("t8, inspector > duplicate", got, { text: O_T5, footer: "Other.wm" })
await record("t9", "O", "ink", async () => { await inspectorPress("delete") }, (m) => { m.oInk = 2 })
await sleep(900)
got = await world()
check("t9, inspector > delete", got, { text: O_T5, footer: "Other.wm" })
ok("the keyboard is in the notes after the drawing steps", got.notes, `${got.notes}`)

// ---- f2: the sidebar row's menu, Duplicate Spare
await record("f2", "W", "file", async () => { await rowMenu("Spare.wm", "Duplicate") }, (m) => { m.copy = true })
await sleep(500)
got = await world()
check("f2, row menu > Duplicate Spare", got, { text: O_T5, footer: "Other.wm" })

// ---- f3: the sidebar's + menu, New Section
await record("f3", "W", "file", async () => { await plusMenu("New Section"); await sleep(500) }, (m) => { m.section = true })
got = await world()
check("f3, + menu > New Section", got, { text: O_T5, footer: "Other.wm" })
await shot("after-eleven-steps")

// ---- Ctrl+Z: the newest step of the note in front or of the window
const byName = (name) => steps.find((s) => s.name === name)
const revert = {
  t1: (m) => { m.aText = A0 }, t2: (m) => { m.aText = A_T1 }, t3: (m) => { m.aText = A_T2 }, f1: (m) => { m.aFile = "Alpha.wm" },
  t4: (m) => { m.oText = O0 }, t5: (m) => { m.oText = O_T4 }, t6: (m) => { m.oInk = 0 }, t7: (m) => { m.oInk = 1 }, t8: (m) => { m.oInk = 2 }, t9: (m) => { m.oInk = 3 },
  f2: (m) => { m.copy = false }, f3: (m) => { m.section = false },
}
const KIND = { t: "text", f: "file" }
let lastCaret = (await world()).caret
async function press(which, name, front) {
  const step = byName(name)
  const label = `${which === "undo" ? "Ctrl+Z" : "Ctrl+Shift+Z"} → ${name}`
  if (which === "undo") { revert[name](model); await undo() } else { step.apply(model); await redo() }
  const here = await world()
  const wantText = front === "O" ? model.oText : model.aText
  const text = step.kind === "text" && step.note === front
  const caret = text ? (which === "undo" ? step.held.caret : step.after.caret) : lastCaret
  // (a drawing step and a file step leave the open note's caret where it was)
  expectWorld(label, here, {
    ...expected(model), text: wantText, notes: true, footer: front === "O" ? "Other.wm" : model.aFile,
    caret: step.kind === "ink" || step.kind === "file" ? lastCaret : caret,
  })
  lastCaret = here.caret
  return here
}

// Other is in front: f3, f2, then its drawing steps t8 t7 t6, its words t5 t4 and then the window's f1 (a rename of Alpha)
for (const name of ["f3", "f2", "t9", "t8", "t7", "t6", "t5", "t4", "f1"]) await press("undo", name, "O")
await shot("other-undone")
await clickTab("Alpha.wm")
await sleep(400)
lastCaret = (await world()).caret
for (const name of ["t3", "t2", "t1"]) await press("undo", name, "A")
got = await world()
check("everything undone", got, { text: A0, notes: true, footer: "Alpha.wm" })
await undo()
check("a press with nothing left to undo changes nothing", await world(), { text: A0, footer: "Alpha.wm" })

// ---- Ctrl+Shift+Z: the way they went
for (const name of ["t1", "t2", "t3", "f1"]) await press("redo", name, "A")
await clickTab("Other.wm")
await sleep(400)
lastCaret = (await world()).caret
for (const name of ["t4", "t5", "t6", "t7", "t8", "t9", "f2", "f3"]) await press("redo", name, "O")
await shot("all-redone")
finish()
