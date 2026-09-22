import XCTest
@testable import WriteMind

/// A bracket is one of three things, and `!foldable` is not the way to
/// ask which.
///
/// A section's bracket folds; a cell's stands for a block of the note; a
/// GROUP's stands for an evaluation cell and its answer and is neither.
/// Every gesture in both gutters — the drag that takes cells, the ranges
/// a shift-click reaches between, what counts as already picked, and the
/// spans an insertion bar is dragged across — asked `!foldable` and so
/// counted the pair's own bracket as a cell: a click on it anchored on
/// the merged range, and a drag past it took cells it never passed.
final class CellBracketKindTests: XCTestCase {
    func testOnlyACellIsACell() {
        let cell = CellBrackets.Bracket(key: "cell:0", depth: 1, top: 0, bottom: 10,
                                        range: NSRange(location: 0, length: 5))
        let section = CellBrackets.Bracket(key: "Notes", depth: 0, top: 0, bottom: 40,
                                           foldable: true, range: NSRange(location: 0, length: 40))
        let group = CellBrackets.Bracket(key: "eval:0", depth: 1, top: 0, bottom: 30,
                                         group: true, range: NSRange(location: 0, length: 30))
        XCTAssertTrue(cell.isCell)
        XCTAssertFalse(section.isCell)
        XCTAssertFalse(group.isCell, "a pair's bracket is furniture round cells, not one of them")
    }

    func testTheSourcePaneAsksTheSameQuestion() {
        let cell = NotebookGutter.Bracket(key: "cell:0", depth: 1, top: 0, bottom: 10,
                                          collapsed: false)
        var section = cell
        section.foldable = true
        var group = cell
        group.group = true
        XCTAssertTrue(cell.isCell)
        XCTAssertFalse(section.isCell)
        XCTAssertFalse(group.isCell)
    }

    /// Nesting is five points a level in a 22-point column, so a cell
    /// deep enough — three headings, and the group inside them — was
    /// drawn past the left edge and simply was not there.
    func testNestingDeeperThanTheColumnSharesTheLastLine() {
        let width = CellBrackets.width
        let deepest = CellBrackets.x(for: CellBrackets.deepest, in: width)
        XCTAssertGreaterThanOrEqual(deepest - 5, 0, "the tick still fits inside the column")
        XCTAssertEqual(CellBrackets.x(for: CellBrackets.deepest + 4, in: width), deepest)
        XCTAssertLessThan(CellBrackets.x(for: 1, in: width), CellBrackets.x(for: 0, in: width),
                          "deeper is further from the margin")
    }

    /// A pair's bracket has exactly the top and bottom of the two cells
    /// inside it, so drawn at the same length it read as a second
    /// hairline five points over rather than as a group.
    func testAGroupStandsProudOfWhatItHolds() {
        XCTAssertGreaterThan(CellBrackets.overhang, 0)
        XCTAssertEqual(CellBrackets.overhang, NotebookGutter.overhang,
                       "both panes draw the same notebook")
    }
}
