import XCTest
@testable import WriteMind

/// Whether the open note may be written back over its file.
///
/// A note lost two cells on 2026-09-20 while a deploy ran with the app
/// still open on it — the deploy smoke-launches a second copy, so two
/// instances held the same file and the last one to save won.
final class NoteWritingTests: XCTestCase {
    func testAFileNobodyHasTouchedIsOurs() {
        XCTAssertTrue(NoteWriting.mayWrite(onDisk: "hello", known: "hello"))
    }

    func testAFileSomebodyElseHasWrittenIsNot() {
        // The whole of the bug: the bytes are not what we last read, so
        // what we are holding is not an edit of them.
        XCTAssertFalse(NoteWriting.mayWrite(onDisk: "hello there", known: "hello"))
    }

    func testANewNoteSavingItselfTheFirstTimeIsAllowed() {
        XCTAssertTrue(NoteWriting.mayWrite(onDisk: nil, known: nil))
    }

    func testAFileThatHasBeenTrashedIsNotPutBackByAnAutosave() {
        // Deleting is a gesture in the sidebar; a save must not undo one.
        XCTAssertFalse(NoteWriting.mayWrite(onDisk: nil, known: "hello"))
    }

    func testAFileWeHaveNeverReadIsNotOursToOverwrite() {
        XCTAssertFalse(NoteWriting.mayWrite(onDisk: "somebody else's words", known: nil))
    }

    func testAnEmptyFileIsStillAFileWeKnow() {
        XCTAssertTrue(NoteWriting.mayWrite(onDisk: "", known: ""))
        XCTAssertFalse(NoteWriting.mayWrite(onDisk: "", known: "hello"),
                       "emptied by somebody else is exactly the case that lost the cells")
    }
}
