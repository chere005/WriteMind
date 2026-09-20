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
                       [CellSeams.Seam(top: 0, bottom: 420, offset: 0,
                                       line: MarkdownPreview.gapHeight / 2)])
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

    // MARK: - Where the bar is drawn

    func testAnOrdinarySeamBetweenTwoCellsDrawsItsBarWhereItAlwaysDid() {
        // The eight points between two cells, which is what nearly every
        // seam on a page is: the bar is halfway down them. The rule that
        // moves the tail's bar must not move this one by so much as a
        // point, so it is pinned here.
        let snug: [CellSeams.Box] = [(20, 60, 0), (68, 120, 12)]
        let between = seams(snug)[1]
        XCTAssertEqual(between.bottom - between.top, MarkdownPreview.gapHeight)
        XCTAssertEqual(between.line, 64, "the middle of the eight, as before")
    }

    func testTheBarUnderTheLastCellIsDrawnAgainstItAndNotHalfwayDownThePage() {
        // Sean, 2026-09-20: "when i select somewhere below the cell, the
        // bar should go immediately after the last cell, not the random
        // spot below it's currently at". The tail runs to the bottom of
        // the page, so clicking anywhere in that empty space still arms
        // it — but the LINE belongs to the cell it follows.
        let tail = seams(page).last
        XCTAssertEqual(tail?.top, 200)
        XCTAssertEqual(tail?.bottom, 300, "the whole of the empty page is still the hit area")
        XCTAssertEqual(tail?.line, 200 + MarkdownPreview.gapHeight / 2)
    }

    func testTheBarAboveTheFirstCellIsDrawnAgainstItToo() {
        // The head seam is the other tall one — the top margin of the
        // page — and it has no cell above it to sit under, so it sits
        // just above the cell it opens.
        let head = seams(page).first
        XCTAssertEqual(head?.top, 0)
        XCTAssertEqual(head?.line, 20 - MarkdownPreview.gapHeight / 2)
    }

    func testTheBarOnAnEmptyPageIsAtTheTopOfIt() {
        // No cell either side of it: what is typed appears at the top of
        // the page, so that is where the bar that types it goes.
        let empty = CellSeams.seams(cells: [], pageTop: 0, pageBottom: 420, noteLength: 0)
        XCTAssertEqual(empty.first?.line, MarkdownPreview.gapHeight / 2)
    }

    // MARK: - Seams too thin to hit

    func testASeamTooThinToHitIsWidenedAboutItsMiddle() {
        // Two cells 2 pt apart. The strip has to be hittable, so the cells
        // give way — evenly, so the line stays where the eye already put it.
        let tight: [CellSeams.Box] = [(20, 60, 0), (62, 100, 9)]
        let middle = seams(tight)[1]
        XCTAssertEqual(middle.line, 61, "the line does not move")
        XCTAssertEqual(middle.top, 61 - MarkdownPreview.gapHeight / 2)
        XCTAssertEqual(middle.bottom, 61 + MarkdownPreview.gapHeight / 2)
        // The minimum is the seam between two cells, and a caller that
        // wants a fatter one says so.
        let fat = CellSeams.seams(cells: tight, pageTop: 0, pageBottom: 300, noteLength: 44, minimum: 20)[1]
        XCTAssertEqual(fat.bottom - fat.top, 20)
        XCTAssertEqual(fat.line, 61)
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
        XCTAssertEqual(out[1], CellSeams.Seam(top: 60, bottom: 100, offset: 12, line: 64))
        XCTAssertEqual(out[2], CellSeams.Seam(top: 100, bottom: 140, offset: 30, line: 104))
    }

    func testTwoCellsThatOverlapDoNotFoldTheSeamBetweenThemInsideOut() {
        let overlapping: [CellSeams.Box] = [(20, 80, 0), (60, 120, 12)]
        let out = seams(overlapping)
        XCTAssertEqual(out.count, 3)
        XCTAssertTrue(out.allSatisfy { $0.top <= $0.bottom })
        XCTAssertEqual(out[1].line, 80, "the edge they share, widened enough to hit")
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

/// The page cut into bands for the POINTER.
///
/// The markdown pane's text view hands AppKit these as its cursor rects
/// rather than one I-beam over the whole of itself with the seam layer's
/// rects laid on top: two rects over one point and AppKit picks which
/// wins, and it kept picking the I-beam (Sean, 2026-09-20: "the mouse
/// cursor should reliably be horizontal between the cells"). Cut this way
/// no rect of the text view's own ever claims a seam.
final class PointerBandTests: XCTestCase {
    private let page: [CellSeams.Box] = [(20, 60, 0), (80, 120, 12), (140, 200, 30)]

    private var seams: [CellSeams.Seam] {
        CellSeams.seams(cells: page, pageTop: 0, pageBottom: 300, noteLength: 44)
    }

    private func bands(_ seams: [CellSeams.Seam],
                       top: CGFloat = 0, bottom: CGFloat = 300) -> [CellSeams.Band] {
        CellSeams.bands(seams: seams, pageTop: top, pageBottom: bottom)
    }

    func testTheBandsCoverThePageEndToEndWithNoOverlapAndNoHole() {
        let out = bands(seams)
        XCTAssertEqual(out.first?.top, 0)
        XCTAssertEqual(out.last?.bottom, 300)
        for (above, below) in zip(out, out.dropFirst()) {
            XCTAssertEqual(above.bottom, below.top, "a point in two bands, or in none")
        }
    }

    func testEverySeamIsABandOfItsOwnAndTheCellsAreTheRest() {
        let out = bands(seams)
        XCTAssertEqual(out.filter(\.horizontal).map { [$0.top, $0.bottom] },
                       [[0, 20], [60, 80], [120, 140], [200, 300]])
        XCTAssertEqual(out.filter { !$0.horizontal }.map { [$0.top, $0.bottom] },
                       [[20, 60], [80, 120], [140, 200]])
    }

    func testAPageWithNoSeamsIsOneOrdinaryBand() {
        // The pen is up: the layer is hidden, it hands over no seams at
        // all, and the pointer is nobody else's business.
        XCTAssertEqual(bands([]), [CellSeams.Band(top: 0, bottom: 300, horizontal: false)])
    }

    func testASeamRunningPastTheEndOfTheViewIsCutOffAtIt() {
        // The seams are measured over the whole document and the rects
        // are asked for in the view's bounds; the tail is routinely
        // taller than what is on screen.
        let out = bands(seams, bottom: 250)
        XCTAssertEqual(out.last, CellSeams.Band(top: 200, bottom: 250, horizontal: true))
    }

    func testTwoSeamsWidenedIntoEachOtherStillLeaveOneBandApiece() {
        // A cell shorter than the minimum has the seams either side of it
        // overlapping, and a band that ran backwards would be a cursor
        // rect AppKit throws away.
        let tight: [CellSeams.Box] = [(20, 60, 0), (62, 64, 9), (66, 100, 18)]
        let out = bands(CellSeams.seams(cells: tight, pageTop: 0, pageBottom: 300, noteLength: 30))
        XCTAssertFalse(out.isEmpty)
        XCTAssertTrue(out.allSatisfy { $0.bottom > $0.top },
                      "a band that runs backwards is a cursor rect AppKit throws away")
        for (above, below) in zip(out, out.dropFirst()) {
            XCTAssertEqual(above.bottom, below.top)
        }
        for y in stride(from: CGFloat(57), to: 69, by: 0.5) {
            XCTAssertTrue(out.contains { $0.horizontal && $0.top <= y && y < $0.bottom },
                          "\(y) is inside one of the two seams")
        }
    }
}
