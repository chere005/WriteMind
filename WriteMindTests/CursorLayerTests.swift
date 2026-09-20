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

/// The camera pane claims the arrow, so the pen's pencil cannot follow the
/// pointer out of the note (Sean, 2026-09-20: "cursor only becomes a pen in
/// the notes pane in drawing mode!!!!!").
final class CursorOutsideTheNoteTests: XCTestCase {
    func testTheLayerAnswersWithWhateverCursorItIsGiven() {
        let pane = CGRect(x: 0, y: 0, width: 300, height: 300)
        XCTAssertTrue(CursorLayer.CursorRectView.cursor(.arrow, at: CGPoint(x: 10, y: 10),
                                                        in: pane, wasInside: false) === NSCursor.arrow)
    }

    func testAClaimedArrowBeatsWhateverWasSetBefore() {
        // What the camera pane does: it claims the arrow for its own area,
        // so the pencil set over the note does not carry into it.
        let pane = CGRect(x: 0, y: 0, width: 300, height: 300)
        let inside = CursorLayer.CursorRectView.cursor(.arrow, at: CGPoint(x: 150, y: 150),
                                                       in: pane, wasInside: true)
        XCTAssertTrue(inside === NSCursor.arrow)
    }

    func testTheNoteStillGetsThePencilBack() {
        let pane = CGRect(x: 0, y: 0, width: 300, height: 300)
        XCTAssertTrue(CursorLayer.CursorRectView.cursor(DrawingCursors.pencil,
                                                        at: CGPoint(x: 150, y: 150),
                                                        in: pane, wasInside: false)
                      === DrawingCursors.pencil)
    }
}

/// The pen is not the source editor's (Sean, 2026-09-19: "drawing should be
/// allowed in either wysiwyg and markdown mode"). It lived beside the ink
/// bands until they went; it never had anything to do with them.
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
