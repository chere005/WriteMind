import { describe, expect, it } from "vitest"
import { positioned, type Block } from "../src/markdown/parser"
import { noTransform, type CanvasItem, type Drawing, type InkCell } from "../src/drawing/model"
import { drawingMediaFiles } from "../src/drawing/inkCell"
import { blockHtml, PAGE } from "../src/export/blocks"
import { blockMediaFor, columnWidth, noteBlocks, printHtml } from "../src/export/document"
import { inkCellJson, inkCellSvg, readInkSnapshot } from "../src/export/inkSnapshot"

/**
 * Picture and ink cells on paper and in their snapshot (docs\PLAN-docking-ink-cells.md (f), (g)): a picture cell is
 * an `<img>` at the column's width capped at its own, a missing one the line-tall placeholder the screen shows; an
 * ink cell is INLINED from the sidecar at the column's width (never its file); the snapshot `ink-<id>.svg` is the same
 * vector writer with the cell's JSON in its metadata.
 */

const ID = "3f2a9c1e-7b4d-4e8a-9c0f-1a2b3c4d5e6f"
const OTHER = "0a0b0c0d-1111-4222-8333-444455556666"
const pane = { width: 900, height: 600 }

const stroke = (id: string, points: { x: number; y: number }[]): CanvasItem => ({
  kind: "stroke", stroke: { id, colorHex: "#2D7DD2", width: 3, points, transform: noTransform(), group: null },
})
const cell: InkCell = {
  id: ID, aspect: 0.25,
  items: [stroke("s", [{ x: 0.1, y: 0.1 }, { x: 0.5, y: 0.2 }]), {
    kind: "image", image: { id: "p", file: "bb.png", center: { x: 0.7, y: 0.1 }, width: 0.1, aspect: 1, transform: noTransform(), hidden: false, group: null },
  }],
}
const drawing: Drawing = { items: [stroke("floating", [{ x: 0.1, y: 0.9 }, { x: 0.2, y: 0.95 }]), { kind: "cell", cell }] }
const present = new Set(["aa.jpg", "bb.png", `ink-${OTHER}.svg`])
const media = blockMediaFor(drawing, pane, (file) => present.has(file) ? `wm-print://${file}` : null)
const block = (line: string): Block => positioned(line)[0]!.block

describe("a picture cell on paper", () => {
  it("is the picture at the column's width capped at its own", () => {
    const html = blockHtml(block("![a cat](.drawings/media/aa.jpg)"), undefined, media)
    expect(html).toContain(`<img src="wm-print://aa.jpg" alt="a cat"`)
    expect(html).toMatch(/^<div class="pic"/)
  })

  it("is one line tall with its alt words (or file name) when the file is not there", () => {
    expect(blockHtml(block("![lost](.drawings/media/gone.jpg)"), undefined, media)).toBe(`<div class="pic missing">lost</div>`)
    expect(blockHtml(block("![](.drawings/media/gone.jpg)"), undefined, media)).toBe(`<div class="pic missing">gone.jpg</div>`)
    // Without media (an older caller) every picture cell is its placeholder.
    expect(blockHtml(block("![](.drawings/media/aa.jpg)"))).toBe(`<div class="pic missing">aa.jpg</div>`)
  })

  it("loads a picture from the web as it is, and has no file for one anywhere else", () => {
    expect(blockHtml(block("![](https://example.com/cat.png)"), undefined, media)).toContain(`src="https://example.com/cat.png"`)
    expect(blockHtml(block("![](pictures/cat.png)"), undefined, media)).toBe(`<div class="pic missing">pictures/cat.png</div>`)
  })
})

describe("an ink cell on paper", () => {
  const column = columnWidth(pane)

  it("is inlined from the sidecar at the column's width, as tall as its aspect", () => {
    const html = blockHtml(block(`![ink](.drawings/media/ink-${ID}.svg)`), undefined, media)
    expect(html).toMatch(/^<div class="pic ink"><svg /)
    expect(html).toContain(`width="${column}" height="${column * 0.25}" viewBox="0 0 ${column} ${column * 0.25}"`)
    // The stroke in the column's px (0.1 of the width across AND down), and the picture inside from its URL.
    expect(html).toContain(`M${Math.round(0.1 * column * 100) / 100} ${Math.round(0.1 * column * 100) / 100}`)
    expect(html).toContain(`href="wm-print://bb.png"`)
    expect(html).not.toContain("<metadata")
  })

  it("is drawn from its snapshot file when this note's sidecar has no such cell (read-only, like a picture)", () => {
    const html = blockHtml(block(`![ink](.drawings/media/ink-${OTHER}.svg)`), undefined, media)
    expect(html).toContain(`<img src="wm-print://ink-${OTHER}.svg"`)
  })

  it("goes through noteBlocks and printHtml, and the cell is not printed again as a floating object", () => {
    const markdown = `# Title\n\n![ink](.drawings/media/ink-${ID}.svg)\n\nwords`
    const blocks = noteBlocks(markdown, undefined, media)
    expect(blocks[1]!.html).toContain("<svg")
    const printed = printHtml({ markdown, drawing, pane, media, mediaUrl: (f) => f }, [30, column * 0.25, PAGE.line])
    expect(printed.html.match(/class="wm-ink-cell"/g)?.length).toBe(1)
    // Two pieces of ink on paper would be two svgs of class "ink": the floating stroke only.
    expect(printed.html.match(/<svg class="ink"/g)?.length).toBe(1)
  })
})

describe("the snapshot ink-<id>.svg", () => {
  it("carries the cell's size, its ink, and the cell itself in its metadata", () => {
    const svg = inkCellSvg(cell, 720, { mediaUrl: (file) => file, metadata: true })
    expect(svg).toMatch(/^<svg xmlns="http:\/\/www\.w3\.org\/2000\/svg"/)
    expect(svg).toContain(`width="720" height="180" viewBox="0 0 720 180"`)
    expect(svg).toContain(`<metadata id="writemind-ink">`)
    expect(svg).toContain(`href="bb.png"`)
    expect(readInkSnapshot(svg)).toEqual(cell)
  })

  it("reads back words that XML minds, and is null for an svg that carries no cell", () => {
    const worded: InkCell = { ...cell, items: [...cell.items, {
      kind: "shape", shape: { id: "t", kind: "text", center: { x: 0.5, y: 0.1 }, width: 0.3, aspect: 0.2, colorHex: "#000000",
        lineWidth: 1, fillHex: null, label: "a < b & \"c\" > d", transform: noTransform(), group: null },
    }] }
    const svg = inkCellSvg(worded, 500, { mediaUrl: (f) => f, metadata: true })
    expect(svg).not.toContain("a < b")
    expect(readInkSnapshot(svg)).toEqual(worded)
    expect(readInkSnapshot(`<svg xmlns="http://www.w3.org/2000/svg"></svg>`)).toBeNull()
    expect(readInkSnapshot(`<svg><metadata id="writemind-ink">not json</metadata></svg>`)).toBeNull()
    expect(JSON.parse(inkCellJson(cell))).toMatchObject({ kind: "cell", id: ID, aspect: 0.25 })
  })

  it("is an empty svg of its size for an empty cell", () => {
    const svg = inkCellSvg({ id: ID, aspect: 0.5, items: [] }, 400, { mediaUrl: (f) => f })
    expect(svg).toContain(`width="400" height="200"`)
    expect(svg).toMatch(/style="display:block;overflow:hidden"><\/svg>$/)
  })

  it("is among the media the drawing needs kept", () => {
    expect(drawingMediaFiles(drawing)).toEqual([`ink-${ID}.svg`, "bb.png"])
  })
})
