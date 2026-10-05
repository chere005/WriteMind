// GRAB with the global pen/mouse hook: window NOT full screen and covering only part of the display.
// Pen-promoted mouse input is mimicked with dwExtraInfo = 0xFF515700 (inject.ps1 "sig"), a real mouse with 0.
// Leave the mouse alone while this runs.
import fs from "node:fs"
// @e2e desktop
import { js, ok, finish, sleep, freshNote, pickTablet, waitFor, tabletBox , noGrab, showVideoPane, setWindowSize } from "../../lib/harness.mjs"
import { target, injector } from "../../lib/desktop.mjs"

const state = () => js(`window.wm.e2eGrab()`)
const diag = () => js(`window.wm.grabDiag()`)
await js(`localStorage.removeItem('writemind.sheetAspect'); localStorage.removeItem('writemind.orientation'); localStorage.removeItem('writemind.grabAuto'); location.reload()`)
await sleep(3000)
await js(`window.wm.e2eSetBounds({ x: 60, y: 60, width: 900, height: 700 })`)
await sleep(600)
const w = await js(`window.wm.e2eWindow()`)
ok("the window is NOT full screen and covers only part of the display", !w.fullScreen && w.bounds.width < w.display.width / 2 + 100 && w.bounds.height < w.display.height, JSON.stringify(w.bounds))
const file = await freshNote()
await showVideoPane()
await pickTablet()
await js(`window.__wmSheet.strokes = []; window.__clicks = []; document.addEventListener('click', e => window.__clicks.push([e.pointerType || '', Math.round(e.clientX), Math.round(e.clientY)]), true)`)
await waitFor(`window.wm.e2eGrab().then(g => g.active)`, 6000)
await sleep(800)
let d = await diag()
console.log("diag", JSON.stringify({ hook: d.hook, mode: d.mode, grabbing: d.grabbing }))
ok("the global hook is installed (koffi loaded in the app)", d.hook.installed, JSON.stringify(d.hook))
ok("HUD text: Grab chip is shown", /Grab: (mouse|pen)/.test(await js(`document.querySelector('[data-tablet=grab-hud]').textContent`)))
const inj = injector()
try {
  // ---- pen-signed mouse moves OUTSIDE the notes window (display x 1500..1700, window is at x<=960)
  await js(`window.wm.e2eGrabLock(null)`)
  await inj.cmd("mouse move 1000 900"); await sleep(400)
  ok("start from MOUSE mode (plain mouse input)", (await state()).mode === "mouse", (await state()).mode)
  await inj.cmd("sig move 1500 800"); await sleep(30)
  for (let i = 0; i < 6; i++) { await inj.cmd(`sig move ${1500 + i * 10} ${800 + i * 6}`); await sleep(15) }
  await sleep(150)
  let g = await state(); d = await diag()
  ok("pen-signature moves over the bare desktop switch to PEN mode at once", g.mode === "pen", g.mode)
  ok("the HUD says what it classified", d.last?.kind === "pen" && d.counts.pen >= 6 && d.mode === "pen", JSON.stringify(d.last) + JSON.stringify(d.counts))
  ok("and the pane chip reads Grab: pen", (await js(`document.querySelector('[data-tablet=grab-hud]').textContent`)).includes("Grab: pen"))

  // ---- a stroke from the pen lands in the sheet through the overlay (synthetic pen pointer, as measured earlier)
  const stroke = async (pts) => {
    await inj.cmd(`pen hover ${pts[0][0]} ${pts[0][1]}`); await sleep(40)
    await inj.cmd(`pen down ${pts[0][0]} ${pts[0][1]} 400`)
    for (let i = 1; i < pts.length; i++) { await inj.cmd(`pen move ${pts[i][0]} ${pts[i][1]} ${400 + i * 60}`); await sleep(8) }
    await inj.cmd(`pen up ${pts.at(-1)[0]} ${pts.at(-1)[1]}`); await sleep(40)
    await inj.cmd(`pen leave ${pts.at(-1)[0]} ${pts.at(-1)[1]}`); await sleep(200)
  }
  await stroke([[1600, 700], [1700, 800], [1800, 900], [1900, 1100]])
  await sleep(300)
  const s = JSON.parse(await js(`JSON.stringify(window.__wmSheet.strokes.map(s => ({ p: s.points, pr: s.pressures })))`))
  ok("a stroke over the BARE DESKTOP (outside the window) reached the sheet", s.length === 1 && s[0].pr?.length === s[0].p.length, JSON.stringify(s).slice(0, 200))
  if (s.length) ok("at the proportional place (1600/1919, 700/1199)", Math.abs(s[0].p[0].x - 1600 / 1919) < 0.006 && Math.abs(s[0].p[0].y - 700 / 1199) < 0.006, JSON.stringify(s[0].p[0]))

  // ---- plain mouse: MOUSE mode at once, and the very first click goes through to the window under the cursor
  await sleep(500)
  await inj.cmd("sig move 300 400"); await sleep(400)   // pen-signed, over the notes window
  ok("still PEN mode over the notes window", (await state()).mode === "pen")
  await js(`window.__clicks.length = 0`)
  await inj.cmd("mouse down"); await sleep(40); await inj.cmd("mouse up"); await sleep(300)   // a real click, NO prior mouse move
  g = await state()
  const clicks = JSON.parse(await js(`JSON.stringify(window.__clicks)`))
  console.log("MEASURED first plain click after pen mode:", JSON.stringify(clicks), "mode:", g.mode)
  ok("a plain mouse button switches to MOUSE mode", g.mode === "mouse", g.mode)
  ok("and that very first click reaches the window under the cursor", clicks.some((c) => c[0] === "mouse"), JSON.stringify(clicks))

  // ---- mouse again after, then pen back: debounce and the stroke-holds-the-mode rule
  await inj.cmd("mouse move 320 420"); await sleep(300)
  ok("plain mouse moves keep MOUSE mode", (await state()).mode === "mouse")
  await inj.cmd("sig move 1500 800"); await sleep(250)
  ok("a pen-signature move takes the sheet back", (await state()).mode === "pen")
  await sleep(300)
  await inj.cmd("pen hover 1500 800"); await inj.cmd("pen down 1500 800 400"); await sleep(50)
  await inj.cmd("mouse move 900 900"); await sleep(150)
  ok("a mouse move DURING a stroke does not take the mode", (await state()).mode === "pen")
  await inj.cmd("pen up 1500 800"); await inj.cmd("pen leave 1500 800"); await sleep(300)
  await inj.cmd("mouse move 905 905"); await sleep(300)
  ok("after the stroke, the mouse gets it", (await state()).mode === "mouse")

  // ---- the log
  await sleep(700)
  const log = fs.existsSync(`${process.env.WM_PROFILE}/grab.log`) ? fs.readFileSync(`${process.env.WM_PROFILE}/grab.log`, "utf8") : ""
  ok("grab.log has the transitions", /pen-signature input/.test(log) && /mouse mode/.test(log), log.slice(-300))
  d = await diag()
  ok("the diagnostics carry overlay bounds, display and the last transitions", d.overlay?.bounds?.width === d.display.bounds.width && d.transitions.length >= 3)
} finally { inj.quit() }
finish()
