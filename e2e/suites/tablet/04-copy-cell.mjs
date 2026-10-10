// The tablet box's "Copy Cell" (renderer/BoxActions.tsx, App.tsx `copySheetCell`, main/wolfram/clipboard.ts `cell`; Sean, 2026-10-06):
// the boxed writing on the SYSTEM CLIPBOARD as a drawing cell, the note untouched.
//   - the row has the fourth button; a mouse click and a pen TAP (the feed clicks it) copy; an empty box copies nothing;
//   - the note, its drawing, the sheet and its box are as they were;
//   - for other apps: a real .svg FILE (the system's file reference) and the SVG markup, TRANSPARENT, and no
//     PNG or TIFF; on a Mac the pasteboard is read back through AppKit (osascript JavaScript): one item, the file's URL;
//   - a paste in WriteMind is a NEW drawing cell at the caret (the editor's paste), one Undo step, no floating picture; a paste
//     with the focus off the editor lands it too (the window's listener), exactly once.
// The harness puts the clipboard back. Unit side: apps/desktop/test/copyCell.test.ts, copiedCell.test.ts.
import fs from "node:fs"
import { spawnSync } from "node:child_process"
import {
  js, ok, note, skip, finish, send, sleep, freshNote, noGrab, showVideoPane, pickTablet, setSelect, tabletBox, waitFor, mouse, drag, click,
  setDoc, focus, key, sidecar, saved, until, META, CTRL, VIEW,
} from "../../lib/harness.mjs"
import { feedConfig, inject, sample, sheetStrokes, strokeSamples } from "../../lib/penfeed.mjs"

const MAC = process.platform === "darwin"
/** The platform's own Paste, as the key delivers it (Chromium takes `commands` for the editing action). */
const system = async (command, k) => {
  const info = { key: k, code: "Key" + k.toUpperCase(), windowsVirtualKeyCode: k.toUpperCase().charCodeAt(0), modifiers: MAC ? META : CTRL }
  await send("Input.dispatchKeyEvent", { type: "rawKeyDown", ...info, commands: [command] })
  await send("Input.dispatchKeyEvent", { type: "keyUp", ...info })
}
/** Something else on the clipboard (a page's own Copy), so a copy that does nothing shows. */
const sentinel = (words) => js(`(()=>{const t=document.createElement('textarea');t.value=${JSON.stringify(words)};document.body.appendChild(t);t.select();const done=document.execCommand('copy');t.remove();return done})()`)
const clip = async () => JSON.parse(await js(`window.wm.e2eClipboard("read").then(JSON.stringify)`))

await js(`window.wm.e2eClipboard("save")`)
try {
  await js(`localStorage.removeItem('writemind.pen')`)
  await noGrab()
  const file = await freshNote({ video: true, rendered: true })
  await showVideoPane()
  await pickTablet()
  await setSelect("[data-tablet=orientation]", "0"); await sleep(350)

  // ---- the note's words, the pen feed
  const cm = JSON.parse(await js(`(()=>{const r=document.querySelector('.cm-content').getBoundingClientRect();return JSON.stringify({x:r.x,y:r.y})})()`))
  await setDoc("First paragraph.\n\nSecond paragraph.", 5)
  await focus()
  await sleep(300)
  const state = () => js(`window.wm.pen.e2e.state().then(s => JSON.stringify({ active: s.active }))`).then(JSON.parse)
  await waitFor(`!!window.__wmPenFeed`)
  await feedConfig({ native: false, backends: ["inject"], focused: true }); await sleep(300)
  await feedConfig({ capture: true }); await sleep(300)
  for (let i = 0; i < 30 && (await state()).active !== "inject"; i++) { await inject([sample({ x: 0.45 + (i % 6) * 0.01, y: 0.5 })]); await sleep(50) }
  await inject([sample({ x: 0.5, y: 0.5, inRange: false })]); await sleep(100)
  await js(`window.__wmSheet.clear?.(); true`); await sleep(150)

  const t = await tabletBox()
  const toPx = (u) => ({ x: t.x + u.x * t.w, y: t.y + u.y * t.h })
  const toSheet = (p) => ({ x: (p.x - t.x) / t.w, y: (p.y - t.y) / t.h })
  const rect = (sel) => js(`(()=>{const e=document.querySelector(${JSON.stringify(sel)});if(!e)return null;const r=e.getBoundingClientRect();return JSON.stringify({x:r.x,y:r.y,w:r.width,h:r.height})})()`).then((v) => v && JSON.parse(v))
  const centre = (r) => ({ x: r.x + r.w / 2, y: r.y + r.h / 2 })
  const zig = (x0, y0, w, h, n = 8) => Array.from({ length: n + 1 }, (_, i) => ({ x: x0 + w * i / n, y: y0 + (i % 2 ? h : 0) }))
  const word = async (x0, y0) => { await inject(strokeSamples(zig(x0, y0, 0.18, 0.06))); await inject(strokeSamples(zig(x0 + 0.02, y0 + 0.03, 0.14, 0.05, 6))); await sleep(150) }
  const boxOver = async (a, b) => { await sleep(400); const p = toPx(a), q = toPx(b); await drag(p.x, p.y, q.x, q.y, { steps: 10 }); await sleep(250) }
  const noteText = () => js(`document.querySelector('.cm-content').cmTile.view.state.doc.toString()`)

  await word(0.52, 0.22)
  await boxOver({ x: 0.42, y: 0.15 }, { x: 0.8, y: 0.45 })
  ok("the box and its row are up", !!(await rect(".camera .tablet .box")) && !!(await rect("[data-tablet=box-actions]")))
  const labels = JSON.parse(await js(`JSON.stringify([...document.querySelectorAll('[data-tablet=box-actions] button')].map(b => [b.dataset.boxAction, b.textContent, b.disabled]))`))
  ok("the row has a fourth button, Copy Cell, after the three", JSON.stringify(labels.map((l) => l[0])) === JSON.stringify(["erase", "ink", "cell", "copy"]) && labels[3][1] === "Copy Cell", JSON.stringify(labels))
  const row = await rect("[data-tablet=box-actions]")
  ok("the row (four buttons) stays on the sheet", row.x >= t.x - 1 && row.x + row.w <= t.x + t.w + 1, JSON.stringify({ row, t }))

  const wordsBefore = await noteText()
  const itemsBefore = (await sidecar(file)).items.length
  const strokesBefore = (await sheetStrokes()).length
  const boxBefore = await rect(".camera .tablet .box")

  // ---- a mouse click copies
  ok("(a sentinel is on the clipboard first)", await sentinel("SENTINEL"))
  await sleep(200)
  const copyAt = centre(await rect("[data-box-action=copy]"))
  await click(copyAt.x, copyAt.y); await sleep(700)
  const first = await clip()
  const types = Object.keys(first)
  note("types: " + types.join(" ; "))
  const text = first["text/plain"] ?? ""
  ok("the clipboard's words are the drawing's SVG (a transparent one)", text.startsWith("<svg") && !/#FFFFFF/i.test(text) && /<path|<polyline/.test(text), text.slice(0, 120))
  ok("WriteMind's own custom type is there (the strokes and the box, for its own paste)", types.some((type) => /chromium|web custom/i.test(type)), types.join(", "))
  ok("no PNG, and no bitmap, beside it (it would win over the file in other apps)", !types.some((type) => /png|tiff|jpeg|bmp/i.test(type)), types.join(", "))
  const fileUrl = first["text/uri-list"] ?? first[`electron application/osclipboard;format="public.file-url"`] ?? ""
  ok("the file reference is there (public.file-url on a Mac, text/uri-list elsewhere)", fileUrl !== "", types.join(", "))
  const uri = fileUrl.trim().split(/\r?\n/)[0]
  const path = uri.startsWith("file://") ? decodeURIComponent(new URL(uri).pathname.replace(/^\/([A-Za-z]:)/, "$1")) : ""
  ok("...to a real .svg file with the same SVG in it", path.endsWith(".svg") && fs.existsSync(path) && fs.readFileSync(path, "utf8") === text, uri)
  ok("...in the app's own temp folder", /WriteMind-copied/.test(path), path)
  ok("the SVG markup is on the clipboard under the system's SVG type", types.some((type) => /svg/i.test(type)), types.join(", "))

  ok("the note is untouched (words and drawing)", (await noteText()) === wordsBefore && (await sidecar(file)).items.length === itemsBefore)
  ok("the sheet keeps the writing and its box stays", (await sheetStrokes()).length === strokesBefore && JSON.stringify(await rect(".camera .tablet .box")) === JSON.stringify(boxBefore))

  if (MAC) {
    // The system's own reading of the pasteboard (AppKit through osascript's JavaScript): the items and their types, and the
    // file reference Finder's Paste reads.
    const JXA = `ObjC.import("AppKit"); var pb=$.NSPasteboard.generalPasteboard; var items=pb.pasteboardItems; var r={items:[],file:null};
      for (var i=0;i<items.count;i++){ var it=items.objectAtIndex(i); r.items.push(ObjC.deepUnwrap(it.types)); var f=it.stringForType("public.file-url"); if(f && !r.file) r.file=ObjC.unwrap(f) }
      JSON.stringify(r)`
    const read = JSON.parse(spawnSync("osascript", ["-l", "JavaScript", "-e", JXA], { encoding: "utf8" }).stdout.trim() || "{}")
    note("NSPasteboard items: " + JSON.stringify(read.items))
    const all = (read.items ?? []).flat()
    ok("macOS sees ONE pasteboard item with the file reference, the SVG and the words (as Finder's own Copy of a file)",
      read.items?.length === 1 && all.includes("public.file-url") && all.includes("public.svg-image") && all.includes("public.utf8-plain-text"), JSON.stringify(read.items))
    ok("...no PNG or TIFF anywhere on it", !all.some((type) => /png|tiff|jpeg/i.test(type)), JSON.stringify(read.items))
    ok("...and the file reference is the SVG file (Finder, Mail and Pages paste that file)", read.file === uri && fs.existsSync(path), `${read.file} / ${uri}`)
  } else skip("the pasteboard read back by the system", "macOS only (osascript)")

  // ---- Mathematica's own type, on a Mac (docs/PARITY.md: port-only)
  if (MAC) {
    const OMEG = `electron application/osclipboard;format="dyn.ah62d4rv4gk8y8xnfk6"`
    const cell = (await clip())[OMEG] ?? ""
    ok("Mathematica's own type is there too (the cell that makes the drawing, or the image once the engine has answered)", /^Cell\[BoxData\[/.test(cell), cell.slice(0, 80))
  }

  // ---- WriteMind's own paste: a new drawing cell at the caret
  const line0 = JSON.parse(await js(`(()=>{const l=document.querySelectorAll(".cm-line")[0];const r=l.getBoundingClientRect();return JSON.stringify({x:r.x+30,y:r.y+r.height/2})})()`))
  await click(line0.x, line0.y); await sleep(150)   // the caret in the first paragraph
  await js(`${VIEW}.focus()`)
  await system("paste", "v"); await sleep(900)
  const pasted = await noteText()
  const m = /!\[ink\]\(snapshots\/ink-([0-9a-f-]+)\.svg\)/g
  const lines = [...pasted.matchAll(m)]
  ok("a paste in the note is ONE new drawing cell, after the caret's paragraph (not text, not a picture)", lines.length === 1 && pasted.startsWith(`First paragraph.\n\n${lines[0][0]}`) && !pasted.includes("<svg"), JSON.stringify(pasted))
  const drawn = lines[0] ? (await saved(file, (d) => d.items.some((i) => i.kind === "cell" && i.id === lines[0][1]))) : { items: [] }
  const made = drawn.items.find((i) => i.kind === "cell")
  ok("...a cell with the writing's strokes in it", !!made && made.items.length === 2, JSON.stringify(made && made.items.length))
  ok("...and no floating picture beside it", drawn.items.every((i) => i.kind === "cell"), JSON.stringify(drawn.items.map((i) => i.kind)))
  await key("z", { modifiers: MAC ? META : CTRL }); await sleep(400)
  const afterUndo = await saved(file, (d) => d.items.length === itemsBefore)
  ok("ONE Undo takes the whole paste back (the line and the cell)", (await noteText()) === wordsBefore && afterUndo.items.length === itemsBefore, JSON.stringify([await noteText(), afterUndo.items.length, itemsBefore]))

  // ---- a paste with the focus off the editor: the window's listener, exactly once
  await js(`${VIEW}.dispatch({selection:{anchor:3}}); document.activeElement && document.activeElement.blur(); document.body.focus(); true`)
  await sleep(100)
  await js(`window.wm.editNative("paste")`); await sleep(900)
  const again = [...(await noteText()).matchAll(m)]
  ok("a paste with the focus off the editor lands it once too", again.length === 1, String(again.length))
  await key("z", { modifiers: MAC ? META : CTRL }); await sleep(300)

  // ---- a pen TAP on the button copies (the feed clicks it: no user gesture), and replaces the copy
  await sentinel("SENTINEL 2")
  await sleep(100)
  const u = toSheet(copyAt)
  await sleep(200)
  await inject([sample({ x: u.x, y: u.y }), sample({ x: u.x, y: u.y, tip: true, p: 0.4 }), sample({ x: u.x + 0.001, y: u.y, tip: true, p: 0.4 }), sample({ x: u.x, y: u.y }), sample({ x: u.x, y: u.y, inRange: false })])
  const tapped = await until(async () => ((await clip())["text/plain"] ?? "").startsWith("<svg"), 4000, 150)
  ok("a pen TAP on Copy Cell copies it too (no gesture needed)", tapped)

  // ---- an empty box copies nothing
  await key("Escape"); await sleep(150)
  await sentinel("SENTINEL 3")
  await boxOver({ x: 0.05, y: 0.6 }, { x: 0.3, y: 0.85 })
  const empty = centre(await rect("[data-box-action=copy]"))
  await click(empty.x, empty.y); await sleep(600)
  const left = (await clip())["text/plain"] ?? ""
  ok("a box with nothing written in it copies nothing (the clipboard is as it was)", !left.startsWith("<svg"), left.slice(0, 60))
  ok("...and says so", /nothing written in that box/.test(await js(`document.querySelector('.camera .trouble')?.textContent ?? ''`)))
} finally {
  await js(`window.wm.e2eClipboard("restore")`)
}
finish()
