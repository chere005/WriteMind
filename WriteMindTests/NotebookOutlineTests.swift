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
