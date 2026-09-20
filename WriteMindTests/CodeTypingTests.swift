import XCTest
@testable import WriteMind

/// Typing in a code cell (Sean, 2026-09-19: "in a code cell in wysiwyg add
/// basic features like auto {} () [] and tab inserts a 4space width tab").
final class CodeTypingTests: XCTestCase {
    private func typing(_ input: String, _ text: String, at caret: Int,
                        length: Int = 0) -> (text: String, selection: NSRange)? {
        guard let edit = CodeTyping.typing(input, in: text,
                                           selection: NSRange(location: caret, length: length))
        else { return nil }
        return ((text as NSString).replacingCharacters(in: edit.range, with: edit.replacement),
                edit.selection)
    }

    // MARK: - Pairs

    func testABracketBringsItsPartner() {
        for (open, close) in [("(", ")"), ("[", "]"), ("{", "}")] {
            let typed = typing(open, "let x = ", at: 8)
            XCTAssertEqual(typed?.text, "let x = \(open)\(close)")
            XCTAssertEqual(typed?.selection, NSRange(location: 9, length: 0), "the caret is between them")
        }
    }

    func testQuotesPairToo() {
        XCTAssertEqual(typing("\"", "print(", at: 6)?.text, "print(\"\"")
        XCTAssertEqual(typing("`", "", at: 0)?.text, "``")
    }

    func testTypingTheCloserStepsOverIt() {
        // Otherwise finishing the call you just opened doubles the bracket.
        let typed = typing(")", "f()", at: 2)
        XCTAssertEqual(typed?.text, "f()")
        XCTAssertEqual(typed?.selection, NSRange(location: 3, length: 0))
    }

    func testABracketWrapsWhatIsSelected() {
        let typed = typing("(", "let x = a + b", at: 8, length: 5)
        XCTAssertEqual(typed?.text, "let x = (a + b)")
        XCTAssertEqual(typed?.selection, NSRange(location: 9, length: 5), "still selected, inside")
    }

    func testAnApostropheInAWordIsJustAnApostrophe() {
        XCTAssertNil(CodeTyping.typing("'", in: "don", selection: NSRange(location: 3, length: 0)))
        XCTAssertNil(CodeTyping.typing("'", in: "x = it", selection: NSRange(location: 6, length: 0)))
    }

    func testAnOrdinaryCharacterIsLeftAlone() {
        XCTAssertNil(CodeTyping.typing("a", in: "let ", selection: NSRange(location: 4, length: 0)))
        XCTAssertNil(CodeTyping.typing(")", in: "f(", selection: NSRange(location: 2, length: 0)),
                     "a closer with nothing to step over goes in as itself")
    }

    // MARK: - Backspace

    func testBackspaceBetweenAPairTakesBoth() {
        let edit = CodeTyping.backspace(in: "f()", selection: NSRange(location: 2, length: 0))
        XCTAssertEqual(edit?.range, NSRange(location: 1, length: 2))
        XCTAssertEqual(edit?.replacement, "")
    }

    func testBackspaceAnywhereElseIsOrdinary() {
        XCTAssertNil(CodeTyping.backspace(in: "f(x)", selection: NSRange(location: 3, length: 0)))
        XCTAssertNil(CodeTyping.backspace(in: "f()", selection: NSRange(location: 0, length: 0)))
    }

    // MARK: - Tab

    func testTabPutsInATab() {
        let edit = CodeTyping.tabbing(in: "let x", selection: NSRange(location: 0, length: 0),
                                      outdent: false)
        XCTAssertEqual(edit.replacement, "\t")
        XCTAssertEqual(edit.selection, NSRange(location: 1, length: 0))
    }

    func testTabOverSeveralLinesIndentsEveryOne() {
        let code = "a = 1\nb = 2\nc = 3"
        let edit = CodeTyping.tabbing(in: code, selection: NSRange(location: 0, length: 11),
                                      outdent: false)
        let after = (code as NSString).replacingCharacters(in: edit.range, with: edit.replacement)
        XCTAssertEqual(after, "\ta = 1\n\tb = 2\nc = 3")
    }

    func testShiftTabTakesALevelOff() {
        let code = "\ta = 1\n    b = 2"
        let edit = CodeTyping.tabbing(in: code, selection: NSRange(location: 0, length: 15),
                                      outdent: true)
        let after = (code as NSString).replacingCharacters(in: edit.range, with: edit.replacement)
        XCTAssertEqual(after, "a = 1\nb = 2", "a tab, or up to four spaces")
    }

    func testOutdentingALineWithNoIndentationLeavesItAlone() {
        XCTAssertEqual(CodeTyping.strippedLevel("a = 1"), "a = 1")
        XCTAssertEqual(CodeTyping.strippedLevel("  a = 1"), "a = 1")
        XCTAssertEqual(CodeTyping.strippedLevel("\t\ta = 1"), "\ta = 1")
    }

    func testTheMarkdownPaneWritesFourSpacesInAFence() {
        // The file should hold spaces: every other reader shows them the
        // same width (Sean, 2026-09-20: "make tab enter 4 spaces in
        // markdown code blocks but in wysiwyg make it an actual tab when
        // copying").
        let edit = CodeTyping.tabbing(in: "let x", selection: NSRange(location: 0, length: 0),
                                      outdent: false, unit: MarkdownFormatting.indentUnit)
        XCTAssertEqual(edit.replacement, "    ")
        XCTAssertEqual(edit.selection, NSRange(location: 4, length: 0))
    }

    func testACodeCellWritesARealTabSoACopyCarriesOne() {
        let edit = CodeTyping.tabbing(in: "let x", selection: NSRange(location: 0, length: 0),
                                      outdent: false)
        XCTAssertEqual(edit.replacement, "\t")
    }

    func testFourSpacesGoOnEveryLineOfASelectionToo() {
        let code = "a = 1\nb = 2"
        let edit = CodeTyping.tabbing(in: code, selection: NSRange(location: 0, length: 11),
                                      outdent: false, unit: "    ")
        XCTAssertEqual((code as NSString).replacingCharacters(in: edit.range, with: edit.replacement),
                       "    a = 1\n    b = 2")
    }

    func testTabOnlyIndentsInsideAFence() {
        let note = "Just a paragraph\n\n```swift\nlet a = 1\n```"
        XCTAssertFalse(CodeTyping.inFence(note, selection: NSRange(location: 3, length: 0)))
        XCTAssertTrue(CodeTyping.inFence(note, selection: NSRange(location: 30, length: 0)))
    }

    func testTheTabIsFourSpacesWide() {
        // The character is a tab; what makes it four spaces is the grid
        // both editors set on their paragraph style.
        XCTAssertEqual(CodeTyping.tab, "\t")
        XCTAssertEqual(MarkdownTextView.paragraphStyle.defaultTabInterval, MarkdownTextView.tabWidth)
        XCTAssertEqual(BlockTextView.paragraphStyle.defaultTabInterval, MarkdownTextView.tabWidth)
    }
}
