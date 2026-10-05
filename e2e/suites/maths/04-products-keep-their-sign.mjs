// A product keeps the sign it was written with. The handwriting reader (and a keyboard) hands over `3 × 4 = 12` and
// `2 · 3`; they are read as products but used to be DRAWN as invisible times, so `3 × 4 = 12` showed as `3 4 = 12`,
// which reads as thirty-four. Now the written sign stays, and a number that follows a factor always has a visible
// sign (`2*3` is `2·3`). Letters and brackets side by side stay side by side (`2x`, `2(x + 1)`).
// Fixed 2026-10-03 (Mathslane-fix1): packages/core/src/math/{expression,mathml}.ts; unit tests in mathml.test.ts.
import { ok, finish, js, sleep, until, freshNote, setDoc, focus, shot } from "../../lib/harness.mjs"

const BT = "`", FENCE = BT.repeat(3)
await freshNote()
await focus()

const sources = ["3 × 4 = 12", "x = 2 × 3 + 1", "2*3", "a · b", "2 x", "2*(x + 1)", "x*2"]
const doc = sources.map((s) => `Line ${BT}wl:${s}${BT} end`).join("\n\n") + `\n\n${FENCE}wl\n5 × 6 = 30\n${FENCE}\n\nfinish`
await setDoc(doc, doc.length)
await until(async () => (await js(`document.querySelectorAll('.wm-math-inline').length`)) === sources.length, 5000)
await sleep(400)

const shown = (wl) => js(`(() => {
  const e = [...document.querySelectorAll('.wm-math-inline, .wm-math-block .wm-math')].find((x) => x.dataset.wl === ${JSON.stringify(wl)})
  if (!e) return null
  // What a reader sees: every character that is drawn, the invisible operators and spaces left out.
  return e.textContent.replace(/[\\s\\u2061\\u2062\\u2009]/g, '')
})()`)

ok("3 × 4 = 12 is drawn with its ×, not as '3 4 = 12'", (await shown("3 × 4 = 12")) === "3×4=12", String(await shown("3 × 4 = 12")))
ok("x = 2 × 3 + 1 keeps its ×", (await shown("x = 2 × 3 + 1")) === "x=2×3+1", String(await shown("x = 2 × 3 + 1")))
ok("a written · stays", (await shown("a · b")) === "a·b", String(await shown("a · b")))
ok("2*3 is drawn 2·3, not as 23", (await shown("2*3")) === "2·3", String(await shown("2*3")))
ok("x*2 is drawn x·2", (await shown("x*2")) === "x·2", String(await shown("x*2")))
ok("2 x stays side by side", (await shown("2 x")) === "2x", String(await shown("2 x")))
ok("2*(x + 1) stays side by side", (await shown("2*(x + 1)")) === "2(x+1)", String(await shown("2*(x + 1)")))
ok("a block fence keeps its × too", (await shown("5 × 6 = 30")) === "5×6=30", String(await shown("5 × 6 = 30")))

// The source is untouched: the note still holds exactly what was typed.
const text = await js(`document.querySelector('.cm-content').cmTile.view.state.doc.toString()`)
ok("the note's text is what was typed (the sign is a matter of drawing)", text === doc)
await shot("products")
finish()
