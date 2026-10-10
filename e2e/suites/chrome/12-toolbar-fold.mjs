// THE FOLD LADDER (docs/PLAN-bars-2026-10.md P1; wireframe FinalToolbar.png "A 460px pane: what doesn't fit moves into
// the dots, which only appear then"). The bar is one 36px row that never wraps and never clips: as the pane narrows the
// inserts and the section moves go into the dots, then list / quote / code, and the Style button gives up its word last.
// What folded is runnable from the dots under "Moved here for width", with icons and keys. The widths are measured in the
// real row at every width from 460 up and at the exact pixel each level starts (barFold.ts holds the arithmetic).
import { ok, finish, freshNote, setDoc, setSel, doc, js, sleep, clickEl, key, shot, MOD, setRendered, canvasBox, drag, saved } from "../../lib/harness.mjs"

await js(`localStorage.clear()`)
await js(`location.reload()`); await sleep(1500)
const file = await freshNote()
const START = "# One\n\nalpha words\n\n# Two\n\nbeta words"
const pane = async (w) => { await js(`(() => { const p = document.querySelector('.pane'); p.style.flex = 'none'; p.style.width = '${w}px' })()`); await sleep(350) }
const unpane = () => js(`(() => { const p = document.querySelector('.pane'); p.style.flex = ''; p.style.width = '' })()`)
const J = async (expr) => JSON.parse(await js(`JSON.stringify(${expr})`))
const bars = () => J(`[...document.querySelectorAll('.top-bar [data-bar]')].filter(c => !c.closest('.float-menu, .bar-context, .style-pop') && c.getBoundingClientRect().width > 0).map(c => c.dataset.bar)`)
/** The row's own measure: height, whether anything sticks out of it, and every button's right edge against the bar's. */
const measure = () => J(`(() => {
  const bar = document.querySelector('.top-bar'); const r = bar.getBoundingClientRect()
  const kids = [...bar.querySelectorAll('button')].map((b) => b.getBoundingClientRect()).filter((b) => b.width > 0)
  return { w: Math.round(bar.clientWidth), h: r.height, scroll: bar.scrollWidth, over: Math.max(0, ...kids.map((b) => b.right - r.right)), under: Math.max(0, ...kids.map((b) => r.left - b.left)),
    wrapped: kids.some((b) => b.height > 30), tops: [...new Set(kids.map((b) => Math.round(b.top)))].length }
})()`)
const has = (list, ...ids) => ids.every((id) => list.includes(id))
const hasNone = (list, ...ids) => ids.every((id) => !list.includes(id))
const INSERTS = ["textbox", "picture", "table", "maths", "shapes", "secup", "secdown"]
const BLOCKS = ["list", "quote", "code"]
const openMore = async () => { await clickEl('[data-bar=more]'); await sleep(250) }
const closeMenu = async () => { if (await js(`!!document.querySelector('.float-menu')`)) { await key("Escape"); await sleep(250) } }
const moreRows = () => J(`[...document.querySelectorAll('.float-menu > .float-row > button')].map(b => [b.dataset.bar ?? '', b.querySelector('.float-label')?.textContent ?? '', b.querySelector('.hint')?.textContent ?? '', !!b.querySelector('svg')])`)

// ---- every width from 460 up: one 36px row, nothing wrapped, nothing clipped, the right things in the right places
for (const w of [460, 480, 520, 560, 600, 640, 676, 700, 760, 900, 1100]) {
  await pane(w)
  const m = await measure()
  const list = await bars()
  ok(`${w}px: the bar is exactly 36px tall`, Math.abs(m.h - 36) < 0.01, JSON.stringify(m))
  ok(`${w}px: one row (nothing wrapped), nothing sticks out of it and it does not scroll`, !m.wrapped && m.tops === 1 && m.over <= 0.5 && m.under <= 0.5 && m.scroll <= m.w + 0.5, JSON.stringify(m))
  ok(`${w}px: the Style button, B I U S, Aa and the pen are always there`, has(list, "style", "bold", "italic", "underline", "strike", "font", "pen", "pen-menu"), list.join())
  const level = w >= 676 ? 0 : w >= 468 ? 1 : 2
  if (level === 0) ok(`${w}px: everything shows and there are no dots`, has(list, ...BLOCKS, ...INSERTS) && hasNone(list, "more"), list.join())
  if (level === 1) ok(`${w}px: the inserts and the section moves are in the dots; list, quote, code stay`, hasNone(list, ...INSERTS) && has(list, ...BLOCKS, "more"), list.join())
  if (level === 2) ok(`${w}px: list, quote and code are in the dots too; Style keeps its word`, hasNone(list, ...INSERTS, ...BLOCKS) && has(list, "more") && (await js(`document.querySelector('[data-bar=style] .bar-label-text')?.textContent`)) === "Text", list.join())
}
await shot("w460"); await pane(460); await shot("w460")
await pane(560); await shot("w560")
await pane(640); await shot("w640")
await pane(760); await shot("w760")

// ---- the exact pixel each level starts (the arithmetic in barFold.ts is the real row's)
for (const [w, want] of [[676, 0], [675, 1], [468, 1], [467, 2]]) {
  await pane(w)
  const list = await bars()
  const m = await measure()
  const got = list.includes("table") ? 0 : list.includes("list") ? 1 : 2
  ok(`at exactly ${w}px the bar is level ${want} and fits (no clipping)`, got === want && m.over <= 0.5 && m.scroll <= m.w + 0.5, JSON.stringify({ got, m }))
}
await pane(300)
const narrow = await bars()
ok("far below 460px the Style button gives up its word last (a glyph), and the bar still fits", has(narrow, "style", "pen", "more") && (await js(`!document.querySelector('[data-bar=style] .bar-label-text')`)) && (await measure()).over <= 0.5, narrow.join())

// ---- widening puts everything back (the observer follows the pane)
await pane(900)
ok("widening the pane brings everything back", has(await bars(), ...BLOCKS, ...INSERTS) && hasNone(await bars(), "more"))

// ---- what folded runs from the dots, with icons and keys, under the caption
await setDoc(START, START.indexOf("alpha") + 2)
await pane(560)
await openMore()
const rows = await moreRows()
const caption = await js(`document.querySelector('.float-menu .float-header')?.textContent`)
ok("the dots' menu is captioned 'Moved here for width' (shown in small caps)", /moved here for width/i.test(caption ?? ""), String(caption))
ok("it lists Text box, Picture…, Table, Maths, Shapes, Move section up, Move section down — each with an icon", JSON.stringify(rows.map((r) => r[1])) === JSON.stringify(["Text box", "Picture…", "Table", "Maths", "Shapes", "Move section up", "Move section down", "Customize toolbar…"]) && rows.slice(0, 7).every((r) => r[3]), JSON.stringify(rows))
const mac = await js(`navigator.userAgent.includes('Mac')`)
const hintOf = (name) => rows.find((r) => r[1] === name)?.[2]
ok("the keys are shown (this machine's, no hand-typed Ctrl on a Mac)", hintOf("Picture…") === (mac ? "⇧⌘I" : "Ctrl+Shift+I") && hintOf("Maths") === (mac ? "⇧⌘M" : "Ctrl+Shift+M") && hintOf("Move section up") === (mac ? "⌃⌘↑" : "Ctrl+Up"), JSON.stringify(rows.map((r) => [r[1], r[2]])))
await shot("more-560")
await clickEl('.float-menu [data-bar=table]'); await sleep(350)
ok("Table from the dots writes the table cell after the caret's, the caret in its first header cell", (await doc()).includes("# One\n\nalpha words\n\n|  |  |\n| --- | --- |\n|  |  |\n|  |  |\n\n# Two"), JSON.stringify(await doc()))
const head = (await js(`document.querySelector('.cm-content').cmTile.view.state.selection.main.head`))
ok("...with the caret after '| ' on its header row", (await doc()).slice(head - 2, head) === "| ", String(head))
await key("z", MOD); await sleep(250)
ok("one undo takes the table back", (await doc()) === START, JSON.stringify(await doc()))
await setSel(START.indexOf("beta") + 1); await sleep(100)
await openMore(); await clickEl('.float-menu [data-bar=secup]'); await sleep(350)
ok("Move section up from the dots moves the caret's section above the one before it", (await doc()).indexOf("# Two") < (await doc()).indexOf("# One") && (await doc()).includes("beta words") && (await doc()).includes("alpha words"), JSON.stringify(await doc()))
await key("z", MOD); await sleep(250)
ok("one undo moves it back", (await doc()) === START, JSON.stringify(await doc()))
await openMore(); await clickEl('.float-menu [data-bar=maths]'); await sleep(350)
ok("Maths from the dots opens the palette (under the dots)", await js(`!!document.querySelector('.math-pop')`))
await key("Escape"); await sleep(250)
ok("Escape closes it", !(await js(`!!document.querySelector('.math-pop')`)))
await setRendered(true)
await openMore(); await clickEl('.float-menu [data-bar=textbox]'); await sleep(250)
const cb = await canvasBox()
await drag(cb.x + 400, cb.y + 300, cb.x + 560, cb.y + 340, { steps: 8 })
const placed = await saved(file, (d) => d.items.some((i) => i.kind === "shape"))
ok("Text box from the dots arms the placement: the next drag puts a text box down", placed.items.some((i) => i.kind === "shape" && i.shapeKind === "text"), JSON.stringify(placed.items.map((i) => i.kind + ":" + (i.shapeKind ?? ""))))
await setRendered(false)
await openMore()
await clickEl('.float-menu [data-bar=shapes]'); await sleep(250)
ok("Shapes in the dots opens its menu beside it", await js(`!!document.querySelector('.float-menu .float-menu.sub [data-bar=shape-rectangle]')`))
await closeMenu()

// ---- list, quote, code from the dots at 460
await pane(460)
await setDoc(START, START.indexOf("alpha") + 2)
await openMore()
const rows460 = await moreRows()
ok("at 460 the dots hold List, Quote and Code too (first)", JSON.stringify(rows460.slice(0, 3).map((r) => r[1])) === JSON.stringify(["List", "Quote", "Code"]), JSON.stringify(rows460.map((r) => r[1])))
await clickEl('.float-menu [data-bar=quote]'); await sleep(300)
ok("Quote from the dots quotes the caret's cell", (await doc()).includes("> alpha words"), JSON.stringify(await doc()))
await key("z", MOD); await sleep(250)
await setSel(START.indexOf("alpha") + 2); await sleep(100)
await openMore(); await clickEl('.float-menu [data-bar=list]'); await sleep(300)
ok("List from the dots writes the list style last picked (dots)", (await doc()).includes("- alpha words"), JSON.stringify(await doc()))
await key("z", MOD); await sleep(250)
await setSel(START.indexOf("alpha") + 2); await sleep(100)
await openMore(); await clickEl('.float-menu [data-bar=code]'); await sleep(300)
ok("Code from the dots makes a code cell", /```\n\n```/.test(await doc()), JSON.stringify(await doc()))
await key("z", MOD); await sleep(250)
ok("and the keyboard is the notes' after each", await js(`document.activeElement?.classList.contains('cm-content')`))

// ---- Customize toolbar… lives in the dots, and on a right-click
await openMore()
await clickEl('.float-menu [data-bar=customize]'); await sleep(300)
ok("Customize toolbar… in the dots opens the four-section checklist under them", await js(`document.querySelectorAll('.bar-context label').length === 4`))
await clickEl('.bar-context [data-section=pen]'); await sleep(250)
ok("unticking Pen takes the pen off the bar (it is shown only in the checklist)", await js(`!document.querySelector('[data-bar=pen]')`))
ok("and the bar is still one 36px row that fits", (await measure()).h === 36 && (await measure()).over <= 0.5)
await clickEl('.bar-context [data-section=pen]'); await sleep(250)
ok("ticking it brings the pen back", await js(`!!document.querySelector('[data-bar=pen]')`))
await key("Escape"); await sleep(200)
await unpane(); await sleep(300)
finish()
