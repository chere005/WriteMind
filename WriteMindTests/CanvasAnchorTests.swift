import XCTest
@testable import WriteMind

/// An object stays beside its own cell when the note is laid out again —
/// which is what switching modes does (Sean, 2026-09-19: "positions stay
/// the same in markdown and wysiwyg mode").
final class CanvasAnchorTests: XCTestCase {
    private let pane = CGSize(width: 400, height: 1000)

    private func picture(at y: Double, height: Double = 0.1, anchor: Int?) -> CanvasItem {
        .image(ImageItem(file: "a.png", center: CGPoint(x: 0.5, y: y), width: 0.4,
                         aspect: height / 0.4, anchor: anchor))
    }

    func testAnObjectIsMovedSoItsTopSitsAtItsCell() {
        let item = picture(at: 0.5, anchor: 120)
        let moved = CanvasAnchors.placed(item, atTop: 300, in: pane)
        XCTAssertEqual(moved.bounds(in: pane).minY, 300, accuracy: 0.5)
    }

    func testMovingItKeepsItsWidthAndHowFarAlongItIs() {
        let item = picture(at: 0.5, anchor: 120)
        let before = item.bounds(in: pane)
        let after = CanvasAnchors.placed(item, atTop: 700, in: pane).bounds(in: pane)
        XCTAssertEqual(after.width, before.width, accuracy: 0.001)
        XCTAssertEqual(after.midX, before.midX, accuracy: 0.001)
        XCTAssertEqual(after.height, before.height, accuracy: 0.001)
    }

    func testEveryAnchoredObjectFollowsItsCellToTheNewLayout() {
        let items = [picture(at: 0.2, anchor: 10), picture(at: 0.6, anchor: 400)]
        // The other mode puts cell 10 at 500 and cell 400 at 20 (a note can
        // reorder that much between a fence rendered and a fence written).
        let moved = CanvasAnchors.reanchored(items, in: pane) { anchor in
            anchor == 10 ? 500 : 20
        }
        XCTAssertEqual(moved[0].bounds(in: pane).minY, 500, accuracy: 0.5)
        XCTAssertEqual(moved[1].bounds(in: pane).minY, 20, accuracy: 0.5)
    }

    func testAnObjectWithNoCellIsLeftAlone() {
        // Drawn before anchors existed, or dropped on a note with no text.
        let loose = picture(at: 0.35, anchor: nil)
        let moved = CanvasAnchors.reanchored([loose], in: pane) { _ in 900 }
        XCTAssertEqual(moved[0].bounds(in: pane).minY, loose.bounds(in: pane).minY, accuracy: 0.001)
    }

    func testAnObjectWhoseCellHasGoneIsLeftAlone() {
        let orphan = picture(at: 0.35, anchor: 9_999)
        let moved = CanvasAnchors.reanchored([orphan], in: pane) { _ in nil }
        XCTAssertEqual(moved[0].bounds(in: pane).minY, orphan.bounds(in: pane).minY, accuracy: 0.001)
    }

    func testNothingIsReportedAsChangedWhenNothingMoved() {
        let items = [picture(at: 0.2, anchor: 10)]
        let top = items[0].bounds(in: pane).minY
        let again = CanvasAnchors.reanchored(items, in: pane) { _ in top }
        XCTAssertFalse(CanvasAnchors.differ(items, again), "a note already in place is not an edit")
        XCTAssertTrue(CanvasAnchors.differ(items, CanvasAnchors.reanchored(items, in: pane) { _ in top + 50 }))
    }

    func testTheAnchorSurvivesTheSidecar() throws {
        let drawing = Drawing(items: [picture(at: 0.4, anchor: 77),
                                      .stroke(Stroke(colorHex: "#000000", width: 2,
                                                     points: [CGPoint(x: 0.1, y: 0.1)], anchor: 12)),
                                      .shape(ShapeItem(kind: .text, colorHex: "#000000", anchor: 5))])
        let data = try JSONEncoder().encode(drawing)
        let back = try JSONDecoder().decode(Drawing.self, from: data)
        XCTAssertEqual(back.items.map(\.anchor), [77, 12, 5])
    }

    func testASidecarWrittenBeforeAnchorsStillReads() throws {
        let old = #"{"items":[{"kind":"image","image":{"file":"a.png","width":0.3,"aspect":1}}]}"#
        let back = try JSONDecoder().decode(Drawing.self, from: Data(old.utf8))
        XCTAssertNil(back.items.first?.anchor)
    }
}

/// The page is a stack: every cell comes immediately after the one above it
/// (Sean, 2026-09-20: "all cells should come immediately after the next
/// one", "there shouldn't be space between these cells").
final class StackedCellTests: XCTestCase {
    private let pane = CGSize(width: 400, height: 1000)
    private let gap: CGFloat = 8

    private func ink(_ y: Double, height: Double = 0.08, anchor: Int?) -> CanvasItem {
        .stroke(Stroke(colorHex: "#000000", width: 2,
                       points: [CGPoint(x: 0.2, y: y), CGPoint(x: 0.5, y: y + height)],
                       anchor: anchor))
    }

    func testADrawingSitsRightUnderItsCell() {
        let stacked = CanvasAnchors.stacked([ink(0.7, anchor: 10)], in: pane, gap: gap) { _ in 200 }
        XCTAssertEqual(stacked[0].bounds(in: pane).minY, 208, accuracy: 1,
                       "the cell's bottom plus one gap, not where the pen was")
    }

    func testTheVoidAboveItIsClosed() {
        // Drawn 500 points below the text, it comes back up to the text.
        let far = ink(0.9, anchor: 10)
        let stacked = CanvasAnchors.stacked([far], in: pane, gap: gap) { _ in 120 }
        XCTAssertLessThan(stacked[0].bounds(in: pane).minY, far.bounds(in: pane).minY)
        XCTAssertEqual(stacked[0].bounds(in: pane).minY, 128, accuracy: 1)
    }

    func testEverythingInOneCellMovesTogetherAndKeepsItsArrangement() {
        let left = ink(0.7, anchor: 10)
        let right = ink(0.74, anchor: 10)
        let before = right.bounds(in: pane).minY - left.bounds(in: pane).minY
        let stacked = CanvasAnchors.stacked([left, right], in: pane, gap: gap) { _ in 300 }
        let after = stacked[1].bounds(in: pane).minY - stacked[0].bounds(in: pane).minY
        XCTAssertEqual(after, before, accuracy: 0.5, "side by side stays side by side")
        XCTAssertEqual(stacked[0].bounds(in: pane).minY, 308, accuracy: 1)
    }

    func testTwoCellsWorthOfDrawingsEachFollowTheirOwn() {
        let stacked = CanvasAnchors.stacked([ink(0.8, anchor: 10), ink(0.2, anchor: 90)],
                                            in: pane, gap: gap) { anchor in
            anchor == 10 ? 100 : 600
        }
        XCTAssertEqual(stacked[0].bounds(in: pane).minY, 108, accuracy: 1)
        XCTAssertEqual(stacked[1].bounds(in: pane).minY, 608, accuracy: 1)
    }

    func testSomethingWithNoCellIsLeftWhereItIs() {
        let loose = ink(0.5, anchor: nil)
        let stacked = CanvasAnchors.stacked([loose], in: pane, gap: gap) { _ in 10 }
        XCTAssertEqual(stacked[0].bounds(in: pane).minY, loose.bounds(in: pane).minY, accuracy: 0.001)
    }

    func testAHiddenPictureIsNotStacked() {
        let hidden = CanvasItem.image(ImageItem(file: "a.png", center: CGPoint(x: 0.5, y: 0.8),
                                                width: 0.3, aspect: 1, hidden: true, anchor: 10))
        let stacked = CanvasAnchors.stacked([hidden], in: pane, gap: gap) { _ in 100 }
        XCTAssertEqual(stacked[0].bounds(in: pane).minY, hidden.bounds(in: pane).minY, accuracy: 0.001)
    }
}
