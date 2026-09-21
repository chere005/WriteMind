import AppKit
import XCTest
@testable import WriteMind

/// What the shape classifier makes of shapes drawn the way a hand draws
/// them. The comments in `ShapeInk` and `FlowChartReading` talk about
/// corpora the classifier was measured on; this is that corpus, in the
/// suite, so a change to the tuning has to answer to it.
///
/// The rule the whole feature rests on: a sketch that comes in as the
/// WRONG shapes is worse than one that comes in as ink. So every case
/// here is either "this is named" or "this is refused", and the refusals
/// matter more.
final class ShapeInkCorpusTests: XCTestCase {
    private let width = 300, height = 300

    /// Ink drawn with Core Graphics and thresholded the way a page is.
    private func drawn(_ draw: (CGContext) -> Void) -> [Bool] {
        let context = CGContext(data: nil, width: width, height: height, bitsPerComponent: 8,
                                bytesPerRow: width, space: CGColorSpaceCreateDeviceGray(),
                                bitmapInfo: CGImageAlphaInfo.none.rawValue)!
        context.setFillColor(CGColor(gray: 1, alpha: 1))
        context.fill(CGRect(x: 0, y: 0, width: width, height: height))
        context.setStrokeColor(CGColor(gray: 0, alpha: 1))
        context.setLineWidth(3)
        context.setLineJoin(.round)
        draw(context)
        let data = context.data!.bindMemory(to: UInt8.self, capacity: width * height)
        var mask = [Bool](repeating: false, count: width * height)
        for index in 0..<(width * height) { mask[index] = data[index] < 128 }
        return mask
    }

    /// The classifier's verdict on everything in the mask.
    private func kind(_ mask: [Bool]) -> ShapeInk.Kind {
        guard let blob = FlowChartReading.component(
            of: CGRect(x: 0, y: 0, width: width, height: height),
            ink: mask, width: width, height: height)
        else { return .none }
        return ShapeInk.read(blob, shortSide: width).kind
    }

    /// A closed polygon through `points`, in the middle of the page.
    private func polygon(_ points: [CGPoint]) -> [Bool] {
        drawn { context in
            context.move(to: points[0])
            for point in points.dropFirst() { context.addLine(to: point) }
            context.addLine(to: points[0])
            context.strokePath()
        }
    }

    // MARK: - The four that already ship, so the corpus can be trusted

    func testADrawnRectangleIsARectangle() {
        XCTAssertEqual(kind(drawn { $0.stroke(CGRect(x: 60, y: 90, width: 180, height: 110)) }),
                       .rectangle)
    }

    func testADrawnOvalIsAnOval() {
        XCTAssertEqual(kind(drawn { $0.strokeEllipse(in: CGRect(x: 60, y: 90, width: 180, height: 110)) }),
                       .oval)
    }

    func testADrawnDiamondIsADiamond() {
        XCTAssertEqual(kind(polygon([CGPoint(x: 150, y: 60), CGPoint(x: 240, y: 150),
                                     CGPoint(x: 150, y: 240), CGPoint(x: 60, y: 150)])),
                       .diamond)
    }

    // MARK: - The two this change lets through

    func testADrawnTriangleIsATriangle() {
        XCTAssertEqual(kind(polygon([CGPoint(x: 150, y: 60), CGPoint(x: 250, y: 230),
                                     CGPoint(x: 50, y: 230)])),
                       .triangle)
    }

    func testADrawnParallelogramIsAParallelogram() {
        XCTAssertEqual(kind(polygon([CGPoint(x: 90, y: 90), CGPoint(x: 250, y: 90),
                                     CGPoint(x: 210, y: 210), CGPoint(x: 50, y: 210)])),
                       .parallelogram)
    }

    // MARK: - And the refusals, which are the point

    func testARectangleDrawnByHandDoesNotBecomeAParallelogram() {
        // Every corner pushed a few points out of true — a rectangle
        // drawn freehand, which must stay the class it is.
        for wobble in [3.0, 6.0, 9.0] as [CGFloat] {
            let shape = polygon([CGPoint(x: 60 + wobble, y: 90),
                                 CGPoint(x: 240, y: 90 - wobble),
                                 CGPoint(x: 240 - wobble, y: 200),
                                 CGPoint(x: 60, y: 200 + wobble)])
            let named = kind(shape)
            XCTAssertNotEqual(named, .parallelogram, "a \\(wobble)-point wobble is still a rectangle")
            XCTAssertNotEqual(named, .triangle)
        }
    }

    func testAScribbleIsNotATriangle() {
        // Where scribbles used to go, and the reason triangles were held
        // back: a mess with three longish strokes in it.
        let scribble = drawn { context in
            context.move(to: CGPoint(x: 70, y: 80))
            for point in [CGPoint(x: 220, y: 130), CGPoint(x: 90, y: 200),
                          CGPoint(x: 230, y: 210), CGPoint(x: 110, y: 100),
                          CGPoint(x: 200, y: 170)] {
                context.addLine(to: point)
            }
            context.strokePath()
        }
        XCTAssertNotEqual(kind(scribble), .triangle)
        XCTAssertNotEqual(kind(scribble), .parallelogram)
    }

    func testAnArrowIsNotAShape() {
        let arrow = drawn { context in
            context.move(to: CGPoint(x: 60, y: 150))
            context.addLine(to: CGPoint(x: 240, y: 150))
            context.move(to: CGPoint(x: 210, y: 130))
            context.addLine(to: CGPoint(x: 240, y: 150))
            context.addLine(to: CGPoint(x: 210, y: 170))
            context.strokePath()
        }
        XCTAssertFalse(ShapeInk.Kind.rectangle.isNode && kind(arrow).isNode,
                       "an arrow is a line, not a node")
    }
}
