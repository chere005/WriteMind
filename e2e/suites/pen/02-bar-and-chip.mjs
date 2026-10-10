// The top bar: no wrapped labels, the Aa popover sits under its button, the pen's tablet row (the old Wacom chip, now the
// last row of the pen menu) notices a pen and pressure, its sheet sits under the pen button, and the pen draws with the pen
// button up (pen mode off). (Was toolbar.mjs.)
import { reloadApp, ok, finish, js, sleep, freshNote, setPen, penIsDown, pe, press, saved, rectOf, centerOf, penMenu, setRendered, key } from "../../lib/harness.mjs"

await js(`localStorage.clear()`)
await reloadApp()          // a pen seen earlier in this app is remembered; start as a new one
const file = await freshNote({ rendered: true })
const wraps = await js(`JSON.stringify([...document.querySelectorAll('.top-bar button, .top-bar select')].filter(b=>b.getBoundingClientRect().height>37).map(b=>b.title||b.textContent))`)
ok("no top-bar button is taller than a row (no wrapped labels)", wraps === "[]", wraps)

// the Aa popover under its button
await press('[data-bar=font]'); await sleep(200)
const t = await js(`(()=>{const b=document.querySelector('[data-bar=font]').getBoundingClientRect();const p=document.querySelector('.style-pop').getBoundingClientRect();return {bl:b.left,bb:b.bottom,pl:p.left,pt:p.top}})()`)
ok("the Aa popover opens under the Aa button", Math.abs(t.pl - t.bl) < 3 && t.pt >= t.bb && t.pt - t.bb < 12, JSON.stringify(t))
await key("Escape"); await sleep(150)
ok("and Escape puts it away", !(await js(`!!document.querySelector('.style-pop')`)))

// the pen's tablet row (the old chip): in the pen menu
await penMenu()
const chip = () => js(`document.querySelector('.pen-chip').className`)
await js(`document.querySelector('.cm-content').dispatchEvent(new PointerEvent('pointermove',{bubbles:true,clientX:5,clientY:5,pointerId:1,pointerType:'mouse',isPrimary:true}))`)
await sleep(100)
ok("the pen chip starts as 'no pen seen'", (await chip()).includes("pen-none"), await chip())
const fire = (type, o) => js(`(()=>{const el=document.querySelector('.cm-content');el.dispatchEvent(new PointerEvent('${type}',{bubbles:true,cancelable:true,composed:true,clientX:500,clientY:300,pointerId:9,pointerType:'pen',isPrimary:true,buttons:${o.buttons},pressure:${o.pressure}}))})()`)
await fire("pointermove", { buttons: 0, pressure: 0 }); await sleep(100)
ok("a hovering pen is noticed", (await chip()).includes("pen-pen"), await chip())
await fire("pointermove", { buttons: 1, pressure: 0.37 }); await sleep(100)
ok("varying pressure turns the chip green", (await chip()).includes("pen-pressure"), await chip())
await press('.pen-chip'); await sleep(250)
const pp = await js(`(()=>{const b=document.querySelector('[data-bar=pen]').getBoundingClientRect();const p=document.querySelector('.pen-pop').getBoundingClientRect();return {bl:b.left,bb:b.bottom,pl:p.left,pt:p.top,pr:p.right,w:innerWidth}})()`)
ok("the tablet sheet sits under the pen button and on screen", pp.pt >= pp.bb && pp.pr <= pp.w && pp.pr >= pp.bl, JSON.stringify(pp))
await key("Escape"); await sleep(150)
ok("Escape puts the sheet away", !(await js(`!!document.querySelector('.pen-pop')`)))

// the pen draws with the pen button down (and a mouse does not: see the buttons script)
await setRendered(true)
await setPen(true)
ok("the pen button reads as down", await penIsDown())
const { x, y } = JSON.parse(await js(`(()=>{const b=document.querySelector('.wm-canvas').getBoundingClientRect();return JSON.stringify({x:b.x,y:b.y})})()`))
await pe("pointerdown", x + 300, y + 200, { pressure: 0.3 })
for (let i = 1; i < 15; i++) await pe("pointermove", x + 300 + i * 8, y + 200 + i * 2, { pressure: 0.3 + i * 0.04 })
await pe("pointerup", x + 420, y + 230, { pressure: 0 })
const d = await saved(file)
ok("a pen stroke made one stroke item", d.items.filter((i) => i.kind === "stroke").length === 1, JSON.stringify(d.items.map((i) => i.kind)))
ok("the footer counts it", /1 object/.test(await js(`document.body.innerText`)))
finish()
