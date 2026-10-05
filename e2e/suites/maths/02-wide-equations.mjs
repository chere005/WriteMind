// Maths wider than the pane. Typeset maths cannot break, and a flex item (CodeMirror's .cm-content) may not
// shrink below its min-content width, so one long equation used to lay the WHOLE note out at its width: every
// other paragraph wrapped at the equation's width and the editor got a sideways scrollbar. Now the content is the
// pane's width and a BLOCK equation scrolls in a box of its own. An INLINE equation is a run of text (Mathslane-fix2:
// it used to be an inline-block that got a scroll box when it did not fit), so it simply wraps with the words round it.
// Fixed 2026-10-03 (Mathslane-fix1 / fix2): `.cm-content { min-width: 0 }` (packages/editor/src/math.ts).
import { ok, finish, js, sleep, until, freshNote, setDoc, focus, shot, setWindowSize, click, VIEW } from "../../lib/harness.mjs"

const BT = "`", FENCE = BT.repeat(3)
const terms = (n) => Array.from({ length: n }, (_, i) => `a${i}*x^${i}`).join(" + ")

await freshNote()
await focus()

const SENTENCE = "An ordinary paragraph of plain words that has to wrap at the width of the pane, however wide the equations around it are, and it goes on for a good few more words so that it takes several lines. "
const PARA = (SENTENCE + SENTENCE.replace("An ordinary", "Another ordinary") + SENTENCE.replace("An ordinary", "Yet another ordinary")).trim()
const doc = [
  PARA,
  "",
  `Inline ${BT}wl:${terms(30)}${BT} and then the sentence goes on after it with more words.`,
  "",
  `A short one ${BT}wl:x^2 + 1${BT} sits in a sentence.`,
  "",
  FENCE + "wl", terms(30), FENCE,
  "",
  `A middling one ${BT}wl:${terms(12)}${BT} in a line.`,
  "",
  "end",
].join("\n")

// The browser reports a rectangle per span of an inline equation: group them into the lines they are on.
const LINES = `(e) => { const rs = [...e.getClientRects()].filter((r) => r.width > 0).sort((a, b) => (a.top + a.bottom) - (b.top + b.bottom)); const out = []
  for (const r of rs) { const mid = (r.top + r.bottom) / 2; const last = out[out.length - 1]
    if (last && mid - last.mid < 9) { last.left = Math.min(last.left, r.left); last.right = Math.max(last.right, r.right) }
    else out.push({ mid, left: r.left, right: r.right }) }
  return out }`

const measure = () => js(`(() => {
  const lines = ${LINES}
  const v = ${VIEW}, sc = v.scrollDOM, c = v.contentDOM
  const lineOf = (needle) => [...c.querySelectorAll('.cm-line')].find((l) => l.textContent.includes(needle))
  const para = lineOf('An ordinary paragraph')
  const pr = para.getBoundingClientRect()
  const lh = parseFloat(getComputedStyle(para).lineHeight)
  const inl = [...c.querySelectorAll('.wm-math-inline')].map((e) => {
    const l = e.closest('.cm-line').getBoundingClientRect()
    const cs = getComputedStyle(e), ls = lines(e)
    return { wl: e.dataset.wl.slice(0, 12), lines: ls.length, lineLeft: Math.round(l.left), lineRight: Math.round(l.right),
      inside: ls.every((x) => x.left >= l.left - 1 && x.right <= l.right + 1), width: Math.round(Math.max(...ls.map((x) => x.right)) - Math.min(...ls.map((x) => x.left))),
      align: cs.verticalAlign, overflowX: cs.overflowX, display: cs.display, wide: e.classList.contains('wm-math-wide'), hasMathml: !!e.querySelector('math'),
      lineHeight: Math.round(l.height * 10) / 10 }
  })
  const blk = [...c.querySelectorAll('.wm-math-block')].map((e) => ({ client: e.clientWidth, scroll: e.scrollWidth, overflowX: getComputedStyle(e).overflowX }))
  return { scrollerClient: sc.clientWidth, scrollerScroll: sc.scrollWidth, contentClient: c.clientWidth, contentScroll: c.scrollWidth,
    paraWidth: Math.round(pr.width), paraLines: Math.round(pr.height / lh), inl, blk }
})()`)

for (const [label, width] of [["a window of 1440", 1440], ["a window of 1000", 1000]]) {
  await setWindowSize(width, 900)
  await setDoc(doc, doc.length)
  await js(`${VIEW}.dispatch({ selection: { anchor: ${doc.length} } })`)
  await until(async () => (await js(`document.querySelectorAll('.wm-math-inline').length`)) >= 3 && (await js(`document.querySelectorAll('.wm-math-block').length`)) === 1, 5000)
  await sleep(500)
  const m = await measure()
  const long = m.inl.find((e) => e.wl.startsWith("a0*x^0")) ?? m.inl[0]
  const short = m.inl.find((e) => e.wl === "x^2 + 1")
  const tag = ` [${label}]`
  const info = JSON.stringify(m)

  ok("the editor has no sideways scroll because of a 30-term equation" + tag, m.scrollerScroll <= m.scrollerClient, info)
  ok("the note keeps the pane's width (the content is not as wide as the equation)" + tag, m.contentClient <= m.scrollerClient && m.contentScroll <= m.scrollerClient, info)
  ok("an ordinary paragraph still wraps at the pane's width: several lines, none wider than the content" + tag, m.paraLines >= 3 && m.paraWidth <= m.contentClient, info)
  ok("the block equation is a scroll box inside the content, wider inside than out" + tag,
    m.blk[0] && m.blk[0].client <= m.contentClient && m.blk[0].scroll > m.blk[0].client && m.blk[0].overflowX === "auto", info)
  ok("the long inline equation wraps over several lines, every piece inside its paragraph" + tag, long.lines > 1 && long.inside, JSON.stringify(long))
  ok("...as text: no scroll box, no box at all" + tag, !long.wide && long.overflowX === "visible" && long.display === "inline" && !long.hasMathml, JSON.stringify(long))
  ok("a short inline equation is text on the baseline, on one line" + tag, short && short.lines === 1 && short.align === "baseline" && short.display === "inline", JSON.stringify(short))
  if (width === 1440) await shot("wide-1440")
}

// Wider and narrower again: the 12-term equation (~600px as text) wraps only when it does not fit its line -- it
// follows the pane's width, both ways, and never makes the editor scroll sideways.
const twelve = (m) => m.inl.filter((e) => e.wl.startsWith("a0*x^0")).sort((x, y) => x.width - y.width)[0]
await setWindowSize(2200, 900)
await sleep(700)
const wideNow = await measure()
const midWide = twelve(wideNow)
ok("the 12-term inline equation (" + midWide.width + "px) is one line in a window of 2200", midWide.lines === 1 && wideNow.scrollerScroll <= wideNow.scrollerClient, JSON.stringify(midWide))
await setWindowSize(900, 900)
await sleep(700)
const narrowNow = await measure()
const midNarrow = twelve(narrowNow)
ok("in a window of 900 the same equation wraps and stays inside its paragraph", midNarrow.lines > 1 && midNarrow.inside, JSON.stringify(midNarrow))
ok("...and the editor still has no sideways scroll", narrowNow.scrollerScroll <= narrowNow.scrollerClient, JSON.stringify(narrowNow))

// A press on the block's scrollbar is for the scrollbar: it scrolls the equation and does not turn it into its
// source (which would make a scroll box impossible to drag). A press on the equation itself still opens the source.
await setWindowSize(1000, 900)
await setDoc(doc, doc.length)
await sleep(600)
const barOf = (selector) => js(`(() => { const e = document.querySelector(${JSON.stringify(selector)}); e.scrollIntoView({ block: 'center' }); const r = e.getBoundingClientRect()
  return { x: Math.round(r.left + r.width / 2), y: Math.round(r.bottom - 3), top: Math.round(r.top + 10), client: e.clientHeight, height: Math.round(r.height) } })()`)
const head = () => js(`${VIEW}.state.selection.main.head`)
const bar = await barOf(".wm-math-block")
await click(bar.x, bar.y)
await sleep(300)
ok("a press on the block's scrollbar leaves it typeset, the caret where it was", (await js(`!!document.querySelector('.wm-math-block')`)) && (await head()) === doc.length, JSON.stringify({ bar, head: await head() }))
await js(`document.querySelector('.wm-math-block').scrollLeft = 0`)
const body = await barOf(".wm-math-block")
await click(body.x, body.top)
await sleep(300)
ok("a press on the block equation itself puts the caret in its source (the block opens as text)", (await head()) < doc.length && !(await js(`!!document.querySelector('.wm-math-block')`)), String(await head()))
await setDoc(doc, doc.length)
await sleep(400)

// Editing next to / inside it still works: the caret into the source and out again leaves the layout alone.
const at = doc.indexOf(BT + "wl:" + terms(30)) + 8
await js(`${VIEW}.dispatch({ selection: { anchor: ${at} } })`)
await sleep(500)
let m = await measure()
ok("the caret inside the long inline source shows the source (text again) and no sideways scroll", m.inl.every((e) => !e.wl.startsWith("a0*x^0") || e.width < 900) && m.scrollerScroll <= m.scrollerClient, JSON.stringify(m))
await js(`${VIEW}.dispatch({ selection: { anchor: ${doc.length} } })`)
await sleep(600)
m = await measure()
ok("...and typeset again with the caret away, wrapped inside its paragraph", m.inl.some((e) => e.lines > 1 && e.inside) && m.scrollerScroll <= m.scrollerClient, JSON.stringify(m))
await shot("wide-after-edit")

await setWindowSize(1440, 900)
finish()
