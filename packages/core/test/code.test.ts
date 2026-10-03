import { describe, expect, it } from "vitest"
import {
  CODE_LANGUAGES, codeTokens, languageFrom, languageTitle, type CodeLanguage, type CodeTokenKind,
} from "../src/markdown/code"

/** Transcribed from `WriteMindTests/CodeHighlighterTests.swift`. */
const run = (code: string, language: CodeLanguage): [CodeTokenKind, string][] => {
  const tokens = codeTokens(code, language)
  // Every run of this suite also checks the shape of the output.
  let previousEnd = 0
  for (const token of tokens) {
    expect(token.range.location, `tokens overlap in: ${code}`).toBeGreaterThanOrEqual(previousEnd)
    expect(token.range.location + token.range.length).toBeLessThanOrEqual(code.length)
    previousEnd = token.range.location + token.range.length
  }
  return tokens.map((t) => [t.kind, code.slice(t.range.location, t.range.location + t.range.length)])
}
const kinds = (pairs: [CodeTokenKind, string][], kind: CodeTokenKind) =>
  pairs.filter((p) => p[0] === kind).map((p) => p[1])
const kindOf = (word: string, code: string, language: CodeLanguage) =>
  run(code, language).find((p) => p[1] === word)?.[0]

describe("the fence tags", () => {
  it("map to languages case-insensitively, with aliases", () => {
    expect(languageFrom("c")).toBe("c")
    expect(languageFrom("C++")).toBe("cpp")
    expect(languageFrom(" hpp ")).toBe("cpp")
    expect(languageFrom("Mathematica")).toBe("wolfram")
    expect(languageFrom("py")).toBe("python")
    expect(languageFrom("TSX")).toBe("typescript")
    expect(languageFrom("js")).toBe("typescript")
    expect(languageFrom("")).toBe("plain")
    expect(languageFrom(null)).toBe("plain")
    expect(languageFrom("haskell")).toBeNull()
    expect(languageFrom("wl")).toBeNull() // this app's maths fence, not a code language
  })

  it("name each of the newer four, and all of them are on the menu", () => {
    expect(languageFrom("rust")).toBe("rust")
    expect(languageFrom("rs")).toBe("rust")
    expect(languageFrom("java")).toBe("java")
    expect(languageFrom("bash")).toBe("bash")
    expect(languageFrom("sh")).toBe("bash")
    expect(languageFrom("shell")).toBe("bash")
    expect(languageFrom("zsh")).toBe("zsh")
    const titles = CODE_LANGUAGES.map(languageTitle)
    for (const name of ["Rust", "Java", "Bash", "Zsh"]) expect(titles).toContain(name)
  })
})

describe("the scanner", () => {
  it("colours nothing in plain text or empty code", () => {
    expect(codeTokens("anything at all", "plain")).toEqual([])
    expect(codeTokens("", "python")).toEqual([])
    expect(codeTokens("fn main() {}", "plain")).toEqual([])
  })

  it("reads C, with a // inside a comment or a string belonging to it", () => {
    const found = run('int main(void) { /* hi // there */ printf("a // b\\n"); return 0x1Fu; }', "c")
    expect(kinds(found, "type")).toEqual(["int", "void"])
    expect(kinds(found, "function")).toEqual(["main", "printf"])
    expect(kinds(found, "keyword")).toEqual(["return"])
    expect(kinds(found, "comment")).toEqual(["/* hi // there */"])
    expect(kinds(found, "string")).toEqual(['"a // b\\n"'])
    expect(kinds(found, "number")).toEqual(["0x1Fu"])
  })

  it("reads C++, a std:: name as one", () => {
    const found = run("std::vector<int> v; class Foo { virtual void go() noexcept; };", "cpp")
    expect(kinds(found, "type")).toContain("std::vector")
    expect(new Set(kinds(found, "keyword"))).toEqual(new Set(["class", "virtual", "noexcept"]))
    expect(kinds(found, "function")).toEqual(["go"])
  })

  it("reads Python: a quote in a comment opens nothing, the f belongs to the string", () => {
    const found = run("def greet(name: str) -> str:\n    # say '#' hello\n    return f'hi {name}'\n", "python")
    expect(kinds(found, "keyword")).toEqual(["def", "return"])
    expect(kinds(found, "function")).toEqual(["greet"])
    expect(kinds(found, "type")).toEqual(["str", "str"])
    expect(kinds(found, "comment")).toEqual(["# say '#' hello"])
    expect(kinds(found, "string")).toEqual(["f'hi {name}'"])
  })

  it("reads Python triple quotes and numerals", () => {
    const found = run("x = '''a\n# not a comment\n'''\ny = 1_000.5e-3", "python")
    expect(kinds(found, "string")).toEqual(["'''a\n# not a comment\n'''"])
    expect(kinds(found, "number")).toEqual(["1_000.5e-3"])
  })

  it("reads TypeScript: a type position, a template literal, a comment", () => {
    const found = run("const f = (a: number): Promise<Foo> => `x${a}`; // note", "typescript")
    expect(kinds(found, "keyword")).toEqual(["const"])
    expect(kinds(found, "type")).toContain("number")
    expect(kinds(found, "type")).toContain("Foo")
    expect(kinds(found, "string")).toEqual(["`x${a}`"])
    expect(kinds(found, "comment")).toEqual(["// note"])
  })

  it("reads Wolfram: nested comments, one-piece patterns, built-ins", () => {
    const found = run("f[x_Integer] := Module[{y = 2.5}, (* a (* nested *) note *) Sin[x] /@ list]", "wolfram")
    expect(kinds(found, "comment")).toEqual(["(* a (* nested *) note *)"])
    expect(kinds(found, "type")).toEqual(["x_Integer"])
    expect(new Set(kinds(found, "keyword"))).toEqual(new Set(["Module", "Sin"]))
    expect(kinds(found, "function")).toEqual(["f"])
    expect(kinds(found, "symbol")).toContain("/@")
    expect(kinds(found, "number")).toEqual(["2.5"])
  })

  it("reads Wolfram slots and anonymous patterns", () => {
    const found = run("Select[list, # > 2 &] /. _Integer -> 0", "wolfram")
    expect(kinds(found, "symbol")).toContain("#")
    expect(kinds(found, "symbol")).toContain("&")
    expect(kinds(found, "type")).toContain("_Integer")
  })

  it("runs an unterminated string or comment to the end rather than hanging", () => {
    expect(run('x = "never closed', "python").at(-1)?.[1]).toBe('"never closed')
    expect(run("/* never closed", "c").at(-1)?.[1]).toBe("/* never closed")
    expect(run("(* never closed", "wolfram").at(-1)?.[1]).toBe("(* never closed")
  })
})

describe("Rust, Java, Bash and Zsh", () => {
  it("colours Rust keywords, types and comments", () => {
    const code = "// count\nfn main() {\n    let mut total: u32 = 0;\n}"
    expect(kindOf("fn", code, "rust")).toBe("keyword")
    expect(kindOf("let", code, "rust")).toBe("keyword")
    expect(kindOf("mut", code, "rust")).toBe("keyword")
    expect(kindOf("u32", code, "rust")).toBe("type")
    expect(kindOf("// count", code, "rust")).toBe("comment")
    expect(kindOf("0", code, "rust")).toBe("number")
  })

  it("colours Rust strings and collections", () => {
    const code = 'let v: Vec<String> = vec!["a"];'
    expect(kindOf("Vec", code, "rust")).toBe("type")
    expect(kindOf("String", code, "rust")).toBe("type")
    expect(kindOf('"a"', code, "rust")).toBe("string")
  })

  it("colours Java keywords, types and strings", () => {
    const code = "public class Main {\n    /* go */\n    private static int n = 3;\n}"
    expect(kindOf("public", code, "java")).toBe("keyword")
    expect(kindOf("class", code, "java")).toBe("keyword")
    expect(kindOf("int", code, "java")).toBe("type")
    expect(kindOf("/* go */", code, "java")).toBe("comment")
    expect(kindOf('"hi"', 'String s = "hi";', "java")).toBe("string")
  })

  it("colours shell comments, keywords and builtins", () => {
    const code = '# build\nif [ -f x ]; then\n  echo "hi"\nfi'
    expect(kindOf("# build", code, "bash")).toBe("comment")
    expect(kindOf("if", code, "bash")).toBe("keyword")
    expect(kindOf("then", code, "bash")).toBe("keyword")
    expect(kindOf("fi", code, "bash")).toBe("keyword")
    expect(kindOf("echo", code, "bash")).toBe("type") // a builtin, not a program
    expect(kindOf('"hi"', code, "bash")).toBe("string")
  })

  it("reads Zsh the same way and knows its own builtins", () => {
    const code = "setopt extended_glob\nfor f in *.md; do print $f; done"
    expect(kindOf("setopt", code, "zsh")).toBe("type")
    expect(kindOf("for", code, "zsh")).toBe("keyword")
    expect(kindOf("do", code, "zsh")).toBe("keyword")
    expect(kindOf("done", code, "zsh")).toBe("keyword")
  })

  it("treats // as a path in a shell, not a comment", () => {
    expect(run("cd //server/share", "bash").find((p) => p[0] === "comment")).toBeUndefined()
  })
})
