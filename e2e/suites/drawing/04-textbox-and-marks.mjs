// Text boxes (card, wrap, commit on click-away, move, double-click to edit again), marks (tick, cross, star,
// question) and a pasted picture. (Was tour/t17 and t18.)
import { ok, finish, js, sleep, freshNote, canvasBox, saved, arm, handles, click, dblclick, dragPath, line, key, typeText, shot, rectOf, clearDrawing, footer } from "../../lib/harness.mjs"

const file = await freshNote({ rendered: true })
const cb = await canvasBox()
const X = (dx) => cb.x + dx, Y = (dy) => cb.y + dy
const items = async () => (await saved(file)).items

// ---- a text box
await arm("text")
await dragPath(line([X(260), Y(200)], [X(520), Y(230)], 10)); await sleep(300)
ok("dragging with the Text shape opens an editor", await js(`!!document.querySelector('.wm-textbox-edit')`))
await typeText("Hello text box. This line is long enough that it must wrap around the card.")
await key("Enter")
await typeText("Second paragraph")
await sleep(300)
const editor = await rectOf(".wm-textbox-edit")
ok("the editor grows with the words (taller than the dragged strip)", editor && editor.h > 40, JSON.stringify(editor))
await shot("editing")
await click(X(800), Y(550)); await sleep(500)
ok("a click away commits and closes the editor", !(await js(`!!document.querySelector('.wm-textbox-edit')`)))
let d = await items()
const box = d.find((i) => i.kind === "shape" && i.shapeKind === "text")
ok("the box is saved as a text shape", !!box, JSON.stringify(d.map((i) => [i.kind, i.shapeKind])))
ok("with both paragraphs in its label", box && box.label.includes("Hello text box") && box.label.includes("Second paragraph") && box.label.includes("\n"), JSON.stringify(box?.label))
await shot("committed")

// pick it and move it
const cx = X(box.center.x * cb.w), cy = Y(box.center.y * cb.h)
await click(cx, cy); await sleep(250)
const hs = await handles()
ok("a click on the box picks it (handles shown)", hs.length >= 3, JSON.stringify(hs.map((h) => h.t)))
// Sean, 2026-10-10: the six glyph discs (the 'Drag to move' one among them) are gone. A text box has the standard
// handles: four corners and its two sides (its height is its words'), a rotate dot, all ON its outline, none over the words.
const edge = (h) => hs.filter((x) => x.t === h)
ok("a text box has four corner handles and two side handles, and a rotate handle", edge("Resize").length === 6 && edge("Turn").length === 1, JSON.stringify(hs.map((h) => [h.t, h.h])))
const inside = hs.filter((h) => h.x > cx - (box.width * cb.w) / 2 + 4 && h.x < cx + (box.width * cb.w) / 2 - 4 && h.y > cy - 20 && h.y < cy + 20)
ok("no handle sits over the words", inside.length === 0, JSON.stringify(inside))
// ...and it moves by a drag of the box itself (a second press within 450 ms is a double-click, which opens its words)
await sleep(600)
await dragPath(line([cx, cy], [cx, cy + 160], 10)); await sleep(300)
d = await items()
const moved = d.find((i) => i.id === box.id)
ok("dragging moves it", moved.transform && moved.transform.dy > 0.05, JSON.stringify(moved.transform))

// double-click to edit again
const by = cy + 160
await click(cx, by); await dblclick(cx, by); await sleep(400)
const value = await js(`document.querySelector('.wm-textbox-edit')?.value`)
ok("a double-click edits the box again, with its words", typeof value === "string" && value.includes("Second paragraph"), JSON.stringify(value))
await key("Escape"); await sleep(200)
await click(X(800), Y(600)); await sleep(300)

// ---- marks
await clearDrawing()
await arm("check"); await click(X(300), Y(140)); await sleep(250)
d = await items()
ok("the Check mark puts a mark on the page", d.length === 1 && d[0].kind === "shape", JSON.stringify(d.map((i) => [i.kind, i.shapeKind])))
ok("...and picks it (a small mark has one pill of two buttons, not a ring: 2026-10-10)", (await handles()).length === 2)
await arm("cross"); await dragPath(line([X(560), Y(130)], [X(600), Y(170)], 8)); await sleep(250)
await arm("star"); await click(X(800), Y(150)); await sleep(250)
await arm("question"); await click(X(1000), Y(150)); await sleep(250)
d = await items()
const kinds = d.filter((i) => i.kind === "shape").map((i) => i.shapeKind)
ok("tick, cross, star and question are four shapes", kinds.length === 4 && new Set(kinds).size === 4, JSON.stringify(kinds))
await shot("marks")

// ---- a pasted picture
await js(`(async()=>{const c=document.createElement('canvas');c.width=320;c.height=200;const x=c.getContext('2d');const g=x.createLinearGradient(0,0,320,200);g.addColorStop(0,'#f2542d');g.addColorStop(1,'#2d7dd2');x.fillStyle=g;x.fillRect(0,0,320,200);const blob=await new Promise(r=>c.toBlob(r,'image/png'));const dt=new DataTransfer();dt.items.add(new File([blob],'p.png',{type:'image/png'}));document.dispatchEvent(new ClipboardEvent('paste',{clipboardData:dt,bubbles:true,cancelable:true}))})()`)
await sleep(1200)
d = await items()
ok("a pasted picture lands on the page", d.filter((i) => i.kind === "image").length === 1, JSON.stringify(d.map((i) => i.kind)))
ok("...and is picked, ready to move", (await handles()).length >= 3)
await shot("picture")
finish()
