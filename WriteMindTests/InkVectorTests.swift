import AppKit
import XCTest
@testable import WriteMind

/// The writing comes off the page as outlines, not pixels (Sean,
/// 2026-09-19: "when getting the drawing, make it a vector graphic so it
/// scales well").
final class InkVectorTests: XCTestCase {
    /// A mask with `ink` true inside `rect`, minus `hole`.
    private func mask(_ size: Int, ink rect: CGRect, hole: CGRect? = nil) -> NotebookCapture.Mask {
        var pixels = [Bool](repeating: false, count: size * size)
        for y in 0..<size {
            for x in 0..<size {
                let point = CGPoint(x: Double(x) + 0.5, y: Double(y) + 0.5)
                guard rect.contains(point) else { continue }
                if let hole, hole.contains(point) { continue }
                pixels[y * size + x] = true
            }
        }
        return NotebookCapture.Mask(width: size, height: size, ink: pixels)
    }

    private let whole = (x: 0, y: 0, width: 12, height: 12)

    func testASolidBlockTracesToOneRectangle() {
        let traced = InkVector.outlines(of: mask(12, ink: CGRect(x: 3, y: 4, width: 5, height: 3)), box: whole)
        XCTAssertEqual(traced.count, 1)
        XCTAssertEqual(traced[0].count, 4, "a rectangle needs four corners and no staircase")
        let xs = traced[0].map(\.x), ys = traced[0].map(\.y)
        XCTAssertEqual(xs.min(), 3); XCTAssertEqual(xs.max(), 8)
        XCTAssertEqual(ys.min(), 4); XCTAssertEqual(ys.max(), 7)
    }

    func testAHoleIsTracedAsItsOwnLoopAndStaysEmpty() {
        let ring = mask(12, ink: CGRect(x: 2, y: 2, width: 8, height: 8),
                        hole: CGRect(x: 4, y: 4, width: 4, height: 4))
        let traced = InkVector.outlines(of: ring, box: whole)
        XCTAssertEqual(traced.count, 2, "the outside of the o and the inside of it")
        let filled = Self.raster(InkVector.path(traced), size: CGSize(width: 12, height: 12), scale: 1)
        XCTAssertGreaterThan(filled(3, 3), 200, "the ring is inked")
        XCTAssertLessThan(filled(6, 6), 40, "the hole in the middle of it is not")
    }

    func testNothingIsTracedFromABlankPage() {
        XCTAssertTrue(InkVector.outlines(of: mask(12, ink: .zero), box: whole).isEmpty)
        XCTAssertNil(InkVector.pdf(of: mask(12, ink: .zero), box: whole, colour: .black))
    }

    func testTheStaircaseIsThinnedAway() {
        // A diagonal stroke: one loop, and far fewer points than the
        // hundreds of unit steps its boundary is made of.
        var pixels = [Bool](repeating: false, count: 60 * 60)
        for i in 4..<56 { for w in 0..<3 { pixels[i * 60 + i + w] = true } }
        let diagonal = NotebookCapture.Mask(width: 60, height: 60, ink: pixels)
        let traced = InkVector.outlines(of: diagonal, box: (0, 0, 60, 60))
        XCTAssertEqual(traced.count, 1)
        XCTAssertLessThan(traced[0].count, 40, "a straight stroke is a few corners, not a staircase")
        XCTAssertGreaterThan(traced[0].count, 3)
    }

    func testTheFileIsAPDFTheSizeOfTheWriting() {
        let data = InkVector.pdf(of: mask(12, ink: CGRect(x: 3, y: 4, width: 5, height: 3)),
                                 box: whole, colour: .black)
        let pdf = try? XCTUnwrap(data)
        XCTAssertEqual(pdf?.prefix(4).map { Character(UnicodeScalar($0)) }.map(String.init).joined(), "%PDF")
        let document = CGPDFDocument(CGDataProvider(data: (pdf ?? Data()) as CFData)!)
        XCTAssertEqual(document?.numberOfPages, 1)
        let page = document?.page(at: 1)
        XCTAssertEqual(page?.getBoxRect(.mediaBox).width, 12)
        XCTAssertEqual(page?.getBoxRect(.mediaBox).height, 12)
    }

    /// The point of all of it: blown up, the edges stay edges.
    func testItScalesWithoutGoingSoft() {
        let data = InkVector.pdf(of: mask(12, ink: CGRect(x: 3, y: 4, width: 5, height: 3)),
                                 box: whole, colour: .black)
        let ink = Self.rasterPDF(try! XCTUnwrap(data), scale: 8)
        let middle = 8 * 5 + 4
        XCTAssertGreaterThan(ink(8 * 3 + 4, middle), 240, "inside the stroke")
        XCTAssertLessThan(ink(8 * 3 - 4, middle), 15, "outside it")
        // Eight times up, the left edge of the block is still an EDGE: the
        // paper next to it is paper and the ink next to it is ink, with at
        // most a pixel of antialiasing between. A raster blown up eight
        // times ramps across eight.
        let across = (8 * 3 - 4...8 * 3 + 4).map { ink($0, middle) }
        let soft = across.filter { (16.0..<240.0).contains($0) }
        XCTAssertLessThanOrEqual(soft.count, 1, "a scaled-up raster would be a gradient: \(across)")
    }

    // MARK: - Rasterising, to check what the vector actually paints

    /// Fill `path` into a bitmap and hand back its ink coverage, 0…255.
    private static func raster(_ path: CGPath, size: CGSize, scale: CGFloat) -> (Int, Int) -> Double {
        let width = Int(size.width * scale), height = Int(size.height * scale)
        let context = CGContext(data: nil, width: width, height: height, bitsPerComponent: 8,
                                bytesPerRow: width, space: CGColorSpaceCreateDeviceGray(),
                                bitmapInfo: CGImageAlphaInfo.none.rawValue)!
        context.setFillColor(gray: 1, alpha: 1)
        context.fill(CGRect(x: 0, y: 0, width: width, height: height))
        // The tracer counts y DOWN the page; a bitmap context counts it up
        // from the bottom. Flipping here means a row of the buffer is a row
        // of the mask, in both helpers.
        context.translateBy(x: 0, y: CGFloat(height))
        context.scaleBy(x: scale, y: -scale)
        context.setFillColor(gray: 0, alpha: 1)
        context.addPath(path)
        context.fillPath(using: .evenOdd)
        // COPIED out of the context: the buffer belongs to it, and reading
        // the pointer after it goes away takes the test host with it.
        let pixels = Self.copy(context)
        let bytesPerRow = context.bytesPerRow
        return { x, y in 255 - Double(pixels[y * bytesPerRow + x]) }
    }

    /// The same, from the PDF bytes — what the app will put on the page.
    private static func rasterPDF(_ data: Data, scale: CGFloat) -> (Int, Int) -> Double {
        let page = CGPDFDocument(CGDataProvider(data: data as CFData)!)!.page(at: 1)!
        let box = page.getBoxRect(.mediaBox)
        let width = Int(box.width * scale), height = Int(box.height * scale)
        let context = CGContext(data: nil, width: width, height: height, bitsPerComponent: 8,
                                bytesPerRow: width, space: CGColorSpaceCreateDeviceGray(),
                                bitmapInfo: CGImageAlphaInfo.none.rawValue)!
        context.setFillColor(gray: 1, alpha: 1)
        context.fill(CGRect(x: 0, y: 0, width: width, height: height))
        context.scaleBy(x: scale, y: scale)
        context.drawPDFPage(page)
        // The PDF was written y-up, so a buffer row is a mask row already.
        let pixels = Self.copy(context)
        let bytesPerRow = context.bytesPerRow
        return { x, y in 255 - Double(pixels[y * bytesPerRow + x]) }
    }

    /// The context's pixels, as bytes this test owns.
    private static func copy(_ context: CGContext) -> [UInt8] {
        let bytes = context.data!.assumingMemoryBound(to: UInt8.self)
        return Array(UnsafeBufferPointer(start: bytes, count: context.bytesPerRow * context.height))
    }
}
