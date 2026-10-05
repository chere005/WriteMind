// A 1.5x display: the canvas backs itself with 1.5 pixels to a CSS pixel (crisp ink), a drawn stroke's handles
// stay on the stroke, and a window resize keeps both in step. The metrics override is page-level and is cleared
// at the end. (Was tour/t16.mjs.)
import { ok, finish, js, send, sleep, freshNote, setPen, canvasBox, saved, click, dragPath, line, handles, shot } from "../../lib/harness.mjs"

const file = await freshNote()
try {
  await send("Emulation.setDeviceMetricsOverride", { width: 1280, height: 720, deviceScaleFactor: 1.5, mobile: false })
  await sleep(800)
  ok("the page reports a device pixel ratio of 1.5", (await js(`devicePixelRatio`)) === 1.5)
  const backing = async () => js(`(()=>{const c=document.querySelector('.wm-canvas canvas');const r=c.getBoundingClientRect();return {w:c.width,h:c.height,cssW:r.width,cssH:r.height}})()`)
  let b = await backing()
  ok("the canvas has 1.5 backing pixels per CSS pixel", Math.abs(b.w / b.cssW - 1.5) < 0.02 && Math.abs(b.h / b.cssH - 1.5) < 0.02, JSON.stringify(b))

  const cb = await canvasBox()
  await setPen(true)
  await dragPath(line([cb.x + 150, cb.y + 200], [cb.x + 450, cb.y + 200], 20), { pen: true }); await sleep(300)
  await dragPath(line([cb.x + 150, cb.y + 250], [cb.x + 450, cb.y + 320], 20), { pen: true }); await sleep(300)
  ok("two strokes drawn on the 1.5x page", (await saved(file)).items.filter((i) => i.kind === "stroke").length === 2)
  await shot("hidpi-ink")
  await setPen(false)
  await click(cb.x + 300, cb.y + 200); await sleep(250)
  const hs = await handles()
  ok("a click on the stroke picks it", hs.length >= 3, JSON.stringify(hs.map((h) => h.t)))
  const xs = hs.map((h) => h.x), ys = hs.map((h) => h.y)
  ok("its handles stand around the stroke (not scaled away from it)",
    Math.min(...xs) < cb.x + 150 + 40 && Math.max(...xs) > cb.x + 450 - 40 && Math.min(...ys) < cb.y + 200 + 30 && Math.max(...ys) > cb.y + 200 - 30,
    JSON.stringify({ xs: [Math.min(...xs), Math.max(...xs)], ys: [Math.min(...ys), Math.max(...ys)], stroke: [cb.x + 150, cb.x + 450, cb.y + 200] }))
  await shot("hidpi-handles")

  // narrower: the canvas and the picture of the ink follow the pane
  await send("Emulation.setDeviceMetricsOverride", { width: 900, height: 600, deviceScaleFactor: 1.5, mobile: false })
  await sleep(700)
  b = await backing()
  ok("after a resize the backing store follows the pane", Math.abs(b.w / b.cssW - 1.5) < 0.02, JSON.stringify(b))
  ok("and nothing was lost", (await saved(file)).items.filter((i) => i.kind === "stroke").length === 2)
  await shot("hidpi-narrow")
} finally {
  await send("Emulation.clearDeviceMetricsOverride")
}
finish()
