import { describe, expect, it } from "vitest"
import { readDrawing, type CanvasItem, type Drawing } from "../src/drawing/model"
import { SHAPE_KINDS } from "../src/drawing/shapes"
import { blockMediaFor, printHtml } from "../src/export/document"
import { INK_HEX, inkPieces, itemHtml, itemSvg, paintHex } from "../src/export/drawing"
import { inkCellSvg } from "../src/export/inkSnapshot"
import { renderQuickLook } from "../src/export/quickLook"
import { positioned } from "../src/markdown/parser"
import { RENDERER_ELEMENTS, tagsOf, unsafeParts, type SafePage } from "./htmlTags"

/**
 * A drawing.json somebody crafted, painted by every writer the drawing has (export/drawing.ts and inkSnapshot.ts: the
 * Quick Look preview, the PDF, an ink cell's snapshot file, the Wolfram export's SVG words). Port-only — the Swift app
 * paints its drawing with Core Graphics and writes no markup — so there is no XCTest file this was transcribed from.
 *
 * Found by the review of the Quick Look preview (2026-10-17): a text box whose `fillHex` was
 * `"><svg><image href="x" onerror="fetch(…)"/></svg><x y="` ENDED the attribute it was written into, and the preview
 * ran the script and fetched from the network — Quick Look does not enforce the page's Content-Security-Policy, so
 * nothing but the writing itself stands between a note from somebody else and script. Each check reads the output
 * the way a browser's tokenizer does (htmlTags.ts), so an attribute that was cut short shows up as what it became.
 */

const CELL = "3f2a9c1e-7b4d-4e8a-9c0f-1a2b3c4d5e6f"
const MANIFEST = JSON.stringify({ format: "writemind-note", version: 1, id: "0b6f5c1e-8d4a-5c0e-9a77-2f1d3b6a9e10" })

/** Values that try to end an attribute, a style declaration or an element, or to be a URL that runs. */
const HOSTILE = [
  `"><svg><image href="x" onerror="fetch('http://127.0.0.1:47123/ran')"/></svg><x y="`,
  `#FFF3A0"><img src="http://127.0.0.1:47123/img.png" onerror="alert(1)"><x y="`,
  `#fff" onmouseover="alert(2)`,
  `'><script>alert(3)</script>`,
  `red;background-image:url(http://127.0.0.1:47123/bg.png)`,
  `#000;background:url(//127.0.0.1:47123/css)`,
  `</div><script>alert(4)</script><div>`,
  `</foreignObject><script>alert(5)</script>`,
  `javascript:alert(6)`,
  `expression(alert(7))`,
  `&quot; onload=&quot;alert(8)`,
  `#12345g`,
  `<`,
  `"`,
]

const transform = { dx: 0, dy: 0, scale: 1, rotation: 0 }

/** Every kind of object, with `value` in every string it has: what a crafted sidecar can say. */
function items(value: string): Record<string, unknown>[] {
  const shapes = SHAPE_KINDS.flatMap((shapeKind, index) => [
    // A node with words and a fill, a text box with a fill and none, and one with only the fill.
    { kind: "shape", id: value, shapeKind, center: { x: 0.2 + (index % 5) * 0.15, y: 0.2 + Math.floor(index / 5) * 0.2 }, width: 0.12, aspect: 0.5, colorHex: value, lineWidth: 2, fillHex: value, label: value, transform, group: value },
    { kind: "shape", id: "n", shapeKind, center: { x: 0.5, y: 0.5 }, width: 0.12, aspect: 0.5, colorHex: "#2D7DD2", lineWidth: 2, fillHex: value, label: "", transform },
    { kind: "shape", id: "c", shapeKind, center: { x: 0.5, y: 0.5 }, width: 0.12, aspect: 0.5, colorHex: value, lineWidth: 2, fillHex: null, label: "words", transform },
  ])
  return [
    { kind: "stroke", id: value, colorHex: value, width: 3, points: [{ x: 0.1, y: 0.1 }, { x: 0.3, y: 0.2 }, { x: 0.4, y: 0.1 }], transform, group: value },
    { kind: "stroke", id: "p", colorHex: value, width: 3, points: [{ x: 0.1, y: 0.1 }, { x: 0.3, y: 0.2 }], pressures: [0.2, 0.9], transform },
    { kind: "stroke", id: "d", colorHex: value, width: 3, points: [{ x: 0.1, y: 0.1 }], transform },
    { kind: "shape", id: "t", shapeKind: "text", center: { x: 0.5, y: 0.1 }, width: 0.3, aspect: 0.3, colorHex: value, lineWidth: 1, fillHex: value, label: value, transform },
    ...shapes,
    { kind: "connector", id: value, start: { x: 0.1, y: 0.9 }, end: { x: 0.9, y: 0.95 }, startHead: value, endHead: "arrow", line: value, colorHex: value, lineWidth: 2, transform },
    { kind: "connector", id: "k", start: { x: 0.1, y: 0.9 }, end: { x: 0.9, y: 0.95 }, startHead: "arrow", endHead: "arrow", line: "dashed", colorHex: value, lineWidth: 2, transform },
    { kind: "image", id: value, file: value, center: { x: 0.5, y: 0.5 }, width: 0.2, aspect: 1, transform, group: value },
    { kind: "image", id: "i", file: "pic.png", center: { x: 0.5, y: 0.5 }, width: 0.2, aspect: 1, transform },
  ]
}

/** The sidecar a crafted note carries: the objects loose on the page, and the same objects in a drawing cell. */
const sidecar = (value: string, cellId = CELL): string =>
  JSON.stringify({ items: [...items(value), { kind: "cell", id: cellId, aspect: 0.4, items: items(value) }] })

const QUICK_LOOK: SafePage = {
  elements: RENDERER_ELEMENTS,
  pictures: /^(cid:|data:image\/)/,
  links: /^(https?:|mailto:|(?![a-z][a-z0-9+.-]*:))/,
}
/** The other writers are handed the test's own picture URLs: `media/<file>`, or nothing. */
const PAPER: SafePage = { ...QUICK_LOOK, pictures: /^(media\/|cid:|data:image\/|$)/ }

describe("a colour from the drawing (paintHex)", () => {
  it("is written only when it is a colour, and always as #-hex", () => {
    expect(paintHex("#2D7DD2")).toBe("#2D7DD2")
    expect(paintHex("#fff")).toBe("#fff")
    expect(paintHex("#FFF3A0CC")).toBe("#FFF3A0CC")
    // (`rgbFromHex` reads a colour without its #, and so does the canvas's reader: written, it gets one.)
    expect(paintHex(" 1C1C1E ")).toBe("#1C1C1E")
    for (const value of HOSTILE) expect(paintHex(value)).toBeNull()
    expect(paintHex("red")).toBeNull()
    expect(paintHex("")).toBeNull()
    expect(paintHex(null)).toBeNull()
    expect(paintHex(undefined)).toBeNull()
  })

  it("leaves an object that has no readable colour drawn in the default ink, and a fill that is not one off", () => {
    const drawing = readDrawing(JSON.stringify({ items: [
      { kind: "stroke", id: "s", colorHex: HOSTILE[0], width: 3, points: [{ x: 0.1, y: 0.1 }, { x: 0.3, y: 0.2 }, { x: 0.4, y: 0.1 }], transform },
      { kind: "shape", id: "t", shapeKind: "text", center: { x: 0.5, y: 0.5 }, width: 0.3, aspect: 0.3, colorHex: "#2D7DD2", lineWidth: 1, fillHex: HOSTILE[1], label: "words", transform },
      { kind: "shape", id: "e", shapeKind: "text", center: { x: 0.5, y: 0.5 }, width: 0.3, aspect: 0.3, colorHex: "#2D7DD2", lineWidth: 1, fillHex: HOSTILE[0], label: "", transform },
    ] }))
    const size = { width: 900, height: 600 }
    const [stroke, box, empty] = drawing.items.map((item) => itemHtml(item, size, { mediaUrl: (file) => file }))
    expect(stroke).toContain(`stroke="${INK_HEX}"`)
    expect(box).not.toContain("background:")
    expect(box).toContain("color:#2D7DD2")
    // An empty text box with no fill it can paint is nothing at all, as an empty one with none.
    expect(empty).toBe("")
  })
})

describe("a crafted drawing, painted by every writer the drawing has", () => {
  const size = { width: 900, height: 600 }
  const words = (text: string) => text.split("\n")

  for (const value of HOSTILE) {
    it(`runs nothing and loads nothing: ${JSON.stringify(value).slice(0, 60)}`, () => {
      const drawing: Drawing = readDrawing(sidecar(value))
      const loose = drawing.items.filter((item) => item.kind !== "cell")
      const cell = drawing.items.find((item): item is Extract<CanvasItem, { kind: "cell" }> => item.kind === "cell")!.cell
      expect(loose.length).toBeGreaterThan(20)
      const media = (file: string) => `media/${file}`

      // Quick Look: the free ink over the page, and the same objects as a drawing cell the note shows.
      const preview = renderQuickLook({
        text: `# A note\n\n![ink](snapshots/ink-${CELL}.svg)\n\nWords.`,
        drawing: sidecar(value),
        manifest: MANIFEST,
        names: ["mimetype", "manifest.json", "note.mdwm", "drawing.json", "media/pic.png", `snapshots/ink-${CELL}.svg`],
      })
      expect(preview.message).toBe(false)
      expect(preview.html).toContain('<div class="free-ink">')
      expect(preview.html).toContain('class="wm-ink-cell"')
      expect(unsafeParts(preview.html, QUICK_LOOK)).toEqual([])
      // The page's own head and nothing else: one style sheet, three meta elements.
      const tags = tagsOf(preview.html)
      expect(tags.filter((tag) => tag.name === "style")).toHaveLength(1)
      expect(tags.filter((tag) => tag.name === "meta")).toHaveLength(3)
      expect(tags.filter((tag) => tag.name === "html" || tag.name === "body")).toHaveLength(2)

      // The PDF: the same cells and ink, through printHtml.
      const markdown = `# A note\n\n![ink](snapshots/ink-${CELL}.svg)`
      const pdf = printHtml({
        markdown, drawing, pane: size, mediaUrl: media,
        media: blockMediaFor(drawing, size, (file) => media(file)),
      }, positioned(markdown).map(() => 40)).html
      expect(unsafeParts(pdf, PAPER)).toEqual([])
      expect(tagsOf(pdf).filter((tag) => tag.name === "style")).toHaveLength(1)

      // One object at a time, as HTML and as SVG elements (with the Wolfram export's words as SVG text, too).
      for (const item of loose) {
        expect(unsafeParts(itemHtml(item, size, { mediaUrl: media }), PAPER)).toEqual([])
        expect(unsafeParts(itemSvg(item, size, { mediaUrl: media }), PAPER)).toEqual([])
        expect(unsafeParts(itemSvg(item, size, { mediaUrl: media, words }), PAPER)).toEqual([])
      }
      expect(unsafeParts(inkPieces(drawing, size, { mediaUrl: media, paper: value }).map((piece) => piece.html).join(""), PAPER)).toEqual([])

      // An ink cell's snapshot file, its id and its background included.
      const snapshot = inkCellSvg({ ...cell, id: value }, 832, { mediaUrl: media, metadata: true, background: value, words })
      expect(unsafeParts(snapshot, PAPER)).toEqual([])
      expect(tagsOf(snapshot)[0]!.attributes.find((one) => one.name === "data-ink-cell")?.value).toBe(value)
    })
  }

  it("still paints a drawing whose colours are colours, as before", () => {
    const drawing = readDrawing(sidecar("#C0392B"))
    const html = inkPieces(drawing, size, { mediaUrl: (file) => `media/${file}` }).map((piece) => piece.html).join("")
    expect(html).toContain('stroke="#C0392B"')
    expect(html).toContain('fill="#C0392B"')
    expect(html).toContain("background:#C0392B")
    expect(unsafeParts(html, PAPER)).toEqual([])
  })
})
