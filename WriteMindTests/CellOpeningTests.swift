import AppKit
import XCTest
@testable import WriteMind

/// A text view with the editor's own metrics, laid out, so a seam can be
/// measured off it the way the pane measures one.
private func sourceView(_ text: String, spacingUnderTheFirstCell: CGFloat = 0) -> PasteAwareTextView {
    // NSTextView(frame:textContainer:) with a nil container gives a view
    // that keeps no text at all — `string` sets nothing. The frame-only
    // initialiser builds the whole TextKit stack.
    let view = PasteAwareTextView(frame: NSRect(x: 0, y: 0, width: 400, height: 800))
    view.font = MarkdownTextView.font
    view.defaultParagraphStyle = MarkdownTextView.paragraphStyle
    view.textContainerInset = NSSize(width: 24, height: 20)
    view.textContainer?.containerSize = NSSize(width: 352, height: CGFloat.greatestFiniteMagnitude)
    view.textContainer?.widthTracksTextView = false
    view.string = text
    view.textStorage?.addAttributes([.font: MarkdownTextView.font,
                                     .paragraphStyle: MarkdownTextView.paragraphStyle],
                                    range: NSRange(location: 0, length: (text as NSString).length))
    if spacingUnderTheFirstCell > 0, let storage = view.textStorage, !text.isEmpty {
        let style = NSMutableParagraphStyle()
        style.setParagraphStyle(MarkdownTextView.paragraphStyle)
        style.paragraphSpacing = spacingUnderTheFirstCell
        let first = (text as NSString).lineRange(for: NSRange(location: 0, length: 0))
        storage.addAttribute(.paragraphStyle, value: style, range: first)
    }
    view.layoutManager?.ensureLayout(for: view.textContainer!)
    return view
}

/// Where the seams are in the markdown pane: measured off the layout, the
/// whole space between two cells and nothing of the cells themselves
/// (Sean, 2026-09-20: "the cursor should be horizontal any space between
/// the two cells.. that's buggy").
final class SeamMeasurementTests: XCTestCase {
    func testThereIsASeamAboveBetweenAndBelowTwoCells() {
        let out = MarkdownTextView.seams(in: sourceView("First cell\n\nSecond cell"))
        XCTAssertEqual(out.count, 3)
        XCTAssertEqual(out.map(\.offset), [0, 12, 23])
    }

    func testTheFirstSeamStartsAtTheTopOfThePaneAndTheLastReachesTheBottom() {
        // The space under the last cell is the tail, all of it — not the
        // seven-point strip it used to be.
        let view = sourceView("First cell\n\nSecond cell")
        let out = MarkdownTextView.seams(in: view)
        XCTAssertEqual(out.first?.top, 0)
        XCTAssertEqual(out.last?.bottom, view.bounds.height)
    }

    func testAnEmptyNoteIsOneSeamOverTheWholePane() {
        let out = MarkdownTextView.seams(in: sourceView(""))
        XCTAssertEqual(out.count, 1)
        XCTAssertEqual(out.first?.offset, 0)
    }

    func testTheBlankLineBetweenTwoCellsIsSeamAllTheWayAcross() {
        let view = sourceView("First cell\n\nSecond cell")
        let out = MarkdownTextView.seams(in: view)
        let layout = view.layoutManager!
        let inset = view.textContainerInset.height
        let blank = layout.lineFragmentRect(forGlyphAt: layout.glyphIndexForCharacter(at: 11),
                                            effectiveRange: nil)
        for y in stride(from: blank.minY + inset, through: blank.maxY + inset, by: 1) {
            XCTAssertEqual(CellSeams.seam(at: y, in: out)?.offset, 12, "\(y) is between the two cells")
        }
        let first = layout.lineFragmentRect(forGlyphAt: 0, effectiveRange: nil)
        XCTAssertNil(CellSeams.seam(at: first.midY + inset, in: out), "the words are not a seam")
    }

    func testTheEmptyLinesOfABlankCellAreTheCellsOwnAndNotTheSeamUnderIt() {
        // A .blank cell's range stops one line short — its last character
        // is the newline that ends the line before the last — so measuring
        // the range alone put the last of his eight empty lines in the
        // seam. Cells are measured over whole lines for exactly this.
        let note = "baz\n" + String(repeating: "\n", count: 10) + "# asdf"
        let view = sourceView(note)
        let out = MarkdownTextView.seams(in: view)
        let layout = view.layoutManager!
        let inset = view.textContainerInset.height
        // Character 12 is the eighth of the eight empty lines; 13 is the
        // line that announces the heading, and that one IS seam.
        let last = layout.lineFragmentRect(forGlyphAt: layout.glyphIndexForCharacter(at: 12),
                                           effectiveRange: nil)
        XCTAssertNil(CellSeams.seam(at: last.midY + inset, in: out),
                     "the eighth empty line is the cell's body")
        let announcing = layout.lineFragmentRect(forGlyphAt: layout.glyphIndexForCharacter(at: 13),
                                                 effectiveRange: nil)
        XCTAssertEqual(CellSeams.seam(at: announcing.midY + inset, in: out)?.offset, 14)
    }

    func testTheSpacingUnderACellIsSeamAndNotPartOfTheCell() {
        // boundingRect(forGlyphRange:in:) answers the USED rect, not the
        // line fragment, so the 8 pt a cell's last line carries under it
        // falls outside the cell's box and inside the seam. A macOS that
        // changed its mind would put the armed line inside a cell, so it
        // is asserted here rather than trusted.
        let plain = MarkdownTextView.cellBoxes(in: sourceView("First cell\n\nSecond cell"))
        let spaced = MarkdownTextView.cellBoxes(
            in: sourceView("First cell\n\nSecond cell", spacingUnderTheFirstCell: 8))
        XCTAssertEqual(plain.count, 2)
        XCTAssertEqual(spaced[0].bottom, plain[0].bottom, accuracy: 0.01,
                       "the space under the cell is not part of it")
        XCTAssertEqual(spaced[1].top - plain[1].top, 8, accuracy: 0.01,
                       "it belongs to the seam above the next cell")
    }

    // MARK: - What the layer takes and what it leaves

    private func layer(_ seams: [CellSeams.Seam]) -> CellInsertions {
        let view = CellInsertions(frame: NSRect(x: 0, y: 0, width: 400, height: 800))
        view.seams = seams
        return view
    }

    func testThePointerIsInTheSeamEverywhereAcrossItExceptTheBracketGutter() {
        let view = layer([CellSeams.Seam(top: 100, bottom: 140, offset: 5)])
        XCTAssertEqual(view.seam(at: CGPoint(x: 20, y: 101))?.offset, 5)
        XCTAssertEqual(view.seam(at: CGPoint(x: 340, y: 139))?.offset, 5)
        XCTAssertNil(view.seam(at: CGPoint(x: 390, y: 120)),
                     "a section's bracket runs down the seams as well as the cells")
        XCTAssertNil(view.seam(at: CGPoint(x: 20, y: 200)), "a cell belongs to the text view")
    }

    func testWithThePenUpTheLayerAnswersNothingAtAll() {
        // The pencil owns the note pane in drawing mode (Sean, 2026-09-20:
        // "cursor only becomes a pen in the notes pane in drawing
        // mode!!!!!"). Hiding the layer is how that is said, and this
        // view's own hit testing has to ask, because overriding hitTest
        // steps over the check AppKit would have made.
        let view = layer([CellSeams.Seam(top: 100, bottom: 140, offset: 5)])
        view.isHidden = true
        XCTAssertNil(view.seam(at: CGPoint(x: 20, y: 120)))
        XCTAssertNil(view.hitTest(CGPoint(x: 20, y: 120)))
    }
}

/// What typing in an armed seam does to the note (Sean, 2026-09-20: "typing
/// from here would insert a new cell below that line").
final class CellOpeningTests: XCTestCase {
    private func armed(_ text: String, at offset: Int) -> PasteAwareTextView {
        let view = sourceView(text)
        view.setSelectedRange(NSRange(location: offset, length: 0))
        view.armedSeam = offset
        return view
    }

    /// The way a keystroke arrives: AppKit passes {NSNotFound, 0} for
    /// "wherever the caret is". A caller that names a range means
    /// something else, and `testWordsReadOffAPicture…` below is why that
    /// difference matters.
    private func type(_ character: String, in view: PasteAwareTextView) {
        view.insertText(character, replacementRange: NSRange(location: NSNotFound, length: 0))
    }

    // MARK: - One character, one cell

    func testTypingInTheSeamBetweenTwoCellsMakesTheCharacterACellOfItsOwn() {
        let view = armed("First cell\n\nSecond cell", at: 12)
        type("x", in: view)
        XCTAssertEqual(view.string, "First cell\n\nx\n\nSecond cell")
        XCTAssertEqual(view.selectedRange().location, 13, "the caret is after what was typed")
        XCTAssertEqual(MarkdownParser.blocks(from: view.string),
                       [.paragraph("First cell"), .paragraph("x"), .paragraph("Second cell")])
    }

    func testTypingInTheSeamAboveTheFirstCellPushesTheNoteDown() {
        let view = armed("First cell\n\nSecond cell", at: 0)
        type("x", in: view)
        XCTAssertEqual(view.string, "x\n\nFirst cell\n\nSecond cell")
    }

    func testTypingUnderTheLastCellOfANoteThatEndsInANewline() {
        let view = armed("Only cell\n", at: 10)
        type("x", in: view)
        XCTAssertEqual(view.string, "Only cell\n\nx")
    }

    func testTypingUnderTheLastCellOfANoteThatDoesNot() {
        let view = armed("Only cell", at: 9)
        type("x", in: view)
        XCTAssertEqual(view.string, "Only cell\n\nx")
    }

    func testTypingInTheSeamBesideARunOfEmptyLinesLeavesThoseLinesAlone() {
        // Those lines are the note's content, not spacing: a cell of eight
        // empty lines is still eight after a cell is opened beside it
        // (Sean, 2026-09-20: "one with 8 empty lines").
        let note = "baz\n" + String(repeating: "\n", count: 10) + "# asdf"
        let view = armed(note, at: 5)
        type("x", in: view)
        XCTAssertEqual(MarkdownParser.blocks(from: view.string),
                       [.paragraph("baz"), .paragraph("x"), .blank(lines: 8),
                        .heading(level: 1, text: "asdf")])
    }

    // MARK: - The invariant

    func testOneCharacterInASeamAddsExactlyThatOneCellThere() {
        // Over several notes and every seam of each: the note gains one
        // cell, it is a paragraph holding what was typed, it is at the
        // seam's own index, and nothing else about the note changes.
        let notes = ["",
                     "First cell\n\nSecond cell",
                     "# Title\n\nBody\n\n- one\n- two",
                     "baz\n" + String(repeating: "\n", count: 10) + "# asdf",
                     "Only cell",
                     "Only cell\n"]
        for note in notes {
            let before = MarkdownParser.blocks(from: note)
            let seams = MarkdownTextView.seams(in: sourceView(note))
            XCTAssertEqual(seams.count, before.count + 1, "a seam above each cell and one under the last")
            for (index, seam) in seams.enumerated() {
                let view = armed(note, at: seam.offset)
                type("x", in: view)
                var wanted = before
                wanted.insert(.paragraph("x"), at: index)
                XCTAssertEqual(MarkdownParser.blocks(from: view.string), wanted,
                               "seam \(index) of \(note.debugDescription)")
            }
        }
    }

    // MARK: - Every other key

    func testReturnInASeamOpensAnEmptyCellThere() {
        let view = armed("First cell\n\nSecond cell", at: 12)
        view.doCommand(by: #selector(NSResponder.insertNewline(_:)))
        XCTAssertEqual(view.string, "First cell\n\n\n\nSecond cell")
        XCTAssertEqual(view.selectedRange().location, 12)
        XCTAssertEqual(MarkdownParser.blocks(from: view.string),
                       [.paragraph("First cell"), .blank(lines: 1), .paragraph("Second cell")])
        XCTAssertNil(view.armedSeam)
    }

    func testEscapeOrAnArrowLeavesTheNoteExactlyAsItWas() {
        // Clicking about the page must never leave empty cells behind.
        for key in [#selector(NSResponder.cancelOperation(_:)), #selector(NSResponder.moveDown(_:))] {
            let view = armed("First cell\n\nSecond cell", at: 12)
            view.doCommand(by: key)
            XCTAssertEqual(view.string, "First cell\n\nSecond cell")
            XCTAssertNil(view.armedSeam)
        }
    }

    func testTheCaretIsNotDrawnWhileASeamIsArmed() {
        // The line across the page IS the cursor; two of them is what he
        // was looking at before.
        let view = sourceView("First cell\n\nSecond cell")
        view.caretColour = .textColor
        view.insertionPointColor = .textColor
        view.armedSeam = 12
        XCTAssertEqual(view.insertionPointColor, .clear)
        view.armedSeam = nil
        XCTAssertEqual(view.insertionPointColor, .textColor)
    }

    func testTheBarGoesOutWhenTheSeamIsOpened() {
        let view = armed("First cell\n\nSecond cell", at: 12)
        var told: [Int?] = []
        view.onArmChanged = { told.append($0) }
        type("x", in: view)
        XCTAssertNil(view.armedSeam)
        XCTAssertEqual(told, [nil], "the layer is told, so the line stops being drawn")
    }

    // MARK: - Text that is not typing

    func testWordsReadOffAPictureGoWhereTheyWereAskedForAndNotAtTheBar() {
        // `EditorBridge.insert(_:belowDocumentY:)` is the only route the
        // "words read from a picture go in under it" feature has, and it
        // names the range they go at. Opening the armed seam instead put
        // them wherever the bar was — at the top of the note, under a
        // picture read further down — and left an empty cell behind.
        let view = armed("First cell\n\nSecond cell", at: 0)
        view.insertText("read\n", replacementRange: NSRange(location: 12, length: 0))
        XCTAssertEqual(view.string, "First cell\n\nread\nSecond cell")
        XCTAssertNil(view.armedSeam, "the offset it held has just moved")
    }
}

/// Which seam the CARET is in — arming is a reading of where the caret is,
/// not a mode a click turns on (Sean, 2026-09-20: "the mouse cursor and
/// text cursor should both become horizontal between cells").
final class SeamArmingTests: XCTestCase {
    private let note = "First cell\n\nSecond cell"

    func testTheCaretOnTheBlankLineBetweenTwoCellsArmsThatSeam() {
        // ↓ off the end of "First cell" lands here. Before, it was an
        // ordinary caret: typing put the character on its own line and
        // the parser read all three lines as one paragraph, so two cells
        // and their two brackets silently became one.
        XCTAssertEqual(CellSeams.arm(caret: NSRange(location: 11, length: 0), in: note, current: nil), 12)
    }

    func testACaretInsideACellArmsNothing() {
        for offset in Array(0...10) + Array(12...23) {
            XCTAssertNil(CellSeams.arm(caret: NSRange(location: offset, length: 0), in: note, current: nil),
                         "\(offset) is in a cell")
        }
    }

    func testASelectionTakesTheBarBack() {
        // A bracket click selects a whole cell and ⌘A the whole note. The
        // bar stayed armed through both, and the first character typed
        // threw the selection away and wrote at the old seam instead.
        XCTAssertNil(CellSeams.arm(caret: NSRange(location: 12, length: 11), in: note, current: 12))
        XCTAssertNil(CellSeams.arm(caret: NSRange(location: 0, length: 23), in: note, current: 12))
    }

    func testTheArmThatPutTheCaretThereStands() {
        // A click in a seam leaves the caret at the first character of the
        // cell below, which by position alone is a caret in that cell.
        XCTAssertEqual(CellSeams.arm(caret: NSRange(location: 12, length: 0), in: note, current: 12), 12)
        XCTAssertNil(CellSeams.arm(caret: NSRange(location: 13, length: 0), in: note, current: 12),
                     "and the next move clears it")
    }

    func testTheTwoEndsOfTheNoteStayExplicit() {
        // Offset 0 is both the seam above the first cell and the first
        // character of it; the length is both the tail seam and the end
        // of the last cell. Neither can be read off the offset.
        XCTAssertNil(CellSeams.arm(caret: NSRange(location: 0, length: 0), in: note, current: nil))
        XCTAssertNil(CellSeams.arm(caret: NSRange(location: 23, length: 0), in: note, current: nil))
        XCTAssertEqual(CellSeams.arm(caret: NSRange(location: 0, length: 0), in: note, current: 0), 0)
        XCTAssertEqual(CellSeams.arm(caret: NSRange(location: 23, length: 0), in: note, current: 23), 23)
    }

    func testTheEmptyLinesInTheMiddleOfARunAreTheNotesOwnContent() {
        // Only the first and last blank line of a run separate two cells
        // (Sean, 2026-09-20: "one with 8 empty lines"). On the ones
        // between them the ordinary caret belongs.
        let note = "baz\n" + String(repeating: "\n", count: 10) + "# asdf"
        XCTAssertEqual(CellSeams.arm(caret: NSRange(location: 4, length: 0), in: note, current: nil), 5,
                       "the first blank line separates baz from the blank cell")
        XCTAssertEqual(CellSeams.arm(caret: NSRange(location: 13, length: 0), in: note, current: nil), 14,
                       "and the last one separates it from the heading")
        for offset in 5...12 {
            XCTAssertNil(CellSeams.arm(caret: NSRange(location: offset, length: 0), in: note, current: nil),
                         "\(offset) is one of his eight empty lines")
        }
    }

    func testTypingWhereTheCaretArmedItMakesACellAndNotAMerge() {
        // End to end, in the text view: the caret on the separator, the
        // seam it arms, the character typed there.
        let view = sourceView(note)
        view.setSelectedRange(NSRange(location: 11, length: 0))
        view.armedSeam = CellSeams.arm(caret: view.selectedRange(), in: view.string, current: nil)
        view.insertText("x", replacementRange: NSRange(location: NSNotFound, length: 0))
        XCTAssertEqual(view.string, "First cell\n\nx\n\nSecond cell")
        XCTAssertEqual(MarkdownParser.blocks(from: view.string),
                       [.paragraph("First cell"), .paragraph("x"), .paragraph("Second cell")])
    }
}

/// A closed section is not on the page, and grows no seams over the text
/// that is.
final class FoldedSeamTests: XCTestCase {
    private func folded(_ text: String, collapsing keys: Set<String>) -> PasteAwareTextView {
        let view = PasteAwareTextView(frame: NSRect(x: 0, y: 0, width: 400, height: 800))
        let folding = FoldingLayoutManager()
        view.textContainer?.replaceLayoutManager(folding)
        folding.typesetter = FoldingTypesetter(folding.folding)
        view.font = MarkdownTextView.font
        view.textContainerInset = NSSize(width: 24, height: 20)
        view.textContainer?.containerSize = NSSize(width: 352, height: CGFloat.greatestFiniteMagnitude)
        view.textContainer?.widthTracksTextView = false
        view.string = text
        view.textStorage?.addAttributes([.font: MarkdownTextView.font,
                                         .paragraphStyle: MarkdownTextView.paragraphStyle],
                                        range: NSRange(location: 0, length: (text as NSString).length))
        folding.folding.hidden = NotebookOutline.hiddenRanges(in: text, collapsed: keys)
        let whole = NSRange(location: 0, length: (text as NSString).length)
        folding.invalidateLayout(forCharacterRange: whole, actualCharacterRange: nil)
        folding.ensureLayout(for: view.textContainer!)
        return view
    }

    private let note = "# Head\n\nHidden one\n\nHidden two\n\n# Next\n\nBody"

    func testWhatIsFoldedAwayIsNotACellAtAll() {
        let open = MarkdownTextView.cellBoxes(in: folded(note, collapsing: []))
        let shut = MarkdownTextView.cellBoxes(in: folded(note, collapsing: ["Head"]))
        XCTAssertEqual(open.count, 5)
        XCTAssertEqual(shut.map(\.offset), [0, 32, 40],
                       "the two paragraphs under the closed heading are not on the page")
    }

    func testAClosedSectionGrowsNoSeamsOverTheTextBelowIt() {
        // Every hidden block used to give a seam of no height at the
        // fold's own y, each widened to the 8 pt minimum about the same
        // point — a stack of phantom strips straddling the fold, whose
        // offsets were all inside the folded text. Clicking one armed a
        // seam the editor then refused to write at, and the section
        // sprang open instead.
        let view = folded(note, collapsing: ["Head"])
        let seams = MarkdownTextView.seams(in: view)
        XCTAssertEqual(seams.map(\.offset), [0, 32, 40, 44],
                       "the heading, the heading after it, its body, and the tail")
        let hidden = NotebookOutline.hiddenRanges(in: note, collapsed: ["Head"])
        for seam in seams {
            XCTAssertFalse(hidden.contains { NSLocationInRange(seam.offset, $0) },
                           "no seam opens a cell inside what is folded away")
        }
    }
}
