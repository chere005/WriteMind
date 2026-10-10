// @e2e video=text
// THE CAMERA'S TEXT BOX ACTION through the bundled reader, in the real app (docs/OCR-BUNDLED.md "Against Vision",
// integration). The fake camera plays the real handwriting fixture (e2e/lib/fixtures.mjs `text.y4m`, 640x480 grey): a box
// over it, "Text" in the box's row, and the words come into the note as a cell with the toast under the header saying so.
//
//   npm run e2e -- --file apps/desktop/scripts/ocr-compare/camera-text.e2e.mjs      (build first)

import { showVideoPane, pickCamera, js, ok, note, finish, sleep, drag, freshNote, shot, waitFor, rectOf, doc } from "../../../../e2e/lib/harness.mjs"

await js(`localStorage.removeItem('writemind.captureMode')`)
await freshNote()
await showVideoPane()
await pickCamera()
const live = await waitFor(`(() => { const v = document.querySelector('.camera video'); return v && v.videoWidth > 0 && v.readyState >= 2 })()`, 15000)
ok("the (fake) camera is delivering frames", live)
if (!live) finish()
await sleep(600)
const body = await rectOf(".camera-body")
await drag(body.x + body.w * 0.04, body.y + body.h * 0.04, body.x + body.w * 0.96, body.y + body.h * 0.96, { steps: 8 })
await sleep(400)
ok("a box is up", await js(`!!document.querySelector('.camera .box')`))
ok("its row offers Text (a reader works)", await js(`!!document.querySelector('.camera [data-camera=box-actions] [data-section=text]')`))
await shot("camera-box")
const before = await doc()
await js(`document.querySelector('.camera [data-section=text]').click()`)
const toast = await waitFor(`/Text added to/.test(document.querySelector('.camera [data-toast]')?.textContent ?? '')`, 30000).catch(() => false)
const said = await js(`document.querySelector('.camera [data-toast]')?.textContent ?? ''`)
ok("a toast under the header says the text was added to the note, with how many lines", !!toast && /^✓ Text added to .+ · \d+ lines?$/.test(said), said)
await shot("camera-text-toast")
const added = (await doc()).slice(before.length)
note("added to the note: " + JSON.stringify(added))
// (the ink rules mark a word with a stroke through it ~~struck~~: at 640x480 they take the felt-tip "the" for one, with Vision's
// reading too - compare.ts scores the words, so the marks are stripped here)
const low = added.replace(/~~|\*\*/g, "").toLowerCase()
ok("the felt-tip words arrived in the note", /the quick brown fox/.test(low) && /jumps over the lazy dog/.test(low), added)
ok("...and the digits", /0123456789/.test(low))
ok("the standing footer line is still the standing hint (the result is the toast's)", !/added|✓/.test(await js(`document.querySelector('.camera [data-camera=status-line]')?.textContent ?? ''`)))
finish()
