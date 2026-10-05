// Palm rejection and fingers: a touch tap moves the caret; while the pen is near, a touch is ignored; the lock
// wears off; in pen mode a finger still scrolls the page. (Was tour/t15.mjs.)
import { reloadApp, ok, finish, js, send, sleep, freshNote, setDoc, sel, setSel, focus, setPen, touch, mouse, hover, VIEW, lineBoxes, rectOf } from "../../lib/harness.mjs"

await reloadApp()      // the pen the last script used must not still be "near"
await freshNote()
await send("Emulation.setFocusEmulationEnabled", { enabled: true })
const long = Array.from({ length: 60 }, (_, i) => "Paragraph number " + i).join("\n\n")
await setDoc(long); await focus(); await sleep(300)
const content = await rectOf(".cm-content")
const lb = await lineBoxes()
const tapY = Math.round((lb[2][0] + lb[2][1]) / 2)
const tapX = Math.round(content.x + 120)

// a finger tap, no pen anywhere near: the caret goes where it landed
await setSel(0)
await touch("touchStart", tapX, tapY); await touch("touchEnd"); await sleep(400)
const moved = (await sel())[0]
ok("a finger tap with no pen near moves the caret", moved > 0, JSON.stringify(await sel()))

// the pen hovers: the palm that follows is ignored
await mouse("mouseMoved", content.x + 300, tapY + 120, { pen: true, buttons: 0 }); await sleep(120)
await setSel(0)
await touch("touchStart", tapX, tapY); await touch("touchEnd"); await sleep(400)
ok("a tap while the pen is near is ignored (palm rejection)", (await sel())[0] === 0, JSON.stringify(await sel()))
ok("the page tells the browser not to take touches for the lock", (await js(`document.querySelector('.stack').style.touchAction`)) !== "")

// the lock wears off after the pen has gone
await sleep(1900)
ok("the touch lock wears off a moment after the pen leaves", (await js(`document.querySelector('.stack').style.touchAction`)) === "", await js(`document.querySelector('.stack').style.touchAction`))
await setSel(0)
await touch("touchStart", tapX, tapY); await touch("touchEnd"); await sleep(400)
ok("and a finger works again", (await sel())[0] > 0, JSON.stringify(await sel()))

// in pen mode a finger still scrolls
await setPen(true)
const before = await js(`${VIEW}.scrollDOM.scrollTop`)
await touch("touchStart", tapX, 600)
for (let i = 1; i <= 10; i++) { await touch("touchMove", tapX, 600 - i * 30); await sleep(16) }
await touch("touchEnd"); await sleep(400)
const after = await js(`${VIEW}.scrollDOM.scrollTop`)
ok("a finger drag scrolls the page even with the pen down", after > before + 100, `${before} -> ${after}`)
await setPen(false)
finish()
