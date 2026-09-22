import XCTest
@testable import WriteMind

/// Where the rendered page puts each cell, and where its bracket goes.
final class CellBracketTests: XCTestCase {
    private func rows(_ heights: [CGFloat]) -> [(id: Int, height: CGFloat)] {
        heights.enumerated().map { ($0.offset, $0.element) }
    }

    func testEveryCellGetsItsPlaceInOrder() {
        let places = PreviewLayout.positions(rows: rows([20, 30, 10]), spacing: 4, top: 10)
        XCTAssertEqual(places[0]?.top, 10)
        XCTAssertEqual(places[0]?.bottom, 30)
        XCTAssertEqual(places[1]?.top, 34)
        XCTAssertEqual(places[1]?.bottom, 64)
        XCTAssertEqual(places[2]?.top, 68)
    }

    func testADrawingOnThePageMovesNoCellAtAll() {
        // The whole of Step 1, in one assertion: there is no argument left
        // to tell the stack about a picture (Sean, 2026-09-20: "don't push
        // other cells around").
        let places = PreviewLayout.positions(rows: rows([20, 20]), spacing: 0, top: 0)
        XCTAssertEqual(places[0]?.top, 0)
        XCTAssertEqual(places[1]?.top, 20)
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

        // AND THE PAGE'S OWN RHYTHM IS THE OTHER PANE'S (Sean,
        // 2026-09-22: "make the spacing more uniform.. in rendered mode
        // things get scrunched together"). A blank line of the note plus
        // the spacing that goes round it, which is what separates two
        // cells in the source — not the floor a seam is allowed to
        // shrink to, which is all `gapHeight` ever was.
        XCTAssertEqual(MarkdownPreview.blockGap,
                       MarkdownTextView.lineHeight
                           + MarkdownTextView.paragraphStyle.lineSpacing, accuracy: 0.001)
        XCTAssertGreaterThan(MarkdownPreview.blockGap, MarkdownPreview.gapHeight * 2,
                             "the page was stacking cells a third of a line apart")
    }

    func testEverySeamIsThatSameGap() {
        let rows = [(id: 1, height: CGFloat(40)), (id: 2, height: CGFloat(120)),
                    (id: 3, height: CGFloat(18))]
        let places = PreviewLayout.positions(rows: rows, spacing: MarkdownPreview.blockGap,
                                             top: MarkdownPreview.topInset)
        XCTAssertEqual(places[2]!.top - places[1]!.bottom, MarkdownPreview.blockGap, accuracy: 0.001)
        XCTAssertEqual(places[3]!.top - places[2]!.bottom, MarkdownPreview.blockGap, accuracy: 0.001)
    }
}

/// A code cell is the same height on both sides of the app (the open list:
/// "the two panes are close to the same height, not exactly").
final class CodeCellHeightTests: XCTestCase {
    /// What the SOURCE pane gives a fenced cell: the ``` line, the body,
    /// the closing ```, all at one source line each.
    private func source(bodyLines: Int) -> CGFloat {
        CGFloat(bodyLines + 2) * MarkdownTextView.lineHeight
    }

    /// What the RENDERED page gives it: the body at the same size and the
    /// same spacing, with the padding standing in for the two fences.
    private func rendered(bodyLines: Int) -> CGFloat {
        CGFloat(bodyLines) * MarkdownTextView.lineHeight + 2 * MarkdownPreview.codePadding
    }

    func testTheTwoPanesGiveACodeCellTheSameHeight() {
        for lines in [1, 2, 5, 20] {
            XCTAssertEqual(source(bodyLines: lines), rendered(bodyLines: lines), accuracy: 0.001,
                           "\(lines) lines of code")
        }
    }

    func testThePaddingIsOneSourceLine() {
        // Which is what the ``` line it stands in for takes over there.
        XCTAssertEqual(MarkdownPreview.codePadding, MarkdownTextView.lineHeight)
    }

    func testTheRenderedPageSetsCodeAtTheSizeTheSourceDoes() {
        XCTAssertEqual(MarkdownTextView.codeSize, MarkdownTextView.font.pointSize * 0.95)
    }

    func testASourceLineIsTheFontsLineHeightPlusItsSpacing() {
        XCTAssertEqual(MarkdownTextView.lineHeight,
                       NSLayoutManager().defaultLineHeight(for: MarkdownTextView.font)
                           + MarkdownTextView.paragraphStyle.lineSpacing)
        XCTAssertGreaterThan(MarkdownTextView.lineHeight, 15, "a sane line for a 15-point font")
    }
}
