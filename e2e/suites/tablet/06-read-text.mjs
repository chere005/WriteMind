// The tablet sheet's TEXT (Sean, 2026-10-10: "i don't see the OCR, it should work on wacom as well" and "bring in writing should
// still be the graphics, text should be a new choice"): the writing on the sheet READ as words by the app's one reader, as a choice of
// its own beside Writing (strokes) and As Drawing Cell. Block letters are written with the synthetic pen; the reader reads them.
import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { js, ok, finish, sleep, freshNote, saved, doc, setDoc, noGrab, pickTablet, tabletBox, penStroke, seg, pe, pickFromMenu, waitFor, shot } from "../../lib/harness.mjs"

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
const png = fs.readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), "../../../apps/desktop/test/fixtures/ocr-handwriting.png")).toString("base64")
const made = await js(`(async (b64) => {
  const img = new Image(); img.src = 'data:image/png;base64,' + b64; await img.decode()
  const W = img.naturalWidth, Y0 = 350, Y1 = 570, H = Y1 - Y0
  const c = document.createElement('canvas'); c.width = W; c.height = img.naturalHeight; const cx = c.getContext('2d'); cx.drawImage(img, 0, 0)
  const px = cx.getImageData(0, Y0, W, H).data
  const g = new Uint8Array(W * H)
  for (let i = 0; i < W * H; i++) { const r = px[4 * i], gr = px[4 * i + 1], b = px[4 * i + 2]; g[i] = r > 170 && gr < 120 && b < 140 ? 1 : 0 }
  const at = (x, y) => (x < 0 || y < 0 || x >= W || y >= H ? 0 : g[y * W + x])
  for (let changed = true; changed;) {
    changed = false
    for (let pass = 0; pass < 2; pass++) {
      const del = []
      for (let y = 1; y < H - 1; y++) for (let x = 1; x < W - 1; x++) {
        if (!g[y * W + x]) continue
        const p2 = at(x, y - 1), p3 = at(x + 1, y - 1), p4 = at(x + 1, y), p5 = at(x + 1, y + 1), p6 = at(x, y + 1), p7 = at(x - 1, y + 1), p8 = at(x - 1, y), p9 = at(x - 1, y - 1)
        const n = p2 + p3 + p4 + p5 + p6 + p7 + p8 + p9
        if (n < 2 || n > 6) continue
        const q = [p2, p3, p4, p5, p6, p7, p8, p9, p2]; let a = 0
        for (let k = 0; k < 8; k++) if (q[k] === 0 && q[k + 1] === 1) a++
        if (a !== 1) continue
        if (pass === 0 ? (p2 * p4 * p6 !== 0 || p4 * p6 * p8 !== 0) : (p2 * p4 * p8 !== 0 || p2 * p6 * p8 !== 0)) continue
        del.push(y * W + x)
      }
      for (const i of del) { g[i] = 0; changed = true }
    }
  }
  const D = [[1, 0], [0, 1], [-1, 0], [0, -1], [1, 1], [-1, 1], [-1, -1], [1, -1]]
  const seen = new Uint8Array(W * H), chains = []
  const nb = (x, y) => D.map(([dx, dy]) => [x + dx, y + dy]).filter(([a, b]) => at(a, b) && !seen[b * W + a])
  const ends = []; for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (at(x, y) && D.filter(([dx, dy]) => at(x + dx, y + dy)).length === 1) ends.push([x, y])
  const walk = (sx, sy) => { const chain = [[sx, sy]]; seen[sy * W + sx] = 1; let [x, y] = [sx, sy]
    for (;;) { const next = nb(x, y); if (!next.length) break; [x, y] = next[0]; seen[y * W + x] = 1; chain.push([x, y]) } return chain }
  for (const [x, y] of ends) if (!seen[y * W + x]) chains.push(walk(x, y))
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (at(x, y) && !seen[y * W + x]) chains.push(walk(x, y))
  const k = 1.2, ox = 60, oy = 40
  const strokes = chains.filter((ch) => ch.length >= 6).map((ch) => {
    const pts = ch.filter((_, i) => i % 3 === 0 || i === ch.length - 1)
    return { colorHex: '#2D7DD2', width: 6, points: pts.map(([x, y]) => ({ x: (ox + x * k) / 1000, y: (oy + y * k) / (1000 / window.__wmSheet.aspect) })), pressures: pts.map((_, i) => 0.4 + 0.3 * (i / pts.length)) }
  })
  window.__wmSheet.replace(strokes)
  return strokes.length
})(${JSON.stringify(png)})`)
console.log("handwriting strokes laid on the sheet:", made)
ok("the handwriting is on the sheet as pen strokes", made > 20, String(made))
await sleep(300)
await shot("written")

// Bring in ▸ As Text: a menu item beside Writing and As Drawing Cell, only because this machine has a reader.
const before = (await saved(file)).items.length
await js(`(() => { const b = document.querySelector('.camera-head [data-capture=ink]'); const r = b.getBoundingClientRect(); b.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: r.x + 4, clientY: r.y + 4 })); return true })()`)
await waitFor(`!!document.querySelector('.float-menu [data-bar=bring-text]')`)
ok("the Bring in menu has three choices, in order: Writing, As Drawing Cell, As Text", await js(`[...document.querySelectorAll('.float-menu [data-bar^=bring-]')].map(b => b.dataset.bar).slice(0, 3).join() === 'bring-writing,bring-cell,bring-text'`))
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
ok("the main button now says it reads (As Text is the default)", await js(`/Read the writing as words/.test(document.querySelector('.camera-head [data-capture=ink]').title)`))
await pickFromMenu(".camera-head [data-capture=ink]", "bring-writing")
const d = await saved(file, (x) => x.items.some((i) => i.kind === "stroke"))
ok("Bring in ▸ Writing is still the graphics: strokes on the note's page, no words added by it", d.items.filter((i) => i.kind === "stroke").length >= made - 5, JSON.stringify(d.items.map((i) => i.kind)))

// The box's own row has a Text button too (the boxed part only).
await js(`document.querySelector('.camera-head [data-tablet=undo]')?.focus()`)
const M = { type: "mouse", pressure: 0 }
await pe("pointerdown", X + 10, Y + 14, M); await pe("pointermove", X + t.w / 2, Y + 0.12 * t.h, M); await pe("pointermove", X + t.w - 10, Y + 0.19 * t.h, M); await pe("pointerup", X + t.w - 10, Y + 0.19 * t.h, { ...M, buttons: 0 })
await waitFor(`!!document.querySelector('[data-tablet=box-actions]')`)
console.log("box row:", await js(`document.querySelector('[data-tablet=box-actions]').innerText.replace(/\\s+/g, ' | ')`))
ok("the box's row has a Text button (with Bring in writing, As drawing cell, Copy, Erase)", await js(`['ink','cell','text','copy','erase'].every(a => !!document.querySelector('[data-box-action=' + a + ']'))`))
await shot("box-row")
await setDoc("", 0)
await js(`document.querySelector('[data-box-action=text]').click()`)
await waitFor(`document.querySelector('.cm-content').innerText.trim().length > 0`, 20000).catch(() => {})
await sleep(300)
const added = await doc()
ok("the box's Text read only the boxed first line (The quick brown fox), not the lines under it", /quick|brown|fox/i.test(added) && !/jumps|lazy|dog/i.test(added), JSON.stringify(added))
finish()
