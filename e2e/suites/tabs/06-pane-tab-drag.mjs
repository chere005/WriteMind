// @e2e isolated
// @e2e timeout=300
// REARRANGING THE VIDEO PANE'S TABS BY DRAGGING (Sean, 2026-10-10: "add rearranging tabs"): the camera's kept pages and the tablet's
// sheets drag as the notebook's tabs do, and their order is kept (in scans.json and sheets.json, so it survives a restart). The Live
// camera tab is first, is not draggable, and nothing can be dropped in front of it. The tab that is open stays open, and a plain
// click still opens a tab.
import {
  INSTANCE_DIR, showVideoPane, pickCamera, pickTablet, restartApp, js, ok, finish, sleep, freshNote, shot, waitFor, click, hover, mouse, key,
  rectOf,
} from "../../lib/harness.mjs"
const J = async (expr) => JSON.parse(await js(`JSON.stringify(${expr})`))
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b)

let at = [0, 0]
const grab = async (x, y) => { await hover(x, y); await mouse("mousePressed", x, y); at = [x, y] }
const slide = async (x, y, steps = 10) => {
  const [x0, y0] = at
  for (let i = 1; i <= steps; i++) await mouse("mouseMoved", x0 + (x - x0) * i / steps, y0 + (y - y0) * i / steps)
  at = [x, y]
  await sleep(250)
}
const letGo = async () => { await mouse("mouseReleased", at[0], at[1], { buttons: 0 }); await sleep(450) }

// ---- the camera's pages
await freshNote({ video: true })
await showVideoPane()
await pickCamera()
ok("the (fake) camera is delivering frames", await waitFor(`(() => { const v = document.querySelector('.camera video'); return v && v.videoWidth > 0 && v.readyState >= 2 })()`, 15000))
await sleep(600)

const pages = () => J(`[...document.querySelectorAll('.camera [data-scan-tab]')].map((t) => { const b = t.getBoundingClientRect()
  return { id: t.dataset.scanTab, name: t.querySelector('.name')?.textContent ?? '', on: t.getAttribute('aria-selected') === 'true', x: b.x, y: b.y, w: b.width, h: b.height, r: b.right,
    drag: t.dataset.drag ?? null, tx: new DOMMatrixReadOnly(getComputedStyle(t).transform).m41 } })`)
const names = async () => (await pages()).map((t) => t.name.replace(/^Live.*/, "Live"))
const open = async () => (await pages()).find((t) => t.on)?.name ?? null
const kept = () => js(`window.__wmScans.set().pages.map((p) => p.name)`)
const grip = (t) => [t.x + 24, t.y + t.h / 2]
const pressAdd = async () => { const r = await rectOf(".camera [data-scan-add]"); await click(r.x + r.w / 2, r.y + r.h / 2); await sleep(900) }

for (let i = 0; i < 3; i++) await pressAdd()
ok("three pages are kept after the Live tab, the last one open", same(await names(), ["Live", "Page 1", "Page 2", "Page 3"]) && (await open()) === "Page 3", JSON.stringify(await names()))

// the Live tab cannot be dragged
{
  const row = await pages()
  const [x, y] = grip(row[0])
  await grab(x, y)
  await slide(row[2].x + row[2].w / 2, y, 12)
  ok("a press on the Live tab dragged across the pages lifts nothing", (await pages()).every((t) => t.drag === null && t.tx === 0), JSON.stringify((await pages()).map((t) => [t.drag, t.tx])))
  await letGo()
  ok("...and Live stays first, the pages as they were, the open page still open", same(await names(), ["Live", "Page 1", "Page 2", "Page 3"]) && (await open()) === "Page 3", JSON.stringify(await names()))
}

// a kept page dragged: Page 3 to the first place
{
  const row = await pages()
  const from = row[3], to = row[1]
  const [x, y] = grip(from)
  await grab(x, y)
  await slide(to.x + to.w / 2 + (x - (from.x + from.w / 2)), y, 12)
  const mid = await pages()
  ok("a page's tab is lifted and follows the pointer, and the pages it passed step aside", mid[3].drag === "lifted" && Math.abs((mid[3].x - from.x) - (at[0] - x)) < 3 && mid[1].tx > 0 && mid[2].tx > 0 && mid[0].tx === 0, JSON.stringify(mid.map((t) => [t.drag, Math.round(t.tx)])))
  ok("nothing is rearranged until it is let go", same(await names(), ["Live", "Page 1", "Page 2", "Page 3"]) && same(await kept(), ["Page 1", "Page 2", "Page 3"]))
  await shot("dragging-page")
  await letGo()
  ok("let go, it lands first among the pages, behind Live", same(await names(), ["Live", "Page 3", "Page 1", "Page 2"]), JSON.stringify(await names()))
  ok("the kept list has the new order, and Page 3 is still the one open", same(await kept(), ["Page 3", "Page 1", "Page 2"]) && (await open()) === "Page 3", `${await kept()} ${await open()}`)
  ok("every tab is at rest again", (await pages()).every((t) => t.drag === null && t.tx === 0))
}

// a page dragged left past the Live tab lands first among the pages — never in front of Live
{
  const row = await pages()
  const from = row[3]
  const [x, y] = grip(from)
  await grab(x, y)
  await slide(row[0].x - 40, y, 14)
  await shot("past-live")
  await letGo()
  ok("dragged past the Live tab, a page lands first among the pages and Live stays first", same(await names(), ["Live", "Page 2", "Page 3", "Page 1"]), JSON.stringify(await names()))
  ok("(and the open page is still Page 3)", (await open()) === "Page 3")
}

// a plain click still opens a page; the tab dragged is not opened by the drag
{
  const row = await pages()
  await click(...grip(row[1]))
  await sleep(400)
  ok("a plain click on a page's tab opens it and moves nothing", (await open()) === "Page 2" && same(await names(), ["Live", "Page 2", "Page 3", "Page 1"]), `${await open()} ${await names()}`)
  const now = await pages()
  const [x, y] = grip(now[3])
  await grab(x, y)
  await slide(now[1].x + 20, y, 12)
  await letGo()
  ok("a page dragged, and not open, does not become the open one", same(await names(), ["Live", "Page 1", "Page 2", "Page 3"]) && (await open()) === "Page 2", `${await names()} ${await open()}`)
}

// Escape, and out of the row
{
  const row = await pages()
  const [x, y] = grip(row[1])
  await grab(x, y)
  await slide(x + 200, y, 12)
  ok("mid-drag, the tab is lifted", (await pages())[1].drag === "lifted")
  await key("Escape"); await sleep(400)
  ok("Escape: every tab is at rest and the order is what it was", (await pages()).every((t) => t.drag === null && t.tx === 0) && same(await names(), ["Live", "Page 1", "Page 2", "Page 3"]))
  await letGo()
  ok("...and the release does not open it", (await open()) === "Page 2" && same(await names(), ["Live", "Page 1", "Page 2", "Page 3"]))
  await grab(x, y)
  await slide(x + 120, y + 260, 14)
  ok("below the row the tab is dimmed and the others are where they were", (await pages())[1].drag === "out" && (await pages()).every((t, i) => i === 1 || t.tx === 0))
  await letGo()
  ok("let go there: nothing moved", same(await names(), ["Live", "Page 1", "Page 2", "Page 3"]) && same(await kept(), ["Page 1", "Page 2", "Page 3"]) && (await open()) === "Page 2")
}

// the order is kept across a restart (scans.json)
await js(`window.__wmScans.move(window.__wmScans.set().pages[2].id, 0)`); await sleep(300)
{
  ok("(arranged: Page 3, Page 1, Page 2)", same(await kept(), ["Page 3", "Page 1", "Page 2"]))
  await js(`window.__wmScans.flush()`)
  await sleep(600)
  await restartApp()
  await showVideoPane()
  await pickCamera()
  await waitFor(`!!document.querySelector('.camera [data-scan-tab]')`, 15000)
  await sleep(700)
  ok("after a restart the pages are in that order behind Live", same(await names(), ["Live", "Page 3", "Page 1", "Page 2"]) && same(await kept(), ["Page 3", "Page 1", "Page 2"]), `${await names()}`)
  await shot("camera-after-restart")
}

// ---- the tablet's sheets
await pickTablet()
const sheets = () => J(`[...document.querySelectorAll('.camera [data-sheet-id]')].map((t) => { const b = t.getBoundingClientRect()
  return { id: t.dataset.sheetId, name: t.querySelector('.name')?.textContent ?? '', on: t.getAttribute('aria-selected') === 'true', x: b.x, y: b.y, w: b.width, h: b.height,
    drag: t.dataset.drag ?? null, tx: new DOMMatrixReadOnly(getComputedStyle(t).transform).m41 } })`)
const sheetNames = async () => (await sheets()).map((t) => t.name)
const sheetOpen = async () => (await sheets()).find((t) => t.on)?.name ?? null
const addSheet = async () => { const r = await rectOf(".camera [data-sheet-add]"); await click(r.x + r.w / 2, r.y + r.h / 2); await sleep(350) }
const stored = () => js(`window.__wmSheets.view().tabs.map((t) => t.name)`)

await waitFor(`document.querySelectorAll('.camera [data-sheet-id]').length >= 1`, 8000)
const startNames = await sheetNames()
while ((await sheets()).length < 3) await addSheet()
const made = await sheetNames()
ok("three sheets in the tablet's row, the last open", made.length === 3 && (await sheetOpen()) === made[2], JSON.stringify([startNames, made]))
{
  const row = await sheets()
  const from = row[2], to = row[0]
  const [x, y] = grip(from)
  await grab(x, y)
  await slide(to.x + to.w / 2 + (x - (from.x + from.w / 2)), y, 12)
  const mid = await sheets()
  ok("a sheet's tab is lifted, follows the pointer, and the others step aside", mid[2].drag === "lifted" && mid[0].tx > 0 && mid[1].tx > 0, JSON.stringify(mid.map((t) => [t.drag, Math.round(t.tx)])))
  await shot("dragging-sheet")
  await letGo()
  const after = await sheetNames()
  ok("let go, the sheet is first", same(after, [made[2], made[0], made[1]]), JSON.stringify(after))
  ok("the sheet that was open is still open, and the stored order is the new one", (await sheetOpen()) === made[2] && same(await stored(), after), `${await sheetOpen()} ${await stored()}`)
  // dragged out of the row, or Escape: put back
  const row2 = await sheets()
  const [x2, y2] = grip(row2[0])
  await grab(x2, y2)
  await slide(x2 + 180, y2, 10)
  await key("Escape"); await sleep(400)
  await letGo()
  ok("Escape puts a sheet back, and its release opens nothing", same(await sheetNames(), after) && (await sheetOpen()) === made[2])
  await click(...grip((await sheets())[1])); await sleep(300)
  ok("a plain click on a sheet's tab still opens it", (await sheetOpen()) === after[1] && same(await sheetNames(), after), `${await sheetOpen()}`)
}
{
  await js(`window.__wmSheets.flush()`)
  await sleep(700)
  const arranged = await sheetNames()
  await restartApp()
  await showVideoPane()
  await waitFor(`document.querySelectorAll('.camera [data-sheet-id]').length >= 3`, 15000).catch(() => null)
  await sleep(700)
  if (!(await js(`!!document.querySelector('.camera [data-sheet-id]')`))) await pickTablet()
  await waitFor(`document.querySelectorAll('.camera [data-sheet-id]').length >= 3`, 15000)
  ok("after a restart the sheets are in the order they were dragged to", same(await sheetNames(), arranged), `${await sheetNames()} vs ${arranged}`)
  await shot("sheets-after-restart")
}
finish()
