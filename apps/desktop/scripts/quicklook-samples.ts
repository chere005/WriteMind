// Sample notes for trying WriteMind's Quick Look extension by hand on a Mac (docs/TESTING.md, "Quick Look"):
//
//   [QUICKLOOK_PROBE=http://127.0.0.1:<port>] npx vite-node apps/desktop/scripts/quicklook-samples.ts <folder>
//
// writes, into <folder> (which must not be Sean's notes folder - it refuses anything under ~/Documents):
//   plain.wm      headings, a text cell, a markdown cell, lists (a mixed one and to-dos), a quote, code, a table
//   rich.wm       a typeset maths cell, an inline maths span, a picture cell, a drawing cell (in drawing.json and as its
//                 snapshot), a runnable cell with its answer, free ink over the page (strokes, a text box, a picture)
//   big.wm        6 000 cells (more than the preview draws: its foot says so)
//   hostile.wm    words that try to be HTML and script, a span whose style tries to break out, and a drawing whose
//                 colours try to end their attributes and run script or load from QUICKLOOK_PROBE (tools/check-quicklook.sh
//                 listens there; each payload would also mark the page, which the photograph tool looks for)
//   slow.wm       lines crafted to be slow (tens of seconds each before the renderer read them in one pass)
//   newer.wm      a manifest of format version 2 (a plain message)
//   broken.wm     rich.wm cut short (a plain message)
//   evil-name.wm  an entry named ../evil (a plain message, nothing unpacked)
// Each is written by the app's own writer (core's entriesToWrite, main/zip.ts's zipBytes), so it is a real note. What
// each says is quicklook-sample-notes.ts, which the tests read too.

import { mkdirSync, readFileSync, writeFileSync } from "node:fs"
import os from "node:os"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { entriesToWrite, inkCellSvg, newWmFile, withEntry, writeDrawing, type Drawing, utf8 } from "@writemind/core"
import { zipBytes } from "../src/main/zip"
import { bigText, CELL, HOSTILE_TEXT, hostileDrawing, PLAIN_TEXT, RICH_CELL, RICH_DRAWING, RICH_TEXT, SLOW_TEXT, stroke } from "./quicklook-sample-notes"

const folder = process.argv[2]
if (!folder) { console.error("usage: vite-node apps/desktop/scripts/quicklook-samples.ts <folder>"); process.exit(2) }
const target = path.resolve(folder)
if (target.startsWith(path.join(os.homedir(), "Documents"))) { console.error("not under ~/Documents: that is where the notes live"); process.exit(2) }
mkdirSync(target, { recursive: true })
// (Port 9 is discard: with no probe given, nothing is listening and nothing is counted.)
const probe = process.env.QUICKLOOK_PROBE || "http://127.0.0.1:9"

const here = path.dirname(fileURLToPath(import.meta.url))
const picture = readFileSync(path.join(here, "../test/fixtures/ocr-english.png"))
const app = { name: "WriteMind", version: "samples" }
const now = new Date("2026-10-17T09:00:00Z")

function note(name: string, text: string, drawing: Drawing | null, extra: { name: string; data: Uint8Array }[] = []): Uint8Array {
  let file = newWmFile(now, app, text)
  if (drawing) file = withEntry(file, "drawing.json", utf8(writeDrawing(drawing)))
  for (const one of extra) file = withEntry(file, one.name, one.data)
  const bytes = zipBytes(entriesToWrite(file, { now, app }).entries, now)
  writeFileSync(path.join(target, name), bytes)
  console.log(`wrote ${path.join(target, name)} (${bytes.length} bytes)`)
  return bytes
}

note("plain.wm", PLAIN_TEXT, null)

const richBytes = note("rich.wm", RICH_TEXT, RICH_DRAWING, [
  { name: "media/page.png", data: picture },
  { name: "media/ink.png", data: picture },
  { name: `snapshots/ink-${CELL}.svg`, data: utf8(inkCellSvg(RICH_CELL, 832, { mediaUrl: (f) => f, metadata: true })) },
])

note("big.wm", bigText(), { items: [stroke("b1", "#2D7DD2", [[0.1, 0.02], [0.3, 0.04]])] })

note("hostile.wm", HOSTILE_TEXT, hostileDrawing(probe))

note("slow.wm", SLOW_TEXT, null)

writeFileSync(path.join(target, "newer.wm"), zipBytes(entriesToWrite({ ...newWmFile(now, app, "# from the future"), }, null).entries
  .map((entry) => entry.name === "manifest.json"
    ? { name: entry.name, data: utf8(JSON.stringify({ format: "writemind-note", version: 2, id: "0b6f5c1e-8d4a-5c0e-9a77-2f1d3b6a9e10" })) }
    : entry), now))
console.log(`wrote ${path.join(target, "newer.wm")}`)

writeFileSync(path.join(target, "broken.wm"), richBytes.subarray(0, Math.floor(richBytes.length * 0.6)))
console.log(`wrote ${path.join(target, "broken.wm")} (cut short)`)

writeFileSync(path.join(target, "evil-name.wm"), zipBytes([
  ...entriesToWrite(newWmFile(now, app, "# evil"), null).entries,
  { name: "../evil", data: utf8("outside") },
], now))
console.log(`wrote ${path.join(target, "evil-name.wm")}`)
