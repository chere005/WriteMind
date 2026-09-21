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

    // MARK: - Replacing, not only deleting

    /// The same widening, with something put in the widened range instead
    /// of nothing — what typing over a selection does.
    private func replacing(_ range: NSRange, in text: String, with typed: String) -> String {
        let ranges = MarkerDeletion.deletions(for: range, in: text)
        let asked = MarkerDeletion.asked(range, in: ranges)
        var out = text as NSString
        for one in ranges {
            out = out.replacingCharacters(in: one, with: one == asked ? typed : "") as NSString
        }
        return out as String
    }

    func testTypingOverHalfAPairTakesTheOtherHalfWithIt() {
        // The bug the to-do list had as a delete: it is a replace as well.
        // Left alone this was "xld** here" — a closing pair with nothing
        // to close. The words that were NOT selected stay, of course.
        XCTAssertEqual(replacing(NSRange(location: 0, length: 4), in: "**bold** here", with: "x"),
                       "xld here")
    }

    func testTheTypedTextLandsWhereTheSelectionWas() {
        XCTAssertEqual(replacing(NSRange(location: 6, length: 2), in: "**bold** here", with: "X"),
                       "boldX here")
    }

    func testPastingSeveralWordsInIsTheSameRule() {
        XCTAssertEqual(replacing(NSRange(location: 1, length: 3), in: "**bold** here", with: "one two"),
                       "one twold here")
    }

    func testAskedNamesTheSelectionAndNotTheOrphanedPartner() {
        let text = "**bold** here"
        let range = NSRange(location: 0, length: 4)
        let ranges = MarkerDeletion.deletions(for: range, in: text)
        XCTAssertEqual(ranges.count, 2, "the selection, widened, and the closing pair")
        XCTAssertEqual(MarkerDeletion.asked(range, in: ranges), NSRange(location: 0, length: 4))
    }

    // MARK: - A range that runs off the end is clamped, not applied

    func testARangePastTheEndCannotBeApplied() {
        // It used to come back as given and throw on the way in.
        let ranges = MarkerDeletion.deletions(for: NSRange(location: 4, length: 80), in: "**a**\n**b**")
        for range in ranges {
            XCTAssertLessThanOrEqual(NSMaxRange(range), 11, "\(range) is off the end")
        }
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
