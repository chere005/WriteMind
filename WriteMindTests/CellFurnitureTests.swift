import AppKit
import XCTest
@testable import WriteMind

/// What the rendered page's cell editor treats as furniture (Sean,
/// 2026-09-21: "only edit the text in a reminders list or bullet list").
final class CellFurnitureTests: XCTestCase {
    private func read(_ source: String) -> CellFurniture.Reading {
        CellFurniture.read(source as NSString, runs: MarkdownSourceStyle.runs(in: source))
    }

    /// The characters the caret may not be put among, as text.
    private func reserved(_ source: String) -> [String] {
        let text = source as NSString
        return read(source).reserved.map { text.substring(with: $0) }
    }

    private func hidden(_ source: String) -> [String] {
        let text = source as NSString
        return read(source).hidden.map { text.substring(with: $0) }.sorted()
    }

    // MARK: - A bullet is drawn, and still out of reach

    func testABulletIsReservedButNotHidden() {
        XCTAssertEqual(reserved("- first\n- second"), ["- ", "- "])
        // `BulletGlyphs` draws the dash as a round bullet; hiding it would
        // leave a list with no marker, which is not a list.
        XCTAssertTrue(hidden("- first\n- second").isEmpty)
        XCTAssertTrue(read("- first").glyphs.isEmpty)
    }

    func testANumberedListIsReservedTheSameWay() {
        XCTAssertEqual(reserved("1. one\n2. two"), ["1. ", "2. "])
    }

    func testPlainProseHasNoFurnitureAtAll() {
        XCTAssertTrue(read("Just some words, and **bold** ones.").isEmpty)
    }

    // MARK: - A reminder

    func testAReminderIsOneBoxAndTheWordsAfterIt() {
        let source = "- [ ] a reminder"
        let reading = read(source)
        // The marker and the brackets go; the box stands for all of them.
        XCTAssertEqual(hidden(source), [" ", "- ", "]"])
        XCTAssertEqual(reading.glyphs, [2: CellFurniture.emptyBox])
        // Reserved up to and including the space: the caret lands on `a`.
        // Twice over, and deliberately — the `- ` is furniture because it
        // is a list marker, the whole head because it is a box.
        XCTAssertEqual(reserved(source), ["- ", "- [ ] "])
        XCTAssertEqual(MarkerHiding.outside(NSRange(location: 0, length: 0),
                                            of: read(source).reserved),
                       NSRange(location: 6, length: 0), "past ALL of it, not past the dash")
    }

    func testATickedReminderGetsTheTickedBox() {
        XCTAssertEqual(read("- [x] done").glyphs, [2: CellFurniture.tickedBox])
        XCTAssertEqual(read("- [X] done").glyphs, [2: CellFurniture.tickedBox])
    }

    func testAnIndentedReminderReservesItsIndentToo() {
        // Nowhere in the head of the line is a place to type.
        XCTAssertEqual(reserved("    - [ ] nested"), ["- ", "    - [ ] "])
        XCTAssertEqual(read("    - [ ] nested").glyphs, [6: CellFurniture.emptyBox])
    }

    func testAReminderWithNoWordsYetStillHasItsBox() {
        let reading = read("- [ ]")
        XCTAssertEqual(reading.glyphs, [2: CellFurniture.emptyBox])
        XCTAssertEqual(reserved("- [ ]"), ["- ", "- [ ]"])
    }

    func testWhatIsNotAReminder() {
        XCTAssertTrue(read("- [] x").glyphs.isEmpty, "no room for a state in the box")
        XCTAssertTrue(read("a [ ] mid-line").glyphs.isEmpty)
        XCTAssertTrue(read("- [ ]x").glyphs.isEmpty, "the box is followed by a space or nothing")
    }

    // MARK: - A heading

    func testAHeadingsHashesAreHiddenAndReserved() {
        XCTAssertEqual(hidden("## Section"), ["## "])
        XCTAssertEqual(reserved("## Section"), ["## "])
        XCTAssertEqual(hidden("###### Deep").first, "###### ")
    }

    func testAFenceAndAnInlinePairAreNotFurniture() {
        XCTAssertTrue(read("```swift\nlet x = 1\n```").isEmpty)
        XCTAssertTrue(read("Plain **bold** here").isEmpty)
        XCTAssertTrue(read("#no space after").isEmpty)
    }

    // MARK: - The glyphs have to exist

    /// A font with no glyph for a character answers 0, which draws as
    /// nothing at all — so a box that is not in the font is a box that
    /// vanishes. U+2610, the empty ballot box, is exactly that in the
    /// system font, which is why the pair here is U+25A1 and U+2611.
    func testBothBoxesExistInTheFontProseIsSetIn() {
        let font = NSFont.systemFont(ofSize: 15)
        XCTAssertNotEqual(BulletGlyphs.glyph(for: CellFurniture.emptyBox, in: font), 0,
                          "the empty box is missing from \(font.fontName)")
        XCTAssertNotEqual(BulletGlyphs.glyph(for: CellFurniture.tickedBox, in: font), 0,
                          "the ticked box is missing from \(font.fontName)")
        XCTAssertEqual(BulletGlyphs.glyph(for: 0x2610, in: font), 0,
                       "if this ever gains a glyph, U+2610 is the better empty box")
        // The monospaced font has no ticked box, and a missing glyph draws
        // as nothing — which is why the substitution asks before it
        // replaces and leaves the bracket showing instead. Nothing is set
        // in that font but a code cell, and a code cell has no furniture.
        XCTAssertEqual(BulletGlyphs.glyph(for: CellFurniture.tickedBox,
                                          in: .monospacedSystemFont(ofSize: 13, weight: .regular)), 0)
    }

    // MARK: - The whole cell

    func testAListOfReminders() {
        let source = "- [x] done\n- [ ] not yet\n- [ ] nor this"
        let reading = read(source)
        XCTAssertEqual(reading.glyphs.count, 3)
        XCTAssertEqual(reading.reserved.count, 6, "three markers and three whole heads")
        // Every box is a `[` in the note, and the note is untouched.
        for (at, _) in reading.glyphs {
            XCTAssertEqual((source as NSString).substring(with: NSRange(location: at, length: 1)), "[")
        }
    }
}
