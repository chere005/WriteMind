// Pictures for measuring the bundled reader (compare.ts; the "Against Vision" table in docs/OCR-BUNDLED.md was made with them), drawn with the Mac's own
// CoreGraphics / CoreText and the handwriting-style fonts macOS ships (Bradley Hand, Snell Roundhand, Noteworthy, Marker Felt,
// Hiragino Maru Gothic / Mincho). Nothing is downloaded. THESE ARE NOT REAL HANDWRITING: a font is one hand's letter shapes
// repeated, so the pictures only stand for the situations (a big photo of a ruled page, cursive joins, Japanese, maths on a
// line, a struck-out word); the real handwriting is the committed fixture. Each glyph is jittered a little (baseline, tilt,
// size) so the line is not typeset-straight.
//
//   swiftc -O make-pictures.swift -o /tmp/make-pictures && /tmp/make-pictures <outdir> <handwriting-fixture.png>
//
// Writes <name>.png and <name>.txt (the ground truth: one line per line of writing) into <outdir>, and sheet-source.pgm (the
// raster sheet-strokes.mjs thins into pen strokes for the tablet sheet).

import CoreGraphics
import CoreText
import Foundation
import ImageIO
import UniformTypeIdentifiers

var seed: UInt64 = 0x9E3779B97F4A7C15
func rnd() -> Double {            // a fixed sequence: the pictures come out the same every run
  seed ^= seed << 13; seed ^= seed >> 7; seed ^= seed << 17
  return Double(seed % 1_000_000) / 1_000_000
}
func jit(_ amount: Double) -> Double { (rnd() * 2 - 1) * amount }

func font(_ names: [String], _ size: CGFloat) -> CTFont {
  for name in names {
    let f = CTFontCreateWithName(name as CFString, size, nil)
    let got = CTFontCopyPostScriptName(f) as String
    if got.lowercased().hasPrefix(name.lowercased().prefix(6)) { return f }
  }
  fputs("font not found: \(names)\n", stderr); exit(1)
}

func context(_ w: Int, _ h: Int, _ bg: (CGFloat, CGFloat, CGFloat)) -> CGContext {
  let c = CGContext(data: nil, width: w, height: h, bitsPerComponent: 8, bytesPerRow: 0,
    space: CGColorSpace(name: CGColorSpace.sRGB)!, bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue)!
  c.setFillColor(CGColor(srgbRed: bg.0, green: bg.1, blue: bg.2, alpha: 1))
  c.fill(CGRect(x: 0, y: 0, width: w, height: h))
  return c
}

func writePNG(_ image: CGImage, _ path: String) {
  let url = URL(fileURLWithPath: path) as CFURL
  let dest = CGImageDestinationCreateWithURL(url, UTType.png.identifier as CFString, 1, nil)!
  CGImageDestinationAddImage(dest, image, nil)
  CGImageDestinationFinalize(dest)
}

/// One line of writing, glyph by glyph, left edge `x`, baseline `y` (CoreGraphics' y is UP). Returns its width.
@discardableResult
func write(_ c: CGContext, _ text: String, font base: CTFont, x: CGFloat, y: CGFloat, color: CGColor,
           wobble: Double = 1, strike: Range<Int>? = nil, raise: Set<Int> = []) -> CGFloat {
  var pen = x
  let size = CTFontGetSize(base)
  var strikeStart: CGFloat = 0, strikeEnd: CGFloat = 0
  for (index, ch) in text.enumerated() {
    let scale = 1 + jit(0.04 * wobble)
    let f = CTFontCreateCopyWithAttributes(base, size * (raise.contains(index) ? 0.62 : 1) * CGFloat(scale), nil, nil)
    let attr = NSAttributedString(string: String(ch), attributes: [
      NSAttributedString.Key(kCTFontAttributeName as String): f,
      NSAttributedString.Key(kCTForegroundColorAttributeName as String): color,
    ])
    let line = CTLineCreateWithAttributedString(attr)
    let advance = CGFloat(CTLineGetTypographicBounds(line, nil, nil, nil))
    c.saveGState()
    let lift = CGFloat(jit(size * 0.025 * wobble)) + (raise.contains(index) ? size * 0.42 : 0)
    c.translateBy(x: pen, y: y + lift)
    c.rotate(by: CGFloat(jit(0.035 * wobble)))
    c.textPosition = .zero
    CTLineDraw(line, c)
    c.restoreGState()
    if let strike = strike {
      if index == strike.lowerBound { strikeStart = pen }
      if index == strike.upperBound - 1 { strikeEnd = pen + advance }
    }
    pen += advance
  }
  if strike != nil {            // a pen stroke through the word, a little uphill, doubled once
    c.setStrokeColor(color); c.setLineWidth(size * 0.05); c.setLineCap(.round)
    for k in 0..<2 {
      c.move(to: CGPoint(x: strikeStart - size * 0.08, y: y + size * (0.28 + CGFloat(k) * 0.03)))
      c.addLine(to: CGPoint(x: strikeEnd + size * 0.08, y: y + size * (0.34 + CGFloat(k) * 0.03)))
      c.strokePath()
    }
  }
  return pen - x
}

func truth(_ name: String, _ lines: [String], into dir: String) {
  try! (lines.joined(separator: "\n") + "\n").write(toFile: "\(dir)/\(name).txt", atomically: true, encoding: .utf8)
}

let args = CommandLine.arguments
guard args.count >= 2 else { fputs("usage: make-pictures <outdir> [handwriting-fixture.png]\n", stderr); exit(1) }
let out = args[1]
try? FileManager.default.createDirectory(atPath: out, withIntermediateDirectories: true)
let ink = CGColor(srgbRed: 0.10, green: 0.13, blue: 0.40, alpha: 1)
let black = CGColor(srgbRed: 0.02, green: 0.02, blue: 0.02, alpha: 1)

// MARK: (a) a notebook page photographed at full resolution: 3000 x 4000, ruled, tilted, shaded, with desk round it

do {
  let pw = 2700, ph = 3700
  let page = context(pw, ph, (0.97, 0.955, 0.90))
  // ruled lines every 140 px from the top margin, a red margin line
  page.setStrokeColor(CGColor(srgbRed: 0.55, green: 0.65, blue: 0.82, alpha: 1)); page.setLineWidth(3)
  var ruleY: CGFloat = CGFloat(ph) - 360
  var rules: [CGFloat] = []
  while ruleY > 160 { page.move(to: CGPoint(x: 0, y: ruleY)); page.addLine(to: CGPoint(x: CGFloat(pw), y: ruleY)); page.strokePath(); rules.append(ruleY); ruleY -= 140 }
  page.setStrokeColor(CGColor(srgbRed: 0.85, green: 0.45, blue: 0.45, alpha: 1)); page.setLineWidth(4)
  page.move(to: CGPoint(x: 330, y: 0)); page.addLine(to: CGPoint(x: 330, y: CGFloat(ph))); page.strokePath()
  let lines = ["Meeting notes Friday", "buy milk and eggs", "call the dentist at nine",
               "the quick brown fox jumps", "over the lazy dog", "remember to water the plants",
               "send the report to Anna", "dinner with Sam at 7"]
  let f = font(["BradleyHandITCTT-Bold"], 118)
  for (i, text) in lines.enumerated() {
    // every other ruled line, the writing sitting on it
    write(page, text, font: f, x: 400 + CGFloat(jit(14)), y: rules[i * 2] + 14, color: ink)
  }
  truth("page-bradley-3000x4000", lines, into: out)
  // the desk: 3000 x 4000, the page turned 2.5 degrees about the middle
  let w = 3000, h = 4000
  let photo = context(w, h, (0.34, 0.27, 0.20))
  photo.saveGState()
  photo.translateBy(x: CGFloat(w) / 2, y: CGFloat(h) / 2)
  photo.rotate(by: -2.5 * .pi / 180)
  photo.draw(page.makeImage()!, in: CGRect(x: -pw / 2, y: -ph / 2, width: pw, height: ph))
  photo.restoreGState()
  // shade: a soft shadow from the lower left, and a vignette
  let data = photo.data!.assumingMemoryBound(to: UInt8.self)
  let stride = photo.bytesPerRow
  for py in 0..<h {
    for px in 0..<w {
      let fx = Double(px) / Double(w), fy = Double(py) / Double(h)       // fy: 0 = top row in memory
      let shadow = 1 - 0.30 * max(0, (fy * 0.8 + (1 - fx) * 0.6) - 0.55) / 0.85
      let dx = fx - 0.5, dy = fy - 0.5
      let vignette = 1 - 0.28 * (dx * dx + dy * dy) * 2
      let noise = 1 + (rnd() - 0.5) * 0.06
      let m = shadow * vignette * noise
      let at = py * stride + px * 4
      data[at] = UInt8(max(0, min(255, Double(data[at]) * m)))
      data[at + 1] = UInt8(max(0, min(255, Double(data[at + 1]) * m)))
      data[at + 2] = UInt8(max(0, min(255, Double(data[at + 2]) * m)))
    }
  }
  writePNG(photo.makeImage()!, "\(out)/page-bradley-3000x4000.png")
}

// MARK: (c) cursive: Snell Roundhand

do {
  let lines = ["Dear Anna, thank you", "for the lovely flowers", "Best wishes, Sam"]
  let c = context(1900, 760, (0.99, 0.99, 0.97))
  let f = font(["SnellRoundhand"], 128)
  for (i, text) in lines.enumerated() { write(c, text, font: f, x: 80, y: 600 - CGFloat(i) * 200, color: black, wobble: 0.5) }
  truth("cursive-snell", lines, into: out)
  writePNG(c.makeImage()!, "\(out)/cursive-snell.png")
}

// MARK: (d) Japanese in handwriting-ish Hiragino fonts (Maru Gothic: pen-like round strokes; Mincho: brush-like)

do {
  let lines = ["今日は会議があります", "東京へ行く", "ありがとうございます", "メモ 2026"]
  for (name, ps) in [("japanese-maru-gothic", "HiraMaruProN-W4"), ("japanese-mincho", "HiraMinProN-W3")] {
    let c = context(1700, 900, (0.99, 0.98, 0.94))
    let f = font([ps], 120)
    for (i, text) in lines.enumerated() { write(c, text, font: f, x: 80, y: 740 - CGFloat(i) * 200, color: black, wobble: 1.4) }
    truth(name, lines, into: out)
    writePNG(c.makeImage()!, "\(out)/\(name).png")
  }
}

// MARK: (e) maths on one line, and a struck-through word

do {
  let lines = ["x = 2y + 1", "E = mc^2", "3 + 4 = 7"]
  let c = context(1500, 800, (0.99, 0.99, 0.97))
  let f = font(["BradleyHandITCTT-Bold"], 130)
  // the exponent is a raised small 2 in the picture, "^2" in the truth: that is how a hand writes it and how the app reads it
  write(c, lines[0], font: f, x: 80, y: 620, color: black)
  write(c, "E = mc2", font: f, x: 80, y: 420, color: black, raise: [6])
  write(c, lines[2], font: f, x: 80, y: 220, color: black)
  truth("maths-line", lines, into: out)
  writePNG(c.makeImage()!, "\(out)/maths-line.png")
}
do {
  let lines = ["Thursday meeting", "buy bread"]
  let c = context(1500, 520, (0.99, 0.99, 0.97))
  let f = font(["BradleyHandITCTT-Bold"], 130)
  write(c, "Thursday meeting", font: f, x: 80, y: 360, color: black, strike: 9..<16)
  write(c, lines[1], font: f, x: 80, y: 170, color: black)
  truth("struck-word", lines, into: out)
  writePNG(c.makeImage()!, "\(out)/struck-word.png")
}

// MARK: the two hands of the real fixture, cut apart: biro cursive (top) and felt-tip print (bottom)

if args.count >= 3, let src = CGImageSourceCreateWithURL(URL(fileURLWithPath: args[2]) as CFURL, nil), let image = CGImageSourceCreateImageAtIndex(src, 0, nil) {
  let w = image.width, h = image.height
  if let top = image.cropping(to: CGRect(x: 0, y: 0, width: w, height: 330)) { writePNG(top, "\(out)/handwriting-biro.png") }
  if let bottom = image.cropping(to: CGRect(x: 0, y: 340, width: w, height: h - 340)) { writePNG(bottom, "\(out)/handwriting-felt.png") }
  truth("handwriting-biro", ["The quick brown fox", "jumps over the lazy", "dog.", "0123456789"], into: out)
  truth("handwriting-felt", ["The quick brown fox", "jumps over the lazy dog.", "0123456789"], into: out)
}

// MARK: the tablet sheet's sources: black text on white, thinned to pen strokes by sheet-strokes.mjs

/// Text as an 8-bit grey PGM (row 0 at the top), the raster sheet-strokes.mjs thins.
func pgm(_ name: String, _ lines: [(String, CGFloat, CGFloat)], width w: Int, height h: Int, size: CGFloat) {
  let c = context(w, h, (1, 1, 1))
  let f = font(["BradleyHandITCTT-Bold"], size)
  for (text, x, y) in lines { write(c, text, font: f, x: x, y: y, color: black, wobble: 0.5) }
  let img = c.makeImage()!
  var grey = [UInt8](repeating: 255, count: w * h)
  let g = CGContext(data: &grey, width: w, height: h, bitsPerComponent: 8, bytesPerRow: w, space: CGColorSpaceCreateDeviceGray(), bitmapInfo: 0)!
  g.draw(img, in: CGRect(x: 0, y: 0, width: w, height: h))
  var out = Data("P5\n\(w) \(h)\n255\n".utf8); out.append(contentsOf: grey)
  try! out.write(to: URL(fileURLWithPath: "\(out_dir)/\(name).pgm"))
}
let out_dir = out
pgm("sheet-source", [("Buy milk and eggs", 40, 480), ("call the plumber", 40, 190)], width: 2000, height: 700, size: 190)
truth("sheet-wacom", ["Buy milk and eggs", "call the plumber"], into: out)
// the words that label a flow chart's boxes (one raster each, so a script can fit each into its own box)
for word in ["Start", "Check", "Done"] {
  pgm("word-\(word.lowercased())", [(word, 30, 250)], width: 760, height: 380, size: 200)
}
print("wrote pictures to \(out)")
