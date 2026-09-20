import XCTest
@testable import WriteMind

/// A cell you can hold: delete it, copy it, duplicate it, move it (Sean,
/// 2026-09-20: "put some effort in making cells behave like mathematica
/// cells").
final class CellCommandTests: XCTestCase {
    private let note = "First cell\n\nSecond cell\n\nThird cell"

    private func cell(_ index: Int, in text: String = "") -> NSRange {
        MarkdownParser.positioned(from: text.isEmpty ? note : text)[index].range
    }

    private func applying(_ edit: MarkdownFormatting.Edit?, to text: String) -> String {
        guard let edit else { return text }
        return (text as NSString).replacingCharacters(in: edit.range, with: edit.replacement)
    }

    // MARK: - Delete

    func testDeletingACellClosesTheStackBehindIt() {
        XCTAssertEqual(applying(CellCommands.delete(cell(1), in: note), to: note),
                       "First cell\n\nThird cell")
    }

    func testDeletingTheLastCellTakesTheBlankLineAboveIt() {
        XCTAssertEqual(applying(CellCommands.delete(cell(2), in: note), to: note),
                       "First cell\n\nSecond cell")
    }

    func testDeletingTheOnlyCellLeavesNothing() {
        let one = "The only cell"
        XCTAssertEqual(applying(CellCommands.delete(cell(0, in: one), in: one), to: one), "")
    }

    func testTheCaretLandsWhereTheCellWas() {
        let edit = CellCommands.delete(cell(0), in: note)
        XCTAssertEqual(edit.selection, NSRange(location: 0, length: 0))
    }

    // MARK: - Copy and duplicate

    func testACopiedCellIsItsOwnMarkdown() {
        XCTAssertEqual(CellCommands.copy(cell(1), in: note), "Second cell")
    }

    func testDuplicatingPutsTheSameCellUnderIt() {
        XCTAssertEqual(applying(CellCommands.duplicate(cell(0), in: note), to: note),
                       "First cell\n\nFirst cell\n\nSecond cell\n\nThird cell")
    }

    func testAPastedCellGoesInAsACellNotAsWords() {
        let edit = CellCommands.paste("## A heading", after: cell(0), in: note)
        XCTAssertEqual(applying(edit, to: note),
                       "First cell\n\n## A heading\n\nSecond cell\n\nThird cell")
        XCTAssertEqual((applying(edit, to: note) as NSString).substring(with: edit.selection),
                       "## A heading", "and it is left selected")
    }

    // MARK: - Move

    func testMovingACellUpSwapsItWithTheOneAbove() {
        XCTAssertEqual(applying(CellCommands.move(cell(1), up: true, in: note), to: note),
                       "Second cell\n\nFirst cell\n\nThird cell")
    }

    func testMovingACellDownSwapsItWithTheOneBelow() {
        XCTAssertEqual(applying(CellCommands.move(cell(1), up: false, in: note), to: note),
                       "First cell\n\nThird cell\n\nSecond cell")
    }

    func testTheCellThatMovedKeepsTheSelection() {
        let edit = try? XCTUnwrap(CellCommands.move(cell(1), up: true, in: note))
        let after = applying(edit, to: note)
        XCTAssertEqual((after as NSString).substring(with: edit!.selection), "Second cell")
    }

    func testTheEndsOfTheNoteHaveNowhereToGo() {
        XCTAssertNil(CellCommands.move(cell(0), up: true, in: note))
        XCTAssertNil(CellCommands.move(cell(2), up: false, in: note))
    }

    func testMovingKeepsWhateverSeparatedThem() {
        let spaced = "One\n\n\nTwo"
        let moved = applying(CellCommands.move(cell(1, in: spaced), up: true, in: spaced), to: spaced)
        XCTAssertEqual(moved, "Two\n\n\nOne")
    }

    func testAHeadingMovesWithItsOwnMarkdown() {
        let text = "## Title\n\nWords"
        XCTAssertEqual(applying(CellCommands.move(cell(1, in: text), up: true, in: text), to: text),
                       "Words\n\n## Title")
    }
}
