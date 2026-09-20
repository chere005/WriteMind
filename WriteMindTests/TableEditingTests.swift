import XCTest
@testable import WriteMind

/// A table on the rendered page is a grid you tab through, with rows and
/// columns added and taken away (the to-do list, 2026-09-19).
final class TableEditingTests: XCTestCase {
    private func table(_ markdown: String) -> MarkdownTable {
        MarkdownTable.parse(markdown.components(separatedBy: "\n"))!
    }

    private var three: MarkdownTable {
        table("| A | B |\n| --- | --- |\n| 1 | 2 |\n| 3 | 4 |")
    }

    // MARK: - Where the caret is

    func testTheHeaderIsRowZeroAndTheFirstRowIsOne() {
        XCTAssertEqual(three.text(at: .init(row: 0, column: 1)), "B")
        XCTAssertEqual(three.text(at: .init(row: 1, column: 0)), "1")
        XCTAssertEqual(three.text(at: .init(row: 2, column: 1)), "4")
        XCTAssertEqual(three.rowCount, 3, "the header and two rows")
    }

    func testACellOffTheGridIsEmptyAndUnwritable() {
        XCTAssertEqual(three.text(at: .init(row: 9, column: 0)), "")
        XCTAssertEqual(three.setting("x", at: .init(row: 9, column: 0)), three)
    }

    // MARK: - Typing

    func testTypingLandsInTheCellAndNowhereElse() {
        let edited = three.setting("nine", at: .init(row: 2, column: 0))
        XCTAssertEqual(edited.text(at: .init(row: 2, column: 0)), "nine")
        XCTAssertEqual(edited.text(at: .init(row: 2, column: 1)), "4")
        XCTAssertEqual(edited.header, ["A", "B"])
    }

    func testAPipeOrANewlineCannotBreakTheRow() {
        // Either one would end the cell or the line in the markdown.
        let edited = three.setting("a | b", at: .init(row: 1, column: 0))
        XCTAssertEqual(edited.lines[2], "| a \\| b | 2 |")
        XCTAssertEqual(MarkdownTable.parse(edited.lines)?.text(at: .init(row: 1, column: 0)), "a | b")
        XCTAssertFalse(three.setting("one\ntwo", at: .init(row: 1, column: 0)).lines[2].contains("\n"))
    }

    func testWhatIsTypedSurvivesTheRoundTripThroughMarkdown() {
        let edited = three.setting("hello", at: .init(row: 0, column: 0))
        XCTAssertEqual(MarkdownTable.parse(edited.lines), edited)
    }

    // MARK: - Tab

    func testTabRunsAlongTheRowThenDownToTheNext() {
        XCTAssertEqual(three.next(after: .init(row: 0, column: 0)), .init(row: 0, column: 1))
        XCTAssertEqual(three.next(after: .init(row: 0, column: 1)), .init(row: 1, column: 0))
        XCTAssertEqual(three.next(after: .init(row: 2, column: 0)), .init(row: 2, column: 1))
    }

    func testThereIsNothingAfterTheLastCell() {
        // Which is where the editor adds a row instead.
        XCTAssertNil(three.next(after: .init(row: 2, column: 1)))
    }

    func testShiftTabGoesBackAndStopsAtTheFirstCell() {
        XCTAssertEqual(three.previous(before: .init(row: 1, column: 0)), .init(row: 0, column: 1))
        XCTAssertEqual(three.previous(before: .init(row: 0, column: 1)), .init(row: 0, column: 0))
        XCTAssertNil(three.previous(before: .init(row: 0, column: 0)))
    }

    // MARK: - Rows and columns

    func testARowGoesInUnderTheOneTheCaretIsIn() {
        let bigger = three.insertingRow(after: 1)
        XCTAssertEqual(bigger.rows.count, 3)
        XCTAssertEqual(bigger.rows[1], ["", ""], "the new one is blank")
        XCTAssertEqual(bigger.rows[2], ["3", "4"], "and the old one moved down")
    }

    func testARowAddedFromTheHeaderGoesToTheTop() {
        XCTAssertEqual(three.insertingRow(after: 0).rows.first, ["", ""])
    }

    func testARowComesOutAndTheLastOneWillNot() {
        XCTAssertEqual(three.removingRow(1)?.rows, [["3", "4"]])
        XCTAssertNil(three.removingRow(0), "the header is not a row")
        XCTAssertNil(three.removingRow(7))
    }

    func testAColumnGoesInWithAHeadingAndABlankInEveryRow() {
        let wider = three.insertingColumn(after: 0)
        XCTAssertEqual(wider.columns, 3)
        XCTAssertEqual(wider.header[1], MarkdownTable.headerName(2))
        XCTAssertEqual(wider.rows[0], ["1", "", "2"])
    }

    func testAColumnComesOutOfEveryRowAtOnce() {
        let narrower = three.removingColumn(0)
        XCTAssertEqual(narrower?.header, ["B"])
        XCTAssertEqual(narrower?.rows, [["2"], ["4"]])
    }

    func testTheLastColumnStays() {
        let single = table("| Only |\n| --- |\n| 1 |")
        XCTAssertNil(single.removingColumn(0), "a table with no columns is not a table")
    }

    func testAnEditedTableIsStillTheSameKindOfTable() {
        // Grid lines are spelled with the outer pipes, and stay spelled that
        // way through an edit.
        let open = table("A | B\n--- | ---\n1 | 2")
        XCTAssertFalse(open.grid)
        XCTAssertFalse(open.insertingRow(after: 1).lines[0].hasPrefix("|"))
        XCTAssertTrue(three.insertingColumn(after: 1).lines[0].hasPrefix("|"))
    }
}
