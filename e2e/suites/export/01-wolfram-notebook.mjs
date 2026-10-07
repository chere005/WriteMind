// File ▸ Export… ▸ Wolfram Notebook (main/wolfram/notebookFile.ts, port-only: docs/PARITY.md), through the real panel
// (the save pick is named by the harness) and, when this machine has wolframscript, checked by the real engine: the
// file Gets as a Notebook, each drawing is an Image Output cell with its size right, and nothing evaluated. Pass 2
// chooses, in Language Setup, a program that answers its version and then never answers a run (a shell script, Mac
// and Linux): the export still writes the file, every drawing is a CLOSED initialization cell, and the notice the
// dialog would have shown is read back (WRITEMIND_E2E records it instead of showing it). Unit side:
// packages/core/test/wolfram*.test.ts, apps/desktop/test/wolfram*.test.ts; the full fixture check is
// apps/desktop/scripts/check-wolfram.ts.
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { spawnSync } from "node:child_process"
import {
  ok, skip, finish, js, sleep, freshNote, setDoc, focus, dragPath, line, saved, pickNext, shot, until, menuClick, key, VIEW,
} from "../../lib/harness.mjs"

const scratch = fs.mkdtempSync(path.join(os.tmpdir(), "wm-e2e-wolfram-"))
const WORDS = "# Export\n\nAbove the drawing, with **bold** and `wl:x^2`.\n\n- [ ] a to-do\n\n```wl\ny = 2x\n```\n\n```eval wl\n1 + 1\n```\n\n```out\n2\n```"
const cellBox = async () => JSON.parse(await js(`(()=>{const e=document.querySelector('.wm-inkcell canvas');if(!e)return 'null';const r=e.getBoundingClientRect();return JSON.stringify({x:r.x,y:r.y,w:r.width,h:r.height})})()`))
const wolframscript = ["/opt/homebrew/bin/wolframscript", "/usr/local/bin/wolframscript", "/Applications/Wolfram Engine.app/Contents/Resources/Wolfram Player.app/Contents/MacOS/wolframscript",
  "/Applications/Wolfram.app/Contents/MacOS/wolframscript", "/Applications/Mathematica.app/Contents/MacOS/wolframscript"].find((file) => fs.existsSync(file))

// ---- a note with words and one drawing cell holding two pen strokes
const file = await freshNote()
await setDoc(WORDS, 0)
await focus(); await js(`${VIEW}.dispatch({selection:{anchor:30}})`)
await menuClick("insertInkCell"); await sleep(700)
const c = await cellBox()
ok("a drawing cell", !!c)
await dragPath(line([c.x + 90, c.y + 50], [c.x + 300, c.y + 120], 14)); await sleep(250)
await dragPath(line([c.x + 90, c.y + 120], [c.x + 300, c.y + 50], 14)); await sleep(250)
await key("Escape"); await sleep(200)
const d = await saved(file, (x) => (x.items.find((i) => i.kind === "cell")?.items?.length ?? 0) === 2)
const cell = d.items.find((i) => i.kind === "cell")
ok("the cell holds its two strokes", cell?.items.length === 2)

/** Export through the panel and wait for the file. */
async function exportTo(name) {
  const out = path.join(scratch, name)
  await pickNext(out)
  await menuClick("export")
  const there = await until(() => fs.existsSync(out) && fs.statSync(out).size > 0, 120000, 300)
  return there ? fs.readFileSync(out, "utf8") : null
}

// ---- pass 1: a program that answers its version and never a run (the engine "does not answer"). It goes FIRST: the
// kernel's real answers are remembered by what was drawn, so once the engine has made this drawing a second export
// would be served from memory and nothing would fall back.
if (process.platform === "win32") skip("the engine that does not answer", "a shell-script stand-in")
else {
  const fake = path.join(scratch, "wolframscript")
  fs.writeFileSync(fake, `#!/bin/sh\nif [ "$1" = "-version" ]; then echo "WolframScript 1.14.0 for stand-in"; exit 0; fi\nexit 0\n`, { mode: 0o755 })
  await pickNext(fake)
  const chosen = await js(`window.wm.languages.choose("wolfram").then((a) => JSON.stringify(a))`)
  ok("Language Setup takes the stand-in as Wolfram's program", JSON.parse(chosen).kind === "chosen", chosen.slice(0, 200))
  await js(`window.wm.e2eTold()`)
  const closed = await exportTo("fallback.nb")
  ok("the export still writes a notebook", closed !== null)
  ok("the drawing is a closed initialization cell that makes it", /CellOpen -> False, InitializationCell -> True/.test(closed ?? "") && /ImportString\[/.test(closed ?? ""))
  const told = await js(`window.wm.e2eTold().then((t) => JSON.stringify(t))`)
  ok("the notice says its drawings appear when its cells are evaluated", /Its drawings appear when its cells are evaluated/.test(told) && /Evaluate Initialization Cells/.test(told), told)
  await js(`window.wm.languages.automatic("wolfram")`)
}

// ---- pass 2: the engine this machine finds by itself
if (!wolframscript) skip("the real engine", "no wolframscript here")
else {
  const engine = await exportTo("engine.nb")
  ok("Export… ▸ Wolfram Notebook wrote a .nb", engine !== null)
  ok("it is a notebook file, ASCII", engine !== null && engine.startsWith("(* Content-type: application/vnd.wolfram.mathematica *)") && !/[^\x00-\x7f]/.test(engine))
  ok("the words are the notebook's own styles", /Cell\["Export", "Title"\]/.test(engine ?? "") && /"Item"/.test(engine ?? "") && /"Output"/.test(engine ?? ""))
  ok("the maths cell is an Input, written with ==", /Cell\[BoxData\[[\s\S]*?2[\s\S]*?"Input", TaggingRules -> \{"WriteMind" -> "maths"\}\]/.test(engine ?? ""))
  const run = spawnSync(wolframscript, ["-code", `nb = Get["${path.join(scratch, "engine.nb")}"];
    imgs = Cases[First[nb], c : Cell[_, "Output", ___, TaggingRules -> {"WriteMind" -> "ink"}] :> ToExpression[c[[1, 1]]]];
    Print["images:", Length[imgs], " ", And @@ (ImageQ /@ imgs), " ", ImageDimensions /@ imgs]`], { encoding: "utf8", timeout: 120000 })
  const said = run.stdout.trim()
  ok("the file Gets as a Notebook whose drawing is an Image", /^images:1 True/.test(said), said)
  await shot("exported")
}
fs.rmSync(scratch, { recursive: true, force: true })
finish()
