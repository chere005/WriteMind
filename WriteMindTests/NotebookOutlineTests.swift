import XCTest
@testable import WriteMind

/// The note read as a notebook: which heading owns which lines, and moving a
/// whole section past its neighbour.
final class NotebookOutlineTests: XCTestCase {
    private let note = """
    # Title

    intro

    ## Alpha

    a body

    ### Alpha one

    deeper

    ## Beta

    b body
    """

    private func apply(_ edit: MarkdownFormatting.Edit, to text: String) -> String {
        (text as NSString).replacingCharacters(in: edit.range, with: edit.replacement)
    }

    func testAHeadingOwnsEverythingUntilOneOfItsOwnRankOrHigher() {
        let sections = NotebookOutline.sections(in: note)
        XCTAssertEqual(sections.map(\.title), ["Title", "Alpha", "Alpha one", "Beta"])
        XCTAssertEqual(sections.map(\.depth), [0, 1, 2, 1])
        let alpha = sections[1]
        let text = note as NSString
        XCTAssertTrue(text.substring(with: alpha.range).contains("deeper"), "the subsection is inside Alpha")
        XCTAssertFalse(text.substring(with: alpha.range).contains("b body"), "Beta is not")
        XCTAssertEqual(text.substring(with: sections[0].headingRange), "# Title")
    }

    func testTheAuthorLineGroupsNothing() {
        let text = "# Title\n###### Sean\n\nbody\n\n## Next\n\nmore"
        let sections = NotebookOutline.sections(in: text)
        XCTAssertEqual(sections.map(\.title), ["Title", "Sean", "Next"])
        let author = sections[1]
        XCTAssertFalse((text as NSString).substring(with: author.range).contains("body"),
                       "the body belongs to the title, not the author line")
    }

    func testAHashInsideAFenceIsNotAHeading() {
        let text = "# Title\n\n```python\n# a comment\n```\n\n## Real"
        XCTAssertEqual(NotebookOutline.sections(in: text).map(\.title), ["Title", "Real"])
    }

    func testTheSameTitleTwiceGetsDistinctKeys() {
        let keys = NotebookOutline.sections(in: "## Notes\n\na\n\n## Notes\n\nb").map(\.key)
        XCTAssertEqual(keys, ["Notes", "Notes#2"])
    }

    func testClosedSectionsHideTheirBodiesAndNestedOnesOnlyOnce() throws {
        let all = NotebookOutline.sections(in: note)
        let hidden = NotebookOutline.hiddenRanges(in: note, collapsed: ["Alpha", "Alpha one"])
        XCTAssertEqual(hidden.count, 1, "the nested body is inside Alpha's")
        let text = (note as NSString).substring(with: hidden[0])
        XCTAssertTrue(text.contains("deeper"))
        XCTAssertTrue(text.contains("### Alpha one"), "the nested heading is hidden with the body")
        let alpha = try XCTUnwrap(all.first { $0.key == "Alpha" })
        XCTAssertEqual(hidden[0].location, NSMaxRange(alpha.headingRange),
                       "the heading line itself stays visible")
        XCTAssertFalse(text.contains("b body"))
        XCTAssertTrue(NotebookOutline.hiddenRanges(in: note, collapsed: []).isEmpty)
        XCTAssertEqual(all.count, 4)
    }

    func testASectionMovesPastItsSiblingWithEverythingUnderIt() throws {
        let caret = (note as NSString).range(of: "## Beta").location
        let edit = try XCTUnwrap(NotebookOutline.moveSection(text: note, selection: NSRange(location: caret, length: 0),
                                                            up: true))
        let moved = apply(edit, to: note)
        let alpha = (moved as NSString).range(of: "## Alpha").location
        let beta = (moved as NSString).range(of: "## Beta").location
        XCTAssertLessThan(beta, alpha, "Beta is now first")
        XCTAssertTrue(moved.contains("### Alpha one"), "Alpha kept its subsection")
        XCTAssertTrue(moved.hasPrefix("# Title"), "the title did not move")
        XCTAssertEqual(moved.count, note.count, "nothing was lost or gained")
    }

    func testTheFirstSectionCannotMoveUpAndTheLastCannotMoveDown() {
        let first = (note as NSString).range(of: "## Alpha").location
        XCTAssertNil(NotebookOutline.moveSection(text: note, selection: NSRange(location: first, length: 0), up: true))
        let last = (note as NSString).range(of: "## Beta").location
        XCTAssertNil(NotebookOutline.moveSection(text: note, selection: NSRange(location: last, length: 0), up: false))
    }

    func testTheCaretRidesAlongWithTheSectionItWasIn() throws {
        let caret = (note as NSString).range(of: "b body").location + 2
        let edit = try XCTUnwrap(NotebookOutline.moveSection(text: note, selection: NSRange(location: caret, length: 0),
                                                            up: true))
        let moved = apply(edit, to: note)
        XCTAssertEqual(edit.selection.location, (moved as NSString).range(of: "b body").location + 2,
                       "the caret sits where it sat inside the moved section")
    }

    func testBeforeTheFirstHeadingTheParagraphIsTheCell() throws {
        let text = "one\n\ntwo\n\n# Heading\n\nbody"
        let edit = try XCTUnwrap(NotebookOutline.moveSection(text: text, selection: NSRange(location: 6, length: 0),
                                                            up: true))
        XCTAssertEqual(apply(edit, to: text), "two\n\none\n\n# Heading\n\nbody")
    }
}

/// Folding: what the editor hides, and where the caret lands when it would
/// otherwise sit inside a closed section.
final class NotebookFoldingTests: XCTestCase {
    private let hidden = [NSRange(location: 10, length: 20), NSRange(location: 60, length: 5)]

    func testACaretGoingForwardsLandsAfterTheFoldAndBackwardsBeforeIt() {
        let inside = NSRange(location: 15, length: 0)
        XCTAssertEqual(MarkdownTextView.Coordinator.snap(inside, out: hidden, backwards: false),
                       NSRange(location: 30, length: 0))
        XCTAssertEqual(MarkdownTextView.Coordinator.snap(inside, out: hidden, backwards: true),
                       NSRange(location: 10, length: 0))
    }

    func testACaretOutsideEveryFoldIsLeftWhereItIs() {
        for location in [0, 10, 30, 45, 65, 100] {
            let caret = NSRange(location: location, length: 0)
            XCTAssertEqual(MarkdownTextView.Coordinator.snap(caret, out: hidden, backwards: false), caret,
                           "moved a caret at \(location)")
        }
    }

    func testASelectionIsNotSnapped() {
        let selection = NSRange(location: 15, length: 4)
        XCTAssertEqual(MarkdownTextView.Coordinator.snap(selection, out: hidden, backwards: false), selection)
    }

    func testTheHiddenRangeOfASectionStartsAfterItsHeading() {
        let note = "# One\n\nbody\n\n# Two\n\nmore"
        let sections = NotebookOutline.sections(in: note)
        let one = sections[0]
        let range = one.hiddenRange(in: (note as NSString).length)
        XCTAssertEqual(range.location, NSMaxRange(one.headingRange))
        let text = (note as NSString).substring(with: range)
        XCTAssertTrue(text.contains("body"))
        XCTAssertFalse(text.contains("# Two"))
    }
}

/// Folding from the keyboard: which section the caret is in, and closing
/// them all at once.
@MainActor
final class FoldCommandTests: XCTestCase {
    private var dir: URL!
    private var store: NoteStore!

    override func setUp() async throws {
        dir = FileManager.default.temporaryDirectory.appending(path: "WriteMindTests-\(UUID().uuidString)")
        try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        try Data("# Title\n\nintro\n\n## One\n\na\n\n## Two\n\nb\n".utf8)
            .write(to: dir.appending(path: "Trip.md"))
        store = NoteStore(directory: dir)
    }

    override func tearDown() async throws {
        store = nil
        try? FileManager.default.removeItem(at: dir)
    }

    func testFoldingOneSectionAndThenAllOfThem() {
        XCTAssertTrue(store.collapsedHere.isEmpty)
        store.setSection("One", collapsed: true)
        XCTAssertEqual(store.collapsedHere, ["One"])
        store.setSection("One", collapsed: false)
        XCTAssertTrue(store.collapsedHere.isEmpty)

        store.foldAllSections()
        XCTAssertEqual(store.collapsedHere, ["Title", "One", "Two"])
        store.unfoldAllSections()
        XCTAssertTrue(store.collapsedHere.isEmpty)
    }

    func testAHeadingWithNothingUnderItIsNotFolded() {
        store.text = "# Alone\n"
        store.foldAllSections()
        XCTAssertTrue(store.collapsedHere.isEmpty, "there is no body to hide")
    }

    func testTheKeyIsTheInnermostSectionTheCaretIsIn() {
        let note = "# Title\n\nintro\n\n## One\n\na\n\n### Deep\n\nd\n"
        let sections = NotebookOutline.sections(in: note)
        let caret = (note as NSString).range(of: "d\n").location
        XCTAssertEqual(NotebookOutline.section(containing: caret, in: sections)?.key, "Deep")
        let inOne = (note as NSString).range(of: "a\n").location
        XCTAssertEqual(NotebookOutline.section(containing: inOne, in: sections)?.key, "One")
    }
}

/// The cell brackets down the right-hand side: they have to be drawn, they
/// have to be where the cells are, and a click has to find them.
final class NotebookGutterTests: XCTestCase {
    private func gutter(_ brackets: [NotebookGutter.Bracket]) -> NotebookGutter {
        let view = NotebookGutter(frame: NSRect(x: 0, y: 0, width: NotebookGutter.width, height: 200))
        view.brackets = brackets
        return view
    }

    private func inkedPixels(_ view: NSView) -> Int {
        guard let rep = view.bitmapImageRepForCachingDisplay(in: view.bounds) else { return 0 }
        view.cacheDisplay(in: view.bounds, to: rep)
        var count = 0
        for x in 0..<rep.pixelsWide {
            for y in 0..<rep.pixelsHigh where (rep.colorAt(x: x, y: y)?.alphaComponent ?? 0) > 0.1 {
                count += 1
            }
        }
        return count
    }

    func testABracketIsActuallyDrawn() {
        let empty = inkedPixels(gutter([]))
        let one = inkedPixels(gutter([.init(key: "One", depth: 0, top: 20, bottom: 120, collapsed: false)]))
        XCTAssertGreaterThan(one, empty + 50, "the bracket put ink on the gutter")
    }

    func testAClosedCellIsDrawnDifferentlyFromAnOpenOne() {
        let open = inkedPixels(gutter([.init(key: "One", depth: 0, top: 20, bottom: 120, collapsed: false)]))
        let shut = inkedPixels(gutter([.init(key: "One", depth: 0, top: 20, bottom: 120, collapsed: true)]))
        XCTAssertGreaterThan(shut, open, "a closed cell carries a triangle as well")
    }

    func testASelectedCellIsDrawnHeavier() {
        let plain = inkedPixels(gutter([.init(key: "One", depth: 0, top: 20, bottom: 120, collapsed: false)]))
        let picked = inkedPixels(gutter([.init(key: "One", depth: 0, top: 20, bottom: 120,
                                               collapsed: false, selected: true)]))
        XCTAssertGreaterThan(picked, plain)
    }

    func testNestedCellsAreDrawnSideBySide() {
        let one = inkedPixels(gutter([.init(key: "One", depth: 0, top: 20, bottom: 120, collapsed: false)]))
        let two = inkedPixels(gutter([.init(key: "One", depth: 0, top: 20, bottom: 120, collapsed: false),
                                      .init(key: "Two", depth: 1, top: 60, bottom: 110, collapsed: false)]))
        XCTAssertGreaterThan(two, one, "the inner one is drawn as well, further in")
    }

    func testTheGutterIsWideEnoughForSeveralLevels() {
        XCTAssertGreaterThanOrEqual(NotebookGutter.width, 20)
    }
}

/// The same notebook on both sides: what lights a bracket up, and how far
/// down the page the brackets go (Sean, 2026-09-19: "make sure the notebook
/// bars on the side work properly in markdown and wysiwyg mode").
final class BracketsInBothModesTests: XCTestCase {
    private let cell = NSRange(location: 10, length: 20)

    func testASelectionOverTheWholeCellPicksIt() {
        XCTAssertTrue(NotebookGutter.isPicked(cell, selection: NSRange(location: 10, length: 20)))
        XCTAssertTrue(NotebookGutter.isPicked(cell, selection: NSRange(location: 0, length: 40)))
    }

    func testHalfASelectionDoesNot() {
        XCTAssertFalse(NotebookGutter.isPicked(cell, selection: NSRange(location: 10, length: 5)))
    }

    func testTheCaretsOwnCellIsPickedTheWayTheRenderedPagePicksIt() {
        // The rendered page draws the cell it is editing heavy; with only a
        // caret, the markdown side now says the same thing.
        XCTAssertTrue(NotebookGutter.isPicked(cell, selection: NSRange(location: 14, length: 0),
                                              caretCell: cell))
        XCTAssertFalse(NotebookGutter.isPicked(cell, selection: NSRange(location: 14, length: 0),
                                               caretCell: NSRange(location: 30, length: 10)))
    }

    func testASectionIsNotLitByACaretAlone() {
        // Sections are given no caret cell: otherwise every bracket out to
        // the margin would light up at once.
        XCTAssertFalse(NotebookGutter.isPicked(cell, selection: NSRange(location: 14, length: 0)))
    }

    func testTheCaretsCellIsTheBlockItIsIn() {
        let text = "First cell\n\n## A heading\n\nWords under it"
        XCTAssertEqual(NotebookCells.block(containing: 3, in: text)?.range.location, 0)
        XCTAssertEqual(NotebookCells.block(containing: 30, in: text)?.range.location, 26)
    }

    func testTheRenderedPagesBracketStripReachesTheLastBracket() {
        // It used to be 4000 points tall whatever the note was, so a long
        // note had cells with no bracket beside them.
        let deep = [CellBrackets.Bracket(key: "cell:1", depth: 0, top: 20, bottom: 60,
                                         range: NSRange(location: 0, length: 1)),
                    CellBrackets.Bracket(key: "cell:2", depth: 0, top: 9_000, bottom: 9_400,
                                         range: NSRange(location: 1, length: 1))]
        XCTAssertGreaterThan(CellBrackets.height(of: deep), 9_400)
        XCTAssertEqual(CellBrackets.height(of: []), CellBrackets.tail, "an empty page needs none")
    }

    func testBothSidesDrawTheirBracketsOnTheSameLines() {
        // One furniture, two renderers: the x of a depth has to agree, or
        // switching modes would shift every bracket sideways.
        let gutter = NotebookGutter(frame: NSRect(x: 0, y: 0, width: NotebookGutter.width, height: 100))
        gutter.brackets = [.init(key: "a", depth: 2, top: 0, bottom: 50, collapsed: false)]
        XCTAssertEqual(CellBrackets.width, NotebookGutter.width)
        XCTAssertEqual(CellBrackets.x(for: 2, in: CellBrackets.width), NotebookGutter.width - 6 - 10)
    }
}

/// The brackets follow the group hierarchy: a cell is drawn inside the
/// section that holds it, and a section inside the one that holds IT
/// (Sean, 2026-09-20: "make sure the brackets follow group heirarchy
/// correctly").
final class BracketHierarchyTests: XCTestCase {
    private let note = """
    Loose words before anything

    # Title

    Under the title

    ## A section

    Under the section

    ### Deeper

    Under the deeper one
    """

    private var sections: [NotebookOutline.Section] { NotebookOutline.sections(in: note) }

    private func depth(ofCellStarting text: String) -> Int {
        let at = (note as NSString).range(of: text).location
        return NotebookOutline.cellDepth(at: at, in: sections)
    }

    func testACellBeforeAnyHeadingIsAtTheMargin() {
        XCTAssertEqual(depth(ofCellStarting: "Loose words"), 0)
    }

    func testEachSectionPutsItsCellsOneStepFurtherIn() {
        XCTAssertEqual(depth(ofCellStarting: "Under the title"), 1)
        XCTAssertEqual(depth(ofCellStarting: "Under the section"), 2)
        XCTAssertEqual(depth(ofCellStarting: "Under the deeper one"), 3)
    }

    func testAHeadingsOwnCellSitsInsideItsGroup() {
        // The heading is the first cell OF the group it opens, so its
        // bracket is drawn inside the group's.
        XCTAssertEqual(depth(ofCellStarting: "## A section"), 2)
        XCTAssertEqual(sections.first { $0.title == "A section" }?.depth, 1)
    }

    func testTheNestingIsByGROUPNotByHeadingLevel() {
        // A note that skips ## still nests one step, not two.
        let skipped = "# Title\n\n### Straight to three\n\nWords"
        let list = NotebookOutline.sections(in: skipped)
        XCTAssertEqual(list.map(\.depth), [0, 1])
        XCTAssertEqual(NotebookOutline.cellDepth(at: (skipped as NSString).range(of: "Words").location,
                                                 in: list), 2)
    }
}
