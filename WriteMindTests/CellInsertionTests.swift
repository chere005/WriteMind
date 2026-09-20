import AppKit
import XCTest
@testable import WriteMind

/// The line between two cells in the markdown pane (Sean, 2026-09-19: "top
/// priority is the horizontal cursor and horizontal lines between cells
/// like in mathematica").
final class CellInsertionTests: XCTestCase {
    private func textView(_ text: String) -> NSTextView {
        // NSTextView(frame:textContainer:) with a nil container gives a
        // view that keeps no text at all — `string` sets nothing. The
        // frame-only initialiser builds the whole TextKit stack.
        let view = NSTextView(frame: NSRect(x: 0, y: 0, width: 400, height: 800))
        view.font = MarkdownTextView.font
        view.textContainerInset = NSSize(width: 24, height: 20)
        view.textContainer?.containerSize = NSSize(width: 352,
                                                   height: CGFloat.greatestFiniteMagnitude)
        view.textContainer?.widthTracksTextView = false
        view.string = text
        view.layoutManager?.ensureLayout(for: view.textContainer!)
        return view
    }

    // MARK: - Where the gaps are

    func testThereIsAGapAboveBetweenAndBelowTwoCells() {
        let gaps = MarkdownTextView.gaps(in: textView("First cell\n\nSecond cell"))
        XCTAssertEqual(gaps.count, 3)
        XCTAssertEqual(gaps.map(\.offset), [0, 12, 23])
        XCTAssertTrue(gaps[0].y < gaps[1].y && gaps[1].y < gaps[2].y, "down the page, in order")
    }

    func testTheGapBetweenTwoCellsIsBetweenTheirLines() {
        let view = textView("First cell\n\nSecond cell")
        let gaps = MarkdownTextView.gaps(in: view)
        let layout = view.layoutManager!
        let firstLine = layout.lineFragmentRect(forGlyphAt: 0, effectiveRange: nil)
        let secondLine = layout.lineFragmentRect(
            forGlyphAt: layout.glyphIndexForCharacter(at: 12), effectiveRange: nil)
        let inset = view.textContainerInset.height
        XCTAssertGreaterThan(gaps[1].y, firstLine.maxY + inset - 1)
        XCTAssertLessThan(gaps[1].y, secondLine.maxY + inset)
    }

    func testAnEmptyNoteHasNoGaps() {
        XCTAssertTrue(MarkdownTextView.gaps(in: textView("")).isEmpty)
    }

    // MARK: - Hitting one

    private let gaps = [CellInsertions.Gap(y: 100, offset: 0, reach: 7),
                        CellInsertions.Gap(y: 200, offset: 40, reach: 12)]

    func testAPointInAGapFindsIt() {
        XCTAssertEqual(CellInsertions.gap(at: CGPoint(x: 50, y: 196), in: gaps)?.offset, 40)
        XCTAssertEqual(CellInsertions.gap(at: CGPoint(x: 50, y: 104), in: gaps)?.offset, 0)
    }

    func testAPointInTheTextIsNotInAGap() {
        // Everything else belongs to the text view, which is most of the
        // page: the layer must not swallow ordinary clicks.
        XCTAssertNil(CellInsertions.gap(at: CGPoint(x: 50, y: 150), in: gaps))
        XCTAssertNil(CellInsertions.gap(at: CGPoint(x: 50, y: 120), in: gaps))
    }

    func testTheNearestGapWins() {
        let close = [CellInsertions.Gap(y: 100, offset: 0, reach: 40),
                     CellInsertions.Gap(y: 130, offset: 9, reach: 40)]
        XCTAssertEqual(CellInsertions.gap(at: CGPoint(x: 0, y: 126), in: close)?.offset, 9)
    }

    func testAThinGapIsStillBigEnoughToHitButNoWider() {
        // Three points either side: enough to put the pointer in, narrow
        // enough that the lines above and below still get their clicks
        // (Sean, 2026-09-20: "cursor is super buggy").
        let thin = [CellInsertions.Gap(y: 100, offset: 0, reach: 1)]
        XCTAssertNotNil(CellInsertions.gap(at: CGPoint(x: 0, y: 102), in: thin))
        XCTAssertNil(CellInsertions.gap(at: CGPoint(x: 0, y: 108), in: thin))
    }

    func testAGapNeverReachesFurtherThanSixPoints() {
        let wide = [CellInsertions.Gap(y: 100, offset: 0, reach: 40)]
        XCTAssertNotNil(CellInsertions.gap(at: CGPoint(x: 0, y: 105), in: wide))
        XCTAssertNil(CellInsertions.gap(at: CGPoint(x: 0, y: 118), in: wide),
                     "the text a line away is the text view's")
    }

    // MARK: - Opening one

    func testClickingAGapOpensAnEmptyCellThere() {
        let view = textView("First cell\n\nSecond cell")
        MarkdownTextView.openCell(at: 12, in: view)
        XCTAssertEqual(view.string, "First cell\n\n\n\nSecond cell")
        XCTAssertEqual(view.selectedRange().location, 13, "the caret is in the new cell")
    }

    func testACellOpenedAtTheEndDoesNotAddTwoBlankLines() {
        let view = textView("Only cell\n")
        MarkdownTextView.openCell(at: (view.string as NSString).length, in: view)
        XCTAssertEqual(view.string, "Only cell\n\n")
        XCTAssertEqual(view.selectedRange().location, 11)
    }
}
