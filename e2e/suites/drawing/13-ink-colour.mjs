// A COLOUR FOR THE WRITING YOU BROUGHT IN (Sean, 2026-10-10: "add a color picker for imported stroke graphics objects"). Two ways writing
// comes onto a page, and neither could be recoloured as a whole: the Wacom sheet's Bring in writing lands as MANY strokes, and the
// camera's Writing capture lands as ONE PICTURE whose file is the traced outline (an SVG filled with the pen's colour of that moment).
//   A. several strokes picked together: the bar has colour and width for the lot; the dot shows the colour they share, or a neutral
//      "mixed"; a swatch (or the custom colour) sets every one in ONE undo step.
//   B. an ink graphic picked: the same colour control rewrites the SVG's fill into a NEW media file and points the picture at it (one
//      undo step, the old file stays for Undo); a photo, a PNG and any other SVG have no colour; a mixed pick of graphics and strokes
//      recolours both together; a photo in the pick takes the colour away.
import {
  ok, finish, js, sleep, freshNote, setPen, canvasBox, saved, click, dragPath, line, key, shot, waitFor, setInput, closeAllTabs, setRendered,
  CTRL, SHIFT,
} from "../../lib/harness.mjs"

let file = await freshNote({ rendered: true })
let cb = await canvasBox()
const X = (dx) => cb.x + dx, Y = (dy) => cb.y + dy
/** The drawing's items as saved; with `until` (a test of the items) waits for it to hold, as `saved` does. */
const items = async (until) => (await saved(file, until ? (drawing) => until(drawing.items) : null)).items
const strokes = async (until) => (await items(until ? (all) => until(all.filter((i) => i.kind === "stroke")) : null)).filter((i) => i.kind === "stroke")
const has = (what) => js(`!!document.querySelector('.wm-insp [data-insp="${what}"]')`)
const popOpen = () => js(`!!document.querySelector('.wm-insp-pop')`)
const pressBar = async (what) => {
  const c = JSON.parse(await js(`(()=>{const b=document.querySelector('.wm-insp [data-insp="${what}"]');if(!b)return 'null';const r=b.getBoundingClientRect();return JSON.stringify({x:r.x+r.width/2,y:r.y+r.height/2})})()`))
  await click(c.x, c.y); await sleep(250)
}
const swatch = async (hex) => { await js(`document.querySelector('.wm-insp-pop [data-colour="${hex}"]').click()`); await sleep(300) }
const dotState = () => js(`(()=>{const d=document.querySelector('.wm-insp [data-insp=colour] .wm-insp-dot');if(!d)return 'null';const c=getComputedStyle(d);return JSON.stringify({mixed:d.dataset.mixed==='1',colour:c.backgroundColor,image:c.backgroundImage})})()`).then(JSON.parse)
const nameOfBar = () => js(`document.querySelector('[data-insp=name]')?.textContent`)
const marquee = async (x1, y1, x2, y2) => {
  await click(X(cb.w - 6), Y(cb.h - 6)); await sleep(150)
  await dragPath(line([X(x1), Y(y1)], [X(x2), Y(y2)], 16), { modifiers: CTRL }); await sleep(350)
}
// (The note has the keyboard: a script that ran before this one in the same app can leave the Find field focused, and a field has its own undo.)
const noteKeys = () => js(`document.querySelector('.cm-content')?.focus()`)
const undo = async () => { await noteKeys(); await key("z", { modifiers: CTRL }); await sleep(350) }
const redo = async () => { await noteKeys(); await key("z", { modifiers: CTRL | SHIFT }); await sleep(350) }
const BLUE = "rgb(45, 125, 210)", RED = "rgb(242, 84, 45)", PURPLE = "rgb(142, 68, 173)"

// =========================================================================================================================
// A. SEVERAL STROKES
// =========================================================================================================================
await setPen(true)
const wave = Array.from({ length: 40 }, (_, i) => [X(160 + i * 10), Y(220 + Math.sin(i / 3) * 40)])
await dragPath(wave, { pen: true })
await dragPath(line([X(180), Y(320)], [X(460), Y(400)], 30), { pen: true })
await dragPath(line([X(460), Y(320)], [X(180), Y(400)], 30), { pen: true })
await setPen(false)
let s = await strokes()
ok("three strokes are on the page", s.length === 3, String(s.length))
const pen = s[0].colorHex
ok("...all in the pen's colour", s.every((x) => x.colorHex === pen), JSON.stringify(s.map((x) => x.colorHex)))
const [waveId, diagA, diagB] = s.map((x) => x.id)

// One stroke picked by itself: red, so the three will differ.
await click(X(220), Y(220 + Math.sin(2) * 40)); await sleep(300)
ok("a click on the wave picks one stroke (a stroke's bar: colour and width)", (await nameOfBar()) === "Stroke" && (await has("colour")) && (await has("width")))
await pressBar("colour"); await swatch("#F2542D")
s = await strokes((d) => d.some((x) => x.colorHex === "#F2542D"))
ok("a swatch colours that one stroke only", s.filter((x) => x.colorHex === "#F2542D").length === 1 && s.find((x) => x.id === waveId)?.colorHex === "#F2542D", JSON.stringify(s.map((x) => x.colorHex)))

// Pick all three: the bar names them and offers colour and width for the lot, beside Group.
await marquee(60, 120, cb.w - 80, cb.h - 120)
ok("a marquee over the strokes picks all three", (await nameOfBar()) === "3 objects")
ok("...and the bar has colour and width for the lot (as well as Group, order, copy and delete)",
  (await Promise.all(["colour", "width", "group", "order", "duplicate", "delete"].map(has))).every(Boolean))
let dot = await dotState()
ok("the colour dot says 'mixed' when they differ (a neutral two-tone, no colour of theirs)", dot.mixed && /linear-gradient/.test(dot.image) && dot.colour !== RED, JSON.stringify(dot))
ok("...while the widths, which are the same, show the one number and not a dash", !(await js(`document.querySelector('.wm-insp [data-insp=width] .wm-insp-value')?.dataset.mixed`)) && (await js(`document.querySelector('.wm-insp [data-insp=width] .wm-insp-value').textContent`)) !== "–")
await shot("mixed")
await pressBar("colour")
ok("...the popover lights no swatch for a pick that differs", (await js(`document.querySelectorAll('.wm-insp-pop .wm-swatch.on').length`)) === 0)
await swatch("#2D7DD2")
s = await strokes((d) => d.every((x) => x.colorHex === "#2D7DD2"))
ok("ONE swatch colours every picked stroke", s.length === 3 && s.every((x) => x.colorHex === "#2D7DD2"), JSON.stringify(s.map((x) => x.colorHex)))
ok("...the popover closed", !(await popOpen()))
dot = await dotState()
ok("...and the dot now shows the colour they share", !dot.mixed && dot.colour === BLUE && dot.image === "none", JSON.stringify(dot))
await shot("shared")
await undo()
s = await strokes((d) => d.find((x) => x.id === waveId)?.colorHex === "#F2542D")
ok("ONE Ctrl+Z gives every stroke the colour it had (the wave red, the others the pen's)",
  s.find((x) => x.id === waveId).colorHex === "#F2542D" && s.find((x) => x.id === diagA).colorHex === pen && s.find((x) => x.id === diagB).colorHex === pen, JSON.stringify(s.map((x) => x.colorHex)))
ok("...the three are still picked, and the dot is mixed again", (await nameOfBar()) === "3 objects" && (await dotState()).mixed)
await redo()
s = await strokes((d) => d.every((x) => x.colorHex === "#2D7DD2"))
ok("Ctrl+Shift+Z colours them all again", s.every((x) => x.colorHex === "#2D7DD2"))

// The custom colour: a well in the popover, dragged through colours in one gesture, ONE undo step.
await sleep(1100)
await pressBar("colour")
await setInput(".wm-insp-pop input[type=color]", "#123456"); await sleep(150)
await setInput(".wm-insp-pop input[type=color]", "#654321"); await sleep(400)
s = await strokes((d) => d.every((x) => x.colorHex.toLowerCase() === "#654321"))
ok("the custom colour sets every picked stroke", s.every((x) => x.colorHex.toLowerCase() === "#654321"), JSON.stringify(s.map((x) => x.colorHex)))
await key("Escape"); await sleep(200)
await undo()
s = await strokes((d) => d.every((x) => x.colorHex === "#2D7DD2"))
ok("...two moves of the well are ONE undo step (back to the blue)", s.every((x) => x.colorHex === "#2D7DD2"), JSON.stringify(s.map((x) => x.colorHex)))

// Width for the lot.
await sleep(1000)
await pressBar("width")
await js(`document.querySelector('.wm-insp-pop [data-width="8"]').click()`); await sleep(300)
s = await strokes((d) => d.every((x) => x.width === 8))
ok("a width sets every picked stroke", s.length === 3 && s.every((x) => x.width === 8), JSON.stringify(s.map((x) => x.width)))
await undo()
s = await strokes((d) => d.every((x) => x.width !== 8))
ok("...in ONE undo step", s.every((x) => x.width !== 8), JSON.stringify(s.map((x) => x.width)))
// Different widths show as mixed: the wave alone gets a width, then all three are picked.
await click(X(cb.w - 6), Y(cb.h - 6)); await sleep(150)
await click(X(220), Y(220 + Math.sin(2) * 40)); await sleep(300)
await pressBar("width")
await js(`document.querySelector('.wm-insp-pop [data-width="12"]').click()`); await sleep(300)
await marquee(60, 120, cb.w - 80, cb.h - 120)
ok("strokes of different widths show 'mixed' for the width", (await js(`document.querySelector('.wm-insp [data-insp=width] .wm-insp-value').dataset.mixed`)) === "1")
await pressBar("width")
ok("...and the popover lights no width", (await js(`document.querySelectorAll('.wm-insp-pop [data-width].on').length`)) === 0)
await key("Escape"); await sleep(200)
await click(X(cb.w - 6), Y(cb.h - 6)); await sleep(150)

// =========================================================================================================================
// B. A CAMERA CAPTURE'S INK GRAPHIC
// =========================================================================================================================
file = await freshNote({ rendered: true })
cb = await canvasBox()
const traced = (fill) => `<svg xmlns="http://www.w3.org/2000/svg" width="240" height="120" viewBox="0 0 240 120"><path fill="${fill}" fill-rule="evenodd" d="M20 20L60 20L60 50L100 50L100 20L140 20L140 100L100 100L100 70L60 70L60 100L20 100ZM170 20L220 20L220 100L170 100Z"/></svg>`
const logoSvg = '<svg xmlns="http://www.w3.org/2000/svg" width="240" height="120" viewBox="0 0 240 120"><rect width="240" height="120" fill="#e03030"/><circle cx="120" cy="60" r="40" fill="#30c030"/></svg>'
const saveMedia = (text, ext) => js(`window.wm.saveMedia(new TextEncoder().encode(${JSON.stringify(text)}), ${JSON.stringify(ext)}, ${JSON.stringify(file)})`)
const mediaText = (name) => js(`window.wm.readMediaText(${JSON.stringify(name)}, ${JSON.stringify(file)})`)
const inkA = await saveMedia(traced("#2D7DD2"), ".svg")
const inkB = await saveMedia(traced("#1C1C1E"), ".svg")
const logo = await saveMedia(logoSvg, ".svg")
const pngBytes = await js(`(async()=>{const c=document.createElement('canvas');c.width=64;c.height=48;const x=c.getContext('2d');x.fillStyle='#e03030';x.fillRect(0,0,64,48);x.fillStyle='#30c030';x.fillRect(32,24,32,24);const b=await new Promise(r=>c.toBlob(r,'image/png'));return Array.from(new Uint8Array(await b.arrayBuffer()))})()`)
const photo = await js(`window.wm.saveMedia(new Uint8Array(${JSON.stringify(pngBytes)}), ".png", ${JSON.stringify(file)})`)
ok("the four pictures are in the note (named by what is in them)", [inkA, inkB, logo, photo].every((m) => /^[0-9a-f]{16}\.(svg|png)$/.test(m.file)) && inkA.file !== inkB.file, JSON.stringify([inkA, inkB, logo, photo]))

// Where things go, in page px: the graphics and two strokes in a band at the top, the logo and the photo below it.
const ROW = { top: 170, s1: 320, s2: 345, low: Math.min(520, cb.h - 90) }
const t0 = { dx: 0, dy: 0, scale: 1, rotation: 0 }
const picture = (id, f, x, y) => ({ kind: "image", id, file: f, center: { x, y }, width: 0.24, aspect: 0.5, transform: t0, hidden: false, group: null })
const pen2 = (id, colorHex, y) => ({ kind: "stroke", id, colorHex, width: 3, points: Array.from({ length: 12 }, (_, k) => ({ x: 0.1 + k * 0.012, y: y + Math.sin(k / 2) * 0.01 })), pressures: Array(12).fill(0.5), transform: t0, group: null })
await js(`window.wm.writeDrawing(${JSON.stringify(file)}, ${JSON.stringify(JSON.stringify({ items: [
  picture("inkA", inkA.file, 0.3, ROW.top / cb.h), picture("inkB", inkB.file, 0.68, ROW.top / cb.h),
  pen2("pen1", "#F2542D", ROW.s1 / cb.h), pen2("pen2", "#2FBF71", ROW.s2 / cb.h),
  picture("logo", logo.file, 0.3, ROW.low / cb.h), picture("photo", photo.file, 0.68, ROW.low / cb.h),
] }))})`)
// Reopen the note so the page reads that drawing.
await closeAllTabs()
await js(`[...document.querySelectorAll('.note-row')].find(r=>r.dataset.path===${JSON.stringify(file)})?.click()`)
await waitFor(`!!document.querySelector('.wm-canvas')`)
await setRendered(true)
await sleep(800)
cb = await canvasBox()
const at = (id, items_) => items_.find((i) => i.id === id)
let d = await saved(file)
const pageX = (f) => f * cb.w
/** The colour painted on the page's ink canvas at a point of picture `p` (in the picture's own 240 x 120). */
const pixelIn = (p, px, py) => {
  const w = p.width * cb.w, h = w * p.aspect
  const x = p.center.x * cb.w - w / 2 + px / 240 * w, y = p.center.y * cb.h - h / 2 + py / 120 * h
  return js(`(() => { const c = document.querySelector('.wm-ink'); const r = c.width / c.getBoundingClientRect().width; const d = c.getContext('2d').getImageData(Math.round(${x}*r), Math.round((${y} - c.offsetTop)*r), 1, 1).data; return [d[0], d[1], d[2], d[3]] })()`)
}
const near = (p, q) => p.slice(0, 3).every((v, i) => Math.abs(v - q[i]) < 40)
const rgb = (css) => css.match(/\d+/g).slice(0, 3).map(Number)
await sleep(500)
let a0 = at("inkA", d.items)
ok("the graphic is painted in its blue (the stem of the H)", near(await pixelIn(a0, 40, 60), rgb(BLUE)), JSON.stringify(await pixelIn(a0, 40, 60)))
await shot("seeded")

// ---- one graphic picked: it has a colour (and no width), a photo and another SVG have none
await click(X(pageX(0.3)), Y(ROW.top)); await sleep(300)
ok("a picked ink graphic is a Picture", (await nameOfBar()) === "Picture")
await waitFor(`!!document.querySelector('.wm-insp [data-insp=colour]')`, 5000).catch(() => {})
ok("...with a COLOUR in its bar (the page read the file once and found the traced outline)", await has("colour"))
ok("...beside its crop, still, and no line width (there is no pen in it)", (await has("crop")) && !(await has("width")))
dot = await dotState()
ok("the dot shows the graphic's fill", dot && !dot.mixed && dot.colour === BLUE, JSON.stringify(dot))
await shot("graphic")
await click(X(pageX(0.3)), Y(ROW.low)); await sleep(900)
ok("a picked SVG that is not a traced graphic (the logo, with its own fills) has NO colour", (await nameOfBar()) === "Picture" && (await has("crop")) && !(await has("colour")))
await click(X(pageX(0.68)), Y(ROW.low)); await sleep(900)
ok("a picked photo (a PNG) has no colour either", (await nameOfBar()) === "Picture" && (await has("crop")) && !(await has("colour")))

// ---- recolour one graphic: a NEW media file, the old one kept, one undo step
await click(X(pageX(0.3)), Y(ROW.top)); await sleep(400)
await waitFor(`!!document.querySelector('.wm-insp [data-insp=colour]')`, 5000)
await pressBar("colour")
ok("the colour popover is the stroke's own: six swatches and a colour well", (await js(`document.querySelectorAll('.wm-insp-pop .wm-swatch').length`)) === 6 && (await js(`!!document.querySelector('.wm-insp-pop input[type=color]')`)))
ok("...with the graphic's own blue lit", (await js(`document.querySelector('.wm-insp-pop .wm-swatch.on')?.dataset.colour`)) === "#2D7DD2")
await swatch("#F2542D")
d = await saved(file, (dd) => at("inkA", dd.items)?.file !== inkA.file)
const a1 = at("inkA", d.items)
ok("a swatch points the picture at a NEW file", a1.file !== inkA.file && /^[0-9a-f]{16}\.svg$/.test(a1.file), a1.file)
const newText = await mediaText(a1.file)
const oldText = await mediaText(inkA.file)
ok("...which is the same outline with its fill changed", newText === traced("#2D7DD2").replace("#2D7DD2", "#F2542D"), String(newText).slice(0, 200))
ok("...and the old file is untouched (Undo has it to go back to)", oldText === traced("#2D7DD2"))
ok("the picture is where it was, the same size", a1.center.x === a0.center.x && a1.center.y === a0.center.y && a1.width === a0.width && a1.aspect === a0.aspect)
ok("nothing else changed", at("inkB", d.items).file === inkB.file && at("pen1", d.items).colorHex === "#F2542D" && d.items.length === 6)
ok("the page paints it red now", near(await pixelIn(a1, 40, 60), rgb(RED)), JSON.stringify(await pixelIn(a1, 40, 60)))
dot = await dotState()
ok("the dot shows the new fill", dot && dot.colour === RED, JSON.stringify(dot))
ok("the popover closed", !(await popOpen()))
await shot("recoloured")
await undo()
d = await saved(file, (dd) => at("inkA", dd.items)?.file === inkA.file)
ok("ONE Ctrl+Z points it at the old file again", at("inkA", d.items).file === inkA.file, at("inkA", d.items).file)
ok("...and the page paints it blue again", near(await pixelIn(a0, 40, 60), rgb(BLUE)), JSON.stringify(await pixelIn(a0, 40, 60)))
await redo()
d = await saved(file, (dd) => at("inkA", dd.items)?.file === a1.file)
ok("Ctrl+Shift+Z recolours it again (the same new file: it is named by what is in it)", at("inkA", d.items).file === a1.file)
ok("...and it is red", near(await pixelIn(a1, 40, 60), rgb(RED)))
await undo()
await saved(file, (dd) => at("inkA", dd.items)?.file === inkA.file)

// ---- the custom colour on a graphic
await click(X(pageX(0.3)), Y(ROW.top)); await sleep(400)
await waitFor(`!!document.querySelector('.wm-insp [data-insp=colour]')`, 5000)
await pressBar("colour")
await setInput(".wm-insp-pop input[type=color]", "#00aa55"); await sleep(1200)
d = await saved(file, (dd) => at("inkA", dd.items)?.file !== inkA.file)
ok("the custom colour recolours it too", (await mediaText(at("inkA", d.items).file)) === traced("#2D7DD2").replace("#2D7DD2", "#00aa55"), String(await mediaText(at("inkA", d.items).file)).slice(0, 160))
await key("Escape"); await sleep(200)
await undo()
await saved(file, (dd) => at("inkA", dd.items)?.file === inkA.file)

// ---- graphics and strokes picked together: the colour goes to all of them, in one undo step
await marquee(40, 20, cb.w - 40, 380)
ok("a marquee over two graphics and two strokes picks four", (await nameOfBar()) === "4 objects")
await waitFor(`!!document.querySelector('.wm-insp [data-insp=colour]')`, 5000).catch(() => {})
ok("...the bar has a colour for the four (and no width: a picture has none)", (await has("colour")) && !(await has("width")) && (await has("group")))
dot = await dotState()
ok("...whose dot says mixed", dot && dot.mixed, JSON.stringify(dot))
await shot("graphics-and-strokes")
await pressBar("colour"); await swatch("#8E44AD")
d = await saved(file, (dd) => at("inkA", dd.items)?.file !== inkA.file && at("inkB", dd.items)?.file !== inkB.file && at("pen1", dd.items)?.colorHex === "#8E44AD" && at("pen2", dd.items)?.colorHex === "#8E44AD")
const purpleGraphic = traced("#8E44AD")
const texts = [await mediaText(at("inkA", d.items).file), await mediaText(at("inkB", d.items).file)]
ok("one swatch recoloured both graphics (new files, the same outlines, purple)", texts.every((t) => t === purpleGraphic), JSON.stringify(texts.map((t) => String(t).slice(0, 90))))
ok("...two graphics that look the same are the one file (it is named by what is in it)", at("inkA", d.items).file === at("inkB", d.items).file)
ok("...and both strokes", at("pen1", d.items).colorHex === "#8E44AD" && at("pen2", d.items).colorHex === "#8E44AD")
ok("...and left the logo and the photo alone", at("logo", d.items).file === logo.file && at("photo", d.items).file === photo.file)
dot = await dotState()
ok("the dot shows the one colour they have now", dot && !dot.mixed && dot.colour === PURPLE, JSON.stringify(dot))
await shot("purple")
await undo()
d = await saved(file, (dd) => at("inkA", dd.items)?.file === inkA.file)
ok("ONE Ctrl+Z gives all four back what they had",
  at("inkA", d.items).file === inkA.file && at("inkB", d.items).file === inkB.file && at("pen1", d.items).colorHex === "#F2542D" && at("pen2", d.items).colorHex === "#2FBF71",
  JSON.stringify(["inkA", "inkB", "pen1", "pen2"].map((id) => at(id, d.items).file ?? at(id, d.items).colorHex)))

// ---- a photo in the pick takes the colour away: it cannot be recoloured, so the lot cannot
await marquee(40, 20, cb.w - 40, cb.h - 30)
ok("a marquee over everything picks all six", (await nameOfBar()) === "6 objects")
await sleep(900)
ok("...and there is NO colour or width for the lot: the photo and the logo would not take it", !(await has("colour")) && !(await has("width")) && (await has("group")) && (await has("delete")))
await shot("with-a-photo")
finish()
