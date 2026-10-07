/**
 * Writes the sidecar and the picture the Wolfram export's check reads (`test/fixtures/wolfram/`, port-only: docs/PARITY.md):
 *
 *   node node_modules/vite-node/vite-node.mjs apps/desktop/scripts/make-wolfram-fixture.ts
 *
 * Two drawing cells (the first with coloured pen strokes whose widths follow a pressure, two nodes, an arrow between
 * them and a turned text box of α, curly quotes and 中文; the second with two waves and a star) and a floating layer
 * (a red line and a text box). An ink cell's items are in fractions of the cell's WIDTH on both axes, so a cell of
 * aspect 0.55 has y from 0 to 0.55. The fixture is committed: this is only how it was made, so it can be made again.
 */

import { mkdirSync, writeFileSync } from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { deflateSync } from "node:zlib"
import { noTransform, writeDrawing, type CanvasItem, type Drawing, type Point } from "@writemind/core"

const OUT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../test/fixtures/wolfram")
mkdirSync(OUT, { recursive: true })

const wave = (x0: number, x1: number, y: number, amp: number, n = 40): Point[] =>
  Array.from({ length: n }, (_v, i) => ({ x: x0 + (x1 - x0) * i / (n - 1), y: y + amp * Math.sin(i / (n - 1) * Math.PI * 4) }))
const pressures = (n: number, lo: number, hi: number): number[] =>
  Array.from({ length: n }, (_v, i) => lo + (hi - lo) * Math.sin(i / (n - 1) * Math.PI))
const stroke = (id: string, colorHex: string, width: number, points: Point[], pressure = true): CanvasItem => ({
  kind: "stroke",
  stroke: { id, colorHex, width, points, ...(pressure ? { pressures: pressures(points.length, 0.15, 1) } : {}), transform: noTransform(), group: null },
})
const shape = (id: string, kind: "roundedRectangle" | "oval" | "text" | "star", cx: number, cy: number, w: number, aspect: number,
  colorHex: string, label: string, rotation = 0, fillHex: string | null = null): CanvasItem => ({
  kind: "shape",
  shape: { id, kind, center: { x: cx, y: cy }, width: w, aspect, colorHex, lineWidth: 2, fillHex, label, transform: { ...noTransform(), rotation }, group: null },
})

const CELL1 = "3f2a9c1e-7b4d-4e8a-9c0f-1a2b3c4d5e6f"
const CELL2 = "0a0b0c0d-1111-4222-8333-444455556666"

const cell1: CanvasItem[] = [
  // Colours dark enough for white paper (a light colour is swapped for black, as in the PDF: `readableInk`).
  stroke("s1", "#2D7DD2", 4, wave(0.03, 0.6, 0.1, 0.05)),
  stroke("s2", "#C0392B", 5, wave(0.06, 0.5, 0.22, 0.03, 30)),
  stroke("s3", "#1E8449", 3, [{ x: 0.08, y: 0.3 }, { x: 0.16, y: 0.35 }, { x: 0.24, y: 0.29 }, { x: 0.32, y: 0.35 }, { x: 0.4, y: 0.3 }, { x: 0.48, y: 0.35 }]),
  stroke("s4", "#B9770E", 8, wave(0.62, 0.95, 0.08, 0.025, 24)),
  shape("n1", "roundedRectangle", 0.14, 0.46, 0.2, 0.25, "#2D7DD2", "Start \u{1F600}"),
  shape("n2", "oval", 0.5, 0.46, 0.2, 0.25, "#8E44AD", "End", 0, "#F4ECF7"),
  {
    kind: "connector",
    connector: {
      id: "c1", start: { x: 0.24, y: 0.46 }, end: { x: 0.4, y: 0.46 }, startNode: "n1", endNode: "n2", startHead: "none", endHead: "arrow",
      line: "solid", colorHex: "#444444", lineWidth: 2, transform: noTransform(), bends: [],
    },
  },
  shape("t1", "text", 0.8, 0.34, 0.3, 0.3, "#1C1C1E", "α β 中文 “curly” and a longer line\u000Bthat has to wrap round", -0.25),
]
const cell2: CanvasItem[] = [
  stroke("q1", "#2D7DD2", 4, wave(0.05, 0.9, 0.08, 0.05, 50)),
  stroke("q2", "#C0392B", 4, wave(0.05, 0.9, 0.21, 0.05, 50)),
  shape("q3", "star", 0.5, 0.15, 0.1, 1, "#B7950B", ""),
]

const drawing: Drawing = {
  items: [
    { kind: "cell", cell: { id: CELL1, aspect: 0.55, items: cell1 } },
    { kind: "cell", cell: { id: CELL2, aspect: 0.3, items: cell2 } },
    // The floating layer: a red underline across the page, and a text box with words, as the pane places them.
    stroke("f1", "#C0392B", 4, [{ x: 0.12, y: 0.3 }, { x: 0.3, y: 0.31 }, { x: 0.5, y: 0.295 }, { x: 0.7, y: 0.305 }]),
    shape("f2", "text", 0.55, 0.36, 0.3, 0.15, "#1C1C1E", "a floating note α 中文"),
  ],
}
writeFileSync(path.join(OUT, "sidecar.json"), writeDrawing(drawing))

// A 48 x 32 gradient PNG for the picture cell.
const w = 48, h = 32
const raw = Buffer.alloc((w * 4 + 1) * h)
for (let y = 0; y < h; y++) {
  for (let x = 0; x < w; x++) {
    const o = y * (w * 4 + 1) + 1 + x * 4
    raw[o] = Math.round(255 * x / (w - 1)); raw[o + 1] = Math.round(255 * y / (h - 1)); raw[o + 2] = 160; raw[o + 3] = 255
  }
}
const table = Array.from({ length: 256 }, (_v, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0 })
const crc = (buf: Buffer) => { let c = 0xffffffff; for (const b of buf) c = table[(c ^ b) & 255]! ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0 }
const chunk = (type: string, data: Buffer) => {
  const body = Buffer.concat([Buffer.from(type), data])
  const length = Buffer.alloc(4); length.writeUInt32BE(data.length)
  const sum = Buffer.alloc(4); sum.writeUInt32BE(crc(body))
  return Buffer.concat([length, body, sum])
}
const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 6
writeFileSync(path.join(OUT, "pic.png"), Buffer.concat([
  Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk("IHDR", ihdr), chunk("IDAT", deflateSync(raw)), chunk("IEND", Buffer.alloc(0)),
]))
console.log(`fixture written to ${OUT}`)
