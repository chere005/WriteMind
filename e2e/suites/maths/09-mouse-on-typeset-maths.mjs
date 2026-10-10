// Presses on typeset maths behave the way presses on words do (found by an independent verifier, 2026-10-04): the
// handler ran for every button and ignored the modifiers, so
//  - Shift+click on an equation did not extend the selection (the anchor was lost),
//  - a right-click moved the caret into the equation and swapped it for its source BEFORE the context menu opened
//    (the page's own "move the caret to the click" would put it at the equation's edge, which shows the source too),
//  - a drag that starts on an equation gave a caret, not a selection.
// Fixed 2026-10-04 (Mathslane-fix1): `pressOnMaths` in packages/editor/src/math.ts. Left button: caret in the source,
// a drag from there selects from the near EDGE (so a drag across an equation selects it, typeset); Shift extends the
// selection to the near edge; the right button selects the equation; Ctrl/Cmd is the drawing layer's.
import { ok, finish, js, sleep, freshNote, setDoc, doc, sel, ranges, setSel, focus, shot, click, rightClick, mouse, hover, drag } from "../../lib/harness.mjs"

const BT = "`", F = BT.repeat(3)
const text = `Alpha ${BT}wl:x^2${BT} beta gamma delta\n\nDelta ${BT}wl:y^2${BT} epsilon zeta\n\n${F}wl\nSqrt[x]\n${F}\n\nEnd\n`
const eq1 = { start: text.indexOf(BT + "wl:x^2"), end: text.indexOf(BT + "wl:x^2") + 8 }
const eq2 = { start: text.indexOf(BT + "wl:y^2"), end: text.indexOf(BT + "wl:y^2") + 8 }
const block = { start: text.indexOf(F + "wl"), end: text.indexOf("Sqrt[x]\n") + "Sqrt[x]\n".length + 3 }

await freshNote()
const reset = async (caret = 0) => {
  await setDoc(text, caret)
  await focus()
  await sleep(350)
}
const inlineCount = () => js(`document.querySelectorAll('.cm-line .wm-math-inline').length`)
const blockCount = () => js(`document.querySelectorAll('.wm-math-block').length`)
/** A point on the n-th equation: `part` is 0..1 along its width. */
const point = async (selector, n, part = 0.5) => {
  const r = await js(`(() => { const e = document.querySelectorAll(${JSON.stringify(selector)})[${n}]; const b = e.getBoundingClientRect(); return { left: b.left, width: b.width, mid: b.top + b.height / 2, top: b.top, height: b.height } })()`)
  return { x: r.left + r.width * part, y: r.mid, ...r }
}
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b)

await reset()
ok("two equations and a block are typeset to begin with", (await inlineCount()) === 2 && (await blockCount()) === 1, `${await inlineCount()} ${await blockCount()}`)
ok("(the positions this script expects)", text.slice(eq1.start, eq1.end) === "`wl:x^2`" && text.slice(eq2.start, eq2.end) === "`wl:y^2`" && text.slice(block.start, block.end) === `${F}wl\nSqrt[x]\n${F}`)

// ---- a plain click is as it was: the caret goes into the source, at the nearer end
{
  let p = await point(".cm-line .wm-math-inline", 0, 0.2)
  await click(p.x, p.y)
  ok("a click on the left half of an equation puts the caret just after `wl:`", same(await sel(), [eq1.start + 4, eq1.start + 4]), JSON.stringify(await sel()))
  ok("...and the equation shows its source", (await inlineCount()) === 1)
  await reset()
  p = await point(".cm-line .wm-math-inline", 0, 0.8)
  await click(p.x, p.y)
  ok("a click on the right half puts it before the closing backtick", same(await sel(), [eq1.end - 1, eq1.end - 1]), JSON.stringify(await sel()))
  // a twitch of the hand is still a click
  await reset()
  p = await point(".cm-line .wm-math-inline", 0, 0.3)
  await hover(p.x, p.y)
  await mouse("mousePressed", p.x, p.y)
  await mouse("mouseMoved", p.x + 2, p.y + 1)
  await mouse("mouseReleased", p.x + 2, p.y + 1)
  await sleep(150)
  ok("a press that moves two pixels is a click, not a drag", (await sel())[0] === (await sel())[1], JSON.stringify(await sel()))
}

// ---- Shift extends
{
  await reset(0)
  let p = await point(".cm-line .wm-math-inline", 1, 0.8)
  await click(p.x, p.y, { shift: true })
  ok("Shift+click on the right half of the second equation selects from the caret to its end", same(await sel(), [0, eq2.end]), JSON.stringify(await sel()))
  ok("...and both equations stay typeset (the selection covers the second)", (await inlineCount()) === 2, String(await inlineCount()))
  await shot("maths-shift-click-selection")
  await reset(0)
  p = await point(".cm-line .wm-math-inline", 1, 0.2)
  await click(p.x, p.y, { shift: true })
  ok("Shift+click on the left half selects up to the start of it", same(await sel(), [0, eq2.start]), JSON.stringify(await sel()))
  ok("...and it stays typeset", (await inlineCount()) === 2)
  // backwards: the caret after the second equation, Shift+click on the first
  await reset(eq2.end + 5)
  p = await point(".cm-line .wm-math-inline", 0, 0.2)
  await click(p.x, p.y, { shift: true })
  ok("Shift+click on an equation BEFORE the caret extends backwards over it", same(await sel(), [eq2.end + 5, eq1.start]), JSON.stringify(await sel()))
  // a selection already made is extended, not replaced
  await reset(0)
  await setSel(1, 4)
  p = await point(".cm-line .wm-math-inline", 1, 0.8)
  await click(p.x, p.y, { shift: true })
  ok("Shift+click keeps the anchor of a selection that was already made", (await sel())[0] === 1 && (await sel())[1] === eq2.end, JSON.stringify(await sel()))
  // Shift + drag
  await reset(0)
  p = await point(".cm-line .wm-math-inline", 1, 0.3)
  await drag(p.x, p.y, p.x + 120, p.y, { shift: true })
  ok("Shift+drag from an equation goes on extending from the old anchor", (await sel())[0] === 0 && (await sel())[1] > eq2.end, JSON.stringify(await sel()))
}

// ---- the right button is not for the maths
{
  await reset(0)
  const p = await point(".cm-line .wm-math-inline", 0, 0.5)
  await rightClick(p.x, p.y)
  ok("a right-click on an equation selects it as a whole (as on an image)", same(await sel(), [eq1.start, eq1.end]), JSON.stringify(await sel()))
  ok("...and it does not turn into its source under the menu", (await inlineCount()) === 2, String(await inlineCount()))
  ok("...the page's own menu opens", await js(`!!document.querySelector('#context-menu')`))
  ok("...with Cut and Copy live (there is a selection)", await js(`[...document.querySelectorAll('#context-menu button')].filter((b) => /^(Cut|Copy)/.test(b.textContent)).every((b) => !b.disabled)`))
  await shot("maths-right-click")
  await js(`document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))`)
  await click(900, 700)
  await sleep(200)
  ok("the document is untouched", (await doc()) === text)
  // ... and on the block
  await reset(0)
  const b = await point(".wm-math-block", 0, 0.5)
  await rightClick(b.x, b.y)
  ok("a right-click on the block selects it, and it stays typeset", same(await sel(), [block.start, block.end]) && (await blockCount()) === 1, JSON.stringify(await sel()))
  await click(900, 700)
  // ...inside a selection that already covers the equation it changes nothing
  await reset(0)
  await setSel(eq1.start - 2, eq1.end + 3)
  const c = await point(".cm-line .wm-math-inline", 0, 0.5)
  await rightClick(c.x, c.y)
  ok("a right-click inside a selection that covers the equation leaves the selection as it was", same(await sel(), [eq1.start - 2, eq1.end + 3]) && (await inlineCount()) === 2, JSON.stringify(await sel()))
  await click(900, 700)
}

// ---- Ctrl (Cmd) is the drawing layer's, on words and on equations alike: the maths does not take the press
{
  await reset(0)
  const p = await point(".cm-line .wm-math-inline", 0, 0.2)
  await click(p.x, p.y, { ctrl: true })
  ok("Ctrl+click on an equation leaves the caret and the equation alone", same(await ranges(), [[0, 0]]) && (await inlineCount()) === 2, JSON.stringify(await ranges()))
}

// ---- a drag that starts on an equation selects
{
  await reset(0)
  let p = await point(".cm-line .wm-math-inline", 0, 0.25)
  await drag(p.x, p.y, p.x + 160, p.y, { steps: 12 })
  let s = await sel()
  ok("a drag that starts on the left half of an equation and goes right selects it and what follows", s[0] === eq1.start && s[1] > eq1.end, JSON.stringify(s))
  ok("...with the equation still typeset (the selection covers it)", (await inlineCount()) === 2, String(await inlineCount()))
  await shot("maths-drag-from-equation")
  // moving the pointer afterwards, button up, changes nothing (the drag is over)
  const held = await sel()
  await hover(p.x + 300, p.y)
  await hover(p.x + 20, p.y)
  await sleep(100)
  ok("after the button is released the selection no longer follows the pointer", same(await sel(), held), JSON.stringify([held, await sel()]))
  // from the right half, going left
  await reset(0)
  p = await point(".cm-line .wm-math-inline", 0, 0.75)
  await drag(p.x, p.y, p.x - 120, p.y, { steps: 12 })
  s = await sel()
  ok("a drag from the right half going left selects it and what precedes", s[0] === eq1.end && s[1] < eq1.start, JSON.stringify(s))
  // down to the next line
  await reset(0)
  p = await point(".cm-line .wm-math-inline", 0, 0.25)
  const q = await point(".cm-line .wm-math-inline", 1, 0.9)
  await drag(p.x, p.y, q.x, q.y, { steps: 14 })
  s = await sel()
  ok("a drag from one equation to another selects both and the words between", s[0] === eq1.start && s[1] >= eq2.end - 1 && s[1] <= eq2.end, JSON.stringify(s))
  // a drag that starts in words and crosses an equation (as it was)
  await reset(0)
  const line = await js(`(() => { const b = document.querySelector('.cm-line').getBoundingClientRect(); return { left: b.left, y: b.top + b.height / 2 } })()`)
  p = await point(".cm-line .wm-math-inline", 0, 0.5)
  await drag(line.left + 4, line.y, p.x + 60, line.y, { steps: 12 })
  s = await sel()
  ok("a drag that starts in words and crosses an equation still covers it", s[0] === 0 && s[1] > eq1.end, JSON.stringify(s))
}

// ---- a block: the same
{
  await reset(0)
  let b = await point(".wm-math-block", 0, 0.5)
  await click(b.x, b.y)
  const bodyEnd = text.indexOf("Sqrt[x]") + "Sqrt[x]".length
  ok("a click on the block puts the caret at the end of its first line", same(await sel(), [bodyEnd, bodyEnd]), JSON.stringify(await sel()))
  await reset(0)
  b = await point(".wm-math-block", 0, 0.5)
  await click(b.x, b.y + b.height * 0.3, { shift: true })
  ok("Shift+click on the lower half of the block selects to the end of it", same(await sel(), [0, block.end]), JSON.stringify(await sel()))
  ok("...and it stays typeset", (await blockCount()) === 1)
  await reset(0)
  b = await point(".wm-math-block", 0, 0.5)
  await click(b.x, b.y - b.height * 0.3, { shift: true })
  ok("Shift+click on the upper half selects up to the start of it", same(await sel(), [0, block.start]), JSON.stringify(await sel()))
  await reset(0)
  b = await point(".wm-math-block", 0, 0.5)
  await drag(b.x, b.y - b.height * 0.3, b.x, b.y + b.height * 0.3 + 90, { steps: 10 })
  const s = await sel()
  ok("a drag from the block downwards selects it and what follows", s[0] === block.start && s[1] > block.end, JSON.stringify(s))
}

// the document was never changed by any of it
ok("no press changed the note", (await doc()) === text)
finish()
