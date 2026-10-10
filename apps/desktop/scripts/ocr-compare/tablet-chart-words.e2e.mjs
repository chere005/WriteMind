// THE TABLET SHEET'S "Bring in writing" with a WORDS in the chart, through the bundled reader (docs/OCR-BUNDLED.md "Against
// Vision", integration): three boxes and two arrows with a word written in each box (the skeleton of a handwriting font drawn by
// the e2e pen), brought in: the chart arrives as nodes AND each node is labelled by the words read inside it (wordsForChart);
// then the sheet's Page picture is read with Aa. Not a person's pen.
//
//   npm run e2e -- --file apps/desktop/scripts/ocr-compare/tablet-chart-words.e2e.mjs      (build first)

import path from "node:path"
import { fileURLToPath } from "node:url"
import { ok, note, finish, sleep, freshNote, saved, js, noGrab, pickTablet, tabletBox, penStroke, seg, rectPts, takeBtn, pickFromMenu, waitFor, shot, doc, barBtn } from "../../../../e2e/lib/harness.mjs"
import { strokesFor } from "./sheet-strokes.mjs"

const made = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../.cache/ocr-compare")
await noGrab()
const file = await freshNote({ video: true, rendered: true })
await js(`!document.querySelector('.camera') && [...document.querySelectorAll('button')].find(b => b.dataset.bar === 'video')?.click()`)
await waitFor(`!!document.querySelector('.camera')`)
await pickTablet()
const t = await tabletBox()
const X = t.x, Y = t.y
const bx = [t.w * 0.04, t.w * 0.38, t.w * 0.72].map(Math.round), bw = Math.round(t.w * 0.24), by = Math.round(t.h * 0.3), bh = Math.round(t.h * 0.26)
const words = ["start", "check", "done"]
for (let i = 0; i < 3; i++) {
  await penStroke(rectPts(X + bx[i], Y + by, bw, bh, 8))
  const inside = { x: X + bx[i] + bw * 0.14, y: Y + by + bh * 0.22, w: bw * 0.72, h: bh * 0.56 }
  for (const stroke of strokesFor(path.join(made, `word-${words[i]}.pgm`), inside, { epsilon: 1 })) await penStroke(stroke.length >= 2 ? stroke : [stroke[0], stroke[0]])
}
for (let i = 0; i < 2; i++) {
  const x0 = X + bx[i] + bw, x1 = X + bx[i + 1], ym = Y + by + bh / 2
  await penStroke(seg(x0, ym, x1, ym, 6))
  await penStroke([[x1 - 12, ym - 8], [x1, ym], [x1 - 12, ym + 8]])
}
await shot("sheet-chart-words")
await js(`document.querySelector('.cm-content').focus()`)
const n0 = (await saved(file)).items.length
await takeBtn("Bring the writing in")
for (let i = 0; i < 40 && (await saved(file)).items.filter((x) => x.kind === "shape").length < 3; i++) await sleep(500)
const d = await saved(file)
const shapes = d.items.slice(n0).filter((i) => i.kind === "shape").sort((a, b) => a.center.x - b.center.x)
ok("three nodes read off the sheet", shapes.length === 3, `shapes=${shapes.length}`)
const labels = shapes.map((s) => (s.label ?? "").trim())
note("node labels, left to right: " + JSON.stringify(labels))
const near = (a, b) => { // Levenshtein <= 1, case-blind: "Chack" is the reader's miss, not the pipeline's
  a = a.toLowerCase(); b = b.toLowerCase(); if (a === b) return true
  const m = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]); for (let j = 1; j <= b.length; j++) m[0][j] = j
  for (let i = 1; i <= a.length; i++) for (let j = 1; j <= b.length; j++) m[i][j] = Math.min(m[i - 1][j] + 1, m[i][j - 1] + 1, m[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1))
  return m[a.length][b.length] <= 1
}
ok("each node is labelled with the word written in it (wordsForChart)", labels.length === 3 && labels.every((l, i) => near(l, words[i])), JSON.stringify(labels))
const toast = await js(`document.querySelector('.camera [data-toast]')?.textContent ?? ''`)
note("toast: " + toast)
ok("the pane says it read a flow chart", /flow chart/i.test(toast), toast)
ok("...and how many nodes were labelled", /3 labelled|labelled/i.test(toast), toast)
await shot("sheet-chart-words-note")

// the sheet as a picture, read with Aa
await barBtn("clear")
for (const stroke of strokesFor(path.join(made, "sheet-source.pgm"), { x: X + t.w * 0.06, y: Y + t.h * 0.08, w: t.w * 0.8, h: t.h * 0.5 }, { epsilon: 1 })) await penStroke(stroke.length >= 2 ? stroke : [stroke[0], stroke[0]])
const n1 = (await saved(file)).items.length
await pickFromMenu(".camera-bar [data-capture=ink]", "bring-page")
const d2 = await saved(file, (x) => x.items.length > n1)
ok("Sheet as Picture brings one picture", d2.items.length === n1 + 1 && d2.items.at(-1)?.kind === "image", JSON.stringify(d2.items.map((i) => i.kind)))
await sleep(600)
const picked = await js(`document.querySelector('[data-insp=name]')?.textContent ?? null`)
note("after the capture the bar over the picture says: " + picked)
if (await js(`!!document.querySelector('[data-insp=read]')`)) {
  const before = await doc()
  await js(`document.querySelector('[data-insp=read]').click()`)
  await waitFor(`/^Read \\d+ lines? into the note\\./.test(document.querySelector('[data-footer=read-notice]')?.textContent ?? '')`, 30000).catch(() => false)
  const read = (await doc()).slice(before.length)
  note("the sheet's picture read as: " + JSON.stringify(read))
  ok("Aa reads the sheet's picture (a dot grid and blue ink)", /milk/i.test(read) && /plumber/i.test(read), read)
  await shot("sheet-picture-read")
} else {
  ok("the sheet's picture is picked with Aa in its bar", false, "no [data-insp=read] (picked: " + picked + ")")
}
finish()
