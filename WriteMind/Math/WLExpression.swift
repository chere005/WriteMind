import Foundation

/// Maths is kept in Wolfram Language (Sean, 2026-09-18: "use WL for the
/// canonical form of the math inputs"), so what a note holds is text anything
/// can read — `Integrate[x^2, {x, 0, 1}]` — and this is what reads it back so
/// it can be typeset.
indirect enum WLExpr: Equatable {
    case number(String)
    case symbol(String)
    case text(String)
    case list([WLExpr])
    case call(WLExpr, [WLExpr])
    case binary(String, WLExpr, WLExpr)
    case negate(WLExpr)

    /// `Integrate[…]` and friends: a named head with its arguments.
    var application: (name: String, args: [WLExpr])? {
        if case .call(.symbol(let name), let args) = self { return (name, args) }
        return nil
    }

    /// Nothing that needs brackets round it when something is done to it.
    var isAtom: Bool {
        switch self {
        case .number, .symbol, .text, .list: return true
        case .call: return true
        case .binary, .negate: return false
        }
    }
}

/// Reads WL. Not the language — the arithmetic, the brackets, the lists and
/// the function calls, which is all a note ever holds.
enum WLParser {
    static func parse(_ source: String) -> WLExpr? {
        var parser = Parser(tokens: tokenize(source))
        guard let expression = parser.expression(0), parser.isFinished else { return nil }
        return expression
    }

    // MARK: - Tokens

    struct Token: Equatable {
        enum Kind { case number, symbol, text, op, punct }
        let kind: Kind
        let value: String
    }

    static let operators = ["->", "==", "!=", "<=", ">=", "+", "-", "*", "/", "^", "<", ">"]

    static func tokenize(_ source: String) -> [Token] {
        var tokens: [Token] = []
        let characters = Array(source)
        var index = 0

        while index < characters.count {
            let character = characters[index]

            if character.isWhitespace { index += 1; continue }

            // \[Alpha] — WL spells Greek letters like this, and they are names.
            if character == "\\", index + 1 < characters.count, characters[index + 1] == "[" {
                var name = "\\["
                index += 2
                while index < characters.count, characters[index] != "]" {
                    name.append(characters[index]); index += 1
                }
                if index < characters.count { index += 1 }
                tokens.append(Token(kind: .symbol, value: name + "]"))
                continue
            }

            if character.isNumber || (character == "." && index + 1 < characters.count && characters[index + 1].isNumber) {
                var number = ""
                while index < characters.count, characters[index].isNumber || characters[index] == "." {
                    number.append(characters[index]); index += 1
                }
                tokens.append(Token(kind: .number, value: number))
                continue
            }

            if character.isLetter || character == "$" {
                var name = ""
                while index < characters.count, characters[index].isLetter || characters[index].isNumber
                    || characters[index] == "$" {
                    name.append(characters[index]); index += 1
                }
                tokens.append(Token(kind: .symbol, value: name))
                continue
            }

            if character == "\"" {
                var value = ""
                index += 1
                while index < characters.count, characters[index] != "\"" {
                    value.append(characters[index]); index += 1
                }
                if index < characters.count { index += 1 }
                tokens.append(Token(kind: .text, value: value))
                continue
            }

            let rest = String(characters[index...])
            if let match = operators.first(where: { rest.hasPrefix($0) }) {
                tokens.append(Token(kind: .op, value: match))
                index += match.count
                continue
            }

            tokens.append(Token(kind: .punct, value: String(character)))
            index += 1
        }
        return tokens
    }

    // MARK: - Precedence

    static func precedence(_ op: String) -> Int {
        switch op {
        case "->": return 1
        case "==", "!=", "<", "<=", ">", ">=": return 2
        case "+", "-": return 3
        case "*", "/": return 4
        case "^": return 5
        default: return 0
        }
    }

    static func isRightAssociative(_ op: String) -> Bool { op == "^" || op == "->" }

    // MARK: - The parser itself

    private struct Parser {
        let tokens: [Token]
        var index = 0

        var isFinished: Bool { index >= tokens.count }
        var current: Token? { index < tokens.count ? tokens[index] : nil }

        mutating func expression(_ minimum: Int) -> WLExpr? {
            guard var left = unary() else { return nil }

            while let token = current {
                if token.kind == .op, precedence(token.value) >= minimum, precedence(token.value) > 0 {
                    let op = token.value
                    index += 1
                    let next = isRightAssociative(op) ? precedence(op) : precedence(op) + 1
                    guard let right = expression(next) else { return nil }
                    left = .binary(op, left, right)
                    continue
                }
                // `2 x` is a product in WL, and someone typing into a slot
                // will write it that way.
                if startsPrimary(token), precedence("*") >= minimum {
                    guard let right = expression(precedence("*") + 1) else { return nil }
                    left = .binary("*", left, right)
                    continue
                }
                break
            }
            return left
        }

        private func startsPrimary(_ token: Token) -> Bool {
            switch token.kind {
            case .number, .symbol, .text: return true
            case .punct: return token.value == "(" || token.value == "{"
            case .op: return false
            }
        }

        mutating func unary() -> WLExpr? {
            if let token = current, token.kind == .op, token.value == "-" {
                index += 1
                guard let operand = unary() else { return nil }
                return .negate(operand)
            }
            if let token = current, token.kind == .op, token.value == "+" {
                index += 1
                return unary()
            }
            return postfix()
        }

        mutating func postfix() -> WLExpr? {
            guard var value = primary() else { return nil }
            while let token = current, token.kind == .punct, token.value == "[" {
                index += 1
                guard let arguments = list(until: "]") else { return nil }
                value = .call(value, arguments)
            }
            return value
        }

        mutating func primary() -> WLExpr? {
            guard let token = current else { return nil }
            switch token.kind {
            case .number: index += 1; return .number(token.value)
            case .symbol: index += 1; return .symbol(token.value)
            case .text: index += 1; return .text(token.value)
            case .op: return nil
            case .punct:
                switch token.value {
                case "(":
                    index += 1
                    guard let inner = expression(0), let close = current,
                          close.kind == .punct, close.value == ")" else { return nil }
                    index += 1
                    return inner
                case "{":
                    index += 1
                    guard let items = list(until: "}") else { return nil }
                    return .list(items)
                default:
                    return nil
                }
            }
        }

        /// Comma-separated expressions up to a closing bracket.
        mutating func list(until close: String) -> [WLExpr]? {
            var items: [WLExpr] = []
            if let token = current, token.kind == .punct, token.value == close {
                index += 1
                return items
            }
            while true {
                guard let item = expression(0) else { return nil }
                items.append(item)
                guard let token = current, token.kind == .punct else { return nil }
                if token.value == "," { index += 1; continue }
                if token.value == close { index += 1; return items }
                return nil
            }
        }
    }
}

/// Back to WL text — the canonical spelling, with the brackets it needs and
/// none it does not. What the maths menu writes into the note comes through
/// here, so two ways of typing the same thing land on one form.
enum WLPrinter {
    static func source(_ expr: WLExpr) -> String {
        switch expr {
        case .number(let value): return value
        case .symbol(let name): return name
        case .text(let value): return "\"\(value)\""
        case .list(let items): return "{" + items.map(source).joined(separator: ", ") + "}"
        case .call(let head, let args):
            return source(head) + "[" + args.map(source).joined(separator: ", ") + "]"
        case .negate(let operand):
            return "-" + wrapped(operand, inside: 6)
        case .binary(let op, let left, let right):
            let level = WLParser.precedence(op)
            let spacing = level <= 3 ? " " : ""
            let leftText = wrapped(left, inside: WLParser.isRightAssociative(op) ? level + 1 : level)
            let rightText = wrapped(right, inside: WLParser.isRightAssociative(op) ? level : level + 1)
            return leftText + spacing + op + spacing + rightText
        }
    }

    private static func wrapped(_ expr: WLExpr, inside level: Int) -> String {
        if case .binary(let op, _, _) = expr, WLParser.precedence(op) < level {
            return "(" + source(expr) + ")"
        }
        if case .negate = expr, level > 3 { return "(" + source(expr) + ")" }
        return source(expr)
    }

    /// Whatever was typed, in canonical form — and left alone if it does not
    /// parse, because half-typed maths is still the user's text.
    static func canonical(_ source: String) -> String {
        guard let expr = WLParser.parse(source) else { return source }
        return Self.source(expr)
    }
}
