import XCTest
@testable import WriteMind

/// ⌘D and ⌘M (Sean, 2026-09-19: "cmd+d and cmd+m to split and merge cells").
final class NotebookCellTests: XCTestCase {
    private func split(_ text: String, at caret: Int) -> String? {
        guard let edit = NotebookCells.split(text: text, selection: NSRange(location: caret, length: 0))
        else { return nil }
        return (text as NSString).replacingCharacters(in: edit.range, with: edit.replacement)
    }

    private func merge(_ text: String, at caret: Int) -> String? {
        guard let edit = NotebookCells.merge(text: text, selection: NSRange(location: caret, length: 0))
        else { return nil }
        return (text as NSString).replacingCharacters(in: edit.range, with: edit.replacement)
    }

    // MARK: - Split

    func testSplitCutsTheCellAtTheCaret() {
        let text = "One two three"
        XCTAssertEqual(split(text, at: 7), "One two\n\nthree")
    }

    func testSplitTakesTheSpaceTheCaretSitsIn() {
        // "One | two" leaves no space hanging off either cell.
        XCTAssertEqual(split("One two", at: 3), "One\n\ntwo")
        XCTAssertEqual(split("One two", at: 4), "One\n\ntwo")
    }

    func testTheCaretLandsAtTheTopOfTheNewCell() {
        let edit = NotebookCells.split(text: "One two", selection: NSRange(location: 4, length: 0))
        XCTAssertEqual(edit?.selection, NSRange(location: 5, length: 0))
        XCTAssertEqual(edit?.replacement, "\n\n")
    }

    func testNothingIsSplitOffTheEndsOfACell() {
        XCTAssertNil(split("One two", at: 0), "an empty cell above it is not a split")
        XCTAssertNil(split("One two", at: 7), "nor one below it")
    }

    func testAFencedBlockIsNotSplit() {
        // A blank line inside a fence is a hole in one block, not two blocks.
        let text = "```swift\nlet a = 1\nlet b = 2\n```"
        XCTAssertNil(split(text, at: 18))
    }

    func testSplittingTheSecondCellLeavesTheFirstAlone() {
        let text = "First cell\n\nSecond cell here"
        XCTAssertEqual(split(text, at: 18), "First cell\n\nSecond\n\ncell here")
    }

    // MARK: - Merge

    func testMergeJoinsTheCellWithTheOneAfterIt() {
        XCTAssertEqual(merge("One\n\nTwo", at: 1), "One\nTwo")
    }

    func testMergeInTheLastCellJoinsItToTheOneBefore() {
        XCTAssertEqual(merge("One\n\nTwo", at: 6), "One\nTwo")
    }

    func testMergeUndoesASplit() {
        let text = "One two three"
        let cut = try? XCTUnwrap(split(text, at: 7))
        XCTAssertEqual(merge(cut ?? "", at: 2), text.replacingOccurrences(of: "One two three",
                                                                          with: "One two\nthree"))
    }

    func testAHeadingWillNotSwallowTheCellUnderIt() {
        XCTAssertNil(merge("# Title\n\nWords under it", at: 2))
    }

    func testAFencedBlockIsNotMerged() {
        XCTAssertNil(merge("Words\n\n```\ncode\n```", at: 2))
        XCTAssertNil(merge("```\ncode\n```\n\nWords", at: 1))
    }

    func testOneCellOnItsOwnHasNothingToMergeWith() {
        XCTAssertNil(merge("Just the one cell", at: 4))
        XCTAssertNil(merge("", at: 0))
    }

    func testTheCaretEndsOnTheSeam() {
        let edit = NotebookCells.merge(text: "One\n\nTwo", selection: NSRange(location: 1, length: 0))
        XCTAssertEqual(edit?.selection, NSRange(location: 4, length: 0))
    }
}

/// ⌘. — the selection grown a step at a time, as in a notebook (Sean,
/// 2026-09-20: "make cells behave like mathematica cells").
final class ExpandSelectionTests: XCTestCase {
    private let note = "# Title\n\nFirst cell here\n\nSecond cell"

    private func expanding(from range: NSRange, times: Int) -> [String] {
        var out: [String] = []
        var current = range
        for _ in 0..<times {
            guard let wider = NotebookCells.expand(current, in: note) else { break }
            out.append((note as NSString).substring(with: wider))
            current = wider
        }
        return out
    }

    func testTheCaretTakesItsWordFirst() {
        XCTAssertEqual(expanding(from: NSRange(location: 12, length: 0), times: 1), ["First"])
    }

    func testThenTheCellThenTheSectionThenTheNote() {
        let steps = expanding(from: NSRange(location: 12, length: 0), times: 4)
        XCTAssertEqual(steps.first, "First")
        XCTAssertEqual(steps.dropFirst().first, "First cell here")
        XCTAssertTrue(steps.last?.contains("# Title") == true, "got \(steps)")
        XCTAssertTrue(steps.count >= 3, "got \(steps)")
    }

    func testItStopsWhenThereIsNothingBigger() {
        let whole = NSRange(location: 0, length: (note as NSString).length)
        XCTAssertNil(NotebookCells.expand(whole, in: note))
    }

    func testACaretInASpaceTakesTheCellRatherThanAWord() {
        // Between two words there is no word to take. (14 is the space
        // after "First": 0–6 the heading, 7 and 8 the newlines, 9–13
        // "First".)
        let space = NSRange(location: 14, length: 0)
        XCTAssertEqual(NotebookCells.expand(space, in: note).map { (note as NSString).substring(with: $0) },
                       "First cell here")
    }

    func testAnEmptyNoteExpandsToNothing() {
        XCTAssertNil(NotebookCells.expand(NSRange(location: 0, length: 0), in: ""))
    }
}
