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

    func testTheCaretLandsBetweenTheTwoNewCells() {
        // Not at the top of the second one. The line the break puts in is
        // where the cursor goes (Sean, 2026-09-20: "when dividing a cell,
        // the cursor should go inbetween the new cells"), and the pane it
        // lands in turns it into the bar.
        let edit = NotebookCells.split(text: "One two", selection: NSRange(location: 4, length: 0))
        XCTAssertEqual(edit?.selection, NSRange(location: 4, length: 0))
        XCTAssertEqual(edit?.replacement, "\n\n")
    }

    func testTheBreakAbsorbsTheNewlineThatIsAlreadyThere() {
        // `isBlank` counted a space and a tab and not a newline, so a cut
        // at a LINE boundary left the newline standing and wrote two more
        // on top of it: "One\ntwo" came out "One\n\n\ntwo", two cells with
        // an empty line between them that nobody typed (Sean, 2026-09-20:
        // "there shouldn't be a spuriously added newline").
        XCTAssertEqual(split("One\ntwo", at: 4), "One\n\ntwo")
        XCTAssertEqual(split("One\ntwo", at: 3), "One\n\ntwo", "and from the other side of it")
    }

    func testAListSplitBetweenTwoOfItsItemsIsTwoLists() {
        XCTAssertEqual(split("- a\n- b", at: 4), "- a\n\n- b")
    }

    func testTheSpacesHangingOffTheEndOfTheLineGoWithTheBreak() {
        // A hard line break — two spaces and a newline — is three
        // characters of whitespace at the cut, and all three belong to it.
        XCTAssertEqual(split("One  \ntwo", at: 6), "One\n\ntwo")
    }

    func testASplitAddsExactlyOneCellAndNeverAnEmptyOne() {
        for (text, caret) in Self.cuts.map({ ($0.text, $0.caret) }) {
            guard let cut = split(text, at: caret) else {
                XCTFail("\(text.debugDescription) at \(caret) did not split")
                continue
            }
            let before = MarkdownParser.positioned(from: text)
            let after = MarkdownParser.positioned(from: cut)
            XCTAssertEqual(after.count, before.count + 1, "\(cut.debugDescription)")
            // ONE blank line between the halves, which is what a seam is.
            // Three newlines in a row is the empty line nobody typed —
            // the whole of the bug, stated as an assertion. (The run
            // before the fix printed "One\n\n\ntwo" and "- a\n\n\n- b".)
            XCTAssertFalse(cut.contains("\n\n\n"), "\(cut.debugDescription) has an empty line in it")
            for cell in after {
                if case .blank = cell.block {
                    XCTFail("\(cut.debugDescription) grew a cell of empty lines")
                }
            }
        }
    }

    func testTheCaretTheSplitLeavesArmsTheSeamBetweenTheHalves() {
        // The cursor half, end to end. `CellSeams.arm` is the one writer
        // of the armed state — arming follows the caret — so putting the
        // caret on the separator blank line IS putting the bar between
        // the two new cells, in both panes and with no second mechanism.
        for cut in Self.cuts {
            guard let edit = NotebookCells.split(text: cut.text,
                                                 selection: NSRange(location: cut.caret, length: 0))
            else {
                XCTFail("\(cut.text.debugDescription) at \(cut.caret) did not split")
                continue
            }
            let after = (cut.text as NSString).replacingCharacters(in: edit.range, with: edit.replacement)
            XCTAssertEqual(after, cut.after)
            XCTAssertEqual(edit.selection, NSRange(location: cut.bar, length: 0))
            XCTAssertEqual(CellSeams.arm(caret: edit.selection, in: after, current: nil), cut.seam,
                           "\(cut.after.debugDescription)")
        }
    }

    /// The cuts the two tests above share: the note, where it is cut, what
    /// it becomes, where the caret is left, and the seam that arms.
    private static let cuts: [(text: String, caret: Int, after: String, bar: Int, seam: Int)] = [
        ("One two three", 7, "One two\n\nthree", 8, 9),
        ("One\ntwo", 4, "One\n\ntwo", 4, 5),
        ("- a\n- b", 4, "- a\n\n- b", 4, 5),
        ("One  \ntwo", 6, "One\n\ntwo", 4, 5),
        ("First cell\n\nSecond cell here", 18, "First cell\n\nSecond\n\ncell here", 19, 20),
    ]

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
