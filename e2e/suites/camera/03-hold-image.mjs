// Hold image (Sean, 2026-10-05): the camera pane's "Hold image" keeps one frame still; the box, Straighten and every
// capture use the HELD frame; pressing it again or Esc (with the pane focused) is the live picture again; another
// source (the camera off, the tablet) lets go. The fake camera plays moving.y4m: a block steps along the bottom one
// place a frame, so where the block is says which frame a picture is.
// @e2e video=moving
import { MOVING_DX, MOVING_X0 } from "../../lib/fixtures.mjs"
import {
  showVideoPane, pickCamera, pickTablet, key, js, ok, finish, sleep, freshNote, saved, shot, waitFor, click, drag, rectOf,
} from "../../lib/harness.mjs"

const file = await freshNote({ video: true })
await showVideoPane()
await pickCamera()
const live = await waitFor(`(() => { const v = document.querySelector('.camera video'); return v && v.videoWidth > 0 && v.readyState >= 2 })()`, 15000)
ok("the (fake) camera is delivering frames", live, await js(`document.querySelector('.camera .trouble')?.textContent ?? ''`))
if (!live) finish()
await sleep(600)

// Where the dark block starts on row 410 of the frame (frame pixels), in the live video, the still, or a picture.
const BLOCK = `(c) => { const x = c.getContext('2d', { willReadFrequently: true }); const y = Math.round(410 * c.height / 480);
  const d = x.getImageData(0, y, c.width, 1).data; for (let i = 0; i < c.width; i++) if (d[i * 4] < 90) return Math.round(i * 640 / c.width); return -1 }`
const videoBlock = () => js(`(() => { const v = document.querySelector('.camera video'); const c = document.createElement('canvas');
  c.width = v.videoWidth; c.height = v.videoHeight; c.getContext('2d').drawImage(v, 0, 0); return (${BLOCK})(c) })()`)
const stillBlock = () => js(`(() => { const c = document.querySelector('.camera canvas.still'); return c && c.width > 0 ? (${BLOCK})(c) : -2 })()`)
const pictureBlock = (name) => js(`new Promise((res) => { const i = new Image(); i.crossOrigin = 'anonymous'; i.onerror = () => res(null)
  setTimeout(() => res(null), 5000)
  i.onload = () => { try { const c = document.createElement('canvas'); c.width = i.naturalWidth; c.height = i.naturalHeight; c.getContext('2d').drawImage(i, 0, 0)
    res({ w: c.width, h: c.height, x: (${BLOCK})(c) }) } catch (e) { res({ error: String(e) }) } }
  i.src = 'wm://media/' + encodeURIComponent(${JSON.stringify(name)}) })`)
const onAStep = (x) => x >= 0 && Math.abs(((x - MOVING_X0) / MOVING_DX) - Math.round((x - MOVING_X0) / MOVING_DX)) < 0.1
const state = () => js(`(() => { const b = document.querySelector('.camera [data-camera=hold]'); const s = document.querySelector('.camera canvas.still');
  return { pressed: b?.getAttribute('aria-pressed'), on: !!b?.classList.contains('on'), disabled: !!b?.disabled, word: !!document.querySelector('.camera [data-camera=held]'),
    still: s ? getComputedStyle(s).display !== 'none' && s.width > 0 : false, video: getComputedStyle(document.querySelector('.camera video')).visibility } })()`)
const pictures = async () => (await saved(file)).items.filter((i) => i.kind === "image")
const pressHold = async () => { const r = await rectOf(".camera [data-camera=hold]"); await click(r.x + r.w / 2, r.y + r.h / 2); await sleep(150) }
const takeRaw = async () => { const r = await rectOf(".camera-bar [data-capture=raw]"); await click(r.x + r.w / 2, r.y + r.h / 2); await sleep(1500) }

// THE FEED MOVES (so a still is told from it).
const seen = new Set()
for (let i = 0; i < 4; i++) { seen.add(await videoBlock()); await sleep(260) }
ok("the live picture moves (the block steps along)", seen.size >= 2, JSON.stringify([...seen]))
let s = await state()
ok("Hold image is in the header, enabled, not pressed", s.pressed === "false" && !s.on && !s.disabled && !s.word, JSON.stringify(s))

// HOLD: the picture stops; the button looks pressed and the line under it says "Held".
await pressHold()
s = await state()
ok("pressing it holds: the button is pressed and says so", s.pressed === "true" && s.on, JSON.stringify(s))
ok("a quiet 'Held' word under the picture", s.word)
ok("the still stands in for the video", s.still && s.video === "hidden", JSON.stringify(s))
const held1 = await stillBlock()
await sleep(700)
const held2 = await stillBlock()
const liveNow = [await videoBlock()]; await sleep(260); liveNow.push(await videoBlock())
ok("the held picture does not move", held1 === held2 && onAStep(held1), `${held1} then ${held2}`)
ok("...while the camera plays on underneath", liveNow[0] !== liveNow[1] || liveNow[0] !== held1, JSON.stringify(liveNow))
await shot("held")

// EVERY CAPTURE IS OF THE HELD FRAME: two Raw pictures some time apart, the same frame.
await takeRaw()
await sleep(600)
await takeRaw()
let pics = await pictures()
ok("two Raw pictures taken while held", pics.length === 2, JSON.stringify(pics.length))
const a = pics[0] && await pictureBlock(pics[0].file), b = pics[1] && await pictureBlock(pics[1].file)
ok("the first is the held frame (the block where the still has it)", a && Math.abs(a.x - held1) <= 3, JSON.stringify({ a, held1 }))
ok("so is the second, taken later", b && Math.abs(b.x - held1) <= 3, JSON.stringify({ b, held1 }))

// THE BOX on the held picture, then Writing from it: the box's part of the held frame comes in as writing.
const vf = await rectOf(".camera .viewfinder")
const fit = Math.min(vf.w / 640, vf.h / 480), ox = vf.x + (vf.w - 640 * fit) / 2, oy = vf.y + (vf.h - 480 * fit) / 2
const at = (fx, fy) => [ox + fx * fit, oy + fy * fit]
const [bx0, by0] = at(60, 50), [bx1, by1] = at(270, 150)
await drag(bx0, by0, bx1, by1, { steps: 8 })
await sleep(200)
ok("a box drawn on the held picture", await js(`!!document.querySelector('.camera .box-clip .box')`))
ok("the picture is still held after the drag", (await state()).pressed === "true")
const choice = await rectOf(".camera .box-choices [data-section=writing]")
if (choice) await click(choice.x + choice.w / 2, choice.y + choice.h / 2)
// The box goes once the capture is in (a box holding a closed outline is read for a chart first, which takes a moment).
await waitFor(`!document.querySelector('.camera .box-clip .box')`, 15000)
await sleep(300)
const all = (await saved(file)).items
ok("Writing from the box on the held frame came in", all.filter((i) => i.kind === "image").length === 3,
  JSON.stringify(all.map((i) => i.kind)) + " " + (await js(`(document.querySelector('.camera .trouble')?.textContent ?? '') + ' | ' + document.querySelector('.camera .note').innerText`)))
await shot("held-writing")
ok("the picture stays held after a capture", (await state()).pressed === "true")

// STRAIGHTEN works on the held frame too (its corners appear on it; Find page looks at the still).
await js(`[...document.querySelectorAll('.camera-bar button')].find(b => b.title.startsWith('Square the page up')).click()`)
await sleep(400)
ok("Straighten shows its corners on the held picture", await js(`document.querySelectorAll('.camera .quad-corner').length`) === 4)
await js(`[...document.querySelectorAll('.camera-bar button')].find(b => b.title.startsWith('Square the page up')).click()`)
await sleep(200)

// A QUARTER TURN turns the still with the picture, and a capture is the held frame turned.
await js(`document.querySelector('[data-camera-turn=right]').click()`)
await sleep(400)
const before = (await pictures()).length
await takeRaw()
pics = await pictures()
const turned = pics.length === before + 1 ? await pictureBlock(pics[pics.length - 1].file) : null
ok("turned while held: the capture is the held frame turned a quarter (480 x 640)", turned && turned.w === 480 && turned.h === 640, JSON.stringify(turned))
ok("still held after the turn", (await state()).pressed === "true")
await shot("held-turned")
await js(`document.querySelector('[data-camera-turn=left]').click()`)
await sleep(400)

// ESC WITH THE PANE FOCUSED: a click on the picture (which boxes the whole picture) focuses the pane; the first Esc
// takes the box away, the next lets go.
const [cx, cy] = at(320, 300)
await click(cx, cy)
await sleep(500)
ok("a click on the picture puts the keyboard in the pane", await js(`document.activeElement === document.querySelector('.camera')`), await js(`document.activeElement?.className ?? ''`))
const boxed = await js(`!!document.querySelector('.camera .box-clip .box')`)
await key("Escape")
await sleep(150)
ok("Esc takes the box away first, and the picture stays held", !(await js(`!!document.querySelector('.camera .box-clip .box')`)) && (await state()).pressed === "true", `boxed=${boxed}`)
await key("Escape")
await sleep(200)
s = await state()
ok("the next Esc is the live picture again", s.pressed === "false" && !s.on && !s.word && !s.still && s.video !== "hidden", JSON.stringify(s))
const after = new Set(); for (let i = 0; i < 3; i++) { after.add(await videoBlock()); await sleep(260) }
ok("...and it moves again", after.size >= 2, JSON.stringify([...after]))

// Esc right after pressing the button (the button has the keyboard) lets go; Esc in the NOTES does not.
await pressHold()
await key("Escape")
await sleep(150)
ok("Esc after pressing Hold image lets go", (await state()).pressed === "false")
await pressHold()
await js(`document.querySelector('.cm-content').focus()`)
await key("Escape")
await sleep(150)
ok("Esc in the notes leaves the picture held", (await state()).pressed === "true")
// PRESSING IT AGAIN lets go.
await pressHold()
ok("pressing it again lets go", (await state()).pressed === "false")

// ANOTHER SOURCE LETS GO: the camera turned off, the tablet.
await pressHold()
await js(`document.querySelector('[data-bar=video-options]').click()`)
await sleep(150)
await js(`[...document.querySelectorAll('.video-pop button')].find(b => b.textContent.includes('Turn Camera Off')).click()`)
await sleep(600)
await pickCamera()
await waitFor(`(() => { const v = document.querySelector('.camera video'); return v && v.videoWidth > 0 && v.readyState >= 2 })()`, 15000)
await sleep(400)
s = await state()
ok("turning the camera off lets go (back on, it is live)", s.pressed === "false" && !s.still, JSON.stringify(s))
await pressHold()
ok("held again", (await state()).pressed === "true")
await pickTablet()
ok("the tablet shows no Hold image", !(await js(`!!document.querySelector('.camera [data-camera=hold]')`)))
await pickCamera()
await waitFor(`(() => { const v = document.querySelector('.camera video'); return v && v.videoWidth > 0 && v.readyState >= 2 })()`, 15000)
await sleep(400)
s = await state()
ok("switching to the tablet let go (back on the camera, it is live)", s.pressed === "false" && !s.still, JSON.stringify(s))
await shot("live-again")
finish()
