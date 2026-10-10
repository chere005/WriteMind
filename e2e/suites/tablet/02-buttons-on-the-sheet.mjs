// Pen buttons on the tablet sheet, Sean's model (2026-10-05, the buttons swapped the same day): a side button HELD
// while the pen touches does its hold job (upper: Erase strokes, lower: Select = the dashed box), a DOUBLE TAP in the
// air does its double-tap job (upper: Undo, lower: Redo), which over the sheet takes back the sheet's OWN strokes; a
// single tap or a press held in the air does nothing, and no context menu opens. Twice: with synthetic DOM pen events, and through the native feed (the
// `inject` backend: samples -> manager -> IPC -> the page's synthesiser, the path Wintab's samples take).
import { js, ok, finish, sleep, freshNote, pe, penStroke, seg, tabletBox, pickTablet, showVideoPane, noGrab, waitFor, shot, setSelect } from "../../lib/harness.mjs"

await js(`localStorage.removeItem('writemind.pen')`)
await noGrab()
await freshNote({ video: true, rendered: true })
await showVideoPane()
await pickTablet()
await setSelect("[data-tablet=orientation]", "0"); await sleep(350)   // the feed's samples land on the sheet as given
const t = await tabletBox()
const X = t.x, Y = t.y
const count = () => js(`window.__wmSheet.strokes.length`)
const boxUp = () => js(`!!document.querySelector('.camera .box')`)
const BIT = { lower: 2, upper: 4 }, BTN = { lower: 2, upper: 1 }
const hover = (x, y) => pe("pointermove", x, y, { buttons: 0, pressure: 0 })
const airTap = async (which, x = X + 100, y = Y + 100) => {
  await pe("pointerdown", x, y, { button: BTN[which], buttons: BIT[which], pressure: 0 })
  await pe("pointerup", x, y, { button: BTN[which], buttons: 0, pressure: 0 })
}
const doubleTap = async (which) => { await hover(X + 100, Y + 100); await airTap(which); await sleep(60); await airTap(which); await sleep(250) }
const holdDrag = async (which, from, to) => {
  const bit = BIT[which]
  await hover(...from)
  await pe("pointerdown", from[0], from[1], { button: BTN[which], buttons: bit, pressure: 0 })
  for (let i = 0; i <= 6; i++) await pe("pointermove", from[0] + (to[0] - from[0]) * i / 6, from[1] + (to[1] - from[1]) * i / 6, { button: -1, buttons: bit | 1, pressure: 0.5 })
  await pe("pointermove", to[0], to[1], { button: -1, buttons: bit, pressure: 0 })
  await pe("pointerup", to[0], to[1], { button: BTN[which], buttons: 0, pressure: 0 })
  await sleep(150)
}

// a real pen coming over the sheet (pointerenter), as the hardware does before it presses anything
await hover(X + 100, Y + 100); await sleep(200)
ok("the sheet starts empty", (await count()) === 0)

// ---- DOM pen events
await penStroke(seg(X + 40, Y + 200, X + 200, Y + 200, 10))
await penStroke(seg(X + 40, Y + 260, X + 200, Y + 260, 10))
ok("the tip writes two strokes", (await count()) === 2)
await hover(X + 100, Y + 100)
await airTap("upper"); await sleep(600); await airTap("lower"); await sleep(600)
ok("a single tap of either button does nothing on the sheet", (await count()) === 2 && !(await boxUp()))
await doubleTap("upper")
ok("double-tap upper = Undo takes the sheet's last stroke back", (await count()) === 1)
await doubleTap("lower")
ok("double-tap lower = Redo brings it back", (await count()) === 2)
// the erasing button held in the air across a stroke: nothing
await pe("pointerdown", X + 120, Y + 180, { button: BTN.upper, buttons: BIT.upper, pressure: 0 })
for (let i = 1; i <= 5; i++) await pe("pointermove", X + 120, Y + 180 + i * 10, { button: -1, buttons: BIT.upper, pressure: 0 })
await pe("pointerup", X + 120, Y + 230, { button: BTN.upper, buttons: 0, pressure: 0 }); await sleep(150)
ok("the upper button held in the air over a stroke does nothing", (await count()) === 2)
await holdDrag("upper", [X + 120, Y + 180], [X + 120, Y + 220])
ok("hold upper + touch rubs out the stroke it crosses, and only that one", (await count()) === 1)
await doubleTap("upper")
ok("...and double-tap Undo brings it back", (await count()) === 2)
await holdDrag("lower", [X + 30, Y + 30], [X + 220, Y + 150])
ok("hold lower + touch pulls the dashed box (no ink)", (await boxUp()) && (await count()) === 2)
// no context menu over the sheet while a pen button is in use
await js(`window.__ctx = 0; document.addEventListener('contextmenu', () => window.__ctx++, true)`)
await airTap("upper")
await js(`document.elementFromPoint(${X + 100}, ${Y + 100}).dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: ${X + 100}, clientY: ${Y + 100}, button: 2 }))`)
await sleep(100)
ok("a right click at the pen over the sheet just after a pen button is stopped before the page hears it", (await js(`window.__ctx`)) === 0)
await js(`document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))`); await sleep(100)
await shot("dom")

// ---- the native feed (inject backend)
const S = (x, y, o = {}) => ({ t: Date.now(), x, y, p: o.p ?? 0, tip: !!o.tip, lower: !!o.lower, upper: !!o.upper, eraser: false, inRange: o.inRange ?? true, backend: "inject" })
const inj = async (samples) => { await js(`window.wm.pen.e2e.inject(${JSON.stringify(samples)}).then(() => 1)`); await sleep(60) }
const config = (c) => js(`window.wm.pen.e2e.config(${JSON.stringify(c)}).then(() => 1)`)
const state = () => js(`window.wm.pen.e2e.state().then(s => JSON.stringify({ active: s.active }))`).then(JSON.parse)
await waitFor(`!!window.__wmPenFeed`)
await config({ native: false, backends: ["inject"], focused: true }); await sleep(300)
await config({ capture: true }); await sleep(300)
await waitFor(`window.__wmPenFeed.gate().capturing === true`, 6000)
for (let i = 0; i < 30 && (await state()).active !== "inject"; i++) { await inj([S(0.45 + (i % 6) * 0.01, 0.5)]); await sleep(50) }
ok("the inject backend feeds the sheet", (await state()).active === "inject")
await js(`window.__wmSheet.clear?.(); true`); await sleep(100)
// screen-frame samples; orientation "match" by default maps them straight onto the sheet
const line = (y, o = {}) => [S(0.2, y, o), ...Array.from({ length: 8 }, (_, i) => S(0.2 + i * 0.05, y, { tip: true, p: 0.5, ...o })), S(0.55, y, o)]
await inj([...line(0.3), ...line(0.5)]); await sleep(150)
const n0 = await count()
ok("the feed writes two strokes", n0 === 2, `n=${n0}`)
const tapS = (b) => [S(0.7, 0.2, { [b]: true }), S(0.7, 0.2, { [b]: true }), S(0.7, 0.2)]
await inj([S(0.7, 0.2), ...tapS("upper")]); await sleep(700)
ok("a single upper tap through the feed does nothing", (await count()) === n0)
await inj([S(0.7, 0.2), ...tapS("upper"), ...tapS("upper")]); await sleep(250)
ok("an upper double tap through the feed = Undo on the sheet", (await count()) === n0 - 1)
await inj([S(0.7, 0.2), ...tapS("lower"), ...tapS("lower")]); await sleep(250)
ok("a lower double tap through the feed = Redo on the sheet", (await count()) === n0)
// hold upper in the air, touch across the first stroke (vertical, at x 0.4), lift, let go
await inj([S(0.4, 0.2), S(0.4, 0.2, { upper: true }), ...Array.from({ length: 8 }, (_, i) => S(0.4, 0.2 + i * 0.03, { upper: true, tip: true, p: 0.5 })), S(0.4, 0.45, { upper: true }), S(0.4, 0.45)])
await sleep(200)
ok("hold upper + touch through the feed rubs out the stroke it crosses", (await count()) === n0 - 1)
await inj([S(0.4, 0.62), S(0.4, 0.62, { upper: true }), S(0.4, 0.55, { upper: true }), S(0.4, 0.45, { upper: true }), S(0.4, 0.45)])
await sleep(200)
ok("...and held in the air across the other one does nothing", (await count()) === n0 - 1)
await inj([S(0.5, 0.5, { inRange: false })])
await config({ capture: false }); await sleep(200)
await shot("feed")
finish()
