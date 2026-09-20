import AppKit
import XCTest
@testable import WriteMind

/// A picture read into words is put away, not thrown away, and one button
/// brings both back (Sean, 2026-09-19).
@MainActor
final class HiddenPictureTests: XCTestCase {
    private var dir: URL!
    private var store: NoteStore!

    override func setUp() async throws {
        dir = FileManager.default.temporaryDirectory.appending(path: "WriteMindTests-\(UUID().uuidString)")
        try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        try Data("# Trip\n\nnotes\n".utf8).write(to: dir.appending(path: "Trip.md"))
        store = NoteStore(directory: dir)
    }

    override func tearDown() async throws {
        store = nil
        try? FileManager.default.removeItem(at: dir)
    }

    func testAHiddenPictureIsNotOnThePaneAtAll() {
        let size = CGSize(width: 400, height: 400)
        var drawing = Drawing()
        drawing.items = [.image(ImageItem(file: "a.png", center: CGPoint(x: 0.5, y: 0.5), width: 0.5))]
        let middle = CGPoint(x: 200, y: 200)
        XCTAssertNotNil(drawing.index(at: middle, in: size))
        XCTAssertEqual(drawing.visibleItems.count, 1)
        let id = drawing.items[0].id
        XCTAssertNotNil(drawing.bounds(of: [id], in: size))

        drawing.items = [.image(ImageItem(file: "a.png", center: CGPoint(x: 0.5, y: 0.5), width: 0.5, hidden: true))]
        XCTAssertNil(drawing.index(at: middle, in: size), "a hidden picture cannot be clicked")
        XCTAssertTrue(drawing.visibleItems.isEmpty, "and is not drawn")
        XCTAssertNil(drawing.bounds(of: [drawing.items[0].id], in: size), "and has no handles")
        XCTAssertTrue(drawing.items[0].isHidden)
    }

    func testTheFlagSurvivesASaveAndASidecarWithoutItStillLoads() throws {
        let item = ImageItem(file: "a.png", hidden: true)
        let data = try JSONEncoder().encode(item)
        XCTAssertTrue(try XCTUnwrap(String(data: data, encoding: .utf8)).contains("hidden"))
        XCTAssertTrue(try JSONDecoder().decode(ImageItem.self, from: data).hidden)

        // CGPoint goes to JSON as [x, y].
        let old = Data(#"{"file":"a.png","center":[0.5,0.5],"width":0.35,"aspect":1}"#.utf8)
        let loaded = try JSONDecoder().decode(ImageItem.self, from: old)
        XCTAssertFalse(loaded.hidden, "a drawing saved before this existed shows its pictures")
    }

    func testReadingAPictureLeavesItOnThePage() throws {
        let file = try XCTUnwrap(DrawingStore.importImage(picture(), in: dir))
        store.drawing.items = [.image(ImageItem(file: file.file, aspect: file.aspect))]
        store.text = "# Trip\n"
        // Reading is not a conversion: whatever Vision finds, the picture
        // is still on the page afterwards (Sean, 2026-09-19).
        store.readText(in: store.drawing.items[0].id)
        XCTAssertFalse(store.drawing.items[0].isHidden)
        XCTAssertEqual(store.drawing.images.count, 1)
    }

    private func picture() -> NSImage {
        let image = NSImage(size: NSSize(width: 20, height: 10))
        image.lockFocus()
        NSColor.black.setFill()
        NSRect(x: 0, y: 0, width: 20, height: 10).fill()
        image.unlockFocus()
        return image
    }
}
