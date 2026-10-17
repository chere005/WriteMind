import { describe, expect, it } from "vitest"
import { noTransform, writeDrawing, type CanvasItem, type Drawing, type InkCell } from "../src/drawing/model"
import { itemHtml } from "../src/export/drawing"
import { blockHtml } from "../src/export/blocks"
import { positioned } from "../src/markdown/parser"
import {
  DARK_PAPER_HEX, PREVIEW_CSP, PREVIEW_LIMITS, PREVIEW_PANE, previewManifestRefusal, previewMessageHtml, previewNamesRefusal,
  previewText, renderQuickLook, type QuickLookInput,
} from "../src/export/quickLook"

/**
 * The Quick Look preview's page (export/quickLook.ts). Port-only: the Swift app has no preview extension, so there is
 * no XCTest file this was transcribed from. The page is the PDF's renderer laid out in flow; these check what the
 * preview adds — the cid: pictures, the cuts, the two appearances, the refusals — and that no script can run in it.
 */

const MANIFEST = JSON.stringify({ format: "writemind-note", version: 1, id: "0b6f5c1e-8d4a-5c0e-9a77-2f1d3b6a9e10" })
const NAMES = ["mimetype", "manifest.json", "note.mdwm"]
const page = (text: string, more: Partial<QuickLookInput> = {}) =>
  renderQuickLook({ text, drawing: null, manifest: MANIFEST, names: NAMES, ...more })
/** The light sheet alone (the page is written twice, light and dark). */
const light = (html: string): string => html.slice(html.indexOf('<div class="sheet light">'), html.indexOf('<div class="sheet dark">'))
const dark = (html: string): string => html.slice(html.indexOf('<div class="sheet dark">'))

const CELL = "3f2a9c1e-7b4d-4e8a-9c0f-1a2b3c4d5e6f"
const stroke = (id: string, colorHex: string, points: [number, number][]): CanvasItem => ({
  kind: "stroke", stroke: { id, colorHex, width: 3, points: points.map(([x, y]) => ({ x, y })), transform: noTransform(), group: null },
})

describe("the preview's page", () => {
  it("is one complete document with a policy that lets no script run and nothing load but the note's own pictures", () => {
    const out = page("# Title\n\nWords.")
    expect(out.message).toBe(false)
    expect(out.html).toMatch(/^<!doctype html><html><head><meta charset="utf-8">/)
    expect(out.html).toContain(`<meta http-equiv="Content-Security-Policy" content="${PREVIEW_CSP}">`)
    expect(PREVIEW_CSP).toContain("default-src 'none'")
    expect(PREVIEW_CSP).toContain("img-src cid: data:")
    expect(PREVIEW_CSP).not.toMatch(/script-src|unsafe-eval|https?:/)
    expect(out.html.endsWith("</body></html>")).toBe(true)
  })

  it("draws headings on the Mac's ladder, in both appearances", () => {
    const out = page("# Title\n\n## Header\n\nWords.")
    expect(light(out.html)).toContain('<div class="heading" style="font-size:28px;font-weight:700;')
    expect(light(out.html)).toContain(">Title</div>")
    expect(light(out.html)).toContain('font-size:22px;font-weight:600;')
    expect(dark(out.html)).toContain(">Title</div>")
    // The dark page shows one, the light page the other: the system decides.
    expect(out.html).toContain("@media (prefers-color-scheme: dark)")
    expect(out.html).toMatch(/\.sheet\.dark \{ display: none; \}[\s\S]*prefers-color-scheme: dark[\s\S]*\.sheet\.light \{ display: none; \}/)
  })

  it("sets a maths cell as MathML, which WebKit draws", () => {
    const out = page("```wl\nSqrt[a^2 + b^2]/(2 c)\n```")
    expect(light(out.html)).toContain('<div class="wm-math-block"><span class="wm-math"><math display="block">')
    expect(light(out.html)).toContain("<msqrt>")
  })

  it("draws every kind of list, a mixed one and to-dos included", () => {
    const out = page("- a dot\n* a dash\n1. one\n- [ ] to do\n- [x] done")
    const html = light(out.html)
    expect(html).toContain('<div class="list">')
    expect(html).toContain(">•</span><span class=\"text\">a dot</span>")
    expect(html).toContain(">–</span><span class=\"text\">a dash</span>")
    expect(html).toContain(">1.</span><span class=\"text\">one</span>")
    expect(html).toContain('<span class="box"><svg')
    expect(html).toMatch(/text-decoration:line-through[^>]*>done<\/span>/)
  })

  it("shows a picture in the note as an attachment, cid:, once however many times the page asks for it", () => {
    const out = page("![a cat](media/cat.png)\n\n![the cat again](media/cat.png)", { names: [...NAMES, "media/cat.png"] })
    expect(out.attachments).toEqual([{ cid: "wm0", entry: "media/cat.png" }])
    expect(light(out.html)).toContain('<img src="cid:wm0" alt="a cat"')
    expect(dark(out.html)).toContain('<img src="cid:wm0" alt="a cat"')
  })

  it("draws a picture that is not in the file as its placeholder line, and asks for no attachment", () => {
    const out = page("![a dog](media/dog.png)")
    expect(out.attachments).toEqual([])
    expect(light(out.html)).toContain('<div class="pic missing">a dog</div>')
  })

  it("loads nothing from the web: a picture there is its placeholder too", () => {
    const out = page("![tracker](https://example.com/pixel.png)")
    expect(out.html).not.toContain("example.com/pixel.png\"")
    expect(out.html).not.toContain("<img")
    expect(light(out.html)).toContain('<div class="pic missing">tracker</div>')
  })

  it("draws a drawing cell from drawing.json at the column's width, in the column", () => {
    const cell: InkCell = { id: CELL, aspect: 0.25, items: [stroke("s", "#2D7DD2", [[0.1, 0.1], [0.5, 0.2]])] }
    const out = page(`Above.\n\n![ink](snapshots/ink-${CELL}.svg)`, { drawing: writeDrawing({ items: [{ kind: "cell", cell }] }) })
    expect(light(out.html)).toContain(`<div class="pic ink"><svg xmlns="http://www.w3.org/2000/svg" class="wm-ink-cell" data-ink-cell="${CELL}" width="832"`)
    // A drawing cell alone is not free ink: the page stays fluid.
    expect(light(out.html)).toContain('<div class="page fluid">')
    expect(out.html).not.toContain('class="free-ink"')
  })

  it("draws a drawing cell that is only its snapshot as that picture", () => {
    const out = page(`![ink](snapshots/ink-${CELL}.svg)`, { names: [...NAMES, `snapshots/ink-${CELL}.svg`] })
    expect(out.attachments).toEqual([{ cid: "wm0", entry: `snapshots/ink-${CELL}.svg` }])
    expect(light(out.html)).toContain('<img src="cid:wm0"')
  })

  it("puts the free ink over the page where it sits, on a fixed page that is zoomed to fit a narrower preview", () => {
    const drawing: Drawing = {
      items: [
        stroke("f", "#000000", [[0.5, 0.5], [0.6, 0.55]]),
        { kind: "image", image: { id: "p", file: "ink.png", center: { x: 0.8, y: 0.2 }, width: 0.1, aspect: 1, transform: noTransform(), hidden: false, group: null } },
        { kind: "image", image: { id: "gone", file: "gone.png", center: { x: 0.2, y: 0.2 }, width: 0.1, aspect: 1, transform: noTransform(), hidden: false, group: null } },
      ],
    }
    const out = page("Words.", { drawing: writeDrawing(drawing), names: [...NAMES, "drawing.json", "media/ink.png"] })
    expect(light(out.html)).toContain('<div class="page fixed" style="min-height:')
    expect(light(out.html)).toContain('<div class="free-ink">')
    // In the pane's own points: (0.5, 0.5) of 900 × 600 is (450, 300).
    expect(light(out.html)).toContain("M450 300")
    expect(PREVIEW_PANE).toEqual({ width: 900, height: 600 })
    // The picture over the page is an attachment; one that is not in the file leaves nothing (as on paper).
    expect(out.attachments).toEqual([{ cid: "wm0", entry: "media/ink.png" }])
    expect(out.html).toContain('<image href="cid:wm0"')
    expect(out.html).not.toContain("gone.png")
    expect(out.html).toContain("@media (max-width: 899.98px) { .fixed { zoom: 0.9722; } }")
    expect(out.html).toContain("@media (max-width: 174.98px) { .fixed { zoom: 0.1667; } }")
  })

  it("reads every pen against its own appearance's page: black ink is light on the dark page", () => {
    const out = page("Words.", { drawing: writeDrawing({ items: [stroke("f", "#000000", [[0.1, 0.1], [0.2, 0.2]])] }) })
    expect(light(out.html)).toContain('stroke="#000000"')
    expect(dark(out.html)).not.toContain('stroke="#000000"')
    expect(DARK_PAPER_HEX).toBe("#1E1F22")
  })

  it("maps the cells' fixed light colours to the app's dark ones, and only the cells'", () => {
    const out = page("## Heading\n\n```js\nconst x = 1\n```")
    expect(out.html).toContain('.dark .heading[style*="color:#1C1C1E"] { color: #E8E8EA !important; }')
    expect(out.html).toContain('.dark .code span[style="color:#AD3DA4"] { color: #FF7AB2 !important; }')
    // Never a rule that would reach a person's own colour (a span, a pen, a text box's words on its card).
    expect(out.html).not.toMatch(/\.dark \[style/)
  })

  it("is a fluid column, with no ladder, when there is no free ink", () => {
    const out = page("Words.")
    expect(light(out.html)).toContain('<div class="page fluid">')
    expect(out.html).not.toContain("zoom:")
  })
})

describe("a long note", () => {
  it("is cut to the first cells, and the page says so at its foot", () => {
    const text = Array.from({ length: PREVIEW_LIMITS.cells + 50 }, (_, i) => `Paragraph ${i + 1}.`).join("\n\n")
    const out = page(text)
    expect(out.cut).toBe(true)
    expect(light(out.html)).toContain("Paragraph 400.")
    expect(light(out.html)).not.toContain("Paragraph 401.")
    expect(out.html).toContain(`<div class="foot">This preview shows the first ${PREVIEW_LIMITS.cells} cells of a long note`)
  })

  it("is parsed only as far as the character limit, cut at a line end", () => {
    const text = "x".repeat(10) + "\n" + "y".repeat(PREVIEW_LIMITS.chars)
    expect(previewText(text)).toEqual({ text: "x".repeat(10), cut: true })
    expect(previewText("short")).toEqual({ text: "short", cut: false })
    const out = page(text, { textBytes: 3 * 1024 * 1024 })
    expect(out.cut).toBe(true)
    expect(out.html).toContain("(3,072 KB)")
  })

  it("leaves a drawing with too many objects off the page and says so", () => {
    const items = Array.from({ length: PREVIEW_LIMITS.inkItems + 1 }, (_, i) => stroke(`s${i}`, "#000000", [[0.1, 0.1], [0.2, 0.2]]))
    const out = page("Words.", { drawing: writeDrawing({ items }) })
    expect(out.html).not.toContain('class="free-ink"')
    expect(out.html).toContain(`The drawing over the page (${(PREVIEW_LIMITS.inkItems + 1).toLocaleString("en-US")} objects) is too large for a preview.`)
  })

  it("says so when the extension could not read the drawing at all", () => {
    const out = page("Words.", { drawingSkipped: true })
    expect(out.html).toContain("The drawing is too large for a preview and is not shown.")
  })
})

describe("hostile words", () => {
  const HOSTILE = [
    "# <script>alert('title')</script>",
    "",
    "<img src=x onerror=alert(1)> and </div></body><script>alert(2)</script>",
    "",
    "<!-- markdown -->",
    "<span style=\"color:red\" onmouseover=\"alert(3)\">a span</span> and [a link](javascript:alert(4)) and <a href=\"x\" onclick=\"y\">z</a>",
    "",
    "```html",
    "<script>alert(5)</script>",
    "```",
    "",
    "| <b onclick=x>h</b> |",
    "|---|",
    "| <svg onload=alert(6)> |",
  ].join("\n")

  it("are words: no element the note did not get from the renderer, no handler, no script, no javascript: link", () => {
    const out = page(HOSTILE, {
      drawing: writeDrawing({
        items: [{ kind: "shape", shape: { id: "t", kind: "text", center: { x: 0.5, y: 0.5 }, width: 0.3, aspect: 0.3, colorHex: "#000000", lineWidth: 1, fillHex: null, label: "<script>alert(7)</script>", transform: noTransform(), group: null } }],
      }),
    })
    expect(out.html).not.toMatch(/<script/i)
    expect(out.html).not.toMatch(/<img src=x/i)
    expect(out.html).not.toMatch(/<svg onload/i)
    // Not one event-handler attribute on any element of the page (the note's own `onerror=` is text: `&lt;img …`).
    expect(out.html).not.toMatch(/<[a-z][^>]*\son[a-z]+\s*=/i)
    expect(out.html).toContain("&lt;img src=x onerror=alert(1)&gt;")
    expect(out.html).not.toMatch(/href="javascript:/i)
    expect(out.html).toContain("&lt;script&gt;alert(5)&lt;/script&gt;")
    expect(out.html).toContain("&lt;script&gt;alert(7)&lt;/script&gt;")
  })

  it("takes out the one handler the PDF's picture writes, so the preview never carries it", () => {
    const pdf = blockHtml(positioned("![a cat](media/cat.png)")[0]!.block, undefined, { url: () => "cid:x", ink: () => null, column: 800 })
    // (If blocks.ts ever writes another handler, the literal in quickLook.ts must follow it: this is where that shows.)
    expect(pdf).toContain(` onerror="var p=this.parentNode;p.className='pic missing';p.textContent=p.getAttribute('data-alt')"`)
    const out = page("![a cat](media/cat.png)", { names: [...NAMES, "media/cat.png"] })
    expect(out.html).not.toContain("onerror")
  })

  it("never throw: a drawing that is not JSON is no drawing, and a note made of junk is a page", () => {
    const out = page("\u0000￿\uD800 ```\n", { drawing: "{not json" })
    expect(out.message).toBe(false)
    expect(out.html).toContain("</body></html>")
  })
})

describe("a note the preview will not show", () => {
  it("is refused by its names before anything is unpacked (SPEC-WM 1.5)", () => {
    expect(previewNamesRefusal([...NAMES, "../evil"])).toBe("This note cannot be shown: “../evil” has a “..” part.")
    expect(previewNamesRefusal([...NAMES, "/etc/passwd"])).toContain("is not a relative name")
    expect(previewNamesRefusal([...NAMES, "note.mdwm"])).toContain("is in the file twice")
    expect(previewNamesRefusal(["manifest.json", "note.mdwm"])).toBe("This is not a WriteMind note (it has no mimetype entry).")
    expect(previewNamesRefusal(["mimetype", "note.mdwm"])).toBe("This note cannot be shown: it has no manifest.json.")
    expect(previewNamesRefusal(NAMES)).toBeNull()
  })

  it("is refused by its manifest: another format, or a newer version (1.7, 1.8)", () => {
    expect(previewManifestRefusal(MANIFEST)).toBeNull()
    expect(previewManifestRefusal(JSON.stringify({ format: "writemind-note", version: 2 })))
      .toBe("A newer WriteMind wrote this note. Open it in WriteMind to see it.")
    expect(previewManifestRefusal(JSON.stringify({ format: "something-else", version: 1 }))).toContain("this is not a WriteMind note")
    expect(previewManifestRefusal("not json")).toBe("This note cannot be shown: manifest.json is not JSON.")
  })

  it("is a plain page that says why, its words escaped", () => {
    const out = page("# Hi", { names: [...NAMES, "../evil"] })
    expect(out.message).toBe(true)
    expect(out.attachments).toEqual([])
    expect(out.html).toContain("“../evil” has a “..” part.")
    expect(previewMessageHtml("<script>x</script>")).toContain("&lt;script&gt;x&lt;/script&gt;")
    expect(previewMessageHtml("x")).toContain(PREVIEW_CSP)
  })
})

describe("a text box on the page", () => {
  it("keeps its whole style: the font's family names cannot end the attribute and drop its colour", () => {
    // Found by the preview (2026-10-17): the font stack's double quotes closed `style="…"` at the first family, and a
    // text box's colour, wrapping and clipping fell off - on the PDF too, where black on white hid it.
    const item: CanvasItem = { kind: "shape", shape: { id: "t", kind: "text", center: { x: 0.5, y: 0.5 }, width: 0.3, aspect: 0.3, colorHex: "#1C1C1E", lineWidth: 1, fillHex: "#FFF3A0", label: "words", transform: noTransform(), group: null } }
    const html = itemHtml(item, { width: 900, height: 600 }, { mediaUrl: (f) => f })
    const style = /style="([^"]*)"/.exec(html)![1]!
    expect(style).toContain("color:#1C1C1E")
    expect(style).toContain("white-space:pre-wrap")
    const node: CanvasItem = { kind: "shape", shape: { ...(item as Extract<CanvasItem, { kind: "shape" }>).shape, kind: "oval", label: "a node" } }
    const label = /<div style="([^"]*)">a node/.exec(itemHtml(node, { width: 900, height: 600 }, { mediaUrl: (f) => f }))
    expect(label?.[1]).toContain("text-align:center")
  })
})
