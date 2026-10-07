// Port-only: no XCTest. The drawings as the SVGs the Wolfram Engine imports as Images (src/export/wolfram/svg.ts, and
// the three options it adds to inkSnapshot.ts / drawing.ts): on white, shown at their screen width, words as SVG text.
import { describe, expect, it } from "vitest"
import { noTransform, type CanvasItem, type Drawing, type InkCell } from "../src/drawing/model"
import { inkCellSvg } from "../src/export/inkSnapshot"
import {
  floatingBands, inlineSvgPictures, MAX_SHOWN, pictureSvg, svgPictures, wolframInkSvg,
} from "../src/export/wolfram/svg"

const ID = "3f2a9c1e-7b4d-4e8a-9c0f-1a2b3c4d5e6f"
const t = (rotation = 0) => ({ ...noTransform(), rotation })
const items: CanvasItem[] = [
  { kind: "stroke", stroke: { id: "a", colorHex: "#C0392B", width: 4, points: [{ x: 0.05, y: 0.05 }, { x: 0.2, y: 0.15 }, { x: 0.3, y: 0.1 }], pressures: [0.2, 0.6, 0.9], transform: noTransform(), group: null } },
  { kind: "stroke", stroke: { id: "b", colorHex: "#2D7DD2", width: 3, points: [{ x: 0.4, y: 0.05 }, { x: 0.5, y: 0.2 }, { x: 0.6, y: 0.1 }], transform: noTransform(), group: null } },
  { kind: "shape", shape: { id: "c", kind: "text", center: { x: 0.7, y: 0.1 }, width: 0.35, aspect: 0.3, colorHex: "#1C1C1E", lineWidth: 1, fillHex: "#FFF2A8", label: "Hello wrapped words", transform: t(0.1), group: null } },
  { kind: "shape", shape: { id: "d", kind: "roundedRectangle", center: { x: 0.2, y: 0.35 }, width: 0.25, aspect: 0.4, colorHex: "#2FBF71", lineWidth: 2, fillHex: null, label: "a node", transform: noTransform(), group: null } },
]
const cell: InkCell = { id: ID, aspect: 0.5, items }
/** A breaker that puts each word on a line of its own: what a narrow box does. */
const eachWord = (text: string) => text.split(" ")

// What inkCellSvg wrote for this cell before the Wolfram options existed (generated from 58943d5): the snapshot file
// and the PDF must not move by a byte.
const BEFORE = `<svg xmlns="http://www.w3.org/2000/svg" class="wm-ink-cell" data-ink-cell="${ID}" width="400" height="200" viewBox="0 0 400 200" style="display:block;overflow:hidden"><path d="M20 20L80 60" fill="none" stroke="#C0392B" stroke-linecap="round" stroke-linejoin="round" stroke-width="3.25"/><path d="M80 60L120 40" fill="none" stroke="#C0392B" stroke-linecap="round" stroke-linejoin="round" stroke-width="5.5"/><path d="M160 20Q200 80 220 60L240 40" fill="none" stroke="#2D7DD2" stroke-linecap="round" stroke-linejoin="round" stroke-width="3"/><foreignObject x="210" y="19" width="140" height="42" transform="translate(280 40) rotate(5.73) scale(1) translate(-280 -40)"><div xmlns="http://www.w3.org/1999/xhtml" style="width:100%;height:100%;box-sizing:border-box;border-radius:6px;background:#FFF2A8;padding:8px 10px;font:14px/18px 'Segoe UI', -apple-system, 'Helvetica Neue', Cantarell, 'Noto Sans', Arial, sans-serif;color:#1C1C1E;white-space:pre-wrap;overflow-wrap:break-word;overflow:hidden">Hello wrapped words</div></foreignObject><path d="M122 120L124.07 120.27L126 121.07L127.66 122.34L128.93 124L129.73 125.93L130 128L130 152L129.73 154.07L128.93 156L127.66 157.66L126 158.93L124.07 159.73L122 160L38 160L35.93 159.73L34 158.93L32.34 157.66L31.07 156L30.27 154.07L30 152L30 128L30.27 125.93L31.07 124L32.34 122.34L34 121.07L35.93 120.27L38 120Z" fill="none" stroke="#000000" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/><foreignObject x="30" y="120" width="100" height="40" transform="translate(80 140) rotate(0) scale(1) translate(-80 -140)"><div xmlns="http://www.w3.org/1999/xhtml" style="width:100%;height:100%;box-sizing:border-box;display:flex;align-items:center;justify-content:center;padding:4px 6px;font:13px/16px 'Segoe UI', -apple-system, 'Helvetica Neue', Cantarell, 'Noto Sans', Arial, sans-serif;color:#000000;text-align:center;white-space:pre-wrap;overflow-wrap:break-word">a node</div></foreignObject></svg>`

describe("the drawing cell's svg, with the export's options", () => {
  it("is byte for byte what it was with none of them", () => {
    expect(inkCellSvg(cell, 400, { mediaUrl: (file) => file })).toBe(BEFORE)
  })

  it("puts the background under everything, first", () => {
    const svg = inkCellSvg(cell, 400, { mediaUrl: (file) => file, background: "#FFFFFF" })
    expect(svg).toMatch(/^<svg [^>]*><rect width="100%" height="100%" fill="#FFFFFF"\/><path /)
  })

  it("is shown at `shown` while its viewBox stays the cell's own width", () => {
    const svg = inkCellSvg(cell, 800, { mediaUrl: (file) => file, shown: 640 })
    expect(svg).toContain(`width="640" height="320" viewBox="0 0 800 400"`)
  })

  it("writes the words as SVG text at the canvas's baselines, in the shape's transform, and no foreignObject", () => {
    const svg = inkCellSvg(cell, 400, { mediaUrl: (file) => file, words: eachWord })
    expect(svg).not.toContain("foreignObject")
    // The card first, then its words: x inside the padding (210 + 10); baselines 19 + 8 + 2 + 11.2 = 40.2, then 18 apart.
    // The box is 42 tall, so the third line (baseline 76.2, past 61) is cut, as the box's edge cuts it on screen.
    expect(svg).toContain(`<rect x="210" y="19" width="140" height="42" rx="6" fill="#FFF2A8" transform="translate(280 40) rotate(5.73) scale(1) translate(-280 -40)"/>`)
    expect(svg).toContain(`<text font-family="'Segoe UI', -apple-system, 'Helvetica Neue', Cantarell, 'Noto Sans', Arial, sans-serif" font-size="14" fill="#1C1C1E" transform="translate(280 40) rotate(5.73) scale(1) translate(-280 -40)"><tspan x="220" y="40.2">Hello</tspan><tspan x="220" y="58.2">wrapped</tspan></text>`)
    expect(svg).not.toContain(">words<")
    // A node's label: centred on the box (x 80; its middle 140 + 0.3 × 13), 13 px.
    expect(svg).toContain(`font-size="13" fill="#000000" text-anchor="middle" transform="translate(80 140) rotate(0) scale(1) translate(-80 -140)"><tspan x="80" y="135.9">a</tspan><tspan x="80" y="151.9">node</tspan></text>`)
  })

  it("holds a node's label to six lines", () => {
    const busy: InkCell = { ...cell, items: [{ ...items[3]!, shape: { ...(items[3] as Extract<CanvasItem, { kind: "shape" }>).shape, label: "1 2 3 4 5 6 7 8" } } as CanvasItem] }
    const svg = inkCellSvg(busy, 400, { mediaUrl: (file) => file, words: eachWord })
    expect(svg.match(/<tspan /g)?.length).toBe(6)
    expect(svg).toContain(">6</tspan>")
    expect(svg).not.toContain(">7</tspan>")
  })

  it("is shown at the cell's width up to 640 points, on white, the words as text (wolframInkSvg)", () => {
    expect(MAX_SHOWN).toBe(640)
    const narrow = wolframInkSvg(cell, 400.4, eachWord)
    expect(narrow.shown).toBe(400)
    expect(narrow.svg).toContain(`fill="#FFFFFF"`)
    expect(narrow.svg).toContain("<tspan ")
    const wide = wolframInkSvg(cell, 900)
    expect(wide.shown).toBe(640)
    expect(wide.svg).toContain(`width="640" height="320" viewBox="0 0 900 450"`)
  })

  // The engine's SVG importer sets a whole line in tofu for an astral code point and refuses the whole drawing for a
  // character XML 1.0 has no place for (checked against the engine: apps/desktop/scripts/check-wolfram.ts).
  describe("words the importer can take", () => {
    const labelled = (label: string): InkCell => ({
      ...cell,
      items: [{ ...items[2]!, shape: { ...(items[2] as Extract<CanvasItem, { kind: "shape" }>).shape, label } } as CanvasItem,
        { ...items[3]!, shape: { ...(items[3] as Extract<CanvasItem, { kind: "shape" }>).shape, label } } as CanvasItem],
    })
    const svgOf = (label: string) => inkCellSvg(labelled(label), 400, { mediaUrl: (file) => file, words: (text) => [text] })
    const spoken = (svg: string) => [...svg.matchAll(/<tspan [^>]*>([^<]*)<\/tspan>/g)].map((m) => m[1]!)

    it("sets no code point above U+FFFF: an emoji becomes a box the importer draws, the rest of the line stays", () => {
      const lines = spoken(svgOf("no emoji \u{1F600} hello \u{20000}\u{1D538}"))
      expect(lines).toEqual(["no emoji □ hello □□", "no emoji □ hello □□"])
      for (const line of lines) expect([...line].every((ch) => ch.codePointAt(0)! <= 0xFFFF)).toBe(true)
      // A lone surrogate is no code point at all.
      expect(spoken(svgOf("a\uD83Db"))[0]).toBe("a□b")
    })

    it("sets no character outside XML 1.0's Char: a vertical tab or a form feed reads as a space", () => {
      const lines = spoken(svgOf("soft\u000Bbreak and\u000Cpage\u0001\u0008￾￿"))
      // eslint-disable-next-line no-control-regex
      for (const line of lines) expect(line).not.toMatch(/[\u0000-\u0008\u000B\u000C\u000E-\u001F￾￿]/)
      expect(lines[0]).toBe("soft break and page    ")
    })

    it("leaves what the importer reads alone: accents, CJK, curly quotes, a tab", () => {
      expect(spoken(svgOf("café 中文 “q”\tz"))[0]).toBe("café 中文 “q”\tz")
    })
  })
})

describe("floatingBands", () => {
  const pane = { width: 1000, height: 1000 }
  /** A short horizontal stroke at document y (px), 2 px wide: its box is y - 1 … y + 1. */
  const line = (id: string, y: number, extra: Partial<Extract<CanvasItem, { kind: "stroke" }>["stroke"]> = {}): CanvasItem => ({
    kind: "stroke", stroke: { id, colorHex: "#1C1C1E", width: 2, points: [{ x: 0.1, y: y / 1000 }, { x: 0.3, y: y / 1000 }], transform: noTransform(), group: null, ...extra },
  })
  const cells = [{ top: 16, offset: 0 }, { top: 100, offset: 20 }, { top: 300, offset: 60 }]

  it("makes one band of objects 10 px apart and two of objects 40 px apart", () => {
    expect(floatingBands({ items: [line("a", 200), line("b", 212)] }, pane, cells)).toHaveLength(1)
    expect(floatingBands({ items: [line("a", 200), line("b", 242)] }, pane, cells)).toHaveLength(2)
  })

  it("is the strip of the page round its objects, with 8 px of air, shown at its own width", () => {
    const [band] = floatingBands({ items: [line("a", 200)] }, pane, cells)
    // The stroke's box is x 99…301, y 199…201; the band 8 px wider each way.
    expect(band!.svg).toMatch(/^<svg xmlns="http:\/\/www.w3.org\/2000\/svg" width="218" height="18" viewBox="91 191 218 18"><rect x="91" y="191" width="218" height="18" fill="#FFFFFF"\/><path /)
    expect(band!.shown).toBe(218)
  })

  it("goes after the last cell that starts above its middle, and before every cell when it is above them all", () => {
    expect(floatingBands({ items: [line("a", 200)] }, pane, cells)[0]!.after).toBe(20)
    expect(floatingBands({ items: [line("a", 320)] }, pane, cells)[0]!.after).toBe(60)
    expect(floatingBands({ items: [line("a", 9)] }, pane, cells)[0]!.after).toBeNull()
  })

  it("never starts above or left of the page", () => {
    const base = line("a", 3) as Extract<CanvasItem, { kind: "stroke" }>
    const near: CanvasItem = { kind: "stroke", stroke: { ...base.stroke, points: [{ x: 0.001, y: 0.003 }, { x: 0.2, y: 0.003 }] } }
    const [band] = floatingBands({ items: [near] }, pane, cells)
    expect(band!.svg).toMatch(/viewBox="0 0 /)
  })

  it("leaves out a picture put away and the drawing's ink cells", () => {
    const drawing: Drawing = {
      items: [
        { kind: "image", image: { id: "p", file: "x.png", center: { x: 0.5, y: 0.5 }, width: 0.2, aspect: 1, transform: noTransform(), hidden: true, group: null } },
        { kind: "cell", cell },
      ],
    }
    expect(floatingBands(drawing, pane, cells)).toEqual([])
  })
})

describe("pictures inside a drawing", () => {
  const svg = `<svg><image href="cat &amp; dog.png" x="0" y="0" width="120" height="80"/><image href="cat &amp; dog.png" x="0" y="0" width="300" height="80"/>`
    + `<image href="gone.png" x="1" y="1" width="10" height="10"/><image href="data:image/png;base64,AA==" width="5"/></svg>`

  it("names each linked picture once, with the widest it is drawn at, and not the inlined ones", () => {
    expect(svgPictures(svg)).toEqual([{ name: "cat & dog.png", width: 300 }, { name: "gone.png", width: 10 }])
  })

  it("puts each one inside as a data URL, attribute-escaped, and drops the ones that are not there", () => {
    const out = inlineSvgPictures(svg, (name) => (name === "gone.png" ? null : `data:image/png;base64,QUJD"<&`))
    expect(out).not.toContain("gone.png")
    expect(out.match(/href="data:image\/png;base64,QUJD&quot;&lt;&amp;"/g)?.length).toBe(2)
    expect(out).toContain(`<image href="data:image/png;base64,AA==" width="5"/>`)
  })

  it("wraps a converted PDF capture in an svg of its own on white, shown at `shown`", () => {
    const wrapped = pictureSvg("data:image/svg+xml;base64,QQ==", 300, 150, 200)
    expect(wrapped).toBe(`<svg xmlns="http://www.w3.org/2000/svg" width="200" height="100" viewBox="0 0 300 150">`
      + `<rect width="100%" height="100%" fill="#FFFFFF"/><image href="data:image/svg+xml;base64,QQ==" x="0" y="0" width="300" height="150" preserveAspectRatio="none"/></svg>`)
    expect(pictureSvg("data:x", 2000, 1000, 1000)).toContain(`width="640" height="320"`)
  })
})
