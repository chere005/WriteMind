// No maths typeset in a TEXT cell, anywhere (Sean, 2026-10-05: "math shouldn't be typeset in non-markdown mode";
// docs/PLAN-text-cells.md, docs/TODO.md). A text cell (a paragraph with no `<!-- markdown -->` marker) shows `wl:`
// and its backticks as typed: in the source pane (also when the maths is TYPED there with real keys), on the rendered
// page and in the sidebar's row. Its neighbours keep typesetting: a marked markdown cell, an older note's paragraph
// with unescaped `wl:` maths (the older-notes rule) and a ```wl maths cell. The paper, the copy and the snippet's rule
// are pinned by packages/core/test/textCellMaths.test.ts, the source pane's by packages/editor/test/mathInline.test.ts.
import { ok, finish, js, sleep, until, freshNote, setDoc, setSel, focus, shot, setRendered, insertText, VIEW } from "../../lib/harness.mjs"

const BT = "`"
const file = await freshNote()
await focus()
await setRendered(false)

// What the escape rule writes for words typed into a text cell (the opening backtick escaped).
const plainOne = `Plain words ${BT}wl:x^2${BT} stay as typed`
const plainTwo = `second line ${BT}wl:Sqrt[y]${BT} too`
const doc = [
  `Plain words \\${BT}wl:x^2${BT} stay as typed`,
  `second line \\${BT}wl:Sqrt[y]${BT} too`,
  "",
  "<!-- markdown -->",
  `Marked ${BT}wl:a+b${BT} typesets`,
  "",
  `Older ${BT}wl:c-d${BT} typesets`,
  "",
  `${BT}${BT}${BT}wl`,
  "x^3",
  `${BT}${BT}${BT}`,
  "",
  "the end ",
].join("\n")
await setDoc(doc, doc.length)

// ---- the source pane, with maths TYPED into the last text cell with real keys (CDP Input.insertText)
await insertText(`${BT}wl:z^3${BT}`)
await sleep(300)
const typedLine = `the end ${BT}wl:z^3${BT}`
const written = await js(`${VIEW}.state.doc.toString()`)
ok("maths typed into a text cell is written with the escape rule (the file says it is words)", written.endsWith(`the end \\${BT}wl:z^3${BT}`), JSON.stringify(written.slice(-30)))
// Move the caret off the typed line, into the marked cell's words, so nothing is shown as source for the caret's sake.
await setSel(written.indexOf("Marked"))
await sleep(400)
const sourceLines = () => js(`JSON.stringify([...${VIEW}.contentDOM.querySelectorAll('.cm-line')].map((l) => ({ text: l.textContent, maths: l.querySelectorAll('.wm-math').length })))`)
let lines = JSON.parse(await sourceLines())
for (const want of [plainOne, plainTwo, typedLine]) {
  const line = lines.find((l) => l.text === want)
  ok(`source pane: the text cell's line reads as typed, nothing typeset: ${want}`, !!line && line.maths === 0, JSON.stringify(lines.filter((l) => l.text.includes("wl:") || l.maths)))
}
const inlineHere = await js(`${VIEW}.contentDOM.querySelectorAll('.wm-math-inline').length`)
ok("source pane: the markdown cell and the older note's paragraph still typeset (2 inline equations)", inlineHere === 2, String(inlineHere))
ok("source pane: the ```wl maths cell is typeset", (await js(`${VIEW}.contentDOM.querySelectorAll('.wm-math-block .wm-math').length`)) === 1)
await shot("source-pane")

// ---- the rendered page (the caret stays in the marked cell: that cell is open, every other one is drawn)
await setRendered(true)
await until(async () => (await js(`document.querySelectorAll('.wm-pv-text').length`)) >= 2, 5000, 100)
await sleep(300)
const drawn = JSON.parse(await js(`JSON.stringify([...document.querySelectorAll('.wm-pv-text')].map((e) => ({ text: e.innerText, maths: e.querySelectorAll('.wm-math').length })))`))
ok("rendered page: the two text cells are drawn as text cells", drawn.length === 2, JSON.stringify(drawn))
ok("rendered page: the first text cell shows its maths as typed, line for line", drawn.some((d) => d.text === `${plainOne}\n${plainTwo}` && d.maths === 0), JSON.stringify(drawn))
ok("rendered page: the typed one too", drawn.some((d) => d.text.trim() === typedLine && d.maths === 0), JSON.stringify(drawn))
ok("rendered page: no maths anywhere inside a text cell", drawn.every((d) => d.maths === 0), JSON.stringify(drawn))
const olderDrawn = await js(`[...document.querySelectorAll('.wm-pv-p:not(.wm-pv-text)')].filter((e) => e.textContent.startsWith('Older')).map((e) => e.querySelectorAll('.wm-math-inline').length)`)
ok("rendered page: the older note's paragraph (unescaped wl:, no marker) still typesets", JSON.stringify(olderDrawn) === "[1]", JSON.stringify(olderDrawn))
ok("rendered page: the marked cell (open, the caret is in it) still typesets", (await js(`${VIEW}.contentDOM.querySelectorAll('.cm-line .wm-math-inline').length`)) === 1)
const blockMaths = await js(`JSON.stringify({ typeset: document.querySelectorAll('.wm-math-block .wm-math').length, asCode: [...document.querySelectorAll('.wm-pv-code')].filter((e) => e.textContent.includes('x^3')).length })`)
ok("rendered page: the ```wl maths cell is typeset (not drawn as code)", /"typeset":[1-9].*"asCode":0/.test(blockMaths), blockMaths)
await shot("rendered-page")

// ---- the sidebar's row: the first two lines of the note are the text cell's, backticks and all
const snippet = () => js(`(() => { const r = [...document.querySelectorAll('.note-row')].find((x) => x.dataset.path === ${JSON.stringify(file)}); return r?.querySelector('.snippet')?.textContent ?? null })()`)
const wantSnippet = `${plainOne} · ${plainTwo}`
await until(async () => (await snippet()) === wantSnippet, 8000, 200)
ok("the sidebar's snippet shows the text cell's maths as typed", (await snippet()) === wantSnippet, String(await snippet()))

await setRendered(false)
finish()
