// Hover feedback before a click (2026-10-06, docs/TODO.md "Drawing polish"; the Mac's hovered object): with the pen up
// the object under the pointer shows a faint outline and faint handles, so you see what a click will take; nothing on
// hover changes the document; the handles stay while the pointer goes to one, and a drag on one picks and moves the
// object; under the pen nothing hovers; a picture shows its outline only; an object in a drawing cell hovers too.
// Real mouse and keys. Unit side: apps/desktop/test/drawingHover.test.ts.
import {
  ok, finish, js, send, sleep, freshNote, canvasBox, saved, setPen, dragPath, line, click, key, shot, handles,
  setDoc, focus, clearDrawing, CTRL, MOD,
} from "../../lib/harness.mjs"

/** The mouse moved with NO button held (the harness hover() moves with the left button down: buttons 1). */
const hover = (x, y) => send("Input.dispatchMouseEvent", { type: "mouseMoved", x, y, button: "none", buttons: 0 })
/** A drag as a hand makes it: the pointer arrives with no button down, then presses, moves and lets go. */
async function handDrag(pts) {
  await hover(pts[0][0], pts[0][1]); await sleep(60)
  await send("Input.dispatchMouseEvent", { type: "mousePressed", x: pts[0][0], y: pts[0][1], button: "left", buttons: 1, clickCount: 1 })
  for (const p of pts.slice(1)) await send("Input.dispatchMouseEvent", { type: "mouseMoved", x: p[0], y: p[1], button: "left", buttons: 1 })
  const end = pts[pts.length - 1]
  await send("Input.dispatchMouseEvent", { type: "mouseReleased", x: end[0], y: end[1], button: "left", buttons: 0, clickCount: 1 })
  await sleep(120)
}

const file = await freshNote({ rendered: true })
await setDoc("# Hover\n\nSome words here, with a stroke drawn over the page beside them.\n\nMore words further down.", 0)
const cb = await canvasBox()
const X = (dx) => cb.x + dx, Y = (dy) => cb.y + dy
const state = async () => JSON.parse(await js(`JSON.stringify({
  box: (()=>{const b=document.querySelector('.wm-hover-box');if(!b)return null;const r=b.getBoundingClientRect();return {x:r.x,y:r.y,w:r.width,h:r.height}})(),
  faint: !!document.querySelector('.wm-handles-faint'),
  handles: document.querySelectorAll('.wm-handle').length,
  opacity: (()=>{const h=document.querySelector('.wm-handles-faint .wm-handle:not(:hover)');return h?Number(getComputedStyle(h).opacity):null})(),
  grab: !!document.querySelector('.wm-hover-grab'),
})`))
const glide = async (from, to, n = 6) => { for (const p of line(from, to, n)) { await hover(p[0], p[1]); await sleep(25) } }

// ---- a stroke on the page
await setPen(true)
await dragPath(line([X(520), Y(330)], [X(720), Y(360)], 14)); await sleep(300)
await setPen(false)
await key("Escape"); await sleep(150)
let d = await saved(file)
const stroke = d.items.find((i) => i.kind === "stroke")
ok("a stroke on the page", !!stroke, JSON.stringify(d.items.map((i) => i.kind)))
const before = JSON.stringify(d.items)

await hover(X(1000), Y(600)); await sleep(150)
let s = await state()
ok("nothing hovered: no outline, no handles", !s.box && s.handles === 0, JSON.stringify(s))
await glide([X(1000), Y(600)], [X(620), Y(345)]); await sleep(250)
s = await state()
ok("hovering the stroke outlines it", !!s.box && s.box.w > 150 && s.box.w < 260, JSON.stringify(s.box))
ok("...and shows its handles, faintly", s.faint && s.handles >= 4 && s.opacity !== null && s.opacity < 0.6, JSON.stringify(s))
ok("...with an open hand over the note", s.grab)
await shot("stroke-hovered")
d = await saved(file)
ok("hovering changes nothing in the document", JSON.stringify(d.items) === before)
ok("...and picks nothing (the arrow keys stay the caret's)", await (async () => {
  await focus(); await js(`${"document.querySelector('.cm-content').cmTile.view"}.dispatch({selection:{anchor:3}})`)
  await key("ArrowRight"); await sleep(100)
  return (await js(`document.querySelector('.cm-content').cmTile.view.state.selection.main.head`)) === 4
})())

// ---- off it: gone after a moment
await glide([X(620), Y(345)], [X(1000), Y(620)]); await sleep(500)
s = await state()
ok("moving off it puts the outline and the handles away", !s.box && s.handles === 0, JSON.stringify(s))

// ---- back on it, then on to a handle: they stay, and a drag on one picks and moves the stroke
await glide([X(1000), Y(620)], [X(620), Y(345)]); await sleep(250)
const grip = (await handles()).find((h) => h.h === "se")   // (2026-10-10: the move disc is gone; a handle of the ring)
ok("a faint resize handle", !!grip)
if (grip) {
  await glide([X(620), Y(345)], [grip.x, grip.y], 5); await sleep(400)
  s = await state()
  ok("the handles stay while the pointer goes to one", s.faint && s.handles >= 4, JSON.stringify(s))
  await shot("handle-reached")
  await handDrag(line([grip.x, grip.y], [grip.x + 40, grip.y + 120], 10)); await sleep(300)
  d = await saved(file, (x) => x.items.some((i) => i.id === stroke.id && i.transform?.dy > 0))
  const moved = d.items.find((i) => i.id === stroke.id)
  ok("a drag on a faint handle picks the object and scales it", moved?.transform && moved.transform.scale > 1.05, JSON.stringify(moved?.transform))
  s = await state()
  ok("...and picks it: its handles are the pick's now, at full strength", !s.faint && !s.box && s.handles >= 4, JSON.stringify(s))
  await shot("picked-by-handle")
}
await key("Escape"); await sleep(200)
await key("z", { modifiers: CTRL }); await sleep(600)
d = await saved(file)
ok("one Ctrl+Z takes the move back", JSON.stringify(d.items) === before)

// ---- under the pen, nothing hovers (a press draws there)
await setPen(true)
await glide([X(1000), Y(600)], [X(620), Y(345)]); await sleep(300)
s = await state()
ok("under the pen nothing hovers", !s.box && s.handles === 0, JSON.stringify(s))
await setPen(false)

// ---- a picture: its outline, no buttons until it is clicked (Sean's rule on the Mac)
await js(`(async()=>{const c=document.createElement('canvas');c.width=300;c.height=160;const x=c.getContext('2d');x.fillStyle='#2d7dd2';x.fillRect(0,0,300,160);const blob=await new Promise(r=>c.toBlob(r,'image/png'));const dt=new DataTransfer();dt.items.add(new File([blob],'p.png',{type:'image/png'}));document.dispatchEvent(new ClipboardEvent('paste',{clipboardData:dt,bubbles:true,cancelable:true}))})()`)
await sleep(1200)
await key("Escape"); await sleep(200)
d = await saved(file)
const image = d.items.find((i) => i.kind === "image")
ok("a pasted picture", !!image)
if (image) {
  const cx = X(image.center.x * cb.w), cy = Y(image.center.y * cb.h - (await js(`document.querySelector('.cm-scroller').scrollTop`)))
  await glide([X(1000), Y(650)], [cx, cy]); await sleep(300)
  s = await state()
  ok("hovering a picture outlines it, with no buttons", !!s.box && s.handles === 0, JSON.stringify(s))
  await shot("picture-hovered")
  await click(cx, cy); await sleep(250)
  ok("a click on it brings its buttons", (await handles()).length >= 4)
  await key("Escape"); await sleep(200)
}

// ---- an object in a drawing cell hovers too (the page emptied first: a floating object over a cell is the page's)
await clearDrawing()
await setDoc("# Hover\n\nA drawing cell below.", 0)
await focus(); await js(`document.querySelector('.cm-content').cmTile.view.dispatch({selection:{anchor:20}})`)
await key("0", { modifiers: MOD }); await sleep(600)
const cell = await js(`(()=>{const e=document.querySelector('.wm-inkcell canvas');if(!e)return null;const r=e.getBoundingClientRect();return JSON.stringify({x:r.x,y:r.y,w:r.width,h:r.height})})()`).then((t) => (t ? JSON.parse(t) : null))
ok("Ctrl+0 makes a drawing cell", !!cell)
if (cell) {
  // The pointer is a pen for the new cell: a stroke in it, then Escape hands the pointer back.
  await dragPath(line([cell.x + 80, cell.y + 60], [cell.x + 260, cell.y + 110], 12)); await sleep(300)
  await key("Escape"); await sleep(200)
  await hover(cell.x + cell.w - 40, cell.y + cell.h - 30); await sleep(200)
  await glide([cell.x + cell.w - 40, cell.y + cell.h - 30], [cell.x + 170, cell.y + 85]); await sleep(300)
  s = await state()
  ok("a stroke in a drawing cell hovers too, outlined inside the cell", !!s.box && s.box.y >= cell.y - 6 && s.box.y + s.box.h <= cell.y + cell.h + 6 && s.faint, JSON.stringify({ box: s.box, cell }))
  await shot("cell-stroke-hovered")
}
finish()
