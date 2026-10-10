// Drawinglane-fix2: the pen / cursor mode putting the pick away, Ctrl+X on selected words, and no phantom undo step.
// Real mouse and key events, the real editor. Unit side: apps/desktop/test/layerKeys.test.ts.
import {
  js, ok, finish, sleep, drag, click, key, freshNote, saved, canvasBox, arm, CTRL, MOD,
  doc, setDoc, sel, setSel, focus, handles, setPen,
} from "../../lib/harness.mjs"

const file = await freshNote({ rendered: true })
const cb = await canvasBox()
const X = (dx) => cb.x + dx, Y = (dy) => cb.y + dy
const shapes = async () => (await saved(file)).items.filter((i) => i.kind === "shape")
async function place(x = 300, y = 250) {
  await arm("rectangle")
  await drag(X(x), Y(y), X(x + 120), Y(y + 60), { steps: 6 })
  await sleep(250)
}

// 1. A picked shape, then the pen goes down: the handles go.
await setDoc("hello", 5); await focus()
await place()
ok("a placed shape is picked (handles up)", (await handles()).length >= 3)
await setPen(true)
await sleep(200)
ok("pen mode puts the pick away", (await handles()).length === 0)
await setPen(false)
await sleep(200)
ok("and back in cursor mode the arrows are the caret's", await (async () => {
  await focus(); await setSel(5); await key("ArrowLeft"); return (await sel())[0] === 4
})(), JSON.stringify(await sel()))

// 2. Words selected in the note, a shape picked: Ctrl+X cuts the WORDS, the shape stays.
await click(X(10), Y(500)); await sleep(100)
await click(X(360), Y(280)); await sleep(200)
ok("the shape is picked by a click", (await handles()).length >= 3)
await focus(); await setSel(0, 5)
await key("x", { modifiers: MOD }); await sleep(200)
ok("Ctrl+X with words selected cut the words...", (await doc()) === "", JSON.stringify(await doc()))
ok("...and left the shape", (await shapes()).length === 1)

// 3. A delete that removes nothing is no undo step: Ctrl+Z still takes back the shape, not a no-op.
await js(`document.activeElement?.blur?.()`)
await click(X(360), Y(280)); await sleep(150)
await key("Backspace"); await sleep(700)
ok("Backspace removed the picked shape", (await shapes()).length === 0)
await key("Backspace"); await sleep(200)       // nothing picked now: the notebook's key
await key("z", { modifiers: CTRL }); await sleep(700)
ok("one Ctrl+Z brings the shape back", (await shapes()).length === 1, String((await shapes()).length))

finish()
