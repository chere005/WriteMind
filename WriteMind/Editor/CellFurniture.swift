import Foundation

/// What, in the markdown of the cell open on the RENDERED page, is FURNITURE:
/// there to be read, and not to be typed.
///
/// Sean, 2026-09-21: "when in wysiwyg mode, don't show the markdown characters
/// for header, only edit the text in a reminders list or bullet list and have
/// normal bullet editing behavior." The source pane shows a line's markers
/// back to you the moment the caret lands on it, and it is right to: there,
/// the markers ARE the text. On the rendered page they are not. A cell opened
/// for editing there must look like the cell that was clicked.
///
/// Three answers, because a marker is furniture in three different ways:
///
/// - `reserved` — the head of the line the caret may not enter. Every marker
///   is in here, whether it is drawn or not. Hidden characters the caret can
///   still be put among are worse than visible ones: the key that looks like
///   it will type in front of the words types between two hashes instead.
/// - `hidden` — drawn as nothing. The heading's hashes, and the `- ` and the
///   brackets of a reminder, which the box stands in for.
/// - `glyphs` — drawn as something else. The `[` of a reminder becomes the
///   box, ticked or not, so a list of reminders reads while it is being
///   edited exactly as it reads when it is not.
///
/// THE REMINDER HALF OF THIS IS THE WHOLE-CELL ROUTE ONLY, since
/// 2026-09-21: clicking a reminder on the page now opens THAT REMINDER'S
/// WORDS with its box left a live checkbox beside it (`ListEditing`,
/// `BlockView.words(of:at:)`), which is what Sean asked for a few hours
/// after this was written. A checklist still opens whole from its bracket
/// in the gutter — that is how a list's kind is changed and how a
/// reminder is unmade — and this is what it looks like when it does.
///
/// A bullet is in NONE of the last two: `BulletGlyphs` already draws `- ` as
/// a round bullet, and a list with no marker is not a list. It is reserved
/// all the same, so the dash cannot be typed over or split.
///
/// The structure is read off the runs `MarkdownSourceStyle` already found —
/// a second reader of "what is a heading" is a second answer waiting to
/// disagree. Only the reminder's box is scanned for here, because it is the
/// one piece of syntax no run describes, and even that asks
/// `MarkdownParser.todoItem` what a reminder is rather than deciding again.
enum CellFurniture {
    struct Reading: Equatable {
        var reserved: [NSRange] = []
        var hidden: [NSRange] = []
        var glyphs: [Int: UniChar] = [:]

        var isEmpty: Bool { reserved.isEmpty && hidden.isEmpty && glyphs.isEmpty }
    }

    /// U+25A1 WHITE SQUARE and U+2611 BALLOT BOX WITH CHECK.
    ///
    /// NOT U+2610, the empty ballot box that is 2611's obvious partner: the
    /// system font does not have it, and `CTFontGetGlyphsForCharacters`
    /// answers a glyph of 0 for a character a font is missing, which draws
    /// as nothing at all. Checked, both fonts this editor uses, and there is
    /// a test that keeps checking.
    static let emptyBox: UniChar = 0x25A1
    static let tickedBox: UniChar = 0x2611

    static func read(_ text: NSString, runs: [MarkdownSourceStyle.Run]) -> Reading {
        var reading = Reading()

        // A heading's hashes: gone, and no-go.
        for range in headingMarkers(runs, in: text) {
            reading.hidden.append(range)
            reading.reserved.append(range)
        }
        // A list's marker: drawn as it always was, and no-go.
        for run in runs where run.kind == .listMarker {
            guard run.range.length > 0, NSMaxRange(run.range) <= text.length else { continue }
            reading.reserved.append(run.range)
        }
        // A reminder's box, which is the marker, the brackets and what is
        // between them — one piece of furniture, drawn as one character.
        for line in lines(in: text) {
            guard let box = reminderBox(onLineAt: line, in: text) else { continue }
            reading.hidden.append(box.marker)
            reading.hidden.append(NSRange(location: box.state, length: 1))
            reading.hidden.append(NSRange(location: box.close, length: 1))
            reading.glyphs[box.open] = box.ticked ? tickedBox : emptyBox
            reading.reserved.append(NSRange(location: line.location,
                                            length: box.end - line.location))
        }
        return reading
    }

    /// The `### ` at the head of a line: a marker run that STARTS its line
    /// and is hashes followed by one space. Nothing else in the syntax looks
    /// like that — a fence is its whole line, and every inline pair is
    /// inside one.
    static func headingMarkers(_ runs: [MarkdownSourceStyle.Run], in text: NSString) -> [NSRange] {
        runs.compactMap { run in
            guard run.kind == .marker, run.range.length >= 2,
                  NSMaxRange(run.range) <= text.length,
                  text.lineRange(for: run.range).location == run.range.location
            else { return nil }
            let body = text.substring(with: run.range)
            guard body.hasSuffix(" "), body.dropLast().allSatisfy({ $0 == "#" }) else { return nil }
            return run.range
        }
    }

    /// Where a reminder's box is on one line, in the note's own offsets.
    /// Nil for every line that is not one.
    struct Box: Equatable {
        /// The `- ` in front of the brackets — hidden, because the box is
        /// the marker on a reminder and two markers is one too many.
        var marker: NSRange
        /// `[`, which is drawn as the box.
        var open: Int
        /// What is between the brackets — the tick, or the space.
        var state: Int
        /// `]`.
        var close: Int
        /// Past the box and the space after it: where the words start, and
        /// where the caret lands.
        var end: Int
        var ticked: Bool
    }

    static func reminderBox(onLineAt line: NSRange, in text: NSString) -> Box? {
        guard line.length > 0, NSMaxRange(line) <= text.length else { return nil }
        let body = text.substring(with: line).trimmingCharacters(in: .newlines)
        let indent = body.prefix { $0 == " " || $0 == "\t" }
        let bare = String(body.dropFirst(indent.count))
        guard let item = MarkdownParser.todoItem(bare) else { return nil }
        // `todoItem` has already said the line is `<marker>[<state>]`, with
        // a two-character marker; these offsets follow from that and are
        // the same ones `MarkdownFormatting.toggleTodo` counts.
        let start = line.location + (String(indent) as NSString).length
        let open = start + 2
        let close = open + 2
        guard close < NSMaxRange(line) else { return nil }
        // The space after the box belongs to the box; a reminder with no
        // words yet has no space to take.
        let after = close + 1
        let end = (after < NSMaxRange(line) && text.character(at: after) == 0x20) ? after + 1 : after
        return Box(marker: NSRange(location: start, length: 2),
                   open: open, state: open + 1, close: close, end: end, ticked: item.done)
    }

    /// Every line of the cell, as ranges.
    static func lines(in text: NSString) -> [NSRange] {
        var out: [NSRange] = []
        var start = 0
        while start < text.length {
            let line = text.lineRange(for: NSRange(location: start, length: 0))
            guard line.length > 0 else { break }
            out.append(line)
            start = NSMaxRange(line)
        }
        return out
    }
}
