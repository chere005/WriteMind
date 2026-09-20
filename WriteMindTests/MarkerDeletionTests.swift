import XCTest
@testable import WriteMind

/// Deleting text whose markers are hidden (the to-do list: "a selection
/// that spans one `**` of a pair can leave `**bold*` behind").
final class MarkerDeletionTests: XCTestCase {
    /// The text left after the delete the editor would really do.
    private func deleting(_ range: NSRange, from text: String) -> String {
        var out = text as NSString
        for range in MarkerDeletion.deletions(for: range, in: text) {
            out = out.replacingCharacters(in: range, with: "") as NSString
        }
        return out as String
    }

    func testHalfAMarkerIsNeverLeftBehind() {
        // "**bo" selected out of "**bold** here".
        XCTAssertEqual(deleting(NSRange(location: 0, length: 4), from: "**bold** here"), "ld here")
    }

    func testTakingOneHalfOfAPairTakesTheOther() {
        // The closing `**` would otherwise be an opener that never closes.
        let after = deleting(NSRange(location: 0, length: 2), from: "**bold** here")
        XCTAssertEqual(after, "bold here")
    }

    func testTheOtherWayRound() {
        XCTAssertEqual(deleting(NSRange(location: 6, length: 2), from: "**bold** here"), "bold here")
    }

    func testAPairTakenWholeIsJustTakenWhole() {
        XCTAssertEqual(deleting(NSRange(location: 0, length: 8), from: "**bold** here"), " here")
    }

    func testOrdinaryTextIsDeletedExactlyAsAsked() {
        let text = "plain words here"
        XCTAssertEqual(MarkerDeletion.deletions(for: NSRange(location: 6, length: 6), in: text),
                       [NSRange(location: 6, length: 6)])
        XCTAssertEqual(deleting(NSRange(location: 6, length: 6), from: text), "plain here")
    }

    func testTextInsideAPairIsDeletedWithoutTouchingTheMarkers() {
        // The pair still has something between it, so it stays.
        XCTAssertEqual(deleting(NSRange(location: 2, length: 2), from: "**bold** here"), "**ld** here")
    }

    func testItWorksForTheOtherKindsOfMarker() {
        XCTAssertEqual(deleting(NSRange(location: 0, length: 3), from: "~~gone~~ here"), "one here")
        XCTAssertEqual(deleting(NSRange(location: 0, length: 1), from: "`code` here"), "code here")
        XCTAssertEqual(deleting(NSRange(location: 0, length: 1), from: "_slanted_ here"), "slanted here")
    }

    func testAnEmptyRangeIsLeftAlone() {
        XCTAssertEqual(MarkerDeletion.deletions(for: NSRange(location: 3, length: 0), in: "**bold**"),
                       [NSRange(location: 3, length: 0)])
    }

    func testTheRangesComeBackBackToFront() {
        // So a caller can apply them in order without re-measuring.
        let ranges = MarkerDeletion.deletions(for: NSRange(location: 0, length: 2), in: "**bold** here")
        XCTAssertEqual(ranges, ranges.sorted { $0.location > $1.location })
    }
}
