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

    func testASumIsMathsAndASentenceIsNot() {
        XCTAssertTrue(HandwritingMarks.looksLikeMaths("x = 2y + 1"))
        XCTAssertTrue(HandwritingMarks.looksLikeMaths("3 × 4 = 12"))
        XCTAssertFalse(HandwritingMarks.looksLikeMaths("buy 3 apples and bread"))
        XCTAssertFalse(HandwritingMarks.looksLikeMaths("hello there"), "no operator at all")
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
