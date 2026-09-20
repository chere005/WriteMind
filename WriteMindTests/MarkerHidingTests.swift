import AppKit
import XCTest
@testable import WriteMind

/// Hiding the markdown markers without touching the note: which runs may
/// vanish, and which paragraph gets to keep its own.
final class MarkerHidingTests: XCTestCase {
    private func hideable(_ source: String) -> [String] {
        let text = source as NSString
        return MarkerHiding.hideable(MarkdownSourceStyle.runs(in: source), in: text)
            .map { text.substring(with: $0) }
    }

    func testTheInlineSyntaxIsWhatVanishes() {
        let hidden = hideable("Plain **bold** and _italic_ and ~~struck~~ here.")
        XCTAssertEqual(hidden.filter { $0 == "**" }.count, 2)
        XCTAssertEqual(hidden.filter { $0 == "_" }.count, 2)
        XCTAssertEqual(hidden.filter { $0 == "~~" }.count, 2)
    }

    func testAHeadingLosesItsHashesAndALinkItsURL() {
        XCTAssertTrue(hideable("## Section").contains("## "))
        let link = hideable("see [the page](https://example.com) now")
        XCTAssertTrue(link.contains("https://example.com"), "the URL goes: \(link)")
        XCTAssertTrue(link.contains("["))
    }

    func testAFenceLineStaysWhereItIs() {
        // Hiding the whole of a ``` line would leave a blank line, not close it.
        XCTAssertTrue(hideable("```swift\nlet x = 1\n```").isEmpty)
    }

    func testALineOfDashesAndAListMarkerAreLeftAlone() {
        XCTAssertTrue(hideable("---").isEmpty)
        XCTAssertTrue(hideable("- an item").isEmpty, "the bullet is drawn, not hidden")
        XCTAssertTrue(hideable("> a quote").isEmpty)
    }

    func testTheRevealedParagraphKeepsItsMarkers() {
        let hiding = MarkerHiding()
        hiding.setMarkers([NSRange(location: 6, length: 2), NSRange(location: 12, length: 2),
                           NSRange(location: 40, length: 2)])
        XCTAssertTrue(hiding.isHidden(6))
        XCTAssertTrue(hiding.isHidden(40))

        let dirty = hiding.setRevealed(NSRange(location: 0, length: 20))
        XCTAssertEqual(dirty.count, 1, "only the paragraph that arrived")
        XCTAssertFalse(hiding.isHidden(6), "the caret's paragraph shows its own")
        XCTAssertFalse(hiding.isHidden(12))
        XCTAssertTrue(hiding.isHidden(40), "everywhere else stays hidden")
    }

    func testMovingInsideOneParagraphCostsNothing() {
        let hiding = MarkerHiding()
        hiding.setMarkers([NSRange(location: 6, length: 2)])
        _ = hiding.setRevealed(NSRange(location: 0, length: 20))
        XCTAssertTrue(hiding.setRevealed(NSRange(location: 0, length: 20)).isEmpty)
        XCTAssertEqual(hiding.setRevealed(NSRange(location: 20, length: 30)).count, 2,
                       "the one left and the one arrived at")
    }

    func testTurningItOffPutsEveryMarkerBack() {
        let hiding = MarkerHiding()
        hiding.setMarkers([NSRange(location: 6, length: 2)])
        XCTAssertTrue(hiding.isHidden(6))
        hiding.isEnabled = false
        XCTAssertFalse(hiding.isHidden(6))
    }

    /// The measurement that matters: a hidden line is exactly as wide as
    /// the same line with the markers deleted.
    func testAHiddenLineIsAsWideAsOneWithTheMarkersDeleted() throws {
        func width(_ source: String, hiding markers: Bool) -> CGFloat {
            let view = NSTextView(usingTextLayoutManager: false)
            view.isRichText = false
            view.font = MarkdownTextView.font
            view.textContainer?.lineFragmentPadding = 0
            view.textContainer?.containerSize = NSSize(width: 4000, height: CGFloat.greatestFiniteMagnitude)
            view.string = source
            let hider = MarkerHiding()
            if markers {
                hider.setMarkers(MarkerHiding.hideable(MarkdownSourceStyle.runs(in: source),
                                                       in: source as NSString))
            }
            view.layoutManager?.delegate = hider
            guard let layout = view.layoutManager, let container = view.textContainer else { return 0 }
            layout.invalidateGlyphs(forCharacterRange: NSRange(location: 0, length: (source as NSString).length),
                                    changeInLength: 0, actualCharacterRange: nil)
            layout.ensureLayout(for: container)
            return layout.usedRect(for: container).width
        }
        let hidden = width("Plain **bold** and _italic_ text", hiding: true)
        let deleted = width("Plain bold and italic text", hiding: false)
        XCTAssertEqual(hidden, deleted, accuracy: 0.5, "the markers take no width at all")
        let visible = width("Plain **bold** and _italic_ text", hiding: false)
        XCTAssertGreaterThan(visible, hidden + 10, "and they really were wide before")
    }
}
