// The RENDERED page's arrows never stand the caret on a fence's ``` line (Sean, 2026-10-05: "in rendered mode
// pressing up or down shouldn't select the backticks of a code cell"), with real key presses and clicks: a note of
// plain cells, a code cell, an eval In/Out pair, a ```wl maths block and an EMPTY code cell, walked Down from the top
// to the end and Up back. At every step the caret's line is never a fence; inside a cell the arrows walk its content
// and leave it from the first / last content line to the bar; the empty cell is given an empty content line to stand
// on; a click on a fence strip of an open cell lands on the content beside it; Shift+Down still selects; the
// markdown side's fences are still text. The rules are packages/editor/src/preview/fences.ts (previewFences.test.ts).
import {
  ok, finish, js, sleep, freshNote, setDoc, doc, key, focus, setSel, setRendered, click, shot, VIEW, SHIFT,
} from "../../lib/harness.mjs"

await freshNote()
await setRendered(true)

const D = [
  "Intro words", "",
  "```python", "print(\"hello\")", "x = 2", "```", "",
  "```eval wl", "1+1", "```", "",
  "```out", "2", "```", "",
  "```wl", "x^2 + 1", "```", "",
  "```", "```", "",
  "Plain para", "",
  "Last words",
].join("\n")

await setDoc(D, 0); await focus(); await sleep(400)

const isFence = (text) => text.trimStart().startsWith("```")
const state = async () => JSON.parse(await js(`(()=>{const v=${VIEW};const s=v.state.selection.main;const l=v.state.doc.lineAt(s.head);
  return JSON.stringify({head:s.head,anchor:s.anchor,line:l.number,text:l.text,
    armed:document.querySelector('.cm-editor').classList.contains('wm-armed'),
    caret:getComputedStyle(document.querySelector('.cm-cursor-primary')||document.body).visibility})})()`))
const step = async (k, o) => { await key(k, o); await sleep(70); return state() }

/** Walk with `k` until the caret stops moving; every step's state. */
async function walk(k) {
  const steps = []
  let last = await state()
  let still = 0
  for (let i = 0; i < 60 && still < 2; i++) {
    const s = await step(k)
    steps.push(s)
    still = s.head === last.head && s.armed === last.armed ? still + 1 : 0
    last = s
  }
  return steps
}

const offFences = (name, steps, length) => {
  const bad = steps.filter((s) => !s.armed && isFence(s.text))
  ok(name + ": the caret is never on a fence line", bad.length === 0, JSON.stringify(bad))
  // (The bar's caret waits on the blank line the bar stands on: every cell here has one round it.)
  const badBar = steps.filter((s) => s.armed && s.text.trim() !== "" && s.head !== 0 && s.head !== length)
  ok(name + ": an armed bar's caret waits on a blank line, not a fence", badBar.length === 0, JSON.stringify(badBar))
}
const visited = (steps) => steps.filter((s) => !s.armed).map((s) => s.text)

// ---- Down from the top to the end
await setSel(0); await focus(); await sleep(100)
const downs = []
// Into the code cell from the bar above it: its first content line, a shot of it open.
let s = await step("ArrowDown"); downs.push(s)
ok("Down from the first cell arms the bar under it", s.armed, s)
s = await step("ArrowDown"); downs.push(s)
ok("Down from the bar into a code cell lands on its first CONTENT line, not the ```python fence", s.text === "print(\"hello\")" && !s.armed, s)
await shot("in-code-first-line")
s = await step("ArrowDown"); downs.push(s)
ok("Down inside the code walks its content", s.text === "x = 2", s)
s = await step("ArrowDown"); downs.push(s)
ok("Down from the last content line leaves the cell: the bar beneath (not the closing fence)", s.armed && s.text === "", s)
downs.push(...await walk("ArrowDown"))
offFences("Down through the note", downs, (await doc()).length)
const seen = visited(downs)
for (const want of ["1+1", "2", "x^2 + 1", "Plain para", "Last words"]) ok(`Down visits "${want}"`, seen.includes(want), JSON.stringify(seen))
const afterDown = await doc()
ok("the empty code cell was given an empty content line to stand on (and nothing else was written)",
  afterDown === D.replace("```\n```", "```\n\n```"), JSON.stringify(afterDown.slice(-60)))
const emptyStep = downs.find((s) => s.text === "" && !s.armed)
ok("...and Down stood the caret on it, between its fences", !!emptyStep, JSON.stringify(downs.map((s) => [s.line, s.text, s.armed])))
ok("Down ends at the bar under the last cell", downs[downs.length - 1].armed && downs[downs.length - 1].head === afterDown.length, downs[downs.length - 1])

// ---- Up from the end to the top
const ups = await walk("ArrowUp")
offFences("Up through the note", ups, (await doc()).length)
const seenUp = visited(ups)
for (const want of ["Plain para", "x^2 + 1", "2", "1+1", "x = 2", "print(\"hello\")", "Intro words"]) ok(`Up visits "${want}"`, seenUp.includes(want), JSON.stringify(seenUp))
const intoPy = ups.findIndex((s) => s.text === "x = 2")
ok("Up from the bar under the code cell lands on its LAST content line, at its end",
  intoPy > 0 && ups[intoPy - 1].armed && ups[intoPy].head === D.indexOf("x = 2") + 5, JSON.stringify(ups.slice(Math.max(0, intoPy - 1), intoPy + 3)))
ok("...then Up walks the content and leaves from the first content line to the bar above",
  ups[intoPy + 1]?.text === "print(\"hello\")" && ups[intoPy + 2]?.armed === true, JSON.stringify(ups.slice(intoPy, intoPy + 3)))
ok("Up wrote nothing", (await doc()) === afterDown)

// ---- The maths block: in its source while the caret is in it, typeset again when it leaves
{
  const mathAt = (await doc()).indexOf("x^2 + 1")
  await setSel(mathAt - 7); await focus(); await sleep(150) // the blank line above ```wl: the bar
  ok("(the caret on the blank line above the maths arms the bar there)", (await state()).armed)
  s = await step("ArrowDown")
  ok("Down from the bar above a ```wl maths block: its content line (the source), not the fence", s.text === "x^2 + 1" && !s.armed, s)
  await shot("in-maths-source")
  s = await step("ArrowDown")
  ok("...Down again leaves it to the bar beneath", s.armed && s.text === "", s)
  await sleep(200)
  ok("...and the maths is typeset again", (await js(`document.querySelectorAll('.wm-math-block').length`)) >= 1)
}

// ---- A click on a fence strip of an open cell lands on the content beside it
{
  const text = await doc()
  const open = text.indexOf("```python")
  const close = text.indexOf("```", text.indexOf("x = 2"))
  await setSel(text.indexOf("x = 2") + 2); await focus(); await sleep(250)
  const box = (pos) => js(`(()=>{const v=${VIEW};const b=v.lineBlockAt(${pos});const r=v.contentDOM.getBoundingClientRect();
    const top=v.documentTop+b.top;return JSON.stringify({x:Math.round(r.left+60),y:top+b.height/2,h:b.height})})()`).then(JSON.parse)
  const openBox = await box(open)
  await click(openBox.x, openBox.y); await sleep(200)
  s = await state()
  ok("a click on the opening fence's strip lands on the first content line", s.text === "print(\"hello\")" && s.head === s.anchor, { s, openBox })
  await shot("click-open-fence")
  const closeBox = await box(close)
  await click(closeBox.x, closeBox.y); await sleep(200)
  s = await state()
  ok("a click on the closing fence's strip lands on the last content line", s.text === "x = 2" && s.head === s.anchor, { s, closeBox })
}

// ---- Shift+arrows still select across cells, fences and all
{
  const text = await doc()
  await setSel(text.indexOf("x = 2") + 5); await focus(); await sleep(150)
  s = await step("ArrowDown", { modifiers: SHIFT })
  ok("Shift+Down from the last content line still extends a selection out of the cell", s.anchor !== s.head && s.head > text.indexOf("x = 2") + 5, s)
}

// ---- The markdown side is unchanged: there the fences are text
{
  await setRendered(false)
  const text = await doc()
  await setSel(text.indexOf("print(")); await focus(); await sleep(150)
  s = await step("ArrowUp")
  ok("on the markdown side Up from the first line of code is onto the ```python line, as before", s.text === "```python", s)
  await setRendered(true)
}

finish()
