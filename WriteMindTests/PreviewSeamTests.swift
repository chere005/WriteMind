import SwiftUI
import XCTest
@testable import WriteMind

/// The seams of the RENDERED page: the same model the markdown pane uses
/// (Sean, 2026-09-20: "the cursor should be horizontal any space between
/// the two cells"), measured off the stack of blocks instead of off the
/// glyphs. One model, two measurements — which is the only reason the two
/// sides can be switched between without the page changing under him.
final class PreviewSeamTests: XCTestCase {
    private func rows(_ heights: [CGFloat], from offsets: [Int]) -> [(id: Int, height: CGFloat)] {
        zip(offsets, heights).map { ($0, $1) }
    }

    private let page: [(id: Int, height: CGFloat)] =
        [(id: 0, height: 40), (id: 12, height: 60), (id: 30, height: 20)]

    // MARK: - A seam above each cell, and the tail under the last

    func testEveryCellHasASeamAboveItAndTheLastOneHasASeamUnderIt() {
        let seams = MarkdownPreview.seams(rows: page, noteLength: 44, pageHeight: 600)
        XCTAssertEqual(seams.count, 4)
        XCTAssertEqual(seams.map(\.offset), [0, 12, 30, 44],
                       "each opens the cell below it, and the last one the end of the note")
    }

    func testTheFirstSeamIsTheWholeTopOfThePageAndNotJustTheGap() {
        // The air above the first cell used to be page padding nobody
        // could click. It is seam now, all of it.
        let seams = MarkdownPreview.seams(rows: page, noteLength: 44, pageHeight: 600)
        XCTAssertEqual(seams[0].top, 0)
        XCTAssertEqual(seams[0].bottom, MarkdownPreview.topInset + MarkdownPreview.gapHeight)
    }

    func testTheSeamBetweenTwoCellsIsTheWholeSpaceBetweenThem() {
        let seams = MarkdownPreview.seams(rows: page, noteLength: 44, pageHeight: 600)
        let places = PreviewLayout.positions(rows: page, spacing: MarkdownPreview.gapHeight,
                                             top: MarkdownPreview.topInset + MarkdownPreview.gapHeight)
        XCTAssertEqual(seams[1].top, places[0]!.bottom)
        XCTAssertEqual(seams[1].bottom, places[12]!.top)
        XCTAssertEqual(seams[1].bottom - seams[1].top, MarkdownPreview.gapHeight, accuracy: 0.001)
    }

    func testTheTailRunsToTheBottomOfThePage() {
        // Everything under the last cell is one seam — not the eighty-point
        // strip the page used to offer, and not the margin under it either.
        let seams = MarkdownPreview.seams(rows: page, noteLength: 44, pageHeight: 600)
        let places = PreviewLayout.positions(rows: page, spacing: MarkdownPreview.gapHeight,
                                             top: MarkdownPreview.topInset + MarkdownPreview.gapHeight)
        XCTAssertEqual(seams.last?.top, places[30]!.bottom)
        XCTAssertEqual(seams.last?.bottom, 600, "down to the bottom of the window")
    }

    func testANoteTallerThanTheWindowStillHasATailUnderItsLastCell() {
        let seams = MarkdownPreview.seams(rows: page, noteLength: 44, pageHeight: 100)
        XCTAssertEqual(seams.last!.bottom - seams.last!.top, MarkdownPreview.tailHeight,
                       "there is always somewhere under the note to put a cell")
    }

    func testAnEmptyNoteIsOneSeamOverTheWholePage() {
        let seams = MarkdownPreview.seams(rows: [], noteLength: 0, pageHeight: 600)
        XCTAssertEqual(seams, [CellSeams.Seam(top: 0, bottom: 600, offset: 0)])
    }

    func testNoPointInsideACellIsInsideASeam() {
        let seams = MarkdownPreview.seams(rows: page, noteLength: 44, pageHeight: 600)
        let places = PreviewLayout.positions(rows: page, spacing: MarkdownPreview.gapHeight,
                                             top: MarkdownPreview.topInset + MarkdownPreview.gapHeight)
        for place in places.values {
            for y in stride(from: place.top + 0.5, to: place.bottom, by: 0.5) {
                XCTAssertNil(CellSeams.seam(at: y, in: seams), "\(y) is inside a cell")
            }
        }
    }

    func testTheTwoPanesOpenTheSameCellsAtTheSameOffsets() {
        // The point of the whole step: he switches between the two sides,
        // and a seam has to mean the same thing on both.
        let note = "# Title\n\nBody\n\n- one\n- two"
        let blocks = MarkdownParser.positioned(from: note)
        let rows = self.rows(blocks.map { _ in 30 }, from: blocks.map(\.range.location))
        let rendered = MarkdownPreview.seams(rows: rows, noteLength: (note as NSString).length,
                                             pageHeight: 600)

        let view = NSTextView(frame: NSRect(x: 0, y: 0, width: 400, height: 800))
        view.font = MarkdownTextView.font
        view.string = note
        let source = MarkdownTextView.seams(in: view)
        XCTAssertEqual(rendered.map(\.offset), source.map(\.offset))
    }
}

/// What a key pressed in an armed seam means, and what it does to the note
/// (Sean, 2026-09-20: "typing from here would insert a new cell below that
/// line"). The awkward part is everything that must do NOTHING.
final class PreviewSeamKeyTests: XCTestCase {
    func testAPrintableCharacterOpensACellAndGoesIntoIt() {
        XCTAssertEqual(MarkdownPreview.seamKey(characters: "x", modifiers: []), .write("x"))
        XCTAssertEqual(MarkdownPreview.seamKey(characters: "X", modifiers: .shift), .write("X"))
        XCTAssertEqual(MarkdownPreview.seamKey(characters: " ", modifiers: []), .write(" "))
        XCTAssertEqual(MarkdownPreview.seamKey(characters: "#", modifiers: .shift), .write("#"))
    }

    func testReturnOpensAnEmptyOneAndEscapeTakesTheBarBack() {
        XCTAssertEqual(MarkdownPreview.seamKey(characters: "\r", modifiers: []), .empty)
        XCTAssertEqual(MarkdownPreview.seamKey(characters: "\u{1B}", modifiers: []), .disarm)
    }

    func testAShortcutIsNotTyping() {
        // ⌘S is not an S, and ⌃D splits a cell.
        XCTAssertEqual(MarkdownPreview.seamKey(characters: "s", modifiers: .command), .pass)
        XCTAssertEqual(MarkdownPreview.seamKey(characters: "d", modifiers: .control), .pass)
    }

    func testAnArrowOrADeleteIsNotACharacterEither() {
        // AppKit hands the function keys over as characters in Unicode's
        // private use area, so "not a control character" is not enough.
        XCTAssertEqual(MarkdownPreview.seamKey(characters: "\u{F701}", modifiers: []), .pass,
                       "the down arrow")
        XCTAssertEqual(MarkdownPreview.seamKey(characters: "\u{7F}", modifiers: []), .pass, "delete")
        XCTAssertEqual(MarkdownPreview.seamKey(characters: "\t", modifiers: []), .pass)
        XCTAssertEqual(MarkdownPreview.seamKey(characters: "", modifiers: []), .pass)
    }

    // MARK: - What reaches the note

    func testTypingInTheSeamBetweenTwoCellsMakesTheCharacterACellOfItsOwn() {
        let opened = MarkdownPreview.opened(.write("x"), at: 12, in: "First cell\n\nSecond cell")
        XCTAssertEqual(opened?.markdown, "First cell\n\nx\n\nSecond cell")
        XCTAssertEqual(opened?.editing, NSRange(location: 12, length: 1))
        XCTAssertEqual(opened?.draft, "x")
        XCTAssertEqual(MarkdownParser.blocks(from: opened!.markdown),
                       [.paragraph("First cell"), .paragraph("x"), .paragraph("Second cell")])
    }

    func testTypingAboveTheFirstCellAndUnderTheLast() {
        XCTAssertEqual(MarkdownPreview.opened(.write("x"), at: 0, in: "First cell\n\nSecond cell")?.markdown,
                       "x\n\nFirst cell\n\nSecond cell")
        XCTAssertEqual(MarkdownPreview.opened(.write("x"), at: 10, in: "Only cell\n")?.markdown,
                       "Only cell\n\nx")
        XCTAssertEqual(MarkdownPreview.opened(.write("x"), at: 9, in: "Only cell")?.markdown,
                       "Only cell\n\nx")
        XCTAssertEqual(MarkdownPreview.opened(.write("x"), at: 0, in: "")?.markdown, "x")
    }

    func testTypingBesideARunOfEmptyLinesLeavesEveryOneOfThem() {
        // Those lines are the note's content, not spacing (Sean,
        // 2026-09-20: "one with 8 empty lines").
        let note = "baz\n" + String(repeating: "\n", count: 10) + "# asdf"
        let opened = MarkdownPreview.opened(.write("x"), at: 5, in: note)
        XCTAssertEqual(MarkdownParser.blocks(from: opened!.markdown),
                       [.paragraph("baz"), .paragraph("x"), .blank(lines: 8),
                        .heading(level: 1, text: "asdf")])
    }

    func testReturnOpensAnEmptyCellThereAndNothingIsTypedInIt() {
        let opened = MarkdownPreview.opened(.empty, at: 12, in: "First cell\n\nSecond cell")
        XCTAssertEqual(opened?.markdown, "First cell\n\n\n\nSecond cell")
        XCTAssertEqual(opened?.editing, NSRange(location: 12, length: 0))
        XCTAssertEqual(opened?.draft, "")
    }

    func testOneCharacterInASeamAddsExactlyThatOneCellThere() {
        // The invariant, over several notes and every seam of each: one
        // more cell, a paragraph holding what was typed, at the seam's own
        // index — the same check the markdown pane's opening passes.
        let notes = ["",
                     "First cell\n\nSecond cell",
                     "# Title\n\nBody\n\n- one\n- two",
                     "baz\n" + String(repeating: "\n", count: 10) + "# asdf",
                     "Only cell",
                     "Only cell\n"]
        for note in notes {
            let before = MarkdownParser.blocks(from: note)
            let blocks = MarkdownParser.positioned(from: note)
            let rows = blocks.map { (id: $0.range.location, height: CGFloat(30)) }
            let seams = MarkdownPreview.seams(rows: rows, noteLength: (note as NSString).length,
                                              pageHeight: 600)
            XCTAssertEqual(seams.count, before.count + 1, "a seam above each cell and one under the last")
            for (index, seam) in seams.enumerated() {
                guard let opened = MarkdownPreview.opened(.write("x"), at: seam.offset, in: note) else {
                    return XCTFail("a character writes")
                }
                var wanted = before
                wanted.insert(.paragraph("x"), at: index)
                XCTAssertEqual(MarkdownParser.blocks(from: opened.markdown), wanted,
                               "seam \(index) of \(note.debugDescription)")
            }
        }
    }

    func testArmingASeamAndThenDisarmingLeavesTheNoteExactlyAsItWas() {
        // Clicking about the page must leave no empty cells behind, so
        // arming writes nothing and every key that only takes the bar back
        // writes nothing either — the markdown is byte for byte the same.
        let note = "First cell\n\nSecond cell"
        let leaving: [(String, EventModifiers)] = [("\u{1B}", []), ("\u{F701}", []), ("\u{F700}", []),
                                                   ("\u{7F}", []), ("\t", []), ("s", .command)]
        for (characters, modifiers) in leaving {
            let key = MarkdownPreview.seamKey(characters: characters, modifiers: modifiers)
            XCTAssertNil(MarkdownPreview.opened(key, at: 12, in: note),
                         "\(characters.debugDescription) writes nothing")
        }
    }
}
