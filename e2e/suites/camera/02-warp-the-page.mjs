// A page seen in perspective (a fake capture device playing tilted.y4m) is squared up through its four corners.
// @e2e video=tilted
import fs from "node:fs"
import { FIXTURES, showVideoPane, pickCamera, js, ok, finish, sleep, drag, click, freshNote, saved, shot, waitFor } from "../../lib/harness.mjs"

const quad = JSON.parse(fs.readFileSync(FIXTURES.tiltedQuad, "utf8"))   // frame pixels, y down
const file = await freshNote()
await showVideoPane()
await pickCamera()
const live = await waitFor(`(() => { const v = document.querySelector('.camera video'); return v && v.videoWidth > 0 && v.readyState >= 2 })()`, 15000)
ok("the (fake) camera is delivering frames", live)
if (!live) finish()
await sleep(500)

// frame pixel -> screen pixel (the video is fitted whole, centred, in the camera pane)
const shown = JSON.parse(await js(`(() => { const v = document.querySelector('.camera video'); const r = v.getBoundingClientRect(); const s = Math.min(r.width / v.videoWidth, r.height / v.videoHeight); const w = v.videoWidth * s, h = v.videoHeight * s; return JSON.stringify({ x: r.x + (r.width - w) / 2, y: r.y + (r.height - h) / 2, s, fw: v.videoWidth, fh: v.videoHeight }) })()`))
const screen = ([px, py]) => ({ x: shown.x + px * shown.s, y: shown.y + py * shown.s })

await js(`(() => { const b = [...document.querySelectorAll('.camera-bar button')].find(b => b.title.startsWith('Square the page up')); if (!b.classList.contains('on')) b.click() })()`)
await sleep(300)
ok("four corners shown", await js(`document.querySelectorAll('.quad-corner').length`) === 4)
const names = { tl: "topLeft", tr: "topRight", br: "bottomRight", bl: "bottomLeft" }
for (const [short, long] of Object.entries(names)) {
  const at = JSON.parse(await js(`(() => { const r = document.querySelector('.quad-corner[data-corner="${long}"]').getBoundingClientRect(); return JSON.stringify({ x: r.x + r.width / 2, y: r.y + r.height / 2 }) })()`))
  const to = screen(quad[short])
  await drag(at.x, at.y, to.x, to.y, { steps: 6 })
}
await shot("warp1")

const analyse = (name) => js(`new Promise((res) => {
  const i = new Image(); i.crossOrigin = 'anonymous'
  i.onerror = () => res(null)
  i.onload = () => {
    const c = document.createElement('canvas'); c.width = i.naturalWidth; c.height = i.naturalHeight
    const x = c.getContext('2d'); x.drawImage(i, 0, 0)
    const W = c.width, H = c.height, d = x.getImageData(0, 0, W, H).data
    const g = (px, py) => d[(py * W + px) * 4]
    const left = []
    for (let f = 0.2; f <= 0.8; f += 0.05) { const row = Math.round(f * H); let k = 0; while (k < W && g(k, row) > 128) k++; left.push(k / W) }
    // the vertical bar of the cross at v = 0.25 (clear of the horizontal bar): where is ink near the middle?
    const row = Math.round(0.25 * H); let mid = -1; for (let k = Math.round(W * 0.4); k < W * 0.6; k++) if (g(k, row) < 128) { mid = k / W; break }
    let desk = 0; for (let k = 0; k < W * H; k++) { const v = d[k * 4]; if (v > 115 && v < 165) desk++ }
    const block = (bx, by) => { let t = 0, n = 0; for (let yy = by; yy < by + 14; yy++) for (let xx = bx; xx < bx + 14; xx++) { t += g(xx, yy); n++ } return t / n }
    const corners = Math.min(block(2, 2), block(W - 16, 2), block(2, H - 16), block(W - 16, H - 16))
    res({ W, H, left, mid, desk: desk / (W * H), corners })
  }
  i.src = 'wm://media/' + encodeURIComponent(${JSON.stringify(name)})
})`)

await js(`[...document.querySelectorAll('.camera-bar button')].find(b => b.title === 'Take the page as a photograph').click()`)
await sleep(2500)
let d = await saved(file)
let pics = d.items.filter(i => i.kind === "image")
ok("a picture was captured", pics.length === 1, JSON.stringify(d.items.map(i => i.kind)))
let a = await analyse(pics[0].file)
console.log(JSON.stringify(a))
ok("the squared page is portrait, near 5:7", a && Math.abs(a.H / a.W - 1.4) < 0.07, a && String(a.H / a.W))
const mean = a.left.reduce((s, v) => s + v, 0) / a.left.length
const spread = Math.max(...a.left) - Math.min(...a.left)
ok("the page's left border runs straight down the picture", spread < 0.01, `spread ${spread.toFixed(4)} of the width`)
ok("...and sits where the page has it (about 6-10% in)", mean > 0.05 && mean < 0.1, mean.toFixed(3))
ok("the cross's upright bar is in the middle", a.mid > 0.47 && a.mid < 0.53, String(a.mid))
ok("no desk in the picture's corners (all paper)", a.corners > 200, String(a.corners))
ok("the picture on the layer has the page's proportions", Math.abs(pics[0].aspect - 1.4) < 0.07, String(pics[0].aspect))
await shot("warp2")

// Now a box over the middle of the page: it is carried through the same perspective.
const c0 = screen([(quad.tl[0] + quad.br[0]) / 2, (quad.tl[1] + quad.br[1]) / 2])
await drag(c0.x - 60, c0.y - 50, c0.x + 60, c0.y + 50, { steps: 6 })
await js(`[...document.querySelectorAll('.camera-bar button')].find(b => b.title === 'Take the page as a photograph').click()`)
await sleep(2500)
d = await saved(file)
pics = d.items.filter(i => i.kind === "image")
ok("a second picture (the boxed part)", pics.length === 2)
const second = pics[1]
a = await analyse(second.file)
ok("the boxed part is smaller than the page", a && a.H < 1500 && a.W < 1200, a && `${a.W}x${a.H}`)
ok("the boxed part is all page (its corners are paper)", a.corners > 150, String(a.corners))
await shot("warp3")
finish()
