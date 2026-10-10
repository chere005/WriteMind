// A flow chart on the camera (a fake capture device playing chart.y4m) comes in as real nodes and arrows.
// @e2e video=chart
import { showVideoPane, pickCamera, key, CTRL, js, ok, finish, sleep, freshNote, saved, canvasBox, shot, waitFor } from "../../lib/harness.mjs"

const file = await freshNote()
await showVideoPane()
await pickCamera()
const live = await waitFor(`(() => { const v = document.querySelector('.camera video'); return v && v.videoWidth > 0 && v.readyState >= 2 })()`, 15000)
ok("the (fake) camera is delivering frames", live, await js(`document.querySelector('.camera [data-toast=error]')?.textContent ?? ''`))
if (!live) finish()
await sleep(500)
await shot("cam1")
await js(`[...document.querySelectorAll('.camera-bar button')].find(b => b.title === 'Take the writing off the page').click()`)
await sleep(2500)
const note = await js(`document.querySelector('.camera [data-toast]')?.textContent ?? ''`)
console.log("camera note:", note)
const d = await saved(file)
const shapes = d.items.filter(i => i.kind === "shape")
const conns = d.items.filter(i => i.kind === "connector")
const pics = d.items.filter(i => i.kind === "image")
ok("the writing is kept as a picture", pics.length === 1, JSON.stringify(d.items.map(i => i.kind)))
ok("three nodes read off the page", shapes.length === 3, `shapes=${shapes.length}`)
ok("they are rectangles", shapes.every(s => s.shapeKind === "rectangle" || s.shapeKind === "roundedRectangle"), JSON.stringify(shapes.map(s => s.shapeKind)))
ok("two arrows read", conns.length === 2, `connectors=${conns.length}`)
ok("each arrow is attached to two different nodes", conns.every(c => c.startNode && c.endNode && c.startNode !== c.endNode && shapes.some(s => s.id === c.startNode) && shapes.some(s => s.id === c.endNode)))
ok("arrowheads at the head end", conns.every(c => c.endHead === "arrow"))
const orth = (c) => { const pts = [c.start, ...c.bends, c.end]; return pts.slice(1).every((p, i) => Math.abs(p.x - pts[i].x) < 1e-6 || Math.abs(p.y - pts[i].y) < 1e-6) }
ok("the arrows were routed with right angles on arrival", conns.every(orth), JSON.stringify(conns.map(c => c.bends.length)))
const pic = pics[0]
ok("the chart lands under the picture it came from", pic && shapes.every(s => s.center.y > pic.center.y), `${pic && pic.center.y} vs ${shapes.map(s => s.center.y.toFixed(2))}`)
ok("the camera pane says it read a chart (a toast under the header)", /flow chart/i.test(note), note)
await shot("cam2")
// One undo takes the picture AND the chart back.
await js(`document.querySelector('.cm-content').focus()`)
await key("z", { modifiers: CTRL })
const after = await saved(file)
ok("one Ctrl+Z takes the capture and its chart back together", after.items.length === 0, JSON.stringify(after.items.map(i => i.kind)))
finish()
