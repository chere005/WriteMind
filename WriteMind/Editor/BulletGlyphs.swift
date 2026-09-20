import AppKit

/// Shows a list's `- ` as a round bullet without changing a character of the
/// markdown (Sean, 2026-09-18: "it should be a round bullet icon"). TextKit 1
/// asks its delegate before it generates glyphs; the dash at the head of a
/// bullet line gets the bullet's glyph from the same font, and the file on
/// disk keeps its dash.
final class BulletGlyphs: NSObject, NSLayoutManagerDelegate {
    func layoutManager(_ layoutManager: NSLayoutManager, shouldGenerateGlyphs glyphs: UnsafePointer<CGGlyph>,
                       properties: UnsafePointer<NSLayoutManager.GlyphProperty>,
                       characterIndexes: UnsafePointer<Int>, font: NSFont,
                       forGlyphRange glyphRange: NSRange) -> Int {
        guard let storage = layoutManager.textStorage else { return 0 }
        let text = storage.string as NSString
        var replaced: [CGGlyph]?
        for index in 0..<glyphRange.length {
            let character = characterIndexes[index]
            guard character < text.length, let glyph = Self.markerGlyph(at: character, in: text, font: font)
            else { continue }
            if replaced == nil {
                replaced = Array(UnsafeBufferPointer(start: glyphs, count: glyphRange.length))
            }
            replaced?[index] = glyph
        }
        guard let replaced else { return 0 }   // 0: generate the glyphs as usual
        replaced.withUnsafeBufferPointer { buffer in
            layoutManager.setGlyphs(buffer.baseAddress!, properties: properties,
                                    characterIndexes: characterIndexes, font: font, forGlyphRange: glyphRange)
        }
        return glyphRange.length
    }

    /// The glyph a list marker is shown with: `-` as a round bullet, `*` as
    /// a dash (Sean, 2026-09-19: "dots or dashes"); nil for any other
    /// character, or for a dash or star that is not a marker.
    static func markerGlyph(at index: Int, in text: NSString, font: NSFont) -> CGGlyph? {
        let character = text.character(at: index)
        guard character == 0x2D || character == 0x2A, isBulletMarker(at: index, in: text) else { return nil }
        return glyph(for: character == 0x2D ? 0x2022 : 0x2013, in: font)
    }

    /// A dash or a star that is the marker of a list line: first on its
    /// line after any indentation, and followed by a space.
    static func isBulletMarker(at index: Int, in text: NSString) -> Bool {
        guard index + 1 < text.length, text.character(at: index) == 0x2D || text.character(at: index) == 0x2A,
              text.character(at: index + 1) == 0x20
        else { return false }
        var cursor = index - 1
        while cursor >= 0 {
            let character = text.character(at: cursor)
            if character == 0x0A { break }
            if character != 0x20, character != 0x09 { return false }
            cursor -= 1
        }
        return true
    }

    static func bulletGlyph(in font: NSFont) -> CGGlyph { glyph(for: 0x2022, in: font) }

    static func glyph(for character: UniChar, in font: NSFont) -> CGGlyph {
        var characters: [UniChar] = [character]
        var glyphs: [CGGlyph] = [0]
        if CTFontGetGlyphsForCharacters(font as CTFont, &characters, &glyphs, 1) { return glyphs[0] }
        return 0
    }
}
