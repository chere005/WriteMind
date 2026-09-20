import AppKit
import SwiftUI

/// One palette for code, wherever it is shown — the source editor's fenced
/// blocks and the preview's. Every colour is given TWICE, once for the light
/// appearance and once for the dark one, and is read at the moment it is
/// drawn: a system accent colour can be yellow, and yellow on white is not
/// text anybody can read (Sean, 2026-09-19: "be mindful of text color... it
/// should always be visible against the background"). These are the pairs
/// Xcode itself uses, which clear 4.5:1 against the backgrounds the blocks
/// are drawn on.
enum CodeColours {
    static func colour(for kind: CodeToken.Kind) -> NSColor {
        switch kind {
        case .keyword: return pair(light: 0xAD3DA4, dark: 0xFF7AB2)
        case .type: return pair(light: 0x2D6E74, dark: 0x5DD8FF)
        case .string: return pair(light: 0xC41A16, dark: 0xFF8170)
        case .comment: return pair(light: 0x5D6C79, dark: 0x8E9AA6)
        case .number: return pair(light: 0x1C00CF, dark: 0xD9C97C)
        case .function: return pair(light: 0x4B21B0, dark: 0xDABAFF)
        case .symbol: return .labelColor
        }
    }

    /// A colour that answers the appearance it is asked in.
    static func pair(light: Int, dark: Int) -> NSColor {
        NSColor(name: nil) { appearance in
            let isDark = appearance.bestMatch(from: [.aqua, .darkAqua]) == .darkAqua
            return rgb(isDark ? dark : light)
        }
    }

    static func rgb(_ value: Int) -> NSColor {
        NSColor(srgbRed: Double((value >> 16) & 0xFF) / 255,
                green: Double((value >> 8) & 0xFF) / 255,
                blue: Double(value & 0xFF) / 255,
                alpha: 1)
    }

    /// What a code block is drawn on, in both appearances — the same tint in
    /// the editor's gutter-less source and in the preview.
    static let background = Color(nsColor: NSColor(name: nil) { appearance in
        appearance.bestMatch(from: [.aqua, .darkAqua]) == .darkAqua
            ? NSColor(white: 1, alpha: 0.07)
            : NSColor(white: 0, alpha: 0.05)
    })

    /// The same colours, straight onto a text storage — the code block
    /// being typed in.
    static func style(_ storage: NSTextStorage, language: CodeLanguage, font: NSFont,
                      paragraph: NSParagraphStyle) {
        let whole = NSRange(location: 0, length: storage.length)
        storage.beginEditing()
        storage.setAttributes([.font: font, .foregroundColor: NSColor.labelColor,
                               .paragraphStyle: paragraph], range: whole)
        for token in CodeHighlighter.tokens(in: storage.string, language: language) {
            let range = NSIntersectionRange(token.range, whole)
            guard range.length > 0 else { continue }
            storage.addAttribute(.foregroundColor, value: colour(for: token.kind), range: range)
        }
        storage.endEditing()
    }

    /// The code set in the preview: monospaced, with the same colours.
    static func attributed(_ code: String, language: CodeLanguage, size: CGFloat = 13) -> AttributedString {
        let text = code as NSString
        let font = NSFont.monospacedSystemFont(ofSize: size, weight: .regular)
        let whole = NSMutableAttributedString(string: code, attributes: [
            .font: font, .foregroundColor: NSColor.labelColor
        ])
        for token in CodeHighlighter.tokens(in: code, language: language) {
            let range = NSIntersectionRange(token.range, NSRange(location: 0, length: text.length))
            guard range.length > 0 else { continue }
            whole.addAttribute(.foregroundColor, value: colour(for: token.kind), range: range)
            if token.kind == .comment,
               let italic = NSFontManager.shared.convert(font, toHaveTrait: .italicFontMask) as NSFont? {
                whole.addAttribute(.font, value: italic, range: range)
            }
        }
        return AttributedString(whole)
    }
}
