import AppKit
import XCTest
@testable import WriteMind

/// The two keys held during a placement (Sean, 2026-09-21: "when placing a
/// marker, if i hold cmd, stay in adding that marker mode.. if i hold
/// shift, the direction elements become fixed to horizontal or vertical
/// axes").
final class PlacementModifierTests: XCTestCase {
    private let size = CGSize(width: 400, height: 300)

    // MARK: - ⇧ holds a line to an axis

    func testADragMostlySidewaysGoesFlatAndOneMostlyDownGoesUpright() {
        let from = CGPoint(x: 100, y: 100)
        XCTAssertEqual(CanvasGeometry.onAxis(CGPoint(x: 220, y: 130), from: from),
                       CGPoint(x: 220, y: 100), "nearer the horizontal")
        XCTAssertEqual(CanvasGeometry.onAxis(CGPoint(x: 130, y: 220), from: from),
                       CGPoint(x: 100, y: 220), "nearer the vertical")
        // Backwards and upwards are the same question.
        XCTAssertEqual(CanvasGeometry.onAxis(CGPoint(x: 10, y: 90), from: from),
                       CGPoint(x: 10, y: 100))
        XCTAssertEqual(CanvasGeometry.onAxis(CGPoint(x: 95, y: 10), from: from),
                       CGPoint(x: 100, y: 10))
    }

    func testTheLengthAlongTheAxisIsKeptRatherThanTheLengthOfTheDrag() {
        // The end stays under the pointer in the direction that is left;
        // rounding the ANGLE would slide it away from the pointer instead.
        let end = CanvasGeometry.onAxis(CGPoint(x: 300, y: 140), from: CGPoint(x: 100, y: 100))
        XCTAssertEqual(end.x, 300)
    }

    func testAnUnheldDragIsNotTouched() {
        let to = CGPoint(x: 220, y: 130)
        XCTAssertEqual(CanvasGeometry.onAxis(to, from: CGPoint(x: 100, y: 100), locked: false), to)
    }

    func testOnlySomethingWithADirectionIsHeldToAnAxis() {
        let from = CGPoint(x: 100, y: 100), to = CGPoint(x: 220, y: 130)
        let arrow = CanvasPlacement.line(start: .none, end: .arrow)
        let tick = CanvasPlacement.shape(.check)
        XCTAssertTrue(arrow.hasDirection)
        XCTAssertFalse(tick.hasDirection, "a mark is square already")
        XCTAssertEqual(arrow.end(to, from: from, modifiers: .shift), CGPoint(x: 220, y: 100))
        XCTAssertEqual(tick.end(to, from: from, modifiers: .shift), to, "⇧ means nothing over a mark")
        XCTAssertEqual(arrow.end(to, from: from, modifiers: []), to)
    }

    func testAnArrowHeldToAnAxisIsPutDownOnThatAxis() {
        let from = CGPoint(x: 100, y: 100)
        let placing = CanvasPlacement.line(start: .none, end: .arrow)
        let to = placing.end(CGPoint(x: 300, y: 140), from: from, modifiers: .shift)
        guard case .connector(let line)? = placing.item(from: from, to: to, in: size,
                                                        colorHex: "#ffffff", lineWidth: 3)
        else { return XCTFail("no arrow") }
        XCTAssertEqual(line.start.y, line.end.y, accuracy: 0.0001, "flat, in the pane's fractions")
        XCTAssertEqual(line.end.x, 300 / size.width, accuracy: 0.0001)
    }

    /// The arrow tool and an ⌥-drag off a node build their line by hand,
    /// so they ask the canvas rather than the placement — and have to get
    /// the same answer.
    func testTheArrowToolHoldsTheSameAxis() {
        let from = CGPoint(x: 100, y: 100), to = CGPoint(x: 300, y: 140)
        XCTAssertEqual(DrawingCanvas.dragEnd(to, from: from, modifiers: .shift),
                       CanvasPlacement.line(start: .none, end: .arrow)
                           .end(to, from: from, modifiers: .shift))
        XCTAssertEqual(DrawingCanvas.dragEnd(to, from: from, modifiers: []), to)
    }

    // MARK: - ⌘ keeps the tool

    func testCommandKeepsTheToolAndNothingElseDoes() {
        XCTAssertTrue(CanvasPlacement.staysArmed(.command))
        XCTAssertTrue(CanvasPlacement.staysArmed([.command, .shift]),
                      "a row of arrows, all of them flat")
        XCTAssertFalse(CanvasPlacement.staysArmed([]))
        XCTAssertFalse(CanvasPlacement.staysArmed(.shift))
        XCTAssertFalse(CanvasPlacement.staysArmed(.option))
    }
}
