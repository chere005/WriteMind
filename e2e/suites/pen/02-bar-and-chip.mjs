// The top bar: no wrapped labels, the T popover sits under its button, the pen chip notices a pen and pressure,
// its popover sits under it, and the pen draws with the pen button up (pen mode off). (Was toolbar.mjs.)
import { reloadApp, ok, finish, js, sleep, freshNote, setPen, penIsDown, pe, press, saved, rectOf, centerOf } from "../../lib/harness.mjs"

await js(`localStorage.clear()`)
await reloadApp()          // a pen seen earlier in this app is remembered; start as a new one
const file = await freshNote()
const wraps = await js(`JSON.stringify([...document.querySelectorAll('.top-bar button, .top-bar select')].filter(b=>b.getBoundingClientRect().height>34).map(b=>b.title||b.textContent))`)
ok("no top-bar button is taller than a row (no wrapped labels)", wraps === "[]", wraps)

// the T popover under its button
await press('.pop-anchor button'); await sleep(200)
const t = await js(`(()=>{const b=document.querySelector('.pop-anchor button').getBoundingClientRect();const p=document.querySelector('.style-pop').getBoundingClientRect();return {bl:b.left,bb:b.bottom,pl:p.left,pt:p.top}})()`)
ok("the T popover opens under the T button", Math.abs(t.pl - t.bl) < 3 && t.pt >= t.bb && t.pt - t.bb < 12, JSON.stringify(t))
await press('.pop-anchor button'); await sleep(100)

// the pen chip
const chip = () => js(`document.querySelector('.pen-chip').className`)
await js(`document.querySelector('.cm-content').dispatchEvent(new PointerEvent('pointermove',{bubbles:true,clientX:5,clientY:5,pointerId:1,pointerType:'mouse',isPrimary:true}))`)
await sleep(100)
ok("the pen chip starts as 'no pen seen'", (await chip()).includes("pen-none"), await chip())
const fire = (type, o) => js(`(()=>{const el=document.querySelector('.cm-content');el.dispatchEvent(new PointerEvent('${type}',{bubbles:true,cancelable:true,composed:true,clientX:500,clientY:300,pointerId:9,pointerType:'pen',isPrimary:true,buttons:${o.buttons},pressure:${o.pressure}}))})()`)
await fire("pointermove", { buttons: 0, pressure: 0 }); await sleep(100)
ok("a hovering pen is noticed", (await chip()).includes("pen-pen"), await chip())
await fire("pointermove", { buttons: 1, pressure: 0.37 }); await sleep(100)
ok("varying pressure turns the chip green", (await chip()).includes("pen-pressure"), await chip())
await press('.pen-chip'); await sleep(200)
const pp = await js(`(()=>{const b=document.querySelector('.pen-chip').getBoundingClientRect();const p=document.querySelector('.pen-pop').getBoundingClientRect();return {bl:b.left,bb:b.bottom,pl:p.left,pt:p.top,pr:p.right,w:innerWidth}})()`)
ok("the pen popover sits under the chip and on screen", pp.pt >= pp.bb && pp.pl <= pp.bl + 3 && pp.pr >= pp.bl && pp.pr <= pp.w, JSON.stringify(pp))
await press('.pen-chip')

// the pen draws with the pen button down (and a mouse does not: see the buttons script)
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
