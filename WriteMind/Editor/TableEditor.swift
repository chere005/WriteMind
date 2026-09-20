import SwiftUI

/// A table on the rendered page, typed into as a grid.
///
/// It used to open as its markdown — click a table and you got
/// `| a | b |` in a text box, which is the one block where the rendered
/// page was worse than the source. Here every cell is its own field: click
/// one and type, Tab along the row and down to the next, Shift-Tab back,
/// and Tab past the last cell adds a row (the spreadsheet bargain — you
/// never reach for a button to keep going). Rows and columns are added and
/// taken away from the strip that appears under the table.
///
/// The markdown is still the storage: every change is written back as the
/// pipe-and-dash lines, so the note on disk is a GFM table either way. The
/// cell brackets still open the block as markdown, which is the way to the
/// raw lines when one is wanted.
struct TableEditor: View {
    let table: MarkdownTable
    /// The table, changed — the caller replaces the block's lines with it.
    var onChange: (MarkdownTable) -> Void

    @FocusState private var focus: MarkdownTable.Cell?
    /// The cell being typed in and what is in it so far. Held here rather
    /// than written through on every keystroke: rewriting the note's text
    /// re-parses and rebuilds the page, and the caret would not survive it.
    @State private var draft: (cell: MarkdownTable.Cell, text: String)?
    @State private var hovering = false

    private var lineColour: Color { Color.primary.opacity(0.18) }

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            grid
            if hovering || focus != nil { controls }
        }
        .onHover { hovering = $0 }
        .onChange(of: focus) { previous, _ in commit(previous) }
        .onDisappear { commit(draft?.cell) }
    }

    private var grid: some View {
        Grid(alignment: .leading, horizontalSpacing: 0, verticalSpacing: 0) {
            GridRow {
                ForEach(0..<table.columns, id: \.self) { column in
                    field(MarkdownTable.Cell(row: 0, column: column))
                }
            }
            Divider().gridCellUnsizedAxes(.horizontal).overlay(lineColour)
            ForEach(1..<max(1, table.rowCount), id: \.self) { row in
                GridRow {
                    ForEach(0..<table.columns, id: \.self) { column in
                        field(MarkdownTable.Cell(row: row, column: column))
                    }
                }
                if table.grid, row < table.rowCount - 1 {
                    Divider().gridCellUnsizedAxes(.horizontal).overlay(lineColour)
                }
            }
        }
        .padding(table.grid ? 0 : 2)
        .background {
            if table.grid { RoundedRectangle(cornerRadius: 4).strokeBorder(lineColour) }
        }
        .fixedSize(horizontal: false, vertical: true)
    }

    private func field(_ cell: MarkdownTable.Cell) -> some View {
        TextField("", text: binding(cell))
            .textFieldStyle(.plain)
            .font(.system(size: 14, weight: cell.isHeader ? .semibold : .regular))
            .padding(.horizontal, 10)
            .padding(.vertical, 5)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(focus == cell ? Color.accentColor.opacity(0.10) : Color.clear)
            .overlay(alignment: .trailing) {
                if table.grid { Rectangle().fill(lineColour).frame(width: 1) }
            }
            .focused($focus, equals: cell)
            // Tab is the whole point, and SwiftUI's own focus order does
            // not know that the end of the table means "another row".
            // Every key is looked at rather than just `.tab`, because
            // Shift-Tab arrives as backtab (U+0019) rather than as a tab
            // with a modifier on it.
            .onKeyPress(phases: .down) { press in
                if press.key == .tab {
                    press.modifiers.contains(.shift) ? stepBack(from: cell) : stepOn(from: cell)
                    return .handled
                }
                if press.characters == "\u{19}" {
                    stepBack(from: cell)
                    return .handled
                }
                return .ignored
            }
            .onSubmit { stepOn(from: cell) }
    }

    /// Add and take away, on the cell the caret is in — or the last one.
    private var controls: some View {
        HStack(spacing: 6) {
            control("Row", systemImage: "plus") { onChange(table.insertingRow(after: here.row)) }
            control("Row", systemImage: "minus") {
                if let smaller = table.removingRow(here.row == 0 ? table.rows.count : here.row) {
                    onChange(smaller)
                }
            }
            .disabled(table.rows.isEmpty)
            Divider().frame(height: 12)
            control("Column", systemImage: "plus") { onChange(table.insertingColumn(after: here.column)) }
            control("Column", systemImage: "minus") {
                if let smaller = table.removingColumn(here.column) { onChange(smaller) }
            }
            .disabled(table.columns < 2)
        }
        .font(.system(size: 11))
        .foregroundStyle(.secondary)
        .padding(.leading, 2)
    }

    private func control(_ title: String, systemImage: String,
                         action: @escaping () -> Void) -> some View {
        Button {
            commit(draft?.cell)
            action()
        } label: {
            Label(title, systemImage: systemImage)
                .labelStyle(.titleAndIcon)
                .padding(.horizontal, 6)
                .padding(.vertical, 2)
                .background(Color.primary.opacity(0.06), in: Capsule())
        }
        .buttonStyle(.plain)
    }

    // MARK: - Typing

    /// The cell the caret is in, or the bottom right when it is nowhere.
    private var here: MarkdownTable.Cell {
        focus ?? draft?.cell ?? MarkdownTable.Cell(row: table.rowCount - 1, column: table.columns - 1)
    }

    private func binding(_ cell: MarkdownTable.Cell) -> Binding<String> {
        Binding(
            get: { draft?.cell == cell ? (draft?.text ?? "") : table.text(at: cell) },
            set: { draft = (cell, $0) })
    }

    /// Write what was typed into the note. Nothing is written when the text
    /// came back the same — a click through a table would otherwise put an
    /// undo step on the stack for every cell it passed.
    private func commit(_ cell: MarkdownTable.Cell?) {
        guard let draft, draft.cell == cell else { return }
        self.draft = nil
        guard draft.text != table.text(at: draft.cell) else { return }
        onChange(table.setting(draft.text, at: draft.cell))
    }

    private func stepOn(from cell: MarkdownTable.Cell) {
        commit(cell)
        if let next = table.next(after: cell) {
            focus = next
            return
        }
        // Past the last cell: another row, and the caret at the front of it.
        onChange(table.insertingRow(after: table.rows.count))
        focusAfterRebuild(MarkdownTable.Cell(row: table.rowCount, column: 0))
    }

    private func stepBack(from cell: MarkdownTable.Cell) {
        commit(cell)
        if let previous = table.previous(before: cell) { focus = previous }
    }

    /// The note is re-parsed and the page rebuilt before a new row exists to
    /// put the caret in, so this waits a turn for it.
    private func focusAfterRebuild(_ cell: MarkdownTable.Cell) {
        DispatchQueue.main.async { focus = cell }
    }
}
