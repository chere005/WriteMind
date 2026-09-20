import XCTest
@testable import WriteMind

/// Holding several cells at once (Sean, 2026-09-20: "fix selecting multiple
/// cells by clicking and dragging, shift clicking, or cmd clicking").
///
/// The gestures themselves are checked on screen; what is pinned here is the
/// arithmetic under them, which is the part that can be wrong silently.
final class CellSelectionTests: XCTestCase {
    private let note = "First cell\n\nSecond cell\n\nThird cell"
    private var cells: [NSRange] { MarkdownParser.positioned(from: note).map(\.range) }

    // MARK: - What lights a bracket

    func testOneRangeOverTheWholeCellPicksIt() {
        XCTAssertTrue(CellSelection.covers(cells[1], [cells[1]]))
        XCTAssertTrue(CellSelection.covers(cells[1], [NSRange(location: 0, length: 40)]))
        XCTAssertFalse(CellSelection.covers(cells[1], [NSRange(location: 12, length: 4)]))
    }

    func testTwoCellsPickedSeparatelyDoNotPickTheSectionRoundThem() {
        // The reason it is any ONE range and never their union: two
        // adjacent cells held separately are two cells, not the group that
        // holds them, or every bracket out to the margin would light up.
        let selection = [cells[0], cells[1]]
        let section = NSRange(location: cells[0].location,
                              length: NSMaxRange(cells[1]) - cells[0].location)
        XCTAssertTrue(CellSelection.covers(cells[0], selection))
        XCTAssertTrue(CellSelection.covers(cells[1], selection))
        XCTAssertFalse(CellSelection.covers(section, selection),
                       "the blank line between them is in neither range")
    }

    func testPickedIsEveryCellABracketWouldLight() {
        XCTAssertEqual(CellSelection.picked(cells: cells, selection: [cells[2], cells[0]]),
                       [cells[0], cells[2]], "in the note's order, whatever order they were taken in")
        XCTAssertEqual(CellSelection.picked(cells: cells, selection: [NSRange(location: 2, length: 0)]), [])
    }

    // MARK: - Shift, and the drag

    func testExtendingReachesEveryCellBetweenTheTwo() {
        XCTAssertEqual(CellSelection.between(cells[0], cells[2], in: cells), cells)
        XCTAssertEqual(CellSelection.between(cells[2], cells[0], in: cells), cells,
                       "a drag upwards reaches the same cells")
        XCTAssertEqual(CellSelection.between(cells[1], cells[1], in: cells), [cells[1]])
    }

    func testExtendingFromARangeThatIsNotACellStillReachesTheOneClicked() {
        let nowhere = NSRange(location: 900, length: 4)
        XCTAssertEqual(CellSelection.between(nowhere, cells[1], in: cells), [cells[1]])
    }

    func testTogglingTakesACellOutAndPutsItBack() {
        let both = CellSelection.toggling(cells[2], in: [cells[0]])
        XCTAssertEqual(both, [cells[0], cells[2]])
        XCTAssertEqual(CellSelection.toggling(cells[0], in: both), [cells[2]],
                       "cmd-clicking one out of the middle leaves a hole")
    }

    // MARK: - Which bracket the pointer is on

    private let spans: [CellSelection.Span] = [
        (top: 0, bottom: 20, range: NSRange(location: 0, length: 10)),
        (top: 30, bottom: 50, range: NSRange(location: 12, length: 11))
    ]

    func testADragInsideACellsBracketIsOnThatCell() {
        XCTAssertEqual(CellSelection.cell(at: 10, in: spans), spans[0].range)
        XCTAssertEqual(CellSelection.cell(at: 40, in: spans), spans[1].range)
    }

    func testADragOverTheSpaceBetweenTwoCellsTakesTheNearer() {
        // The pointer spends half a drag in the seams; a drag that let go
        // while it crossed one would flicker the whole way down the page.
        XCTAssertEqual(CellSelection.cell(at: 24, in: spans), spans[0].range)
        XCTAssertEqual(CellSelection.cell(at: 27, in: spans), spans[1].range)
        XCTAssertEqual(CellSelection.cell(at: 900, in: spans), spans[1].range,
                       "dragged off the bottom of the page: the last cell")
    }

    func testAnEmptyPageHasNoCellToDragOver() {
        XCTAssertNil(CellSelection.cell(at: 10, in: []))
    }
}

/// The gutter takes every click inside it — the bug this step began with
/// was that it took only the four points either side of a bracket's line,
/// so the mouse down at the top of a drag never reached the view at all.
final class GutterClickTests: XCTestCase {
    private func gutter() -> NotebookGutter {
        let pane = NSView(frame: NSRect(x: 0, y: 0, width: 200, height: 200))
        let view = NotebookGutter(frame: NSRect(x: 0, y: 0, width: NotebookGutter.width, height: 200))
        view.brackets = [.init(key: "cell:0", depth: 0, top: 0, bottom: 20, collapsed: false,
                               range: NSRange(location: 0, length: 10))]
        pane.addSubview(view)
        return view
    }

    func testAClickWhereThereIsNoBracketStaysInTheGutter() {
        // Nothing happens, and it does not reach the text behind: a click
        // on the note's furniture must not put a caret in the note. And a
        // drag that starts here is a drag this view can follow.
        let view = gutter()
        XCTAssertTrue(view.hitTest(NSPoint(x: 11, y: 150)) === view, "far below the only bracket")
        XCTAssertTrue(view.hitTest(NSPoint(x: 2, y: 8)) === view, "the far side of the column")
    }

    func testAClickOutsideTheGutterIsNoneOfItsBusiness() {
        XCTAssertNil(gutter().hitTest(NSPoint(x: 100, y: 100)))
    }
}

/// And what a key means while the rendered page is holding cells. It has
/// no text view to type over a selection with, the way the markdown pane
/// has, so the meanings are spelled out and tested here.
final class HeldCellKeyTests: XCTestCase {
    func testAPrintableCharacterReplacesWhatIsHeld() {
        XCTAssertEqual(MarkdownPreview.cellKey(characters: "x", modifiers: []), .replace("x"))
        XCTAssertEqual(MarkdownPreview.cellKey(characters: "X", modifiers: .shift), .replace("X"))
        XCTAssertEqual(MarkdownPreview.cellKey(characters: "#", modifiers: .shift), .replace("#"))
    }

    func testADeleteTakesThemAndEscapeLetsThemGo() {
        XCTAssertEqual(MarkdownPreview.cellKey(characters: "\u{8}", modifiers: []), .remove, "backspace")
        XCTAssertEqual(MarkdownPreview.cellKey(characters: "\u{7F}", modifiers: []), .remove, "forward delete")
        XCTAssertEqual(MarkdownPreview.cellKey(characters: "\u{1B}", modifiers: []), .clear)
    }

    func testAShortcutIsNotTyping() {
        // ⌃⌫ is the Delete Cell menu item and ⌘S is not an S; both are
        // somebody else's before they are ever this.
        XCTAssertEqual(MarkdownPreview.cellKey(characters: "\u{8}", modifiers: .control), .pass)
        XCTAssertEqual(MarkdownPreview.cellKey(characters: "s", modifiers: .command), .pass)
        XCTAssertEqual(MarkdownPreview.cellKey(characters: "\u{F701}", modifiers: []), .pass, "an arrow")
        XCTAssertEqual(MarkdownPreview.cellKey(characters: "", modifiers: []), .pass)
    }
}
