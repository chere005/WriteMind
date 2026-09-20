import XCTest
@testable import WriteMind

/// The three shapes a list can take.
///
/// This file was Tables and Lists until 2026-09-20, when tables came out of
/// the app whole (Sean: "just completely remove tables as a feature and
/// we'll rebuild that from scratch"). What the table half pinned — that a
/// line of pipes is a table, that the `---|---` rule made a header — is now
/// pinned the other way round, below: pipes are prose.

/// What a line of pipes is now that tables are gone.
final class PipesArePoseTests: XCTestCase {
    func testALineOfPipesIsAParagraphAndNotATable() {
        // The inverse of the old testTheParserPicksTheTableOutOfTheNote,
        // which passed on this very note until 2026-09-20.
        let note = "before\n\n| a | b |\n| --- | --- |\n| 1 | 2 |\n\nafter"
        let blocks = MarkdownParser.blocks(from: note)
        XCTAssertEqual(blocks.count, 3, "got \(blocks)")
        XCTAssertEqual(blocks[1], .paragraph("| a | b | | --- | --- | | 1 | 2 |"))
    }

    func testTheRuleUnderAHeaderRowNoLongerLooksAhead() {
        // `---` on its own is still a horizontal rule; it is `---|---`
        // under a row of pipes that used to make a header, and does not.
        XCTAssertEqual(MarkdownParser.blocks(from: "a | b\n--- | ---\n1 | 2"),
                       [.paragraph("a | b --- | --- 1 | 2")])
    }

    func testAPipeInProseIsStillJustProse() {
        XCTAssertEqual(MarkdownParser.blocks(from: "a | b is not a table"),
                       [.paragraph("a | b is not a table")])
    }
}

final class ListStyleTests: XCTestCase {
    private func apply(_ edit: MarkdownFormatting.Edit, to text: String) -> String {
        (text as NSString).replacingCharacters(in: edit.range, with: edit.replacement)
    }

    func testEachStyleWritesItsOwnMarker() {
        let text = "one\ntwo"
        let all = NSRange(location: 0, length: 7)
        XCTAssertEqual(apply(MarkdownFormatting.toggleList(text: text, selection: all, style: .dots), to: text),
                       "- one\n- two")
        XCTAssertEqual(apply(MarkdownFormatting.toggleList(text: text, selection: all, style: .dashes), to: text),
                       "* one\n* two")
        XCTAssertEqual(apply(MarkdownFormatting.toggleList(text: text, selection: all, style: .numbered), to: text),
                       "1. one\n2. two")
    }

    func testAskingForTheStyleAListAlreadyHasTakesTheMarkersAway() {
        let text = "- one\n- two"
        let edit = MarkdownFormatting.toggleList(text: text, selection: NSRange(location: 0, length: 11), style: .dots)
        XCTAssertEqual(apply(edit, to: text), "one\ntwo")
    }

    func testAskingForAnotherStyleSwapsTheMarkersRatherThanStackingThem() {
        let text = "- one\n- two"
        let edit = MarkdownFormatting.toggleList(text: text, selection: NSRange(location: 0, length: 11),
                                                 style: .numbered)
        XCTAssertEqual(apply(edit, to: text), "1. one\n2. two")
    }

    func testDotsAndDashesAreDifferentBlocksToThePreview() {
        XCTAssertEqual(MarkdownParser.blocks(from: "- a\n- b"), [.bullets(["a", "b"])])
        XCTAssertEqual(MarkdownParser.blocks(from: "* a\n* b"), [.dashes(["a", "b"])])
        XCTAssertEqual(MarkdownParser.blocks(from: "- a\n* b"), [.bullets(["a"]), .dashes(["b"])])
    }

    func testAStarRuleIsStillARule() {
        XCTAssertEqual(MarkdownParser.blocks(from: "***"), [.rule])
    }

    func testTheEditorShowsADashForAStarMarkerAndABulletForADash() {
        let text = "- one\n* two\nplain - not a marker" as NSString
        XCTAssertTrue(BulletGlyphs.isBulletMarker(at: 0, in: text))
        XCTAssertTrue(BulletGlyphs.isBulletMarker(at: 6, in: text))
        XCTAssertFalse(BulletGlyphs.isBulletMarker(at: text.range(of: "- not").location, in: text))
    }
}
