import CoreGraphics
import Foundation

/// A table drawn by hand, read off the page as a markdown table (the
/// to-do list: OCR reads strikethrough, rings, arrows and checkboxes, but
/// "not read: tables drawn by hand").
///
/// The grid is found in the INK, not in the words: a ruled line is a run of
/// ink that crosses most of the table and is only a stroke or two thick,
/// which nothing written by hand looks like. Two of those across and two
/// down make a grid, and the words are then dealt into whichever box each
/// one sits in. Reading it from the rules rather than from the words is
/// what keeps a paragraph of prose — which has no rules through it — from
/// ever being mistaken for a table.
enum DrawnTable {
    /// A rule: where it is, and how far along the page it runs.
    struct Rule: Equatable {
        /// The middle of the line, across the axis it rules.
        var at: CGFloat
        var from: CGFloat
        var to: CGFloat

        var length: CGFloat { to - from }
    }

    struct Grid: Equatable {
        /// The rules, in order: the lines between the cells and round them.
        var rows: [Rule]
        var columns: [Rule]

        var box: CGRect {
            CGRect(x: columns.first?.at ?? 0, y: rows.first?.at ?? 0,
                   width: (columns.last?.at ?? 0) - (columns.first?.at ?? 0),
                   height: (rows.last?.at ?? 0) - (rows.first?.at ?? 0))
        }
        /// A table with three lines across has two rows of cells.
        var rowCount: Int { max(0, rows.count - 1) }
        var columnCount: Int { max(0, columns.count - 1) }

        /// The box of one cell, in the page's pixels.
        func cell(row: Int, column: Int) -> CGRect {
            guard row >= 0, row + 1 < rows.count, column >= 0, column + 1 < columns.count else { return .zero }
            return CGRect(x: columns[column].at, y: rows[row].at,
                          width: columns[column + 1].at - columns[column].at,
                          height: rows[row + 1].at - rows[row].at)
        }
    }

    /// How much of the grid's width a line has to cross to be one of its
    /// rules. Hand-drawn lines overshoot and fall short; this is generous
    /// enough for that and far too much for a word.
    static let span = 0.62
    /// A grid needs at least this many cells each way — two columns and
    /// two rows, header included.
    static let minimumCells = 2
    /// Two rules nearer than this are one wobbly line.
    static let merge: CGFloat = 6

    // MARK: - Finding the rules

    /// Every row of the mask that is mostly ink, as rules.
    static func horizontalRules(ink: [Bool], width: Int, height: Int,
                                span: Double = span) -> [Rule] {
        rules(count: height, across: width, minimum: Double(width) * span) { y, x in
            ink[y * width + x]
        }
    }

    /// The same down the page.
    static func verticalRules(ink: [Bool], width: Int, height: Int,
                              span: Double = span) -> [Rule] {
        rules(count: width, across: height, minimum: Double(height) * span) { x, y in
            ink[y * width + x]
        }
    }

    /// The lines of one axis: for each index, the longest unbroken-enough
    /// run of ink along it; the ones long enough to be a rule, merged so a
    /// line two or three pixels thick is one rule.
    ///
    /// The length test comes BEFORE the merge, and has to: every row of a
    /// table has SOME ink in it (the verticals cross it), so merging first
    /// chained every row between the top rule and the bottom one into a
    /// single rule and the grid vanished.
    private static func rules(count: Int, across: Int, minimum: Double,
                              inked: (Int, Int) -> Bool) -> [Rule] {
        var found: [Rule] = []
        for index in 0..<count {
            var best: (from: Int, to: Int)?
            var start: Int?
            var gap = 0
            // A hand-drawn line is not solid: a gap of a few pixels is
            // still the same line.
            let allowed = max(2, across / 60)
            for position in 0..<across {
                if inked(index, position) {
                    if start == nil { start = position }
                    gap = 0
                } else if start != nil {
                    gap += 1
                    if gap > allowed {
                        let run = (from: start!, to: position - gap)
                        if best == nil || run.to - run.from > best!.to - best!.from { best = run }
                        start = nil
                        gap = 0
                    }
                }
            }
            if let start {
                let run = (from: start, to: across - 1)
                if best == nil || run.to - run.from > best!.to - best!.from { best = run }
            }
            guard let best, Double(best.to - best.from) >= minimum else { continue }
            found.append(Rule(at: CGFloat(index), from: CGFloat(best.from), to: CGFloat(best.to)))
        }
        return merged(found)
    }

    /// Lines within `merge` of each other are one line, at their middle.
    static func merged(_ rules: [Rule]) -> [Rule] {
        var out: [Rule] = []
        for rule in rules.sorted(by: { $0.at < $1.at }) {
            if let last = out.last, rule.at - last.at <= merge {
                out[out.count - 1] = Rule(at: (last.at + rule.at) / 2,
                                          from: min(last.from, rule.from), to: max(last.to, rule.to))
            } else {
                out.append(rule)
            }
        }
        return out
    }

    /// The grid a page holds, if it holds one.
    static func grid(ink: [Bool], width: Int, height: Int) -> Grid? {
        guard width > 8, height > 8, ink.count == width * height else { return nil }
        let across = horizontalRules(ink: ink, width: width, height: height)
        let down = verticalRules(ink: ink, width: width, height: height)
        guard across.count >= minimumCells + 1 || down.count >= minimumCells + 1 else { return nil }
        guard across.count >= 2, down.count >= 2 else { return nil }
        let grid = Grid(rows: across, columns: down)
        guard grid.rowCount >= 1, grid.columnCount >= 1,
              grid.rowCount * grid.columnCount >= minimumCells * 2,
              grid.box.width > 16, grid.box.height > 16 else { return nil }
        return grid
    }

    // MARK: - Reading it

    /// The grid, filled in from the words that sit in its cells. The first
    /// row is the header, the way a markdown table is written.
    static func markdown(_ grid: Grid, words: [HandwritingMarks.Word]) -> String? {
        guard grid.rowCount >= 1, grid.columnCount >= 1 else { return nil }
        var cells = Array(repeating: Array(repeating: [HandwritingMarks.Word](),
                                           count: grid.columnCount),
                          count: grid.rowCount)
        for word in words {
            let middle = CGPoint(x: word.box.midX, y: word.box.midY)
            for row in 0..<grid.rowCount {
                for column in 0..<grid.columnCount where grid.cell(row: row, column: column).contains(middle) {
                    cells[row][column].append(word)
                }
            }
        }
        let text = cells.map { row in
            row.map { words in
                words.sorted { $0.box.minX < $1.box.minX }
                    .map(\.text)
                    .joined(separator: " ")
                    .trimmingCharacters(in: .whitespaces)
            }
        }
        guard text.contains(where: { $0.contains { !$0.isEmpty } }) else { return nil }
        let table = MarkdownTable(header: text[0],
                                  rows: Array(text.dropFirst()),
                                  grid: true)
        return table.lines.joined(separator: "\n")
    }

    /// Whether a word is inside the grid — one that is has been read into
    /// the table and must not be read into the lines as well.
    static func holds(_ grid: Grid, word: CGRect) -> Bool {
        grid.box.insetBy(dx: -2, dy: -2).contains(CGPoint(x: word.midX, y: word.midY))
    }
}
