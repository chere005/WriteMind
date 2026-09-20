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
