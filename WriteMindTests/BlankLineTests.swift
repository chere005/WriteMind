import XCTest
@testable import WriteMind

/// Blank lines are the note's, not the editor's (Sean, 2026-09-20: "in
/// markdown that should be 8 literal blank lines… the line after baz would
/// be a part of baz, the next line starts new data, the line preceding
/// # asdf is basically indicating the following line starts a new cell. so
/// there's 3 cells there.. one with 8 empty lines.. and autospacing
/// between the cells").
final class BlankLineTests: XCTestCase {
    private func kinds(_ text: String) -> [String] {
        MarkdownParser.positioned(from: text).map { block in
            switch block.block {
            case .paragraph: return "paragraph"
            case .heading: return "heading"
            case .blank(let lines): return "blank(\(lines))"
            case .code: return "code"
            default: return "other"
            }
        }
    }

    func testTenBlankLinesAreThreeCellsOneOfThemEightLinesTall() {
        let note = "baz\n" + String(repeating: "\n", count: 10) + "# asdf"
        XCTAssertEqual(kinds(note), ["paragraph", "blank(8)", "heading"])
    }

    func testOneBlankLineIsJustTheSeamBetweenTwoCells() {
        XCTAssertEqual(kinds("foo\n\nbar"), ["paragraph", "paragraph"])
    }

    func testTwoBlankLinesAreTheTwoSeparatorsAndNothingBetween() {
        XCTAssertEqual(kinds("foo\n\n\nbar"), ["paragraph", "paragraph"])
    }

    func testThreeMakeACellOfOneEmptyLine() {
        XCTAssertEqual(kinds("foo\n\n\n\nbar"), ["paragraph", "blank(1)", "paragraph"])
    }

    func testTheEmptyCellHasItsOwnPlaceInTheNote() {
        let note = "foo\n\n\n\n\nbar"
        let blocks = MarkdownParser.positioned(from: note)
        guard blocks.count == 3 else { return XCTFail("got \(kinds(note))") }
        XCTAssertGreaterThan(blocks[1].range.location, blocks[0].range.location)
        XCTAssertLessThan(blocks[1].range.location, blocks[2].range.location)
    }

    func testTheCellAfterAnEmptyCellCoversItsOwnText() {
        // The blank cell used to leave the open block's end behind it, so
        // the cell after it came out with a range of NEGATIVE length —
        // {14, -2} for this note. Every seam and every edit of a rendered
        // cell is measured off these ranges, so they have to be real.
        let note = "baz\n" + String(repeating: "\n", count: 10) + "# asdf"
        let blocks = MarkdownParser.positioned(from: note)
        guard blocks.count == 3 else { return XCTFail("got \(kinds(note))") }
        XCTAssertEqual(blocks[0].range, NSRange(location: 0, length: 3), "baz")
        XCTAssertGreaterThan(blocks[2].range.length, 0)
        XCTAssertEqual(blocks[2].range, NSRange(location: 14, length: 6), "# asdf, and only it")
    }

    func testBlankLinesInsideAFenceAreStillCode() {
        XCTAssertEqual(kinds("```swift\nlet a = 1\n\n\n\nlet b = 2\n```"), ["code"])
    }

    func testOnlyTheSeparatorsAreDrawnSmall() {
        // The lines a cell is made of keep their height; the one that ends
        // the cell above and the one that announces the next do not.
        let note = "baz\n" + String(repeating: "\n", count: 10) + "# asdf"
        XCTAssertEqual(MarkdownSourceStyle.structuralLines(in: note).count, 2)
    }

    func testASingleSeamIsDrawnSmall() {
        XCTAssertEqual(MarkdownSourceStyle.structuralLines(in: "foo\n\nbar").count, 1)
    }
}
