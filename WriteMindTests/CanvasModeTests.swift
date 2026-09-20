import AppKit
import XCTest
@testable import WriteMind

/// Three modes over one pane, and only one of them is the notebook's (Sean,
/// 2026-09-20: "the pen button section should allow choosing between pen
/// mode, cursor mode, and pointer select mode… pen and pointer select mode
/// operate in the same space… the cursor interacts with the notebook").
@MainActor
final class CanvasModeTests: XCTestCase {
    private var suite: String!

    override func setUp() {
        super.setUp()
        suite = "WriteMindTests-\(UUID().uuidString)"
    }

    override func tearDown() {
        UserDefaults.standard.removePersistentDomain(forName: suite)
        super.tearDown()
    }

    private func state() -> AppState { AppState(defaults: UserDefaults(suiteName: suite)!) }

    func testCursorModeIsTheOnlyOneThatLetsTheNotebookHaveThePane() {
        let app = state()
        XCTAssertEqual(app.canvasMode, .cursor, "a pane with no tool picked is the notebook's")
        XCTAssertFalse(app.canvasOwnsPane)
        XCTAssertFalse(app.penActive)

        app.canvasMode = .pen
        XCTAssertTrue(app.canvasOwnsPane)
        XCTAssertTrue(app.penActive, "the pen is the mode now, not a flag beside it")

        app.canvasMode = .select
        XCTAssertTrue(app.canvasOwnsPane, "no click reaches the text while the marquee is the mode")
        XCTAssertFalse(app.penActive)

        app.canvasMode = .cursor
        XCTAssertFalse(app.canvasOwnsPane)
    }

    func testTheOneGestureToolsTakeThePaneWithoutBeingModes() {
        let app = state()
        app.connectActive = true
        XCTAssertTrue(app.canvasOwnsPane, "the arrow tool has the pane for its one drag")
        XCTAssertEqual(app.canvasMode, .cursor, "and it is not a mode: the mode is still the cursor")

        app.connectActive = false
        app.placing = .shape(.oval)
        XCTAssertTrue(app.canvasOwnsPane)
        XCTAssertEqual(app.canvasMode, .cursor)
    }

    func testPickingAModePutsDownWhateverToolWasHeld() {
        let app = state()
        app.connectActive = true
        app.canvasMode = .pen
        XCTAssertFalse(app.connectActive, "one answer to what a drag does, not two")

        app.placing = .shape(.oval)
        XCTAssertEqual(app.canvasMode, .cursor, "arming a shape puts the pen down, as it always did")
        app.canvasMode = .select
        XCTAssertNil(app.placing, "and picking a mode puts the armed shape away")
    }

    func testTheModeIsRememberedTheWayThePensSizeIs() {
        let first = state()
        first.canvasMode = .select
        XCTAssertEqual(state().canvasMode, .select, "a launch comes up where it was left")

        first.canvasMode = .cursor
        XCTAssertEqual(state().canvasMode, .cursor)
    }

    /// The part that has cost four rounds of Sean's time: whose cursor it is.
    /// Nil is not "no cursor" — it is "the notebook's", which has four of its
    /// own (the bar between two cells, the hand over the + and over the
    /// brackets, the I-beam over the words) and is not ours to overwrite.
    func testTheCursorFollowsTheModeAndIsHandedBack() {
        let app = state()
        XCTAssertNil(app.paneCursor)

        app.canvasMode = .pen
        XCTAssertTrue(app.paneCursor === DrawingCursors.pencil)

        app.canvasMode = .select
        XCTAssertTrue(app.paneCursor === NSCursor.crosshair)

        app.canvasMode = .cursor
        XCTAssertNil(app.paneCursor, "a mode switch leaves no cursor behind it")

        app.connectActive = true
        XCTAssertTrue(app.paneCursor === NSCursor.crosshair)
        app.connectActive = false
        app.placing = .shape(.oval)
        XCTAssertTrue(app.paneCursor === NSCursor.crosshair)
        app.placing = nil
        XCTAssertNil(app.paneCursor)
    }

    /// A symbol that does not exist draws as nothing at all, and the button
    /// or the footer label is then a blank space that means something.
    func testEveryModeHasAWordAndASymbolThatExists() {
        for mode in AppState.CanvasMode.allCases {
            XCTAssertFalse(mode.title.isEmpty)
            XCTAssertFalse(mode.help.isEmpty)
            XCTAssertNotNil(NSImage(systemSymbolName: mode.icon, accessibilityDescription: nil),
                            "\(mode.rawValue) is drawn with \(mode.icon)")
        }
    }
}

/// What the rectangle takes. Select mode is this marquee promoted to a mode,
/// so what it selects is the one rule underneath both it and ⌘-drag.
final class CanvasMarqueeTests: XCTestCase {
    private let pane = CGSize(width: 1000, height: 200)

    private func line(from: CGPoint, to: CGPoint) -> CanvasItem {
        .stroke(Stroke(colorHex: "#2D7DD2", width: 3, points: [from, to]))
    }

    func testTheMarqueeTakesEverythingItTouchesAndNothingElse() {
        let crossed = line(from: CGPoint(x: 0.1, y: 0.5), to: CGPoint(x: 0.9, y: 0.5))
        let inside = line(from: CGPoint(x: 0.47, y: 0.45), to: CGPoint(x: 0.49, y: 0.55))
        let elsewhere = line(from: CGPoint(x: 0.1, y: 0.1), to: CGPoint(x: 0.2, y: 0.1))
        let drawing = Drawing(items: [crossed, inside, elsewhere])

        // A small box in the middle of the pane: it cuts the long stroke
        // rather than holding it, which is enough (Sean, 2026-09-18: "if
        // it's in the selection rectangle, it's included, the whole drawing
        // doesn't need to be highlighted").
        let taken = drawing.ids(touching: CGRect(x: 460, y: 80, width: 40, height: 40), in: pane)
        XCTAssertEqual(taken, [crossed.id, inside.id])
    }

    func testAHiddenPictureIsNotSweptUpByTheRectangle() {
        // A picture read into words is put away, not thrown away — it cannot
        // be clicked and is not drawn, so a rectangle dragged over the empty
        // space where it used to be must not hand it to ⌫ either.
        let put = CanvasItem.image(ImageItem(file: "a.png", center: CGPoint(x: 0.5, y: 0.5),
                                             width: 0.4, hidden: true))
        let drawing = Drawing(items: [put])
        XCTAssertTrue(drawing.ids(touching: CGRect(x: 0, y: 0, width: 1000, height: 200), in: pane).isEmpty)
    }
}
