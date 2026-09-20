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

    // MARK: - Checkboxes

    /// A shopping list on paper: a box at the head of each line, ticked or
    /// not, and the words beside it (Sean, 2026-09-19: "a hand-drawn box
    /// with a tick in it, or an empty one, in a line of writing, should
    /// come back as a markdown task item").
    private func checklist(_ items: [(ticked: Bool, text: String)]) -> CGImage {
        let width = 700, height = 80 * items.count + 40
        let context = CGContext(data: nil, width: width, height: height, bitsPerComponent: 8,
                                bytesPerRow: width * 4, space: CGColorSpaceCreateDeviceRGB(),
                                bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue)!
        context.setFillColor(CGColor(red: 1, green: 1, blue: 1, alpha: 1))
        context.fill(CGRect(x: 0, y: 0, width: width, height: height))
        context.setStrokeColor(CGColor(gray: 0, alpha: 1))
        context.setLineWidth(3)
        let attributes: [NSAttributedString.Key: Any] = [.font: NSFont.boldSystemFont(ofSize: 40),
                                                          .foregroundColor: NSColor.black]
        let graphics = NSGraphicsContext(cgContext: context, flipped: false)
        for (index, item) in items.enumerated() {
            // Core Graphics y goes up: the first item is drawn nearest the top.
            let y = CGFloat(height - 72 - index * 80)
            let box = CGRect(x: 30, y: y, width: 34, height: 34)
            context.stroke(box)
            if item.ticked {
                // A tick clear of the outline: it is a blob of its own, and
                // the rule has to read the mask rather than the box's own
                // pixels to see it.
                context.move(to: CGPoint(x: box.minX + 6, y: box.midY))
                context.addLine(to: CGPoint(x: box.midX, y: box.minY + 6))
                context.addLine(to: CGPoint(x: box.maxX - 5, y: box.maxY - 5))
                context.strokePath()
            }
            NSGraphicsContext.saveGraphicsState()
            NSGraphicsContext.current = graphics
            (item.text as NSString).draw(at: CGPoint(x: 84, y: y - 2), withAttributes: attributes)
            NSGraphicsContext.restoreGraphicsState()
        }
        return context.makeImage()!
    }

    func testADrawnCheckboxComesBackAsATaskItem() {
        let read = TextRecognition.lines(in: checklist([(true, "milk"), (false, "bread")]))
        XCTAssertEqual(read, ["- [x] milk", "- [ ] bread"], "got \(read)")
    }

    func testAPageWithNoBoxesIsLeftExactlyAsItWas() {
        // The words that start with the round letters a box is confused
        // with; nothing here may grow a task marker.
        let read = TextRecognition.lines(in: picture(["Order flowers", "Odd one out"]))
        XCTAssertEqual(read, ["Order flowers", "Odd one out"], "got \(read)")
    }

    func testABoxDrawnOverAWordIsNotTheLinesCheckbox() {
        let width = 700, height = 120
        let context = CGContext(data: nil, width: width, height: height, bitsPerComponent: 8,
                                bytesPerRow: width * 4, space: CGColorSpaceCreateDeviceRGB(),
                                bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue)!
        context.setFillColor(CGColor(red: 1, green: 1, blue: 1, alpha: 1))
        context.fill(CGRect(x: 0, y: 0, width: width, height: height))
        NSGraphicsContext.saveGraphicsState()
        NSGraphicsContext.current = NSGraphicsContext(cgContext: context, flipped: false)
        ("call the plumber" as NSString).draw(at: CGPoint(x: 30, y: 40),
                                              withAttributes: [.font: NSFont.boldSystemFont(ofSize: 40),
                                                               .foregroundColor: NSColor.black])
        NSGraphicsContext.restoreGraphicsState()
        context.setStrokeColor(CGColor(gray: 0, alpha: 1))
        context.setLineWidth(3)
        context.stroke(CGRect(x: 260, y: 36, width: 34, height: 34))
        let read = TextRecognition.lines(in: context.makeImage()!)
        XCTAssertEqual(read.count, 1, "got \(read)")
        XCTAssertFalse(read.first?.hasPrefix("- [") == true, "a box halfway along is not a checkbox: \(read)")
    }

    // MARK: - An arrow between two words

    /// The three places a drawn arrow can be, against one line of writing
    /// with two words on it.
    func testAnArrowGoesInlineBesideOrIsLeftToVision() {
        let band = CGRect(x: 20, y: 10, width: 160, height: 30)
        let letters = [CGRect(x: 20, y: 12, width: 40, height: 26),
                       CGRect(x: 140, y: 12, width: 40, height: 26)]
        let words = zip(["Paris", "Lyon"], letters).map { HandwritingMarks.Word(text: $0, box: $1) }
        let line = [(box: band, words: words)]   // here the ink and the boxes agree

        func place(_ arrow: CGRect) -> TextRecognition.ArrowPlace {
            TextRecognition.place(arrow, onLines: line, amongInk: letters + [arrow])
        }

        XCTAssertEqual(place(CGRect(x: 70, y: 20, width: 50, height: 8)),
                       .inline(line: 0, before: 1), "in the gap between the two words")
        XCTAssertEqual(place(CGRect(x: 70, y: 70, width: 50, height: 8)),
                       .ownLine, "well below the line")
        XCTAssertEqual(place(CGRect(x: 220, y: 20, width: 40, height: 8)),
                       .ownLine, "out to the right of everything")
        XCTAssertEqual(place(CGRect(x: 25, y: 18, width: 30, height: 8)),
                       .read, "drawn over a word: Vision has read it already")

        // And an arrow Vision DID read, in the gap: a second one would be
        // a duplicate ("Paris → → Lyon").
        let alreadyRead = [HandwritingMarks.Word(text: "Paris", box: letters[0]),
                           HandwritingMarks.Word(text: "→", box: CGRect(x: 70, y: 20, width: 50, height: 8)),
                           HandwritingMarks.Word(text: "Lyon", box: letters[1])]
        XCTAssertEqual(TextRecognition.place(CGRect(x: 70, y: 20, width: 50, height: 8),
                                             onLines: [(box: band, words: alreadyRead)],
                                             amongInk: letters + [CGRect(x: 70, y: 20, width: 50, height: 8)]),
                       .read)
    }

    /// Vision breaks a line at a drawn arrow, so the two halves come back
    /// as separate readings; they are put back together.
    func testTwoReadingsSplitByAnArrowBecomeOneLine() {
        let left = TextRecognition.Piece(y: 0.6, box: CGRect(x: 20, y: 40, width: 90, height: 32),
                                          text: "Paris")
        let right = TextRecognition.Piece(y: 0.6, box: CGRect(x: 180, y: 42, width: 180, height: 34),
                                           text: "→ Lyon")
        XCTAssertEqual(TextRecognition.joinAcrossArrows([left, right]).map(\.text), ["Paris → Lyon"])

        let farOff = TextRecognition.Piece(y: 0.6, box: CGRect(x: 600, y: 42, width: 180, height: 34),
                                            text: "→ Lyon")
        XCTAssertEqual(TextRecognition.joinAcrossArrows([left, farOff]).map(\.text),
                       ["Paris", "→ Lyon"], "a column away is not the same line")

        let below = TextRecognition.Piece(y: 0.3, box: CGRect(x: 180, y: 120, width: 180, height: 34),
                                           text: "→ Lyon")
        XCTAssertEqual(TextRecognition.joinAcrossArrows([left, below]).map(\.text),
                       ["Paris", "→ Lyon"], "the line below is not this line")

        let plain = TextRecognition.Piece(y: 0.6, box: CGRect(x: 180, y: 42, width: 180, height: 34),
                                           text: "Lyon")
        XCTAssertEqual(TextRecognition.joinAcrossArrows([left, plain]).map(\.text), ["Paris", "Lyon"],
                       "nothing but an arrow joins two readings")
    }

    /// Two words with an arrow between them, or with the arrow dropped
    /// well below the line — and, for the rule that matters most, the same
    /// page with no arrow drawn at all.
    private func arrowPicture(dropped: Bool = false, arrow: Bool = true,
                              lyon: CGFloat = 285) -> CGImage {
        let width = 700, height = 200
        let context = CGContext(data: nil, width: width, height: height, bitsPerComponent: 8,
                                bytesPerRow: width * 4, space: CGColorSpaceCreateDeviceRGB(),
                                bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue)!
        context.setFillColor(CGColor(red: 1, green: 1, blue: 1, alpha: 1))
        context.fill(CGRect(x: 0, y: 0, width: width, height: height))
        let attributes: [NSAttributedString.Key: Any] = [.font: NSFont.boldSystemFont(ofSize: 40),
                                                          .foregroundColor: NSColor.black]
        NSGraphicsContext.saveGraphicsState()
        NSGraphicsContext.current = NSGraphicsContext(cgContext: context, flipped: false)
        ("Paris" as NSString).draw(at: CGPoint(x: 30, y: 110), withAttributes: attributes)
        ("Lyon" as NSString).draw(at: CGPoint(x: lyon, y: 110), withAttributes: attributes)
        NSGraphicsContext.restoreGraphicsState()
        guard arrow else { return context.makeImage()! }
        // On the line's band, or well below it.
        let y: CGFloat = dropped ? 50 : 124
        let tip = lyon - 20
        context.setStrokeColor(CGColor(gray: 0, alpha: 1))
        context.setLineWidth(4)
        context.move(to: CGPoint(x: tip - 90, y: y)); context.addLine(to: CGPoint(x: tip, y: y))
        context.strokePath()
        context.move(to: CGPoint(x: tip - 12, y: y + 10)); context.addLine(to: CGPoint(x: tip, y: y))
        context.addLine(to: CGPoint(x: tip - 12, y: y - 10)); context.strokePath()
        return context.makeImage()!
    }

    /// The path that fires on a page like this one: Vision reads the arrow
    /// itself and BREAKS THE LINE at it, so the two halves have to be put
    /// back together.
    func testAnArrowBetweenTwoWordsComesBackInTheLine() {
        let picture = arrowPicture()
        XCTAssertEqual(TextRecognition.observations(in: picture, languages: nil).count, 2,
                       "the premise: Vision hands this page back as two readings")
        let read = TextRecognition.lines(in: picture)
        XCTAssertEqual(read, ["Paris → Lyon"], "got \(read)")
    }

    /// And the path that fires when Vision MISSES the arrow: the ink rule
    /// puts it back between the two words rather than on a line of its own.
    ///
    /// The reading therefore comes from the page with no arrow on it, and
    /// the INK from the page with one — because a printed arrow drawn in
    /// code is one Vision reads every time, and the case worth testing is
    /// the handwritten one it does not.
    /// One line of words with a wide space in it, and a small arrow drawn
    /// in that space. Vision reads the two words as ONE line here and
    /// leaves the arrow alone, which is the case this rule exists for.
    private func spacedArrowPicture() -> CGImage {
        let width = 700, height = 200
        let context = CGContext(data: nil, width: width, height: height, bitsPerComponent: 8,
                                bytesPerRow: width * 4, space: CGColorSpaceCreateDeviceRGB(),
                                bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue)!
        context.setFillColor(CGColor(red: 1, green: 1, blue: 1, alpha: 1))
        context.fill(CGRect(x: 0, y: 0, width: width, height: height))
        NSGraphicsContext.saveGraphicsState()
        NSGraphicsContext.current = NSGraphicsContext(cgContext: context, flipped: false)
        ("Paris         Lyon" as NSString)
            .draw(at: CGPoint(x: 30, y: 110),
                  withAttributes: [.font: NSFont.boldSystemFont(ofSize: 40),
                                   .foregroundColor: NSColor.black])
        NSGraphicsContext.restoreGraphicsState()
        // Clear of the letters at both ends: an arrow that runs into the L
        // of Lyon is ONE blob of ink with it, and no longer an arrow at all.
        let y: CGFloat = 124
        context.setStrokeColor(CGColor(gray: 0, alpha: 1))
        context.setLineWidth(3)
        context.move(to: CGPoint(x: 132, y: y)); context.addLine(to: CGPoint(x: 190, y: y))
        context.strokePath()
        context.move(to: CGPoint(x: 182, y: y + 8)); context.addLine(to: CGPoint(x: 190, y: y))
        context.addLine(to: CGPoint(x: 182, y: y - 8)); context.strokePath()
        return context.makeImage()!
    }

    func testAnArrowVisionDidNotReadGoesBetweenTheWords() throws {
        let picture = spacedArrowPicture()
        let observations = TextRecognition.observations(in: picture, languages: nil)
        XCTAssertEqual(observations.count, 1, "the premise: Vision hands this back as ONE line")
        let best = try XCTUnwrap(observations.first?.topCandidates(1).first)
        XCTAssertEqual(best.string.split(separator: " ").count, 2,
                       "…of two words, with the arrow unread: \(best.string)")
        let read = TextRecognition.lines(in: picture)
        XCTAssertEqual(read, ["Paris → Lyon"], "got \(read)")
    }

    func testAnArrowAwayFromTheWritingKeepsItsOwnLine() {
        let read = TextRecognition.lines(in: arrowPicture(dropped: true))
        XCTAssertEqual(read.count, 3, "the words, then the arrow underneath: \(read)")
        XCTAssertEqual(read.last, "→", "got \(read)")
    }

    // MARK: - Maths

    /// A line of algebra drawn on a page. EVERY OPERATOR ON IT IS A THIN
    /// BAR ACROSS THE MIDDLE OF ITS OWN BOX, which is exactly the shape
    /// `struckThrough` looks for, so each one used to come back wrapped in
    /// `~~` — and that in turn defeated the maths path, which will not
    /// touch a line carrying marks.
    private func mathsPicture(_ line: String) -> CGImage {
        let width = 700, height = 120
        let context = CGContext(data: nil, width: width, height: height, bitsPerComponent: 8,
                                bytesPerRow: width * 4, space: CGColorSpaceCreateDeviceRGB(),
                                bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue)!
        context.setFillColor(CGColor(red: 1, green: 1, blue: 1, alpha: 1))
        context.fill(CGRect(x: 0, y: 0, width: width, height: height))
        NSGraphicsContext.saveGraphicsState()
        NSGraphicsContext.current = NSGraphicsContext(cgContext: context, flipped: false)
        (line as NSString).draw(at: CGPoint(x: 30, y: 40),
                                withAttributes: [.font: NSFont.boldSystemFont(ofSize: 40),
                                                 .foregroundColor: NSColor.black])
        NSGraphicsContext.restoreGraphicsState()
        return context.makeImage()!
    }

    func testADrawnLineOfAlgebraComesBackAsMaths() {
        let read = TextRecognition.lines(in: mathsPicture("x = 2y + 1"))
        XCTAssertEqual(read.count, 1, "got \(read)")
        XCTAssertFalse(read.first?.contains("~~") == true,
                       "the = and the + are operators, not words struck out: \(read)")
        XCTAssertEqual(read.first, MathMarkup.inline("x = 2y + 1"), "got \(read)")
    }

    func testABlankPictureReadsAsNothing() {
        XCTAssertTrue(TextRecognition.lines(in: picture([])).isEmpty)
    }
}
