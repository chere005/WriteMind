// @e2e isolated
// A PICTURE COPIED FROM ONE NOTE INTO ANOTHER IS AN ENTRY OF THE NOTE IT LANDS IN (docs/SPEC-WM.md 1.2, 3.3; wmStore.ts
// `withNamedMedia`). Copying a picture object in note A and pasting it into note B used to add the item to B's drawing and
// nothing else: B showed the picture only while A's container was loaded (a cross-note lookup by name), and after a restart —
// or with A gone — B had an <img> with nothing behind it.
//   1. a picture is pasted into A (it arrives picked), copied with the keyboard, and pasted into B;
//   2. B's own .wm holds the picture's bytes (read from disk by lib/wm.mjs, not by the app);
//   3. A is deleted and the app restarted: B alone still serves the picture.
// The unit side: apps/desktop/test/wmStoreFixes.test.ts (13).
import fs from "node:fs"
import {
  ok, finish, js, sleep, until, key, CTRL, freshNote, setDoc, setRendered, saved, shot,
} from "../../lib/harness.mjs"
import { readWm } from "../../lib/wm.mjs"
import { restartApp } from "../../lib/harness.mjs"

const PASTE_PNG = `(async () => {
  const c = document.createElement('canvas'); c.width = 120; c.height = 80; const x = c.getContext('2d');
  x.fillStyle = '#e03030'; x.fillRect(0, 0, 60, 40); x.fillStyle = '#3030e0'; x.fillRect(60, 40, 60, 40)
  const blob = await new Promise((r) => c.toBlob(r, 'image/png'))
  const dt = new DataTransfer(); dt.items.add(new File([blob], 'pasted.png', { type: 'image/png' }))
  document.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }))
})()`
const served = (name) => js(`new Promise((res) => { const i = new Image(); i.onload = () => res([i.naturalWidth, i.naturalHeight]); i.onerror = () => res(null); i.src = 'wm://media/' + encodeURIComponent(${JSON.stringify(name)}) })`)

// ---- 1. a picture in A, copied, pasted into B --------------------------------------------------------------------------------
const a = await freshNote()
await setDoc("# A\n", 0)
await sleep(700)
await setRendered(true) // the page ink layer (pictures, objects) belongs to the rendered page (2.17.0)
await js(PASTE_PNG)
const inA = await saved(a, (d) => d.items.some((i) => i.kind === "image"), 8000)
const picture = inA.items.find((i) => i.kind === "image")?.file
ok("the picture is in A's drawing", !!picture, JSON.stringify(inA.items.map((i) => i.kind)))
await sleep(800)
ok("...and in A's own .wm", !!picture && readWm(a).entries[`media/${picture}`]?.length > 0)

// (the copy puts a token on the clipboard through the page's own copy command: it is caught on its way out)
await js(`window.__copied = null; window.addEventListener('copy', (event) => { window.__copied = event.clipboardData.getData('text/plain') })`)
await js(`document.activeElement?.blur?.()`)
await key("c", { modifiers: CTRL })
const copied = await until(() => js(`window.__copied !== null`), 4000, 100)
const token = await js(`window.__copied`)
ok("Ctrl+C on the picked picture copies the object", copied && typeof token === "string" && token.length > 0, JSON.stringify(token))

const b = await freshNote()
await setDoc("# B\n", 0)
await sleep(700)
await js(`(() => { const dt = new DataTransfer(); dt.setData('text/plain', window.__copied); document.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true })) })()`)
const inB = await saved(b, (d) => d.items.some((i) => i.kind === "image"), 8000)
ok("the object is pasted into B's drawing", inB.items.some((i) => i.kind === "image" && i.file === picture), JSON.stringify(inB.items.map((i) => [i.kind, i.file])))
await sleep(900)

// ---- 2. B's own file holds the picture ---------------------------------------------------------------------------------------
const bFile = readWm(b)
ok("B's own .wm holds the picture's bytes (a real PNG), not only a reference to A's", !!picture && bFile.entries[`media/${picture}`]?.subarray(0, 4).toString("hex") === "89504e47", `${picture} ${bFile.names.join(",")}`)
await shot("pasted-between-notes")

// ---- 3. A goes, the app restarts: B stands alone -----------------------------------------------------------------------------
fs.rmSync(a, { force: true })
await restartApp()
await sleep(1800)
const again = await saved(b, (d) => d.items.some((i) => i.kind === "image"), 8000)
ok("after a restart B's drawing still has the picture", again.items.some((i) => i.kind === "image" && i.file === picture))
const back = await served(picture)
ok("...and the picture is served out of B alone (A is gone)", !!back && back[0] === 120 && back[1] === 80, JSON.stringify(back))
finish()
