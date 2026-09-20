import XCTest
@testable import WriteMind

/// The tooltip's pane has to be big enough for what is written on it.
///
/// Sean, 2026-09-19: "the pane behind the tooltip for the buttons like shapes
/// etc isn't big enough". The bubble sizes itself with `.fixedSize()`, so
/// nothing proposes a width to the line under the title — a `maxWidth:` there
/// clamped the box while the text went on drawing one long line out of the
/// material behind it. A measured, CONCRETE width is a real proposal: long
/// details wrap and the pane grows, short ones stay narrow.
final class BarTipTests: XCTestCase {
    /// The real tip that showed the bug worst.
    private let shapes = "Flow-chart shapes, and arrows between them — hold ⌥ and drag from a node"

    func testALongDetailIsCappedSoItWrapsInsteadOfRunningOff() {
        XCTAssertEqual(BarTipBubble.detailWidth(shapes), 240,
                       "a detail wider than the cap takes the cap, and wraps into it")
    }

    func testTheShapesDetailReallyIsWiderThanTheCap() {
        // Guards the premise: if this line ever fits on one line at 240 the
        // test above stops proving anything.
        let oneLine = (shapes as NSString)
            .size(withAttributes: [.font: NSFont.systemFont(ofSize: 11)]).width
        XCTAssertGreaterThan(oneLine, 240,
                             "the tip that prompted this is a line and a half wide")
    }

    func testAShortDetailKeepsItsOwnWidth() {
        let width = BarTipBubble.detailWidth("Size and colour")
        XCTAssertLessThan(width, 240, "a short tip does not get a 240pt bubble")
        XCTAssertGreaterThan(width, 40, "…nor a bubble too narrow to read")
    }

    func testTheWidthIsNeverShorterThanTheTextItHasToHold() {
        for detail in ["Heavier type for the selection",
                       "A line under the selection",
                       "Turn the video a quarter turn left"] {
            let measured = (detail as NSString)
                .size(withAttributes: [.font: NSFont.systemFont(ofSize: 11)]).width
            XCTAssertGreaterThanOrEqual(BarTipBubble.detailWidth(detail), measured,
                                        "\(detail) would be clipped")
        }
    }

    func testTheCapIsHonouredWhateverIsAskedFor() {
        XCTAssertEqual(BarTipBubble.detailWidth(String(repeating: "wide ", count: 200)), 240)
    }
}
