import Foundation

/// Font, size and colour on a run of text. Markdown carries none of those, so
/// they are written as `<span style="…">…</span>` — the same trade already
/// made for `<u>`: portable HTML that other markdown readers understand,
/// rather than a private marker only this app can read.
extension MarkdownFormatting {
    struct SpanStyle: Equatable {
        var family: String?
        var size: Double?
        var colorHex: String?

        var isEmpty: Bool { family == nil && size == nil && colorHex == nil }

        /// `font-family: Georgia; font-size: 18px; color: #2D7DD2`
        var css: String {
            var parts: [String] = []
            if let family, !family.isEmpty { parts.append("font-family: \(family)") }
            if let size { parts.append("font-size: \(Int(size.rounded()))px") }
            if let colorHex { parts.append("color: \(colorHex)") }
            return parts.joined(separator: "; ")
        }
    }

    private static let spanPattern = try? NSRegularExpression(
        pattern: "^<span\\s[^>]*>([\\s\\S]*)</span>$", options: [])

    /// Wrap the selection in a styled span — replacing one that is already
    /// there rather than nesting, and removing it when the style is empty.
    static func applySpan(text: String, selection: NSRange, style: SpanStyle) -> Edit {
        let ns = text as NSString
        var range = clamp(selection, to: ns.length)
        var inner = ns.substring(with: range)

        // "<span …>word</span>" selected
        if let match = spanPattern?.firstMatch(in: inner, range: NSRange(location: 0, length: (inner as NSString).length)),
           match.numberOfRanges == 2 {
            inner = (inner as NSString).substring(with: match.range(at: 1))
        } else if let outer = enclosingSpan(in: ns, around: range) {
            // <span …>|word|</span> selected
            range = outer
        }

        guard !style.isEmpty else {
            return Edit(range: range, replacement: inner,
                        selection: NSRange(location: range.location, length: (inner as NSString).length))
        }
        let open = "<span style=\"\(style.css)\">"
        let replacement = open + inner + "</span>"
        let openLength = (open as NSString).length
        return Edit(range: range, replacement: replacement,
                    selection: NSRange(location: range.location + openLength,
                                       length: (inner as NSString).length))
    }

    /// Take the styling off the selection, leaving its text.
    static func removeSpan(text: String, selection: NSRange) -> Edit {
        applySpan(text: text, selection: selection, style: SpanStyle())
    }

    /// The span tags sitting immediately outside `range`, if any.
    private static func enclosingSpan(in ns: NSString, around range: NSRange) -> NSRange? {
        let closing = "</span>"
        let after = NSRange(location: NSMaxRange(range), length: (closing as NSString).length)
        guard NSMaxRange(after) <= ns.length, ns.substring(with: after) == closing else { return nil }

        let before = ns.substring(to: range.location)
        guard before.hasSuffix(">"), let openStart = before.range(of: "<span ", options: .backwards) else { return nil }
        let openLocation = before.distance(from: before.startIndex, to: openStart.lowerBound)
        let opening = (before as NSString).substring(from: openLocation)
        guard !opening.dropFirst().contains("<") else { return nil }
        return NSRange(location: openLocation, length: NSMaxRange(after) - openLocation)
    }

    // MARK: - Sublime's ⌘D

    /// What a press of ⌘D leaves behind: the ranges to select, and whether
    /// the search is word-bounded (it is, once a press expanded a bare caret
    /// into a word — the same rule Sublime uses).
    struct OccurrenceStep: Equatable {
        var ranges: [NSRange]
        var wholeWord: Bool
        /// The range that was just added, to scroll to.
        var reveal: NSRange
    }

    /// The word around `location` — letters, digits and underscores.
    static func wordRange(in text: String, at location: Int) -> NSRange? {
        let ns = text as NSString
        guard ns.length > 0 else { return nil }
        var start = min(max(0, location), ns.length)
        var end = start
        // A caret just past a word takes that word, as Sublime does.
        while start > 0, isWordCharacter(ns.character(at: start - 1)) { start -= 1 }
        while end < ns.length, isWordCharacter(ns.character(at: end)) { end += 1 }
        guard end > start else { return nil }
        return NSRange(location: start, length: end - start)
    }

    /// One press of ⌘D against whatever is selected now. Nil when there is
    /// nothing to do — no word under the caret, or every occurrence taken —
    /// and then the selection is left exactly as it was.
    ///
    /// Every input range is clamped, de-duplicated and sorted first, because
    /// they may be stale: the document can have been edited, or shortened,
    /// between two presses, and AppKit drops the whole selection if it is
    /// handed a range past the end.
    static func selectNextOccurrence(in text: String, ranges: [NSRange], wholeWord: Bool) -> OccurrenceStep? {
        let ns = text as NSString
        let clean = normalise(ranges, in: ns)
        guard let last = clean.last else { return nil }

        // Nothing selected yet: take the word under the caret.
        if clean.allSatisfy({ $0.length == 0 }) {
            guard let word = wordRange(in: text, at: last.location) else { return nil }
            var next = clean.filter { $0.length > 0 }
            next.append(word)
            return OccurrenceStep(ranges: normalise(next, in: ns), wholeWord: true, reveal: word)
        }

        // The term is the newest non-empty range — the one the last press added.
        guard let newest = clean.last(where: { $0.length > 0 }) else { return nil }
        let term = ns.substring(with: newest)
        guard !term.isEmpty else { return nil }

        let searchFrom = clean.map { NSMaxRange($0) }.max() ?? NSMaxRange(newest)
        guard let found = nextOccurrence(in: text, of: term, after: searchFrom,
                                         skipping: clean, wholeWord: wholeWord) else { return nil }
        return OccurrenceStep(ranges: normalise(clean + [found], in: ns), wholeWord: wholeWord, reveal: found)
    }

    /// Every occurrence at once — Sublime's "Select All Occurrences".
    static func allOccurrences(in text: String, of term: String, wholeWord: Bool) -> [NSRange] {
        let ns = text as NSString
        var found: [NSRange] = []
        var from = 0
        while from < ns.length {
            let hit = ns.range(of: term, options: [.literal], range: NSRange(location: from, length: ns.length - from))
            guard hit.location != NSNotFound else { break }
            if !wholeWord || isWholeWord(hit, in: ns) { found.append(hit) }
            from = hit.location + 1
        }
        return found
    }

    /// The next occurrence of `term` after `location`, wrapping to the top,
    /// skipping anything that OVERLAPS a range already selected — not just an
    /// exact repeat, because an overlapping pair makes AppKit discard the lot.
    static func nextOccurrence(in text: String, of term: String, after location: Int,
                               skipping existing: [NSRange], wholeWord: Bool = false) -> NSRange? {
        let ns = text as NSString
        let termLength = (term as NSString).length
        guard termLength > 0, ns.length >= termLength else { return nil }
        let start = min(max(0, location), ns.length)

        let windows = [NSRange(location: start, length: ns.length - start),
                       NSRange(location: 0, length: min(start, ns.length))]
        for window in windows {
            var searchFrom = window.location
            while searchFrom < NSMaxRange(window) {
                let remaining = NSRange(location: searchFrom, length: NSMaxRange(window) - searchFrom)
                let found = ns.range(of: term, options: [.literal], range: remaining)
                guard found.location != NSNotFound else { break }
                let clashes = existing.contains { NSIntersectionRange($0, found).length > 0 || NSEqualRanges($0, found) }
                if !clashes, !wholeWord || isWholeWord(found, in: ns) { return found }
                searchFrom = found.location + 1
            }
        }
        return nil
    }

    /// True when nothing word-like touches either end of the range.
    static func isWholeWord(_ range: NSRange, in ns: NSString) -> Bool {
        if range.location > 0, isWordCharacter(ns.character(at: range.location - 1)) { return false }
        let after = NSMaxRange(range)
        if after < ns.length, isWordCharacter(ns.character(at: after)) { return false }
        return true
    }

    private static func isWordCharacter(_ character: unichar) -> Bool {
        guard let scalar = UnicodeScalar(character) else { return false }
        return CharacterSet.alphanumerics.contains(scalar) || scalar == "_"
    }

    /// In order, inside the document, with no duplicates and no overlaps —
    /// what AppKit requires of `selectedRanges`, and what a stale range set
    /// after an edit will not be.
    static func normalise(_ ranges: [NSRange], in ns: NSString) -> [NSRange] {
        var out: [NSRange] = []
        for range in ranges.map({ clamp($0, to: ns.length) }).sorted(by: { $0.location < $1.location }) {
            if let previous = out.last {
                if NSEqualRanges(previous, range) { continue }
                if NSIntersectionRange(previous, range).length > 0 { continue }
                // Two carets in the same spot are one caret.
                if previous.length == 0, range.length == 0, previous.location == range.location { continue }
            }
            out.append(range)
        }
        return out
    }
}

extension NSString {
    /// The word around a character — letters, numbers and the marks that
    /// hold a word together. Empty where the character is a space.
    func rangeOfWord(at index: Int) -> NSRange {
        guard length > 0, index >= 0, index < length else { return NSRange(location: index, length: 0) }
        let letters = CharacterSet.alphanumerics.union(CharacterSet(charactersIn: "_-'"))
        func isWord(_ at: Int) -> Bool {
            guard at >= 0, at < length else { return false }
            guard let scalar = Unicode.Scalar(character(at: at)) else { return false }
            return letters.contains(scalar)
        }
        guard isWord(index) else { return NSRange(location: index, length: 0) }
        var start = index, end = index + 1
        while isWord(start - 1) { start -= 1 }
        while isWord(end) { end += 1 }
        return NSRange(location: start, length: end - start)
    }
}

