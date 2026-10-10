// Whose key is it? The drawing layer watches keys the notebook also hears. Real mouse and key events, the real
// editor (Drawinglane-fix1): a key the layer takes is taken COMPLETELY (Backspace removed the picked shape AND a
// letter of the note), a pick that is gone does not swallow keys, typing ends a pick, Enter confirms a crop,
// and a cancelled label does not swallow the next one. Unit side: apps/desktop/test/layerKeys.test.ts.
import {
  js, ok, finish, sleep, drag, click, dblclick, key, typeText, freshNote, saved, canvasBox, arm, CTRL, MOD, SHIFT,
  doc, setDoc, sel, setSel, focus, handles, shot, waitFor, press, line, send,
} from "../../lib/harness.mjs"

const file = await freshNote({ rendered: true })
const cb = await canvasBox()
const X = (dx) => cb.x + dx, Y = (dy) => cb.y + dy
const items = async () => (await saved(file)).items
const shapes = async () => (await items()).filter((i) => i.kind === "shape")
const handleCount = async () => (await handles()).length
const caret = async () => (await sel())[0]

/** Put a rectangle on the page from the Shapes palette; it arrives picked, and the keys are the editor's focus. */
async function place(x = 300, y = 250) {
  await arm("rectangle")
  await drag(X(x), Y(y), X(x + 120), Y(y + 60), { steps: 6 })
  await sleep(250)
}
/** Take everything off the layer: a Ctrl-marquee over the page, then Backspace (the shape-only case of the new rule). */
async function clearLayer() {
  await js(`document.activeElement?.blur?.()`)
  await drag(X(10), Y(10), X(cb.w - 20), Y(cb.h - 20), { steps: 8, modifiers: CTRL })
  await key("Backspace")
  await sleep(200)
}

// ---------------------------------------------------------------------------------------------------------------
// 1. Backspace / Delete with a shape picked: the shape goes and the note keeps every letter.
await setDoc("hello", 5); await focus()
await place()
ok("a shape from the palette arrives picked", (await handleCount()) >= 3)
await key("Backspace")
ok("Backspace removed the picked shape...", (await shapes()).length === 0, JSON.stringify((await items()).map((i) => i.kind)))
ok("...and did NOT also take a letter out of the note", (await doc()) === "hello", JSON.stringify(await doc()))

await setSel(2); await focus()
await place()
await key("Delete")
ok("Delete removed the shape...", (await shapes()).length === 0)
ok("...and not the letter after the caret", (await doc()) === "hello", JSON.stringify(await doc()))
ok("the caret stayed where it was", (await caret()) === 2, String(await caret()))

// Picked by a click on it, not by placing it.
await setSel(5); await focus()
await place()
await click(X(10), Y(500))                          // let go: a press on the page
await sleep(150)
ok("a press elsewhere lets go of the pick", (await handleCount()) === 0)
await click(X(360), Y(280))                         // a click on the shape picks it
ok("a click on the shape picks it", (await handleCount()) >= 3)
await key("Backspace")
ok("Backspace on a clicked shape removes only the shape", (await shapes()).length === 0 && (await doc()) === "hello", JSON.stringify(await doc()))

// The REAL flow: the palette is a menu button and may keep the focus after a choice. Placing hands it back to the notebook.
await setDoc("hello", 5)
await js(`document.querySelector('[data-bar=shapes]').focus()`)
await place()
const where = await js(`document.activeElement?.className || document.activeElement?.tagName`)
ok("placing from the palette hands the keys back to the notebook", /cm-content/.test(where), where)
await key("Backspace")
ok("...so Backspace removes the shape and only the shape", (await shapes()).length === 0 && (await doc()) === "hello", JSON.stringify(await doc()))

// A key repeat of a Backspace the layer took is the layer's too (a held key must not start eating the note).
await setDoc("hello", 5); await focus()
await place()
{
  // One physical press, held: the key goes down, repeats while it is held, and comes up once.
  const k = { key: "Backspace", code: "Backspace", windowsVirtualKeyCode: 8 }
  await send("Input.dispatchKeyEvent", { type: "rawKeyDown", ...k })
  await send("Input.dispatchKeyEvent", { type: "rawKeyDown", ...k, autoRepeat: true })
  await send("Input.dispatchKeyEvent", { type: "rawKeyDown", ...k, autoRepeat: true })
  await send("Input.dispatchKeyEvent", { type: "keyUp", ...k })
  await sleep(150)
}
ok("a repeat of the Backspace that deleted the shape does not reach the note", (await doc()) === "hello", JSON.stringify(await doc()))
await key("Backspace")                              // a fresh press is the note's again
ok("...and the next fresh press is the note's", (await doc()) === "hell", JSON.stringify(await doc()))

// ---------------------------------------------------------------------------------------------------------------
// 2. Typing in the notebook is the end of the pick.
await setDoc("ab", 2); await focus()
await place()
await typeText("teh")
ok("typed letters reach the note", (await doc()) === "abteh", JSON.stringify(await doc()))
ok("typing let go of the shape (no handles)", (await handleCount()) === 0)
await key("Backspace")
ok("so Backspace now edits the note", (await doc()) === "abte", JSON.stringify(await doc()))
ok("...and the shape is still there", (await shapes()).length === 1)
await key("ArrowLeft"); await key("ArrowLeft")
ok("the arrows move the caret again", (await caret()) === 2, String(await caret()))
await clearLayer()

// ---------------------------------------------------------------------------------------------------------------
// 3. A pick that is gone swallows nothing.
await setDoc("abcdef", 6); await focus()
await place()
await key("z", { modifiers: CTRL })
ok("Ctrl+Z took the new shape away", (await shapes()).length === 0)
await focus()
await key("ArrowLeft"); await key("ArrowLeft")
ok("the arrows move the caret (a pick that no longer exists does not take them)", (await caret()) === 4, String(await caret()))
await key("Backspace")
ok("Backspace edits the note", (await doc()) === "abcef", JSON.stringify(await doc()))
await key("z", { modifiers: CTRL })
ok("and the very next Ctrl+Z takes THAT back (no dead drawing entry in the way)", (await doc()) === "abcdef", JSON.stringify(await doc()))

// ---------------------------------------------------------------------------------------------------------------
// 4. The words win once they are selected: click a shape, Ctrl+A in the note, Ctrl+X cuts the TEXT.
await setDoc("some words", 10); await focus()
await place()
await key("a", { modifiers: MOD })
ok("Ctrl+A in the note selects the words", JSON.stringify(await sel()) === "[0,10]" || JSON.stringify(await sel()) === "[10,0]", JSON.stringify(await sel()))
ok("...and lets go of the shape", (await handleCount()) === 0)
await key("x", { modifiers: MOD })
ok("Ctrl+X cuts the words", (await doc()) === "", JSON.stringify(await doc()))
ok("...and leaves the shape", (await shapes()).length === 1)
await key("z", { modifiers: CTRL })
await clearLayer()

// ---------------------------------------------------------------------------------------------------------------
// 5. What the layer does answer: the arrows nudge, Ctrl+X cuts the object, and the caret does not move.
await setDoc("abcdef", 3); await focus()
await place()
const at0 = (await shapes())[0].transform
await key("ArrowRight"); await key("ArrowRight", { shift: true }); await key("ArrowDown")
const at1 = (await shapes())[0].transform
ok("arrows nudge the picked shape", at1.dx > at0.dx && at1.dy > at0.dy, JSON.stringify([at0, at1]))
ok("...and the caret in the note did not move", (await caret()) === 3, String(await caret()))
await key("x", { modifiers: MOD })
ok("Ctrl+X cuts the picked object", (await shapes()).length === 0 && (await doc()) === "abcdef", JSON.stringify(await doc()))

// ---------------------------------------------------------------------------------------------------------------
// 6. Another note: nothing of the pick is carried to it.
await setDoc("abcdef", 6); await focus()
await place()
ok("a shape is picked in the first note", (await handleCount()) >= 3)
const second = await js(`(async () => { const root = (await window.wm.capabilities()).root; return window.wm.createNote(root) })()`)
await sleep(900)
await js(`(() => { const r = [...document.querySelectorAll('.note-row')].find(x => x.dataset.path === ${JSON.stringify(second)}); r?.click() })()`)
await waitFor(`document.querySelector('.cm-content') && !!document.querySelector('.wm-canvas')`)
await sleep(700)
ok("no handles in the other note", (await handleCount()) === 0)
await setDoc("xyz", 3); await focus()
await key("ArrowLeft"); await key("ArrowLeft")
ok("the arrows move the caret in the other note", (await caret()) === 1, String(await caret()))
await key("Backspace")
ok("Backspace edits the other note", (await doc()) === "yz", JSON.stringify(await doc()))
await key("z", { modifiers: CTRL })
ok("and one Ctrl+Z takes it back (not a dead entry)", (await doc()) === "xyz", JSON.stringify(await doc()))
await js(`(() => { const r = [...document.querySelectorAll('.note-row')].find(x => x.dataset.path === ${JSON.stringify(file)}); r?.click() })()`)
await sleep(900)
ok("back in the first note the shape is still there, and not picked", (await shapes()).length === 1 && (await handleCount()) === 0)
await clearLayer()

// ---------------------------------------------------------------------------------------------------------------
// 7. A node's label: Escape cancels one edit and not the next.
await place(200, 150)
await click(X(260), Y(180)); await click(X(260), Y(180))      // two presses within the double-click time
await waitFor(`!!document.querySelector('.wm-label-edit')`, 3000)
ok("a second press on a node opens its label", await js(`!!document.querySelector('.wm-label-edit')`))
await typeText("nope")
await key("Escape")
ok("Escape closes the label editor", !(await js(`!!document.querySelector('.wm-label-edit')`)))
await sleep(200)
await click(X(260), Y(180)); await click(X(260), Y(180))
await waitFor(`!!document.querySelector('.wm-label-edit')`, 3000)
ok("the node opens its label again", await js(`!!document.querySelector('.wm-label-edit')`))
await typeText("kept")
await click(X(30), Y(600))                                    // click away
await sleep(300)
ok("clicking away after an Escape-cancelled edit still commits the next one", !(await js(`!!document.querySelector('.wm-label-edit')`)))
const labelled = (await shapes())[0]
ok("...and the label is what was typed", labelled && labelled.label === "kept", JSON.stringify(labelled && labelled.label))
ok("the cancelled text never reached the shape", labelled && !labelled.label.includes("nope"))
// Enter commits at the first press.
await click(X(260), Y(180)); await click(X(260), Y(180))
await waitFor(`!!document.querySelector('.wm-label-edit')`, 3000)
await key("Escape")
await click(X(260), Y(180)); await click(X(260), Y(180))
await waitFor(`!!document.querySelector('.wm-label-edit')`, 3000)
await typeText("enter")
await key("Enter")
ok("Enter commits at the first press after an Escape", !(await js(`!!document.querySelector('.wm-label-edit')`)))
ok("...with the typed words", (await shapes())[0]?.label === "enter", JSON.stringify((await shapes())[0]?.label))
await clearLayer()

// ---------------------------------------------------------------------------------------------------------------
// 8. A crop box: Enter confirms (and does not type a newline into the note), Esc leaves the picture alone, and a
//    box left open does not follow you to another note.
await js(`window.__png = async () => {
  const c = document.createElement('canvas'); c.width = 400; c.height = 300; const x = c.getContext('2d');
  x.fillStyle = '#e03030'; x.fillRect(0,0,200,150); x.fillStyle = '#30c030'; x.fillRect(200,0,200,150);
  x.fillStyle = '#3030e0'; x.fillRect(0,150,200,150); x.fillStyle = '#e0e030'; x.fillRect(200,150,200,150);
  const blob = await new Promise(r => c.toBlob(r, 'image/png')); return new File([blob], 'quad.png', { type: 'image/png' }) }`)
async function pasteQuad() {
  await js(`(async () => { const dt = new DataTransfer(); dt.items.add(await window.__png()); document.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true })) })()`)
  await sleep(700)
}
const centre = (sel) => js(`(() => { const r = document.querySelector(${JSON.stringify(sel)}).getBoundingClientRect(); return {x: r.x + r.width/2, y: r.y + r.height/2} })()`)
await setDoc("Crop enter", 10); await focus()
await pasteQuad()
let pic = (await items()).find((i) => i.kind === "image")
ok("a pasted picture is on the layer", !!pic)
ok("...and arrives picked, with a crop button", await js(`!!document.querySelector('.wm-insp [data-insp="crop"]')`))
let c = await centre('.wm-insp [data-insp="crop"]')
await click(c.x, c.y)
await sleep(250)
ok("the crop box opens", await js(`!!document.querySelector('.wm-crop')`))
c = await centre('.wm-crop-corner[data-corner="2"]')
const cx = pic.center.x * cb.w, cy = pic.center.y * cb.h
await drag(c.x, c.y, X(cx), Y(cy), { steps: 8 })      // the lower-right corner to the middle
await focus()
await key("Enter")
await sleep(900)
const cropped = (await items()).find((i) => i.kind === "image")
ok("Enter confirms the crop (a new, smaller file)", cropped && cropped.file !== pic.file && cropped.width < pic.width * 0.6, JSON.stringify(cropped && [cropped.file, cropped.width]))
ok("...and the crop box is gone", !(await js(`!!document.querySelector('.wm-crop')`)))
ok("...and Enter did not type a newline into the note", (await doc()) === "Crop enter", JSON.stringify(await doc()))

// Escape leaves the picture alone.
await click(X(cb.w / 2), Y(cb.h - 40)); await sleep(100)
pic = (await items()).find((i) => i.kind === "image")
const cxy = { x: pic.center.x * cb.w, y: pic.center.y * cb.h }
await click(X(cxy.x), Y(cxy.y)); await sleep(200)
c = await centre('.wm-insp [data-insp="crop"]')
await click(c.x, c.y); await sleep(250)
ok("the crop box opens again", await js(`!!document.querySelector('.wm-crop')`))
await focus()
await key("Escape")
ok("Esc closes the crop box", !(await js(`!!document.querySelector('.wm-crop')`)))
ok("...and leaves the picture alone", (await items()).find((i) => i.kind === "image").file === cropped.file)

// A box left open stays with its own note.
await click(X(cxy.x), Y(cxy.y)); await sleep(200)
c = await centre('.wm-insp [data-insp="crop"]')
await click(c.x, c.y); await sleep(250)
ok("a crop box is open", await js(`!!document.querySelector('.wm-crop')`))
await js(`(() => { const r = [...document.querySelectorAll('.note-row')].find(x => x.dataset.path === ${JSON.stringify(second)}); r?.click() })()`)
await sleep(900)
ok("it does not follow to the other note", !(await js(`!!document.querySelector('.wm-crop')`)))
await setDoc("xyz", 3); await focus()
await key("ArrowLeft"); await key("ArrowLeft")
ok("and the arrows there are the caret's", (await caret()) === 1, String(await caret()))
await js(`(() => { const r = [...document.querySelectorAll('.note-row')].find(x => x.dataset.path === ${JSON.stringify(file)}); r?.click() })()`)
await sleep(900)

finish()
