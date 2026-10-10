// @e2e video=text
// WHERE NO READER WORKS, THE APP SHOWS NOTHING FOR READING (docs/OCR-BUNDLED.md "Where the files come from"; AGENTS.md "ONE place
// asks what the platform can do"). Run it against a build without the reader (there is ONE, the bundled one: a dev build
// made offline without the models, or a scratch copy of a build with out/helpers/bundled-ocr moved away). Capabilities say
// so, a picked picture's bar has no Aa, the camera's box row has no Text, and there is no other reader to fall back on.
// (With the reader present this script fails by design: it is a check on the absence.)
//
//   npm run e2e -- --file apps/desktop/scripts/ocr-compare/no-reader.e2e.mjs      (in the scratch copy)

import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { showVideoPane, pickCamera, js, ok, note, finish, sleep, drag, freshNote, waitFor, rectOf } from "../../../../e2e/lib/harness.mjs"

const fixtures = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../test/fixtures")
await freshNote({ rendered: true })
const caps = await js(`window.wm.capabilities()`)
note(`capabilities: ocr ${caps.handwritingOCR}, platform ${caps.platform}`)
ok("capabilities say no reader works", caps.handwritingOCR === false)
ok("...and say nothing about which engine or language (there is one reader)", !('ocrEngine' in caps) && !('japaneseOCR' in caps))
const status = await js(`window.wm.ocrStatus()`)
ok("the reader's status agrees", status.ocr === false)

const b64 = fs.readFileSync(path.join(fixtures, "ocr-handwriting.png")).toString("base64")
await js(`(async()=>{const bytes=Uint8Array.from(atob(${JSON.stringify(b64)}),c=>c.charCodeAt(0));const dt=new DataTransfer();dt.items.add(new File([bytes],'p.png',{type:'image/png'}));document.dispatchEvent(new ClipboardEvent('paste',{clipboardData:dt,bubbles:true,cancelable:true}))})()`)
await sleep(1300)
ok("a pasted picture is picked, with its bar", (await js(`document.querySelector('[data-insp=name]')?.textContent`)) === "Picture" && await js(`!!document.querySelector('[data-insp=crop]')`))
ok("...and no Aa (data-insp=read) in it", await js(`!document.querySelector('[data-insp=read]')`))

await showVideoPane()
await pickCamera()
const live = await waitFor(`(() => { const v = document.querySelector('.camera video'); return v && v.videoWidth > 0 && v.readyState >= 2 })()`, 15000)
ok("the (fake) camera is delivering frames", live)
const body = await rectOf(".camera-body")
await drag(body.x + body.w * 0.1, body.y + body.h * 0.1, body.x + body.w * 0.9, body.y + body.h * 0.9, { steps: 8 })
await sleep(400)
ok("a box is up with its row", await js(`!!document.querySelector('.camera [data-camera=box-actions]')`))
ok("...and the row has no Text", await js(`!document.querySelector('.camera [data-camera=box-actions] [data-section=text]')`))
finish()
