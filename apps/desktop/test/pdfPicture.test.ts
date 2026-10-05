import { mkdtempSync, writeFileSync } from "node:fs"
import os from "node:os"
import path from "node:path"
import zlib from "node:zlib"
import { describe, expect, it } from "vitest"
import { isPdfPicture, pdfToSvg, readPdfPicture, svgDataUrl } from "../src/main/pdfPicture"

/**
 * A Mac notebook's traced capture is a one-page PDF in `.drawings/media` (InkVector.pdf). On Windows it was a dashed
 * empty box with "could not load the picture TRACE-1.pdf" over the window, and the PDF export printed nothing for it
 * (verifier macpdfpic.mjs). It is now read as the paths it is and drawn as an SVG.
 */

type Part = string | Buffer

/** A PDF with the objects given (1-based), a classic cross-reference table, and `1 0 R` as the catalog. */
function pdf(objects: Part[]): Buffer {
  const chunks: Buffer[] = [Buffer.from("%PDF-1.4\n%\xE2\xE3\xCF\xD3\n", "latin1")]
  const offsets: number[] = []
  let at = chunks[0]!.length
  objects.forEach((body, index) => {
    offsets.push(at)
    const piece = Buffer.concat([Buffer.from(`${index + 1} 0 obj\n`, "latin1"), Buffer.isBuffer(body) ? body : Buffer.from(body, "latin1"), Buffer.from("\nendobj\n", "latin1")])
    chunks.push(piece)
    at += piece.length
  })
  const xref = objects.length + 1
  let table = `xref\n0 ${xref}\n0000000000 65535 f \n`
  for (const offset of offsets) table += `${String(offset).padStart(10, "0")} 00000 n \n`
  table += `trailer\n<< /Size ${xref} /Root 1 0 R >>\nstartxref\n${at}\n%%EOF\n`
  chunks.push(Buffer.from(table, "latin1"))
  return Buffer.concat(chunks)
}

/** The same, with the objects' own numbers (some of a file's objects live inside others). */
function numbered(entries: [number, Part][]): Buffer {
  const chunks: Buffer[] = [Buffer.from("%PDF-1.5\n", "latin1")]
  for (const [n, body] of entries) {
    chunks.push(Buffer.from(`${n} 0 obj\n`, "latin1"), Buffer.isBuffer(body) ? body : Buffer.from(body, "latin1"),
      Buffer.from("\nendobj\n", "latin1"))
  }
  chunks.push(Buffer.from("trailer\n<< /Root 2 0 R >>\n%%EOF\n", "latin1"))
  return Buffer.concat(chunks)
}

const stream = (dict: string, data: Buffer | string): Buffer =>
  Buffer.concat([Buffer.from(`<< ${dict} /Length ${Buffer.byteLength(data as string, "latin1")} >>\nstream\n`, "latin1"),
    Buffer.isBuffer(data) ? data : Buffer.from(data, "latin1"), Buffer.from("\nendstream", "latin1")])

/** The one-page PDF of the verifier's script: a black square and a blue diagonal, 100 x 75. */
const simple = (content: string, box = "[0 0 100 75]"): Buffer => pdf([
  "<< /Type /Catalog /Pages 2 0 R >>",
  "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
  `<< /Type /Page /Parent 2 0 R /MediaBox ${box} /Contents 4 0 R /Resources << >> >>`,
  stream("", content),
])

const svgOf = (bytes: Buffer): string => {
  const picture = pdfToSvg(bytes)
  expect(picture).not.toBeNull()
  return picture!.svg
}

describe("a PDF capture as a picture", () => {
  it("reads the verifier's one-page PDF: a black square and a blue diagonal", () => {
    const picture = pdfToSvg(simple("0 0 0 rg 10 10 30 30 re f 0 0 1 RG 3 w 5 5 m 95 70 l S"))!
    expect(picture.width).toBe(100)
    expect(picture.height).toBe(75)
    expect(picture.svg).toContain('width="100" height="75" viewBox="0 0 100 75"')
    // PDF counts y up: the picture is flipped into SVG's y-down
    expect(picture.svg).toContain('<g transform="matrix(1 0 0 -1 0 75)">')
    expect(picture.svg).toContain('<path d="M10 10L40 10L40 40L10 40Z" fill="#000000"/>')
    expect(picture.svg).toContain('<path d="M5 5L95 70" fill="none" stroke="#0000ff" stroke-width="3"/>')
  })

  it("is what CoreGraphics writes for InkVector: a flip, loops filled even-odd, in a compressed stream with an indirect length", () => {
    // q Q q 0 0 W H re W n  /Cs1 cs r g b sc  1 0 0 -1 0 H cm  loops  f*  Q
    const content = [
      "q Q q 0 0 120 90 re W n", "/Cs1 cs 0.1 0.2 0.3 sc", "q 1 0 0 -1 0 90 cm",
      "5 5 m 50 5 l 50 50 l 5 50 l h", "20 20 m 30 20 l 30 30 l 20 30 l h", "f*", "Q Q",
    ].join("\n")
    const packed = zlib.deflateSync(Buffer.from(content, "latin1"))
    const bytes = pdf([
      "<< /Type /Catalog /Pages 2 0 R >>",
      "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
      "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 120 90] /Contents 4 0 R /Resources << /ColorSpace << /Cs1 6 0 R >> >> >>",
      Buffer.concat([Buffer.from("<< /Filter /FlateDecode /Length 5 0 R >>\nstream\n", "latin1"), packed, Buffer.from("\nendstream", "latin1")]),
      String(packed.length),
      "[/ICCBased 7 0 R]",
      "<< /N 3 >>",
    ])
    const svg = svgOf(bytes)
    expect(svg).toContain('d="M5 5L50 5L50 50L5 50ZM20 20L30 20L30 30L20 30Z"')
    expect(svg).toContain('fill="#1a334d"')
    expect(svg).toContain('fill-rule="evenodd"')
    expect(svg).toContain('transform="matrix(1 0 0 -1 0 90)"')
    // (the clip to the page box and the colour space are not paint)
    expect(svg.match(/<path /g)).toHaveLength(1)
  })

  it("reads a page that lives inside an object stream, and a media box the page tree hands down", () => {
    // PDF 1.5: the catalog, the page tree and the page are objects 2, 3 and 4, inside object 1
    const entries = [
      "<< /Type /Catalog /Pages 3 0 R >>",
      "<< /Type /Pages /Kids [4 0 R] /Count 1 /MediaBox [0 0 50 40] >>",
      "<< /Type /Page /Parent 3 0 R /Contents 5 0 R >>",
    ]
    const offsets = [0, entries[0]!.length + 1, entries[0]!.length + entries[1]!.length + 2]
    const head = `2 ${offsets[0]} 3 ${offsets[1]} 4 ${offsets[2]} `
    const objstm = stream(`/Type /ObjStm /N 3 /First ${head.length} /Filter /FlateDecode`,
      zlib.deflateSync(Buffer.from(head + entries.join("\n"), "latin1")))
    const bytes = numbered([[1, objstm], [5, stream("", "1 0 0 rg 0 0 25 20 re f")]])
    const picture = pdfToSvg(bytes)!
    expect(picture.width).toBe(50)
    expect(picture.height).toBe(40)
    expect(picture.svg).toContain('<path d="M0 0L25 0L25 20L0 20Z" fill="#ff0000"/>')
  })

  it("the matrices compose the PDF way: the inner cm applies first", () => {
    const svg = svgOf(simple("2 0 0 2 10 10 cm 1 0 0 1 5 5 cm 0 0 4 4 re f"))
    expect(svg).toContain('transform="matrix(2 0 0 2 20 20)"')
  })

  it("q and Q keep a colour, a line and a matrix to themselves", () => {
    const svg = svgOf(simple("1 0 0 rg q 0 1 0 rg 1 0 0 1 3 3 cm 0 0 1 1 re f Q 0 0 1 1 re f"))
    expect(svg).toContain('fill="#00ff00"')
    expect(svg).toContain('<path d="M0 0L1 0L1 1L0 1Z" fill="#ff0000"/>')
    expect(svg.match(/matrix\(1 0 0 1 3 3\)/g)).toHaveLength(1)
  })

  it("grey, CMYK, a dash, a round cap and a transparent fill", () => {
    const content = "0.5 g 0 0 2 2 re f 1 0 0 0 k 0 0 2 2 re f 0 0 0 1 K 2 w 1 J 1 j [3 2] 1 d 0 0 m 9 9 l S"
    const svg = svgOf(simple(content))
    expect(svg).toContain('fill="#808080"')
    expect(svg).toContain('fill="#00ffff"')
    expect(svg).toContain('stroke="#000000"')
    expect(svg).toContain('stroke-linecap="round"')
    expect(svg).toContain('stroke-linejoin="round"')
    expect(svg).toContain('stroke-dasharray="3 2"')
    expect(svg).toContain('stroke-dashoffset="1"')
  })

  it("curves and the filled-and-stroked operators", () => {
    const svg = svgOf(simple("0 0 m 1 2 3 4 5 6 c 7 8 9 10 v 11 12 13 14 y h B*"))
    expect(svg).toContain('d="M0 0C1 2 3 4 5 6C5 6 7 8 9 10C11 12 13 14 13 14Z"')
    expect(svg).toContain('fill-rule="evenodd"')
    expect(svg).toContain('stroke="#000000"')
  })

  it("a box that does not start at the origin lands at the origin of the picture", () => {
    const picture = pdfToSvg(simple("0 0 1 1 re f", "[10 20 110 95]"))!
    expect(picture.width).toBe(100)
    expect(picture.height).toBe(75)
    expect(picture.svg).toContain('matrix(1 0 0 -1 -10 95)')
  })

  it("only the first page is read", () => {
    const bytes = pdf([
      "<< /Type /Catalog /Pages 2 0 R >>",
      "<< /Type /Pages /Kids [3 0 R 5 0 R] /Count 2 >>",
      "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 10 10] /Contents 4 0 R >>",
      stream("", "1 0 0 rg 0 0 5 5 re f"),
      "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 99 99] /Contents 6 0 R >>",
      stream("", "0 0 1 rg 0 0 50 50 re f"),
    ])
    const picture = pdfToSvg(bytes)!
    expect(picture.width).toBe(10)
    expect(picture.svg).toContain("#ff0000")
    expect(picture.svg).not.toContain("#0000ff")
  })

  it("several content streams are one page", () => {
    const bytes = pdf([
      "<< /Type /Catalog /Pages 2 0 R >>",
      "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
      "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 10 10] /Contents [4 0 R 5 0 R] >>",
      stream("", "1 0 0 rg 0 0 5 5 re"),
      stream("", "f"),
    ])
    expect(svgOf(bytes)).toContain('<path d="M0 0L5 0L5 5L0 5Z" fill="#ff0000"/>')
  })

  it("is not fooled by 'obj' inside a compressed stream, and coordinates may be negative or have no leading zero", () => {
    const noisy = Buffer.concat([Buffer.from("3 0 obj << /Fake true >> endobj", "latin1"), Buffer.from([0, 255, 10, 13])])
    const bytes = pdf([
      "<< /Type /Catalog /Pages 2 0 R >>",
      "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
      "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 10 10] /Contents 4 0 R >>",
      stream("", "-.5 .25 m 1 +2 l S"),
      stream("", noisy),
    ])
    expect(svgOf(bytes)).toContain('d="M-0.5 0.25L1 2"')
  })

  it("answers null — and does not throw — for what it cannot draw", () => {
    expect(pdfToSvg(Buffer.from("not a pdf"))).toBeNull()
    expect(pdfToSvg(Buffer.alloc(0))).toBeNull()
    expect(pdfToSvg(Buffer.from("%PDF-1.4\n1 0 obj << /Type /Catalog >> endobj"))).toBeNull()
    // a page of text and nothing else
    expect(pdfToSvg(simple("BT /F1 12 Tf 10 10 Td (hello) Tj ET"))).toBeNull()
    // a stream with a filter nobody here reads
    const odd = pdf([
      "<< /Type /Catalog /Pages 2 0 R >>",
      "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
      "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 10 10] /Contents 4 0 R >>",
      stream("/Filter /DCTDecode", "xx"),
    ])
    expect(pdfToSvg(odd)).toBeNull()
    // garbage after a valid header must not hang or throw
    expect(pdfToSvg(Buffer.from("%PDF-1.4\n" + "[<<(/ ".repeat(500)))).toBeNull()
  })

  it("names pictures that are PDFs, and hands a page its SVG as a URL", () => {
    expect(isPdfPicture("TRACE-1.pdf")).toBe(true)
    expect(isPdfPicture("C:\\notes\\.drawings\\media\\ABC.PDF")).toBe(true)
    expect(isPdfPicture("photo.png")).toBe(false)
    expect(svgDataUrl("<svg/>")).toBe("data:image/svg+xml;base64,PHN2Zy8+")
  })

  it("reads a file, and reads it again only when it has changed", async () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), "wm-pdfpic-"))
    const file = path.join(dir, "TRACE-1.pdf")
    writeFileSync(file, simple("0 0 5 5 re f"))
    const first = await readPdfPicture(file)
    expect(first!.svg).toContain("M0 0L5 0L5 5L0 5Z")
    expect(await readPdfPicture(file)).toBe(first)
    writeFileSync(file, simple("0 0 6 6 re f"))
    const later = await readPdfPicture(file)
    expect(later).not.toBe(first)
    expect(later!.svg).toContain("M0 0L6 0L6 6L0 6Z")
    writeFileSync(file, "nope")
    expect(await readPdfPicture(file)).toBeNull()
  })
})
