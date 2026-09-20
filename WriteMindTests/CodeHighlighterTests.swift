import XCTest
@testable import WriteMind

/// The colouring of fenced code: one scanner, five languages, and the rule
/// that a comment or a string swallows whatever looks like syntax inside it.
final class CodeHighlighterTests: XCTestCase {
    private func run(_ code: String, _ language: CodeLanguage) -> [(CodeToken.Kind, String)] {
        let text = code as NSString
        let tokens = CodeHighlighter.tokens(in: code, language: language)
        // Every run of this suite also checks the shape of the output.
        var previousEnd = 0
        for token in tokens {
            XCTAssertGreaterThanOrEqual(token.range.location, previousEnd, "tokens overlap in: \(code)")
            XCTAssertLessThanOrEqual(NSMaxRange(token.range), text.length, "token past the end in: \(code)")
            previousEnd = NSMaxRange(token.range)
        }
        return tokens.map { ($0.kind, text.substring(with: $0.range)) }
    }

    private func kinds(_ pairs: [(CodeToken.Kind, String)], _ kind: CodeToken.Kind) -> [String] {
        pairs.filter { $0.0 == kind }.map(\.1)
    }

    func testFenceTagsMapToLanguagesCaseInsensitivelyWithAliases() {
        XCTAssertEqual(CodeLanguage.from(fence: "c"), .c)
        XCTAssertEqual(CodeLanguage.from(fence: "C++"), .cpp)
        XCTAssertEqual(CodeLanguage.from(fence: " hpp "), .cpp)
        XCTAssertEqual(CodeLanguage.from(fence: "Mathematica"), .wolfram)
        XCTAssertEqual(CodeLanguage.from(fence: "py"), .python)
        XCTAssertEqual(CodeLanguage.from(fence: "TSX"), .typescript)
        XCTAssertEqual(CodeLanguage.from(fence: "js"), .typescript)
        XCTAssertEqual(CodeLanguage.from(fence: ""), .plain)
        XCTAssertEqual(CodeLanguage.from(fence: nil), .plain)
        XCTAssertNil(CodeLanguage.from(fence: "rust"))
        XCTAssertNil(CodeLanguage.from(fence: "wl"), "wl is this app's maths fence, not a code language")
    }

    func testPlainTextAndEmptyCodeColourNothing() {
        XCTAssertTrue(CodeHighlighter.tokens(in: "anything at all", language: .plain).isEmpty)
        XCTAssertTrue(CodeHighlighter.tokens(in: "", language: .python).isEmpty)
    }

    func testC() {
        let found = run("int main(void) { /* hi // there */ printf(\"a // b\\n\"); return 0x1Fu; }", .c)
        XCTAssertEqual(kinds(found, .type), ["int", "void"])
        XCTAssertEqual(kinds(found, .function), ["main", "printf"])
        XCTAssertEqual(kinds(found, .keyword), ["return"])
        XCTAssertEqual(kinds(found, .comment), ["/* hi // there */"], "a // inside a comment is the comment")
        XCTAssertEqual(kinds(found, .string), ["\"a // b\\n\""], "a // inside a string is the string")
        XCTAssertEqual(kinds(found, .number), ["0x1Fu"])
    }

    func testCpp() {
        let found = run("std::vector<int> v; class Foo { virtual void go() noexcept; };", .cpp)
        XCTAssertTrue(kinds(found, .type).contains("std::vector"), "a std:: name reads as one: \(found)")
        XCTAssertEqual(Set(kinds(found, .keyword)), ["class", "virtual", "noexcept"])
        XCTAssertEqual(kinds(found, .function), ["go"])
    }

    func testPython() {
        let found = run("def greet(name: str) -> str:\n    # say '#' hello\n    return f'hi {name}'\n", .python)
        XCTAssertEqual(kinds(found, .keyword), ["def", "return"])
        XCTAssertEqual(kinds(found, .function), ["greet"])
        XCTAssertEqual(kinds(found, .type), ["str", "str"])
        XCTAssertEqual(kinds(found, .comment), ["# say '#' hello"], "a quote in a comment opens nothing")
        XCTAssertEqual(kinds(found, .string), ["f'hi {name}'"], "the f prefix belongs to the string")
    }

    func testPythonTripleQuotesAndNumerals() {
        let found = run("x = '''a\n# not a comment\n'''\ny = 1_000.5e-3", .python)
        XCTAssertEqual(kinds(found, .string), ["'''a\n# not a comment\n'''"])
        XCTAssertEqual(kinds(found, .number), ["1_000.5e-3"])
    }

    func testTypeScript() {
        let found = run("const f = (a: number): Promise<Foo> => `x${a}`; // note", .typescript)
        XCTAssertEqual(kinds(found, .keyword), ["const"])
        XCTAssertTrue(kinds(found, .type).contains("number"))
        XCTAssertTrue(kinds(found, .type).contains("Foo"), "a capitalised name in a type position: \(found)")
        XCTAssertEqual(kinds(found, .string), ["`x${a}`"], "a template literal is one string")
        XCTAssertEqual(kinds(found, .comment), ["// note"])
    }

    func testWolfram() {
        let found = run("f[x_Integer] := Module[{y = 2.5}, (* a (* nested *) note *) Sin[x] /@ list]", .wolfram)
        XCTAssertEqual(kinds(found, .comment), ["(* a (* nested *) note *)"], "Wolfram comments nest")
        XCTAssertEqual(kinds(found, .type), ["x_Integer"], "a pattern is one thing")
        XCTAssertEqual(Set(kinds(found, .keyword)), ["Module", "Sin"])
        XCTAssertEqual(kinds(found, .function), ["f"])
        XCTAssertTrue(kinds(found, .symbol).contains("/@"))
        XCTAssertEqual(kinds(found, .number), ["2.5"])
    }

    func testWolframSlotsAndAnonymousPatterns() {
        let found = run("Select[list, # > 2 &] /. _Integer -> 0", .wolfram)
        XCTAssertTrue(kinds(found, .symbol).contains("#"))
        XCTAssertTrue(kinds(found, .symbol).contains("&"))
        XCTAssertTrue(kinds(found, .type).contains("_Integer"))
    }

    func testAnUnterminatedStringOrCommentRunsToTheEndRatherThanHanging() {
        XCTAssertEqual(run("x = \"never closed", .python).last?.1, "\"never closed")
        XCTAssertEqual(run("/* never closed", .c).last?.1, "/* never closed")
        XCTAssertEqual(run("(* never closed", .wolfram).last?.1, "(* never closed")
    }
}
