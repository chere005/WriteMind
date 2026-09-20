import XCTest
@testable import WriteMind

/// The pane most of these work in: wide and short, so anything that confused
/// normalised space with view space shows up as a squashed or sheared object.
private let pane = CGSize(width: 1000, height: 200)

final class CanvasItemTests: XCTestCase {
    private func line(width: Double = 4) -> CanvasItem {
        .stroke(Stroke(colorHex: "#2D7DD2", width: width,
                       points: [CGPoint(x: 0.1, y: 0.5), CGPoint(x: 0.9, y: 0.5)]))
    }

    private func picture(aspect: Double = 0.5) -> CanvasItem {
        .image(ImageItem(file: "a.png", center: CGPoint(x: 0.5, y: 0.5), width: 0.4, aspect: aspect))
    }

    func testAPictureKeepsItsOwnShapeInAPaneOfAnyShape() {
        let box = picture(aspect: 0.5).baseBounds(in: pane)
        XCTAssertEqual(box.width, 400, accuracy: 0.001)
        XCTAssertEqual(box.height, 200, accuracy: 0.001)   // 400 × 0.5, not 400 × (0.5 × 1000/200)
    }

    func testAClickLandsOnTheInkAndNotOnTheBoxAroundIt() {
        let stroke = line()
        XCTAssertTrue(stroke.hitTest(CGPoint(x: 500, y: 100), in: pane))
        XCTAssertFalse(stroke.hitTest(CGPoint(x: 500, y: 130), in: pane))
        XCTAssertFalse(stroke.hitTest(CGPoint(x: 50, y: 100), in: pane))
    }

    func testAMarqueeTakesWhateverItTouches() {
        let stroke = line()
        // Nowhere near either end, and far too small to hold the whole stroke.
        XCTAssertTrue(stroke.intersects(CGRect(x: 480, y: 90, width: 20, height: 20), in: pane))
        XCTAssertFalse(stroke.intersects(CGRect(x: 480, y: 10, width: 20, height: 20), in: pane))
    }

    func testAMarqueeInsideAPictureStillTakesIt() {
        XCTAssertTrue(picture().intersects(CGRect(x: 490, y: 95, width: 10, height: 10), in: pane))
        XCTAssertFalse(picture().intersects(CGRect(x: 0, y: 0, width: 20, height: 20), in: pane))
    }

    func testATurnedPictureIsCaughtWhereItActuallyIs() {
        // 400 × 100 upright, so 100 × 400 once it is stood on its end.
        var turned = picture(aspect: 0.25)
        turned.transform.rotation = .pi / 2
        let below = CGRect(x: 495, y: 170, width: 10, height: 10)
        XCTAssertTrue(turned.intersects(below, in: pane))
        XCTAssertFalse(picture(aspect: 0.25).intersects(below, in: pane))
    }
}

final class CanvasEditTests: XCTestCase {
    private var stroke: CanvasItem {
        .stroke(Stroke(colorHex: "#000000", width: 2,
                       points: [CGPoint(x: 0.4, y: 0.4), CGPoint(x: 0.6, y: 0.6)]))
    }

    func testDraggingMovesByTheFractionOfThePaneItWasDraggedAcross() {
        let moved = CanvasEdit.transform(stroke, from: .identity,
                                         translate: CGVector(dx: 100, dy: 50),
                                         about: .zero, in: pane)
        XCTAssertEqual(moved.dx, 0.1, accuracy: 0.0001)
        XCTAssertEqual(moved.dy, 0.25, accuracy: 0.0001)
        XCTAssertEqual(moved.scale, 1, accuracy: 0.0001)
    }

    func testTurningOneObjectTurnsItWhereItStands() {
        let pivot = stroke.placedCenter(in: pane)
        let turned = CanvasEdit.transform(stroke, from: .identity, rotate: .pi / 2,
                                          about: pivot, in: pane)
        XCTAssertEqual(turned.rotation, .pi / 2, accuracy: 0.0001)
        XCTAssertEqual(turned.dx, 0, accuracy: 0.0001)
        XCTAssertEqual(turned.dy, 0, accuracy: 0.0001)
    }

    func testScalingAGroupPushesItsMembersAwayFromTheGroupsCentre() {
        let scaled = CanvasEdit.transform(stroke, from: .identity, scale: 2,
                                          about: .zero, in: pane)
        XCTAssertEqual(scaled.scale, 2, accuracy: 0.0001)
        // The centre sat at (500, 100); twice as far from (0, 0) is (1000, 200).
        XCTAssertEqual(scaled.dx, 0.5, accuracy: 0.0001)
        XCTAssertEqual(scaled.dy, 0.5, accuracy: 0.0001)
    }

    func testAGestureThatEndsWhereItStartedChangesNothing() {
        let same = CanvasEdit.transform(stroke, from: .identity, translate: .zero, scale: 1, rotate: 0,
                                        about: CGPoint(x: 10, y: 10), in: pane)
        XCTAssertEqual(same, .identity)
    }

    func testTheScaleFactorIsHowMuchFurtherTheHandleWasDragged() {
        let pivot = CGPoint(x: 100, y: 100)
        XCTAssertEqual(CanvasEdit.factor(from: CGPoint(x: 200, y: 100),
                                         to: CGPoint(x: 300, y: 100), about: pivot), 2, accuracy: 0.0001)
    }
}

/// A sidecar written before objects existed has a `strokes` array and no
/// transforms at all; it still has to open.
private struct LegacyStroke: Encodable {
    let id: UUID
    let colorHex: String
    let width: Double
    let points: [CGPoint]
}
private struct LegacyDrawing: Encodable { let strokes: [LegacyStroke] }

final class DrawingCodingTests: XCTestCase {
    func testAnOlderSidecarStillOpens() throws {
        let legacy = LegacyDrawing(strokes: [
            LegacyStroke(id: UUID(), colorHex: "#F2542D", width: 3,
                         points: [CGPoint(x: 0.2, y: 0.3), CGPoint(x: 0.4, y: 0.5)])
        ])
        let data = try JSONEncoder().encode(legacy)
        let drawing = try JSONDecoder().decode(Drawing.self, from: data)

        XCTAssertEqual(drawing.items.count, 1)
        XCTAssertEqual(drawing.strokes.first?.colorHex, "#F2542D")
        XCTAssertEqual(drawing.strokes.first?.transform, .identity)
    }

    func testStrokesAndPicturesSurviveARoundTrip() throws {
        var drawing = Drawing(items: [
            .stroke(Stroke(colorHex: "#2FBF71", width: 6, points: [CGPoint(x: 0.1, y: 0.1)])),
            .image(ImageItem(file: "picture.png", width: 0.5, aspect: 1.5))
        ])
        drawing.items[0].transform = ItemTransform(dx: 0.1, dy: -0.2, scale: 1.4, rotation: 0.6)

        let data = try JSONEncoder().encode(drawing)
        XCTAssertEqual(try JSONDecoder().decode(Drawing.self, from: data), drawing)
    }
}

final class DrawingMediaTests: XCTestCase {
    private var dir: URL!

    override func setUpWithError() throws {
        dir = FileManager.default.temporaryDirectory.appending(path: "WriteMindTests-\(UUID().uuidString)")
        try FileManager.default.createDirectory(at: DrawingStore.mediaFolder(in: dir),
                                                withIntermediateDirectories: true)
    }

    override func tearDownWithError() throws {
        try? FileManager.default.removeItem(at: dir)
    }

    private func writeMedia(_ name: String) throws {
        try Data("not really a picture".utf8).write(to: DrawingStore.mediaURL(name, in: dir))
    }

    func testACopyOfANoteGetsItsOwnCopiesOfThePictures() throws {
        try writeMedia("one.png")
        let copy = DrawingStore.copyingMedia(Drawing(items: [.image(ImageItem(file: "one.png"))]), in: dir)

        let file = try XCTUnwrap(copy.images.first?.file)
        XCTAssertNotEqual(file, "one.png")
        XCTAssertTrue(FileManager.default.fileExists(atPath: DrawingStore.mediaURL(file, in: dir).path))
        XCTAssertTrue(FileManager.default.fileExists(atPath: DrawingStore.mediaURL("one.png", in: dir).path))
    }

    func testSweepingTakesOnlyThePicturesNoNoteStillPointsAt() throws {
        try writeMedia("kept.png")
        try writeMedia("orphan.png")
        DrawingStore.save(Drawing(items: [.image(ImageItem(file: "kept.png"))]),
                          for: dir.appending(path: "Note.md"), in: dir)

        DrawingStore.pruneMedia(in: dir)

        XCTAssertTrue(FileManager.default.fileExists(atPath: DrawingStore.mediaURL("kept.png", in: dir).path))
        XCTAssertFalse(FileManager.default.fileExists(atPath: DrawingStore.mediaURL("orphan.png", in: dir).path))
    }

    func testDeletingANoteTakesItsPicturesWithIt() throws {
        try writeMedia("gone.png")
        let note = dir.appending(path: "Trip.md")
        DrawingStore.save(Drawing(items: [.image(ImageItem(file: "gone.png"))]), for: note, in: dir)

        DrawingStore.delete(for: note, in: dir)

        XCTAssertFalse(FileManager.default.fileExists(atPath: DrawingStore.mediaURL("gone.png", in: dir).path))
    }
}
