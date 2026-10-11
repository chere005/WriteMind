// READING THE PEN'S HANDWRITING ON THE NOTE PAGE (Sean, 2026-10-10: "no ocr for the pen on top of rendered notepage"): the strokes a pen
// writes on the rendered page, picked, have a Read button in their bar; it reads them as words and types the words into the note just
// under the lowest of them. The strokes stay. A person's handwriting (e2e/lib/handwriting.mjs), drawn with the real pen pointer events.
// And (Sean, 2026-10-10: "Text brought in should be grouped together"): ALL THREE LINES of the fixture's handwriting come in as ONE
// cell, lines together, one bracket on the rendered page.
import { ok, finish, js, sleep, freshNote, setPen, canvasBox, saved, handles, click, dragPath, line, shot, doc, setDoc, waitFor, brackets, CTRL } from "../../lib/harness.mjs"
import { RED, traceHandwriting } from "../../lib/handwriting.mjs"

const file = await freshNote({ rendered: true })
const cb = await canvasBox()
const X = (dx) => cb.x + dx, Y = (dy) => cb.y + dy
const strokes = async () => (await saved(file)).items.filter((i) => i.kind === "stroke")

// The three red lines of the fixture ("The quick brown fox / jumps over the lazy dog. / 0123456789"), written with the pen near the top of the page.
const chains = await traceHandwriting(js)
await setPen(true)
const k = 0.95
for (const chain of chains) {
  const pts = chain.filter((_, i) => i % 2 === 0 || i === chain.length - 1).map(([x, y]) => [X(70 + x * k), Y(120 + (y - RED.top) * k)])
  if (pts.length >= 2) await dragPath(pts, { pen: true, wait: 30 })
}
const written = await strokes()
ok("the pen wrote the lines as strokes on the page", written.length >= chains.length - 2, `${written.length} strokes for ${chains.length} traced`)
await setPen(false)
await shot("written")

// Pick them all (a marquee), and the bar over them has a Read button.
await click(X(900), Y(700)); await sleep(100)
await dragPath(line([X(30), Y(60)], [X(cb.w - 40), Y(420)], 20), { modifiers: CTRL }); await sleep(300)
const picked = await handles()
ok("a marquee over the writing picks it (handles round it)", picked.length >= 3, JSON.stringify(picked.map((h) => h.t)))
ok("the bar over picked handwriting has a Read button, and its tooltip says what it does", await js(`(() => { const b = document.querySelector('[data-insp=read]'); return !!b && /Read the handwriting as words/.test(b.title) })()`))
ok("...and the button is an icon, not the letters Aa", await js(`(() => { const b = document.querySelector('[data-insp=read]'); return !!b && !!b.querySelector('svg') && !/Aa/.test(b.textContent ?? '') })()`))
await shot("picked")

const before = await doc()
await js(`document.querySelector('[data-insp=read]').click()`)
await waitFor(`/quick|brown|fox|lazy|dog/i.test(document.querySelector('.cm-content')?.innerText ?? '')`, 40000).catch(() => {})
await sleep(400)
const text = await doc()
console.log("note text:", JSON.stringify(text))
const hits = ["quick", "brown", "fox", "jumps", "over", "lazy", "dog"].filter((w) => text.toLowerCase().includes(w))
ok("the handwriting came into the note as words (at least four of the seven words are right)", hits.length >= 4 && text !== before, `${hits.join()} in ${JSON.stringify(text)}`)
ok("the lines of the reading are ONE cell: three or more lines together, no blank line between them", text.trim().split("\n").length >= 3 && !/\n[ \t]*\n/.test(text.trim()), JSON.stringify(text))
await sleep(300)
const held = await brackets()
ok("...with one bracket on the page", held.length === 1, JSON.stringify(held))
ok("the page is the rendered one", await js(`document.querySelector('.cm-editor').classList.contains('wm-rendered')`))
ok("the pane said so (Read N lines into the note)", await js(`/Read \\d+ lines? into the note/.test(document.body.innerText)`).catch(() => false))
ok("the strokes stay", (await strokes()).length === written.length)
await shot("read")
// Closed (the caret in another cell) its lines are still lines on the rendered page: it is a text cell, and a text cell keeps every line break.
const closed = text + "\n\nlast cell"
await setDoc(closed, closed.length)
await sleep(500)
ok("closed, the reading is a text cell and keeps its lines on the rendered page (not run together into one)", await js(`(() => { const h = [...document.querySelectorAll('.wm-pv-text')].find((e) => /quick|brown|fox/i.test(e.textContent ?? '')); return !!h && h.querySelectorAll('br').length >= 2 })()`))
await shot("closed")

finish()
