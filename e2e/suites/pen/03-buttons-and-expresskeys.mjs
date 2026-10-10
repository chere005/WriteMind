// Pen buttons + ExpressKeys on the note's page, synthetic PointerEvents (pointerType pen) and real key / mouse events.
// Sean's model (2026-10-05): each side button has a HOLD job (while the button is held and the pen TOUCHES) and a
// DOUBLE-TAP job (two quick presses in the air, the tip never touching). Defaults (swapped 2026-10-05): lower = hold
// Select / double-tap Redo, upper = hold Erase strokes / double-tap Undo. A single tap does nothing, a press held in
// the air does nothing, and no context menu opens over the page while a pen button is in use. (penButtons.ts,
// penActions.ts)
import { js, send, ok, finish, sleep, freshNote, saved, waitFor, pe, reloadApp, mouse, setRendered, MOD } from "../../lib/harness.mjs"

const file = await freshNote({ rendered: true })
await js(`localStorage.removeItem('writemind.pen')`)
await reloadApp()
const name = file.split(/[\\/]/).pop().replace(/\.wm$/, "")
const reopen = async () => {
  await js(`(() => { const r=[...document.querySelectorAll('.note-row')]; const m=r.find(x=>x.textContent.includes(${JSON.stringify(name)}))||r[0]; m.click() })()`)
  await setRendered(true)
  await waitFor(`!!document.querySelector('.wm-canvas')`); await sleep(600)
}
await reopen()

// a long note so there is something to pan
await js(`(() => { const c=document.querySelector('.cm-content'); c.focus(); document.execCommand('insertText', false, Array.from({length:160},(_, i)=>'line '+i).join('\\n')) })()`)
await sleep(600)
// let CodeMirror measure every line once, so the page (and the ink that is a fraction of it) stops growing
await js(`document.querySelector('.cm-scroller').scrollTop = 1e6`); await sleep(500)
await js(`document.querySelector('.cm-scroller').scrollTop = 0`); await sleep(500)

const box = JSON.parse(await js(`(()=>{const b=document.querySelector('.wm-canvas').getBoundingClientRect();return JSON.stringify({x:b.x,y:b.y,w:b.width,h:b.height})})()`))
const X = box.x + 120, Y = box.y + 120
const hover = (x, y, o = {}) => pe("pointermove", x, y, { buttons: 0, pressure: 0, ...o })
const stroke = async (x0, y0, x1, y1) => {
  await hover(x0, y0); await pe("pointerdown", x0, y0)
  for (let i = 1; i <= 10; i++) await pe("pointermove", x0 + (x1 - x0) * i / 10, y0 + (y1 - y0) * i / 10)
  await pe("pointerup", x1, y1)
}
const strokes = async () => (await saved(file)).items.filter((i) => i.kind === "stroke").length
const strokeList = async () => (await saved(file)).items.filter((i) => i.kind === "stroke")
const handles = () => js(`document.querySelectorAll('.wm-handle').length`)
const handleBox = () => js(`(()=>{const hs=[...document.querySelectorAll('.wm-handle')].map(h=>h.getBoundingClientRect());return hs.length?{x:Math.min(...hs.map(r=>r.left)),y:Math.min(...hs.map(r=>r.top)),r:Math.max(...hs.map(r=>r.right)),b:Math.max(...hs.map(r=>r.bottom))}:null})()`)
const esc = () => js(`window.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}))`).then(() => sleep(80))
const BIT = { lower: 2, upper: 4 }, BTN = { lower: 2, upper: 1 }
/** A side button pressed and let go in the air (no tip, no pressure). */
const airTap = async (which, x = X + 400, y = Y + 300) => {
  await pe("pointerdown", x, y, { button: BTN[which], buttons: BIT[which], pressure: 0 })
  await pe("pointerup", x, y, { button: BTN[which], buttons: 0, pressure: 0 })
}
const doubleTap = async (which, gap = 60) => { await hover(X + 400, Y + 300); await airTap(which); await sleep(gap); await airTap(which); await sleep(250) }
/**
 * The button pressed in the air, the pen then TOUCHING and dragging (Chromium: that touch is a pointermove that gains
 * the tip), lifted with the button still held (more `after` moves in the air), the button let go.
 */
const holdDrag = async (which, from, to, after = []) => {
  const bit = BIT[which]
  await hover(...from)
  await pe("pointerdown", from[0], from[1], { button: BTN[which], buttons: bit, pressure: 0 })
  for (let i = 0; i <= 8; i++) await pe("pointermove", from[0] + (to[0] - from[0]) * i / 8, from[1] + (to[1] - from[1]) * i / 8, { button: -1, buttons: bit | 1, pressure: 0.5 })
  await pe("pointermove", to[0], to[1], { button: -1, buttons: bit, pressure: 0 })
  for (const [x, y] of after) await pe("pointermove", x, y, { button: -1, buttons: bit, pressure: 0 })
  const last = after.at(-1) ?? to
  await pe("pointerup", last[0], last[1], { button: BTN[which], buttons: 0, pressure: 0 })
  await sleep(150)
}
/** Windows Ink's way: the barrel held at contact is the button itself, with pressure and no tip bit. */
const inkDrag = async (which, from, to) => {
  await hover(...from)
  await pe("pointerdown", from[0], from[1], { button: BTN[which], buttons: BIT[which], pressure: 0.5 })
  for (let i = 1; i <= 8; i++) await pe("pointermove", from[0] + (to[0] - from[0]) * i / 8, from[1] + (to[1] - from[1]) * i / 8, { button: -1, buttons: BIT[which], pressure: 0.5 })
  await pe("pointerup", to[0], to[1], { button: BTN[which], buttons: 0, pressure: 0 })
  await sleep(150)
}
const openPop = async () => { if (!(await js(`!!document.querySelector('.pen-pop')`))) { await js(`document.querySelector("[data-pen=chip]").click()`); await sleep(120) } }
const setting = async (sel, action) => {
  await openPop()
  await js(`(() => { const s = document.querySelector("[data-pen=${sel}]"); Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype,"value").set.call(s, ${JSON.stringify(action)}); s.dispatchEvent(new Event("change",{bubbles:true})) })()`)
  await sleep(40)
}
const closePop = async () => { await js(`document.querySelector('.pen-pop') && document.querySelector('[data-pen=chip]').click()`); await sleep(60) }
const colour = () => js(`document.querySelector('.pen-colour').value`)
const width = () => js(`document.querySelector('select[title="Pen width"]').value`)
const pressed = (bar) => js(`document.querySelector('[data-bar=${bar}]').getAttribute('aria-pressed')`)
const stored = () => js(`JSON.parse(localStorage.getItem('writemind.pen')||'{}')`)
const columns = () => js(`['lower','upper','eraser','tipAlt'].map(k=>{const h=document.querySelector('[data-pen=btn-'+k+']');const d=document.querySelector('[data-pen=dbl-'+k+']');return k+':'+(h?h.value:'?')+'/'+(d?d.value:'-')}).join(' ')`)
/** The lower button's hold (Select): a marquee from a to b. */
const select = (x0, y0, x1, y1) => holdDrag("lower", [x0, y0], [x1, y1])

// ---- ink to work with
await stroke(X, Y, X + 150, Y + 10)
await stroke(X, Y + 60, X + 150, Y + 70)
ok("two strokes drawn with the tip", (await strokes()) === 2)

// ---- the popover: two columns per button, Sean's defaults
await openPop()
ok("popover: hold and double-tap per side button, hold only for the eraser end and Tip + Alt",
  (await columns()) === "lower:select/redo upper:erase/undo eraser:erase/- tipAlt:none/-", await columns())
ok("...with the app's words", await js(`(()=>{const t=document.querySelector('.pen-pop').textContent;return t.includes('Double-tap')&&t.includes('Erase strokes')&&t.includes('Undo')&&t.includes('Redo')})()`))
await closePop()

// ---- upper: hold erases, double-tap undoes; lower: double-tap redoes
await holdDrag("upper", [X + 75, Y - 20], [X + 75, Y + 25])
ok("hold upper + touch: rubs out the stroke it crosses (and draws nothing)", (await strokes()) === 1 && (await handles()) === 0)
await doubleTap("upper")
ok("double-tap upper = Undo: the stroke is back", (await strokes()) === 2)
await doubleTap("lower")
ok("double-tap lower = Redo: it is gone again", (await strokes()) === 1)
await doubleTap("upper")
ok("...and Undo once more brings it back", (await strokes()) === 2)

// ---- single taps, a slow pair, a press held in the air: nothing
await hover(X + 400, Y + 300)
await airTap("upper"); await sleep(700); await airTap("lower"); await sleep(700)
ok("a single tap of either button does nothing", (await strokes()) === 2 && (await handles()) === 0)
await airTap("upper"); await sleep(650); await airTap("upper"); await sleep(400)
ok("two taps too far apart are two single taps: nothing", (await strokes()) === 2)
await hover(X + 75, Y - 20)
await pe("pointerdown", X + 75, Y - 20, { button: 2, buttons: 2, pressure: 0 })
for (let i = 1; i <= 6; i++) await pe("pointermove", X + 75, Y - 20 + i * 15, { button: -1, buttons: 2, pressure: 0 })
await pe("pointerup", X + 75, Y + 70, { button: 2, buttons: 0, pressure: 0 }); await sleep(200)
ok("the lower button held in the air over the ink does nothing (nothing selected or erased)", (await strokes()) === 2 && (await handles()) === 0)

// ---- the hold ends where the pen lifts
await holdDrag("upper", [X + 40, Y - 20], [X + 40, Y + 25], [[X + 40, Y + 45], [X + 40, Y + 80]])
ok("hold upper erases while the pen touches, and stops when it lifts (the stroke below survives)", (await strokes()) === 1)
await doubleTap("upper")
ok("(undone)", (await strokes()) === 2)

// ---- Windows Ink's barrel at contact (the button with pressure, no tip bit)
await inkDrag("upper", [X + 100, Y - 20], [X + 100, Y + 25])
ok("upper held at contact, Windows Ink style, erases too", (await strokes()) === 1)
await doubleTap("upper")
ok("(undone)", (await strokes()) === 2)

// ---- lower: hold selects; a drag inside the selection moves it
await select(X - 40, Y - 30, X + 200, Y + 90)
ok("hold lower + touch: the marquee selects (handles), no ink", (await handles()) >= 3 && (await strokes()) === 2)
const b0 = await handleBox()
const before = JSON.stringify((await strokeList())[0])
await holdDrag("lower", [X + 75, Y + 35], [X + 75, Y + 135])
const b1 = await handleBox()
ok("hold lower inside the selection drags it (moved ~100px down)", b1 && b0 && Math.abs((b1.y - b0.y) - 100) < 12, JSON.stringify({ b0, b1 }))
ok("...the stroke itself moved", JSON.stringify((await strokeList())[0]) !== before)
await doubleTap("upper")
ok("double-tap Undo takes the move back", JSON.stringify((await strokeList())[0]) === before)
await esc()
ok("Esc clears the selection", (await handles()) === 0)
await inkDrag("lower", [X - 40, Y - 30], [X + 200, Y + 30])
ok("lower held at contact, Windows Ink style, selects too", (await handles()) >= 3)
await esc()

// ---- the cursor says what the button will do when the pen touches
const kind = () => js(`document.querySelector('.pen-cursor').dataset.kind`)
const held = async (bits) => { await pe("pointermove", X + 300, Y + 300, { button: -1, buttons: bits, pressure: 0 }); await sleep(120); return kind() }
ok("pen cursor is the red cross while the upper button is down", (await held(4)) === "erase")
ok("...a select box for the lower", (await held(2)) === "select")
ok("...a ring again when nothing is held", (await held(0)) === "ring")

// ---- no context menu over the page while a pen button is in use
await js(`window.__ctx = 0; document.addEventListener('contextmenu', () => window.__ctx++, true)`)
const text = JSON.parse(await js(`(()=>{const l=[...document.querySelectorAll('.cm-line')][3].getBoundingClientRect();return JSON.stringify({x:l.x+20,y:l.y+l.height/2})})()`))
// (a) Windows Ink: the lower button pressed with the pen on the words is a right click (a real pen event through CDP)
await mouse("mouseMoved", text.x, text.y, { buttons: 0, pen: true })
await mouse("mousePressed", text.x, text.y, { button: "right", pen: true })
await mouse("mouseReleased", text.x, text.y, { button: "right", pen: true }); await sleep(250)
ok("a pen right-click (lower button at contact) on the words opens no menu", (await js(`!document.querySelector('.context-menu')`)) && (await js(`window.__ctx`)) === 0, `ctx=${await js(`window.__ctx`)}`)
// (b) the driver's hover click: a MOUSE right click at the pen just after the pen's own events
await hover(text.x, text.y); await airTap("upper", text.x, text.y)
await mouse("mousePressed", text.x, text.y, { button: "right" })
await mouse("mouseReleased", text.x, text.y, { button: "right" }); await sleep(250)
ok("a right click just after a pen button opens no menu either", (await js(`!document.querySelector('.context-menu')`)) && (await js(`window.__ctx`)) === 0)
// (c) the driver's hover click as the ONLY sign of the button (Windows Ink delivers no pen event for it): a double one = Redo
await holdDrag("upper", [X + 75, Y - 20], [X + 75, Y + 25])
ok("(erased one for the echo test)", (await strokes()) === 1)
// (undone with the upper button, so the lower one's double tap has the erase to redo)
await doubleTap("upper"); await hover(X + 400, Y + 300); await sleep(350)
for (let i = 0; i < 2; i++) { await mouse("mousePressed", X + 400, Y + 300, { button: "right" }); await mouse("mouseReleased", X + 400, Y + 300, { button: "right" }); await sleep(60) }
await sleep(250)
ok("two of the driver's right clicks at the hovering pen = the lower button's double tap (Redo)", (await strokes()) === 1 && (await js(`window.__ctx`)) === 0)
await doubleTap("upper")
// (d) the mouse alone, once the pen has gone: its right click still opens the menu
await sleep(1700)
await mouse("mouseMoved", text.x + 5, text.y, { buttons: 0 }); await sleep(300)
await mouse("mousePressed", text.x, text.y, { button: "right" })
await mouse("mouseReleased", text.x, text.y, { button: "right" }); await sleep(300)
ok("a plain mouse right click (no pen near) still opens the Cut / Copy / Paste menu", await js(`!!document.querySelector('.context-menu')`))
await js(`document.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}))`); await sleep(150)
ok("(the menu closes with Esc)", await js(`!document.querySelector('.context-menu')`))

// ---- the popover: another job per column, kept across a reload
await setting("dbl-upper", "nextColour"); await setting("btn-upper", "select"); await closePop()
const c0 = await colour()
await doubleTap("upper"); const c1 = await colour()
ok("double-tap upper set to Next colour steps the colour once", c0 !== c1, `${c0} ${c1}`)
await holdDrag("upper", [X - 40, Y - 30], [X + 200, Y + 30])
ok("hold upper set to Select pulls the marquee", (await handles()) >= 3 && (await strokes()) === 2)
await esc()
await setting("dbl-lower", "toggleErase"); await closePop()
await doubleTap("lower")
ok("double-tap lower set to Erase tool turns the tool on", (await pressed("erase")) === "true")
await doubleTap("lower")
ok("...and off", (await pressed("erase")) === "false")
await setting("dbl-lower", "wider"); await closePop()
const w0 = Number(await width()); await doubleTap("lower")
ok("double-tap Wider widens the line", Number(await width()) > w0)
const s = await stored()
ok("stored as both jobs per button (and the hold actions for an older WriteMind)",
  s.slots?.upper?.hold === "select" && s.slots?.upper?.double === "nextColour" && s.slots?.lower?.double === "wider" && s.buttons?.upper === "select", JSON.stringify(s))
await reloadApp()
await openPop()
ok("settings survive a reload", (await columns()) === "lower:select/wider upper:select/nextColour eraser:erase/- tipAlt:none/-", await columns())
await closePop()

// ---- an older WriteMind's store is migrated: old defaults become the new ones, a deliberate choice is kept
await js(`localStorage.setItem('writemind.pen', JSON.stringify({ penDraws: true, pressure: true, sideButton: 'selects', buttons: { lower: 'select', upper: 'pan', eraser: 'erase', tipAlt: 'none' } }))`)
await reloadApp(); await openPop()
ok("a 0.4.0 store with the old defaults comes up with the new defaults", (await columns()) === "lower:select/redo upper:erase/undo eraser:erase/- tipAlt:none/-", await columns())
await closePop()
await js(`localStorage.setItem('writemind.pen', JSON.stringify({ sideButton: 'selects', buttons: { lower: 'add', upper: 'nextColour', eraser: 'erase', tipAlt: 'pan' } }))`)
await reloadApp(); await openPop()
ok("...and a deliberate choice is kept (a hold as the hold, a one-shot as the double tap)", (await columns()) === "lower:add/redo upper:erase/nextColour eraser:erase/- tipAlt:pan/-", await columns())
await closePop()
await js(`localStorage.removeItem('writemind.pen')`)
await reloadApp()
await reopen()

// ---- ExpressKeys: real key events through the browser's input pipeline
const CTRL = 2, ALT = 1
const chord = async (k, code, vk, mods, extra = {}) => {
  await send("Input.dispatchKeyEvent", { type: "rawKeyDown", key: k, code, windowsVirtualKeyCode: vk, modifiers: mods, ...extra })
  await send("Input.dispatchKeyEvent", { type: "keyUp", key: k, code, windowsVirtualKeyCode: vk, modifiers: mods })
  await sleep(120)
}
await js(`document.querySelector('.cm-content').focus()`)
const e0 = await colour()
await chord("4", "Digit4", 52, MOD | ALT)
const e1 = await colour()
ok("ExpressKey Ctrl+Alt+4 (Next colour) fires once from the editor", e0 !== e1)
ok("...focus stays in the editor", await js(`document.activeElement.className.includes('cm-content')`))
await chord("4", "Digit4", 52, MOD | ALT, { autoRepeat: true })
ok("an auto-repeat of the same key does nothing", (await colour()) === e1)
await chord("5", "Digit5", 53, MOD | ALT)
ok("Ctrl+Alt+5 (Previous colour) steps back exactly one", (await colour()) === e0)
const kw0 = Number(await width())
await chord("6", "Digit6", 54, MOD | ALT); const kw1 = Number(await width())
await chord("7", "Digit7", 55, MOD | ALT)
ok("Ctrl+Alt+6 / 7 widen and thin the line", kw1 > kw0 && Number(await width()) === kw0, `${kw0} ${kw1}`)
await chord("2", "Digit2", 50, MOD | ALT)
ok("Ctrl+Alt+2 toggles the Erase tool", (await pressed("erase")) === "true")
await chord("3", "Digit3", 51, MOD | ALT)
ok("Ctrl+Alt+3 toggles Select (and drops Erase)", (await pressed("select")) === "true" && (await pressed("erase")) === "false")
await chord("3", "Digit3", 51, MOD | ALT)
const dd = (await stored()).penDraws
await chord("8", "Digit8", 56, MOD | ALT)
ok("Ctrl+Alt+8 toggles Pen always draws", (await stored()).penDraws === !dd)
await chord("8", "Digit8", 56, MOD | ALT)
const penOn = () => js(`[...document.querySelectorAll('button')].find(b=>b.textContent==='✎').classList.contains('on')`)
const p0 = await penOn()
await chord("1", "Digit1", 49, MOD | ALT)
ok("Ctrl+Alt+1 puts the pen down / up", (await penOn()) === !p0)
await chord("1", "Digit1", 49, MOD | ALT)
// from the canvas: select with the pen, then the key; the pen press leaves focus on the page
await select(X - 20, Y - 20, X + 200, Y + 30)
const n0 = await strokes()
ok("selected for the key test", (await handles()) >= 3)
await chord("0", "Digit0", 48, MOD | ALT)
ok("Ctrl+Alt+0 clears the selection (focus on the canvas side)", (await handles()) === 0)
await select(X - 20, Y - 20, X + 200, Y + 30)
await chord("9", "Digit9", 57, MOD | ALT)
ok("Ctrl+Alt+9 deletes the held items, once", (await strokes()) === n0 - 1 && (await handles()) === 0)
await chord("z", "KeyZ", 90, CTRL)
ok("Ctrl+Z brings the deleted stroke back", (await strokes()) === n0)
// the tool the ExpressKey toggled is a real tool: erase with it, no button at all
await stroke(X, Y + 300, X + 150, Y + 300)
const n1 = await strokes()
await chord("2", "Digit2", 50, MOD | ALT)
await hover(X + 75, Y + 300); await pe("pointerdown", X + 75, Y + 300); await pe("pointermove", X + 80, Y + 300); await pe("pointerup", X + 80, Y + 300)
ok("with the Erase tool on (by key) the tip erases", (await strokes()) === n1 - 1)
await chord("2", "Digit2", 50, MOD | ALT)
await chord("z", "KeyZ", 90, CTRL)

// ---- regression: the mouse
const mouseEv = (type, x, y, o = {}) => send("Input.dispatchMouseEvent", { type, x, y, button: "left", buttons: type === "mouseReleased" ? 0 : 1, clickCount: 1, modifiers: o.modifiers ?? 0 })
const m0 = await strokes()
await mouseEv("mouseMoved", X + 500, Y + 400, { buttons: 0 })
await mouseEv("mousePressed", X + 500, Y + 400); await mouseEv("mouseMoved", X + 560, Y + 440); await mouseEv("mouseReleased", X + 560, Y + 440)
await sleep(100)
ok("a mouse drag in cursor mode draws no ink", (await strokes()) === m0)
await mouseEv("mouseMoved", X - 40, Y - 40, { buttons: 0 })
await mouseEv("mousePressed", X - 40, Y - 40, { modifiers: CTRL }); await mouseEv("mouseMoved", X + 100, Y + 20, { modifiers: CTRL }); await mouseEv("mouseMoved", X + 200, Y + 100, { modifiers: CTRL }); await mouseEv("mouseReleased", X + 200, Y + 100, { modifiers: CTRL })
await sleep(120)
ok("Ctrl-drag with the mouse is still the marquee", (await handles()) >= 3)

finish()
