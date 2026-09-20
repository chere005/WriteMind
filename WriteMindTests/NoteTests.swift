import XCTest
@testable import WriteMind

final class NoteTests: XCTestCase {
    private let url = URL(fileURLWithPath: "/tmp/WriteMindTests/Ideas for spring.md")

    func testTitleComesFromTheFirstHeading() {
        let note = Note.make(url: url, modified: .now, contents: "\n\n## Garden plan\nbeds\nseeds\nthird")
        XCTAssertEqual(note.title, "Garden plan")
        XCTAssertEqual(note.snippet, "beds · seeds")
        XCTAssertEqual(note.filename, "Ideas for spring")
    }

    func testTitleFallsBackToTheFileName() {
        let note = Note.make(url: url, modified: .now, contents: "just prose")
        XCTAssertEqual(note.title, "Ideas for spring")
        XCTAssertEqual(note.snippet, "just prose")
    }

    func testSnippetDropsInlineMarkup() {
        let note = Note.make(url: url, modified: .now, contents: "# T\n- **bold** and <u>under</u> `code`\n> quoted")
        XCTAssertEqual(note.snippet, "bold and under code · quoted")
    }

    func testSnippetDropsHeadingHashesFromLaterHeadings() {
        let note = Note.make(url: url, modified: .now, contents: "# T\n###### Sean Cheren\n## Next")
        XCTAssertEqual(note.snippet, "Sean Cheren · Next")
    }

    func testEmptyHeadingFallsBackToTheFileName() {
        XCTAssertEqual(Note.make(url: url, modified: .now, contents: "#\n").title, "Ideas for spring")
    }
}
