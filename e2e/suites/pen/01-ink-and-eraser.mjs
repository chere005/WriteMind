// A pen stroke is saved with one pressure per point; the eraser end rubs it out; the barrel button drags a
// marquee while the pen touches (the lower one since 2026-10-05; the upper one erases), and draws no ink. Synthetic
// pen PointerEvents on the drawing layer. (Was pen.mjs.)
import { ok, finish, js, sleep, freshNote, setPen, canvasBox, pe, saved, handles } from "../../lib/harness.mjs"

const file = await freshNote()
await setPen(true)
const info = await js(`(()=>{const c=document.querySelector('.wm-canvas');return {pe:getComputedStyle(c).pointerEvents,ta:getComputedStyle(c).touchAction}})()`)
ok("the drawing layer takes pointer events with the pen down", info.pe !== "none", JSON.stringify(info))
const { x, y } = await canvasBox()
const strokesIn = (d) => d.items.filter((i) => i.kind === "stroke")
// (A save can be slow on a cold machine: with `until`, the sidecar is read until it holds, up to 5 s.)
const strokes = async (until = null) => strokesIn(await saved(file, until))

// a stroke with rising pressure
await pe("pointerdown", x + 100, y + 200, { pressure: 0.1 })
for (let i = 1; i <= 20; i++) await pe("pointermove", x + 100 + i * 10, y + 200 + Math.sin(i / 3) * 20, { pressure: 0.1 + i * 0.045 })
await pe("pointerup", x + 300, y + 200, { buttons: 0, pressure: 0 })
let s = await strokes((d) => strokesIn(d).length > 0)
const stroke = s.at(-1)
ok("the stroke is saved", !!stroke)
ok("one pressure per point", !!stroke && stroke.pressures?.length === stroke?.points.length && stroke.pressures.length > 5)
ok("the pressure rises along the stroke", stroke && stroke.pressures.at(-1) > stroke.pressures[0] + 0.5)
const nBefore = s.length

// the eraser end across the stroke
await pe("pointerdown", x + 200, y + 200, { button: 5, buttons: 32 })
await pe("pointermove", x + 210, y + 200, { button: -1, buttons: 32 })
await pe("pointerup", x + 210, y + 200, { buttons: 0 })
ok("the eraser end removed the stroke", (await strokes((d) => strokesIn(d).length === nBefore - 1)).length === nBefore - 1)

// the lower barrel button held while the pen touches = marquee (select), not ink (Windows Ink: the barrel at contact is
// the button itself with pressure, no tip bit)
await pe("pointerdown", x + 100, y + 300, { pressure: 0.5 })
for (let i = 1; i <= 5; i++) await pe("pointermove", x + 100 + i * 10, y + 300, { pressure: 0.5 })
await pe("pointerup", x + 150, y + 300, { buttons: 0 })
const before = (await saved(file, (d) => strokesIn(d).length > 0)).items.length
await pe("pointerdown", x + 50, y + 250, { button: 2, buttons: 2 })
await pe("pointermove", x + 300, y + 350, { button: -1, buttons: 2 })
await pe("pointerup", x + 300, y + 350, { buttons: 0 })
await sleep(300)
ok("the barrel-button drag selected the stroke (handles shown)", (await handles()).length >= 3)
ok("...and drew no ink", (await saved(file)).items.length === before)
finish()
