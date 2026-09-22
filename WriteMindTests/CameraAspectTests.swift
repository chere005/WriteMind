import XCTest
@testable import WriteMind

/// The shape of the viewfinder (Sean, 2026-09-21: "add aspect ratio
/// control").
final class CameraAspectTests: XCTestCase {
    private let wide = CGSize(width: 800, height: 400)
    private let tall = CGSize(width: 400, height: 800)

    func testFreeHandsThePaneStraightBack() {
        XCTAssertEqual(CameraAspect.free.fit(in: wide), wide)
        XCTAssertEqual(CameraAspect.free.fit(in: tall), tall)
        XCTAssertNil(CameraAspect.free.ratio)
    }

    func testEveryShapeIsTheLargestOneThatFits() {
        for aspect in CameraAspect.allCases {
            guard let ratio = aspect.ratio else { continue }
            for pane in [wide, tall, CGSize(width: 500, height: 500)] {
                let size = aspect.fit(in: pane)
                XCTAssertEqual(size.width / size.height, ratio, accuracy: 0.0001,
                               "\(aspect.title) in \(pane)")
                XCTAssertLessThanOrEqual(size.width, pane.width + 0.001, "\(aspect.title)")
                XCTAssertLessThanOrEqual(size.height, pane.height + 0.001, "\(aspect.title)")
                // Largest: one side touches the pane.
                let touches = abs(size.width - pane.width) < 0.001
                    || abs(size.height - pane.height) < 0.001
                XCTAssertTrue(touches, "\(aspect.title) in \(pane) left room on both sides")
            }
        }
    }

    func testAWideShapeInAWidePaneIsHeldByItsHeight() {
        // 16:9 in a 2:1 pane: the pane is wider than the shape, so the
        // height is what runs out first.
        let size = CameraAspect.sixteenNine.fit(in: wide)
        XCTAssertEqual(size.height, 400, accuracy: 0.001)
        XCTAssertEqual(size.width, 400 * 16 / 9, accuracy: 0.001)
        // And the same shape in a tall pane is held by its width.
        let narrow = CameraAspect.sixteenNine.fit(in: tall)
        XCTAssertEqual(narrow.width, 400, accuracy: 0.001)
    }

    func testTheUprightShapesAreTheUprightOnes() {
        let upright = CameraAspect.allCases.filter(\.isUpright).map(\.title)
        XCTAssertEqual(upright, ["3:4", "2:3", "9:16"])
        let across = CameraAspect.allCases.filter { !$0.isUpright }.map(\.title)
        XCTAssertEqual(across, ["Free", "1:1", "4:3", "3:2", "16:9"])
        // Every case is in exactly one of the two rows the panel draws.
        XCTAssertEqual(upright.count + across.count, CameraAspect.allCases.count)
    }

    /// A pane dragged shut is not a choice, and every coordinate
    /// downstream divides by these numbers.
    func testAPaneWithNoRoomInItHandsBackWhatItWasGiven() {
        for pane in [CGSize.zero, CGSize(width: 1, height: 400), CGSize(width: 400, height: 0)] {
            XCTAssertEqual(CameraAspect.fourThree.fit(in: pane), pane, "\(pane)")
        }
    }

    /// It is remembered, so the raw values are a stored format.
    func testEveryShapeHasAStableName() {
        XCTAssertEqual(CameraAspect.allCases.map(\.rawValue),
                       ["free", "square", "fourThree", "threeFour",
                        "threeTwo", "twoThree", "sixteenNine", "nineSixteen"])
        XCTAssertEqual(CameraAspect(rawValue: "nonsense"), nil)
    }
}
