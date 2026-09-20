import Foundation

/// The languages a fenced code block can be tagged with (Sean, 2026-09-19:
/// "make sure to support c, cpp, wolfram, python, typescript code blocks").
/// The tag written after the ``` is ordinary markdown, so a note stays
/// readable anywhere; this is only what the colours are chosen from.
enum CodeLanguage: String, CaseIterable, Identifiable {
    case plain = ""
    case c
    case cpp
    case wolfram
    case python
    case typescript
    case rust
    case java
    case bash
    case zsh

    var id: String { rawValue }
    /// What goes after the fence.
    var fence: String { rawValue }

    var title: String {
        switch self {
        case .plain: return "Plain Text"
        case .c: return "C"
        case .cpp: return "C++"
        case .wolfram: return "Wolfram Language"
        case .python: return "Python"
        case .typescript: return "TypeScript"
        case .rust: return "Rust"
        case .java: return "Java"
        case .bash: return "Bash"
        case .zsh: return "Zsh"
        }
    }

    /// The language a fence tag names, or nil when it names something else.
    /// `wl` is NOT here: that is this app's maths fence, and maths is set,
    /// not coloured.
    static func from(fence: String?) -> CodeLanguage? {
        let tag = (fence ?? "").trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        switch tag {
        case "": return .plain
        case "c": return .c
        case "cpp", "c++", "cc", "cxx", "hpp", "h": return .cpp
        case "wolfram", "mathematica", "wls", "m": return .wolfram
        case "python", "py", "python3": return .python
        case "typescript", "ts", "tsx", "javascript", "js": return .typescript
        case "rust", "rs": return .rust
        case "java": return .java
        // `sh` and `shell` are Bash's: the colouring is the same and the
        // fence is what most notes write.
        case "bash", "sh", "shell": return .bash
        case "zsh": return .zsh
        default: return nil
        }
    }
}

struct CodeToken: Equatable {
    enum Kind: Equatable { case keyword, type, string, comment, number, function, symbol }
    var range: NSRange
    var kind: Kind
}

/// A small hand-written scanner — one left-to-right pass in which comments
/// and strings are found FIRST, so a `//` inside a string is not a comment
/// and a quote inside a comment opens nothing. Anything unterminated runs to
/// the end of the text rather than hanging: a note is edited mid-token all
/// the time.
enum CodeHighlighter {
    static func tokens(in code: String, language: CodeLanguage) -> [CodeToken] {
        guard language != .plain else { return [] }
        let text = code as NSString
        let length = text.length
        guard length > 0 else { return [] }

        var tokens: [CodeToken] = []
        var index = 0
        /// The last character that was not a space — what tells a TypeScript
        /// `Foo` in `x: Foo` from a `Foo` standing on its own.
        var previousSymbol: unichar = 0
        var previousWord = ""

        func character(_ at: Int) -> unichar { (at >= 0 && at < length) ? text.character(at: at) : 0 }
        func matches(_ string: String, at: Int) -> Bool {
            let other = string as NSString
            guard at + other.length <= length else { return false }
            for offset in 0..<other.length where text.character(at: at + offset) != other.character(at: offset) {
                return false
            }
            return true
        }
        func emit(_ from: Int, _ to: Int, _ kind: CodeToken.Kind) {
            guard to > from else { return }
            tokens.append(CodeToken(range: NSRange(location: from, length: to - from), kind: kind))
        }
        /// Wolfram spells a pattern `x_`, so an underscore ENDS a symbol
        /// there; everywhere else it is an ordinary letter.
        func identifierPart(_ unit: unichar) -> Bool {
            language == .wolfram ? (isIdentifierPart(unit) && unit != 0x5F) : isIdentifierPart(unit)
        }
        func nextNonSpace(_ from: Int) -> Int {
            var cursor = from
            while cursor < length, isSpace(character(cursor)) { cursor += 1 }
            return cursor
        }

        while index < length {
            let start = index
            let unit = character(index)

            // Whitespace: nothing to colour, but it does not break the "what
            // came before" context either.
            if isSpace(unit) || unit == 0x0A || unit == 0x0D {
                index += 1
                continue
            }

            // ---- comments
            if language.hasSlashComments, matches("//", at: index) {
                var cursor = index + 2
                while cursor < length, character(cursor) != 0x0A { cursor += 1 }
                emit(start, cursor, .comment); index = cursor; continue
            }
            if language.hasSlashComments, matches("/*", at: index) {
                var cursor = index + 2
                while cursor < length, !matches("*/", at: cursor) { cursor += 1 }
                cursor = min(length, cursor + 2)
                emit(start, cursor, .comment); index = cursor; continue
            }
            if language.hasHashComments, unit == 0x23 {   // #
                var cursor = index + 1
                while cursor < length, character(cursor) != 0x0A { cursor += 1 }
                emit(start, cursor, .comment); index = cursor; continue
            }
            if language == .wolfram, matches("(*", at: index) {
                // Wolfram's comments nest: (* a (* b *) c *) is one comment.
                var cursor = index + 2
                var depth = 1
                while cursor < length, depth > 0 {
                    if matches("(*", at: cursor) { depth += 1; cursor += 2 }
                    else if matches("*)", at: cursor) { depth -= 1; cursor += 2 }
                    else { cursor += 1 }
                }
                emit(start, min(cursor, length), .comment); index = min(cursor, length); continue
            }

            // ---- strings
            if language == .python, let end = pythonTripleQuote(text, length: length, at: index) {
                emit(start, end, .string); index = end
                previousSymbol = 0x22; previousWord = ""
                continue
            }
            if language.quotes.contains(unit) {
                let end = simpleString(text, length: length, from: index, quote: unit,
                                       escapes: language != .wolfram || unit == 0x22)
                emit(start, end, .string); index = end
                previousSymbol = unit; previousWord = ""
                continue
            }

            // ---- numbers
            if isDigit(unit) || (unit == 0x2E && isDigit(character(index + 1))) {
                let end = number(text, length: length, from: index, language: language)
                emit(start, end, .number); index = end
                previousSymbol = 0x30; previousWord = ""
                continue
            }

            // ---- Wolfram patterns and slots, which start where nothing else does
            if language == .wolfram {
                if unit == 0x5F {   // _
                    let end = wolframPattern(text, length: length, from: index)
                    emit(start, end, .type); index = end
                    previousSymbol = unit; previousWord = ""
                    continue
                }
                if unit == 0x23 {   // # #1 ##
                    var cursor = index + 1
                    while cursor < length, character(cursor) == 0x23 || isDigit(character(cursor)) { cursor += 1 }
                    emit(start, cursor, .symbol); index = cursor
                    previousSymbol = unit; previousWord = ""
                    continue
                }
                if let operatorEnd = wolframOperator(text, length: length, at: index) {
                    emit(start, operatorEnd, .symbol); index = operatorEnd
                    previousSymbol = unit; previousWord = ""
                    continue
                }
            }

            // ---- identifiers
            if isIdentifierStart(unit) {
                var cursor = index + 1
                while cursor < length, identifierPart(character(cursor)) { cursor += 1 }
                var word = text.substring(with: NSRange(location: index, length: cursor - index))

                // A Python string prefix is part of the string: rb"…", f'…'.
                if language == .python, word.count <= 2,
                   word.allSatisfy({ "fFrRbBuU".contains($0) }),
                   language.quotes.contains(character(cursor)) {
                    let end = pythonTripleQuote(text, length: length, at: cursor)
                        ?? simpleString(text, length: length, from: cursor,
                                        quote: character(cursor), escapes: true)
                    emit(start, end, .string); index = end
                    previousSymbol = 0x22; previousWord = ""
                    continue
                }
                // `std::vector` reads as one name.
                if language == .cpp, word == "std", matches("::", at: cursor), isIdentifierStart(character(cursor + 2)) {
                    cursor += 2
                    while cursor < length, identifierPart(character(cursor)) { cursor += 1 }
                    emit(start, cursor, .type); index = cursor
                    previousSymbol = 0x3A; previousWord = "std"
                    continue
                }
                // `x_Integer` — the pattern is the whole thing.
                if language == .wolfram, character(cursor) == 0x5F {
                    let end = wolframPattern(text, length: length, from: cursor)
                    emit(start, end, .type); index = end
                    previousSymbol = 0x5F; previousWord = word
                    continue
                }

                let after = nextNonSpace(cursor)
                let callBracket: unichar = language == .wolfram ? 0x5B : 0x28   // [ or (
                let kind = classify(word, language: language, previousWord: previousWord,
                                    previousSymbol: previousSymbol, callsOut: character(after) == callBracket)
                emit(start, cursor, kind)
                index = cursor
                previousWord = word
                previousSymbol = 0
                word = ""
                continue
            }

            previousSymbol = unit
            previousWord = ""
            index += 1
        }
        return tokens
    }

    // MARK: - What a word is

    private static func classify(_ word: String, language: CodeLanguage, previousWord: String,
                                 previousSymbol: unichar, callsOut: Bool) -> CodeToken.Kind {
        if language.keywords.contains(word) { return .keyword }
        if language.types.contains(word) { return .type }
        if language == .wolfram {
            if let first = word.first, first.isUppercase {
                return CodeLanguage.wolframBuiltins.contains(word) ? .keyword : (callsOut ? .function : .symbol)
            }
            return callsOut ? .function : .symbol
        }
        if language == .typescript, let first = word.first, first.isUppercase {
            // `x: Foo`, `extends Foo`, `new Foo`, `<Foo>` — a name in a type
            // position. Anywhere else a capitalised name is just a name.
            let typePosition = previousSymbol == 0x3A || previousSymbol == 0x3C   // : <
                || ["extends", "implements", "new", "as", "instanceof", "interface", "type", "class"]
                    .contains(previousWord)
            if typePosition { return .type }
        }
        return callsOut ? .function : .symbol
    }

    // MARK: - Runs of characters

    private static func simpleString(_ text: NSString, length: Int, from: Int,
                                     quote: unichar, escapes: Bool) -> Int {
        var cursor = from + 1
        while cursor < length {
            let unit = text.character(at: cursor)
            if escapes, unit == 0x5C { cursor += 2; continue }         // \
            if unit == quote { return cursor + 1 }
            // A plain quote does not run past its line; a template literal does.
            if unit == 0x0A, quote != 0x60 { return cursor }
            cursor += 1
        }
        return length
    }

    /// `"""…"""` and `'''…'''`, or nil when this is not one.
    private static func pythonTripleQuote(_ text: NSString, length: Int, at: Int) -> Int? {
        let unit = text.character(at: at)
        guard unit == 0x22 || unit == 0x27, at + 2 < length,
              text.character(at: at + 1) == unit, text.character(at: at + 2) == unit
        else { return nil }
        var cursor = at + 3
        while cursor < length {
            if text.character(at: cursor) == 0x5C { cursor += 2; continue }
            if text.character(at: cursor) == unit, cursor + 2 < length,
               text.character(at: cursor + 1) == unit, text.character(at: cursor + 2) == unit {
                return cursor + 3
            }
            cursor += 1
        }
        return length
    }

    private static func number(_ text: NSString, length: Int, from: Int, language: CodeLanguage) -> Int {
        var cursor = from
        if text.character(at: cursor) == 0x30, cursor + 1 < length,
           text.character(at: cursor + 1) == 0x78 || text.character(at: cursor + 1) == 0x58 {   // 0x
            cursor += 2
            while cursor < length, isHexDigit(text.character(at: cursor)) || text.character(at: cursor) == 0x5F {
                cursor += 1
            }
        } else {
            while cursor < length {
                let unit = text.character(at: cursor)
                if isDigit(unit) || unit == 0x5F || unit == 0x2E { cursor += 1; continue }
                if unit == 0x65 || unit == 0x45 {   // e E
                    let next = cursor + 1 < length ? text.character(at: cursor + 1) : 0
                    if isDigit(next) || ((next == 0x2B || next == 0x2D) && cursor + 2 < length
                                         && isDigit(text.character(at: cursor + 2))) {
                        cursor += 2
                        continue
                    }
                }
                break
            }
        }
        // Suffixes: 10ul, 1.5f, Wolfram's 2.5`.
        while cursor < length, "uUlLfF".unicodeScalars.map({ unichar($0.value) }).contains(text.character(at: cursor)) {
            cursor += 1
        }
        if language == .wolfram, cursor < length, text.character(at: cursor) == 0x60 { cursor += 1 }
        return cursor
    }

    /// `_`, `__`, `_Integer`, `_?NumberQ`, `x_` (the `x` is already behind us).
    private static func wolframPattern(_ text: NSString, length: Int, from: Int) -> Int {
        var cursor = from
        while cursor < length, text.character(at: cursor) == 0x5F { cursor += 1 }
        if cursor < length, text.character(at: cursor) == 0x3F { cursor += 1 }   // ?
        while cursor < length, isIdentifierPart(text.character(at: cursor)) { cursor += 1 }
        return cursor
    }

    private static let wolframOperators = ["@@@", "//.", ":>", ":=", "/;", "/@", "@@", "//", "->", "/.", "&", "@", "|>", "<|"]

    private static func wolframOperator(_ text: NSString, length: Int, at: Int) -> Int? {
        for op in wolframOperators {
            let other = op as NSString
            guard at + other.length <= length else { continue }
            var same = true
            for offset in 0..<other.length where text.character(at: at + offset) != other.character(at: offset) {
                same = false
                break
            }
            if same { return at + other.length }
        }
        return nil
    }

    // MARK: - Character classes

    private static func isSpace(_ unit: unichar) -> Bool { unit == 0x20 || unit == 0x09 }
    private static func isDigit(_ unit: unichar) -> Bool { unit >= 0x30 && unit <= 0x39 }
    private static func isHexDigit(_ unit: unichar) -> Bool {
        isDigit(unit) || (unit >= 0x41 && unit <= 0x46) || (unit >= 0x61 && unit <= 0x66)
    }
    private static func isIdentifierStart(_ unit: unichar) -> Bool {
        (unit >= 0x41 && unit <= 0x5A) || (unit >= 0x61 && unit <= 0x7A) || unit == 0x5F || unit == 0x24 || unit > 0x7F
    }
    private static func isIdentifierPart(_ unit: unichar) -> Bool { isIdentifierStart(unit) || isDigit(unit) }
}

extension CodeLanguage {
    var hasSlashComments: Bool {
        self == .c || self == .cpp || self == .typescript || self == .rust || self == .java
    }

    /// `#` to the end of the line — Python and the shells.
    var hasHashComments: Bool { self == .python || self == .bash || self == .zsh }

    /// A shell: `$VAR` and `${VAR}` are the thing to see at a glance.
    var isShell: Bool { self == .bash || self == .zsh }

    /// The quote characters that open a string.
    var quotes: Set<unichar> {
        switch self {
        case .plain: return []
        case .c, .cpp: return [0x22, 0x27]
        case .wolfram: return [0x22]
        case .python: return [0x22, 0x27]
        case .typescript: return [0x22, 0x27, 0x60]
        case .rust, .java: return [0x22, 0x27]
        // A backtick in a shell is a command substitution; it is coloured
        // as a string for the same reason `$( )` is not: what is inside it
        // is another command, and the point is to see where it starts.
        case .bash, .zsh: return [0x22, 0x27, 0x60]
        }
    }

    var keywords: Set<String> {
        switch self {
        case .plain: return []
        case .c: return Self.cKeywords
        case .cpp: return Self.cKeywords.union(Self.cppKeywords)
        case .wolfram: return []
        case .python: return Self.pythonKeywords
        case .typescript: return Self.typescriptKeywords
        case .rust: return Self.rustKeywords
        case .java: return Self.javaKeywords
        case .bash, .zsh: return Self.shellKeywords
        }
    }

    var types: Set<String> {
        switch self {
        case .plain, .wolfram: return []
        case .c, .cpp: return Self.cTypes
        case .python: return Self.pythonTypes
        case .typescript: return Self.typescriptTypes
        case .rust: return Self.rustTypes
        case .java: return Self.javaTypes
        // A shell has no types; the builtins are the words worth marking.
        case .bash, .zsh: return Self.shellBuiltins
        }
    }

    static let cKeywords: Set<String> = [
        "if", "else", "for", "while", "do", "switch", "case", "default", "break", "continue", "return",
        "goto", "sizeof", "typedef", "struct", "union", "enum", "static", "extern", "const", "volatile",
        "inline", "register", "restrict", "signed", "unsigned", "auto", "_Static_assert", "_Atomic",
        "include", "define", "ifdef", "ifndef", "endif", "pragma"
    ]
    static let cppKeywords: Set<String> = [
        "class", "namespace", "template", "typename", "public", "private", "protected", "virtual",
        "override", "final", "new", "delete", "this", "nullptr", "constexpr", "consteval", "concept",
        "requires", "using", "try", "catch", "throw", "noexcept", "operator", "friend", "explicit",
        "mutable", "static_cast", "dynamic_cast", "reinterpret_cast", "const_cast", "decltype",
        "co_await", "co_return", "co_yield", "true", "false"
    ]
    static let cTypes: Set<String> = [
        "int", "char", "short", "long", "float", "double", "void", "bool", "wchar_t", "char8_t",
        "char16_t", "char32_t", "size_t", "ssize_t", "ptrdiff_t", "intptr_t", "uintptr_t",
        "int8_t", "int16_t", "int32_t", "int64_t", "uint8_t", "uint16_t", "uint32_t", "uint64_t",
        "FILE", "va_list", "string", "vector", "map", "set", "pair", "shared_ptr", "unique_ptr"
    ]
    static let pythonKeywords: Set<String> = [
        "and", "as", "assert", "async", "await", "break", "class", "continue", "def", "del", "elif",
        "else", "except", "finally", "for", "from", "global", "if", "import", "in", "is", "lambda",
        "match", "case", "nonlocal", "not", "or", "pass", "raise", "return", "try", "while", "with",
        "yield", "True", "False", "None", "self", "cls"
    ]
    static let pythonTypes: Set<String> = [
        "int", "str", "float", "complex", "list", "dict", "set", "frozenset", "tuple", "bool",
        "bytes", "bytearray", "object", "type", "range"
    ]
    static let typescriptKeywords: Set<String> = [
        "abstract", "as", "async", "await", "break", "case", "catch", "class", "const", "continue",
        "debugger", "declare", "default", "delete", "do", "else", "enum", "export", "extends",
        "false", "finally", "for", "from", "function", "get", "if", "implements", "import", "in",
        "infer", "instanceof", "interface", "is", "keyof", "let", "module", "namespace", "new",
        "null", "of", "package", "private", "protected", "public", "readonly", "require", "return",
        "satisfies", "set", "static", "super", "switch", "this", "throw", "true", "try", "type",
        "typeof", "var", "void", "while", "with", "yield"
    ]
    static let typescriptTypes: Set<String> = [
        "string", "number", "boolean", "any", "never", "unknown", "object", "symbol", "bigint",
        "undefined", "Array", "Promise", "Record", "Partial", "Readonly", "Map", "Set", "Date"
    ]

    static let rustKeywords: Set<String> = [
        "as", "async", "await", "break", "const", "continue", "crate", "dyn", "else", "enum",
        "extern", "false", "fn", "for", "if", "impl", "in", "let", "loop", "match", "mod", "move",
        "mut", "pub", "ref", "return", "self", "Self", "static", "struct", "super", "trait", "true",
        "type", "unsafe", "use", "where", "while", "union", "macro_rules"
    ]
    static let rustTypes: Set<String> = [
        "i8", "i16", "i32", "i64", "i128", "isize", "u8", "u16", "u32", "u64", "u128", "usize",
        "f32", "f64", "bool", "char", "str", "String", "Vec", "Option", "Result", "Box", "Rc", "Arc",
        "RefCell", "Cell", "HashMap", "HashSet", "BTreeMap", "BTreeSet", "Some", "None", "Ok", "Err"
    ]
    static let javaKeywords: Set<String> = [
        "abstract", "assert", "break", "case", "catch", "class", "const", "continue", "default",
        "do", "else", "enum", "extends", "final", "finally", "for", "goto", "if", "implements",
        "import", "instanceof", "interface", "native", "new", "package", "private", "protected",
        "public", "return", "static", "strictfp", "super", "switch", "synchronized", "this", "throw",
        "throws", "transient", "try", "volatile", "while", "var", "record", "sealed", "permits",
        "yield", "true", "false", "null"
    ]
    static let javaTypes: Set<String> = [
        "int", "long", "short", "byte", "char", "float", "double", "boolean", "void", "String",
        "Object", "Integer", "Long", "Double", "Boolean", "Character", "List", "ArrayList", "Map",
        "HashMap", "Set", "HashSet", "Optional", "Stream", "Exception", "RuntimeException"
    ]
    /// The shell words that change what a line DOES — the control flow and
    /// the builtins that are not programs on the disk.
    static let shellKeywords: Set<String> = [
        "if", "then", "elif", "else", "fi", "case", "esac", "for", "select", "while", "until",
        "do", "done", "function", "in", "time", "coproc", "return", "break", "continue", "exit",
        "local", "declare", "typeset", "readonly", "export", "unset", "shift", "trap", "set"
    ]
    static let shellBuiltins: Set<String> = [
        "echo", "printf", "read", "cd", "pwd", "test", "eval", "exec", "source", "alias", "unalias",
        "wait", "jobs", "kill", "let", "getopts", "shopt", "setopt", "emulate", "autoload", "zmodload",
        "true", "false"
    ]

    /// The Wolfram built-ins worth marking: the ones a notebook page is
    /// mostly made of. A capitalised name that is not here is still a symbol.
    static let wolframBuiltins: Set<String> = [
        "Module", "With", "Block", "Function", "If", "Which", "Switch", "Do", "For", "While", "Table",
        "Map", "MapThread", "Apply", "Nest", "NestList", "Fold", "FoldList", "Plot", "Plot3D",
        "ListPlot", "ListLinePlot", "Histogram", "Integrate", "NIntegrate", "D", "Dt", "Sum", "Product",
        "Limit", "Series", "Solve", "NSolve", "DSolve", "FindRoot", "Simplify", "FullSimplify",
        "Expand", "Factor", "Together", "Apart", "Collect", "Coefficient", "Sin", "Cos", "Tan", "ArcSin",
        "ArcCos", "ArcTan", "Sinh", "Cosh", "Tanh", "Exp", "Log", "Sqrt", "Abs", "Sign", "Floor",
        "Ceiling", "Round", "Mod", "Max", "Min", "Total", "Mean", "Median", "Variance", "StandardDeviation",
        "Pi", "E", "I", "Infinity", "Degree", "GoldenRatio", "EulerGamma", "True", "False", "None", "Null",
        "List", "Length", "First", "Last", "Rest", "Most", "Part", "Take", "Drop", "Range", "Select",
        "Cases", "Count", "Position", "Join", "Flatten", "Partition", "Sort", "SortBy", "Reverse",
        "Union", "Intersection", "Complement", "Append", "Prepend", "Insert", "Delete", "Times", "Plus",
        "Print", "Echo", "StringJoin", "StringSplit", "StringReplace", "StringLength", "StringTake",
        "ToString", "ToExpression", "Characters", "Graphics", "Graphics3D", "Line", "Circle", "Disk",
        "Rectangle", "Polygon", "Point", "Arrow", "Text", "Style", "RGBColor", "Hue", "Red", "Blue",
        "Green", "Black", "White", "Gray", "Orange", "Thick", "Thin", "Dashed", "PointSize",
        "Return", "Throw", "Catch", "Sow", "Reap", "Set", "SetDelayed", "Rule", "RuleDelayed",
        "Association", "Keys", "Values", "Lookup", "AssociationMap", "Dataset", "Import", "Export",
        "Manipulate", "Dynamic", "Animate", "Show", "Grid", "Column", "Row", "Framed", "Tooltip",
        "RandomReal", "RandomInteger", "RandomChoice", "SeedRandom", "Timing", "AbsoluteTiming",
        "Quiet", "Check", "Assert", "Head", "Depth", "AtomQ", "NumberQ", "StringQ", "ListQ", "MemberQ",
        "FreeQ", "MatchQ", "Replace", "ReplaceAll", "ReplaceRepeated", "Nothing", "Missing", "Automatic",
        "All", "Options", "SetOptions", "Clear", "Remove", "Needs", "Get", "Compile", "Parallelize"
    ]
}
