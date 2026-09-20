import XCTest
@testable import WriteMind

/// Flow-chart lines: right angles, as few as possible, round what is in the
/// way, and out of each other's corridor (Sean, 2026-09-19).
final class ConnectorRoutingTests: XCTestCase {
    private let left = CGRect(x: 100, y: 100, width: 80, height: 40)

    private func isOrthogonal(_ path: [CGPoint]) -> Bool {
        guard path.count >= 2 else { return false }
        for index in 0..<(path.count - 1) {
            let a = path[index], b = path[index + 1]
            if abs(a.x - b.x) > 0.001 && abs(a.y - b.y) > 0.001 { return false }
        }
        return true
    }

    func testTwoNodesInLineAreJoinedByOneStraightSegment() {
        let right = CGRect(x: 300, y: 100, width: 80, height: 40)
        let path = ConnectorRouting.path(from: left, to: right)
        XCTAssertEqual(path.count, 2, "no corners needed: \(path)")
        XCTAssertEqual(path[0], CGPoint(x: 180, y: 120), "out of the right-hand side")
        XCTAssertEqual(path[1], CGPoint(x: 300, y: 120), "into the left-hand side")
        XCTAssertTrue(isOrthogonal(path))
    }

    func testNodesStackedUpAreJoinedTopToBottom() {
        let below = CGRect(x: 100, y: 300, width: 80, height: 40)
        let path = ConnectorRouting.path(from: left, to: below)
        XCTAssertEqual(path.count, 2)
        XCTAssertEqual(path[0], CGPoint(x: 140, y: 140), "out of the bottom")
        XCTAssertEqual(path[1], CGPoint(x: 140, y: 300), "into the top")
    }

    func testANodeOffToOneSideTakesASingleCorner() {
        let away = CGRect(x: 320, y: 260, width: 80, height: 40)
        let path = ConnectorRouting.path(from: left, to: away)
        XCTAssertEqual(path.count, 3, "one bend is the fewest that joins them: \(path)")
        XCTAssertTrue(isOrthogonal(path))
        XCTAssertEqual(path.first, CGPoint(x: 180, y: 120), "out of the side that faces it")
        XCTAssertEqual(path.last, CGPoint(x: 360, y: 260), "and down into the top of the other")
    }

    func testTwoNodesOnTopOfEachOtherStillGetAnOrthogonalLine() {
        let path = ConnectorRouting.path(from: left, to: CGRect(x: 120, y: 110, width: 80, height: 40))
        XCTAssertTrue(isOrthogonal(path), "a diagonal is never drawn: \(path)")
        XCTAssertGreaterThanOrEqual(path.count, 2)
    }

    func testNodesSideBySideAtDifferentHeightsTakeTheCorridorBetweenThem() {
        // Ten points out of line: too far to draw straight, and too little
        // for a single corner to reach a side face on — so it goes out,
        // across the gap, and in.
        let right = CGRect(x: 300, y: 110, width: 80, height: 40)
        let path = ConnectorRouting.path(from: left, to: right)
        XCTAssertTrue(isOrthogonal(path))
        XCTAssertEqual(path.count, 4, "two bends: \(path)")
        XCTAssertEqual(path[1].x, 240, accuracy: 0.001, "halfway between the facing sides")
        XCTAssertEqual(path[2].x, 240, accuracy: 0.001)
    }

    func testTheLineGoesRoundANodeInTheWay() {
        let right = CGRect(x: 400, y: 130, width: 80, height: 40)
        let between = CGRect(x: 230, y: 90, width: 60, height: 120)
        let blocked = ConnectorRouting.path(from: left, to: right, obstacles: [between])
        XCTAssertTrue(isOrthogonal(blocked))
        XCTAssertTrue(ConnectorRouting.clear(blocked, of: [between]), "it still crosses it: \(blocked)")
    }

    func testTwoLinesInOneCorridorAreMovedApart() {
        let rightA = CGRect(x: 300, y: 110, width: 80, height: 40)
        let leftB = CGRect(x: 100, y: 200, width: 80, height: 40)
        let rightB = CGRect(x: 300, y: 210, width: 80, height: 40)
        let a = ConnectorRouting.path(from: left, to: rightA)
        let b = ConnectorRouting.path(from: leftB, to: rightB)
        XCTAssertEqual(a.count, 4)
        XCTAssertEqual(a[1].x, b[1].x, accuracy: 0.001, "they would share a corridor")

        let lanes = ConnectorRouting.channels(for: [a, b], fixed: [])
        XCTAssertNotEqual(lanes[0], lanes[1], "so they are given different lanes")
        let moved = ConnectorRouting.path(from: leftB, to: rightB, channel: lanes[1])
        XCTAssertNotEqual(moved[1].x, a[1].x, accuracy: 0.001, "and one of them steps aside")
    }

    func testALineDraggedByHandKeepsItsLane() {
        let a = ConnectorRouting.path(from: left, to: CGRect(x: 300, y: 110, width: 80, height: 40))
        let lanes = ConnectorRouting.channels(for: [a, a], fixed: [0])
        XCTAssertEqual(lanes[0], 0, "the one that was dragged does not move")
    }

    func testDraggingASegmentMovesItAndStretchesItsNeighbours() {
        let path = [CGPoint(x: 0, y: 0), CGPoint(x: 50, y: 0), CGPoint(x: 50, y: 100), CGPoint(x: 100, y: 100)]
        let moved = ConnectorRouting.moved(path, segment: 1, to: 80)
        XCTAssertEqual(moved[0], CGPoint(x: 0, y: 0), "the ends stay put")
        XCTAssertEqual(moved[3], CGPoint(x: 100, y: 100))
        XCTAssertEqual(moved[1], CGPoint(x: 80, y: 0), "the corners follow")
        XCTAssertEqual(moved[2], CGPoint(x: 80, y: 100))
        XCTAssertTrue(isOrthogonal(moved))
    }

    func testEverySegmentHasACircleInTheMiddleOfIt() {
        let path = [CGPoint(x: 0, y: 0), CGPoint(x: 50, y: 0), CGPoint(x: 50, y: 100)]
        let middles = ConnectorRouting.midpoints(of: path)
        XCTAssertEqual(middles.count, 2)
        XCTAssertEqual(middles[0].point, CGPoint(x: 25, y: 0))
        XCTAssertFalse(middles[0].vertical)
        XCTAssertEqual(middles[1].point, CGPoint(x: 50, y: 50))
        XCTAssertTrue(middles[1].vertical)
    }

    func testAnOverrideIsPutBackAndAnEndStaysOnItsNode() {
        let size = CGSize(width: 1000, height: 1000)
        let path = [CGPoint(x: 0, y: 0), CGPoint(x: 50, y: 0), CGPoint(x: 50, y: 100), CGPoint(x: 100, y: 100)]
        let override = ConnectorItem.SegmentOverride(index: 1, vertical: true, value: 0.3)
        let applied = ConnectorRouting.applying([override], to: path, start: nil, end: nil, in: size)
        XCTAssertEqual(applied[1].x, 300, accuracy: 0.001)
        XCTAssertEqual(applied[2].x, 300, accuracy: 0.001)

        // An override for a segment that now runs the other way is dropped.
        let stale = ConnectorItem.SegmentOverride(index: 0, vertical: true, value: 0.9)
        XCTAssertEqual(ConnectorRouting.applying([stale], to: path, start: nil, end: nil, in: size), path)
    }

    func testAnEndDraggedOffItsNodeIsPulledBackToItsEdge() {
        let box = CGRect(x: 100, y: 100, width: 80, height: 40)
        XCTAssertEqual(ConnectorRouting.clamped(CGPoint(x: 500, y: 118), to: box), CGPoint(x: 180, y: 118))
        XCTAssertEqual(ConnectorRouting.clamped(CGPoint(x: 140, y: 0), to: box), CGPoint(x: 140, y: 100))
    }

    func testAConnectorRemembersItsCornersThroughASave() throws {
        let connector = ConnectorItem(start: CGPoint(x: 0.1, y: 0.1), end: CGPoint(x: 0.5, y: 0.5),
                                      startNode: UUID(), colorHex: "#000000",
                                      bends: [CGPoint(x: 0.3, y: 0.1)],
                                      overrides: [.init(index: 0, vertical: false, value: 0.25)])
        let data = try JSONEncoder().encode(connector)
        let back = try JSONDecoder().decode(ConnectorItem.self, from: data)
        XCTAssertEqual(back.bends, connector.bends)
        XCTAssertEqual(back.overrides, connector.overrides)
        XCTAssertEqual(back.route.count, 3)
        XCTAssertTrue(back.isRouted)

        // Two hashes: the colour's own # would close a single-hash raw string.
        let old = Data(##"{"start":[0.1,0.1],"end":[0.5,0.5],"colorHex":"#000000","lineWidth":2}"##.utf8)
        let plain = try JSONDecoder().decode(ConnectorItem.self, from: old)
        XCTAssertTrue(plain.bends.isEmpty)
        XCTAssertFalse(plain.isRouted, "a line from the palette is not routed")
    }
}
