import XCTest
@testable import WriteMind

/// The preview's blocks step over a picture the same way the editor's text
/// does (Sean, 2026-09-19: "cells are not obeying the placement below or
/// above images / text grabs rules").
final class PreviewLayoutTests: XCTestCase {
    private func rows(_ heights: [CGFloat]) -> [(id: Int, height: CGFloat)] {
        heights.enumerated().map { ($0.offset, $0.element) }
    }

    func testWithNoPicturesNothingMoves() {
        XCTAssertTrue(PreviewLayout.padding(rows: rows([20, 20, 20]), spacing: 0, top: 0, bands: []).isEmpty)
    }

    func testTheBlockThatWouldStraddleAPictureGoesUnderIt() {
        // Blocks of 20 from y=0; a picture over 30…80.
        let band = CGRect(x: 0, y: 30, width: 100, height: 50)
        let pushes = PreviewLayout.padding(rows: rows([20, 20, 20, 20, 20]), spacing: 0, top: 0,
                                           bands: [band])
        XCTAssertNil(pushes[0], "0…20 is above it")
        // 20…40 straddles the band's top (30 − the margin).
        let push = try? XCTUnwrap(pushes[1])
        XCTAssertNotNil(push)
        XCTAssertEqual(push ?? 0, 30 + 50 + PreviewLayout.margin - 20, accuracy: 0.001,
                       "down to the band's bottom plus its margin")
        XCTAssertNil(pushes[2], "everything after it is carried along by the one push")
    }

    func testABlockThatSitsCompletelyAboveOrBelowIsLeftAlone() {
        let band = CGRect(x: 0, y: 200, width: 100, height: 40)
        let pushes = PreviewLayout.padding(rows: rows([20, 20]), spacing: 0, top: 0, bands: [band])
        XCTAssertTrue(pushes.isEmpty, "both are well above it")
    }

    func testTwoPicturesInARowArePassedOneAfterTheOther() {
        let first = CGRect(x: 0, y: 30, width: 100, height: 40)
        let second = CGRect(x: 0, y: 80, width: 100, height: 40)
        let pushes = PreviewLayout.padding(rows: rows([20, 20]), spacing: 0, top: 0,
                                           bands: [first, second])
        XCTAssertEqual(pushes[1] ?? 0, 80 + 40 + PreviewLayout.margin - 20, accuracy: 0.001,
                       "past both, not just the first")
    }

    func testTheTopInsetAndTheSpacingAreCountedIn() {
        let band = CGRect(x: 0, y: 100, width: 100, height: 20)
        let withInset = PreviewLayout.padding(rows: rows([20, 20, 20]), spacing: 10, top: 50,
                                              bands: [band])
        // y: 50…70, then 80…100, which straddles the band.
        XCTAssertNil(withInset[0])
        XCTAssertEqual(withInset[1] ?? 0, 100 + 20 + PreviewLayout.margin - 80, accuracy: 0.001)
    }

    func testAPictureAboveEverythingPushesTheWholeNoteDown() {
        let band = CGRect(x: 0, y: 0, width: 100, height: 60)
        let pushes = PreviewLayout.padding(rows: rows([20, 20]), spacing: 0, top: 0, bands: [band])
        XCTAssertEqual(pushes[0] ?? 0, 60 + PreviewLayout.margin, accuracy: 0.001)
        XCTAssertNil(pushes[1], "the second is carried by the first")
    }
}

/// Where the rendered page puts each cell, and where its bracket goes.
final class CellBracketTests: XCTestCase {
    private func rows(_ heights: [CGFloat]) -> [(id: Int, height: CGFloat)] {
        heights.enumerated().map { ($0.offset, $0.element) }
    }

    func testEveryCellGetsItsPlaceInOrder() {
        let places = PreviewLayout.positions(rows: rows([20, 30, 10]), spacing: 4, top: 10, bands: [])
        XCTAssertEqual(places[0]?.top, 10)
        XCTAssertEqual(places[0]?.bottom, 30)
        XCTAssertEqual(places[1]?.top, 34)
        XCTAssertEqual(places[1]?.bottom, 64)
        XCTAssertEqual(places[2]?.top, 68)
    }

    func testAPictureMovesTheCellsBelowItAndTheirBracketsWithThem() {
        let band = CGRect(x: 0, y: 20, width: 100, height: 40)
        let places = PreviewLayout.positions(rows: rows([20, 20]), spacing: 0, top: 0, bands: [band])
        // 0…20 straddles the band's top (20 − the margin), so it goes
        // under it, and the one after follows.
        XCTAssertEqual(places[0]?.top ?? -1, 20 + 40 + PreviewLayout.margin, accuracy: 0.001)
        XCTAssertEqual(places[1]?.top ?? 0, 20 + 40 + PreviewLayout.margin + 20, accuracy: 0.001)
    }

    func testABracketIsHitOnItsOwnLineAndNotOnTheNext() {
        let outer = CellBrackets.Bracket(key: "Title", depth: 0, top: 0, bottom: 100,
                                         foldable: true, range: NSRange(location: 0, length: 10))
        let inner = CellBrackets.Bracket(key: "cell:1", depth: 1, top: 10, bottom: 40,
                                         range: NSRange(location: 0, length: 4))
        let width = CellBrackets.width
        let outerX = CellBrackets.x(for: 0, in: width)
        let innerX = CellBrackets.x(for: 1, in: width)
        XCTAssertNotEqual(outerX, innerX, "a group is drawn further out than its cells")
        XCTAssertEqual(CellBrackets.bracket(at: CGPoint(x: outerX, y: 50), in: [outer, inner],
                                            width: width)?.key, "Title")
        XCTAssertEqual(CellBrackets.bracket(at: CGPoint(x: innerX, y: 20), in: [outer, inner],
                                            width: width)?.key, "cell:1")
        XCTAssertNil(CellBrackets.bracket(at: CGPoint(x: 0, y: 20), in: [outer, inner], width: width),
                     "the middle of the gutter is not a bracket")
        XCTAssertNil(CellBrackets.bracket(at: CGPoint(x: innerX, y: 90), in: [inner], width: width),
                     "below the cell is not the cell")
    }
}

/// The same place, whichever mode is showing (Sean, 2026-09-19: "positions
/// stay the same in markdown and wysiwyg mode"). The two sides lay a note
/// out at different heights, so what carries across is the CELL at the top,
/// not the number of points scrolled.
final class TopCellTests: XCTestCase {
    private let places: [Int: (top: CGFloat, bottom: CGFloat)] = [
        0: (top: 20, bottom: 80),
        12: (top: 94, bottom: 180),
        40: (top: 194, bottom: 600),
        90: (top: 614, bottom: 700),
    ]

    func testTheTopOfThePageIsTheFirstCell() {
        XCTAssertEqual(PreviewLayout.topRow(positions: places, scroll: 0), 0)
    }

    func testScrollingPastACellMovesTheAnswerOn() {
        XCTAssertEqual(PreviewLayout.topRow(positions: places, scroll: 100), 12)
        XCTAssertEqual(PreviewLayout.topRow(positions: places, scroll: 300), 40)
        XCTAssertEqual(PreviewLayout.topRow(positions: places, scroll: 5_000), 90)
    }

    func testACellAlmostAtTheTopCountsAsTheTopOne() {
        // A few points short of a cell's top, the window is showing that
        // cell, not the sliver of the one before it — and a switch back
        // lands on the same one, so modes do not walk the page.
        XCTAssertEqual(PreviewLayout.topRow(positions: places, scroll: 194), 40)
        XCTAssertEqual(PreviewLayout.topRow(positions: places, scroll: 190), 40, "within the tolerance")
        XCTAssertEqual(PreviewLayout.topRow(positions: places, scroll: 180), 12, "outside it")
    }

    func testSwitchingBackAndForthStaysOnTheSameCell() {
        let places = self.places
        var scroll: CGFloat = 300
        for _ in 0..<4 {
            let cell = PreviewLayout.topRow(positions: places, scroll: scroll)
            XCTAssertEqual(cell, 40)
            scroll = places[cell ?? 0]?.top ?? 0
        }
    }

    func testAnEmptyPageHasNoTopCell() {
        XCTAssertNil(PreviewLayout.topRow(positions: [:], scroll: 0))
    }

    func testTheCellIsFoundFromAnOffsetInsideIt() {
        // What the rendered page scrolls to when the markdown pane hands it
        // a character offset that is halfway through a block.
        let text = "First cell\n\n## A heading\n\nWords under it"
        let blocks = MarkdownParser.positioned(from: text)
        XCTAssertEqual(blocks.last(where: { $0.range.location <= 30 })?.range.location, 26)
        XCTAssertEqual(blocks.last(where: { $0.range.location <= 0 })?.range.location, 0)
    }
}

/// One gap, the same everywhere (Sean, 2026-09-19: "there shouldn't be
/// gaps between cells" / "gaps should just be a small fixed padding, not
/// some varying amount").
final class CellSpacingTests: XCTestCase {
    func testTheGapBetweenCellsIsSmallAndFixed() {
        XCTAssertLessThanOrEqual(MarkdownPreview.gapHeight, 10)
        XCTAssertGreaterThan(MarkdownPreview.gapHeight, 0, "the pointer still has to fit in it")
    }

    func testEverySeamIsThatSameGap() {
        let rows = [(id: 1, height: CGFloat(40)), (id: 2, height: CGFloat(120)),
                    (id: 3, height: CGFloat(18))]
        let places = PreviewLayout.positions(rows: rows, spacing: MarkdownPreview.gapHeight,
                                             top: MarkdownPreview.topInset, bands: [])
        XCTAssertEqual(places[2]!.top - places[1]!.bottom, MarkdownPreview.gapHeight, accuracy: 0.001)
        XCTAssertEqual(places[3]!.top - places[2]!.bottom, MarkdownPreview.gapHeight, accuracy: 0.001)
    }
}
