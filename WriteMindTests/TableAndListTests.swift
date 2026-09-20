import XCTest
@testable import WriteMind

/// Tables, and the three shapes a list can take.
final class MarkdownTableTests: XCTestCase {
    func testABlankTableCarriesItsGridChoiceInItsPipes() {
        let grid = MarkdownTable.blank(columns: 2, rows: 1, grid: true)
        XCTAssertEqual(grid, "| Column 1 | Column 2 |\n| --- | --- |\n|   |   |\n")
        let open = MarkdownTable.blank(columns: 2, rows: 1, grid: false)
        XCTAssertEqual(open, "Column 1 | Column 2\n--- | ---\n  |  \n")
    }

    func testParsingReadsTheCellsAndTheGridChoiceBack() throws {
        let table = try XCTUnwrap(MarkdownTable.parse(["| a | b |", "| --- | :-: |", "| 1 | 2 |"]))
        XCTAssertEqual(table.header, ["a", "b"])
        XCTAssertEqual(table.rows, [["1", "2"]])
        XCTAssertTrue(table.grid)
        let open = try XCTUnwrap(MarkdownTable.parse(["a | b", "--- | ---", "1 | 2"]))
        XCTAssertFalse(open.grid)
        XCTAssertEqual(open.header, ["a", "b"])
    }

    func testARowIsPaddedOrTrimmedToTheHeaderSoTheGridIsRectangular() throws {
        let table = try XCTUnwrap(MarkdownTable.parse(["| a | b |", "| --- | --- |", "| 1 |", "| 1 | 2 | 3 |"]))
        XCTAssertEqual(table.rows, [["1", ""], ["1", "2"]])
    }

    func testAnEscapedPipeStaysInsideItsCell() {
        XCTAssertEqual(MarkdownTable.cells(of: #"| a \| b | c |"#), ["a | b", "c"])
    }

    func testWithoutASeparatorLineItIsNotATable() {
        XCTAssertNil(MarkdownTable.parse(["| a | b |", "| 1 | 2 |"]))
        XCTAssertFalse(MarkdownTable.isSeparator("| a | b |"))
        XCTAssertTrue(MarkdownTable.isSeparator("|---|---|"))
        XCTAssertTrue(MarkdownTable.isSeparator("--- | :---:"))
    }

    func testTheParserPicksTheTableOutOfTheNote() {
        let note = "before\n\n| a | b |\n| --- | --- |\n| 1 | 2 |\n\nafter"
        let blocks = MarkdownParser.blocks(from: note)
        XCTAssertEqual(blocks.count, 3, "got \(blocks)")
        guard case .table(let table) = blocks[1] else { return XCTFail("no table in \(blocks)") }
        XCTAssertEqual(table.header, ["a", "b"])
        XCTAssertEqual(table.rows, [["1", "2"]])
    }

    func testAPipeInProseIsNotATable() {
        XCTAssertEqual(MarkdownParser.blocks(from: "a | b is not a table"),
                       [.paragraph("a | b is not a table")])
    }

    func testTheButtonWritesATableWithTheFirstHeaderCellSelected() {
        let text = "hi"
        let edit = MarkdownFormatting.insertTable(text: text, selection: NSRange(location: 2, length: 0))
        let out = (text as NSString).replacingCharacters(in: edit.range, with: edit.replacement)
        XCTAssertTrue(out.hasPrefix("hi\n| Column 1 |"), out)
        XCTAssertEqual((out as NSString).substring(with: edit.selection), "Column 1")
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
