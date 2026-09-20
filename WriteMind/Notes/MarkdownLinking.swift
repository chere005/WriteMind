import Foundation

/// Links between notes, and the anchors they point at.
///
/// A whole-note link is `[Title](Other%20Note.md)`. A link to a PART of a note
/// needs something to point at, so one is written INTO that note: a heading
/// already has one (its slug), a highlighted run gets `<mark id="wm-…">…</mark>`
/// — which is also the annotation Sean asked for, "that it's highlighted and
/// linked to" — and any other block gets an empty `<a id="wm-…"></a>` in front
/// of it. All three are portable HTML, not a private marker.
enum MarkdownLinking {
    static let trigger = "/link"

    struct Anchor: Equatable {
        let id: String
        /// The target note's text after the anchor was written into it, or nil
        /// when the note already had one (a heading) and needs no edit.
        let rewrittenText: String?
        /// What the link should read as.
        let title: String
    }

    static func newAnchorID() -> String {
        "wm-" + String(UUID().uuidString.prefix(8)).lowercased()
    }

    /// `## The bar` → `the-bar`, the slug every markdown renderer would make.
    static func slug(for heading: String) -> String {
        let lowered = heading.lowercased()
        var out = ""
        for character in lowered {
            if character.isLetter || character.isNumber { out.append(character) }
            else if character == " " || character == "-" || character == "_" {
                if out.last != "-" { out.append("-") }
            }
        }
        while out.hasSuffix("-") { out.removeLast() }
        return out.isEmpty ? "section" : out
    }

    /// The link text for a block: its heading, or its first few words.
    static func title(forBlock line: String) -> String {
        let stripped = MarkdownFormatting.setHeading(text: line, selection: NSRange(location: 0, length: 0), level: .body)
        let body = (line as NSString).replacingCharacters(in: stripped.range, with: stripped.replacement)
            .trimmingCharacters(in: .whitespaces)
        let plain = Note.stripInlineMarkup(body)
        let words = plain.split(separator: " ").prefix(8).joined(separator: " ")
        return words.isEmpty ? "section" : words
    }

    /// What a link into `text` at `selection` should point at, and what `text`
    /// has to become for the anchor to exist.
    ///
    /// - A non-empty selection is highlighted with `<mark id="…">`.
    /// - A caret on a heading uses the heading's own slug; nothing is written.
    /// - A caret anywhere else gets an `<a id="…">` before its block.
    static func anchor(in text: String, at selection: NSRange) -> Anchor {
        let ns = text as NSString
        let selection = MarkdownFormatting.clamp(selection, to: ns.length)

        if let trimmed = trimmingWhitespace(selection, in: ns) {
            let id = newAnchorID()
            let selection = trimmed
            let selected = ns.substring(with: selection)
            let marked = "<mark id=\"\(id)\">\(selected)</mark>"
            return Anchor(id: id,
                          rewrittenText: ns.replacingCharacters(in: selection, with: marked),
                          title: Note.stripInlineMarkup(selected).trimmingCharacters(in: .whitespacesAndNewlines))
        }

        let caret = NSRange(location: selection.location, length: 0)
        let lineRange = ns.lineRange(for: caret)
        var line = ns.substring(with: lineRange)
        if line.hasSuffix("\n") { line.removeLast() }

        let level = MarkdownFormatting.headingLevel(of: line)
        if level != .body {
            let heading = title(forBlock: line)
            return Anchor(id: slug(for: heading), rewrittenText: nil, title: heading)
        }

        let id = newAnchorID()
        let anchored = "<a id=\"\(id)\"></a>" + line
        let replaced = ns.replacingCharacters(
            in: NSRange(location: lineRange.location, length: (line as NSString).length), with: anchored)
        return Anchor(id: id, rewrittenText: replaced, title: title(forBlock: line))
    }

    /// The selection without the whitespace at its edges — a stray trailing
    /// space inside a `<mark>` is a link that highlights one character too far.
    /// Nil when there is nothing but whitespace, which is not a target.
    static func trimmingWhitespace(_ range: NSRange, in ns: NSString) -> NSRange? {
        guard range.length > 0 else { return nil }
        let whitespace = CharacterSet.whitespacesAndNewlines
        var start = range.location
        var end = NSMaxRange(range)
        func isSpace(_ index: Int) -> Bool {
            guard let scalar = UnicodeScalar(ns.character(at: index)) else { return false }
            return whitespace.contains(scalar)
        }
        while start < end, isSpace(start) { start += 1 }
        while end > start, isSpace(end - 1) { end -= 1 }
        return end > start ? NSRange(location: start, length: end - start) : nil
    }

    /// `[Title](Some%20Note.md#wm-1234)` — the anchor is dropped for a whole-note link.
    static func link(title: String, fileName: String, anchor: String?) -> String {
        let encoded = fileName.addingPercentEncoding(withAllowedCharacters: .urlPathAllowed) ?? fileName
        let destination = anchor.map { "\(encoded)#\($0)" } ?? encoded
        let clean = title.replacingOccurrences(of: "]", with: "")
            .replacingOccurrences(of: "\n", with: " ")
        return "[\(clean.isEmpty ? fileName : clean)](\(destination))"
    }

    /// Where the `/link` the user just typed sits — at `caret` if it is still
    /// there, otherwise the nearest one, because they may have typed since.
    static func triggerRange(in text: String, near caret: Int) -> NSRange? {
        let ns = text as NSString
        let length = (trigger as NSString).length
        let at = NSRange(location: caret - length, length: length)
        if at.location >= 0, NSMaxRange(at) <= ns.length, ns.substring(with: at) == trigger { return at }

        var best: NSRange?
        var from = 0
        while from < ns.length {
            let found = ns.range(of: trigger, options: [.literal],
                                 range: NSRange(location: from, length: ns.length - from))
            guard found.location != NSNotFound else { break }
            if best == nil || abs(found.location - caret) < abs(best!.location - caret) { best = found }
            from = NSMaxRange(found)
        }
        return best
    }

    /// True the moment `/link` has been completed at the caret.
    static func justTypedTrigger(in text: String, caret: Int) -> Bool {
        let ns = text as NSString
        let length = (trigger as NSString).length
        let range = NSRange(location: caret - length, length: length)
        guard range.location >= 0, NSMaxRange(range) <= ns.length else { return false }
        guard ns.substring(with: range) == trigger else { return false }
        // Only at a word boundary, so a path like "docs/linked" does not fire it.
        if range.location > 0 {
            let before = ns.substring(with: NSRange(location: range.location - 1, length: 1))
            if !(before == " " || before == "\n" || before == "\t") { return false }
        }
        return true
    }
}
