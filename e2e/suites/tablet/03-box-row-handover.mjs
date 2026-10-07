// The dashed box's row of buttons on the tablet sheet, what was left (docs/TODO.md "The buttons under the sheet's box"):
//  1. a pen stroke that STARTS on the row is the sheet's, from its first point (it was lost: the feed sent the whole
//     contact to the button it began on); a pen TAP on a button still clicks it (renderer/penFeed.ts `data-pen-handover`);
//  2. the same for the mouse: a drag begun on a button pulls a box on the sheet from that point; a click still clicks
//     (BoxActions.tsx `watch`, boxRow.ts `rowPressToSheet`);
//  3. "Bring in as Drawing Cell" keeps the ink where it sat in the box: the box IS the cell (boxRow.ts `cellOfBox`).
// The pen comes through the native feed (the inject backend: samples -> manager -> IPC -> the page's synthesiser, the path
// Wintab's samples take); the box and the buttons get REAL mouse input (CDP).
import {
  js, ok, finish, sleep, freshNote, noGrab, showVideoPane, pickTablet, setSelect, tabletBox, waitFor, shot, mouse, drag, click,
  typeText, key, sidecar, saved,
} from "../../lib/harness.mjs"
import { feedConfig, inject, sample, sheetStrokes, strokeSamples } from "../../lib/penfeed.mjs"

await js(`localStorage.removeItem('writemind.pen')`)
await noGrab()
const file = await freshNote({ video: true })
await showVideoPane()
await pickTablet()
await setSelect("[data-tablet=orientation]", "0"); await sleep(350)   // the feed's samples land on the sheet as given

// ---- the note's words (the cell goes after the caret's paragraph)
const cm = JSON.parse(await js(`(()=>{const r=document.querySelector('.cm-content').getBoundingClientRect();return JSON.stringify({x:r.x,y:r.y})})()`))
await click(cm.x + 40, cm.y + 12)
await typeText("First paragraph.")
await key("Enter"); await key("Enter")
await typeText("Second paragraph.")
await sleep(300)

// ---- the native feed, through the inject backend
const state = () => js(`window.wm.pen.e2e.state().then(s => JSON.stringify({ active: s.active }))`).then(JSON.parse)
await waitFor(`!!window.__wmPenFeed`)
await feedConfig({ native: false, backends: ["inject"], focused: true }); await sleep(300)
await feedConfig({ capture: true }); await sleep(300)
for (let i = 0; i < 30 && (await state()).active !== "inject"; i++) { await inject([sample({ x: 0.45 + (i % 6) * 0.01, y: 0.5 })]); await sleep(50) }
ok("the inject backend feeds the sheet", (await state()).active === "inject")
await inject([sample({ x: 0.5, y: 0.5, inRange: false })]); await sleep(100)
await js(`window.__wmSheet.clear?.(); true`); await sleep(150)

const t = await tabletBox()
const toSheet = (p) => ({ x: (p.x - t.x) / t.w, y: (p.y - t.y) / t.h })
const toPx = (u) => ({ x: t.x + u.x * t.w, y: t.y + u.y * t.h })
const rect = (sel) => js(`(()=>{const e=document.querySelector(${JSON.stringify(sel)});if(!e)return null;const r=e.getBoundingClientRect();return JSON.stringify({x:r.x,y:r.y,w:r.width,h:r.height})})()`).then((v) => v && JSON.parse(v))
const centre = (r) => ({ x: r.x + r.w / 2, y: r.y + r.h / 2 })
const zig = (x0, y0, w, h, n = 8) => Array.from({ length: n + 1 }, (_, i) => ({ x: x0 + w * i / n, y: y0 + (i % 2 ? h : 0) }))
/** One handwritten word: two strokes in [x0, x0 + 0.18] x [y0, y0 + 0.08] (sheet fractions). */
const word = async (x0, y0) => { await inject(strokeSamples(zig(x0, y0, 0.18, 0.06))); await inject(strokeSamples(zig(x0 + 0.02, y0 + 0.03, 0.14, 0.05, 6))); await sleep(150) }
const boxOver = async (a, b) => { await sleep(400); const p = toPx(a), q = toPx(b); await drag(p.x, p.y, q.x, q.y, { steps: 10 }); await sleep(250) }
const inBox = (strokes, b) => strokes.filter((s) => s.points.every((p) => p.x >= b.x && p.x <= b.x + b.w && p.y >= b.y && p.y <= b.y + b.h)).length
const BOX = { x: 0.42, y: 0.15, w: 0.38, h: 0.3 }

// ---- the word, the box round it, the row under the box
await word(0.52, 0.22)
await boxOver({ x: BOX.x, y: BOX.y }, { x: BOX.x + BOX.w, y: BOX.y + BOX.h })
ok("the box and its row are up", !!(await rect(".camera .tablet .box")) && !!(await rect("[data-tablet=box-actions]")))
ok("the row hands a stroke that starts on it to the sheet (data-pen-handover)", await js(`document.querySelector('[data-tablet=box-actions]').hasAttribute('data-pen-handover')`))
let row = await rect("[data-tablet=box-actions]")
ok("the row lies on the sheet (under the box)", row && row.y >= t.y && row.y + row.h <= t.y + t.h, JSON.stringify({ row, t }))

// 1. a PEN stroke that starts on the Erase button
const erase0 = centre(await rect("[data-box-action=erase]"))
const u = toSheet(erase0)
let before = await sheetStrokes()
await sleep(200)
await inject(strokeSamples([u, { x: u.x + 0.004, y: u.y + 0.003 }, { x: u.x + 0.06, y: u.y + 0.12 }, { x: u.x + 0.12, y: u.y + 0.2 }]))
await sleep(250)
let after = await sheetStrokes()
const made = after.at(-1)
ok("a pen stroke begun on a box button is written on the sheet", after.length === before.length + 1, `${before.length} -> ${after.length}`)
ok("...from its FIRST point (where the pen touched the button)", made && Math.hypot((made.points[0].x - u.x) * t.w, (made.points[0].y - u.y) * t.h) < 1.5,
  JSON.stringify({ first: made?.points[0], u }))
ok("...with all of its points (the small first move kept)", made && made.points.length >= 10 && Math.abs(made.points.at(-1).y - (u.y + 0.2)) * t.h < 2, String(made?.points.length))
ok("...and the button was NOT clicked (the boxed word is still on the sheet; the box stays)", inBox(after, BOX) === 2 && !!(await rect(".camera .tablet .box")), String(inBox(after, BOX)))
await mouse("mouseMoved", t.x + t.w - 10, t.y + 10, { buttons: 0 })
await shot("stroke-from-row")

// a pen TAP on Erase still clicks it
await sleep(200)
await inject([sample({ x: u.x, y: u.y }), sample({ x: u.x, y: u.y, tip: true, p: 0.4 }), sample({ x: u.x + 0.001, y: u.y, tip: true, p: 0.4 }), sample({ x: u.x, y: u.y }), sample({ x: u.x, y: u.y, inRange: false })])
await sleep(300)
after = await sheetStrokes()
ok("a pen TAP on Erase still clicks it (the boxed word goes, nothing is written)", inBox(after, BOX) === 0 && after.length === before.length - 1, `${before.length + 1} -> ${after.length}`)
await js(`window.__wmSheet.undo(); true`); await sleep(200)
ok("(the sheet's Undo brings the word back)", inBox(await sheetStrokes(), BOX) === 2)

// 2. the MOUSE: a click on Erase still clicks; a drag begun on Bring in Writing pulls a box from that point
await sleep(400)
await click(erase0.x, erase0.y); await sleep(300)
ok("a mouse click on Erase still erases", inBox(await sheetStrokes(), BOX) === 0)
await js(`window.__wmSheet.undo(); true`); await sleep(200)
const strokesNow = (await sheetStrokes()).length
const note0 = (await sidecar(file)).items.length
const ink0 = centre(await rect("[data-box-action=ink]"))
const end = { x: ink0.x + 90, y: ink0.y + 60 }
await drag(ink0.x, ink0.y, end.x, end.y, { steps: 12 }); await sleep(300)
const nb = await rect(".camera .tablet .box")
ok("a mouse drag begun on Bring in Writing pulls a NEW box on the sheet from where it began",
  nb && Math.abs(nb.x - ink0.x) < 3 && Math.abs(nb.y - ink0.y) < 3 && Math.abs(nb.x + nb.w - end.x) < 3 && Math.abs(nb.y + nb.h - end.y) < 3, JSON.stringify({ nb, ink0, end }))
ok("...and Bring in Writing did not run (the sheet and the note as they were)", (await sheetStrokes()).length === strokesNow && (await sidecar(file)).items.length === note0,
  `${strokesNow} / ${note0}`)
ok("...the new box has its own row", !!(await rect("[data-tablet=box-actions]")))
await mouse("mouseMoved", t.x + t.w - 10, t.y + 10, { buttons: 0 })
await shot("box-from-row")
await key("Escape"); await sleep(150)

// 3. Bring in as Drawing Cell: the box is the cell, the ink where it sat in it
await js(`window.__wmSheet.clear(); true`); await sleep(150)
await sleep(200)
const W0 = { x: 0.6, y: 0.3 }
await word(W0.x, W0.y)
const ink = (await sheetStrokes()).flatMap((s) => s.points)
const inkMin = { x: Math.min(...ink.map((p) => p.x)), y: Math.min(...ink.map((p) => p.y)) }
const p1 = JSON.parse(await js(`(()=>{const l=document.querySelectorAll('.cm-line')[0];const r=l.getBoundingClientRect();return JSON.stringify({x:r.x+30,y:r.y+r.height/2})})()`))
await click(p1.x, p1.y); await sleep(150)
const CB = { x: 0.45, y: 0.2, w: 0.4, h: 0.3 }
await boxOver({ x: CB.x, y: CB.y }, { x: CB.x + CB.w, y: CB.y + CB.h })
const drawnBox = await rect(".camera .tablet .box")
const cellBtn = centre(await rect("[data-box-action=cell]"))
await sleep(200)
await click(cellBtn.x, cellBtn.y); await sleep(900)
const text = await js(`document.querySelector('.cm-content').cmTile.view.state.doc.toString()`)
const m = /!\[ink\]\(snapshots\/ink-([0-9a-f-]+)\.svg\)/.exec(text)
ok("Bring in as Drawing Cell writes a drawing cell after the caret's paragraph", !!m && text.startsWith(`First paragraph.\n\n${m[0]}`), JSON.stringify(text))
ok("...and the sheet keeps the writing (Sean, 2026-10-06)", (await sheetStrokes()).length > 0)
const cell = m ? (await saved(file, (d) => d.items.some((i) => i.kind === "cell" && i.id === m[1]))).items.find((i) => i.kind === "cell" && i.id === m[1]) : null
const live = m ? await rect(`.wm-inkcell[data-ink-cell="${m[1]}"]`) : null
if (cell && live) {
  const W = live.w
  const pts = cell.items.flatMap((i) => i.points)
  const cx = Math.min(...pts.map((p) => p.x)) * W, cy = Math.min(...pts.map((p) => p.y)) * W
  const H = cell.aspect * W
  // the air round the box (half the widest pen, and a pixel; the box is narrower than the column, so nothing is scaled)
  const air = Math.ceil(Math.max(...cell.items.map((i) => i.width)) / 2) + 1
  // landed px per sheet px, from the ink's own width (on the sheet and in the cell)
  const inkW = (Math.max(...ink.map((p) => p.x)) - inkMin.x) * t.w
  const k = (Math.max(...pts.map((p) => p.x)) - Math.min(...pts.map((p) => p.x))) * W / inkW
  // on the sheet, in its px: the box and the ink's offset in it
  const BH = drawnBox.h
  const OX = (inkMin.x * t.w + t.x) - drawnBox.x, OY = (inkMin.y * t.h + t.y) - drawnBox.y
  ok("the cell is the box: as tall as the box at the ink's own scale (plus a hair of air)", Math.abs(H - 2 * air - BH * k) < 3, JSON.stringify({ H, air, BH, k }))
  ok("the ink keeps where it sat in the box: as far down", Math.abs(cy - air - OY * k) < 3, JSON.stringify({ cy, want: air + OY * k }))
  ok("...and as far in (not at the cell's left pad)", Math.abs(cx - air - OX * k) < 3 && cx > 20, JSON.stringify({ cx, want: air + OX * k }))
} else ok("the cell's sidecar item and its widget are there", false, JSON.stringify({ cell: !!cell, live }))
await mouse("mouseMoved", t.x + t.w - 10, t.y + 10, { buttons: 0 })
await shot("cell-keeps-place")

// 4. the WINDOW's own pen (capture off: real DOM pen events, as Windows Ink delivers them) follows the same rule
await inject([sample({ x: 0.5, y: 0.5, inRange: false })])
await feedConfig({ capture: false }); await sleep(400)
await key("Escape"); await sleep(100)
await js(`window.__wmSheet.clear(); true`); await sleep(150)
const w0 = toPx({ x: 0.25, y: 0.25 }), w1 = toPx({ x: 0.42, y: 0.3 })
await drag(w0.x, w0.y, w1.x, w1.y, { steps: 8, pen: true }); await sleep(200)
ok("(capture off: the window pen writes on the sheet)", (await sheetStrokes()).length === 1)
await boxOver({ x: 0.2, y: 0.15 }, { x: 0.5, y: 0.4 })
const e1 = centre(await rect("[data-box-action=erase]"))
const n1 = (await sheetStrokes()).length
await drag(e1.x, e1.y, e1.x + 40, e1.y + 50, { steps: 10, pen: true }); await sleep(250)
const s1 = await sheetStrokes()
ok("a window-pen stroke begun on a box button is written on the sheet from its first point",
  s1.length === n1 + 1 && Math.hypot(s1.at(-1).points[0].x * t.w + t.x - e1.x, s1.at(-1).points[0].y * t.h + t.y - e1.y) < 1.5, JSON.stringify(s1.at(-1)?.points[0]))
ok("...and Erase was not clicked (the boxed stroke is still there, the box stays)", inBox(s1, { x: 0.2, y: 0.15, w: 0.3, h: 0.25 }) === 1 && !!(await rect(".camera .tablet .box")))
await mouse("mouseMoved", t.x + t.w - 10, t.y + 10, { buttons: 0 })
await shot("window-pen-from-row")

// 5. the header's Bring in ▾ (Sean, 2026-10-06): "To docked cell" makes Writing dock a drawing cell; the sheet keeps it
await key("Escape"); await sleep(100)
const cellsBefore = ((await js(`document.querySelector('.cm-content').cmTile.view.state.doc.toString()`)).match(/!\[ink\]/g) ?? []).length
await js(`document.querySelector('[data-tablet=bring-to]').click(); true`); await sleep(150)
ok("Bring in ▾ offers To writing and To docked cell", await js(`[...document.querySelectorAll('[data-bring-to]')].map(b => b.textContent).join('|')`) === "To writing|To docked cell")
await js(`document.querySelector('[data-bring-to=cell]').click(); true`); await sleep(150)
ok("...the choice is remembered", await js(`localStorage.getItem('writemind.bringInTo')`) === '"cell"')
const kept = (await sheetStrokes()).length
await js(`document.querySelector('.camera-bar [data-capture=ink]').click(); true`); await sleep(900)
const after5 = await js(`document.querySelector('.cm-content').cmTile.view.state.doc.toString()`)
ok("To docked cell: Writing docks a new drawing cell in the note", (after5.match(/!\[ink\]/g) ?? []).length === cellsBefore + 1, JSON.stringify(after5))
ok("...and the sheet keeps the writing", (await sheetStrokes()).length === kept && kept > 0)
await js(`document.querySelector('[data-tablet=bring-to]').click(); true`); await sleep(100)
await js(`document.querySelector('[data-bring-to=writing]').click(); true`); await sleep(100)
finish()
