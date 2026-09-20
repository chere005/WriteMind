import AppKit

/// Live preview for the source editor, without changing a character of the
/// note: the markdown markers stay in the text storage — so the file, the
/// clipboard, undo and Find all still see them — but the layout manager is
/// told to give them a zero-advance control glyph, so they take no width and
/// paint no ink. The paragraph the caret is in keeps its markers visible, so
/// they can still be typed.
///
/// `NSLayoutManager` has ONE delegate slot, so this object does
/// `BulletGlyphs`' job in the same pass: the bullet substitution and the
/// hiding are decided per character over one buffer.
final class MarkerHiding: NSObject, NSLayoutManagerDelegate {

    /// Off puts the raw markdown back — the toggle, and the fallback.
    var isEnabled = true

    /// Every marker character in the note, the revealed paragraph aside.
    private(set) var hiddenCharacters = IndexSet()
    private var allMarkers = IndexSet()
    private(set) var revealed: NSRange?

    // MARK: - what is hidden

    /// The runs that may vanish: inline syntax only.
    ///
    /// NOT a fence line — `MarkdownSourceStyle` marks the whole ``` line as
    /// `.marker`, and hiding all of it leaves a blank full-height line
    /// rather than closing the gap. NOT `.listMarker` or `.quoteMarker`
    /// either: `BulletGlyphs` already draws those, and a list with no
    /// marker is not a list.
    static func hideable(_ runs: [MarkdownSourceStyle.Run], in text: NSString) -> [NSRange] {
        runs.compactMap { run in
            guard run.kind == .marker || run.kind == .linkURL, run.range.length > 0,
                  NSMaxRange(run.range) <= text.length
            else { return nil }
            // A run that IS its whole line (a fence, a lone `---`) stays.
            let line = text.lineRange(for: run.range)
            let content = text.substring(with: line).trimmingCharacters(in: .newlines)
            guard run.range.length < (content as NSString).length else { return nil }
            return run.range
        }
    }

    /// Call after every re-scan of the markdown.
    func setMarkers(_ markers: [NSRange]) {
        var set = IndexSet()
        for range in markers where range.length > 0 {
            set.insert(integersIn: range.location..<NSMaxRange(range))
        }
        allMarkers = set
        rebuild()
    }

    /// Move the revealed paragraph. Returns the character ranges whose
    /// glyphs the caller must invalidate — empty when nothing changed, so a
    /// caret move inside one paragraph costs nothing at all.
    func setRevealed(_ paragraph: NSRange?) -> [NSRange] {
        guard paragraph != revealed else { return [] }
        let previous = revealed
        revealed = paragraph
        rebuild()
        return [previous, paragraph].compactMap { $0 }
    }

    private func rebuild() {
        guard let revealed else { hiddenCharacters = allMarkers; return }
        var set = allMarkers
        set.remove(integersIn: revealed.location..<NSMaxRange(revealed))
        hiddenCharacters = set
    }

    @inline(__always) private func hides(_ characterIndex: Int) -> Bool {
        isEnabled && hiddenCharacters.contains(characterIndex)
    }

    /// For the arrow keys and anything else that has to step over what
    /// cannot be seen.
    func isHidden(_ characterIndex: Int) -> Bool { hides(characterIndex) }

    // MARK: - the mechanism

    func layoutManager(_ layoutManager: NSLayoutManager,
                       shouldGenerateGlyphs glyphs: UnsafePointer<CGGlyph>,
                       properties: UnsafePointer<NSLayoutManager.GlyphProperty>,
                       characterIndexes: UnsafePointer<Int>,
                       font: NSFont,
                       forGlyphRange glyphRange: NSRange) -> Int {
        // Off means OFF: no hiding and no bullet substitution either, so
        // "show the markdown" shows the markdown and renders nothing at all
        // (Sean, 2026-09-19: "it keeps trying to render when i'm in show
        // only markdown mode").
        guard isEnabled, let storage = layoutManager.textStorage else { return 0 }
        let text = storage.string as NSString
        var newGlyphs: [CGGlyph]?
        var newProperties: [NSLayoutManager.GlyphProperty]?

        for index in 0..<glyphRange.length {
            let character = characterIndexes[index]
            guard character < text.length else { continue }
            if hides(character) {
                // .controlCharacter + .zeroAdvancement: no width, no ink,
                // and — unlike .null — the caret, the word boundaries and
                // glyphRange(forCharacterRange:) all stay honest.
                if newProperties == nil {
                    newProperties = Array(UnsafeBufferPointer(start: properties, count: glyphRange.length))
                }
                newProperties?[index].insert(.controlCharacter)
            } else if let bullet = BulletGlyphs.markerGlyph(at: character, in: text, font: font) {
                if newGlyphs == nil {
                    newGlyphs = Array(UnsafeBufferPointer(start: glyphs, count: glyphRange.length))
                }
                newGlyphs?[index] = bullet
            }
        }

        guard newGlyphs != nil || newProperties != nil else { return 0 }  // 0: generate as usual
        let finalGlyphs = newGlyphs ?? Array(UnsafeBufferPointer(start: glyphs, count: glyphRange.length))
        let finalProperties = newProperties
            ?? Array(UnsafeBufferPointer(start: properties, count: glyphRange.length))
        finalGlyphs.withUnsafeBufferPointer { g in
            finalProperties.withUnsafeBufferPointer { p in
                layoutManager.setGlyphs(g.baseAddress!, properties: p.baseAddress!,
                                        characterIndexes: characterIndexes, font: font,
                                        forGlyphRange: glyphRange)
            }
        }
        return glyphRange.length
    }

    /// A marker is not really a control character, so say what it should do.
    /// (AppKit already gives an unknown control glyph zero advancement; this
    /// is what stops a hidden tab from still tabbing.)
    func layoutManager(_ layoutManager: NSLayoutManager,
                       shouldUse action: NSLayoutManager.ControlCharacterAction,
                       forControlCharacterAt charIndex: Int) -> NSLayoutManager.ControlCharacterAction {
        hides(charIndex) ? .zeroAdvancement : action
    }
}

extension NSTextView {
    /// From `textViewDidChangeSelection` and after an edit. Does nothing
    /// while the caret stays in one paragraph; when it moves, it
    /// re-generates the glyphs of the two paragraphs involved and nothing
    /// else. Never `ensureLayout(for: container)` here — that lays out the
    /// whole note.
    func updateHiddenMarkers(_ hiding: MarkerHiding) {
        guard let layoutManager, let container = textContainer else { return }
        let text = string as NSString
        let caret = min(selectedRange().location, max(text.length - 1, 0))
        let paragraph = text.length == 0
            ? NSRange(location: 0, length: 0)
            : text.lineRange(for: NSRange(location: caret, length: 0))
        let dirty = hiding.setRevealed(paragraph)
        guard !dirty.isEmpty else { return }
        for range in dirty {
            let clipped = NSIntersectionRange(range, NSRange(location: 0, length: text.length))
            guard clipped.length > 0 else { continue }
            layoutManager.invalidateGlyphs(forCharacterRange: clipped, changeInLength: 0,
                                           actualCharacterRange: nil)
            layoutManager.invalidateLayout(forCharacterRange: clipped, actualCharacterRange: nil)
            layoutManager.ensureLayout(forCharacterRange: clipped)
        }
        layoutManager.ensureLayout(forBoundingRect: visibleRect, in: container)
        needsDisplay = true
    }
}
