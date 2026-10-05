// Inline maths is a linear run of text, so it can never collide with the lines above and below it. A first port set
// inline maths in two dimensions, as an inline-block with negative vertical margins: in consecutive bullets, quote
// lines or a wrapped paragraph, a stacked fraction / derivative / matrix was drawn at full height inside a 21.8px line
// and overlapped its neighbours by up to 12px (the denominator of df/dx ran through the next bullet), and the lower
// half of the box took the clicks meant for the line below (the caret went into the WRONG equation's source).
// Fixed 2026-10-03 (Mathslane-fix2): `mathElement(…, {display:"inline"})` is the Mac's linear run (`inlineSpans`);
// block maths stays MathML. Also checked on the rendered page.
import { ok, finish, js, sleep, until, freshNote, setDoc, focus, shot, click, setRendered, VIEW } from "../../lib/harness.mjs"

const BT = "`"
await freshNote()
await focus()

// Tall in two dimensions: all of these used to stack or hang below the baseline.
const tall = [
  "D[f, x]", "(a + b)/2", "Sin[x]/x", "Limit[1/x, x -> 0]", "{{a, b}, {c, d}}", "Binomial[n, k]",
  "Sum[1/n^2, {n, 1, Infinity}]", "Integrate[x^2, {x, 0, 1}]", "Sqrt[x^2 + 1]", "Dt[f, t]", "D[f, {x, 2}]",
]
const bullets = tall.map((wl, i) => `- item ${i} ${BT}wl:${wl}${BT} after`).join("\n")
const quotes = tall.slice(0, 5).map((wl, i) => `> quote ${i} ${BT}wl:${wl}${BT} after`).join("\n")
const doc = [`Heading line`, "", bullets, "", quotes, "", "a plain line", "", "the end"].join("\n")

const probe = () => js(`(() => {
  const c = ${VIEW}.contentDOM
  const lines = [...c.querySelectorAll('.cm-line')].map((l) => ({ text: l.textContent, r: l.getBoundingClientRect() }))
  const plain = lines.find((l) => l.text === 'a plain line')
  const inl = [...c.querySelectorAll('.wm-math-inline')].map((e) => {
    const rects = [...e.getClientRects()].map((r) => ({ top: r.top, bottom: r.bottom, left: r.left, right: r.right }))
    const line = e.closest('.cm-line').getBoundingClientRect()
    const cs = getComputedStyle(e)
    return { wl: e.dataset.wl, rects, line: { top: line.top, bottom: line.bottom, h: line.height }, display: cs.display,
      hasMathml: !!e.querySelector('math'), spans: e.children.length, scrollBox: cs.overflowX !== 'visible' }
  })
  return { plainH: plain ? plain.r.height : null, inl, scrollerOverflow: ${VIEW}.scrollDOM.scrollWidth > ${VIEW}.scrollDOM.clientWidth }
})()`)

async function check(label) {
  const m = await probe()
  const bad = m.inl.filter((e) => e.rects.some((r) => r.top < e.line.top - 1 || r.bottom > e.line.bottom + 1))
  ok(`${label}: ${m.inl.length} inline equations, all typeset`, m.inl.length === tall.length + 5, JSON.stringify(m.inl.map((e) => e.wl)))
  ok(`${label}: none is drawn as MathML, a box or a scroll box -- it is text`, m.inl.every((e) => !e.hasMathml && !e.scrollBox && e.display === "inline" && e.spans > 0), JSON.stringify(m.inl.filter((e) => e.hasMathml || e.scrollBox || e.display !== "inline").map((e) => e.wl)))
  ok(`${label}: every equation lies inside its own line (no overlap with the lines above and below)`, bad.length === 0,
    JSON.stringify(bad.map((e) => ({ wl: e.wl, rects: e.rects.map((r) => [Math.round(r.top), Math.round(r.bottom)]), line: [Math.round(e.line.top), Math.round(e.line.bottom)] }))))
  return m
}

await setDoc(doc, doc.length)
await js(`${VIEW}.dispatch({ selection: { anchor: ${doc.length} } })`)
await until(async () => (await js(`document.querySelectorAll('.wm-math-inline').length`)) === tall.length + 5, 6000)
await sleep(500)
const m = await check("in the notebook")
// the lines of a list / quote that hold tall maths are no taller than a plain line (the maths does not push them apart)
const lineH = await js(`[...${VIEW}.contentDOM.querySelectorAll('.cm-line')].filter((l) => l.querySelector('.wm-math-inline')).map((l) => Math.round(l.getBoundingClientRect().height * 10) / 10)`)
const tallest = Math.max(...lineH), shortest = Math.min(...lineH)
ok("lines with maths in them are all about as tall as each other (the maths never made a line taller)", tallest - shortest < 6, JSON.stringify(lineH))
ok("...and no taller than 1.5 text lines even with an integral sign and a sum in them", tallest <= m.plainH * 1.5, JSON.stringify({ tallest, plain: m.plainH }))
await shot("inline-linear-light-or-dark")

// What is on the page: the linear run reads as the maths.
const shown = (wl) => js(`(() => { const e = [...document.querySelectorAll('.wm-math-inline')].find((x) => x.dataset.wl === ${JSON.stringify(wl)}); return e ? e.textContent.replace(/\\s+/g, ' ').trim() : null })()`)
ok("a derivative reads as a derivative", /∂f\/∂x/.test(String(await shown("D[f, x]"))), String(await shown("D[f, x]")))
ok("a fraction reads as a fraction", /\(a \+ b\)\/2/.test(String(await shown("(a + b)/2"))), String(await shown("(a + b)/2")))
ok("a definite integral has its sign and bounds", /^∫01 x2 dx$/.test(String(await shown("Integrate[x^2, {x, 0, 1}]"))), String(await shown("Integrate[x^2, {x, 0, 1}]")))
ok("a matrix is written out in braces", /\{\{a, b\}, \{c, d\}\}/.test(String(await shown("{{a, b}, {c, d}}"))), String(await shown("{{a, b}, {c, d}}")))

// Clicks. A press on an equation puts the caret in THAT equation's own source (the nearer end). The old box was
// taller than its line, so its lower half took the clicks meant for the line below it (clicktest.mjs of the
// verifier: y at 90% of the box gave the caret of the next bullet's Sum). Two checks: (1) every point of the
// equation's own line that the page says is the equation opens THAT equation, at the nearer end; (2) a point on the
// line above and on the line below, at the equation's own x, is not the equation.
const spans = tall.map((wl) => {
  const start = doc.indexOf(BT + "wl:" + wl + BT)
  return { wl, start, end: start + wl.length + 5 }
})
const caret = () => js(`${VIEW}.state.selection.main.head`)
const restore = async () => {
  await setDoc(doc, doc.length)
  await js(`${VIEW}.dispatch({ selection: { anchor: ${doc.length} } })`)
  await sleep(150)
}
const pointOn = (wl, fx, fy) => js(`(() => { const e = [...document.querySelectorAll('.wm-math-inline')].find((x) => x.dataset.wl === ${JSON.stringify(wl)})
  if (!e) return null; e.scrollIntoView({ block: 'center' })
  const r = e.getBoundingClientRect(), l = e.closest('.cm-line').getBoundingClientRect()
  const mine = (x, y) => { const t = document.elementFromPoint(x, y); return !!t && t.closest('.wm-math-inline') === e }
  const x = r.left + r.width * ${fx}, y = l.top + l.height * ${fy}, cx = r.left + r.width / 2
  return { x, y, mine: mine(x, y), above: mine(cx, l.top - 5), below: mine(cx, l.bottom + 5), belowLow: mine(cx, l.bottom + 12) } })()`)
const wrongClicks = [], stolen = [], thin = []
for (const s of spans) {
  let hits = 0
  for (const fx of [0.1, 0.3, 0.5, 0.7, 0.9]) {
    for (const fy of [0.15, 0.5, 0.85]) {
      await restore()
      const p = await pointOn(s.wl, fx, fy)
      if (!p) { wrongClicks.push(s.wl + " missing"); continue }
      if (p.above || p.below || p.belowLow) stolen.push(s.wl + JSON.stringify([p.above, p.below, p.belowLow]))
      if (!p.mine) continue
      hits++
      await click(p.x, p.y)
      await sleep(100)
      const head = await caret()
      const lateHalf = fx > 0.5, earlyHalf = fx < 0.5
      const wrong = !(head > s.start && head < s.end) || (lateHalf && head < s.end - 2) || (earlyHalf && head > s.start + 5)
      if (wrong) wrongClicks.push(`${s.wl} @${fx},${fy} -> ${head} (wanted ${lateHalf ? "end" : earlyHalf ? "start" : "either end"} of ${s.start}..${s.end})`)
    }
  }
  if (hits < 3) thin.push(`${s.wl}: ${hits}`)
}
ok("an equation never reaches into the lines above and below it (a point there is not the equation)", stolen.length === 0, stolen.slice(0, 5).join(" | "))
ok("every equation can be pressed (at least three points of its line are the equation)", thin.length === 0, thin.join(" | "))
ok("a press on any part of any equation puts the caret in that equation's own source (nearer end)", wrongClicks.length === 0, wrongClicks.slice(0, 6).join(" | "))

// A long inline equation wraps like words: no scroll box, no sideways scroll, every fragment inside the line.
const long = Array.from({ length: 30 }, (_, i) => `a${i}*x^${i}`).join(" + ")
const longDoc = `Before ${BT}wl:${long}${BT} and after, then more words so that it is a real paragraph.\n\nnext`
await setDoc(longDoc, longDoc.length)
await js(`${VIEW}.dispatch({ selection: { anchor: ${longDoc.length} } })`)
await until(async () => (await js(`document.querySelectorAll('.wm-math-inline').length`)) === 1, 5000)
await sleep(400)
// The browser reports a rectangle per span; group them into the lines they are on.
const LINES = `(e) => { const rs = [...e.getClientRects()].filter((r) => r.width > 0).sort((a, b) => (a.top + a.bottom) - (b.top + b.bottom)); const out = []
  for (const r of rs) { const mid = (r.top + r.bottom) / 2; const last = out[out.length - 1]
    if (last && mid - last.mid < 9) { last.left = Math.min(last.left, r.left); last.right = Math.max(last.right, r.right); last.top = Math.min(last.top, r.top); last.bottom = Math.max(last.bottom, r.bottom) }
    else out.push({ mid, left: r.left, right: r.right, top: r.top, bottom: r.bottom }) }
  return out }`
const lg = await js(`(() => { const lines = ${LINES}; const e = document.querySelector('.wm-math-inline'); const rects = lines(e)
  const line = e.closest('.cm-line').getBoundingClientRect(); const sc = ${VIEW}.scrollDOM
  return { frags: rects.length, inside: rects.every((r) => r.left >= line.left - 1 && r.right <= line.right + 1), sideways: sc.scrollWidth > sc.clientWidth,
    box: getComputedStyle(e).overflowX, wide: e.classList.contains('wm-math-wide') } })()`)
ok("a 30-term inline equation wraps over several lines inside its paragraph", lg.frags > 1 && lg.inside, JSON.stringify(lg))
ok("...with no scroll box of its own and no sideways scroll on the editor", lg.box === "visible" && !lg.wide && !lg.sideways, JSON.stringify(lg))
// a press on a wrapped fragment: the second line's left half is "toward the start", the last fragment's right half toward the end
const head0 = longDoc.indexOf(BT + "wl:"), end0 = head0 + long.length + 5
const fragClick = async (index, fx) => {
  await js(`${VIEW}.dispatch({ selection: { anchor: ${longDoc.length} } })`)
  await sleep(150)
  const at = await js(`(() => { const lines = ${LINES}; const e = document.querySelector('.wm-math-inline'); const r = lines(e)[${index}]; return { x: r.left + (r.right - r.left) * ${fx}, y: r.mid } })()`)
  await click(at.x, at.y)
  await sleep(150)
  return caret()
}
const first = await fragClick(0, 0.2), lastIndex = lg.frags - 1
const last = await fragClick(lastIndex, 0.9)
ok("a press near the start of the first line is toward the start of the source; near the end of the last line, toward the end", first < head0 + 6 + long.length / 2 && last > end0 - 6 - long.length / 2 && first < last, JSON.stringify({ first, last, head0, end0 }))

// The rendered page draws the same text.
await setDoc(doc, doc.length)
await sleep(300)
await setRendered(true)
await sleep(700)
const r = await js(`(() => {
  const root = document.querySelector('.cm-content'); const e = [...root.querySelectorAll('.wm-math-inline')]
  return { n: e.length, mathml: e.filter((x) => x.querySelector('math')).length, overlap: e.filter((x) => { const l = x.closest('.wm-pv') ?? x.parentElement; const lb = l.getBoundingClientRect(); return [...x.getClientRects()].some((q) => q.top < lb.top - 1 || q.bottom > lb.bottom + 1) }).length }
})()`)
ok("on the rendered page the equations are text too, inside their blocks", r.n >= tall.length && r.mathml === 0 && r.overlap === 0, JSON.stringify(r))
await shot("inline-linear-rendered")
await setRendered(false)
finish()
