// GRAB mode, first pass: the overlay appears, pen samples at the display's corners land on the sheet's corners,
// strokes arrive in the notes window's shared sheet and send into the note's sidecar with pressure.
// @e2e desktop
import { js, ok, finish, sleep, freshNote, saved, pickTablet, waitFor, barBtn, takeBtn, tabletBox , noGrab, showVideoPane, setWindowSize } from "../../lib/harness.mjs"
import { target, injector } from "../../lib/desktop.mjs"

const waitFor2 = async (t, expr, ms = 8000) => { const end = Date.now() + ms; while (Date.now() < end) { if (await t.js(expr)) return true; await sleep(150) } return false }
const near = (a, b, eps = 0.01) => Math.abs(a - b) <= eps
await js(`localStorage.removeItem('writemind.sheetAspect'); localStorage.removeItem('writemind.orientation'); localStorage.removeItem('writemind.grabAuto'); location.reload()`)
await sleep(3000)
await js(`window.wm.e2eSetBounds({ x: 0, y: 0, width: 1440, height: 900 })`)   // onscreen on purpose: the overlay maps to it
await sleep(500)
const file = await freshNote()
await showVideoPane()
await pickTablet()
await js(`window.__wmSheet.strokes = []`)

// LANDSCAPE BY DEFAULT: the sheet has the screen's (landscape) shape.
const shape = JSON.parse(await js(`(()=>{const b=document.querySelector('.camera .tablet').getBoundingClientRect();return JSON.stringify({w:b.width,h:b.height,sw:screen.width,sh:screen.height,o:localStorage.getItem('writemind.orientation'),sel:document.querySelector('[data-tablet=orientation]').value})})()`))
ok("the sheet is landscape by default (the screen's shape)", shape.w > shape.h && near(shape.w / shape.h, shape.sw / shape.sh, 0.02), JSON.stringify(shape))
ok("the orientation dropdown reads Match screen", shape.sel === "match")

const inj = injector()
try {
  const t = await tabletBox()
  await waitFor(`window.wm.e2eGrab().then(g => g.active)`, 4000)
  const before = await js(`window.wm.e2eGrab()`)
  ok("GRAB IS ON BY DEFAULT: the Tablet source took the tablet with no click", before.active, JSON.stringify(before))
  ok("the pane switch reads Grab: on", await js(`document.querySelector('[data-tablet=grab]').textContent`) === "Grab: on")
  await waitFor(`window.wm.e2eGrab().then(g => g.active)`, 5000)
  await sleep(1200)
  const g = await js(`window.wm.e2eGrab()`)
  console.log("grab", JSON.stringify(g))
  ok("an overlay window exists, covers the display, is on top, takes no focus", g.active && g.alwaysOnTop && g.focusable === false
    && g.bounds.x === g.display.x && g.bounds.y === g.display.y && g.bounds.width === g.display.width && g.bounds.height === g.display.height, JSON.stringify(g))
  ok("the exit key is registered while grabbed", g.shortcut)
  ok("it starts in mouse mode (nothing is held)", g.mode === "mouse", g.mode)

  const ov = await target("grab=1")
  await js(`window.wm.e2eGrabLock('pen')`)
  await sleep(300)
  ok("pen mode now", (await js(`window.wm.e2eGrab()`)).mode === "pen")
  const rect = JSON.parse(await ov.js(`JSON.stringify(document.querySelector('[data-grab=sheet]').getBoundingClientRect())`))
  console.log("overlay sheet rect", JSON.stringify(rect), "pane sheet", JSON.stringify(t))
  const win = await js(`window.wm.e2eWindow()`)
  ok("the overlay draws the sheet where the pane's sheet is on screen",
    near(rect.x, win.content.x + t.x, 1.5) && near(rect.y, win.content.y + t.y, 1.5) && near(rect.width, t.w, 1.5) && near(rect.height, t.h, 1.5),
    JSON.stringify({ rect, content: win.content, t }))

  await waitFor2(ov, `!document.querySelector(".grab-strip.shown")`)
  // Display corners (physical pixels; this display is 1920x1200 at 100%).
  const W = 1919, H = 1199   // the injector's 1920x1200 reference display
  const stroke = async (pts, p = 600) => {
    await inj.cmd(`pen hover ${pts[0][0]} ${pts[0][1]}`); await sleep(40)
    await inj.cmd(`pen hover ${pts[0][0]} ${pts[0][1]}`); await sleep(40)
    await inj.cmd(`pen down ${pts[0][0]} ${pts[0][1]} 300`)
    for (let i = 1; i < pts.length; i++) { await inj.cmd(`pen move ${pts[i][0]} ${pts[i][1]} ${300 + Math.round(i * 600 / pts.length)}`); await sleep(8) }
    await inj.cmd(`pen up ${pts.at(-1)[0]} ${pts.at(-1)[1]}`); await sleep(40)
    await inj.cmd(`pen leave ${pts.at(-1)[0]} ${pts.at(-1)[1]}`); await sleep(150)
  }
  const sheetStrokes = () => js(`JSON.stringify(window.__wmSheet.strokes.map(s => ({ p: s.points, n: s.pressures?.length ?? 0, pr: s.pressures })))`).then(JSON.parse)

  // A stroke from the display's top-left to its bottom-right, and the two other corners.
  await stroke([[0, 0], [400, 250], [900, 600], [W, H]])
  await stroke([[W, 0], [1200, 300], [600, 700], [0, H]])
  await sleep(500)
  const s = await sheetStrokes()
  console.log("strokes", JSON.stringify(s.map((x) => [x.p[0], x.p.at(-1), x.p.length])))
  ok("two strokes reached the notes window's sheet", s.length === 2, String(s.length))
  if (s.length === 2) {
    ok("top-left of the display is the sheet's top-left", near(s[0].p[0].x, 0, 0.004) && near(s[0].p[0].y, 0, 0.004), JSON.stringify(s[0].p[0]))
    ok("bottom-right of the display is the sheet's bottom-right", near(s[0].p.at(-1).x, 1, 0.004) && near(s[0].p.at(-1).y, 1, 0.004), JSON.stringify(s[0].p.at(-1)))
    ok("top-right is the sheet's top-right", near(s[1].p[0].x, 1, 0.004) && near(s[1].p[0].y, 0, 0.004), JSON.stringify(s[1].p[0]))
    ok("bottom-left is the sheet's bottom-left", near(s[1].p.at(-1).x, 0, 0.004) && near(s[1].p.at(-1).y, 1, 0.004), JSON.stringify(s[1].p.at(-1)))
    ok("proportional: the display's centre is the sheet's centre", near(s[0].p[2].x, 900 / W, 0.004) && near(s[0].p[2].y, 600 / H, 0.004), JSON.stringify(s[0].p[2]))
    ok("pressure per point, rising", s[0].n === s[0].p.length && s[0].pr.at(-1) > s[0].pr[0] + 0.2, JSON.stringify(s[0].pr))
  }
  // The notes window drew them too (the pane's canvas), and the overlay shows them.
  const ovInk = await ov.js(`(()=>{const c=document.querySelector('[data-grab=sheet] canvas');const d=c.getContext('2d').getImageData(0,0,c.width,c.height).data;let n=0;for(let i=3;i<d.length;i+=4)if(d[i]>0)n++;return n})()`)
  ok("the overlay draws the ink live", ovInk > 200, String(ovInk))
  const paneInk = await js(`(()=>{const c=document.querySelector('.camera .tablet canvas');const d=c.getContext('2d').getImageData(0,0,c.width,c.height).data;let n=0;for(let i=3;i<d.length;i+=4)if(d[i]>0)n++;return n})()`)
  ok("and the pane's own sheet has the same ink", paneInk > 200, String(paneInk))

  // Send Writing from the pane's button puts the strokes in the note's sidecar with pressure.
  await js(`document.querySelector('.cm-content').focus()`)
  await takeBtn("Bring the writing in")
  const d = await saved(file)
  const strokes = d.items.filter((i) => i.kind === "stroke")
  ok("the strokes arrived in the note's sidecar with pressure", strokes.length === 2 && strokes.every((x) => x.pressures?.length === x.points.length), JSON.stringify(d.items.map((i) => i.kind)))
  ok("the sheet cleared (and the overlay with it)", (await sheetStrokes()).length === 0 && (await ov.js(`window.__ev ? 0 : 0`)) === 0)

  // Switching Grab off restores everything (the pen roams the screen again).
  await barBtn("grab")
  await waitFor(`window.wm.e2eGrab().then(g => !g.active)`, 5000)
  await sleep(500)
  const after = await js(`window.wm.e2eGrab()`)
  ok("Release closes the overlay and frees the key", !after.active && !after.shortcut, JSON.stringify(after))
  ov.close()
} finally { inj.quit() }
finish()
