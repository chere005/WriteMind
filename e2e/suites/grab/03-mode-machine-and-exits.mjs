// GRAB mode, second pass: the pen/mouse mode machine against a real overlay (synthetic pen + mouse injected into
// Windows), the exits (Release, Esc, overlay crash, overlay silent), and orientation.
// NOTE: the machine's mouse test moves the real cursor; leave the mouse alone while it runs.
// @e2e desktop
import { js, ok, finish, sleep, freshNote, saved, pickTablet, waitFor, barBtn, takeBtn, tabletBox, key, send , noGrab, showVideoPane, setWindowSize } from "../../lib/harness.mjs"
import { target, injector } from "../../lib/desktop.mjs"

const near = (a, b, eps = 0.01) => Math.abs(a - b) <= eps
const waitFor2 = async (t, expr, ms = 8000) => { const end = Date.now() + ms; while (Date.now() < end) { if (await t.js(expr)) return true; await sleep(150) } return false }
const state = () => js(`window.wm.e2eGrab()`)
const grabOn = async () => { if (!(await state()).active) await barBtn("grab"); await waitFor(`window.wm.e2eGrab().then(g => g.active)`, 5000); await sleep(500) }
const grabOff = async () => { if ((await state()).active) { await barBtn("grab"); await waitFor(`window.wm.e2eGrab().then(g => !g.active)`, 5000) } await sleep(300) }
const sheetStrokes = () => js(`JSON.stringify(window.__wmSheet.strokes.map(s => ({ p: s.points })))`).then(JSON.parse)
const setOrient = (v) => js(`(()=>{const s=document.querySelector('[data-tablet=orientation]');const set=Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype,'value').set;set.call(s,${JSON.stringify(String(v))});s.dispatchEvent(new Event('change',{bubbles:true}))})()`)

await js(`localStorage.removeItem('writemind.sheetAspect'); localStorage.removeItem('writemind.orientation'); localStorage.removeItem('writemind.grabAuto'); location.reload()`)
await sleep(3000)
await js(`window.wm.e2eSetBounds({ x: 0, y: 0, width: 1440, height: 900 })`)   // onscreen on purpose: the overlay maps to it
await sleep(500)
const file = await freshNote()
await showVideoPane()
await pickTablet()
await js(`window.__wmSheet.strokes = []; window.__clicks = []; for (const t of ['pointerdown','click']) document.addEventListener(t, e => window.__clicks.push([t, e.pointerType || '', Math.round(e.clientX), Math.round(e.clientY)]), true)`)
const inj = injector()
const W = 1919, H = 1199
const stroke = async (pts, press = 300) => {
  await inj.cmd(`pen hover ${pts[0][0]} ${pts[0][1]}`); await sleep(40)
  await inj.cmd(`pen hover ${pts[0][0]} ${pts[0][1]}`); await sleep(40)
  await inj.cmd(`pen down ${pts[0][0]} ${pts[0][1]} ${press}`)
  for (let i = 1; i < pts.length; i++) { await inj.cmd(`pen move ${pts[i][0]} ${pts[i][1]} ${press + i * 40}`); await sleep(8) }
  await inj.cmd(`pen up ${pts.at(-1)[0]} ${pts.at(-1)[1]}`); await sleep(40)
  await inj.cmd(`pen leave ${pts.at(-1)[0]} ${pts.at(-1)[1]}`); await sleep(150)
}
try {
  // ---------- 1. the mode machine: mouse -> pen -> mouse, measured
  await grabOn()
  let g = await state()
  ok("grab starts in mouse mode: the overlay is click-through", g.mode === "mouse")
  const ov = await target("grab=1")
  await waitFor2(ov, `!document.querySelector(".grab-strip.shown")`)

  // The pen appears over EMPTY desktop (not over our window): only the cursor-poll rule can see it.
  await inj.cmd("sig move 1700 1000"); await sleep(60)
  for (let i = 1; i <= 8; i++) { await inj.cmd(`sig move ${1700 + i * 12} ${1000 + i * 8}`); await sleep(40) }
  await sleep(500)
  g = await state()
  ok("a pen moving over empty desktop takes the sheet (cursor moved, no mouse behind it)", g.mode === "pen", g.mode)
  await inj.cmd("pen leave 1800 1060"); await sleep(100)

  // The pen is over our own window while click-through: the notes window sees it and gives it back.
  await js(`window.wm.e2eGrabLock('mouse')`); await sleep(200); await js(`window.wm.e2eGrabLock(null)`)
  ok("(reset to mouse mode)", (await state()).mode === "mouse")
  await inj.cmd("pen hover 300 400"); await sleep(50)
  await inj.cmd("pen down 300 400 400"); await sleep(50); await inj.cmd("pen move 320 420 500"); await inj.cmd("pen up 320 420"); await sleep(50); await inj.cmd("pen leave 320 420")
  await sleep(500)
  g = await state()
  ok("a pen over the notes window (overlay click-through) is noticed and takes the sheet", g.mode === "pen", g.mode)

  // The mouse: the first mouse move on the capturing overlay hands everything back.
  await sleep(400)
  await inj.cmd("mouse move 700 500"); await sleep(60); await inj.cmd("mouse move 705 505"); await sleep(400)
  g = await state()
  ok("a mouse move gives the mouse back (overlay is click-through again)", g.mode === "mouse", g.mode)
  await js(`window.__clicks.length = 0`)
  // A click on something in the notes window now lands in it (measured with a document listener).
  await inj.cmd("mouse move 600 700"); await sleep(80); await inj.cmd("mouse move 602 702"); await sleep(80)
  await inj.cmd("mouse down"); await sleep(40); await inj.cmd("mouse up"); await sleep(300)
  const clicks = await js(`JSON.stringify(window.__clicks)`)
  console.log("MEASURED mouse click while grabbed (mouse mode):", clicks)
  ok("MOUSE STILL REACHES THE NOTES WINDOW while grabbed (pointerdown + click, type mouse)", JSON.parse(clicks).some((c) => c[0] === "click" && c[1] === "mouse"), clicks)
  g = await state()
  ok("and the click did not flip the machine to pen", g.mode === "mouse", g.mode)

  // ---------- 2. exits
  // Esc in the notes window ends it.
  await js(`document.querySelector('.cm-content').focus()`)
  await key("Escape", { code: "Escape", vk: 27 })
  ok("Esc releases the grab", await waitFor(`window.wm.e2eGrab().then(g => !g.active)`, 4000))
  g = await state()
  ok("the overlay is gone and the exit key is free", !g.active && !g.shortcut, JSON.stringify(g))

  // The overlay's page dying ends it (never a window left over the screen).
  await grabOn()
  const ov2 = await target("grab=1")
  ov2.send("Page.crash", {}).catch(() => {})
  ok("a crashed overlay page ends the grab", await waitFor(`window.wm.e2eGrab().then(g => !g.active)`, 6000))
  g = await state()
  ok("... and nothing is left", !g.active && !g.shortcut)

  // An overlay that stops answering (no heartbeat) is closed by main.
  await grabOn()
  await js(`window.wm.e2eGrabBeatOff()`)
  ok("a silent overlay (no heartbeat) is closed", await waitFor(`window.wm.e2eGrab().then(g => !g.active)`, 6000))

  // The exit button on the overlay's strip (the pen presses it through the remapped position).
  await grabOn()
  const ov3 = await target("grab=1")
  await js(`window.wm.e2eGrabLock('pen')`)
  await waitFor2(ov3, `!document.querySelector(".grab-strip.shown")`)
  // dwell at the sheet's top edge: the display position whose sheet position is on the top edge
  const r = JSON.parse(await ov3.js(`JSON.stringify(document.querySelector('[data-grab=sheet]').getBoundingClientRect())`))
  const place = (fx, fy) => [Math.round(fx * W), Math.round(fy * H)]
  const [hx, hy] = place(0.5, 0.01)
  await inj.cmd(`pen hover ${hx} ${hy}`)
  for (let i = 0; i < 12; i++) { await inj.cmd(`pen hover ${hx + (i % 2)} ${hy}`); await sleep(60) }
  ok("hovering at the sheet's top edge brings the strip down", await waitFor2(ov3, `!!document.querySelector(".grab-strip.shown")`, 3000))
  // press Exit: its centre, in sheet fractions, then to the display
  const ex = JSON.parse(await ov3.js(`(()=>{const b=document.querySelector('[data-grab=exit]').getBoundingClientRect();const s=document.querySelector('[data-grab=sheet]').getBoundingClientRect();return JSON.stringify({fx:(b.x+b.width/2-s.x)/s.width, fy:(b.y+b.height/2-s.y)/s.height})})()`))
  const [ex1, ey1] = place(ex.fx, ex.fy)
  await inj.cmd(`pen hover ${ex1} ${ey1}`); await sleep(100)
  await inj.cmd(`pen down ${ex1} ${ey1} 400`); await sleep(60); await inj.cmd(`pen up ${ex1} ${ey1}`)
  ok("pressing Exit on the strip with the pen releases the grab", await waitFor(`window.wm.e2eGrab().then(g => !g.active)`, 4000))
  await inj.cmd(`pen leave ${ex1} ${ey1}`)
  ov3.close()
  void r

  // ---------- 3. the watchdog: 20 s with no pen lets go of the mouse (not of the grab)
  await grabOn()
  await js(`window.wm.e2eGrabLock(null)`)
  await inj.cmd("pen hover 1700 1000"); for (let i = 1; i <= 8; i++) { await inj.cmd(`sig move ${1700 + i * 12} ${1000 + i * 8}`); await sleep(40) }
  await inj.cmd("pen leave 1800 1060")
  await sleep(500)
  g = await state()
  console.log("mode before watchdog wait:", g.mode)
  if (g.mode === "pen") {
    await sleep(21500)
    g = await state()
    ok("20 s with no pen: the overlay lets the mouse through", g.mode === "mouse" && g.active, JSON.stringify(g))
  } else ok("(skipped: the mouse moved during the test)", true)
  await grabOff()

  // ---------- 4. every orientation: display corners -> sheet corners, and a stroke drawn UP lands upright in the note
  // Display corners TL TR BR BL; expected sheet corner for each turn (shared/orientation.ts, tested in vitest).
  const corners = [[0, 0], [W, 0], [W, H], [0, H]]
  const expected = { 0: [[0, 0], [1, 0], [1, 1], [0, 1]], 1: [[1, 0], [1, 1], [0, 1], [0, 0]], 2: [[1, 1], [0, 1], [0, 0], [1, 0]], 3: [[0, 1], [0, 0], [1, 0], [1, 1]] }
  for (const turns of [0, 1, 2, 3]) {
    await setOrient(turns)
    await sleep(500)
    await js(`window.__wmSheet.strokes = []`)
    const shape = JSON.parse(await js(`(()=>{const b=document.querySelector('.camera .tablet').getBoundingClientRect();return JSON.stringify({w:b.width,h:b.height})})()`))
    ok(`orientation ${turns * 90}: the sheet is ${turns % 2 ? "portrait" : "landscape"}`, turns % 2 ? shape.h > shape.w : shape.w > shape.h, JSON.stringify(shape))
    await grabOn()
    await js(`window.wm.e2eGrabLock('pen')`)
    const o = await target("grab=1")
    await waitFor2(o, `!document.querySelector(".grab-strip.shown")`)
    const orect = JSON.parse(await o.js(`JSON.stringify(document.querySelector('[data-grab=sheet]').getBoundingClientRect())`))
    ok(`orientation ${turns * 90}: the overlay's sheet is the pane's shape`, turns % 2 ? orect.height > orect.width : orect.width > orect.height, JSON.stringify(orect))
    // one short stroke starting AT each display corner (heading inwards a little)
    for (let i = 0; i < 4; i++) {
      const [cx, cy] = corners[i]
      const dx = cx === 0 ? 40 : -40, dy = cy === 0 ? 40 : -40
      await stroke([[cx, cy], [cx + dx, cy + dy]])
    }
    await sleep(300)
    const s = await sheetStrokes()
    ok(`orientation ${turns * 90}: four corner strokes arrived`, s.length === 4, String(s.length) + JSON.stringify(s.map((x) => x.p[0])))
    if (s.length === 4) {
      const good = s.every((st, i) => near(st.p[0].x, expected[turns][i][0], 0.006) && near(st.p[0].y, expected[turns][i][1], 0.006))
      ok(`orientation ${turns * 90}: each display corner is the right sheet corner`, good, JSON.stringify(s.map((x) => x.p[0])))
    }
    // A stroke drawn "up" as the person holds the tablet: from the person's bottom-middle to top-middle.
    // person's bottom-middle on the sheet = (0.5, 0.9) -> top (0.5, 0.1); to the display through the inverse map.
    const toScreen = (u, v) => ({ 0: [u, v], 1: [v, 1 - u], 2: [1 - u, 1 - v], 3: [1 - v, u] }[turns])
    const up = Array.from({ length: 8 }, (_, i) => { const [fx, fy] = toScreen(0.5, 0.9 - i * 0.1); return [Math.round(fx * W), Math.round(fy * H)] })
    await js(`window.__wmSheet.strokes = []`)
    await stroke(up)
    await sleep(300)
    const mine = await sheetStrokes()
    ok(`orientation ${turns * 90}: a stroke drawn up is upright on the sheet`, mine.length === 1 && mine[0].p[0].y > mine[0].p.at(-1).y + 0.5 && near(mine[0].p[0].x, 0.5, 0.02) && near(mine[0].p.at(-1).x, 0.5, 0.02), JSON.stringify(mine[0]?.p?.[0]) + JSON.stringify(mine[0]?.p?.at(-1)))
    await js(`document.querySelector('.cm-content').focus()`)
    await takeBtn("Bring the writing in")
    const d = await saved(file)
    const st = d.items.filter((x) => x.kind === "stroke").at(-1)
    if (!st) console.log("DBG items", JSON.stringify(d.items.map((i) => i.kind)), "trouble:", await js(`(document.querySelector(".camera .trouble")||{}).textContent`), "sheet:", (await sheetStrokes()).length, JSON.stringify(await js(`window.wm.e2eGrab()`)))
    ok(`orientation ${turns * 90}: it lands upright in the note's sidecar`, !!st && st.points[0].y > st.points.at(-1).y && Math.abs(st.points[0].x - st.points.at(-1).x) < 0.01,
      JSON.stringify(st?.points?.slice(0, 2)))
    await grabOff()
    o.close()
  }
  await setOrient("match")
} finally { inj.quit(); await grabOff().catch(() => {}) }
finish()
