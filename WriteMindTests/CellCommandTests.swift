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

    // MARK: - Several cells at once

    private let four = "One\n\nTwo\n\nThree\n\nFour"

    private func applying(_ edits: [MarkdownFormatting.Edit], to text: String) -> String {
        var out = text as NSString
        for edit in edits { out = out.replacingCharacters(in: edit.range, with: edit.replacement) as NSString }
        return out as String
    }

    private func deleting(_ picked: [NSRange], in text: String) -> String {
        applying(CellCommands.edits(over: picked, in: text) { CellCommands.delete($0, in: $1) }, to: text)
    }

    func testTheEditsComeBackBackToFront() {
        let cells = MarkdownParser.positioned(from: four).map(\.range)
        let edits = CellCommands.edits(over: [cells[0], cells[2]], in: four) {
            CellCommands.delete($0, in: $1)
        }
        XCTAssertEqual(edits.count, 2)
        XCTAssertGreaterThan(edits[0].range.location, edits[1].range.location,
                             "the one further down the note is made first")
    }

    func testTakingTwoCellsThatAreNotNeighboursLeavesTheOnesBetween() {
        // The back-to-front ordering IS this test: made front to back, the
        // first edit moves every character the second one names, and the
        // note comes out cut in the wrong places.
        let cells = MarkdownParser.positioned(from: four).map(\.range)
        XCTAssertEqual(deleting([cells[0], cells[2]], in: four), "Two\n\nFour")
    }

    func testTakingThreeCellsAtOnceClosesTheStackBehindThem() {
        let cells = MarkdownParser.positioned(from: four).map(\.range)
        XCTAssertEqual(deleting([cells[0], cells[1], cells[2]], in: four), "Four")
    }

    func testTakingTheCellsAtTheEndOfTheNoteTakesTheBlankLineAboveThem() {
        // A run at the end has nothing below to close up, so the blank
        // line ABOVE the run goes — the whole run, not each cell of it.
        XCTAssertEqual(deleting([cell(1), cell(2)], in: note), "First cell")
    }

    func testACellHandedInTwiceIsStillTakenOnce() {
        XCTAssertEqual(deleting([cell(1), cell(1)], in: note), "First cell\n\nThird cell")
    }

    func testARangeOverSeveralCellsMeansAllOfThem() {
        // A section's own bracket holds its cells; ⌃⌫ on it takes them.
        let whole = NSRange(location: cell(0).location, length: NSMaxRange(cell(1)) - cell(0).location)
        XCTAssertEqual(deleting([whole], in: note), "Third cell")
    }

    func testDuplicatingSeveralCellsPutsTheWholeRunUnderItself() {
        XCTAssertEqual(applying(CellCommands.edits(over: [cell(0), cell(1)], in: note) {
            CellCommands.duplicate($0, in: $1)
        }, to: note),
                       "First cell\n\nSecond cell\n\nFirst cell\n\nSecond cell\n\nThird cell")
    }

    func testMovingSeveralCellsMovesTheWholeRun() {
        let run = NSRange(location: cell(1).location, length: NSMaxRange(cell(2)) - cell(1).location)
        XCTAssertEqual(applying(CellCommands.move(run, up: true, in: note), to: note),
                       "Second cell\n\nThird cell\n\nFirst cell")
    }

    func testNothingSelectedIsNothingDone() {
        XCTAssertTrue(CellCommands.edits(over: [], in: note) { CellCommands.delete($0, in: $1) }.isEmpty)
    }
}
