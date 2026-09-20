import XCTest
@testable import WriteMind

/// A box round the whole picture — Sean, 2026-09-19: "add a button for picking
/// a square that is the size of the image being captured".
///
/// The button hands the selector the picture's own rectangle instead of one
/// dragged corner to corner, so the two things that have to be right are the
/// geometry it is built from: where the picture sits in a pane that is not its
/// shape, and where that lands once the pane is zoomed in.
final class CameraZoomBoxTests: XCTestCase {
    private let pane = CGSize(width: 800, height: 600)

    func testThePictureIsFittedInsideAPaneOfADifferentShape() {
        // A 16:9 camera in a 4:3 pane: full width, bars above and below.
        let shown = NotebookCapture.displayedFrame(of: CGSize(width: 1920, height: 1080), in: pane)
        XCTAssertEqual(shown.width, 800, accuracy: 0.001)
        XCTAssertEqual(shown.height, 450, accuracy: 0.001)
        XCTAssertEqual(shown.minY, 75, accuracy: 0.001, "centred, so the bars are equal")
        XCTAssertLessThan(shown.height, pane.height, "the pane is NOT the picture")
    }

    func testZoomedIsTheExactInverseOfUnzoomed() {
        let box = CGRect(x: 0.25, y: 0.25, width: 0.5, height: 0.5)
        for point in [CGPoint(x: 0, y: 0), CGPoint(x: 400, y: 300), CGPoint(x: 799, y: 599)] {
            let there = CameraZoom.zoomed(point, box: box, in: pane)
            let back = CameraZoom.unzoomed(there, box: box, in: pane)
            XCTAssertEqual(back.x, point.x, accuracy: 0.0001)
            XCTAssertEqual(back.y, point.y, accuracy: 0.0001)
        }
    }

    func testTheZoomedBoxRoundTripsAsARectangleToo() {
        let box = CGRect(x: 0.1, y: 0.2, width: 0.4, height: 0.4)
        let picture = NotebookCapture.displayedFrame(of: CGSize(width: 1920, height: 1080), in: pane)
        let drawn = CameraZoom.zoomed(picture, box: box, in: pane)
        let back = CameraZoom.unzoomed(drawn, box: box, in: pane)
        XCTAssertEqual(back.minX, picture.minX, accuracy: 0.001)
        XCTAssertEqual(back.minY, picture.minY, accuracy: 0.001)
        XCTAssertEqual(back.width, picture.width, accuracy: 0.001)
        XCTAssertEqual(back.height, picture.height, accuracy: 0.001)
    }

    func testAZoomedInPictureIsDrawnBiggerThanThePane() {
        // Zoomed to a quarter of the pane, the picture is four times as wide —
        // so the box round it has to be clipped to the pane, which is what the
        // camera pane does before it draws one.
        let box = CGRect(x: 0.25, y: 0.25, width: 0.25, height: 0.25)
        let picture = NotebookCapture.displayedFrame(of: CGSize(width: 1600, height: 1200), in: pane)
        let drawn = CameraZoom.zoomed(picture, box: box, in: pane)
        XCTAssertGreaterThan(drawn.width, pane.width)
        let visible = drawn.intersection(CGRect(origin: .zero, size: pane))
        XCTAssertEqual(visible.width, pane.width, accuracy: 0.001)
        XCTAssertEqual(visible.height, pane.height, accuracy: 0.001)
    }

    func testTheWholePictureBoxCapturesTheWholePicture() throws {
        // The box the button makes, taken back through the capture's own
        // mapping, is the entire frame: 0…1 in both directions.
        let frame = CGSize(width: 1920, height: 1080)
        let shown = NotebookCapture.displayedFrame(of: frame, in: pane)
        let region = try XCTUnwrap(NotebookCapture.region(from: shown, frame: frame, in: pane))
        XCTAssertEqual(region.minX, 0, accuracy: 0.001)
        XCTAssertEqual(region.minY, 0, accuracy: 0.001)
        XCTAssertEqual(region.width, 1, accuracy: 0.001)
        XCTAssertEqual(region.height, 1, accuracy: 0.001)
    }
}
