// UNDOCKING (2026-10-06, docs/TODO.md "Drawing polish"): the reverse of the ⤵ dock handle. A drawing cell's or a
// docked picture's right-click menu has Undock: the line leaves the note, and its objects float on the drawing layer
// over the note EXACTLY where the cell showed them (the same pixels), picked; ONE Ctrl+Z puts the cell back (line,
// ink and all), Ctrl+Y takes it out again; nothing is lost either way (the picture's file stays). Real mouse and keys.
// Unit side: packages/core/test/inkCell.test.ts (undockedInk / undockedPicture), apps/desktop/test/dockUndo.test.ts
// (one Undo step), packages/editor/test/undock.test.ts (the line taken out).
import {
  ok, finish, js, send, sleep, freshNote, saved, arm, line, dragPath, rightClick, key, shot, handles, setDoc, focus,
  canvasBox, noteFileExists, CTRL,
} from "../../lib/harness.mjs"

const hover = (x, y) => send("Input.dispatchMouseEvent", { type: "mouseMoved", x, y, button: "none", buttons: 0 })
async function handDrag(pts) {
  await hover(pts[0][0], pts[0][1]); await sleep(60)
  await send("Input.dispatchMouseEvent", { type: "mousePressed", x: pts[0][0], y: pts[0][1], button: "left", buttons: 1, clickCount: 1 })
  for (const p of pts.slice(1)) await send("Input.dispatchMouseEvent", { type: "mouseMoved", x: p[0], y: p[1], button: "left", buttons: 1 })
  const end = pts[pts.length - 1]
  await send("Input.dispatchMouseEvent", { type: "mouseReleased", x: end[0], y: end[1], button: "left", buttons: 0, clickCount: 1 })
  await sleep(250)
}
const VIEW = `document.querySelector('.cm-content').cmTile.view`
const text = () => js(`${VIEW}.state.doc.toString()`)
const cellBox = async () => JSON.parse(await js(`(()=>{const e=document.querySelector('.wm-inkcell canvas');if(!e)return 'null';const r=e.getBoundingClientRect();return JSON.stringify({x:r.x,y:r.y,w:r.width,h:r.height})})()`))
/** Where a canvas has ink, as a box in client px (null when it has none). */
const inkBox = (selector) => js(`(()=>{const c=document.querySelector(${JSON.stringify(selector)});if(!c||!c.width)return 'null';
  const r=c.getBoundingClientRect();const k=c.width/r.width;const d=c.getContext('2d').getImageData(0,0,c.width,c.height).data;
  let x0=1e9,y0=1e9,x1=-1,y1=-1;for(let y=0;y<c.height;y++)for(let x=0;x<c.width;x++){if(d[(y*c.width+x)*4+3]>60){if(x<x0)x0=x;if(x>x1)x1=x;if(y<y0)y0=y;if(y>y1)y1=y}}
  return x1<0?'null':JSON.stringify({x0:r.x+x0/k,y0:r.y+y0/k,x1:r.x+x1/k,y1:r.y+y1/k})})()`).then(JSON.parse)
const near = (a, b, px = 3) => a && b && ["x0", "y0", "x1", "y1"].every((k) => Math.abs(a[k] - b[k]) <= px)
const menuItems = async () => JSON.parse(await js(`JSON.stringify([...document.querySelectorAll('#cell-menu button')].map(b=>b.textContent.trim()))`))
const choose = (label) => js(`[...document.querySelectorAll('#cell-menu button')].find(b=>b.textContent.trim().startsWith(${JSON.stringify(label)}))?.click()`)

const file = await freshNote()
const WORDS = "# Undock\n\nAbove the cell.\n\nBelow the cell."
await setDoc(WORDS, 0)
await focus(); await js(`${VIEW}.dispatch({selection:{anchor:25}})`)
await key("0", { modifiers: CTRL }); await sleep(700)
let c = await cellBox()
ok("a drawing cell", !!c)
// The pointer is a pen for the new cell: a stroke in it; then a rectangle from the top bar.
await dragPath(line([c.x + 90, c.y + 50], [c.x + 300, c.y + 120], 14)); await sleep(250)
await key("Escape"); await sleep(150)
await arm("rectangle")
await handDrag(line([c.x + 400, c.y + 40], [c.x + 560, c.y + 130], 8))
await key("Escape"); await sleep(200)
let d = await saved(file, (x) => (x.items.find((i) => i.kind === "cell")?.items?.length ?? 0) === 2)
const cell = d.items.find((i) => i.kind === "cell")
ok("the cell holds a stroke and a rectangle", cell?.items.map((i) => i.kind).sort().join() === "shape,stroke", JSON.stringify(cell?.items.map((i) => i.kind)))
const docked = await text()
const shown = await inkBox(".wm-inkcell canvas")
ok("the cell draws them", !!shown)
await shot("docked")

// ---- right-click ▸ Undock
await rightClick(c.x + c.w - 80, c.y + c.h - 40); await sleep(250)
ok("the drawing cell's menu has Undock", (await menuItems()).includes("Undock"), JSON.stringify(await menuItems()))
await choose("Undock"); await sleep(600)
ok("the cell's line leaves the note, and the words close up behind it", (await text()) === WORDS, JSON.stringify(await text()))
d = await saved(file, (x) => !x.items.some((i) => i.kind === "cell"))
ok("the cell's item leaves the drawing; its stroke and rectangle float, same ids", !d.items.some((i) => i.kind === "cell")
  && cell?.items.every((one) => d.items.some((i) => i.id === one.id && i.kind === one.kind)), JSON.stringify(d.items.map((i) => i.kind)))
ok("they arrive picked", (await handles()).length >= 4)
await shot("undocked-picked")
await key("Escape"); await sleep(400)
const floating = await inkBox(".wm-ink")
ok("they float exactly where the cell showed them (to 3 px)", near(floating, shown), JSON.stringify({ shown, floating }))
await shot("undocked")
ok("the cell's snapshot file is still there (nothing deleted)", await noteFileExists(`.drawings/media/ink-${cell?.id}.svg`))

// ---- one Ctrl+Z puts the cell back, Ctrl+Y takes it out again
await focus()
await key("z", { modifiers: CTRL }); await sleep(700)
ok("one Ctrl+Z: the cell's line is back", (await text()) === docked, JSON.stringify(await text()))
d = await saved(file, (x) => x.items.some((i) => i.kind === "cell"))
ok("...the cell is back with both objects, and nothing floats", d.items.find((i) => i.kind === "cell")?.items.length === 2
  && !d.items.some((i) => i.kind === "stroke" || i.kind === "shape"), JSON.stringify(d.items.map((i) => i.kind)))
await sleep(300)
ok("...drawn in its cell again", near(await inkBox(".wm-inkcell canvas"), shown))
await key("y", { modifiers: CTRL }); await sleep(700)
d = await saved(file, (x) => !x.items.some((i) => i.kind === "cell"))
ok("Ctrl+Y: undocked again", (await text()) === WORDS && d.items.filter((i) => i.kind !== "cell").length === 2)
await key("z", { modifiers: CTRL }); await sleep(700)

// ---- a docked picture: paste one, dock it with the ⤵ handle, then undock it
await setDoc(WORDS, 25); await sleep(300)
await js(`(async()=>{const c=document.createElement('canvas');c.width=320;c.height=180;const x=c.getContext('2d');x.fillStyle='#d94';x.fillRect(0,0,320,180);x.fillStyle='#246';x.fillRect(40,40,120,90);const blob=await new Promise(r=>c.toBlob(r,'image/png'));const dt=new DataTransfer();dt.items.add(new File([blob],'p.png',{type:'image/png'}));document.dispatchEvent(new ClipboardEvent('paste',{clipboardData:dt,bubbles:true,cancelable:true}))})()`)
await sleep(1300)
const dock = (await handles()).find((h) => /^Dock/.test(h.t))
ok("a pasted picture, picked, with the dock handle", !!dock)
if (dock) {
  await focus(); await js(`${VIEW}.dispatch({selection:{anchor:25}})`)
  await handDrag([[dock.x, dock.y], [dock.x, dock.y]]); await sleep(700)
  const withPicture = await text()
  ok("the dock handle makes it a picture cell", /!\[\]\(\.drawings\/media\/[^)]+\.png\)/.test(withPicture), JSON.stringify(withPicture))
  const fileName = /\.drawings\/media\/([^)]+\.png)/.exec(withPicture)?.[1]
  const img = JSON.parse(await js(`(()=>{const e=document.querySelector('.wm-cellpic img');if(!e)return 'null';const r=e.getBoundingClientRect();return JSON.stringify({x:r.x,y:r.y,w:r.width,h:r.height})})()`))
  ok("shown in the note", !!img && img.w > 100)
  await rightClick(img.x + img.w / 2, img.y + img.h / 2); await sleep(250)
  const items = await menuItems()
  ok("a docked picture's menu has Undock (and Cut, Copy, Delete)", ["Undock", "Cut", "Copy", "Delete Picture Cell"].every((l) => items.some((t) => t.startsWith(l))), JSON.stringify(items))
  await shot("picture-menu")
  await choose("Undock"); await sleep(700)
  ok("its line leaves the note", (await text()) === WORDS, JSON.stringify(await text()))
  d = await saved(file, (x) => x.items.some((i) => i.kind === "image"))
  const image = d.items.find((i) => i.kind === "image")
  ok("it floats again: the same file", image?.file === fileName, JSON.stringify([image?.file, fileName]))
  const cb = await canvasBox()
  const top = await js(`document.querySelector('.cm-scroller').scrollTop`)
  const at = image && { x: cb.x + image.center.x * cb.w - image.width * cb.w / 2, y: cb.y + image.center.y * cb.h - top - image.width * cb.w * image.aspect / 2, w: image.width * cb.w }
  ok("...at the size and the place the note showed it (to 2 px)", at && Math.abs(at.x - img.x) <= 2 && Math.abs(at.y - img.y) <= 2 && Math.abs(at.w - img.w) <= 2, JSON.stringify({ at, img }))
  ok("...picked", (await handles()).length >= 4)
  await shot("picture-undocked")
  await focus()
  await key("z", { modifiers: CTRL }); await sleep(700)
  d = await saved(file, (x) => !x.items.some((i) => i.kind === "image"))
  ok("one Ctrl+Z: the picture cell is back, nothing floats", (await text()) === withPicture && !d.items.some((i) => i.kind === "image"), JSON.stringify(await text()))
}
finish()
