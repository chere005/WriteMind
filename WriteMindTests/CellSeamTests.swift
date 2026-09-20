import XCTest
@testable import WriteMind

/// The spaces between the cells (Sean, 2026-09-20: "the cursor should be
/// horizontal any space between the two cells… when clicking in between,
/// the horizontal line appears and that is where the cursor is.. typing
/// from here would insert a new cell below that line").
///
/// Geometry only — no text view, no page. What a cell's box is measured
/// from is the two panes' business; what the space between two of them is
/// belongs here, once.
final class CellSeamTests: XCTestCase {
    /// Three cells down a 300 pt page, comfortably apart, offsets as a note
    /// of 44 characters would give them.
    private let page: [CellSeams.Box] =
        [(20, 60, 0), (80, 120, 12), (140, 200, 30)]

    private func seams(_ cells: [CellSeams.Box],
                       pageTop: CGFloat = 0, pageBottom: CGFloat = 300,
                       noteLength: Int = 44) -> [CellSeams.Seam] {
        CellSeams.seams(cells: cells, pageTop: pageTop, pageBottom: pageBottom, noteLength: noteLength)
    }

    // MARK: - The page is cells and seams and nothing else

    func testEveryCellHasASeamAboveItAndTheLastOneHasASeamUnderIt() {
        XCTAssertEqual(seams(page).count, 4)
        XCTAssertEqual(seams([page[0]]).count, 2)
        XCTAssertEqual(seams([]).count, 1)
    }

    func testTheFirstSeamStartsAtTheTopOfThePageAndTheLastReachesTheBottom() {
        let out = seams(page, pageTop: 4)
        XCTAssertEqual(out.first?.top, 4)
        XCTAssertEqual(out.first?.bottom, 20, "down to the first cell")
        XCTAssertEqual(out.last?.top, 200, "up from the last one")
        XCTAssertEqual(out.last?.bottom, 300)
    }

    func testEveryPointBetweenTwoCellsIsInExactlyOneSeamAndNoPointOnACellIsInAny() {
        let out = seams(page)
        for y in stride(from: CGFloat(60.5), to: 80, by: 0.5) {
            XCTAssertEqual(out.filter { $0.contains(y) }.count, 1, "\(y) is between two cells")
        }
        let onACell = Array(stride(from: CGFloat(20.5), to: 60, by: 0.5))
            + Array(stride(from: CGFloat(140.5), to: 200, by: 0.5))
        for y in onACell {
            XCTAssertTrue(out.allSatisfy { !$0.contains(y) }, "\(y) is inside a cell")
        }
    }

    func testASeamOpensTheCellBelowItAndTheLastOneOpensAtTheEndOfTheNote() {
        XCTAssertEqual(seams(page, noteLength: 44).map(\.offset), [0, 12, 30, 44])
    }

    func testAnEmptyNoteIsOneSeamOverTheWholePage() {
        XCTAssertEqual(CellSeams.seams(cells: [], pageTop: 0, pageBottom: 420, noteLength: 0),
                       [CellSeams.Seam(top: 0, bottom: 420, offset: 0)])
        // A note of nothing but blank lines parses to no cells either; what
        // is typed in its one seam still goes at the end of it.
        XCTAssertEqual(CellSeams.seams(cells: [], pageTop: 0, pageBottom: 420, noteLength: 3).first?.offset, 3)
    }

    // MARK: - Hitting one

    func testThePointerIsInTheSeamItIsInsideAndInNoOtherOne() {
        let out = seams(page)
        XCTAssertEqual(CellSeams.seam(at: 70, in: out)?.offset, 12)
        XCTAssertEqual(CellSeams.seam(at: 250, in: out)?.offset, 44, "the whole tail, not a strip of it")
        XCTAssertEqual(CellSeams.seam(at: 10, in: out)?.offset, 0, "and the whole space above the first cell")
        XCTAssertEqual(CellSeams.seam(at: 60, in: out)?.offset, 12, "a cell's own edge is the seam's too")
        XCTAssertNil(CellSeams.seam(at: 100, in: out), "a cell is not a seam, however near its edge is")
    }

    func testTheLineIsDrawnDownTheMiddleOfTheSeam() {
        XCTAssertEqual(seams(page)[1].middle, 70)
    }

    // MARK: - Seams too thin to hit

    func testASeamTooThinToHitIsWidenedAboutItsMiddle() {
        // Two cells 2 pt apart. The strip has to be hittable, so the cells
        // give way — evenly, so the line stays where the eye already put it.
        let tight: [CellSeams.Box] = [(20, 60, 0), (62, 100, 9)]
        let middle = seams(tight)[1]
        XCTAssertEqual(middle.middle, 61, "the line does not move")
        XCTAssertEqual(middle.top, 61 - MarkdownPreview.gapHeight / 2)
        XCTAssertEqual(middle.bottom, 61 + MarkdownPreview.gapHeight / 2)
        // The minimum is the seam between two cells, and a caller that
        // wants a fatter one says so.
        let fat = CellSeams.seams(cells: tight, pageTop: 0, pageBottom: 300, noteLength: 44, minimum: 20)[1]
        XCTAssertEqual(fat.bottom - fat.top, 20)
        XCTAssertEqual(fat.middle, 61)
    }

    func testAThinSeamAtTheEdgeOfThePageGrowsInwardRatherThanOffIt() {
        // The page's own edges do not move: hovering the very top of the
        // page has to find the first seam, and the tail has to reach the
        // bottom, so here the cell alone gives way.
        let tight: [CellSeams.Box] = [(2, 60, 0)]
        let out = seams(tight, pageBottom: 63)
        XCTAssertEqual(out[0].top, 0)
        XCTAssertEqual(out[0].bottom, MarkdownPreview.gapHeight)
        XCTAssertEqual(out[1].bottom, 63)
        XCTAssertEqual(out[1].top, 63 - MarkdownPreview.gapHeight)
    }

    // MARK: - Boxes that arrive in a state

    func testCellsHandedInOutOfOrderStillComeDownThePage() {
        let jumbled: [CellSeams.Box] = [(140, 200, 30), (20, 60, 0), (80, 120, 12)]
        XCTAssertEqual(seams(jumbled), seams(page))
    }

    func testABoxHandedInUpsideDownIsTurnedTheRightWayUp() {
        let out = seams([(top: 60, bottom: 20, offset: 0)])
        XCTAssertEqual(out[0].bottom, 20)
        XCTAssertEqual(out[1].top, 60)
    }

    func testACellOfNoHeightStillHasASeamEitherSideOfIt() {
        // A blank cell can measure to nothing, and it is still a cell: the
        // seam above it opens IT, the seam below opens the cell after it.
        let flat: [CellSeams.Box] = [(20, 60, 0), (100, 100, 12), (140, 200, 30)]
        let out = seams(flat)
        XCTAssertEqual(out.count, 4)
        XCTAssertEqual(out[1], CellSeams.Seam(top: 60, bottom: 100, offset: 12))
        XCTAssertEqual(out[2], CellSeams.Seam(top: 100, bottom: 140, offset: 30))
    }

    func testTwoCellsThatOverlapDoNotFoldTheSeamBetweenThemInsideOut() {
        let overlapping: [CellSeams.Box] = [(20, 80, 0), (60, 120, 12)]
        let out = seams(overlapping)
        XCTAssertEqual(out.count, 3)
        XCTAssertTrue(out.allSatisfy { $0.top <= $0.bottom })
        XCTAssertEqual(out[1].middle, 80, "the edge they share, widened enough to hit")
        XCTAssertEqual(out[2].top, 120, "and the tail starts under the lower of them")
    }

    func testAPageThatEndsAboveTheLastCellStillLeavesASeamUnderIt() {
        // The caller is confused — a page cannot be shorter than the note
        // on it — but there is still somewhere to type under the last cell.
        let out = seams(page, pageBottom: 100)
        XCTAssertEqual(out.count, 4)
        XCTAssertEqual(out[3].bottom, 200)
        XCTAssertEqual(out[3].bottom - out[3].top, MarkdownPreview.gapHeight)
        XCTAssertEqual(out[3].offset, 44)
    }
}
