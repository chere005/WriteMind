// Every comparison picture, made ready AS THE APP MAKES IT before either reader sees it (docs/OCR-BUNDLED.md "Against
// Vision"): the real `prepareForReading` of renderer/ocrClient.ts runs in the real app - flattened on white, no side over
// 3200 pixels, a printed dot grid painted out - and the PNG that would be handed to the reader is written to
// apps/desktop/.cache/ocr-compare/prepared/<name>.png (with the ground truth beside it). compare.ts --prepared reads those.
//
//   npm run e2e -- --file apps/desktop/scripts/ocr-compare/prepare-pictures.e2e.mjs      (build first)

import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { ok, finish, freshNote, js, noGrab, waitFor } from "../../../../e2e/lib/harness.mjs"

const here = path.dirname(fileURLToPath(import.meta.url))
const desktop = path.resolve(here, "../..")
const made = path.join(desktop, ".cache", "ocr-compare")
const out = path.join(made, "prepared")
fs.mkdirSync(out, { recursive: true })

await noGrab()
const file = await freshNote()
await waitFor(`!!window.__wmOcr`)

const folders = [path.join(desktop, "test", "fixtures"), made]
for (const folder of folders) {
  for (const name of fs.readdirSync(folder).filter((n) => n.endsWith(".png") && fs.existsSync(path.join(folder, n.replace(/\.png$/, ".txt")))).sort()) {
    const b64 = fs.readFileSync(path.join(folder, name)).toString("base64")
    const result = JSON.parse(await js(`(async () => {
      const bytes = Uint8Array.from(atob(${JSON.stringify(b64)}), (c) => c.charCodeAt(0))
      const stored = (await window.wm.saveMedia(bytes, 'png', ${JSON.stringify(file)})).file
      const image = await new Promise((resolve, reject) => { const i = new Image(); i.crossOrigin = 'anonymous'; i.onload = () => resolve(i); i.onerror = () => reject(new Error('no picture')); i.src = 'wm://media/' + encodeURIComponent(stored) })
      const prepared = await window.__wmOcr.prepareForReading(image, image.naturalWidth, image.naturalHeight)
      const blob = await new Promise((resolve) => prepared.canvas.toBlob(resolve, 'image/png'))
      const buffer = new Uint8Array(await blob.arrayBuffer())
      let s = ''
      for (let i = 0; i < buffer.length; i += 8192) s += String.fromCharCode(...buffer.subarray(i, i + 8192))
      return JSON.stringify({ png: btoa(s), cleaned: prepared.cleaned, width: prepared.canvas.width, height: prepared.canvas.height, from: [image.naturalWidth, image.naturalHeight] })
    })()`))
    fs.writeFileSync(path.join(out, name), Buffer.from(result.png, "base64"))
    fs.copyFileSync(path.join(folder, name.replace(/\.png$/, ".txt")), path.join(out, name.replace(/\.png$/, ".txt")))
    console.log(`${name}: ${result.from.join("x")} -> ${result.width}x${result.height}${result.cleaned ? ", dot grid painted out" : ""}`)
    ok(`${name} prepared`, result.width > 0)
  }
}
finish()
