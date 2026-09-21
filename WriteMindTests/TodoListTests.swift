import XCTest
@testable import WriteMind

/// The fourth kind of bullet: a box you can tick (Sean, 2026-09-21: "add a
/// bullet type which are todo bullets that can be checked or unchecked").
final class TodoListTests: XCTestCase {
    // MARK: - Reading one

    func testAnUntickedBoxIsATaskThatIsNotDone() throws {
        let item = try XCTUnwrap(MarkdownParser.todoItem("- [ ] milk"))
        XCTAssertEqual(item.text, "milk")
        XCTAssertFalse(item.done)
    }

    func testATickedBoxIsDone() throws {
        XCTAssertEqual(MarkdownParser.todoItem("- [x] milk")?.done, true)
        XCTAssertEqual(MarkdownParser.todoItem("- [X] milk")?.done, true,
                       "other editors write it either way round")
    }

    func testAStarOrAPlusCarriesABoxToo() {
        XCTAssertEqual(MarkdownParser.todoItem("* [ ] a")?.text, "a")
        XCTAssertEqual(MarkdownParser.todoItem("+ [x] a")?.text, "a")
    }

    func testAnEmptyTaskIsATaskWithNothingInIt() throws {
        let item = try XCTUnwrap(MarkdownParser.todoItem("- [ ] "))
        XCTAssertEqual(item.text, "")
    }

    func testSomethingThatOnlyLooksLikeABoxIsNot() {
        XCTAssertNil(MarkdownParser.todoItem("- [] milk"), "no room for a mark in it")
        XCTAssertNil(MarkdownParser.todoItem("- [?] milk"), "only a space or an x")
        XCTAssertNil(MarkdownParser.todoItem("- [x]milk"), "the box needs its space after it")
        XCTAssertNil(MarkdownParser.todoItem("[ ] milk"), "no bullet at all")
        XCTAssertNil(MarkdownParser.todoItem("- milk"))
    }

    // MARK: - Reading a list of them

    func testATaskListIsItsOwnCellAndNotAListOfBullets() {
        let blocks = MarkdownParser.blocks(from: "- [ ] milk\n- [x] eggs")
        XCTAssertEqual(blocks, [.todos([TodoItem(text: "milk", done: false),
                                        TodoItem(text: "eggs", done: true)])])
    }

    func testAPlainBulletListIsStillBullets() {
        XCTAssertEqual(MarkdownParser.blocks(from: "- milk\n- eggs"), [.bullets(["milk", "eggs"])])
    }

    func testTasksAndBulletsSideBySideAreTwoCells() {
        let blocks = MarkdownParser.blocks(from: "- milk\n- [ ] eggs")
        XCTAssertEqual(blocks.count, 2, "got \(blocks)")
        XCTAssertEqual(blocks.first, .bullets(["milk"]))
        XCTAssertEqual(blocks.last, .todos([TodoItem(text: "eggs", done: false)]))
    }

    // MARK: - Writing one

    func testTheButtonWritesAnUntickedBox() {
        let text = "milk\neggs"
        let edit = MarkdownFormatting.toggleList(text: text, selection: NSRange(location: 0, length: 9),
                                                 style: .todo)
        XCTAssertEqual((text as NSString).replacingCharacters(in: edit.range, with: edit.replacement),
                       "- [ ] milk\n- [ ] eggs")
    }

    func testPressingItAgainTakesTheBoxesAway() {
        let text = "- [ ] milk\n- [x] eggs"
        let edit = MarkdownFormatting.toggleList(text: text, selection: NSRange(location: 0, length: 21),
                                                 style: .todo)
        XCTAssertEqual((text as NSString).replacingCharacters(in: edit.range, with: edit.replacement),
                       "milk\neggs")
    }

    func testTurningATaskListIntoBulletsLeavesNoBoxBehind() {
        // The box goes with the dash, or "- [ ] milk" became "- [ ] milk"
        // with a second marker in front of it.
        let text = "- [x] milk"
        let edit = MarkdownFormatting.toggleList(text: text, selection: NSRange(location: 0, length: 10),
                                                 style: .dots)
        XCTAssertEqual((text as NSString).replacingCharacters(in: edit.range, with: edit.replacement),
                       "- milk")
    }

    // MARK: - Ticking one

    func testTickingTheSecondBoxTouchesOnlyThatBox() throws {
        let note = "- [ ] milk\n- [ ] eggs"
        let edit = try XCTUnwrap(MarkdownFormatting.toggleTodo(text: note,
                                                               block: NSRange(location: 0, length: 21),
                                                               item: 1))
        XCTAssertEqual((note as NSString).replacingCharacters(in: edit.range, with: edit.replacement),
                       "- [ ] milk\n- [x] eggs")
    }

    func testTickingATickedBoxUnticksIt() throws {
        let note = "- [x] milk"
        let edit = try XCTUnwrap(MarkdownFormatting.toggleTodo(text: note,
                                                               block: NSRange(location: 0, length: 10),
                                                               item: 0))
        XCTAssertEqual((note as NSString).replacingCharacters(in: edit.range, with: edit.replacement),
                       "- [ ] milk")
    }

    func testTickingKeepsTheIndentationAndTheMarkerItWasWrittenWith() throws {
        let note = "  * [ ] milk"
        let edit = try XCTUnwrap(MarkdownFormatting.toggleTodo(text: note,
                                                               block: NSRange(location: 0, length: 12),
                                                               item: 0))
        XCTAssertEqual((note as NSString).replacingCharacters(in: edit.range, with: edit.replacement),
                       "  * [x] milk")
    }

    func testTickingAnItemThatIsNoLongerThereDoesNothing() {
        XCTAssertNil(MarkdownFormatting.toggleTodo(text: "- [ ] milk",
                                                   block: NSRange(location: 0, length: 10), item: 3))
        XCTAssertNil(MarkdownFormatting.toggleTodo(text: "just words",
                                                   block: NSRange(location: 0, length: 10), item: 0))
    }

    func testTickingInsideOneCellDoesNotReachTheNext() throws {
        let note = "- [ ] milk\n\n- [ ] eggs"
        let second = NSRange(location: 12, length: 10)
        let edit = try XCTUnwrap(MarkdownFormatting.toggleTodo(text: note, block: second, item: 0))
        XCTAssertEqual((note as NSString).replacingCharacters(in: edit.range, with: edit.replacement),
                       "- [ ] milk\n\n- [x] eggs")
    }

    // MARK: - Return

    func testReturnCarriesTheListOnWithAnEmptyBox() {
        XCTAssertEqual(PreviewEditing.listContinuation(for: "- [x] milk"), "- [ ] ")
        XCTAssertEqual(PreviewEditing.listContinuation(for: "  * [ ] milk"), "  * [ ] ")
    }

    func testReturnOnAnEmptyTaskEndsTheList() {
        XCTAssertEqual(PreviewEditing.listContinuation(for: "- [ ] "), "")
    }
}
