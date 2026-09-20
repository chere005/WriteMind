import XCTest
@testable import WriteMind

/// Where a dragged floating thing ends up (Sean, 2026-09-19: "moving a
/// floating thing out of that box moves it into another floating cell, or
/// above the next fixed cell").
final class FloatingHomingTests: XCTestCase {
    private let cells = [
        FloatingHoming.CellBox(anchor: 0, top: 0, bottom: 100),
        FloatingHoming.CellBox(anchor: 40, top: 120, bottom: 200),
        FloatingHoming.CellBox(anchor: 90, top: 400, bottom: 500),
    ]

    private func thing(_ y: CGFloat, height: CGFloat = 20) -> CGRect {
        CGRect(x: 10, y: y, width: 60, height: height)
    }

    func testInsideItsOwnBoxItStaysWhereItBelongs() {
        XCTAssertEqual(FloatingHoming.home(for: thing(140), in: cells), 40)
        XCTAssertEqual(FloatingHoming.home(for: thing(10), in: cells), 0)
    }

    func testDroppedInAnotherBoxItJoinsThatCell() {
        XCTAssertEqual(FloatingHoming.home(for: thing(440), in: cells), 90)
    }

    func testOutOfEveryBoxItGoesAboveTheNextFixedCell() {
        // Between cell 40 (ends 200) and cell 90 (starts 400).
        XCTAssertEqual(FloatingHoming.home(for: thing(300), in: cells), 90)
    }

    func testPastTheLastCellItBelongsToTheLastOne() {
        XCTAssertEqual(FloatingHoming.home(for: thing(900), in: cells), 90)
    }

    func testAboveEverythingItBelongsToTheFirst() {
        XCTAssertEqual(FloatingHoming.home(for: thing(-200), in: cells), 0)
    }

    func testACellOfNothingButDrawingsCanBeJoinedButIsNotTheNextFixedCell() {
        var boxes = cells
        boxes.append(FloatingHoming.CellBox(anchor: 70, top: 240, bottom: 320, isText: false))
        // Dropped in the floating cell: it joins it.
        XCTAssertEqual(FloatingHoming.home(for: thing(260), in: boxes), 70)
        // Dropped in the gap above it: the next FIXED cell is 90, not 70.
        XCTAssertEqual(FloatingHoming.home(for: thing(225), in: boxes), 90)
    }

    func testANoteWithNoCellsHomesNothing() {
        XCTAssertNil(FloatingHoming.home(for: thing(10), in: []))
    }

    // MARK: - The outermost box

    func testACellsBoxGrowsToHoldWhatFloatsInIt() {
        let boxes = FloatingHoming.boxes(cells: cells,
                                         floating: [(anchor: 40, box: CGRect(x: 0, y: 90, width: 50,
                                                                             height: 160))])
        let cell = boxes.first { $0.anchor == 40 }
        XCTAssertEqual(cell?.top, 90, "up to the top of the picture")
        XCTAssertEqual(cell?.bottom, 250, "and down to the bottom of it")
    }

    func testEverythingInOneCellSharesOneBox() {
        let boxes = FloatingHoming.boxes(cells: cells, floating: [
            (anchor: 0, box: CGRect(x: 0, y: -30, width: 20, height: 20)),
            (anchor: 0, box: CGRect(x: 0, y: 150, width: 20, height: 20)),
        ])
        let cell = boxes.first { $0.anchor == 0 }
        XCTAssertEqual(cell?.top, -30)
        XCTAssertEqual(cell?.bottom, 170, "one outermost box round both of them")
        // And a thing dropped between them is still in that cell.
        XCTAssertEqual(FloatingHoming.home(for: thing(60), in: boxes), 0)
    }

    func testAnUnanchoredThingChangesNoBox() {
        XCTAssertEqual(FloatingHoming.boxes(cells: cells,
                                            floating: [(anchor: nil, box: thing(9_000))]), cells)
    }
}

/// Nothing floats in a void: a cell drawn on the empty page below the note
/// follows the cell above it (Sean, 2026-09-20: "all cells are next to
/// eachother, there's random space between cells here").
final class FloatingFollowsTests: XCTestCase {
    private let pane = CGSize(width: 400, height: 1000)

    private func picture(at y: Double, height: Double) -> CanvasItem {
        .image(ImageItem(file: "a.png", center: CGPoint(x: 0.5, y: y), width: 0.4,
                         aspect: height / 0.4))
    }

    func testSomethingDrawnFarBelowIsPulledUpToFollowItsCell() {
        let item = picture(at: 0.8, height: 0.1)
        let moved = CanvasAnchors.placed(item, atTop: 260, in: pane)
        XCTAssertEqual(moved.bounds(in: pane).minY, 260, accuracy: 0.5)
        XCTAssertEqual(moved.bounds(in: pane).height, item.bounds(in: pane).height, accuracy: 0.5,
                       "it is moved, not resized")
    }

    func testSomethingBesideItsCellIsLeftWhereItWas() {
        // The rule only pulls up what is BELOW the cell it belongs to.
        let cell = FloatingHoming.CellBox(anchor: 0, top: 100, bottom: 240)
        let beside = CGRect(x: 0, y: 150, width: 80, height: 60)
        XCTAssertFalse(beside.minY > cell.bottom + MarkdownPreview.gapHeight + 1)
    }

    func testTheVoidIsMeasuredFromTheCellsBottom() {
        let cell = FloatingHoming.CellBox(anchor: 0, top: 100, bottom: 240)
        let below = CGRect(x: 0, y: 700, width: 80, height: 60)
        XCTAssertTrue(below.minY > cell.bottom + MarkdownPreview.gapHeight + 1)
    }
}
