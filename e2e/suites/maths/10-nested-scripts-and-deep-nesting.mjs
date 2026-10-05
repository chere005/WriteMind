// Two defects of the LINEAR typesetter, which sets every inline `wl:` span (found by independent verifiers, 2026-10-04):
//  1. Scripts were flattened: a power inside a power or a subscript lost its own level, so `wl:Exp[-x^2]` drew e with
//     one raised "-x2", `wl:x^y^z` drew x^(yz), and the palette's own Gaussian (Integrate[Exp[-x^2], {x, -Infinity,
//     Infinity}]) read as the integral of e^(-x2). The block form (MathML) was right, so the two disagreed.
//  2. Time was exponential in nesting depth (standsAlone drew the arguments of a call to learn whether it is special,
//     and powerBase drew them again): a 21-deep `wl:Factorial[Factorial[...]]` took 0.9 s to insert and 0.4 s on EVERY
//     caret move, and 30 deep never finished -- a short pasted span could freeze the renderer every time the note was
//     opened.
// Fixed 2026-10-04 (Mathslane-fix1): `mathScript` and `specialForm` in packages/core/src/math/typesetter.ts.
import { ok, finish, js, sleep, until, freshNote, setDoc, focus, shot, VIEW } from "../../lib/harness.mjs"

const BT = "`"
await freshNote()
await focus()

const sources = ["Exp[-x^2]", "x^y^z", "Exp[x^2]", "Subscript[x, n^2]", "Integrate[Exp[-x^2], {x, -Infinity, Infinity}]", "x^2"]
const doc = ["Scripts in scripts:", "", ...sources.map((s, i) => `- line ${i} ${BT}wl:${s}${BT} end`), "", "the end", ""].join("\n")
await setDoc(doc, doc.length)
await until(async () => (await js(`document.querySelectorAll('.cm-line .wm-math-inline').length`)) === sources.length, 6000)
await sleep(400)

// What the page draws for one equation: its pieces with their size, their lift and their style.
const pieces = (wl) => js(`(() => {
  const e = [...document.querySelectorAll('.cm-line .wm-math-inline')].find((x) => x.dataset.wl === ${JSON.stringify(wl)})
  return e ? [...e.children].map((c) => ({ text: c.textContent, size: c.style.fontSize || '1em', top: c.style.top || '0', italic: c.style.fontStyle === 'italic' })) : null
})()`)
const levels = (list) => new Set(list.map((p) => `${p.size}/${p.top}`)).size

let p = await pieces("Exp[-x^2]")
ok("Exp[-x^2] reads e, minus x, squared", p && p.map((x) => x.text).join("") === "e−x2", JSON.stringify(p))
ok("...at three levels: the e, the exponent, the exponent's exponent", p && levels(p) === 3, JSON.stringify(p))
ok("...and the x in the exponent is still a variable (italic)", p && p.some((x) => x.text === "x" && x.italic), JSON.stringify(p))
p = await pieces("x^y^z")
ok("x^y^z has three levels, each smaller than the one before", p && levels(p) === 3 && parseFloat(p[2].size) < parseFloat(p[1].size) && parseFloat(p[1].size) < 1, JSON.stringify(p))
p = await pieces("Exp[x^2]")
ok("Exp[x^2] is not e^(x2): the 2 is a level above the x", p && levels(p) === 3, JSON.stringify(p))
p = await pieces("Subscript[x, n^2]")
ok("Subscript[x, n^2]: the 2 is a level of its own", p && levels(p) === 3, JSON.stringify(p))
p = await pieces("Integrate[Exp[-x^2], {x, -Infinity, Infinity}]")
ok("the Gaussian: the 2 is smaller than the x it is the power of, and higher", p && (() => {
  const x = p.find((q) => q.text === "x" && q.top !== "0"), two = p.find((q) => q.text === "2")
  return x && two && parseFloat(two.size) < parseFloat(x.size)
})(), JSON.stringify(p))
p = await pieces("x^2")
ok("a plain power is as it was: the 2 raised at 0.7", p && p.length === 2 && p[1].size === "0.7em", JSON.stringify(p))
await shot("maths-nested-scripts")

// ---- depth: nothing the user can type makes the renderer wait
const nest = (k, open, close, inner = "x") => { let s = inner; for (let i = 0; i < k; i++) s = open + s + close; return s }
const deep = [nest(30, "Factorial[", "]", "n"), nest(40, "Exp[", "]^2"), nest(40, "Sqrt[", "]^2"), nest(40, "Abs[", "]^2"), nest(40, "Subscript[", ", i]^2")]
const text2 = deep.map((s, i) => `Line ${i} ${BT}wl:${s}${BT} end`).join("\n\n") + "\n\ntail\n"
const t0 = Date.now()
const timings = await js(`(() => {
  const v = ${VIEW}
  const t = performance.now()
  v.dispatch({ changes: { from: 0, to: v.state.doc.length, insert: ${JSON.stringify(text2)} }, selection: { anchor: v.state.doc.length } })
  const inserted = performance.now() - t
  const moves = []
  for (const at of [0, 10, 200, v.state.doc.length]) { const s = performance.now(); v.dispatch({ selection: { anchor: at } }); moves.push(performance.now() - s) }
  return { inserted, moves }
})()`)
ok(`${deep.length} spans nested 30 to 40 deep are inserted at once (${Math.round(timings.inserted)} ms)`, timings.inserted < 500, JSON.stringify(timings))
ok(`...and a caret move costs nothing (${timings.moves.map(Math.round).join(", ")} ms)`, Math.max(...timings.moves) < 200, JSON.stringify(timings))
ok("the page answered (the renderer did not hang)", Date.now() - t0 < 10000)
await until(async () => (await js(`document.querySelectorAll('.cm-line .wm-math-inline').length`)) >= 1, 4000)
ok("and the deep spans are typeset", (await js(`document.querySelectorAll('.cm-line .wm-math-inline').length`)) === deep.length, String(await js(`document.querySelectorAll('.cm-line .wm-math-inline').length`)))
await shot("maths-deep-nesting")

finish()
