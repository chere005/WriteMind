// Pen buttons + ExpressKeys, synthetic PointerEvents (pointerType pen). 
import { js, send, ok, finish, sleep, freshNote, saved, waitFor, pe, reloadApp, openNote } from "../../lib/harness.mjs"

const file = await freshNote()
await js(`localStorage.removeItem('writemind.pen')`)
await reloadApp()
const name = file.split(/[\\/]/).pop().replace(/\.md$/, "")
const reopen = async () => {
  await js(`(() => { const r=[...document.querySelectorAll('.note-row')]; const m=r.find(x=>x.textContent.includes(${JSON.stringify(name)}))||r[0]; m.click() })()`)
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
const handles = () => js(`document.querySelectorAll('.wm-handle').length`)
const esc = () => js(`window.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}))`).then(() => sleep(80))
/** A button press: hover-style (down with the button, tip up), optional moves while held, release. */
const press = async (button, bit, o = {}) => {
  const x = o.x ?? X + 400, y = o.y ?? Y + 300
  await hover(x, y)
  if (o.late) await pe("pointermove", x, y, { button: -1, buttons: bit, pressure: 0 })
  else await pe("pointerdown", x, y, { button, buttons: bit, pressure: 0 })
  for (const [mx, my] of o.moves ?? []) await pe("pointermove", mx, my, { button: -1, buttons: o.touch ? bit | 1 : bit, pressure: o.touch ? 0.5 : 0 })
  const last = o.moves?.at(-1)
  if (o.late) await pe("pointermove", last?.[0] ?? x, last?.[1] ?? y, { button: -1, buttons: 0, pressure: 0 })
  await pe("pointerup", last?.[0] ?? x, last?.[1] ?? y, { button, buttons: 0, pressure: 0 })
  await sleep(80)
}
const tap = (button, bit, o = {}) => press(button, bit, { x: X + 400, y: Y + 300, ...o })
const setting = async (slot, action) => {
  if (!(await js(`!!document.querySelector("[data-pen=btn-${slot}]")`))) { await js(`document.querySelector("[data-pen=chip]").click()`); await sleep(120) }
  await js(`(() => { const s = document.querySelector("[data-pen=btn-${slot}]"); Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype,"value").set.call(s, ${JSON.stringify(action)}); s.dispatchEvent(new Event("change",{bubbles:true})) })()`)
  await sleep(40)
}
const closePop = async () => { await js(`document.querySelector('.pen-pop') && document.querySelector('[data-pen=chip]').click()`); await sleep(60) }
const colour = () => js(`document.querySelector('.pen-colour').value`)
const width = () => js(`document.querySelector('select[title="Pen width"]').value`)
const pressed = (bar) => js(`document.querySelector('[data-bar=${bar}]').getAttribute('aria-pressed')`)
const stored = () => js(`JSON.parse(localStorage.getItem('writemind.pen')||'{}')`)
const scrollTop = () => js(`Math.max(...[...document.querySelectorAll('*')].map(e => e.scrollTop))`)
const resetScroll = () => js(`[...document.querySelectorAll('*')].forEach(e => { if (e.scrollTop) e.scrollTop = 0 })`).then(() => sleep(100))
const select = (x0, y0, x1, y1) => press(2, 2, { x: x0, y: y0, moves: [[x1, y1]] })

// ---- ink to work with
await stroke(X, Y, X + 150, Y + 10)
await stroke(X, Y + 60, X + 150, Y + 70)
ok("two strokes drawn with the tip", (await strokes()) === 2)

// ---- defaults
await js(`document.querySelector('[data-pen=chip]').click()`); await sleep(100)
ok("popover shows the four selects with the Mac-idiom defaults",
  await js(`['lower','upper','eraser','tipAlt'].map(k=>document.querySelector('[data-pen='+'btn-'+k+']').value).join()`) === "select,pan,erase,none")
ok("ExpressKeys table lists the shortcuts with copy buttons",
  await js(`document.querySelectorAll('[data-pen=express] tr').length >= 12 && document.querySelectorAll('[data-pen-copy]').length >= 12`))
ok("a suggested layout is shown", await js(`document.querySelector('.pen-pop').textContent.includes('4 keys:') && document.querySelector('.pen-pop').textContent.includes('8 keys:')`))
await closePop()

// ---- lower = Select (hold): hover-style, tip-first, and move-only
await select(X - 40, Y - 40, X + 200, Y + 100)
ok("lower button drag selects (handles), hover-style", (await handles()) >= 3)
ok("...and drew no ink", (await strokes()) === 2)
await esc()
ok("Esc clears the selection", (await handles()) === 0)
await hover(X - 40, Y - 40); await pe("pointerdown", X - 40, Y - 40, { button: 0, buttons: 3 })
await pe("pointermove", X + 200, Y + 100, { button: -1, buttons: 3 }); await pe("pointerup", X + 200, Y + 100, { button: 0, buttons: 0 }); await sleep(80)
ok("lower held at contact (button 0, buttons 3) selects too", (await handles()) >= 3 && (await strokes()) === 2)
await esc()
await press(2, 2, { x: X - 40, y: Y - 40, late: true, moves: [[X + 200, Y + 100]] })
ok("a button that only appears as a pointermove still selects", (await handles()) >= 3)
await esc()

// ---- cursor shows the action
const kind = () => js(`document.querySelector('.pen-cursor').dataset.kind`)
const held = async (bits) => { await pe("pointermove", X + 300, Y + 300, { button: -1, buttons: bits, pressure: 0 }); await sleep(120); return kind() }
ok("pen cursor is a select box while the lower button is down", (await held(2)) === "select")
ok("...a hand for the upper (pan)", (await held(4)) === "pan")
ok("...the red cross for the eraser end", (await held(32)) === "erase")
ok("...a ring again when nothing is held", (await held(0)) === "ring")
await js(`document.querySelector('[data-pen=chip]').click()`); await sleep(100)
await held(2)
ok("Test panel: lower lamp lit", await js(`document.querySelector('[data-lamp=lower]').classList.contains('on')`))
await held(0)
ok("...marked as seen afterwards", await js(`const l=document.querySelector('[data-lamp=lower]');l.classList.contains('ever') && !l.classList.contains('on')`))
await pe("pointermove", X + 300, Y + 300, { button: 0, buttons: 1, pressure: 0.8 }); await sleep(150)
ok("...tip lamp lit and the pressure bar up", await js(`document.querySelector('[data-lamp=tip]').classList.contains('on') && parseFloat(document.querySelector('.pen-bar span').style.width) > 70`))
await pe("pointerup", X + 300, Y + 300, { button: 0, buttons: 0 })
await closePop()

// ---- upper = Pan
const t0 = await scrollTop()
await press(1, 4, { x: X + 300, y: Y + 300, moves: [[X + 300, Y + 250], [X + 300, Y + 200], [X + 300, Y + 100]] })
const t1 = await scrollTop()
ok("upper button drag pans the page (scrolls ~200px)", t1 - t0 > 150 && t1 - t0 < 260, `${t0}->${t1}`)
ok("...and drew no ink", (await strokes()) === 2)
await resetScroll()

// ---- eraser end = Erase
await press(5, 32, { x: X + 75, y: Y + 5, moves: [[X + 80, Y + 6]] })
ok("eraser end rubs out the stroke under it", (await strokes()) === 1)
await js(`document.querySelector('.cm-content').focus()`)
await js(`window.dispatchEvent(new KeyboardEvent('keydown',{key:'z',ctrlKey:true,bubbles:true}))`); await sleep(300)
ok("Ctrl+Z brings it back", (await strokes()) === 2)

// ---- lower = Erase (the old side-button choice)
await setting("lower", "erase"); await closePop()
ok("setting persisted", (await stored()).buttons?.lower === "erase" && (await stored()).sideButton === "erases")
await press(2, 2, { x: X + 75, y: Y + 5, moves: [[X + 80, Y + 6]] })
ok("lower=Erase rubs out", (await strokes()) === 1)
await js(`window.dispatchEvent(new KeyboardEvent('keydown',{key:'z',ctrlKey:true,bubbles:true}))`); await sleep(300)
ok("...and Undo restores", (await strokes()) === 2)

// ---- lower = Add to selection (shift-extend)
await setting("lower", "select"); await closePop()
await select(X - 20, Y - 20, X + 200, Y + 30)
const h1 = await handles()
const span = () => js(`(()=>{const hs=[...document.querySelectorAll('.wm-handle')].map(h=>h.getBoundingClientRect());return Math.max(...hs.map(r=>r.bottom))-Math.min(...hs.map(r=>r.top))})()`)
const s1 = await span()
await setting("lower", "add"); await closePop()
await select(X - 20, Y + 40, X + 200, Y + 100)
const s2 = await span()
ok("Add keeps the first selection and grows it", h1 >= 3 && s2 > s1 + 30, `${h1} ${s1} ${s2}`)
await esc()

// ---- taps
await setting("lower", "undo"); await setting("upper", "redo"); await closePop()
await stroke(X, Y + 120, X + 150, Y + 130)
ok("third stroke", (await strokes()) === 3)
await tap(2, 2)
ok("lower tap = Undo, exactly once", (await strokes()) === 2)
await tap(1, 4)
ok("upper tap = Redo, exactly once", (await strokes()) === 3)
await tap(2, 2, { moves: [[X + 400, Y + 310]], touch: true })
ok("a button used while the tip touches is not a tap", (await strokes()) === 3)
await tap(2, 2, { late: true })
ok("a tap that arrives only as pointermoves fires once", (await strokes()) === 2)
await tap(1, 4)

const c0 = await colour()
await setting("lower", "nextColour"); await closePop()
await tap(2, 2); const c1 = await colour()
await tap(2, 2); const c2 = await colour()
ok("Next colour steps one preset per tap", c0 !== c1 && c1 !== c2 && c0 !== c2, `${c0} ${c1} ${c2}`)

await setting("lower", "wider"); await setting("upper", "thinner"); await closePop()
const w0 = Number(await width())
await tap(2, 2); const w1 = Number(await width())
await tap(1, 4); await tap(1, 4); const w2 = Number(await width())
ok("Wider then Thinner step the width", w1 > w0 && w2 < w1, `${w0} ${w1} ${w2}`)

await setting("lower", "toggleErase"); await closePop()
await tap(2, 2)
ok("Erase tool toggles on by a tap", (await pressed("erase")) === "true")
await tap(2, 2)
ok("...and off by the next", (await pressed("erase")) === "false")

await setting("lower", "toggleSelect"); await closePop()
await tap(2, 2)
ok("Select tool toggles on by a tap", (await pressed("select")) === "true")
await esc()
await stroke(X - 40, Y - 40, X + 200, Y + 100)
ok("with Select on, a tip drag selects and draws no ink", (await handles()) >= 3 && (await strokes()) === 3)
await esc()
await tap(2, 2)
ok("...and the tool toggles off", (await pressed("select")) === "false")

await setting("lower", "togglePenDraws"); await closePop()
const d0 = (await stored()).penDraws
await tap(2, 2)
ok("Toggle pen-draws flips the setting", (await stored()).penDraws === !d0)
await tap(2, 2)

await setting("lower", "select"); await setting("upper", "clearSelection"); await closePop()
await select(X - 20, Y - 20, X + 200, Y + 30)
ok("selected one stroke", (await handles()) >= 3)
await tap(1, 4)
ok("Clear selection tap drops the handles", (await handles()) === 0)
await select(X - 20, Y - 20, X + 200, Y + 30)
await setting("lower", "deleteSelection"); await closePop()
const nb = await strokes()
await tap(2, 2)
ok("Delete selection tap removes the held stroke", (await strokes()) === nb - 1 && (await handles()) === 0)

await js(`window.__ctx = 0; document.addEventListener('contextmenu', () => window.__ctx++, true)`)
await setting("lower", "contextMenu"); await closePop()
await tap(2, 2)
ok("Right-click tap dispatches exactly one contextmenu", (await js(`window.__ctx`)) === 1)

await setting("lower", "none"); await setting("upper", "none"); await closePop()
const nn = await strokes()
await tap(2, 2); await tap(1, 4)
ok("None does nothing (no ink, no change)", (await strokes()) === nn && (await handles()) === 0)
await hover(X, Y + 200); await pe("pointerdown", X, Y + 200, { button: 0, buttons: 3 }); await pe("pointermove", X + 100, Y + 210, { button: -1, buttons: 3 }); await pe("pointerup", X + 100, Y + 210, { button: 0, buttons: 0 })
ok("...but a tip pressed under a None button still writes", (await strokes()) === nn + 1)

// ---- Tip + Alt
await setting("tipAlt", "pan"); await closePop()
const a0 = await scrollTop()
await hover(X + 300, Y + 300, { alt: true })
await pe("pointerdown", X + 300, Y + 300, { alt: true }); await pe("pointermove", X + 300, Y + 200, { alt: true }); await pe("pointerup", X + 300, Y + 200, { alt: true })
await sleep(100)
ok("Tip + Alt pans when assigned (and writes nothing)", (await scrollTop()) - a0 > 60 && (await strokes()) === nn + 1, `${a0}->${await scrollTop()}`)
await resetScroll()
await setting("tipAlt", "none"); await closePop()

// ---- the sheet: a button with no sheet meaning must not draw there
await setting("lower", "select"); await setting("upper", "pan"); await closePop()

// ---- persistence across reload
await setting("lower", "wider"); await setting("upper", "toggleErase"); await setting("eraser", "undo"); await setting("tipAlt", "add"); await closePop()
await reloadApp()
await js(`document.querySelector('[data-pen=chip]').click()`); await sleep(150)
ok("settings survive a reload", await js(`['lower','upper','eraser','tipAlt'].map(k=>document.querySelector('[data-pen=btn-'+k+']').value).join()`) === "wider,toggleErase,undo,add")
await setting("lower", "select"); await setting("upper", "pan"); await setting("eraser", "erase"); await setting("tipAlt", "none"); await closePop()

// ---- ExpressKeys: real key events through the browser's input pipeline
const CTRL = 2, ALT = 1
const chord = async (k, code, vk, mods, extra = {}) => {
  await send("Input.dispatchKeyEvent", { type: "rawKeyDown", key: k, code, windowsVirtualKeyCode: vk, modifiers: mods, ...extra })
  await send("Input.dispatchKeyEvent", { type: "keyUp", key: k, code, windowsVirtualKeyCode: vk, modifiers: mods })
  await sleep(120)
}
await reopen()
await js(`document.querySelector('.cm-content').focus()`)
const e0 = await colour()
await chord("4", "Digit4", 52, CTRL | ALT)
const e1 = await colour()
ok("ExpressKey Ctrl+Alt+4 (Next colour) fires once from the editor", e0 !== e1)
ok("...focus stays in the editor", await js(`document.activeElement.className.includes('cm-content')`))
await chord("4", "Digit4", 52, CTRL | ALT, { autoRepeat: true })
ok("an auto-repeat of the same key does nothing", (await colour()) === e1)
await chord("5", "Digit5", 53, CTRL | ALT)
ok("Ctrl+Alt+5 (Previous colour) steps back exactly one", (await colour()) === e0)
const kw0 = Number(await width())
await chord("6", "Digit6", 54, CTRL | ALT); const kw1 = Number(await width())
await chord("7", "Digit7", 55, CTRL | ALT)
ok("Ctrl+Alt+6 / 7 widen and thin the line", kw1 > kw0 && Number(await width()) === kw0, `${kw0} ${kw1}`)
await chord("2", "Digit2", 50, CTRL | ALT)
ok("Ctrl+Alt+2 toggles the Erase tool", (await pressed("erase")) === "true")
await chord("3", "Digit3", 51, CTRL | ALT)
ok("Ctrl+Alt+3 toggles Select (and drops Erase)", (await pressed("select")) === "true" && (await pressed("erase")) === "false")
await chord("3", "Digit3", 51, CTRL | ALT)
const dd = (await stored()).penDraws
await chord("8", "Digit8", 56, CTRL | ALT)
ok("Ctrl+Alt+8 toggles Pen always draws", (await stored()).penDraws === !dd)
await chord("8", "Digit8", 56, CTRL | ALT)
const penOn = () => js(`[...document.querySelectorAll('button')].find(b=>b.textContent==='✎').classList.contains('on')`)
const p0 = await penOn()
await chord("1", "Digit1", 49, CTRL | ALT)
ok("Ctrl+Alt+1 puts the pen down / up", (await penOn()) === !p0)
await chord("1", "Digit1", 49, CTRL | ALT)
// from the canvas: select with the pen, then the key; the pen press leaves focus on the page
await select(X - 20, Y - 20, X + 200, Y + 30)
const n0 = await strokes()
ok("selected for the key test", (await handles()) >= 3)
await chord("0", "Digit0", 48, CTRL | ALT)
ok("Ctrl+Alt+0 clears the selection (focus on the canvas side)", (await handles()) === 0)
await select(X - 20, Y - 20, X + 200, Y + 30)
await chord("9", "Digit9", 57, CTRL | ALT)
ok("Ctrl+Alt+9 deletes the held items, once", (await strokes()) === n0 - 1 && (await handles()) === 0)
await chord("z", "KeyZ", 90, CTRL)
ok("Ctrl+Z brings the deleted stroke back", (await strokes()) === n0)
// the tool the ExpressKey toggled is a real tool: erase with it, no button at all
await stroke(X, Y + 300, X + 150, Y + 300)
const n1 = await strokes()
await chord("2", "Digit2", 50, CTRL | ALT)
await hover(X + 75, Y + 300); await pe("pointerdown", X + 75, Y + 300); await pe("pointermove", X + 80, Y + 300); await pe("pointerup", X + 80, Y + 300)
ok("with the Erase tool on (by key) the tip erases", (await strokes()) === n1 - 1)
await chord("2", "Digit2", 50, CTRL | ALT)
await chord("z", "KeyZ", 90, CTRL)

// ---- regression: the mouse
const mouse = (type, x, y, o = {}) => send("Input.dispatchMouseEvent", { type, x, y, button: "left", buttons: type === "mouseReleased" ? 0 : 1, clickCount: 1, modifiers: o.modifiers ?? 0 })
const m0 = await strokes()
await mouse("mouseMoved", X + 500, Y + 400, { buttons: 0 })
await mouse("mousePressed", X + 500, Y + 400); await mouse("mouseMoved", X + 560, Y + 440); await mouse("mouseReleased", X + 560, Y + 440)
await sleep(100)
ok("a mouse drag in cursor mode draws no ink", (await strokes()) === m0)
await mouse("mouseMoved", X - 40, Y - 40, { buttons: 0 })
await mouse("mousePressed", X - 40, Y - 40, { modifiers: CTRL }); await mouse("mouseMoved", X + 100, Y + 20, { modifiers: CTRL }); await mouse("mouseMoved", X + 200, Y + 100, { modifiers: CTRL }); await mouse("mouseReleased", X + 200, Y + 100, { modifiers: CTRL })
await sleep(120)
ok("Ctrl-drag with the mouse is still the marquee", (await handles()) >= 3)

finish()
