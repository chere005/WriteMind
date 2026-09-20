import XCTest
@testable import WriteMind

/// Zooming the video pane into a dragged box, and finding the way back —
/// what the capture button needs to bring in what is on screen.
final class CameraZoomTests: XCTestCase {
    private let pane = CGSize(width: 800, height: 600)

    func testTheBoxIsBlownUpUntilItFillsThePane() {
        let box = CGRect(x: 0.25, y: 0.25, width: 0.5, height: 0.5)   // 400 × 300 in the middle
        XCTAssertEqual(CameraZoom.scale(of: box, in: pane), 2, accuracy: 0.001)
        // Already centred, so it does not have to move.
        let offset = CameraZoom.offset(of: box, in: pane)
        XCTAssertEqual(offset.width, 0, accuracy: 0.001)
        XCTAssertEqual(offset.height, 0, accuracy: 0.001)
    }

    func testABoxOffToOneSideIsBroughtToTheMiddle() {
        let box = CGRect(x: 0, y: 0, width: 0.5, height: 0.5)
        let offset = CameraZoom.offset(of: box, in: pane)
        XCTAssertEqual(offset.width, 400, accuracy: 0.001, "its centre moves to the pane's")
        XCTAssertEqual(offset.height, 300, accuracy: 0.001)
    }

    func testAPointOnTheZoomedPaneIsFoundOnTheRealPicture() {
        let box = CGRect(x: 0.25, y: 0.25, width: 0.5, height: 0.5)
        // The middle of the zoomed pane is the middle of the box.
        let middle = CameraZoom.unzoomed(CGPoint(x: 400, y: 300), box: box, in: pane)
        XCTAssertEqual(middle.x, 400, accuracy: 0.001)
        XCTAssertEqual(middle.y, 300, accuracy: 0.001)
        // Its top-left corner is the box's top-left corner.
        let corner = CameraZoom.unzoomed(CGPoint(x: 0, y: 0), box: box, in: pane)
        XCTAssertEqual(corner.x, 200, accuracy: 0.001)
        XCTAssertEqual(corner.y, 150, accuracy: 0.001)
    }

    func testARectDrawnOnTheZoomedPaneComesBackSmaller() {
        let box = CGRect(x: 0.25, y: 0.25, width: 0.5, height: 0.5)
        let drawn = CGRect(x: 200, y: 150, width: 400, height: 300)
        let real = CameraZoom.unzoomed(drawn, box: box, in: pane)
        XCTAssertEqual(real.width, 200, accuracy: 0.001, "half the size, since the pane is doubled")
        XCTAssertEqual(real.height, 150, accuracy: 0.001)
    }

    func testZoomingTwiceComposesIntoOneBoxOfTheWholePicture() throws {
        let first = try XCTUnwrap(CameraZoom.compose(CGRect(x: 200, y: 150, width: 400, height: 300),
                                                     over: nil, in: pane))
        XCTAssertEqual(first, CGRect(x: 0.25, y: 0.25, width: 0.5, height: 0.5))
        // Now the middle half of the ZOOMED pane: a quarter of the picture.
        let second = try XCTUnwrap(CameraZoom.compose(CGRect(x: 200, y: 150, width: 400, height: 300),
                                                      over: first, in: pane))
        XCTAssertEqual(second.width, 0.25, accuracy: 0.001)
        XCTAssertEqual(second.height, 0.25, accuracy: 0.001)
        XCTAssertEqual(second.midX, 0.5, accuracy: 0.001, "still round the middle")
    }

    func testASpeckOfABoxIsNotAZoom() {
        XCTAssertNil(CameraZoom.compose(CGRect(x: 10, y: 10, width: 4, height: 4), over: nil, in: pane))
        XCTAssertFalse(CameraZoom.isUsable(CGRect(x: 0, y: 0, width: 0.01, height: 0.5)))
        XCTAssertTrue(CameraZoom.isUsable(CGRect(x: 0, y: 0, width: 0.2, height: 0.2)))
    }

    func testABoxDraggedPastTheEdgeIsClipped() throws {
        let box = try XCTUnwrap(CameraZoom.compose(CGRect(x: -100, y: -100, width: 400, height: 300),
                                                   over: nil, in: pane))
        XCTAssertEqual(box.minX, 0, accuracy: 0.001)
        XCTAssertEqual(box.minY, 0, accuracy: 0.001)
    }

    func testNoZoomMeansNoChange() {
        XCTAssertEqual(CameraZoom.scale(of: CGRect(x: 0, y: 0, width: 1, height: 1), in: pane), 1,
                       accuracy: 0.001)
    }
}

/// What a gesture on the camera picture means. The click is answered from
/// AppKit's own click count rather than by waiting to see whether a second
/// one arrives (Sean, 2026-09-19: "clicking to exit after selecting a
/// section of the page is slow").
final class SectionBoxGestureTests: XCTestCase {
    func testARealDragLeavesItsBoxAlone() {
        XCTAssertEqual(SectionBox.action(translation: CGSize(width: 40, height: 3), clicks: 1), .keep)
        XCTAssertEqual(SectionBox.action(translation: CGSize(width: 0, height: -30), clicks: 1), .keep)
    }

    func testAClickClearsAndTwoTakeTheWholePicture() {
        XCTAssertEqual(SectionBox.action(translation: .zero, clicks: 1), .clear)
        XCTAssertEqual(SectionBox.action(translation: CGSize(width: 2, height: 2), clicks: 1), .clear,
                       "a shaky hand is still a click")
        XCTAssertEqual(SectionBox.action(translation: .zero, clicks: 2), .whole)
        XCTAssertEqual(SectionBox.action(translation: .zero, clicks: 3), .whole)
    }

    func testTheSlackIsFourPoints() {
        XCTAssertFalse(SectionBox.isDrag(CGSize(width: 3.9, height: 3.9)))
        XCTAssertTrue(SectionBox.isDrag(CGSize(width: 4, height: 0)))
    }

    func testADoubleClickIsNotReadAsADragEvenIfTheHandMoves() {
        XCTAssertEqual(SectionBox.action(translation: CGSize(width: 3, height: 1), clicks: 2), .whole)
    }
}
