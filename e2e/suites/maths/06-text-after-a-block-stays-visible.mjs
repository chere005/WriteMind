// A typeset ```wl block replaces its WHOLE closing-fence line, so anything on that line after the backticks used to
// vanish from the page (it stayed in the file, but the page is the source here). Two ordinary flows did it:
//   1. Palette Insert ("On its own line") with the caret on a blank line between paragraphs: the caret landed at
//      the END of the closing fence, and what was typed next was on the fence's line.
//   2. Backspace at the start of the line right under a block joined that line onto the fence: "```text...".
// Fixed 2026-10-03 (Mathslane-fix2): `insertMath` puts the caret on the line AFTER the block (templates.ts), and a
// block whose closing fence has anything after the backticks stays source, so every word is on the page (math.ts).
// Since text cells (2026-10-05) the block is a cell of its own, kept apart from its neighbours by blank lines: the
// caret lands on the blank line under it, and what is typed there is a new cell between the block and the next one.
// At the very end of the note there is no line under the block: the caret waits at the end of the closing fence with
// the bar up just under the block, and what is typed goes into a new cell below it (never onto the fence's line).
import { ok, finish, js, send, sleep, until, freshNote, setDoc, focus, shot, key, typeText, doc, lineTexts, clickEl, VIEW, CTRL } from "../../lib/harness.mjs"

const FENCE = "```"
await freshNote()
await focus()

const blocks = () => js(`document.querySelectorAll('.cm-content .wm-math-block').length`)
const head = () => js(`${VIEW}.state.selection.main.head`)
const lineOfCaret = () => js(`(() => { const v = ${VIEW}; const l = v.state.doc.lineAt(v.state.selection.main.head); return { text: l.text, col: v.state.selection.main.head - l.from } })()`)
const end = () => key("End", { ctrl: true })

// --- 1. The palette's Insert, caret on the blank line between two paragraphs --------------------------------------
const first = "first paragraph\n\nsecond paragraph"
await setDoc(first, "first paragraph\n".length)
await focus()
await sleep(200)
await clickEl('[data-math="button"]')
await sleep(350)
await clickEl('[data-insert="1"]')
await sleep(500)
let text = await doc()
ok("the block went in on its own lines, the paragraphs kept apart", text === `first paragraph\n\n${FENCE}wl\nIntegrate[x^2, {x, 0, 1}]\n${FENCE}\n\nsecond paragraph`, JSON.stringify(text))
ok("the freshly inserted block is typeset at once (the caret is not on the fence)", (await blocks()) === 1, `blocks=${await blocks()} caret=${await head()}`)
const where = await lineOfCaret()
ok("the caret is on the line after the block, not on the closing fence", where.text === "" && where.col === 0, JSON.stringify(where))
await typeText("and this follows the equation ")
await sleep(400)
text = await doc()
ok("what is typed next is on a line of its own after the block", text.endsWith(`${FENCE}\n\nand this follows the equation \n\nsecond paragraph`), JSON.stringify(text))
await end()
await sleep(400)
let lines = await lineTexts()
ok("the words typed after the insert are on the page", lines.some((t) => t.includes("and this follows the equation")), JSON.stringify(lines))
ok("...and the block is still typeset", (await blocks()) === 1)
await shot("block-after-insert")

// the same at the end of a line with more below it, and at the end of the document
const second = "alpha\nbeta"
await setDoc(second, "alpha".length)
await focus()
await clickEl('[data-math="button"]')
await sleep(350)
await clickEl('[data-insert="1"]')
await sleep(500)
ok("at the end of a line with more below: typeset at once, caret at the start of the next line",
  (await blocks()) === 1 && (await lineOfCaret()).text === "" && (await lineOfCaret()).col === 0, JSON.stringify(await lineOfCaret()))
text = await doc()
ok("...the block a cell of its own between the two lines", text === `alpha\n\n${FENCE}wl\nIntegrate[x^2, {x, 0, 1}]\n${FENCE}\n\nbeta`, JSON.stringify(text))
await setDoc("alpha", "alpha".length)
await focus()
await clickEl('[data-math="button"]')
await sleep(350)
await clickEl('[data-insert="1"]')
await sleep(500)
const barUnder = await js(`(() => {
  const block = document.querySelector('.cm-content .wm-math-block')?.getBoundingClientRect()
  return !!block && [...document.querySelectorAll('.wm-bar')].some((b) => { const t = b.getBoundingClientRect().top; return t >= block.bottom - 4 && t <= block.bottom + 30 })
})()`)
const last = await lineOfCaret()
ok("at the end of the note: typeset at once, caret at the end of the closing fence, the bar up just under the block",
  (await blocks()) === 1 && last.text === FENCE && last.col === 3 && barUnder, JSON.stringify({ ...last, barUnder }))
await typeText("tail")
await sleep(300)
lines = await lineTexts()
ok("...and what is typed there is on the page", lines.includes("tail"), JSON.stringify(lines))

// --- 2. Backspace at the start of the line under a typeset block --------------------------------------------------
const under = `intro\n\n${FENCE}wl\nSum[1/n^2, {n, 1, Infinity}]\n${FENCE}\ntext right under the equation\n\nend`
const at = under.indexOf("text right under")
await setDoc(under, at)
await focus()
await sleep(300)
ok("before: the block is typeset and the line under it is plain text", (await blocks()) === 1 && (await lineTexts()).includes("text right under the equation"))
await key("Backspace")
await sleep(300)
text = await doc()
ok("Backspace joined the line onto the closing fence (the file keeps the words)", text.includes(`${FENCE}text right under the equation`), JSON.stringify(text))
await js(`${VIEW}.dispatch({ selection: { anchor: ${VIEW}.state.doc.length } })`)
await sleep(400)
lines = await lineTexts()
ok("with the caret away, the joined words are STILL ON THE PAGE", lines.some((t) => t.includes("text right under the equation")), JSON.stringify(lines))
ok("...the block stays as source rather than hiding them", (await blocks()) === 0 && lines.some((t) => t.includes("Sum[1/n^2")), JSON.stringify(lines))
await shot("block-after-backspace")
// Put the line break back: the words are no longer on the fence line, and the block is typeset again.
await js(`${VIEW}.dispatch({ selection: { anchor: ${at - 1} } })`)
await focus()
await key("Enter")
await sleep(200)
await js(`${VIEW}.dispatch({ selection: { anchor: ${VIEW}.state.doc.length } })`)
await sleep(400)
ok("Enter again puts the words back on their own line and the block is typeset again",
  (await blocks()) === 1 && (await lineTexts()).includes("text right under the equation"), JSON.stringify(await lineTexts()))

// --- 3. Anything after the backticks of the closing fence, and what does not count ------------------------------------
const cases = [
  ["words after the fence", `${FENCE}wl\nPi\n${FENCE} and then words\n\nz`, 0, true],
  ["a fourth backtick", `${FENCE}wl\nPi\n${FENCE}\`\n\nz`, 0, true],
  ["only spaces after the fence", `${FENCE}wl\nPi\n${FENCE}   \n\nz`, 0, false],
  ["nothing after the fence", `${FENCE}wl\nPi\n${FENCE}\n\nz`, 0, false],
  ["an indented fence", `- item\n  ${FENCE}wl\n  Pi\n  ${FENCE}\n\nz`, 0, false],
]
for (const [name, source, , hidesNothing] of cases) {
  await setDoc(source, source.length)
  await js(`${VIEW}.dispatch({ selection: { anchor: ${source.length} } })`)
  await sleep(450)
  const shown = await lineTexts()
  const typeset = (await blocks()) === 1
  // every visible character of the file is on the page, OR the block is typeset (and then the closing fence line has nothing to lose)
  const everyWordVisible = !/ and then words/.test(source) || shown.some((t) => t.includes("and then words"))
  ok(`${name}: ${hidesNothing ? "source stays, every word visible" : "typeset"}`, hidesNothing ? !typeset && everyWordVisible : typeset, JSON.stringify({ typeset, shown }))
}

// --- 4. The old behaviour that must not change ----------------------------------------------------------------------
const plain = `before\n\n${FENCE}wl\nSqrt[x^2 + 1]\n${FENCE}\n\nafter`
await setDoc(plain, plain.length)
await js(`${VIEW}.dispatch({ selection: { anchor: ${plain.length} } })`)
await sleep(400)
ok("an ordinary block is typeset with the caret away", (await blocks()) === 1)
await js(`${VIEW}.dispatch({ selection: { anchor: ${plain.indexOf("Sqrt") + 3} } })`)
await sleep(300)
ok("...and is source with the caret inside it", (await blocks()) === 0)
finish()
