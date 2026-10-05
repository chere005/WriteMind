// Pen buttons on the tablet sheet. 
import { hover, noGrab, showVideoPane, reloadApp, js, ok, finish, sleep, freshNote, pe, penStroke, seg, tabletBox, pickTablet } from "../../lib/harness.mjs"

await js(`localStorage.removeItem('writemind.pen')`)
await noGrab()
await freshNote({ video: true })
await showVideoPane()
await pickTablet()
const t = await tabletBox()
const X = t.x, Y = t.y
// a real pen coming over the sheet (pointerenter), as the hardware does before it presses anything
await hover(X + 100, Y + 100, { pen: true }); await sleep(200)
const count = () => js(`window.__sheetCount ?? null`)
// The sheet's strokes: read them from the canvas pixel presence is fragile; use the Undo button's state and the bar.
const canUndo = () => js(`!document.querySelector('.camera-bar [data-tablet=undo]').disabled`)
const clearEnabled = () => js(`!document.querySelector('.camera-bar [data-tablet=clear]').disabled`)
const setting = async (slot, action) => {
  if (!(await js(`!!document.querySelector("[data-pen=btn-${slot}]")`))) { await js(`document.querySelector("[data-pen=chip]").click()`); await sleep(120) }
  await js(`(() => { const s = document.querySelector("[data-pen=btn-${slot}]"); Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype,"value").set.call(s, ${JSON.stringify(action)}); s.dispatchEvent(new Event("change",{bubbles:true})) })()`)
  await sleep(60)
}
const closePop = async () => { await js(`document.querySelector('.pen-pop') && document.querySelector('[data-pen=chip]').click()`); await sleep(80) }

ok("the sheet starts empty", !(await clearEnabled()))
// upper button (Pan by default) on the sheet: nothing to scroll, and it must not draw
await pe("pointermove", X + 100, Y + 100, { buttons: 0, pressure: 0 })
await pe("pointerdown", X + 100, Y + 100, { button: 1, buttons: 4, pressure: 0 })
await pe("pointermove", X + 150, Y + 140, { button: -1, buttons: 4, pressure: 0 })
await pe("pointerup", X + 150, Y + 140, { button: 1, buttons: 0, pressure: 0 })
await sleep(100)
ok("the upper button (pan) draws nothing on the sheet", !(await clearEnabled()))
// a tap action on the sheet: nothing drawn either, and it does what it says
await penStroke(seg(X + 40, Y + 200, X + 200, Y + 200, 10))
ok("the tip writes a stroke", await clearEnabled())
await setting("lower", "undo"); await closePop(); await sleep(250)
await pe("pointermove", X + 100, Y + 100, { buttons: 0, pressure: 0 })
await pe("pointerdown", X + 100, Y + 100, { button: 2, buttons: 2, pressure: 0 })
await pe("pointerup", X + 100, Y + 100, { button: 2, buttons: 0, pressure: 0 })
await sleep(600)
ok("a lower-button tap = Undo takes the sheet's last stroke back, once", !(await clearEnabled()))
// lower = erase
await penStroke(seg(X + 40, Y + 200, X + 200, Y + 200, 10))
await setting("lower", "erase"); await closePop()
await pe("pointerdown", X + 120, Y + 200, { button: 2, buttons: 2, pressure: 0 }); await pe("pointermove", X + 125, Y + 200, { button: -1, buttons: 2, pressure: 0 }); await pe("pointerup", X + 125, Y + 200, { button: 2, buttons: 0, pressure: 0 })
await sleep(100)
ok("lower=Erase rubs the stroke out on the sheet", !(await clearEnabled()))
// the Select tool by key puts the dashed box up with the plain tip
await setting("lower", "select"); await closePop()
await pe("pointerdown", X + 40, Y + 40, { button: 2, buttons: 2, pressure: 0 }); await pe("pointermove", X + 200, Y + 140, { button: -1, buttons: 2, pressure: 0 })
await sleep(150)
ok("lower=Select pulls the dashed box on the sheet", await js(`!!document.querySelector('.camera .box')`))
await pe("pointerup", X + 200, Y + 140, { button: 2, buttons: 0, pressure: 0 })
finish()
