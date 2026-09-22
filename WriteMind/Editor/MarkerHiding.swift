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
    /// FURNITURE: what stays out of sight, or is drawn as something else,
    /// whatever the caret is doing — and where the caret may not go.
    ///
    /// The ordinary hiding shows a paragraph's markers back to you when the
    /// caret arrives, because in the SOURCE pane they are the thing being
    /// typed. On the RENDERED page they are not, and `CellFurniture` is
    /// what decides which is which. This object only carries the answer:
    /// the characters that vanish, the ones drawn as a different glyph, and
    /// the ranges `outside(_:of:)` keeps the caret out of.
    private var furniture = IndexSet()
    private var substitutions: [Int: UniChar] = [:]
    private(set) var furnitureRanges: [NSRange] = []
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

    /// Where the caret really goes when it is put at `range`: out of any
    /// piece of furniture, and out of the FRONT of it — a prefix has
    /// nothing to its left but the start of the line, so there is only one
    /// way out. A real selection is left exactly as it was made.
    ///
    /// PAST ALL OF IT, not past the first piece found. The pieces overlap
    /// on purpose: a reminder's `- ` is furniture because it is a list
    /// marker AND the whole `- [ ] ` is furniture because it is a box, and
    /// each of those is true on its own. Taking the first match put the
    /// caret two characters in, between the dash and the bracket — inside
    /// the very thing it was being moved out of.
    static func outside(_ range: NSRange, of furniture: [NSRange]) -> NSRange {
        guard range.length == 0 else { return range }
        var location = range.location
        // Each turn moves strictly forward, and a piece can only be used
        // once, so this cannot spin.
        for _ in 0...furniture.count {
            let ends = furniture.filter {
                $0.length > 0 && location >= $0.location && location < NSMaxRange($0)
            }
            guard let furthest = ends.map({ NSMaxRange($0) }).max() else { break }
            location = furthest
        }
        return NSRange(location: location, length: 0)
    }

    /// A backspace with the caret just behind a piece of furniture takes
    /// the WHOLE piece: the cell stops being a heading, which is what the
    /// key looks like it is doing. Left alone it ate the space out of
    /// `## `, and the heading quietly became a paragraph beginning `##`.
    static func furnitureBehind(_ caret: Int, in furniture: [NSRange]) -> NSRange? {
        furniture.first { $0.length > 0 && NSMaxRange($0) == caret }
    }

    /// What the cell's furniture is, as `CellFurniture` read it.
    func setFurniture(_ reading: CellFurniture.Reading) {
        furnitureRanges = reading.reserved.filter { $0.length > 0 }
        var set = IndexSet()
        for range in reading.hidden where range.length > 0 {
            set.insert(integersIn: range.location..<NSMaxRange(range))
        }
        furniture = set
        substitutions = reading.glyphs
        rebuild()
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
        var set = allMarkers
        if let revealed { set.remove(integersIn: revealed.location..<NSMaxRange(revealed)) }
        // The furniture goes back in AFTER the reveal has taken its
        // paragraph out, which is the whole point of it.
        set.formUnion(furniture)
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
            } else if let stands = substitutions[character],
                      case let substitute = BulletGlyphs.glyph(for: stands, in: font),
                      substitute != 0 {
                // Drawn as something else — the box a reminder's `[`
                // becomes. A font with no glyph for it answers 0, which
                // would draw as nothing at all, so the bracket is left
                // alone rather than losing the box altogether.
                if newGlyphs == nil {
                    newGlyphs = Array(UnsafeBufferPointer(start: glyphs, count: glyphRange.length))
                }
                newGlyphs?[index] = substitute
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
        // A bar between two cells is in NO cell, so no cell shows its
        // markers. Arming parks the caret at the next cell's first
        // character and this is the second reader of that offset — the
        // brackets were taught not to light in ee1cb44 and this one was
        // not, so clicking the seam above `## Notes` popped the heading's
        // hashes into view and shifted its words right, as if the caret
        // had been put in it (Sean, 2026-09-20: "the next section
        // shouldn't be highlighted when the input cursor is currently
        // that horizontal bar"). Arming with ↓ never did it, because the
        // caret sits on the blank line then — one bar, two behaviours.
        let armed = (self as? PasteAwareTextView)?.armedSeam != nil
        let paragraph: NSRange? = armed ? nil : (text.length == 0
            ? NSRange(location: 0, length: 0)
            : text.lineRange(for: NSRange(location: caret, length: 0)))
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
