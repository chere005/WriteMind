// THE DRAWING INSPECTOR'S "Aa" on a picked picture, through the bundled reader, in the real app (docs/OCR-BUNDLED.md,
// integration): a picture of real handwriting (the committed fixture) is pasted, arrives picked with Aa in
// its bar, the press reads it, the words land as a cell directly under the picture, and the footer says so.
//
//   npm run e2e -- --file apps/desktop/scripts/ocr-compare/aa-picture.e2e.mjs      (build first)

import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { ok, note, finish, sleep, freshNote, js, doc, shot, waitFor, saved, key, CTRL } from "../../../../e2e/lib/harness.mjs"

const fixtures = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../test/fixtures")
const file = await freshNote({ rendered: true })
const caps = await js(`window.wm.capabilities()`)
note(`capabilities: ocr ${caps.handwritingOCR}, platform ${caps.platform}`)
ok("the reader is there, so the app offers Aa", caps.handwritingOCR === true)

const paste = (name) => {
  const b64 = fs.readFileSync(path.join(fixtures, name)).toString("base64")
  return js(`(async()=>{const bytes=Uint8Array.from(atob(${JSON.stringify(b64)}),c=>c.charCodeAt(0));const dt=new DataTransfer();dt.items.add(new File([bytes],'p.png',{type:'image/png'}));document.dispatchEvent(new ClipboardEvent('paste',{clipboardData:dt,bubbles:true,cancelable:true}))})()`)
}
const has = (control) => js(`!!document.querySelector('[data-insp=${control}]')`)

await paste("ocr-handwriting.png")
await sleep(1300)
ok("the pasted picture arrives picked, named Picture", (await js(`document.querySelector('[data-insp=name]')?.textContent`)) === "Picture")
ok("...with Aa (data-insp=read) in its bar", await has("read"))
const before = await doc()
await shot("picture-picked")
await js(`document.querySelector('[data-insp=read]').click()`)
const done = await waitFor(`/^Read \\d+ lines? into the note\\./.test(document.querySelector('[data-footer=read-notice]')?.textContent ?? '')`, 30000).catch(() => false)
const notice = await js(`document.querySelector('[data-footer=read-notice]')?.textContent ?? ''`)
ok("the footer says how many lines were read into the note", !!done, notice)
const after = await doc()
note("the note now reads: " + JSON.stringify(after))
const words = after.slice(before.length).toLowerCase()
ok("the words of the felt-tip print came into the note", /the quick brown fox/.test(words) && /jumps over the lazy dog/.test(words) && /0123456789/.test(words), words)
ok("...and a good part of the biro cursive (\"the qui...\", \"jumps over the lazy\")", /the qui/.test(words) && /jumps over the lazy/.test(words))
// WHERE: a cell of its own, under the picture (its bottom edge), not at the top of the note and not over the picture.
const line = await js(`(() => { const lines = [...document.querySelectorAll('.cm-line')].filter((l) => /quick brown/i.test(l.textContent)); const r = lines[0]?.getBoundingClientRect(); return r ? JSON.stringify({ top: r.top }) : 'null' })()`)
note("first line of the reading at " + line)
await shot("after-read")
// the picture is still there, and the reading is one Ctrl+Z from gone
const d = await saved(file)
ok("the picture stays in the drawing", d.items.filter((i) => i.kind === "image").length === 1)
await js(`document.querySelector('.cm-content').focus()`)
await key("z", { modifiers: CTRL })
await sleep(500)
ok("one Ctrl+Z takes the words back out of the note", !/quick brown/i.test((await doc()).slice(before.length)), JSON.stringify(await doc()))
finish()
