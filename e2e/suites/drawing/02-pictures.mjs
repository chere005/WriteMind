// Pictures on the drawing layer: paste, drop, crop box, undo through Ctrl+Z and Edit > Undo.
import { menuClick, js, ok, finish, sleep, drag, click, key, typeText, freshNote, saved, canvasBox, shot, CTRL, waitFor } from "../../lib/harness.mjs"

const file = await freshNote()
const cb = await canvasBox()
const size = { w: cb.w, h: cb.h }

// A test picture: four colour quadrants, 400x300, as a File.
await js(`window.__png = async () => {
  const c = document.createElement('canvas'); c.width = 400; c.height = 300; const x = c.getContext('2d');
  x.fillStyle = '#e03030'; x.fillRect(0,0,200,150); x.fillStyle = '#30c030'; x.fillRect(200,0,200,150);
  x.fillStyle = '#3030e0'; x.fillRect(0,150,200,150); x.fillStyle = '#e0e030'; x.fillRect(200,150,200,150);
  const blob = await new Promise(r => c.toBlob(r, 'image/png')); return new File([blob], 'quad.png', { type: 'image/png' }) }`)

/** The colour painted on the base canvas at a document point (the canvas is a band of the note in the scroller, from its `offsetTop`). */
const pixelAt = (px, py) => js(`(() => { const c = document.querySelector('.wm-ink'); const r = c.width / c.getBoundingClientRect().width; const d = c.getContext('2d').getImageData(Math.round(${px}*r), Math.round((${py} - c.offsetTop)*r), 1, 1).data; return [d[0], d[1], d[2], d[3]] })()`)
const near = (p, q) => p.slice(0, 3).every((v, i) => Math.abs(v - q[i]) < 40)

// Paste (Ctrl+V's event), as the clipboard would deliver it.
await js(`(async () => { const dt = new DataTransfer(); dt.items.add(await window.__png()); document.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true })) })()`)
await sleep(600)
let d = await saved(file)
let imgs = d.items.filter(i => i.kind === "image")
ok("paste put a picture on the drawing layer", imgs.length === 1, JSON.stringify(d.items.map(i => i.kind)))
const first = imgs[0]
const cx = first.center.x * size.w, cy = first.center.y * size.h
const w = first.width * size.w, h = w * first.aspect
ok("picture's aspect is the file's", Math.abs(first.aspect - 0.75) < 0.01, String(first.aspect))
await sleep(300)
ok("the canvas painted the picture (red top-left)", near(await pixelAt(cx - w / 4, cy - h / 4), [224, 48, 48]), JSON.stringify(await pixelAt(cx - w / 4, cy - h / 4)))
ok("...and green top-right", near(await pixelAt(cx + w / 4, cy - h / 4), [48, 192, 48]))

// Drop, on the stack.
await js(`(async () => { const dt = new DataTransfer(); dt.items.add(await window.__png()); document.querySelector('.stack').dispatchEvent(new DragEvent('drop', { dataTransfer: dt, bubbles: true, cancelable: true })) })()`)
await sleep(600)
d = await saved(file)
imgs = d.items.filter(i => i.kind === "image")
ok("drop put a second picture on the layer", imgs.length === 2, String(imgs.length))
ok("both pictures share the one file (same bytes)", imgs[0].file === imgs[1].file)
const target = imgs[1]   // the dropped one lies on top of the pasted one
await shot("pic1")

// The crop box: pick the first picture, press the scissors, drag the bottom-right corner to the middle.
await click(cb.x + cx - w / 4, cb.y + cy - h / 4)
await sleep(250)
ok("crop button shown for a picked picture", await js(`!!document.querySelector('.wm-handle[title="Crop this picture"]')`))
const scissors = JSON.parse(await js(`(() => { const r = document.querySelector('.wm-handle[title="Crop this picture"]').getBoundingClientRect(); return JSON.stringify({x: r.x + r.width/2, y: r.y + r.height/2}) })()`))
await click(scissors.x, scissors.y)
await sleep(250)
ok("crop box opened", await js(`!!document.querySelector('.wm-crop') && document.querySelectorAll('.wm-crop-corner').length === 4`))
const corner2 = JSON.parse(await js(`(() => { const r = document.querySelector('.wm-crop-corner[data-corner="2"]').getBoundingClientRect(); return JSON.stringify({x: r.x + r.width/2, y: r.y + r.height/2}) })()`))
await drag(corner2.x, corner2.y, cb.x + cx, cb.y + cy, { steps: 8 })     // to the middle of the picture
await shot("pic2")
const ok2 = JSON.parse(await js(`(() => { const r = document.querySelector('.wm-crop-ok').getBoundingClientRect(); return JSON.stringify({x: r.x + r.width/2, y: r.y + r.height/2}) })()`))
await click(ok2.x, ok2.y)
await sleep(900)
d = await saved(file)
const cropped = d.items.find(i => i.kind === "image" && i.id === target.id)
ok("cropping made a new file", cropped && cropped.file !== target.file, JSON.stringify(cropped && cropped.file))
ok("the kept part is half as wide", cropped && Math.abs(cropped.width - target.width / 2) < 0.02, `${cropped && cropped.width} vs ${target.width / 2}`)
ok("...and the aspect is unchanged for a quarter (0.75)", cropped && Math.abs(cropped.aspect - 0.75) < 0.03, String(cropped && cropped.aspect))
ok("the kept part stays where it was on the page (centre moved up-left)", cropped && Math.abs(cropped.center.x - (target.center.x - target.width / 4)) < 0.01, `${cropped && cropped.center.x}`)
const pic = await js(`new Promise((res) => { const i = new Image(); i.crossOrigin = 'anonymous'; i.onload = () => res([i.naturalWidth, i.naturalHeight]); i.onerror = () => res(null); i.src = 'wm://media/' + encodeURIComponent(${JSON.stringify(cropped?.file ?? "")}) })`)
ok("the new file is the cropped pixels (200x150)", pic && pic[0] === 200 && pic[1] === 150, JSON.stringify(pic))
const cx2 = cropped.center.x * size.w, cy2 = cropped.center.y * size.h
ok("the canvas shows only the red quadrant now", near(await pixelAt(cx2, cy2), [224, 48, 48]), JSON.stringify(await pixelAt(cx2, cy2)))

// Undo through the app: type some words first so the two histories interleave.
await js(`document.querySelector('.cm-content').focus()`)
await typeText("hello")
await sleep(300)
// Ctrl+Z: the words came last
await key("z", { modifiers: CTRL })
let text = await js(`document.querySelector('.cm-content').innerText`)
ok("first Ctrl+Z took the words back", !text.includes("hello"), JSON.stringify(text))
d = await sidecar_now()
async function sidecar_now() { return saved(file) }
ok("...and left the crop alone", d.items.find(i => i.id === target.id).file === cropped.file)
// Ctrl+Z again: nothing typed is left, so the crop goes
await key("z", { modifiers: CTRL })
d = await saved(file)
ok("next Ctrl+Z undid the crop (original file back)", d.items.find(i => i.id === target.id)?.file === target.file, JSON.stringify(d.items.find(i => i.id === target.id)?.file))
// Edit > Undo in the app's own menu (through the main process): the dropped picture goes
const clickedUndo = await menuClick("undo")
ok("Edit > Undo exists and was clicked", clickedUndo !== false, String(clickedUndo))
d = await saved(file)
ok("Edit > Undo took the dropped picture back", d.items.filter(i => i.kind === "image").length === 1, String(d.items.filter(i => i.kind === "image").length))
await menuClick("redo")
d = await saved(file)
ok("Edit > Redo brought it back", d.items.filter(i => i.kind === "image").length === 2)
// Ctrl+Z with focus in the notebook, then Ctrl+Shift+Z
await key("z", { modifiers: CTRL })
await key("z", { modifiers: CTRL | 8 })
d = await saved(file)
ok("Ctrl+Z then Ctrl+Shift+Z leaves two pictures", d.items.filter(i => i.kind === "image").length === 2)
await shot("pic3")
finish()
