// What a reader sees for the two misreadings the verifier found (Mathslane-v2-0), in the real page, inline and as a block:
//  - Function application written with round brackets was read as a product and the brackets were dropped: f(2) = 4
//    showed as `f·2 = 4`, y(0) = 1 as `y·0 = 1`, f(x) = 2x as `f x = 2x`.
//  - A power of a call that is drawn as a script row, a product or a log was not bracketed: Exp[x]^2 drew `e` with a
//    raised x and a 2 beside it (reads as e^(x²)), Dot[a,b]^2 as `a·b²`, Log[2,x]^2 as `log₂x²`.
// Fixed 2026-10-03 (Mathslane-fix2): packages/core/src/math/{expression,mathml,typesetter}.ts; unit tests in mathFix2.test.ts.
import { ok, finish, js, sleep, until, freshNote, setDoc, focus, shot, VIEW } from "../../lib/harness.mjs"

const BT = "`", FENCE = BT.repeat(3)
await freshNote()
await focus()

const inlineSources = ["f(2) = 4", "y(0) = 1", "f(x) = 2x", "sin(x) + f(x+1)", "Exp[x]^2", "Dot[a, b]^2", "Log[2, x]^2", "f(x)^2", "2*3 = 6", "3(2)"]
const blockSources = ["f(2) = 4", "y(0) = 1", "f(x) = 2x", "Exp[x]^2", "Dot[a, b]^2", "Log[2, x]^2", "Sin[x]^2", "Factorial[x^2]"]
const doc = [
  ...inlineSources.map((s, i) => `Line ${i} ${BT}wl:${s}${BT} end`),
  "",
  ...blockSources.flatMap((s) => [FENCE + "wl", s, FENCE, ""]),
  "last",
].join("\n")
await setDoc(doc, doc.length)
await js(`${VIEW}.dispatch({ selection: { anchor: ${doc.length} } })`)
await until(async () => (await js(`document.querySelectorAll('.wm-math-inline').length`)) === inlineSources.length
  && (await js(`document.querySelectorAll('.wm-math-block').length`)) === blockSources.length, 6000)
await sleep(400)

// What a reader sees: every character drawn, the invisible operators and the spaces left out.
const seen = (selector, wl) => js(`(() => {
  const e = [...document.querySelectorAll(${JSON.stringify(selector)})].find((x) => x.dataset.wl === ${JSON.stringify(wl)})
  return e ? e.textContent.replace(/[\\s\\u2061\\u2062\\u2009]/g, '') : null
})()`)
const INLINE = ".wm-math-inline", BLOCK = ".wm-math-block .wm-math"

for (const [selector, label, sources] of [[INLINE, "inline", inlineSources], [BLOCK, "block", blockSources]]) {
  for (const [wl, want] of [["f(2) = 4", "f(2)=4"], ["y(0) = 1", "y(0)=1"], ["f(x) = 2x", "f(x)=2x"]]) {
    if (!sources.includes(wl)) continue
    const got = await seen(selector, wl)
    ok(`${label}: ${wl} keeps its brackets and has no dot (reads ${want})`, got === want, String(got))
  }
}
ok("inline: sin(x) + f(x+1) keeps both pairs of brackets", (await seen(INLINE, "sin(x) + f(x+1)")) === "sin(x)+f(x+1)", String(await seen(INLINE, "sin(x) + f(x+1)")))
ok("inline: 3(2) keeps its brackets and takes no dot", (await seen(INLINE, "3(2)")) === "3(2)", String(await seen(INLINE, "3(2)")))
ok("inline: 2*3 is still drawn with a dot", (await seen(INLINE, "2*3 = 6")) === "2·3=6", String(await seen(INLINE, "2*3 = 6")))
ok("inline: f(x)^2 keeps its brackets and its exponent", (await seen(INLINE, "f(x)^2")) === "f(x)2", String(await seen(INLINE, "f(x)^2")))

// Powers: the base is bracketed, so the exponent belongs to ALL of it.
for (const [wl, want] of [["Exp[x]^2", "(ex)2"], ["Dot[a, b]^2", "(a·b)2"]]) {
  ok(`inline: ${wl} is bracketed (reads ${want})`, (await seen(INLINE, wl)) === want, String(await seen(INLINE, wl)))
}
ok("inline: Log[2, x]^2 is bracketed", (await seen(INLINE, "Log[2, x]^2")) === "(log2x)2", String(await seen(INLINE, "Log[2, x]^2")))
// A block: the base of the msup is a fenced row starting with "(" and ending with ")".
const baseOf = (wl) => js(`(() => {
  const e = [...document.querySelectorAll('.wm-math-block .wm-math')].find((x) => x.dataset.wl === ${JSON.stringify(wl)})
  const sup = e && e.querySelector('math > msup, math > mrow > msup')
  const base = sup && sup.firstElementChild
  return base ? { tag: base.tagName.toLowerCase(), first: base.firstElementChild?.textContent, last: base.lastElementChild?.textContent } : null
})()`)
for (const wl of ["Exp[x]^2", "Dot[a, b]^2", "Log[2, x]^2"]) {
  const b = await baseOf(wl)
  ok(`block: the base of ${wl} is in brackets`, b && b.tag === "mrow" && b.first === "(" && b.last === ")", JSON.stringify(b))
}
const sin = await baseOf("Sin[x]^2")
ok("block: sin(x)^2 is one name applied to (x), not wrapped twice", sin && sin.tag === "mrow" && sin.first === "sin", JSON.stringify(sin))
ok("block: (x²)! has its brackets", (await seen(BLOCK, "Factorial[x^2]")) === "(x2)!", String(await seen(BLOCK, "Factorial[x^2]")))

// The note is what was typed: the brackets and the fixes are a matter of how it is drawn.
ok("the note's text is what was typed", (await js(`${VIEW}.state.doc.toString()`)) === doc)
await shot("brackets-and-powers")
finish()
