// Connector routing, segment circles, node labels, undo: the real UI, real mouse and keys.
import { js, ok, finish, sleep, drag, click, key, typeText, freshNote, saved, canvasBox, arm, CTRL, shot } from "../../lib/harness.mjs"
const file = await freshNote({ rendered: true })
const cb = await canvasBox()
const X = (dx) => cb.x + dx, Y = (dy) => cb.y + dy
const size = { w: cb.w, h: cb.h }
// two flow-chart boxes: A upper left, B lower right (a corner is needed to route)
await arm("rectangle"); await drag(X(80), Y(120), X(240), Y(190))
await arm("rectangle"); await drag(X(420), Y(300), X(580), Y(370))
let d = await saved(file)
const nodes = d.items.filter(i => i.kind === "shape")
ok("two nodes placed", nodes.length === 2, JSON.stringify(d.items.map(i => i.kind)))
const [A, B] = nodes
// an arrow from inside A to inside B. The ARROW TOOL attaches both ends; an Arrow from the palette attaches
// nothing, as on the Mac (06-keys.mjs / 07-gestures.mjs hold that check). The tool stays armed: put it away.
await arm("tool"); await drag(X(160), Y(155), X(500), Y(335), { steps: 12 })
await arm("tool")
d = await saved(file)
let c = d.items.find(i => i.kind === "connector")
ok("arrow placed", !!c)
ok("arrow attached to both nodes", c && c.startNode === A.id && c.endNode === B.id, JSON.stringify(c))
const orth = (c) => { const pts = [c.start, ...c.bends, c.end]; return pts.slice(1).every((p, i) => Math.abs(p.x - pts[i].x) < 1e-6 || Math.abs(p.y - pts[i].y) < 1e-6) }
ok("routed with right angles", c && c.bends.length >= 1 && orth(c), JSON.stringify(c && c.bends))
await shot("conn1")

// move B by dragging it: the connector follows and stays orthogonal, ending on B's edge
const endBefore = JSON.stringify(c.end)
await drag(X(530), Y(345), X(590), Y(295), { steps: 10 })
d = await saved(file)
const B2 = d.items.find(i => i.kind === "shape" && i.id === B.id)
c = d.items.find(i => i.kind === "connector")
ok("node moved", B2 && (B2.transform.dx !== 0 || B2.transform.dy !== 0), JSON.stringify(B2 && B2.transform))
ok("connector end followed the node", JSON.stringify(c.end) !== endBefore && orth(c), `${endBefore} -> ${JSON.stringify(c.end)}`)
const bw = B2.width * size.w, bh = bw * B2.aspect
const bcx = B2.center.x * size.w + B2.transform.dx * size.w, bcy = B2.center.y * size.h + B2.transform.dy * size.h
// reconnect bakes nothing into shapes, so the connector end is computed from the placed box
const ex = c.end.x * size.w, ey = c.end.y * size.h
const onEdge = Math.abs(Math.abs(ex - bcx) - bw / 2) < 2 || Math.abs(Math.abs(ey - bcy) - bh / 2) < 2
ok("connector end sits on the node's edge", onEdge, JSON.stringify({ ex, ey, bcx, bcy, bw, bh }))

// select the connector by clicking on its line, find the segment circles
const pts = [c.start, ...c.bends, c.end].map(p => ({ x: p.x * size.w, y: p.y * size.h }))
const mid = { x: (pts[0].x + pts[1].x) / 2, y: (pts[0].y + pts[1].y) / 2 }
await click(X(mid.x), Y(mid.y))
await sleep(250)
const circles = await js(`document.querySelectorAll('.wm-segment').length`)
ok("segment circles shown for the selected connector", circles === pts.length - 1, `circles=${circles} pts=${pts.length}`)
await shot("conn2")
// drag the middle segment's circle
const mids = JSON.parse(await js(`JSON.stringify([...document.querySelectorAll('.wm-segment')].map(e=>{const r=e.getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2,v:e.dataset.vertical,i:e.dataset.segment}}))`))
const target = mids[Math.floor(mids.length / 2)]
const vertical = target.v === "1"
const before = JSON.stringify(c.bends)
await drag(target.x, target.y, target.x + (vertical ? 40 : 0), target.y + (vertical ? 0 : 40), { steps: 6 })
d = await saved(file)
c = d.items.find(i => i.kind === "connector")
ok("dragging a segment writes an override", c.overrides && c.overrides.length === 1, JSON.stringify(c.overrides))
ok("the line moved and stayed orthogonal", JSON.stringify(c.bends) !== before && orth(c), JSON.stringify(c.bends))
const want = (vertical ? target.x + 40 - cb.x : target.y + 40 - cb.y) / (vertical ? size.w : size.h)
ok("override value is the pointer's coordinate", c.overrides && Math.abs(c.overrides[0].value - want) < 0.02, `${c.overrides && c.overrides[0].value} vs ${want}`)

// double-click node A to label it
await key("Escape")
const aCx = A.center.x * size.w, aCy = A.center.y * size.h
await click(X(aCx), Y(aCy)); await click(X(aCx), Y(aCy))
await sleep(250)
ok("double-click opens the label editor", await js(`!!document.querySelector('.wm-label-edit')`))
await typeText("Start")
await key("Enter", { vk: 13, code: "Enter" })
d = await saved(file)
const A2 = d.items.find(i => i.kind === "shape" && i.id === A.id)
ok("label saved on the node", A2 && A2.label === "Start", JSON.stringify(A2 && A2.label))
await shot("conn3")

// Ctrl+Z (the app's undo) takes the label back
await js(`document.activeElement && document.activeElement.blur && document.activeElement.blur()`)
await key("z", { modifiers: CTRL })
d = await saved(file)
ok("Ctrl+Z took the label back", d.items.find(i => i.id === A.id).label === "")
// and Ctrl+Shift+Z brings it back
await key("z", { modifiers: CTRL | 8 })
d = await saved(file)
ok("Ctrl+Shift+Z put the label back", d.items.find(i => i.id === A.id).label === "Start")

// delete B: its connector goes with it
const bx = B2.center.x * size.w + B2.transform.dx * size.w, by = B2.center.y * size.h + B2.transform.dy * size.h
await click(X(bx - bw / 2 + 2), Y(by))
await key("Delete", { vk: 46, code: "Delete" })
d = await saved(file)
ok("deleting a node takes its arrow with it",
  !d.items.some(i => i.kind === "connector") && !d.items.some(i => i.id === B.id),
  JSON.stringify(d.items.map(i => i.kind)))
// Undo of a MOVE (the gesture is one entry on the app's history, taken back by Ctrl+Z).
await arm("oval"); await drag(X(100), Y(500), X(220), Y(560))
d = await saved(file)
const oval = d.items.find(i => i.kind === "shape" && i.shapeKind === "oval")
await drag(X(160), Y(530), X(260), Y(480), { steps: 8 })
d = await saved(file)
ok("the oval moved", d.items.find(i => i.id === oval.id).transform.dx > 0.01)
await js(`document.activeElement && document.activeElement.blur && document.activeElement.blur()`)
await key("z", { modifiers: CTRL })
d = await saved(file)
ok("Ctrl+Z put the oval back where it was", d.items.find(i => i.id === oval.id).transform.dx === 0)
finish()
