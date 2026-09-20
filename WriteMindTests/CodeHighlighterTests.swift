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
        XCTAssertNil(CodeLanguage.from(fence: "haskell"), "a language this app does not colour")
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

/// Rust, Java, Bash and Zsh (Sean, 2026-09-19: "add rust java bash zsh
/// syntax highlighting").
final class MoreLanguagesTests: XCTestCase {
    private func kinds(_ code: String, _ language: CodeLanguage) -> [(String, CodeToken.Kind)] {
        let text = code as NSString
        return CodeHighlighter.tokens(in: code, language: language)
            .map { (text.substring(with: $0.range), $0.kind) }
    }

    private func kind(of word: String, in code: String, _ language: CodeLanguage) -> CodeToken.Kind? {
        kinds(code, language).first { $0.0 == word }?.1
    }

    // MARK: - The fences

    func testEachLanguageIsNamedByItsFence() {
        XCTAssertEqual(CodeLanguage.from(fence: "rust"), .rust)
        XCTAssertEqual(CodeLanguage.from(fence: "rs"), .rust)
        XCTAssertEqual(CodeLanguage.from(fence: "java"), .java)
        XCTAssertEqual(CodeLanguage.from(fence: "bash"), .bash)
        XCTAssertEqual(CodeLanguage.from(fence: "sh"), .bash)
        XCTAssertEqual(CodeLanguage.from(fence: "shell"), .bash)
        XCTAssertEqual(CodeLanguage.from(fence: "zsh"), .zsh)
    }

    func testEachOneIsOnTheMenu() {
        // The fence menu is built from allCases, so a language that is not
        // in it cannot be picked.
        let titles = CodeLanguage.allCases.map(\.title)
        for name in ["Rust", "Java", "Bash", "Zsh"] { XCTAssertTrue(titles.contains(name), name) }
    }

    // MARK: - Rust

    func testRustKeywordsTypesAndComments() {
        let code = "// count\nfn main() {\n    let mut total: u32 = 0;\n}"
        XCTAssertEqual(kind(of: "fn", in: code, .rust), .keyword)
        XCTAssertEqual(kind(of: "let", in: code, .rust), .keyword)
        XCTAssertEqual(kind(of: "mut", in: code, .rust), .keyword)
        XCTAssertEqual(kind(of: "u32", in: code, .rust), .type)
        XCTAssertEqual(kind(of: "// count", in: code, .rust), .comment)
        XCTAssertEqual(kind(of: "0", in: code, .rust), .number)
    }

    func testRustStringsAndCollections() {
        let code = "let v: Vec<String> = vec![\"a\"];"
        XCTAssertEqual(kind(of: "Vec", in: code, .rust), .type)
        XCTAssertEqual(kind(of: "String", in: code, .rust), .type)
        XCTAssertEqual(kind(of: "\"a\"", in: code, .rust), .string)
    }

    // MARK: - Java

    func testJavaKeywordsAndTypes() {
        let code = "public class Main {\n    /* go */\n    private static int n = 3;\n}"
        XCTAssertEqual(kind(of: "public", in: code, .java), .keyword)
        XCTAssertEqual(kind(of: "class", in: code, .java), .keyword)
        XCTAssertEqual(kind(of: "int", in: code, .java), .type)
        XCTAssertEqual(kind(of: "/* go */", in: code, .java), .comment)
    }

    func testJavaStringsAreDoubleQuoted() {
        XCTAssertEqual(kind(of: "\"hi\"", in: "String s = \"hi\";", .java), .string)
    }

    // MARK: - The shells

    func testShellCommentsAndKeywords() {
        let code = "# build\nif [ -f x ]; then\n  echo \"hi\"\nfi"
        XCTAssertEqual(kind(of: "# build", in: code, .bash), .comment)
        XCTAssertEqual(kind(of: "if", in: code, .bash), .keyword)
        XCTAssertEqual(kind(of: "then", in: code, .bash), .keyword)
        XCTAssertEqual(kind(of: "fi", in: code, .bash), .keyword)
        XCTAssertEqual(kind(of: "echo", in: code, .bash), .type, "a builtin, not a program")
        XCTAssertEqual(kind(of: "\"hi\"", in: code, .bash), .string)
    }

    func testZshReadsTheSameWayAndKnowsItsOwnBuiltins() {
        let code = "setopt extended_glob\nfor f in *.md; do print $f; done"
        XCTAssertEqual(kind(of: "setopt", in: code, .zsh), .type)
        XCTAssertEqual(kind(of: "for", in: code, .zsh), .keyword)
        XCTAssertEqual(kind(of: "do", in: code, .zsh), .keyword)
        XCTAssertEqual(kind(of: "done", in: code, .zsh), .keyword)
    }

    func testASlashCommentIsNotAThingInAShell() {
        // `//` is a path, not a comment.
        XCTAssertNil(kinds("cd //server/share", .bash).first { $0.1 == .comment })
    }

    func testNothingIsColouredInPlainText() {
        XCTAssertTrue(CodeHighlighter.tokens(in: "fn main() {}", language: .plain).isEmpty)
    }
}
