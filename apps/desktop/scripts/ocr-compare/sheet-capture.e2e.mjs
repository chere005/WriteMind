// Writes text on the tablet's sheet with the app's own e2e synthetic pen and takes the sheet's PAGE picture out
// (docs/OCR-BUNDLED.md): the picture the Wacom sheet really produces, for compare.ts to read.
//
//   npm run e2e -- --file apps/desktop/scripts/ocr-compare/sheet-capture.e2e.mjs      (build first)
//
// The strokes are the skeleton of a handwriting-style font (sheet-strokes.mjs), NOT a person's pen. Writes
// apps/desktop/.cache/ocr-compare/sheet-wacom.png (+ the truth, which make-pictures.swift wrote beside it).

import { execFileSync } from "node:child_process"
import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { ok, finish, sleep, freshNote, saved, js, noGrab, pickTablet, tabletBox, penStroke, pickFromMenu, waitFor, shot } from "../../../../e2e/lib/harness.mjs"
import { strokesFor } from "./sheet-strokes.mjs"

const here = path.dirname(fileURLToPath(import.meta.url))
const made = path.resolve(here, "../../.cache/ocr-compare")
if (!fs.existsSync(path.join(made, "sheet-source.pgm"))) throw new Error("run make-pictures.swift first (compare.ts does)")

await noGrab()
const file = await freshNote({ video: true, rendered: true })
await js(`!document.querySelector('.camera') && [...document.querySelectorAll('button')].find(b => b.dataset.bar === 'video')?.click()`)
await waitFor(`!!document.querySelector('.camera')`)
await pickTablet()
const t = await tabletBox()
console.log("sheet", JSON.stringify(t))

// the writing sits in the upper left of the sheet: the page picture is cut to the sheet's page shape, and writing right to the
// edge loses its last letter ("eggs")
const strokes = strokesFor(path.join(made, "sheet-source.pgm"),
  { x: t.x + t.w * 0.06, y: t.y + t.h * 0.08, w: t.w * 0.8, h: t.h * 0.5 }, { epsilon: 1 })
console.log("strokes", strokes.length, "points", strokes.reduce((n, s) => n + s.length, 0))
for (const stroke of strokes) await penStroke(stroke.length >= 2 ? stroke : [stroke[0], stroke[0]])
await sleep(300)
await shot("sheet-written")

const before = (await saved(file)).items.length
await pickFromMenu(".camera-bar [data-capture=ink]", "bring-page")
const drawing = await saved(file, (d) => d.items.length > before)
const picture = drawing.items.filter((i) => i.kind === "image").at(-1)
ok("the sheet's Page capture is a picture in the note", !!picture, JSON.stringify(drawing.items.map((i) => i.kind)))
// The picture is a JPEG in the note's media; it is decoded by the page and handed over as the PNG of its pixels.
const base64 = await js(`new Promise((resolve, reject) => { const i = new Image(); i.crossOrigin = 'anonymous'; i.onload = () => { try { const c = document.createElement('canvas'); c.width = i.naturalWidth; c.height = i.naturalHeight; c.getContext('2d').drawImage(i, 0, 0); resolve(c.toDataURL('image/png').split(',')[1]) } catch (e) { reject(e) } }; i.onerror = () => reject(new Error('the picture did not load')); i.src = 'wm://media/' + encodeURIComponent(${JSON.stringify(picture?.file)}) })`)
const png = path.join(made, "sheet-wacom.png")
fs.writeFileSync(png, Buffer.from(base64, "base64"))
console.log("wrote", png, execFileSync("sips", ["-g", "pixelWidth", "-g", "pixelHeight", png]).toString().replace(/\s+/g, " "))
finish()
