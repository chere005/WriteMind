import AppKit
import XCTest
@testable import WriteMind

/// The marks on a page that are not letters: a line through a word, an
/// arrow, a ring, a power (Sean, 2026-09-19).
final class HandwritingMarksTests: XCTestCase {
    private let width = 200, height = 60

    /// An ink mask drawn by hand: every rect filled.
    private func mask(_ rects: [CGRect]) -> [Bool] {
        var ink = [Bool](repeating: false, count: width * height)
        for rect in rects {
            for y in Int(rect.minY)..<Int(rect.maxY) where y >= 0 && y < height {
                for x in Int(rect.minX)..<Int(rect.maxX) where x >= 0 && x < width {
                    ink[y * width + x] = true
                }
            }
        }
        return ink
    }

    func testABarAcrossTheMiddleOfAWordIsAStrikethrough() {
        let word = CGRect(x: 20, y: 20, width: 80, height: 20)
        let bar = CGRect(x: 20, y: 29, width: 80, height: 2)
        XCTAssertTrue(HandwritingMarks.struckThrough(word: word, ink: mask([bar]),
                                                     width: width, height: height))
    }

    func testALineUnderTheWordIsNotAStrikethrough() {
        let word = CGRect(x: 20, y: 20, width: 80, height: 20)
        let underline = CGRect(x: 20, y: 41, width: 80, height: 2)
        XCTAssertFalse(HandwritingMarks.struckThrough(word: word, ink: mask([underline]),
                                                      width: width, height: height))
    }

    func testAShortDashInsideAWordIsNotAStrikethrough() {
        let word = CGRect(x: 20, y: 20, width: 80, height: 20)
        let dash = CGRect(x: 40, y: 29, width: 20, height: 2)
        XCTAssertFalse(HandwritingMarks.struckThrough(word: word, ink: mask([dash]),
                                                      width: width, height: height))
    }

    func testASolidBlockIsNotAStrikethrough() {
        let word = CGRect(x: 20, y: 20, width: 80, height: 20)
        XCTAssertFalse(HandwritingMarks.struckThrough(word: word, ink: mask([word]),
                                                      width: width, height: height),
                       "a filled box is not a thin line")
    }

    func testAnArrowPointsWhereItsHeadIs() {
        // A shaft with a fat head on the right.
        let shaft = CGRect(x: 20, y: 29, width: 60, height: 3)
        let head = CGRect(x: 70, y: 24, width: 10, height: 13)
        let box = CGRect(x: 20, y: 24, width: 60, height: 13)
        XCTAssertEqual(HandwritingMarks.arrow(box: box, ink: mask([shaft, head]),
                                              width: width, height: height), "→")

        let leftHead = CGRect(x: 20, y: 24, width: 10, height: 13)
        XCTAssertEqual(HandwritingMarks.arrow(box: box, ink: mask([shaft, leftHead]),
                                              width: width, height: height), "←")
    }

    func testAnArrowCanPointDown() {
        let shaft = CGRect(x: 60, y: 5, width: 3, height: 45)
        let head = CGRect(x: 55, y: 40, width: 13, height: 10)
        let box = CGRect(x: 55, y: 5, width: 13, height: 45)
        XCTAssertEqual(HandwritingMarks.arrow(box: box, ink: mask([shaft, head]),
                                              width: width, height: height), "↓")
    }

    func testAPlainLineIsNotAnArrow() {
        let line = CGRect(x: 20, y: 29, width: 80, height: 3)
        XCTAssertNil(HandwritingMarks.arrow(box: line, ink: mask([line]),
                                            width: width, height: height),
                     "no head, no arrow")
    }

    func testWhatVisionReadsAsAnArrowBecomesOne() {
        XCTAssertEqual(HandwritingMarks.normaliseArrows("A -> B"), "A → B")
        XCTAssertEqual(HandwritingMarks.normaliseArrows("A --> B"), "A → B")
        XCTAssertEqual(HandwritingMarks.normaliseArrows("A => B"), "A → B")
        XCTAssertEqual(HandwritingMarks.normaliseArrows("B <- A"), "B ← A")
    }

    func testARingIsRoundAndHollowAndHoldsItsWord() {
        let ring = CGRect(x: 10, y: 10, width: 60, height: 50)
        XCTAssertTrue(HandwritingMarks.isRing(box: ring, fill: 0.2, shortSide: 200))
        XCTAssertFalse(HandwritingMarks.isRing(box: ring, fill: 0.9, shortSide: 200), "a blot is not a ring")
        XCTAssertFalse(HandwritingMarks.isRing(box: CGRect(x: 0, y: 0, width: 80, height: 6), fill: 0.2,
                                               shortSide: 200), "a dash is not a ring")
        XCTAssertTrue(HandwritingMarks.encircles(ring, word: CGRect(x: 20, y: 22, width: 40, height: 22)))
        XCTAssertFalse(HandwritingMarks.encircles(ring, word: CGRect(x: 60, y: 22, width: 60, height: 22)),
                       "half in is not in")
    }

    func testAnOThatIsReallyARingIsDropped() {
        XCTAssertTrue(HandwritingMarks.isRingRead("O"))
        XCTAssertTrue(HandwritingMarks.isRingRead("0"))
        XCTAssertFalse(HandwritingMarks.isRingRead("Op"))
    }

    // MARK: - An arrow between two words

    /// A line of writing 30 points tall with three words on it, and the
    /// ink those words are made of. Vision's word boxes are LOOSE on
    /// purpose here — each one runs right up to the next, the way the real
    /// ones do — so the tests prove that the gap is found in the ink and
    /// only the ORDER comes from Vision.
    private let band = CGRect(x: 20, y: 10, width: 180, height: 30)
    private let words = [CGRect(x: 20, y: 12, width: 66, height: 26),
                         CGRect(x: 86, y: 12, width: 60, height: 26),
                         CGRect(x: 146, y: 12, width: 54, height: 26)]
    /// What is actually on the page: three clumps of letters with real
    /// gaps between them.
    private let letters = [CGRect(x: 20, y: 12, width: 40, height: 26),
                           CGRect(x: 90, y: 12, width: 40, height: 26),
                           CGRect(x: 160, y: 12, width: 40, height: 26)]

    private func between(_ arrow: CGRect, extraInk: [CGRect] = []) -> Int? {
        HandwritingMarks.betweenWords(arrow, line: band, words: words,
                                      marks: letters + extraInk + [arrow])
    }

    func testAnArrowInTheGapBelongsToTheWordAfterIt() {
        XCTAssertEqual(between(CGRect(x: 64, y: 20, width: 22, height: 8)), 1)
        XCTAssertEqual(between(CGRect(x: 134, y: 20, width: 22, height: 8)), 2)
    }

    func testAnArrowOverAWordBelongsToNobody() {
        let overTheSecond = CGRect(x: 95, y: 20, width: 30, height: 8)
        XCTAssertNil(between(overTheSecond), "Vision has already read whatever that is")
    }

    func testAnArrowAtEitherEndOfTheLineIsNotBetweenWords() {
        XCTAssertNil(between(CGRect(x: 0, y: 20, width: 16, height: 8)),
                     "in front of the first word")
        XCTAssertNil(between(CGRect(x: 206, y: 20, width: 16, height: 8)),
                     "after the last word")
    }

    func testAnArrowOnAnotherLineIsNotOnThisOne() {
        XCTAssertNil(between(CGRect(x: 64, y: 60, width: 22, height: 8)))
    }

    func testTheGapIsFoundInTheInkAndNotInVisionsWordBoxes() {
        // The arrow at 64…86 is inside the FIRST word's box (20…86) as
        // Vision draws it, and in a clear gap in the ink. It is the ink
        // that decides — the box measured on a real page overlapped its
        // neighbour by 74 points.
        XCTAssertTrue(words[0].intersects(CGRect(x: 64, y: 20, width: 22, height: 8)),
                      "the premise: Vision's box for the first word covers this gap")
        XCTAssertEqual(between(CGRect(x: 64, y: 20, width: 22, height: 8)), 1)
        // …and a speck of ink dropped into that gap takes it away again.
        XCTAssertNil(between(CGRect(x: 64, y: 20, width: 22, height: 8),
                             extraInk: [CGRect(x: 70, y: 18, width: 6, height: 12)]),
                     "something else is drawn there, so it is not a gap")
    }

    func testAnArrowIsNotAWordWithALineThroughIt() {
        XCTAssertTrue(HandwritingMarks.isArrowRead("→"))
        XCTAssertTrue(HandwritingMarks.isArrowRead(" ↔ "))
        XCTAssertFalse(HandwritingMarks.isArrowRead("→x"))
        XCTAssertFalse(HandwritingMarks.isArrowRead(""))
        XCTAssertTrue(HandwritingMarks.startsWithArrow("→ Lyon"))
        XCTAssertFalse(HandwritingMarks.startsWithArrow("Lyon →"))
        XCTAssertTrue(HandwritingMarks.endsWithArrow("Paris →"))
    }

    func testTwoReadingsAreOnTheSameBandOrTheyAreNot() {
        XCTAssertTrue(HandwritingMarks.sameBand(band, band.offsetBy(dx: 200, dy: 4)))
        XCTAssertFalse(HandwritingMarks.sameBand(band, band.offsetBy(dx: 200, dy: 40)))
    }

    // MARK: - Checkboxes

    /// Ink drawn with Core Graphics and thresholded the way a photographed
    /// page is. The mask's FIRST ROW IS THE PICTURE'S TOP, which is the way
    /// round every mask in the app is — Core Graphics counts up from the
    /// bottom, and a bitmap context's first row is the image's top, so the
    /// two are already the right way round and `maskBox` is what turns a
    /// rect you drew into the rect the rules are given.
    private func drawn(_ draw: (CGContext) -> Void) -> [Bool] {
        let context = CGContext(data: nil, width: width, height: height, bitsPerComponent: 8,
                                bytesPerRow: width, space: CGColorSpaceCreateDeviceGray(),
                                bitmapInfo: CGImageAlphaInfo.none.rawValue)!
        context.setFillColor(CGColor(gray: 1, alpha: 1))
        context.fill(CGRect(x: 0, y: 0, width: width, height: height))
        context.setStrokeColor(CGColor(gray: 0, alpha: 1))
        context.setFillColor(CGColor(gray: 0, alpha: 1))
        context.setLineWidth(3)
        draw(context)
        let data = context.data!.bindMemory(to: UInt8.self, capacity: width * height)
        var mask = [Bool](repeating: false, count: width * height)
        for y in 0..<height {
            for x in 0..<width { mask[y * width + x] = data[y * width + x] < 128 }
        }
        return mask
    }

    private func maskBox(_ rect: CGRect) -> CGRect {
        CGRect(x: rect.minX, y: CGFloat(height) - rect.maxY, width: rect.width, height: rect.height)
    }

    /// The tight box of everything inked — what a connected component hands
    /// the rules, rather than the rect that happened to be drawn.
    private func inkBox(_ mask: [Bool]) -> CGRect {
        var x0 = width, x1 = -1, y0 = height, y1 = -1
        for y in 0..<height {
            for x in 0..<width where mask[y * width + x] {
                x0 = min(x0, x); x1 = max(x1, x); y0 = min(y0, y); y1 = max(y1, y)
            }
        }
        guard x1 >= 0 else { return .null }
        return CGRect(x: x0, y: y0, width: x1 - x0 + 1, height: y1 - y0 + 1)
    }

    /// A 24-point box at the head of a 30-point line of writing, and the
    /// words to its right.
    private let square = CGRect(x: 20, y: 16, width: 24, height: 24)
    private var lineBox: CGRect { CGRect(x: 56, y: 14, width: 130, height: 30) }

    private func tick(_ context: CGContext, in box: CGRect) {
        context.move(to: CGPoint(x: box.minX + 5, y: box.midY))
        context.addLine(to: CGPoint(x: box.midX, y: box.minY + 5))
        context.addLine(to: CGPoint(x: box.maxX - 4, y: box.maxY - 4))
        context.strokePath()
    }

    private func read(_ mask: [Bool], line: CGRect? = nil) -> Bool? {
        HandwritingMarks.checkbox(inkBox(mask), line: maskBox(line ?? lineBox),
                                  ink: mask, width: width, height: height)
    }

    func testAnEmptyBoxAtTheHeadOfALineIsAnUntickedTask() {
        let mask = drawn { $0.stroke(square) }
        XCTAssertEqual(read(mask), false, "a box with nothing in it")
    }

    func testABoxWithATickInItIsTicked() {
        // The tick never touches the outline, so it is a blob of its own:
        // the rule reads the whole mask, not the box's own pixels.
        let apart = drawn { context in
            context.stroke(square)
            self.tick(context, in: square.insetBy(dx: 3, dy: 3))
        }
        XCTAssertEqual(read(apart), true, "a tick drawn clear of the outline")

        let touching = drawn { context in
            context.stroke(square)
            self.tick(context, in: square)
        }
        XCTAssertEqual(read(touching), true, "…and one that runs into it")
    }

    func testACrossInTheBoxCountsAsTickedToo() {
        let mask = drawn { context in
            context.stroke(square)
            context.move(to: CGPoint(x: square.minX + 4, y: square.minY + 4))
            context.addLine(to: CGPoint(x: square.maxX - 4, y: square.maxY - 4))
            context.move(to: CGPoint(x: square.minX + 4, y: square.maxY - 4))
            context.addLine(to: CGPoint(x: square.maxX - 4, y: square.minY + 4))
            context.strokePath()
        }
        XCTAssertEqual(read(mask), true)
    }

    func testAFilledSquareIsNotACheckbox() {
        XCTAssertNil(read(drawn { $0.fill(square) }), "a blot is a bullet, not a box")
    }

    func testARoundLetterAtTheHeadOfALineIsNotACheckbox() {
        // The shapes that are nearly square and hollow, which is exactly
        // what the four-edges rule is there to throw out.
        for letter in ["O", "D", "o", "e", "a", "C"] {
            let mask = drawn { context in
                NSGraphicsContext.saveGraphicsState()
                NSGraphicsContext.current = NSGraphicsContext(cgContext: context, flipped: false)
                (letter as NSString).draw(at: CGPoint(x: 20, y: 16),
                                          withAttributes: [.font: NSFont.systemFont(ofSize: 34),
                                                           .foregroundColor: NSColor.black])
                NSGraphicsContext.restoreGraphicsState()
            }
            XCTAssertNil(read(mask), "\(letter) is a letter, not a checkbox")
        }
    }

    func testTheFourEdgesRuleIsWhatSeparatesThem() {
        // Guards the premise of the test above: a box fills the edges of
        // its own bounding box and a round letter does not. If these two
        // ever meet, the rule has stopped proving anything.
        let box = drawn { $0.stroke(square) }
        let letter = drawn { context in
            NSGraphicsContext.saveGraphicsState()
            NSGraphicsContext.current = NSGraphicsContext(cgContext: context, flipped: false)
            ("O" as NSString).draw(at: CGPoint(x: 20, y: 16),
                                   withAttributes: [.font: NSFont.systemFont(ofSize: 34),
                                                    .foregroundColor: NSColor.black])
            NSGraphicsContext.restoreGraphicsState()
        }
        let drawnBox = HandwritingMarks.edgesInked(inkBox(box), ink: box, width: width, height: height)
        let roundLetter = HandwritingMarks.edgesInked(inkBox(letter), ink: letter,
                                                      width: width, height: height)
        XCTAssertEqual(drawnBox, 1, accuracy: 0.001, "every edge of a drawn box is inked")
        XCTAssertLessThan(roundLetter, 0.8, "an O leaves the edges of its box empty")
    }

    func testABoxThatIsNotTheSizeOfTheWritingIsLeftAlone() {
        let mask = drawn { $0.stroke(square) }
        let tiny = CGRect(x: 56, y: 22, width: 130, height: 8)
        XCTAssertNil(read(mask, line: tiny), "far taller than the line it would start")
        let huge = CGRect(x: 56, y: 0, width: 130, height: 58)
        XCTAssertNil(read(mask, line: huge), "far shorter than the line it would start")
    }

    func testOnlyAMarkAtTheHEADOfALineCounts() {
        let line = maskBox(lineBox)
        XCTAssertTrue(HandwritingMarks.startsLine(maskBox(square), line: line))
        // The same box halfway along the words.
        XCTAssertFalse(HandwritingMarks.startsLine(maskBox(square.offsetBy(dx: 90, dy: 0)), line: line),
                       "a box drawn over a word is not the line's checkbox")
        // …and out on its own, a line above.
        XCTAssertFalse(HandwritingMarks.startsLine(maskBox(square.offsetBy(dx: 0, dy: 34)), line: line),
                       "a box on another line is not this line's")
    }

    func testALineBecomesAMarkdownTaskItem() {
        XCTAssertEqual(HandwritingMarks.taskItem("milk", ticked: true), "- [x] milk")
        XCTAssertEqual(HandwritingMarks.taskItem("bread", ticked: false), "- [ ] bread")
        XCTAssertEqual(HandwritingMarks.taskItem("• bread", ticked: false), "- [ ] bread",
                       "the box read as a bullet does not become a second marker")
        XCTAssertEqual(HandwritingMarks.taskItem("- bread", ticked: false), "- [ ] bread")
        XCTAssertEqual(HandwritingMarks.taskItem("  ", ticked: true), "",
                       "a box with nothing beside it is not a task")
    }

    func testWhatVisionReadsADrawnBoxAsIsDropped() {
        for read in ["D", "O", "0", "[]", "[ ]", "□", "X", "V", "•"] {
            XCTAssertTrue(HandwritingMarks.isBoxRead(read), "\(read) is the box, not a word")
        }
        for word in ["milk", "Go", "42x", "は い"] {
            XCTAssertFalse(HandwritingMarks.isBoxRead(word), "\(word) is a word")
        }
    }

    func testMostlyInsideIsBothWaysRound() {
        let outer = CGRect(x: 0, y: 0, width: 40, height: 40)
        XCTAssertTrue(HandwritingMarks.mostlyInside(CGRect(x: 5, y: 5, width: 20, height: 20), outer))
        XCTAssertFalse(HandwritingMarks.mostlyInside(outer, CGRect(x: 5, y: 5, width: 20, height: 20)))
        XCTAssertFalse(HandwritingMarks.mostlyInside(CGRect(x: 30, y: 30, width: 40, height: 40), outer),
                       "a corner overlap is not inside")
    }

    func testASumIsMathsAndASentenceIsNot() {
        XCTAssertTrue(HandwritingMarks.looksLikeMaths("x = 2y + 1"))
        XCTAssertTrue(HandwritingMarks.looksLikeMaths("3 × 4 = 12"))
        XCTAssertFalse(HandwritingMarks.looksLikeMaths("buy 3 apples and bread"))
        XCTAssertFalse(HandwritingMarks.looksLikeMaths("hello there"), "no operator at all")
    }

    func testOnlyAnOperatorIsNeverAWordStruckOut() {
        XCTAssertTrue(HandwritingMarks.isOperatorRead("="))
        XCTAssertTrue(HandwritingMarks.isOperatorRead(" + "))
        XCTAssertTrue(HandwritingMarks.isOperatorRead("≤"))
        XCTAssertFalse(HandwritingMarks.isOperatorRead("2y"), "a word is more than the bar")
        XCTAssertFalse(HandwritingMarks.isOperatorRead("x=1"), "a whole sum is not one sign")
        XCTAssertFalse(HandwritingMarks.isOperatorRead(""))
    }

    func testATimesSignWithNothingToMultiplyIsTheLetterX() {
        XCTAssertEqual(HandwritingMarks.strayTimesAsX("× = 2y + 1"), "x = 2y + 1")
        XCTAssertEqual(HandwritingMarks.strayTimesAsX("2y + 1 = ×"), "2y + 1 = x")
        XCTAssertEqual(HandwritingMarks.strayTimesAsX("3 × 4"), "3 × 4", "a real sum is left alone")
        XCTAssertEqual(HandwritingMarks.strayTimesAsX("(a + b) × 2"), "(a + b) × 2",
                       "a bracket closes an operand")
    }

    func testTheSignsAHandWritesBecomeWolfram() {
        XCTAssertEqual(HandwritingMarks.wolfram("3 × 4 ÷ 2"), "3 * 4 / 2")
        XCTAssertEqual(HandwritingMarks.wolfram("x ≤ 5"), "x <= 5")
        XCTAssertEqual(HandwritingMarks.wolfram("π r^2"), "Pi r^2")
    }

    func testARaisedDigitBecomesAPower() {
        // "x2" with the 2 small and high is x^2; "2x" on the line is not.
        let big = CGRect(x: 0, y: 10, width: 10, height: 20)
        let small = CGRect(x: 12, y: 8, width: 6, height: 9)
        XCTAssertEqual(HandwritingMarks.superscripted([("x", big), ("2", small)]), "x^2")
        let onTheLine = CGRect(x: 12, y: 10, width: 10, height: 20)
        XCTAssertEqual(HandwritingMarks.superscripted([("2", onTheLine), ("x", big)]), "2x")
    }
}
