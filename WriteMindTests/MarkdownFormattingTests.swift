import XCTest

/// The code-block button: a fence round the selection, or an empty one to
/// type into.
final class CodeBlockTests: XCTestCase {
    private func applied(_ text: String, _ edit: MarkdownFormatting.Edit) -> String {
        (text as NSString).replacingCharacters(in: edit.range, with: edit.replacement)
    }

    func testASelectionIsFencedOnLinesOfItsOwn() {
        let text = "a\nb\nc"
        let edit = MarkdownFormatting.codeBlock(text: text, selection: NSRange(location: 2, length: 1))
        XCTAssertEqual(applied(text, edit), "a\n```\nb\n```\nc")
        // The line after already began with a newline, so none was added;
        // the caret sits right after the closing fence.
        XCTAssertEqual(edit.selection.location, 2 + ("```\nb\n```" as NSString).length)
    }

    func testAnEmptyBlockOpensWithTheCaretInside() {
        let text = "hi"
        let edit = MarkdownFormatting.codeBlock(text: text, selection: NSRange(location: 2, length: 0))
        XCTAssertEqual(applied(text, edit), "hi\n```\n\n```")
        XCTAssertEqual(edit.selection, NSRange(location: 7, length: 0), "on the empty line between the fences")
    }

    func testTypingIntoAnEmptyBlockStaysInsideIt() {
        let text = "hi"
        let edit = MarkdownFormatting.codeBlock(text: text, selection: NSRange(location: 2, length: 0))
        let opened = applied(text, edit)
        let typed = (opened as NSString).replacingCharacters(in: NSRange(location: edit.selection.location, length: 0),
                                                            with: "FSADF")
        XCTAssertEqual(typed, "hi\n```\nFSADF\n```")
        XCTAssertEqual(MarkdownParser.blocks(from: typed).last, .code(language: nil, body: "FSADF"))
    }
}
@testable import WriteMind

final class MarkdownFormattingTests: XCTestCase {
    private func apply(_ edit: MarkdownFormatting.Edit, to text: String) -> String {
        (text as NSString).replacingCharacters(in: edit.range, with: edit.replacement)
    }

    func testBoldWrapsSelectionAndKeepsItSelected() {
        let edit = MarkdownFormatting.toggleWrap(text: "say word now", selection: NSRange(location: 4, length: 4), open: "**")
        XCTAssertEqual(apply(edit, to: "say word now"), "say **word** now")
        XCTAssertEqual(edit.selection, NSRange(location: 6, length: 4))
    }

    func testBoldWithNoSelectionLeavesCaretBetweenMarkers() {
        let edit = MarkdownFormatting.toggleWrap(text: "ab", selection: NSRange(location: 1, length: 0), open: "**")
        XCTAssertEqual(apply(edit, to: "ab"), "a****b")
        XCTAssertEqual(edit.selection, NSRange(location: 3, length: 0))
    }

    func testBoldUnwrapsWhenMarkersAreInsideTheSelection() {
        let text = "say **word** now"
        let edit = MarkdownFormatting.toggleWrap(text: text, selection: NSRange(location: 4, length: 8), open: "**")
        XCTAssertEqual(apply(edit, to: text), "say word now")
        XCTAssertEqual(edit.selection, NSRange(location: 4, length: 4))
    }

    func testBoldUnwrapsWhenMarkersSitJustOutsideTheSelection() {
        let text = "say **word** now"
        let edit = MarkdownFormatting.toggleWrap(text: text, selection: NSRange(location: 6, length: 4), open: "**")
        XCTAssertEqual(apply(edit, to: text), "say word now")
        XCTAssertEqual(edit.selection, NSRange(location: 4, length: 4))
    }

    func testUnderlineUsesHTMLTags() {
        let edit = MarkdownFormatting.toggleWrap(text: "x", selection: NSRange(location: 0, length: 1),
                                                 open: MarkdownFormatting.underlineOpen, close: MarkdownFormatting.underlineClose)
        XCTAssertEqual(apply(edit, to: "x"), "<u>x</u>")
    }

    func testBulletsAreAddedToEveryLineTheSelectionTouches() {
        let text = "one\ntwo\nthree"
        let edit = MarkdownFormatting.toggleBullets(text: text, selection: NSRange(location: 1, length: 5))
        XCTAssertEqual(apply(edit, to: text), "- one\n- two\nthree")
        // The two bulleted lines stay selected — without the newline after them.
        XCTAssertEqual(edit.selection, NSRange(location: 0, length: 11))
    }

    func testBulletsAreRemovedWhenEveryLineHasOne() {
        let text = "- one\n- two\n"
        let edit = MarkdownFormatting.toggleBullets(text: text, selection: NSRange(location: 0, length: 11))
        XCTAssertEqual(apply(edit, to: text), "one\ntwo\n")
    }

    func testBulletOnEmptyLineMovesTheCaretPastTheMarker() {
        let edit = MarkdownFormatting.toggleBullets(text: "", selection: NSRange(location: 0, length: 0))
        XCTAssertEqual(edit.replacement, "- ")
        XCTAssertEqual(edit.selection, NSRange(location: 2, length: 0))
    }

    func testCaretOnBulletedLineIsPulledBackWhenTheBulletGoes() {
        let text = "- hello"
        let edit = MarkdownFormatting.toggleBullets(text: text, selection: NSRange(location: 7, length: 0))
        XCTAssertEqual(apply(edit, to: text), "hello")
        XCTAssertEqual(edit.selection, NSRange(location: 5, length: 0))
    }

    func testSelectionPastTheEndIsClampedNotCrashed() {
        let edit = MarkdownFormatting.toggleWrap(text: "ab", selection: NSRange(location: 10, length: 5), open: "_")
        XCTAssertEqual(apply(edit, to: "ab"), "ab__")
    }
}

final class IndentAndQuoteTests: XCTestCase {
    private func apply(_ edit: MarkdownFormatting.Edit, to text: String) -> String {
        (text as NSString).replacingCharacters(in: edit.range, with: edit.replacement)
    }

    func testQuoteTogglesEveryLineTheSelectionTouches() {
        let text = "one\ntwo"
        let quoted = apply(MarkdownFormatting.toggleQuote(text: text, selection: NSRange(location: 0, length: 7)), to: text)
        XCTAssertEqual(quoted, "> one\n> two")
        let back = apply(MarkdownFormatting.toggleQuote(text: quoted, selection: NSRange(location: 0, length: 11)), to: quoted)
        XCTAssertEqual(back, "one\ntwo")
    }

    func testIndentAddsFourSpacesToAPlainLineAndToABullet() {
        XCTAssertEqual(apply(MarkdownFormatting.indent(text: "a", selection: NSRange(location: 1, length: 0)), to: "a"), "    a")
        let bullet = "- item"
        XCTAssertEqual(apply(MarkdownFormatting.indent(text: bullet, selection: NSRange(location: 0, length: 0)), to: bullet), "    - item")
    }

    func testIndentNestsAQuoteRatherThanShiftingIt() {
        let text = "> q"
        XCTAssertEqual(apply(MarkdownFormatting.indent(text: text, selection: NSRange(location: 3, length: 0)), to: text), "> > q")
    }

    func testOutdentTakesSpacesFirstThenTheQuoteMarker() {
        XCTAssertEqual(apply(MarkdownFormatting.outdent(text: "    > q", selection: NSRange(location: 7, length: 0)), to: "    > q"), "> q")
        XCTAssertEqual(apply(MarkdownFormatting.outdent(text: "> q", selection: NSRange(location: 3, length: 0)), to: "> q"), "q")
        XCTAssertEqual(apply(MarkdownFormatting.outdent(text: "q", selection: NSRange(location: 1, length: 0)), to: "q"), "q")
    }

    func testIndentAndOutdentSpanAMultiLineSelection() {
        let text = "- a\n- b"
        let inward = MarkdownFormatting.indent(text: text, selection: NSRange(location: 0, length: 7))
        XCTAssertEqual(apply(inward, to: text), "    - a\n    - b")
        let indented = "    - a\n    - b"
        let outward = MarkdownFormatting.outdent(text: indented, selection: NSRange(location: 0, length: 15))
        XCTAssertEqual(apply(outward, to: indented), "- a\n- b")
    }

    func testBlankLinesAreLeftAloneByIndent() {
        let text = "a\n\nb"
        XCTAssertEqual(apply(MarkdownFormatting.indent(text: text, selection: NSRange(location: 0, length: 4)), to: text), "    a\n\n    b")
    }

    func testBackspaceInsideThePrefixOutdents() {
        let text = "    - item"
        let edit = MarkdownFormatting.outdentForBackspace(text: text, selection: NSRange(location: 6, length: 0))
        XCTAssertEqual(edit.map { apply($0, to: text) }, "- item")
    }

    func testBackspaceInTheTextIsAnOrdinaryBackspace() {
        XCTAssertNil(MarkdownFormatting.outdentForBackspace(text: "    - item", selection: NSRange(location: 8, length: 0)))
        XCTAssertNil(MarkdownFormatting.outdentForBackspace(text: "plain", selection: NSRange(location: 3, length: 0)))
    }

    func testBackspaceAtColumnZeroJoinsLinesInstead() {
        XCTAssertNil(MarkdownFormatting.outdentForBackspace(text: "a\n  - b", selection: NSRange(location: 2, length: 0)))
    }

    func testBackspaceWithASelectionIsAnOrdinaryDelete() {
        XCTAssertNil(MarkdownFormatting.outdentForBackspace(text: "  - item", selection: NSRange(location: 2, length: 3)))
    }

    func testPrefixLengthCountsWhitespaceQuotesAndTheListMarker() {
        XCTAssertEqual(MarkdownFormatting.prefixLength(of: "  > > - x"), 8)
        XCTAssertEqual(MarkdownFormatting.prefixLength(of: "plain"), 0)
    }
}

final class HeadingTests: XCTestCase {
    private func apply(_ edit: MarkdownFormatting.Edit, to text: String) -> String {
        (text as NSString).replacingCharacters(in: edit.range, with: edit.replacement)
    }

    func testEachLevelWritesItsOwnMarker() {
        let expected: [(MarkdownFormatting.Heading, String)] = [
            (.title, "# x"), (.header, "## x"), (.section, "### x"),
            (.subsection, "#### x"), (.subsubsection, "##### x"), (.authorSubheader, "###### x"),
        ]
        for (level, want) in expected {
            let edit = MarkdownFormatting.setHeading(text: "x", selection: NSRange(location: 1, length: 0), level: level)
            XCTAssertEqual(apply(edit, to: "x"), want, level.name)
        }
    }

    func testAppliedTwiceItGoesBackToBody() {
        let once = apply(MarkdownFormatting.setHeading(text: "x", selection: NSRange(location: 0, length: 0), level: .section), to: "x")
        XCTAssertEqual(once, "### x")
        let twice = apply(MarkdownFormatting.setHeading(text: once, selection: NSRange(location: 0, length: 0), level: .section), to: once)
        XCTAssertEqual(twice, "x")
    }

    func testChangingLevelReplacesTheMarkerRatherThanStacking() {
        let text = "### x"
        let edit = MarkdownFormatting.setHeading(text: text, selection: NSRange(location: 0, length: 0), level: .title)
        XCTAssertEqual(apply(edit, to: text), "# x")
    }

    func testBodyStripsWhateverLevelIsThere() {
        let text = "###### byline"
        let edit = MarkdownFormatting.setHeading(text: text, selection: NSRange(location: 0, length: 0), level: .body)
        XCTAssertEqual(apply(edit, to: text), "byline")
    }

    func testAMultiLineSelectionTakesTheFirstLineAsTheToggleAndBlanksAreLeft() {
        let text = "a\n\nb"
        let edit = MarkdownFormatting.setHeading(text: text, selection: NSRange(location: 0, length: 4), level: .header)
        XCTAssertEqual(apply(edit, to: text), "## a\n\n## b")
    }

    func testHeadingLevelReadsTheLineBack() {
        XCTAssertEqual(MarkdownFormatting.headingLevel(of: "## x"), .header)
        XCTAssertEqual(MarkdownFormatting.headingLevel(of: "###### x"), .authorSubheader)
        XCTAssertEqual(MarkdownFormatting.headingLevel(of: "#hashtag"), .body)
        XCTAssertEqual(MarkdownFormatting.headingLevel(of: "####### too many"), .body)
        XCTAssertEqual(MarkdownFormatting.headingLevel(of: "plain"), .body)
    }
}

final class IndentBlockTests: XCTestCase {
    private func apply(_ edit: MarkdownFormatting.Edit, to text: String) -> String {
        (text as NSString).replacingCharacters(in: edit.range, with: edit.replacement)
    }

    func testACaretInAWrappedParagraphIndentsEveryLineOfIt() {
        let text = "one line\ntwo line\nthree line\n\nafter"
        // Caret on the SECOND line of the paragraph.
        let edit = MarkdownFormatting.indent(text: text, selection: NSRange(location: 10, length: 0))
        XCTAssertEqual(apply(edit, to: text), "    one line\n    two line\n    three line\n\nafter")
    }

    func testTheParagraphStopsAtABlankLine() {
        let text = "a\n\nb\nc"
        let edit = MarkdownFormatting.indent(text: text, selection: NSRange(location: 3, length: 0))
        XCTAssertEqual(apply(edit, to: text), "a\n\n    b\n    c")
    }

    func testABulletIndentsAloneNotTheWholeList() {
        let text = "- one\n- two\n- three"
        let edit = MarkdownFormatting.indent(text: text, selection: NSRange(location: 8, length: 0))
        XCTAssertEqual(apply(edit, to: text), "- one\n    - two\n- three")
    }

    func testAQuoteLineAndAHeadingAlsoStandAlone() {
        let quote = "> one\n> two"
        XCTAssertEqual(apply(MarkdownFormatting.indent(text: quote, selection: NSRange(location: 8, length: 0)), to: quote),
                       "> one\n> > two")
        let heading = "# Title\nbody"
        XCTAssertEqual(apply(MarkdownFormatting.indent(text: heading, selection: NSRange(location: 2, length: 0)), to: heading),
                       "    # Title\nbody")
    }

    func testAParagraphStopsAtAListThatFollowsIt() {
        let text = "prose one\nprose two\n- item"
        let edit = MarkdownFormatting.indent(text: text, selection: NSRange(location: 0, length: 0))
        XCTAssertEqual(apply(edit, to: text), "    prose one\n    prose two\n- item")
    }

    func testOutdentUndoesTheWholeParagraphToo() {
        let text = "    one\n    two"
        let edit = MarkdownFormatting.outdent(text: text, selection: NSRange(location: 10, length: 0))
        XCTAssertEqual(apply(edit, to: text), "one\ntwo")
    }

    func testAnExplicitSelectionIsStillTakenAsGiven() {
        let text = "one\ntwo\nthree"
        let edit = MarkdownFormatting.indent(text: text, selection: NSRange(location: 0, length: 3))
        XCTAssertEqual(apply(edit, to: text), "    one\ntwo\nthree")
    }
}

/// One step in is four spaces, and a tab is shown four spaces wide (Sean,
/// 2026-09-19: "indentation and tab width is 4 spaces").
final class IndentWidthTests: XCTestCase {
    func testTheStepIsFourSpaces() {
        XCTAssertEqual(MarkdownFormatting.indentUnit, "    ")
        XCTAssertEqual(MarkdownFormatting.indentUnit.count, MarkdownFormatting.tabWidth)
    }

    func testATabIsShownFourSpacesWide() {
        let style = MarkdownTextView.paragraphStyle
        XCTAssertTrue(style.tabStops.isEmpty, "no stops of its own, so the interval decides")
        let four = ("    " as NSString).size(withAttributes: [.font: MarkdownTextView.font]).width
        XCTAssertEqual(style.defaultTabInterval, four, accuracy: 0.5)
        XCTAssertEqual(BlockTextView.paragraphStyle.defaultTabInterval, four, accuracy: 0.5)
    }

    func testOutdentTakesTheWholeStep() {
        let text = "    deep"
        let edit = MarkdownFormatting.outdent(text: text, selection: NSRange(location: 0, length: 0))
        XCTAssertEqual((text as NSString).replacingCharacters(in: edit.range, with: edit.replacement), "deep")
    }
}
