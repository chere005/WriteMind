// Copy of a drawing cell, written again for Mathematica (main/wolfram/clipboard.ts, port-only: docs/PARITY.md). Mac only:
// the front end's own pasteboard type is known there, so what is on the SYSTEM clipboard can be read back from main
// (WRITEMIND_E2E `e2eClipboard`): at once the cell as an open Input cell, then — when the engine answers — the image
// itself (`GraphicsBox`), checked with wolframscript to be an Image of the right size; and a paste back into WriteMind
// is exactly the one cell line, no floating picture. The harness puts the clipboard back. Unit side:
// apps/desktop/test/wolframCopy.test.ts.
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { spawnSync } from "node:child_process"
import {
  ok, note, skip, finish, js, send, sleep, freshNote, setDoc, focus, key, dragPath, line, saved, until, doc, click, brackets, menuClick, META, VIEW,
} from "../../lib/harness.mjs"

if (process.platform !== "darwin") { skip("copy for Mathematica", "the front end's clipboard type is known on a Mac only"); finish(); process.exit(0) }
const OMEG = `electron application/osclipboard;format="dyn.ah62d4rv4gk8y8xnfk6"`
const wolframscript = ["/opt/homebrew/bin/wolframscript", "/usr/local/bin/wolframscript", "/Applications/Wolfram Engine.app/Contents/Resources/Wolfram Player.app/Contents/MacOS/wolframscript",
  "/Applications/Wolfram.app/Contents/MacOS/wolframscript", "/Applications/Mathematica.app/Contents/MacOS/wolframscript"].find((file) => fs.existsSync(file))
const cellBox = async () => JSON.parse(await js(`(()=>{const e=document.querySelector('.wm-inkcell canvas');if(!e)return 'null';const r=e.getBoundingClientRect();return JSON.stringify({x:r.x,y:r.y,w:r.width,h:r.height})})()`))
/** The platform's own Copy / Paste, as the key delivers it (Chromium takes `commands` for the editing action). */
const system = async (command, k) => {
  const info = { key: k, code: "Key" + k.toUpperCase(), windowsVirtualKeyCode: k.toUpperCase().charCodeAt(0), modifiers: META }
  await send("Input.dispatchKeyEvent", { type: "rawKeyDown", ...info, commands: [command] })
  await send("Input.dispatchKeyEvent", { type: "keyUp", ...info })
}
const clip = async () => JSON.parse(await js(`window.wm.e2eClipboard("read").then(JSON.stringify)`))

await js(`window.wm.e2eClipboard("save")`)
try {
  const file = await freshNote()
  await setDoc("# Copy\n\nA drawing cell below.", 0)
  await focus(); await js(`${VIEW}.dispatch({selection:{anchor:20}})`)
  await menuClick("insertInkCell"); await sleep(700)
  const c = await cellBox()
  ok("a drawing cell", !!c)
  await dragPath(line([c.x + 90, c.y + 50], [c.x + 300, c.y + 120], 14)); await sleep(250)
  await key("Escape"); await sleep(200)
  await saved(file, (x) => (x.items.find((i) => i.kind === "cell")?.items?.length ?? 0) === 1)

  // Hold the cell by its bracket in the gutter, and press the system's Copy (the shell's own key, `commands`).
  const mine = (await brackets()).find((b) => b.y >= c.y && b.y <= c.y + c.h)
  ok("the drawing cell has a bracket to hold it by", !!mine)
  const before = await doc()
  await click(mine.right, mine.y); await sleep(150)
  await system("copy", "c"); await sleep(300)

  const first = await clip()
  ok("the page's own copy is on the clipboard still (WriteMind's cells, and words)", Object.keys(first).some((t) => /chromium|web custom/i.test(t)) && typeof first["text/plain"] === "string", Object.keys(first).join(", "))
  ok("the front end's own type is there at once, holding the cell that makes the drawing", /Cell\[BoxData\["\(\* WriteMind: a drawing/.test(first[OMEG] ?? ""), String(first[OMEG]).slice(0, 80))
  if (!wolframscript) skip("the image itself", "no wolframscript here")
  else {
    const answered = await until(async () => /GraphicsBox/.test((await clip())[OMEG] ?? ""), 60000, 500)
    ok("when the engine answers, the same type holds the image itself", answered)
    const second = await clip()
    note("types now: " + Object.keys(second).join(" ; "))
    ok("a PNG for other apps went beside it", Object.keys(second).some((t) => /png/i.test(t)), Object.keys(second).join(", "))
    const text = second[OMEG] ?? ""
    const out = path.join(os.tmpdir(), `wm-e2e-copy-${process.pid}.txt`)
    fs.writeFileSync(out, text)
    const run = spawnSync(wolframscript, ["-code", `c = ToExpression[ReadString["${out}"]]; i = ToExpression[c[[1, 1]]]; Print[Head[c], " ", ImageQ[i], " ", ImageDimensions[i]]`], { encoding: "utf8", timeout: 120000 })
    fs.rmSync(out, { force: true })
    ok("it parses back to a Cell holding an Image", /^Cell True \{\d+, \d+\}/.test(run.stdout.trim()), run.stdout.trim())
    // A paste back into WriteMind is the cells and only the cells.
    const floatingBefore = (await saved(file, () => true)).items.filter((i) => i.kind !== "cell").length
    const last = (await brackets()).at(-1)
    await click(last.right, last.y); await sleep(150)
    await js(`${VIEW}.focus()`); await system("paste", "v"); await sleep(900)
    const after = await doc()
    const lines = (after.match(/!\[ink\]\(\.drawings\/media\/ink-[0-9a-f-]+\.svg\)/g) ?? []).length
    ok("pasting it back is one more cell line", lines === 2 && after.length > before.length, `${lines} ink lines in ${JSON.stringify(after)}`)
    const drawing = await saved(file, () => true)
    ok("...and no floating picture beside it", drawing.items.filter((i) => i.kind !== "cell").length === floatingBefore, JSON.stringify(drawing.items.map((i) => i.kind)))
  }
} finally {
  await js(`window.wm.e2eClipboard("restore")`)
}
finish()
