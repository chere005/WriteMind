import AppKit
import XCTest
@testable import WriteMind

/// Vision reads printed words drawn in code; that is enough to know the
/// plumbing — flattening on white, ordering, the join — is right.
final class TextRecognitionTests: XCTestCase {
    private func picture(_ lines: [String]) -> CGImage {
        let width = 700, height = 80 * lines.count + 40
        let context = CGContext(data: nil, width: width, height: height, bitsPerComponent: 8,
                                bytesPerRow: width * 4, space: CGColorSpaceCreateDeviceRGB(),
                                bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue)!
        // Transparent, like a captured chunk of writing; the reader puts it on white.
        let graphics = NSGraphicsContext(cgContext: context, flipped: false)
        NSGraphicsContext.saveGraphicsState()
        NSGraphicsContext.current = graphics
        let attributes: [NSAttributedString.Key: Any] = [.font: NSFont.boldSystemFont(ofSize: 44),
                                                          .foregroundColor: NSColor.black]
        for (index, line) in lines.enumerated() {
            // Core Graphics y goes up: the first line is drawn nearest the top.
            let y = CGFloat(height - 70 - index * 80)
            (line as NSString).draw(at: CGPoint(x: 30, y: y), withAttributes: attributes)
        }
        NSGraphicsContext.restoreGraphicsState()
        return context.makeImage()!
    }

    func testPrintedLinesComeBackInOrder() {
        let read = TextRecognition.lines(in: picture(["Hello World", "Second line"]))
        XCTAssertEqual(read.count, 2, "two lines, got \(read)")
        XCTAssertTrue(read.first?.lowercased().contains("hello") == true, "got \(read)")
        XCTAssertTrue(read.last?.lowercased().contains("second") == true, "got \(read)")
    }

    /// A page with a printed dot grid drawn under the words.
    private func dottedPicture(_ lines: [String], spacing: Int = 24, dot: Int = 5) -> CGImage {
        let base = picture(lines)
        let width = base.width, height = base.height
        let context = CGContext(data: nil, width: width, height: height, bitsPerComponent: 8,
                                bytesPerRow: width * 4, space: CGColorSpaceCreateDeviceRGB(),
                                bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue)!
        context.setFillColor(CGColor(red: 1, green: 1, blue: 1, alpha: 1))
        context.fill(CGRect(x: 0, y: 0, width: width, height: height))
        context.setFillColor(CGColor(gray: 0.62, alpha: 1))
        for y in stride(from: spacing, to: height, by: spacing) {
            for x in stride(from: spacing, to: width, by: spacing) {
                context.fillEllipse(in: CGRect(x: x, y: y, width: dot, height: dot))
            }
        }
        context.draw(base, in: CGRect(x: 0, y: 0, width: width, height: height))
        return context.makeImage()!
    }

    func testAPrintedDotGridIsPaintedOutBeforeTheWordsAreRead() throws {
        let dotted = dottedPicture(["Hello World"])
        let cleaned = try XCTUnwrap(TextRecognition.withoutDotGrid(dotted), "the grid should be found")
        XCTAssertNil(TextRecognition.withoutDotGrid(picture(["Hello World"])),
                     "a page with no grid is left exactly as it is")
        let read = TextRecognition.lines(in: cleaned)
        XCTAssertEqual(read.count, 1, "the dots are not read as text: \(read)")
        XCTAssertTrue(read.first?.lowercased().contains("hello") == true, "got \(read)")
    }

    func testTheWordsOnADottedPageStillComeBack() {
        let read = TextRecognition.lines(in: dottedPicture(["Milk and bread", "call the plumber"]))
        XCTAssertEqual(read.count, 2, "got \(read)")
        XCTAssertTrue(read.first?.lowercased().contains("milk") == true, "got \(read)")
    }

    func testJapaneseIsRead() throws {
        try XCTSkipUnless(TextRecognition.japaneseAvailable, "this Mac's Vision has no Japanese")
        let read = TextRecognition.lines(in: picture(["カタカナのメモ", "ひらがな 123"]))
        XCTAssertEqual(read.count, 2, "got \(read)")
        XCTAssertTrue(read.first?.contains("カタカナ") == true, "got \(read)")
        XCTAssertTrue(read.last?.contains("123") == true, "the numbers come with it: \(read)")
    }

    func testEnglishStillReadsExactlyAsItDid() {
        let read = TextRecognition.lines(in: picture(["Buy milk and bread", "call the plumber"]))
        XCTAssertEqual(read, ["Buy milk and bread", "call the plumber"])
    }

    func testKanaCountsAsAWordAndAStrokeDoesNot() {
        XCTAssertTrue(TextRecognition.looksLikeText("え", confidence: 0.8), "one kana is a word")
        XCTAssertTrue(TextRecognition.looksLikeText("メモ 123", confidence: 0.8))
        XCTAssertFalse(TextRecognition.looksLikeText("ー", confidence: 0.9), "a stroke is a doodle")
        XCTAssertFalse(TextRecognition.looksLikeText("、 。 ・", confidence: 0.9), "a dot grid reads like this")
    }

    func testDoodlesAndDotsAreNotText() {
        XCTAssertTrue(TextRecognition.looksLikeText("Hello World", confidence: 0.9))
        XCTAssertTrue(TextRecognition.looksLikeText("42", confidence: 0.6))
        XCTAssertTrue(TextRecognition.looksLikeText("I like building tools.", confidence: 0.4))
        XCTAssertFalse(TextRecognition.looksLikeText("~ ' ` -", confidence: 0.9), "no letters at all")
        XCTAssertFalse(TextRecognition.looksLikeText("l l l l", confidence: 0.8), "strokes, not a word")
        XCTAssertFalse(TextRecognition.looksLikeText("Hello", confidence: 0.1), "read with no confidence")
        XCTAssertFalse(TextRecognition.looksLikeText("", confidence: 1))
    }

    func testABlankPictureReadsAsNothing() {
        XCTAssertTrue(TextRecognition.lines(in: picture([])).isEmpty)
    }
}
