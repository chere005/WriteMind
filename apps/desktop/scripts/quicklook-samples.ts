// Sample notes for trying WriteMind's Quick Look extension by hand on a Mac (docs/TESTING.md, "Quick Look"):
//
//   npx vite-node apps/desktop/scripts/quicklook-samples.ts <folder>
//
// writes, into <folder> (which must not be Sean's notes folder - it refuses anything under ~/Documents):
//   plain.wm      headings, a text cell, a markdown cell, lists (a mixed one and to-dos), a quote, code, a table
//   rich.wm       a typeset maths cell, an inline maths span, a picture cell, a drawing cell (in drawing.json and as its
//                 snapshot), a runnable cell with its answer, free ink over the page (strokes, a text box, a picture)
//   big.wm        6 000 cells (more than the preview draws: its foot says so)
//   hostile.wm    words that try to be HTML and script, a span whose style tries to break out
//   newer.wm      a manifest of format version 2 (a plain message)
//   broken.wm     rich.wm cut short (a plain message)
//   evil-name.wm  an entry named ../evil (a plain message, nothing unpacked)
// Each is written by the app's own writer (core's entriesToWrite, main/zip.ts's zipBytes), so it is a real note.

import { mkdirSync, readFileSync, writeFileSync } from "node:fs"
import os from "node:os"
import path from "node:path"
import { fileURLToPath } from "node:url"
import {
  entriesToWrite, inkCellSvg, newWmFile, noTransform, withEntry, writeDrawing, type CanvasItem, type Drawing, type InkCell,
  utf8,
} from "@writemind/core"
import { zipBytes } from "../src/main/zip"

const folder = process.argv[2]
if (!folder) { console.error("usage: vite-node apps/desktop/scripts/quicklook-samples.ts <folder>"); process.exit(2) }
const target = path.resolve(folder)
if (target.startsWith(path.join(os.homedir(), "Documents"))) { console.error("not under ~/Documents: that is where the notes live"); process.exit(2) }
mkdirSync(target, { recursive: true })

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

const stroke = (id: string, colorHex: string, points: [number, number][]): CanvasItem => ({
  kind: "stroke", stroke: { id, colorHex, width: 3, points: points.map(([x, y]) => ({ x, y })), transform: noTransform(), group: null },
})

note("plain.wm", [
  "# A plain note",
  "",
  "A text cell, as typed: *not italic* and line breaks\nkept as they are.",
  "",
  "<!-- markdown -->",
  "A markdown cell with **bold**, _italic_, ~~struck~~, `code` and a [link](https://example.com).",
  "",
  "## Lists",
  "",
  "- a dot",
  "* a dash",
  "1. numbered",
  "- [ ] to do",
  "- [x] done",
  "",
  "> A quote, in italics, with its bar.",
  "",
  "```js",
  "const answer = 42 // a comment",
  "```",
  "",
  "| Column | Right |",
  "|---|--:|",
  "| a | 1 |",
  "| b | 22 |",
  "",
  "---",
  "",
  "###### The author line",
].join("\n"), null)

const CELL = "3f2a9c1e-7b4d-4e8a-9c0f-1a2b3c4d5e6f"
const cell: InkCell = {
  id: CELL, aspect: 0.3,
  items: [
    stroke("c1", "#2D7DD2", [[0.05, 0.05], [0.2, 0.2], [0.35, 0.08], [0.5, 0.25]]),
    { kind: "shape", shape: { id: "c2", kind: "oval", center: { x: 0.75, y: 0.15 }, width: 0.3, aspect: 0.4, colorHex: "#C0392B", lineWidth: 3, fillHex: null, label: "a node", transform: noTransform(), group: null } },
  ],
}
const rich: Drawing = {
  items: [
    stroke("f1", "#C0392B", [[0.62, 0.05], [0.75, 0.02], [0.92, 0.07], [0.95, 0.15]]),
    stroke("f2", "#000000", [[0.55, 0.45], [0.6, 0.5], [0.7, 0.42]]),
    { kind: "shape", shape: { id: "f3", kind: "text", center: { x: 0.8, y: 0.3 }, width: 0.25, aspect: 0.3, colorHex: "#1C1C1E", lineWidth: 2, fillHex: "#FFF3A0", label: "free ink: a text box over the page", transform: noTransform(), group: null } },
    { kind: "image", image: { id: "f4", file: "ink.png", center: { x: 0.85, y: 0.75 }, width: 0.2, aspect: 0.5, transform: noTransform(), hidden: false, group: null } },
    { kind: "cell", cell },
  ],
}
const richText = [
  "# Maths, pictures and drawings",
  "",
  "<!-- markdown -->",
  "Inline maths `wl:x^2 + 1` in a line of words.",
  "",
  "```wl",
  "Integrate[Sin[x]^2, {x, 0, Pi}] == Pi/2",
  "```",
  "",
  "```wl",
  "Sqrt[a^2 + b^2]/(2 c)",
  "```",
  "",
  "A picture cell:",
  "",
  "![the reader's test page](media/page.png)",
  "",
  "A drawing cell:",
  "",
  `![ink](snapshots/ink-${CELL}.svg)`,
  "",
  "```python",
  "print(6 * 7)",
  "```",
  "",
  "```out",
  "42",
  "```",
].join("\n")
const richBytes = note("rich.wm", richText, rich, [
  { name: "media/page.png", data: picture },
  { name: "media/ink.png", data: picture },
  { name: `snapshots/ink-${CELL}.svg`, data: utf8(inkCellSvg(cell, 832, { mediaUrl: (f) => f, metadata: true })) },
])

const big: string[] = ["# A long note", ""]
for (let i = 1; i <= 6000; i++) {
  big.push(i % 50 === 0 ? `## Part ${i / 50}` : `Paragraph ${i}: the quick brown fox jumps over the lazy dog, again and again, to make a long note.`, "")
}
note("big.wm", big.join("\n"), { items: [stroke("b1", "#2D7DD2", [[0.1, 0.02], [0.3, 0.04]])] })

note("hostile.wm", [
  "# <script>alert('title')</script>",
  "",
  "<img src=x onerror=alert(1)> and </div></body><script>alert(2)</script>",
  "",
  "<!-- markdown -->",
  "<span style=\"color:red\" onmouseover=\"alert(3)\">a span</span> and [a link](javascript:alert(4)) and ![x](https://example.com/track.png)",
  "",
  "```html",
  "<script>alert(5)</script>",
  "```",
].join("\n"), null)

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
