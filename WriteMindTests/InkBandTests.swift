import XCTest
@testable import WriteMind

/// A drawing opens one gap in the text, as tall as the drawing.
final class InkBandTests: XCTestCase {
    private let pane = CGSize(width: 400, height: 800)

    /// A stroke from one normalised point to another.
    private func ink(from: CGPoint, to: CGPoint) -> CanvasItem {
        .stroke(Stroke(colorHex: "#000000", width: 2, points: [from, to]))
    }

    func testInkReservesABandOfItsOwn() {
        // It did not before: only pictures and text boxes pushed the text
        // aside, so a sketch and the words ran through each other.
        let bands = InkBands.bands(for: [ink(from: CGPoint(x: 0.2, y: 0.25), to: CGPoint(x: 0.6, y: 0.4))],
                                   in: pane)
        XCTAssertEqual(bands.count, 1)
        XCTAssertEqual(bands[0].minY, 200, accuracy: 2)
        XCTAssertEqual(bands[0].maxY, 320, accuracy: 2)
    }

    func testOneSketchIsOneBandHoweverManyStrokesItTook() {
        let strokes = (0..<12).map { i in
            ink(from: CGPoint(x: 0.2 + Double(i) * 0.02, y: 0.30),
                to: CGPoint(x: 0.25 + Double(i) * 0.02, y: 0.30 + Double(i % 3) * 0.03))
        }
        let bands = InkBands.bands(for: strokes, in: pane)
        XCTAssertEqual(bands.count, 1, "forty strokes must not open forty gaps")
        XCTAssertEqual(bands[0].minY, 240, accuracy: 2)
        XCTAssertEqual(bands[0].maxY, 288, accuracy: 2)
    }

    func testTwoDrawingsFarApartKeepTheirOwnBands() {
        let bands = InkBands.bands(for: [ink(from: CGPoint(x: 0.1, y: 0.1), to: CGPoint(x: 0.3, y: 0.15)),
                                         ink(from: CGPoint(x: 0.1, y: 0.7), to: CGPoint(x: 0.3, y: 0.75))],
                                   in: pane)
        XCTAssertEqual(bands.count, 2)
        XCTAssertLessThan(bands[0].maxY, bands[1].minY)
    }

    func testStrokesThatAllButTouchCountAsOne() {
        // Within the gap: the second stroke starts 4pt below the first ends.
        let bands = InkBands.bands(for: [ink(from: CGPoint(x: 0.1, y: 0.10), to: CGPoint(x: 0.3, y: 0.20)),
                                         ink(from: CGPoint(x: 0.1, y: 0.205), to: CGPoint(x: 0.3, y: 0.30))],
                                   in: pane)
        XCTAssertEqual(bands.count, 1)
        XCTAssertEqual(bands[0].height, 160, accuracy: 4)
    }

    func testABandsAreInOrderDownThePage() {
        let bands = InkBands.bands(for: [ink(from: CGPoint(x: 0.1, y: 0.8), to: CGPoint(x: 0.3, y: 0.85)),
                                         ink(from: CGPoint(x: 0.1, y: 0.1), to: CGPoint(x: 0.3, y: 0.15))],
                                   in: pane)
        XCTAssertEqual(bands.map { Int($0.minY) }.sorted(), bands.map { Int($0.minY) })
    }

    func testNothingIsReservedBeforeThePaneHasASize() {
        XCTAssertTrue(InkBands.bands(for: [ink(from: .zero, to: CGPoint(x: 1, y: 1))],
                                     in: CGSize(width: 0, height: 0)).isEmpty)
    }
}

/// The pen is not the source editor's (Sean, 2026-09-19: "drawing should be
/// allowed in either wysiwyg and markdown mode").
@MainActor
final class PenAcrossModesTests: XCTestCase {
    private func state() -> AppState {
        AppState(defaults: UserDefaults(suiteName: "WriteMindTests-\(UUID().uuidString)")!)
    }

    func testThePenStaysUpWhenTheRenderedPageComesUp() {
        let app = state()
        app.penActive = true
        app.toggleMode()
        XCTAssertEqual(app.mode, .preview)
        XCTAssertTrue(app.penActive, "the pen used to be put down by the switch")
        app.toggleMode()
        XCTAssertTrue(app.penActive)
    }
}

/// A drawing is a cell of the notebook, as tall as the drawing (Sean,
/// 2026-09-19: "drawings from the pen tool or that are grabbed from the
/// camera should go in a cell.. the cell is the height of the drawn stuff").
final class InkCellTests: XCTestCase {
    private let textCells: [(top: CGFloat, depth: Int)] = [(top: 0, depth: 1), (top: 200, depth: 2),
                                                           (top: 500, depth: 1)]

    func testEveryBandGetsACellAsTallAsItIs() {
        let cells = InkBands.cells(for: [CGRect(x: 0, y: 220, width: 300, height: 140)], beside: textCells)
        XCTAssertEqual(cells.count, 1)
        XCTAssertEqual(cells[0].top, 220)
        XCTAssertEqual(cells[0].bottom, 360)
    }

    func testADrawingIsBracketedInsideTheSectionItSitsIn() {
        // The depth of the text cell above it, so the bracket lines up with
        // its neighbours instead of starting a level of its own.
        XCTAssertEqual(InkBands.cells(for: [CGRect(x: 0, y: 240, width: 10, height: 20)],
                                      beside: textCells)[0].depth, 2)
        XCTAssertEqual(InkBands.cells(for: [CGRect(x: 0, y: 600, width: 10, height: 20)],
                                      beside: textCells)[0].depth, 1)
    }

    func testADrawingAboveTheFirstCellTakesThatCellsDepth() {
        XCTAssertEqual(InkBands.cells(for: [CGRect(x: 0, y: -40, width: 10, height: 20)],
                                      beside: textCells)[0].depth, 1)
    }

    func testAnEmptyPageHasNoInkCells() {
        XCTAssertTrue(InkBands.cells(for: [], beside: textCells).isEmpty)
        XCTAssertTrue(InkBands.cells(for: [CGRect(x: 0, y: 10, width: 10, height: 0)],
                                     beside: textCells).isEmpty)
    }

    func testTwoDrawingsGetTwoCells() {
        let cells = InkBands.cells(for: [CGRect(x: 0, y: 20, width: 10, height: 30),
                                         CGRect(x: 0, y: 300, width: 10, height: 30)],
                                   beside: textCells)
        XCTAssertEqual(cells.count, 2)
        XCTAssertNotEqual(cells[0].key, cells[1].key)
    }
}

/// The text holds still while something is being nudged over it (Sean,
/// 2026-09-19: "when moving contents, when close to an edge things are
/// jittery.. give some padding").
final class BandSettlingTests: XCTestCase {
    private func band(_ y: CGFloat, height: CGFloat = 80) -> CGRect {
        CGRect(x: 0, y: y, width: 300, height: height)
    }

    func testASmallNudgeDoesNotMoveTheHoleInTheText() {
        let settled = BandSettling.settled([band(206)], previous: [band(200)])
        XCTAssertEqual(settled, [band(200)], "six points is not worth relaying the page out for")
    }

    func testARealMoveDoes() {
        let settled = BandSettling.settled([band(260)], previous: [band(200)])
        XCTAssertEqual(settled, [band(260)])
    }

    func testTheHoleFollowsOnceThePaddingIsPassed() {
        // Nudge by nudge, the band stays put until one step crosses the
        // padding — and then it lands exactly where the object is, with no
        // accumulated drift.
        var settled = [band(200)]
        for y in stride(from: CGFloat(202), through: 210, by: 2) {
            settled = BandSettling.settled([band(y)], previous: settled)
            XCTAssertEqual(settled, [band(200)])
        }
        settled = BandSettling.settled([band(213)], previous: settled)
        XCTAssertEqual(settled, [band(213)])
    }

    func testAGrowingBandIsNotHeldBack() {
        // A stroke added to a sketch makes its band taller, which is a real
        // change, not a nudge.
        XCTAssertEqual(BandSettling.settled([band(200, height: 240)], previous: [band(200)]),
                       [band(200, height: 240)])
    }

    func testANewBandArrivesAtOnce() {
        let settled = BandSettling.settled([band(100), band(600)], previous: [band(100)])
        XCTAssertEqual(settled, [band(100), band(600)])
    }

    func testABandThatWentAwayTakesItsHoleWithIt() {
        XCTAssertEqual(BandSettling.settled([], previous: [band(100)]), [])
    }

    func testTwoBandsEachKeepTheirOwnPlace() {
        // The nearest match, not the first: two objects nudged at once must
        // not swap holes.
        let settled = BandSettling.settled([band(104), band(504)], previous: [band(100), band(500)])
        XCTAssertEqual(settled, [band(100), band(500)])
    }

    func testTheFirstLayoutTakesWhatItIsGiven() {
        XCTAssertEqual(BandSettling.settled([band(100)], previous: []), [band(100)])
    }
}
