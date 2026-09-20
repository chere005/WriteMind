import SwiftUI

/// The glyphs maths is read in. WL names on the left, what a reader expects
/// on the right — `Pi` is π on the page and stays `Pi` in the file.
enum MathSymbols {
    static let constants: [String: String] = [
        "Pi": "π", "E": "e", "I": "i", "Infinity": "∞", "Degree": "°",
        "EulerGamma": "γ", "GoldenRatio": "φ", "ImaginaryI": "i", "Indeterminate": "?",
        // The number sets, which are plain WL symbols rather than \[names].
        "Reals": "ℝ", "Integers": "ℤ", "Rationals": "ℚ", "Complexes": "ℂ", "Primes": "ℙ",
        "Booleans": "𝔹", "True": "True", "False": "False"
    ]

    /// The rest of the `\[Name]` table: the operators and relations a page
    /// of maths is written with (Sean, 2026-09-19: "add more under calculus
    /// functions and symbols").
    static let operators: [String: String] = [
        "PlusMinus": "±", "MinusPlus": "∓", "TildeTilde": "≈", "Tilde": "∼", "TildeEqual": "≃",
        "Congruent": "≡", "Proportional": "∝", "CenterDot": "⋅", "Times": "×", "Divide": "÷",
        "SmallCircle": "∘", "CirclePlus": "⊕", "CircleTimes": "⊗", "CircleMinus": "⊖",
        "Subset": "⊂", "Superset": "⊃", "SubsetEqual": "⊆", "SupersetEqual": "⊇",
        "Not": "¬", "And": "∧", "Or": "∨", "Implies": "⇒", "Equivalent": "⇔",
        "LeftArrow": "←", "RightArrow": "→", "UpArrow": "↑", "DownArrow": "↓",
        "LongRightArrow": "⟶", "LongLeftArrow": "⟵", "DoubleRightArrow": "⇒",
        "Because": "∵", "Perpendicular": "⊥", "DoubleVerticalBar": "∥", "Angle": "∠",
        "Prime": "′", "DoublePrime": "″", "CenterEllipsis": "⋯", "Ellipsis": "…",
        "VerticalEllipsis": "⋮", "ContourIntegral": "∮", "DoubleContourIntegral": "∯",
        "Integral": "∫", "Sum": "∑", "Product": "∏", "SquareRoot": "√", "Aleph": "ℵ",
        "HBar": "ħ", "ScriptL": "ℓ", "Micro": "µ", "Angstrom": "Å", "Star": "⋆",
        "LessEqual": "≤", "GreaterEqual": "≥", "NotEqual": "≠", "Equal": "=",
        "LeftRightArrow": "↔", "Element": "∈", "NotElement": "∉", "EmptySet": "∅",
        "Infinity": "∞", "Cross": "✕", "Wedge": "∧", "Vee": "∨", "Del": "∇"
    ]

    static let greek: [String: String] = [
        "Alpha": "α", "Beta": "β", "Gamma": "γ", "Delta": "δ", "Epsilon": "ε", "Zeta": "ζ",
        "Eta": "η", "Theta": "θ", "Iota": "ι", "Kappa": "κ", "Lambda": "λ", "Mu": "μ",
        "Nu": "ν", "Xi": "ξ", "Omicron": "ο", "Pi": "π", "Rho": "ρ", "Sigma": "σ",
        "Tau": "τ", "Upsilon": "υ", "Phi": "φ", "Chi": "χ", "Psi": "ψ", "Omega": "ω",
        "CapitalDelta": "Δ", "CapitalGamma": "Γ", "CapitalLambda": "Λ", "CapitalOmega": "Ω",
        "CapitalPhi": "Φ", "CapitalPi": "Π", "CapitalPsi": "Ψ", "CapitalSigma": "Σ",
        "CapitalTheta": "Θ", "CapitalXi": "Ξ", "Element": "∈", "NotElement": "∉",
        "Union": "∪", "Intersection": "∩", "PartialD": "∂", "Nabla": "∇",
        "Therefore": "∴", "ForAll": "∀", "Exists": "∃", "EmptySet": "∅"
    ]

    /// The functions that are set upright and lower case, the way they are read.
    static let functions: [String: String] = [
        "Sin": "sin", "Cos": "cos", "Tan": "tan", "Cot": "cot", "Sec": "sec", "Csc": "csc",
        "ArcSin": "arcsin", "ArcCos": "arccos", "ArcTan": "arctan",
        "Sinh": "sinh", "Cosh": "cosh", "Tanh": "tanh",
        "Log": "ln", "Log10": "log₁₀", "Log2": "log₂", "Exp": "exp",
        "Max": "max", "Min": "min", "Mod": "mod", "Gcd": "gcd", "Det": "det",
        "ArcSinh": "arcsinh", "ArcCosh": "arccosh", "ArcTanh": "arctanh",
        "Erf": "erf", "Erfc": "erfc", "Gamma": "Γ", "Beta": "B", "Zeta": "ζ",
        "Floor": "⌊⌋", "Ceiling": "⌈⌉", "Norm": "‖‖", "Re": "Re", "Im": "Im",
        "Arg": "arg", "Conjugate": "conj", "Tr": "tr", "Rank": "rank",
        "Dot": "·", "Cross": "×", "Trace": "tr", "Sign": "sgn"
    ]

    static let relations: [String: String] = [
        "==": "=", "!=": "≠", "<=": "≤", ">=": "≥", "<": "<", ">": ">",
        "->": "→", "+": "+", "-": "−", "*": "·", "/": "/"
    ]

    /// `\[Alpha]` → α, `Pi` → π, anything else as it stands.
    static func glyph(for symbol: String) -> String {
        if symbol.hasPrefix("\\["), symbol.hasSuffix("]") {
            let name = String(symbol.dropFirst(2).dropLast())
            return greek[name] ?? operators[name] ?? constants[name] ?? name
        }
        return constants[symbol] ?? symbol
    }

    /// A single letter is a variable and is set in italic; `sin` and `Δ` are not.
    static func isVariable(_ glyph: String) -> Bool {
        glyph.count == 1 && (glyph.first?.isLetter ?? false)
    }
}

/// Maths inside a line of prose: one `AttributedString`, with real raised and
/// lowered scripts, so it sits in a paragraph without a view of its own.
/// Anything that would need two dimensions — a stacked fraction, a radical
/// with a roof — is written the linear way here and stacked properly by
/// `MathView` when it is on its own line.
enum MathTypesetter {
    static func inline(_ source: String, size: CGFloat = 15) -> AttributedString? {
        guard let expr = WLParser.parse(source) else { return nil }
        return render(expr, size: size)
    }

    static func render(_ expr: WLExpr, size: CGFloat) -> AttributedString {
        switch expr {
        case .number(let value):
            return plain(value, size: size)
        case .text(let value):
            return plain(value, size: size)
        case .symbol(let name):
            let glyph = MathSymbols.glyph(for: name)
            return plain(glyph, size: size, italic: MathSymbols.isVariable(glyph))
        case .list(let items):
            var out = plain("{", size: size)
            for (index, item) in items.enumerated() {
                if index > 0 { out.append(plain(", ", size: size)) }
                out.append(render(item, size: size))
            }
            out.append(plain("}", size: size))
            return out
        case .negate(let operand):
            var out = plain("−", size: size)
            out.append(fenced(operand, size: size, level: 4))
            return out
        case .binary(let op, let left, let right):
            return binary(op, left, right, size: size)
        case .call:
            return call(expr, size: size)
        }
    }

    // MARK: - Pieces

    static func plain(_ string: String, size: CGFloat, italic: Bool = false) -> AttributedString {
        var piece = AttributedString(string)
        piece.font = italic
            ? .system(size: size, design: .serif).italic()
            : .system(size: size, design: .serif)
        return piece
    }

    /// Raised or lowered, and smaller — an exponent, or the bounds of a sum.
    static func script(_ piece: AttributedString, size: CGFloat, raised: Bool) -> AttributedString {
        var copy = piece
        copy.font = .system(size: size * 0.7, design: .serif)
        copy.baselineOffset = raised ? size * 0.36 : -size * 0.22
        return copy
    }

    private static func fenced(_ expr: WLExpr, size: CGFloat, level: Int) -> AttributedString {
        var needsBrackets = false
        if case .binary(let op, _, _) = expr, WLParser.precedence(op) < level { needsBrackets = true }
        if case .negate = expr, level > 3 { needsBrackets = true }
        guard needsBrackets else { return render(expr, size: size) }
        var out = plain("(", size: size)
        out.append(render(expr, size: size))
        out.append(plain(")", size: size))
        return out
    }

    private static func binary(_ op: String, _ left: WLExpr, _ right: WLExpr, size: CGFloat) -> AttributedString {
        switch op {
        case "^":
            var out = fenced(left, size: size, level: 5)
            out.append(script(render(right, size: size), size: size, raised: true))
            return out
        case "*":
            var out = fenced(left, size: size, level: 4)
            out.append(plain("\u{2009}", size: size))     // a thin space, the way maths multiplies
            out.append(fenced(right, size: size, level: 5))
            return out
        case "/":
            var out = fenced(left, size: size, level: 4)
            out.append(plain("/", size: size))
            out.append(fenced(right, size: size, level: 5))
            return out
        default:
            let level = WLParser.precedence(op)
            var out = fenced(left, size: size, level: level)
            out.append(plain(" \(MathSymbols.relations[op] ?? op) ", size: size))
            out.append(fenced(right, size: size, level: level + 1))
            return out
        }
    }

    private static func call(_ expr: WLExpr, size: CGFloat) -> AttributedString {
        guard let (name, args) = expr.application else {
            if case .call(let head, let args) = expr {
                var out = render(head, size: size)
                out.append(arguments(args, size: size))
                return out
            }
            return plain("?", size: size)
        }

        switch (name, args.count) {
        case ("Integrate", 2):
            var out = plain("∫", size: size * 1.3)
            if case .list(let bounds) = args[1], bounds.count == 3 {
                out.append(script(render(bounds[1], size: size), size: size, raised: false))
                out.append(script(render(bounds[2], size: size), size: size, raised: true))
                out.append(plain(" ", size: size))
                out.append(render(args[0], size: size))
                out.append(differential(bounds[0], size: size))
            } else {
                out.append(plain(" ", size: size))
                out.append(render(args[0], size: size))
                out.append(differential(args[1], size: size))
            }
            return out

        case ("Sum", 2), ("Product", 2):
            var out = plain(name == "Sum" ? "∑" : "∏", size: size * 1.25)
            if case .list(let bounds) = args[1], bounds.count >= 2 {
                var lower = render(bounds[0], size: size)
                lower.append(plain("=", size: size))
                lower.append(render(bounds[1], size: size))
                out.append(script(lower, size: size, raised: false))
                if bounds.count >= 3 {
                    out.append(script(render(bounds[2], size: size), size: size, raised: true))
                }
            }
            out.append(plain(" ", size: size))
            out.append(fenced(args[0], size: size, level: 3))
            return out

        case ("Sqrt", 1):
            var out = plain("√", size: size)
            out.append(bracketed(args[0], size: size))
            return out

        case ("Abs", 1):
            var out = plain("|", size: size)
            out.append(render(args[0], size: size))
            out.append(plain("|", size: size))
            return out

        case ("Limit", 2):
            var out = plain("lim", size: size)
            out.append(script(render(args[1], size: size), size: size, raised: false))
            out.append(plain(" ", size: size))
            out.append(fenced(args[0], size: size, level: 3))
            return out

        case ("D", 2):
            // ∂f/∂x — a partial, because D over a function of several
            // variables is what a page of notes means by it. `{x, n}` in the
            // second slot is the nth derivative.
            if case .list(let parts) = args[1], parts.count == 2 {
                var out = plain("∂", size: size)
                out.append(script(render(parts[1], size: size), size: size, raised: true))
                out.append(fenced(args[0], size: size, level: 5))
                out.append(plain("/∂", size: size))
                out.append(render(parts[0], size: size))
                out.append(script(render(parts[1], size: size), size: size, raised: true))
                return out
            }
            var out = plain("∂", size: size)
            out.append(fenced(args[0], size: size, level: 5))
            out.append(plain("/∂", size: size))
            out.append(render(args[1], size: size))
            return out

        case ("D", 3):
            var out = plain("∂", size: size)
            out.append(script(plain("2", size: size), size: size, raised: true))
            out.append(fenced(args[0], size: size, level: 5))
            out.append(plain("/∂", size: size))
            out.append(render(args[1], size: size))
            out.append(plain("∂", size: size))
            out.append(render(args[2], size: size))
            return out

        case ("Dt", 2):
            var out = plain("d", size: size)
            out.append(fenced(args[0], size: size, level: 5))
            out.append(plain("/d", size: size))
            out.append(render(args[1], size: size))
            return out

        case ("Grad", _), ("Laplacian", _), ("Div", _), ("Curl", _):
            var out = plain("∇", size: size)
            if name == "Laplacian" { out.append(script(plain("2", size: size), size: size, raised: true)) }
            if name == "Div" { out.append(plain("·", size: size)) }
            if name == "Curl" { out.append(plain("×", size: size)) }
            out.append(plain("\u{2009}", size: size))
            out.append(fenced(args.first ?? .symbol("f"), size: size, level: 5))
            return out

        case ("ContourIntegrate", 2):
            var out = plain("∮", size: size * 1.3)
            out.append(plain(" ", size: size))
            out.append(render(args[0], size: size))
            out.append(differential(args[1], size: size))
            return out

        case ("Integrate", 3), ("Integrate", 4):
            // A double or triple integral: one sign per variable.
            var out = plain(String(repeating: "∫", count: args.count - 1), size: size * 1.3)
            out.append(plain(" ", size: size))
            out.append(render(args[0], size: size))
            for bound in args.dropFirst() {
                if case .list(let parts) = bound, let variable = parts.first {
                    out.append(differential(variable, size: size))
                }
            }
            return out

        case ("Series", 2):
            var out = plain("series ", size: size)
            out.append(render(args[0], size: size))
            return out

        case ("Limit", 3):
            // The third argument is a Direction rule: a little + or − on the
            // approach says which side it comes from.
            var out = plain("lim", size: size)
            var under = render(args[1], size: size)
            if case .binary("->", _, .text(let direction)) = args[2] {
                under.append(plain(direction == "FromBelow" ? "⁻" : "⁺", size: size))
            }
            out.append(script(under, size: size, raised: false))
            out.append(plain(" ", size: size))
            out.append(fenced(args[0], size: size, level: 3))
            return out

        case ("Subscript", 2):
            var out = render(args[0], size: size)
            out.append(script(render(args[1], size: size), size: size, raised: false))
            return out

        case ("Exp", 1):
            var out = plain("e", size: size, italic: true)
            out.append(script(render(args[0], size: size), size: size, raised: true))
            return out

        case ("Log", 2):
            var out = plain("log", size: size)
            out.append(script(render(args[0], size: size), size: size, raised: false))
            out.append(plain(" ", size: size))
            out.append(bracketed(args[1], size: size))
            return out

        case ("Binomial", 2):
            var out = plain("C", size: size)
            out.append(script(render(args[0], size: size), size: size, raised: true))
            out.append(script(render(args[1], size: size), size: size, raised: false))
            return out

        case ("Factorial", 1):
            var out = fenced(args[0], size: size, level: 5)
            out.append(plain("!", size: size))
            return out

        default:
            if let short = MathSymbols.functions[name], args.count == 1 {
                var out = plain(short, size: size)
                out.append(plain("\u{2009}", size: size))
                out.append(bracketed(args[0], size: size))
                return out
            }
            var out = plain(name, size: size)
            out.append(arguments(args, size: size))
            return out
        }
    }

    /// `dx`, with the d upright and the variable italic.
    private static func differential(_ variable: WLExpr, size: CGFloat) -> AttributedString {
        var out = plain(" d", size: size)
        out.append(render(variable, size: size))
        return out
    }

    /// Brackets only where they are needed to read it right.
    private static func bracketed(_ expr: WLExpr, size: CGFloat) -> AttributedString {
        guard !expr.isAtom else { return render(expr, size: size) }
        var out = plain("(", size: size)
        out.append(render(expr, size: size))
        out.append(plain(")", size: size))
        return out
    }

    private static func arguments(_ args: [WLExpr], size: CGFloat) -> AttributedString {
        var out = plain("(", size: size)
        for (index, arg) in args.enumerated() {
            if index > 0 { out.append(plain(", ", size: size)) }
            out.append(render(arg, size: size))
        }
        out.append(plain(")", size: size))
        return out
    }
}

/// How maths is spelled in a note: WL inside a code span for a line of prose,
/// and a `wl` fence for maths on its own. Both are ordinary markdown, so a
/// note still opens anywhere.
enum MathMarkup {
    static let inlinePrefix = "wl:"
    static let fence = "wl"

    static func inline(_ wl: String) -> String { "`" + inlinePrefix + wl + "`" }
    static func block(_ wl: String) -> String { "```" + fence + "\n" + wl + "\n```" }

    /// The WL inside a code span, or nil when the span is just code.
    static func expression(inCode text: String) -> String? {
        guard text.hasPrefix(inlinePrefix) else { return nil }
        let expression = String(text.dropFirst(inlinePrefix.count)).trimmingCharacters(in: .whitespaces)
        return expression.isEmpty ? nil : expression
    }

    /// Only `wl` is maths. `wolfram` used to be an alias for it and is now
    /// a CODE language, set in monospace and coloured (Sean, 2026-09-19:
    /// "make sure to support c, cpp, wolfram, python, typescript code
    /// blocks") — the maths button has always written `wl`.
    static func isMathFence(_ language: String?) -> Bool {
        language?.lowercased() == fence
    }
}
