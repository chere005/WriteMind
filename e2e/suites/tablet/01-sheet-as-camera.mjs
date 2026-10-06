// The tablet as a source for the video pane: write, box, chart, page, undo, erase. 
import { hover, setSelect, press, noGrab, penHover, js, ok, finish, sleep, freshNote, saved, key, CTRL, ALT, mouse, pe, penStroke, seg, rectPts, tabletBox, pickTablet, barBtn, takeBtn, shot, waitFor } from "../../lib/harness.mjs"

await noGrab()
const file = await freshNote({ video: true })
await js(`!document.querySelector('.camera') && [...document.querySelectorAll('button')].find(b => b.dataset.bar === 'video')?.click()`)
await waitFor(`!!document.querySelector('.camera')`)
await pickTablet()
ok("the Tablet entry is in the video menu and picks the sheet", await js(`!!document.querySelector('.camera .tablet') && !document.querySelector('.camera video')`))
ok("Straighten is not offered on the sheet", await js(`![...document.querySelectorAll('.camera-bar button')].some(b => b.textContent === 'Straighten')`))
ok("the choice is remembered", await js(`localStorage.getItem('writemind.videoSource')`) === '"tablet"')
const t = await tabletBox()
console.log("sheet", JSON.stringify(t))
const px = () => js(`(()=>{const c=document.querySelector('.camera .tablet canvas');const d=c.getContext('2d').getImageData(0,0,c.width,c.height).data;let n=0;for(let i=3;i<d.length;i+=4)if(d[i]>0)n++;return n})()`)
ok("the sheet starts blank", (await px()) === 0)

// 1. WRITING comes in as the pen's own strokes, with pressure.
const X = t.x, Y = t.y
await penStroke(seg(X + 40, Y + 80, X + 200, Y + 90, 14))
await penStroke(seg(X + 40, Y + 120, X + 200, Y + 130, 14))
await sleep(100)
ok("the pen's strokes are drawn live", (await px()) > 200, String(await px()))
await takeBtn("Bring the writing in")
let d = await saved(file)
let strokes = d.items.filter(i => i.kind === "stroke")
ok("two stroke items arrived (no picture)", strokes.length === 2 && !d.items.some(i => i.kind === "image"), JSON.stringify(d.items.map(i => i.kind)))
ok("with a pressure per point, rising", strokes.every(s => s.pressures?.length === s.points.length && s.pressures.at(-1) > s.pressures[0] + 0.3))
ok("placed on the pane inside it, at page scale", strokes.every(s => s.points.every(p => p.x > 0 && p.x < 1 && p.y > 0 && p.y < 1)) && Math.max(...strokes.flatMap(s => s.points.map(p => p.x))) - Math.min(...strokes.flatMap(s => s.points.map(p => p.x))) < 0.42)
ok("the sheet keeps the writing once sent (Sean, 2026-10-06)", (await px()) > 200, String(await px()))

// One Ctrl+Z at the page takes the capture back from the note; the sheet is untouched by it.
const kept = await px()
// The pen goes over the note's page (as it does on its way to the note), so the next Ctrl+Z is the note's.
await hover(300, 200, { pen: true }); await sleep(150)
await mouse("mouseMoved", 300, 60, { buttons: 0 })
await js(`document.querySelector('.cm-content').focus()`)
await key("z", { modifiers: CTRL })
d = await saved(file, (x) => x.items.length === 0)
ok("one Ctrl+Z at the page takes the capture back from the note", d.items.length === 0, JSON.stringify(d.items.map(i => i.kind)))
ok("...and the sheet still has the writing", (await px()) === kept, `${kept} -> ${await px()}`)

// 2. Ctrl+Z with the pen over the sheet takes back a STROKE ON THE SHEET.
await penStroke(seg(X + 60, Y + 250, X + 220, Y + 250, 10))
const before = await px()
await hover(X + 100, Y + Math.round(t.h * 0.8), { pen: true }); await sleep(250)
await key("z", { modifiers: CTRL })
ok("Ctrl+Z over the sheet takes back the last stroke", (await px()) < before, `${await px()} vs ${before}`)
await barBtn("clear"); await sleep(100)
ok("Clear wipes the sheet", (await px()) === 0)

// 3. The BOX: only the section in it comes in; the rest stays on the sheet. (The Box button went, 2026-10-05: the
// Select toggle makes the pen pull the dashed box, and the box gets its own row of buttons under it.)
await penStroke(seg(X + 30, Y + 100, X + 110, Y + 100, 8))      // left
await penStroke(seg(X + 150, Y + 100, X + 230, Y + 100, 8))     // right
await barBtn("select")
await pe("pointerdown", X + 10, Y + 60); await pe("pointermove", X + 80, Y + 120); await pe("pointermove", X + 130, Y + 150); await pe("pointerup", X + 130, Y + 150, { buttons: 0 })
ok("the dashed box is shown", await js(`!!document.querySelector('.camera .box')`))
ok("...with its row of buttons (Erase, Bring in Writing, Bring in as Drawing Cell)", await js(`!!document.querySelector('[data-tablet=box-actions]')`))
await barBtn("select")
ok("the Select toggle lets go when pressed again", !(await js(`document.querySelector('.camera-bar [data-tablet=select]').classList.contains('on')`)))
await js(`document.querySelector('.cm-content').focus()`)
const n1 = (await saved(file)).items.length
await takeBtn("Bring the writing in")
d = await saved(file)
strokes = d.items.filter(i => i.kind === "stroke")
ok("only the writing in the box arrived", d.items.length === n1 + 1, `added=${d.items.length - n1}`)
ok("the right-hand writing stayed on the sheet", (await px()) > 100)
await barBtn("clear")

// 4. FLOW CHART: three boxes and two arrows drawn on the sheet come in as nodes and connectors under the writing.
const bx = [t.w * 0.05, t.w * 0.40, t.w * 0.75].map(Math.round), bw = Math.round(t.w * 0.2), by = Math.round(t.h * 0.25), bh = Math.round(t.h * 0.3)
for (const x of bx) await penStroke(rectPts(X + x, Y + by, bw, bh, 8))
for (let i = 0; i < 2; i++) {
  const x0 = X + bx[i] + bw, x1 = X + bx[i + 1], ym = Y + by + bh / 2
  await penStroke(seg(x0, ym, x1, ym, 6))
  await penStroke([[x1 - 14, ym - 9], [x1, ym], [x1 - 14, ym + 9]])
}
await shot("chart-sheet")
await js(`document.querySelector('.cm-content').focus()`)
const nBefore = (await saved(file)).items.length
await takeBtn("Bring the writing in")
// the text reader labels the nodes: allow it a few seconds the first time
for (let i = 0; i < 12 && (await saved(file)).items.filter((x) => x.kind === "shape").length < 3; i++) await sleep(500)
d = await saved(file)
const added = d.items.slice(nBefore)
const shapes = added.filter(i => i.kind === "shape"), conns = added.filter(i => i.kind === "connector")
ok("three nodes read off the sheet", shapes.length === 3, `shapes=${shapes.length} kinds=${JSON.stringify(shapes.map(s => s.shapeKind))}`)
ok("two arrows read, attached to nodes", conns.length === 2 && conns.every(c => c.startNode && c.endNode), `connectors=${conns.length}`)
ok("the strokes came too", added.some(i => i.kind === "stroke"))
const maxStrokeY = Math.max(...added.filter(i => i.kind === "stroke").flatMap(s => s.points.map(p => p.y)))
ok("the chart lands under the writing", shapes.length > 0 && shapes.every(s => s.center.y > maxStrokeY - 0.02), `${shapes.map(s => s.center.y.toFixed(2))} vs ${maxStrokeY.toFixed(2)}`)
ok("the pane says it read a chart", /flow chart/i.test(await js(`document.querySelector('.camera .note').textContent`)))
await shot("chart-note")
await js(`document.querySelector('.cm-content').focus()`)
await mouse("mouseMoved", 300, 60, { buttons: 0 })
await key("z", { modifiers: CTRL })
d = await saved(file)
ok("one Ctrl+Z takes the strokes and the chart back together", d.items.length === nBefore, `${d.items.length} vs ${nBefore}`)

// 5. PAGE: the sheet as a picture (the Aa reader works on it where an OCR exists).
await barBtn("clear")
await penStroke(seg(X + 40, Y + 80, X + 200, Y + 140, 14))
const n0 = (await saved(file)).items.length
await takeBtn("Bring the sheet in")
d = await saved(file)
const pic = d.items.filter(i => i.kind === "image")
ok("Page brings one picture", pic.length === 1 && d.items.length === n0 + 1, JSON.stringify(d.items.map(i => i.kind)))
ok("and the picture file exists", pic.length === 1 && await js(`new Promise(r => { const i = new Image(); i.onload = () => r(i.naturalWidth > 0); i.onerror = () => r(false); i.src = 'wm://media/' + encodeURIComponent(${JSON.stringify(pic[0]?.file)}) })`))

// 6. ERASE: no Erase button on the bar (Sean, 2026-10-05: "remove the erase button from the wacom menu bar"); the
// pen's Erase Tool toggle (Ctrl+Alt+2 with the pen last over the sheet) still erases there, then the side button.
await barBtn("clear")
const hint = () => js(`document.querySelector('.camera .note').textContent`)
ok("the sheet's bar has no Erase button", await js(`!document.querySelector('[data-tablet=erase]') && ![...document.querySelectorAll('.camera-bar button')].some(b => b.textContent.trim() === 'Erase')`))
ok("...and the hint says which pen button rubs out", /hold its first button to rub out/.test(await hint()), await hint())
await penStroke(seg(X + 40, Y + 200, X + 200, Y + 200, 14))
const drawn = await px()
await js(`document.querySelector('.cm-content').focus()`)
await key("2", { modifiers: CTRL | ALT })
ok("the pen's Erase Tool (Ctrl+Alt+2) turns the sheet's eraser on, and the hint says how to put it down", /Erasing: touch a stroke \(Erase Tool, Ctrl\+Alt\+2/.test(await hint()), await hint())
await pe("pointerdown", X + 120, Y + 203, { pressure: 0.4 }); await pe("pointermove", X + 125, Y + 203); await pe("pointerup", X + 125, Y + 203, { buttons: 0 })
await sleep(120)
ok("...and it rubs out the stroke under the pen", (await px()) === 0 && drawn > 100)
await key("2", { modifiers: CTRL | ALT })
ok("Ctrl+Alt+2 again puts it down", !/Erasing/.test(await hint()), await hint())
await penStroke(seg(X + 40, Y + 220, X + 200, Y + 220, 14))
const keep = await px()
// The upper side button (since 2026-10-05; the lower one selects): pressed in the air it does nothing; held while the
// pen touches it rubs out (the default hold).
const upper = (p) => pe("pointerdown", X + 120, Y + 223, { button: 1, buttons: 4, pressure: p }).then(() => pe("pointermove", X + 125, Y + 223, { button: -1, buttons: 4, pressure: p })).then(() => pe("pointerup", X + 125, Y + 223, { button: 1, buttons: 0, pressure: 0 }))
await upper(0); await sleep(150)
ok("the upper button pressed in the air does nothing", (await px()) === keep)
await upper(0.5); await sleep(150)
ok("held while the pen touches, the upper button rubs the stroke out (default hold: Erase)", (await px()) === 0)
await shot("after")
finish()
