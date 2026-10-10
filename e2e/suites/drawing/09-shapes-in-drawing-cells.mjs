// Shapes, arrows and text boxes inside DRAWING CELLS (2026-10-06, docs/TODO.md "Drawing polish"): the top bar's tools
// and the cell's own right-click menu put them INTO the cell they are used in (its sidecar item, like its strokes);
// they are kept inside it, labelled and typed in place, attached to each other, drawn by the cell's own canvas on
// both pages, written into its snapshot (the ink file other viewers and the export show), they move with the cell,
// and Undo takes them back. Real mouse and keys. Unit side: packages/core/test/inkCell.test.ts.
import { readWm } from "../../lib/wm.mjs"
import {
  ok, finish, js, send, sleep, freshNote, saved, arm, line, click, dblclick, rightClick, key, typeText, shot,
  handles, setDoc, focus, readNoteFile, CTRL, MOD,
} from "../../lib/harness.mjs"

/** The mouse moved with no button held, and a drag as a hand makes it (the pointer arrives first, then presses). */
const hover = (x, y) => send("Input.dispatchMouseEvent", { type: "mouseMoved", x, y, button: "none", buttons: 0 })
async function handDrag(pts) {
  await hover(pts[0][0], pts[0][1]); await sleep(60)
  await send("Input.dispatchMouseEvent", { type: "mousePressed", x: pts[0][0], y: pts[0][1], button: "left", buttons: 1, clickCount: 1 })
  for (const p of pts.slice(1)) await send("Input.dispatchMouseEvent", { type: "mouseMoved", x: p[0], y: p[1], button: "left", buttons: 1 })
  const end = pts[pts.length - 1]
  await send("Input.dispatchMouseEvent", { type: "mouseReleased", x: end[0], y: end[1], button: "left", buttons: 0, clickCount: 1 })
  await sleep(250)
}
const cellBox = async () => JSON.parse(await js(`(()=>{const e=document.querySelector('.wm-inkcell canvas');if(!e)return 'null';const r=e.getBoundingClientRect();return JSON.stringify({x:r.x,y:r.y,w:r.width,h:r.height})})()`))
/** Pixels of the cell's own canvas that hold ink. */
const cellInk = () => js(`(()=>{const c=document.querySelector('.wm-inkcell canvas');if(!c||!c.width)return 0;const d=c.getContext('2d').getImageData(0,0,c.width,c.height).data;let n=0;for(let i=3;i<d.length;i+=4)if(d[i]>40)n++;return n})()`)
const cellOf = (drawing) => drawing.items.find((i) => i.kind === "cell")

const file = await freshNote({ rendered: true })
await setDoc("# Cells\n\nA drawing cell below.", 0)
await focus(); await js(`document.querySelector('.cm-content').cmTile.view.dispatch({selection:{anchor:20}})`)
await key("0", { modifiers: MOD }); await sleep(700)
await key("Escape"); await sleep(150)
let c = await cellBox()
ok("a drawing cell (Ctrl+0)", !!c, JSON.stringify(c))

// ---- 1. a rectangle from the top bar's Shapes, dragged out in the cell
await arm("rectangle")
await handDrag(line([c.x + 60, c.y + 40], [c.x + 220, c.y + 110], 8))
let d = await saved(file, (x) => cellOf(x)?.items?.some((i) => i.kind === "shape"))
let cell = cellOf(d)
const rect = cell?.items.find((i) => i.kind === "shape" && i.shapeKind === "rectangle")
ok("the rectangle went INTO the cell, not onto the page", !!rect && !d.items.some((i) => i.kind === "shape"), JSON.stringify(d.items.map((i) => i.kind)))
ok("...in the cell's frame (fractions of its width): 160 px wide", rect && Math.abs(rect.width * c.w - 160) < 3, JSON.stringify(rect && rect.width * c.w))
ok("...picked, its handles round it", (await handles()).length >= 4)
ok("the cell's own canvas draws it", (await cellInk()) > 200)
await key("Escape"); await sleep(150)

// ---- 2. a shape dragged past the cell's edge stays inside the cell
await arm("oval")
await handDrag(line([c.x + c.w - 120, c.y + c.h - 60], [c.x + c.w + 80, c.y + c.h + 90], 8))
d = await saved(file, (x) => cellOf(x)?.items?.some((i) => i.shapeKind === "oval"))
const oval = cellOf(d)?.items.find((i) => i.shapeKind === "oval")
ok("an oval dragged out past the cell's corner stops at its edge", !!oval
  && (oval.center.x + oval.width / 2) * c.w <= c.w + 1 && (oval.center.y * c.w + oval.width * oval.aspect * c.w / 2) <= c.h + 1, JSON.stringify(oval))
await key("Escape"); await sleep(150)

// ---- 3. a text box from the cell's own menu: right-click ▸ Text Box, then a click in the cell
await rightClick(c.x + 700, c.y + 150); await sleep(250)
const labels = JSON.parse(await js(`JSON.stringify([...document.querySelectorAll('#cell-menu button')].map(b=>b.textContent.trim()))`))
ok("the cell's menu offers Text Box, Shape, Arrow and Undock", ["Text Box", "Shape", "Arrow", "Undock"].every((l) => labels.some((t) => t.startsWith(l))), JSON.stringify(labels))
await shot("cell-menu")
await js(`[...document.querySelectorAll('#cell-menu button')].find(b=>b.textContent.trim().startsWith('Text Box'))?.click()`); await sleep(200)
await click(c.x + 520, c.y + 60); await sleep(300)
ok("a click in the cell opens a text box there, for typing", await js(`!!document.querySelector('.wm-textbox-edit[data-cell]')`))
await typeText("Inside the cell")
await sleep(200)
await shot("typing-in-cell")
await click(c.x + 900, c.y + c.h + 200); await sleep(400)
d = await saved(file, (x) => cellOf(x)?.items?.some((i) => i.shapeKind === "text" && i.label === "Inside the cell"))
const text = cellOf(d)?.items.find((i) => i.shapeKind === "text")
ok("the text box and its words live in the cell", text?.label === "Inside the cell" && !d.items.some((i) => i.kind === "shape"), JSON.stringify(text))

// ---- 4. the arrow tool, from the rectangle to the text box: attached at both ends, in the cell
const at = (item) => [c.x + item.center.x * c.w, c.y + item.center.y * c.w]
await arm("tool")
await handDrag(line(at(rect), at(text), 10))
await key("Escape"); await sleep(200)
d = await saved(file, (x) => cellOf(x)?.items?.some((i) => i.kind === "connector"))
const arrow = cellOf(d)?.items.find((i) => i.kind === "connector")
ok("an arrow drawn with the arrow tool lives in the cell, from the rectangle to the text box", arrow?.startNode === rect?.id && arrow?.endNode === text?.id,
  JSON.stringify(arrow && [arrow.startNode, arrow.endNode]))

// ---- 5. a double-click on the rectangle labels it, in place
await click(c.x + 900, c.y + c.h + 200); await sleep(150)
await dblclick(...at(rect)); await sleep(300)
ok("a double-click on the node in the cell opens its label", await js(`!!document.querySelector('.wm-label-edit[data-cell]')`))
await typeText("Start"); await key("Enter"); await sleep(300)
d = await saved(file, (x) => cellOf(x)?.items?.some((i) => i.id === rect?.id && i.label === "Start"))
ok("the label is the cell's rectangle's", cellOf(d)?.items.find((i) => i.id === rect?.id)?.label === "Start")
await key("Escape"); await sleep(200)
await shot("shapes-in-cell")
const inkBefore = await cellInk()

// ---- 6. they move with the cell: a line typed above it
const itemsBefore = JSON.stringify(cellOf(d).items)
await focus(); await js(`document.querySelector('.cm-content').cmTile.view.dispatch({selection:{anchor:7}})`)
await key("Enter"); await typeText("A new line above the cell."); await key("Enter"); await sleep(400)
const moved = await cellBox()
d = await saved(file)
ok("a line typed above moves the cell down...", moved.y > c.y + 20, JSON.stringify([c.y, moved.y]))
ok("...and its shapes, arrow and text box with it (the cell's items are untouched)", JSON.stringify(cellOf(d).items) === itemsBefore)
ok("...still drawn in it", Math.abs((await cellInk()) - inkBefore) < inkBefore * 0.05, JSON.stringify([inkBefore, await cellInk()]))

// ---- 7. the rendered page draws the same cell
await key("t", { modifiers: MOD }); await sleep(800)
ok("the rendered page draws them too (the same cell canvas)", (await cellInk()) > inkBefore * 0.9, String(await cellInk()))
await shot("rendered-page")
await key("t", { modifiers: MOD }); await sleep(600)

// ---- 8. the cell's ink file (its snapshot, what other viewers and the export show) holds them
await sleep(800)
const svg = readWm(file).entries[`snapshots/ink-${cellOf(d).id}.svg`]?.toString() ?? ""
ok("the cell's snapshot holds the shapes, the arrow and the text box", svg.includes("Inside the cell") && svg.includes(">Start<") && (svg.match(/<path/g) ?? []).length >= 3,
  svg.slice(0, 200))

// ---- 9. Undo takes them back, one at a time (the typed line first, in however many steps the typing took)
await focus()
const text0 = "# Cells\n\nA drawing cell below."
for (let i = 0; i < 6 && !(await js(`document.querySelector('.cm-content').cmTile.view.state.doc.toString()`)).startsWith(text0); i++) {
  await key("z", { modifiers: CTRL }); await sleep(300)
}
ok("Ctrl+Z takes the typed line back", (await js(`document.querySelector('.cm-content').cmTile.view.state.doc.toString()`)).startsWith(text0))
await key("z", { modifiers: CTRL }); await sleep(500)
d = await saved(file)
const back = cellOf(d)?.items ?? []
ok("...then the label", back.some((i) => i.id === rect?.id) && !back.find((i) => i.id === rect?.id)?.label, JSON.stringify(back.map((i) => [i.shapeKind ?? i.kind, i.label])))
await key("z", { modifiers: CTRL }); await sleep(500)
d = await saved(file)
ok("...then the arrow", !(cellOf(d)?.items ?? []).some((i) => i.kind === "connector"))
finish()
