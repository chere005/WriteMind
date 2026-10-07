// Scanned pages as tabs (Sean, 2026-10-07: "work on scanner tabs"): in the document camera the tab row shows the live
// "Camera" tab and a "+"; "+" keeps the camera's picture (the held one with Hold image) as a page of its own, with its
// box and its corners, and opens it; a tab switches, a double-click renames, the x asks first and closes. A kept page
// stands in the video's place and Writing / Page / Raw, the box, Straighten, Zoom and the turn work on IT, not on the
// live picture; it is kept across a restart. The fake camera plays moving.y4m: a block steps along the bottom one
// place a frame, so where the block is says which frame a picture is.
// @e2e video=moving
// @e2e isolated
// @e2e timeout=300
import fs from "node:fs"
import path from "node:path"
import { MOVING_DX, MOVING_X0 } from "../../lib/fixtures.mjs"
import {
  INSTANCE_DIR, showVideoPane, pickCamera, pickTablet, restartApp, js, ok, finish, sleep, freshNote, saved, shot, waitFor, click,
  dblclick, drag, rectOf, key, openNote,
} from "../../lib/harness.mjs"

const file = await freshNote({ video: true })
await showVideoPane()
await pickCamera()
const live = async () => waitFor(`(() => { const v = document.querySelector('.camera video'); return v && v.videoWidth > 0 && v.readyState >= 2 })()`, 15000)
ok("the (fake) camera is delivering frames", await live(), await js(`document.querySelector('.camera .trouble')?.textContent ?? ''`))
await sleep(600)

// Where the dark block starts on row 410 of the frame (frame pixels), in the live video, a page's picture, or a capture.
const BLOCK = `(c) => { const x = c.getContext('2d', { willReadFrequently: true }); const y = Math.round(410 * c.height / 480);
  const d = x.getImageData(0, y, c.width, 1).data; for (let i = 0; i < c.width; i++) if (d[i * 4] < 90) return Math.round(i * 640 / c.width); return -1 }`
const videoBlock = () => js(`(() => { const v = document.querySelector('.camera video'); const c = document.createElement('canvas');
  c.width = v.videoWidth; c.height = v.videoHeight; c.getContext('2d').drawImage(v, 0, 0); return (${BLOCK})(c) })()`)
const pageBlock = () => js(`(() => { const c = document.querySelector('.camera canvas.page-still'); return c && c.width > 0 ? (${BLOCK})(c) : -2 })()`)
const pictureBlock = (name) => js(`new Promise((res) => { const i = new Image(); i.crossOrigin = 'anonymous'; i.onerror = () => res(null)
  setTimeout(() => res(null), 5000)
  i.onload = () => { try { const c = document.createElement('canvas'); c.width = i.naturalWidth; c.height = i.naturalHeight; c.getContext('2d').drawImage(i, 0, 0)
    res({ w: c.width, h: c.height, x: (${BLOCK})(c) }) } catch (e) { res({ error: String(e) }) } }
  i.src = 'wm://media/' + encodeURIComponent(${JSON.stringify(name)}) })`)
const rounded = (v) => JSON.stringify(v, (k, x) => (typeof x === "number" ? Math.round(x * 1000) / 1000 : x))
const near = (a, b, d = 3) => a != null && b != null && Math.abs(a - b) <= d

const set = () => js(`window.__wmScans.set()`)
const tabs = () => js(`[...document.querySelectorAll('.camera [data-scan-tab]')].map((t) => ({ id: t.dataset.scanTab, name: t.querySelector('.name')?.textContent ?? '', on: t.getAttribute('aria-selected') === 'true' }))`)
const openTab = async (id) => { const r = await rectOf(`.camera [data-scan-tab="${id}"]`); await click(r.x + 14, r.y + r.h / 2); await sleep(350) }
const pageReady = (id) => waitFor(`(() => { const c = document.querySelector('.camera canvas.page-still'); return !!c && c.dataset.page === ${JSON.stringify(id)} && c.width > 0 })()`, 8000)
const addBtn = () => js(`(() => { const b = document.querySelector('.camera [data-scan-add]'); return b ? { disabled: b.disabled, title: b.title } : null })()`)
const pressAdd = async () => { const r = await rectOf(".camera [data-scan-add]"); await click(r.x + r.w / 2, r.y + r.h / 2); await sleep(900) }
const pressBar = async (sel) => { const r = await rectOf(sel); await click(r.x + r.w / 2, r.y + r.h / 2) }
const boxRect = () => js(`(() => { const b = document.querySelector('.camera .box-clip .box'); if (!b) return null; const r = b.getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height } })()`)
const images = async () => (await saved(file)).items.filter((i) => i.kind === "image")
const same = (a, b, d = 1.5) => a && b && ["x", "y", "w", "h"].every((k) => Math.abs(a[k] - b[k]) <= d)
const vf = await rectOf(".camera .viewfinder")
const fit = Math.min(vf.w / 640, vf.h / 480), ox = vf.x + (vf.w - 640 * fit) / 2, oy = vf.y + (vf.h - 480 * fit) / 2
const at = (fx, fy) => [ox + fx * fit, oy + fy * fit]

// ---- THE ROW BEFORE ANY PAGE: the Camera tab, open, and an enabled "+"
let row = await tabs()
ok("the row starts with the Camera tab only, and it is open", row.length === 1 && row[0].id === "camera" && row[0].on, JSON.stringify(row))
let add = await addBtn()
ok('"+" is enabled while the camera delivers a picture', add && !add.disabled, JSON.stringify(add))
ok("there are no pages kept yet", (await set()).pages.length === 0)
await shot("camera-only")

// ---- "+" KEEPS THE CAMERA'S PICTURE AND ITS BOX AS PAGE 1, AND OPENS IT
const [bx0, by0] = at(60, 50), [bx1, by1] = at(270, 150)
await drag(bx0, by0, bx1, by1, { steps: 8 })
await sleep(200)
const liveBox = await boxRect()
ok("a box is drawn on the live picture", !!liveBox)
await pressAdd()
let s = await set()
row = await tabs()
ok("+ makes a tab, Page 1, and opens it", row.length === 2 && row[1].name === "Page 1" && row[1].on && !row[0].on, JSON.stringify(row))
const p1 = s.pages[0]
ok("the page keeps the box (as fractions of the picture) and the picture's size", p1 && p1.box && p1.width === 640 && p1.height === 480 && Math.abs(p1.box.x - 60 / 640) < 0.02 && Math.abs(p1.box.width - 210 / 640) < 0.02, JSON.stringify(p1))
await pageReady(p1.id)
const block1 = await pageBlock()
ok("the page shows a picture of its own: a frame, the block on a step", block1 >= 0 && ((block1 - MOVING_X0) / MOVING_DX) % 1 < 0.1, String(block1))
ok("the video is out of sight and the page canvas is in", await js(`getComputedStyle(document.querySelector('.camera video')).visibility === 'hidden' && getComputedStyle(document.querySelector('.camera canvas.page-still')).display !== 'none'`))
const kept1 = await boxRect()
ok("the box is on the page, where it was drawn", same(kept1, liveBox), JSON.stringify({ kept1, liveBox }))
ok("the camera's box is spent: the Camera tab has none", (await (async () => { await openTab("camera"); const b = await boxRect(); await openTab(p1.id); return b })()) === null)
ok("Hold image is the camera's: disabled on a page", await js(`document.querySelector('.camera [data-camera=hold]').disabled`))
await shot("page-1")

// ---- A SECOND PAGE, LATER: its picture is another frame
await openTab("camera")
ok("the Camera tab is the live picture again", (await js(`getComputedStyle(document.querySelector('.camera video')).visibility`)) !== "hidden" && await js(`document.querySelector('.camera [data-camera=hold]').disabled === false`))
let wait = 0
while (near(await videoBlock(), block1, 2) && wait++ < 25) await sleep(120)
await pressAdd()
s = await set()
row = await tabs()
ok("a second + makes Page 2, open", row.length === 3 && row[2].name === "Page 2" && row[2].on, JSON.stringify(row))
const p2 = s.pages[1]
ok("Page 2 has no box", p2 && p2.box === null)
await pageReady(p2.id)
const block2 = await pageBlock()
ok("Page 2 is a different frame than Page 1", block2 >= 0 && !near(block2, block1, 2), `${block1} vs ${block2}`)
await openTab(p1.id)
await pageReady(p1.id)
ok("...and Page 1 still shows its own", near(await pageBlock(), block1, 1), String(await pageBlock()))
ok("opening a page puts its box back, the other page has none", same(await boxRect(), liveBox) )
await openTab(p2.id)
ok("Page 2 shows no box", (await boxRect()) === null)

// ---- WRITING / IMAGE / RAW work on the STORED page, not on the live picture
await pageReady(p2.id)
await pressBar(".camera-bar [data-capture=raw]")
await sleep(1500)
let pics = await images()
ok("Raw on Page 2 took one picture", pics.length === 1, JSON.stringify(pics.map((i) => i.file)) + " | " + await js(`(document.querySelector('.camera .trouble')?.textContent ?? '') + ' | ' + document.querySelector('.camera .note').innerText + ' | disabled=' + document.querySelector('.camera-bar [data-capture=raw]').disabled`))
const raw = pics[0] && await pictureBlock(pics[0].file)
ok("it is Page 2's frame, not the live one", raw && near(raw.x, block2, 2) && raw.w === 640, JSON.stringify({ raw, block2, liveNow: await videoBlock() }))
ok("the page stays: the tab is still there, open", (await tabs()).length === 3 && (await tabs())[2].on)

await openTab(p1.id)
await pageReady(p1.id)
const choice = await rectOf(".camera .box-choices [data-section=writing]")
ok("the box's own Writing / Image choices show on a page", !!choice && !!(await rectOf(".camera .box-choices [data-section=image]")))
if (choice) await click(choice.x + choice.w / 2, choice.y + choice.h / 2)
await waitFor(`!document.querySelector('.camera .box-clip .box')`, 15000)
await sleep(400)
pics = await images()
ok("Writing from the box on Page 1 came in", pics.length === 2, (await js(`(document.querySelector('.camera .trouble')?.textContent ?? '') + ' | ' + document.querySelector('.camera .note').innerText`)))
ok("the box is spent (the page keeps none now) and the page stays open", (await set()).pages[0].box === null && (await tabs())[1].on)
await shot("page-1-after-writing")

// ---- THE TURN, STRAIGHTEN AND ZOOM ARE THE PAGE'S OWN
const turnBefore = await js(`document.querySelector('.camera video').dataset.turn`)
await js(`document.querySelector('[data-camera-turn=right]').click()`)
await sleep(400)
s = await set()
ok("turning a page turns that page only", s.pages[0].rotation === 90 && s.pages[1].rotation === 0, JSON.stringify(s.pages.map((p) => p.rotation)))
ok("...the live camera's turn is as it was", (await js(`document.querySelector('.camera video').dataset.turn`)) === turnBefore && await js(`localStorage.getItem('writemind.cameraRotation')`) !== "90", `${turnBefore} / ${await js(`document.querySelector('.camera video').dataset.turn`)} / ${await js(`localStorage.getItem('writemind.cameraRotation')`)}`)
ok("the page canvas is drawn turned a quarter", (await js(`document.querySelector('.camera canvas.page-still').style.transform`)).includes("rotate(90deg)"))
// a box on the turned page (screen space: the picture is now 480 x 640), kept
const rect = await rectOf(".camera .viewfinder")
await drag(rect.x + rect.w * 0.38, rect.y + rect.h * 0.36, rect.x + rect.w * 0.62, rect.y + rect.h * 0.6, { steps: 8 })
await sleep(250)
const turnedBox = await boxRect()
ok("a box drawn on the turned page is kept with it", !!turnedBox && !!(await set()).pages[0].box)
await openTab(p2.id)
await pageReady(p2.id)
ok("Page 2 is not turned and has no box", (await set()).pages[1].rotation === 0 && (await boxRect()) === null)
// Straighten on Page 2
await js(`[...document.querySelectorAll('.camera-bar button')].find(b => b.title.startsWith('Square the page up')).click()`)
await sleep(500)
ok("Straighten shows its four corners on a kept page", await js(`document.querySelectorAll('.camera .quad-corner').length`) === 4)
s = await set()
ok("the page keeps that it is straightened, and its corners", s.pages[1].straighten === true && !!s.pages[1].quad, JSON.stringify(s.pages[1]))
await openTab(p1.id)
ok("Page 1 shows no corners", await js(`document.querySelectorAll('.camera .quad-corner').length`) === 0)
await openTab("camera")
ok("the Camera tab shows no corners either (its own Straighten is off)", await js(`document.querySelectorAll('.camera .quad-corner').length`) === 0)
await openTab(p2.id)
ok("Page 2 has its corners again", await js(`document.querySelectorAll('.camera .quad-corner').length`) === 4)
// Zoom on a page
ok("Zoom is on offer on a page", !(await js(`document.querySelector('[data-camera-zoom=square]').disabled`)))

// ---- RENAME, AND CLOSE ASKS
const r2 = await rectOf(`.camera [data-scan-tab="${p1.id}"] .name`)
await dblclick(r2.x + r2.w / 2, r2.y + r2.h / 2)
await sleep(200)
ok("a double-click opens a name field", await js(`!!document.querySelector('.camera input[data-sheet-name]')`))
await js(`(() => { const i = document.querySelector('.camera input[data-sheet-name]'); const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set; set.call(i, 'Receipt'); i.dispatchEvent(new Event('input', { bubbles: true })) })()`)
await key("Enter")
await sleep(250)
ok("Enter keeps the new name", (await set()).pages[0].name === "Receipt" && (await tabs())[1].name === "Receipt", JSON.stringify(await tabs()))

await openTab("camera")
await pressAdd()
s = await set()
ok("a third page, from the Camera tab", s.pages.length === 3 && s.current === s.pages[2].id && s.pages[2].name === "Page 3", JSON.stringify(s.pages.map((p) => p.name)))
const p3 = s.pages[2]
ok("the third picture is on disk, in the profile's scans folder", fs.existsSync(path.join(INSTANCE_DIR, "profile", "scans", `${p3.id}.jpg`)))
await js(`document.querySelector('[data-scan-close="${p3.id}"]').click()`)
await sleep(200)
ok("the first press asks: Close?, and nothing is lost yet", (await js(`document.querySelector('[data-scan-close="${p3.id}"]').textContent`)) === "Close?" && (await set()).pages.length === 3)
await js(`document.querySelector('[data-scan-close="${p3.id}"]').click()`)
await sleep(400)
s = await set()
ok("the second closes it: the page and its picture file are gone, the neighbour opens", s.pages.length === 2 && s.current === p2.id && !fs.existsSync(path.join(INSTANCE_DIR, "profile", "scans", `${p3.id}.jpg`)), JSON.stringify({ current: s.current, n: s.pages.length }))
// A "Close?" that is not followed up goes by itself
await js(`document.querySelector('[data-scan-close="${p2.id}"]').click()`)
await sleep(3400)
ok("a Close? that nobody confirms takes itself back", (await js(`document.querySelector('[data-scan-close="${p2.id}"]').textContent`)) === "×" && (await set()).pages.length === 2)

// "+" from a page takes the LIVE camera picture
const before = (await set()).pages.length
await openTab(p2.id)
await pressAdd()
s = await set()
ok('"+" on a page keeps the live camera picture as a new page', s.pages.length === before + 1 && s.pages[2].box === null && s.pages[2].straighten === false, JSON.stringify(s.pages[2]))
await js(`document.querySelector('[data-scan-close="${s.pages[2].id}"]').click()`)
await js(`document.querySelector('[data-scan-close="${s.pages[2].id}"]').click()`)
await sleep(400)

// ---- THE TABLET AND BACK: the pages are still there, and the tablet shows no page tabs
await openTab(p1.id)
await pickTablet()
ok("the tablet's row is the sheets' own, with no page tabs", await js(`!document.querySelector('[data-scan-tab]') && !!document.querySelector('.camera [data-sheets=tablet]')`))
await pickCamera()
await live()
await sleep(500)
row = await tabs()
ok("back on the camera the pages are in the row, the open one still open", row.length === 3 && row[1].on, JSON.stringify(row))
await pageReady(p1.id)
ok("...and the picture is drawn again", near(await pageBlock(), block1, 1))

// ---- "+" WITH HOLD IMAGE KEEPS THE HELD FRAME, not the live one
await openTab("camera")
await pressBar(".camera [data-camera=hold]")
await sleep(300)
const heldBlock = await js(`(() => { const c = document.querySelector('.camera canvas.still'); const x = c.getContext('2d', { willReadFrequently: true }); const y = Math.round(410 * c.height / 480);
  const d = x.getImageData(0, y, c.width, 1).data; for (let i = 0; i < c.width; i++) if (d[i * 4] < 90) return Math.round(i * 640 / c.width); return -1 })()`)
await sleep(700)
await pressAdd()
s = await set()
const heldPage = s.pages[s.pages.length - 1]
await pageReady(heldPage.id)
ok("a page kept while the picture is held is the held frame", near(await pageBlock(), heldBlock, 1), `${await pageBlock()} vs held ${heldBlock}, live ${await videoBlock()}`)
await openTab("camera")
ok("...and the camera tab is still holding it", await js(`document.querySelector('.camera [data-camera=hold]').getAttribute('aria-pressed') === 'true'`))
await pressBar(".camera [data-camera=hold]")
await js(`document.querySelector('[data-scan-close="${heldPage.id}"]').click()`)
await js(`document.querySelector('[data-scan-close="${heldPage.id}"]').click()`)
await sleep(400)
ok("(that page closed again)", (await set()).pages.length === 2)
await openTab(p1.id)

// ---- KEPT ACROSS A RESTART
await js(`window.__wmScans.flush()`)
await sleep(600)
const beforeRestart = await set()
await restartApp()
await showVideoPane()
await pickCamera()
await live()
await sleep(700)
s = await set()
row = await tabs()
ok("after a restart the pages are in the row, and the app starts on the camera", row.length === 3 && row[0].on && row[1].name === "Receipt" && row[2].name === "Page 2", JSON.stringify(row))
ok("each page has everything it had: size, turn, box, corners, shape",
  s.pages.length === 2 && ["id", "width", "height", "rotation", "straighten"].every((k) => s.pages[0][k] === beforeRestart.pages[0][k] && s.pages[1][k] === beforeRestart.pages[1][k])
  && rounded(s.pages[0].box) === rounded(beforeRestart.pages[0].box) && rounded(s.pages[1].quad) === rounded(beforeRestart.pages[1].quad) && Math.abs((s.pages[1].shape ?? 0) - (beforeRestart.pages[1].shape ?? 0)) < 1e-4,
  JSON.stringify(s.pages))
await openTab(p2.id)
await pageReady(p2.id)
ok("Page 2's picture came back from its file: the same frame", near(await pageBlock(), block2, 1), `${await pageBlock()} vs ${block2}`)
ok("its corners are there", await js(`document.querySelectorAll('.camera .quad-corner').length`) === 4)
await openTab(p1.id)
await pageReady(p1.id)
ok("Page 1's picture, turn and box came back", near(await pageBlock(), block1, 1) && (await js(`document.querySelector('.camera canvas.page-still').style.transform`)).includes("rotate(90deg)") && !!(await boxRect()), JSON.stringify(await boxRect()))
await shot("after-restart")
// Image from the restored page's box works as before the restart (into the note, open again)
await openNote(file.split(/[\\/]/).pop().replace(/\.wm$/, ""))
await sleep(500)
const again = await rectOf(".camera .box-choices [data-section=image]")
if (again) await click(again.x + again.w / 2, again.y + again.h / 2)
await waitFor(`!document.querySelector('.camera .box-clip .box')`, 15000)
await sleep(400)
ok("Image from a restored page's box comes in", (await images()).length === 3, `${!!again} | ${(await images()).length} | ${await js(`(document.querySelector('.camera .trouble')?.textContent ?? '') + ' | ' + document.querySelector('.camera .note').innerText + ' | open=' + !!document.querySelector('.wm-canvas')`)}`)
finish()
