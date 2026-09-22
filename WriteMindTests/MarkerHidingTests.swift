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

    // MARK: - Furniture: hidden even on the caret's own line

    private func furniture(_ source: String) -> [String] {
        let text = source as NSString
        return CellFurniture.headingMarkers(MarkdownSourceStyle.runs(in: source), in: text)
            .map { text.substring(with: $0) }
    }

    func testTheHashesAtTheHeadOfALineAreFurnitureAndNothingElseIs() {
        XCTAssertEqual(furniture("## Section"), ["## "])
        XCTAssertEqual(furniture("###### Deep\n\n# Top"), ["###### ", "# "])
        // Not an inline pair, not a fence, not a hash inside the words.
        XCTAssertTrue(furniture("Plain **bold** here").isEmpty)
        XCTAssertTrue(furniture("```swift\nlet x = 1\n```").isEmpty)
        XCTAssertTrue(furniture("a #hashtag mid-line").isEmpty)
        XCTAssertTrue(furniture("#no space after").isEmpty)
    }

    func testAnEmptyHeadingIsStillFurniture() {
        // `hideable` leaves a run that IS its whole line alone, so an
        // empty heading kept its hashes; as furniture it does not.
        XCTAssertTrue(hideable("## ").isEmpty)
        XCTAssertEqual(furniture("## "), ["## "])
    }

    func testFurnitureStaysHiddenWhileItsOwnParagraphIsRevealed() {
        let source = "## Section"
        let text = source as NSString
        let hiding = MarkerHiding()
        hiding.setMarkers(MarkerHiding.hideable(MarkdownSourceStyle.runs(in: source), in: text))
        hiding.setFurniture(CellFurniture.read(text, runs: MarkdownSourceStyle.runs(in: source)))
        // The caret is in the heading — the one case that used to show it.
        _ = hiding.setRevealed(NSRange(location: 0, length: text.length))
        XCTAssertTrue(hiding.isHidden(0), "the # is furniture on the rendered page")
        XCTAssertTrue(hiding.isHidden(2), "and so is the space after it")
        XCTAssertFalse(hiding.isHidden(3), "the words are not")
    }

    func testTheCaretIsPushedOutOfTheFrontOfFurniture() {
        let piece = [NSRange(location: 0, length: 3)]
        // Anywhere inside it — including its very start, which is where a
        // click on the left edge and Home both land.
        for at in 0...2 {
            XCTAssertEqual(MarkerHiding.outside(NSRange(location: at, length: 0), of: piece),
                           NSRange(location: 3, length: 0), "from \(at)")
        }
        // Past it, and a real selection, are left exactly as they are.
        XCTAssertEqual(MarkerHiding.outside(NSRange(location: 5, length: 0), of: piece),
                       NSRange(location: 5, length: 0))
        XCTAssertEqual(MarkerHiding.outside(NSRange(location: 0, length: 9), of: piece),
                       NSRange(location: 0, length: 9))
        XCTAssertEqual(MarkerHiding.outside(NSRange(location: 1, length: 0), of: []),
                       NSRange(location: 1, length: 0))
    }

    func testABackspaceBehindFurnitureTakesTheWholePiece() {
        let piece = [NSRange(location: 0, length: 3)]
        XCTAssertEqual(MarkerHiding.furnitureBehind(3, in: piece), piece[0])
        XCTAssertNil(MarkerHiding.furnitureBehind(4, in: piece))
        XCTAssertNil(MarkerHiding.furnitureBehind(0, in: piece))
        XCTAssertNil(MarkerHiding.furnitureBehind(3, in: []))
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

/// The two panes, closer to the same height (Sean, 2026-09-19: "positions
/// stay the same in markdown and wysiwyg mode").
final class StructuralLineTests: XCTestCase {
    func testTheBlankLineBetweenTwoCellsIsStructure() {
        let text = "First cell\n\nSecond cell"
        let lines = MarkdownSourceStyle.structuralLines(in: text)
        XCTAssertEqual(lines.count, 1)
        XCTAssertEqual((text as NSString).substring(with: lines[0]), "\n")
    }

    func testAFencesOwnLinesAreNotCollapsed() {
        // They mean nothing on the rendered page, but they have characters
        // on them, and a line with characters squashed to a few points is
        // a line of writing cut in half (Sean, 2026-09-20).
        let text = "Words\n\n```swift\nlet a = 1\n```\n"
        let strings = MarkdownSourceStyle.structuralLines(in: text)
            .map { (text as NSString).substring(with: $0).trimmingCharacters(in: .newlines) }
        XCTAssertFalse(strings.contains("```swift"), "got \(strings)")
        XCTAssertEqual(strings, [""], "only the blank line between the two cells")
    }

    func testALineOfWritingIsNot() {
        let text = "Just one line of prose"
        XCTAssertTrue(MarkdownSourceStyle.structuralLines(in: text).isEmpty)
    }

    func testABlankLineIsNotWhatMakesTheGap() {
        // The gap is the space after the cell above it, so however many
        // blank lines the file has between two cells, the gap is one.
        XCTAssertLessThan(MarkdownSourceStyle.structuralSize, MarkdownPreview.gapHeight)
    }

    func testAnEmptyNoteHasNothingToCollapse() {
        XCTAssertTrue(MarkdownSourceStyle.structuralLines(in: "").isEmpty)
    }
}

/// One gap per cell, wherever it is (Sean, 2026-09-20: "cells still aren't
/// stacked with an even small spacing between them").
final class CellGapInTheSourceTests: XCTestCase {
    func testEveryCellEndsWithTheLineThatCarriesTheGap() {
        let text = "First cell\n\n## A heading\n\nWords under it"
        let ends = MarkdownSourceStyle.cellEndLines(in: text)
            .map { (text as NSString).substring(with: $0).trimmingCharacters(in: .newlines) }
        XCTAssertEqual(ends, ["First cell", "## A heading", "Words under it"])
    }

    func testACellOfSeveralLinesCarriesItOnlyOnTheLast() {
        let text = "one\ntwo\nthree\n\nnext cell"
        let ends = MarkdownSourceStyle.cellEndLines(in: text)
            .map { (text as NSString).substring(with: $0).trimmingCharacters(in: .newlines) }
        XCTAssertEqual(ends, ["three", "next cell"])
    }

    func testAHeadingWithNoBlankLineAfterItStillGetsAGap() {
        // The gap comes from the cell, not from a blank line the file may
        // or may not have.
        let text = "## Title\nStraight into the words"
        XCTAssertEqual(MarkdownSourceStyle.cellEndLines(in: text).count, 2)
    }

    func testABlankLineIsDrawnAtAlmostNothing() {
        XCTAssertLessThanOrEqual(MarkdownSourceStyle.structuralSize, 3)
    }

    func testAnEmptyNoteHasNoCellEnds() {
        XCTAssertTrue(MarkdownSourceStyle.cellEndLines(in: "").isEmpty)
    }
}
