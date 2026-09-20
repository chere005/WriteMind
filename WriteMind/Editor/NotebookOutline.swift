import Foundation

/// The note read as a notebook: a heading opens a group that runs to the
/// next heading of its own level or higher, the way Wolfram and Jupyter
/// notebooks nest their cells (Sean, 2026-09-19: "make the sections grouped
/// like wolfram/jupyter notebooks.. show the notebook grouping and collapsing
/// on the side"). Pure: text and ranges in, sections and edits out. The
/// gutter draws these, the collapse hides their bodies, and the move
/// buttons swap them with their neighbours.
enum NotebookOutline {
    /// The author line (level 6) groups nothing: it sits under a title the
    /// way a subtitle does, and what follows it still belongs to the title.
    static let leafLevel = 6

    struct Section: Equatable, Identifiable {
        /// What the collapse state is remembered by: the heading's words,
        /// with an ordinal when the same words head more than one section
        /// ("Notes", "Notes#2"). Nothing else in the note is stable enough —
        /// an offset moves with every keystroke above it.
        var key: String
        var title: String
        var level: Int
        /// How many sections enclose this one.
        var depth: Int
        /// The heading line, without its newline.
        var headingRange: NSRange
        /// The heading's first character to the end of the group's last
        /// line, before the newline that ends it. Trailing blank lines belong
        /// to the group (they move with it); `contentEnd` is where the last
        /// written line ends, which is where a bracket should stop.
        var range: NSRange
        var contentEnd: Int

        var id: String { key }
        /// Whether there is anything under the heading worth folding away.
        /// Measured to the last WRITTEN line: a heading followed by nothing
        /// but blank lines has no body, and folding it would hide nothing
        /// while drawing a closed bracket.
        var hasBody: Bool { contentEnd > NSMaxRange(headingRange) }

        /// The text hidden while the section is closed: from the heading's
        /// own newline through the body's last newline, so every hidden line
        /// is a whole paragraph and the next visible line starts fresh.
        func hiddenRange(in length: Int) -> NSRange {
            let start = NSMaxRange(headingRange)
            let end = min(length, NSMaxRange(range) + 1)
            return NSRange(location: start, length: max(0, end - start))
        }
    }

    /// Every heading in the text, in order, with its group worked out. A
    /// `#` inside a code fence is code, not a heading.
    static func sections(in text: String) -> [Section] {
        struct Line { var range: NSRange; var level: Int; var title: String; var blank: Bool }
        var lines: [Line] = []
        var offset = 0
        var inFence = false
        for line in text.components(separatedBy: "\n") {
            let length = (line as NSString).length
            let trimmed = line.trimmingCharacters(in: .whitespaces)
            var level = 0, title = ""
            if trimmed.hasPrefix("```") {
                inFence.toggle()
            } else if !inFence, let (found, text) = MarkdownParser.heading(trimmed) {
                level = found
                title = text.trimmingCharacters(in: .whitespaces)
            }
            lines.append(Line(range: NSRange(location: offset, length: length), level: level,
                              title: title, blank: trimmed.isEmpty))
            offset += length + 1
        }

        var result: [Section] = []
        var headingLines: [Int] = []
        var open: [Int] = []
        var titles: [String: Int] = [:]

        func close(_ index: Int, before lineIndex: Int) {
            let last = lines[lineIndex - 1]
            let start = result[index].range.location
            result[index].range = NSRange(location: start, length: NSMaxRange(last.range) - start)
            var written = lineIndex - 1
            while written > headingLines[index], lines[written].blank { written -= 1 }
            result[index].contentEnd = NSMaxRange(lines[written].range)
        }

        for (index, line) in lines.enumerated() where line.level > 0 {
            if line.level < leafLevel {
                while let top = open.last, result[top].level >= line.level {
                    close(top, before: index)
                    open.removeLast()
                }
            }
            let count = (titles[line.title] ?? 0) + 1
            titles[line.title] = count
            let key = count == 1 ? line.title : "\(line.title)#\(count)"
            result.append(Section(key: key, title: line.title, level: line.level, depth: open.count,
                                  headingRange: line.range, range: line.range, contentEnd: NSMaxRange(line.range)))
            headingLines.append(index)
            if line.level < leafLevel { open.append(result.count - 1) }
        }
        while let top = open.last {
            close(top, before: lines.count)
            open.removeLast()
        }
        return result
    }

    /// How far in a cell's bracket is drawn: one step inside the section
    /// that holds it, and at the margin when no section does. The section
    /// brackets themselves are drawn at their own depth, so a cell always
    /// sits INSIDE the group it belongs to — a notebook's hierarchy (Sean,
    /// 2026-09-20: "make sure the brackets follow group heirarchy
    /// correctly").
    static func cellDepth(at offset: Int, in sections: [Section]) -> Int {
        (section(containing: offset, in: sections)?.depth ?? -1) + 1
    }

    /// The innermost section the caret is in — on its heading or anywhere
    /// under it — or nil before the first heading.
    static func section(containing caret: Int, in sections: [Section]) -> Section? {
        sections
            .filter { $0.range.location <= caret && caret <= NSMaxRange($0.range) }
            .max { $0.depth < $1.depth }
    }

    /// The sections directly inside `parent` (all the top-level ones for nil),
    /// in order.
    static func children(of parent: Section?, in sections: [Section]) -> [Section] {
        guard let parent else { return sections.filter { $0.depth == 0 } }
        return sections.filter {
            $0.depth == parent.depth + 1 && $0.range.location > parent.range.location
                && NSMaxRange($0.range) <= NSMaxRange(parent.range)
        }
    }

    static func parent(of section: Section, in sections: [Section]) -> Section? {
        sections.first {
            $0.depth == section.depth - 1 && $0.range.location < section.range.location
                && NSMaxRange(section.range) <= NSMaxRange($0.range)
        }
    }

    /// The bodies of the closed sections, as ranges to hide — merged, since a
    /// closed section inside a closed section is hidden once.
    static func hiddenRanges(in text: String, collapsed: Set<String>) -> [NSRange] {
        guard !collapsed.isEmpty else { return [] }
        let length = (text as NSString).length
        let ranges = sections(in: text)
            .filter { collapsed.contains($0.key) && $0.hasBody }
            .map { $0.hiddenRange(in: length) }
            .filter { $0.length > 0 }
            .sorted { $0.location < $1.location }
        var merged: [NSRange] = []
        for range in ranges {
            if let last = merged.last, range.location <= NSMaxRange(last) {
                merged[merged.count - 1] = NSUnionRange(last, range)
            } else {
                merged.append(range)
            }
        }
        return merged
    }

    /// The edit that moves the caret's section above the sibling before it or
    /// below the one after it (Sean, 2026-09-19: "move section up / down").
    /// A section moves with everything nested in it. Before the first
    /// heading the cells are paragraphs, and it is the paragraph that
    /// moves. Nil when there is nothing to swap with.
    static func moveSection(text: String, selection: NSRange, up: Bool) -> MarkdownFormatting.Edit? {
        let ns = text as NSString
        let caret = min(max(0, selection.location), ns.length)
        let all = sections(in: text)
        let moving: NSRange
        let other: NSRange
        if let section = section(containing: caret, in: all) {
            let siblings = children(of: parent(of: section, in: all), in: all)
            guard let index = siblings.firstIndex(of: section) else { return nil }
            let neighbour = up ? index - 1 : index + 1
            guard siblings.indices.contains(neighbour) else { return nil }
            moving = section.range
            other = siblings[neighbour].range
        } else {
            let cells = paragraphs(in: ns, before: all.first?.range.location ?? ns.length)
            guard let index = cells.firstIndex(where: { $0.location <= caret && caret <= NSMaxRange($0) })
            else { return nil }
            let neighbour = up ? index - 1 : index + 1
            guard cells.indices.contains(neighbour) else { return nil }
            moving = cells[index]
            other = cells[neighbour]
        }

        let first = up ? other : moving
        let second = up ? moving : other
        let span = NSRange(location: first.location, length: NSMaxRange(second) - first.location)
        let firstText = ns.substring(with: first)
        let secondText = ns.substring(with: second)
        let gap = ns.substring(with: NSRange(location: NSMaxRange(first), length: second.location - NSMaxRange(first)))
        let replacement = secondText + gap + firstText

        let delta = caret - moving.location
        let landing = up ? span.location : span.location + (secondText as NSString).length + (gap as NSString).length
        let length = NSMaxRange(selection) <= NSMaxRange(moving) ? selection.length : 0
        return MarkdownFormatting.Edit(range: span, replacement: replacement,
                                       selection: NSRange(location: landing + delta, length: length))
    }

    /// Runs of written lines before `limit`, each from its first character to
    /// the end of its last line.
    static func paragraphs(in ns: NSString, before limit: Int) -> [NSRange] {
        var cells: [NSRange] = []
        var current: NSRange?
        var offset = 0
        for line in ns.components(separatedBy: "\n") {
            let length = (line as NSString).length
            let range = NSRange(location: offset, length: length)
            offset += length + 1
            guard range.location < limit else { break }
            if line.trimmingCharacters(in: .whitespaces).isEmpty {
                if let open = current { cells.append(open); current = nil }
            } else if let open = current {
                current = NSRange(location: open.location, length: NSMaxRange(range) - open.location)
            } else {
                current = range
            }
        }
        if let open = current { cells.append(open) }
        return cells
    }
}
