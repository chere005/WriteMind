// The box's PICTURE and the header's SHEET entries (Sean, 2026-10-10: "add bring in as picture to selections, not just page.. also add
// a sheet as picture or sheet as text to the bring in drop down"; and "drop the word As from As Drawing Cell and As Text"):
//   - the box's row has Picture: the boxed part of the sheet as an image, paper and all;
//   - the header's Bring in menu has, under Writing / Drawing Cell / Text, Sheet as Picture and Sheet as Text: the WHOLE sheet, whatever
//     the box says.
import { js, ok, finish, sleep, freshNote, saved, doc, setDoc, noGrab, pickTablet, tabletBox, pe, pickFromMenu, waitFor, shot } from "../../lib/harness.mjs"
import { RED, traceHandwriting } from "../../lib/handwriting.mjs"

await noGrab()
const file = await freshNote({ video: true, rendered: false })
await js(`!document.querySelector('.camera') && [...document.querySelectorAll('button')].find(b => b.dataset.bar === 'video')?.click()`)
await waitFor(`!!document.querySelector('.camera')`)
await pickTablet()
const t = await tabletBox()
const X = t.x, Y = t.y

// Real handwriting on the sheet (three lines), as in 06.
const chains = await traceHandwriting(js)
await js(`((chains) => {
  const k = 1.2, ox = 60, oy = 40
  window.__wmSheet.replace(chains.map((ch) => ({
    colorHex: '#2D7DD2', width: 6,
    points: ch.map(([x, y]) => ({ x: (ox + x * k) / 1000, y: (oy + (y - ${RED.top}) * k) / (1000 / window.__wmSheet.aspect) })),
    pressures: ch.map((_, i) => 0.4 + 0.3 * (i / ch.length)),
  })))
})(${JSON.stringify(chains)})`)
await sleep(300)

// The header's menu: the order and the words ("As" is gone).
await js(`(() => { const b = document.querySelector('.camera-head [data-capture=ink]'); const r = b.getBoundingClientRect(); b.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: r.x + 4, clientY: r.y + 4 })); return true })()`)
await waitFor(`!!document.querySelector('.float-menu [data-bar=bring-sheet-text]')`)
ok("Bring in's menu reads Writing, Drawing Cell, Text, then Sheet as Picture and Sheet as Text (no 'As')",
  await js(`[...document.querySelectorAll('.float-menu [data-bar^=bring-] .float-label')].map(b => b.textContent).join('|')`) === "Writing|Drawing Cell|Text|Sheet as Picture|Sheet as Text")
await js(`document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))`)
await sleep(150)

// A box over the first line, then the box row's Picture: the boxed part only.
const M = { type: "mouse", pressure: 0 }
await pe("pointerdown", X + 10, Y + 14, M); await pe("pointermove", X + t.w / 2, Y + 0.12 * t.h, M); await pe("pointermove", X + t.w - 10, Y + 0.19 * t.h, M); await pe("pointerup", X + t.w - 10, Y + 0.19 * t.h, { ...M, buttons: 0 })
await waitFor(`!!document.querySelector('[data-tablet=box-actions]')`)
ok("the box's row says Writing, Drawing cell, Text, Picture, Copy, Erase", await js(`[...document.querySelectorAll('[data-tablet=box-actions] button')].map(b => b.textContent.trim()).join('|')`) === "Bring in writing|Drawing cell|Text|Picture|Copy|Erase")
await js(`document.querySelector('[data-box-action=picture]').click()`)
const first = await saved(file, (x) => x.items.some((i) => i.kind === "image"))
const pictures = first.items.filter((i) => i.kind === "image")
ok("the box's Picture brought one picture in", pictures.length === 1, JSON.stringify(first.items.map((i) => i.kind)))
const part = pictures[0]
await shot("box-picture")

// Sheet as Picture with the box still up: the WHOLE sheet, so a much taller picture than the boxed line.
await waitFor(`!!document.querySelector('[data-tablet=box-actions]')`, 3000).catch(() => {})
await pickFromMenu(".camera-head [data-capture=ink]", "bring-page")
const second = await saved(file, (x) => x.items.filter((i) => i.kind === "image").length >= 2)
const both = second.items.filter((i) => i.kind === "image")
ok("Sheet as Picture brought a second picture", both.length === 2, JSON.stringify(second.items.map((i) => i.kind)))
const whole = both.find((i) => i.id !== part.id)
ok("...and it is the WHOLE sheet, not the boxed part (several times taller for its width)", whole && whole.aspect > part.aspect * 2.5, JSON.stringify({ part: part.aspect, whole: whole?.aspect }))

// Sheet as Text: all three lines, whatever the box says.
await setDoc("", 0)
await pickFromMenu(".camera-head [data-capture=ink]", "bring-sheet-text")
await waitFor(`/dog|lazy|0123/i.test(document.querySelector('.cm-content')?.innerText ?? '')`, 30000).catch(() => {})
await sleep(300)
const text = await doc()
console.log("sheet text:", JSON.stringify(text))
ok("Sheet as Text read the whole sheet (the lines under the box too)", /quick|brown/i.test(text) && /lazy|dog|jumps/i.test(text), JSON.stringify(text))
finish()
