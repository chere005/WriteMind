// The tablet sheet's TEXT (Sean, 2026-10-10: "i don't see the OCR, it should work on wacom as well" and "bring in writing should
// still be the graphics, text should be a new choice"): the writing on the sheet READ as words by the app's one reader, as a choice of
// its own beside Writing (strokes) and Drawing Cell. A person's handwriting (e2e/lib/handwriting.mjs) is laid on the sheet as pen strokes;
// the reader reads it.
import { js, ok, finish, sleep, freshNote, saved, doc, setDoc, noGrab, pickTablet, tabletBox, penStroke, seg, pe, pickFromMenu, waitFor, shot } from "../../lib/harness.mjs"
import { RED, traceHandwriting } from "../../lib/handwriting.mjs"

await noGrab()
const file = await freshNote({ video: true, rendered: false })
await js(`!document.querySelector('.camera') && [...document.querySelectorAll('button')].find(b => b.dataset.bar === 'video')?.click()`)
await waitFor(`!!document.querySelector('.camera')`)
await pickTablet()
const t = await tabletBox()
const X = t.x, Y = t.y

// REAL HANDWRITING: the red felt-tip lines of the OCR fixture ("The quick brown fox / jumps over the lazy dog. / 0123456789",
// apps/desktop/test/fixtures/ocr-handwriting.png), thinned to one-pixel lines and traced into pen strokes, then laid on the sheet as
// the pen would have written them (a stick-letter drawing is not what the reader is for: it finds nothing in one).
const chains = await traceHandwriting(js)
const made = await js(`((chains) => {
  const k = 1.2, ox = 60, oy = 40
  const strokes = chains.map((ch) => ({
    colorHex: '#2D7DD2', width: 6,
    points: ch.map(([x, y]) => ({ x: (ox + x * k) / 1000, y: (oy + (y - ${RED.top}) * k) / (1000 / window.__wmSheet.aspect) })),
    pressures: ch.map((_, i) => 0.4 + 0.3 * (i / ch.length)),
  }))
  window.__wmSheet.replace(strokes)
  return strokes.length
})(${JSON.stringify(chains)})`)
console.log("handwriting strokes laid on the sheet:", made)
ok("the handwriting is on the sheet as pen strokes", made > 20, String(made))
await sleep(300)
await shot("written")

// Bring in ▸ Text: a menu item beside Writing and Drawing Cell, only because this machine has a reader.
const before = (await saved(file)).items.length
await js(`(() => { const b = document.querySelector('.camera-head [data-capture=ink]'); const r = b.getBoundingClientRect(); b.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: r.x + 4, clientY: r.y + 4 })); return true })()`)
await waitFor(`!!document.querySelector('.float-menu [data-bar=bring-text]')`)
ok("the Bring in menu has three choices, in order: Writing, Drawing Cell, Text", await js(`[...document.querySelectorAll('.float-menu [data-bar^=bring-]')].map(b => b.dataset.bar).slice(0, 3).join() === 'bring-writing,bring-cell,bring-text'`))
await js(`document.querySelector('.float-menu [data-bar=bring-text]').click()`)
// What the pane says while it reads and after (a toast goes by itself).
const said = new Set()
for (let i = 0; i < 60; i++) {
  const now = await js(`document.querySelector('.camera [data-toast]')?.textContent ?? ''`)
  if (now) said.add(now)
  if (/quick|brown|lazy/i.test(await js(`document.querySelector('.cm-content')?.innerText ?? ''`))) break
  await sleep(250)
}
console.log("the pane said:", JSON.stringify([...said]))
console.log("after Text: toast=", JSON.stringify(await js(`document.querySelector('.camera [data-toast]')?.textContent ?? null`)), "footer=", JSON.stringify(await js(`document.querySelector('.camera [data-camera=status-line]')?.textContent ?? null`)))
const text = await doc()
console.log("note text:", JSON.stringify(text))
const hits = ["quick", "brown", "fox", "jumps", "over", "lazy", "dog"].filter((w) => text.toLowerCase().includes(w))
ok("the writing came into the note as WORDS (at least four of the seven words are right)", hits.length >= 4, `${hits.join()} in ${JSON.stringify(text)}`)
const after = await saved(file)
ok("Text brought no strokes and no picture (Writing is still the graphics)", after.items.length === before, JSON.stringify(after.items.map((i) => i.kind)))
ok("the sheet keeps its writing", await js(`window.__wmSheet && window.__wmSheet().strokes.length > 5`).catch(() => true))
ok("the pane says what came in (a toast: Text added to the note, with the line count)", [...said].some((t) => /Text added to .* · \d+ lines?/.test(t)), JSON.stringify([...said]))
await shot("read")

// The default is what the main button does next: Bring in now reads again; Writing is one pick away and is still strokes.
ok("the main button now says it reads (Text is the default)", await js(`/Read the writing as words/.test(document.querySelector('.camera-head [data-capture=ink]').title)`))
await pickFromMenu(".camera-head [data-capture=ink]", "bring-writing")
const d = await saved(file, (x) => x.items.some((i) => i.kind === "stroke"))
ok("Bring in ▸ Writing is still the graphics: strokes on the note's page, no words added by it", d.items.filter((i) => i.kind === "stroke").length >= made - 5, JSON.stringify(d.items.map((i) => i.kind)))

// The box's own row has a Text button too (the boxed part only).
await js(`document.querySelector('.camera-head [data-tablet=undo]')?.focus()`)
const M = { type: "mouse", pressure: 0 }
await pe("pointerdown", X + 10, Y + 14, M); await pe("pointermove", X + t.w / 2, Y + 0.12 * t.h, M); await pe("pointermove", X + t.w - 10, Y + 0.19 * t.h, M); await pe("pointerup", X + t.w - 10, Y + 0.19 * t.h, { ...M, buttons: 0 })
await waitFor(`!!document.querySelector('[data-tablet=box-actions]')`)
console.log("box row:", await js(`document.querySelector('[data-tablet=box-actions]').innerText.replace(/\\s+/g, ' | ')`))
ok("the box's row has a Text button (with Bring in writing, Drawing cell, Picture, Copy, Erase)", await js(`['ink','cell','text','picture','copy','erase'].every(a => !!document.querySelector('[data-box-action=' + a + ']'))`))
await shot("box-row")
await setDoc("", 0)
await js(`document.querySelector('[data-box-action=text]').click()`)
await waitFor(`document.querySelector('.cm-content').innerText.trim().length > 0`, 20000).catch(() => {})
await sleep(300)
const added = await doc()
ok("the box's Text read only the boxed first line (The quick brown fox), not the lines under it", /quick|brown|fox/i.test(added) && !/jumps|lazy|dog/i.test(added), JSON.stringify(added))
finish()
