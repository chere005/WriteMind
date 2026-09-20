import AppKit
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

    func testTheBarOnAnEmptyPageIsWhereTheFirstCellWillLand() {
        // No cell either side of it, so the PANE says where one would go
        // and the bar sits half a gap above that — the head seam's own
        // rule. Hard against the top of the page it was sixteen points
        // (source) or twenty-six (rendered) above the character it opens:
        // the same "the bar is not where the cell goes" complaint at the
        // other end of the page (2026-09-20).
        let empty = CellSeams.seams(cells: [], pageTop: 0, pageBottom: 420, noteLength: 0,
                                    firstCellTop: 30)
        XCTAssertEqual(empty.first?.line, 30 - MarkdownPreview.gapHeight / 2)
        XCTAssertEqual(empty.first?.top, 0, "the whole page is still the hit area")
        XCTAssertEqual(empty.first?.bottom, 420)
    }

    func testTheRenderedPagePutsAnEmptyNotesBarWhereAOneCellNotesBarIs() {
        // Through the pane's own call, because that is where the inset
        // is known: the first cell lands in the same place either way, so
        // the bar that opens it must too.
        let empty = MarkdownPreview.seams(rows: [], noteLength: 0, pageHeight: 600)
        let one = MarkdownPreview.seams(rows: [(id: 0, height: 30)], noteLength: 4, pageHeight: 600)
        XCTAssertEqual(empty.first?.line,
                       MarkdownPreview.topInset + MarkdownPreview.gapHeight
                           - MarkdownPreview.gapHeight / 2)
        XCTAssertEqual(empty.first?.line, one.first?.line)
    }

    func testTheSourcePaneDoesTheSameFromItsTextContainersInset() {
        let tv = PasteAwareTextView(usingTextLayoutManager: false)
        tv.frame = NSRect(x: 0, y: 0, width: 400, height: 600)
        tv.textContainerInset = NSSize(width: 24, height: 20)
        tv.string = ""
        let seams = MarkdownTextView.seams(in: tv)
        XCTAssertEqual(seams.count, 1)
        XCTAssertEqual(seams.first?.line, tv.textContainerOrigin.y - MarkdownPreview.gapHeight / 2)
        XCTAssertEqual(seams.first?.line, 16, "twenty points down, half a gap above the first line")
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

/// The + at the left-hand end of the bar, as the POINTER reads it.
///
/// Sean, 2026-09-20: "it should be a pointer over the + button". The +
/// is a button and the rest of the bar is not, so the one region both
/// panes read it from lives beside the line they both draw it on.
final class SeamPlusTests: XCTestCase {
    /// The ordinary eight points between two cells.
    private let seam = CellSeams.Seam(top: 60, bottom: 68, offset: 12, line: 64)
    /// And the tail, which is everything under the last cell.
    private let tail = CellSeams.Seam(top: 200, bottom: 600, offset: 44, line: 204)
    private let leading: CGFloat = CellInsertions.plusLeading

    func testTheTargetIsMoreGenerousThanTheDotItDraws() {
        // A ten-point dot on an eight-point bar is not a target anybody
        // hits exactly.
        let dot = CellSeams.plus(onTheLineAt: seam.line, leading: leading)
        let target = CellSeams.plusTarget(in: tail, leading: leading)
        XCTAssertGreaterThan(target.width, dot.width)
        XCTAssertGreaterThan(target.height, dot.height)
        XCTAssertLessThan(target.minX, dot.minX, "and slack on the outside edge too")
    }

    func testTheTargetNeverLeavesTheSeamItIsDrawnOn() {
        // The click cannot reach it from a cell — the layer takes no
        // mouse down outside a seam — so a pointer that turned into a
        // hand up in the cell above would promise a press that never
        // arrives.
        for seam in [seam, tail] {
            let target = CellSeams.plusTarget(in: seam, leading: leading)
            XCTAssertGreaterThanOrEqual(target.minY, seam.top, "\(seam)")
            XCTAssertLessThanOrEqual(target.maxY, seam.bottom, "\(seam)")
        }
        XCTAssertEqual(CellSeams.plusTarget(in: seam, leading: leading).height, 8,
                       "an ordinary seam is shorter than the slack, so the seam wins")
    }

    func testTheTargetDoesNotSwallowTheBarBesideIt() {
        // The bar runs from eighteen points in to the far margin and
        // arms the seam; only the + opens the menu.
        XCTAssertLessThanOrEqual(CellSeams.plusTarget(in: tail, leading: leading).maxX, 18)
        XCTAssertFalse(CellSeams.onPlus(CGPoint(x: 300, y: 204), of: tail, leading: leading),
                       "the middle of the bar is not the button")
    }

    func testTheTargetIsOnTheSeamsOwnLineAndNotTheMiddleOfIt() {
        // The tail seam is hundreds of points tall and its bar is drawn
        // hard under the last cell.
        let target = CellSeams.plusTarget(in: tail, leading: leading)
        XCTAssertTrue(CellSeams.onPlus(CGPoint(x: leading + 5, y: tail.line), of: tail, leading: leading))
        XCTAssertFalse(CellSeams.onPlus(CGPoint(x: leading + 5, y: 400), of: tail, leading: leading),
                       "the empty page below the bar is seam, not button")
        // Against the bar, give or take what the seam's own top edge
        // clips off it — and nowhere near the middle of four hundred
        // points of empty page.
        XCTAssertLessThan(abs(target.midY - tail.line), CellSeams.plusSize / 2 + CellSeams.plusGrip)
    }

    func testTheBottomEdgeOfASeamIsOnThePlusTheWayItIsInTheSeam() {
        // `Seam.contains` takes both its edges, and the + drawn across
        // an eight-point seam has to be pressable at the same points.
        XCTAssertTrue(seam.contains(seam.bottom))
        XCTAssertTrue(CellSeams.onPlus(CGPoint(x: 9, y: seam.bottom), of: seam, leading: leading))
    }
}

/// An idle re-measure is not a move.
///
/// The flicker (Sean, 2026-09-20: "it does flicker sometimes back to a
/// cursor"): both panes re-measure the seams off the text layout on
/// every keystroke, caret move, restyle and scroll, and every
/// difference tore the cursor rects down and built them again — with
/// the text view's upright I-beam in the gap.
final class SeamSteadinessTests: XCTestCase {
    private let page: [CellSeams.Box] = [(20, 60, 0), (80, 120, 12), (140, 200, 30)]

    private var measured: [CellSeams.Seam] {
        CellSeams.seams(cells: page, pageTop: 0, pageBottom: 300, noteLength: 44)
    }

    /// The same layout measured again, a few thousandths of a point out.
    private func remeasured(_ seams: [CellSeams.Seam]) -> [CellSeams.Seam] {
        seams.map {
            CellSeams.Seam(top: $0.top + 0.004, bottom: $0.bottom - 0.002,
                           offset: $0.offset, line: $0.line + 0.003)
        }
    }

    func testTheSameLayoutMeasuredAgainIsNotAMove() {
        let was = measured
        let again = remeasured(was)
        XCTAssertNotEqual(again, was, "the premise: the floats really do differ")
        XCTAssertFalse(CellSeams.moved(again, from: was),
                       "a hundredth of a point is not a seam moving")
        XCTAssertFalse(CellSeams.moved(was, from: was))
    }

    func testASeamThatHasReallyMovedIsAMove() {
        let was = measured
        var shifted = was
        shifted[1] = CellSeams.Seam(top: was[1].top + 14, bottom: was[1].bottom + 14,
                                    offset: was[1].offset, line: was[1].line + 14)
        XCTAssertTrue(CellSeams.moved(shifted, from: was), "a line of text was added above it")
        XCTAssertTrue(CellSeams.moved(Array(was.dropLast()), from: was), "a cell went")
        var renumbered = was
        renumbered[2] = CellSeams.Seam(top: was[2].top, bottom: was[2].bottom,
                                       offset: was[2].offset + 1, line: was[2].line)
        XCTAssertTrue(CellSeams.moved(renumbered, from: was),
                      "a character before it moves what it opens, not where it is")
    }

    func testTheToleranceIsBelowWhatAnEyeCanSeeAndNotAPointMore() {
        // Half a point: a seam that has moved by a visible pixel is a
        // move, or the bar would be drawn off the gap it belongs to.
        let was = measured
        let nudged = was.map {
            CellSeams.Seam(top: $0.top + 1, bottom: $0.bottom + 1, offset: $0.offset, line: $0.line + 1)
        }
        XCTAssertTrue(CellSeams.moved(nudged, from: was))
    }
}

/// A rect with a hole cut out of it, which is how the + gets its own
/// cursor without two rects over one point (AGENTS.md: "Being ABOVE the
/// text view does not win the cursor either").
final class SeamCutTests: XCTestCase {
    private let strip = CGRect(x: 0, y: 60, width: 400, height: 8)

    func testAHoleThatTouchesNothingLeavesTheRectWhole() {
        XCTAssertEqual(CellSeams.cut(strip, around: CGRect(x: 0, y: 200, width: 18, height: 18)), [strip])
        XCTAssertEqual(CellSeams.cut(strip, around: .null), [strip])
        XCTAssertEqual(CellSeams.cut(strip, around: .zero), [strip])
    }

    func testThePlusHoleLeavesTheRestOfTheBarBesideIt() {
        let seam = CellSeams.Seam(top: 60, bottom: 68, offset: 12, line: 64)
        let hole = CellSeams.plusTarget(in: seam, leading: CellInsertions.plusLeading)
        let rest = CellSeams.cut(strip, around: hole)
        XCTAssertEqual(rest, [CGRect(x: hole.maxX, y: 60, width: 400 - hole.maxX, height: 8)],
                       "the + is at the left-hand end, so what is left is one piece")
    }

    func testThePiecesCoverTheRestOfTheRectAndNoneOfTheHole() {
        let hole = CGRect(x: 100, y: 62, width: 20, height: 3)
        let pieces = CellSeams.cut(strip, around: hole)
        XCTAssertEqual(pieces.count, 4, "above, below, left and right of it")
        XCTAssertEqual(pieces.reduce(0) { $0 + $1.width * $1.height },
                       strip.width * strip.height - hole.width * hole.height, accuracy: 0.001)
        for piece in pieces {
            XCTAssertTrue(piece.intersection(hole).isEmpty, "\(piece) is over the +")
            XCTAssertEqual(piece.intersection(strip), piece, "\(piece) is outside the seam")
        }
        for (one, other) in pieces.enumerated().flatMap({ index, piece in
            pieces.dropFirst(index + 1).map { (piece, $0) }
        }) {
            XCTAssertTrue(one.intersection(other).isEmpty, "\(one) and \(other) overlap")
        }
    }

    func testAHoleThatCoversTheWholeRectLeavesNothing() {
        XCTAssertEqual(CellSeams.cut(strip, around: strip.insetBy(dx: -10, dy: -10)), [])
    }
}
