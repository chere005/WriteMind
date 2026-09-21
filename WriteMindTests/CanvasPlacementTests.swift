import XCTest
@testable import WriteMind

/// A shape starts where the drag starts and ends where it ends (Sean,
/// 2026-09-19); a click still puts one down at its own size.
final class CanvasPlacementTests: XCTestCase {
    private let pane = CGSize(width: 800, height: 600)

    func testANodeTakesExactlyTheRectangleThatWasDragged() throws {
        let shape = try XCTUnwrap(CanvasPlacement.shape(.rectangle, from: CGPoint(x: 100, y: 100),
                                                        to: CGPoint(x: 300, y: 200), in: pane,
                                                        colorHex: "#000000", lineWidth: 2))
        XCTAssertEqual(shape.center.x, 200 / 800, accuracy: 0.0001)
        XCTAssertEqual(shape.center.y, 150 / 600, accuracy: 0.0001)
        XCTAssertEqual(shape.width, 200 / 800, accuracy: 0.0001)
        XCTAssertEqual(shape.aspect, 100 / 200, accuracy: 0.0001, "the box's own shape, not the default")
    }

    func testDraggingBackwardsIsTheSameRectangle() throws {
        let forward = try XCTUnwrap(CanvasPlacement.shape(.oval, from: CGPoint(x: 100, y: 100),
                                                          to: CGPoint(x: 300, y: 200), in: pane,
                                                          colorHex: "#000000", lineWidth: 2))
        let back = try XCTUnwrap(CanvasPlacement.shape(.oval, from: CGPoint(x: 300, y: 200),
                                                       to: CGPoint(x: 100, y: 100), in: pane,
                                                       colorHex: "#000000", lineWidth: 2))
        XCTAssertEqual(forward.center, back.center)
        XCTAssertEqual(forward.width, back.width, accuracy: 0.0001)
    }

    func testAMarkKeepsItsSquareAndGrowsTheWayTheDragWent() {
        let down = CanvasPlacement.box(from: CGPoint(x: 100, y: 100), to: CGPoint(x: 160, y: 130),
                                       kind: .check, in: pane)
        XCTAssertEqual(down, CGRect(x: 100, y: 100, width: 60, height: 60), "square, anchored at the start")
        let up = CanvasPlacement.box(from: CGPoint(x: 100, y: 100), to: CGPoint(x: 40, y: 60),
                                     kind: .check, in: pane)
        XCTAssertEqual(up, CGRect(x: 40, y: 40, width: 60, height: 60), "and it can go up and left")
    }

    func testAClickPutsTheShapeDownAtItsOwnSizeWhereItWasClicked() throws {
        let click = CGPoint(x: 400, y: 300)
        let box = CanvasPlacement.box(from: click, to: CGPoint(x: click.x + 2, y: click.y - 1),
                                      kind: .rectangle, in: pane)
        XCTAssertEqual(box.midX, 400, accuracy: 0.001)
        XCTAssertEqual(box.midY, 300, accuracy: 0.001)
        XCTAssertEqual(box.width, 0.18 * 800, accuracy: 0.001, "the size the button used to give it")
        let shape = try XCTUnwrap(CanvasPlacement.shape(.rectangle, from: click, to: click, in: pane,
                                                        colorHex: "#000000", lineWidth: 2))
        XCTAssertEqual(shape.aspect, ShapeItem.Kind.rectangle.defaultAspect, accuracy: 0.0001)
    }

    func testATinyDragIsAClickAndARealOneIsNot() {
        XCTAssertFalse(CanvasPlacement.isDrag(from: .zero, to: CGPoint(x: 3, y: 3)))
        XCTAssertTrue(CanvasPlacement.isDrag(from: .zero, to: CGPoint(x: 5, y: 0)))
    }

    func testNothingSmallerThanTheMinimumGoesDown() {
        let box = CanvasPlacement.box(from: CGPoint(x: 10, y: 10), to: CGPoint(x: 16, y: 40),
                                      kind: .rectangle, in: pane)
        XCTAssertEqual(box.width, CanvasPlacement.minimumSide, accuracy: 0.001)
        XCTAssertEqual(box.height, 30, accuracy: 0.001, "the side that was big enough is untouched")
    }

    func testALineRunsFromTheStartOfTheDragToItsEnd() throws {
        let line = try XCTUnwrap(CanvasPlacement.connector(from: CGPoint(x: 80, y: 60),
                                                           to: CGPoint(x: 400, y: 300), in: pane,
                                                           startHead: .none, endHead: .arrow,
                                                           colorHex: "#000000", lineWidth: 3))
        XCTAssertEqual(line.start.x, 0.1, accuracy: 0.0001)
        XCTAssertEqual(line.start.y, 0.1, accuracy: 0.0001)
        XCTAssertEqual(line.end.x, 0.5, accuracy: 0.0001)
        XCTAssertEqual(line.end.y, 0.5, accuracy: 0.0001)
        XCTAssertEqual(line.endHead, .arrow)
        XCTAssertNil(line.startNode, "a line from the palette is attached to nothing")
    }

    func testALineRunsFromThePressToTheReleaseAndNowhereElse() throws {
        // Sean, 2026-09-21: "click starts the beginning, release is the
        // end of the arrow".
        let line = try XCTUnwrap(CanvasPlacement.connector(from: CGPoint(x: 200, y: 150),
                                                           to: CGPoint(x: 600, y: 450), in: pane,
                                                           startHead: .none, endHead: .arrow,
                                                           colorHex: "#000000", lineWidth: 3))
        XCTAssertEqual(line.start.x, 0.25, accuracy: 0.0001)
        XCTAssertEqual(line.start.y, 0.25, accuracy: 0.0001)
        XCTAssertEqual(line.end.x, 0.75, accuracy: 0.0001)
        XCTAssertEqual(line.end.y, 0.75, accuracy: 0.0001)
    }

    func testAPressThatNeverMovedPutsDownNoLineAtAll() {
        // It used to put down a short horizontal one, centred on the
        // click: a different line from the one asked for, in a different
        // place. Nothing, and the tool stays armed for the next try.
        XCTAssertNil(CanvasPlacement.connector(from: CGPoint(x: 400, y: 300),
                                               to: CGPoint(x: 401, y: 300), in: pane,
                                               startHead: .none, endHead: .none,
                                               colorHex: "#000000", lineWidth: 3))
    }

    func testTheArmedObjectComesBackAsACanvasItem() throws {
        let shape = try XCTUnwrap(CanvasPlacement.shape(.star).item(from: .zero, to: CGPoint(x: 60, y: 60),
                                                                    in: pane, colorHex: "#FF0000", lineWidth: 4))
        XCTAssertNotNil(shape.shape)
        let line = try XCTUnwrap(CanvasPlacement.line(start: .arrow, end: .arrow)
            .item(from: .zero, to: CGPoint(x: 60, y: 60), in: pane, colorHex: "#FF0000", lineWidth: 4))
        XCTAssertNotNil(line.connector)
        XCTAssertEqual(CanvasPlacement.line(start: .arrow, end: .arrow).title, "Double-headed Arrow")
        XCTAssertEqual(CanvasPlacement.shape(.check).title, "Check Mark")
    }
}
