import XCTest
@testable import WriteMind

final class MarkdownParserTests: XCTestCase {
    func testHeadingsParagraphsAndRules() {
        let blocks = MarkdownParser.blocks(from: "# Title\n\nline one\nline two\n\n---\n## Sub")
        XCTAssertEqual(blocks, [
            .heading(level: 1, text: "Title"),
            .paragraph("line one line two"),
            .rule,
            .heading(level: 2, text: "Sub"),
        ])
    }

    func testHashWithoutSpaceIsNotAHeading() {
        XCTAssertEqual(MarkdownParser.blocks(from: "#hashtag"), [.paragraph("#hashtag")])
    }

    func testListsQuotesAndCode() {
        let source = "- a\n- b\n\n1. x\n2) y\n> quoted\n> more\n```swift\nlet a = 1\n\nlet b = 2\n```\nafter"
        XCTAssertEqual(MarkdownParser.blocks(from: source), [
            .bullets(["a", "b"]),
            .numbered(["x", "y"]),
            .quote("quoted more"),
            .code(language: "swift", body: "let a = 1\n\nlet b = 2"),
            .paragraph("after"),
        ])
    }

    func testAListInterruptsAParagraph() {
        XCTAssertEqual(MarkdownParser.blocks(from: "text\n- item"), [.paragraph("text"), .bullets(["item"])])
    }

    func testUnclosedFenceStillRendersAsCode() {
        XCTAssertEqual(MarkdownParser.blocks(from: "```\nx"), [.code(language: nil, body: "x")])
    }

    func testInlineUnderlineTagsBecomeAnAttributeNotText() {
        let rendered = MarkdownInline.attributed("a <u>b</u> **c**")
        XCTAssertEqual(String(rendered.characters), "a b c")
        let runs = rendered.runs.map { (String(rendered[$0.range].characters), $0.underlineStyle != nil) }
        XCTAssertTrue(runs.contains { $0 == ("b", true) }, "\(runs)")
        XCTAssertFalse(runs.contains { $0 == ("a ", true) }, "\(runs)")
    }
}

/// Code is backticks, not indentation (Sean, 2026-09-20: "code blocks are
/// only ``` and ` and `` blocks (multiline, inline, and allows ` inline)").
final class IndentationIsNotCodeTests: XCTestCase {
    func testAnIndentedLineIsStillAParagraph() {
        let blocks = MarkdownParser.blocks(from: "    four spaces in front")
        XCTAssertEqual(blocks.count, 1)
        if case .paragraph(let text)? = blocks.first {
            XCTAssertEqual(text, "    four spaces in front", "and it keeps its indentation")
        } else {
            XCTFail("got \(blocks)")
        }
    }

    func testAFenceIsStillCode() {
        let blocks = MarkdownParser.blocks(from: "```swift\nlet a = 1\n```")
        guard case .code(let language, let body)? = blocks.first else { return XCTFail("got \(blocks)") }
        XCTAssertEqual(language, "swift")
        XCTAssertEqual(body, "let a = 1")
    }

    func testASpanWithABacktickInItIsWrittenWithTwo() {
        let runs = MarkdownSourceStyle.runs(in: "use ``a ` b`` here")
        let code = runs.filter { $0.kind == .code }
        XCTAssertEqual(code.count, 1)
        XCTAssertEqual(("use ``a ` b`` here" as NSString).substring(with: code[0].range), "a ` b")
    }

    func testAnOrdinarySpanStillWorks() {
        let runs = MarkdownSourceStyle.runs(in: "use `code` here")
        XCTAssertEqual(runs.filter { $0.kind == .code }.count, 1)
    }

    func testTheIndentedLinesInsideAListAreStillTheList() {
        let blocks = MarkdownParser.blocks(from: "- one\n    - nested")
        XCTAssertEqual(blocks.count, 1, "one list, got \(blocks)")
    }
}
