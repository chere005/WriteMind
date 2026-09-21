import AppKit
import XCTest
@testable import WriteMind

/// A flow chart sketched on paper, read off it — and, far more important,
/// a page of ordinary writing read as nothing at all (Sean, 2026-09-19:
/// "have ocr also grab shapes and flow charts").
final class FlowChartReadingTests: XCTestCase {
    private let width = 600, height = 460
    private let pane = CGSize(width: 600, height: 460)

    /// Ink drawn with Core Graphics, then thresholded the way a photograph
    /// of the page would be.
    private func ink(_ draw: (CGContext) -> Void) -> [Bool] {
        let context = CGContext(data: nil, width: width, height: height, bitsPerComponent: 8,
                                bytesPerRow: width, space: CGColorSpaceCreateDeviceGray(),
                                bitmapInfo: CGImageAlphaInfo.none.rawValue)!
        context.setFillColor(CGColor(gray: 1, alpha: 1))
        context.fill(CGRect(x: 0, y: 0, width: width, height: height))
        context.setStrokeColor(CGColor(gray: 0, alpha: 1))
        context.setFillColor(CGColor(gray: 0, alpha: 1))
        context.setLineWidth(3)
        draw(context)
        let data = context.data!.bindMemory(to: UInt8.self, capacity: width * height)
        // Core Graphics counts up from the bottom; the mask counts down
        // from the top, like every other mask in the app.
        var mask = [Bool](repeating: false, count: width * height)
        for y in 0..<height {
            for x in 0..<width {
                mask[y * width + x] = data[(height - 1 - y) * width + x] < 128
            }
        }
        return mask
    }

    private func box(_ rect: CGRect) -> (CGContext) -> Void {
        { context in context.stroke(rect) }
    }

    func testTwoBoxesAndAnArrowComeInAsAChart() {
        let mask = ink { context in
            context.stroke(CGRect(x: 60, y: 300, width: 180, height: 90))     // top box
            context.stroke(CGRect(x: 60, y: 90, width: 180, height: 90))      // bottom box
            context.move(to: CGPoint(x: 150, y: 300))                          // the arrow between
            context.addLine(to: CGPoint(x: 150, y: 185))
            context.strokePath()
            context.fill(CGRect(x: 143, y: 180, width: 14, height: 14))        // its head
        }
        let items = FlowChartReading.items(ink: mask, width: width, height: height, words: [],
                                           in: pane, colorHex: "#000000", lineWidth: 2)
        let shapes = items.compactMap(\.shape)
        XCTAssertEqual(shapes.count, 2, "two boxes: \(items.count) items")
        XCTAssertTrue(shapes.allSatisfy { FlowChartReading.shipped.contains($0.kind) })
        for shape in shapes {
            XCTAssertGreaterThan(shape.width, 0.1)
            XCTAssertLessThan(shape.width, 0.9)
        }
    }

    func testASingleRingIsNotAChart() {
        // One circle round a word is emphasis, which the mark reader
        // already turns into bold. It must not become a node.
        let mask = ink { context in
            context.strokeEllipse(in: CGRect(x: 200, y: 200, width: 160, height: 80))
        }
        XCTAssertTrue(FlowChartReading.items(ink: mask, width: width, height: height, words: [],
                                             in: pane, colorHex: "#000000", lineWidth: 2).isEmpty)
    }

    func testAPageOfWritingIsNotAChart() {
        let mask = ink { context in
            let font = NSFont.systemFont(ofSize: 22)
            NSGraphicsContext.saveGraphicsState()
            NSGraphicsContext.current = NSGraphicsContext(cgContext: context, flipped: false)
            for line in 0..<8 {
                let text = "The quick brown fox jumps over the lazy dog again"
                (text as NSString).draw(at: CGPoint(x: 30, y: CGFloat(400 - line * 45)),
                                        withAttributes: [.font: font, .foregroundColor: NSColor.black])
            }
            NSGraphicsContext.restoreGraphicsState()
        }
        let items = FlowChartReading.items(ink: mask, width: width, height: height, words: [],
                                           in: pane, colorHex: "#000000", lineWidth: 2)
        XCTAssertTrue(items.isEmpty, "prose came back as \(items.count) objects")
    }

    func testAnUnderlineOnItsOwnIsNeverAConnector() {
        let mask = ink { context in
            context.move(to: CGPoint(x: 60, y: 200))
            context.addLine(to: CGPoint(x: 400, y: 200))
            context.strokePath()
        }
        XCTAssertTrue(FlowChartReading.items(ink: mask, width: width, height: height, words: [],
                                             in: pane, colorHex: "#000000", lineWidth: 2).isEmpty)
    }

    func testTheMarksStayInkAndTheShapesDoNot() {
        // The six shapes a chart is drawn with, including the triangle and
        // the parallelogram that used to be held back (Sean, 2026-09-21).
        XCTAssertEqual(FlowChartReading.shipped,
                       [.rectangle, .roundedRectangle, .oval, .diamond, .triangle, .parallelogram])
        // And the marks, which the classifier reads perfectly well and
        // which this must not put on the page anyway: a tick in a drawn
        // box is already a task item, and reading it here as well would
        // read the same ink twice.
        XCTAssertFalse(FlowChartReading.shipped.contains(.check))
        XCTAssertFalse(FlowChartReading.shipped.contains(.cross))
        XCTAssertFalse(FlowChartReading.shipped.contains(.star))
    }

    func testTheObjectsAreMovedIntoTheBoxTheyBelongIn() {
        let shape = CanvasItem.shape(ShapeItem(kind: .rectangle, center: CGPoint(x: 0.5, y: 0.5),
                                               width: 0.4, aspect: 0.5, colorHex: "#000000"))
        let line = CanvasItem.connector(ConnectorItem(start: CGPoint(x: 0.2, y: 0.2),
                                                      end: CGPoint(x: 0.8, y: 0.8),
                                                      colorHex: "#000000"))
        let landing = CGRect(x: 150, y: 230, width: 300, height: 115)   // a quarter of the pane
        let moved = FlowChartReading.placed([shape, line], into: landing, pane: pane)
        let placedShape = moved[0].shape!
        XCTAssertEqual(placedShape.center.x, 0.5, accuracy: 0.001, "centred in the landing box")
        XCTAssertEqual(placedShape.center.y, 0.625, accuracy: 0.001)
        XCTAssertEqual(placedShape.width, 0.2, accuracy: 0.001, "half the width it was")
        let placedLine = moved[1].connector!
        XCTAssertEqual(placedLine.start.x, 0.35, accuracy: 0.001)
        XCTAssertEqual(placedLine.end.x, 0.65, accuracy: 0.001)
    }

    func testTheLeanDecidesRectangleFromDiamondAndRefusesTheBandBetween() {
        // The classifier's own verdict is only taken when the lean agrees.
        let blob = NotebookCapture.Component(stride: 10, minX: 0, minY: 0, maxX: 1, maxY: 1,
                                             pixels: [0, 1])
        // Too small to read either way — the point is that nothing crashes
        // and nothing is named.
        XCTAssertNil(FlowChartReading.named(blob, shortSide: 400, lean: 0))
        XCTAssertEqual(FlowChartReading.rectangleLean, 8)
        XCTAssertEqual(FlowChartReading.diamondLean, 25)
        XCTAssertLessThan(FlowChartReading.rectangleLean, FlowChartReading.diamondLean,
                          "there is a band where nothing is emitted")
    }
}
