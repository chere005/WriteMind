import Foundation

/// A GFM table, read from and written to the pipe-and-dash lines every
/// markdown reader knows. Whether it is shown with grid lines is in the
/// writing itself (Sean, 2026-09-19: "add tables with grids or no grids"):
/// `| a | b |`, with a pipe at both ends, is a grid; `a | b`, without them,
/// is set open, with only a rule under the header. Both are tables to
/// anything else, so the choice costs nothing and survives any editor.
struct MarkdownTable: Equatable {
    var header: [String]
    var rows: [[String]]
    var grid: Bool

    var columns: Int { header.count }

    static func headerName(_ column: Int) -> String { "Column \(column)" }

    /// An empty table to type into: a header row, the rule, and `rows` blank rows.
    static func blank(columns: Int, rows: Int, grid: Bool) -> String {
        let header = (1...max(1, columns)).map(headerName)
        let rule = Array(repeating: "---", count: max(1, columns))
        let blank = Array(repeating: " ", count: max(1, columns))
        var lines = [line(header, grid: grid), line(rule, grid: grid)]
        for _ in 0..<max(0, rows) { lines.append(line(blank, grid: grid)) }
        return lines.joined(separator: "\n") + "\n"
    }

    static func line(_ cells: [String], grid: Bool) -> String {
        let inner = cells.map { $0.isEmpty ? " " : $0 }.joined(separator: " | ")
        return grid ? "| " + inner + " |" : inner
    }

    /// The whole table as lines, keeping its own grid choice.
    var lines: [String] {
        var out = [Self.line(header, grid: grid), Self.line(Array(repeating: "---", count: columns), grid: grid)]
        out += rows.map { Self.line($0, grid: grid) }
        return out
    }

    /// `| --- | :-: | ---: |` — the line that makes the one above it a header.
    static func isSeparator(_ line: String) -> Bool {
        let cells = self.cells(of: line)
        guard !cells.isEmpty, line.contains("-") else { return false }
        return cells.allSatisfy { cell in
            let bare = cell.trimmingCharacters(in: .whitespaces)
            guard bare.count >= 1 else { return false }
            return bare.allSatisfy { $0 == "-" || $0 == ":" } && bare.contains("-")
        }
    }

    /// A line that could be a row: it has a pipe that is not inside a code span.
    static func isRow(_ line: String) -> Bool {
        line.contains("|") && !line.trimmingCharacters(in: .whitespaces).isEmpty
    }

    /// Whether a row is written with pipes at both ends.
    static func hasOuterPipes(_ line: String) -> Bool {
        let bare = line.trimmingCharacters(in: .whitespaces)
        return bare.hasPrefix("|") && bare.hasSuffix("|") && bare.count > 1
    }

    /// The cells of one line, trimmed, the outer pipes dropped when there are
    /// any. A `\|` is a pipe inside a cell, not between two.
    static func cells(of line: String) -> [String] {
        var cells: [String] = []
        var current = ""
        var escaped = false
        for character in line.trimmingCharacters(in: .whitespaces) {
            if escaped {
                current.append(character == "|" ? "|" : "\\\(character)")
                escaped = false
            } else if character == "\\" {
                escaped = true
            } else if character == "|" {
                cells.append(current); current = ""
            } else {
                current.append(character)
            }
        }
        if escaped { current.append("\\") }
        cells.append(current)
        if hasOuterPipes(line) {
            if !cells.isEmpty { cells.removeFirst() }
            if !cells.isEmpty { cells.removeLast() }
        }
        return cells.map { $0.trimmingCharacters(in: .whitespaces) }
    }

    /// The table in `lines`, which must start with the header and its rule.
    /// Rows shorter than the header are padded, longer ones trimmed, so the
    /// grid is always rectangular.
    static func parse(_ lines: [String]) -> MarkdownTable? {
        guard lines.count >= 2, isRow(lines[0]), isSeparator(lines[1]) else { return nil }
        let header = cells(of: lines[0])
        guard !header.isEmpty else { return nil }
        let width = header.count
        let rows = lines.dropFirst(2).map { line -> [String] in
            var cells = self.cells(of: line)
            if cells.count < width { cells += Array(repeating: "", count: width - cells.count) }
            return Array(cells.prefix(width))
        }
        return MarkdownTable(header: header, rows: rows, grid: hasOuterPipes(lines[0]))
    }
}
