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

    /// WHAT A HOVER PROMISES IS WHAT A CLICK TAKES (Sean, 2026-09-22:
    /// "hovering over sections on the right side should faintly indicate
    /// what would be selected if clicked"). Both gutters ask
    /// `CellSelection.cells(of:in:)` over the brackets they call cells —
    /// so a section promises the cells under it, a pair promises the two
    /// in it, and neither promises its own merged range.
    func testAHoverPromisesTheCellsAClickWouldTake() {
        let input = NSRange(location: 10, length: 20)
        let output = NSRange(location: 32, length: 12)
        let after = NSRange(location: 46, length: 8)
        let brackets = [
            CellBrackets.Bracket(key: "Notes", depth: 0, top: 0, bottom: 90,
                                 foldable: true, range: NSRange(location: 0, length: 54)),
            CellBrackets.Bracket(key: "eval:10", depth: 1, top: 10, bottom: 60,
                                 group: true, range: NSRange(location: 10, length: 34)),
            CellBrackets.Bracket(key: "cell:10", depth: 2, top: 10, bottom: 34, range: input),
            CellBrackets.Bracket(key: "cell:32", depth: 2, top: 36, bottom: 60, range: output),
            CellBrackets.Bracket(key: "cell:46", depth: 1, top: 62, bottom: 90, range: after),
        ]
        let cells = brackets.filter(\.isCell).map(\.range)
        XCTAssertEqual(cells, [input, output, after], "the pair's own bracket is not a cell")

        func promise(_ key: String) -> [NSRange] {
            let bracket = brackets.first { $0.key == key }!
            return CellSelection.cells(of: bracket.range, in: cells)
        }
        XCTAssertEqual(promise("eval:10"), [input, output], "a pair promises the two in it")
        XCTAssertEqual(promise("Notes"), [input, output, after])
        XCTAssertEqual(promise("cell:32"), [output], "a cell promises itself and nothing else")
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
