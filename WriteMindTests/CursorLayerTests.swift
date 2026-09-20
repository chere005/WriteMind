import AppKit
import XCTest
@testable import WriteMind

/// The pen's pencil belongs to the note pane and nowhere else.
final class CursorLayerTests: XCTestCase {
    private let pane = CGRect(x: 0, y: 0, width: 400, height: 600)

    private func cursor(at point: CGPoint, wasInside: Bool,
                        _ cursor: NSCursor? = DrawingCursors.pencil) -> NSCursor? {
        CursorLayer.CursorRectView.cursor(cursor, at: point, in: pane, wasInside: wasInside)
    }

    func testThePencilIsShownOverTheNote() {
        XCTAssertTrue(cursor(at: CGPoint(x: 200, y: 300), wasInside: false) === DrawingCursors.pencil)
        XCTAssertTrue(cursor(at: CGPoint(x: 200, y: 300), wasInside: true) === DrawingCursors.pencil)
    }

    func testLeavingTheNoteTakesThePencilBack() {
        // The camera pane sets no cursor of its own, so the pencil would
        // stick there unless the arrow is put back on the way out.
        XCTAssertTrue(cursor(at: CGPoint(x: 900, y: 300), wasInside: true) === NSCursor.arrow)
    }

    func testNothingIsForcedOnAPointerThatWasNeverOverTheNote() {
        // Otherwise every mouse move anywhere in the window would fight the
        // split divider's resize cursor and the gutter's pointing hand.
        XCTAssertNil(cursor(at: CGPoint(x: 900, y: 300), wasInside: false))
    }

    func testWithThePenDownTheLayerAsksForNothing() {
        XCTAssertNil(cursor(at: CGPoint(x: 200, y: 300), wasInside: true, nil))
        XCTAssertNil(cursor(at: CGPoint(x: 900, y: 300), wasInside: true, nil))
    }
}
