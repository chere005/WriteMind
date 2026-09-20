import AppKit
import XCTest
@testable import WriteMind

/// The drawing layer through the real store: an object that is put on a note
/// has to still be there after the note is saved, closed and opened again.
@MainActor
final class NoteStoreDrawingTests: XCTestCase {
    private var dir: URL!
    private var store: NoteStore!

    override func setUp() async throws {
        dir = FileManager.default.temporaryDirectory.appending(path: "WriteMindTests-\(UUID().uuidString)")
        try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        try Data("# Trip\n\nnotes\n".utf8).write(to: dir.appending(path: "Trip.md"))
        store = NoteStore(directory: dir)
    }

    override func tearDown() async throws {
        store = nil
        try? FileManager.default.removeItem(at: dir)
    }

    private var sidecar: URL { DrawingStore.url(for: dir.appending(path: "Trip.md"), in: dir) }

    /// The capture button is disabled while a capture runs; a capture that
    /// finds nothing still has to hand the button back.
    func testTheCaptureButtonComesBackAfterACaptureThatFindsNothing() async throws {
        XCTAssertNotNil(store.selectedNote)
        let blank = CIImage(color: CIColor(red: 0.5, green: 0.5, blue: 0.5))
            .cropped(to: CGRect(x: 0, y: 0, width: 640, height: 480))
        store.captureNotebook(frame: blank, quarterTurns: 0, colour: .black, mode: .page)
        XCTAssertTrue(store.isCapturing)
        for _ in 0..<400 where store.isCapturing { try await Task.sleep(nanoseconds: 50_000_000) }
        XCTAssertFalse(store.isCapturing, "the capture never came back")
        XCTAssertNotNil(store.captureNotice)
        XCTAssertEqual(store.drawing.images.count, 0)
    }

    /// ⌘V in the editor with a screenshot on the pasteboard — png and tiff,
    /// no file, the way ⌃⇧⌘4 leaves one — puts it on the layer.
    func testPastingAScreenshotIntoTheEditorPutsItOnTheLayer() throws {
        let pasteboard = NSPasteboard(name: NSPasteboard.Name("WriteMindTests-\(UUID().uuidString)"))
        defer { pasteboard.releaseGlobally() }
        pasteboard.clearContents()
        let rep = try XCTUnwrap(NSBitmapImageRep(bitmapDataPlanes: nil, pixelsWide: 30, pixelsHigh: 20,
                                                 bitsPerSample: 8, samplesPerPixel: 4, hasAlpha: true,
                                                 isPlanar: false, colorSpaceName: .deviceRGB,
                                                 bytesPerRow: 0, bitsPerPixel: 0))
        pasteboard.setData(try XCTUnwrap(rep.representation(using: .png, properties: [:])), forType: .png)
        pasteboard.setData(try XCTUnwrap(rep.tiffRepresentation), forType: .tiff)

        let textView = PasteAwareTextView(usingTextLayoutManager: true)
        textView.pasteboard = pasteboard
        let store = self.store!
        textView.onPasteImage = { store.pasteImage(from: $0) }
        // The Edit menu asks first, and a plain-text view would say no to a
        // pasteboard with no text on it — that "no" is what ate ⌘V.
        let pasteItem = NSMenuItem(title: "Paste", action: #selector(NSText.paste(_:)), keyEquivalent: "v")
        XCTAssertTrue(textView.validateUserInterfaceItem(pasteItem), "Paste must be enabled for a picture")
        textView.paste(nil)

        XCTAssertEqual(store.drawing.images.count, 1)
        let placed = try XCTUnwrap(store.drawing.images.first)
        XCTAssertEqual(placed.aspect, 20.0 / 30.0, accuracy: 0.001)
        XCTAssertNotNil(DrawingStore.loadImage(placed.file, in: dir))
    }

    /// A picture goes just under the caret's line, flush with the text —
    /// and nothing in the note moves for it.
    func testAPictureLandsUnderTheCaretsLine() throws {
        store.canvasSize = CGSize(width: 1000, height: 800)
        store.caretAnchor = { CGRect(x: 30, y: 100, width: 500, height: 20) }
        let rep = try XCTUnwrap(NSBitmapImageRep(bitmapDataPlanes: nil, pixelsWide: 300, pixelsHigh: 150,
                                                 bitsPerSample: 8, samplesPerPixel: 4, hasAlpha: true,
                                                 isPlanar: false, colorSpaceName: .deviceRGB,
                                                 bytesPerRow: 0, bitsPerPixel: 0))
        let image = NSImage(size: NSSize(width: 300, height: 150))
        image.addRepresentation(rep)
        let before = store.text

        XCTAssertTrue(store.addImage(image))
        let placed = try XCTUnwrap(store.drawing.images.first)
        XCTAssertEqual(placed.width * 1000, 300, accuracy: 0.001, "a small picture keeps its size")
        XCTAssertEqual(placed.center.x * 1000, 30 + 150, accuracy: 0.001, "flush with the text")
        // One seam under the line — the same gap that sits between two
        // cells, so the landing and the seam cannot drift apart.
        XCTAssertEqual(placed.center.y * 800, 120 + MarkdownPreview.gapHeight + 75, accuracy: 0.001,
                       "just under the line")
        XCTAssertEqual(store.text, before, "the note is not touched to make room")

        // With no caret to go by, the middle of the pane, as before.
        store.caretAnchor = { nil }
        XCTAssertTrue(store.addImage(image))
        let second = try XCTUnwrap(store.drawing.images.last)
        XCTAssertEqual(second.center.x, 0.5 + 0.03, accuracy: 0.001)
    }

    func testTheCaretsLineIsWhereTheTextViewSaysItIs() {
        let textView = NSTextView(usingTextLayoutManager: false)
        textView.frame = NSRect(x: 0, y: 0, width: 400, height: 300)
        textView.textContainerInset = NSSize(width: 24, height: 20)
        textView.string = "Hello\nWorld"
        let bridge = EditorBridge()
        bridge.textView = textView

        textView.setSelectedRange(NSRange(location: 0, length: 0))
        let first = bridge.caretLineFrame()!
        XCTAssertEqual(first.minY, 20, accuracy: 0.5, "the first line starts at the inset")
        XCTAssertEqual(first.minX, 24 + textView.textContainer!.lineFragmentPadding, accuracy: 0.5)

        textView.setSelectedRange(NSRange(location: 8, length: 0))
        let second = bridge.caretLineFrame()!
        XCTAssertGreaterThan(second.minY, first.maxY - 0.5, "the second line is below the first")
    }

    func testTextReadFromAPictureGoesInUnderIt() {
        let textView = NSTextView(usingTextLayoutManager: false)
        textView.frame = NSRect(x: 0, y: 0, width: 400, height: 300)
        textView.textContainerInset = NSSize(width: 24, height: 20)
        textView.string = "Hello\nWorld"
        let bridge = EditorBridge()
        bridge.textView = textView
        // Setting the string leaves the caret at the END; the first line is
        // wanted here.
        textView.setSelectedRange(NSRange(location: 0, length: 0))
        let firstLine = bridge.caretLineFrame()!

        // A picture whose bottom edge is in the second line's band: the
        // words go in front of "World".
        bridge.insert("READ", belowDocumentY: firstLine.maxY + 2)
        XCTAssertEqual(textView.string, "Hello\nREAD\nWorld")
        XCTAssertEqual(textView.selectedRange().location, ("Hello\nREAD\n" as NSString).length)

        // A picture below everything: the words go on the end, on a line of their own.
        bridge.insert("MORE", belowDocumentY: 5000)
        XCTAssertEqual(textView.string, "Hello\nREAD\nWorld\nMORE\n")
    }

    func testReturnCarriesAListOnAndAnEmptyItemEndsIt() {
        let textView = NSTextView(usingTextLayoutManager: false)
        let bridge = EditorBridge()
        bridge.textView = textView

        textView.string = "- one"
        textView.setSelectedRange(NSRange(location: 5, length: 0))
        XCTAssertTrue(bridge.continueList())
        XCTAssertEqual(textView.string, "- one\n- ")
        XCTAssertEqual(textView.selectedRange().location, 8)

        // Return again on the empty item: the marker goes, the list is over.
        XCTAssertTrue(bridge.continueList())
        XCTAssertEqual(textView.string, "- one\n")

        textView.string = "1. a"
        textView.setSelectedRange(NSRange(location: 4, length: 0))
        XCTAssertTrue(bridge.continueList())
        XCTAssertEqual(textView.string, "1. a\n2. ")

        // Not at the end of the item, or not a list: an ordinary Return.
        textView.string = "- one"
        textView.setSelectedRange(NSRange(location: 2, length: 0))
        XCTAssertFalse(bridge.continueList())
        textView.string = "plain"
        textView.setSelectedRange(NSRange(location: 5, length: 0))
        XCTAssertFalse(bridge.continueList())
    }

    func testOnlyTheDashAtTheHeadOfABulletLineIsABullet() {
        let text = "- one\n  - two\nnot - this\n-no\n" as NSString
        XCTAssertTrue(BulletGlyphs.isBulletMarker(at: 0, in: text))
        XCTAssertTrue(BulletGlyphs.isBulletMarker(at: 8, in: text), "indented")
        XCTAssertFalse(BulletGlyphs.isBulletMarker(at: 18, in: text), "a dash in the middle of a line")
        XCTAssertFalse(BulletGlyphs.isBulletMarker(at: 25, in: text), "no space after it")
        XCTAssertNotEqual(BulletGlyphs.bulletGlyph(in: NSFont.systemFont(ofSize: 15)), 0)
    }

    func testAStrokeSurvivesTheNoteBeingClosedAndOpenedAgain() {
        XCTAssertNotNil(store.selectedNote)
        store.beginDrawingChange()
        store.drawing.items.append(.stroke(Stroke(colorHex: "#2FBF71", width: 3,
                                                  points: [CGPoint(x: 0.2, y: 0.3), CGPoint(x: 0.6, y: 0.7)])))
        store.flushPendingSave()

        XCTAssertTrue(FileManager.default.fileExists(atPath: sidecar.path), "nothing was written to \(sidecar.path)")
        let reopened = NoteStore(directory: dir)
        XCTAssertEqual(reopened.drawing.items.count, 1)
        XCTAssertEqual(reopened.drawing.strokes.first?.colorHex, "#2FBF71")
    }

    func testMovingAnObjectIsKeptAndCanBeUndone() {
        store.beginDrawingChange()
        store.drawing.items.append(.stroke(Stroke(colorHex: "#000000", width: 2, points: [CGPoint(x: 0.5, y: 0.5)])))

        store.beginDrawingChange()
        store.drawing.items[0].transform = ItemTransform(dx: 0.25, dy: -0.1, scale: 2, rotation: 0.5)
        store.flushPendingSave()

        XCTAssertEqual(NoteStore(directory: dir).drawing.items.first?.transform.dx ?? 0, 0.25, accuracy: 0.0001)

        store.undoDrawing()
        XCTAssertEqual(store.drawing.items.first?.transform, .identity)
        XCTAssertTrue(store.canRedoDrawing)
        store.redoDrawing()
        XCTAssertEqual(store.drawing.items.first?.transform.scale ?? 0, 2, accuracy: 0.0001)

        store.undoDrawing()
        store.undoDrawing()
        XCTAssertTrue(store.drawing.isEmpty, "undoing past the first change should leave an empty layer")
    }

    func testAPastedPictureIsCopiedInAndPointedAt() throws {
        // Built from a bitmap of a known PIXEL size: drawing into an NSImage
        // on this machine would hand back a 2x retina rep, and the size a
        // picture lands at is measured in pixels.
        let rep = try XCTUnwrap(NSBitmapImageRep(
            bitmapDataPlanes: nil, pixelsWide: 40, pixelsHigh: 20, bitsPerSample: 8,
            samplesPerPixel: 4, hasAlpha: true, isPlanar: false,
            colorSpaceName: .deviceRGB, bytesPerRow: 0, bitsPerPixel: 0))
        let image = NSImage(size: NSSize(width: 40, height: 20))
        image.addRepresentation(rep)

        store.canvasSize = CGSize(width: 800, height: 600)
        XCTAssertTrue(store.addImage(image))
        store.flushPendingSave()

        let item = try XCTUnwrap(store.drawing.images.first)
        XCTAssertEqual(item.aspect, 0.5, accuracy: 0.01)
        // 40pt wide in an 800pt pane, so a twentieth of it — small pictures
        // are not blown up to fill the page.
        XCTAssertEqual(item.width, 0.05, accuracy: 0.001)
        XCTAssertTrue(FileManager.default.fileExists(atPath: DrawingStore.mediaURL(item.file, in: dir).path))
        XCTAssertEqual(NoteStore(directory: dir).drawing.images.first?.file, item.file)
    }

    func testTheLayerIsEmptiedAndItsFileRemovedWhenTheDrawingIsCleared() {
        store.beginDrawingChange()
        store.drawing.items.append(.stroke(Stroke(colorHex: "#000000", width: 2, points: [.zero])))
        store.flushPendingSave()
        XCTAssertTrue(FileManager.default.fileExists(atPath: sidecar.path))

        store.clearDrawing()
        store.flushPendingSave()
        XCTAssertFalse(FileManager.default.fileExists(atPath: sidecar.path))
        XCTAssertTrue(store.canUndoDrawing)
    }
}

/// ⌘Z while the pen is up steps the DRAWING back, not the text (Sean,
/// 2026-09-19: "add undo when drawing").
@MainActor
final class DrawingUndoTests: XCTestCase {
    private var dir: URL!
    private var store: NoteStore!

    override func setUp() async throws {
        dir = FileManager.default.temporaryDirectory.appending(path: "WriteMindTests-\(UUID().uuidString)")
        try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        try Data("# Trip\n".utf8).write(to: dir.appending(path: "Trip.md"))
        store = NoteStore(directory: dir)
    }

    override func tearDown() async throws {
        store = nil
        try? FileManager.default.removeItem(at: dir)
    }

    private func stroke() -> CanvasItem {
        .stroke(Stroke(colorHex: "#F2542D", width: 3,
                       points: [CGPoint(x: 0.1, y: 0.1), CGPoint(x: 0.4, y: 0.4)]))
    }

    func testAStrokeIsUndoneAndPutBack() {
        XCTAssertFalse(store.canUndoDrawing)
        XCTAssertFalse(store.undoDrawing(), "nothing to undo says so, and the key goes to the text")

        store.beginDrawingChange()
        store.drawing.items.append(stroke())
        XCTAssertTrue(store.canUndoDrawing)
        XCTAssertTrue(store.undoDrawing())
        XCTAssertTrue(store.drawing.items.isEmpty, "the stroke is gone")
        XCTAssertTrue(store.canRedoDrawing)
        XCTAssertTrue(store.redoDrawing())
        XCTAssertEqual(store.drawing.items.count, 1, "and comes back")
    }

    func testEachStrokeIsItsOwnStepBack() {
        for _ in 0..<3 {
            store.beginDrawingChange()
            store.drawing.items.append(stroke())
        }
        XCTAssertEqual(store.drawing.items.count, 3)
        store.undoDrawing()
        XCTAssertEqual(store.drawing.items.count, 2, "one stroke at a time")
        store.undoDrawing()
        store.undoDrawing()
        XCTAssertTrue(store.drawing.items.isEmpty)
        XCTAssertFalse(store.undoDrawing(), "and no further back than the note was opened")
    }

    func testDrawingAgainAfterUndoDropsWhatWasUndone() {
        store.beginDrawingChange()
        store.drawing.items.append(stroke())
        store.undoDrawing()
        XCTAssertTrue(store.canRedoDrawing)
        store.beginDrawingChange()
        store.drawing.items.append(stroke())
        XCTAssertFalse(store.canRedoDrawing, "the branch that was undone is gone")
    }
}

/// Whose ⌘Z it is (Sean, 2026-09-19: "fix undo in drawing mode").
@MainActor
final class UndoOwnershipTests: XCTestCase {
    func testTheDrawingOwnsItWhileThePenIsUp() {
        let state = AppState(defaults: UserDefaults(suiteName: "WriteMindTests-\(UUID().uuidString)")!)
        XCTAssertFalse(state.drawingOwnsUndo, "with nothing going on, ⌘Z is the text's")
        state.canvasMode = .pen
        XCTAssertTrue(state.drawingOwnsUndo)
        state.canvasMode = .cursor
        XCTAssertFalse(state.drawingOwnsUndo)
    }

    func testItAlsoOwnsItWithSomethingPickedOrArmed() {
        let state = AppState(defaults: UserDefaults(suiteName: "WriteMindTests-\(UUID().uuidString)")!)
        state.canvasSelection = true
        XCTAssertTrue(state.drawingOwnsUndo, "something is picked on the layer")
        state.canvasSelection = false
        state.placing = .shape(.oval)
        XCTAssertTrue(state.drawingOwnsUndo, "a shape is waiting to be put down")
        state.placing = nil
        state.connectActive = true
        XCTAssertTrue(state.drawingOwnsUndo, "the arrow tool is on")
    }
}
