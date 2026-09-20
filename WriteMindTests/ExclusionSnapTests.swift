import AppKit
import XCTest
@testable import WriteMind

/// A picture takes a band of the page, and that band may not cut a cell in
/// half (Sean, 2026-09-19: "images and captures can't break the text in a
/// group").
final class ExclusionSnapTests: XCTestCase {
    /// A text view laid out the way the editor lays one out.
    private func view(_ text: String, width: CGFloat = 300) -> NSTextView {
        let view = NSTextView(usingTextLayoutManager: false)
        view.isRichText = false
        view.font = MarkdownTextView.font
        view.textContainer?.lineFragmentPadding = 0
        view.textContainer?.containerSize = NSSize(width: width, height: CGFloat.greatestFiniteMagnitude)
        view.textContainer?.widthTracksTextView = false
        view.string = text
        view.layoutManager?.ensureLayout(for: view.textContainer!)
        return view
    }

    private func lineTop(of view: NSTextView, at character: Int) -> CGFloat {
        let layout = view.layoutManager!
        let glyph = layout.glyphIndexForCharacter(at: character)
        return layout.lineFragmentRect(forGlyphAt: glyph, effectiveRange: nil).minY
    }

    /// A paragraph long enough to wrap over several lines.
    private let long = "One two three four five six seven eight nine ten eleven twelve thirteen "
        + "fourteen fifteen sixteen seventeen eighteen nineteen twenty."

    func testABandInTheMiddleOfAParagraphIsStretchedToItsTop() throws {
        let note = "First line.\n\n\(long)\n\nAfter.\n"
        let tv = view(note)
        let paragraph = (note as NSString).range(of: long)
        let top = lineTop(of: tv, at: paragraph.location)
        // A band starting well inside the paragraph — a couple of lines down.
        let inside = CGRect(x: -10_000, y: top + 40, width: 20_000, height: 30)
        let snapped = MarkdownTextView.snappedToCells([inside], in: tv)
        XCTAssertEqual(snapped.count, 1)
        XCTAssertEqual(snapped[0].minY, top, accuracy: 0.5, "the band now starts where the cell does")
        XCTAssertEqual(snapped[0].maxY, inside.maxY, accuracy: 0.5, "and still ends where it did")
    }

    func testABandThatAlreadyFallsBetweenCellsIsLeftAlone() throws {
        let note = "First line.\n\n\(long)\n\nAfter.\n"
        let tv = view(note)
        let paragraph = (note as NSString).range(of: long)
        let top = lineTop(of: tv, at: paragraph.location)
        let between = CGRect(x: -10_000, y: top, width: 20_000, height: 20)
        XCTAssertEqual(MarkdownTextView.snappedToCells([between], in: tv)[0].minY, between.minY,
                       accuracy: 0.5)
    }

    func testAListIsOneCellAndIsNotSplitEither() throws {
        let note = "- one\n- two\n- three\n- four\n\nAfter.\n"
        let tv = view(note)
        let list = (note as NSString).range(of: "- one")
        let top = lineTop(of: tv, at: list.location)
        let middle = CGRect(x: -10_000, y: top + 30, width: 20_000, height: 20)
        let snapped = MarkdownTextView.snappedToCells([middle], in: tv)
        XCTAssertEqual(snapped[0].minY, top, accuracy: 0.5, "the whole list goes under the picture")
    }

    func testABandAboveTheTextOrBelowItIsUntouched() {
        let tv = view("Only one line.\n")
        let above = CGRect(x: -10_000, y: -50, width: 20_000, height: 20)
        let below = CGRect(x: -10_000, y: 5_000, width: 20_000, height: 20)
        XCTAssertEqual(MarkdownTextView.snappedToCells([above, below], in: tv), [above, below])
    }

    func testAnEmptyNoteChangesNothing() {
        let tv = view("")
        let band = CGRect(x: -10_000, y: 10, width: 20_000, height: 20)
        XCTAssertEqual(MarkdownTextView.snappedToCells([band], in: tv), [band])
    }
}

/// A picture goes in the gap between two cells, never beside a line of one
/// (Sean, 2026-09-19: "inserted grabbed drawings and images are their own
/// object that can only go between cells").
final class CellBoundaryTests: XCTestCase {
    private func bridge(_ text: String) -> (EditorBridge, NSTextView) {
        let view = NSTextView(usingTextLayoutManager: false)
        view.isRichText = false
        view.font = MarkdownTextView.font
        view.textContainer?.lineFragmentPadding = 0
        view.textContainer?.containerSize = NSSize(width: 300, height: CGFloat.greatestFiniteMagnitude)
        view.textContainer?.widthTracksTextView = false
        view.string = text
        view.layoutManager?.ensureLayout(for: view.textContainer!)
        let bridge = EditorBridge()
        bridge.textView = view
        return (bridge, view)
    }

    private func lineTop(_ view: NSTextView, at character: Int) -> CGFloat {
        let layout = view.layoutManager!
        return layout.lineFragmentRect(forGlyphAt: layout.glyphIndexForCharacter(at: character),
                                       effectiveRange: nil).minY + view.textContainerOrigin.y
    }

    func testAPointInsideACellSnapsToThatCellsEdge() throws {
        let long = "One two three four five six seven eight nine ten eleven twelve thirteen fourteen."
        let note = "Title line\n\n\(long)\n\nAfter.\n"
        let (bridge, view) = bridge(note)
        let paragraph = (note as NSString).range(of: long)
        let top = lineTop(view, at: paragraph.location)

        // A point two lines into the paragraph comes back as one of that
        // paragraph's own edges, never a point inside it.
        let inside = top + 30
        let snapped = try XCTUnwrap(bridge.cellBoundary(near: inside))
        XCTAssertNotEqual(snapped, inside)
        XCTAssertTrue(abs(snapped - top) < 1 || snapped > inside,
                      "snapped to \(snapped), the cell starts at \(top)")
    }

    func testAPointAlreadyInAGapStaysWhereItIs() throws {
        let note = "One\n\nTwo\n\nThree\n"
        let (bridge, view) = bridge(note)
        let second = (note as NSString).range(of: "Two")
        let top = lineTop(view, at: second.location)
        let snapped = try XCTUnwrap(bridge.cellBoundary(near: top))
        XCTAssertEqual(snapped, top, accuracy: 0.5)
    }

    func testAnEmptyNoteHasNoBoundaries() {
        let (bridge, _) = bridge("")
        XCTAssertNil(bridge.cellBoundary(near: 10))
    }

    func testWithNoTextViewItAnswersNothing() {
        XCTAssertNil(EditorBridge().cellBoundary(near: 10))
    }
}
