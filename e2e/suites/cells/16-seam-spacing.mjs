// The bar keeps the same distance from the cell it follows wherever it is: HALF A CELL SPACING (Sean, 2026-10-10:
// "the spacing isn't even when the horizontal cursor is at the bottom.. it should be half a cell spacing away"). Between
// two cells the bar is in the middle of the gap, half a spacing from each; under the last cell it was four points from
// it and above the first it was four points too, so the three looked different. Measured on the page, not in the
// model: the bar's centre against the edges of the cells as the DOM draws them, on the markdown side and the rendered
// page, with the + marker on the bar and the new cell landing half a spacing under it.
import { ok, test, note, finish, js, sleep, freshNote, setDoc, doc, sel, key, click, hover, focus, armed, setRendered, typeText, shot } from "../../lib/harness.mjs"

await freshNote()
const D0 = "Alpha\n\nBeta\n\nGamma"

// ---- what the page shows (viewport pixels throughout: the bar, the cells and the scroller share them)
/** The cells as drawn, top to bottom: every block child of the content that has words in it (or is a drawn block). */
const blocks = async () => JSON.parse(await js(`JSON.stringify([...document.querySelector('.cm-content').children]
  .filter((e) => e.textContent.trim() !== '' || e.className.includes('wm-pv'))
  .map((e) => { const r = e.getBoundingClientRect(); return { top: r.top, bottom: r.bottom, text: e.textContent.slice(0, 14) } }))`))
/** The first line of the page, whatever is on it: where a cell opened on an empty note lands. */
const firstLine = async () => JSON.parse(await js(`(() => { const r = document.querySelector('.cm-content').firstElementChild.getBoundingClientRect(); return JSON.stringify({ top: r.top, bottom: r.bottom }) })()`))
/** The armed bar's centre line, and the + marker's. */
const bar = async () => JSON.parse(await js(`(() => {
  const b = document.querySelector('.wm-bar:not(.wm-bar-faint):not(.wm-bar-drop)')
  const p = document.querySelector('.wm-plus')
  const s = document.querySelector('.cm-scroller').getBoundingClientRect()
  const mid = (e) => { if (!e) return null; const r = e.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2, top: r.top, bottom: r.bottom } }
  return JSON.stringify({ bar: mid(b), plus: mid(p), scrollerTop: s.top, scrollerBottom: s.bottom })
})()`))
const near = (a, b, tolerance = 1) => Math.abs(a - b) <= tolerance
const SPACING = 15 * 1.45 // one blank line of the page (PREVIEW_BLOCK_GAP): the air between two cells

/** Arm the bar by a real click at a page point and wait for it to be drawn. */
const armAt = async (y) => { await click(600, y); await sleep(250) }

for (const rendered of [false, true]) {
  const side = rendered ? "rendered page" : "markdown side"
  await setRendered(rendered)

  await test(`${side}: the bar between two cells is half a spacing from each`, async () => {
    await setDoc(D0); await focus(); await sleep(300)
    const [alpha, beta] = await blocks()
    const gap = beta.top - alpha.bottom
    ok("the cells are a cell spacing apart", near(gap, SPACING, 0.5), JSON.stringify({ gap }))
    await armAt((alpha.bottom + beta.top) / 2)
    const m = await bar()
    ok("the bar is up", await armed() && !!m.bar, JSON.stringify(m))
    ok("half a spacing under the cell above", near(m.bar.y - alpha.bottom, gap / 2), JSON.stringify({ m, alpha }))
    ok("half a spacing over the cell below", near(beta.top - m.bar.y, gap / 2), JSON.stringify({ m, beta }))
    note(`${side}: between two cells the bar is ${(m.bar.y - alpha.bottom).toFixed(2)} under the cell above and ${(beta.top - m.bar.y).toFixed(2)} over the cell below`)
  })

  await test(`${side}: the bar under the last cell is the same half spacing from it`, async () => {
    await setDoc(D0); await focus(); await sleep(300)
    const [alpha, beta, gamma] = await blocks()
    const half = (beta.top - alpha.bottom) / 2
    await armAt(gamma.bottom + 120)
    const m = await bar()
    ok("a click a long way under the last cell arms the bar after it", await armed() && (await sel())[0] === D0.length, JSON.stringify(await sel()))
    ok("the bar is half a spacing under the last cell, as far as it is from a neighbour between two cells", near(m.bar.y - gamma.bottom, half), JSON.stringify({ m, gamma, half }))
    ok("the + is on the bar", near(m.plus.y, m.bar.y, 1.5), JSON.stringify(m))
    note(`${side}: under the last cell the bar is ${(m.bar.y - gamma.bottom).toFixed(2)} below it`)
    await shot(`${rendered ? "rendered" : "markdown"}-tail`)
    // The click target is the whole tail, the bar's own line included.
    await key("Escape"); await sleep(100)
    await armAt(m.bar.y)
    ok("a click on the bar's own line arms the same bar", await armed() && (await sel())[0] === D0.length, JSON.stringify(await sel()))
    // Typing there opens the cell below: it lands half a spacing under the bar (the bar is the middle of the air between).
    await typeText("Z"); await sleep(250)
    ok("typing makes a new last cell", (await doc()) === D0 + "\n\nZ", JSON.stringify(await doc()))
    const after = await blocks()
    ok("the new cell starts half a spacing under where the bar was", near(after[3].top - m.bar.y, half), JSON.stringify({ after, bar: m.bar.y }))
    ok("and a cell spacing under the last one", near(after[3].top - after[2].bottom, half * 2), JSON.stringify(after))
    await key("z", { ctrl: true }); await sleep(200)
    ok("Ctrl+Z takes it away", (await doc()) === D0, JSON.stringify(await doc()))
  })

  await test(`${side}: the bar above the first cell is the same half spacing from it, with the + on the page`, async () => {
    await setDoc(D0); await focus(); await sleep(300)
    const [alpha, beta] = await blocks()
    const half = (beta.top - alpha.bottom) / 2
    await armAt(alpha.top - 4)
    const m = await bar()
    ok("a click above the first cell arms the bar before it", await armed() && (await sel())[0] === 0, JSON.stringify(await sel()))
    ok("the bar is half a spacing over the first cell", near(alpha.top - m.bar.y, half), JSON.stringify({ m, alpha, half }))
    ok("the + is on the bar", near(m.plus.y, m.bar.y, 1.5), JSON.stringify(m))
    ok("and the whole + is on the page (the scroller does not cut it off)", m.plus.top >= m.scrollerTop - 0.5, JSON.stringify(m))
    note(`${side}: over the first cell the bar is ${(alpha.top - m.bar.y).toFixed(2)} above it and ${(m.bar.y - m.scrollerTop).toFixed(2)} under the top of the page`)
    await shot(`${rendered ? "rendered" : "markdown"}-head`)
    await typeText("Top"); await sleep(250)
    ok("typing makes a new first cell", (await doc()) === "Top\n\n" + D0, JSON.stringify(await doc()))
    const after = await blocks()
    ok("it starts half a spacing under where the bar was", near(after[0].top - m.bar.y, half), JSON.stringify({ after: after[0], bar: m.bar.y }))
    await key("z", { ctrl: true }); await sleep(200)
    ok("Ctrl+Z takes it away", (await doc()) === D0, JSON.stringify(await doc()))
  })

  await test(`${side}: a note of one cell, and cells that are taller than a line`, async () => {
    for (const text of ["Alpha", "Alpha\n\n- one\n- two", "# Title\n\nAlpha\n\n```js\ncode\n```"]) {
      await setDoc(text); await focus(); await sleep(300)
      const list = await blocks()
      const last = list[list.length - 1]
      const first = list[0]
      await armAt(last.bottom + 120)
      const tail = await bar()
      ok(`${JSON.stringify(text)}: half a spacing under the last cell`, near(tail.bar.y - last.bottom, SPACING / 2), JSON.stringify({ tail, last }))
      await key("Escape"); await sleep(100)
      await armAt(first.top - 4)
      const head = await bar()
      ok(`${JSON.stringify(text)}: half a spacing over the first cell`, near(first.top - head.bar.y, SPACING / 2), JSON.stringify({ head, first }))
      await key("Escape"); await sleep(100)
    }
  })

  await test(`${side}: a note with nothing in it: the bar is half a spacing over where the first cell lands`, async () => {
    await setDoc(""); await focus(); await sleep(300)
    const landing = await firstLine()
    await armAt(landing.top + 200)
    const m = await bar()
    ok("the bar is up", await armed() && !!m.bar, JSON.stringify(m))
    ok("half a spacing over the first line", near(landing.top - m.bar.y, SPACING / 2), JSON.stringify({ m, landing }))
    ok("the + is on the bar and on the page", near(m.plus.y, m.bar.y, 1.5) && m.plus.top >= m.scrollerTop - 0.5, JSON.stringify(m))
    await typeText("Q"); await sleep(250)
    ok("typing makes the first cell", (await doc()) === "Q", JSON.stringify(await doc()))
    const after = await blocks()
    ok("it lands half a spacing under the bar", near(after[0].top - m.bar.y, SPACING / 2), JSON.stringify({ after: after[0], bar: m.bar.y }))
  })
}
finish()
