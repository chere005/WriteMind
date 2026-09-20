import XCTest
@testable import WriteMind

/// The preview's blocks step over a picture the same way the editor's text
/// does (Sean, 2026-09-19: "cells are not obeying the placement below or
/// above images / text grabs rules").
final class PreviewLayoutTests: XCTestCase {
    private func rows(_ heights: [CGFloat]) -> [(id: Int, height: CGFloat)] {
        heights.enumerated().map { ($0.offset, $0.element) }
    }

    func testWithNoPicturesNothingMoves() {
        XCTAssertTrue(PreviewLayout.padding(rows: rows([20, 20, 20]), spacing: 0, top: 0, bands: []).isEmpty)
    }

    func testTheBlockThatWouldStraddleAPictureGoesUnderIt() {
        // Blocks of 20 from y=0; a picture over 30…80.
        let band = CGRect(x: 0, y: 30, width: 100, height: 50)
        let pushes = PreviewLayout.padding(rows: rows([20, 20, 20, 20, 20]), spacing: 0, top: 0,
                                           bands: [band])
        XCTAssertNil(pushes[0], "0…20 is above it")
        // 20…40 straddles the band's top (30 - the 6pt margin = 24).
        let push = try? XCTUnwrap(pushes[1])
        XCTAssertNotNil(push)
        XCTAssertEqual(push ?? 0, 66, accuracy: 0.001, "down to the band's bottom plus its margin")
        XCTAssertNil(pushes[2], "everything after it is carried along by the one push")
    }

    func testABlockThatSitsCompletelyAboveOrBelowIsLeftAlone() {
        let band = CGRect(x: 0, y: 200, width: 100, height: 40)
        let pushes = PreviewLayout.padding(rows: rows([20, 20]), spacing: 0, top: 0, bands: [band])
        XCTAssertTrue(pushes.isEmpty, "both are well above it")
    }

    func testTwoPicturesInARowArePassedOneAfterTheOther() {
        let first = CGRect(x: 0, y: 30, width: 100, height: 40)    // 24…76 with margins
        let second = CGRect(x: 0, y: 80, width: 100, height: 40)   // 74…126
        let pushes = PreviewLayout.padding(rows: rows([20, 20]), spacing: 0, top: 0,
                                           bands: [first, second])
        XCTAssertEqual(pushes[1] ?? 0, 106, accuracy: 0.001, "past both, not just the first")
    }

    func testTheTopInsetAndTheSpacingAreCountedIn() {
        let band = CGRect(x: 0, y: 100, width: 100, height: 20)
        let withInset = PreviewLayout.padding(rows: rows([20, 20, 20]), spacing: 10, top: 50,
                                              bands: [band])
        // y: 50…70, then 80…100 (straddles 94…126), then on.
        XCTAssertNil(withInset[0])
        XCTAssertEqual(withInset[1] ?? 0, 46, accuracy: 0.001)
    }

    func testAPictureAboveEverythingPushesTheWholeNoteDown() {
        let band = CGRect(x: 0, y: 0, width: 100, height: 60)
        let pushes = PreviewLayout.padding(rows: rows([20, 20]), spacing: 0, top: 0, bands: [band])
        XCTAssertEqual(pushes[0] ?? 0, 66, accuracy: 0.001)
        XCTAssertNil(pushes[1], "the second is carried by the first")
    }
}

/// Where the rendered page puts each cell, and where its bracket goes.
final class CellBracketTests: XCTestCase {
    private func rows(_ heights: [CGFloat]) -> [(id: Int, height: CGFloat)] {
        heights.enumerated().map { ($0.offset, $0.element) }
    }

    func testEveryCellGetsItsPlaceInOrder() {
        let places = PreviewLayout.positions(rows: rows([20, 30, 10]), spacing: 4, top: 10, bands: [])
        XCTAssertEqual(places[0]?.top, 10)
        XCTAssertEqual(places[0]?.bottom, 30)
        XCTAssertEqual(places[1]?.top, 34)
        XCTAssertEqual(places[1]?.bottom, 64)
        XCTAssertEqual(places[2]?.top, 68)
    }

    func testAPictureMovesTheCellsBelowItAndTheirBracketsWithThem() {
        let band = CGRect(x: 0, y: 20, width: 100, height: 40)
        let places = PreviewLayout.positions(rows: rows([20, 20]), spacing: 0, top: 0, bands: [band])
        // 0…20 straddles the band's top (20 − the 6pt margin = 14), so it
        // goes under it, and the one after follows.
        XCTAssertEqual(places[0]?.top ?? -1, 66, accuracy: 0.001)
        XCTAssertEqual(places[1]?.top ?? 0, 86, accuracy: 0.001)
    }

    func testABracketIsHitOnItsOwnLineAndNotOnTheNext() {
        let outer = CellBrackets.Bracket(key: "Title", depth: 0, top: 0, bottom: 100,
                                         foldable: true, range: NSRange(location: 0, length: 10))
        let inner = CellBrackets.Bracket(key: "cell:1", depth: 1, top: 10, bottom: 40,
                                         range: NSRange(location: 0, length: 4))
        let width = CellBrackets.width
        let outerX = CellBrackets.x(for: 0, in: width)
        let innerX = CellBrackets.x(for: 1, in: width)
        XCTAssertNotEqual(outerX, innerX, "a group is drawn further out than its cells")
        XCTAssertEqual(CellBrackets.bracket(at: CGPoint(x: outerX, y: 50), in: [outer, inner],
                                            width: width)?.key, "Title")
        XCTAssertEqual(CellBrackets.bracket(at: CGPoint(x: innerX, y: 20), in: [outer, inner],
                                            width: width)?.key, "cell:1")
        XCTAssertNil(CellBrackets.bracket(at: CGPoint(x: 0, y: 20), in: [outer, inner], width: width),
                     "the middle of the gutter is not a bracket")
        XCTAssertNil(CellBrackets.bracket(at: CGPoint(x: innerX, y: 90), in: [inner], width: width),
                     "below the cell is not the cell")
    }
}
