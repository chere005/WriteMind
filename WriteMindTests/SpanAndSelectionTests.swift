import XCTest
@testable import WriteMind

final class SpanStyleTests: XCTestCase {
    private func apply(_ edit: MarkdownFormatting.Edit, to text: String) -> String {
        (text as NSString).replacingCharacters(in: edit.range, with: edit.replacement)
    }

    private let style = MarkdownFormatting.SpanStyle(family: "Georgia", size: 18, colorHex: "#2D7DD2")

    func testCSSNamesOnlyThePartsThatAreSet() {
        XCTAssertEqual(style.css, "font-family: Georgia; font-size: 18px; color: #2D7DD2")
        XCTAssertEqual(MarkdownFormatting.SpanStyle(size: 20).css, "font-size: 20px")
        XCTAssertTrue(MarkdownFormatting.SpanStyle().isEmpty)
    }

    func testApplyWrapsTheSelectionAndKeepsTheWordSelected() {
        let text = "at dawn"
        let edit = MarkdownFormatting.applySpan(text: text, selection: NSRange(location: 3, length: 4), style: style)
        XCTAssertEqual(apply(edit, to: text), "at <span style=\"font-family: Georgia; font-size: 18px; color: #2D7DD2\">dawn</span>")
        XCTAssertEqual((apply(edit, to: text) as NSString).substring(with: edit.selection), "dawn")
    }

    func testApplyReplacesAnExistingSpanRatherThanNesting() {
        let text = "<span style=\"color: #FF0000\">dawn</span>"
        let whole = MarkdownFormatting.applySpan(text: text, selection: NSRange(location: 0, length: (text as NSString).length), style: MarkdownFormatting.SpanStyle(size: 20))
        XCTAssertEqual(apply(whole, to: text), "<span style=\"font-size: 20px\">dawn</span>")
    }

    func testApplyFindsTheSpanWhenOnlyItsTextIsSelected() {
        let text = "a <span style=\"color: #FF0000\">dawn</span> b"
        let inner = NSRange(location: 31, length: 4)
        XCTAssertEqual((text as NSString).substring(with: inner), "dawn")
        let edit = MarkdownFormatting.applySpan(text: text, selection: inner, style: MarkdownFormatting.SpanStyle(size: 20))
        XCTAssertEqual(apply(edit, to: text), "a <span style=\"font-size: 20px\">dawn</span> b")
    }

    func testAnEmptyStyleStripsTheSpan() {
        let text = "a <span style=\"color: #FF0000\">dawn</span> b"
        let edit = MarkdownFormatting.removeSpan(text: text, selection: NSRange(location: 31, length: 4))
        XCTAssertEqual(apply(edit, to: text), "a dawn b")
    }

    func testTheTagParsesBackIntoAStyle() {
        let parsed = MarkdownInline.style(fromTag: "<span style=\"font-family: 'Georgia'; font-size: 18px; color: #2D7DD2\">")
        XCTAssertEqual(parsed.family, "Georgia")
        XCTAssertEqual(parsed.size, 18)
        XCTAssertEqual(parsed.colorHex, "#2D7DD2")
    }

    func testTokenizerSeparatesTagsFromText() {
        let tokens = MarkdownInline.tokenize("a <u>b</u> <span style=\"color: #000000\">c</span>")
        XCTAssertEqual(tokens, [
            .text("a "), .open(MarkdownInline.Style(underline: true)), .text("b"), .close,
            .text(" "), .open(MarkdownInline.Style(colorHex: "#000000")), .text("c"), .close,
        ])
    }

    func testSpanTextSurvivesRenderingAndKeepsItsColour() {
        let rendered = MarkdownInline.attributed("at <span style=\"color: #2D7DD2\">**dawn**</span>")
        XCTAssertEqual(String(rendered.characters), "at dawn")
        XCTAssertTrue(rendered.runs.contains { rendered[$0.range].foregroundColor != nil })
    }

    func testUnknownHTMLIsLeftAsText() {
        XCTAssertEqual(String(MarkdownInline.attributed("a <b>c</b>").characters), "a <b>c</b>")
    }
}

final class SelectNextOccurrenceTests: XCTestCase {
    private func step(_ text: String, _ ranges: [NSRange], wholeWord: Bool = false) -> MarkdownFormatting.OccurrenceStep? {
        MarkdownFormatting.selectNextOccurrence(in: text, ranges: ranges, wholeWord: wholeWord)
    }

    func testWordRangeTakesTheWordUnderAndBeforeTheCaret() {
        let text = "let total = total_count"
        XCTAssertEqual(MarkdownFormatting.wordRange(in: text, at: 5), NSRange(location: 4, length: 5))
        XCTAssertEqual(MarkdownFormatting.wordRange(in: text, at: 9), NSRange(location: 4, length: 5))
        XCTAssertEqual(MarkdownFormatting.wordRange(in: text, at: 13), NSRange(location: 12, length: 11))
    }

    func testWordRangeIsNilOnEmptySpaceAndEmptyText() {
        XCTAssertNil(MarkdownFormatting.wordRange(in: "a  b", at: 2))
        XCTAssertNil(MarkdownFormatting.wordRange(in: "", at: 0))
    }

    func testTheFirstPressTakesTheWordAndTurnsOnWholeWordMatching() {
        let first = step("one two one", [NSRange(location: 1, length: 0)])
        XCTAssertEqual(first?.ranges, [NSRange(location: 0, length: 3)])
        XCTAssertEqual(first?.wholeWord, true)
    }

    func testEachPressAddsTheNextOccurrence() {
        let text = "one two one two one"
        var ranges = [NSRange(location: 0, length: 3)]
        for expected in [8, 16] {
            guard let next = step(text, ranges, wholeWord: true) else { return XCTFail("no step") }
            XCTAssertEqual(next.reveal, NSRange(location: expected, length: 3))
            ranges = next.ranges
        }
        XCTAssertEqual(ranges.count, 3)
        XCTAssertNil(step(text, ranges, wholeWord: true), "every occurrence is taken")
    }

    func testWholeWordMatchingSkipsTheWordInsideAnother() {
        let text = "one oneself one"
        let next = step(text, [NSRange(location: 0, length: 3)], wholeWord: true)
        XCTAssertEqual(next?.reveal, NSRange(location: 12, length: 3))
        // Without the flag, the substring inside "oneself" counts.
        XCTAssertEqual(step(text, [NSRange(location: 0, length: 3)], wholeWord: false)?.reveal,
                       NSRange(location: 4, length: 3))
    }

    func testItWrapsToTheTop() {
        let text = "one two one"
        XCTAssertEqual(step(text, [NSRange(location: 8, length: 3)], wholeWord: true)?.reveal,
                       NSRange(location: 0, length: 3))
    }

    func testOverlappingMatchesAreNeverBothSelected() {
        // "aa" in "aaaa" matches at 0, 1 and 2; 1 overlaps 0, so 2 is next.
        let next = step("aaaa", [NSRange(location: 0, length: 2)])
        XCTAssertEqual(next?.reveal, NSRange(location: 2, length: 2))
        XCTAssertEqual(next?.ranges, [NSRange(location: 0, length: 2), NSRange(location: 2, length: 2)])
    }

    func testStaleRangesFromAShortenedDocumentAreClampedNotFatal() {
        // The ranges describe a longer document that has since been cut down.
        let next = step("one", [NSRange(location: 0, length: 3), NSRange(location: 40, length: 3)])
        XCTAssertNotNil(next == nil ? "ok" : "ok")
        XCTAssertFalse(next?.ranges.contains { NSMaxRange($0) > 3 } ?? false)
    }

    func testDuplicateAndOutOfOrderRangesAreNormalised() {
        let ns = "one two one" as NSString
        let normalised = MarkdownFormatting.normalise(
            [NSRange(location: 8, length: 3), NSRange(location: 0, length: 3), NSRange(location: 0, length: 3)], in: ns)
        XCTAssertEqual(normalised, [NSRange(location: 0, length: 3), NSRange(location: 8, length: 3)])
    }

    func testNoWordUnderTheCaretIsLeftAlone() {
        XCTAssertNil(step("a  b", [NSRange(location: 2, length: 0)]))
        XCTAssertNil(step("", [NSRange(location: 0, length: 0)]))
        XCTAssertNil(step("abc", []))
    }

    func testSelectAllTakesEveryMatchAndHonoursWordBounds() {
        XCTAssertEqual(MarkdownFormatting.allOccurrences(in: "one oneself one", of: "one", wholeWord: true),
                       [NSRange(location: 0, length: 3), NSRange(location: 12, length: 3)])
        XCTAssertEqual(MarkdownFormatting.allOccurrences(in: "one oneself one", of: "one", wholeWord: false).count, 3)
    }

    func testATermSpanningLinesStillMatches() {
        let text = "a\nb x a\nb"
        let next = step(text, [NSRange(location: 0, length: 3)])
        XCTAssertEqual(next?.reveal, NSRange(location: 6, length: 3))
    }

    func testAnEmptyTermMatchesNothing() {
        XCTAssertNil(MarkdownFormatting.nextOccurrence(in: "abc", of: "", after: 0, skipping: []))
    }
}

final class MarkdownLinkingTests: XCTestCase {
    func testSlugMatchesWhatAMarkdownRendererWouldMake() {
        XCTAssertEqual(MarkdownLinking.slug(for: "The bar"), "the-bar")
        XCTAssertEqual(MarkdownLinking.slug(for: "Notes & Ideas — 2026!"), "notes-ideas-2026")
        XCTAssertEqual(MarkdownLinking.slug(for: "!!!"), "section")
    }

    func testAHighlightedRunIsMarkedAndLinkedInTheTarget() {
        let text = "before dawn after"
        let anchor = MarkdownLinking.anchor(in: text, at: NSRange(location: 7, length: 5))
        XCTAssertEqual(anchor.title, "dawn")
        XCTAssertEqual(anchor.rewrittenText, "before <mark id=\"\(anchor.id)\">dawn</mark> after")
        XCTAssertTrue(anchor.id.hasPrefix("wm-"))
    }

    func testACaretOnAHeadingUsesItsSlugAndWritesNothing() {
        let text = "# Title\n\n## The bar\n\nbody"
        let anchor = MarkdownLinking.anchor(in: text, at: NSRange(location: 12, length: 0))
        XCTAssertEqual(anchor.id, "the-bar")
        XCTAssertEqual(anchor.title, "The bar")
        XCTAssertNil(anchor.rewrittenText)
    }

    func testACaretInAnyOtherBlockGetsAnAnchorInFrontOfIt() {
        let text = "# Title\n\nthe whole block here"
        let anchor = MarkdownLinking.anchor(in: text, at: NSRange(location: 12, length: 0))
        XCTAssertEqual(anchor.rewrittenText, "# Title\n\n<a id=\"\(anchor.id)\"></a>the whole block here")
        XCTAssertEqual(anchor.title, "the whole block here")
    }

    func testLinkMarkdownEncodesTheFileNameAndCarriesTheAnchor() {
        XCTAssertEqual(MarkdownLinking.link(title: "The bar", fileName: "My Note.md", anchor: "the-bar"),
                       "[The bar](My%20Note.md#the-bar)")
        XCTAssertEqual(MarkdownLinking.link(title: "Whole", fileName: "A.md", anchor: nil), "[Whole](A.md)")
    }

    func testTheTriggerFiresOnlyAtAWordBoundary() {
        XCTAssertTrue(MarkdownLinking.justTypedTrigger(in: "see /link", caret: 9))
        XCTAssertTrue(MarkdownLinking.justTypedTrigger(in: "/link", caret: 5))
        XCTAssertFalse(MarkdownLinking.justTypedTrigger(in: "docs/link", caret: 9))
        XCTAssertFalse(MarkdownLinking.justTypedTrigger(in: "see /link ", caret: 10))
    }

    func testTheTriggerRangeSurvivesTheCaretMovingOn() {
        let text = "one /link two"
        XCTAssertEqual(MarkdownLinking.triggerRange(in: text, near: 9), NSRange(location: 4, length: 5))
        XCTAssertEqual(MarkdownLinking.triggerRange(in: text, near: 13), NSRange(location: 4, length: 5))
        XCTAssertNil(MarkdownLinking.triggerRange(in: "nothing here", near: 3))
    }
}

extension MarkdownLinkingTests {
    func testWhitespaceOnlySelectionIsTreatedAsACaretInThatBlock() {
        let text = "# Title\n\nbody here"
        let anchor = MarkdownLinking.anchor(in: text, at: NSRange(location: 7, length: 2))
        // The selection is only the newlines after the heading, so it marks
        // nothing and points at the block the selection STARTS in.
        XCTAssertNil(anchor.rewrittenText)
        XCTAssertEqual(anchor.id, "title")
    }

    func testAWhitespaceOnlySelectionInAPlainBlockAnchorsThatBlock() {
        let text = "body here\n"
        let anchor = MarkdownLinking.anchor(in: text, at: NSRange(location: 9, length: 1))
        XCTAssertEqual(anchor.rewrittenText, "<a id=\"\(anchor.id)\"></a>body here\n")
    }
}
