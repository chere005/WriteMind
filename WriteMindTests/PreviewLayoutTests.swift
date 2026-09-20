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
