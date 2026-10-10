// (a) Every way a cell (or an object) is made leaves the caret in the right place and is ONE undo step (docs/PLAN-bars-2026-10.md P7):
// the keys, the menu bar's commands and the + menu are in cells/10 and the editor suites; this holds the inserts of the Insert group:
// the Maths palette (a block at a bar, in a cell, at its end; inline) and the Text box (an object on the page: the words and the
// caret are not touched, and its own Ctrl+Z takes only the box). Markdown side and rendered page; the real mouse and keys.
import { ok, test, finish, js, sleep, freshNote, setDoc, doc, sel, key, click, focus, setSel, lineBoxes, setRendered, clickEl, menuClick, canvasBox, saved, dragPath, line, typeText, armed } from "../../lib/harness.mjs"

const file = await freshNote()
const D0 = "Alpha\n\nBeta words"
const INTEGRAL = "Integrate[x^2, {x, 0, 1}]"

async function palette(own) {
  await clickEl('[data-math="button"]'); await sleep(300)
  await clickEl('[data-template="integrate.definite"]'); await sleep(250)
  if (!own) await js(`document.querySelector('[data-own]').click()`)
  await clickEl('[data-insert="1"]'); await sleep(400)
}

for (const rendered of [false, true]) {
  const side = rendered ? "rendered page" : "markdown side"
  await setRendered(rendered)

  const WHERE = {
    "at a bar": async () => { const l = await lineBoxes(); await click(700, Math.round((l[0][1] + l[1][0]) / 2)); await sleep(150) },
    "in the middle of a cell": async () => setSel(D0.indexOf("words")),
    "at the end of the note": async () => setSel(D0.length),
  }
  for (const [where, put] of Object.entries(WHERE)) {
    for (const own of [true, false]) {
      await test(`${side}: the Maths palette, ${own ? "on its own line" : "inline"}, ${where}: the maths is in, the caret after it, one undo step`, async () => {
        await setDoc(D0, 0); await focus(); await sleep(250)
        await put()
        await palette(own)
        const d = await doc()
        ok("the source is in the note", d.includes(INTEGRAL), JSON.stringify(d))
        ok(own ? "as a maths cell of its own (a ```wl fence)" : "as inline maths (a `wl:` span)", own ? /```wl\n/.test(d) : d.includes("`wl:" + INTEGRAL + "`"), JSON.stringify(d))
        ok("the palette is closed and the keyboard is in the notes", (await js(`!document.querySelector('.math-pop')`)) && (await js(`document.activeElement?.closest('.cm-content') !== null`)))
        const at = (await sel())[0]
        ok("the caret is after what was written (not before it, not on top of the old words)", at > (d.indexOf(INTEGRAL) + INTEGRAL.length - 1) - 1, JSON.stringify([at, d.length]))
        await key("z", { ctrl: true }); await sleep(250)
        ok("ONE Ctrl+Z takes the whole insert back", (await doc()) === D0, JSON.stringify(await doc()))
      })
    }
  }
}

await test("the rendered page: a Text box is an object on the page: the words and the caret are not touched, one Ctrl+Z takes only the box", async () => {
  await setRendered(true)
  await setDoc(D0, 0); await focus(); await sleep(300)
  await setSel(D0.indexOf("words")); await sleep(100)
  await menuClick("insertTextBox"); await sleep(300)
  ok("the caret did not move for arming it", (await sel())[0] === D0.indexOf("words"), JSON.stringify(await sel()))
  const cb = await canvasBox()
  await dragPath(line([cb.x + 300, cb.y + 300], [cb.x + 560, cb.y + 330], 10)); await sleep(300)
  ok("a drag opens its editor", await js(`!!document.querySelector('.wm-textbox-edit')`))
  await typeText("A box of words"); await sleep(200)
  await click(cb.x + 900, cb.y + 600); await sleep(500)
  ok("the note's words were not touched", (await doc()) === D0, JSON.stringify(await doc()))
  const items = (await saved(file, (d) => d.items.some((i) => i.shapeKind === "text"))).items
  ok("the box is on the page's drawing", items.some((i) => i.kind === "shape" && i.shapeKind === "text" && i.label.includes("A box of words")), JSON.stringify(items.map((i) => [i.kind, i.shapeKind])))
  await js(`document.querySelector('.cm-content').cmTile.view.focus()`)
  await key("z", { ctrl: true }); await sleep(500)
  const after = (await saved(file, () => true)).items
  ok("one Ctrl+Z takes the box away", !after.some((i) => i.shapeKind === "text"), JSON.stringify(after.map((i) => [i.kind, i.shapeKind])))
  ok("and the note's words are still as they were", (await doc()) === D0, JSON.stringify(await doc()))
})
finish()
