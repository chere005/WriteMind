import Foundation

/// What can be done to a whole cell, the way a Mathematica notebook does it
/// (Sean, 2026-09-20: "put some effort in making cells behave like
/// mathematica cells").
///
/// In a notebook the cell is a thing you can hold: click its bracket and
/// the cell is selected — not a range of characters that happens to cover
/// it, the CELL — and then Delete takes it away, ⌘C copies it whole, ⌘X
/// cuts it, ⌘V puts one back after it, and typing replaces it. Moving one
/// is dragging its bracket up or down the stack. All of that is the same
/// handful of edits to the markdown underneath, so they live here, over a
/// string and a range, and both panes call them.
enum CellCommands {
    /// The cell and the blank line that separates it from the next one —
    /// what "delete this cell" really takes, so the stack closes up
    /// behind it instead of leaving a hole.
    static func extent(of cell: NSRange, in text: String) -> NSRange {
        let ns = text as NSString
        guard ns.length > 0 else { return cell }
        var end = min(NSMaxRange(cell), ns.length)
        // The newlines after it, up to and including the blank line.
        var newlines = 0
        while end < ns.length, ns.character(at: end) == 10, newlines < 2 {
            end += 1
            newlines += 1
        }
        // At the end of the note there is nothing below to close up, so the
        // blank line ABOVE it goes instead.
        var start = cell.location
        if newlines == 0 {
            while start > 0, ns.character(at: start - 1) == 10, cell.location - start < 2 { start -= 1 }
        }
        return NSRange(location: start, length: end - start)
    }

    /// Taking a cell out: the text left behind, and where the caret goes —
    /// the top of whichever cell moved up into its place.
    static func delete(_ cell: NSRange, in text: String) -> MarkdownFormatting.Edit {
        let range = extent(of: cell, in: text)
        return MarkdownFormatting.Edit(range: range, replacement: "",
                                       selection: NSRange(location: range.location, length: 0))
    }

    /// A cell on the clipboard is its own markdown, with the blank line
    /// after it, so pasting it puts a cell in rather than a run of words.
    static func copy(_ cell: NSRange, in text: String) -> String {
        let ns = text as NSString
        let range = NSIntersectionRange(cell, NSRange(location: 0, length: ns.length))
        guard range.length > 0 else { return "" }
        return ns.substring(with: range).trimmingCharacters(in: .newlines)
    }

    /// Putting a cell in after this one.
    static func paste(_ markdown: String, after cell: NSRange, in text: String) -> MarkdownFormatting.Edit {
        let ns = text as NSString
        let body = markdown.trimmingCharacters(in: .newlines)
        let end = min(NSMaxRange(cell), ns.length)
        let opening = end >= ns.length ? "\n\n" : "\n\n"
        let replacement = opening + body
        return MarkdownFormatting.Edit(
            range: NSRange(location: end, length: 0), replacement: replacement,
            selection: NSRange(location: end + (opening as NSString).length,
                               length: (body as NSString).length))
    }

    /// The same cell again, under it — Mathematica's ⌘D on a cell bracket.
    static func duplicate(_ cell: NSRange, in text: String) -> MarkdownFormatting.Edit {
        paste(copy(cell, in: text), after: cell, in: text)
    }

    /// Dragging a bracket up or down: the cell changes places with its
    /// neighbour. Nil at the ends of the note, where there is nowhere to go.
    ///
    /// A range that holds SEVERAL cells — a run of them picked out of the
    /// gutter, or a section's own bracket — moves as one: the whole run
    /// changes places with the cell beyond it, rather than the first of
    /// them stepping out of the run and leaving the rest behind.
    static func move(_ cell: NSRange, up: Bool, in text: String) -> MarkdownFormatting.Edit? {
        let ns = text as NSString
        let cells = MarkdownParser.positioned(from: text).map(\.range)
        guard let index = cells.firstIndex(where: { NSEqualRanges($0, cell) })
                ?? cells.firstIndex(where: { NSIntersectionRange($0, cell).length > 0 })
        else { return nil }
        let last = max(index, cells.lastIndex(where: { NSIntersectionRange($0, cell).length > 0 }) ?? index)
        let otherIndex = up ? index - 1 : last + 1
        guard otherIndex >= 0, otherIndex < cells.count else { return nil }

        let mine = NSRange(location: cells[index].location,
                           length: NSMaxRange(cells[last]) - cells[index].location)
        let theirs = cells[otherIndex]
        let first = up ? theirs : mine, second = up ? mine : theirs
        let span = NSRange(location: first.location,
                           length: min(NSMaxRange(second), ns.length) - first.location)
        let between = NSRange(location: NSMaxRange(first),
                              length: second.location - NSMaxRange(first))
        let separator = between.length > 0 ? ns.substring(with: between) : "\n\n"
        let swapped = ns.substring(with: second) + separator + ns.substring(with: first)
        // The cell that moved keeps the selection, at its new place.
        let landing = up
            ? NSRange(location: span.location, length: mine.length)
            : NSRange(location: span.location + (ns.substring(with: second) as NSString).length
                        + (separator as NSString).length,
                      length: mine.length)
        return MarkdownFormatting.Edit(range: span, replacement: swapped, selection: landing)
    }

    /// Several cells at once — what ⌃⌫ and ⌃⇧D do when more than one
    /// bracket is lit (the plan's step 3).
    ///
    /// BACK TO FRONT, which is the whole reason this is not a loop at the
    /// call site: every edit is worked out against the note AS IT IS, so
    /// one made in front of another would leave the second pointing at
    /// characters that have moved. Doing the last one first leaves every
    /// range still meaning what it meant.
    ///
    /// And cells that sit next to each other go in as ONE span: `extent`
    /// then reads the blank line after the LAST of them rather than one
    /// inside the run, so the stack closes up behind three deleted cells
    /// exactly the way it closes behind one.
    static func edits(over cells: [NSRange], in text: String,
                      make: (NSRange, String) -> MarkdownFormatting.Edit?) -> [MarkdownFormatting.Edit] {
        let all = MarkdownParser.positioned(from: text).map(\.range)
        guard !all.isEmpty else { return [] }

        // Which of the note's cells were handed in. A range that covers
        // whole cells means all of them — a section's bracket holds
        // several — and one that only reaches into a cell means that cell.
        var indexes: [Int] = []
        for cell in cells {
            var inside = all.indices.filter {
                all[$0].length > 0 && NSIntersectionRange(all[$0], cell).length == all[$0].length
            }
            if inside.isEmpty, let touched = all.firstIndex(where: { NSIntersectionRange($0, cell).length > 0 }) {
                inside = [touched]
            }
            for index in inside where !indexes.contains(index) { indexes.append(index) }
        }
        indexes.sort()

        var spans: [NSRange] = []
        var previous: Int?
        for index in indexes {
            if let previous, index == previous + 1, var span = spans.popLast() {
                span.length = NSMaxRange(all[index]) - span.location
                spans.append(span)
            } else {
                spans.append(all[index])
            }
            previous = index
        }

        var out: [MarkdownFormatting.Edit] = []
        // Nothing may reach past the edit already made: at the end of the
        // note `extent` walks BACKWARDS over the blank line above, and two
        // runs a blank cell apart can both want the same newline.
        var limit = (text as NSString).length
        for span in spans.reversed() {
            guard let edit = make(span, text) else { continue }
            let start = min(edit.range.location, limit)
            let range = NSRange(location: start, length: max(0, min(NSMaxRange(edit.range), limit) - start))
            out.append(MarkdownFormatting.Edit(range: range, replacement: edit.replacement,
                                               selection: edit.selection))
            limit = start
        }
        return out
    }
}
