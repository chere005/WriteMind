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

    // MARK: - Editing the grid

    /// A place in the table. Row 0 is the header; row 1 is the first row
    /// under the rule, so one number walks the whole grid (Sean,
    /// 2026-09-19: a table should be "a grid you tab through, with rows and
    /// columns added and taken away").
    struct Cell: Hashable {
        var row: Int
        var column: Int

        var isHeader: Bool { row == 0 }
    }

    var rowCount: Int { rows.count + 1 }

    func contains(_ cell: Cell) -> Bool {
        cell.row >= 0 && cell.row < rowCount && cell.column >= 0 && cell.column < columns
    }

    func text(at cell: Cell) -> String {
        guard contains(cell) else { return "" }
        return cell.isHeader ? header[cell.column] : rows[cell.row - 1][cell.column]
    }

    func setting(_ text: String, at cell: Cell) -> MarkdownTable {
        guard contains(cell) else { return self }
        // A newline would end the row and a pipe would end the cell, so
        // neither can be typed into one: the line is the storage.
        let clean = text.replacingOccurrences(of: "\n", with: " ")
            .replacingOccurrences(of: "|", with: "\\|")
        var copy = self
        if cell.isHeader { copy.header[cell.column] = clean } else { copy.rows[cell.row - 1][cell.column] = clean }
        return copy
    }

    /// A blank row under `row` — under the header when that is where the
    /// caret is, at the end when `row` is past the last one.
    func insertingRow(after row: Int) -> MarkdownTable {
        var copy = self
        let index = min(max(row, 0), rows.count)
        copy.rows.insert(Array(repeating: "", count: columns), at: index)
        return copy
    }

    /// Nil when it is the last row: a table with no rows is a header and a
    /// rule, which is still a table, but taking the LAST one leaves nothing
    /// to take next and the command should simply be unavailable.
    func removingRow(_ row: Int) -> MarkdownTable? {
        guard row >= 1, row <= rows.count else { return nil }
        var copy = self
        copy.rows.remove(at: row - 1)
        return copy
    }

    func insertingColumn(after column: Int) -> MarkdownTable {
        var copy = self
        let index = min(max(column + 1, 0), columns)
        copy.header.insert(Self.headerName(index + 1), at: index)
        copy.rows = copy.rows.map { row in
            var row = row
            row.insert("", at: min(index, row.count))
            return row
        }
        return copy
    }

    /// Nil for the last column — a table needs one.
    func removingColumn(_ column: Int) -> MarkdownTable? {
        guard columns > 1, column >= 0, column < columns else { return nil }
        var copy = self
        copy.header.remove(at: column)
        copy.rows = copy.rows.map { row in
            var row = row
            if column < row.count { row.remove(at: column) }
            return row
        }
        return copy
    }

    /// Tab order: along the row, then down to the start of the next one.
    /// Nil past the last cell — which is where Tab adds a row.
    func next(after cell: Cell) -> Cell? {
        guard contains(cell) else { return nil }
        if cell.column + 1 < columns { return Cell(row: cell.row, column: cell.column + 1) }
        guard cell.row + 1 < rowCount else { return nil }
        return Cell(row: cell.row + 1, column: 0)
    }

    /// The other way, stopping at the first cell of the header.
    func previous(before cell: Cell) -> Cell? {
        guard contains(cell) else { return nil }
        if cell.column > 0 { return Cell(row: cell.row, column: cell.column - 1) }
        guard cell.row > 0 else { return nil }
        return Cell(row: cell.row - 1, column: columns - 1)
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
