import AppKit
import XCTest
@testable import WriteMind

/// Cropping a picture on the drawing layer: the maths that keeps the kept
/// part where it was, and the file that holds it.
final class CropTests: XCTestCase {
    func testTheKeptPartStaysWhereItWasWhateverTheTransform() {
        let size = CGSize(width: 1000, height: 1000)
        var item = ImageItem(file: "a.png", center: CGPoint(x: 0.5, y: 0.5), width: 0.4, aspect: 1)
        item.transform.dx = 0.1
        item.transform.scale = 2
        item.transform.rotation = .pi / 2
        let rect = CGRect(x: 0.5, y: 0, width: 0.5, height: 0.5)   // the top-right quarter

        // Where that quarter's centre is on the pane now: (600, 400) before
        // the transform, turned and doubled about (500, 500), then moved.
        let whole = CanvasItem.image(item)
        let base = whole.baseBounds(in: size)
        let expected = CGPoint(x: base.minX + rect.midX * base.width, y: base.minY + rect.midY * base.height)
            .applying(whole.matrix(in: size))
        XCTAssertEqual(expected.x, 800, accuracy: 1e-6)
        XCTAssertEqual(expected.y, 700, accuracy: 1e-6)

        let cropped = CanvasEdit.crop(item, to: rect, file: "b.png", aspect: 1, in: size)
        XCTAssertEqual(cropped.file, "b.png")
        XCTAssertEqual(cropped.width, 0.2, accuracy: 1e-9)
        XCTAssertEqual(cropped.transform, item.transform)
        let placed = CanvasItem.image(cropped).placedCenter(in: size)
        XCTAssertEqual(placed.x, expected.x, accuracy: 1e-6)
        XCTAssertEqual(placed.y, expected.y, accuracy: 1e-6)
    }

    func testACornerDragKeepsTheBoxInsideThePictureAndNotTooSmall() {
        let full = CGRect(x: 0, y: 0, width: 1, height: 1)
        let topLeft = CanvasEdit.cropRect(full, movingCorner: 0, to: CGPoint(x: 0.25, y: 0.5))
        XCTAssertEqual(topLeft, CGRect(x: 0.25, y: 0.5, width: 0.75, height: 0.5))

        let outside = CanvasEdit.cropRect(full, movingCorner: 2, to: CGPoint(x: 1.7, y: -3))
        XCTAssertEqual(outside.maxX, 1)
        XCTAssertEqual(outside.maxY, 0.05, accuracy: 1e-9)

        let tiny = CanvasEdit.cropRect(topLeft, movingCorner: 1, to: CGPoint(x: 0, y: 0.9))
        XCTAssertEqual(tiny.width, 0.05, accuracy: 1e-9)
        XCTAssertEqual(tiny.minY, 0.9, accuracy: 1e-9)
        XCTAssertEqual(tiny.height, 0.1, accuracy: 1e-9)
    }

    func testCroppingWritesANewPictureAndLeavesTheOldOne() throws {
        let folder = FileManager.default.temporaryDirectory.appending(path: UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: folder) }

        // 40×20: white on the left, black on the right.
        let rep = try XCTUnwrap(NSBitmapImageRep(bitmapDataPlanes: nil, pixelsWide: 40, pixelsHigh: 20,
                                                 bitsPerSample: 8, samplesPerPixel: 4, hasAlpha: true,
                                                 isPlanar: false, colorSpaceName: .deviceRGB,
                                                 bytesPerRow: 0, bitsPerPixel: 0))
        for y in 0..<20 {
            for x in 0..<40 { rep.setColor(x < 20 ? NSColor.white : NSColor.black, atX: x, y: y) }
        }
        let image = NSImage(size: NSSize(width: 40, height: 20))
        image.addRepresentation(rep)

        let original = try XCTUnwrap(DrawingStore.importImage(image, in: folder))
        let cropped = try XCTUnwrap(DrawingStore.cropImage(
            original.file, to: CGRect(x: 0.5, y: 0, width: 0.5, height: 1), in: folder))
        XCTAssertEqual(cropped.pixelWidth, 20)
        XCTAssertEqual(cropped.pixelHeight, 20)
        XCTAssertNotEqual(cropped.file, original.file)
        XCTAssertTrue(FileManager.default.fileExists(atPath: DrawingStore.mediaURL(original.file, in: folder).path),
                      "the original stays for undo; the sweep takes it later")

        let result = try XCTUnwrap(DrawingStore.loadImage(cropped.file, in: folder))
        let pixels = try XCTUnwrap(NSBitmapImageRep(data: try XCTUnwrap(result.tiffRepresentation)))
        let colour = try XCTUnwrap(pixels.colorAt(x: 5, y: 5)?.usingColorSpace(.deviceRGB))
        XCTAssertLessThan(colour.redComponent, 0.1, "the kept half is the black one")
    }
}
