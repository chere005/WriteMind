import XCTest
@testable import WriteMind

/// Editing a checklist one item at a time (Sean, 2026-09-21: "when
/// modifying a checklist.. the checkboxes remain in tact and just the text
/// part of the list becomes editable, one at a time").
final class ListEditingTests: XCTestCase {
    private let list = "- [x] done\n- [ ] not yet\n- [ ] nor this"

    private func reminders(_ markdown: String) -> [Reminder] {
        let text = markdown as NSString
        return ListEditing.reminders(in: NSRange(location: 0, length: text.length), of: text)
    }

    private func words(_ markdown: String) -> [String] {
        let text = markdown as NSString
        return reminders(markdown).map { text.substring(with: $0.text) }
    }

    // MARK: - Where the words are

    func testEveryItemsWordsAreFoundWithoutItsBox() {
        XCTAssertEqual(words(list), ["done", "not yet", "nor this"])
        XCTAssertEqual(reminders(list).map(\.ticked), [true, false, false])
    }

    func testTheBoxIsTheCharacterATickReplaces() {
        let text = list as NSString
        for reminder in reminders(list) {
            let box = text.substring(with: NSRange(location: reminder.box, length: 1))
            XCTAssertEqual(box, reminder.ticked ? "x" : " ")
        }
    }

    func testAnEmptyItemHasAnEmptyRangeWhereItsWordsWouldGo() {
        let one = reminders("- [ ] ")
        XCTAssertEqual(one.count, 1)
        XCTAssertEqual(one.first?.text.length, 0)
        XCTAssertEqual(one.first?.text.location, 6)
        // And one with no space after the box at all.
        XCTAssertEqual(reminders("- [ ]").first?.text.length, 0)
    }

    func testAnIndentedItemKeepsItsIndentOutOfTheWords() {
        XCTAssertEqual(words("    - [ ] nested"), ["nested"])
        XCTAssertEqual(reminders("    - [ ] nested").first?.text.location, 10)
    }

    func testLinesThatAreNotRemindersAreNotCounted() {
        // The tick counts task LINES; so does this, or the third item on
        // screen would not be the third item in the note.
        XCTAssertEqual(words("- [ ] one\njust words\n- [x] two"), ["one", "two"])
        XCTAssertTrue(reminders("- a bullet\n> a quote\nwords").isEmpty)
    }

    func testAnItemIsFoundAgainByTheRangeOfItsWords() {
        let text = list as NSString
        let second = reminders(list)[1]
        XCTAssertEqual(ListEditing.reminder(forText: second.text, in: text), second)
        // A range that is not an item's words is not one.
        XCTAssertNil(ListEditing.reminder(forText: NSRange(location: second.text.location + 1,
                                                           length: 3), in: text))
    }

    // MARK: - Return

    func testReturnAtTheEndOfAnItemMakesTheNextOne() {
        let item = reminders(list)[0].text
        let split = ListEditing.split(list, item: item, head: "done", tail: "")
        XCTAssertEqual(split?.markdown, "- [x] done\n- [ ] \n- [ ] not yet\n- [ ] nor this")
        // The new one is open, empty, and NOT ticked however the one it
        // came from was.
        XCTAssertEqual(split?.editing.length, 0)
        XCTAssertEqual(words(split!.markdown), ["done", "", "not yet", "nor this"])
        XCTAssertEqual(reminders(split!.markdown).map(\.ticked), [true, false, false, false])
    }

    func testReturnInTheMiddleCutsTheWordsInTwo() {
        let item = reminders(list)[1].text
        let split = ListEditing.split(list, item: item, head: "not", tail: " yet")
        XCTAssertEqual(words(split!.markdown), ["done", "not", " yet", "nor this"])
        let text = split!.markdown as NSString
        XCTAssertEqual(text.substring(with: split!.editing), " yet",
                       "the half that moved is the half that is open")
    }

    func testReturnKeepsTheMarkerTheListIsWrittenWith() {
        let starred = "* [ ] one"
        let split = ListEditing.split(starred, item: reminders(starred)[0].text, head: "one", tail: "")
        XCTAssertEqual(split?.markdown, "* [ ] one\n* [ ] ")
        let nested = "    - [x] one"
        let deep = ListEditing.split(nested, item: reminders(nested)[0].text, head: "one", tail: "")
        XCTAssertEqual(deep?.markdown, "    - [x] one\n    - [ ] ", "and the indentation")
    }

    // MARK: - Backspace

    func testBackspaceInAnEmptyItemTakesItAway() {
        let note = "- [ ] one\n- [ ] \n- [ ] three"
        let empty = reminders(note)[1].text
        let gone = ListEditing.removeEmpty(note, item: empty)
        XCTAssertEqual(gone?.markdown, "- [ ] one\n- [ ] three")
        // And the one above it is open, at its end.
        XCTAssertEqual(gone?.editing, NSRange(location: 9, length: 0))
        XCTAssertEqual((gone!.markdown as NSString).substring(to: 9), "- [ ] one")
    }

    func testBackspaceInTheFirstItemOfAListHasNothingToGoBackTo() {
        let note = "- [ ] \n- [ ] two"
        let gone = ListEditing.removeEmpty(note, item: reminders(note)[0].text)
        XCTAssertEqual(gone?.markdown, "- [ ] two")
        XCTAssertNil(gone?.editing ?? nil, "the caller takes the cell away instead")
    }

    func testBackspaceAtTheStartOfWordsJoinsThemToTheItemAbove() {
        let note = "- [ ] one\n- [ ] two"
        let second = reminders(note)[1].text
        let joined = ListEditing.joinPrevious(note, item: NSRange(location: second.location, length: 3))
        XCTAssertEqual(joined?.markdown, "- [ ] onetwo")
        XCTAssertEqual(joined?.editing, NSRange(location: 9, length: 0), "the caret sits at the seam")
        XCTAssertEqual(words(joined!.markdown), ["onetwo"])
    }

    func testThereIsNothingToJoinToAtTheTopOfAList() {
        let note = "- [ ] one\n- [ ] two"
        XCTAssertNil(ListEditing.joinPrevious(note, item: reminders(note)[0].text))
        // Nor when the line above is not a reminder at all.
        let mixed = "Some prose\n\n- [ ] one"
        XCTAssertNil(ListEditing.joinPrevious(mixed, item: reminders(mixed)[0].text))
    }

    // MARK: - One walk

    /// The tick and the edit have to agree about which reminder is which.
    /// They counted indentation two different ways before this.
    func testTheTickAndTheWalkAgreeAboutEveryItem() {
        for note in [list, "    - [ ] a\n    - [x] b", "- [ ] a\nnot one\n- [ ] b", "* [x] a\n+ [ ] b"] {
            let text = note as NSString
            let found = ListEditing.reminders(in: NSRange(location: 0, length: text.length), of: text)
            for (index, reminder) in found.enumerated() {
                guard let edit = MarkdownFormatting.toggleTodo(
                    text: note, block: NSRange(location: 0, length: text.length), item: index)
                else { return XCTFail("no tick for item \(index) of \(note.debugDescription)") }
                XCTAssertEqual(edit.range, NSRange(location: reminder.box, length: 1),
                               "item \(index) of \(note.debugDescription)")
            }
        }
    }

    /// A tick replaces exactly one character with exactly one character,
    /// which is the only reason a box can be ticked while an item beside
    /// it is open for typing without moving anything underneath it.
    func testATickIsAlwaysOneCharacterForOne() {
        let text = list as NSString
        for index in 0..<3 {
            let edit = MarkdownFormatting.toggleTodo(text: list,
                                                     block: NSRange(location: 0, length: text.length),
                                                     item: index)
            XCTAssertEqual(edit?.range.length, 1)
            XCTAssertEqual(edit?.replacement.count, 1)
        }
    }
}
