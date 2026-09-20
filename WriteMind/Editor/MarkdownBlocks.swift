import AppKit
import SwiftUI
import Foundation

/// The block structure of a markdown document — enough for notes, not a spec.
enum MarkdownBlock: Equatable {
    case heading(level: Int, text: String)
    case paragraph(String)
    case bullets([String])
    /// A list written with `* `, shown with a dash (Sean, 2026-09-19: "picks
    /// dots or dashes or numbered"). Ordinary markdown either way.
    case dashes([String])
    case numbered([String])
    case quote(String)
    case code(language: String?, body: String)
    case rule
    /// A GFM table. Whether it is drawn with grid lines is in the writing
    /// itself — see MarkdownTable.
    case table(MarkdownTable)
}

/// A block and the slice of source it was parsed from — the range is what
/// makes editing the rendered preview possible: a block is written back over
/// its own source and nothing else is touched.
struct PositionedBlock: Equatable, Identifiable {
    let block: MarkdownBlock
    let range: NSRange
    var id: Int { range.location }
}

enum MarkdownParser {
    static func blocks(from markdown: String) -> [MarkdownBlock] {
        positioned(from: markdown).map(\.block)
    }

    static func positioned(from markdown: String) -> [PositionedBlock] {
        var blocks: [PositionedBlock] = []
        var paragraph: [String] = []
        var bullets: [String] = []
        var dashes: [String] = []
        var numbered: [String] = []
        var quote: [String] = []
        var code: [String]?
        var codeLanguage: String?
        var table: [String]?

        // Where the open block started, and where the last line of it ended.
        var blockStart = 0
        var blockEnd = 0
        var lineStart = 0

        func emit(_ block: MarkdownBlock) {
            blocks.append(PositionedBlock(block: block, range: NSRange(location: blockStart, length: blockEnd - blockStart)))
        }

        func flush() {
            if !paragraph.isEmpty { emit(.paragraph(paragraph.joined(separator: " "))); paragraph = [] }
            if !bullets.isEmpty { emit(.bullets(bullets)); bullets = [] }
            if !dashes.isEmpty { emit(.dashes(dashes)); dashes = [] }
            if !numbered.isEmpty { emit(.numbered(numbered)); numbered = [] }
            if !quote.isEmpty { emit(.quote(quote.joined(separator: " "))); quote = [] }
            if let open = table, let parsed = MarkdownTable.parse(open) { emit(.table(parsed)) }
            table = nil
        }

        /// The first line of a block sets its start; every line extends its end.
        func openIfNeeded() {
            if paragraph.isEmpty && bullets.isEmpty && dashes.isEmpty && numbered.isEmpty
                && quote.isEmpty && code == nil && table == nil {
                blockStart = lineStart
            }
        }

        let allLines = markdown.components(separatedBy: .newlines)
        for (lineIndex, rawLine) in allLines.enumerated() {
            defer { lineStart += (rawLine as NSString).length + 1 }
            let lineEnd = lineStart + (rawLine as NSString).length
            // A blank line ends a block without being part of it, so only the
            // lines that go INTO a block move its end (a paragraph's range
            // stops at its last character, not at the newline after it).
            if !rawLine.trimmingCharacters(in: .whitespaces).isEmpty || code != nil {
                blockEnd = lineEnd
            }
            if var open = code {
                if rawLine.trimmingCharacters(in: .whitespaces).hasPrefix("```") {
                    emit(.code(language: codeLanguage, body: open.joined(separator: "\n")))
                    code = nil
                    codeLanguage = nil
                } else {
                    open.append(rawLine)
                    code = open
                }
                continue
            }

            let line = rawLine.trimmingCharacters(in: .whitespaces)

            // A table runs while its lines keep pipes in them. It opens on a
            // row whose NEXT line is the `---` rule that makes it a header,
            // which is the one place this parser looks ahead.
            if var open = table {
                if !line.isEmpty, MarkdownTable.isRow(line) {
                    open.append(line)
                    table = open
                    continue
                }
                flush()
            }
            if !line.isEmpty, MarkdownTable.isRow(line), lineIndex + 1 < allLines.count,
               MarkdownTable.isSeparator(allLines[lineIndex + 1].trimmingCharacters(in: .whitespaces)) {
                flush()
                blockStart = lineStart
                table = [line]
                continue
            }

            if line.hasPrefix("```") {
                flush()
                blockStart = lineStart
                let lang = line.dropFirst(3).trimmingCharacters(in: .whitespaces)
                codeLanguage = lang.isEmpty ? nil : lang
                code = []
                continue
            }
            if line.isEmpty { flush(); continue }
            if isRule(line) { flush(); blockStart = lineStart; emit(.rule); continue }
            if let (level, text) = heading(line) {
                flush(); blockStart = lineStart; emit(.heading(level: level, text: text)); continue
            }
            if line.hasPrefix(">") {
                if !paragraph.isEmpty || !bullets.isEmpty || !dashes.isEmpty || !numbered.isEmpty { flush() }
                openIfNeeded()
                quote.append(line.dropFirst().trimmingCharacters(in: .whitespaces))
                continue
            }
            if let item = bulletItem(line) {
                if !paragraph.isEmpty || !dashes.isEmpty || !numbered.isEmpty || !quote.isEmpty { flush() }
                openIfNeeded()
                bullets.append(item)
                continue
            }
            if let item = dashItem(line) {
                if !paragraph.isEmpty || !bullets.isEmpty || !numbered.isEmpty || !quote.isEmpty { flush() }
                openIfNeeded()
                dashes.append(item)
                continue
            }
            if let item = numberedItem(line) {
                if !paragraph.isEmpty || !bullets.isEmpty || !dashes.isEmpty || !quote.isEmpty { flush() }
                openIfNeeded()
                numbered.append(item)
                continue
            }
            if !bullets.isEmpty || !dashes.isEmpty || !numbered.isEmpty || !quote.isEmpty { flush() }
            openIfNeeded()
            paragraph.append(line)
        }

        if let open = code {
            // An unclosed fence still renders as code — better than swallowing the rest of the note.
            emit(.code(language: codeLanguage, body: open.joined(separator: "\n")))
        }
        flush()
        return blocks
    }

    // MARK: - Line classifiers

    static func heading(_ line: String) -> (Int, String)? {
        let hashes = line.prefix { $0 == "#" }
        guard (1...6).contains(hashes.count) else { return nil }
        let rest = line.dropFirst(hashes.count)
        guard rest.first == " " || rest.isEmpty else { return nil }
        return (hashes.count, rest.trimmingCharacters(in: .whitespaces))
    }

    static func isRule(_ line: String) -> Bool {
        let compact = line.replacingOccurrences(of: " ", with: "")
        guard compact.count >= 3 else { return false }
        return compact.allSatisfy { $0 == "-" } || compact.allSatisfy { $0 == "*" } || compact.allSatisfy { $0 == "_" }
    }

    /// A dot bullet: `- ` or `+ `.
    static func bulletItem(_ line: String) -> String? {
        for marker in ["- ", "+ "] where line.hasPrefix(marker) {
            return String(line.dropFirst(2))
        }
        return nil
    }

    /// A dash bullet: `* `.
    static func dashItem(_ line: String) -> String? {
        line.hasPrefix("* ") ? String(line.dropFirst(2)) : nil
    }

    static func numberedItem(_ line: String) -> String? {
        let digits = line.prefix { $0.isNumber }
        guard !digits.isEmpty, digits.count <= 4 else { return nil }
        let rest = line.dropFirst(digits.count)
        guard rest.hasPrefix(". ") || rest.hasPrefix(") ") else { return nil }
        return String(rest.dropFirst(2))
    }
}

/// Inline markdown (`**bold**`, `_italic_`, `` `code` ``, links) plus the two
/// HTML tags the toolbar writes: `<u>` from the underline button and
/// `<span style="…">` from the text-style menu.
enum MarkdownInline {
    static func attributed(_ source: String, baseSize: CGFloat = 15) -> AttributedString {
        var result = AttributedString()
        var stack: [Style] = []

        for token in tokenize(source) {
            switch token {
            case .open(let style): stack.append(style)
            case .close: if !stack.isEmpty { stack.removeLast() }
            case .text(let text):
                result.append(styled(text, with: Style.merged(stack), baseSize: baseSize))
            }
        }
        return result
    }

    struct Style: Equatable {
        var underline = false
        var family: String?
        var size: Double?
        var colorHex: String?

        static func merged(_ stack: [Style]) -> Style {
            stack.reduce(into: Style()) { out, next in
                out.underline = out.underline || next.underline
                if let family = next.family { out.family = family }
                if let size = next.size { out.size = size }
                if let hex = next.colorHex { out.colorHex = hex }
            }
        }
    }

    enum Token: Equatable { case open(Style), close, text(String) }

    /// Render one run of markdown and lay the enclosing style over it. The
    /// bold/italic the markdown itself carries survives: it comes back as an
    /// `inlinePresentationIntent`, which is read here and folded into the
    /// span's own font rather than being overwritten by it.
    static func styled(_ text: String, with style: Style, baseSize: CGFloat) -> AttributedString {
        var piece = render(text, baseSize: baseSize)
        if style.underline { piece.underlineStyle = .single }
        if let hex = style.colorHex, let colour = Color(hex: hex) { piece.foregroundColor = colour }

        if style.family != nil || style.size != nil {
            let size = style.size.map { CGFloat($0) } ?? baseSize
            for run in piece.runs {
                let intent = run.inlinePresentationIntent ?? []
                var traits: NSFontDescriptor.SymbolicTraits = []
                if intent.contains(.stronglyEmphasized) { traits.insert(.bold) }
                if intent.contains(.emphasized) { traits.insert(.italic) }
                piece[run.range].font = font(family: style.family, size: size, traits: traits)
            }
        }
        return piece
    }

    static func font(family: String?, size: CGFloat, traits: NSFontDescriptor.SymbolicTraits) -> Font {
        let base: NSFont
        if let family, let named = NSFont(name: family, size: size) ?? NSFontManager.shared
            .font(withFamily: family, traits: [], weight: 5, size: size) {
            base = named
        } else {
            base = NSFont.systemFont(ofSize: size)
        }
        guard !traits.isEmpty else { return Font(base) }
        let descriptor = base.fontDescriptor.withSymbolicTraits(traits)
        return Font(NSFont(descriptor: descriptor, size: size) ?? base)
    }

    static func render(_ text: String, baseSize: CGFloat = 15) -> AttributedString {
        let options = AttributedString.MarkdownParsingOptions(
            allowsExtendedAttributes: false,
            interpretedSyntax: .inlineOnlyPreservingWhitespace,
            failurePolicy: .returnPartiallyParsedIfPossible)
        let parsed = (try? AttributedString(markdown: text, options: options)) ?? AttributedString(text)
        return typesetMaths(in: parsed, baseSize: baseSize)
    }

    /// `` `wl:Sum[i, {i, 1, n}]` `` in a sentence comes out as maths. The runs
    /// are replaced back to front, so the ranges ahead of each one are still
    /// the ranges it was found at.
    static func typesetMaths(in string: AttributedString, baseSize: CGFloat) -> AttributedString {
        var result = string
        var replacements: [(Range<AttributedString.Index>, AttributedString)] = []
        for run in result.runs {
            guard (run.inlinePresentationIntent ?? []).contains(.code) else { continue }
            let text = String(result[run.range].characters)
            guard let source = MathMarkup.expression(inCode: text),
                  let maths = MathTypesetter.inline(source, size: baseSize) else { continue }
            replacements.append((run.range, maths))
        }
        for (range, maths) in replacements.reversed() {
            result.replaceSubrange(range, with: maths)
        }
        return result
    }

    /// Split on `<u>`, `</u>`, `<span style="…">` and `</span>`; everything
    /// else is text, including any other HTML, which stays literal.
    static func tokenize(_ source: String) -> [Token] {
        var tokens: [Token] = []
        var buffer = ""
        let ns = source as NSString
        var index = 0

        func flush() {
            if !buffer.isEmpty { tokens.append(.text(buffer)); buffer = "" }
        }

        while index < ns.length {
            let rest = ns.substring(from: index)
            if rest.hasPrefix("<u>") {
                flush(); tokens.append(.open(Style(underline: true))); index += 3
            } else if rest.hasPrefix("</u>") {
                flush(); tokens.append(.close); index += 4
            } else if rest.hasPrefix("</span>") {
                flush(); tokens.append(.close); index += 7
            } else if rest.hasPrefix("<span"), let close = rest.range(of: ">") {
                let tag = String(rest[rest.startIndex..<close.upperBound])
                flush()
                tokens.append(.open(style(fromTag: tag)))
                index += (tag as NSString).length
            } else {
                buffer.append(Character(UnicodeScalar(ns.character(at: index)) ?? " "))
                index += 1
            }
        }
        flush()
        return tokens
    }

    /// `<span style="font-family: Georgia; font-size: 18px; color: #2D7DD2">`
    static func style(fromTag tag: String) -> Style {
        var style = Style()
        guard let open = tag.range(of: "style=\""), let close = tag.range(of: "\"", range: open.upperBound..<tag.endIndex)
        else { return style }
        for declaration in tag[open.upperBound..<close.lowerBound].components(separatedBy: ";") {
            let pair = declaration.split(separator: ":", maxSplits: 1).map { $0.trimmingCharacters(in: .whitespaces) }
            guard pair.count == 2 else { continue }
            switch pair[0].lowercased() {
            case "font-family": style.family = pair[1].trimmingCharacters(in: CharacterSet(charactersIn: "\'\""))
            case "font-size": style.size = Double(pair[1].replacingOccurrences(of: "px", with: "").trimmingCharacters(in: .whitespaces))
            case "color": style.colorHex = pair[1]
            default: break
            }
        }
        return style
    }
}
