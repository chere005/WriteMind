import SwiftUI

/// Maths on a line of its own, set in two dimensions: fractions stack, ∑ and
/// ∏ carry their bounds above and below, a root gets its roof. Anything that
/// reads properly on one line is handed to the inline typesetter, so this only
/// holds the shapes that need the extra dimension.
struct MathView: View {
    let source: String
    var size: CGFloat = 19

    var body: some View {
        if let expr = WLParser.parse(source) {
            MathExpressionView(expr: expr, size: size)
        } else {
            // Half-typed maths is still the user's text: show it as it stands.
            Text(source)
                .font(.system(size: size, design: .monospaced))
                .foregroundStyle(.secondary)
        }
    }
}

struct MathExpressionView: View {
    let expr: WLExpr
    var size: CGFloat = 19

    var body: some View {
        switch expr {
        case .binary("/", let top, let bottom):
            MathFraction(top: MathExpressionView(expr: top, size: size),
                         bottom: MathExpressionView(expr: bottom, size: size))
        case .binary("^", let base, let power):
            HStack(alignment: .top, spacing: 0) {
                MathGroup(expr: base, size: size, bracketsBelow: 5)
                MathExpressionView(expr: power, size: size * 0.68)
                    .padding(.bottom, size * 0.42)
            }
        case .binary(let op, let left, let right):
            HStack(alignment: .firstTextBaseline, spacing: op == "*" ? size * 0.12 : size * 0.22) {
                MathGroup(expr: left, size: size, bracketsBelow: WLParser.precedence(op))
                if op != "*" {
                    Text(MathSymbols.relations[op] ?? op)
                        .font(.system(size: size, design: .serif))
                }
                MathGroup(expr: right, size: size, bracketsBelow: WLParser.precedence(op) + 1)
            }
        case .negate(let operand):
            HStack(spacing: 1) {
                Text("−").font(.system(size: size, design: .serif))
                MathGroup(expr: operand, size: size, bracketsBelow: 4)
            }
        case .list(let items) where items.count > 1 && items.allSatisfy(MathExpressionView.isRow):
            MathMatrix(rows: items, size: size)
        case .call:
            MathCall(expr: expr, size: size)
        default:
            Text(MathTypesetter.render(expr, size: size))
        }
    }

    static func isRow(_ expr: WLExpr) -> Bool {
        if case .list = expr { return true }
        return false
    }
}

/// One thing over another, with the bar between them.
private struct MathFraction<Top: View, Bottom: View>: View {
    let top: Top
    let bottom: Bottom

    var body: some View {
        VStack(spacing: 2) {
            top
            Rectangle().frame(height: 1)
            bottom
        }
        .fixedSize()
        .padding(.horizontal, 2)
    }
}

/// Brackets, but only where the reading needs them — a stacked fraction is
/// its own bracket.
private struct MathGroup: View {
    let expr: WLExpr
    let size: CGFloat
    let bracketsBelow: Int

    private var needsBrackets: Bool {
        if case .binary(let op, _, _) = expr {
            if op == "/" { return false }
            return WLParser.precedence(op) < bracketsBelow
        }
        if case .negate = expr { return bracketsBelow > 3 }
        return false
    }

    var body: some View {
        if needsBrackets {
            HStack(spacing: 0) {
                MathFence(glyph: "(", size: size)
                MathExpressionView(expr: expr, size: size)
                MathFence(glyph: ")", size: size)
            }
        } else {
            MathExpressionView(expr: expr, size: size)
        }
    }
}

/// A bracket that grows with what it holds.
private struct MathFence: View {
    let glyph: String
    let size: CGFloat

    var body: some View {
        Text(glyph)
            .font(.system(size: size * 1.15, design: .serif))
            .foregroundStyle(.primary)
    }
}

private struct MathCall: View {
    let expr: WLExpr
    let size: CGFloat

    var body: some View {
        if let (name, args) = expr.application {
            switch (name, args.count) {
            case ("Integrate", 2):
                MathIntegral(integrand: args[0], bounds: args[1], size: size)
            case ("Sum", 2):
                MathBigOperator(glyph: "∑", term: args[0], bounds: args[1], size: size)
            case ("Product", 2):
                MathBigOperator(glyph: "∏", term: args[0], bounds: args[1], size: size)
            case ("Divide", 2):
                MathFraction(top: MathExpressionView(expr: args[0], size: size),
                             bottom: MathExpressionView(expr: args[1], size: size))
            case ("Sqrt", 1):
                MathRadical(term: args[0], size: size)
            case ("Abs", 1):
                HStack(spacing: 1) {
                    MathFence(glyph: "|", size: size)
                    MathExpressionView(expr: args[0], size: size)
                    MathFence(glyph: "|", size: size)
                }
            case ("D", 2):
                if case .list(let parts) = args[1], parts.count == 2 {
                    // D[f, {x, n}] — the nth derivative, with its order over
                    // both the ∂s.
                    MathFraction(top: MathOrderedDifferential(glyph: "∂", expr: args[0],
                                                              order: parts[1], size: size),
                                 bottom: MathOrderedDifferential(glyph: "∂", expr: parts[0],
                                                                 order: parts[1], size: size))
                } else {
                    MathFraction(top: MathDifferential(glyph: "∂", expr: args[0], size: size),
                                 bottom: MathDifferential(glyph: "∂", expr: args[1], size: size))
                }
            case ("D", 3):
                // A mixed partial: ∂²f over ∂x ∂y.
                MathFraction(top: MathOrderedDifferential(glyph: "∂", expr: args[0],
                                                          order: .number("2"), size: size),
                             bottom: HStack(spacing: 2) {
                                 MathDifferential(glyph: "∂", expr: args[1], size: size)
                                 MathDifferential(glyph: "∂", expr: args[2], size: size)
                             })
            case ("Dt", 2):
                MathFraction(top: MathDifferential(glyph: "d", expr: args[0], size: size),
                             bottom: MathDifferential(glyph: "d", expr: args[1], size: size))
            case ("Integrate", 3), ("Integrate", 4):
                MathMultipleIntegral(integrand: args[0], bounds: Array(args.dropFirst()), size: size)
            case ("ContourIntegrate", 2):
                HStack(alignment: .center, spacing: 2) {
                    Text("∮").font(.system(size: size * 2, design: .serif))
                    MathExpressionView(expr: args[0], size: size)
                    MathDifferential(glyph: "d", expr: args[1], size: size)
                }
            case ("Grad", _), ("Div", _), ("Curl", _), ("Laplacian", _):
                MathVectorOperator(name: name, operand: args.first ?? .symbol("f"), size: size)
            case ("Limit", 3):
                MathLimit(term: args[0], approach: args[1], direction: args[2], size: size)
            case ("Limit", 2):
                MathLimit(term: args[0], approach: args[1], size: size)
            case ("Binomial", 2):
                HStack(spacing: 0) {
                    MathFence(glyph: "(", size: size * 1.4)
                    VStack(spacing: 0) {
                        MathExpressionView(expr: args[0], size: size * 0.9)
                        MathExpressionView(expr: args[1], size: size * 0.9)
                    }
                    MathFence(glyph: ")", size: size * 1.4)
                }
            default:
                MathFunction(name: name, args: args, size: size)
            }
        } else {
            Text(MathTypesetter.render(expr, size: size))
        }
    }
}

/// ∫ with its bounds beside it, which is where an integral wants them.
private struct MathIntegral: View {
    let integrand: WLExpr
    let bounds: WLExpr
    let size: CGFloat

    var body: some View {
        HStack(alignment: .center, spacing: 2) {
            Text("∫").font(.system(size: size * 2, design: .serif))
            if case .list(let parts) = bounds, parts.count == 3 {
                VStack(alignment: .leading, spacing: size * 0.55) {
                    MathExpressionView(expr: parts[2], size: size * 0.62)
                    MathExpressionView(expr: parts[1], size: size * 0.62)
                }
                MathExpressionView(expr: integrand, size: size)
                MathDifferential(glyph: "d", expr: parts[0], size: size)
            } else {
                MathExpressionView(expr: integrand, size: size)
                MathDifferential(glyph: "d", expr: bounds, size: size)
            }
        }
    }
}

/// ∑ and ∏: the index below, the top of the range above.
private struct MathBigOperator: View {
    let glyph: String
    let term: WLExpr
    let bounds: WLExpr
    let size: CGFloat

    var body: some View {
        HStack(alignment: .center, spacing: 4) {
            VStack(spacing: 0) {
                if case .list(let parts) = bounds, parts.count >= 3 {
                    MathExpressionView(expr: parts[2], size: size * 0.6)
                }
                Text(glyph).font(.system(size: size * 1.8, design: .serif))
                if case .list(let parts) = bounds, parts.count >= 2 {
                    HStack(spacing: 1) {
                        MathExpressionView(expr: parts[0], size: size * 0.6)
                        Text("=").font(.system(size: size * 0.6, design: .serif))
                        MathExpressionView(expr: parts[1], size: size * 0.6)
                    }
                }
            }
            MathGroup(expr: term, size: size, bracketsBelow: 3)
        }
    }
}

private struct MathRadical: View {
    let term: WLExpr
    let size: CGFloat

    var body: some View {
        HStack(alignment: .top, spacing: 0) {
            Text("√").font(.system(size: size * 1.25, design: .serif))
            MathExpressionView(expr: term, size: size)
                .padding(.top, 3)
                .padding(.horizontal, 2)
                .overlay(alignment: .top) { Rectangle().frame(height: 1) }
        }
    }
}

/// `dx`, `∂f` — the operator upright, what it applies to as it is.
private struct MathDifferential: View {
    let glyph: String
    let expr: WLExpr
    let size: CGFloat

    var body: some View {
        HStack(spacing: 1) {
            Text(glyph).font(.system(size: size, design: .serif))
            MathExpressionView(expr: expr, size: size)
        }
    }
}

private struct MathLimit: View {
    let term: WLExpr
    let approach: WLExpr
    /// `Direction -> "FromAbove"`, when the limit has a side.
    var direction: WLExpr?
    let size: CGFloat

    private var sign: String? {
        guard case .binary("->", _, .text(let which))? = direction else { return nil }
        return which == "FromBelow" ? "\u{207B}" : "\u{207A}"
    }

    var body: some View {
        HStack(alignment: .center, spacing: 5) {
            VStack(spacing: 0) {
                Text("lim").font(.system(size: size, design: .serif))
                HStack(spacing: 0) {
                    MathExpressionView(expr: approach, size: size * 0.6)
                    if let sign {
                        Text(sign).font(.system(size: size * 0.6, design: .serif))
                    }
                }
            }
            MathGroup(expr: term, size: size, bracketsBelow: 3)
        }
    }
}

/// ∂ⁿf — the operator, its order, and what it applies to.
private struct MathOrderedDifferential: View {
    let glyph: String
    let expr: WLExpr
    let order: WLExpr
    let size: CGFloat

    var body: some View {
        HStack(alignment: .top, spacing: 1) {
            Text(glyph).font(.system(size: size, design: .serif))
            MathExpressionView(expr: order, size: size * 0.62)
                .padding(.bottom, size * 0.3)
            MathExpressionView(expr: expr, size: size)
                .padding(.top, size * 0.14)
        }
    }
}

/// ∬ and ∭: one sign per variable, then the integrand and its differentials.
private struct MathMultipleIntegral: View {
    let integrand: WLExpr
    let bounds: [WLExpr]
    let size: CGFloat

    var body: some View {
        HStack(alignment: .center, spacing: 2) {
            ForEach(Array(bounds.enumerated()), id: \.offset) { _, bound in
                HStack(alignment: .center, spacing: 1) {
                    Text("∫").font(.system(size: size * 2, design: .serif))
                    if case .list(let parts) = bound, parts.count == 3 {
                        VStack(alignment: .leading, spacing: size * 0.55) {
                            MathExpressionView(expr: parts[2], size: size * 0.62)
                            MathExpressionView(expr: parts[1], size: size * 0.62)
                        }
                    }
                }
            }
            MathExpressionView(expr: integrand, size: size)
            ForEach(Array(bounds.enumerated()), id: \.offset) { _, bound in
                if case .list(let parts) = bound, let variable = parts.first {
                    MathDifferential(glyph: "d", expr: variable, size: size)
                }
            }
        }
    }
}

/// ∇f, ∇·F, ∇×F, ∇²f.
private struct MathVectorOperator: View {
    let name: String
    let operand: WLExpr
    let size: CGFloat

    var body: some View {
        HStack(alignment: .center, spacing: 2) {
            HStack(alignment: .top, spacing: 0) {
                Text("∇").font(.system(size: size, design: .serif))
                if name == "Laplacian" {
                    Text("2").font(.system(size: size * 0.62, design: .serif))
                        .padding(.bottom, size * 0.3)
                }
            }
            if name == "Div" { Text("·").font(.system(size: size, design: .serif)) }
            if name == "Curl" { Text("×").font(.system(size: size * 0.8, design: .serif)) }
            MathGroup(expr: operand, size: size, bracketsBelow: 5)
        }
    }
}

/// `sin x`, `f(x, y)` — the name upright, the arguments set properly.
private struct MathFunction: View {
    let name: String
    let args: [WLExpr]
    let size: CGFloat

    var body: some View {
        HStack(alignment: .center, spacing: 2) {
            Text(MathSymbols.functions[name] ?? MathSymbols.glyph(for: name))
                .font(.system(size: size, design: .serif))
            if !args.isEmpty {
                MathFence(glyph: "(", size: size)
                ForEach(Array(args.enumerated()), id: \.offset) { index, arg in
                    if index > 0 {
                        Text(",").font(.system(size: size, design: .serif))
                    }
                    MathExpressionView(expr: arg, size: size)
                }
                MathFence(glyph: ")", size: size)
            }
        }
    }
}

private struct MathMatrix: View {
    let rows: [WLExpr]
    let size: CGFloat

    var body: some View {
        HStack(spacing: 2) {
            MathFence(glyph: "(", size: size * 2)
            Grid(alignment: .center, horizontalSpacing: size * 0.7, verticalSpacing: size * 0.35) {
                ForEach(Array(rows.enumerated()), id: \.offset) { _, row in
                    GridRow {
                        if case .list(let cells) = row {
                            ForEach(Array(cells.enumerated()), id: \.offset) { _, cell in
                                MathExpressionView(expr: cell, size: size)
                            }
                        }
                    }
                }
            }
            MathFence(glyph: ")", size: size * 2)
        }
    }
}
