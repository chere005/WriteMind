// @e2e isolated
// @e2e timeout=300
// REARRANGING THE NOTEBOOK'S TABS BY DRAGGING (Sean, 2026-10-10: "add rearranging tabs"). A real mouse (CDP input events) presses a
// tab, moves, and lets go: the tab follows the pointer once it has moved a few pixels, the tabs it passes step aside, it lands where
// it is let go and the open-notes list shows the new order. A plain click still opens a tab and a middle click still closes one;
// Escape, or letting go above / below the row, puts the tab back; a tab dropped on the sidebar does nothing; the tab in front stays in
// front; nothing is written to a note and Undo has nothing new; the window does not move; the order survives a reload and a restart,
// closing and opening other tabs; and on a row that scrolls a drag held at the end scrolls it under the pointer.
import fs from "node:fs"
import path from "node:path"
import {
  js, ok, finish, sleep, shot, seedNotes, closeAllTabs, openNote, centerOf, rectOf, click, hover, mouse, key, setWindowSize, notesDir,
  menu, windowInfo, reloadApp, restartApp, waitFor, clickEl,
} from "../../lib/harness.mjs"
const J = async (expr) => JSON.parse(await js(`JSON.stringify(${expr})`))

const names = ["Alpha", "Bravo", "Charlie", "Delta", "Echo", "Foxtrot", "Golf", "Hotel"]
await seedNotes(Object.fromEntries(names.map((n, i) => [`${n}.md`, `# ${n}\n\nbody ${i}\n`])), { clean: true })
await js(`localStorage.clear()`)
await closeAllTabs()

// ---- what the row looks like, read from the page
const tabs = () => J(`[...document.querySelectorAll('.tab-strip .tab')].map((t) => { const b = t.getBoundingClientRect()
  return { name: t.querySelector('.name').textContent, open: t.classList.contains('open'), x: b.x, y: b.y, w: b.width, h: b.height, r: b.right,
    drag: t.dataset.drag ?? null, tx: new DOMMatrixReadOnly(getComputedStyle(t).transform).m41, path: t.dataset.path } })`)
const order = async () => (await tabs()).map((t) => t.name)
const front = async () => (await tabs()).find((t) => t.open)?.name ?? null
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b)
const listed = async () => {
  await clickEl("[data-bar=tab-list]"); await sleep(250)
  const rows = await J(`[...document.querySelectorAll('.float-menu button')].map((b) => ({ text: b.textContent.trim(), checked: b.getAttribute('aria-checked') }))`)
  await key("Escape"); await sleep(200)
  return rows.filter((r) => r.checked !== null).map((r) => ({ name: r.text.replace(/^\u2713\s*/, ""), on: r.checked === "true" }))
}
const stripBox = () => rectOf(".tab-strip")

// ---- a hand on the mouse: press, move in steps, let go (each is a real mouse event)
let at = [0, 0]
const grab = async (x, y) => { await hover(x, y); await mouse("mousePressed", x, y); at = [x, y] }
const slide = async (x, y, steps = 10) => {
  const [x0, y0] = at
  for (let i = 1; i <= steps; i++) await mouse("mouseMoved", x0 + (x - x0) * i / steps, y0 + (y - y0) * i / steps)
  at = [x, y]
  await sleep(250)   // (the tabs it passed take a moment to step aside)
}
const letGo = async () => { await mouse("mouseReleased", at[0], at[1], { buttons: 0 }); await sleep(450) }
/** Where on a tab to press: the left of its name, clear of the ×. */
const grip = (t) => [t.x + 22, t.y + t.h / 2]
const dragTab = async (from, toName) => {
  const row = await tabs()
  const a = row.find((t) => t.name === from), b = row.find((t) => t.name === toName)
  const [x, y] = grip(a)
  await grab(x, y)
  await slide(b.x + b.w / 2 + (b.x > a.x ? 6 : -6) + (x - (a.x + a.w / 2)), y)
  await letGo()
}

const root = await notesDir()
const mtimes = () => Object.fromEntries(fs.readdirSync(root).filter((f) => /\.(wm|md)$/.test(f)).map((f) => [f, fs.statSync(path.join(root, f)).mtimeMs]))
const undoLabel = async () => (await menu()).find((m) => m.label === "Edit")?.submenu.find((i) => /^Undo/.test(i.label))?.label
const bounds = async () => JSON.stringify((await windowInfo()).bounds)

for (const n of ["Alpha", "Bravo", "Charlie", "Delta", "Echo"]) await openNote(n)
let row = await tabs()
ok("five notes are open, in the order they were opened, the last in front", same(await order(), ["Alpha", "Bravo", "Charlie", "Delta", "Echo"]) && (await front()) === "Echo", JSON.stringify(row.map((t) => [t.name, t.open])))
ok("the tabs and the strip are not window-drag regions (a press on a tab never moves the window)", await js(`(() => { const t = document.querySelector('.tab'); const s = document.querySelector('.tab-strip')
  return getComputedStyle(t).webkitAppRegion === 'no-drag' && getComputedStyle(s).webkitAppRegion === 'no-drag' && getComputedStyle(document.querySelector('.tab-room')).webkitAppRegion === 'drag' })()`))

const filesBefore = mtimes(), undoBefore = await undoLabel(), windowBefore = await bounds()

// ---- 1. A DRAG: Alpha to Charlie's place
{
  const t0 = await tabs()
  const [x, y] = grip(t0[0])
  await grab(x, y)
  await slide(x + 3, y, 1)
  ok("a few pixels of movement are not yet a drag (no tab is lifted)", (await tabs()).every((t) => t.drag === null))
  await slide(t0[2].x + t0[2].w / 2 + 6, y, 12)
  const mid = await tabs()
  ok("the tab is lifted and follows the pointer", mid[0].drag === "lifted" && Math.abs((mid[0].x - t0[0].x) - (at[0] - x)) < 3, JSON.stringify([mid[0].drag, mid[0].x - t0[0].x, at[0] - x]))
  ok("the tabs it passed step aside by its width; the rest stay", Math.abs(mid[1].tx + t0[0].w) < 2 && Math.abs(mid[2].tx + t0[0].w) < 2 && mid[3].tx === 0 && mid[4].tx === 0, JSON.stringify(mid.map((t) => Math.round(t.tx))))
  ok("nothing is rearranged until it is let go, and the tab in front stays in front", same(mid.map((t) => t.name), names.slice(0, 5)) && (await front()) === "Echo")
  ok("the page shows the grab (no text is selected)", await js(`document.documentElement.dataset.tabDragging !== undefined && !getSelection().toString()`))
  await shot("dragging")
  await letGo()
  ok("let go, it lands where it was dropped: Bravo, Charlie, Alpha, Delta, Echo", same(await order(), ["Bravo", "Charlie", "Alpha", "Delta", "Echo"]), JSON.stringify(await order()))
  const after = await tabs()
  ok("every tab is at rest again (no lift, no offset), and the one in front is still Echo", after.every((t) => t.drag === null && t.tx === 0) && (await front()) === "Echo" && (await js(`document.documentElement.dataset.tabDragging === undefined`)), JSON.stringify(after.map((t) => [t.drag, t.tx])))
  ok("the click that ends a drag did not open the tab dragged", (await front()) === "Echo" && (await js(`document.querySelector('.cm-content').textContent.includes('body 4')`)))
  await shot("dropped")
}
{
  const rows = await listed()
  ok("the open-notes list shows the new order, the note in front checked", same(rows.map((r) => r.name), ["Bravo", "Charlie", "Alpha", "Delta", "Echo"]) && rows.filter((r) => r.on).map((r) => r.name).join() === "Echo", JSON.stringify(rows))
}

// ---- 2. A CLICK is still a click, a middle click still closes
{
  const t0 = await tabs()
  await click(...grip(t0[1]))
  ok("a plain click on a tab opens it and rearranges nothing", (await front()) === "Charlie" && same(await order(), ["Bravo", "Charlie", "Alpha", "Delta", "Echo"]), `${await front()} ${await order()}`)
  // a press that wobbles by a pixel or two is still a click
  const [x, y] = grip(t0[0])
  await grab(x, y); await slide(x + 2, y + 1, 2); await letGo()
  ok("a press that moves two pixels is a click: it opens that tab", (await front()) === "Bravo" && same(await order(), ["Bravo", "Charlie", "Alpha", "Delta", "Echo"]), `${await front()} ${await order()}`)
}

// ---- 3. Dragging the tab in front moves it and keeps it in front; a tab not in front does not become it
{
  await dragTab("Bravo", "Echo")
  ok("the tab in front dragged to the end stays in front", same(await order(), ["Charlie", "Alpha", "Delta", "Echo", "Bravo"]) && (await front()) === "Bravo", `${await order()} ${await front()}`)
  await dragTab("Echo", "Charlie")
  ok("a tab that is not in front, dragged, does not take its place", same(await order(), ["Echo", "Charlie", "Alpha", "Delta", "Bravo"]) && (await front()) === "Bravo", `${await order()} ${await front()}`)
  const loose = await tabs()
  ok("the note shown is still the one in front", await js(`document.querySelector('.cm-content').textContent.includes('body 1')`))
  ok("no tab was left lifted or offset", loose.every((t) => t.drag === null && t.tx === 0))
}

// ---- 4. ESCAPE puts the tab back
{
  const was = await order(), frontWas = await front()
  const t0 = await tabs()
  const [x, y] = grip(t0[0])
  await grab(x, y)
  await slide(x + 260, y, 12)
  ok("mid-drag the first tab is lifted and has the tabs it passed out of its way", (await tabs())[0].drag === "lifted" && (await tabs())[1].tx < 0)
  await key("Escape"); await sleep(400)
  const cancelled = await tabs()
  ok("Escape: every tab is back at rest and nothing is lifted", cancelled.every((t) => t.drag === null && t.tx === 0) && await js(`document.documentElement.dataset.tabDragging === undefined`), JSON.stringify(cancelled.map((t) => [t.drag, Math.round(t.tx)])))
  ok("Escape: the order is what it was", same(await order(), was))
  await letGo()
  ok("and the release that follows does not open the tab or move anything", same(await order(), was) && (await front()) === frontWas, `${await order()} ${await front()}`)
  // the drag is over: the pointer moving with no button changes nothing
  await hover(x + 300, y); await sleep(100)
  ok("(a hover after it moves nothing)", (await tabs()).every((t) => t.drag === null && t.tx === 0))
}

// ---- 5. A tab dragged OUT of the row snaps back — over the page, and over the sidebar
{
  const was = await order(), frontWas = await front()
  const t0 = await tabs()
  const [x, y] = grip(t0[2])
  await grab(x, y)
  await slide(x + 200, y + 220, 14)
  const out = await tabs()
  ok("below the row the tab is dimmed and the others are back in their places", out[2].drag === "out" && out.filter((t, i) => i !== 2).every((t) => t.tx === 0), JSON.stringify(out.map((t) => [t.drag, Math.round(t.tx)])))
  await letGo()
  ok("let go over the page: nothing moved, nothing opened", same(await order(), was) && (await front()) === frontWas && (await tabs()).every((t) => t.drag === null && t.tx === 0), `${await order()} ${await front()}`)

  const rowsBefore = await js(`[...document.querySelectorAll('.note-row')].map((r) => r.dataset.path).join('|')`)
  const filesNow = fs.readdirSync(root).sort().join('|')
  const sidebar = await rectOf(".note-row")
  await grab(x, y)
  await slide(x - 80, y, 6)
  await slide(sidebar.x + 40, sidebar.y + sidebar.h / 2, 14)
  ok("over the sidebar it is a tab still, dimmed", (await tabs())[2].drag === "out")
  await letGo()
  ok("dropped on a sidebar note nothing happens: no tab moved, no note moved or opened", same(await order(), was) && (await front()) === frontWas
    && (await js(`[...document.querySelectorAll('.note-row')].map((r) => r.dataset.path).join('|')`)) === rowsBefore && fs.readdirSync(root).sort().join('|') === filesNow, `${await order()} ${await front()}`)
  // and the sidebar's own drag is untouched: a note row is still draggable
  ok("the sidebar's rows are still draggable", await js(`document.querySelector('.note-row').getAttribute('draggable') === 'true'`))
}

// ---- 6. NOTHING IS WRITTEN, NO UNDO STEP, THE WINDOW STAYED
{
  const now = mtimes()
  ok("no note was written by any of it", same(now, filesBefore), JSON.stringify({ before: filesBefore, now }))
  ok("Edit ▸ Undo has nothing new to take back", (await undoLabel()) === undoBefore, `${undoBefore} -> ${await undoLabel()}`)
  ok("the window did not move or resize", (await bounds()) === windowBefore, `${windowBefore} -> ${await bounds()}`)
  const order0 = await order()
  await js(`document.querySelector('.cm-content').focus()`)
  await key("z", { ctrl: true }); await sleep(300)
  ok("Ctrl+Z does not undo an arrangement", same(await order(), order0), `${order0} -> ${await order()}`)
}

// ---- 7. THE ORDER IS KEPT: closing and opening other tabs, a reload, a restart
{
  const before = await order()
  const gone = before[before.length - 1]
  await js(`[...document.querySelectorAll('.tab')].find((t) => t.querySelector('.name').textContent === ${JSON.stringify(gone)}).querySelector('.close').click()`); await sleep(500)
  ok("closing a tab leaves the others in their order", same(await order(), before.slice(0, -1)), `${before} -> ${await order()}`)
  await openNote("Foxtrot")
  ok("a note opened after goes on the end, the others as they were", same(await order(), [...before.slice(0, -1), "Foxtrot"]) && (await front()) === "Foxtrot", `${await order()} ${await front()}`)
  // a middle click closes a tab (a real one) — and is not a drag
  const t0 = await tabs()
  const mid = t0[1]
  await hover(...grip(mid)); await mouse("mousePressed", ...grip(mid), { button: "middle", buttons: 4 }); await mouse("mouseReleased", ...grip(mid), { button: "middle", buttons: 0 }); await sleep(500)
  ok("a middle click on a tab still closes it", same(await order(), t0.filter((t) => t !== mid).map((t) => t.name)), `${await order()}`)
  await dragTab("Foxtrot", t0[0].name)
  const kept = await order(), keptFront = await front()
  ok("(the arrangement to keep)", kept[0] === "Foxtrot" && kept.length === 4, JSON.stringify(kept))
  await sleep(900)
  await reloadApp()
  await waitFor(`document.querySelectorAll('.tab').length === ${kept.length}`, 15000)
  ok("after a reload the tabs come back in that order, the same one in front", same(await order(), kept) && (await front()) === keptFront, `${await order()} ${await front()}`)
  await sleep(900)
  await restartApp()
  await waitFor(`document.querySelectorAll('.tab').length === ${kept.length}`, 20000)
  ok("after a restart the tabs come back in that order, the same one in front", same(await order(), kept) && (await front()) === keptFront, `${await order()} ${await front()}`)
  ok("and the open-notes list shows it", same((await listed()).map((r) => r.name), kept))
}

// ---- 8. A ROW THAT SCROLLS: the drag held at an end scrolls it under the pointer
{
  await closeAllTabs()
  for (const n of names) await openNote(n)
  await js(`document.querySelector('[data-bar=sidebar]').click()`); await sleep(300)
  await setWindowSize(460, 800); await sleep(700)
  const scroller = () => J(`(() => { const s = document.querySelector('.tab-strip'); return { left: s.scrollLeft, max: s.scrollWidth - s.clientWidth } })()`)
  await js(`document.querySelector('.tab-strip').scrollLeft = 0`); await sleep(150)
  let sc = await scroller()
  ok("eight tabs do not fit in 460px: the row scrolls", sc.max > 300, JSON.stringify(sc))
  const strip = await stripBox()
  const t0 = await tabs()
  const first = t0.find((t) => t.x >= strip.x - 1)
  const start = await order()
  const [gx, gy] = grip(first)
  await grab(gx, gy)
  await slide(strip.x + strip.w - 8, gy, 10)
  const held0 = (await scroller()).left
  await sleep(900)
  const held = await scroller()
  ok("held near the right end, the row scrolls under the drag", held.left > held0 + 100 || held.left >= held.max - 1, JSON.stringify([held0, held]))
  const lifted = (await tabs()).find((t) => t.drag === "lifted")
  ok("and the tab is still under the pointer (inside the row)", lifted && lifted.x >= strip.x - 4 && lifted.r <= strip.x + strip.w + 4 && lifted.x <= at[0] && lifted.r >= at[0] - 12, JSON.stringify([lifted, at, strip]))
  await shot("scrolling")
  await letGo()
  const after = await order()
  const index = after.indexOf(start[start.indexOf(first.name)])
  ok("let go at the end: it moved far beyond what was in view", index >= 5 && after.length === start.length && same([...after].sort(), [...start].sort()), JSON.stringify([after, index]))
  // and back to the left end
  await sleep(200)
  const now = await tabs()
  const mover = now.find((t) => t.name === first.name)
  const visible = mover.x >= strip.x - 1 && mover.r <= strip.x + strip.w + 1
  ok("the tab dropped is in view (the row follows it)", visible, JSON.stringify([mover, strip]))
  const [lx, ly] = grip(mover)
  await grab(lx, ly)
  await slide(strip.x + 8, ly, 10)
  const back0 = (await scroller()).left
  await sleep(1200)
  const back = await scroller()
  ok("held near the left end, the row scrolls back", back.left < back0 - 100 || back.left <= 1, JSON.stringify([back0, back]))
  await letGo()
  const home = await order()
  ok("let go at the left end, the tab lands near the start", home.indexOf(first.name) <= 1, JSON.stringify(home))
  await shot("scrolled-back")
  await setWindowSize(1440, 900); await sleep(400)
}
finish()
